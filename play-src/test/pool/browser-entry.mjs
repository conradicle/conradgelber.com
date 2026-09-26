// The browser half of the determinism test (served only by the local dev
// server, at /pool-test/). Same frozen shots, same engine files, and the
// hash has to match the one Node recorded.
import fixture from './shots.json';
import { runFixture } from './run-fixture.mjs';

const out = document.getElementById('result');
const { hashes, ms } = runFixture(fixture, 2);
const same = hashes[0] === hashes[1];
const match = hashes[0] === fixture.hash;
window.poolDeterminism = { hashes, expected: fixture.hash, same, match, shots: fixture.shots.length, ms, ua: navigator.userAgent };
out.textContent = `${fixture.shots.length} shots, run twice: ${hashes.join(' / ')}. Node recorded ${fixture.hash}. ${same && match ? 'Identical.' : 'DIFFERENT.'}`;
