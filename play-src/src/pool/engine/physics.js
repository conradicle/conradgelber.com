import { R, L, W, SEGS, SEG_COUNT, SEG_STRIDE, POCKETS } from './table.js';

/**
 * The deterministic shot simulation, shared by the browser, the server and
 * the computer player.
 *
 * Determinism rules for everything in this file: only + - * / and Math.sqrt
 * on numbers (IEEE 754 requires those to be correctly rounded, so every
 * engine gets the same bits), loops always run in ball-number order, and
 * nothing reads the clock or a random source. Shot inputs arrive as
 * integers and are turned into floats here, the same way on every machine.
 *
 * Model: each ball has a velocity and a 3D spin. On the cloth a ball either
 * slides (the contact point slips, sliding friction acts against the slip
 * and changes both velocity and spin) or rolls (spin locked to velocity,
 * rolling friction slows it). Side spin decays on its own. Ball to ball
 * contacts are equal-mass impulses along the line of centres with a little
 * energy loss and no throw, so the cue ball keeps its spin through a hit and
 * the cloth then bends its path (follow and draw). Cushions return part of
 * the normal speed, and friction at the cushion trades side spin for
 * sideways speed, which is what English does to a rebound.
 *
 * Within each fixed step, balls move in straight lines and every collision
 * is found at its exact time (a quadratic, solved with sqrt), so a cut angle
 * does not depend on the step size.
 */

/** Fixed timestep: 1/1024 s, exact in binary. */
export const DT = 1 / 1024;
/** Longest a shot may run before everything is stopped where it is. */
export const MAX_STEPS = 40 * 1024;
/** Top cue ball speed at full power, m/s. */
export const V_MAX = 11.5;
/** Largest tip offset, as a fraction of the ball radius. */
export const MAX_TIP = 0.5;
/** Integer ranges for shot inputs. */
export const POWER_MAX = 1000;
export const SPIN_MAX = 1000;
export const AIM_MAX = 1 << 20;

export const G = 9.81;
export const MU_SLIDE = 0.2;
export const MU_ROLL = 0.024;
/** Side spin lost per second, rad/s. */
const Z_DECEL = 25;
export const E_BALL = 0.95;
const E_CUSHION = 0.8;
const MU_CUSHION = 0.2;

const D2 = 4 * R * R;
const SLIDE_DV = MU_SLIDE * G * DT;
const SLIP_DV = 3.5 * SLIDE_DV;
const ROLL_DV = MU_ROLL * G * DT;
const Z_DW = Z_DECEL * DT;
const SPIN_K = 5 / (2 * R);
/** Below this slip speed (m/s) a ball counts as rolling. */
const SLIP_EPS = 1e-6;
/** Most collisions resolved inside one step before the rest of it is skipped. */
const MAX_EVENTS = 64;
/**
 * Broad phase. A ball's total kinetic energy, moving plus spinning, never
 * rises under cloth friction (each step is proved to lose energy in the
 * comments on friction()), so the fastest it can ever travel before its next
 * contact is sqrt(v^2 + (2/5) R^2 w^2), with w its full spin. Spin can turn
 * into speed (a follow shot's cue ball stops dead at contact, then speeds up
 * again), which is why the bound uses energy and never the current speed.
 * A pair of balls whose gap is wider than both bounds can close in the time
 * left cannot touch, so it is skipped until then; the same goes for a ball
 * and the cushions. Contacts are the only thing that can raise a ball's
 * energy, so every contact clears the cached times for the balls in it.
 * Skipping only pairs that cannot collide leaves every result bit for bit
 * the same.
 */
const I_RATIO = (2 / 5) * R * R;
/** Gap shaved off (metres) and speed padding, so rounding never makes a skip unsafe. */
const SAFE_GAP = 1e-9;
const SAFE_PAD = 1 + 1e-9;
/**
 * Pairs that could come due within this long are kept on a short list that
 * every step walks; the rest are not looked at again until the earliest of
 * their safe times, or until a contact.
 */
const HORIZON = 32 * DT;

export const BALLS = 16;

/**
 * A running shot. `state` is { on: boolean[16], x: number[16], y: number[16] }
 * indexed by ball number (0 is the cue ball). `shot` is
 * { ax, ay, power, side, top }, all integers:
 *   ax, ay: aim direction, any non-zero vector with |component| <= AIM_MAX
 *   power: 0..POWER_MAX
 *   side, top: tip offset, each -SPIN_MAX..SPIN_MAX, with side^2 + top^2 <= SPIN_MAX^2;
 *     SPIN_MAX means MAX_TIP of the radius. Positive side is right English, positive top is follow.
 */
export class Sim {
  constructor(state, shot) {
    this.on = Uint8Array.from(state.on, (b) => (b ? 1 : 0));
    this.x = Float64Array.from(state.x);
    this.y = Float64Array.from(state.y);
    this.vx = new Float64Array(BALLS);
    this.vy = new Float64Array(BALLS);
    this.wx = new Float64Array(BALLS);
    this.wy = new Float64Array(BALLS);
    this.wz = new Float64Array(BALLS);
    this.moving = new Uint8Array(BALLS);
    this.steps = 0;
    this.done = false;
    /** First ball the cue ball touched, or -1. */
    this.firstHit = -1;
    /** Any ball touched a cushion after the cue ball's first contact. */
    this.railAfterHit = false;
    /** Balls that touched a cushion at any time, in order of first touch. */
    this.railed = [];
    /** Pocketed balls in the order they dropped: { ball, pocket, step }. */
    this.pocketed = [];

    const len = Math.sqrt(shot.ax * shot.ax + shot.ay * shot.ay);
    const ux = shot.ax / len;
    const uy = shot.ay / len;
    const v = (V_MAX * shot.power) / POWER_MAX;
    const top = (MAX_TIP * shot.top) / SPIN_MAX;
    const side = (MAX_TIP * shot.side) / SPIN_MAX;
    const k = SPIN_K * v;
    this.vx[0] = v * ux;
    this.vy[0] = v * uy;
    // Rolling spin for a velocity (vx, vy) is (-vy/R, vx/R); a tip at 0.4 R gives exactly that.
    this.wx[0] = -k * top * uy;
    this.wy[0] = k * top * ux;
    this.wz[0] = k * side;
    this.moving[0] = v > 0 ? 1 : 0;
    if (!this.moving[0]) this.done = true;

    /** Simulated seconds since the strike. */
    this.t = 0;
    /** Per ball: the most speed its energy allows. */
    this.bound = new Float64Array(BALLS);
    /** Per pair (i * BALLS + j, i < j): no contact possible before this time. */
    this.pairSafe = new Float64Array(BALLS * BALLS).fill(-Infinity);
    /** Per ball: no cushion contact possible before this time. */
    this.railSafe = new Float64Array(BALLS).fill(-Infinity);
    /** Pairs to check every step, in (i, j) order, and when the list must be rebuilt. */
    this.active = new Uint8Array(BALLS * BALLS);
    this.activeN = 0;
    this.rescanAt = -Infinity;
    this.rebound(0);
  }

  /** Pair safe time from the current gap and both balls' bounds. */
  pairTime(i, j, now) {
    const px = this.x[j] - this.x[i];
    const py = this.y[j] - this.y[i];
    const reach = (this.bound[i] + this.bound[j]) * SAFE_PAD;
    return reach > 0 ? now + (Math.sqrt(px * px + py * py) - 2 * R - SAFE_GAP) / reach : Infinity;
  }

  /**
   * Rebuild the list of pairs to check: every pair that could touch before
   * now + HORIZON, kept in (i, j) order so ties resolve as a full scan would.
   * The rest are safe until at least the earliest of their times, so the list
   * holds until then.
   */
  rescan(now) {
    const { on, moving, pairSafe, active } = this;
    const horizon = now + HORIZON;
    // Energy only fell since each bound was taken, so a fresh one is tighter and still safe.
    for (let i = 0; i < BALLS; i++) if (on[i] && moving[i]) this.rebound(i);
    let n = 0;
    let next = Infinity;
    for (let i = 0; i < BALLS; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < BALLS; j++) {
        if (!on[j] || (!moving[i] && !moving[j])) continue;
        const k = i * BALLS + j;
        if (pairSafe[k] < horizon) pairSafe[k] = this.pairTime(i, j, now);
        if (pairSafe[k] < horizon) active[n++] = k;
        else if (pairSafe[k] < next) next = pairSafe[k];
      }
    }
    this.activeN = n;
    this.rescanAt = next;
  }

  /** Recompute a ball's speed bound from its energy now. */
  rebound(i) {
    const { vx, vy, wx, wy, wz } = this;
    this.bound[i] = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + I_RATIO * (wx[i] * wx[i] + wy[i] * wy[i] + wz[i] * wz[i]));
  }

  /** A contact changed ball i: its bound is new and every cached time involving it is void. */
  touched(i) {
    this.rebound(i);
    this.railSafe[i] = -Infinity;
    for (let j = 0; j < BALLS; j++) {
      if (j < i) this.pairSafe[j * BALLS + i] = -Infinity;
      else if (j > i) this.pairSafe[i * BALLS + j] = -Infinity;
    }
    this.rescanAt = -Infinity;
  }

  /**
   * Everything needed to carry on later, as plain JSON (numbers survive
   * JSON exactly). The broad-phase caches are left out: they only ever skip
   * pairs that cannot touch, so rebuilding them changes no result.
   */
  save() {
    return {
      on: Array.from(this.on), x: Array.from(this.x), y: Array.from(this.y),
      vx: Array.from(this.vx), vy: Array.from(this.vy),
      wx: Array.from(this.wx), wy: Array.from(this.wy), wz: Array.from(this.wz),
      moving: Array.from(this.moving),
      steps: this.steps, t: this.t, done: this.done,
      firstHit: this.firstHit, railAfterHit: this.railAfterHit,
      railed: [...this.railed], pocketed: this.pocketed.map((p) => ({ ...p })),
    };
  }

  /** A Sim that carries on from save(). */
  static restore(saved) {
    const sim = new Sim({ on: saved.on.map(Boolean), x: saved.x, y: saved.y }, { ax: 1, ay: 0, power: 0, side: 0, top: 0 });
    for (const k of ['on', 'vx', 'vy', 'wx', 'wy', 'wz', 'moving']) sim[k].set(saved[k]);
    Object.assign(sim, {
      steps: saved.steps, t: saved.t, done: saved.done,
      firstHit: saved.firstHit, railAfterHit: saved.railAfterHit,
      railed: [...saved.railed], pocketed: saved.pocketed.map((p) => ({ ...p })),
    });
    for (let i = 0; i < BALLS; i++) sim.rebound(i);
    return sim;
  }

  /** Run to the end. Returns this. */
  run() {
    while (!this.done) this.step();
    return this;
  }

  /** Advance one fixed step. */
  step() {
    if (this.done) return;
    this.friction();
    this.advance(DT);
    this.pockets();
    this.steps++;
    let any = false;
    for (let i = 0; i < BALLS; i++) if (this.moving[i]) any = true;
    if (!any || this.steps >= MAX_STEPS) this.finish();
  }

  finish() {
    for (let i = 0; i < BALLS; i++) {
      this.vx[i] = this.vy[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
      this.moving[i] = 0;
    }
    this.done = true;
  }

  /** Where the balls are now, in the same shape as the input state. */
  state() {
    return { on: Array.from(this.on, (b) => b === 1), x: Array.from(this.x), y: Array.from(this.y) };
  }

  /**
   * One step of cloth friction. Per unit mass, with I = (2/5) R^2 and a the
   * speed change this step, a sliding step changes the energy by
   * -a s + (7/4) a^2, where s is the slip speed (the spin terms fold into s
   * because I * 5/(2R) = R). A full step has s > 3.5 a, so the change is
   * below -(7/4) a^2; a partial step has a = s / 3.5, a change of -s^2 / 7.
   * A rolling step only shrinks v and the matching spin, and side spin only
   * decays. So no step adds energy, which the broad phase relies on.
   */
  friction() {
    const { vx, vy, wx, wy, wz, moving, on } = this;
    for (let i = 0; i < BALLS; i++) {
      if (!on[i] || !moving[i]) continue;
      const sx = vx[i] - R * wy[i];
      const sy = vy[i] + R * wx[i];
      const s2 = sx * sx + sy * sy;
      if (s2 > SLIP_EPS * SLIP_EPS) {
        // Sliding: friction against the slip. The slip keeps its direction and
        // shrinks 3.5 times as fast as the velocity changes.
        const s = Math.sqrt(s2);
        const frac = s <= SLIP_DV ? s / SLIP_DV : 1;
        const a = SLIDE_DV * frac;
        const fx = sx / s;
        const fy = sy / s;
        vx[i] -= a * fx;
        vy[i] -= a * fy;
        wx[i] -= SPIN_K * a * fy;
        wy[i] += SPIN_K * a * fx;
        if (frac < 1) {
          wx[i] = -vy[i] / R;
          wy[i] = vx[i] / R;
        }
      } else {
        const v2 = vx[i] * vx[i] + vy[i] * vy[i];
        if (v2 <= ROLL_DV * ROLL_DV) {
          vx[i] = vy[i] = wx[i] = wy[i] = 0;
        } else {
          const v = Math.sqrt(v2);
          const f = (v - ROLL_DV) / v;
          vx[i] *= f;
          vy[i] *= f;
          wx[i] = -vy[i] / R;
          wy[i] = vx[i] / R;
        }
      }
      if (wz[i] > Z_DW) wz[i] -= Z_DW;
      else if (wz[i] < -Z_DW) wz[i] += Z_DW;
      else wz[i] = 0;
      if (vx[i] === 0 && vy[i] === 0 && wx[i] === 0 && wy[i] === 0) {
        wz[i] = 0;
        moving[i] = 0;
      }
    }
  }

  /** Move every ball through `dt`, stopping at each collision on the way. */
  advance(dt) {
    let left = dt;
    let now = this.t;
    for (let n = 0; n < MAX_EVENTS; n++) {
      const hit = this.nextEvent(left, now);
      if (hit === null) break;
      this.move(this.evT);
      left -= this.evT;
      now += this.evT;
      if (hit === 0) this.collideBalls(this.evA, this.evB);
      else this.collideCushion(this.evA, this.evNx, this.evNy);
    }
    this.move(left);
    this.t += dt;
  }

  move(t) {
    if (t <= 0) return;
    for (let i = 0; i < BALLS; i++) {
      if (!this.moving[i]) continue;
      this.x[i] += this.vx[i] * t;
      this.y[i] += this.vy[i] * t;
    }
  }

  /**
   * The earliest collision within `limit` seconds. Returns 0 for two balls,
   * 1 for a ball and a cushion, null for none; details go in this.ev*.
   * Ties go to the first found, which the fixed loop order makes the same everywhere.
   */
  nextEvent(limit, now) {
    const { x, y, vx, vy, on, moving, bound, pairSafe, railSafe } = this;
    let best = limit;
    let kind = null;
    // Every pair left off the list is safe past now + limit, so it cannot be the next event.
    if (now + limit > this.rescanAt) this.rescan(now);
    const { active, activeN } = this;
    for (let n = 0; n < activeN; n++) {
      // Pair index is i * BALLS + j with BALLS = 16.
      const k = active[n];
      const i = k >> 4;
      const j = k & 15;
      if (!on[i] || !on[j] || (!moving[i] && !moving[j])) continue;
      if (pairSafe[k] >= now + best) continue;
      pairSafe[k] = this.pairTime(i, j, now);
      if (pairSafe[k] >= now + best) continue;
      const px = x[j] - x[i];
      const py = y[j] - y[i];
      const qx = vx[j] - vx[i];
      const qy = vy[j] - vy[i];
      const b = px * qx + py * qy;
      if (b >= 0) continue; // not closing
      const c = px * px + py * py - D2;
      let t;
      if (c <= 0) t = 0;
      else {
        const a = qx * qx + qy * qy;
        // Gap squared minus 4R^2 is f(t) = a t^2 + 2 b t + c. If f still falls at
        // `best` and is still positive there, there is no contact before it.
        if (-b >= a * best && a * best * best + 2 * b * best + c > 0) continue;
        const disc = b * b - a * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / a;
      }
      if (t < best) {
        best = t;
        kind = 0;
        this.evA = i;
        this.evB = j;
      }
    }
    for (let i = 0; i < BALLS; i++) {
      if (!on[i] || !moving[i]) continue;
      const bx = x[i];
      const by = y[i];
      if (railSafe[i] >= now + best) continue;
      // Every cushion face and jaw lies on or outside the rectangle of the
      // cushion lines, so the distance to that rectangle is a safe gap.
      let edge = bx;
      if (L - bx < edge) edge = L - bx;
      if (by < edge) edge = by;
      if (W - by < edge) edge = W - by;
      const reach = bound[i] * SAFE_PAD;
      railSafe[i] = reach > 0 ? now + (edge - R - SAFE_GAP) / reach : Infinity;
      if (railSafe[i] >= now + best) continue;
      const ux = vx[i];
      const uy = vy[i];
      for (let s = 0; s < SEG_COUNT; s++) {
        const o = s * SEG_STRIDE;
        const ax = SEGS[o];
        const ay = SEGS[o + 1];
        const ex = SEGS[o + 4];
        const ey = SEGS[o + 5];
        const nx = SEGS[o + 6];
        const ny = SEGS[o + 7];
        const len = SEGS[o + 8];
        // The face: distance to the line reaches R while the contact lies on the segment.
        const d = (bx - ax) * nx + (by - ay) * ny;
        const vn = ux * nx + uy * ny;
        const sign = d >= 0 ? 1 : -1;
        const dd = d * sign;
        const vv = vn * sign;
        if (vv < 0) {
          const t = dd <= R ? 0 : (dd - R) / -vv;
          if (t < best) {
            const along = (bx + ux * t - ax) * ex + (by + uy * t - ay) * ey;
            if (along >= 0 && along <= len) {
              best = t;
              kind = 1;
              this.evA = i;
              this.evNx = nx * sign;
              this.evNy = ny * sign;
              continue;
            }
          }
        }
        // The two ends: a point the ball's centre must stay R away from.
        for (let e = 0; e < 2; e++) {
          const cx = SEGS[o + 2 * e];
          const cy = SEGS[o + 2 * e + 1];
          const px = bx - cx;
          const py = by - cy;
          const b = px * ux + py * uy;
          if (b >= 0) continue;
          const c = px * px + py * py - R * R;
          let t;
          if (c <= 0) t = 0;
          else {
            const a = ux * ux + uy * uy;
            const disc = b * b - a * c;
            if (disc < 0) continue;
            t = (-b - Math.sqrt(disc)) / a;
          }
          if (t < best) {
            const pxt = px + ux * t;
            const pyt = py + uy * t;
            const m = Math.sqrt(pxt * pxt + pyt * pyt);
            best = t;
            kind = 1;
            this.evA = i;
            this.evNx = pxt / m;
            this.evNy = pyt / m;
          }
        }
      }
    }
    this.evT = best;
    return kind;
  }

  collideBalls(i, j) {
    const { x, y, vx, vy } = this;
    const px = x[j] - x[i];
    const py = y[j] - y[i];
    const m = Math.sqrt(px * px + py * py);
    const nx = px / m;
    const ny = py / m;
    const closing = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
    if (closing <= 0) return;
    const J = ((1 + E_BALL) / 2) * closing;
    vx[i] -= J * nx;
    vy[i] -= J * ny;
    vx[j] += J * nx;
    vy[j] += J * ny;
    this.moving[i] = 1;
    this.moving[j] = 1;
    this.touched(i);
    this.touched(j);
    if (this.firstHit < 0 && (i === 0 || j === 0)) this.firstHit = i === 0 ? j : i;
  }

  /** (nx, ny) points from the cushion to the ball centre. */
  collideCushion(i, nx, ny) {
    const { vx, vy, wz } = this;
    const vn = vx[i] * nx + vy[i] * ny;
    if (vn >= 0) return;
    // Tangent is z cross n; the contact point's slip along it is v.t - R wz.
    const tx = -ny;
    const ty = nx;
    const slip = vx[i] * tx + vy[i] * ty - R * wz[i];
    const jn = (1 + E_CUSHION) * -vn;
    let jt = (-2 * slip) / 7;
    const cap = MU_CUSHION * jn;
    if (jt > cap) jt = cap;
    else if (jt < -cap) jt = -cap;
    vx[i] += jn * nx + jt * tx;
    vy[i] += jn * ny + jt * ty;
    wz[i] -= SPIN_K * jt;
    this.touched(i);
    if (this.firstHit >= 0) this.railAfterHit = true;
    if (!this.railed.includes(i)) this.railed.push(i);
  }

  pockets() {
    const { x, y, on, moving } = this;
    for (let i = 0; i < BALLS; i++) {
      // A ball at rest was checked on the step it last moved.
      if (!on[i] || !moving[i]) continue;
      const bx = x[i];
      const by = y[i];
      if (bx > R && bx < L - R && by > R && by < W - R) continue;
      for (let p = 0; p < POCKETS.length; p++) {
        const k = POCKETS[p];
        const rx = bx - k.mx;
        const ry = by - k.my;
        const depth = rx * k.ox + ry * k.oy;
        const lateral = ry * k.ox - rx * k.oy;
        if (depth > k.drop && lateral < k.half && lateral > -k.half) {
          on[i] = 0;
          this.moving[i] = 0;
          this.vx[i] = this.vy[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
          this.pocketed.push({ ball: i, pocket: p, step: this.steps });
          break;
        }
      }
    }
  }
}
