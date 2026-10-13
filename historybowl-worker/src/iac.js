// IAC regional packets, served only to the team. The packets live in the
// Workers KV namespace bound as IAC (uploaded from a git-ignored folder; see
// play-src/scripts/historybowl/import-packets.mjs), never in this public
// repo. Every request carries the team passcode in X-Team-Passcode; the
// passcode itself is a Worker secret (TEAM_PASSCODE).

import { allow, hasRoom } from './limiter.js';
import { passcodeMatches } from './passcode.js';

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function index(env) {
  return (await env.IAC.get('index', 'json')) || [];
}

async function packet(env, id) {
  if (!/^[\w.-]{1,80}$/.test(id)) return null;
  return env.IAC.get(`packet:${id}`, 'json');
}

/**
 * Handle /historybowl/api/iac/*. `json` and `fail` build responses.
 * Returns a Response.
 */
export async function handleIac(route, request, env, url, { json, fail }) {
  if (!env.IAC || !env.TEAM_PASSCODE) return fail(503, 'IAC packets are not set up yet.');
  // Wrong passcodes are limited hard, and the limit is checked before the
  // passcode, so a guess made during a lockout reveals nothing.
  if (!(await hasRoom(request, env, 'unlock'))) return fail(429, 'Too many tries. Wait a minute.');
  const ok = await passcodeMatches(request.headers.get('X-Team-Passcode'), env.TEAM_PASSCODE);
  if (!ok) {
    await allow(request, env, 'unlock');
    return fail(401, 'That passcode is not right.');
  }

  if (route === '/iac/check') {
    const list = await index(env);
    return json(200, { ok: true, packets: list.length, complete: list.filter((p) => p.complete).length });
  }
  if (route === '/iac/index') return json(200, { packets: await index(env) });
  if (route === '/iac/packet') {
    let id = url.searchParams.get('id') || '';
    if (!id) {
      // A random complete packet, avoiding the ones the page says it has used.
      const used = new Set((url.searchParams.get('not') || '').split(',').filter(Boolean));
      const list = (await index(env)).filter((p) => p.complete);
      const fresh = list.filter((p) => !used.has(p.id));
      const pick = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
      if (!pick) return fail(404, 'No complete packets yet.');
      id = pick.id;
    }
    const p = await packet(env, id);
    return p ? json(200, { packet: p }) : fail(404, 'No such packet.');
  }
  if (route === '/iac/tossups') {
    // Long tossups (second and fourth quarters) or short ones (first quarter) from a few random packets.
    const fmt = url.searchParams.get('fmt') === 'short' ? 'short' : 'long';
    const n = Math.min(12, Math.max(1, Number(url.searchParams.get('n')) || 8));
    const list = shuffle((await index(env)).slice()).slice(0, 3);
    const packets = (await Promise.all(list.map((p) => packet(env, p.id)))).filter(Boolean);
    const pool = packets.flatMap((p) => (fmt === 'short' ? p.q1 : [...p.q2.map((x) => x.tossup), ...p.q4]));
    return json(200, { tossups: shuffle(pool).slice(0, n) });
  }
  return fail(404, 'Not found');
}
