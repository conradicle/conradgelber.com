// 12axes: the imported bank, scoring and normalization, per-mode picking and
// ordering, matching, the share-link codec, and checks over the hand-written
// reference data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AXES, AXIS, DISPLAY_ORDER } from '../src/12axes/axes.js';
import { scoreAxes, impact, axisCounts, WEIGHTS, NEUTRAL } from '../src/12axes/score.js';
import { pickQuestions, orderQuestions, rng, MODES, MODE_KEYS } from '../src/12axes/select.js';
import { refPoint, rank, similarity, distance, DIMS } from '../src/12axes/match.js';
import { encodeResult, decodeResult, parseHash, extractCode } from '../src/12axes/share.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = (f) => JSON.parse(readFileSync(path.join(here, '../data/12axes', f), 'utf8'));
const bank = data('questions.json').questions;
const ideologies = data('ideologies.json').ideologies;
const SA = 0;
const SD = 4;

// ---------- the bank

test('bank: 288 statements, 24 per axis, 12 leaning each way, ids stable', () => {
  assert.equal(bank.length, 288);
  bank.forEach((q, i) => assert.equal(q.id, i));
  for (let ax = 0; ax < 12; ax++) {
    const on = bank.filter((q) => q.axis === ax);
    assert.equal(on.length, 24);
    assert.equal(on.filter((q) => q.dir === 1).length, 12);
    assert.equal(on.filter((q) => q.dir === -1).length, 12);
  }
  assert.deepEqual([...DISPLAY_ORDER].sort((a, b) => a - b), AXES.map((_, i) => i));
});

// ---------- scoring

for (const mode of MODE_KEYS) {
  test(`${mode}: agreeing with every left-pole statement and disagreeing with every right-pole one gives 100, and the mirror gives 0`, () => {
    for (let seed = 1; seed <= 20; seed++) {
      const served = pickQuestions(bank, mode, rng(seed));
      const toLeft = served.map((q) => (q.dir === 1 ? SA : SD));
      const toRight = served.map((q) => (q.dir === 1 ? SD : SA));
      assert.deepEqual(scoreAxes(served, toLeft), new Array(12).fill(100));
      assert.deepEqual(scoreAxes(served, toRight), new Array(12).fill(0));
    }
  });

  test(`${mode}: all Strongly agree and all Strongly disagree land where the left/right mix says, mirrored`, () => {
    for (let seed = 1; seed <= 20; seed++) {
      const served = pickQuestions(bank, mode, rng(seed));
      const agree = scoreAxes(served, served.map(() => SA));
      const disagree = scoreAxes(served, served.map(() => SD));
      for (let ax = 0; ax < 12; ax++) {
        const on = served.filter((q) => q.axis === ax);
        const net = on.reduce((s, q) => s + q.dir, 0);
        assert.equal(agree[ax], 50 + (50 * net) / on.length);
        assert.equal(agree[ax] + disagree[ax], 100);
      }
    }
  });

  test(`${mode}: all Neutral gives 50 on every axis`, () => {
    const served = pickQuestions(bank, mode, rng(7));
    assert.deepEqual(scoreAxes(served, served.map(() => NEUTRAL)), new Array(12).fill(50));
  });
}

test('scores stay within 0-100 for random answers in every mode', () => {
  for (const mode of MODE_KEYS) {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 31 + 7);
      const served = pickQuestions(bank, mode, r);
      for (const s of scoreAxes(served, served.map(() => Math.floor(r() * 5)))) {
        assert.ok(s >= 0 && s <= 100, `${mode} seed ${seed}: ${s}`);
      }
    }
  }
});

test('a 36-question run and a 240-question run reach the same scale', () => {
  for (const mode of ['short', 'extreme']) {
    const served = pickQuestions(bank, mode, rng(3));
    const scores = scoreAxes(served, served.map((q) => (q.dir === 1 ? 1 : 3))); // Agree / Disagree
    assert.deepEqual(scores, new Array(12).fill(75));
  }
});

test('impacts add up to the score', () => {
  const served = pickQuestions(bank, 'full', rng(11));
  const r = rng(5);
  const answers = served.map(() => Math.floor(r() * 5));
  const counts = axisCounts(served);
  const scores = scoreAxes(served, answers);
  for (let ax = 0; ax < 12; ax++) {
    const sum = served.reduce((s, q, i) => s + (q.axis === ax ? impact(q, answers[i], counts[ax]) : 0), 0);
    assert.ok(Math.abs(50 + sum - scores[ax]) < 1e-9);
  }
  assert.deepEqual(WEIGHTS, [2, 1, 0, -1, -2]);
});

// ---------- picking and order

test('each mode serves the right number per axis, from both sides, no repeats', () => {
  for (const mode of MODE_KEYS) {
    const per = MODES[mode].perAxis;
    for (let seed = 1; seed <= 100; seed++) {
      const served = pickQuestions(bank, mode, rng(seed));
      assert.equal(served.length, per * 12);
      assert.equal(new Set(served.map((q) => q.id)).size, served.length);
      assert.equal(new Set(served.map((q) => q.text)).size, served.length, 'same text served twice');
      for (let ax = 0; ax < 12; ax++) {
        const on = served.filter((q) => q.axis === ax);
        assert.equal(on.length, per);
        const left = on.filter((q) => q.dir === 1).length;
        assert.ok(left === Math.ceil(per / 2) || left === Math.floor(per / 2), `${mode} axis ${ax}: ${left} left of ${per}`);
      }
    }
  }
});

test('short and full spread picks over intensity buckets', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const served = pickQuestions(bank, 'full', rng(seed));
    for (let ax = 0; ax < 12; ax++) {
      const buckets = served.filter((q) => q.axis === ax).map((q) => q.bucket);
      assert.equal(new Set(buckets).size, buckets.length);
    }
  }
});

test('never two statements in a row on the same axis', () => {
  for (const mode of MODE_KEYS) {
    for (let seed = 1; seed <= 100; seed++) {
      const served = pickQuestions(bank, mode, rng(seed));
      for (let i = 1; i < served.length; i++) assert.notEqual(served[i].axis, served[i - 1].axis, `${mode} seed ${seed} at ${i}`);
    }
  }
});

test('ordering handles a lopsided set when it is feasible', () => {
  const list = [0, 0, 0, 1, 1, 2].map((axis, id) => ({ id, axis }));
  for (let seed = 1; seed <= 50; seed++) {
    const out = orderQuestions(list, rng(seed));
    assert.equal(out.length, 6);
    for (let i = 1; i < out.length; i++) assert.notEqual(out[i].axis, out[i - 1].axis);
  }
});

test('different sessions get different questions', () => {
  const a = pickQuestions(bank, 'short', rng(1)).map((q) => q.id).sort().join();
  const b = pickQuestions(bank, 'short', rng(2)).map((q) => q.id).sort().join();
  assert.notEqual(a, b);
});

// ---------- matching

test('matching compares the trade dimension to the Globalist %, not the Protectionist %', () => {
  const scores = new Array(12).fill(50);
  scores[AXIS.trade] = 0; // fully Globalist
  assert.equal(refPoint(scores).dipl, 100);
  scores[AXIS.economy] = 100;
  scores[AXIS.power] = 40;
  scores[AXIS.culture] = 50;
  assert.equal(rank(ideologies, refPoint(scores), 1)[0].item.name, 'Trotskyism');
});

test('matching: exact coordinates match at 100%, ranking is by distance', () => {
  const fascism = ideologies.find((x) => x.name === 'Fascism');
  const top = rank(ideologies, { ...fascism.stats }, 10);
  assert.equal(top[0].item.name, 'Fascism');
  assert.equal(top[0].similarity, 100);
  for (let i = 1; i < top.length; i++) assert.ok(top[i].distance >= top[i - 1].distance);
  assert.equal(similarity({ econ: 0, govt: 0, dipl: 0, scty: 0 }, { econ: 100, govt: 100, dipl: 100, scty: 100 }), 0);
  assert.equal(distance({ econ: 0, govt: 0, dipl: 0, scty: 0 }, { econ: 30, govt: 40, dipl: 0, scty: 0 }), 50);
});

// ---------- share links

test('share links round-trip in every mode and stay short', () => {
  const longest = {};
  for (const mode of MODE_KEYS) {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed + 1000);
      const served = pickQuestions(bank, mode, r);
      const answers = served.map(() => Math.floor(r() * 5));
      const scores = scoreAxes(served, answers);
      const code = encodeResult({ mode, scores, ids: served.map((q) => q.id), answers });
      const back = decodeResult(code);
      assert.equal(back.mode, mode);
      back.scores.forEach((s, i) => assert.ok(Math.abs(s - scores[i]) <= 0.25));
      const want = served.map((q, i) => [q.id, answers[i]]).sort((x, y) => x[0] - y[0]);
      assert.deepEqual(back.ids, want.map((p) => p[0]));
      assert.deepEqual(back.answers, want.map((p) => p[1]));
      longest[mode] = Math.max(longest[mode] || 0, code.length);
    }
  }
  assert.ok(longest.short <= 90, 'short ' + longest.short);
  assert.ok(longest.extreme <= 170, 'extreme ' + longest.extreme);
});

test('share links reject damaged codes and parse fragments', () => {
  assert.throws(() => decodeResult('AAAA'));
  assert.throws(() => decodeResult('not valid!'));
  const served = pickQuestions(bank, 'short', rng(9));
  const code = encodeResult({ mode: 'short', scores: scoreAxes(served, served.map(() => 2)), ids: served.map((q) => q.id), answers: served.map(() => 2) });
  assert.throws(() => decodeResult(code.slice(0, -4)));
  assert.deepEqual(parseHash('#r=' + code), { kind: 'result', a: code });
  assert.deepEqual(parseHash('#c=' + code + '.' + code), { kind: 'compare', a: code, b: code });
  assert.equal(parseHash('#about'), null);
  assert.equal(extractCode('https://conradgelber.com/12axes/#r=' + code), code);
  assert.equal(extractCode('  ' + code + ' '), code);
  assert.equal(extractCode('hello'), null);
});

// ---------- hand-written data

const PLAIN = /[—–‘’“”]/; // no em/en dashes or curly quotes in UI copy

test('every ideology from the source has a description, and the text is plain', () => {
  const text = data('ideology-text.json');
  for (const x of ideologies) {
    assert.ok(text[x.name], 'missing description: ' + x.name);
    assert.ok(!PLAIN.test(text[x.name]), x.name);
  }
  assert.equal(Object.keys(text).length, ideologies.length);
});

test('axis text covers all twelve axes', () => {
  const axes = data('axes.json');
  assert.equal(axes.length, 12);
  axes.forEach((a, i) => {
    assert.equal(a.key, AXES[i].key);
    for (const f of ['about', 'leftReading', 'rightReading']) {
      assert.ok(a[f] && !PLAIN.test(a[f]), `${a.key}.${f}`);
    }
  });
});

test('reference library: at most 17 thinkers and 12 countries, each with a summary, a source and estimated coordinates', () => {
  const ref = data('reference.json');
  const thinkers = ref.items.filter((x) => x.kind === 'thinker');
  const countries = ref.items.filter((x) => x.kind === 'country');
  assert.ok(thinkers.length >= 14 && thinkers.length <= 17, 'thinkers: ' + thinkers.length);
  assert.ok(!thinkers.some((x) => x.name.startsWith('Kautilya')));
  for (const n of ['John Rawls', 'Robert Nozick']) assert.ok(thinkers.some((x) => x.name === n), n);
  assert.ok(countries.find((x) => x.name === 'Athens').stats.scty < countries.find((x) => x.name === 'Victorian Britain').stats.scty, 'present-day scale: Athens below Victorian Britain');
  assert.equal(countries.length, 12);
  assert.match(ref.note, /illustrative editorial estimate/);
  for (const x of ref.items) {
    assert.ok(x.name && x.when && x.summary && !PLAIN.test(x.summary), x.name);
    assert.match(x.source, /^https:\/\/(plato\.stanford\.edu|www\.britannica\.com)\//, x.name);
    for (const d of DIMS) assert.ok(x.stats[d] >= 0 && x.stats[d] <= 100, `${x.name} ${d}`);
  }
  // Spread: both ends of each dimension are represented.
  for (const d of DIMS) {
    const v = ref.items.map((x) => x.stats[d]);
    assert.ok(Math.min(...v) <= 20 && Math.max(...v) >= 80, d);
  }
});

// ---------- storage

test('storage: every read and write survives blocked storage', async () => {
  const store = await import('../src/12axes/store.js');
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(store.load(), {});
    assert.equal(store.save({ a: 1 }), false);
    assert.equal(store.update((d) => { d.x = 1; }), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
  }
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) } });
  try {
    assert.equal(store.update((d) => { d.progress = { at: 3 }; }), true);
    assert.deepEqual(store.load(), { progress: { at: 3 } });
    mem.set('12axes:v1', '{not json');
    assert.deepEqual(store.load(), {});
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
  }
});
