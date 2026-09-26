// Flight Path weak-spot memory: storage handling and weighting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseData, createRound, pickRoute } from '../src/flight-path/logic.js';
import { loadStats, saveStats, recordRound, routeWeight, weakSpots, STORAGE_KEY } from '../src/flight-path/weak-spots.js';

const data = parseData(JSON.parse(readFileSync(new URL('../../flight-path/routes.json', import.meta.url), 'utf8')));
const fake = (countries) => ({
  id: -1, from: { name: 'A', country: 'France' }, to: { name: 'B', country: 'Japan' },
  km: 1000, band: 'short', countries, crimea: false,
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('stats survive empty, blocked and corrupt storage', () => {
  assert.deepEqual(loadStats(memoryStorage()), {});
  assert.deepEqual(loadStats(null), {});
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
  assert.deepEqual(loadStats(blocked), {});
  assert.equal(saveStats(blocked, { Chad: { miss: 1, streak: 0 } }), false);
  const corrupt = memoryStorage();
  corrupt.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadStats(corrupt), {});
  corrupt.setItem(STORAGE_KEY, '{"Chad":{"miss":"x"},"Mali":{"miss":2,"streak":0}}');
  assert.deepEqual(loadStats(corrupt), { Mali: { miss: 2, streak: 0 } });
});

test('stats round-trip and clear', () => {
  const s = memoryStorage();
  saveStats(s, { Chad: { miss: 1, streak: 0 } });
  assert.deepEqual(loadStats(s), { Chad: { miss: 1, streak: 0 } });
  saveStats(s, {});
  assert.equal(s.getItem(STORAGE_KEY), null);
});

test('misses add weight and three correct in a row drop it', () => {
  const route = fake(['Chad', 'Niger']);
  let stats = {};
  const play = (found) => { const r = createRound(route); r.found = found; stats = recordRound(stats, r); };
  play(['Niger']);
  assert.deepEqual(stats, { Chad: { miss: 1, streak: 0 } });
  assert.deepEqual(weakSpots(stats), ['Chad']);
  assert.equal(routeWeight(route, stats), 3);
  play(['Niger']);
  assert.equal(stats.Chad.miss, 2);
  play(['Chad', 'Niger']);
  play(['Chad', 'Niger']);
  assert.equal(stats.Chad.streak, 2);
  assert.equal(routeWeight(route, stats), 5);
  play(['Chad', 'Niger']);
  assert.equal(stats.Chad, undefined);
  assert.equal(routeWeight(route, stats), 1);
  // A miss in the middle resets the streak.
  play(['Niger']);
  play(['Chad', 'Niger']);
  play(['Niger']);
  play(['Chad', 'Niger']);
  play(['Chad', 'Niger']);
  assert.deepEqual(stats.Chad, { miss: 2, streak: 2 });
});

test('weighted selection favours routes over weak spots', () => {
  const routes = data.routes.filter((r) => r.band === 'medium');
  const target = 'Chad';
  const share = (stats) => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    let hits = 0;
    for (let i = 0; i < 3000; i++) if (pickRoute(routes, 'medium', { weight: (r) => routeWeight(r, stats), rand }).countries.includes(target)) hits++;
    return hits / 3000;
  };
  const base = share({});
  const weighted = share({ [target]: { miss: 3, streak: 0 } });
  assert.ok(weighted > base * 2, `${base} -> ${weighted}`);
});

