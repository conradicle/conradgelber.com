// Cuts the map geometry into small files so a game downloads only what its
// five maps draw. Puzzles are grouped by difficulty, era and a grid cell of
// their centre; each group gets one TopoJSON holding the records its
// puzzles draw and the coastline, clipped to the box the group's frames
// cover and simplified to a third of a pixel at the group's widest zoom.
// Curated puzzles get one file each. Every puzzle's "geo" names its file.
//
// Run after build-bank.mjs and build-curated.mjs.
//
//   node scripts/borderline/build-maps.mjs [--sizes]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import mapshaper from 'mapshaper';
import * as topojson from 'topojson-client';
import { BUILD_DIR, OUT_DIR, SIMPLIFY_M } from './config.mjs';
import { makeProjection, FRAME_W as W, FRAME_H as H } from '../../src/borderline/projection.js';
import { loadWorld } from './lib/world.mjs';

// Grid cells in degrees. Hard crops are small, so their cells are too.
export const CELL = { N: [30, 20], H: [20, 15], C: [360, 180] };
// The projection draws 4 units past the frame edge; clip a little further.
const PAD = 10;
const MARGIN_DEG = 0.5;
// Simplify to this fraction of a frame unit at the widest crop in a group.
const SIMPLIFY_PX = 0.35;
const EARTH_KM = 6371.0088;

const bankDir = path.join(OUT_DIR, 'bank');
const geoDir = path.join(OUT_DIR, 'geo');
const shards = readdirSync(bankDir).filter((f) => /^[NHC]-\d+\.json$/.test(f)).sort();
const bank = new Map(shards.map((f) => [f, JSON.parse(readFileSync(path.join(bankDir, f), 'utf8'))]));

/** Lon/lat box of a crop's frame, longitudes unwrapped around its centre. */
function extent(p) {
  const proj = makeProjection(p);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    for (const [x, y] of [
      [-PAD + (W + 2 * PAD) * k / steps, -PAD], [-PAD + (W + 2 * PAD) * k / steps, H + PAD],
      [-PAD, -PAD + (H + 2 * PAD) * k / steps], [W + PAD, -PAD + (H + 2 * PAD) * k / steps],
    ]) {
      const ll = proj.invert([x, y]);
      let lon = ll[0];
      while (lon - p.c[0] > 180) lon -= 360;
      while (lon - p.c[0] < -180) lon += 360;
      x0 = Math.min(x0, lon); x1 = Math.max(x1, lon);
      y0 = Math.min(y0, ll[1]); y1 = Math.max(y1, ll[1]);
    }
  }
  // A pole inside the frame takes every longitude.
  for (const pole of [[0, 90], [0, -90]]) {
    const xy = proj(pole);
    if (xy && xy[0] > -PAD && xy[0] < W + PAD && xy[1] > -PAD && xy[1] < H + PAD) {
      x0 = -180; x1 = 180;
      if (pole[1] > 0) y1 = 90; else y0 = -90;
    }
  }
  return [x0 - MARGIN_DEG, Math.max(-90, y0 - MARGIN_DEG), x1 + MARGIN_DEG, Math.min(90, y1 + MARGIN_DEG)];
}

/** Clip rectangles for a box, split at the antimeridian. */
function clipShapes([x0, y0, x1, y1]) {
  const rect = (a, b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a, y0], [a, y1], [b, y1], [b, y0], [a, y0]]] } });
  if (x1 - x0 >= 360) return [rect(-180, 180)];
  const out = [];
  if (x0 < -180) { out.push(rect(x0 + 360, 180)); out.push(rect(-180, x1)); }
  else if (x1 > 180) { out.push(rect(x0, 180)); out.push(rect(-180, x1 - 360)); }
  else out.push(rect(x0, x1));
  return out;
}

const kmOf = (p) => (W * EARTH_KM) / p.s;

function groupKey(p) {
  if (p.src === 'hb') return p.id;
  const d = p.id[0];
  const [cw, ch] = CELL[d];
  const cx = Math.floor((p.p.c[0] + 180) / cw), cy = Math.floor((p.p.c[1] + 90) / ch);
  return d + p.era + '-' + cx + '-' + cy;
}

const world = loadWorld();
const hbFile = path.join(BUILD_DIR, 'hb.json');
const hb = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : null;
const hbFeatures = hb ? new Map(topojson.feature(hb, hb.objects.hb).features.map((f) => [f.properties.rid, f.geometry])) : new Map();
const geometryOf = (rid) => world.byRid.get(rid)?.geometry || hbFeatures.get(rid);

const groups = new Map();
for (const list of bank.values()) {
  for (const p of list) {
    const key = groupKey(p);
    if (!groups.has(key)) groups.set(key, { key, puzzles: [], rids: new Set(), box: null, km: 0 });
    const g = groups.get(key);
    g.puzzles.push(p);
    for (const [rid] of p.draw) g.rids.add(rid);
    const b = extent(p.p);
    g.box = g.box ? [Math.min(g.box[0], b[0]), Math.min(g.box[1], b[1]), Math.max(g.box[2], b[2]), Math.max(g.box[3], b[3])] : b;
    g.km = Math.max(g.km, kmOf(p.p));
  }
}

mkdirSync(geoDir, { recursive: true });
const tmp = path.join(BUILD_DIR, 'maps-tmp');
mkdirSync(tmp, { recursive: true });
const written = new Set();
let raw = 0, gz = 0;
for (const g of groups.values()) {
  const file = 'g-' + g.key + '.json';
  const records = { type: 'FeatureCollection', features: [...g.rids].map((rid) => {
    const geometry = geometryOf(rid);
    if (!geometry) throw new Error('no geometry for ' + rid);
    return { type: 'Feature', properties: { rid, u: world.byRid.get(rid)?.unit || rid }, geometry };
  }) };
  const land = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: world.land.geometry }] };
  const clip = { type: 'FeatureCollection', features: clipShapes(g.box) };
  for (const [name, fc] of [['r', records], ['land', land], ['clip', clip]]) writeFileSync(path.join(tmp, name + '.json'), JSON.stringify(fc));
  const interval = Math.max(SIMPLIFY_M, Math.round((SIMPLIFY_PX * g.km * 1000) / W));
  const out = path.join(geoDir, file);
  await mapshaper.runCommands('-i ' + path.join(tmp, 'r.json') + ' ' + path.join(tmp, 'land.json') + ' combine-files' +
    ' -clip ' + path.join(tmp, 'clip.json') + ' target=* -simplify interval=' + interval + ' keep-shapes target=*' +
    ' -o ' + out + ' format=topojson quantization=100000 target=*');
  const buf = readFileSync(out);
  raw += buf.length; gz += zlib.gzipSync(buf, { level: 9 }).length;
  written.add(file);
  for (const p of g.puzzles) p.geo = 'geo/' + file;
}
rmSync(tmp, { recursive: true, force: true });

// Drop map files no puzzle uses (older layouts included).
for (const f of readdirSync(geoDir)) if (!written.has(f)) rmSync(path.join(geoDir, f));
for (const [f, list] of bank) writeFileSync(path.join(bankDir, f), JSON.stringify(list));
console.log('wrote ' + written.size + ' map files, ' + (raw / 1048576).toFixed(1) + ' MB raw, ' + (gz / 1048576).toFixed(1) + ' MB gzipped');
