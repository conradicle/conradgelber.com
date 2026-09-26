import { Sim, BALLS, AIM_MAX, POWER_MAX, SPIN_MAX } from './physics.js';
import { R, L, W, FOOT_SPOT, HEAD_SPOT, HEAD_STRING, POCKETS, SEGS, SEG_COUNT, SEG_STRIDE } from './table.js';
import { rack8, rack9 } from './rack.js';

/**
 * Casual 8-ball and 9-ball, GamePigeon style, as a pure state machine shared
 * by the server, the browser and the computer player. Nothing here reads a
 * clock: the shot clock and disconnects live in the room, which calls
 * timeout() or forfeit() when they run out.
 *
 * A game state is plain JSON:
 *   game: 8 | 9, guide: 'off' | 'medium' | 'full', seed
 *   table: { on, x, y } indexed by ball number, 0 the cue ball
 *   turn: 0 | 1 (the player to shoot), breaker: 0 | 1, shots: shots taken
 *   phase: 'break' | 'play' | 'over'
 *   ballInHand: 'kitchen' (behind the head string, for the break) | 'table' | null
 *   groups: null, or ['solids' | 'stripes', ...] indexed by player
 *   winner: null | 0 | 1, and last: the report of the last shot or event
 */

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupBalls = (g) => (g === 'solids' ? SOLIDS : STRIPES);
export const groupOf = (n) => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);
const other = (p) => 1 - p;

/** Placement is sent in tenths of a millimetre. */
export const PLACE_SCALE = 10000;

export function newGame({ game, guide, seed, breaker }) {
  return {
    v: 1,
    game,
    guide,
    seed,
    table: game === 9 ? rack9(seed) : rack8(seed),
    turn: breaker,
    breaker,
    shots: 0,
    phase: 'break',
    ballInHand: 'kitchen',
    groups: null,
    winner: null,
    last: null,
  };
}

/** Lowest-numbered object ball on the table (9-ball), or 0 if none. */
export function lowestBall(table) {
  for (let n = 1; n < BALLS; n++) if (table.on[n]) return n;
  return 0;
}

/** What the shooter must hit first: a list of ball numbers (empty means any but the 8). */
export function targets(state, player = state.turn) {
  const { table } = state;
  if (state.game === 9) return [lowestBall(table)];
  if (state.phase === 'break' || !state.groups) return [];
  const mine = groupBalls(state.groups[player]).filter((n) => table.on[n]);
  return mine.length ? mine : [8];
}

/** The shooter is on the 8 and must call a pocket. */
export function onTheEight(state, player = state.turn) {
  if (state.game !== 8 || state.phase !== 'play' || !state.groups) return false;
  return groupBalls(state.groups[player]).every((n) => !state.table.on[n]);
}

/**
 * Is (x, y) a legal cue ball spot right now? On the cloth (never in a pocket
 * mouth), clear of every cushion and jaw, clear of every ball, and behind the
 * head string for a break.
 */
export function legalSpot(state, x, y) {
  if (!(x >= R && x <= L - R && y >= R && y <= W - R)) return false;
  if (state.ballInHand === 'kitchen' && x > HEAD_STRING) return false;
  for (const k of POCKETS) if ((x - k.mx) * k.ox + (y - k.my) * k.oy > -R) return false;
  for (let s = 0; s < SEG_COUNT; s++) {
    const o = s * SEG_STRIDE;
    const along = Math.max(0, Math.min(SEGS[o + 8], (x - SEGS[o]) * SEGS[o + 4] + (y - SEGS[o + 1]) * SEGS[o + 5]));
    const dx = x - (SEGS[o] + along * SEGS[o + 4]);
    const dy = y - (SEGS[o + 1] + along * SEGS[o + 5]);
    if (dx * dx + dy * dy < R * R) return false;
  }
  for (let n = 1; n < BALLS; n++) {
    if (!state.table.on[n]) continue;
    const dx = state.table.x[n] - x;
    const dy = state.table.y[n] - y;
    if (dx * dx + dy * dy < 4 * R * R) return false;
  }
  return true;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Check a shot from `player`: { shot: { ax, ay, power, side, top },
 * place?: { x, y } in tenths of a millimetre, call?: pocket index }.
 * Returns an error message, or null when it is fine.
 */
export function checkInput(state, player, input) {
  if (state.phase === 'over') return 'The game is over.';
  if (player !== state.turn) return 'It is not your turn.';
  if (!input || typeof input !== 'object') return 'Bad shot.';
  const { shot, place, call } = input;
  if (!shot || typeof shot !== 'object') return 'Bad shot.';
  const { ax, ay, power, side, top } = shot;
  if (!isInt(ax, -AIM_MAX, AIM_MAX) || !isInt(ay, -AIM_MAX, AIM_MAX) || (ax === 0 && ay === 0)) return 'Bad aim.';
  if (!isInt(power, 1, POWER_MAX)) return 'Bad power.';
  if (!isInt(side, -SPIN_MAX, SPIN_MAX) || !isInt(top, -SPIN_MAX, SPIN_MAX) || side * side + top * top > SPIN_MAX * SPIN_MAX) return 'Bad spin.';
  if (place != null) {
    if (!state.ballInHand) return 'You do not have ball in hand.';
    if (typeof place !== 'object' || !isInt(place.x, 0, Math.round(L * PLACE_SCALE)) || !isInt(place.y, 0, Math.round(W * PLACE_SCALE))) return 'Bad placement.';
    if (!legalSpot(state, place.x / PLACE_SCALE, place.y / PLACE_SCALE)) {
      return state.ballInHand === 'kitchen' ? 'Place the cue ball behind the line, clear of other balls.' : 'Place the cue ball on the table, clear of other balls.';
    }
  } else if (!state.table.on[0]) return 'Place the cue ball first.';
  if (onTheEight(state, player)) {
    if (!isInt(call, 0, POCKETS.length - 1)) return 'Call a pocket for the 8.';
  } else if (call != null) return 'Only the 8 is called.';
  return null;
}

/** The table with the cue ball placed, ready to simulate. */
export function tableForShot(state, input) {
  const t = { on: [...state.table.on], x: [...state.table.x], y: [...state.table.y] };
  if (input.place != null) {
    t.on[0] = true;
    t.x[0] = input.place.x / PLACE_SCALE;
    t.y[0] = input.place.y / PLACE_SCALE;
  }
  return t;
}

/** Put a ball back on the foot spot, or the nearest free point behind it (then in front) on the long axis. */
export function respot(table, n) {
  const free = (x) => {
    for (let k = 0; k < BALLS; k++) {
      if (k === n || !table.on[k]) continue;
      const dx = table.x[k] - x;
      const dy = table.y[k] - FOOT_SPOT.y;
      if (dx * dx + dy * dy < 4 * R * R) return false;
    }
    return true;
  };
  const stepX = R / 8;
  let x = FOOT_SPOT.x;
  while (x <= L - R && !free(x)) x += stepX;
  if (x > L - R) for (x = FOOT_SPOT.x; x >= R && !free(x); x -= stepX);
  table.on[n] = true;
  table.x[n] = x;
  table.y[n] = FOOT_SPOT.y;
}

/** Run the shot and apply the rules. Returns the new state; the input must have passed checkInput. */
export function playShot(state, input) {
  const sim = new Sim(tableForShot(state, input), input.shot).run();
  return applyResult(state, input, sim);
}

/**
 * Apply a finished simulation (anything with the Sim's result fields: the
 * server may run it in slices) to the state before the shot.
 */
export function applyResult(state, input, sim) {
  const shooter = state.turn;
  const opp = other(shooter);
  const wasBreak = state.phase === 'break';
  const table = { on: Array.from(sim.on, (b) => !!b), x: Array.from(sim.x), y: Array.from(sim.y) };
  const dropped = sim.pocketed.map((p) => p.ball);
  const objects = dropped.filter((n) => n !== 0);
  const scratch = dropped.includes(0);
  const want = targets(state, shooter);
  const fouls = [];
  if (scratch) fouls.push('scratch');
  if (sim.firstHit < 0) fouls.push('no-hit');
  else if (state.game === 8 && want.length === 0 && sim.firstHit === 8 && !wasBreak) fouls.push('eight-first');
  else if (want.length && !want.includes(sim.firstHit)) fouls.push('wrong-first');
  if (sim.firstHit >= 0 && objects.length === 0 && !sim.railAfterHit) fouls.push('no-rail');

  const report = {
    kind: 'shot',
    shooter,
    game: state.game,
    wasBreak,
    firstHit: sim.firstHit,
    wanted: want,
    pocketed: objects,
    pockets: sim.pocketed.filter((p) => p.ball !== 0).map((p) => p.pocket),
    scratch,
    fouls,
    respotted: [],
    assigned: null,
    win: null,
    next: shooter,
    ballInHand: null,
  };
  const next = {
    ...state,
    table,
    shots: state.shots + 1,
    phase: 'play',
    ballInHand: null,
    last: report,
  };
  const foul = fouls.length > 0;

  if (state.game === 9) {
    if (objects.includes(9)) {
      if (!foul) return finish(next, report, shooter, 'nine');
      respot(table, 9);
      report.respotted.push(9);
    }
    report.next = !foul && objects.length ? shooter : opp;
  } else {
    const onEight = onTheEight(state, shooter);
    if (objects.includes(8)) {
      if (wasBreak) {
        respot(table, 8);
        report.respotted.push(8);
      } else if (!onEight) return finish(next, report, opp, 'early-eight');
      else if (scratch) return finish(next, report, opp, 'scratch-on-eight');
      else if (foul) return finish(next, report, opp, 'foul-on-eight');
      else {
        const pocket = sim.pocketed.find((p) => p.ball === 8).pocket;
        if (pocket !== input.call) return finish(next, report, opp, 'wrong-pocket');
        return finish(next, report, shooter, 'eight');
      }
    }
    // Groups: the first ball to drop on a clean shot after the break decides.
    if (!wasBreak && !state.groups && !foul) {
      const first = objects.find((n) => n !== 8);
      if (first) {
        const g = groupOf(first);
        next.groups = shooter === 0 ? [g, g === 'solids' ? 'stripes' : 'solids'] : [g === 'solids' ? 'stripes' : 'solids', g];
        report.assigned = { player: shooter, group: g };
      }
    }
    let keep;
    if (foul) keep = false;
    else if (wasBreak) keep = objects.length > 0;
    else if (!next.groups) keep = objects.some((n) => n !== 8);
    else if (report.assigned) keep = true;
    else keep = objects.some((n) => groupOf(n) === next.groups[shooter]);
    report.next = keep ? shooter : opp;
  }

  next.turn = report.next;
  if (foul) {
    next.ballInHand = 'table';
    report.ballInHand = 'table';
    if (scratch) table.on[0] = false;
  }
  return next;
}

function finish(next, report, winner, reason) {
  report.win = { winner, reason };
  report.next = null;
  next.phase = 'over';
  next.winner = winner;
  next.ballInHand = null;
  return next;
}

/**
 * The shot clock ran out: a foul, and ball in hand for the opponent. Before
 * the break the rack is still whole, so the opponent breaks instead.
 */
export function timeout(state) {
  if (state.phase === 'over') return state;
  const shooter = state.turn;
  const hand = state.phase === 'break' ? 'kitchen' : 'table';
  const report = { kind: 'timeout', shooter, fouls: ['timeout'], next: other(shooter), ballInHand: hand };
  return { ...state, turn: other(shooter), ballInHand: hand, last: report };
}

/** A player left for good or conceded: the other one wins. */
export function forfeit(state, loser, reason = 'forfeit') {
  const winner = other(loser);
  return { ...state, phase: 'over', winner, ballInHand: null, last: { kind: 'forfeit', shooter: loser, win: { winner, reason } } };
}

/** Where to show the cue ball while a player with ball in hand has not placed it. */
export function suggestedSpot(state) {
  if (state.table.on[0] && legalSpot(state, state.table.x[0], state.table.y[0])) return { x: state.table.x[0], y: state.table.y[0] };
  const tries = [HEAD_SPOT, { x: HEAD_SPOT.x, y: HEAD_SPOT.y + 4 * R }, { x: HEAD_SPOT.x, y: HEAD_SPOT.y - 4 * R }];
  for (let i = 1; i < 40; i++) tries.push({ x: HEAD_SPOT.x - i * R, y: HEAD_SPOT.y }, { x: HEAD_SPOT.x, y: HEAD_SPOT.y + (i % 2 ? 1 : -1) * i * R * 0.5 });
  return tries.find((p) => legalSpot(state, p.x, p.y)) ?? HEAD_SPOT;
}
