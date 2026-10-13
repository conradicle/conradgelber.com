// Import IAC National History Bowl packets (PDFs) for History Bowl Study.
//
//   node play-src/scripts/historybowl/import-packets.mjs <folder or PDFs...>
//
// For each PDF: read its lines, parse the quarters, and write
//   play-src/data/historybowl/iac/<packet id>.json   the packet, as questions
//   play-src/data/historybowl/iac/report.txt         what parsed and any problems
//   play-src/data/historybowl/iac/kv.json            everything, for KV upload
// That folder is git-ignored: IAC's questions never go into this public
// repo. Upload with `npm --prefix historybowl-worker run upload-iac`.
// A .txt file of lines (one per line, bold as <b>...</b>) also works, for testing.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parsePacket, packetComplete } from '../../src/historybowl/packet.js';
import { fromPacket } from '../../src/historybowl/question.js';
import { pdfLines } from './pdf-lines.mjs';

const OUT = resolve(import.meta.dirname, '../../data/historybowl/iac');

function inputs(args) {
  const files = [];
  for (const a of args) {
    const p = resolve(a);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (/\.(pdf|txt)$/i.test(f)) files.push(join(p, f));
    } else files.push(p);
  }
  return files;
}

async function linesOf(file) {
  if (extname(file).toLowerCase() === '.pdf') return pdfLines(file);
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((html) => ({ html, text: html.replace(/<[^>]*>/g, '') }));
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node play-src/scripts/historybowl/import-packets.mjs <folder or PDFs...>');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const report = [];
const kv = [];
const index = [];
const seen = new Set();
for (const file of inputs(args)) {
  let parsed;
  try {
    parsed = parsePacket(await linesOf(file), { file: basename(file) });
  } catch (e) {
    report.push(`${basename(file)}: could not read (${e.message})`);
    continue;
  }
  const pk = fromPacket(parsed);
  let id = pk.id;
  for (let n = 2; seen.has(id); n++) id = `${pk.id}-${n}`;
  seen.add(id);
  pk.id = id;
  const counts = { q1: pk.q1.length, q2: pk.q2.length, bonuses: pk.q2.filter((x) => x.bonus).length, q3: pk.q3.map((c) => c.questions.length), q4: pk.q4.length, extra: pk.extra.length };
  const complete = packetComplete(parsed);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(pk, null, 1));
  kv.push({ key: `packet:${id}`, value: JSON.stringify(pk) });
  index.push({ id, label: pk.label, file: basename(file), counts, complete });
  report.push(`${basename(file)} -> ${id} (${pk.label}) ${complete ? 'complete' : 'INCOMPLETE'}`);
  report.push(`  Q1 ${counts.q1}, Q2 ${counts.q2} with ${counts.bonuses} bonuses, Q3 ${pk.q3.map((c) => `"${c.label}" ${c.questions.length}`).join(', ') || 'none'}, Q4 ${counts.q4}, extra ${counts.extra}`);
  for (const p of parsed.problems) report.push(`  problem: ${p}`);
}
kv.push({ key: 'index', value: JSON.stringify(index) });
writeFileSync(join(OUT, 'kv.json'), JSON.stringify(kv));
writeFileSync(join(OUT, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
console.log(`\n${index.length} packets, ${index.filter((p) => p.complete).length} complete. Written to ${OUT}`);
