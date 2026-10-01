// Diagnostic: how the CShapes-Europe map of 31 December 1885 meets the
// CShapes map of 1 January 1886 across a grid of European crops. The seam
// is never a tell; where it differs visibly, crops cannot reach back past
// 1886 and fall back to the 1886 edge.
//
//   node scripts/borderline/check-seam.mjs [km]
import { loadWorld } from './lib/world.mjs';
import { loadNames } from './lib/names.mjs';
import { Crop } from './lib/judge.mjs';
import { scaleForWidth, FRAME_W as W, FRAME_H as H } from '../../src/borderline/projection.js';
import { largestChange } from './lib/raster.mjs';
import { CS_FIRST, VISIBLE_MIN_AREA } from './config.mjs';

const km = Number(process.argv[2] || 2500);
const world = loadWorld();
const names = loadNames();
const pairs = new Map();
let n = 0, bad = 0;
for (let lat = 38; lat <= 64; lat += 4) {
  for (let lon = -6; lon <= 40; lon += 4) {
    const crop = new Crop(world, names, { c: [lon, lat], s: scaleForWidth(km) });
    const a = crop.paint('1885-12-31'), b = crop.paint(CS_FIRST);
    const ch = largestChange(a.buf, b.buf, W, H);
    n++;
    if (ch.area < VISIBLE_MIN_AREA) continue;
    bad++;
    const nm = (st, id) => (id < 0 ? 'sea' : id === 0 ? 'blank' : st.recOf.get(id).name);
    const k = nm(a, ch.pair[0]) + ' -> ' + nm(b, ch.pair[1]);
    pairs.set(k, (pairs.get(k) || []).concat([lon + ',' + lat + ':' + ch.area]));
  }
}
console.log('crops ' + n + ', visible seam in ' + bad);
for (const [k, v] of [...pairs].sort((p, q) => q[1].length - p[1].length)) console.log(v.length + '  ' + k + '   ' + v.slice(0, 6).join(' '));
