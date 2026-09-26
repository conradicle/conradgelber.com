import { R, L, W, POCKETS } from './table.js';
import { BALLS, V_MAX, MAX_TIP, POWER_MAX, SPIN_MAX, G, MU_SLIDE, E_BALL } from './physics.js';

/**
 * The aim guide. It is drawn every frame while aiming, so it is plain
 * geometry and never runs the simulation: straight lines, mirror bounces
 * off the cushions, and one curve for the cue ball's path after contact.
 * It ignores every collision after the first, so it helps with the shot
 * without playing it.
 *
 *   off:    a short line from the cue ball.
 *   medium: the line to the first ball it would hit, the ghost ball there,
 *           and a short line for the object ball's direction.
 *   full:   the cue ball and the first object ball traced through up to two
 *           cushions each, with the cue ball's path after contact bent by
 *           follow or draw the way the simulation's friction would bend it.
 *
 * Returns { cue: [[x, y], ...], ghost: {x, y} | null, target: ball | -1,
 * object: [[x, y], ...], after: [[x, y], ...], pocket: index | -1 } in
 * table metres, where `pocket` is the pocket the object ball's line runs into.
 */

const OFF_LENGTH = 0.25;
const OBJECT_SHORT = 0.18;
const TRACE_LENGTH = 2.2;
const AFTER_LENGTH = 1.2;

export function aimGuide(table, level, aim, power = POWER_MAX / 2, side = 0, top = 0) {
  const x0 = table.x[0];
  const y0 = table.y[0];
  const dx = aim.x;
  const dy = aim.y;
  const out = { cue: [], ghost: null, target: -1, object: [], after: [], pocket: -1 };
  if (level === 'off') {
    out.cue = [[x0, y0], [x0 + dx * OFF_LENGTH, y0 + dy * OFF_LENGTH]];
    return out;
  }
  const hit = firstBall(table, x0, y0, dx, dy);
  const wall = railDistance(x0, y0, dx, dy);
  if (!hit || wall < hit.t) {
    // Nothing in the way before a cushion.
    if (level === 'medium') out.cue = [[x0, y0], [x0 + dx * wall, y0 + dy * wall]];
    else out.cue = trace(x0, y0, dx, dy, TRACE_LENGTH, 2).points;
    return out;
  }
  const gx = x0 + dx * hit.t;
  const gy = y0 + dy * hit.t;
  out.cue = [[x0, y0], [gx, gy]];
  out.ghost = { x: gx, y: gy };
  out.target = hit.ball;
  const ox = table.x[hit.ball];
  const oy = table.y[hit.ball];
  const nx = (ox - gx) / (2 * R);
  const ny = (oy - gy) / (2 * R);
  if (level === 'medium') {
    out.object = [[ox, oy], [ox + nx * OBJECT_SHORT, oy + ny * OBJECT_SHORT]];
    return out;
  }
  const obj = trace(ox, oy, nx, ny, TRACE_LENGTH, 2);
  out.object = obj.points;
  out.pocket = obj.pocket;
  out.after = cueAfter(gx, gy, dx, dy, nx, ny, hit.t, power, side, top);
  return out;
}

/** The nearest ball the cue ball's centre line runs into: the ghost ball distance t. */
function firstBall(table, x0, y0, dx, dy) {
  let best = null;
  for (let n = 1; n < BALLS; n++) {
    if (!table.on[n]) continue;
    const px = table.x[n] - x0;
    const py = table.y[n] - y0;
    const along = px * dx + py * dy;
    if (along <= 0) continue;
    const off2 = px * px + py * py - along * along;
    if (off2 >= 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - off2);
    if (t >= 0 && (!best || t < best.t)) best = { ball: n, t };
  }
  return best;
}

/** Distance along (dx, dy) until the ball's centre is R from a cushion line. */
function railDistance(x, y, dx, dy) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (L - R - x) / dx);
  if (dx < 0) t = Math.min(t, (R - x) / dx);
  if (dy > 0) t = Math.min(t, (W - R - y) / dy);
  if (dy < 0) t = Math.min(t, (R - y) / dy);
  return Math.max(0, t);
}

/** Is a point where the ball meets the cushion line actually a pocket mouth? */
function pocketAt(x, y) {
  for (let p = 0; p < POCKETS.length; p++) {
    const k = POCKETS[p];
    if (Math.hypot(x - k.mx, y - k.my) < k.half + R * 0.5) return p;
  }
  return -1;
}

/** A straight line with mirror bounces, stopping at a pocket, after `bounces` cushions or at `length`. */
function trace(x, y, dx, dy, length, bounces) {
  const points = [[x, y]];
  let left = length;
  for (let b = 0; ; b++) {
    const t = railDistance(x, y, dx, dy);
    if (t >= left) {
      points.push([x + dx * left, y + dy * left]);
      return { points, pocket: -1 };
    }
    x += dx * t;
    y += dy * t;
    left -= t;
    points.push([x, y]);
    const p = pocketAt(x, y);
    if (p >= 0) return { points, pocket: p };
    if (b === bounces) return { points, pocket: -1 };
    if (x <= R + 1e-9 || x >= L - R - 1e-9) dx = -dx;
    if (y <= R + 1e-9 || y >= W - R - 1e-9) dy = -dy;
  }
}

/**
 * The cue ball after contact. Its spin at contact comes from the tip offset,
 * worn down by the cloth over the distance to the object ball; after the
 * impulse along the line of centres it slides, and constant friction
 * against the slip makes the path a parabola until it rolls, then a straight
 * line, bounced off up to two cushions.
 */
function cueAfter(gx, gy, dx, dy, nx, ny, dist, power, side, top) {
  const v0 = (V_MAX * power) / POWER_MAX;
  const k = (5 * v0) / (2 * R);
  const tip = (MAX_TIP * top) / SPIN_MAX;
  // Approach: velocity and slip both lie along the aim line (side spin never slips on the cloth).
  // Slip along the aim line is v - R * spin; it shrinks 3.5 times as fast as the speed changes.
  let v = v0;
  let spin = k * tip; // rolling spin about the axis across the aim line, rad/s
  const a = MU_SLIDE * G;
  const slip0 = v - R * spin;
  if (slip0 !== 0 && v0 > 0) {
    const sgn = slip0 > 0 ? 1 : -1;
    const tRoll = Math.abs(slip0) / (3.5 * a);
    // Distance covered while sliding: v0 t - sgn a t^2 / 2. Solve for the contact time, if it comes first.
    const dRoll = v0 * tRoll - (sgn * a * tRoll * tRoll) / 2;
    let t = tRoll;
    if (dist < dRoll) {
      const disc = v0 * v0 - 2 * sgn * a * dist;
      t = disc >= 0 ? (sgn > 0 ? (v0 - Math.sqrt(disc)) / a : (-v0 + Math.sqrt(disc)) / a) : tRoll;
    }
    v = v0 - sgn * a * t;
    spin += (sgn * 2.5 * a * t) / R;
    if (t === tRoll) spin = v / R;
  } else spin = v / R;
  if (v < 0.05) v = 0.05; // A dead-slow ball still shows its line.
  // Impulse along the line of centres.
  const vn = v * (dx * nx + dy * ny);
  const j = ((1 + E_BALL) / 2) * vn;
  let vx = v * dx - j * nx;
  let vy = v * dy - j * ny;
  // Spin vector across the aim line: rolling forward along (dx, dy) is spin * (-dy, dx).
  const wx = -spin * dy;
  const wy = spin * dx;
  let sx = vx - R * wy;
  let sy = vy + R * wx;
  const s = Math.hypot(sx, sy);
  const points = [[gx, gy]];
  let x = gx;
  let y = gy;
  let travelled = 0;
  if (s > 1e-6) {
    const tRoll = s / (3.5 * a);
    const ux = sx / s;
    const uy = sy / s;
    const steps = 24;
    // Time reached along the curve; if it meets a cushion first, the straight
    // part below leaves from there with the velocity it has at that moment.
    let tEnd = tRoll;
    for (let i = 1; i <= steps; i++) {
      const t = (tRoll * i) / steps;
      const px = gx + vx * t - (a * ux * t * t) / 2;
      const py = gy + vy * t - (a * uy * t * t) / 2;
      if (px < R || px > L - R || py < R || py > W - R) {
        tEnd = (tRoll * (i - 1)) / steps;
        break;
      }
      travelled += Math.hypot(px - x, py - y);
      x = px;
      y = py;
      points.push([x, y]);
      if (travelled >= AFTER_LENGTH) return points;
    }
    vx -= a * ux * tEnd;
    vy -= a * uy * tEnd;
  }
  const m = Math.hypot(vx, vy);
  if (m < 1e-6) return points;
  const rest = trace(x, y, vx / m, vy / m, AFTER_LENGTH - travelled, 2).points;
  return points.concat(rest.slice(1));
}
