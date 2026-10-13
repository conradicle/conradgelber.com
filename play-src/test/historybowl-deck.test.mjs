// History Bowl Study: starter-deck fixes, the bounceback setting and the
// lightning record format.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDeckFixes, applyDeckFixes } from '../src/historybowl/deck.js';
import { KEYS, loadSettings, cleanRecord, exportData, importData, saveCards } from '../src/historybowl/store.js';
import { weakestAreas } from '../src/historybowl/areas.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const deck = JSON.parse(readFileSync(new URL('../../historybowl/data/decks/starter.json', import.meta.url), 'utf8'));

test('the starter deck is well formed', () => {
  assert.equal(deck.cards.length, 66);
  assert.equal(new Set(deck.cards.map((c) => c.id)).size, 66);
  for (const c of deck.cards) {
    assert.ok(c.front.length > 10 && c.back.length > 1, c.id);
    assert.ok(!/[—–]/.test(c.front + c.back), `${c.id} has a dash`);
  }
});

test('deck fixes edit and delete cards, and survive bad storage', () => {
  const s = memoryStorage();
  s.setItem(KEYS.deckFixes, JSON.stringify({ 'starter-01': { back: 'Peace of Westphalia (1648)' }, 'starter-02': { deleted: true }, junk: 5, 'starter-03': { front: '' } }));
  const fixes = loadDeckFixes(s);
  assert.deepEqual(Object.keys(fixes).sort(), ['starter-01', 'starter-02']);
  const cards = applyDeckFixes(deck.cards, fixes);
  assert.equal(cards.length, 65);
  assert.equal(cards[0].back, 'Peace of Westphalia (1648)');
  assert.equal(cards[0].edited, true);
  assert.equal(applyDeckFixes(deck.cards, fixes, { keepDeleted: true }).length, 66);
  assert.deepEqual(loadDeckFixes({ getItem() { throw new Error('blocked'); } }), {});
});

test('deck fixes travel in exports; this device keeps its own', () => {
  const a = memoryStorage();
  a.setItem(KEYS.deckFixes, JSON.stringify({ 'starter-05': { deleted: true }, 'starter-06': { back: 'A' } }));
  const file = JSON.parse(JSON.stringify(exportData(a)));
  const b = memoryStorage();
  b.setItem(KEYS.deckFixes, JSON.stringify({ 'starter-06': { back: 'B' } }));
  saveCards(b, []);
  assert.equal(importData(b, file).ok, true);
  assert.deepEqual(loadDeckFixes(b), { 'starter-05': { deleted: true }, 'starter-06': { back: 'B' } });
});

test('bouncebacks default to in-person rules', () => {
  assert.equal(loadSettings(memoryStorage()).bounceRule, 'in-person');
  const s = memoryStorage();
  s.setItem(KEYS.settings, JSON.stringify({ bounceRule: 'online' }));
  assert.equal(loadSettings(s).bounceRule, 'online');
  s.setItem(KEYS.settings, JSON.stringify({ bounceRule: 'bogus' }));
  assert.equal(loadSettings(s).bounceRule, 'in-person');
});

test('records keep their format; lightning stays out of the weakest areas', () => {
  const base = { id: '1', qid: 'q', ts: 1, ok: false, cat: 'History', sub: 'Ancient History', src: 'qbreader' };
  assert.equal(cleanRecord(base).fmt, 'tossup');
  assert.equal(cleanRecord({ ...base, fmt: 'lightning' }).fmt, 'lightning');
  assert.equal(cleanRecord({ ...base, fmt: 'nonsense' }).fmt, 'tossup');
  const lightning = Array.from({ length: 12 }, (_, i) => cleanRecord({ ...base, id: 'l' + i, fmt: 'lightning' }));
  assert.equal(weakestAreas(lightning).length, 0);
});
