// /play/: a globe pin drop game. Bundled by esbuild into ../play/play.js.
//
// The globe is an orthographic projection drawn into a fixed 600x600 SVG
// viewBox, so every coordinate here is in viewBox units and CSS scales the
// whole thing to fit. d3-zoom owns the zoom level (wheel, pinch, and its
// internal gesture state); one-finger or mouse drags it reports are turned
// into rotation. Taps are detected separately with pointer events, so a drag
// of more than TAP_SLOP pixels never drops a pin.

import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoDistance, geoArea } from 'd3-geo';
import { select, pointer } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { feature } from 'topojson-client';

const SIZE = 600;
const RADIUS = 290;
const K_MIN = 1;
const K_MAX = 8;
const TAP_SLOP = 6;
const ROUNDS = 10;
const EARTH_KM = 6371;
const DEG = 180 / Math.PI;

const $ = (id) => document.getElementById(id);

// Screen reader announcements (a polite live region outside the screens, so
// it is in the page before anything is said into it).
function announce(text) {
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- scoring ----------

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const roundScore = (km) => Math.round(1000 * Math.exp(-km / 1500));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ---------- best scores (storage may be unavailable) ----------

function readBest(tier) {
  try {
    const v = parseInt(window.localStorage.getItem('play-best-' + tier), 10);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function writeBest(tier, total) {
  try {
    window.localStorage.setItem('play-best-' + tier, String(total));
  } catch (e) {
    // Private mode or blocked storage: the game still works, it just forgets.
  }
}

// ---------- globe ----------

const svgEl = $('globe');
const svg = select(svgEl);
const projection = geoOrthographic()
  .translate([SIZE / 2, SIZE / 2])
  .scale(RADIUS)
  .clipAngle(90)
  .precision(0)
  .rotate([80, -25]);
const path = geoPath(projection).digits(1);
const graticule = geoGraticule10();

const sea = svg.select('.sea');
const graticulePath = svg.select('.graticule');
const landPath = svg.select('.land');
const arcPath = svg.select('.arc');
const guessPin = svg.select('.pin-guess');
const answerPin = svg.select('.pin-answer');

// Land at several levels of detail. Projecting the full 1:50m coastline
// takes 20 ms or more a frame, too slow to drag smoothly on a phone, so
// motion draws a thinned copy and the full outline comes back at rest.
let land = null;   // { full, fine, coarse }
let moving = false;
let settle = 0;
let k = 1;
let rotation = [80, -25];
let guess = null;   // [lon, lat]
let answer = null;  // [lon, lat]
let arc = null;     // GeoJSON LineString
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
  if (land) landPath.attr('d', path(pickLand()));
  arcPath.attr('d', arc ? path(arc) : null);
  placePin(guessPin, guess);
  placePin(answerPin, answer);
}

function pickLand() {
  if (moving) return k < 2 ? land.coarse : land.fine;
  return k < 2 ? land.fine : land.full;
}

// Called for every frame of motion; the full-detail redraw waits until
// nothing has moved for a moment.
function markMoving() {
  moving = true;
  clearTimeout(settle);
  settle = setTimeout(() => { moving = false; schedule(); }, 160);
}

// Drop points closer than tol degrees to the last kept one. Rings that
// collapse below a triangle are removed (tiny islands vanish mid-drag only).
// Points on the poles and the antimeridian are always kept: Antarctica's
// ring runs along both, and losing them turns it inside out. Any polygon
// whose thinned area comes out larger than a hemisphere has been turned
// inside out anyway, so it falls back to the original.
function thin(multi, tol) {
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
    dropPin(pointer(e, svgEl));
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
    case 'Enter': case ' ': dropPin([SIZE / 2, SIZE / 2]); break;
    default: return;
  }
  cancelAnimationFrame(anim);
  e.preventDefault();
});

function dropPin([x, y]) {
  if (state !== 'guessing') return;
  const r = RADIUS * k;
  if (Math.hypot(x - SIZE / 2, y - SIZE / 2) > r) return;
  const lonlat = projection.invert([x, y]);
  if (!lonlat || !Number.isFinite(lonlat[0]) || !Number.isFinite(lonlat[1])) return;
  guess = lonlat;
  lockBtn.disabled = false;
  announce('Pin dropped. Lock in your guess, or drop the pin again.');
  schedule();
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

// ---------- game ----------

const screens = { start: $('screen-start'), round: $('screen-round'), end: $('screen-end') };
const lockBtn = $('lock');
const nextBtn = $('next');
const result = $('result');

let places = [];
let tier = null;
let deck = [];
let round = 0;
let history = [];
let state = 'idle';

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function refreshBest() {
  for (const el of document.querySelectorAll('[data-best]')) {
    const best = readBest(el.dataset.best);
    el.textContent = best === null ? 'Not played yet' : 'Best ' + fmt(best);
  }
}

function startGame(nextTier) {
  tier = nextTier;
  deck = shuffle(places.filter((p) => p.tier === tier)).slice(0, ROUNDS);
  history = [];
  round = 0;
  show('round');
  startRound();
}

function startRound() {
  const place = deck[round];
  state = 'guessing';
  guess = null;
  answer = null;
  arc = null;
  $('round-count').textContent = `Round ${round + 1} of ${ROUNDS}`;
  $('round-total').textContent = `Score ${fmt(history.reduce((s, h) => s + h.score, 0))}`;
  $('place-name').textContent = place.name;
  $('place-country').textContent = '';
  result.textContent = '';
  lockBtn.hidden = false;
  lockBtn.disabled = true;
  nextBtn.hidden = true;
  if (k !== 1) flyTo(center(), 1);
  schedule();
  announce(`Round ${round + 1} of ${ROUNDS}. Find ${place.name}.`);
  svgEl.focus({ preventScroll: true });
}

function lockIn() {
  if (state !== 'guessing' || !guess) return;
  state = 'revealed';
  const place = deck[round];
  answer = [place.lon, place.lat];
  arc = {
    type: 'LineString',
    coordinates: Array.from({ length: 65 }, (_, i) => geoInterpolate(guess, answer)(i / 64)),
  };
  const km = haversineKm(guess, answer);
  const score = roundScore(km);
  history.push({ place, km, score });

  $('place-country').textContent = place.country;
  $('round-total').textContent = `Score ${fmt(history.reduce((s, h) => s + h.score, 0))}`;
  result.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = `${fmt(km)} km`;
  result.append(strong, ` away, ${fmt(score)} ${score === 1 ? 'point' : 'points'}`);

  lockBtn.hidden = true;
  nextBtn.hidden = false;
  nextBtn.textContent = round + 1 === ROUNDS ? 'See results' : 'Next place';
  nextBtn.focus();

  // Frame both points: centre on the arc's midpoint and zoom so each end
  // sits inside roughly 80% of the viewBox's half-width.
  const half = geoDistance(guess, answer) / 2;
  const fit = (0.8 * SIZE / 2) / (RADIUS * Math.max(Math.sin(Math.min(half, Math.PI / 2)), 1e-3));
  flyTo(geoInterpolate(guess, answer)(0.5), Math.max(K_MIN, Math.min(K_MAX, fit)));
}

function next() {
  round += 1;
  if (round < ROUNDS) startRound();
  else endGame();
}

function endGame() {
  state = 'idle';
  const total = history.reduce((s, h) => s + h.score, 0);
  const prev = readBest(tier);
  if (prev === null || total > prev) writeBest(tier, total);
  $('end-total').textContent = `${fmt(total)} out of 10,000`;
  $('end-best').textContent = prev === null || total > prev
    ? 'That is your best score on this difficulty.'
    : `Your best on this difficulty is ${fmt(prev)}.`;

  const body = $('end-rows');
  body.textContent = '';
  for (const h of history) {
    const tr = document.createElement('tr');
    const place = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = h.place.name;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = h.place.country;
    place.append(name, where);
    const dist = document.createElement('td');
    dist.className = 'num';
    dist.textContent = `${fmt(h.km)} km`;
    const score = document.createElement('td');
    score.className = 'num';
    score.textContent = fmt(h.score);
    tr.append(place, dist, score);
    body.append(tr);
  }
  refreshBest();
  show('end');
  $('again').focus({ preventScroll: true });
}

lockBtn.addEventListener('click', lockIn);
nextBtn.addEventListener('click', next);
$('again').addEventListener('click', () => startGame(tier));
$('change').addEventListener('click', () => {
  show('start');
  document.querySelector('.tier').focus({ preventScroll: true });
});

// ---------- boot ----------

const tierButtons = document.querySelectorAll('.tier');
const status = $('load-status');

function setLoading(on, message) {
  for (const b of tierButtons) b.disabled = on;
  status.textContent = message || '';
}

setLoading(true, 'Loading the map');
refreshBest();

Promise.all([
  fetch('/play/land.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  fetch('/play/places.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
]).then(([topo, list]) => {
  const f = feature(topo, topo.objects.land);
  const g = f.features ? f.features[0].geometry : f.geometry;
  const full = g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g;
  land = { full, fine: thin(full, 0.1), coarse: thin(full, 0.3) };
  places = list;
  for (const b of tierButtons) b.addEventListener('click', () => startGame(b.dataset.tier));
  setLoading(false);
  render();
}).catch(() => {
  setLoading(true, 'The map did not load. Refresh the page to try again.');
});
