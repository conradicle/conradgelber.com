// Flight Path game rules: guesses, aliases, disputed places, route choice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseData, bandOf, buildLookup, judge, createRound, isComplete, suggest, suggestionIndex, pickRoute,
} from '../src/flight-path/logic.js';
import { normalize } from '../lib/countries.mjs';

const data = parseData(JSON.parse(readFileSync(new URL('../../flight-path/routes.json', import.meta.url), 'utf8')));
const lookup = buildLookup(data.countries);
const find = (a, b) => data.routes.find((r) =>
  (r.from.name === a && r.to.name === b) || (r.from.name === b && r.to.name === a));

// A made-up route for rules that need a particular set of countries.
const fake = (countries, extra = {}) => ({
  id: -1, from: { name: 'A', country: 'France' }, to: { name: 'B', country: 'Japan' },
  km: 1000, band: 'short', countries, crimea: false, ...extra,
});

test('difficulty bands', () => {
  assert.equal(bandOf(2999), 'short');
  assert.equal(bandOf(3000), 'medium');
  assert.equal(bandOf(8000), 'medium');
  assert.equal(bandOf(8001), 'long');
  for (const b of ['short', 'medium', 'long']) assert.ok(data.routes.some((r) => r.band === b));
});

test('every route crosses at least two countries besides its endpoints', () => {
  for (const r of data.routes) {
    assert.ok(r.countries.length >= 2);
    assert.ok(!r.countries.includes(r.from.country) && !r.countries.includes(r.to.country));
  }
});

test('normalize folds case, accents, punctuation and "the"', () => {
  assert.equal(normalize("Côte d'Ivoire"), normalize('cote divoire'));
  assert.equal(normalize('The Gambia'), 'gambia');
  assert.equal(normalize('St. Kitts & Nevis'), 'saint kitts and nevis');
  assert.equal(normalize('  U.S.A. '), 'usa');
});

test('common aliases are accepted', () => {
  const cases = {
    USA: 'United States', 'United States': 'United States', US: 'United States', America: 'United States',
    UK: 'United Kingdom', Britain: 'United Kingdom', 'Great Britain': 'United Kingdom', England: 'United Kingdom',
    'Ivory Coast': "Côte d'Ivoire", "Cote d'Ivoire": "Côte d'Ivoire",
    'Czech Republic': 'Czechia', Czechia: 'Czechia', Burma: 'Myanmar', Myanmar: 'Myanmar',
    DRC: 'Democratic Republic of the Congo', 'DR Congo': 'Democratic Republic of the Congo',
    Holland: 'Netherlands', Swaziland: 'Eswatini', 'East Timor': 'Timor-Leste', 'Cape Verde': 'Cabo Verde',
    Macedonia: 'North Macedonia', Turkiye: 'Turkey', UAE: 'United Arab Emirates', Persia: 'Iran',
    'Vatican City': 'Vatican', 'Bosnia': 'Bosnia and Herzegovina', Macau: 'Macao',
  };
  for (const [typed, name] of Object.entries(cases)) {
    assert.ok((lookup.get(normalize(typed)) || []).includes(name), `${typed} -> ${name}`);
  }
  // Ambiguous names can mean either country.
  assert.deepEqual([...lookup.get('korea')].sort(), ['North Korea', 'South Korea']);
  assert.deepEqual([...lookup.get('congo')].sort(), ['Democratic Republic of the Congo', 'Republic of the Congo']);
});

test('every alias points at a country the game knows', () => {
  for (const list of lookup.values()) for (const n of list) assert.ok(data.countries.includes(n), n);
});

test('found, already, wrong, repeat and unknown guesses', () => {
  const round = createRound(fake(['Germany', 'Poland']));
  assert.equal(judge(round, lookup, 'germany').kind, 'found');
  assert.equal(judge(round, lookup, 'Germany').kind, 'already');
  assert.equal(judge(round, lookup, 'Spain').kind, 'wrong');
  assert.equal(judge(round, lookup, 'spain').kind, 'repeat');
  assert.equal(judge(round, lookup, 'Atlantis').kind, 'unknown');
  assert.equal(judge(round, lookup, 'France').kind, 'endpoint');
  assert.deepEqual(round.wrong, ['Spain']);
  assert.equal(isComplete(round), false);
  assert.equal(judge(round, lookup, 'POLAND').kind, 'found');
  assert.equal(isComplete(round), true);
});

test('an ambiguous alias counts for whichever country is on the route', () => {
  const round = createRound(fake(['North Korea', 'China']));
  assert.deepEqual(judge(round, lookup, 'Korea'), { kind: 'found', name: 'North Korea' });
  const both = createRound(fake(['South Korea', 'North Korea']));
  assert.equal(judge(both, lookup, 'Korea').name, 'South Korea');
  assert.equal(judge(both, lookup, 'Korea').name, 'North Korea');
});

test('naming the sovereign counts for a territory on the route', () => {
  const round = createRound(fake(['Greenland', 'Iceland']));
  assert.deepEqual(judge(round, lookup, 'Denmark'), { kind: 'found', name: 'Greenland', via: 'Denmark' });
  assert.equal(judge(round, lookup, 'Denmark').kind, 'already');
  // The sovereign itself on the route takes priority.
  const both = createRound(fake(['Denmark', 'Greenland']));
  assert.equal(judge(both, lookup, 'Denmark').name, 'Denmark');
});

test('a claimant is neutral on a route over the disputed place', () => {
  for (const [place, claimant] of [['Taiwan', 'China'], ['Kosovo', 'Serbia'], ['Palestine', 'Israel'], ['Western Sahara', 'Morocco']]) {
    const round = createRound(fake([place, 'Philippines']));
    const r = judge(round, lookup, claimant);
    assert.equal(r.kind, 'neutral', `${claimant} on a route over ${place}`);
    assert.equal(r.note, `${place} is listed separately in this game.`);
    assert.deepEqual(round.wrong, []);
    assert.deepEqual(round.notes, [r.note]);
    // Guessing it twice adds the note once.
    judge(round, lookup, claimant);
    assert.equal(round.notes.length, 1);
  }
});

test('a claimant that is itself on the route is simply found', () => {
  const round = createRound(fake(['Taiwan', 'China']));
  assert.equal(judge(round, lookup, 'China').kind, 'found');
});

test('the claimant is wrong when the route misses the disputed place', () => {
  const round = createRound(fake(['Japan', 'Philippines']));
  assert.equal(judge(round, lookup, 'Serbia').kind, 'wrong');
});

test('Ukraine is neutral on a route over Crimea without Ukraine', () => {
  const round = createRound(fake(['Russia', 'Georgia'], { crimea: true }));
  const r = judge(round, lookup, 'Ukraine');
  assert.equal(r.kind, 'neutral');
  assert.match(r.note, /Crimea/);
  const plain = createRound(fake(['Russia', 'Georgia']));
  assert.equal(judge(plain, lookup, 'Ukraine').kind, 'wrong');
});

test('type-ahead suggestions', () => {
  const index = suggestionIndex(data.countries);
  assert.equal(suggest(index, 'ger')[0].name, 'Germany');
  assert.ok(suggest(index, 'ivory').some((s) => s.name === "Côte d'Ivoire"));
  assert.ok(suggest(index, 'burma').some((s) => s.label === 'Myanmar (Burma)'));
  assert.ok(suggest(index, 'guinea').length > 3);
  assert.equal(suggest(index, '').length, 0);
  assert.ok(suggest(index, 'a').length <= 8);
  // One row per country.
  const names = suggest(index, 'congo').map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  // Skipped countries (already found) are left out.
  assert.ok(!suggest(index, 'ger', 8, new Set(['Germany'])).some((s) => s.name === 'Germany'));
});

test('recent routes are skipped while others remain', () => {
  const short = data.routes.filter((r) => r.band === 'short');
  const recent = short.slice(1).map((r) => r.id);
  assert.equal(pickRoute(data.routes, 'short', { recent }).id, short[0].id);
});

test('the named sample routes exist in the data', () => {
  assert.ok(find('New York', 'Hong Kong').countries.includes('Canada'));
  assert.ok(find('London', 'Tokyo').countries.includes('Russia'));
});
