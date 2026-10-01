// Places country labels on a painted crop: each region gets the largest
// font (between LABEL_MIN and LABEL_MAX) whose text box sits at least 90%
// inside the region and clear of labels already placed. Bigger regions go
// first. Long multi-word names may break onto two lines.
import { LABEL_ADVANCE, LABEL_MIN } from '../config.mjs';

const NARROW = new Set([...' .,\'-()I']);
const WIDE = new Set([...'MW']);

/** Width of upper-case text in em, before the font size. */
export function textEm(s) {
  let w = 0;
  for (const ch of s) w += NARROW.has(ch) ? 0.45 : WIDE.has(ch) ? 1.3 : 1;
  return w * LABEL_ADVANCE;
}

// Line boxes: cap height is about 0.72 em; lines are 1.05 em apart.
const boxH = (size, lines) => size * (0.72 + (lines - 1) * 1.05);

function splits(text) {
  const out = [[text]];
  const words = text.split(' ');
  if (words.length < 2) return out;
  for (let i = 1; i < words.length; i++) {
    out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  }
  return out;
}

/**
 * @param {Int16Array} buf painted crop
 * @param {{id:number, text:string, area:number}[]} regions
 * @returns {Map<number, {lines:string[], x:number, y:number, size:number, w:number}>}
 */
export function placeLabels(buf, W, H, regions, maxSize) {
  const placed = new Map();
  const boxes = [];
  const order = [...regions].sort((p, q) => q.area - p.area);
  for (const r of order) {
    if (r.area < 150 || !r.text.trim()) continue;
    // Integral image of this region.
    const ii = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rowSum = 0;
      for (let x = 0; x < W; x++) {
        if (buf[y * W + x] === r.id) rowSum++;
        ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + rowSum;
      }
    }
    const inside = (x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
      if (x1 <= x0 || y1 <= y0) return 0;
      const s = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
      return s / ((x1 - x0) * (y1 - y0));
    };
    // Candidate centres: a grid over the region.
    const cands = [];
    let cx = 0, cy = 0;
    for (let y = 4; y < H - 4; y += 3) {
      for (let x = 4; x < W - 4; x += 3) {
        if (buf[y * W + x] === r.id) { cands.push([x, y]); cx += x; cy += y; }
      }
    }
    if (!cands.length) continue;
    cx /= cands.length; cy /= cands.length;
    let best = null;
    for (const lines of splits(r.text)) {
      const em = Math.max(...lines.map(textEm));
      for (const [x, y] of cands) {
        let lo = LABEL_MIN, hi = maxSize, fit = 0;
        const fits = (size) => {
          const w = em * size, h = boxH(size, lines.length);
          const x0 = x - w / 2 - 2, x1 = x + w / 2 + 2, y0 = y - h / 2 - 2, y1 = y + h / 2 + 2;
          if (x0 < 2 || y0 < 2 || x1 > W - 2 || y1 > H - 2) return false;
          if (inside(x0, y0, x1, y1) < 0.9) return false;
          for (const b of boxes) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
          return true;
        };
        if (!fits(lo)) continue;
        while (hi - lo > 0.5) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid; else hi = mid;
        }
        if (fits(hi)) lo = hi;
        fit = Math.floor(lo * 2) / 2;
        // Prefer bigger type, then one line, then the middle of the region.
        const score = fit * (lines.length === 1 ? 1 : 0.92) - Math.hypot(x - cx, y - cy) * 1e-3;
        if (!best || score > best.score) best = { score, lines, x, y, size: fit, w: em * fit };
      }
    }
    if (!best) continue;
    const h = boxH(best.size, best.lines.length);
    boxes.push([best.x - best.w / 2 - 3, best.y - h / 2 - 3, best.x + best.w / 2 + 3, best.y + h / 2 + 3]);
    placed.set(r.id, { lines: best.lines, x: best.x, y: best.y, size: best.size, w: Math.round(best.w * 10) / 10 });
  }
  return placed;
}
