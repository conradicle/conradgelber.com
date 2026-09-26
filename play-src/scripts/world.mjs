// Loads Natural Earth admin-0 features from the world-atlas package and
// prepares them for lib/sphere.mjs. Used by the /flight-path/ build scripts
// and tests; the 1:10m file never ships to the site.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { prepare, contains, toVec } from '../lib/sphere.mjs';

const require = createRequire(import.meta.url);

export function loadFeatures(resolution = '10m') {
  const topo = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${resolution}.json`), 'utf8'));
  return feature(topo, topo.objects.countries).features.map((f) => ({
    ne: f.properties.name,
    geometry: f.geometry,
    rings: prepare(f.geometry),
  }));
}

// The polygon of Russia's MultiPolygon that holds Crimea (it is its own
// polygon: the Kerch Strait separates it from the rest of Russia and the
// Perekop isthmus joins it to Ukraine).
export function crimeaRings(features) {
  const russia = features.find((f) => f.ne === 'Russia');
  const simferopol = [34.10, 44.95];
  for (const poly of russia.geometry.coordinates) {
    const rings = prepare({ type: 'Polygon', coordinates: poly });
    if (contains(rings, simferopol)) return rings;
  }
  throw new Error('no Crimea polygon in Russia');
}

// Distance in km from a point to the nearest vertex of a feature, a cheap
// stand-in for "how far off the coast" at the 1:10m scale.
export function nearestVertexKm(f, lonlat) {
  const p = toVec(lonlat);
  let best = -1;
  for (const r of f.rings) for (const q of r.pts) {
    const d = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    if (d > best) best = d;
  }
  return 6371 * Math.acos(Math.min(1, best));
}
