// The globe shared by /play/ and /flight-path/.
//
// An orthographic projection drawn into a fixed 600x600 SVG viewBox, so
// every coordinate here is in viewBox units and CSS scales the whole thing
// to fit. d3-zoom owns the zoom level (wheel, pinch, and its internal
// gesture state); one-finger or mouse drags it reports are turned into
// rotation. Taps are detected separately with pointer events, so a drag of
// more than TAP_SLOP pixels never counts as a tap.
//
// The SVG must contain a .sea circle, a .graticule path and a .land path.
// Anything else a game draws goes in its draw() hook, which runs at the end
// of every render.

import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoDistance, geoArea } from 'd3-geo';
import { select, pointer } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

export const SIZE = 600;
export const RADIUS = 290;
export const K_MIN = 1;
export const K_MAX = 8;
const TAP_SLOP = 6;
const DEG = 180 / Math.PI;

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Drop points closer than tol degrees to the last kept one. Rings that
// collapse below a triangle are removed (tiny islands vanish mid-drag only).
// Points on the poles and the antimeridian are always kept: Antarctica's
// ring runs along both, and losing them turns it inside out. Any polygon
// whose thinned area comes out larger than a hemisphere has been turned
// inside out anyway, so it falls back to the original.
export function thin(multi, tol) {
  const t2 = tol * tol;
  const ring = (r) => {
    const out = [r[0]];
    let [a, b] = r[0];
    for (let i = 1; i < r.length - 1; i++) {
      const [x, y] = r[i];
      const dx = (x - a) * Math.cos(y * Math.PI / 180);
      const dy = y - b;
      const edge = Math.abs(y) > 89.9 || Math.abs(x) > 179.9;
      if (edge || dx * dx + dy * dy >= t2) { out.push(r[i]); a = x; b = y; }
    }
    out.push(r[r.length - 1]);
    return out.length >= 4 ? out : null;
  };
  return {
    type: 'MultiPolygon',
    coordinates: multi.coordinates
      .map((poly) => {
        const thinned = poly.map(ring);
        if (!thinned[0]) return null;
        const out = thinned.filter(Boolean);
        return geoArea({ type: 'Polygon', coordinates: out }) > 2 * Math.PI ? poly : out;
      })
      .filter(Boolean),
  };
}

// A geometry at three levels of detail: { full, fine, coarse }.
export function levels(multi) {
  return { full: multi, fine: thin(multi, 0.1), coarse: thin(multi, 0.3) };
}

// svgEl: the globe's <svg>. options:
//   rotation  starting [lambda, phi] rotation
//   onTap     called with [x, y] in viewBox units for a tap or click, and
//             with the centre for Enter or Space
//   draw      called at the end of every render
export function createGlobe(svgEl, { rotation: start, onTap, draw }) {
  const svg = select(svgEl);
  const projection = geoOrthographic()
    .translate([SIZE / 2, SIZE / 2])
    .scale(RADIUS)
    .clipAngle(90)
    .precision(0)
    .rotate(start);
  const path = geoPath(projection).digits(1);
  const graticule = geoGraticule10();

  const sea = svg.select('.sea');
  const graticulePath = svg.select('.graticule');
  const landPath = svg.select('.land');

  // Land at several levels of detail. Projecting the full 1:50m coastline
  // takes 20 ms or more a frame, too slow to drag smoothly on a phone, so
  // motion draws a thinned copy and the full outline comes back at rest.
  let land = null;   // { full, fine, coarse }
  let moving = false;
  let settle = 0;
  let k = 1;
  let rotation = start;
  let frame = 0;
  let anim = 0;

  function center() {
    return [-rotation[0], -rotation[1]];
  }

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    projection.rotate(rotation).scale(RADIUS * k);
    sea.attr('r', RADIUS * k);
    graticulePath.attr('d', path(graticule));
    if (land) landPath.attr('d', path(pick(land)));
    if (draw) draw();
  }

  // Which of a { full, fine, coarse } set to draw right now.
  function pick(set) {
    if (moving) return k < 2 ? set.coarse : set.fine;
    return k < 2 ? set.fine : set.full;
  }

  // Called for every frame of motion; the full-detail redraw waits until
  // nothing has moved for a moment.
  function markMoving() {
    moving = true;
    clearTimeout(settle);
    settle = setTimeout(() => { moving = false; schedule(); }, 160);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function placePin(sel, lonlat) {
    const visible = lonlat && geoDistance(lonlat, center()) < Math.PI / 2 - 1e-6;
    sel.classed('off', !visible);
    if (visible) {
      const [x, y] = projection(lonlat);
      sel.attr('transform', `translate(${x.toFixed(2)},${y.toFixed(2)})`);
    }
  }

  function rotateBy(dx, dy) {
    markMoving();
    const f = DEG / (RADIUS * k);
    rotation = [
      rotation[0] + dx * f,
      Math.max(-90, Math.min(90, rotation[1] - dy * f)),
    ];
    schedule();
  }

  // Zoom: d3-zoom tracks k. Its translate is ignored except as a source of
  // drag deltas, and pinches and wheel steps never rotate the globe.
  let last = zoomIdentity;
  let syncing = false;
  const zoom = d3zoom()
    .scaleExtent([K_MIN, K_MAX])
    .clickDistance(TAP_SLOP)
    .on('zoom', (event) => {
      const t = event.transform;
      const src = event.sourceEvent;
      if (!syncing && src && (src.type === 'mousemove' ||
          (src.type === 'touchmove' && src.touches.length === 1))) {
        rotateBy(t.x - last.x, t.y - last.y);
      }
      last = t;
      if (t.k !== k) {
        k = t.k;
        markMoving();
        schedule();
      }
    });
  svg.call(zoom).on('dblclick.zoom', null);

  function setZoom(nextK) {
    syncing = true;
    svg.call(zoom.transform, zoomIdentity.translate(last.x, last.y).scale(nextK));
    syncing = false;
  }

  // Taps: pointer events run alongside d3-zoom's mouse and touch listeners.
  const pointers = new Map();
  let tap = null;

  // Any direct input takes over from a running flyTo().
  svgEl.addEventListener('wheel', () => cancelAnimationFrame(anim), { passive: true });

  svgEl.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, true);
    tap = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 } : null;
  });
  svgEl.addEventListener('pointermove', (e) => {
    if (tap && e.pointerId === tap.id) {
      tap.moved = Math.max(tap.moved, Math.hypot(e.clientX - tap.x, e.clientY - tap.y));
    }
  });
  svgEl.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (tap && e.pointerId === tap.id && tap.moved < TAP_SLOP) {
      if (onTap) onTap(pointer(e, svgEl));
    }
    tap = null;
  });
  svgEl.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    tap = null;
  });

  svgEl.addEventListener('keydown', (e) => {
    const step = 12;
    switch (e.key) {
      case 'ArrowLeft': rotateBy(step, 0); break;
      case 'ArrowRight': rotateBy(-step, 0); break;
      case 'ArrowUp': rotateBy(0, step); break;
      case 'ArrowDown': rotateBy(0, -step); break;
      case '+': case '=': setZoom(Math.min(K_MAX, k * 1.4)); break;
      case '-': case '_': setZoom(Math.max(K_MIN, k / 1.4)); break;
      case 'Enter': case ' ':
        if (!onTap) return;
        onTap([SIZE / 2, SIZE / 2]);
        break;
      default: return;
    }
    cancelAnimationFrame(anim);
    e.preventDefault();
  });

  // The point under [x, y] in viewBox units, or null if it is off the globe.
  function invert([x, y]) {
    const r = RADIUS * k;
    if (Math.hypot(x - SIZE / 2, y - SIZE / 2) > r) return null;
    const lonlat = projection.invert([x, y]);
    if (!lonlat || !Number.isFinite(lonlat[0]) || !Number.isFinite(lonlat[1])) return null;
    return lonlat;
  }

  // Turn the globe to `target` ([lon, lat]) and zoom to `targetK`, along the
  // great circle. With reduced motion the view jumps straight there.
  function flyTo(target, targetK) {
    cancelAnimationFrame(anim);
    if (reduceMotion.matches) {
      rotation = [-target[0], -target[1]];
      setZoom(targetK);
      schedule();
      return;
    }
    const from = center();
    const interp = geoInterpolate(from, target);
    const k0 = k;
    const ms = 400 + 900 * Math.min(1, geoDistance(from, target) / Math.PI);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const c = interp(e);
      rotation = [-c[0], -c[1]];
      markMoving();
      setZoom(k0 * Math.pow(targetK / k0, e));
      render();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // Centre on the midpoint of a and b and zoom so each sits inside roughly
  // `share` of the viewBox's half-width.
  function frameBetween(a, b, share = 0.8) {
    const half = geoDistance(a, b) / 2;
    const fit = (share * SIZE / 2) / (RADIUS * Math.max(Math.sin(Math.min(half, Math.PI / 2)), 1e-3));
    flyTo(geoInterpolate(a, b)(0.5), Math.max(K_MIN, Math.min(K_MAX, fit)));
  }

  return {
    projection,
    path,
    render,
    schedule,
    pick,
    placePin,
    invert,
    flyTo,
    frameBetween,
    setZoom,
    center,
    setLand(multi) { land = levels(multi); },
    get k() { return k; },
  };
}
