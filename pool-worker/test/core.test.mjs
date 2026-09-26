import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, emptyRoom, FIRST_SLICE, SLICE } from '../src/core.js';
import { cleanCode, isAllowedRoomCode, cleanName, ROOM_CODE_ALPHABET, ENGINE_VERSION, SHOT_CLOCK_MS, RECONNECT_MS } from '../../play-src/src/pool/engine/protocol.js';
import { playShot } from '../../play-src/src/pool/engine/rules.js';
import { AIM_MAX } from '../../play-src/src/pool/engine/physics.js';
import { seededRng } from '../../play-src/src/pool/engine/rng.js';

const v = ENGINE_VERSION;

/** A room with a fake clock and fake sockets. */
function harness() {
  const h = { t: 1_000_000, sent: [], ended: [], online: new Set() };
  const rng = seededRng(42);
  h.core = new RoomCore(emptyRoom('KSJGZZ'), {
    now: () => h.t,
    rng,
    send: (id, type, d) => h.sent.push({ id, type, d: JSON.parse(JSON.stringify(d)) }),
    isConnected: (id) => h.online.has(id),
    sessionEnded: (id, reason) => {
      h.online.delete(id);
      h.ended.push({ id, reason });
    },
  });
  h.of = (id, type) => h.sent.filter((m) => m.id === id && m.type === type);
  h.last = (id, type) => h.of(id, type).at(-1)?.d;
  /** Run alarms until nothing is due now. */
  h.alarms = () => {
    for (let n = 0; n < 200; n++) {
      const due = h.core.nextAlarm();
      if (due === null || due > h.t) return;
      h.core.alarm();
    }
    throw new Error('alarms never settled');
  };
  return h;
}

/** Two players seated and connected; the game has started. */
function twoPlayers() {
  const h = harness();
  const a = h.core.create({ name: 'Ana', game: '8', guide: 'full', v }).seat;
  h.online.add(a.id);
  h.core.connected(a.id);
  const b = h.core.join({ name: 'Ben', v }).seat;
  h.online.add(b.id);
  h.core.connected(b.id);
  return { h, a, b, g: () => h.core.snapshot().game };
}

const breakShot = { shot: { ax: AIM_MAX, ay: 0, power: 1000, side: 0, top: 0 } };

// ─── Room codes and names ─────────────────────────────────────────────────

test('room codes: six letters from the alphabet, any case, spaces trimmed', () => {
  assert.equal(cleanCode(' ksjgzz '), 'KSJGZZ');
  assert.equal(cleanCode('KSJGZ'), null);
  assert.equal(cleanCode('KSJGZZA'), null);
  assert.equal(cleanCode('BOOMED'), null, 'B, O, M, E and D are not in the alphabet');
  assert.equal(cleanCode(123456), null);
  for (const c of 'IOBDEPVMN') assert.ok(!ROOM_CODE_ALPHABET.includes(c));
});

test('room codes never spell a blocked word', () => {
  assert.equal(isAllowedRoomCode('KSJGZZ'), true);
  assert.equal(isAllowedRoomCode('XSHITX'), false);
  assert.equal(isAllowedRoomCode('ASSKLQ'), false);
  assert.equal(isAllowedRoomCode('QHSSQH'), false, 'a double S is out anywhere');
});

test('names are cleaned: invisible characters stripped, 16 code points at most', () => {
  assert.equal(cleanName('  Bo​  '), 'Bo');
  assert.equal(cleanName('⠀'), null);
  assert.equal(cleanName('a'.repeat(30)), 'a'.repeat(16));
  assert.equal(cleanName(7), null);
});

// ─── Joining ──────────────────────────────────────────────────────────────

test('create, then join: the game starts at once with the creator breaking', () => {
  const { h, a, b, g } = twoPlayers();
  assert.equal(g().state.phase, 'break');
  assert.equal(g().state.turn, 0);
  assert.equal(h.last(a.id, 'game:state').me, 0);
  assert.equal(h.last(b.id, 'game:state').me, 1);
  assert.deepEqual(h.last(b.id, 'game:state').names, ['Ana', 'Ben']);
  assert.equal(h.last(a.id, 'game:state').clock.left, SHOT_CLOCK_MS);
});

test('a third player is turned away', () => {
  const { h } = twoPlayers();
  assert.equal(h.core.join({ name: 'Cy', v }), 'That room is full.');
});

test('a page from another engine version is turned away', () => {
  const h = harness();
  assert.match(h.core.create({ name: 'Ana', game: '8', guide: 'full', v: 'old' }), /updated/);
});

test('bad room settings and empty names are refused', () => {
  const h = harness();
  assert.equal(h.core.create({ name: '', game: '8', guide: 'full', v }), 'Enter a name.');
  assert.match(h.core.create({ name: 'Ana', game: '10', guide: 'full', v }), /Pick a game/);
  assert.match(h.core.create({ name: 'Ana', game: '8', guide: 'x', v }), /Pick a game/);
  assert.equal(h.core.join({ name: 'Ben', v }), 'There is no room with that code.');
});

// ─── Shots ────────────────────────────────────────────────────────────────

test('only the player whose turn it is may shoot', () => {
  const { h, b } = twoPlayers();
  assert.equal(h.core.shot(b.id, { seq: 0, input: breakShot }), 'It is not your turn.');
});

test('a shot for an old turn is refused', () => {
  const { h, a } = twoPlayers();
  assert.equal(h.core.shot(a.id, { seq: 3, input: breakShot }), 'That shot was for an earlier turn.');
});

test('bad input is refused', () => {
  const { h, a } = twoPlayers();
  const bad = [
    null,
    { shot: null },
    { shot: { ax: 0, ay: 0, power: 500, side: 0, top: 0 } },
    { shot: { ax: 1.5, ay: 0, power: 500, side: 0, top: 0 } },
    { shot: { ax: AIM_MAX + 1, ay: 0, power: 500, side: 0, top: 0 } },
    { shot: { ax: 1, ay: 0, power: 0, side: 0, top: 0 } },
    { shot: { ax: 1, ay: 0, power: 1001, side: 0, top: 0 } },
    { shot: { ax: 1, ay: 0, power: 500, side: 1000, top: 1000 } },
    { shot: { ax: 1, ay: 0, power: '500', side: 0, top: 0 } },
    { ...breakShot, place: { x: 99999, y: 5000 } },
    { ...breakShot, place: { x: 15000, y: 5000 } },
    { ...breakShot, call: 2 },
  ];
  for (const input of bad) assert.ok(h.core.shot(a.id, { seq: 0, input }), JSON.stringify(input));
  assert.equal(h.core.snapshot().game.pending, null, 'nothing was played');
});

test('a second shot while one is on the table is refused', () => {
  const { h, a } = twoPlayers();
  assert.equal(h.core.shot(a.id, { seq: 0, input: breakShot }), null);
  assert.equal(h.core.shot(a.id, { seq: 0, input: breakShot }), 'A shot is already on the table.');
});

test('the watcher gets the shot at once; the result comes after the slices, the same as one run', () => {
  const { h, a, b, g } = twoPlayers();
  const before = g().state;
  assert.equal(h.core.shot(a.id, { seq: 0, input: breakShot }), null);
  assert.deepEqual(h.last(b.id, 'game:shot'), { seq: 0, input: breakShot, shooter: 0 });
  assert.equal(h.last(a.id, 'game:shot'), undefined, 'the shooter already has it');
  // A full-power break takes thousands of steps: more than the first slice.
  assert.ok(g().pending && g().pending.sim.steps === FIRST_SLICE);
  assert.equal(h.core.nextAlarm(), h.t);
  let alarms = 0;
  while (g().pending) {
    // Rebuild the room from its snapshot between slices, as a hibernating object would be.
    h.core = new RoomCore(JSON.parse(JSON.stringify(h.core.snapshot())), h.core.d);
    h.core.alarm();
    alarms++;
  }
  assert.ok(alarms >= 2 && alarms < 20, `${alarms} slices of ${SLICE}`);
  const whole = playShot(before, breakShot);
  assert.deepEqual(g().state, whole, 'sliced and restored, the result is the same to the bit');
  assert.deepEqual(h.last(a.id, 'game:result').state, whole);
  assert.deepEqual(h.last(b.id, 'game:result').state, whole);
  assert.equal(g().seq, 1);
});

test('the next clock starts after the shot has played out on screen', () => {
  const { h, a, g } = twoPlayers();
  const t0 = h.t;
  h.core.shot(a.id, { seq: 0, input: breakShot });
  h.alarms();
  const left = h.last(a.id, 'game:result').clock.left;
  assert.ok(left > SHOT_CLOCK_MS + 1000, `clock allows for the animation (${left} ms)`);
  assert.ok(g().clock.endsAt > t0 + SHOT_CLOCK_MS);
});

// ─── Shot clock ───────────────────────────────────────────────────────────

test('running out the clock is a foul: ball in hand for the other player', () => {
  const { h, a, g } = twoPlayers();
  h.core.shot(a.id, { seq: 0, input: breakShot });
  h.alarms();
  const shooter = g().state.turn;
  h.t = g().clock.endsAt;
  h.alarms();
  assert.equal(g().state.last.kind, 'timeout');
  assert.equal(g().state.turn, 1 - shooter);
  assert.equal(g().state.ballInHand, 'table');
  assert.equal(g().seq, 2);
});

test('running out the clock before the break passes the break', () => {
  const { h, g } = twoPlayers();
  h.t += SHOT_CLOCK_MS;
  h.alarms();
  assert.equal(g().state.turn, 1);
  assert.equal(g().state.phase, 'break');
});

// ─── Disconnects ──────────────────────────────────────────────────────────

test('a disconnect freezes the clock; coming back resumes it where it was', () => {
  const { h, a, b, g } = twoPlayers();
  h.t += 20_000;
  h.online.delete(b.id);
  h.core.disconnected(b.id);
  assert.equal(g().waiting.player, 1);
  assert.equal(g().clock.left, SHOT_CLOCK_MS - 20_000);
  assert.equal(h.last(a.id, 'game:state').waiting.left, RECONNECT_MS);
  assert.equal(h.core.shot(a.id, { seq: 0, input: breakShot }), 'Waiting for the other player to reconnect.');
  h.t += 90_000;
  h.alarms();
  assert.equal(g().state.phase, 'break', 'nothing happened while they were away');
  h.online.add(b.id);
  h.core.connected(b.id);
  assert.equal(g().waiting, null);
  assert.equal(g().clock.endsAt, h.t + SHOT_CLOCK_MS - 20_000);
});

test('no return within five minutes: the player who stayed wins', () => {
  const { h, a, b, g } = twoPlayers();
  h.online.delete(b.id);
  h.core.disconnected(b.id);
  h.t += RECONNECT_MS;
  h.alarms();
  assert.equal(g().state.phase, 'over');
  assert.equal(g().state.winner, 0);
  assert.deepEqual(h.last(a.id, 'game:result').state.last.win, { winner: 0, reason: 'forfeit' });
});

test('resume with the seat token takes the seat back', () => {
  const { h, b } = twoPlayers();
  assert.equal(h.core.resume({ token: b.token, v }).seat.id, b.id);
  assert.match(h.core.resume({ token: 'nope', v }), /seat has gone/);
});

// ─── Leaving, rematch, aim ────────────────────────────────────────────────

test('leaving mid-game hands the other player the win, without a second message', () => {
  const { h, a, b, g } = twoPlayers();
  h.core.leave(a.id);
  const r = h.last(b.id, 'game:result');
  assert.deepEqual(r.state.last.win, { winner: 1, reason: 'left' });
  assert.equal(h.of(b.id, 'toast').length, 0);
  assert.deepEqual(h.ended, [{ id: a.id, reason: 'left' }]);
  assert.equal(g(), null);
});

test('leaving after the game says who went, by name', () => {
  const { h, a, b, g } = twoPlayers();
  g().state.phase = 'over';
  h.core.leave(a.id);
  assert.equal(h.last(b.id, 'toast').message, 'Ana left the room.');
});

test('rematch needs both players, and the other player breaks', () => {
  const { h, a, b, g } = twoPlayers();
  assert.equal(h.core.rematch(a.id), 'Finish this game first.');
  g().state.phase = 'over';
  assert.equal(h.core.rematch(a.id), null);
  assert.equal(h.last(b.id, 'toast').message, 'Ana wants a rematch.');
  assert.equal(g().state.phase, 'over');
  h.core.rematch(b.id);
  assert.equal(g().state.phase, 'break');
  assert.equal(g().state.turn, 1);
  assert.equal(g().breaker, 1);
});

test('aim is relayed from the shooter only, and only in shape', () => {
  const { h, a, b } = twoPlayers();
  h.core.aim(b.id, { ax: 1, ay: 0, power: 50 });
  assert.equal(h.last(a.id, 'game:aim'), undefined);
  h.core.aim(a.id, { ax: 5, ay: 7, power: 50, place: { x: 100, y: 200 }, call: 9, extra: 'x' });
  assert.deepEqual(h.last(b.id, 'game:aim'), { ax: 5, ay: 7, power: 50, place: { x: 100, y: 200 }, call: null });
  h.core.aim(a.id, { ax: 5.5, ay: 7, power: 50 });
  assert.equal(h.of(b.id, 'game:aim').length, 1);
});
