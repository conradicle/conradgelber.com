// Flight Path's weak-spot memory: countries the player misses come up more
// often. Kept in localStorage; every read and write is wrapped so the game
// plays normally when storage is empty, full or blocked.
//
// stats: { [country]: { miss, streak } }. A country missed at a reveal gains
// weight; three correct in a row clears it.

export const STORAGE_KEY = 'flight-path-stats';
const STREAK_TO_CLEAR = 3;
const MAX_MISS = 5;
const MISS_WEIGHT = 2;

export function loadStats(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = {};
    for (const [name, v] of Object.entries(data)) {
      if (v && Number.isFinite(v.miss) && Number.isFinite(v.streak)) out[name] = { miss: v.miss, streak: v.streak };
    }
    return out;
  } catch (e) {
    return {};
  }
}

export function saveStats(storage, stats) {
  try {
    if (Object.keys(stats).length) storage.setItem(STORAGE_KEY, JSON.stringify(stats));
    else storage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    // Private mode or blocked storage: the game still works, it just forgets.
    return false;
  }
}

// Fold a finished round into the stats (returns a new object).
export function recordRound(stats, round) {
  const out = { ...stats };
  for (const name of round.route.countries) {
    const found = round.found.includes(name);
    // Only countries that have been missed are tracked.
    if (found && !out[name]) continue;
    const s = { ...(out[name] || { miss: 0, streak: 0 }) };
    if (found) {
      s.streak += 1;
      if (s.streak >= STREAK_TO_CLEAR) s.miss = 0;
    } else {
      s.miss = Math.min(MAX_MISS, s.miss + 1);
      s.streak = 0;
    }
    if (s.miss === 0 && s.streak >= STREAK_TO_CLEAR) delete out[name];
    else out[name] = s;
  }
  return out;
}

// Countries that currently carry extra weight.
export function weakSpots(stats) {
  return Object.keys(stats).filter((n) => stats[n].miss > 0).sort();
}

export function routeWeight(route, stats) {
  let w = 1;
  for (const c of route.countries) if (stats[c] && stats[c].miss > 0) w += MISS_WEIGHT * stats[c].miss;
  return w;
}

