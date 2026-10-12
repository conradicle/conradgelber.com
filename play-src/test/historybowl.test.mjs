// History Bowl Study: answer checking, era and region estimates, the
// reading schedule, and the device store (including export and import).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, parseAnswerline, mainAnswer, close } from '../src/historybowl/answer.js';
import { estimateEra, estimateRegion, yearsIn } from '../src/historybowl/tags.js';
import { words, sentences, schedule, shownAt, buzzFraction, cleanText } from '../src/historybowl/text.js';
import { loadRecords, saveRecords, loadCards, saveCards, exportData, importData, aggregate, loadSettings, KEYS, addSeen, loadSeen } from '../src/historybowl/store.js';

const judge = (line, given) => checkAnswer(line, given).directive;

test('accepts the underlined part and close spellings', () => {
  const line = 'Charles <b><u>de Gaulle</u></b>';
  assert.equal(judge(line, 'de Gaulle'), 'accept');
  assert.equal(judge(line, 'Charles de Gaulle'), 'accept');
  assert.equal(judge(line, 'de gaule'), 'accept');
  assert.equal(judge(line, 'Petain'), 'reject');
  assert.equal(judge(line, ''), 'reject');
});

test('alternates in brackets, parentheses and "or" in the main answer', () => {
  assert.equal(judge('<b><u>Inca</u></b>n Empire [or <b><u>Tawantinsuyu</u></b>]', 'Tawantinsuyu'), 'accept');
  assert.equal(judge('<b><u>Inca</u></b>n Empire [or <b><u>Tawantinsuyu</u></b>]', 'incan'), 'accept');
  assert.equal(judge('<b><u>Ku Klux Klan</u></b> (or <b><u>KKK</u></b>)', 'KKK'), 'accept');
  assert.equal(judge('<b><u>Scotland</u></b> or <b><u>Alba</u></b> (prompt on “United Kingdom” before “Campbell”)', 'Alba'), 'accept');
  assert.equal(judge('<b><u>Beijing</u></b> [or <b><u>Peking</u></b> before it is read]', 'Peking'), 'accept');
});

test('prompts and rejections', () => {
  const alex = '<b><u>Alexander the Great</u></b> [or <b><u>Alexander III</u></b> of Macedon; prompt on <u>Alexander</u>]';
  assert.equal(judge(alex, 'Alexander'), 'prompt');
  assert.equal(judge(alex, 'Alexander the Great'), 'accept');
  assert.equal(judge(alex, 'Alexander III'), 'accept');
  assert.equal(judge(alex, 'Alexander II'), 'prompt');
  const eic = '<b><u>British East India Trading Company</u></b> [accept the <b><u>John Company</u></b>; accept <b><u>British East India Company</u></b>; prompt on <u>East India Company</u> or <u>EIC</u>]';
  assert.equal(judge(eic, 'East India Company'), 'prompt');
  assert.equal(judge(eic, 'EIC'), 'prompt');
  assert.equal(judge(eic, 'British East India Company'), 'accept');
  const italy = 'Republic of <b><u>Italy</u></b> [or Repubblica <b><u>Italia</u></b>na; do NOT accept or prompt on Venice]';
  assert.equal(judge(italy, 'Venice'), 'reject');
  assert.equal(judge(italy, 'Italy'), 'accept');
});

test('pronunciation guides and plain-text answerlines', () => {
  const line = 'W. E. B. Du Bois [[doo-BOYSS]] (or William Edward Burghardt Du Bois; accept pronunciation as [[doo-BWAH]])';
  assert.equal(judge(line, 'Du Bois'), 'accept');
  assert.equal(judge(line, 'W.E.B. DuBois'), 'accept');
  assert.equal(mainAnswer(line), 'W. E. B. Du Bois');
  assert.equal(judge('Battle of Isandlwana', 'Isandlwana'), 'accept');
});

test('separately underlined names in one answer are alternatives; a compound name needs both', () => {
  const line = 'Arthur <b><u>Wellesley</u></b>, 1st Duke of <b><u>Wellington</u></b> [or the Iron Duke]';
  assert.equal(judge(line, 'Duke of Wellington'), 'accept');
  assert.equal(judge(line, 'Wellesley'), 'accept');
  assert.equal(judge('<b><u>Mayor</u></b> of the <b><u>Palace</u></b>', 'Mayor'), 'reject');
  assert.equal(judge('<b><u>Mayor</u></b> of the <b><u>Palace</u></b>', 'mayor of the palace'), 'accept');
});

test('numbers must match exactly', () => {
  assert.equal(close('1848', '1849'), false);
  assert.equal(judge('<b><u>Henry VIII</u></b>', 'Henry VII'), 'reject');
});

test('parseAnswerline keeps quoted examples of descriptive prompts', () => {
  const p = parseAnswerline('<b><u>Prohibition</u></b> (prompt on descriptions of “banning alcohol”)');
  assert.deepEqual(p.options.map((o) => o.kind), ['accept', 'prompt']);
  assert.equal(p.options[1].text, 'banning alcohol');
});

test('era from years, decades, centuries and BC dates', () => {
  assert.deepEqual(yearsIn('In the 1840s, and in 1215.'), [1840, 1215]);
  assert.deepEqual(yearsIn('around 480 BC'), [-480]);
  assert.equal(estimateEra('This treaty of 1648 ended a war begun in 1618.', 'European History'), 'early-modern');
  assert.equal(estimateEra('In the fifth century BCE this city fought Sparta.', 'Ancient History'), 'ancient');
  assert.equal(estimateEra('A 2014 annexation followed protests in 2013.', 'World History'), 'recent');
  assert.equal(estimateEra('No dates here at all.', 'Ancient History'), 'ancient');
  assert.equal(estimateEra('No dates here at all.', 'World History'), 'unknown');
  assert.equal(estimateEra('An army of 5000 men marched 1200 km.', 'World History'), 'unknown');
});

test('region from the subcategory first, then keywords', () => {
  assert.equal(estimateRegion('the British in Ohio', 'History', 'American History'), 'United States');
  assert.equal(estimateRegion('This Mughal emperor built a tomb in Agra for his wife.', 'History', 'World History'), 'South Asia');
  assert.equal(estimateRegion('This Somali leader fought the British.', 'History', 'World History'), 'Africa');
  assert.equal(estimateRegion('Mountains and rivers.', 'Geography', 'Geography'), 'Geography');
  assert.equal(estimateRegion('Nothing to go on.', 'History', 'Other History'), 'Region unclear');
});

test('words, sentences and the reading schedule', () => {
  const t = cleanText('W. E. B. Du Bois wrote this.  (*) He founded the NAACP. For 10 points, name him.');
  assert.ok(!t.includes('(*)'));
  const w = words(t);
  const s = sentences(w);
  assert.equal(s.length, 3);
  assert.deepEqual(w.slice(s[0][0], s[0][1]).join(' '), 'W. E. B. Du Bois wrote this.');
  const times = schedule(w, 240);
  assert.equal(times.length, w.length + 1);
  assert.equal(shownAt(times, 0), 1);
  assert.equal(shownAt(times, 1e9), w.length);
  // A sentence end takes longer than a plain word.
  assert.ok(times[7] - times[6] > times[2] - times[1]);
  assert.equal(buzzFraction(5, 10), 0.5);
  assert.equal(buzzFraction(12, 10), 1);
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
const rec = (id, extra = {}) => ({ id, qid: 'q' + id, src: 'qbreader', cat: 'History', sub: 'European History', era: 'medieval', region: 'Europe', ok: true, buzz: 0.5, ovr: false, ts: Number(id), ...extra });

test('store survives empty, blocked and corrupt storage', () => {
  assert.deepEqual(loadRecords(memoryStorage()), []);
  assert.deepEqual(loadRecords(null), []);
  assert.deepEqual(loadRecords(blocked), []);
  assert.equal(saveRecords(blocked, [rec('1')]), false);
  assert.deepEqual(loadSettings(blocked).sources, ['bee', 'qb']);
  const s = memoryStorage();
  s.setItem(KEYS.records, '{not json');
  assert.deepEqual(loadRecords(s), []);
  s.setItem(KEYS.records, JSON.stringify([rec('1'), { id: 2 }, null, rec('3', { buzz: 7 })]));
  const got = loadRecords(s);
  assert.equal(got.length, 2);
  assert.equal(got[1].buzz, 1);
  s.setItem(KEYS.settings, JSON.stringify({ wpm: 9999, level: 'bogus', answerSecs: 1 }));
  const set = loadSettings(s);
  assert.equal(set.wpm, 450);
  assert.equal(set.level, 'regional');
  assert.equal(set.answerSecs, 3);
});

test('seen list keeps the newest ids only once', () => {
  const s = memoryStorage();
  let seen = loadSeen(s);
  seen = addSeen(s, seen, 'a');
  seen = addSeen(s, seen, 'b');
  seen = addSeen(s, seen, 'a');
  assert.deepEqual(loadSeen(s), ['b', 'a']);
});

test('export then import into another device merges without duplicates', () => {
  const laptop = memoryStorage();
  saveRecords(laptop, [rec('1'), rec('2', { ok: false, buzz: null })]);
  saveCards(laptop, [{ id: 'c1', front: 'Clue', back: 'Answer', created: 1 }]);
  const file = JSON.parse(JSON.stringify(exportData(laptop, 0)));
  const phone = memoryStorage();
  saveRecords(phone, [rec('2', { ok: false, buzz: null }), rec('9')]);
  saveCards(phone, [{ id: 'c1', front: 'Clue', back: 'Answer', created: 1, fsrs: { lastReview: 50 } }]);
  const res = importData(phone, file);
  assert.deepEqual(res, { ok: true, records: 1, cards: 0, fixes: 0 });
  assert.deepEqual(loadRecords(phone).map((r) => r.id), ['1', '2', '9']);
  // The phone's card was reviewed more recently, so it stays.
  assert.equal(loadCards(phone)[0].fsrs.lastReview, 50);
  assert.equal(importData(phone, { kind: 'other' }).ok, false);
  assert.equal(importData(phone, { ...file, version: 99 }).ok, false);
  assert.equal(importData(blocked, file).ok, false);
});

test('aggregate averages buzz over correct answers only', () => {
  const rows = aggregate([rec('1', { buzz: 0.4 }), rec('2', { buzz: 0.8 }), rec('3', { ok: false, buzz: 0.1 }), rec('4', { cat: 'Geography' })], 'cat');
  const h = rows.find((r) => r.key === 'History');
  assert.equal(h.heard, 3);
  assert.equal(h.correct, 2);
  assert.ok(Math.abs(h.avgBuzz - 0.6) < 1e-9);
  assert.equal(rows[0].key, 'History');
  const only = aggregate([rec('1'), rec('2', { src: 'ai' })], 'cat', (r) => r.src === 'ai');
  assert.equal(only[0].heard, 1);
});
