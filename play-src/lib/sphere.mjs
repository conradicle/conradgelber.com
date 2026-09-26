// Great-circle math for /flight-path/, used by scripts/build-routes.mjs and
// the tests. Everything works on 3D unit vectors, so longitude wrap-around
// (the antimeridian) and the poles need no special cases.
//
// Country outlines are treated the way d3-geo treats them: each edge
// between two vertices is itself a great-circle arc.

export const EARTH_KM = 6371;
const RAD = Math.PI / 180;

export function toVec([lon, lat]) {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

export function toLonLat([x, y, z]) {
  return [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z))) / RAD];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

// Angle in radians between two unit vectors, accurate at every size.
export function angle(a, b) {
  return Math.atan2(len(cross(a, b)), dot(a, b));
}

export function distanceKm(a, b) {
  return EARTH_KM * angle(toVec(a), toVec(b));
}

// Points along the great circle from a to b ([lon, lat] each), n + 1 of them.
export function greatCirclePoints(a, b, n) {
  const va = toVec(a);
  const vb = toVec(b);
  const w = angle(va, vb);
  const s = Math.sin(w);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = s < 1e-12 ? va : [0, 1, 2].map((j) =>
      (Math.sin((1 - t) * w) * va[j] + Math.sin(t * w) * vb[j]) / s);
    out.push(toLonLat(p));
  }
  return out;
}

// A route from a to b, ready to test against many edges.
export function makeArc(a, b) {
  const va = toVec(a);
  const vb = toVec(b);
  const n = cross(va, vb);
  if (len(n) < 1e-12) throw new Error('route endpoints are the same or antipodal');
  return { a: va, b: vb, n: unit(n), w: angle(va, vb) };
}

// Where the minor arc c-d crosses the route, as a fraction of the route's
// length, or -1 if it does not. An edge that only touches the route at a
// vertex counts on one side only (half-open test), so a route passing
// exactly through a shared vertex is not counted twice.
function crossAt(arc, c, d) {
  const sc = dot(arc.n, c);
  const sd = dot(arc.n, d);
  if ((sc > 0 && sd > 0) || (sc <= 0 && sd <= 0)) return -1;
  // The point on c-d that lies on the route's great circle.
  const f = sc / (sc - sd);
  const p = unit([c[0] + f * (d[0] - c[0]), c[1] + f * (d[1] - c[1]), c[2] + f * (d[2] - c[2])]);
  // It has to fall between a and b on the route.
  if (dot(cross(arc.a, p), arc.n) < 0 || dot(cross(p, arc.b), arc.n) < 0) return -1;
  return angle(arc.a, p) / arc.w;
}

// Prepare a GeoJSON Polygon or MultiPolygon: every ring as unit vectors,
// with a bounding cap (centre and cosine of its angular radius) so most
// rings can be skipped without looking at their edges.
export function prepare(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map(toVec);
      let sum = [0, 0, 0];
      for (const p of pts) sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
      const c = len(sum) < 1e-9 ? pts[0] : unit(sum);
      let cosr = 1;
      for (const p of pts) cosr = Math.min(cosr, dot(c, p));
      rings.push({ pts, c, cosr: cosr - 1e-9 });
    }
  }
  return rings;
}

// Could the route come within a ring's bounding cap?
function nearCap(arc, ring) {
  const { c, cosr } = ring;
  if (dot(arc.a, c) >= cosr || dot(arc.b, c) >= cosr) return true;
  // Closest point to c on the route's great circle, if it lies on the route.
  const d = dot(c, arc.n);
  const q = [c[0] - d * arc.n[0], c[1] - d * arc.n[1], c[2] - d * arc.n[2]];
  const l = len(q);
  if (l < 1e-12) return false;
  const p = [q[0] / l, q[1] / l, q[2] / l];
  if (dot(cross(arc.a, p), arc.n) < 0 || dot(cross(p, arc.b), arc.n) < 0) return false;
  return dot(p, c) >= cosr;
}

// Every place the route crosses the outline of `rings`, sorted, as
// fractions of the route's length.
export function crossings(arc, rings) {
  const ts = [];
  for (const ring of rings) {
    if (!nearCap(arc, ring)) continue;
    const p = ring.pts;
    for (let i = 1; i < p.length; i++) {
      const t = crossAt(arc, p[i - 1], p[i]);
      if (t >= 0) ts.push(t);
    }
  }
  return ts.sort((x, y) => x - y);
}

const AXES = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

// Is the point inside `rings`? Even-odd rule, so the winding order of the
// rings does not matter (some Natural Earth rings are wound backwards). Each
// ring is tested on its own, along an arc from the point to a reference
// point outside that ring's cap, and the answers are combined with XOR,
// which is what even-odd over all the rings together comes to.
export function contains(rings, lonlat) {
  const p = toVec(lonlat);
  let inside = false;
  for (const ring of rings) {
    if (dot(p, ring.c) < ring.cosr) continue;
    const ref = [[-ring.c[0], -ring.c[1], -ring.c[2]], ...AXES].find((r) =>
      dot(r, ring.c) < ring.cosr && Math.abs(dot(p, r)) < 0.999);
    if (!ref) throw new Error('no reference point outside a ring');
    const arc = { a: p, b: ref, n: unit(cross(p, ref)), w: angle(p, ref) };
    if (crossings(arc, [ring]).length % 2 === 1) inside = !inside;
  }
  return inside;
}

// The stretches of the route that lie over `rings`, as [t0, t1] fractions of
// its length. `startInside` says whether the route's first point is inside.
export function intervals(arc, rings, startInside) {
  const ts = crossings(arc, rings);
  const out = [];
  let inside = startInside;
  let from = 0;
  for (const t of ts) {
    if (inside) out.push([from, t]);
    inside = !inside;
    from = t;
  }
  if (inside) out.push([from, 1]);
  return out;
}

// Union of several interval lists, merged and sorted.
export function union(...lists) {
  const all = lists.flat().sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Intervals in `list` with anything in `minus` taken out.
export function subtract(list, minus) {
  let out = list.map((x) => x.slice());
  for (const [m0, m1] of minus) {
    const next = [];
    for (const [a, b] of out) {
      if (m1 <= a || m0 >= b) { next.push([a, b]); continue; }
      if (m0 > a) next.push([a, m0]);
      if (m1 < b) next.push([m1, b]);
    }
    out = next;
  }
  return out;
}

// Total length in km of a list of intervals on a route.
export function lengthKm(arc, list) {
  return list.reduce((s, [a, b]) => s + (b - a), 0) * arc.w * EARTH_KM;
}
