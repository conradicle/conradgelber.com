import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINE_VERSION } from '../src/pool/engine/protocol.js';
import { runFixture } from './pool/run-fixture.mjs';

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'pool/shots.json'), 'utf8'));

test('the frozen shot set is for this engine (else: node test/pool/make-fixture.mjs)', () => {
  assert.equal(fixture.engine, ENGINE_VERSION);
});

test('200 shots, run twice, give identical final positions, matching the recorded hash', () => {
  const kinds = {};
  for (const s of fixture.shots) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  assert.equal(fixture.shots.length, 200);
  assert.ok(kinds['max follow'] + kinds['max draw'] >= 50);
  assert.ok(kinds.near >= 20);
  const { hashes } = runFixture(fixture, 2);
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[0], fixture.hash);
});
