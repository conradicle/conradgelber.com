// Map labels: the text a unit carries on a given day. names.json gives the
// base name per date range; dependencies add their owner in the old atlas
// way, "NIGERIA (BR.)", so independence and changes of owner show on the
// map and count as tells like any rename.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HAND_DIR } from '../config.mjs';

export const SUFFIXED = new Set(['colony', 'protectorate', 'mandate', 'leased']);

export function loadNames(file = path.join(HAND_DIR, 'names.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Dataset name with its bracketed aliases removed. */
export const cleanName = (s) => s.replace(/\s*\([^)]*\)/g, '').replace(/\/.*$/, '').trim();

function entryFor(names, unit, date) {
  const list = names.units[unit];
  if (!list) return null;
  for (const e of list) {
    if (e.from <= date && (e.to === 'present' || date <= e.to)) return e;
  }
  return null;
}

/**
 * @param {object} names  parsed names.json
 * @param {{unit:string, name:string, status:string, owner:string}} rec
 * @param {string} date
 * @returns {{text:string, base:string, owner:string|null}}
 */
export function labelFor(names, rec, date) {
  const e = entryFor(names, rec.unit, date);
  const base = e ? e.label : cleanName(rec.name);
  let owner = null;
  if (e && 'owner' in e) owner = e.owner;
  else if (SUFFIXED.has(rec.status) && !(e && e.suffix === false)) owner = rec.owner;
  const o = owner && names.owners[owner];
  if (owner && !o) throw new Error('names.json: no owner entry for ' + owner + ' (' + rec.unit + ' ' + date + ')');
  const adj = o && new RegExp('\\b(' + o.adj.join('|') + ')\\b').test(base);
  const text = o && !adj ? base + ' (' + o.abbr + ')' : base;
  return { text: text.toUpperCase(), base, owner: o && !adj ? owner : null };
}

/** Every date on which some entry for `unit` begins or ends. */
export function nameDates(names, unit) {
  const out = [];
  for (const e of names.units[unit] || []) {
    out.push(e.from);
    if (e.to !== 'present') out.push(e.to);
  }
  return out;
}
