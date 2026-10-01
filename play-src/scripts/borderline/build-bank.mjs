// Builds the Borderline puzzle bank: samples crops (seeded, so the same
// inputs give the same bank), judges them on worker threads, keeps the
// fair ones up to a quota per era and difficulty, and writes
//
//   borderline/data/index.json         counts and era offsets
//   borderline/data/bank/N-00.json ... puzzles, 50 to a shard
//   borderline/data/geo/era-<b>.json   TopoJSON of every record drawn in era b
//   borderline/data/geo/land.json      the shared coastline
//   borderline/data/bank.csv           one line a puzzle, for skimming
//
// Run build-geo.mjs first. Curated pre-1886 puzzles are added from
// data/borderline/curated.json by build-curated.mjs.
//
//   node scripts/borderline/build-bank.mjs [--quick]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { DIFF, OUT_DIR, CURRENT_YEAR } from './config.mjs';
import { scaleForWidth } from '../../src/borderline/projection.js';
import { yearOf } from '../../src/borderline/window.js';
import { loadWorld } from './lib/world.mjs';
import { loadNames } from './lib/names.mjs';
import { Crop } from './lib/judge.mjs';
import { tellText } from './lib/tells.mjs';

const SEED = 20261001;
export const SHARD = 50;

// Eras: the daily picks one era per round with equal weight, so each era
// needs a healthy pool. Era 0 is CShapes-Europe (Europe only).
export const ERAS = [
  { from: '1816-01-01', to: '1885-12-31' },
  { from: '1886-01-01', to: '1913-12-31' },
  { from: '1914-01-01', to: '1945-12-31' },
  { from: '1946-01-01', to: '1975-12-31' },
  { from: '1976-01-01', to: '2026-09-30' },
];
const QUOTA = { N: [200, 450, 450, 450, 450], H: [150, 330, 330, 330, 330] };

// Where crops are centred: [lon0, lat0, lon1, lat1, weight per era]. The
// busy regions get most of the weight; "world" keeps some global spread.
// CShapes-Europe stops at the Urals, the Caucasus and the Mediterranean,
// so era 0 uses narrower crops centred well inside it.
const EU_WIDTH = { N: [1500, 2800], H: [550, 1300] };
const REGIONS = [
  { name: 'west-central europe', box: [-10, 42, 25, 59], w: [0, 4, 4, 3, 3] },
  { name: 'balkans', box: [13, 36, 30, 47], w: [0, 4, 4, 3, 3] },
  { name: 'eastern europe', box: [20, 44, 45, 62], w: [0, 3, 3, 3, 4] },
  { name: 'scandinavia and baltic', box: [5, 54, 32, 68], w: [0, 1, 2, 1, 1] },
  { name: 'europe 1816-1885', box: [-4, 40, 32, 58], w: [1, 0, 0, 0, 0] },
  { name: 'middle east', box: [25, 12, 62, 42], w: [0, 4, 5, 4, 3] },
  { name: 'north africa', box: [-17, 15, 35, 37], w: [0, 3, 3, 3, 1] },
  { name: 'sub-saharan africa', box: [-18, -35, 52, 15], w: [0, 6, 5, 6, 2] },
  { name: 'south asia', box: [60, 5, 95, 37], w: [0, 3, 3, 3, 2] },
  { name: 'southeast asia', box: [92, -10, 130, 28], w: [0, 3, 3, 3, 2] },
  { name: 'east asia', box: [100, 20, 145, 52], w: [0, 2, 2, 2, 1] },
  { name: 'central asia', box: [45, 35, 90, 55], w: [0, 1, 1, 1, 2] },
  { name: 'americas', box: [-125, -55, -35, 55], w: [0, 1, 1, 1, 1] },
  { name: 'oceania', box: [110, -45, 180, 0], w: [0, 1, 1, 1, 1] },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 864e5;
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

function makeSpec(rand, i, era, diff) {
  const regs = REGIONS.filter((r) => r.w[era] > 0);
  const total = regs.reduce((s, r) => s + r.w[era], 0);
  let pick = rand() * total, reg = regs[0];
  for (const r of regs) { if ((pick -= r.w[era]) < 0) { reg = r; break; } }
  const [x0, y0, x1, y1] = reg.box;
  const lon = x0 + rand() * (x1 - x0);
  // Uniform on the sphere within the box.
  const s0 = Math.sin(y0 * Math.PI / 180), s1 = Math.sin(y1 * Math.PI / 180);
  const lat = Math.asin(s0 + rand() * (s1 - s0)) * 180 / Math.PI;
  const [k0, k1] = era === 0 ? EU_WIDTH[diff] : DIFF[diff].widthKm;
  const km = k0 * Math.pow(k1 / k0, rand());
  const e = ERAS[era];
  const shown = isoOf(Math.floor(dayNum(e.from) + rand() * (dayNum(e.to) - dayNum(e.from) + 1)));
  return { i, era, diff, region: reg.name, c: [round(lon, 3), round(lat, 3)], km: Math.round(km), shown };
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Worker: judge specs, adjusting the crop width until the label count fits.
function judgeSpec(world, names, spec) {
  const [lo, hi] = DIFF[spec.diff].labeled;
  const [k0, k1] = spec.era === 0 ? EU_WIDTH[spec.diff] : DIFF[spec.diff].widthKm;
  let km = spec.km;
  for (let tries = 0; tries < 6; tries++) {
    const p = { c: spec.c, s: round(scaleForWidth(km), 2) };
    const crop = new Crop(world, names, p);
    const v = crop.view(spec.shown, spec.diff);
    if (v.reject) return { reject: v.reject };
    if (v.nLabels < lo) km *= 1.3;
    else if (v.nLabels > hi) km *= 0.78;
    else return { ...crop.judge(spec.shown, spec.diff, v), p, km: Math.round(km) };
    if (km < k0 * 0.6 || km > k1 * 1.6) break;
  }
  return { reject: 'labels' };
}

if (!isMainThread) {
  const world = loadWorld();
  const names = loadNames();
  parentPort.on('message', (batch) => {
    parentPort.postMessage(batch.map((spec) => {
      try { return { i: spec.i, r: judgeSpec(world, names, spec) }; }
      catch (err) { return { i: spec.i, r: { reject: 'error', error: String(err.stack || err) } }; }
    }));
  });
} else {
  await main();
}

async function runAll(specs) {
  const n = Math.max(1, Math.min(cpus().length - 1, 12));
  const self = fileURLToPath(import.meta.url);
  const workers = Array.from({ length: n }, () => new Worker(self));
  const out = new Array(specs.length);
  let next = 0, done = 0;
  await new Promise((resolve, reject) => {
    const feed = (w) => {
      if (next >= specs.length) return;
      const batch = specs.slice(next, next + 20);
      next += batch.length;
      w.postMessage(batch);
    };
    for (const w of workers) {
      w.on('message', (res) => {
        for (const { i, r } of res) { out[i - specs[0].i] = r; done++; }
        if (done === specs.length) resolve(); else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  await Promise.all(workers.map((w) => w.terminate()));
  return out;
}

async function main() {
  const quick = process.argv.includes('--quick');
  const names = loadNames();
  const rand = rng(SEED);
  const kept = { N: ERAS.map(() => []), H: ERAS.map(() => []) };
  const seen = new Set();
  const stats = {};
  const unverified = new Map();
  const only = (process.argv.find((a) => a.startsWith('--eras=')) || '').slice(7).split(',').filter(Boolean).map(Number);
  const dry = process.argv.includes('--dry');
  const quota = (d, e) => (only.length && !only.includes(e) ? 0
    : quick ? Math.ceil(QUOTA[d][e] / (process.argv.includes('--tiny') ? 60 : 15)) : QUOTA[d][e]);
  let next = 0;
  const maxRounds = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=80').slice(9));
  for (let round = 0; round < maxRounds; round++) {
    const specs = [];
    for (const d of ['N', 'H']) {
      for (let e = 0; e < ERAS.length; e++) {
        const short = quota(d, e) - kept[d][e].length;
        if (short <= 0) continue;
        for (let k = 0; k < Math.min(short * 12 + 60, 3000); k++) specs.push(makeSpec(rand, next++, e, d));
      }
    }
    if (!specs.length) break;
    const t0 = Date.now();
    const res = await runAll(specs);
    for (let k = 0; k < specs.length; k++) {
      const spec = specs[k], r = res[k];
      const key = spec.diff + spec.era + ':' + (r.reject || 'ok');
      stats[key] = (stats[key] || 0) + 1;
      if (r.reject === 'error') console.error(r.error);
      if (r.reject === 'unverified') {
        for (const t of r.unverified) {
          const k = t.date + '  ' + t.kind + '  ' + t.a.unit + ' ' + t.a.label + ' -> ' + t.b.unit + ' ' + t.b.label + (t.born ? ' (born)' : t.gone ? ' (gone)' : '');
          unverified.set(k, (unverified.get(k) || 0) + 1);
        }
      }
      if (r.reject) continue;
      const list = kept[spec.diff][spec.era];
      if (list.length >= quota(spec.diff, spec.era)) continue;
      const dedup = spec.diff + '|' + r.start + '|' + r.end + '|' + r.labels.map((l) => l.lines.join(' ')).sort().join(',');
      if (seen.has(dedup)) { stats[spec.diff + spec.era + ':dup'] = (stats[spec.diff + spec.era + ':dup'] || 0) + 1; continue; }
      seen.add(dedup);
      list.push({ spec, r });
    }
    const fill = ['N', 'H'].map((d) => d + ' ' + kept[d].map((l, e) => l.length + '/' + quota(d, e)).join(' ')).join('  ');
    console.log('round ' + round + ': ' + specs.length + ' crops in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's  ' + fill);
  }
  console.log(Object.entries(stats).sort().map(([k, v]) => k + '=' + v).join('\n'));
  if (unverified.size) {
    console.log('unverified 1816-1885 tells (add to eu-dates.json):');
    for (const [k, v] of [...unverified].sort((p, q) => q[1] - p[1])) console.log(String(v).padStart(5) + '  ' + k);
  }
  if (dry) return;
  await write(kept, names);
}

async function write(kept, names) {
  const bankDir = path.join(OUT_DIR, 'bank');
  const geoDir = path.join(OUT_DIR, 'geo');
  mkdirSync(bankDir, { recursive: true });
  for (const f of readdirSync(bankDir)) if (/^[NH]-d+.json$/.test(f)) rmSync(path.join(bankDir, f));
  mkdirSync(geoDir, { recursive: true });
  const world = loadWorld();
  // Keep the curated block that build-curated.mjs adds.
  const old = existsSync(path.join(OUT_DIR, 'index.json')) ? JSON.parse(readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8')) : {};
  const index = { version: 1, shard: SHARD, eras: ERAS, difficulties: {}, curated: old.curated };
  const csv = [['id', 'difficulty', 'era', 'shown', 'from', 'to', 'width', 'start_tell', 'end_tell', 'labels', 'lon', 'lat', 'km', 'region'].join(',')];
  const usedByEra = ERAS.map(() => new Set());
  for (const d of ['N', 'H']) {
    const all = [];
    const offsets = [];
    kept[d].forEach((list, era) => {
      offsets.push(all.length);
      for (const { spec, r } of list) all.push({ spec, r, era });
    });
    const puzzles = all.map(({ spec, r, era }, n) => {
      const id = d + String(n).padStart(4, '0');
      for (const [rid] of r.draw) usedByEra[era].add(rid);
      const startText = tellText(r.startTell, 'start', names.owners, r.startTell.precision);
      const endText = r.endTell ? tellText(r.endTell, 'end', names.owners, r.endTell.precision) : null;
      const sy = yearOf(r.start);
      const ey = r.end === 'present' ? CURRENT_YEAR : yearOf(r.end);
      const tell = (t, text) => t && { date: t.date, kind: t.kind, unit: t.kind === 'name' ? (t.b || t.a).unit : (t.born ? t.b.unit : t.gone ? t.a.unit : t.a.unit), text };
      csv.push([id, d, era, spec.shown, r.start, r.end, ey - sy, startText, endText || 'still standing today',
        r.labels.map((l) => l.lines.join(' ')).join(' / '), spec.c[0], spec.c[1], r.km, spec.region].map(csvCell).join(','));
      return {
        id, era, shown: spec.shown, src: spec.era === 0 ? 'eu' : 'cs',
        p: r.p, draw: r.draw,
        labels: r.labels.map((l) => ({ t: l.lines, x: l.x, y: l.y, s: l.size, w: l.w })),
        win: { start: r.start, end: r.end, sy, ey: r.end === 'present' ? 'present' : ey },
        tells: { start: tell(r.startTell, startText), end: tell(r.endTell, endText) },
      };
    });
    for (let s = 0; s * SHARD < puzzles.length; s++) {
      const file = d + '-' + String(s).padStart(2, '0') + '.json';
      writeFileSync(path.join(bankDir, file), JSON.stringify(puzzles.slice(s * SHARD, (s + 1) * SHARD)));
    }
    index.difficulties[d] = { count: puzzles.length, eraOffsets: offsets };
  }
  writeFileSync(path.join(OUT_DIR, 'bank.csv'), csv.join('\n') + '\n');
  writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 1));
  await writeGeo(world, usedByEra, geoDir);
  console.log('wrote bank: N ' + index.difficulties.N.count + ', H ' + index.difficulties.H.count);
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function writeGeo(world, usedByEra, geoDir) {
  const strip = (r) => ({ type: 'Feature', properties: { rid: r.rid }, geometry: r.geometry });
  for (const [era, used] of usedByEra.entries()) {
    const fc = { type: 'FeatureCollection', features: world.records.filter((r) => used.has(r.rid)).map(strip) };
    await runMapshaper(fc, path.join(geoDir, 'era-' + era + '.json'), 'era');
  }
  await runMapshaper({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: world.land.geometry }] },
    path.join(geoDir, 'land.json'), 'land');
}

function runMapshaper(fc, out, name) {
  const tmp = out + '.in.json';
  writeFileSync(tmp, JSON.stringify(fc));
  return mapshaper.runCommands('-i ' + tmp + ' name=' + name + ' -o ' + out + ' format=topojson quantization=100000')
    .finally(() => rmSync(tmp, { force: true }));
}
