// Calls to QB Reader (https://www.qbreader.org/api), the free public
// quizbowl database. The page cannot call it directly: the site's CSP
// allows connections to conradgelber.com only. Only whitelisted parameters
// are passed on, and whole packets are kept in Cloudflare's edge cache.

import { BEE_SETS, CATEGORIES, LEVELS, SUBCATEGORIES, fromQbBonus, fromQbTossup } from '../../play-src/src/historybowl/question.js';

const QB = 'https://www.qbreader.org/api';
const UA = 'conradgelber.com History Bowl Study (conrad@conradgelber.com)';
const PACKET_CACHE_SECONDS = 30 * 24 * 3600;

// How often each category comes up in a mixed draw: History Bowl is mostly
// history, with geography, arts and literature questions around it.
const WEIGHT = { History: 6, Geography: 1.5, 'Fine Arts': 1, Literature: 1 };

const ALL_SUBS = new Set(Object.values(SUBCATEGORIES).flat());

export class UpstreamError extends Error {}

async function qbGet(path, params, { cache = false } = {}) {
  const url = `${QB}/${path}?${new URLSearchParams(params)}`;
  const cacheKey = new Request(url);
  if (cache && typeof caches !== 'undefined') {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit.json();
  }
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  } catch (e) {
    throw new UpstreamError('QB Reader did not answer');
  }
  if (!res.ok) throw new UpstreamError(`QB Reader answered ${res.status}`);
  const body = await res.text();
  if (cache && typeof caches !== 'undefined') {
    await caches.default.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${PACKET_CACHE_SECONDS}` } }));
  }
  return JSON.parse(body);
}

/** Read and check the query string of /api/tossups. Returns null if anything is off. */
export function parseTossupQuery(sp) {
  const list = (k) => (sp.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const src = list('src');
  const cats = list('cats');
  const subs = list('subs');
  const level = sp.get('level') || 'regional';
  const n = Number(sp.get('n') || 8);
  if (!src.length || !src.every((s) => s === 'bee' || s === 'qb')) return null;
  if (!cats.length || !cats.every((c) => CATEGORIES.includes(c))) return null;
  if (!subs.every((s) => ALL_SUBS.has(s))) return null;
  if (!(level in LEVELS)) return null;
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return { src: [...new Set(src)], cats: [...new Set(cats)], subs: [...new Set(subs)], level, n };
}

/** Does a tossup fit the chosen categories and subcategories? */
function fits(t, q) {
  if (!q.cats.includes(t.category)) return false;
  // A subcategory filter only narrows the categories it belongs to.
  const narrowed = q.subs.filter((s) => (SUBCATEGORIES[t.category] || []).includes(s));
  return !narrowed.length || narrowed.includes(t.subcategory);
}

function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Split `n` draws across categories by weight. */
export function splitByWeight(cats, n, rnd = Math.random) {
  const counts = Object.fromEntries(cats.map((c) => [c, 0]));
  const total = cats.reduce((s, c) => s + (WEIGHT[c] || 1), 0);
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    for (const c of cats) {
      r -= WEIGHT[c] || 1;
      if (r < 0) {
        counts[c]++;
        break;
      }
    }
  }
  return counts;
}

async function beeTossups(q, want) {
  const out = [];
  const tried = new Set();
  // A packet has about 25 history tossups, so one or two packets usually do.
  for (let tries = 0; tries < 4 && out.length < want; tries++) {
    const [set, packets] = BEE_SETS[Math.floor(Math.random() * BEE_SETS.length)];
    const packetNumber = 1 + Math.floor(Math.random() * packets);
    if (tried.has(set + packetNumber)) continue;
    tried.add(set + packetNumber);
    const data = await qbGet('packet', { setName: set, packetNumber: String(packetNumber) }, { cache: true });
    const pool = shuffle((data.tossups || []).filter((t) => fits(t, q)));
    for (const t of pool.slice(0, want - out.length)) out.push(fromQbTossup(t, 'bee'));
  }
  return out;
}

async function qbTossups(q, want) {
  if (want <= 0) return [];
  const difficulties = LEVELS[q.level].join(',');
  const calls = [];
  if (q.subs.length) {
    // Subcategories given: one call over them, plus the chosen categories that have none picked.
    const open = q.cats.filter((c) => !(SUBCATEGORIES[c] || []).some((s) => q.subs.includes(s)));
    const subCats = q.cats.filter((c) => !open.includes(c));
    const counts = splitByWeight([...(subCats.length ? ['__subs'] : []), ...open], want);
    for (const [c, k] of Object.entries(counts)) {
      if (!k) continue;
      const params = { difficulties, number: String(k), standardOnly: 'true' };
      if (c === '__subs') Object.assign(params, { categories: subCats.join(','), subcategories: q.subs.join(',') });
      else params.categories = c;
      calls.push(qbGet('random-tossup', params));
    }
  } else {
    for (const [c, k] of Object.entries(splitByWeight(q.cats, want))) {
      if (k) calls.push(qbGet('random-tossup', { categories: c, difficulties, number: String(k), standardOnly: 'true' }));
    }
  }
  const results = await Promise.all(calls);
  return results.flatMap((r) => (r.tossups || []).map((t) => fromQbTossup(t, 'qb')));
}

/** A batch of tossups for the reader, mixed across the chosen sources. */
export async function tossups(q) {
  let fromBee = [];
  if (q.src.includes('bee')) {
    const want = q.src.includes('qb') ? Math.ceil(q.n / 2) : q.n;
    fromBee = await beeTossups(q, want);
  }
  // QB Reader proper fills whatever the Bee packets did not.
  const fromQb = q.src.includes('qb') ? await qbTossups(q, q.n - fromBee.length) : [];
  return shuffle([...fromBee, ...fromQb]).filter((t) => t.text && t.answerPlain);
}

/** Read and check the query string of /api/bonuses: one category, optional subcategory. */
export function parseBonusQuery(sp) {
  const cat = sp.get('cat') || '';
  const sub = sp.get('sub') || '';
  const level = sp.get('level') || 'regional';
  const n = Number(sp.get('n') || 3);
  if (!CATEGORIES.includes(cat)) return null;
  if (sub && !(SUBCATEGORIES[cat] || []).includes(sub)) return null;
  if (!(level in LEVELS)) return null;
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return { cat, sub, level, n };
}

/** Random bonuses in one category, for second-quarter bonuses and lightning rounds. */
export async function bonuses(q) {
  const params = { categories: q.cat, difficulties: LEVELS[q.level].join(','), number: String(q.n), standardOnly: 'true' };
  if (q.sub) params.subcategories = q.sub;
  const data = await qbGet('random-bonus', params);
  return (data.bonuses || []).map(fromQbBonus).filter((b) => b.parts.length);
}

/** QB Reader's answer checker. */
export async function checkAnswer(answerline, givenAnswer) {
  const r = await qbGet('check-answer', { answerline, givenAnswer });
  const directive = ['accept', 'prompt', 'reject'].includes(r.directive) ? r.directive : 'reject';
  return { directive, directedPrompt: typeof r.directedPrompt === 'string' ? r.directedPrompt.slice(0, 200) : null };
}
