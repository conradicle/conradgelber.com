// Great-circle math and route crossings for /flight-path/, checked against
// Natural Earth 1:10m. Run with: npm --prefix play-src test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toVec, angle, distanceKm, greatCirclePoints, makeArc, prepare, contains,
  intervals, union, subtract, lengthKm,
} from '../lib/sphere.mjs';
import { loadWorld, routeCountries, crossedBy, MIN_KM } from '../scripts/build-routes.mjs';
import { loadFeatures } from '../scripts/world.mjs';

const cities = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'));
const city = (name) => {
  const c = cities.find((x) => x.name === name);
  if (!c) throw new Error('no city ' + name);
  return c;
};
const world = loadWorld();
const route = (a, b) => routeCountries(world, city(a), city(b));
const names = (r) => r.counted.map((c) => c.name);

// ---------- pure math ----------

test('distances match known great-circle lengths', () => {
  // New York to London is about 5,570 km; London to Tokyo about 9,560 km.
  assert.ok(Math.abs(distanceKm([-74.006, 40.713], [-0.128, 51.507]) - 5570) < 15);
  assert.ok(Math.abs(distanceKm([-0.128, 51.507], [139.69, 35.69]) - 9560) < 15);
  // A quarter of the way round the world along the equator.
  assert.ok(Math.abs(distanceKm([0, 0], [90, 0]) - Math.PI / 2 * 6371) < 1e-6);
});

test('angle is accurate for tiny and near-antipodal separations', () => {
  const a = toVec([10, 10]);
  assert.ok(Math.abs(angle(a, toVec([10, 10.000001])) - 1e-6 * Math.PI / 180) < 1e-12);
  assert.ok(Math.abs(angle(toVec([0, 0]), toVec([179.9999, 0])) - (Math.PI - 1e-4 * Math.PI / 180)) < 1e-9);
});

test('great-circle points cross the antimeridian on the Pacific side', () => {
  // Tokyo to Los Angeles: the shortest route goes east over the Pacific,
  // so longitude jumps from +180 to -180 exactly once and never passes
  // through 0 (which would mean going the long way round over Asia).
  const pts = greatCirclePoints([139.69, 35.69], [-118.24, 34.05], 200);
  let jumps = 0;
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) > 180) jumps++;
    assert.ok(Math.abs(pts[i][0]) > 90, `point ${i} at ${pts[i][0]} is not over the Pacific`);
  }
  assert.equal(jumps, 1);
  // The route bows north, to about 48 degrees.
  const top = Math.max(...pts.map((p) => p[1]));
  assert.ok(top > 46 && top < 50, `highest latitude ${top}`);
});

test('great-circle points go over the pole when the route does', () => {
  const pts = greatCirclePoints([0, 60], [180, 60], 100);
  assert.ok(Math.max(...pts.map((p) => p[1])) > 89.99);
});

test('interval helpers', () => {
  assert.deepEqual(union([[0, 0.2], [0.5, 0.6]], [[0.1, 0.3]]), [[0, 0.3], [0.5, 0.6]]);
  assert.deepEqual(subtract([[0, 1]], [[0.2, 0.3], [0.9, 1.2]]), [[0, 0.2], [0.3, 0.9]]);
});

test('a square crossed straight through gives one stretch of the right length', () => {
  const square = prepare({ type: 'Polygon', coordinates: [[[10, -1], [12, -1], [12, 1], [10, 1], [10, -1]]] });
  const arc = makeArc([0, 0], [20, 0]);
  const iv = intervals(arc, square, false);
  assert.equal(iv.length, 1);
  assert.ok(Math.abs(lengthKm(arc, iv) - distanceKm([10, 0], [12, 0])) < 0.01);
});

test('winding order does not matter', () => {
  const ring = [[10, -1], [12, -1], [12, 1], [10, 1], [10, -1]];
  const cw = prepare({ type: 'Polygon', coordinates: [ring] });
  const ccw = prepare({ type: 'Polygon', coordinates: [ring.slice().reverse()] });
  for (const rings of [cw, ccw]) {
    assert.equal(contains(rings, [11, 0]), true);
    assert.equal(contains(rings, [0, 0]), false);
  }
  // Natural Earth's 1:10m Maldives has a ring wound the other way, which
  // makes d3-geo's point test say it covers the whole world.
  const maldives = loadFeatures('10m').find((f) => f.ne === 'Maldives');
  assert.equal(contains(maldives.rings, [-74, 40.7]), false);
  assert.equal(contains(maldives.rings, [73.509, 4.175]), true); // Malé
});

// ---------- the required routes ----------

test('New York to Hong Kong crosses Canada and Russia', () => {
  const r = route('New York', 'Hong Kong');
  const list = names(r);
  assert.ok(list.includes('Canada'), list.join(', '));
  assert.ok(list.includes('Russia'), list.join(', '));
  // In the order the plane reaches them.
  assert.ok(list.indexOf('Canada') < list.indexOf('Russia'));
});

test('London to Tokyo crosses Russia', () => {
  assert.ok(names(route('London', 'Tokyo')).includes('Russia'));
});

test('Tokyo to Los Angeles crosses the antimeridian over open water', () => {
  const r = route('Tokyo', 'Los Angeles');
  assert.deepEqual(names(r), []);
  // Only the endpoints' own countries are under the route.
  assert.deepEqual(r.all.map((c) => c.name).sort(), ['Japan', 'United States']);
});

test('a route over Chukotka stays over Russia across the antimeridian', () => {
  // Russia is cut into two polygons at 180 degrees. The route has to stay
  // "inside" when it passes from one to the other, in both directions.
  for (const [a, b] of [[[175, 67], [-178, 67]], [[-178, 67], [175, 67]]]) {
    const r = crossedBy(world, a, b);
    assert.deepEqual(r.list.map((c) => c.name), ['Russia']);
    assert.ok(Math.abs(r.list[0].km - r.km) < 0.5, `${r.list[0].km} of ${r.km} km`);
  }
});

test('Fiji is found on both sides of the antimeridian', () => {
  const r = crossedBy(world, [178.0, -16.3], [-179.7, -16.8]);
  assert.deepEqual(r.list.map((c) => c.name), ['Fiji']);
});

test('routes near the North Pole', () => {
  // Vancouver to Stockholm passes over Greenland at about 72 degrees north.
  assert.deepEqual(names(route('Vancouver', 'Stockholm')), ['Greenland', 'Norway']);
  // A route straight over the pole from Alaska to Norway's Svalbard side
  // crosses no land between the endpoints' countries except Greenland's
  // northern tip, which it misses; the pole itself is open sea.
  const r = crossedBy(world, [-150, 75], [30, 75]);
  assert.deepEqual(r.list.map((c) => c.name), []);
});

test('small countries are not missed', () => {
  assert.ok(names(route('Brussels', 'Zürich')).includes('Luxembourg'));
  assert.ok(names(route('Paris', 'Frankfurt')).includes('Luxembourg'));
  assert.ok(names(route('Riyadh', 'Dubai')).includes('Qatar'));
});

test('crossings are the same in both directions', () => {
  const pairs = [
    ['New York', 'Hong Kong'], ['Anchorage', 'Beijing'], ['Sydney', 'Honolulu'],
    ['Seattle', 'Moscow'], ['Santiago', 'Auckland'], ['Cape Town', 'Perth'],
    ['Reykjavík', 'Tokyo'], ['Buenos Aires', 'Beijing'], ['Suva', 'Los Angeles'],
  ];
  for (const [a, b] of pairs) {
    assert.deepEqual(names(route(b, a)).sort(), names(route(a, b)).sort(), `${a} - ${b}`);
  }
});

test('no country is counted for more land than the route has', () => {
  for (const [a, b] of [['Dakar', 'Madrid'], ['Casablanca', 'Lagos'], ['New York', 'Hong Kong']]) {
    const r = route(a, b);
    const total = r.counted.reduce((s, c) => s + c.km, 0);
    assert.ok(total <= r.km, `${a} - ${b}: ${total} of ${r.km}`);
  }
});

test('Western Sahara and Morocco are counted separately', () => {
  const r = route('Dakar', 'Madrid');
  assert.deepEqual(names(r), ['Mauritania', 'Western Sahara', 'Morocco']);
});

test('routes over Crimea are flagged', () => {
  assert.equal(route('Moscow', 'Ankara').crimea, true);
  assert.equal(route('Minsk', 'Istanbul').crimea, false);
});

test('a route over Crimea only requires neither Russia nor Ukraine', () => {
  // No two cities in the pool cross Crimea without crossing mainland Russia
  // or Ukraine too, so this route runs the length of the peninsula, from the
  // Black Sea west of Yevpatoria to the Kerch peninsula.
  const r = crossedBy(world, [32.6, 45.3], [36.2, 45.2]);
  assert.ok(r.crimeaKm > 200, `${r.crimeaKm} km over Crimea`);
  const list = r.list.map((c) => c.name);
  assert.ok(!list.includes('Russia'), list.join(', '));
  assert.ok(!list.includes('Ukraine'), list.join(', '));
});

test('Crimea plus mainland Russia still requires Russia', () => {
  // Anchorage to Ankara crosses Siberia and European Russia, then Crimea.
  const r = route('Anchorage', 'Ankara');
  assert.equal(r.crimea, true);
  const russia = r.counted.find((c) => c.name === 'Russia');
  assert.ok(russia && russia.km > 1000, russia && `${russia.km} km`);
});

test('the Crimea stretch never counts toward Russia', () => {
  // New York to Dubai passes over Crimea and mainland Ukraine but no other
  // Russian land.
  const r = route('New York', 'Dubai');
  assert.equal(r.crimea, true);
  assert.ok(names(r).includes('Ukraine'));
  assert.ok(!names(r).includes('Russia'));
  assert.ok(!r.all.some((c) => c.name === 'Russia'));
});

test('grazes under the minimum are not counted', () => {
  // San Jose to Saint Petersburg clips the Bahamas for under 100 m.
  const r = route('San José', 'Saint Petersburg');
  assert.ok(!names(r).includes('Bahamas'));
  const graze = r.grazes.find((c) => c.name === 'Bahamas');
  assert.ok(graze && graze.km < MIN_KM);
});

// ---------- the shipped file ----------

test('routes.json agrees with a fresh computation', () => {
  const data = JSON.parse(readFileSync(new URL('../../flight-path/routes.json', import.meta.url), 'utf8'));
  assert.equal(data.cities.length, cities.length);
  // Spot-check every 97th route rather than all 11,000.
  for (let k = 0; k < data.routes.length; k += 97) {
    const [i, j, list] = data.routes[k];
    const fresh = routeCountries(world, cities[i], cities[j]);
    assert.deepEqual(list.map((c) => data.countries[c]), names(fresh), `${cities[i].name} - ${cities[j].name}`);
    assert.ok(list.length >= 2);
  }
});
