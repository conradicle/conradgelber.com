// Prints every unit's label over time (as the map would show it) and
// fails on gaps in names.json: a dataset name with brackets or a slash and
// no entry, an owner with no abbreviation, or an entry that starts on its
// own date without a source.
//
//   node scripts/borderline/check-names.mjs [--quiet]
import { loadWorld } from './lib/world.mjs';
import { loadNames, labelFor } from './lib/names.mjs';
import { addDays } from '../../src/borderline/window.js';

const quiet = process.argv.includes('--quiet');
const world = loadWorld();
const names = loadNames();
const problems = [];

const byUnit = new Map();
for (const r of world.records) {
  if (!byUnit.has(r.unit)) byUnit.set(r.unit, []);
  byUnit.get(r.unit).push(r);
}
const boundaries = new Set(world.records.flatMap((r) => [r.start, addDays(r.end, 1)]));

for (const [unit, recs] of [...byUnit].sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))) {
  recs.sort((a, b) => (a.start < b.start ? -1 : 1));
  const spans = [];
  for (const r of recs) {
    const dates = [r.start, ...(names.units[unit] || []).map((e) => e.from).filter((d) => d > r.start && d <= r.end)];
    for (const d of dates) {
      let text;
      try { text = labelFor(names, r, d).text; } catch (e) { problems.push(e.message); continue; }
      const last = spans[spans.length - 1];
      if (last && last.text === text) continue;
      spans.push({ from: d, text });
    }
    if (/[(/]/.test(r.name) && !(names.units[unit] || []).some((e) => e.from <= r.start && (e.to === 'present' || e.to >= r.start))) {
      problems.push(unit + ' "' + r.name + '" from ' + r.start + ' has no names.json entry');
    }
  }
  if (!quiet) console.log(unit.padEnd(7) + spans.map((s) => s.from + ' ' + s.text).join('  >  '));
}

for (const [unit, list] of Object.entries(names.units)) {
  for (const e of list) {
    if (e.from > '1816-01-01' && !boundaries.has(e.from) && !e.source) {
      problems.push(unit + ' entry "' + e.label + '" starts ' + e.from + ' (not a record boundary) without a source');
    }
  }
}

if (problems.length) {
  console.error('\n' + problems.length + ' problem(s):\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nnames.json: ok');
