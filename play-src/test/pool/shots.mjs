// A fixed set of 200 shots for the determinism tests, built from a seed so
// every run (Node or a browser) gets the same inputs. Aim, layouts and the
// near misses are worked out here with any math; only the Sim is under test.
import { Sim, AIM_MAX, POWER_MAX, SPIN_MAX, BALLS } from '../../src/pool/engine/physics.js';
import { rack8, rack9 } from '../../src/pool/engine/rack.js';
import { R, L, W, FOOT_SPOT } from '../../src/pool/engine/table.js';
import { seededRng, unit } from '../../src/pool/engine/rng.js';

const aim = (dx, dy) => {
  const m = Math.hypot(dx, dy);
  return { ax: Math.round((dx / m) * AIM_MAX), ay: Math.round((dy / m) * AIM_MAX) };
};
const empty = () => ({ on: new Array(BALLS).fill(false), x: new Array(BALLS).fill(0), y: new Array(BALLS).fill(0) });
const clone = (s) => ({ on: [...s.on], x: [...s.x], y: [...s.y] });

/** Balls at random, none touching, each 5 mm or more off the cushions. */
function layout(rng, count) {
  const s = empty();
  const ids = [0];
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  for (let k = 0; k < count; k++) ids.push(pool.splice(Math.floor(unit(rng) * pool.length), 1)[0]);
  for (const id of ids) {
    for (;;) {
      const x = R + 0.005 + unit(rng) * (L - 2 * R - 0.01);
      const y = R + 0.005 + unit(rng) * (W - 2 * R - 0.01);
      if (ids.every((o) => !s.on[o] || Math.hypot(s.x[o] - x, s.y[o] - y) > 2 * R + 0.002)) {
        s.on[id] = true;
        s.x[id] = x;
        s.y[id] = y;
        break;
      }
    }
  }
  return s;
}

/** A shot at object ball `id` with a cut: `cut` in -0.9..0.9 of a full ball width. */
function cutShot(s, id, cut, power, side, top) {
  const dx = s.x[id] - s.x[0];
  const dy = s.y[id] - s.y[0];
  const m = Math.hypot(dx, dy);
  // Aim at a ghost-ball point offset sideways from the object ball's centre.
  const gx = s.x[id] + (-dy / m) * cut * 2 * R;
  const gy = s.y[id] + (dx / m) * cut * 2 * R;
  return { ...aim(gx - s.x[0], gy - s.y[0]), power, side, top };
}

function spinPair(rng) {
  const side = Math.round((2 * unit(rng) - 1) * 600);
  const top = Math.round((2 * unit(rng) - 1) * 600);
  return { side, top };
}

/**
 * The cue ball's path after contact runs within a millimetre of ball B
 * (`graze` false: it must not touch) or just clips it (`graze` true). Run the
 * shot without B, put B beside a point on the cue ball's path after its first
 * contact, then run it again with B and keep it only if it really happened.
 */
function nearMiss(rng, i, graze) {
  for (;;) {
    const s = layout(rng, 1);
    const id = s.on.findIndex((on, k) => on && k > 0);
    const top = i % 2 ? SPIN_MAX : -SPIN_MAX;
    const shot = cutShot(s, id, (2 * unit(rng) - 1) * 0.6, 300 + Math.round(unit(rng) * 400), 0, top);
    const sim = new Sim(s, shot);
    const path = [];
    while (!sim.done) {
      sim.step();
      if (sim.firstHit >= 0 && sim.on[0]) path.push([sim.x[0], sim.y[0]]);
    }
    if (path.length < 400) continue;
    const at = 150 + Math.floor(unit(rng) * (path.length - 300));
    const [px, py] = path[at];
    const [qx, qy] = path[at + 1];
    const m = Math.hypot(qx - px, qy - py);
    if (m === 0) continue;
    const miss = graze ? -(0.0002 + unit(rng) * 0.002) : 0.00005 + unit(rng) * 0.0009;
    const sideSign = unit(rng) < 0.5 ? -1 : 1;
    const bx = px + sideSign * (-(qy - py) / m) * (2 * R + miss);
    const by = py + sideSign * ((qx - px) / m) * (2 * R + miss);
    if (bx < R + 0.002 || bx > L - R - 0.002 || by < R + 0.002 || by > W - R - 0.002) continue;
    const t = clone(s);
    const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((k) => !t.on[k]);
    if ([0, id].some((o) => Math.hypot(bx - t.x[o], by - t.y[o]) < 2 * R + 0.01)) continue;
    t.on[b] = true;
    t.x[b] = bx;
    t.y[b] = by;
    // Check it with B on the table.
    const check = new Sim(t, shot);
    let hitB = false;
    let gap = Infinity;
    const collide = check.collideBalls.bind(check);
    check.collideBalls = (p, q) => {
      if ((p === 0 && q === b) || (q === 0 && p === b)) hitB = true;
      collide(p, q);
    };
    while (!check.done) {
      check.step();
      if (check.firstHit === id && check.on[0] && check.on[b] && !hitB) {
        gap = Math.min(gap, Math.hypot(check.x[0] - check.x[b], check.y[0] - check.y[b]) - 2 * R);
      }
    }
    if (check.firstHit !== id) continue;
    if (graze ? hitB : !hitB && gap > 0 && gap <= 0.001) return { kind: graze ? 'graze' : 'near', state: t, shot, near: b, gap };
  }
}

export function buildShots() {
  const rng = seededRng(20260925);
  const shots = [];
  // 30 breaks.
  for (let i = 0; i < 30; i++) {
    const state = i % 2 ? rack9(1000 + i) : rack8(1000 + i);
    state.y[0] = W / 2 + (2 * unit(rng) - 1) * 0.3;
    const dy = (2 * unit(rng) - 1) * 0.01;
    const { side, top } = spinPair(rng);
    shots.push({ kind: 'break', state, shot: { ...aim(FOOT_SPOT.x - state.x[0], FOOT_SPOT.y + dy - state.y[0]), power: 800 + Math.round(unit(rng) * 200), side, top } });
  }
  // 60 with the most follow or draw the tip allows.
  for (let i = 0; i < 60; i++) {
    const state = layout(rng, 3 + Math.floor(unit(rng) * 10));
    const id = state.on.findIndex((on, k) => on && k > 0);
    const top = i % 2 ? SPIN_MAX : -SPIN_MAX;
    shots.push({ kind: i % 2 ? 'max follow' : 'max draw', state, shot: cutShot(state, id, (2 * unit(rng) - 1) * 0.8, 150 + Math.round(unit(rng) * 850), 0, top) });
  }
  // 25 where the cue ball passes within a millimetre of another ball after contact, and 5 where it clips it.
  for (let i = 0; i < 30; i++) shots.push(nearMiss(rng, i, i >= 25));
  // 80 anything: random layouts, aim, power and spin.
  for (let i = 0; i < 80; i++) {
    const state = layout(rng, 1 + Math.floor(unit(rng) * 15));
    const ids = state.on.map((on, k) => (on && k > 0 ? k : -1)).filter((k) => k > 0);
    const id = ids[Math.floor(unit(rng) * ids.length)];
    const { side, top } = spinPair(rng);
    const shot = i % 8 === 7
      ? { ...aim(2 * unit(rng) - 1, 2 * unit(rng) - 1), power: Math.round(unit(rng) * POWER_MAX), side, top }
      : cutShot(state, id, (2 * unit(rng) - 1) * 0.9, 50 + Math.round(unit(rng) * 950), side, top);
    shots.push({ kind: 'random', state, shot });
  }
  return shots;
}

/** Run one shot and flatten everything that must match into numbers. */
export function outcome(SimClass, { state, shot }) {
  const sim = new SimClass(state, shot).run();
  const out = [sim.steps, sim.firstHit, sim.railAfterHit ? 1 : 0];
  for (let i = 0; i < BALLS; i++) out.push(sim.on[i] ? 1 : 0, sim.x[i], sim.y[i]);
  for (const p of sim.pocketed) out.push(p.ball, p.pocket, p.step);
  out.push(-1, ...sim.railed);
  return out;
}

/** FNV-1a over the exact bits of every number: any difference changes it. */
export function hashOutcomes(list) {
  const f = new Float64Array(1);
  const bytes = new Uint8Array(f.buffer);
  let h = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const out of list) {
    for (const n of out) {
      f[0] = n;
      for (let k = 0; k < 8; k++) {
        h = Math.imul(h ^ bytes[k], 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ bytes[k], 0x5bd1e995) >>> 0;
      }
    }
  }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
