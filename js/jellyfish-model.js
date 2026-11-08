/* Invisible anatomy in world coordinates. No renderer or browser dependencies. */
const TAU = Math.PI * 2;
export const STRANDS = 20;
export const NODES = 19;
const STEP = 1 / 90;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// A brief squeeze and a long refill, rather than a sine and a motionless half-cycle.
export function stroke(phase) {
  const p = ((phase % 1) + 1) % 1;
  return p < .16 ? 0 : p < .37 ? smooth((p - .16) / .21) : 1 - smooth((p - .37) / .63);
}

export function bellPoint(a, v, contraction, time, seed, out) {
  const theta = v * Math.PI / 2;
  const asymmetry = Math.sin(a * 3 + time * .63 + seed);
  const rib = 1 + .018 * Math.cos(a * 12 + .2 * Math.sin(time * .4));
  // The shoulder and aperture squeeze independently of the crown; the rim curls up.
  const r = Math.sin(theta) * (1.04 - .37 * contraction * v ** 2.7) * rib * (1 + .025 * asymmetry * v * v);
  out[0] = Math.cos(a) * r;
  out[1] = .10 + (.65 + .19 * contraction) * Math.cos(theta)
    + .17 * contraction * v ** 6 + .026 * Math.sin(a * 12 + time * .7) * v ** 8
    + .025 * asymmetry * v * (1 - v);
  out[2] = Math.sin(a) * r;
  return out;
}

export class JellyfishSchool {
  constructor({ count = 4, aspect = 1.4, specimen = false, desk = false, compact = false } = {}) {
    this.aspect = aspect; this.time = 0; this.accumulator = 0; this.specimen = specimen;
    this.pointer = [100, 100]; this.attention = 0;
    let seed = 72913;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    this.animals = Array.from({ length: count }, (_, i) => {
      const o = {
        x: (specimen ? -.08 : [-.68, .53, -.28, .64][i]) * aspect,
        y: specimen ? -.02 : compact && !desk ? [.54, -.03, -.55][i] : [.42, .16, -.44, -.53][i], z: 0,
        vx: 0, vy: 0, heading: specimen ? -.30 : [-.35, .65, -1.5, 2.5][i], turn: 0,
        seed: random() * TAU, phase: specimen ? .08 : random(),
        period: 3.4 + random() * 1.3, strength: .85 + random() * .3,
        size: specimen ? .31 : (desk ? .23 : compact ? .096 : .125) * [.98, 1.12, .82, .72][i],
        depth: .86 + random() * .17, contraction: 0, thrust: 0,
        pulse: -100, yaw: 0, pitch: 0, scale: 0,
        chains: [],
      };
      o.contraction = stroke(o.phase);
      o.depth = .91 + .07 * Math.sin(o.seed); o.scale = o.size * o.depth;
      o.yaw = .23 * Math.sin(o.seed); o.pitch = .19 + .10 * Math.sin(o.seed);
      for (let j = 0; j < STRANDS; j++) {
        const oral = j >= 16, angle = (oral ? (j - 16) / 4 + .125 : j / 16) * TAU;
        const chain = { angle, oral, length: (oral ? 1.65 : 2.35) * (.8 + random() * .4),
          trailX: Math.sin(o.heading), trailY: -Math.cos(o.heading),
          seed: random() * TAU, points: new Float32Array(NODES * 3), previous: new Float32Array(NODES * 3) };
        // Derive traits without consuming the organism RNG: swimming stays exact.
        const trait = n => { const v = Math.sin(chain.seed * (17.13 + n * 3.71) + o.seed * 9.17 + j * 1.93) * 43758.5453; return v - Math.floor(v); };
        chain.angle += (trait(1) - .5) * (oral ? .16 : .13);
        chain.length *= .95 + .1 * trait(2);
        chain.drag = .9 + .2 * trait(3);
        chain.response = .78 + .44 * trait(4);
        chain.flex = .78 + .44 * trait(5);
        chain.current = .7 + .6 * trait(6);
        chain.tipResponse = .55 + .85 * trait(7);
        chain.frequency = .27 + .23 * trait(8);
        chain.phase = trait(9) * TAU;
        chain.ribbonWidth = .18 + .045 * trait(10);
        chain.tipX = chain.trailX; chain.tipY = chain.trailY;
        o.chains.push(chain);
      }
      return o;
    });
    this.temp = new Float64Array(3);
    this.resetChains();
  }
  transform(o, p, out) {
    const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw), sx = Math.sin(o.pitch), cx = Math.cos(o.pitch);
    const x = cy * p[0] + sy * p[2], z = -sy * p[0] + cy * p[2];
    const y = cx * (p[1] + .22) - sx * z, zz = sx * (p[1] + .22) + cx * z;
    const c = Math.cos(o.heading), s = Math.sin(o.heading), scale = o.scale;
    out[0] = o.x + (c * x - s * y) * scale;
    out[1] = o.y + (s * x + c * y) * scale;
    out[2] = zz * scale;
    return out;
  }
  surface(o, a, v, out) {
    bellPoint(a, v, o.contraction, this.time, o.seed, out);
    return this.transform(o, out, out);
  }
  root(o, chain, out) {
    if (!chain.oral) return this.surface(o, chain.angle, 1, out);
    out[0] = Math.cos(chain.angle) * .25; out[1] = .13; out[2] = Math.sin(chain.angle) * .25;
    return this.transform(o, out, out);
  }
  resetChains() {
    for (const o of this.animals) for (const chain of o.chains) {
      this.root(o, chain, this.temp);
      for (let k = 0; k < NODES; k++) {
        const d = k / (NODES - 1), b = k * 3, length = chain.length * o.scale;
        chain.points[b] = this.temp[0] + Math.sin(o.heading) * length * d + .05 * Math.sin(d * 5 + chain.seed) * d * o.scale;
        chain.points[b + 1] = this.temp[1] - Math.cos(o.heading) * length * d;
        chain.points[b + 2] = this.temp[2] + Math.cos(chain.seed) * .2 * d * o.scale;
      }
      chain.previous.set(chain.points);
    }
  }
  resize(aspect) {
    const ratio = aspect / this.aspect;
    for (const o of this.animals) {
      const shift = o.x * (ratio - 1);
      o.x += shift; o.vx *= ratio;
      for (const chain of o.chains) for (let b = 0; b < chain.points.length; b += 3) {
        chain.points[b] += shift; chain.previous[b] += shift;
      }
    }
    this.aspect = aspect;
  }
  advance(elapsed) {
    // Fixed substeps give identical dynamics at 30/60/120Hz; discard suspended time.
    this.accumulator += clamp(elapsed, 0, .0667);
    while (this.accumulator >= STEP) { this.step(STEP); this.accumulator -= STEP; }
  }
  step(dt) {
    this.time += dt;
    for (const o of this.animals) {
      const old = o.contraction;
      o.phase += dt / o.period;
      o.contraction = stroke(o.phase);
      const squeeze = Math.max(0, o.contraction - old) / dt;
      const flowX = .009 * Math.sin(this.time * .13 + o.y * 2.1) + .004 * Math.cos(this.time * .23 + o.seed);
      const flowY = .008 * Math.cos(this.time * .11 + o.x * 1.8 + o.seed);
      // Evolving velocity intention. Heading may traverse a full circle, with a
      // damped angular velocity; no clamped upright pose or instantaneous flips.
      let dx = Math.sin(this.time * .075 + o.seed) * .6;
      let dy = Math.cos(this.time * .061 + o.seed * 1.7) * .55;
      const margin = this.specimen ? .58 : Math.min(.43, this.aspect * .62);
      const bx = Math.max(.05, this.aspect - margin), by = this.specimen ? .44 : .59;
      dx -= Math.sign(o.x) * smooth((Math.abs(o.x) / bx - .55) / .45) * 2.8;
      dy -= Math.sign(o.y) * smooth((Math.abs(o.y) / by - .45) / .55) * 2.8;
      for (const other of this.animals) if (o !== other) {
        const x = o.x - other.x, y = o.y - other.y, d = Math.hypot(x, y), radius = (o.scale + other.scale) * 2.6;
        if (d > .001 && d < radius) { dx += x / d * (1 - d / radius) * 1.5; dy += y / d * (1 - d / radius) * 1.5; }
      }
      const px = o.x - this.pointer[0], py = o.y - this.pointer[1], near = Math.exp(-Math.hypot(px, py) * 5) * this.attention;
      dx += px * near * .9; dy += py * near * .9;
      const desired = Math.atan2(-dx, dy);
      o.turn += (clamp(wrap(desired - o.heading) * .42, -.28, .28) - o.turn) * (1 - Math.exp(-dt * 1.6));
      o.heading += o.turn * dt;
      // Only decreasing aperture produces a jet. The refill carries momentum.
      o.thrust = squeeze * .034 * o.strength;
      o.vx += (-Math.sin(o.heading) * o.thrust + (flowX - o.vx) * .65) * dt;
      o.vy += ( Math.cos(o.heading) * o.thrust + (flowY - o.vy) * .65) * dt;
      // Soft water resistance near *whole organism* margins. No wrap/teleport.
      o.vx -= Math.sign(o.x) * Math.max(0, Math.abs(o.x) - bx) * .45 * dt;
      o.vy -= Math.sign(o.y) * Math.max(0, Math.abs(o.y) - by) * .45 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.depth = .91 + .07 * Math.sin(this.time * .043 + o.seed);
      o.scale = o.size * o.depth;
      o.yaw = .23 * Math.sin(this.time * .13 + o.seed);
      o.pitch = .19 + .10 * Math.sin(this.time * .19 + o.seed);
      for (const chain of o.chains) this.stepChain(o, chain, dt, flowX, flowY);
    }
  }
  stepChain(o, chain, dt, flowX, flowY) {
    const p = chain.points, prev = chain.previous, rest = chain.length * o.scale / (NODES - 1);
    this.root(o, chain, this.temp);
    const t = this.time, seed = chain.seed, oral = chain.oral;
    const aftX = Math.sin(o.heading), aftY = -Math.cos(o.heading);
    // A filtered wake follows both swimming and relative water motion. This is
    // a loose bending envelope, not a target pose for the whole filament.
    let wakeX = aftX * .026 + (flowX - o.vx) * .45;
    let wakeY = aftY * .026 + (flowY - o.vy) * .45;
    const wakeLength = Math.hypot(wakeX, wakeY) || 1;
    const follow = 1 - Math.exp(-dt * (oral ? 1.25 : .85) * chain.response);
    chain.trailX += (wakeX / wakeLength - chain.trailX) * follow;
    chain.trailY += (wakeY / wakeLength - chain.trailY) * follow;
    const trailLength = Math.hypot(chain.trailX, chain.trailY) || 1;
    wakeX = chain.trailX / trailLength; wakeY = chain.trailY / trailLength;
    // Distal wake has a strand-specific extra delay; the stable collar is unchanged.
    const tipFollow = 1 - Math.exp(-dt * (oral ? 1.1 : .8) * chain.tipResponse);
    chain.tipX += (wakeX - chain.tipX) * tipFollow;
    chain.tipY += (wakeY - chain.tipY) * tipFollow;
    const tipLength = Math.hypot(chain.tipX, chain.tipY) || 1;
    const tipX = chain.tipX / tipLength, tipY = chain.tipY / tipLength;
    const waterX = flowX + .0025 * Math.sin(t * .48 + seed) + .0015 * Math.cos(t * .23 + seed * 2);
    const waterZ = .002 * Math.cos(t * .42 + seed);
    for (let k = 1; k < NODES; k++) {
      const b = k * 3, d = k / (NODES - 1), distal = smooth((d - .58) / .42);
      // Stronger root damping and calmer oral arms; tips retain more inertia.
      const damping = Math.exp(-dt * (oral ? 5.8 - 1.3 * d : 5.0 - 2.0 * d) * (1 + (chain.drag - 1) * d));
      // Two slow, incommensurate local flows are strongest only in the final
      // third. Each strand has its own phase, rate and sensitivity.
      const local = (Math.sin(t * chain.frequency + chain.phase - d * 6.4)
        + .42 * Math.sin(t * chain.frequency * .61 + seed * 2 + d * 9)) * distal * chain.current * o.scale * (oral ? .010 : .034);
      for (let axis = 0; axis < 3; axis++) {
        const value = p[b + axis], velocity = (value - prev[b + axis]) * damping;
        const water = axis === 0 ? waterX + wakeX * .006 + .002 * Math.sin(t * .55 - d * 3 + seed) * d * chain.current - tipY * local
          : axis === 1 ? flowY + wakeY * .006 + tipX * local
          : waterZ * Math.sin(d * 2 + seed) * d * chain.current + local * .35 * Math.cos(chain.phase + d * 3);
        p[b + axis] += velocity + water * (1 - damping) * dt;
        prev[b + axis] = value;
      }
    }
    // A short, compliant collar stabilizes the first three links. Its influence
    // vanishes before the free filament; no world-space history is rotated.
    const splay = (oral ? .035 : .075) * Math.cos(chain.angle);
    for (let k = 1; k <= 3; k++) {
      const b = k * 3, weight = (1 - Math.exp(-dt * (oral ? 28 : 23))) * (1 - k / 4) ** 2;
      const targetX = this.temp[0] + (aftX + Math.cos(o.heading) * splay) * rest * k;
      const targetY = this.temp[1] + (aftY + Math.sin(o.heading) * splay) * rest * k;
      for (let axis = 0; axis < 3; axis++) {
        const target = axis === 0 ? targetX : axis === 1 ? targetY : this.temp[2];
        const correction = (target - p[b + axis]) * weight;
        p[b + axis] += correction; prev[b + axis] += correction * .75;
      }
    }
    // Local bending relaxation removes short zigzags without prescribing a
    // heading. Wider oral ribbons resist sharp folds more than fine filaments.
    for (let k = 1; k < NODES - 1; k++) {
      const b = k * 3, d = k / (NODES - 1), weight = 1 - Math.exp(-dt * (oral ? 2.8 : .95) * (1 - d * .45) * (1 + .5 * smooth((d - .58) / .42)) / (1 + (chain.flex - 1) * d));
      for (let axis = 0; axis < 3; axis++) {
        const correction = ((p[b - 3 + axis] + p[b + 3 + axis]) * .5 - p[b + axis]) * weight;
        p[b + axis] += correction; prev[b + axis] += correction * .8;
      }
    }
    // Distance constraints transfer the moving root's pull through the water.
    for (let pass = 0; pass < 6; pass++) {
      p[0] = this.temp[0]; p[1] = this.temp[1]; p[2] = this.temp[2];
      for (let k = 1; k < NODES; k++) {
        const b = k * 3, a = b - 3, x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2];
        const distance = Math.hypot(x, y, z) || 1e-6, correction = (distance - rest) / distance;
        const weight = k === 1 ? 1 : .5;
        p[b] -= x * correction * weight; p[b + 1] -= y * correction * weight; p[b + 2] -= z * correction * weight;
        if (k > 1) { p[a] += x * correction * .5; p[a + 1] += y * correction * .5; p[a + 2] += z * correction * .5; }
      }
    }
    // Preserve exact lengths, limiting only folds outside a generous trailing
    // cone. The cone widens toward the tip and follows the delayed wake, so
    // ordinary bends stay free while filaments cannot curl back over the bell.
    for (let k = 1; k < NODES; k++) {
      const b = k * 3, a = b - 3, d = k / (NODES - 1);
      let x = p[b] - p[a], y = p[b + 1] - p[a + 1], z = p[b + 2] - p[a + 2];
      const length = Math.hypot(x, y, z) || 1e-6;
      x /= length; y /= length; z /= length;
      const distal = smooth((d - .58) / .42);
      const wx = wakeX + (tipX - wakeX) * distal, wy = wakeY + (tipY - wakeY) * distal;
      const wl = Math.hypot(wx, wy) || 1, ux = wx / wl, uy = wy / wl;
      const dot = x * ux + y * uy;
      const angle = (oral ? .55 + .55 * d : .72 + .60 * d) * (1 + (chain.flex - 1) * distal * .12);
      const limit = Math.cos(angle);
      if (dot < limit) {
        let px = x - ux * dot, py = y - uy * dot, pz = z;
        const lateral = Math.hypot(px, py, pz);
        if (lateral < 1e-6) { px = -uy; py = ux; pz = 0; }
        const side = Math.sin(angle) / (lateral < 1e-6 ? 1 : lateral);
        const nx = ux * limit + px * side, ny = uy * limit + py * side, nz = pz * side;
        // Constraint corrections should not inject a fresh sideways impulse.
        prev[b] += (nx - x) * rest; prev[b + 1] += (ny - y) * rest; prev[b + 2] += (nz - z) * rest;
        x = nx; y = ny; z = nz;
      }
      p[b] = p[a] + x * rest; p[b + 1] = p[a + 1] + y * rest; p[b + 2] = p[a + 2] + z * rest;
    }
    prev[0] = p[0]; prev[1] = p[1]; prev[2] = p[2];
  }
  sampleChain(chain, d, out, tangent) {
    const t = clamp(d, 0, 1) * (NODES - 1), k = Math.min(NODES - 2, Math.floor(t)), u = t - k, p = chain.points;
    // Cubic Hermite interpolation removes the visible seven-segment elbows.
    for (let axis = 0; axis < 3; axis++) {
      const a = p[Math.max(0, k - 1) * 3 + axis], b = p[k * 3 + axis];
      const c = p[(k + 1) * 3 + axis], e = p[Math.min(NODES - 1, k + 2) * 3 + axis];
      out[axis] = .5 * ((2 * b) + (-a + c) * u + (2*a - 5*b + 4*c - e) * u*u + (-a + 3*b - 3*c + e) * u*u*u);
      if (tangent) tangent[axis] = .5 * ((-a + c) + 2 * (2*a - 5*b + 4*c - e) * u + 3 * (-a + 3*b - 3*c + e) * u*u);
    }
    return out;
  }
}
