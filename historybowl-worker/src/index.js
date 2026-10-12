import { UpstreamError, checkAnswer, parseTossupQuery, tossups } from './qb.js';
import { allow } from './limiter.js';

export { Limiter } from './limiter.js';

/**
 * History Bowl Study's Worker, routed only at conradgelber.com/historybowl/api*.
 * The page itself is the Pages site.
 *
 *   GET  /historybowl/api/tossups?src=bee,qb&cats=History&subs=&level=regional&n=8
 *   POST /historybowl/api/check   {answerline, given}
 *   POST /historybowl/api/report  {qid, source, note}
 *
 * Nothing secret belongs in this folder: Pages serves the repo as it is.
 */

const API = '/historybowl/api';

// Responses from code carry the same baseline headers as the site.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error) => json(status, { error });

/** Requests from another site's pages are turned away (requests without an Origin, like curl, are rate-limited like any other). */
function originAllowed(request, url, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return request.method === 'GET';
  if (origin === url.origin) return true;
  return (env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

async function readBody(request, max) {
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

async function handleApi(request, env, url) {
  const route = url.pathname.slice(API.length);
  if (!originAllowed(request, url, env)) return fail(403, 'Forbidden');
  if (!(await allow(request, env, route === '/report' ? 'report' : 'api'))) return fail(429, 'Too many requests. Wait a minute and try again.');

  if (route === '/tossups' && request.method === 'GET') {
    const q = parseTossupQuery(url.searchParams);
    if (!q) return fail(400, 'Bad query');
    return json(200, { tossups: await tossups(q) });
  }

  if (route === '/check' && request.method === 'POST') {
    const b = await readBody(request, 8000);
    if (!b || typeof b.answerline !== 'string' || typeof b.given !== 'string' || b.answerline.length > 4000 || b.given.length > 200) return fail(400, 'Bad request');
    if (!b.given.trim()) return json(200, { directive: 'reject', directedPrompt: null });
    return json(200, await checkAnswer(b.answerline, b.given.trim()));
  }

  if (route === '/report' && request.method === 'POST') {
    const b = await readBody(request, 2000);
    if (!b || typeof b.qid !== 'string' || !/^[\w:.-]{1,80}$/.test(b.qid)) return fail(400, 'Bad request');
    const report = {
      qid: b.qid,
      source: typeof b.source === 'string' ? b.source.slice(0, 40) : '',
      note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
      at: new Date().toISOString(),
    };
    // Keyed by time so a listing reads oldest first. No IP or name is kept.
    const key = `report:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
    await env.REPORTS.put(key, JSON.stringify(report), { metadata: { qid: report.qid } });
    return json(200, { ok: true });
  }

  return fail(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API + '/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        // Seen only with `wrangler tail`; carries no player data.
        console.error('historybowl api error', url.pathname, String(e && e.stack || e));
        if (e instanceof UpstreamError) return fail(502, 'The question database did not answer. Try again in a moment.');
        return fail(500, 'Something went wrong.');
      }
    }
    // Only in local dev, where the site's files are served alongside.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
  },
};
