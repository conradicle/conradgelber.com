/* Lab swimming model: one jellyfish in three dimensions. No renderer or browser
   dependencies. The front page still uses jellyfish-model.js; this file is the
   experimental replacement.

   What drives the motion:
   - A stroke wave travels around the bell margin. To turn, the inside of the turn
     contracts first and weakly, the outside later and harder.
   - Thrust and turning torque are summed from sixteen sectors of the margin, so
     the heading changes because the stroke is lopsided.
   - Drag is far higher sideways than along the axis, for the bell and for every
     tentacle link, so things trail and stream without target poses.
   - Every hydrodynamic force reads one velocity field, water(). Today it is built
     from shed vortex rings and the bell's own breathing. A grid fluid can replace
     it later without touching the bodies. */
const TAU = Math.PI * 2;
export const FINE = 24, ORAL = 4, NODES = 22, SECTORS = 16;
const STEP = 1 / 90, PIVOT = 0.40, REFERENCE = 0.29;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Power stroke, slower refill, a small elastic flare, then a glide.
// jellyfish-lab.js repeats this in GLSL; keep the two identical.
export function stroke(phase) {
  const p = phase - Math.floor(phase);
  if (p < 0.22) return smooth(p / 0.22);
  if (p < 0.68) return 1 - smooth((p - 0.22) / 0.46);
  if (p < 0.84) { const w = (p - 0.68) / 0.16; return -0.04 * Math.sin(Math.PI * w) * (1 - w); }
  return 0;
}

export class LabJellyfish {
  constructor({ seed = 1, aspect = 1.6, size = REFERENCE } = {}) {
    let state = (seed >>> 0) || 1;
    const random = this.random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
    this.aspect = aspect; this.time = 0; this.accumulator = 0; this.scale = size;
    this.seed = random() * TAU;
    this.pos = new Float64Array([-0.04 * aspect, -0.05, 0]);
    this.vel = new Float64Array(3); this.omega = new Float64Array(3);
    this.basis = new Float64Array(9); // body x, swimming axis, body z
    this.setAxis(-0.28, 1, 0.12);
    this.phase = 0.9; this.period = 3.6; this.amp = 1;
    this.turn = new Float64Array([1, 0, 0]); // cos and sin of the turn side, strength 0..1
    this.decided = false; this.startled = 0; this.retractUntil = -100;
    this.wander = [0, 1, 0]; this.bearing = Math.PI / 2 + 0.3; this.goal = null;
    this.pointer = [100, 100]; this.attention = 0;
    this.sector = new Float64Array(SECTORS);
    this.meanC = 0; this.rate = 0; this.thrust = 0;
    this.rings = []; this.mouth = new Float64Array(3);
    this.chains = [];
    for (let j = 0; j < FINE + ORAL; j++) {
      const oral = j >= FINE;
      const chain = {
        oral,
        angle: oral ? ((j - FINE) / ORAL + 0.125) * TAU : ((j + 0.5) / FINE + (random() - 0.5) * 0.022) * TAU,
        length: oral ? 1.9 * (0.85 + 0.3 * random()) : 2.7 * (0.62 + 0.7 * random()),
        seed: random() * TAU, phase: random() * TAU,
        drag: 0.85 + 0.3 * random(), stiffness: 0.8 + 0.4 * random(),
        response: 0.78 + 0.44 * random(), ribbonWidth: 0.2 + 0.05 * random(),
        reach: 1,
        points: new Float64Array(NODES * 3), previous: new Float64Array(NODES * 3),
      };
      this.chains.push(chain);
    }
    this.root0 = new Float64Array(3); this.flow = new Float64Array(3);
    for (let i = 0; i < SECTORS; i++) this.sector[i] = this.contraction(i / SECTORS * TAU, 1);
    this.resetChains();
  }

  setAxis(x, y, z) {
    const b = this.basis, n = Math.hypot(x, y, z) || 1;
    b[3] = x / n; b[4] = y / n; b[5] = z / n;
    // Any vector off the axis seeds the frame.
    let ex = 1, ey = 0, ez = 0;
    if (Math.abs(b[3]) > 0.9) { ex = 0; ey = 0; ez = 1; }
    b[0] = ex; b[1] = ey; b[2] = ez;
    this.orthonormalize();
  }

  orthonormalize() {
    const b = this.basis;
    let n = Math.hypot(b[3], b[4], b[5]) || 1; b[3] /= n; b[4] /= n; b[5] /= n;
    const d = b[0] * b[3] + b[1] * b[4] + b[2] * b[5];
    b[0] -= b[3] * d; b[1] -= b[4] * d; b[2] -= b[5] * d;
    n = Math.hypot(b[0], b[1], b[2]) || 1; b[0] /= n; b[1] /= n; b[2] /= n;
    b[6] = b[1] * b[5] - b[2] * b[4]; b[7] = b[2] * b[3] - b[0] * b[5]; b[8] = b[0] * b[4] - b[1] * b[3];
  }

  // Contraction at an angle around the bell and a position from crown (0) to margin (1).
  contraction(a, v) {
    const k = this.turn[2], side = Math.cos(a) * this.turn[0] + Math.sin(a) * this.turn[1];
    const lag = 0.05 * k * (1 - side), amp = this.amp * (1 - 0.3 * k * side);
    // The soft margin follows the body of the bell a beat late.
    const c = amp * lerp(stroke(this.phase - lag), stroke(this.phase - lag - 0.05), smooth((v - 0.5) / 0.5));
    // The crown is one point, so every angle must agree there.
    return lerp(this.amp * stroke(this.phase - 0.05 * k), c, smooth(v / 0.5));
  }

  bellLocal(a, v, out) {
    const c = this.contraction(a, v), theta = v * Math.PI / 2, lobes = Math.sin(a * 3 + this.seed);
    const r = Math.sin(theta) * (1.04 - 0.40 * c * v ** 2.7) * (1 + 0.02 * lobes * v * v);
    out[0] = Math.cos(a) * r;
    out[1] = 0.10 + (0.65 + 0.19 * c) * Math.cos(theta) + 0.17 * c * v ** 6 + 0.022 * Math.cos(a * 16) * v ** 8;
    out[2] = Math.sin(a) * r;
    return out;
  }

  toWorld(p, out) {
    const b = this.basis, s = this.scale, x = p[0], y = p[1] - PIVOT, z = p[2];
    out[0] = this.pos[0] + (b[0] * x + b[3] * y + b[6] * z) * s;
    out[1] = this.pos[1] + (b[1] * x + b[4] * y + b[7] * z) * s;
    out[2] = this.pos[2] + (b[2] * x + b[5] * y + b[8] * z) * s;
    return out;
  }

  surface(a, v, out) { return this.toWorld(this.bellLocal(a, v, out), out); }

  root(chain, out) {
    if (!chain.oral) return this.surface(chain.angle, 1, out);
    out[0] = Math.cos(chain.angle) * 0.25; out[1] = 0.13; out[2] = Math.sin(chain.angle) * 0.25;
    return this.toWorld(out, out);
  }

  resetChains() {
    const b = this.basis, r = this.root0;
    for (const chain of this.chains) {
      this.root(chain, r);
      const rest = chain.length * this.scale / (NODES - 1);
      const ca = Math.cos(chain.angle), sa = Math.sin(chain.angle), out = chain.oral ? 0.05 : 0.25;
      for (let k = 0; k < NODES; k++) for (let axis = 0; axis < 3; axis++) {
        chain.points[k * 3 + axis] = r[axis] + (-b[3 + axis] + (b[axis] * ca + b[6 + axis] * sa) * out) * rest * k;
      }
      chain.previous.set(chain.points);
    }
  }

  resize(aspect) { this.aspect = aspect; }

  // A touch: quick escape strokes, and the tentacles pull in.
  startle() {
    this.startled = 3; this.retractUntil = this.time + 1.6;
    const p = this.phase - Math.floor(this.phase);
    if (p >= 0.84) { this.decide(); this.decided = false; this.phase = Math.ceil(this.phase); }
    else this.period = Math.min(this.period, 2.0);
  }

  advance(elapsed) {
    this.accumulator += clamp(elapsed, 0, 0.0667);
    while (this.accumulator >= STEP) { this.step(STEP); this.accumulator -= STEP; }
  }

  // Once per stroke the animal picks where to go, how hard to pull and how to turn.
  decide() {
    const b = this.basis, random = this.random, w = this.wander;
    // The wish to go somewhere is a bearing that drifts freely round the compass.
    this.bearing += (random() - 0.5) * 0.7;
    w[2] = (w[2] + (random() - 0.5) * 0.24) * 0.6;
    w[0] = Math.cos(this.bearing); w[1] = Math.sin(this.bearing);
    let n;
    let dx = w[0], dy = w[1], dz = w[2];
    if (this.goal) { dx = this.goal[0]; dy = this.goal[1]; dz = this.goal[2]; }
    else {
      const bx = Math.max(0.15, this.aspect * 0.75), by = 0.62, bz = 0.34;
      const wallX = smooth((Math.abs(this.pos[0]) / bx - 0.62) / 0.38), wallY = smooth((Math.abs(this.pos[1]) / by - 0.62) / 0.38);
      dx -= Math.sign(this.pos[0]) * wallX * 2.4; dy -= Math.sign(this.pos[1]) * wallY * 2.4;
      dz -= clamp(this.pos[2] / bz, -1.5, 1.5) * 0.45 + b[5] * 0.25;
      const px = this.pos[0] - this.pointer[0], py = this.pos[1] - this.pointer[1], near = Math.exp(-Math.hypot(px, py) * 3.2) * this.attention;
      dx += px * near * 6; dy += py * near * 6;
      // Once turned away from an edge it keeps the new course.
      if (wallX + wallY + near > 0.02) this.bearing = Math.atan2(dy, dx);
    }
    n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
    const along = dx * b[3] + dy * b[4] + dz * b[5];
    const ex = dx - b[3] * along, ey = dy - b[4] * along, ez = dz - b[5] * along, off = Math.hypot(ex, ey, ez);
    if (off > 1e-4) {
      this.turn[0] = (ex * b[0] + ey * b[1] + ez * b[2]) / off;
      this.turn[1] = (ex * b[6] + ey * b[7] + ez * b[8]) / off;
      this.turn[2] = clamp(Math.atan2(off, along) / 1.5, 0, 1);
    } else this.turn[2] = 0;
    const quiet = !this.startled && !this.goal && this.turn[2] < 0.45;
    const draw = random(), pace = random();
    // Now and then it skips a beat and drifts.
    this.amp = this.startled ? 1.15 : quiet && draw < 0.1 ? 0 : 0.82 + 0.18 * draw;
    this.period = this.startled ? 1.9 : 3.1 + 1.2 * pace;
    if (this.startled) this.startled--;
  }

  // Velocity of the water at a point. The one seam a grid fluid would replace.
  water(p, out, far = false) {
    const t = this.time, s = this.scale, b = this.basis;
    let ux = 0.010 * Math.sin(t * 0.13 + p[1] * 2.1) + 0.004 * Math.cos(t * 0.23 + p[2] * 3);
    let uy = 0.007 * Math.cos(t * 0.11 + p[0] * 1.8);
    let uz = 0.004 * Math.sin(t * 0.17 + p[0] * 1.3 + p[1]);
    let x, y, z;
    if (!far) {
    // Water close to the bell is carried along with it.
    x = p[0] - this.pos[0]; y = p[1] - this.pos[1]; z = p[2] - this.pos[2];
    const carry = 0.6 * Math.exp(-(x * x + y * y + z * z) / (1.7 * s * s));
    ux += this.vel[0] * carry; uy += this.vel[1] * carry; uz += this.vel[2] * carry;
    // The bell breathes: out through the opening on the stroke, back in on the refill.
    x = p[0] - this.mouth[0]; y = p[1] - this.mouth[1]; z = p[2] - this.mouth[2];
    const h = 0.7 * s, d2 = x * x + y * y + z * z, d = Math.sqrt(d2) || 1e-6;
    const behind = -(x * b[3] + y * b[4] + z * b[5]) / d;
    const breath = 0.20 * this.rate * s * (h * h * h / (d2 + h * h) ** 1.5) * Math.min(1, d / h) * (0.25 + 0.75 * smooth(behind * 0.5 + 0.5));
    ux += x / d * breath; uy += y / d * breath; uz += z / d * breath;
    }
    // Each stroke leaves a vortex ring: fast water down its core, a slower return outside.
    if (!far) for (const ring of this.rings) {
      x = p[0] - ring.x; y = p[1] - ring.y; z = p[2] - ring.z;
      const along = x * ring.dx + y * ring.dy + z * ring.dz;
      const rx = x - ring.dx * along, ry = y - ring.dy * along, rz = z - ring.dz * along;
      const rho = Math.sqrt(rx * rx + ry * ry + rz * rz), q = rho / ring.radius, l = along / (ring.radius * 1.1);
      const g = ring.strength * Math.exp(-l * l - q * q);
      const axial = g * (1 - 1.4 * q * q), radial = rho > 1e-6 ? g * 0.9 * l * q / rho : 0;
      ux += ring.dx * axial + rx * radial; uy += ring.dy * axial + ry * radial; uz += ring.dz * axial + rz * radial;
    }
    out[0] = ux; out[1] = uy; out[2] = uz;
    return out;
  }

  step(dt) {
    this.time += dt;
    const b = this.basis, s = this.scale, size = s / REFERENCE;
    const before = this.phase; this.phase += dt / this.period;
    const p0 = before - Math.floor(before), p = this.phase - Math.floor(this.phase);
    if (Math.floor(this.phase) > Math.floor(before)) this.decided = false;
    else if (!this.decided && p >= 0.985) { this.decide(); this.decided = true; }

    // Sum thrust and torque around the margin.
    let force = 0, suction = 0, tx = 0, tz = 0, mean = 0, rate = 0;
    for (let i = 0; i < SECTORS; i++) {
      const a = i / SECTORS * TAU, c = this.contraction(a, 1), d = (c - this.sector[i]) / dt;
      this.sector[i] = c; mean += c; rate += d;
      if (d > 0) { const f = d * d; force += f; tx -= f * Math.sin(a); tz += f * Math.cos(a); } else suction += d * d;
    }
    force /= SECTORS; suction /= SECTORS; tx /= SECTORS; tz /= SECTORS;
    this.meanC = mean / SECTORS; this.rate = rate / SECTORS;
    this.thrust = 0.062 * force * size;

    // A push at a rim point turns the bell about the axis r x axis = cos(a) z - sin(a) x.
    const o = this.omega, torque = 1.3;
    for (let axis = 0; axis < 3; axis++) o[axis] += (b[axis] * tx + b[6 + axis] * tz) * torque * dt;
    const spin = Math.exp(-dt * 1.5);
    o[0] *= spin; o[1] *= spin; o[2] *= spin;
    for (let e = 0; e < 9; e += 3) {
      const x = b[e], y = b[e + 1], z = b[e + 2];
      b[e] += (o[1] * z - o[2] * y) * dt; b[e + 1] += (o[2] * x - o[0] * z) * dt; b[e + 2] += (o[0] * y - o[1] * x) * dt;
    }
    this.orthonormalize();

    // Thrust along the axis; drag that resists sideways slip far more than forward glide.
    const v = this.vel, open = clamp(1 - this.meanC, 0, 1.1);
    // The bell feels the ambient water, never its own breath or wake.
    const far = this.water(this.pos, this.flow, true), fx = far[0], fy = far[1], fz = far[2];
    const push = (this.thrust - 0.006 * suction * size) * dt;
    v[0] += b[3] * push; v[1] += b[4] * push; v[2] += b[5] * push;
    const rx = v[0] - fx, ry = v[1] - fy, rz = v[2] - fz, along = rx * b[3] + ry * b[4] + rz * b[5];
    const kAlong = 1 - Math.exp(-dt * 0.38 * (0.6 + 0.7 * open)), kAcross = 1 - Math.exp(-dt * 2.4);
    for (let axis = 0; axis < 3; axis++) {
      const par = b[3 + axis] * along, r = axis === 0 ? rx : axis === 1 ? ry : rz;
      v[axis] -= par * kAlong + (r - par) * kAcross;
    }
    // A last resort well outside the roaming box.
    const bx = this.aspect * 1.1, by = 0.95, bz = 0.6;
    v[0] -= Math.sign(this.pos[0]) * Math.max(0, Math.abs(this.pos[0]) - bx) * 0.6 * dt;
    v[1] -= Math.sign(this.pos[1]) * Math.max(0, Math.abs(this.pos[1]) - by) * 0.6 * dt;
    v[2] -= Math.sign(this.pos[2]) * Math.max(0, Math.abs(this.pos[2]) - bz) * 0.9 * dt;
    this.pos[0] += v[0] * dt; this.pos[1] += v[1] * dt; this.pos[2] += v[2] * dt;
    // The opening of the bell, where the breathing flow is centred.
    for (let axis = 0; axis < 3; axis++) this.mouth[axis] = this.pos[axis] + b[3 + axis] * (0.10 - PIVOT) * s;

    // Shed a ring as the power stroke ends.
    if (p0 < 0.22 && p >= 0.22 && this.amp > 0.2) {
      this.rings.push({
        x: this.mouth[0], y: this.mouth[1], z: this.mouth[2], dx: -b[3], dy: -b[4], dz: -b[5],
        vx: v[0] * 0.3 - b[3] * 0.085 * size, vy: v[1] * 0.3 - b[4] * 0.085 * size, vz: v[2] * 0.3 - b[5] * 0.085 * size,
        radius: 0.78 * s, power: 0.10 * this.amp * size, strength: 0, age: 0,
      });
      if (this.rings.length > 5) this.rings.shift();
    }
    for (const ring of this.rings) {
      ring.age += dt; ring.x += ring.vx * dt; ring.y += ring.vy * dt; ring.z += ring.vz * dt;
      const slow = Math.exp(-dt * 0.45); ring.vx *= slow; ring.vy *= slow; ring.vz *= slow;
      ring.radius += 0.035 * s * dt;
      ring.strength = ring.power * Math.exp(-ring.age / 2.4) * smooth(ring.age / 0.25);
    }
    while (this.rings.length && this.rings[0].age > 8) this.rings.shift();

    const retracting = this.time < this.retractUntil;
    for (const chain of this.chains) {
      const breathe = 0.9 + 0.1 * Math.sin(this.time * 0.21 + chain.phase);
      const want = retracting ? (chain.oral ? 0.8 : 0.5) : breathe;
      chain.reach += (want - chain.reach) * (1 - Math.exp(-dt * (want < chain.reach ? 2.6 : 0.3)));
      this.stepChain(chain, dt);
    }
  }

  stepChain(chain, dt) {
    const p = chain.points, prev = chain.previous, b = this.basis, s = this.scale, oral = chain.oral;
    const rest = chain.length * s * chain.reach / (NODES - 1), w = this.flow, last = NODES - 1;
    const across = (oral ? 6.5 : 4.6) * chain.drag, along = (oral ? 3.0 : 1.5) * chain.drag;
    for (let k = 1; k < NODES; k++) {
      const i = k * 3, d = k / last, hi = Math.min(last, k + 1) * 3, lo = i - 3;
      let tx = p[hi] - p[lo], ty = p[hi + 1] - p[lo + 1], tz = p[hi + 2] - p[lo + 2];
      const tl = Math.hypot(tx, ty, tz) || 1e-9; tx /= tl; ty /= tl; tz /= tl;
      let vx = p[i] - prev[i], vy = p[i + 1] - prev[i + 1], vz = p[i + 2] - prev[i + 2];
      this.water(p.subarray(i, i + 3), w);
      // Slip through the water, split along and across the link. Finer tips are lighter.
      const rx = w[0] * dt - vx, ry = w[1] * dt - vy, rz = w[2] * dt - vz, slip = rx * tx + ry * ty + rz * tz;
      const light = 1 + 0.6 * d, ka = 1 - Math.exp(-dt * along * light), kn = 1 - Math.exp(-dt * across * light);
      vx += tx * slip * ka + (rx - tx * slip) * kn;
      vy += ty * slip * ka + (ry - ty * slip) * kn - 0.04 * s / REFERENCE * dt * dt;
      vz += tz * slip * ka + (rz - tz * slip) * kn;
      prev[i] = p[i]; prev[i + 1] = p[i + 1]; prev[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy; p[i + 2] += vz;
    }
    const r = this.root(chain, this.root0);
    // The first links are clamped like a rod set into the margin: down and a little outward.
    const ca = Math.cos(chain.angle), sa = Math.sin(chain.angle), flare = oral ? 0.05 : 0.32;
    let hx = -b[3] * 0.9 + (b[0] * ca + b[6] * sa) * flare, hy = -b[4] * 0.9 + (b[1] * ca + b[7] * sa) * flare, hz = -b[5] * 0.9 + (b[2] * ca + b[8] * sa) * flare;
    const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    const bend = 1 - Math.exp(-dt * (oral ? 3.2 : 0.9) * chain.stiffness);
    for (let pass = 0; pass < 6; pass++) {
      p[0] = r[0]; p[1] = r[1]; p[2] = r[2];
      if (pass < 2) for (let k = 1; k <= 2; k++) {
        const i = k * 3, hold = (1 - Math.exp(-dt * (k === 1 ? 26 : 7))) * 0.5;
        p[i] += (r[0] + hx * rest * k - p[i]) * hold; p[i + 1] += (r[1] + hy * rest * k - p[i + 1]) * hold; p[i + 2] += (r[2] + hz * rest * k - p[i + 2]) * hold;
      }
      if (pass === 0) for (let k = 1; k < last; k++) {
        const i = k * 3, d = k / last, weight = bend * (1 - 0.5 * d);
        for (let axis = 0; axis < 3; axis++) p[i + axis] += ((p[i - 3 + axis] + p[i + 3 + axis]) * 0.5 - p[i + axis]) * weight;
      }
      for (let k = 1; k < NODES; k++) {
        const i = k * 3, a = i - 3, x = p[i] - p[a], y = p[i + 1] - p[a + 1], z = p[i + 2] - p[a + 2];
        const length = Math.hypot(x, y, z) || 1e-9, fix = (length - rest) / length, mine = k === 1 ? 1 : 0.5;
        p[i] -= x * fix * mine; p[i + 1] -= y * fix * mine; p[i + 2] -= z * fix * mine;
        if (k > 1) { p[a] += x * fix * 0.5; p[a + 1] += y * fix * 0.5; p[a + 2] += z * fix * 0.5; }
      }
    }
    p[0] = r[0]; p[1] = r[1]; p[2] = r[2]; prev[0] = r[0]; prev[1] = r[1]; prev[2] = r[2];
    // Nothing passes through the bell.
    for (let k = 2; k < NODES; k++) {
      const i = k * 3, x = p[i] - this.pos[0], y = p[i + 1] - this.pos[1], z = p[i + 2] - this.pos[2];
      const qx = (x * b[0] + y * b[1] + z * b[2]) / s, qy = (x * b[3] + y * b[4] + z * b[5]) / s + PIVOT, qz = (x * b[6] + y * b[7] + z * b[8]) / s;
      if (oral) {
        if (qy > 0.13) { const lift = (qy - 0.13) * s; for (let axis = 0; axis < 3; axis++) { p[i + axis] -= b[3 + axis] * lift; prev[i + axis] -= b[3 + axis] * lift * 0.7; } }
        continue;
      }
      if (k < 3 || qy < 0.25 || qy > 0.92) continue;
      const t = (qy - 0.10) / 0.82, radius = 0.92 * Math.sqrt(1 - t * t) * (1 - 0.38 * Math.max(0, this.meanC) * (1 - t)), rho = Math.hypot(qx, qz);
      if (rho >= radius) continue;
      const ox = rho > 1e-6 ? qx / rho : ca, oz = rho > 1e-6 ? qz / rho : sa, out = (radius - rho) * s;
      for (let axis = 0; axis < 3; axis++) { const move = (b[axis] * ox + b[6 + axis] * oz) * out; p[i + axis] += move; prev[i + axis] += move * 0.7; }
    }
    // Retraction and collision corrections can outrun the iterative solver. Limit
    // only excess length, carrying Verlet history along so the correction does
    // not create an artificial kick. Shorter links remain free to bend.
    for (let k = 1; k < NODES; k++) {
      const i = k * 3, a = i - 3;
      const x = p[i] - p[a], y = p[i + 1] - p[a + 1], z = p[i + 2] - p[a + 2];
      const length = Math.hypot(x, y, z);
      if (length > rest) {
        const fix = (length - rest) / length;
        for (let axis = 0; axis < 3; axis++) {
          const correction = (axis === 0 ? x : axis === 1 ? y : z) * fix;
          p[i + axis] -= correction;
          prev[i + axis] -= correction;
        }
      }
    }
  }

  sampleChain(chain, d, out, tangent) {
    const t = clamp(d, 0, 1) * (NODES - 1), k = Math.min(NODES - 2, Math.floor(t)), u = t - k, p = chain.points;
    for (let axis = 0; axis < 3; axis++) {
      const a = p[Math.max(0, k - 1) * 3 + axis], b = p[k * 3 + axis];
      const c = p[(k + 1) * 3 + axis], e = p[Math.min(NODES - 1, k + 2) * 3 + axis];
      out[axis] = 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u * u + (-a + 3 * b - 3 * c + e) * u * u * u);
      if (tangent) tangent[axis] = 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - e) * u + 3 * (-a + 3 * b - 3 * c + e) * u * u);
    }
    return out;
  }
}
