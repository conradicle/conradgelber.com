// Checks that every place in ../play/places.json falls on land in
// ../play/land.json, or within 50 km of it. Small islands and coastal
// cities can sit just off the 1:50m coastline, so a near miss is fine; a
// point far out at sea means a bad match in build-places.mjs.
//
//   node scripts/check-places.mjs
//
// Prints every place that fails and exits non-zero if there are any.

import { readFileSync } from 'node:fs';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const topo = read('../../play/land.json');
const places = read('../../play/places.json');
const land = feature(topo, topo.objects.land);

const R = 6371;
const TOLERANCE_KM = 50;
const rad = Math.PI / 180;

const rings = [];
for (const f of land.features || [land]) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) rings.push(ring);
}

// Distance in km from the place to the nearest coastline segment, using a
// local equirectangular projection centred on the place. Accurate to well
// under a kilometre at the 50 km scale that matters here.
function nearestCoastKm(lon, lat) {
  const kx = R * rad * Math.cos(lat * rad);
  const ky = R * rad;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [lon1, lat1] = ring[i - 1];
      const [lon2, lat2] = ring[i];
      if (Math.abs(lat1 - lat) > 3 && Math.abs(lat2 - lat) > 3) continue;
      const wrap = (d) => ((d + 540) % 360) - 180;
      const ax = wrap(lon1 - lon) * kx, ay = (lat1 - lat) * ky;
      const bx = wrap(lon2 - lon) * kx, by = (lat2 - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      best = Math.min(best, Math.hypot(px, py));
    }
  }
  return best;
}

let failures = 0;
let offshore = 0;
for (const p of places) {
  if (geoContains(land, [p.lon, p.lat])) continue;
  const d = nearestCoastKm(p.lon, p.lat);
  if (d <= TOLERANCE_KM) {
    offshore++;
    console.log(`near   ${p.tier.padEnd(8)} ${p.name}, ${p.country}: ${d.toFixed(1)} km from land`);
  } else {
    failures++;
    console.log(`FAIL   ${p.tier.padEnd(8)} ${p.name}, ${p.country}: ${d.toFixed(1)} km from land`);
  }
}

console.log(`${places.length} places: ${places.length - offshore - failures} on land, ` +
  `${offshore} within ${TOLERANCE_KM} km, ${failures} failed`);
process.exit(failures ? 1 : 0);
