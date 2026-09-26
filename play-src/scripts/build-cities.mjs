// Builds data/cities.json from data/city-list.json and Natural Earth's
// ne_10m_populated_places_simple.geojson (public domain), the same way
// build-places.mjs does for /play/. The geojson is not committed; download
// it once from
//   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places_simple.geojson
// and pass its path:
//   node scripts/build-cities.mjs path/to/ne_10m_populated_places_simple.geojson
//
// Each city's country is the 1:10m admin-0 feature it falls in (or, for a
// point just off the coast, the nearest one within 25 km), mapped to the
// game's country names. Exits non-zero if any entry is missing, ambiguous,
// or not on land.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contains } from '../lib/sphere.mjs';
import { gameName } from '../lib/countries.mjs';
import { loadFeatures, nearestVertexKm } from './world.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-cities.mjs <ne_10m_populated_places_simple.geojson>');
  process.exit(2);
}

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const list = JSON.parse(readFileSync(here('../data/city-list.json'), 'utf8')).cities;
const places = JSON.parse(readFileSync(src, 'utf8')).features;
const world = loadFeatures('10m');

const BASE = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ß: 'ss' };
const fold = (s) => s.replace(/[øØæÆłŁđĐıß]/g, (c) => BASE[c])
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const out = [];
const problems = [];

for (const entry of list) {
  const [label, adm0, adm1] = entry.split('|');
  const [displayRaw, neNameRaw] = label.split('=');
  const exact = displayRaw.endsWith('!');
  const display = exact ? displayRaw.slice(0, -1) : displayRaw;
  const neName = neNameRaw || display;
  const hits = places.filter(({ properties: p }) =>
    (fold(p.name) === fold(neName) || fold(p.nameascii || '') === fold(neName)) &&
    p.adm0name === adm0 &&
    (!adm1 || p.adm1name === adm1));
  if (hits.length !== 1) {
    problems.push(`${entry} -> ${hits.length} matches` +
      (hits.length ? ' (' + hits.map((h) => h.properties.adm1name).join(', ') + ')' : ''));
    continue;
  }
  const [lon, lat] = hits[0].geometry.coordinates.map((x) => +x.toFixed(4));

  let inside = world.filter((f) => gameName(f.ne) && contains(f.rings, [lon, lat]));
  let note = '';
  if (inside.length === 0) {
    const near = world
      .filter((f) => gameName(f.ne))
      .map((f) => ({ f, km: nearestVertexKm(f, [lon, lat]) }))
      .sort((a, b) => a.km - b.km)[0];
    if (near.km > 25) {
      problems.push(`${entry}: not on land, nearest is ${near.f.ne} at ${near.km.toFixed(1)} km`);
      continue;
    }
    inside = [near.f];
    note = ` (off the 1:10m coast by ${near.km.toFixed(1)} km)`;
  }
  const countries = [...new Set(inside.map((f) => gameName(f.ne)))];
  if (countries.length !== 1) {
    problems.push(`${entry}: inside ${countries.join(' and ')}`);
    continue;
  }
  const neDisplay = hits[0].properties.name;
  out.push({
    name: !exact && fold(neDisplay) === fold(display) ? neDisplay : display,
    country: countries[0],
    lat,
    lon,
  });
  if (note) console.log(`${display}${note}`);
}

const seen = new Set();
for (const c of out) {
  if (seen.has(c.name)) problems.push('duplicate ' + c.name);
  seen.add(c.name);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

writeFileSync(here('../data/cities.json'),
  '[\n' + out.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
console.log(`wrote ${out.length} cities to data/cities.json`);
