// Builds ../play/places.json from place-list.mjs and Natural Earth's
// ne_10m_populated_places_simple.geojson (public domain). The geojson is not
// committed; download it once from
//   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places_simple.geojson
// and pass its path:
//   node scripts/build-places.mjs path/to/ne_10m_populated_places_simple.geojson
//
// Exits non-zero if any entry is missing or ambiguous in Natural Earth.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TIERS, COUNTRY_LABELS } from './place-list.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-places.mjs <ne_10m_populated_places_simple.geojson>');
  process.exit(2);
}

const features = JSON.parse(readFileSync(src, 'utf8')).features;
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const out = [];
const problems = [];

for (const [tier, entries] of Object.entries(TIERS)) {
  for (const entry of entries) {
    const [label, country, adm1] = entry.split('|');
    const [display, neNameRaw] = label.split('=');
    const neName = neNameRaw || display;
    const hits = features.filter(({ properties: p }) =>
      (fold(p.name) === fold(neName) || fold(p.nameascii || '') === fold(neName)) &&
      p.adm0name === country &&
      (!adm1 || p.adm1name === adm1));
    if (hits.length !== 1) {
      problems.push(`${tier}: ${entry} -> ${hits.length} matches` +
        (hits.length ? ' (' + hits.map((h) => h.properties.adm1name).join(', ') + ')' : ''));
      continue;
    }
    const [lon, lat] = hits[0].geometry.coordinates;
    out.push({
      name: display,
      country: COUNTRY_LABELS[country] || country,
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
      tier,
      ne_id: hits[0].properties.ne_id,
    });
  }
}

const seen = new Set();
for (const p of out) {
  const key = p.tier + ':' + p.name;
  if (seen.has(key)) problems.push('duplicate ' + key);
  seen.add(key);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const dest = fileURLToPath(new URL('../../play/places.json', import.meta.url));
writeFileSync(dest, JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
const counts = Object.keys(TIERS).map((t) => `${t} ${out.filter((p) => p.tier === t).length}`);
console.log(`wrote ${out.length} places to play/places.json (${counts.join(', ')})`);
