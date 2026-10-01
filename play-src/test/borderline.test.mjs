// Borderline: the window calculation, scoring, daily seeding and names,
// then the known cases run through the real judge on a fixture of CShapes
// records (test/borderline/fixture-geo.json, from make-fixture.mjs), the
// curated Russian Alaska map, and checks over the whole committed bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { windowAround, windowFromSpans, windowYears, addDays } from '../src/borderline/window.js';
import { scoreGuess, yearsOff, MAX, K, HINT_COST } from '../src/borderline/score.js';
import { dailyKey, dailyPicks } from '../src/borderline/seed.js';
import { titleCase } from '../src/borderline/text.js';
import { loadNames, labelFor } from '../scripts/borderline/lib/names.mjs';
import { loadWorld } from '../scripts/borderline/lib/world.mjs';
import { Crop } from '../scripts/borderline/lib/judge.mjs';
import { scaleForWidth } from '../src/borderline/projection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

// ---------- the window function

test('window runs from the latest visible change to the day before the next', () => {
  const changes = [
    { date: '1900-01-01', visible: true, tell: 'a' },
    { date: '1905-06-01', visible: false },
    { date: '1908-10-07', visible: true, tell: 'b' },
    { date: '1913-01-01', visible: true, tell: 'c' },
    { date: '1920-01-01', visible: true, tell: 'd' },
  ];
  const w = windowAround('1910-06-01', changes, { first: '1886-01-01', last: 'present' });
  assert.equal(w.start, '1908-10-07');
  assert.equal(w.end, '1912-12-31');
  assert.equal(w.startTell, 'b');
  assert.equal(w.endTell, 'c');
  assert.equal(w.startCensored, false);
});

test('a change on the shown day opens the window; no change means a dataset edge', () => {
  const w = windowAround('1908-10-07', [{ date: '1908-10-07', visible: true }], { first: '1886-01-01', last: 'present' });
  assert.equal(w.start, '1908-10-07');
  assert.equal(w.end, 'present');
  assert.equal(w.endCensored, true);
  const e = windowAround('1890-01-01', [], { first: '1886-01-01', last: 'present' });
  assert.equal(e.startCensored, true);
  assert.equal(e.start, '1886-01-01');
});

test('spans: latest start and earliest end, with their tells', () => {
  const w = windowFromSpans('1855-01-01', [
    { unit: 'oregon', from: '1846-06-15', to: 'present', tell: {} },
    { unit: 'alaska', from: '1799-07-08', to: '1867-10-17', tell: {} },
  ], { first: '1600-01-01', last: 'present' });
  assert.equal(w.start, '1846-06-15');
  assert.equal(w.end, '1867-10-17');
  assert.equal(w.startTell.unit, 'oregon');
  assert.equal(w.endTell.unit, 'alaska');
  assert.equal(w.endTell.date, '1867-10-18');
});

test('window years are inclusive and present means the current year', () => {
  assert.deepEqual(windowYears({ start: '1918-11-03', end: '1938-09-29' }, 2026), [1918, 1938]);
  assert.deepEqual(windowYears({ start: '2022-06-01', end: 'present' }, 2026), [2022, 2026]);
  assert.equal(addDays('1900-02-28', 1), '1900-03-01');
  assert.equal(addDays('2000-03-01', -1), '2000-02-29');
});

// ---------- scoring and seeding

test('scoring: full marks inside, decay with K outside, tell costs 1000', () => {
  assert.equal(K.N, 15);
  assert.equal(K.H, 8);
  assert.equal(scoreGuess(1910, [1908, 1912], 'N', false), MAX);
  assert.equal(scoreGuess(1923, [1908, 1912], 'N', false), Math.round(MAX * Math.exp(-11 / 15)));
  assert.equal(scoreGuess(1900, [1908, 1912], 'H', false), Math.round(MAX * Math.exp(-1)));
  assert.equal(scoreGuess(1910, [1908, 1912], 'N', true), MAX - HINT_COST);
  assert.equal(scoreGuess(1700, [1908, 1912], 'N', true), 0);
  assert.equal(yearsOff(1912, 1908, 1912), 0);
});

test('the daily date is New York time', () => {
  assert.equal(dailyKey(new Date('2026-10-02T03:30:00Z')), '2026-10-01');
  assert.equal(dailyKey(new Date('2026-10-02T04:30:00Z')), '2026-10-02');
});

test('daily picks are the same for everyone and distinct', () => {
  const index = read(path.join(site, 'borderline/data/index.json'));
  const a = dailyPicks(index, 'N', '2026-10-01', 5);
  const b = dailyPicks(index, 'N', '2026-10-01', 5);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 5);
  assert.notDeepEqual(a, dailyPicks(index, 'N', '2026-10-02', 5));
});

// ---------- names

test('renames from the brief carry their verified dates', () => {
  const names = loadNames();
  const at = (unit, date, status = 'independent', owner = '') =>
    labelFor(names, { unit, name: '', status, owner }, date).text;
  assert.equal(at('g630', '1935-03-20'), 'PERSIA');
  assert.equal(at('g630', '1935-03-21'), 'IRAN');
  assert.equal(at('g800', '1939-06-23'), 'SIAM');
  assert.equal(at('g800', '1939-06-24'), 'THAILAND');
  assert.equal(at('g780', '1972-05-21'), 'CEYLON');
  assert.equal(at('g780', '1972-05-22'), 'SRI LANKA');
  assert.equal(at('g490', '1971-10-26'), 'CONGO (KINSHASA)');
  assert.equal(at('g490', '1971-10-27'), 'ZAIRE');
  assert.equal(at('g490', '1997-05-16'), 'ZAIRE');
  assert.equal(at('g490', '1997-05-17'), 'DEM. REP. OF THE CONGO');
  assert.equal(at('g775', '1989-06-17'), 'BURMA');
  assert.equal(at('g775', '1989-06-18'), 'MYANMAR');
  assert.equal(at('g365', '1922-12-30'), 'U.S.S.R.');
  assert.equal(at('g365', '1991-12-26'), 'RUSSIA');
  assert.equal(at('g345', '1929-10-03'), 'YUGOSLAVIA');
  assert.equal(at('g300', '1900-01-01'), 'AUSTRIA-HUNGARY');
  assert.equal(at('g640', '1923-10-28'), 'OTTOMAN EMPIRE');
  assert.equal(at('g640', '2022-06-01'), 'TÜRKIYE');
  assert.equal(at('g452', '1950-01-01', 'colony', '200'), 'GOLD COAST (BR.)');
  assert.equal(titleCase('EMPIRE OF BRAZIL'), 'Empire of Brazil');
});

// ---------- known cases through the real judge

const fixture = path.join(here, 'borderline/fixture-geo.json');
const world = loadWorld(fixture, { strict: false });
const names = loadNames();
for (const c of read(path.join(here, 'borderline/cases.json'))) {
  test('judge: ' + c.name, () => {
    const crop = new Crop(world, names, { c: c.center, s: scaleForWidth(c.km) });
    crop.maxYears = Infinity;
    const r = crop.judge(c.shown, 'N', crop.view(c.shown, 'N', { maxSea: 1, maxBlank: 1 }));
    assert.equal(r.reject, undefined, 'rejected: ' + r.reject);
    if (c.start) assert.equal(r.start, c.start);
    if (c.startKind) assert.equal(r.startTell.kind, c.startKind);
    if (c.end) assert.equal(r.end, c.end);
    if (c.endKind) assert.equal(r.endTell.kind, c.endKind);
    if (c.endUnit) assert.equal(r.endTell.a.unit, c.endUnit);
  });
}

// ---------- the curated Russian Alaska map

test('a map with Russian Alaska ends in 1867', () => {
  const cur = read(path.join(here, '../data/borderline/curated.json'));
  const alaska = cur.puzzles.find((q) => q.id === 'C01');
  const w = windowFromSpans(alaska.shown, alaska.facts.map((f) => ({ unit: f.about, from: f.from || '1600-01-01', to: f.to || 'present', tell: {} })), { first: '1600-01-01', last: 'present' });
  assert.equal(w.end, '1867-10-17');
  assert.equal(w.endTell.unit, 'Russian Empire');
  const built = read(path.join(site, 'borderline/data/bank/C-00.json')).find((p) => p.id === 'C01');
  assert.equal(built.win.ey, 1867);
  for (const q of cur.puzzles) for (const f of q.facts) assert.match(f.source, /^https:\/\//, q.id + ' fact without a source');
});

// ---------- the committed bank

const bankDir = path.join(site, 'borderline/data/bank');
const bank = existsSync(bankDir)
  ? readdirSync(bankDir).filter((f) => /^[NHC]-\d+\.json$/.test(f)).flatMap((f) => read(path.join(bankDir, f)))
  : [];
const labels = (p) => p.labels.map((l) => l.t.join(' '));

test('bank: every window fits the rules', () => {
  assert.ok(bank.length > 1000, 'bank has ' + bank.length + ' puzzles');
  for (const p of bank) {
    const ey = p.win.ey === 'present' ? 2026 : p.win.ey;
    assert.ok(ey - p.win.sy <= 30, p.id + ' window wider than 30 years');
    assert.ok(p.labels.length >= 3, p.id + ' has fewer than 3 labels');
    assert.ok(p.win.start <= p.shown && (p.win.end === 'present' || p.shown <= p.win.end), p.id + ' shown date outside its window');
    assert.ok(p.tells.start && p.tells.start.text, p.id + ' has no start tell');
  }
});

test('bank: Austria-Hungary maps end by 1918, U.S.S.R. maps by 1991, Zaire maps start in 1971 or later', () => {
  for (const p of bank) {
    const l = labels(p);
    if (l.includes('AUSTRIA-HUNGARY') && p.src === 'cs') assert.ok(p.win.end <= '1918-11-02', p.id);
    if (l.includes('U.S.S.R.')) assert.ok(p.win.end <= '1991-12-25' && p.win.start >= '1922-12-30', p.id);
    if (l.includes('ZAIRE')) assert.ok(p.win.start >= '1971-10-27' && p.win.end <= '1997-05-16', p.id);
    if (l.includes('PERSIA')) assert.ok(p.win.end <= '1935-03-20', p.id);
  }
  const ah = bank.filter((p) => p.tells.end && p.tells.end.unit === 'g300' && p.src === 'cs');
  assert.ok(ah.length > 0, 'some map should end on the end of Austria-Hungary');
  for (const p of ah) assert.equal(p.win.ey, 1918, p.id);
});
