import { Sim, BALLS, AIM_MAX, POWER_MAX, SPIN_MAX } from './physics.js';
import { R, L, W, POCKETS, FOOT_SPOT, HEAD_STRING } from './table.js';
import { applyResult, targets, onTheEight, legalSpot, tableForShot, PLACE_SCALE } from './rules.js';
import { unit } from './rng.js';

/**
 * The computer player. It lists candidate shots (every legal object ball into
 * every pocket, with a few powers and spins, and safeties when nothing is
 * on), plays each one through the real simulation and rules, scores the
 * result, and shoots the best with some aim and power error.
 *
 * It thinks in slices so the page never freezes: `think(budget)` runs up to
 * `budget` simulation steps and returns null until it has decided, then the
 * shot input. Every random choice comes from the seeded generator in a fixed
 * order, so the same seed gives the same game however the work is sliced.
 */

export const LEVELS = {
  easy: { aimSd: 1.6, powerSd: 0.16, maxCandidates: 10, powers: [0.45], spins: [0], position: 0, safeties: false, robust: 3, pickFromTop: 3 },
  medium: { aimSd: 0.55, powerSd: 0.07, maxCandidates: 40, powers: [0.3, 0.55], spins: [0, 1, -1], position: 0.5, safeties: true, robust: 0, pickFromTop: 1 },
  hard: { aimSd: 0.14, powerSd: 0.03, maxCandidates: 140, powers: [0.22, 0.38, 0.6, 0.85], spins: [0, 1, -1, 0.5, -0.5], position: 1, safeties: true, robust: 6, pickFromTop: 1 },
};

const DEG = Math.PI / 180;
/** Largest cut the computer tries, and how steep an approach a side pocket takes. */
const MAX_CUT = 78 * DEG;
const SIDE_APPROACH = 55 * DEG;
const CORNER_APPROACH = 62 * DEG;

/** Standard normal from the seeded generator (Box-Muller; fine outside the simulation). */
function gauss(rng) {
  const u = Math.max(unit(rng), 1e-12);
  const v = unit(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const toAim = (dx, dy) => {
  const m = Math.hypot(dx, dy);
  return { ax: Math.round((dx / m) * AIM_MAX), ay: Math.round((dy / m) * AIM_MAX) };
};

/** Where to send an object ball for pocket p: the middle of the mouth. */
const pocketPoint = (p) => ({ x: POCKETS[p].mx, y: POCKETS[p].my });

/** Is the straight path from a to b clear of every ball but the ones listed, for a ball of radius R? */
function clear(table, ax, ay, bx, by, skip) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let n = 0; n < BALLS; n++) {
    if (!table.on[n] || skip.includes(n)) continue;
    const t = Math.max(0, Math.min(1, ((table.x[n] - ax) * dx + (table.y[n] - ay) * dy) / len2));
    const px = ax + t * dx - table.x[n];
    const py = ay + t * dy - table.y[n];
    if (px * px + py * py < 4 * R * R * 0.98) return false;
  }
  return true;
}

/**
 * A direct pot from cue position (cx, cy): object ball n into pocket p.
 * Returns { ghost, cut, dist, quality } or null if it is not on.
 */
export function potLine(table, cx, cy, n, p) {
  const bx = table.x[n];
  const by = table.y[n];
  const pk = pocketPoint(p);
  const tx = pk.x - bx;
  const ty = pk.y - by;
  const d2 = Math.hypot(tx, ty);
  const ux = tx / d2;
  const uy = ty / d2;
  // Approach angle into the pocket.
  const k = POCKETS[p];
  const approach = Math.acos(Math.max(-1, Math.min(1, ux * k.ox + uy * k.oy)));
  if (approach > (p === 1 || p === 4 ? SIDE_APPROACH : CORNER_APPROACH)) return null;
  const gx = bx - ux * 2 * R;
  const gy = by - uy * 2 * R;
  const cx2 = gx - cx;
  const cy2 = gy - cy;
  const d1 = Math.hypot(cx2, cy2);
  if (d1 < 1e-6) return null;
  const cut = Math.acos(Math.max(-1, Math.min(1, (cx2 * ux + cy2 * uy) / d1)));
  if (cut > MAX_CUT) return null;
  if (!clear(table, cx, cy, gx, gy, [0, n]) || !clear(table, bx, by, pk.x, pk.y, [0, n])) return null;
  const quality = (Math.cos(cut) ** 2) / (1 + 1.2 * d1 + 0.8 * d2);
  return { ghost: { x: gx, y: gy }, cut, dist: d1 + d2, quality };
}

/** How good is the best next shot for `player` in this state (0 to about 0.8)? */
export function bestShotQuality(state, player) {
  const t = state.table;
  if (state.phase === 'over') return 0;
  if (state.ballInHand) return 0.7;
  if (!t.on[0]) return 0.7;
  let want = targets(state, player);
  if (!want.length) want = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((n) => t.on[n]);
  let best = 0;
  for (const n of want) {
    if (!t.on[n]) continue;
    for (let p = 0; p < POCKETS.length; p++) {
      const line = potLine(t, t.x[0], t.y[0], n, p);
      if (line && line.quality > best) best = line.quality;
    }
  }
  return best;
}

/** Score the state after a shot, from the shooter's point of view. */
function score(before, after, shooter, cfg) {
  const r = after.last;
  if (after.phase === 'over') return after.winner === shooter ? 10000 : -10000;
  let s = 0;
  const foul = r.fouls.length > 0;
  if (foul) s -= 400;
  if (after.turn === shooter) {
    s += 300 + 40 * r.pocketed.length;
    s += cfg.position * 400 * bestShotQuality(after, shooter);
  } else {
    // The opponent's chances from here.
    s -= 250 * bestShotQuality(after, 1 - shooter);
  }
  if (before.game === 8 && after.groups) {
    const mine = after.groups[shooter];
    for (const n of r.pocketed) if (n !== 8 && (mine === 'solids' ? n > 8 : n < 8)) s -= 25;
  }
  return s;
}

/** Aim and power error for a chosen shot. */
function perturb(shot, cfg, rng) {
  const a = gauss(rng) * cfg.aimSd * DEG;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const ax = shot.ax * c - shot.ay * sn;
  const ay = shot.ax * sn + shot.ay * c;
  const power = Math.max(1, Math.min(POWER_MAX, Math.round(shot.power * (1 + gauss(rng) * cfg.powerSd))));
  return { ...shot, ...toAim(ax, ay), power };
}

function breakShot(state, cfg, rng) {
  const t = state.table;
  // The apex: the rack ball nearest the foot spot.
  let apex = 1;
  let bestD = Infinity;
  for (let n = 1; n < BALLS; n++) {
    if (!t.on[n]) continue;
    const d = Math.hypot(t.x[n] - FOOT_SPOT.x, t.y[n] - FOOT_SPOT.y);
    if (d < bestD) {
      bestD = d;
      apex = n;
    }
  }
  const input = {};
  let cx = t.x[0];
  let cy = t.y[0];
  if (state.ballInHand) {
    cx = HEAD_STRING - 0.04;
    cy = W / 2 + (unit(rng) - 0.5) * 0.12;
    input.place = { x: Math.round(cx * PLACE_SCALE), y: Math.round(cy * PLACE_SCALE) };
  }
  const power = cfg === LEVELS.easy ? 780 : 1000;
  input.shot = perturb({ ...toAim(t.x[apex] - cx, t.y[apex] - cy), power, side: 0, top: -200 }, cfg, rng);
  return input;
}

/** Candidate cue spots for ball in hand: straight behind each pot, and a little either side. */
function handSpots(state, n, p, cfg) {
  const t = state.table;
  const pk = pocketPoint(p);
  const ux = pk.x - t.x[n];
  const uy = pk.y - t.y[n];
  const m = Math.hypot(ux, uy);
  const spots = [];
  const angles = cfg.position ? [0, 18 * DEG, -18 * DEG] : [0];
  for (const a of angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = (ux * c - uy * s) / m;
    const dy = (ux * s + uy * c) / m;
    for (const back of [0.28, 0.5]) {
      const x = t.x[n] - dx * (2 * R + back);
      const y = t.y[n] - dy * (2 * R + back);
      if (legalSpot(state, x, y)) spots.push({ x, y });
    }
  }
  return spots;
}

export function createThinker(state, player, level, rng) {
  const cfg = LEVELS[level];
  if (state.phase === 'break') {
    const input = breakShot(state, cfg, rng);
    return { think: () => input, candidates: 1 };
  }
  const t = state.table;
  let want = targets(state, player);
  if (!want.length) want = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((n) => t.on[n]);
  want = want.filter((n) => t.on[n]);
  const eight = onTheEight(state, player);

  // Candidate pots.
  const pots = [];
  for (const n of want) {
    for (let p = 0; p < POCKETS.length; p++) {
      const spots = state.ballInHand || !t.on[0] ? handSpots(state, n, p, cfg) : [{ x: t.x[0], y: t.y[0], stay: true }];
      for (const spot of spots) {
        const line = potLine(t, spot.x, spot.y, n, p);
        if (line) pots.push({ n, p, spot, line });
      }
    }
  }
  pots.sort((a, b) => b.line.quality - a.line.quality);

  const list = [];
  for (const pot of pots) {
    for (const pw of cfg.powers) {
      for (const sp of cfg.spins) {
        // Longer shots need more pace; scale by distance.
        const power = Math.round(Math.min(1, pw * (0.7 + 0.5 * pot.line.dist)) * POWER_MAX);
        const input = {
          shot: { ...toAim(pot.line.ghost.x - pot.spot.x, pot.line.ghost.y - pot.spot.y), power, side: 0, top: Math.round(sp * SPIN_MAX * 0.9) },
        };
        if (!pot.spot.stay) input.place = { x: Math.round(pot.spot.x * PLACE_SCALE), y: Math.round(pot.spot.y * PLACE_SCALE) };
        if (eight) input.call = pot.p;
        list.push(input);
      }
    }
  }
  let chosenFrom = list.slice(0, cfg.maxCandidates);
  // Safeties (or, for Easy, just hitting something) when little is on.
  if (chosenFrom.length < 3) {
    const hand = state.ballInHand || !t.on[0];
    for (const n of want) {
      // With ball in hand, try spots all round the ball that have a clear line to it.
      const froms = [];
      if (!hand) froms.push({ x: t.x[0], y: t.y[0] });
      else {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const x = t.x[n] + Math.cos(a) * 0.3;
          const y = t.y[n] + Math.sin(a) * 0.3;
          if (legalSpot(state, x, y) && clear(t, x, y, t.x[n], t.y[n], [0, n])) froms.push({ x, y, placed: true });
          if (froms.length >= (cfg.safeties ? 3 : 1)) break;
        }
      }
      for (const from of froms) {
        const bx = t.x[n] - from.x;
        const by = t.y[n] - from.y;
        const m = Math.hypot(bx, by);
        const offsets = cfg.safeties ? [-0.8, -0.4, 0, 0.4, 0.8] : [0];
        for (const off of offsets) {
          // Aim at a point beside the object ball: a thin or full hit.
          const px = t.x[n] + (-by / m) * off * 2 * R;
          const py = t.y[n] + (bx / m) * off * 2 * R;
          for (const power of cfg.safeties ? [180, 320] : [400]) {
            const input = { shot: { ...toAim(px - from.x, py - from.y), power, side: 0, top: 0 } };
            if (from.placed) input.place = { x: Math.round(from.x * PLACE_SCALE), y: Math.round(from.y * PLACE_SCALE) };
            if (eight) input.call = 0;
            chosenFrom.push(input);
          }
        }
      }
    }
  }
  if (!chosenFrom.length) {
    // Nothing legal found: roll the cue ball at the first target.
    const n = want[0] ?? 1;
    const from = t.on[0] ? { x: t.x[0], y: t.y[0] } : { x: L / 4, y: W / 2 };
    const input = { shot: { ...toAim(t.x[n] - from.x, t.y[n] - from.y), power: 350, side: 0, top: 0 } };
    if (!t.on[0] || state.ballInHand) input.place = { x: Math.round(from.x * PLACE_SCALE), y: Math.round(from.y * PLACE_SCALE) };
    if (eight) input.call = 0;
    chosenFrom = [input];
  }

  // Evaluate, a slice at a time.
  const scored = [];
  let i = 0;
  let sim = null;
  let phase = 'scan';
  let robustList = [];
  let robustAt = 0;
  let decided = null;

  const runSome = (budget, input) => {
    if (!sim) sim = new Sim(tableForShot(state, input), input.shot);
    while (!sim.done && budget > 0) {
      sim.step();
      budget--;
    }
    return budget;
  };

  return {
    candidates: chosenFrom.length,
    think(budget = 4000) {
      if (decided) return decided;
      while (budget > 0) {
        if (phase === 'scan') {
          if (i >= chosenFrom.length) {
            scored.sort((a, b) => b.s - a.s);
            if (cfg.robust) {
              // Replay the best few with the aim nudged either way; prefer shots that survive a small miss.
              robustList = scored.slice(0, cfg.robust).map((c) => ({ ...c, variants: [-1, 1].map((sg) => nudge(c.input, sg * cfg.aimSd * 1.5)), total: c.s }));
              phase = 'robust';
              robustAt = 0;
              continue;
            }
            phase = 'pick';
            continue;
          }
          budget = runSome(budget, chosenFrom[i]);
          if (!sim.done) return null;
          const after = applyResult(state, chosenFrom[i], sim);
          scored.push({ input: chosenFrom[i], s: score(state, after, player, cfg) });
          sim = null;
          i++;
        } else if (phase === 'robust') {
          const flat = robustList.flatMap((c) => c.variants.map((v) => ({ c, v })));
          if (robustAt >= flat.length) {
            for (const c of robustList) c.s = c.total / 3;
            scored.splice(0, robustList.length, ...robustList.sort((a, b) => b.s - a.s));
            phase = 'pick';
            continue;
          }
          const { c, v } = flat[robustAt];
          budget = runSome(budget, v);
          if (!sim.done) return null;
          c.total += score(state, applyResult(state, v, sim), player, cfg);
          sim = null;
          robustAt++;
        } else {
          // Easy picks loosely among the leaders, but never a shot it can see is much worse.
          const top = scored.slice(0, Math.max(1, Math.min(cfg.pickFromTop, scored.length))).filter((c) => c.s >= scored[0].s - 150);
          const pick = top[Math.floor(unit(rng) * top.length)];
          const input = { ...pick.input, shot: perturb(pick.input.shot, cfg, rng) };
          decided = input;
          return decided;
        }
      }
      return null;
    },
  };
}

/** The same input with the aim turned by `deg` degrees. */
function nudge(input, deg) {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const { ax, ay } = input.shot;
  return { ...input, shot: { ...input.shot, ...toAim(ax * c - ay * s, ax * s + ay * c) } };
}

/** Think to the end in one go (tests and server-free simulations of whole games). */
export function decide(state, player, level, rng) {
  const th = createThinker(state, player, level, rng);
  let r = null;
  while (!r) r = th.think(1 << 30);
  return r;
}
