// History Bowl Study, phase 5: parsing an NHBB packet's text into quarters.
// The fixture is a packet written for this test in the regional layout
// (no IAC text): title lines, running footers, four quarters, bonuses,
// lightning categories titled two ways, and point markers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePacket, quarterOf, looksLikeCategory, packetComplete, stripMarkers, balanceBold } from '../src/historybowl/packet.js';
import { fromPacket, packetId } from '../src/historybowl/question.js';
import { checkAnswer } from '../src/historybowl/answer.js';

const fixture = readFileSync(new URL('./historybowl/packet-fixture.txt', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((html) => ({ html, text: html.replace(/<[^>]*>/g, '') }));

test('quarter headings in their usual spellings', () => {
  assert.equal(quarterOf('FIRST QUARTER'), 1);
  assert.equal(quarterOf('Second Quarter'), 2);
  assert.equal(quarterOf('Quarter 3'), 3);
  assert.equal(quarterOf('Lightning Round'), 3);
  assert.equal(quarterOf('4th Quarter:'), 4);
  assert.equal(quarterOf('EXTRA QUESTIONS'), 'extra');
  assert.equal(quarterOf('Tiebreaker Tossups'), 'extra');
  assert.equal(quarterOf('This quarter of the city was burned in 64 AD.'), null);
});

test('category titles look like titles', () => {
  assert.ok(looksLikeCategory('Ancient Rome'));
  assert.ok(looksLikeCategory('Twentieth-Century Asia'));
  assert.ok(!looksLikeCategory('Name the first emperor of Rome.'));
  assert.ok(!looksLikeCategory('this man won at Zama'));
  assert.equal(stripMarkers('A clue. (+) Another. (*) For the point, name it.'), 'A clue. Another. For the point, name it.');
});

test('the fixture packet parses completely', () => {
  const p = parsePacket(fixture, { file: 'fixture.pdf' });
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.meta, { file: 'fixture.pdf', title: 'National History Bowl Regional Tournament 2019-2020', set: 'A', year: '2019-2020', round: 3 });
  assert.equal(p.q1.length, 10);
  assert.equal(p.q2.length, 8);
  assert.deepEqual(p.q3.map((c) => [c.category, c.questions.length]), [['Ancient Rome', 8], ['Explorers', 8], ['Twentieth-Century Asia', 8]]);
  assert.equal(p.q4.length, 8);
  assert.equal(p.extra.length, 1);
  assert.ok(packetComplete(p));
  // Lines that wrap are joined; footers are dropped.
  assert.equal(p.q1[0].text, 'This general crossed the Rubicon in 49 BC, starting a civil war. For the point, name this Roman who was assassinated on the Ides of March.');
  assert.ok(!p.q1.some((q) => /Page/.test(q.text)));
  // Bonuses attach to their tossups.
  assert.equal(p.q2[0].bonus.answer, 'Cardinal Richelieu');
  assert.ok(p.q2[0].bonus.text.endsWith('chief minister of Louis XIII.'));
  // An answer that wraps keeps both lines.
  assert.equal(p.q3[0].questions[6].answer, 'Appian Way [or Via Appia]');
  // Point markers are removed from fourth-quarter text.
  assert.ok(!/\(\+\)|\(\*\)/.test(p.q4[0].text));
});

test('bold in the answer is the required part', () => {
  assert.equal(balanceBold('Appian</b> Way'), '<b>Appian</b> Way');
  assert.equal(balanceBold('Gaius <b>Caesar</b>'), 'Gaius <b>Caesar</b>');
  const run = parsePacket([{ text: 'FIRST QUARTER' }, { text: '1. Name this road.' }, { text: 'ANSWER: Appian Way', html: '<b>ANSWER: Appian</b> Way' }]);
  assert.equal(run.q1[0].answerHtml, '<b>Appian</b> Way');
  const p = parsePacket(fixture);
  assert.equal(p.q1[0].answerHtml, 'Gaius Julius <b>Caesar</b>');
  assert.equal(checkAnswer(p.q1[0].answerHtml, 'Caesar').directive, 'accept');
  assert.equal(checkAnswer(p.q1[0].answerHtml, 'Pompey').directive, 'reject');
  assert.equal(checkAnswer(p.q1[3].answerHtml, 'Elizabeth').directive, 'prompt');
});

test('problems are reported, not guessed', () => {
  const broken = parsePacket([
    { text: 'FIRST QUARTER' },
    { text: '1. A question with no answer line.' },
    { text: '2. Another question.' },
    { text: 'ANSWER: Something' },
    { text: 'SECOND QUARTER' },
    { text: 'ANSWER: stray' },
  ]);
  assert.ok(broken.problems.includes('Q1 1 has no answer'));
  assert.ok(broken.problems.some((m) => m.startsWith('Answer with no question')));
  assert.ok(broken.problems.some((m) => m.startsWith('Q1 has 2 tossups')));
  assert.equal(packetComplete(broken), false);
});

test('a packet becomes questions in the shared shape', () => {
  const pk = fromPacket(parsePacket(fixture));
  assert.equal(pk.id, '2019-2020-A-r3');
  assert.equal(packetId({ file: 'NHBB 2016 A Round 5.pdf', year: '', set: '', round: null }), 'NHBB-2016-A-Round-5');
  assert.equal(pk.label, '2019-2020 A Set Round 3');
  const q = pk.q1[0];
  assert.equal(q.source, 'iac-packet-short');
  assert.equal(q.id, 'iac:2019-2020-A-r3:q1-1');
  assert.equal(q.answerPlain, 'Gaius Julius Caesar');
  assert.equal(q.subGuess, true);
  assert.equal(pk.q2[0].tossup.source, 'iac-packet');
  assert.equal(pk.q2[0].bonus.answerPlain, 'Cardinal Richelieu');
  assert.equal(pk.q3[1].label, 'Explorers');
  assert.equal(pk.q3[1].questions.length, 8);
  assert.equal(pk.q4[1].region, 'Middle East');
  assert.equal(pk.q4[1].subcategory, 'World History');
  assert.equal(pk.q1[4].subcategory, 'American History');
  // Dated BC: ancient, whatever the place words say ("civil war" here).
  assert.equal(pk.q1[0].subcategory, 'Ancient History');
});
