// The twelve-spoke radar, as SVG markup for a viewBox of W x H. Spokes run
// in display order, clockwise from the top; each is labeled with its axis's
// left pole, and a point's distance from the centre is that pole's share.
import { AXES, DISPLAY_ORDER } from './axes.js';

export const W = 640;
export const H = 470;
const CX = W / 2;
const CY = H / 2;
const R = 150;
const LABEL_R = R + 16;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n) => n.toFixed(1);

function at(i, r) {
  const t = (-90 + i * (360 / DISPLAY_ORDER.length)) * (Math.PI / 180);
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}

// series: [{ scores: number[12] (indexed by axis), cls: 'a' | 'b' }]
export function radarMarkup(series) {
  const n = DISPLAY_ORDER.length;
  let out = '';
  for (const p of [25, 50, 75, 100]) {
    const pts = DISPLAY_ORDER.map((_, i) => at(i, (R * p) / 100).map(f).join(',')).join(' ');
    out += `<polygon class="ring${p === 50 ? ' ring-mid' : ''}" points="${pts}"/>`;
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, R);
    out += `<line class="spoke" x1="${CX}" y1="${CY}" x2="${f(x)}" y2="${f(y)}"/>`;
    const [lx, ly] = at(i, LABEL_R);
    const c = Math.cos((-90 + i * (360 / n)) * (Math.PI / 180));
    const s = Math.sin((-90 + i * (360 / n)) * (Math.PI / 180));
    const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
    const dy = s > 0.5 ? '1em' : s < -0.5 ? '-0.25em' : '0.35em';
    out += `<text class="label" x="${f(lx)}" y="${f(ly)}" dy="${dy}" text-anchor="${anchor}">${esc(AXES[DISPLAY_ORDER[i]].left)}</text>`;
  }
  for (const { scores, cls } of series) {
    const pts = DISPLAY_ORDER.map((ax, i) => at(i, (R * scores[ax]) / 100));
    out += `<polygon class="shape shape-${cls}" points="${pts.map((p) => p.map(f).join(',')).join(' ')}"/>`;
    for (const [x, y] of pts) {
      out += cls === 'b'
        ? `<rect class="dot-b" x="${f(x - 4.5)}" y="${f(y - 4.5)}" width="9" height="9"/>`
        : `<circle class="dot-a" cx="${f(x)}" cy="${f(y)}" r="5"/>`;
    }
  }
  return out;
}

// Plain-text description for the radar's accessible name.
export function radarSummary(scores) {
  return DISPLAY_ORDER.map((ax) => `${AXES[ax].left} ${Math.round(scores[ax])}%`).join(', ');
}
