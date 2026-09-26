// Runs the frozen shot set: shared by the Node test and the browser page.
import { Sim } from '../../src/pool/engine/physics.js';
import { outcome, hashOutcomes } from './shots.mjs';

/** Run every shot `rounds` times; returns each round's hash and the time taken. */
export function runFixture(fixture, rounds = 2) {
  const hashes = [];
  const t0 = performance.now();
  for (let r = 0; r < rounds; r++) hashes.push(hashOutcomes(fixture.shots.map((s) => outcome(Sim, s))));
  return { hashes, ms: performance.now() - t0 };
}
