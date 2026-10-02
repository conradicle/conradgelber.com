// Renders bank puzzles to PNG for spot checks, with the window and both
// tells printed under the map. Uses the same drawing code as the page.
//
//   node scripts/borderline/render-puzzle.mjs N0042 H0007 C0003 [--out dir] [--scale 2]
//   node scripts/borderline/render-puzzle.mjs --sample 12     (random spread)
//   node scripts/borderline/render-puzzle.mjs --blind 20 --curated 5 --out dir
//       a shuffled set of maps with no ids or captions, named 01.png ...,
//       and answer-key.txt beside them saying which came from where
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BUILD_DIR, OUT_DIR } from './config.mjs';
import { mapMarkup } from '../../src/borderline/render.js';
import { FRAME_W as W, FRAME_H as H } from '../../src/borderline/projection.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const outDir = opt('--out', path.join(BUILD_DIR, 'png'));
const scale = Number(opt('--scale', 2));
const sample = Number(opt('--sample', 0));
const blind = Number(opt('--blind', 0));
const blindCurated = Number(opt('--curated', 5));
mkdirSync(outDir, { recursive: true });

const read = (f) => JSON.parse(readFileSync(path.join(OUT_DIR, f), 'utf8'));
const index = read('index.json');
const shards = new Map();
const geo = new Map();

function puzzleById(id) {
  const d = id[0];
  const n = Number(id.slice(1));
  const file = 'bank/' + d + '-' + String(Math.floor(n / index.shard)).padStart(2, '0') + '.json';
  if (!shards.has(file)) shards.set(file, read(file));
  const p = shards.get(file).find((q) => q.id === id);
  if (!p) throw new Error('no puzzle ' + id);
  return p;
}

function geoFor(p) {
  const file = p.geo;
  if (!geo.has(file)) geo.set(file, read(file));
  return geo.get(file);
}

function wrap(text, max) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length > max) lines.push(w);
    else lines[lines.length - 1] = (cur + ' ' + w).trim();
  }
  return lines;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function render(id, name = id) {
  const p = puzzleById(id);
  const notes = name !== id ? [] : [
    id + '  shown ' + p.shown + '  window ' + p.win.sy + ' to ' + p.win.ey,
    ...wrap('Start: ' + p.tells.start.text, 64),
    ...wrap('End: ' + (p.tells.end ? p.tells.end.text : 'still standing today'), 64),
  ];
  const capH = notes.length ? 14 + notes.length * 13 : 0;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W * scale + '" height="' + (H + capH) * scale +
    '" viewBox="0 0 ' + W + ' ' + (H + capH) + '">' +
    '<rect width="100%" height="100%" fill="#fff"/>' +
    mapMarkup(p, geoFor(p)) +
    notes.map((t, i) => '<text x="6" y="' + (H + 16 + i * 13) + '" font-family="Georgia, serif" font-size="10" fill="#222">' + esc(t) + '</text>').join('') +
    '</svg>';
  const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Georgia' } }).render().asPng();
  const file = path.join(outDir, name + '.png');
  writeFileSync(file, png);
  console.log('wrote ' + file);
}

let ids = args;
if (sample) {
  ids = [];
  for (const d of Object.keys(index.difficulties)) {
    const { count } = index.difficulties[d];
    for (let k = 0; k < sample; k++) ids.push(d + String(Math.floor(((k + 0.5) / sample) * count)).padStart(4, '0'));
  }
}
if (blind) {
  // Curated maps against CShapes maps from the same years (before 1914),
  // so the date alone gives nothing away. Seeded, so reruns match.
  let a = 20261002;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const take = (list, n) => { const l = [...list], out = []; while (out.length < n && l.length) out.push(l.splice(Math.floor(rand() * l.length), 1)[0]); return out; };
  const curated = take(index.curated.N, blindCurated);
  const n = index.difficulties.N;
  const early = [];
  for (let k = 0; k < n.eraOffsets[2]; k++) early.push('N' + String(k).padStart(4, '0'));
  const picks = take([...curated, ...take(early, blind - curated.length)], blind);
  const key = ['Blind test: which maps are curated (historical-basemaps) and which are CShapes?', ''];
  picks.forEach((id, k) => {
    const name = String(k + 1).padStart(2, '0');
    render(id, name);
    const p = puzzleById(id);
    key.push(name + '.png  ' + (p.src === 'hb' ? 'CURATED (historical-basemaps)' : 'CShapes' + (p.src === 'eu' ? '-Europe' : '')) + '  ' + id + '  shown ' + p.shown);
  });
  writeFileSync(path.join(outDir, 'answer-key.txt'), key.join('\n') + '\n');
} else {
  for (const id of ids) render(id);
}
