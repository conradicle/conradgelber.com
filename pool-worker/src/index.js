import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, WS_PATH, cleanCode, isAllowedRoomCode } from '../../play-src/src/pool/engine/protocol.js';
import { limiterFor } from './limiter.js';
import { refuse } from './room.js';

export { PoolRoom } from './room.js';
export { Limiter } from './limiter.js';

/**
 * The pool Worker is routed only at conradgelber.com/pool/ws: the page
 * itself is the Pages site. Sockets are /pool/ws?room=CODE, or
 * /pool/ws?create=1 to be issued a fresh code. Room flow, codes and rate
 * limits follow Cambio's Worker.
 *
 * Nothing secret belongs in this folder: Pages serves the repo as it is.
 */

// Responses from code carry the same baseline headers as the site.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
const plain = (status, body) =>
  new Response(body, { status, headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

function newCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(ROOM_CODE_LENGTH));
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

/** Same-origin only (plus any dev origins): blocks other sites from opening sockets as a visitor. */
function originAllowed(request, url, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  if (origin === url.origin) return true;
  return (env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

export default {
  async fetch(request, env, ctx) {
    const later = (p) => ctx.waitUntil(p);
    const url = new URL(request.url);
    if (url.pathname !== WS_PATH) {
      // Only in local dev, where the site's files are served alongside.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return plain(404, 'Not found');
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return plain(426, 'Expected a WebSocket');
    if (!originAllowed(request, url, env)) return plain(403, 'Forbidden');

    let code = cleanCode(url.searchParams.get('room'));
    if (url.searchParams.has('create')) {
      const limits = await limiterFor(request, env);
      if (!(await limits.ok('create'))) return refuse('Too many new rooms from here. Wait a minute and try again.', later);
      await limits.hit('create');
      code = null;
      for (let i = 0; i < 20 && !code; i++) {
        const candidate = newCode();
        if (!isAllowedRoomCode(candidate)) continue;
        const stub = env.ROOMS.get(env.ROOMS.idFromName(candidate));
        const r = await stub.fetch(`https://room/claim?room=${candidate}`, { method: 'POST' });
        if (r.status === 200) code = candidate;
      }
      if (!code) return plain(503, 'No free room code. Try again.');
    }
    if (!code) return plain(400, 'Missing room code');

    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    if (!url.searchParams.has('create')) {
      // Guessing codes: after a few sockets to codes with no room, this IP is
      // turned away for a minute, even from rooms that exist.
      const limits = await limiterFor(request, env);
      if (!(await limits.ok('miss'))) return refuse('Too many tries with room codes that do not exist. Wait a minute and try again.', later);
      const exists = (await room.fetch('https://room/exists')).status === 200;
      if (!exists) await limits.hit('miss');
    }

    const forward = new URL(request.url);
    forward.searchParams.set('room', code);
    forward.searchParams.delete('create');
    return room.fetch(new Request(forward, request));
  },
};
