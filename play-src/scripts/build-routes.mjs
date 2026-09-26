// Builds ../flight-path/routes.json: for every pair of cities in
// data/cities.json, the countries the great-circle route between them
// passes over, worked out exactly against Natural Earth's 1:10m admin-0
// boundaries (world-atlas countries-10m.json, which never ships).
//
//   node scripts/build-routes.mjs [--report path]
//
// Output: { countries: [name], points: { country: [lon, lat] },
// cities: [[name, country, lat, lon]], routes: [[from, to, [country...],
// crimea]] }, all by index. points covers countries missing from the
// 1:50m drawing data. Countries are in the order the route reaches them;
// the trailing 1 marks a route over Crimea. The page works out distances
// from the city coordinates.
//
// Crimea is scored for no one. Natural Earth draws it inside Russia, so
// its stretch of a route is taken out of Russia's (and, to be safe,
// Ukraine's) before the 2 km test: a route whose only Russian land is
// Crimea does not require Russia.
//
// A country counts when at least MIN_KM of the route lies over its land.
// Routes are kept when they cross at least two countries other than the
// origin's and the destination's, and never when they cross a feature in
// EXCLUDE_ROUTES. --report writes every crossing shorter than REVIEW_KM, and
// a few other checks, to a text file for review.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeArc, intervals, union, subtract, lengthKm, contains, distanceKm, EARTH_KM } from '../lib/sphere.mjs';
import { gameName, EXCLUDE_ROUTES, CARVE, DISPUTED } from '../lib/countries.mjs';
import { geoCentroid } from 'd3-geo';
import { loadFeatures, crimeaRings } from './world.mjs';

export const MIN_KM = 2;
const CRIMEA_CLAIMANTS = DISPUTED.Crimea;
const REVIEW_KM = 10;
const MIN_COUNTRIES = 2;

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Game countries (plus excluded features and Crimea) as lists of prepared
// rings, one list per Natural Earth feature.
export function loadWorld() {
  const features = loadFeatures('10m');
  const groups = new Map();
  for (const f of features) {
    const key = EXCLUDE_ROUTES.has(f.ne) ? f.ne : gameName(f.ne);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f.rings);
  }
  return { groups, crimea: crimeaRings(features) };
}

// Is the start of the route inside these rings? Only worth the full test
// when the point is inside one of the rings' bounding caps.
function startsInside(arc, rings, from) {
  const a = arc.a;
  if (!rings.some((r) => a[0] * r.c[0] + a[1] * r.c[1] + a[2] * r.c[2] >= r.cosr)) return false;
  return contains(rings, from);
}

// Every country the route from a to b passes over, in the order the route
// reaches them, with the km of land it covers in each. Origin and
// destination countries are included; callers drop them.
export function crossedBy(world, a, b) {
  const arc = makeArc(a, b);
  const over = new Map();
  for (const [name, featureRings] of world.groups) {
    const lists = featureRings.map((rings) => intervals(arc, rings, startsInside(arc, rings, a)));
    const iv = union(...lists);
    if (iv.length) over.set(name, iv);
  }
  for (const [keep, carveFrom] of CARVE) {
    if (over.has(keep) && over.has(carveFrom)) {
      over.set(carveFrom, subtract(over.get(carveFrom), over.get(keep)));
    }
  }
  const crimeaIv = intervals(arc, world.crimea, startsInside(arc, world.crimea, a));
  for (const name of CRIMEA_CLAIMANTS) {
    if (over.has(name)) over.set(name, subtract(over.get(name), crimeaIv));
  }
  const list = [...over]
    .map(([name, iv]) => ({ name, km: lengthKm(arc, iv), at: iv.length ? iv[0][0] : 1, iv }))
    .filter((c) => c.km > 0)
    .sort((x, y) => x.at - y.at);
  return { km: arc.w * EARTH_KM, list, crimeaKm: lengthKm(arc, crimeaIv), arc };
}

// The game's view of one route: countries that count, in route order.
export function routeCountries(world, from, to) {
  const r = crossedBy(world, [from.lon, from.lat], [to.lon, to.lat]);
  const excluded = r.list.some((c) => EXCLUDE_ROUTES.has(c.name) && c.km > 0);
  const counted = r.list.filter((c) =>
    !EXCLUDE_ROUTES.has(c.name) && c.name !== from.country && c.name !== to.country && c.km >= MIN_KM);
  const grazes = r.list.filter((c) =>
    !EXCLUDE_ROUTES.has(c.name) && c.name !== from.country && c.name !== to.country && c.km < MIN_KM);
  return { km: r.km, counted, grazes, excluded, crimea: r.crimeaKm >= MIN_KM, all: r.list };
}

function main() {
  const reportPath = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;
  const cities = JSON.parse(readFileSync(here('../data/cities.json'), 'utf8'));
  const world = loadWorld();
  const names = [...world.groups.keys()].filter((n) => !EXCLUDE_ROUTES.has(n)).sort((x, y) => x.localeCompare(y, 'en'));
  const index = new Map(names.map((n, i) => [n, i]));
  for (const c of cities) if (!index.has(c.country)) throw new Error('unknown country ' + c.country);

  const routes = [];
  const review = [];
  const overlaps = [];
  let pairs = 0, sameCountry = 0, tooFew = 0, excluded = 0;
  const t0 = Date.now();
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const from = cities[i], to = cities[j];
      pairs++;
      if (from.country === to.country) { sameCountry++; continue; }
      const r = routeCountries(world, from, to);
      if (r.excluded) { excluded++; continue; }
      // Two counted countries over the same stretch means overlapping
      // polygons that CARVE does not handle yet.
      for (let x = 0; x < r.counted.length; x++) for (let y = x + 1; y < r.counted.length; y++) {
        const both = r.counted[x].iv.flatMap(([a0, a1]) => r.counted[y].iv
          .map(([b0, b1]) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))));
        const km = both.reduce((s, v) => s + v, 0) * r.km;
        if (km > 1) overlaps.push(`${from.name} - ${to.name}: ${r.counted[x].name} and ${r.counted[y].name} overlap ${km.toFixed(1)} km`);
      }
      for (const c of [...r.counted, ...r.grazes]) {
        if (c.km < REVIEW_KM) review.push({ route: `${from.name} - ${to.name}`, name: c.name, km: c.km, counted: c.km >= MIN_KM });
      }
      if (r.counted.length < MIN_COUNTRIES) { tooFew++; continue; }
      const row = [i, j, r.counted.map((c) => index.get(c.name))];
      if (r.crimea) row.push(1);
      routes.push(row);
    }
  }

  // The page draws countries from the 1:50m file. For the few that are
  // only in the 1:10m data, it needs a point to put a marker on.
  const in50 = new Set(loadFeatures('50m').map((f) => gameName(f.ne)).filter(Boolean));
  const points = {};
  for (const f of loadFeatures('10m')) {
    const name = gameName(f.ne);
    if (name && !in50.has(name)) points[index.get(name)] = geoCentroid(f.geometry).map((x) => +x.toFixed(3));
  }

  const out = {
    countries: names,
    points,
    cities: cities.map((c) => [c.name, index.get(c.country), c.lat, c.lon]),
    routes,
  };
  const json = JSON.stringify(out).replace(/\],\[/g, '],\n[');
  writeFileSync(here('../../flight-path/routes.json'), json + '\n');

  const bands = { short: 0, medium: 0, long: 0 };
  for (const [i, j] of routes) {
    const km = distanceKm([cities[i].lon, cities[i].lat], [cities[j].lon, cities[j].lat]);
    bands[km < 3000 ? 'short' : km <= 8000 ? 'medium' : 'long']++;
  }
  console.log(`${pairs} pairs in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${routes.length} routes kept ` +
    `(short ${bands.short}, medium ${bands.medium}, long ${bands.long}); skipped ${sameCountry} same-country, ` +
    `${tooFew} with fewer than ${MIN_COUNTRIES} countries, ${excluded} over ${[...EXCLUDE_ROUTES].join(', ')}`);
  console.log(`wrote flight-path/routes.json, ${json.length + 1} bytes`);
  if (overlaps.length) console.log(`${overlaps.length} overlapping crossings, first: ${overlaps[0]}`);

  if (reportPath) {
    const byCountry = {};
    for (const r of review) (byCountry[r.name] ||= []).push(r);
    const lines = [`Crossings under ${REVIEW_KM} km (counted when ${MIN_KM} km or more)`, ''];
    for (const [name, list] of Object.entries(byCountry).sort((x, y) => y[1].length - x[1].length)) {
      const counted = list.filter((r) => r.counted);
      lines.push(`${name}: ${counted.length} counted, ${list.length - counted.length} ignored`);
      for (const r of list.sort((x, y) => x.km - y.km)) lines.push(`  ${r.km.toFixed(2).padStart(5)} km ${r.counted ? 'counted' : 'ignored'}  ${r.route}`);
    }
    lines.push('', `Overlaps (${overlaps.length})`, ...overlaps);
    writeFileSync(reportPath, lines.join('\n') + '\n');
    console.log('wrote ' + reportPath);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
