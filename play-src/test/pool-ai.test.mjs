import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, checkInput, playShot } from '../src/pool/engine/rules.js';
import { createThinker, decide } from '../src/pool/engine/ai.js';
import { seededRng } from '../src/pool/engine/rng.js';

/** A whole game between two computer players; returns every input and the final state. */
function playGame(game, levels, seed, budget) {
  let s = newGame({ game, guide: 'off', seed, breaker: 0 });
  const rng = [seededRng(seed * 2 + 1), seededRng(seed * 2 + 2)];
  const inputs = [];
  while (s.phase !== 'over' && inputs.length < 200) {
    const p = s.turn;
    const th = createThinker(s, p, levels[p], rng[p]);
    let input = null;
    while (!input) input = th.think(budget);
    assert.equal(checkInput(s, p, input), null, 'the computer only sends legal shots');
    inputs.push(input);
    s = playShot(s, input);
  }
  return { inputs, s };
}

test('a game between computer players finishes, with legal inputs throughout', () => {
  const { s } = playGame(9, ['medium', 'easy'], 4, 1 << 30);
  assert.equal(s.phase, 'over');
});

test('the same seeds replay the same game, however the thinking is sliced', () => {
  const a = playGame(8, ['easy', 'medium'], 11, 1 << 30);
  const b = playGame(8, ['easy', 'medium'], 11, 500);
  assert.deepEqual(b.inputs, a.inputs);
  assert.equal(b.s.winner, a.s.winner);
});

test('thinking in slices returns null until it has decided', () => {
  const s = newGame({ game: 8, guide: 'off', seed: 2, breaker: 0 });
  s.phase = 'play';
  s.ballInHand = null;
  const th = createThinker(s, 0, 'hard', seededRng(1));
  assert.equal(th.think(50), null);
  let r = null;
  while (!r) r = th.think(5000);
  assert.deepEqual(r, decide(s, 0, 'hard', seededRng(1)));
});
