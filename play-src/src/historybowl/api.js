// Calls to the History Bowl Worker at /historybowl/api (same origin, so the
// site's CSP allows them). The Worker talks to QB Reader.

const API = '/historybowl/api';

async function call(path, init = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
    const res = await fetch(API + path, { ...init, signal: ctrl.signal, headers });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A batch of tossups from the chosen sources. IAC packets (team only) come
 * from their own endpoint and make up about a third of a mixed batch.
 */
export async function fetchTossups(settings, n) {
  const qbSources = settings.sources.filter((s) => s === 'bee' || s === 'qb');
  const pass = settings.sources.includes('iac') ? settings.teamPass : '';
  const fromIac = pass ? (qbSources.length ? Math.max(1, Math.round(n / 3)) : n) : 0;
  const [iac, rest] = await Promise.all([
    fromIac ? iacTossups(pass, fromIac).catch(() => []) : [],
    qbSources.length ? fetchQb({ ...settings, sources: qbSources }, n - fromIac) : [],
  ]);
  const all = [...iac, ...rest];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

async function fetchQb(settings, n) {
  if (n <= 0) return [];
  const params = new URLSearchParams({
    src: settings.sources.join(','),
    cats: settings.cats.join(','),
    subs: (settings.subs || []).join(','),
    level: settings.level,
    n: String(n),
  });
  const data = await call(`/tossups?${params}`, {}, 15000);
  return Array.isArray(data.tossups) ? data.tossups : [];
}

export async function checkRemote(answerline, given, timeoutMs) {
  const r = await call('/check', { method: 'POST', body: JSON.stringify({ answerline, given }) }, timeoutMs);
  if (!['accept', 'prompt', 'reject'].includes(r.directive)) throw new Error('bad answer');
  return r;
}

export async function sendReport(report) {
  return call('/report', { method: 'POST', body: JSON.stringify(report) });
}

/** Random bonuses in one category (and optional subcategory). */
export async function fetchBonuses({ cat, sub = '', level = 'regional', n = 3 }) {
  const params = new URLSearchParams({ cat, sub: sub || '', level, n: String(n) });
  const data = await call(`/bonuses?${params}`, {}, 15000);
  return Array.isArray(data.bonuses) ? data.bonuses : [];
}

// ---------- IAC regional packets (team passcode) ----------

const team = (pass) => ({ headers: { 'X-Team-Passcode': pass } });

/** { ok, packets, complete } for a right passcode; throws with .status 401 for a wrong one. */
export async function iacCheck(pass) {
  return call('/iac/check', team(pass));
}

/** A whole packet for a match, avoiding the ids in `not` when it can. */
export async function iacPacket(pass, not = []) {
  const data = await call(`/iac/packet?not=${encodeURIComponent(not.slice(-40).join(','))}`, team(pass), 15000);
  return data.packet || null;
}

export async function iacTossups(pass, n, fmt = 'long') {
  const data = await call(`/iac/tossups?n=${n}&fmt=${fmt}`, team(pass), 15000);
  return Array.isArray(data.tossups) ? data.tossups : [];
}
