// The QB Reader proxy: query checks, the category mix and answerline cleaning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBonusQuery, parseTossupQuery, splitByWeight } from '../src/qb.js';
import { fromQbTossup, safeAnswerHtml } from '../../play-src/src/historybowl/question.js';

const q = (s) => parseTossupQuery(new URLSearchParams(s));

test('tossup queries accept only known values', () => {
  assert.deepEqual(q('src=bee,qb&cats=History,Geography&level=regional&n=8'), { src: ['bee', 'qb'], cats: ['History', 'Geography'], subs: [], level: 'regional', n: 8 });
  assert.equal(q('src=bee&cats=History&subs=European%20History').subs[0], 'European History');
  assert.equal(q('src=evil&cats=History'), null);
  assert.equal(q('src=qb&cats=History,Bogus'), null);
  assert.equal(q('src=qb&cats=History&subs=Bogus'), null);
  assert.equal(q('src=qb&cats=History&level=college'), null);
  assert.equal(q('src=qb&cats=History&n=500'), null);
  assert.equal(q('src=qb&cats=History&n=2.5'), null);
  assert.equal(q('cats=History'), null);
});

test('history gets most of a mixed draw', () => {
  let i = 0;
  const seq = () => ((i = (i * 9301 + 49297) % 233280) / 233280);
  const counts = splitByWeight(['History', 'Geography', 'Fine Arts', 'Literature'], 1000, seq);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 1000);
  assert.ok(counts.History > 550 && counts.History < 750, JSON.stringify(counts));
  assert.deepEqual(splitByWeight(['Geography'], 5), { Geography: 5 });
});

test('answerlines keep emphasis tags and lose everything else', () => {
  assert.equal(safeAnswerHtml('<b><u>Congo</u></b> [accept <B>Zaire</B>]'), '<b><u>Congo</u></b> [accept <b>Zaire</b>]');
  assert.equal(safeAnswerHtml('<img src=x onerror=alert(1)>Habsburg<script>x</script>'), 'Habsburgx');
  assert.equal(safeAnswerHtml('<b onclick="x">Rome</b>'), 'Rome</b>');
  assert.equal(safeAnswerHtml('Tom & Jerry <3'), 'Tom &amp; Jerry &lt;3');
});

test('QB Reader tossups map to the shared shape', () => {
  const t = fromQbTossup({
    _id: 'abc',
    question_sanitized: 'This treaty of 1648 (*) ended the Thirty Years\' War. For 10 points, name it.',
    answer: 'Peace of <b><u>Westphalia</u></b>',
    answer_sanitized: 'Peace of Westphalia',
    category: 'History',
    subcategory: 'European History',
    set: { name: '2019 History Bee Nationals', year: 2019 },
    packet: { number: 3 },
    number: 12,
    difficulty: 0,
  }, 'bee');
  assert.equal(t.id, 'qb:abc');
  assert.equal(t.source, 'iac-bee-qbreader');
  assert.ok(!t.text.includes('(*)'));
  assert.equal(t.era, 'early-modern');
  assert.equal(t.region, 'Europe');
  assert.equal(t.packet, 3);
});

test('bonus queries: one known category, a subcategory that belongs to it', () => {
  const b = (s) => parseBonusQuery(new URLSearchParams(s));
  assert.deepEqual(b('cat=History&sub=World%20History&n=10'), { cat: 'History', sub: 'World History', level: 'regional', n: 10 });
  assert.equal(b('cat=Geography').sub, '');
  assert.equal(b('cat=Geography&sub=World%20History'), null);
  assert.equal(b('cat=Bogus'), null);
  assert.equal(b('cat=History&n=50'), null);
});

test('the team passcode check', async () => {
  const { passcodeMatches } = await import('../src/passcode.js');
  assert.equal(await passcodeMatches('rho kappa', 'rho kappa'), true);
  assert.equal(await passcodeMatches(' rho kappa ', 'rho kappa'), true);
  assert.equal(await passcodeMatches('rho', 'rho kappa'), false);
  assert.equal(await passcodeMatches('', 'rho kappa'), false);
  assert.equal(await passcodeMatches('x', ''), false);
});
