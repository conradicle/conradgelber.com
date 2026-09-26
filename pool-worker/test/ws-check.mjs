// End-to-end check of a running pool Worker over real WebSockets.
//   node test/ws-check.mjs http://localhost:8797
//   node test/ws-check.mjs https://conradgelber.com
// Exits non-zero on any failure. The last check trips the per-IP limit on
// wrong room codes, so this address is turned away for a minute after it.
import WebSocket from 'ws';
import { ENGINE_VERSION } from '../../play-src/src/pool/engine/protocol.js';
import { AIM_MAX } from '../../play-src/src/pool/engine/physics.js';

const base = new URL(process.argv[2] ?? 'http://localhost:8797');
const origin = base.origin;
const wsBase = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/pool/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) failed++;
};

class Client {
  constructor() {
    this.frames = [];
    this.acks = new Map();
    this.seq = 0;
  }
  open(query, o = origin) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsBase + query, { headers: { Origin: o } });
      this.ws.on('open', resolve);
      this.ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.on('error', reject);
      this.ws.on('close', (code, reason) => {
        this.closed = { code, reason: String(reason) };
      });
      this.ws.on('message', (raw) => {
        const f = JSON.parse(String(raw));
        if (f.t === 'ack') this.acks.get(f.a)?.(f.d);
        else this.frames.push(f);
      });
    });
  }
  req(t, d) {
    const a = ++this.seq;
    return new Promise((resolve) => {
      this.acks.set(a, resolve);
      this.ws.send(JSON.stringify({ t, d, a }));
    });
  }
  async next(t, pred = () => true, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.frames.findIndex((f) => f.t === t && pred(f.d));
      if (i >= 0) return this.frames.splice(i, 1)[0].d;
      await sleep(20);
    }
    return null;
  }
  close() {
    this.ws?.close();
  }
}

// ─── Plain HTTP ───────────────────────────────────────────────────────────

{
  const page = await fetch(new URL('/pool/', base));
  const csp = page.headers.get('content-security-policy') ?? '';
  if (base.hostname === 'localhost' || base.hostname === '127.0.0.1') {
    check('the page is served with the site CSP', page.status === 200 && csp.includes("connect-src 'self'") && csp.includes("script-src 'self'"), csp.slice(0, 60));
  }
  const notWs = await fetch(new URL('/pool/ws?room=KSJGZZ', base));
  check('the socket path answers plain requests with 426', notWs.status === 426, String(notWs.status));
  check('responses from the Worker carry nosniff and a CSP', notWs.headers.get('x-content-type-options') === 'nosniff' && !!notWs.headers.get('content-security-policy'));
}

// ─── Origin, codes ────────────────────────────────────────────────────────

{
  const c = new Client();
  let err = null;
  try {
    await c.open('?create=1', 'https://evil.example');
  } catch (e) {
    err = e.message;
  }
  check('a socket from another origin is refused', err === 'HTTP 403', err ?? 'opened');
  c.close();
}
{
  const c = new Client();
  let err = null;
  try {
    await c.open('?room=nope');
  } catch (e) {
    err = e.message;
  }
  check('a malformed room code is refused', err === 'HTTP 400', err ?? 'opened');
  c.close();
}

// ─── A game ───────────────────────────────────────────────────────────────

const ana = new Client();
await ana.open('?create=1');
const made = await ana.req('room:create', { name: 'Ana', game: '9', guide: 'full', v: ENGINE_VERSION });
check('create a room', made.ok && /^[ACFGHJKLQRSTUWXYZ]{6}$/.test(made.session.code), made.session?.code ?? made.error);
const code = made.session.code;

const old = new Client();
await old.open(`?room=${code}`);
const oldJoin = await old.req('room:join', { name: 'Old', v: 'stale' });
check('a page from another engine version is refused', !oldJoin.ok && /updated/.test(oldJoin.error), oldJoin.error);
old.close();

const ben = new Client();
await ben.open(`?room=${code.toLowerCase()}`);
const joined = await ben.req('room:join', { name: 'Ben', v: ENGINE_VERSION });
check('join with the code, in any case', joined.ok);
const aState = await ana.next('game:state');
const bState = await ben.next('game:state');
check('both players get the game, and it starts at once', aState?.state.phase === 'break' && bState?.me === 1 && aState?.me === 0, JSON.stringify(aState?.names));
check('the shot clock is running', aState?.clock?.running === true && aState.clock.left > 55_000);

const cy = new Client();
await cy.open(`?room=${code}`);
const full = await cy.req('room:join', { name: 'Cy', v: ENGINE_VERSION });
check('a third player is refused', !full.ok && full.error === 'That room is full.', full.error);
cy.close();

const shot = { shot: { ax: AIM_MAX, ay: 0, power: 1000, side: 0, top: -200 } };
const wrongTurn = await ben.req('game:shot', { seq: 0, input: shot });
check('the wrong player cannot shoot', !wrongTurn.ok && wrongTurn.error === 'It is not your turn.', wrongTurn.error);
const badInput = await ana.req('game:shot', { seq: 0, input: { shot: { ...shot.shot, power: 5000 } } });
check('out-of-range power is refused', !badInput.ok && badInput.error === 'Bad power.', badInput.error);
const oldSeq = await ana.req('game:shot', { seq: 7, input: shot });
check('a shot for another turn is refused', !oldSeq.ok, oldSeq.error);

const t0 = Date.now();
const took = await ana.req('game:shot', { seq: 0, input: shot });
check('the break is accepted', took.ok, took.error);
const watched = await ben.next('game:shot');
check('the other player gets the shot straight away', watched?.seq === 0 && watched.shooter === 0 && JSON.stringify(watched.input) === JSON.stringify(shot));
const ra = await ana.next('game:result');
const rb = await ben.next('game:result');
check('both get the result', !!ra && !!rb, `${Date.now() - t0} ms, sliced over alarms`);
check('the results are identical', JSON.stringify(ra?.state) === JSON.stringify(rb?.state));
check('the turn moved on', ra?.seq === 0 && (ra.state.turn === 0 || ra.state.turn === 1) && ra.state.phase !== 'break');

// ─── Leaving ──────────────────────────────────────────────────────────────

if (ra && ra.state.phase === 'play') {
  const left = await ben.req('room:leave');
  check('leave the room', left.ok);
  const forfeit = await ana.next('game:result', (d) => d.state.phase === 'over');
  check('leaving mid-game hands the win to the player who stayed', forfeit?.state.winner === 0 && forfeit.state.last.win.reason === 'left');
}
ana.close();
ben.close();

// ─── Rate limit on wrong codes (last: it locks this address out for a minute) ─

{
  let refused = null;
  for (let i = 0; i < 12 && !refused; i++) {
    const c = new Client();
    try {
      await c.open('?room=ZZZZZZ');
      await sleep(150);
      if (c.closed?.code === 4429) refused = c.closed.reason;
    } catch {
      /* ignore */
    }
    c.close();
  }
  check('guessing codes is cut off after a few misses', !!refused, refused ?? 'never refused');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
