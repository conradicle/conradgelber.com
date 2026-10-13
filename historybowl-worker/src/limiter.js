import { DurableObject } from 'cloudflare:workers';

/**
 * Per-IP counters, one Durable Object per IP, as in the pool Worker and
 * Cambio's (conradicle/cambio-game, packages/worker/src/limiter.ts). The
 * object is named by a SHA-256 of the IP, so the address itself is never a
 * name or a stored value, and the counts live only in memory.
 */

export const WINDOW_MS = 60_000;
/** Per IP, per minute. */
export const LIMITS = {
  /** Batches of questions and answer checks. A fast player uses about 10 a minute. */
  api: 120,
  /** Error reports. */
  report: 10,
  /** Wrong team passcodes. */
  unlock: 10,
};

export class Limiter extends DurableObject {
  hits = new Map();

  /** POST /hit?kind=K: count one, and answer 429 if the window was already full. GET /check?kind=K: 429 if full, without counting. */
  async fetch(request) {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    if (!(kind in LIMITS)) return new Response(null, { status: 400 });
    const now = Date.now();
    const recent = (this.hits.get(kind) ?? []).filter((t) => now - t < WINDOW_MS);
    const full = recent.length >= LIMITS[kind];
    if (!full && url.pathname === '/hit') recent.push(now);
    this.hits.set(kind, recent);
    return new Response(null, { status: full ? 429 : 200 });
  }
}

async function stubFor(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`historybowl-limit:${ip}`));
  const name = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return env.LIMITER.get(env.LIMITER.idFromName(name));
}

/** Is there room for one more of this kind from this IP? Counts nothing. */
export async function hasRoom(request, env, kind) {
  return (await (await stubFor(request, env)).fetch(`https://limit/check?kind=${kind}`)).status === 200;
}

/** Count one request of this kind from this IP; false once the minute's allowance is used. Local dev has no CF-Connecting-IP, so it shares one. */
export async function allow(request, env, kind) {
  return (await (await stubFor(request, env)).fetch(`https://limit/hit?kind=${kind}`, { method: 'POST' })).status === 200;
}
