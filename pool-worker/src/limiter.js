import { DurableObject } from 'cloudflare:workers';

/**
 * Per-IP counters, one Durable Object per IP, as in Cambio's Worker
 * (conradicle/cambio-game, packages/worker/src/limiter.ts). The object is
 * named by a SHA-256 of the IP, so the address itself is never a name or a
 * stored value, and the counts live only in memory.
 */

export const WINDOW_MS = 60_000;
/** Per IP, per minute. */
export const LIMITS = {
  /** Sockets opened with a room code that has no room: a wrong code or a guess. */
  miss: 10,
  /** New rooms (?create=1). */
  create: 5,
};

export class Limiter extends DurableObject {
  hits = new Map();

  /** GET /check?kind=K: 429 once the window is full. POST /hit?kind=K: count one. */
  async fetch(request) {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    if (!(kind in LIMITS)) return new Response(null, { status: 400 });
    const now = Date.now();
    const recent = (this.hits.get(kind) ?? []).filter((t) => now - t < WINDOW_MS);
    if (url.pathname === '/hit') recent.push(now);
    this.hits.set(kind, recent);
    return new Response(null, { status: recent.length >= LIMITS[kind] ? 429 : 200 });
  }
}

/** The limiter for this request's IP. Local dev has no CF-Connecting-IP, so it shares one. */
export async function limiterFor(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pool-limit:${ip}`));
  const name = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const stub = env.LIMITER.get(env.LIMITER.idFromName(name));
  return {
    async ok(kind) {
      return (await stub.fetch(`https://limit/check?kind=${kind}`)).status === 200;
    },
    async hit(kind) {
      await stub.fetch(`https://limit/hit?kind=${kind}`, { method: 'POST' });
    },
  };
}
