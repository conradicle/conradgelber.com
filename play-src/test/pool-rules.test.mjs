import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, applyResult, checkInput, playShot, timeout, forfeit, targets, onTheEight, lowestBall, legalSpot, respot, PLACE_SCALE,
} from '../src/pool/engine/rules.js';
import { BALLS, SPIN_MAX, POWER_MAX, AIM_MAX } from '../src/pool/engine/physics.js';
import { R, L, W, FOOT_SPOT, HEAD_STRING } from '../src/pool/engine/table.js';

// A finished "simulation" with exactly the outcome a test needs.
function fake(state, { firstHit = -1, rail = true, pocketed = [], place = null } = {}) {
  const on = [...state.table.on];
  const x = [...state.table.x];
  const y = [...state.table.y];
  if (place) {
    on[0] = true;
    x[0] = place.x;
    y[0] = place.y;
  }
  for (const [ball] of pocketed) on[ball] = false;
  return { on, x, y, firstHit, railAfterHit: rail, pocketed: pocketed.map(([ball, pocket], i) => ({ ball, pocket, step: i })) };
}
const shot = { ax: AIM_MAX, ay: 0, power: 500, side: 0, top: 0 };
const input = (extra = {}) => ({ shot, ...extra });

/** An 8-ball game past the break, groups as given (player 0 first), player 0 to shoot. */
function eightBall({ groups = null, off = [] } = {}) {
  const s = newGame({ game: 8, guide: 'full', seed: 7, breaker: 0 });
  s.phase = 'play';
  s.ballInHand = null;
  s.groups = groups;
  for (const n of off) s.table.on[n] = false;
  return s;
}
function nineBall({ off = [] } = {}) {
  const s = newGame({ game: 9, guide: 'full', seed: 7, breaker: 0 });
  s.phase = 'play';
  s.ballInHand = null;
  for (const n of off) s.table.on[n] = false;
  return s;
}

// ─── Fouls (both games) ───────────────────────────────────────────────────

test('scratch is a foul: ball in hand for the opponent, cue ball off the table', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 3, pocketed: [[0, 2]] }));
  assert.deepEqual(n.last.fouls, ['scratch']);
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, 'table');
  assert.equal(n.table.on[0], false);
});

test('hitting no ball is a foul', () => {
  const s = nineBall();
  const n = applyResult(s, input(), fake(s, { firstHit: -1 }));
  assert.ok(n.last.fouls.includes('no-hit'));
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, 'table');
});

test('no ball reaching a rail after contact, with nothing pocketed, is a foul', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 3, rail: false }));
  assert.deepEqual(n.last.fouls, ['no-rail']);
  assert.equal(n.ballInHand, 'table');
});

test('no rail is fine when a ball was pocketed', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 3, rail: false, pocketed: [[3, 0]] }));
  assert.deepEqual(n.last.fouls, []);
  assert.equal(n.turn, 0);
});

test('8-ball: hitting the opponent group first is a foul', () => {
  const s = eightBall({ groups: ['solids', 'stripes'] });
  const n = applyResult(s, input(), fake(s, { firstHit: 11 }));
  assert.deepEqual(n.last.fouls, ['wrong-first']);
  assert.equal(n.turn, 1);
});

test('8-ball: hitting the 8 first while you still have balls is a foul', () => {
  const s = eightBall({ groups: ['solids', 'stripes'] });
  const n = applyResult(s, input(), fake(s, { firstHit: 8 }));
  assert.deepEqual(n.last.fouls, ['wrong-first']);
});

test('8-ball: on an open table, hitting the 8 first is a foul', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 8 }));
  assert.deepEqual(n.last.fouls, ['eight-first']);
});

test('9-ball: the cue ball must hit the lowest ball first', () => {
  const s = nineBall({ off: [1, 2] });
  assert.deepEqual(targets(s), [3]);
  const bad = applyResult(s, input(), fake(s, { firstHit: 4 }));
  assert.deepEqual(bad.last.fouls, ['wrong-first']);
  const good = applyResult(s, input(), fake(s, { firstHit: 3 }));
  assert.deepEqual(good.last.fouls, []);
});

test('balls pocketed on a foul stay down (8-ball) and the table stays open', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 3, pocketed: [[3, 0], [0, 1]] }));
  assert.equal(n.table.on[3], false);
  assert.equal(n.groups, null);
  assert.equal(n.turn, 1);
});

// ─── Groups ───────────────────────────────────────────────────────────────

test('the first ball legally pocketed after the break assigns groups', () => {
  const s = eightBall();
  s.turn = 1;
  const n = applyResult(s, input(), fake(s, { firstHit: 12, pocketed: [[12, 3]] }));
  assert.deepEqual(n.groups, ['solids', 'stripes']);
  assert.deepEqual(n.last.assigned, { player: 1, group: 'stripes' });
  assert.equal(n.turn, 1);
});

test('with balls from both groups down, the first to drop decides', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 2, pocketed: [[10, 4], [2, 0]] }));
  assert.deepEqual(n.groups, ['stripes', 'solids']);
  assert.equal(n.turn, 0);
});

test('balls pocketed on the break do not assign groups', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 1, breaker: 0 });
  const n = applyResult(s, input(), fake(s, { firstHit: 1, pocketed: [[5, 1]] }));
  assert.equal(n.groups, null);
  assert.equal(n.turn, 0, 'pocketing on the break keeps the turn');
});

test('pocketing only opponent balls passes the turn without a foul', () => {
  const s = eightBall({ groups: ['solids', 'stripes'] });
  const n = applyResult(s, input(), fake(s, { firstHit: 3, pocketed: [[12, 2]] }));
  assert.deepEqual(n.last.fouls, []);
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, null);
});

// ─── The 8 ────────────────────────────────────────────────────────────────

test('the 8 on the break is respotted and the breaker continues', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 1, breaker: 1 });
  s.table.x[8] = 1.2; // moved by the break, so the foot spot is free
  const n = applyResult(s, input(), fake(s, { firstHit: 1, pocketed: [[8, 2]] }));
  assert.equal(n.phase, 'play');
  assert.equal(n.table.on[8], true);
  assert.deepEqual(n.last.respotted, [8]);
  assert.equal(n.turn, 1);
  assert.equal(n.winner, null);
});

test('the 8 and a scratch on the break: 8 respotted, a normal foul, no loss', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 1, breaker: 0 });
  const n = applyResult(s, input(), fake(s, { firstHit: 1, pocketed: [[8, 2], [0, 0]] }));
  assert.equal(n.winner, null);
  assert.equal(n.table.on[8], true);
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, 'table');
});

test('respotting behind the foot spot when it is taken', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 1, breaker: 0 });
  s.table.on[8] = false;
  // The rack's apex sits on the foot spot, so the 8 goes behind it, clear of every ball.
  respot(s.table, 8);
  assert.equal(s.table.y[8], FOOT_SPOT.y);
  assert.ok(s.table.x[8] > FOOT_SPOT.x);
  for (let k = 0; k < BALLS; k++) {
    if (k === 8 || !s.table.on[k]) continue;
    assert.ok(Math.hypot(s.table.x[k] - s.table.x[8], s.table.y[k] - s.table.y[8]) >= 2 * R - 1e-12);
  }
});

test('pocketing the 8 early loses', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3] });
  const n = applyResult(s, input(), fake(s, { firstHit: 4, pocketed: [[8, 0]] }));
  assert.equal(n.phase, 'over');
  assert.equal(n.winner, 1);
  assert.equal(n.last.win.reason, 'early-eight');
});

test('pocketing your last ball and the 8 on the same shot loses', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6] });
  const n = applyResult(s, input(), fake(s, { firstHit: 7, pocketed: [[7, 1], [8, 0]] }));
  assert.equal(n.last.win.reason, 'early-eight');
  assert.equal(n.winner, 1);
});

test('the 8 on an open table after the break loses', () => {
  const s = eightBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 2, pocketed: [[8, 5]] }));
  assert.equal(n.last.win.reason, 'early-eight');
});

test('on the 8 you must call a pocket', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(onTheEight(s), true);
  assert.deepEqual(targets(s), [8]);
  assert.equal(checkInput(s, 0, input()), 'Call a pocket for the 8.');
  assert.equal(checkInput(s, 0, input({ call: 6 })), 'Call a pocket for the 8.');
  assert.equal(checkInput(s, 0, input({ call: 3 })), null);
});

test('the 8 in the called pocket wins', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6, 7] });
  const n = applyResult(s, input({ call: 3 }), fake(s, { firstHit: 8, pocketed: [[8, 3]] }));
  assert.equal(n.winner, 0);
  assert.equal(n.last.win.reason, 'eight');
});

test('the 8 in the wrong pocket loses', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6, 7] });
  const n = applyResult(s, input({ call: 3 }), fake(s, { firstHit: 8, pocketed: [[8, 4]] }));
  assert.equal(n.winner, 1);
  assert.equal(n.last.win.reason, 'wrong-pocket');
});

test('a scratch while pocketing the 8 loses', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6, 7] });
  const n = applyResult(s, input({ call: 3 }), fake(s, { firstHit: 8, pocketed: [[8, 3], [0, 2]] }));
  assert.equal(n.winner, 1);
  assert.equal(n.last.win.reason, 'scratch-on-eight');
});

test('pocketing the 8 on another foul loses', () => {
  const s = eightBall({ groups: ['solids', 'stripes'], off: [1, 2, 3, 4, 5, 6, 7] });
  const n = applyResult(s, input({ call: 3 }), fake(s, { firstHit: 12, pocketed: [[8, 3]] }));
  assert.equal(n.winner, 1);
  assert.equal(n.last.win.reason, 'foul-on-eight');
});

// ─── 9-ball ───────────────────────────────────────────────────────────────

test('the 9 on the break wins', () => {
  const s = newGame({ game: 9, guide: 'off', seed: 3, breaker: 1 });
  const n = applyResult(s, input(), fake(s, { firstHit: 1, pocketed: [[9, 0]] }));
  assert.equal(n.winner, 1);
  assert.equal(n.last.win.reason, 'nine');
});

test('the 9 on a combination wins', () => {
  const s = nineBall({ off: [1, 2] });
  const n = applyResult(s, input(), fake(s, { firstHit: 3, pocketed: [[9, 5]] }));
  assert.equal(n.winner, 0);
});

test('the 9 on a foul is respotted and the opponent gets ball in hand', () => {
  // Only the 5 and the 9 left, both well away from the foot spot.
  const s = nineBall({ off: [1, 2, 3, 4, 6, 7, 8] });
  s.table.x[5] = 0.5;
  s.table.x[9] = 1.2;
  const n = applyResult(s, input(), fake(s, { firstHit: 6, pocketed: [[9, 5]] }));
  assert.equal(n.winner, null);
  assert.equal(n.table.on[9], true);
  assert.equal(n.table.x[9], FOOT_SPOT.x);
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, 'table');
});

test('9-ball: any ball pocketed on a legal shot keeps the turn', () => {
  const s = nineBall();
  const n = applyResult(s, input(), fake(s, { firstHit: 1, pocketed: [[6, 2]] }));
  assert.equal(n.turn, 0);
  const miss = applyResult(s, input(), fake(s, { firstHit: 1 }));
  assert.equal(miss.turn, 1);
  assert.equal(miss.ballInHand, null);
  assert.equal(lowestBall(n.table), 1);
});

// ─── Shot clock, forfeit ──────────────────────────────────────────────────

test('running out of time is a foul: ball in hand for the opponent', () => {
  const s = eightBall({ groups: ['solids', 'stripes'] });
  const n = timeout(s);
  assert.equal(n.turn, 1);
  assert.equal(n.ballInHand, 'table');
  assert.deepEqual(n.last.fouls, ['timeout']);
});

test('running out of time before the break passes the break', () => {
  const s = newGame({ game: 9, guide: 'off', seed: 1, breaker: 0 });
  const n = timeout(s);
  assert.equal(n.turn, 1);
  assert.equal(n.phase, 'break');
  assert.equal(n.ballInHand, 'kitchen');
});

test('forfeit gives the other player the win', () => {
  const n = forfeit(eightBall(), 0);
  assert.equal(n.winner, 1);
  assert.equal(n.phase, 'over');
});

// ─── Input checks ─────────────────────────────────────────────────────────

test('input checks: turn, ranges and placement', () => {
  const s = eightBall();
  assert.equal(checkInput(s, 1, input()), 'It is not your turn.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, power: 0 } }), 'Bad power.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, power: POWER_MAX + 1 } }), 'Bad power.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, ax: 0, ay: 0 } }), 'Bad aim.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, ax: 0.5 } }), 'Bad aim.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, side: SPIN_MAX, top: SPIN_MAX } }), 'Bad spin.');
  assert.equal(checkInput(s, 0, { shot: { ...shot, side: '5' } }), 'Bad spin.');
  assert.equal(checkInput(s, 0, { shot }), null);
  assert.equal(checkInput(s, 0, { shot, place: { x: 5000, y: 5000 } }), 'You do not have ball in hand.');
  s.ballInHand = 'table';
  const onBall = { x: Math.round(s.table.x[5] * PLACE_SCALE), y: Math.round(s.table.y[5] * PLACE_SCALE) };
  assert.match(checkInput(s, 0, { shot, place: onBall }), /clear of other balls/);
  assert.equal(checkInput(s, 0, { shot, place: { x: 5000, y: 5000 } }), null);
  assert.equal(checkInput(s, 0, { shot, place: { x: -1, y: 5000 } }), 'Bad placement.');
  assert.equal(checkInput(s, 0, { shot, call: 2 }), 'Only the 8 is called.');
});

test('break placement must be behind the head string', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 1, breaker: 0 });
  assert.equal(legalSpot(s, HEAD_STRING - 0.01, W / 2), true);
  assert.equal(legalSpot(s, HEAD_STRING + 0.01, W / 2), false);
  assert.equal(legalSpot(s, R / 2, W / 2), false);
  assert.equal(legalSpot(s, L / 5, W - R + 0.001), false);
});

test('a cue ball off the table must be placed', () => {
  const s = eightBall();
  s.table.on[0] = false;
  s.ballInHand = 'table';
  assert.equal(checkInput(s, 0, { shot }), 'Place the cue ball first.');
});

// ─── Through the real simulation ──────────────────────────────────────────

test('a straight pot into the corner, with draw, keeps the turn', () => {
  const s = eightBall();
  for (let n = 1; n < BALLS; n++) s.table.on[n] = false;
  s.table.on[3] = true;
  s.table.x[3] = 0.3;
  s.table.y[3] = 0.3;
  s.table.x[0] = 0.6;
  s.table.y[0] = 0.6;
  // Harder than this and the draw carries the cue ball back up the diagonal into the top side pocket.
  const n = playShot(s, { shot: { ax: -AIM_MAX, ay: -AIM_MAX, power: 200, side: 0, top: -SPIN_MAX } });
  assert.deepEqual(n.last.pocketed, [3]);
  assert.deepEqual(n.last.pockets, [0]);
  assert.deepEqual(n.last.fouls, []);
  assert.deepEqual(n.groups, ['solids', 'stripes']);
  assert.equal(n.turn, 0);
});

test('a straight pot with follow scratches in the same pocket', () => {
  const s = eightBall();
  for (let n = 1; n < BALLS; n++) s.table.on[n] = false;
  s.table.on[3] = true;
  s.table.x[3] = 0.3;
  s.table.y[3] = 0.3;
  s.table.x[0] = 0.6;
  s.table.y[0] = 0.6;
  const n = playShot(s, { shot: { ax: -AIM_MAX, ay: -AIM_MAX, power: 400, side: 0, top: SPIN_MAX } });
  assert.deepEqual(n.last.pocketed, [3]);
  assert.equal(n.last.scratch, true);
  assert.equal(n.turn, 1);
  assert.equal(n.groups, null, 'no groups from a foul');
});
