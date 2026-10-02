// Writes test/borderline/fixture-geo.json: the CShapes and CShapes-Europe
// records around each crop in test/borderline/cases.json, clipped to a box
// around the crop, in the same layout as build/geo.json. The window tests
// run the real judge on it without the full pipeline.
//
//   node scripts/borderline/make-fixture.mjs   (after build-geo.mjs)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';
import * as topojson from 'topojson-client';
import { BUILD_DIR, PLAY_SRC } from './config.mjs';
import { loadWorld } from './lib/world.mjs';
import { loadNames } from './lib/names.mjs';
import { Crop } from './lib/judge.mjs';
import { makeProjection, scaleForWidth, FRAME_W as W, FRAME_H as H } from '../../src/borderline/projection.js';

const dir = path.join(PLAY_SRC, 'test/borderline');
const cases = JSON.parse(readFileSync(path.join(dir, 'cases.json'), 'utf8'));
const world = loadWorld();
const names = loadNames();
const topo = JSON.parse(readFileSync(path.join(BUILD_DIR, 'geo.json'), 'utf8'));

// Lon/lat box around the frame (with a margin) for each crop.
const boxes = [];
const rids = new Set();
for (const c of cases) {
  const p = { c: c.center, s: scaleForWidth(c.km) };
  const proj = makeProjection(p);
  const pts = [];
  for (let t = 0; t <= 20; t++) {
    for (const [x, y] of [[t / 20 * W, 0], [t / 20 * W, H], [0, t / 20 * H], [W, t / 20 * H]]) {
      pts.push(proj.invert([(x - W / 2) * 1.3 + W / 2, (y - H / 2) * 1.3 + H / 2]));
    }
  }
  const lons = pts.map((q) => q[0]), lats = pts.map((q) => q[1]);
  boxes.push([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
  for (const r of new Crop(world, names, p).cands) rids.add(r.rid);
}

const box = (b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]] } });
const tmp = (f) => path.join(BUILD_DIR, f);
const keep = (layer) => topojson.feature(topo, topo.objects[layer]).features.filter((f) => f.geometry && (layer === 'land' || rids.has(f.properties.rid)));
writeFileSync(tmp('fx-cs.json'), JSON.stringify({ type: 'FeatureCollection', features: keep('cs') }));
writeFileSync(tmp('fx-eu.json'), JSON.stringify({ type: 'FeatureCollection', features: keep('eu') }));
writeFileSync(tmp('fx-land.json'), JSON.stringify({ type: 'FeatureCollection', features: keep('land') }));
writeFileSync(tmp('fx-box.json'), JSON.stringify({ type: 'FeatureCollection', features: boxes.map(box) }));
const out = path.join(dir, 'fixture-geo.json');
await mapshaper.runCommands([
  '-i combine-files', tmp('fx-cs.json'), tmp('fx-eu.json'), tmp('fx-land.json'), tmp('fx-box.json'),
  '-rename-layers cs,eu,land,box',
  '-dissolve target=box',
  '-clip box target=cs,eu,land',
  '-o', out, 'format=topojson target=cs,eu,land quantization=1e6',
].join(' '));
for (const f of ['fx-cs.json', 'fx-eu.json', 'fx-land.json', 'fx-box.json']) rmSync(tmp(f), { force: true });
console.log('wrote ' + out + ' (' + rids.size + ' records)');
