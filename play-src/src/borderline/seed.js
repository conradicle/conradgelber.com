// Picking puzzles. The daily set is seeded by the date in New York so
// everyone gets the same five maps; practice uses a random seed.

export const DAILY_ZONE = 'America/New_York';

/** Today's date as yyyy-mm-dd in the daily time zone. */
export function dailyKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The pools a game draws from: the curated pre-1886 maps, then one pool
 * per era of the bank. Each round picks a pool by weight, then a puzzle.
 * @returns {{weight:number, ids:string[]}[]}
 */
export function pools(index, diff) {
  const out = [];
  const curated = index.curated ? index.curated[diff] || [] : [];
  if (curated.length) out.push({ weight: 0.6, ids: curated });
  const d = index.difficulties[diff];
  d.eraOffsets.forEach((start, era) => {
    const end = era + 1 < d.eraOffsets.length ? d.eraOffsets[era + 1] : d.count;
    const ids = [];
    for (let n = start; n < end; n++) ids.push(diff + String(n).padStart(4, '0'));
    if (ids.length) out.push({ weight: 1, ids });
  });
  return out;
}

/** Pick `count` distinct puzzle ids. */
export function pick(index, diff, rand, count, avoid = new Set()) {
  const ps = pools(index, diff);
  const total = ps.reduce((s, p) => s + p.weight, 0);
  const chosen = [];
  let guard = 0;
  while (chosen.length < count && guard++ < 1000) {
    let r = rand() * total;
    let pool = ps[ps.length - 1];
    for (const p of ps) { if ((r -= p.weight) < 0) { pool = p; break; } }
    const id = pool.ids[Math.floor(rand() * pool.ids.length)];
    if (chosen.includes(id) || avoid.has(id)) continue;
    chosen.push(id);
  }
  return chosen;
}

export function dailyPicks(index, diff, key, count) {
  return pick(index, diff, rng(hashString('borderline|' + key + '|' + diff)), count);
}
