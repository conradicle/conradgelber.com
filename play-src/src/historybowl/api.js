// Calls to the History Bowl Worker at /historybowl/api (same origin, so the
// site's CSP allows them). The Worker talks to QB Reader.

const API = '/historybowl/api';

async function call(path, init = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API + path, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTossups(settings, n) {
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
