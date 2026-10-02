// Loads build/geo.json into plain records the judge can query by date.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as topojson from 'topojson-client';
import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import { BUILD_DIR, CS_LAST, HAND_DIR } from '../config.mjs';
import { addDays } from '../../../src/borderline/window.js';

// Open-ended records (standing at the last CShapes day) run to this date.
export const OPEN = '9999-12-31';

function cap(feature) {
  const c = geoCentroid(feature);
  let r = 0;
  const walk = (a) => {
    if (typeof a[0] === 'number') { r = Math.max(r, geoDistance(c, a)); return; }
    for (const b of a) walk(b);
  };
  walk(feature.geometry.coordinates);
  return { c, r };
}

export function loadWorld(file = path.join(BUILD_DIR, 'geo.json'), { strict = true } = {}) {
  const topo = JSON.parse(readFileSync(file, 'utf8'));
  const records = [];
  for (const layer of ['cs', 'eu']) {
    for (const f of topojson.feature(topo, topo.objects[layer]).features) {
      if (!f.geometry) continue;
      const p = f.properties;
      records.push({
        ...p,
        src: layer,
        end: layer === 'cs' && p.end === CS_LAST ? OPEN : p.end,
        geometry: f.geometry,
        area: geoArea(f),
        cap: cap(f),
      });
    }
  }
  const land = topojson.feature(topo, topo.objects.land).features[0];
  applyCsDates(records, strict);
  const euVerified = applyEuDates(records, strict);
  return { topo, records, land, euVerified, byRid: new Map(records.map((r) => [r.rid, r])) };
}

/** Sourced corrections to CShapes 2.0 record dates (cs-dates.json). */
function applyCsDates(records, strict, file = path.join(HAND_DIR, 'cs-dates.json')) {
  if (!existsSync(file)) return;
  for (const ch of JSON.parse(readFileSync(file, 'utf8')).changes) {
    if (!ch.source) throw new Error('cs-dates: no source for ' + ch.unit);
    const side = 'start' in ch ? 'start' : 'end';
    const mine = records.filter((r) => r.src === 'cs' && r.unit === ch.unit && r[side] === ch[side]);
    if (!mine.length) { if (strict) throw new Error('cs-dates: no ' + ch.unit + ' record with ' + side + ' ' + ch[side]); continue; }
    for (const r of mine) r[side] = side === 'start' ? ch.newStart : ch.newEnd;
  }
}

/**
 * CShapes-Europe records hold the borders of 1 January of each year, so
 * the change between two records happened some time in the year before.
 * eu-dates.json gives the real date (with a source) for each change that
 * can become a tell. Returns the set of verified change dates; a 1816-1885
 * puzzle whose tell falls on any other date is rejected.
 */
// strict: false skips entries whose records are missing (the test fixture
// holds only the records near its crops).
function applyEuDates(records, strict, file = path.join(HAND_DIR, 'eu-dates.json')) {
  const verified = new Map();
  if (!existsSync(file)) return verified;
  const { changes } = JSON.parse(readFileSync(file, 'utf8'));
  const eu = records.filter((r) => r.src === 'eu');
  for (const ch of changes) {
    const mine = eu.filter((r) => r.unit === ch.unit);
    if ('from' in ch) {
      const rec = mine.find((r) => r.start === ch.from + '-01-01');
      if (!rec) { if (strict) throw new Error('eu-dates: no ' + ch.unit + ' record from ' + ch.from); continue; }
      const prev = mine.find((r) => r.end === (ch.from - 1) + '-12-31');
      rec.start = ch.date;
      if (prev) prev.end = addDays(ch.date, -1);
    } else {
      const rec = mine.find((r) => r.end === ch.to + '-12-31');
      if (!rec) { if (strict) throw new Error('eu-dates: no ' + ch.unit + ' record to ' + ch.to); continue; }
      rec.end = addDays(ch.date, -1);
    }
    if (!ch.source) throw new Error('eu-dates: no source for ' + ch.unit + ' ' + ch.date);
    verified.set(ch.date, ch);
  }
  return verified;
}
