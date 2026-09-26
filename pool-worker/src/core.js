import { Sim, AIM_MAX } from '../../play-src/src/pool/engine/physics.js';
import { newGame, checkInput, applyResult, tableForShot, timeout, forfeit } from '../../play-src/src/pool/engine/rules.js';
import { SHOT_CLOCK_MS, RECONNECT_MS, PLAYBACK, cleanName, ENGINE_VERSION } from '../../play-src/src/pool/engine/protocol.js';

/**
 * One pool room, independent of the runtime. The Durable Object owns the
 * sockets, storage and alarm; this owns the seats, the game, the shot clock
 * and the shot in progress. Its whole state is `snapshot()`, saved after
 * every change, so the object may hibernate or be evicted between any two
 * calls. `nextAlarm()` is the one time it next needs to wake.
 *
 * A shot is simulated in slices: the first when it arrives, the rest in
 * alarms, each invocation with its own CPU allowance. The half-run shot is
 * part of the snapshot, so eviction mid-shot only means picking it up again.
 */

/** Steps in the first slice (cold code runs slowly) and in each one after. */
export const FIRST_SLICE = 256;
export const SLICE = 1024;
/** A new code is kept for its creator this long even with nobody in the room. */
const CLAIM_MS = 60_000;
/** Idle rooms close after this long without a move. */
export const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
/** A little over the animation, so the clock starts once both screens are still. */
const SETTLE_MS = 600;

export function emptyRoom(code) {
  return { v: 1, code, seats: [], settings: null, game: null, claimedUntil: null, lastActiveAt: null };
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export class RoomCore {
  /**
   * deps: now(), rng() (uint32), send(seatId, type, payload), isConnected(seatId),
   * sessionEnded(seatId, reason).
   */
  constructor(snapshot, deps) {
    this.s = snapshot;
    this.d = deps;
    this.s.lastActiveAt ??= deps.now();
  }

  snapshot() {
    return this.s;
  }

  isEmpty() {
    return this.s.seats.length === 0 && !(this.s.claimedUntil && this.s.claimedUntil > this.d.now());
  }

  claim() {
    if (this.s.seats.length || (this.s.claimedUntil && this.s.claimedUntil > this.d.now())) return false;
    this.s.claimedUntil = this.d.now() + CLAIM_MS;
    return true;
  }

  touch() {
    this.s.lastActiveAt = this.d.now();
  }

  seatOf(id) {
    return this.s.seats.findIndex((m) => m.id === id);
  }

  // ─── Joining ──────────────────────────────────────────────────────────

  newSeat(name) {
    const hex = () => this.d.rng().toString(16).padStart(8, '0');
    return { id: hex() + hex(), token: hex() + hex() + hex() + hex(), name, graceUntil: null };
  }

  create({ name, game, guide, v }) {
    if (v !== ENGINE_VERSION) return 'Pool has been updated. Reload the page to play.';
    const clean = cleanName(name);
    if (!clean) return 'Enter a name.';
    if (!['8', '9'].includes(String(game)) || !['off', 'medium', 'full'].includes(guide)) return 'Pick a game and an aim guide.';
    if (this.s.seats.length) return 'That room is already in use. Start a new one.';
    const seat = this.newSeat(clean);
    this.s.seats.push(seat);
    this.s.settings = { game: Number(game), guide };
    this.s.claimedUntil = null;
    return { seat };
  }

  join({ name, v }) {
    if (v !== ENGINE_VERSION) return 'Pool has been updated. Reload the page to play.';
    const clean = cleanName(name);
    if (!clean) return 'Enter a name.';
    if (!this.s.settings || this.s.seats.length === 0) return 'There is no room with that code.';
    if (this.s.seats.length >= 2) return 'That room is full.';
    const seat = this.newSeat(clean);
    this.s.seats.push(seat);
    this.startGame(0);
    return { seat };
  }

  resume({ token, v }) {
    if (v !== ENGINE_VERSION) return 'Pool has been updated. Reload the page to play.';
    const seat = this.s.seats.find((m) => m.token === token);
    return seat ? { seat } : 'That game is over or the seat has gone.';
  }

  /** A seat's socket is now open. */
  connected(id) {
    const i = this.seatOf(id);
    if (i < 0) return;
    this.s.seats[i].graceUntil = null;
    const g = this.s.game;
    if (g && g.waiting && g.waiting.player === i) {
      // Back in time: the clock carries on from where it stopped.
      g.waiting = null;
      if (g.clock.left != null && !g.pending && g.state.phase !== 'over') g.clock = { endsAt: this.d.now() + g.clock.left, left: null };
    }
    this.broadcastRoom();
    this.sendGame(i);
    if (g) this.broadcastGame(i);
  }

  /** A seat's last socket closed. */
  disconnected(id) {
    const i = this.seatOf(id);
    if (i < 0 || this.d.isConnected(id)) return;
    const now = this.d.now();
    const seat = this.s.seats[i];
    const g = this.s.game;
    if (g && g.state.phase !== 'over') {
      if (!g.waiting) {
        // Freeze the table and the clock until they come back or time runs out.
        g.waiting = { player: i, endsAt: now + RECONNECT_MS };
        if (g.clock.endsAt != null) g.clock = { endsAt: null, left: Math.max(0, g.clock.endsAt - now) };
      }
      seat.graceUntil = null;
    } else seat.graceUntil = now + RECONNECT_MS;
    this.broadcastRoom();
    this.broadcastGame();
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i < 0) return;
    // Taken now: once the seat is gone, index i belongs to the player who stayed.
    const name = this.s.seats[i].name;
    const g = this.s.game;
    const forfeited = !!(g && g.state.phase !== 'over' && this.s.seats.length === 2);
    if (forfeited) {
      g.state = forfeit(g.state, i, 'left');
      g.seq++;
      g.pending = null;
      g.waiting = null;
      g.clock = { endsAt: null, left: null };
      this.sendResultToAll();
    }
    this.s.seats.splice(i, 1);
    this.d.sessionEnded(id, 'left');
    if (this.s.seats.length) {
      this.s.game = null;
      // A forfeit already told them, and says they won; otherwise say who went.
      if (!forfeited) this.d.send(this.s.seats[0].id, 'toast', { message: `${name} left the room.` });
      this.broadcastRoom();
    }
  }

  // ─── The game ─────────────────────────────────────────────────────────

  startGame(breaker) {
    const { game, guide } = this.s.settings;
    const seed = this.d.rng();
    this.s.game = {
      state: newGame({ game, guide, seed, breaker }),
      names: this.s.seats.map((m) => m.name),
      seq: 0,
      breaker,
      clock: { endsAt: this.d.now() + SHOT_CLOCK_MS, left: null },
      pending: null,
      waiting: null,
      rematch: [false, false],
    };
    this.broadcastRoom();
    this.broadcastGame();
  }

  /** A shot from seat `id`: { seq, input }. Returns an error message or null. */
  shot(id, payload) {
    const i = this.seatOf(id);
    const g = this.s.game;
    if (i < 0 || !g) return 'There is no game in this room.';
    if (g.state.phase === 'over') return 'The game is over.';
    if (g.waiting) return 'Waiting for the other player to reconnect.';
    if (g.pending) return 'A shot is already on the table.';
    if (!payload || payload.seq !== g.seq) return 'That shot was for an earlier turn.';
    const input = sanitize(payload.input);
    if (!input) return 'Bad shot.';
    const err = checkInput(g.state, i, input);
    if (err) return err;
    g.clock = { endsAt: null, left: null };
    const sim = new Sim(tableForShot(g.state, input), input.shot);
    g.pending = { seq: g.seq, input, at: this.d.now(), sim: null };
    this.sendOther(i, 'game:shot', { seq: g.seq, input, shooter: i });
    this.runSlice(sim, FIRST_SLICE);
    return null;
  }

  /** Run part of the pending shot; finish it, or save it to carry on at the next alarm. */
  runSlice(sim, steps) {
    const g = this.s.game;
    for (let n = 0; n < steps && !sim.done; n++) sim.step();
    if (!sim.done) {
      g.pending.sim = sim.save();
      return;
    }
    const p = g.pending;
    g.state = applyResult(g.state, p.input, sim);
    g.seq++;
    g.pending = null;
    if (g.state.phase === 'over') g.clock = { endsAt: null, left: null };
    else {
      // The next shot's clock starts once the animation has played out on both screens.
      const anim = (sim.steps / 1024 / PLAYBACK) * 1000;
      g.clock = { endsAt: p.at + anim + SETTLE_MS + SHOT_CLOCK_MS, left: null };
      if (g.waiting) g.clock = { endsAt: null, left: SHOT_CLOCK_MS };
    }
    this.sendResultToAll();
  }

  /** Live aim for the watcher: relayed as is, after a shape check. */
  aim(id, a) {
    const i = this.seatOf(id);
    const g = this.s.game;
    if (i < 0 || !g || g.state.turn !== i || g.pending || g.state.phase === 'over' || !a) return;
    if (!isInt(a.ax, -AIM_MAX, AIM_MAX) || !isInt(a.ay, -AIM_MAX, AIM_MAX) || !isInt(a.power, 0, 100)) return;
    const place = a.place && isInt(a.place.x, 0, 30000) && isInt(a.place.y, 0, 30000) ? { x: a.place.x, y: a.place.y } : null;
    const call = isInt(a.call, 0, 5) ? a.call : null;
    this.sendOther(i, 'game:aim', { ax: a.ax, ay: a.ay, power: a.power, place, call });
  }

  rematch(id) {
    const i = this.seatOf(id);
    const g = this.s.game;
    if (i < 0 || this.s.seats.length < 2) return 'The other player has left.';
    if (!g || g.state.phase !== 'over') return 'Finish this game first.';
    g.rematch[i] = true;
    if (g.rematch[0] && g.rematch[1]) this.startGame(1 - g.breaker);
    else {
      this.broadcastRoom();
      this.d.send(this.s.seats[1 - i].id, 'toast', { message: `${this.s.seats[i].name} wants a rematch.` });
    }
    return null;
  }

  // ─── Time ─────────────────────────────────────────────────────────────

  nextAlarm() {
    const times = [];
    const g = this.s.game;
    if (g) {
      if (g.pending) times.push(this.d.now());
      if (g.waiting) times.push(g.waiting.endsAt);
      else if (g.clock.endsAt != null && g.state.phase !== 'over') times.push(g.clock.endsAt);
    }
    for (const m of this.s.seats) if (m.graceUntil) times.push(m.graceUntil);
    if (this.s.claimedUntil) times.push(this.s.claimedUntil);
    if (this.s.seats.length) times.push((this.s.lastActiveAt ?? this.d.now()) + ROOM_IDLE_MS);
    return times.length ? Math.min(...times) : null;
  }

  alarm() {
    const now = this.d.now();
    const g = this.s.game;
    if (g?.pending) {
      // Carry on with the shot in progress.
      const sim = Sim.restore(g.pending.sim);
      this.runSlice(sim, SLICE);
      return;
    }
    if (g && g.waiting && g.waiting.endsAt <= now) {
      // They did not come back: the player who stayed wins.
      const gone = g.waiting.player;
      g.state = forfeit(g.state, gone, 'forfeit');
      g.seq++;
      g.waiting = null;
      g.clock = { endsAt: null, left: null };
      this.sendResultToAll();
      const seat = this.s.seats[gone];
      if (seat) seat.graceUntil = now + RECONNECT_MS;
    } else if (g && !g.waiting && g.clock.endsAt != null && g.clock.endsAt <= now && g.state.phase !== 'over') {
      g.state = timeout(g.state);
      g.seq++;
      g.clock = { endsAt: now + SHOT_CLOCK_MS, left: null };
      this.sendResultToAll();
    }
    for (const m of [...this.s.seats]) {
      if (m.graceUntil && m.graceUntil <= now && !this.d.isConnected(m.id)) {
        this.s.seats.splice(this.s.seats.indexOf(m), 1);
        this.d.sessionEnded(m.id, 'disconnected');
        if (this.s.game) this.s.game = null;
        this.broadcastRoom();
      }
    }
    if (this.s.claimedUntil && this.s.claimedUntil <= now) this.s.claimedUntil = null;
    if (this.s.seats.length && (this.s.lastActiveAt ?? now) + ROOM_IDLE_MS <= now) {
      for (const m of this.s.seats) this.d.sessionEnded(m.id, 'idle');
      this.s.seats = [];
      this.s.game = null;
    }
  }

  // ─── Messages ─────────────────────────────────────────────────────────

  roomView(i) {
    return {
      code: this.s.code,
      me: i,
      players: this.s.seats.map((m) => ({ name: m.name, connected: this.d.isConnected(m.id) })),
      status: this.s.game ? 'playing' : 'waiting',
      rematch: this.s.game?.rematch ?? [false, false],
    };
  }

  clockView() {
    const g = this.s.game;
    if (!g || g.state.phase === 'over') return null;
    if (g.clock.endsAt != null) return { running: true, left: Math.max(0, g.clock.endsAt - this.d.now()) };
    if (g.clock.left != null) return { running: false, left: g.clock.left };
    return null;
  }

  gameView(i) {
    const g = this.s.game;
    return {
      me: i,
      names: g.names,
      seq: g.seq,
      state: g.state,
      clock: this.clockView(),
      waiting: g.waiting ? { player: g.waiting.player, left: Math.max(0, g.waiting.endsAt - this.d.now()) } : null,
      pending: g.pending ? { seq: g.pending.seq, input: g.pending.input, shooter: g.state.turn } : null,
    };
  }

  broadcastRoom() {
    this.s.seats.forEach((m, i) => this.d.send(m.id, 'room:state', this.roomView(i)));
  }

  sendGame(i) {
    if (this.s.game && this.s.seats[i]) this.d.send(this.s.seats[i].id, 'game:state', this.gameView(i));
  }

  /** Full game state to everyone except `skip`. */
  broadcastGame(skip = -1) {
    this.s.seats.forEach((_, i) => {
      if (i !== skip) this.sendGame(i);
    });
  }

  sendOther(i, type, payload) {
    const other = this.s.seats[1 - i];
    if (other) this.d.send(other.id, type, payload);
  }

  sendResultToAll() {
    const g = this.s.game;
    const view = { seq: g.seq - 1, state: g.state, clock: this.clockView() };
    for (const m of this.s.seats) this.d.send(m.id, 'game:result', view);
  }
}

/** Keep only the fields a shot may have, with integer checks left to checkInput. */
function sanitize(input) {
  if (!input || typeof input !== 'object' || !input.shot || typeof input.shot !== 'object') return null;
  const { ax, ay, power, side, top } = input.shot;
  const out = { shot: { ax, ay, power, side, top } };
  if (input.place != null) {
    if (typeof input.place !== 'object') return null;
    out.place = { x: input.place.x, y: input.place.y };
  }
  if (input.call != null) out.call = input.call;
  return out;
}
