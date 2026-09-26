// Freezes the 200-shot set into shots.json, with the hash the current engine
// gives it. Inputs are generated once here (with Math.hypot, cos and the
// like, whose last bit may differ between engines), so the Node and browser
// determinism tests feed the simulation exactly the same numbers.
//   node test/pool/make-fixture.mjs   after any change to the physics
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Sim } from '../../src/pool/engine/physics.js';
import { ENGINE_VERSION } from '../../src/pool/engine/protocol.js';
import { buildShots, outcome, hashOutcomes } from './shots.mjs';

const shots = buildShots().map(({ kind, state, shot }) => ({ kind, state, shot }));
const hash = hashOutcomes(shots.map((s) => outcome(Sim, s)));
writeFileSync(resolve(import.meta.dirname, 'shots.json'), JSON.stringify({ engine: ENGINE_VERSION, hash, shots }));
console.log(`${shots.length} shots, engine ${ENGINE_VERSION}, hash ${hash}`);
