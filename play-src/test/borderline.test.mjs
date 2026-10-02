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
import { dailyKey, dailyPicks, scheduleDays, allIds, pick, rng } from '../src/borderline/seed.js';
import { titleCase } from '../src/borderline/text.js';
import { loadNames, labelFor } from '../scripts/borderline/lib/names.mjs';
import { loadWorld } from '../scripts/borderline/lib/world.mjs';
import { Crop } from '../scripts/borderline/lib/judge.mjs';
import { scaleForWidth } from '../src/borderline/projection.js';
import { tellNeeds, readableSize, contestedIn } from '../scripts/borderline/lib/fairness.mjs';
import { LABEL_READABLE, LABEL_INSET } from '../scripts/borderline/config.mjs';
import { boxH } from '../scripts/borderline/lib/labels.mjs';

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

test('a daily puzzle comes back only after the whole schedule, exactly that many days later', () => {
  const index = read(path.join(site, 'borderline/data/index.json'));
  for (const d of ['N', 'H']) {
    const days = scheduleDays(index, d, 5);
    const seenOn = new Map();
    const start = Date.parse('2026-09-01T00:00:00Z');
    for (let k = 0; k < days * 2 + 3; k++) {
      const key = new Date(start + k * 864e5).toISOString().slice(0, 10);
      for (const id of dailyPicks(index, d, key, 5)) {
        if (seenOn.has(id)) assert.equal(k - seenOn.get(id), days, d + ' ' + id + ' repeats after ' + (k - seenOn.get(id)) + ' days');
        seenOn.set(id, k);
      }
    }
    // One full schedule covers every puzzle but the remainder, once each.
    assert.equal(seenOn.size, days * 5);
  }
});

test('a full daily schedule matches the bank era by era', () => {
  const index = read(path.join(site, 'borderline/data/index.json'));
  const n = index.difficulties.N;
  const eraOf = (id) => (id[0] === 'C' ? 'C' : n.eraOffsets.filter((o) => Number(id.slice(1)) >= o).length - 1);
  const want = new Map(), got = new Map();
  for (const id of allIds(index, 'N')) want.set(eraOf(id), (want.get(eraOf(id)) || 0) + 1);
  for (let k = 0; k < scheduleDays(index, 'N', 5); k++) {
    const key = new Date(Date.parse('2026-10-01T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
    for (const id of dailyPicks(index, 'N', key, 5)) got.set(eraOf(id), (got.get(eraOf(id)) || 0) + 1);
  }
  for (const [era, count] of want) assert.ok(Math.abs((got.get(era) || 0) - count) <= 4, 'era ' + era);
});

test('practice picks skip maps already seen', () => {
  const index = read(path.join(site, 'borderline/data/index.json'));
  const all = allIds(index, 'H');
  const avoid = new Set(all.slice(5));
  assert.deepEqual(new Set(pick(index, 'H', rng(7), 5, avoid)), new Set(all.slice(0, 5)));
});

// ---------- fairness checks

test('tells name the countries a player must find, and none for an absence', () => {
  const A = { unit: 'gA', label: 'A' }, B = { unit: 'gB', label: 'B' }, blank = { unit: 'blank' };
  assert.deepEqual(tellNeeds({ kind: 'border', a: A, b: B }, 'start'), ['gB', 'gA']);
  assert.deepEqual(tellNeeds({ kind: 'border', a: A, b: B, born: true }, 'start'), ['gB']);
  assert.deepEqual(tellNeeds({ kind: 'border', a: A, b: B, born: true }, 'end'), []);
  assert.deepEqual(tellNeeds({ kind: 'border', a: A, b: B, gone: true }, 'start'), []);
  assert.deepEqual(tellNeeds({ kind: 'border', a: A, b: B, gone: true }, 'end'), ['gA']);
  assert.deepEqual(tellNeeds({ kind: 'border', a: blank, b: B }, 'start'), ['gB']);
  assert.deepEqual(tellNeeds({ kind: 'name', a: A, b: B }, 'end'), ['gA']);
  assert.deepEqual(tellNeeds({ kind: 'transfer', a: A, b: B }, 'start'), ['gB']);
});

test('a label in the corner or over the frame rule is not readable', () => {
  assert.equal(readableSize({ lines: ['UPPER VOLTA'], x: 180, y: 200, size: 13, w: 80 }), 13);
  assert.equal(readableSize({ lines: ['UPPER VOLTA'], x: 42, y: 8, size: 13, w: 80 }), 0);
  assert.equal(readableSize({ lines: ['UPPER VOLTA'], x: 44, y: 14, size: 13, w: 80 }), 0);
});

test('Crimea after 18 March 2014 is never in a window, nor its annexation as a tell', () => {
  const p = { c: [34, 46], s: scaleForWidth(1500) };
  assert.equal(contestedIn(p, '2014-03-18', 'present'), 'Crimea');
  assert.equal(contestedIn(p, '1992-01-01', '2014-03-17'), 'Crimea');
  assert.equal(contestedIn(p, '1992-01-01', '2014-03-16'), null);
  assert.equal(contestedIn({ c: [10, 50], s: scaleForWidth(1500) }, '2014-03-18', 'present'), null);
});

test('the West Bank, Gaza and Golan after 10 June 1967 and Western Sahara after 1975 are rejected', () => {
  const levant = { c: [35, 32], s: scaleForWidth(2500) };
  assert.equal(contestedIn(levant, '1957-01-01', '1967-06-10'), 'West Bank, Gaza and Golan');
  assert.equal(contestedIn(levant, '1957-01-01', '1967-06-09'), null);
  const sahara = { c: [-12, 25], s: scaleForWidth(2500) };
  assert.equal(contestedIn(sahara, '1960-01-01', '1975-11-14'), 'Western Sahara');
  assert.equal(contestedIn(sahara, '1960-01-01', '1975-11-13'), null);
});

test('missing land is rejected only where it would be visible', () => {
  assert.equal(contestedIn({ c: [-60, -50], s: scaleForWidth(3000) }, '1950-01-01', '1960-01-01'), 'Falklands (missing land)');
  // Gibraltar is under a speck even on a tight crop; Macau shows on one.
  assert.equal(contestedIn({ c: [-5, 37], s: scaleForWidth(700) }, '1950-01-01', '1960-01-01'), null);
  assert.equal(contestedIn({ c: [113.5, 22.5], s: scaleForWidth(650) }, '1950-01-01', '1960-01-01'), 'Macau (missing land)');
  assert.equal(contestedIn({ c: [113.5, 22.5], s: scaleForWidth(3000) }, '1950-01-01', '1960-01-01'), null);
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
    crop.checkFairness = false;
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
  assert.equal(built.d, 'N');
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

test('bank: every tell label is readable and inside the frame', () => {
  for (const p of bank) {
    for (const l of p.labels) {
      const h = boxH(l.s, l.t.length);
      assert.ok(l.x - l.w / 2 >= LABEL_INSET && l.x + l.w / 2 <= 360 - LABEL_INSET && l.y - h / 2 >= LABEL_INSET && l.y + h / 2 <= 400 - LABEL_INSET,
        p.id + ' ' + l.t.join(' ') + ' touches the frame');
    }
    for (const side of ['start', 'end']) {
      const t = p.tells[side];
      if (!t) continue;
      assert.ok(Array.isArray(t.needs), p.id + ' ' + side + ' tell has no needs');
      for (const need of t.needs) {
        const l = p.labels.find((x) => x.t.join(' ') === need);
        assert.ok(l, p.id + ' ' + side + ' tell needs ' + need + ', which has no label');
        assert.ok(l.s >= LABEL_READABLE, p.id + ' ' + need + ' is only ' + l.s);
      }
    }
  }
});

test('bank: no map shows a rejected contested or missing area, and curated maps are Normal only', () => {
  for (const p of bank) {
    if (p.src === 'hb') { assert.equal(p.d, 'N', p.id); continue; }
    assert.equal(contestedIn(p.p, p.win.start, p.win.end), null, p.id);
  }
});

test('bank: every puzzle has its map file, holding every record it draws', () => {
  const files = new Map();
  for (const p of bank) {
    assert.match(p.geo, /^geo\/g-[\w-]+\.json$/, p.id);
    if (!files.has(p.geo)) files.set(p.geo, new Set(read(path.join(site, 'borderline/data', p.geo)).objects.r.geometries.map((g) => g.properties.rid)));
    for (const [rid] of p.draw) assert.ok(files.get(p.geo).has(rid), p.id + ' ' + rid);
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
