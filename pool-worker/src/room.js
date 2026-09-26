import { DurableObject } from 'cloudflare:workers';
import { MAX_FRAME_BYTES } from '../../play-src/src/pool/engine/protocol.js';
import { RoomCore, emptyRoom } from './core.js';

const OPEN = 1;
/** Per socket; extra frames are dropped. Aim updates come about 8 a second. */
const RATE_PER_SECOND = 30;
/** A socket must create, join or resume within this long. The page does it at once. */
const UNJOINED_MS = 15_000;
/** Two players with a few tabs each. More are turned away. */
const MAX_SOCKETS = 8;

const cryptoRng = () => crypto.getRandomValues(new Uint32Array(1))[0];

/**
 * Turn a socket away with a reason the page can show. Browsers hide the HTTP
 * status of a failed upgrade, so the socket opens and closes at once with
 * close code 4429 and the reason as its text (as Cambio's Worker does).
 */
export function refuse(reason, waitUntil) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  waitUntil(
    new Promise((done) =>
      setTimeout(() => {
        try {
          server.close(4429, reason);
        } catch {
          /* already gone */
        }
        done();
      }, 50),
    ),
  );
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * One Durable Object per room, with the WebSocket Hibernation API. The
 * room's whole state is saved after every change and its next deadline (a
 * shot slice, the shot clock, a reconnect countdown, a seat's grace, idle
 * close) is the alarm, so a room survives hibernation, eviction and deploys.
 */
export class PoolRoom extends DurableObject {
  core = null;
  alarmAt = undefined;
  rate = new WeakMap();

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const snap = await ctx.storage.get('room');
      if (snap) this.core = new RoomCore(snap, this.deps());
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  deps() {
    return {
      now: () => Date.now(),
      rng: cryptoRng,
      send: (seatId, type, payload) => {
        const frame = JSON.stringify({ t: type, d: payload });
        for (const ws of this.socketsOf(seatId)) {
          try {
            ws.send(frame);
          } catch {
            /* closing */
          }
        }
      },
      isConnected: (seatId) => this.socketsOf(seatId).length > 0,
      sessionEnded: (seatId, reason) => {
        for (const ws of this.socketsOf(seatId)) {
          const a = ws.deserializeAttachment();
          try {
            ws.send(JSON.stringify({ t: 'session:ended', d: { reason } }));
          } catch {
            /* closing */
          }
          ws.serializeAttachment({ ...a, seatId: null });
          ws.close(4000, 'session ended');
        }
      },
    };
  }

  socketsOf(seatId) {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN && ws.deserializeAttachment()?.seatId === seatId);
  }

  room(code) {
    this.core ??= new RoomCore(emptyRoom(code), this.deps());
    return this.core;
  }

  unjoinedDue() {
    const due = this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.seatId === null)
      .map((a) => (a.openedAt ?? 0) + UNJOINED_MS);
    return due.length ? Math.min(...due) : null;
  }

  /** Save the snapshot and keep exactly one alarm at the next deadline. */
  async save() {
    const core = this.core;
    if (core?.isEmpty()) {
      await this.ctx.storage.deleteAll();
      this.alarmAt = undefined;
      this.core = null;
    } else if (core) {
      await this.ctx.storage.put('room', core.snapshot());
    }
    const times = [this.core?.nextAlarm() ?? null, this.unjoinedDue()].filter((t) => t !== null);
    const next = times.length ? Math.min(...times) : null;
    if (next !== this.alarmAt) {
      if (next === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(next);
      this.alarmAt = next;
    }
  }

  // ─── Requests from the Worker ───────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/exists') return new Response(null, { status: this.core && !this.core.isEmpty() ? 200 : 404 });
    const code = url.searchParams.get('room') ?? '';
    const core = this.room(code);
    if (url.pathname === '/claim') {
      const claimed = core.claim();
      await this.save();
      return new Response(null, { status: claimed ? 200 : 409 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return refuse('This room has too many connections. Try again in a moment.', (p) => this.ctx.waitUntil(p));
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, seatId: null, openedAt: Date.now() });
    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Socket events ──────────────────────────────────────────────────────

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES || !this.allow(ws)) return;
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame.t !== 'string') return;
    const att = ws.deserializeAttachment();
    const core = this.room(att.code);
    const reply = (d) => {
      if (typeof frame.a === 'number') ws.send(JSON.stringify({ t: 'ack', a: frame.a, d }));
    };
    const d = frame.d && typeof frame.d === 'object' ? frame.d : {};
    const me = att.seatId && core.seatOf(att.seatId) >= 0 ? att.seatId : null;
    const bind = (seat) => {
      ws.serializeAttachment({ ...att, seatId: seat.id });
      reply({ ok: true, session: { token: seat.token, code: core.snapshot().code } });
      core.connected(seat.id);
    };
    if (me && frame.t !== 'game:aim') core.touch();

    switch (frame.t) {
      case 'room:create':
      case 'room:join':
      case 'session:resume': {
        const r = frame.t === 'room:create' ? core.create(d) : frame.t === 'room:join' ? core.join(d) : core.resume(d);
        if (typeof r === 'string') {
          reply({ ok: false, error: r });
          return;
        }
        bind(r.seat);
        break;
      }
      case 'room:leave':
        reply({ ok: true });
        if (me) core.leave(me);
        break;
      case 'game:shot': {
        const err = me ? core.shot(me, d) : 'Not in a room.';
        reply(err ? { ok: false, error: err } : { ok: true });
        if (err) return;
        break;
      }
      case 'game:aim':
        if (me) core.aim(me, d);
        return; // nothing to save
      case 'game:rematch': {
        const err = me ? core.rematch(me) : 'Not in a room.';
        reply(err ? { ok: false, error: err } : { ok: true });
        break;
      }
      default:
        return;
    }
    await this.save();
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
    await this.closed(ws);
  }

  async webSocketError(ws) {
    await this.closed(ws);
  }

  async closed(ws) {
    const att = ws.deserializeAttachment();
    if (!att?.seatId || !this.core) return;
    this.core.disconnected(att.seatId);
    await this.save();
  }

  async alarm() {
    this.alarmAt = null;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.seatId === null && (a.openedAt ?? 0) + UNJOINED_MS <= now) ws.close(4408, 'No room joined.');
    }
    this.core?.alarm();
    await this.save();
  }

  allow(ws) {
    const now = Date.now();
    const r = this.rate.get(ws) ?? { start: now, count: 0 };
    if (now - r.start > 1000) {
      r.start = now;
      r.count = 0;
    }
    r.count += 1;
    this.rate.set(ws, r);
    return r.count <= RATE_PER_SECOND;
  }
}
