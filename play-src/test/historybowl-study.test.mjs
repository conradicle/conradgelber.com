// History Bowl Study, phase 2: tag corrections, the weakest-areas ranking
// and FSRS flashcard scheduling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords, saveRecords, saveCards, loadCards, loadFixes, saveFix, withFix, exportData, importData } from '../src/historybowl/store.js';
import { weakestAreas, pointsOf, inAreas, MIN_IN_AREA } from '../src/historybowl/areas.js';
import { rate, preview, dueToday, dueNow, interleave, endOfDay, formatGap, testScheduler, Rating, isNew } from '../src/historybowl/srs.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
let n = 0;
const rec = (extra = {}) => ({ id: String(++n), qid: 'q' + n, src: 'qbreader', cat: 'History', sub: 'European History', era: 'medieval', region: 'Europe', ok: true, buzz: 0.5, ovr: false, ts: n, ...extra });
const many = (k, extra) => Array.from({ length: k }, () => rec(extra));

test('a correction applies to every record and card of that question, and to the question itself', () => {
  const s = memoryStorage();
  const records = [rec({ qid: 'jewel', sub: 'American History', region: 'United States' }), rec({ qid: 'jewel', sub: 'American History' }), rec({ qid: 'other' })];
  const cards = [{ id: 'c', front: 'f', back: 'b', created: 1, qid: 'jewel', sub: 'American History', cat: 'History' }];
  saveRecords(s, records);
  saveCards(s, cards);
  const st = saveFix(s, { fixes: loadFixes(s), records: loadRecords(s), cards: loadCards(s) }, 'jewel', { sub: 'World History', region: 'East Asia' });
  const after = loadRecords(s);
  assert.deepEqual(after.filter((r) => r.qid === 'jewel').map((r) => [r.sub, r.region, r.fx.sort().join()]), [['World History', 'East Asia', 'region,sub'], ['World History', 'East Asia', 'region,sub']]);
  assert.equal(after.find((r) => r.qid === 'other').sub, 'European History');
  assert.equal(loadCards(s)[0].sub, 'World History');
  assert.deepEqual(loadFixes(s), { jewel: { sub: 'World History', region: 'East Asia' } });
  const q = withFix({ id: 'jewel', category: 'History', subcategory: 'American History', era: 'world-wars', region: 'United States' }, st.fixes);
  assert.equal(q.subcategory, 'World History');
  assert.equal(q.region, 'East Asia');
  assert.equal(q.era, 'world-wars');
});

test('corrections travel in exports; this device keeps its own on a clash', () => {
  const a = memoryStorage();
  saveRecords(a, [rec({ qid: 'x' })]);
  saveFix(a, { fixes: {}, records: loadRecords(a), cards: [] }, 'x', { era: 'cold-war', sub: 'World History' });
  const file = JSON.parse(JSON.stringify(exportData(a)));
  const b = memoryStorage();
  saveFix(b, { fixes: {}, records: [], cards: [] }, 'x', { era: 'recent' });
  const res = importData(b, file);
  assert.equal(res.fixes, 1);
  assert.deepEqual(loadFixes(b).x, { era: 'recent', sub: 'World History' });
  assert.equal(loadRecords(b)[0].era, 'recent');
});

test('points reward early correct buzzes', () => {
  assert.equal(pointsOf(rec({ ok: false })), 0);
  assert.equal(pointsOf(rec({ buzz: 0 })), 1);
  assert.equal(pointsOf(rec({ buzz: 1 })), 0.5);
  assert.equal(pointsOf(rec({ buzz: null })), 0.5);
});

test('weakest areas need 8 tossups and rank subcategories first', () => {
  const records = [
    ...many(MIN_IN_AREA, { sub: 'Ancient History', ok: false, era: 'ancient', region: 'Ancient world' }),
    ...many(MIN_IN_AREA, { sub: 'American History', buzz: 0.9, region: 'United States', era: 'revolutions' }),
    ...many(MIN_IN_AREA - 1, { sub: 'World History', ok: false, region: 'Africa' }),
    ...many(20, { sub: 'European History', buzz: 0.2 }),
  ];
  const w = weakestAreas(records);
  assert.deepEqual(w.map((a) => a.key), ['Ancient History', 'American History', 'European History']);
  assert.ok(w.every((a) => a.kind === 'sub' && !a.estimated));
  // World History has only 7 tossups, so it does not count yet.
  assert.ok(!w.some((a) => a.key === 'World History'));
});

test('estimated era and region only fill the list, and say so', () => {
  const records = [...many(10, { sub: 'European History', buzz: 0.3, era: 'medieval', region: 'Europe' }), ...many(4, { sub: 'World History', ok: false, era: 'medieval', region: 'Africa' }), ...many(4, { sub: 'Other History', ok: false, era: 'medieval', region: 'Africa' })];
  const w = weakestAreas(records);
  assert.equal(w[0].kind, 'sub');
  assert.equal(w[0].key, 'European History');
  const africa = w.find((a) => a.key === 'Africa');
  assert.ok(africa && africa.kind === 'region' && africa.estimated && /estimated/.test(africa.label));
  // Corrected by hand, a region is no longer an estimate.
  const fixed = records.map((r) => (r.region === 'Africa' ? { ...r, fx: ['region'] } : r));
  assert.equal(weakestAreas(fixed).find((a) => a.key === 'Africa').estimated, false);
});

test('Bee nationals tossups count half', () => {
  const bee = many(8, { sub: 'World History', ok: false, src: 'iac-bee-qbreader' });
  const reg = many(8, { sub: 'World History', buzz: 0 });
  const w = weakestAreas([...bee, ...reg], { count: 1 });
  // Unweighted the score would be 0.5; with the misses at half weight, 2/3.
  assert.ok(Math.abs(w[0].score - 2 / 3) < 1e-9);
});

test('inAreas matches by subcategory, era or region', () => {
  const q = { subcategory: 'World History', era: 'ancient', region: 'East Asia' };
  assert.ok(inAreas(q, [{ kind: 'sub', key: 'World History' }]));
  assert.ok(inAreas(q, [{ kind: 'region', key: 'East Asia' }]));
  assert.ok(!inAreas(q, [{ kind: 'era', key: 'recent' }]));
});

test('FSRS: a new card is due; rating schedules it; Again comes back soonest', () => {
  const f = testScheduler();
  const now = Date.UTC(2026, 9, 12, 12);
  const card = { id: 'a', front: 'f', back: 'b', created: now, fsrs: null, cat: 'History' };
  assert.ok(isNew(card));
  assert.equal(dueToday([card], now).length, 1);
  const again = rate(null, Rating.Again, now, f);
  const easy = rate(null, Rating.Easy, now, f);
  assert.ok(again.due < easy.due);
  assert.equal(again.lastReview, now);
  const later = { ...card, fsrs: easy };
  assert.equal(dueNow([later], now).length, 0);
  assert.equal(dueToday([later], easy.due - 1000).length, 1);
  // A card failed a minute ago is due today but waits its minute.
  const failed = { ...card, fsrs: again };
  assert.equal(dueToday([failed], now).length, 1);
  assert.equal(dueNow([failed], now).length, 0);
  // Survives JSON and keeps its schedule.
  const round = JSON.parse(JSON.stringify(easy));
  const good = rate(round, Rating.Good, easy.due, f);
  assert.ok(good.due > easy.due);
  assert.equal(good.reps, 2);
  const p = preview(null, now, f);
  assert.deepEqual(Object.keys(p), ['again', 'hard', 'good', 'easy']);
});

test('gaps and day ends', () => {
  assert.equal(formatGap(60_000), '1m');
  assert.equal(formatGap(3 * 3600_000), '3h');
  assert.equal(formatGap(8 * 86400_000), '8d');
  const now = new Date(2026, 9, 12, 9).getTime();
  assert.equal(new Date(endOfDay(now)).getHours(), 23);
});

test('interleaving avoids back-to-back subcategories when it can', () => {
  const cards = [...Array.from({ length: 4 }, (_, i) => ({ id: 'h' + i, cat: 'History', sub: 'European History' })), ...Array.from({ length: 4 }, (_, i) => ({ id: 'g' + i, cat: 'Geography', sub: 'Geography' }))];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = interleave(cards, rnd);
  assert.equal(out.length, 8);
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].sub, out[i - 1].sub);
});

test('accents split off by PDF conversion are put back', async () => {
  const { joinAccents } = await import('../src/historybowl/question.js');
  const { checkAnswer } = await import('../src/historybowl/answer.js');
  const line = joinAccents('Gust\u00b4av Hus\u00b4ak');
  assert.equal(line, 'Gust\u00e1v Hus\u00e1k');
  assert.equal(checkAnswer(line, 'Gustav Husak').directive, 'accept');
  assert.equal(checkAnswer(line, 'Husak').directive, 'accept');
});
