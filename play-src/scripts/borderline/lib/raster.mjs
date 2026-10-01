// Pixel-level judging of crops. A crop state is painted into an id buffer
// (-1 sea, 0 land with no unit, 1.. a region per unit) at the frame size the
// player sees; two states differ visibly when the patch of changed pixels,
// after a 3 x 3 opening, is large enough. Comparing partitions (who shares
// a border with whom) instead of unit codes means a unit that changes its
// code without moving a border is not a change; its label still can be.
import { geoPath } from 'd3-geo';

export const SEA = -1;
export const BLANK = 0;

/** Projected rings of a GeoJSON geometry, in frame pixels. */
export function projectRings(geom, projection) {
  const rings = [];
  let cur = null;
  const ctx = {
    moveTo(x, y) { cur = [x, y]; rings.push(cur); },
    lineTo(x, y) { cur.push(x, y); },
    closePath() {},
    arc() {},
  };
  geoPath(projection, ctx)(geom);
  return rings.filter((r) => r.length >= 6);
}

/** Even-odd scanline fill of flat rings [x0,y0,x1,y1,...] with value v. */
export function fillRings(buf, W, H, rings, v) {
  const edges = [];
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let x0 = r[2 * i], y0 = r[2 * i + 1], x1 = r[2 * j], y1 = r[2 * j + 1];
      if (y0 === y1) continue;
      if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
      if (y1 < 0 || y0 > H) continue;
      edges.push({ y0, y1, x0, k: (x1 - x0) / (y1 - y0) });
    }
  }
  if (!edges.length) return;
  edges.sort((a, b) => a.y0 - b.y0);
  let next = 0;
  let active = [];
  const xs = [];
  for (let row = 0; row < H; row++) {
    const y = row + 0.5;
    while (next < edges.length && edges[next].y0 <= y) active.push(edges[next++]);
    if (!active.length) { if (next >= edges.length) break; continue; }
    active = active.filter((e) => e.y1 > y);
    xs.length = 0;
    for (const e of active) if (e.y0 <= y) xs.push(e.x0 + (y - e.y0) * e.k);
    xs.sort((a, b) => a - b);
    const base = row * W;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let a = Math.ceil(xs[i] - 0.5);
      let b = Math.ceil(xs[i + 1] - 0.5);
      if (a < 0) a = 0;
      if (b > W) b = W;
      for (let x = a; x < b; x++) buf[base + x] = v;
    }
  }
}

/**
 * Pair every region of `a` with at most one region of `b` (largest
 * overlaps first). Pixels whose (a, b) pair is not matched are changed.
 */
export function matchRegions(a, b) {
  const counts = new Map();
  for (let i = 0; i < a.length; i++) {
    const k = (a[i] + 1) * 65536 + (b[i] + 1);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const pairs = [...counts].sort((p, q) => q[1] - p[1]);
  const usedA = new Set();
  const usedB = new Set();
  const matched = new Set();
  const aToB = new Map();
  for (const [k] of pairs) {
    const ra = Math.floor(k / 65536) - 1;
    const rb = (k % 65536) - 1;
    if (usedA.has(ra) || usedB.has(rb)) continue;
    usedA.add(ra); usedB.add(rb); matched.add(k); aToB.set(ra, rb);
  }
  return { matched, aToB, counts };
}

/**
 * Largest connected patch of changed pixels between two states after a
 * 3 x 3 opening, with the (a, b) pair that dominates it.
 */
export function largestChange(a, b, W, H, match = matchRegions(a, b)) {
  const n = W * H;
  const mask = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (!match.matched.has((a[i] + 1) * 65536 + (b[i] + 1))) { mask[i] = 1; any = true; }
  }
  if (!any) return { area: 0, pair: null, match };
  // Erode: keep a pixel only if its 3 x 3 neighbourhood is all changed.
  // Outside the frame counts as changed, so edge patches are not shaved.
  const er = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (!mask[yy * W + xx]) { ok = 0; break; }
        }
      }
      er[i] = ok;
    }
  }
  // Dilate back.
  const op = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!er[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W) op[yy * W + xx] = mask[yy * W + xx];
        }
      }
    }
  }
  // Connected patches (4-neighbour) and the biggest one.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = 0;
  let bestPairs = null;
  for (let s = 0; s < n; s++) {
    if (!op[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    let area = 0;
    const pc = new Map();
    while (top) {
      const i = stack[--top];
      area++;
      const k = (a[i] + 1) * 65536 + (b[i] + 1);
      pc.set(k, (pc.get(k) || 0) + 1);
      const x = i % W;
      if (x > 0 && op[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < W - 1 && op[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= W && op[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[top++] = i - W; }
      if (i < n - W && op[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[top++] = i + W; }
    }
    if (area > best) { best = area; bestPairs = pc; }
  }
  // The patch's (a, b) pairs, most pixels first.
  const pairs = bestPairs
    ? [...bestPairs].sort((p, q) => q[1] - p[1]).map(([k, c]) => [Math.floor(k / 65536) - 1, (k % 65536) - 1, c])
    : [];
  return { area: best, pair: pairs[0] || null, pairs, match };
}

/** Pixel count per region id. */
export function regionAreas(buf) {
  const m = new Map();
  for (let i = 0; i < buf.length; i++) m.set(buf[i], (m.get(buf[i]) || 0) + 1);
  return m;
}

/** Region adjacency (4-neighbour), for colouring. */
export function adjacency(buf, W, H) {
  const adj = new Map();
  const link = (p, q) => {
    if (p <= 0 || q <= 0 || p === q) return;
    if (!adj.has(p)) adj.set(p, new Set());
    if (!adj.has(q)) adj.set(q, new Set());
    adj.get(p).add(q); adj.get(q).add(p);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x + 1 < W) link(buf[i], buf[i + 1]);
      if (y + 1 < H) link(buf[i], buf[i + W]);
    }
  }
  return adj;
}
