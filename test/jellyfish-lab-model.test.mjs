import test from 'node:test';
import assert from 'node:assert/strict';
import { LabJellyfish, stroke, NODES, FINE } from '../js/jellyfish-lab-model.js';

const axis = m => [m.basis[3], m.basis[4], m.basis[5]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const run = (m, seconds) => { for (let k = 0; k < seconds * 90; k++) m.step(1 / 90); };

test('the stroke squeezes, refills, flares and rests', () => {
  assert.equal(stroke(0), 0);
  assert.ok(Math.abs(stroke(0.22) - 1) < 1e-9);
  assert.ok(stroke(0.11) > 0.4 && stroke(0.45) < stroke(0.3));
  assert.ok(stroke(0.74) < 0, 'the bell opens a little past rest');
  assert.equal(stroke(0.9), 0);
});

test('the crown is one point however lopsided the stroke is', () => {
  const m = new LabJellyfish({ seed: 3 });
  m.turn.set([0.6, 0.8, 1]); m.phase = 0.15;
  const values = [0, 1, 2, 3, 4].map(a => m.contraction(a, 0));
  for (const v of values) assert.ok(Math.abs(v - values[0]) < 1e-12);
  assert.ok(Math.abs(m.contraction(0, 1) - m.contraction(Math.PI, 1)) > 0.05, 'the margin differs from side to side');
});

test('fixed steps agree across display refresh rates', () => {
  const a = new LabJellyfish({ seed: 9 }), b = new LabJellyfish({ seed: 9 });
  for (let k = 0; k < 240; k++) a.advance(1 / 30);
  for (let k = 0; k < 960; k++) b.advance(1 / 120);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a.pos[i] - b.pos[i]) < 1e-6);
});

test('it swims forward along its axis with a pulsing speed', () => {
  const m = new LabJellyfish({ seed: 7 });
  m.goal = axis(m); run(m, 8);
  const start = [...m.pos], heading = axis(m);
  let fastest = 0, slowest = 9;
  for (let k = 0; k < 90 * 8; k++) { m.step(1 / 90); const speed = Math.hypot(...m.vel); fastest = Math.max(fastest, speed); slowest = Math.min(slowest, speed); }
  const moved = [m.pos[0] - start[0], m.pos[1] - start[1], m.pos[2] - start[2]];
  assert.ok(dot(moved, heading) > 0.15, 'net travel is forward');
  assert.ok(slowest > 0.1 * fastest && slowest < 0.7 * fastest, 'it glides between strokes without stopping');
});

test('a lopsided stroke turns the bell toward its goal', () => {
  const m = new LabJellyfish({ seed: 7 });
  run(m, 4);
  for (const side of [0, 6]) {
    const goal = [m.basis[side], m.basis[side + 1], m.basis[side + 2]];
    m.goal = goal;
    const before = dot(axis(m), goal);
    run(m, 16);
    assert.ok(dot(axis(m), goal) > before + 0.6, 'the axis swings round to the goal');
  }
});

test('roots stay on the bell and links keep their length', () => {
  const m = new LabJellyfish({ seed: 21 }), p = new Float64Array(3);
  for (let f = 0; f < 90 * 25; f++) {
    m.step(1 / 90);
    if (f % 30) continue;
    for (const c of m.chains) {
      m.root(c, p);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.points[i] - p[i]) < 1e-9);
      const rest = c.length * m.scale * c.reach / (NODES - 1);
      for (let k = 1; k < NODES; k++) {
        const i = k * 3, length = Math.hypot(c.points[i] - c.points[i - 3], c.points[i + 1] - c.points[i - 2], c.points[i + 2] - c.points[i - 1]);
        assert.ok(Math.abs(length / rest - 1) < 0.05, 'links stretch less than five percent');
      }
    }
  }
});

test('tentacles trail behind a swimming bell', () => {
  const m = new LabJellyfish({ seed: 7 });
  m.goal = axis(m); run(m, 12);
  let behind = 0;
  for (const c of m.chains.slice(0, FINE)) {
    const e = (NODES - 1) * 3, tip = [c.points[e] - c.points[0], c.points[e + 1] - c.points[1], c.points[e + 2] - c.points[2]];
    if (dot(tip, axis(m)) < 0) behind++;
  }
  assert.ok(behind >= FINE - 2);
});

test('a startle quickens the stroke and pulls the tentacles in', () => {
  const m = new LabJellyfish({ seed: 5 });
  run(m, 6);
  const reach = m.chains[0].reach;
  m.startle(); run(m, 1.5);
  assert.ok(m.chains[0].reach < reach - 0.2);
  assert.ok(m.period <= 2.0);
});

test('a long free swim stays finite and near the stage', () => {
  for (const seed of [1, 42, 977]) {
    const m = new LabJellyfish({ seed });
    for (let k = 0; k < 90 * 240; k++) {
      m.step(1 / 90);
      if (k % 90 === 0) assert.ok(Number.isFinite(m.pos[0] + m.pos[1] + m.pos[2] + m.chains[5].points[40]) && Math.abs(m.pos[0]) < 2.2 && Math.abs(m.pos[1]) < 1.3 && Math.abs(m.pos[2]) < 0.9);
    }
  }
});
