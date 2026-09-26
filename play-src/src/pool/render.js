import { R, L, W, POCKETS, HEAD_STRING } from './engine/table.js';
import { BALLS } from './engine/physics.js';

/**
 * Draws the table on a canvas. The simulation's table has x along its length
 * (0 at the head rail) and y across it, y up. In landscape x runs left to
 * right; in portrait the table stands up with the head rail at the bottom,
 * so the player breaks upward, as in GamePigeon.
 */

/**
 * Rail width as drawn, in metres. Phones in portrait get thin rails so the
 * cloth, and the balls on it, can be as large as the screen allows.
 */
export const RAIL = 0.055;
export const RAIL_COMPACT = 0.025;
/** The whole table as drawn, rails included, for a given rail width. */
export const outer = (rail) => ({ l: L + 2 * rail, w: W + 2 * rail });

const COLORS = {
  1: '#F2C21B', 2: '#1D4FC4', 3: '#D5281B', 4: '#5B2A8C', 5: '#EE7420', 6: '#157A3B', 7: '#7A1F1F', 8: '#141414',
};
const colorOf = (n) => COLORS[n > 8 ? n - 8 : n];

const INK = '#13233C';
const CLOTH = '#14675E';
const CLOTH_LINE = 'rgba(238,240,243,.16)';
const RAIL_WOOD = '#13233C';
const POCKET = '#070D17';
const PAPER = '#EEF0F3';
const GUIDE = 'rgba(238,240,243,.9)';
const GUIDE_SOFT = 'rgba(238,240,243,.55)';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.portrait = false;
    this.s = 1;
    this.dpr = 1;
    this.reducedMotion = false;
    this.rail = RAIL;
  }

  /** Size the backing store to the canvas's CSS box. */
  resize(portrait, rail = RAIL) {
    this.portrait = portrait;
    this.rail = rail;
    const { l: OUTER_L, w: OUTER_W } = outer(rail);
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.s = portrait ? rect.width / OUTER_W : rect.width / OUTER_L;
  }

  /** Table metres to CSS pixels. */
  toScreen(x, y) {
    const r = this.rail;
    if (this.portrait) return [(W - y + r) * this.s, (L - x + r) * this.s];
    return [(x + r) * this.s, (W - y + r) * this.s];
  }

  /** CSS pixels to table metres. */
  toTable(px, py) {
    const r = this.rail;
    if (this.portrait) return [L + r - py / this.s, W + r - px / this.s];
    return [px / this.s - r, W + r - py / this.s];
  }

  /** A direction in table space to screen space (unit vectors stay unit). */
  dirToScreen(dx, dy) {
    return this.portrait ? [-dy, -dx] : [dx, -dy];
  }

  /** Where each pocket is drawn: the hole centre and radius, in table metres. */
  holes() {
    // Thin rails leave less room behind the mouth, so the holes sit further in.
    const thin = this.rail < 0.04;
    return POCKETS.map((p, i) => {
      const corner = i !== 1 && i !== 4;
      const back = corner ? (thin ? 0.012 : 0.028) : thin ? 0.016 : 0.036;
      const r = corner ? (thin ? 0.05 : 0.058) : thin ? 0.046 : 0.052;
      return { x: p.mx + p.ox * back, y: p.my + p.oy * back, r };
    });
  }

  /**
   * Draw a frame. `view` holds: table ({on, x, y}), ghostCue (a cue ball
   * being placed: {x, y, ok}), guide (from aimGuide), aim ({x, y}) and
   * cue (whether to draw the stick, with pull 0..1), callPockets (true while
   * choosing the 8's pocket), called (pocket index), kitchen (show the head
   * string), highlight (ball numbers to ring: the legal targets).
   */
  draw(view) {
    const { ctx } = this;
    const s = this.s;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // Rails and cloth.
    ctx.save();
    ctx.fillStyle = RAIL_WOOD;
    roundRect(ctx, 0, 0, this.cssW, this.cssH, Math.min(0.035, this.rail * 0.7) * s);
    ctx.fill();
    // Everything else stays inside the table's outline (pockets included).
    ctx.clip();
    const [cx0, cy0] = this.toScreen(0, W);
    const [cx1, cy1] = this.toScreen(L, 0);
    const left = Math.min(cx0, cx1);
    const top = Math.min(cy0, cy1);
    ctx.fillStyle = CLOTH;
    ctx.fillRect(left, top, Math.abs(cx1 - cx0), Math.abs(cy1 - cy0));

    // Diamonds on the rails, and the head string.
    ctx.fillStyle = 'rgba(238,240,243,.55)';
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      for (const y of [-this.rail / 2, W + this.rail / 2]) this.dot((L * i) / 8, y, 0.006);
    }
    for (let i = 1; i < 4; i++) for (const x of [-this.rail / 2, L + this.rail / 2]) this.dot(x, (W * i) / 4, 0.006);
    if (view.kitchen) {
      ctx.strokeStyle = CLOTH_LINE;
      ctx.lineWidth = 1.5;
      this.line([[HEAD_STRING, 0], [HEAD_STRING, W]]);
    }

    // Pockets.
    const holes = this.holes();
    holes.forEach((h, i) => {
      ctx.fillStyle = POCKET;
      this.circle(h.x, h.y, h.r);
      ctx.fill();
      if (view.callPockets) {
        ctx.lineWidth = view.called === i ? 4 : 2;
        ctx.strokeStyle = view.called === i ? '#F2C21B' : PAPER;
        this.circle(h.x, h.y, h.r + 0.01);
        ctx.stroke();
        // The number sits on the cloth just inside the mouth, where thin rails never clip it.
        const k = POCKETS[i];
        this.label(k.mx - k.ox * 0.06, k.my - k.oy * 0.06, String(i + 1), 0.045, view.called === i ? '#F2C21B' : PAPER);
      }
    });

    // The guide goes under the balls.
    if (view.guide) this.drawGuide(view.guide);

    // Balls.
    const t = view.table;
    for (let n = 1; n < BALLS; n++) if (t.on[n]) this.ball(n, t.x[n], t.y[n], view.highlight?.includes(n));
    if (view.ghostCue) {
      ctx.globalAlpha = view.ghostCue.ok ? 1 : 0.45;
      this.ball(0, view.ghostCue.x, view.ghostCue.y, false);
      ctx.globalAlpha = 1;
      if (!view.ghostCue.ok) {
        ctx.strokeStyle = '#D5281B';
        ctx.lineWidth = 2;
        this.circle(view.ghostCue.x, view.ghostCue.y, R + 0.004);
        ctx.stroke();
      }
    } else if (t.on[0]) this.ball(0, t.x[0], t.y[0], false);

    if (view.cue && view.aim) this.drawCue(view.cueFrom ?? { x: t.x[0], y: t.y[0] }, view.aim, view.cue.pull ?? 0);
    ctx.restore();
  }

  drawGuide(g) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 1.5;
    if (g.cue.length) this.line(g.cue);
    if (g.ghost) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = GUIDE;
      this.circle(g.ghost.x, g.ghost.y, R);
      ctx.stroke();
    }
    if (g.object.length) {
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 2;
      this.line(g.object);
    }
    if (g.after.length) {
      ctx.strokeStyle = GUIDE_SOFT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      this.line(g.after);
      ctx.setLineDash([]);
    }
  }

  drawCue(from, aim, pull) {
    const { ctx } = this;
    const [bx, by] = this.toScreen(from.x, from.y);
    const [dx, dy] = this.dirToScreen(aim.x, aim.y);
    const gap = (R + 0.012 + pull * 0.12) * this.s;
    const len = 1.15 * this.s;
    const x0 = bx - dx * gap;
    const y0 = by - dy * gap;
    const x1 = x0 - dx * len;
    const y1 = y0 - dy * len;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#E8D3A6';
    ctx.lineWidth = Math.max(3, 0.011 * this.s);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // Tip and ferrule.
    ctx.strokeStyle = PAPER;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 - dx * 0.02 * this.s, y0 - dy * 0.02 * this.s);
    ctx.stroke();
    ctx.strokeStyle = '#2E6FB5';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 - dx * 0.006 * this.s, y0 - dy * 0.006 * this.s);
    ctx.stroke();
    // Butt.
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(4, 0.014 * this.s);
    ctx.beginPath();
    ctx.moveTo(x0 - dx * len * 0.7, y0 - dy * len * 0.7);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  /** One ball: solid colour, or white with a wide band for stripes; the number on a white disc. */
  ball(n, x, y, ring) {
    const { ctx } = this;
    const [px, py] = this.toScreen(x, y);
    const r = R * this.s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (n === 0) ctx.fillStyle = '#F7F5EE';
    else if (n > 8) ctx.fillStyle = '#F7F5EE';
    else ctx.fillStyle = colorOf(n);
    ctx.fill();
    if (n > 8) {
      // Stripe: a band across the middle, a little over half the ball's height.
      ctx.clip();
      ctx.fillStyle = colorOf(n);
      if (this.portrait) ctx.fillRect(px - r * 0.58, py - r, r * 1.16, r * 2);
      else ctx.fillRect(px - r, py - r * 0.58, r * 2, r * 1.16);
    }
    ctx.restore();
    // Outline, so white balls read on the cloth and dark ones on the pocket.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(7,13,23,.55)';
    ctx.beginPath();
    ctx.arc(px, py, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    if (n > 0) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0B1220';
      const size = Math.max(8, r * (n > 9 ? 0.78 : 0.9));
      ctx.font = `600 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), px, py + size * 0.04);
    }
    if (ring) {
      ctx.strokeStyle = 'rgba(242,194,27,.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  circle(x, y, r) {
    const [px, py] = this.toScreen(x, y);
    this.ctx.beginPath();
    this.ctx.arc(px, py, r * this.s, 0, Math.PI * 2);
  }

  dot(x, y, r) {
    this.circle(x, y, r);
    this.ctx.fill();
  }

  line(points) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const [px, py] = this.toScreen(x, y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  label(x, y, text, size, color) {
    const { ctx } = this;
    const [px, py] = this.toScreen(x, y);
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(11, size * this.s)}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px, py);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Pocket names as the player sees the table. Landscape: head rail on the
 * left; portrait: head rail at the bottom.
 */
export function pocketName(p, portrait) {
  const names = portrait
    ? ['bottom right corner', 'right side', 'top right corner', 'top left corner', 'left side', 'bottom left corner']
    : ['bottom left corner', 'bottom side', 'bottom right corner', 'top right corner', 'top side', 'top left corner'];
  return names[p];
}
