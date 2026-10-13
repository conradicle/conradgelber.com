// Weakest areas: where the player most needs practice.
//
// Every tossup heard scores between 0 and 1: a miss is 0; a correct buzz is
// worth more the earlier it came (1 at the first word, 0.5 at the last).
// An area's score is the weighted mean over its tossups.
//
// Areas come first from the subcategory (QB Reader's own tag, or the
// player's correction). The estimated era and region tags only fill the list
// when fewer than three subcategories have enough tossups to judge.
// IAC History Bee nationals run harder than a regional set, so each of
// those tossups counts half.

import { ERA_LABEL } from './tags.js';

export const MIN_IN_AREA = 8;
export const BEE_SOURCE = 'iac-bee-qbreader';

export const weightOf = (r) => (r.src === BEE_SOURCE ? 0.5 : 1);

export function pointsOf(r) {
  if (!r.ok) return 0;
  return 1 - 0.5 * (r.buzz === null || r.buzz === undefined ? 1 : r.buzz);
}

function group(records, keyOf) {
  const groups = new Map();
  for (const r of records) {
    const key = keyOf(r);
    if (!key) continue;
    const g = groups.get(key) || { key, n: 0, w: 0, pts: 0, correct: 0, buzzSum: 0, buzzN: 0, sample: r };
    g.n++;
    g.w += weightOf(r);
    g.pts += weightOf(r) * pointsOf(r);
    if (r.ok) {
      g.correct++;
      if (r.buzz !== null) {
        g.buzzSum += r.buzz;
        g.buzzN++;
      }
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    n: g.n,
    score: g.w ? g.pts / g.w : 0,
    accuracy: g.correct / g.n,
    avgBuzz: g.buzzN ? g.buzzSum / g.buzzN : null,
    sample: g.sample,
  }));
}

const byScore = (a, b) => a.score - b.score || b.n - a.n || String(a.key).localeCompare(String(b.key));

/**
 * The weakest areas, at most `count`, each
 * { kind: 'sub'|'era'|'region', key, label, category, n, score, accuracy, avgBuzz, estimated }.
 */
export function weakestAreas(all, { count = 3, min = MIN_IN_AREA } = {}) {
  // Tossups only: a lightning answer carries no buzz point.
  const records = all.filter((r) => r.fmt !== 'lightning');
  // A guessed subcategory (IAC packets) counts only once the player has corrected it.
  const subs = group(records, (r) => (r.sub && r.sub !== 'Unknown' && (!r.sg || (r.fx || []).includes('sub')) ? r.sub : null))
    .filter((g) => g.n >= min)
    .sort(byScore)
    .map((g) => ({ kind: 'sub', key: g.key, label: g.key, category: g.sample.cat, n: g.n, score: g.score, accuracy: g.accuracy, avgBuzz: g.avgBuzz, estimated: false }));
  const out = subs.slice(0, count);
  if (out.length >= count) return out;

  // Secondary signal: estimated era and region, only to fill the list.
  const estimatedOnly = (field) => (r) => !(r.fx || []).includes(field);
  const eras = group(records, (r) => (r.era && r.era !== 'unknown' ? r.era : null))
    .filter((g) => g.n >= min)
    .map((g) => {
      const est = records.some((r) => r.era === g.key && estimatedOnly('era')(r));
      return { kind: 'era', key: g.key, label: (ERA_LABEL[g.key] || g.key) + (est ? ' (estimated)' : ''), category: null, n: g.n, score: g.score, accuracy: g.accuracy, avgBuzz: g.avgBuzz, estimated: est };
    });
  const regions = group(records, (r) => (r.region && !/unclear/i.test(r.region) && r.region !== 'Geography' ? r.region : null))
    .filter((g) => g.n >= min)
    .map((g) => {
      const est = records.some((r) => r.region === g.key && estimatedOnly('region')(r));
      return { kind: 'region', key: g.key, label: g.key + (est ? ' (estimated)' : ''), category: null, n: g.n, score: g.score, accuracy: g.accuracy, avgBuzz: g.avgBuzz, estimated: est };
    });
  for (const g of [...eras, ...regions].sort(byScore)) {
    if (out.length >= count) break;
    out.push(g);
  }
  return out;
}

/** How a question matches a set of weak areas (after corrections). */
export function inAreas(q, areas) {
  return areas.some((a) => (a.kind === 'sub' ? q.subcategory === a.key : a.kind === 'era' ? q.era === a.key : q.region === a.key));
}
