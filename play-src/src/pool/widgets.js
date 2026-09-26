/**
 * The spin picker (a cue ball with a dot for the tip) and the fine-aim
 * wheel. Both are canvases, so nothing needs an inline style; each keeps its
 * ARIA value in step with what it draws.
 */

function fit(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

/** Words for a tip position: side and top each in -1..1. */
export function spinWords(side, top) {
  const parts = [];
  const pct = (v) => `${Math.round(Math.abs(v) * 100)}%`;
  if (Math.abs(top) >= 0.05) parts.push(`${pct(top)} ${top > 0 ? 'follow' : 'draw'}`);
  if (Math.abs(side) >= 0.05) parts.push(`${pct(side)} ${side > 0 ? 'right' : 'left'}`);
  return parts.length ? parts.join(', ') : 'none';
}

export function drawSpinBall(canvas, side, top, big) {
  const { ctx, w, h } = fit(canvas);
  const r = Math.min(w, h) / 2 - 1;
  // Not laid out yet (its panel or screen is hidden): nothing to draw.
  if (r <= 0) return;
  const cx = w / 2;
  const cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#F7F5EE';
  ctx.strokeStyle = '#13233C';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (big) {
    // Cross hairs and the half-radius limit ring.
    ctx.strokeStyle = 'rgba(19,35,60,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The dot's travel is capped at half the radius, drawn to scale.
  const dx = cx + side * r * 0.5;
  const dy = cy - top * r * 0.5;
  ctx.fillStyle = '#A4210F';
  ctx.beginPath();
  ctx.arc(dx, dy, big ? 9 : 4.5, 0, Math.PI * 2);
  ctx.fill();
}

/** A pointer position on the spin ball as (side, top), clamped to the unit disc. */
export function spinFromPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const r = Math.min(rect.width, rect.height) / 2 - 1;
  let side = (clientX - rect.left - rect.width / 2) / (r * 0.5);
  let top = -(clientY - rect.top - rect.height / 2) / (r * 0.5);
  const m = Math.hypot(side, top);
  if (m > 1) {
    side /= m;
    top /= m;
  }
  return { side, top };
}

/** The wheel: ridges that slide as the aim turns, like GamePigeon's. */
export function drawWheel(canvas, angle, active) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = active ? '#13233C' : '#4A5870';
  ctx.fillRect(0, 0, w, h);
  const spacing = 9;
  const offset = ((angle * 900) % spacing + spacing) % spacing;
  for (let x = -spacing + offset; x < w + spacing; x += spacing) {
    // Brighter ridges in the middle, as if the wheel were round.
    const t = 1 - Math.abs(x - w / 2) / (w / 2);
    ctx.fillStyle = `rgba(238,240,243,${0.12 + 0.5 * Math.max(0, t)})`;
    ctx.fillRect(x, 5, 2, h - 10);
  }
}
