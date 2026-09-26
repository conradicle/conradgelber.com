import { WS_PATH, ENGINE_VERSION, cleanCode } from './engine/protocol.js';

/**
 * The online side of the page: a plain WebSocket to the room's Durable
 * Object at /pool/ws, same-origin, so the site's connect-src 'self' covers
 * it. The link works like Cambio's (packages/client/src/link.ts): frames
 * are { t, d, a }, `a` asks for an acknowledgement, a dropped socket
 * reconnects with backoff and resumes the seat, and close code 4429 means
 * the server turned us away with a reason to show.
 *
 * The seat token lives in sessionStorage, so a refresh resumes the game in
 * the same tab; a copy in localStorage lets a reopened tab offer to rejoin.
 */

const ACK_TIMEOUT_MS = 10_000;
const REFUSED = 4429;
const SESSION_KEY = 'pool-session';

const wsUrl = (query) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}${query}`;

function storeSession(s) {
  for (const store of [sessionStorage, localStorage]) {
    try {
      if (s) store.setItem(SESSION_KEY, JSON.stringify({ ...s, at: Date.now() }));
      else store.removeItem(SESSION_KEY);
    } catch {
      /* storage blocked: the game still works, it just cannot resume */
    }
  }
}
function readSession(store) {
  try {
    const s = JSON.parse(store.getItem(SESSION_KEY) || 'null');
    return s && typeof s.token === 'string' && typeof s.code === 'string' ? s : null;
  } catch {
    return null;
  }
}

export class Online {
  constructor(h) {
    this.h = h;
    this.ws = null;
    this.query = '';
    this.wanted = false;
    this.retry = 0;
    this.retryTimer = null;
    this.seq = 0;
    this.acks = new Map();
    this.session = null;
  }

  // ─── Rooms ──────────────────────────────────────────────────────────────

  async create({ name, game, guide }) {
    await this.open('?create=1');
    const r = await this.request('room:create', { name, game, guide, v: ENGINE_VERSION });
    this.adopt(r.session);
    return r.session.code;
  }

  async join({ name, code }) {
    const clean = cleanCode(code);
    if (!clean) throw new Error('That is not a room code. Codes are six letters.');
    await this.open(`?room=${clean}`);
    const r = await this.request('room:join', { name, v: ENGINE_VERSION });
    this.adopt(r.session);
  }

  /** After a refresh: take the seat back if this tab had one. */
  async resumeIfAny() {
    const s = readSession(sessionStorage);
    if (!s) return;
    try {
      await this.open(`?room=${encodeURIComponent(s.code)}`);
      const r = await this.request('session:resume', { token: s.token, v: ENGINE_VERSION });
      this.adopt(r.session);
    } catch (e) {
      storeSession(null);
      this.close();
      this.h.onError(e.message);
    }
  }

  adopt(session) {
    this.session = session;
    this.query = `?room=${encodeURIComponent(session.code)}`;
    storeSession(session);
  }

  leave() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.emit('room:leave', {}, () => {});
    storeSession(null);
    this.session = null;
    this.close();
  }

  shoot(seq, input) {
    return this.request('game:shot', { seq, input });
  }

  aim(a) {
    this.emit('game:aim', a);
  }

  async rematch() {
    try {
      await this.request('game:rematch', {});
    } catch (e) {
      this.h.onError(e.message);
    }
  }

  // ─── Link ───────────────────────────────────────────────────────────────

  request(type, d) {
    return new Promise((resolve, reject) => {
      this.emit(type, d, (r) => (r && r.ok ? resolve(r) : reject(new Error(r?.error || 'The game server did not answer.'))));
    });
  }

  emit(type, d, ack) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ack?.({ ok: false, error: 'Not connected to the game server.' });
      return;
    }
    const frame = { t: type, d };
    if (ack) {
      const a = ++this.seq;
      frame.a = a;
      const timer = setTimeout(() => {
        this.acks.delete(a);
        ack({ ok: false, error: 'The game server did not answer.' });
      }, ACK_TIMEOUT_MS);
      this.acks.set(a, { fn: ack, timer });
    }
    ws.send(JSON.stringify(frame));
  }

  open(query) {
    this.close();
    this.query = query;
    this.wanted = true;
    return this.connect(true);
  }

  close() {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.failAcks('Disconnected.');
  }

  connect(first) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl(this.query));
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.retry = 0;
        resolve();
        if (!first && this.session) {
          // Back after a drop: take the seat again.
          this.request('session:resume', { token: this.session.token, v: ENGINE_VERSION }).catch((e) => {
            storeSession(null);
            this.session = null;
            this.close();
            this.h.onEnded(e.message);
          });
        }
      };
      ws.onmessage = (e) => {
        let f;
        try {
          f = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (f.t === 'ack') {
          const pending = this.acks.get(f.a);
          if (pending) {
            clearTimeout(pending.timer);
            this.acks.delete(f.a);
            pending.fn(f.d);
          }
          return;
        }
        this.dispatch(f.t, f.d);
      };
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (e.code === REFUSED) {
          this.wanted = false;
          this.failAcks(e.reason);
          if (!opened && first) reject(new Error(e.reason));
          else this.h.onEnded(e.reason);
          return;
        }
        this.failAcks('Disconnected.');
        if (!opened && first) {
          this.wanted = false;
          reject(new Error(location.hostname.endsWith('.pages.dev') ? 'Online play only works on conradgelber.com, where the game server lives.' : 'Could not reach the game server.'));
          return;
        }
        if (this.wanted) this.scheduleReconnect();
      };
    });
  }

  dispatch(type, d) {
    const h = this.h;
    if (type === 'room:state') h.onRoom(d);
    else if (type === 'game:state') h.onState(d);
    else if (type === 'game:shot') h.onShot(d);
    else if (type === 'game:result') h.onResult({ ...d, receivedAt: performance.now() });
    else if (type === 'game:aim') h.onAim(d);
    else if (type === 'toast') h.onError(d.message);
    else if (type === 'session:ended') {
      storeSession(null);
      this.session = null;
      this.wanted = false;
      const why = { left: 'You left the room.', kicked: 'You were removed from the room.', disconnected: 'You were away too long and lost your seat.', idle: 'The room closed after two hours without a shot.' };
      h.onEnded(why[d?.reason] || 'The room has closed.');
    }
  }

  scheduleReconnect() {
    const delay = Math.min(5000, 400 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted) this.connect(false).catch(() => this.scheduleReconnect());
    }, delay);
  }

  failAcks(error) {
    const pending = [...this.acks.values()];
    this.acks.clear();
    for (const { fn, timer } of pending) {
      clearTimeout(timer);
      fn({ ok: false, error });
    }
  }
}

/** A seat from a closed tab, recent enough to still be held for us (5 minutes). */
export function rejoinable() {
  const s = readSession(localStorage);
  return s && Date.now() - s.at < 5 * 60_000 ? s : null;
}

export function rejoin(online, s) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* fall through: resumeIfAny finds nothing */
  }
  return online.resumeIfAny();
}
