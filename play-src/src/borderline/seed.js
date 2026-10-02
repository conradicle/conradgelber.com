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

/** Every puzzle id of a difficulty: the curated maps, then the bank. */
export function allIds(index, diff) {
  const ids = [...(index.curated?.[diff] || [])];
  for (let n = 0; n < index.difficulties[diff].count; n++) ids.push(diff + String(n).padStart(4, '0'));
  return ids;
}

/**
 * Pick `count` distinct ids, every puzzle equally likely, so each era turns
 * up in proportion to how many puzzles it has.
 */
export function pick(index, diff, rand, count, avoid = new Set()) {
  const ids = allIds(index, diff);
  const fresh = ids.filter((id) => !avoid.has(id));
  const from = fresh.length >= count ? fresh : ids;
  const chosen = [];
  while (chosen.length < count && chosen.length < from.length) {
    const id = from[Math.floor(rand() * from.length)];
    if (!chosen.includes(id)) chosen.push(id);
  }
  return chosen;
}

// The daily schedule: one fixed shuffle of every puzzle of a difficulty,
// dealt out `count` a day from this date. A puzzle comes back only when the
// whole shuffle has been dealt, so the gap between repeats is exactly
// scheduleDays() days. Five consecutive ids of a uniform shuffle are a
// uniform sample, so eras appear in proportion to their size.
export const DAILY_EPOCH = '2026-10-01';

export const scheduleDays = (index, diff, count) => Math.floor(allIds(index, diff).length / count);

function dayNumber(key) {
  return Math.round((Date.parse(key + 'T00:00:00Z') - Date.parse(DAILY_EPOCH + 'T00:00:00Z')) / 864e5);
}

const schedules = new Map();
function schedule(index, diff) {
  const cacheKey = diff + '|' + index.difficulties[diff].count + '|' + (index.curated?.[diff] || []).length;
  if (!schedules.has(cacheKey)) {
    const ids = allIds(index, diff);
    const rand = rng(hashString('borderline|' + diff));
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    schedules.set(cacheKey, ids);
  }
  return schedules.get(cacheKey);
}

export function dailyPicks(index, diff, key, count) {
  const days = scheduleDays(index, diff, count);
  const d = ((dayNumber(key) % days) + days) % days;
  return schedule(index, diff).slice(d * count, d * count + count);
}
