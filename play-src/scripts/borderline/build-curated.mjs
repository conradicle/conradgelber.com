// Builds the hand-curated pre-1886 puzzles from historical-basemaps
// snapshots (data/borderline/curated.json). Each puzzle names the snapshot
// features to draw and the label each one gets; every other feature in the
// crop is drawn as land with no unit. Its window comes from dated facts
// about what the map shows, each with a source, through the same
// windowFromSpans() the tests use.
//
//   node scripts/borderline/build-curated.mjs           write build/hb.json and bank/C-00.json
//   node scripts/borderline/build-curated.mjs --peek    PNGs of each crop with every feature named
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';
import * as topojson from 'topojson-client';
import { geoArea, geoPath, geoCentroid, geoDistance, geoContains } from 'd3-geo';
import { Resvg } from '@resvg/resvg-js';
import { BUILD_DIR, HAND_DIR, OUT_DIR, RAW_DIR, CURRENT_YEAR, MAX_WINDOW_YEARS, MIN_LABELED, SIMPLIFY_M } from './config.mjs';
import { makeProjection, scaleForWidth, FRAME_W as W, FRAME_H as H } from '../../src/borderline/projection.js';
import { windowFromSpans, windowYears } from '../../src/borderline/window.js';
import { Crop } from './lib/judge.mjs';
import { adjacency } from './lib/raster.mjs';
import { loadWorld } from './lib/world.mjs';
import { when } from './lib/tells.mjs';
import { legible, readableSize } from './lib/fairness.mjs';

const peek = process.argv.includes('--peek');
const curated = JSON.parse(readFileSync(path.join(HAND_DIR, 'curated.json'), 'utf8'));

// historical-basemaps mixes ring orders; d3 wants exterior rings clockwise.
function clockwise(geom) {
  const fix = (poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly);
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: fix(geom.coordinates) };
  return { type: 'MultiPolygon', coordinates: geom.coordinates.map(fix) };
}

// historical-basemaps cuts lakes out of the countries around them, where
// CShapes paints straight across; a hole would show as bare paper on the
// curated maps only. Fill every hole that holds no other feature.
function fillLakes(features) {
  const points = features.map((f) => geoCentroid(f));
  for (const [k, f] of features.entries()) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (let h = poly.length - 1; h >= 1; h--) {
        let hole = { type: 'Polygon', coordinates: [poly[h].slice().reverse()] };
        if (geoArea(hole) > 2 * Math.PI) hole = { type: 'Polygon', coordinates: [poly[h]] };
        if (!points.some((pt, j) => j !== k && geoContains(hole, pt))) poly.splice(h, 1);
      }
    }
  }
}

const snapshots = new Map();
function snapshot(year) {
  if (!snapshots.has(year)) {
    const file = path.join(RAW_DIR, 'hb_world_' + year + '.geojson');
    if (!existsSync(file)) throw new Error('missing ' + file + ': run fetch-sources.mjs');
    const fc = JSON.parse(readFileSync(file, 'utf8'));
    fc.features = fc.features.filter((f) => f.geometry).map((f, i) => ({
      type: 'Feature', geometry: clockwise(f.geometry),
      properties: { rid: 'h' + year + '-' + i, name: f.properties.NAME || '' },
    }));
    fillLakes(fc.features);
    snapshots.set(year, fc);
  }
  return snapshots.get(year);
}

const world = loadWorld();

// A draw key is a feature NAME, or NAME@lon,lat for the one feature of that
// name containing the point (historical-basemaps reuses names).
function matches(key, f) {
  const [name, at] = key.split('@');
  if (f.properties.name !== name) return false;
  return !at || geoContains(f, at.split(',').map(Number));
}
const labelOf = (q, f) => {
  for (const [key, label] of Object.entries(q.draw)) if (matches(key, f)) return label;
  return undefined;
};

function capOf(f) {
  const c = geoCentroid(f);
  let r = 0;
  const walk = (a) => { if (typeof a[0] === 'number') r = Math.max(r, geoDistance(c, a)); else a.forEach(walk); };
  walk(f.geometry.coordinates);
  return { c, r };
}

if (peek) {
  const dir = path.join(BUILD_DIR, 'png', 'curated-peek');
  mkdirSync(dir, { recursive: true });
  for (const q of curated.puzzles) {
    const proj = makeProjection({ c: q.center, s: scaleForWidth(q.km) });
    const pth = geoPath(proj);
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="800" viewBox="0 0 360 400"><rect width="360" height="400" fill="#cfe0e8"/>';
    s += '<path d="' + pth(world.land) + '" fill="#f4ecd6"/>';
    const fc = snapshot(q.snapshot);
    const cols = ['#ead2a4', '#c9d6a8', '#e8bcab', '#bfd0d8', '#dcc8de', '#efdea2'];
    fc.features.forEach((f, i) => {
      const d = pth(f.geometry);
      if (!d) return;
      const drawn = labelOf(q, f) !== undefined;
      s += '<path d="' + d + '" fill="' + (drawn ? cols[i % 6] : 'none') + '" stroke="' + (drawn ? '#553' : '#bbb') + '" stroke-width="0.6"/>';
      const c = proj(geoCentroid(f.geometry));
      if (c && c[0] > 4 && c[0] < W - 4 && c[1] > 4 && c[1] < H - 4) {
        s += '<text x="' + c[0].toFixed(1) + '" y="' + c[1].toFixed(1) + '" font-size="6" text-anchor="middle" font-family="Arial" fill="' + (drawn ? '#000' : '#888') + '">' +
          (f.properties.name || '?').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>';
      }
    });
    s += '</svg>';
    writeFileSync(path.join(dir, q.id + '.png'), new Resvg(s).render().asPng());
  }
  console.log('peeks in ' + dir);
  process.exit(0);
}

// Geometry: the drawn features of every puzzle, clipped to the shared land
// and simplified like the CShapes layers.
const used = new Map();
for (const q of curated.puzzles) {
  for (const key of Object.keys(q.draw)) {
    const fs = snapshot(q.snapshot).features.filter((f) => matches(key, f));
    if (!fs.length) throw new Error(q.id + ': no feature "' + key + '" in ' + q.snapshot);
    for (const f of fs) used.set(f.properties.rid, f);
  }
}
mkdirSync(BUILD_DIR, { recursive: true });
const tmpIn = path.join(BUILD_DIR, 'hb-in.json');
const tmpLand = path.join(BUILD_DIR, 'hb-land.json');
writeFileSync(tmpIn, JSON.stringify({ type: 'FeatureCollection', features: [...used.values()] }));
writeFileSync(tmpLand, JSON.stringify({ type: 'FeatureCollection', features: [world.land] }));
const hbBuild = path.join(BUILD_DIR, 'hb.json');
await mapshaper.runCommands('-i ' + tmpIn + ' name=hb -clip ' + tmpLand + ' -simplify interval=' + SIMPLIFY_M +
  ' keep-shapes -filter-slivers min-area=2km2 -o ' + hbBuild + ' format=topojson quantization=1e6');
const hbTopo = JSON.parse(readFileSync(hbBuild, 'utf8'));
const hbFeatures = new Map(topojson.feature(hbTopo, hbTopo.objects.hb).features.map((f) => [f.properties.rid, f]));

// Tells that rest on colour ('Sicily shares the colour of Savoy') need those
// units in different tints, beyond the neighbour rule.
function distinctColors(q, st, color) {
  const adj = adjacency(st.buf, W, H);
  const ids = q.distinct.map((label) => [...st.recOf].find(([, r]) => r.name === label)?.[0]).filter((id) => id !== undefined);
  for (let i = 1; i < ids.length; i++) {
    const taken = new Set(ids.slice(0, i).map((id) => color.get(id)));
    if (!taken.has(color.get(ids[i]))) continue;
    for (const q2 of adj.get(ids[i]) || []) taken.add(color.get(q2));
    for (let k = 0; k < 6; k++) if (!taken.has(k)) { color.set(ids[i], k); break; }
  }
}

const out = [];
const problems = [];
const regionsOf = (st) => { const m = new Map(); for (let i = 0; i < st.buf.length; i++) if (st.buf[i] > 0) m.set(st.buf[i], (m.get(st.buf[i]) || 0) + 1); return [...m].map(([id, n]) => st.recOf.get(id).name + ':' + n); };
for (const q of curated.puzzles) {
  const fc = snapshot(q.snapshot);
  // A pseudo-world: the drawn features as records that always exist.
  const records = [];
  const labels = { owners: {}, units: {} };
  for (const f of fc.features) {
    const label = labelOf(q, f);
    if (label === undefined) continue;
    const g = hbFeatures.get(f.properties.rid);
    if (!g || !g.geometry) continue;
    const unit = 'u' + (label || f.properties.rid);
    labels.units[unit] = [{ from: '1600-01-01', to: 'present', label: label || ' ' }];
    records.push({
      rid: f.properties.rid, unit, src: q.shown < '1886-01-01' ? 'eu' : 'cs', start: '1600-01-01', end: '9999-12-31',
      status: 'independent', owner: '', name: label || ' ', geometry: g.geometry, area: geoArea(g),
      cap: capOf(g),
    });
  }
  const crop = new Crop({ ...world, records }, labels, { c: q.center, s: Math.round(scaleForWidth(q.km) * 100) / 100 });
  const v = crop.view(q.shown, q.d, { maxBlank: q.maxBlank ?? 0.2 });
  if (v.reject) { problems.push(q.id + ': ' + v.reject + ' ' + JSON.stringify({ sea: v.sea, blank: v.blank })); continue; }
  // Unlabeled features (label null) keep their fill but get no text.
  const placed = [...v.placed].filter(([id]) => (crop.label(v.st, id).base || '').trim());
  if (placed.length < MIN_LABELED) problems.push(q.id + ': only ' + placed.length + ' labels (' + [...regionsOf(v.st)].join(', ') + ')');

  const edges = { first: '1600-01-01', last: 'present' };
  const spans = q.facts.map((f) => ({
    from: f.from || '1600-01-01', to: f.to || 'present', unit: f.about,
    tell: { start: f.fromText, end: f.toText, source: f.source, whenStart: f.whenStart, whenEnd: f.whenEnd, needs: f.needs || [f.about] },
  }));
  const win = windowFromSpans(q.shown, spans, edges);
  // The labels each tell points at must be readable, as in the bank.
  const sizeOf = new Map(placed.map(([, l]) => [l.lines.join(' ').toUpperCase(), readableSize(l)]));
  for (const t of [win.startTell, win.endTell]) {
    for (const need of t?.needs || []) {
      const size = sizeOf.get(need.toUpperCase()) || 0;
      if (!legible(size)) problems.push(q.id + ': tell label ' + need + (size ? ' is ' + size : ' is missing or touches the frame') + ' (' + [...sizeOf].map(([k, s]) => k + '@' + s).join(', ') + ')');
    }
  }
  if (win.startCensored || win.endCensored) problems.push(q.id + ': window open at one end');
  const [sy, ey] = windowYears(win, CURRENT_YEAR);
  if (ey - sy > MAX_WINDOW_YEARS) problems.push(q.id + ': window ' + sy + '-' + ey + ' is wider than ' + MAX_WINDOW_YEARS + ' years');
  if (q.shown < win.start || q.shown > win.end) problems.push(q.id + ': shown date outside its window');
  const text = (t, side) => {
    const base = side === 'start' ? t.start : t.end;
    if (!base) throw new Error(q.id + ': fact for the ' + side + ' edge has no ' + (side === 'start' ? 'fromText' : 'toText'));
    const at = side === 'start' ? t.whenStart : t.whenEnd;
    return base.replace('{when}', at || when(t.date));
  };
  const color = crop.colors(v.st);
  if (q.distinct) distinctColors(q, v.st, color);
  out.push({
    id: q.id, d: q.d, era: 'hb', snapshot: q.snapshot, shown: q.shown, src: 'hb',
    p: crop.p,
    draw: v.st.recs.map((r) => [r.rid, color.get(crop.unitId.get(r.unit))]),
    labels: placed.map(([, l]) => ({ t: l.lines, x: l.x, y: l.y, s: l.size, w: l.w })),
    win: { start: win.start, end: win.end, sy, ey },
    tells: {
      start: { date: win.startTell.date, kind: 'fact', unit: win.startTell.unit, text: text(win.startTell, 'start'), source: win.startTell.source, needs: win.startTell.needs.map((n) => n.toUpperCase()) },
      end: { date: win.endTell.date, kind: 'fact', unit: win.endTell.unit, text: text(win.endTell, 'end'), source: win.endTell.source, needs: win.endTell.needs.map((n) => n.toUpperCase()) },
    },
  });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// Write the shard and the curated block of index.json. build-maps.mjs cuts
// each puzzle's map file from build/hb.json.
mkdirSync(path.join(OUT_DIR, 'bank'), { recursive: true });
rmSync(tmpIn, { force: true });
rmSync(tmpLand, { force: true });
writeFileSync(path.join(OUT_DIR, 'bank/C-00.json'), JSON.stringify(out));
const indexFile = path.join(OUT_DIR, 'index.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
// Curated maps are Normal only: their looser borders would stand out on
// the tight Hard crops.
if (out.some((p) => p.d !== 'N')) throw new Error('curated puzzles must be Normal');
index.curated = { file: 'bank/C-00.json', N: out.map((p) => p.id) };
writeFileSync(indexFile, JSON.stringify(index, null, 1));
console.log('wrote ' + out.length + ' curated puzzles');
