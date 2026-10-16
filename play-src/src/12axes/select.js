// Which statements a session gets, and in what order.
import { AXES } from './axes.js';

export const MODES = {
  short: { label: 'Short', perAxis: 3, minutes: 5 },
  full: { label: 'Full', perAxis: 5, minutes: 9 },
  extreme: { label: 'Extreme', perAxis: 20, minutes: 30 },
};
export const MODE_KEYS = ['short', 'full', 'extreme'];

// mulberry32: small seeded generator, so tests can replay a session.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// n statements from one side of one axis, spread over its intensity buckets
// (one from each bucket in a random order, then round again), skipping any
// text already served this session.
function pickSide(pool, n, used, rand) {
  const buckets = new Map();
  for (const q of shuffle(pool.slice(), rand)) {
    if (!buckets.has(q.bucket)) buckets.set(q.bucket, []);
    buckets.get(q.bucket).push(q);
  }
  const order = shuffle([...buckets.keys()], rand);
  const out = [];
  while (out.length < n) {
    let took = false;
    for (const b of order) {
      if (out.length >= n) break;
      const list = buckets.get(b);
      while (list.length && used.has(list[0].text)) list.shift();
      const q = list.shift();
      if (q) { out.push(q); used.add(q.text); took = true; }
    }
    if (!took) throw new Error('not enough statements on one side of axis ' + pool[0].axis);
  }
  return out;
}

// Per axis, the larger half comes from a randomly chosen side and the rest
// from the other, so every axis has statements leaning both ways.
export function pickQuestions(bank, mode, rand) {
  const per = MODES[mode].perAxis;
  const used = new Set();
  const picked = [];
  for (const ax of shuffle(AXES.map((_, i) => i), rand)) {
    const onAxis = bank.filter((q) => q.axis === ax);
    const major = rand() < 0.5 ? 1 : -1;
    const nMajor = Math.ceil(per / 2);
    picked.push(...pickSide(onAxis.filter((q) => q.dir === major), nMajor, used, rand));
    picked.push(...pickSide(onAxis.filter((q) => q.dir === -major), per - nMajor, used, rand));
  }
  return orderQuestions(picked, rand);
}

// Shuffle so that no two statements in a row share an axis. Each step picks
// a random axis (weighted by how many it has left) other than the last one,
// unless one axis has so many left that it must go now to stay feasible.
export function orderQuestions(list, rand) {
  const byAxis = new Map();
  for (const q of shuffle(list.slice(), rand)) {
    if (!byAxis.has(q.axis)) byAxis.set(q.axis, []);
    byAxis.get(q.axis).push(q);
  }
  const out = [];
  let last = -1;
  let total = list.length;
  while (total) {
    const axes = [...byAxis.keys()].filter((a) => byAxis.get(a).length);
    const forced = axes.find((a) => a !== last && byAxis.get(a).length * 2 > total);
    let ax = forced;
    if (ax == null) {
      const cand = axes.filter((a) => a !== last);
      const pool = cand.length ? cand : axes;
      let r = rand() * pool.reduce((s, a) => s + byAxis.get(a).length, 0);
      ax = pool[pool.length - 1];
      for (const a of pool) {
        r -= byAxis.get(a).length;
        if (r < 0) { ax = a; break; }
      }
    }
    out.push(byAxis.get(ax).pop());
    last = ax;
    total--;
  }
  return out;
}
