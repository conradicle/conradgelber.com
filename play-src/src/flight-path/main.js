// /flight-path/: name every country on the great-circle route between two
// cities. Bundled by esbuild into ../flight-path/flight-path.js.
//
// The globe comes from ../globe.js (shared with /play/). Which countries a
// route crosses was worked out ahead of time against Natural Earth's 1:10m
// boundaries (scripts/build-routes.mjs); the 1:50m shapes loaded here are
// only for drawing.

import { geoContains, geoCentroid, geoArea, geoDistance } from 'd3-geo';
import { select } from 'd3-selection';
import { feature, mesh } from 'topojson-client';
import { createGlobe, levels, reduceMotion } from '../globe.js';
import { gameName, CARVE } from '../../lib/countries.mjs';
import { greatCirclePoints } from '../../lib/sphere.mjs';
import {
  parseData, BANDS, buildLookup, suggestionIndex, suggest, createRound, judge, isComplete, pickRoute,
} from './logic.js';
import { createCombobox } from './combobox.js';

const RECENT = 40;
const ARC_POINTS = 256;
const ARC_MS = 1400;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Screen reader announcements (a polite live region outside the screens, so
// it is in the page before anything is said into it).
function announce(text) {
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

// ---------- state ----------

let data = null;          // parseData(routes.json)
let lookup = null;        // normalized name -> [country]
let suggestions = null;   // type-ahead index
let shapes = null;        // country -> { geometry, polys, lod }
let borders = null;       // MultiLineString of shared borders
let band = null;
let recent = [];
let round = null;
let revealed = false;
let arcShown = null;      // GeoJSON LineString drawn so far
let markers = [];         // [{ lonlat, kind }]
let arcAnim = 0;

// ---------- globe ----------

const svgEl = $('globe');
const svg = select(svgEl);
const bordersPath = svg.select('.borders');
const shapeLayer = svg.select('.shapes');
const arcPath = svg.selectAll('.arc-casing, .route-arc');
const markerLayer = svg.select('.markers');
const fromPin = svg.select('.pin-from');
const toPin = svg.select('.pin-to');

const globe = createGlobe(svgEl, {
  rotation: [-20, -30],
  draw,
});

// Which countries are colored, and how. Later entries paint over earlier
// ones, and a place carved out of another country (Western Sahara from
// Morocco) is painted after it, in its own state or plain land.
function highlights() {
  if (!round) return [];
  const out = [];
  const add = (name, kind) => { if (shapes.has(name)) out.push({ name, kind }); };
  add(round.route.from.country, 'endpoint');
  add(round.route.to.country, 'endpoint');
  for (const name of round.route.countries) {
    if (round.found.includes(name)) add(name, 'found');
    else if (revealed) add(name, 'missed');
  }
  for (const name of round.wrong) add(name, 'wrong');
  for (const [keep, from] of CARVE) {
    if (out.some((h) => h.name === from) && !out.some((h) => h.name === keep)) add(keep, 'plain');
  }
  const order = (h) => CARVE.findIndex(([keep]) => keep === h.name);
  return out.sort((a, b) => order(a) - order(b));
}

// True while the globe is being dragged, zoomed or flown. globe.pick()
// chooses a level of detail from zoom and motion; asking it to choose
// between two labels reads the motion back out.
function atRest() {
  return globe.pick({ coarse: false, fine: globe.k >= 2 ? false : true, full: true });
}

function draw() {
  // Borders are left out while the globe moves, to keep dragging smooth.
  bordersPath.attr('d', borders && atRest() ? globe.path(borders) : null);
  shapeLayer.selectAll('path')
    .data(highlights(), (h) => h.name)
    .join('path')
    .attr('class', (h) => 'shape ' + h.kind)
    .attr('d', (h) => globe.path(globe.pick(shapes.get(h.name).lod)));
  arcPath.attr('d', arcShown ? globe.path(arcShown) : null);
  markerLayer.selectAll('g')
    .data(markers)
    .join((enter) => {
      const g = enter.append('g');
      g.append('path');
      return g;
    })
    .attr('class', (m) => 'marker ' + m.kind)
    .each(function (m) { globe.placePin(select(this), m.lonlat); })
    .select('path')
    .attr('d', (m) => MARKER_SHAPES[m.kind]);
  if (round) {
    globe.placePin(fromPin, [round.route.from.lon, round.route.from.lat]);
    globe.placePin(toPin, [round.route.to.lon, round.route.to.lat]);
  }
}

// Marker symbols in viewBox units, centred on the point: a circle for
// found, a diamond for missed, a cross for a wrong guess. The shape carries
// the meaning as well as the color.
const MARKER_SHAPES = {
  found: 'M0,-7A7,7 0 1 1 0,7A7,7 0 1 1 0,-7Z',
  missed: 'M0,-8.5L8.5,0L0,8.5L-8.5,0Z',
  wrong: 'M-7,-4L-4,-7L0,-3L4,-7L7,-4L3,0L7,4L4,7L0,3L-4,7L-7,4L-3,0Z',
};

// A point to put a country's marker on: where the route first passes over
// it on the 1:50m map, or failing that (a country too small for 1:50m to
// catch) the middle of whichever of its polygons lies closest to the route.
function markerPoint(name, arcCoords) {
  const shape = shapes.get(name);
  if (!shape) return data.points[name] || null;
  const hits = arcCoords.filter((p) => geoContains(shape.geometry, p));
  if (hits.length) return hits[Math.floor(hits.length / 2)];
  let best = null;
  let bestD = Infinity;
  for (const c of shape.polys) {
    const d = Math.min(...arcCoords.map((p) => geoDistance(c, p)));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// A wrong guess gets its marker on its largest polygon.
function largestPoint(name) {
  const shape = shapes.get(name);
  if (!shape) return data.points[name] || null;
  return shape.largest;
}

function buildShapes(topo) {
  const byName = new Map();
  for (const f of feature(topo, topo.objects.countries).features) {
    const name = gameName(f.properties.name);
    if (!name || !f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(...polys);
  }
  const out = new Map();
  for (const [name, polys] of byName) {
    const geometry = { type: 'MultiPolygon', coordinates: polys };
    const parts = polys.map((p) => ({ type: 'Polygon', coordinates: p }));
    let largest = parts[0];
    for (const p of parts) if (geoArea(p) > geoArea(largest)) largest = p;
    out.set(name, {
      geometry,
      polys: parts.map((p) => geoCentroid(p)),
      largest: geoCentroid(largest),
      lod: levels(geometry),
    });
  }
  return out;
}

// ---------- screens ----------

const screens = { start: $('screen-start'), round: $('screen-round') };

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

const input = $('guess-input');
const feedback = $('feedback');
const combo = createCombobox({
  input,
  list: $('guess-list'),
  getSuggestions: (text) => suggest(suggestions, text, 8, new Set([...round.found, ...round.wrong])),
  onSubmit: guess,
});

function setFeedback(text, kind) {
  feedback.textContent = text;
  feedback.className = 'feedback' + (kind ? ' ' + kind : '');
}

function progressText() {
  return `${round.found.length} of ${round.route.countries.length} found`;
}

function startRound() {
  const route = pickRoute(data.routes, band, { recent });
  recent = [route.id, ...recent].slice(0, RECENT);
  // Half the time, fly it the other way round.
  const flip = Math.random() < 0.5;
  round = createRound(flip ? { ...route, from: route.to, to: route.from, countries: route.countries.slice().reverse() } : route);
  revealed = false;
  arcShown = null;
  markers = [];
  cancelAnimationFrame(arcAnim);

  const { from, to } = round.route;
  $('band-label').textContent = `${BANDS[band].label} route`;
  $('route-title').textContent = `${from.name} to ${to.name}`;
  $('route-countries').textContent = `From ${from.country} to ${to.country}. Neither of these counts.`;
  updateProgress();
  $('found-list').textContent = '';
  $('wrong-list').textContent = '';
  $('found-none').hidden = false;
  $('wrong-block').hidden = true;
  $('results').hidden = true;
  $('guess-area').hidden = false;
  $('reveal').hidden = false;
  setFeedback('');
  input.value = '';
  combo.close();

  show('round');
  globe.frameBetween([from.lon, from.lat], [to.lon, to.lat], 0.75);
  globe.schedule();
  announce(`${from.name}, ${from.country}, to ${to.name}, ${to.country}. ` +
    `${round.route.countries.length} countries to find.`);
  input.focus({ preventScroll: true });
}

function updateProgress() {
  $('progress').textContent = progressText();
}

function addChip(listId, name, kind) {
  const li = document.createElement('li');
  li.className = 'chip ' + kind;
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.setAttribute('aria-hidden', 'true');
  li.append(mark, name);
  $(listId).append(li);
}

function guess(text) {
  if (!round || revealed) return;
  const r = judge(round, lookup, text);
  const { from, to } = round.route;
  let message = '';
  let kind = '';
  switch (r.kind) {
    case 'found':
      message = r.via
        ? `Yes: ${r.name}, which belongs to ${r.via}. ${progressText()}.`
        : `Yes: ${r.name}. ${progressText()}.`;
      kind = 'good';
      addChip('found-list', r.name, 'found');
      $('found-none').hidden = true;
      updateProgress();
      break;
    case 'already':
      message = `You already found ${r.name}.`;
      break;
    case 'wrong':
      message = `No: the route does not pass over ${r.name}.`;
      kind = 'bad';
      addChip('wrong-list', r.name, 'wrong');
      $('wrong-block').hidden = false;
      break;
    case 'repeat':
      message = `You already guessed ${r.name}.`;
      break;
    case 'neutral':
      message = `${r.note} ${r.name} is not counted either way.`;
      break;
    case 'endpoint':
      message = r.name === from.country
        ? `${r.name} is where the flight starts, so it does not count.`
        : `${r.name} is where the flight ends, so it does not count.`;
      if (from.country === to.country) message = `${r.name} is at both ends, so it does not count.`;
      break;
    default:
      message = `"${r.name}" is not a country in this game. Pick one from the suggestions.`;
  }
  setFeedback(message, kind);
  announce(message);
  globe.schedule();
  if (isComplete(round)) reveal(true);
}

function reveal(complete) {
  if (!round || revealed) return;
  revealed = true;
  combo.close();
  $('guess-area').hidden = true;
  $('reveal').hidden = true;

  const { route } = round;
  const coords = greatCirclePoints([route.from.lon, route.from.lat], [route.to.lon, route.to.lat], ARC_POINTS);
  markers = [
    ...route.countries.map((name) => ({ lonlat: markerPoint(name, coords), kind: round.found.includes(name) ? 'found' : 'missed' })),
    ...round.wrong.map((name) => ({ lonlat: largestPoint(name), kind: 'wrong' })),
  ].filter((m) => m.lonlat);
  globe.frameBetween([route.from.lon, route.from.lat], [route.to.lon, route.to.lat], 0.75);
  drawArc(coords);
  showResults(complete);
}

function drawArc(coords) {
  cancelAnimationFrame(arcAnim);
  if (reduceMotion.matches) {
    arcShown = { type: 'LineString', coordinates: coords };
    globe.schedule();
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ARC_MS);
    const n = Math.max(2, Math.round(t * coords.length));
    arcShown = { type: 'LineString', coordinates: coords.slice(0, n) };
    // Only the arc changes; the next full render picks it up too.
    arcPath.attr('d', globe.path(arcShown));
    if (t < 1) arcAnim = requestAnimationFrame(step);
  };
  arcAnim = requestAnimationFrame(step);
}

function showResults(complete) {
  const { route } = round;
  const found = round.found.length;
  const total = route.countries.length;
  const wrong = round.wrong.length;
  const score = `${found} of ${total} countries found, ${wrong} wrong ${wrong === 1 ? 'guess' : 'guesses'}`;
  $('results-title').textContent = complete ? `All ${total} countries found, ${wrong} wrong ${wrong === 1 ? 'guess' : 'guesses'}` : score;
  $('results-km').textContent = `${route.from.name} to ${route.to.name} is ${fmt(route.km)} km along the great circle.`;

  const list = $('results-list');
  list.textContent = '';
  for (const name of route.countries) {
    const ok = round.found.includes(name);
    const li = document.createElement('li');
    li.className = 'result-row ' + (ok ? 'found' : 'missed');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'result-name';
    label.textContent = name;
    const status = document.createElement('span');
    status.className = 'result-status';
    status.textContent = ok ? 'Found' : 'Missed';
    li.append(mark, label, status);
    list.append(li);
  }

  const wrongList = $('results-wrong');
  wrongList.textContent = '';
  for (const name of round.wrong) {
    const li = document.createElement('li');
    li.className = 'result-row wrong';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'result-name';
    label.textContent = name;
    const status = document.createElement('span');
    status.className = 'result-status';
    status.textContent = 'Wrong guess';
    li.append(mark, label, status);
    wrongList.append(li);
  }
  $('results-wrong-block').hidden = !wrong;

  const notes = $('results-notes');
  notes.textContent = '';
  for (const note of round.notes) {
    const p = document.createElement('p');
    p.textContent = note;
    notes.append(p);
  }
  notes.hidden = !round.notes.length;

  $('results').hidden = false;
  const title = $('results-title');
  title.focus({ preventScroll: true });
  title.scrollIntoView({ block: 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  announce(`${title.textContent}. ${$('results-km').textContent}`);
}

// ---------- controls ----------

$('guess-btn').addEventListener('click', () => { combo.submit(); input.focus(); });
$('reveal').addEventListener('click', () => reveal(false));
$('next-route').addEventListener('click', startRound);
$('change').addEventListener('click', () => {
  round = null;
  markers = [];
  arcShown = null;
  globe.schedule();
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

const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

Promise.all([
  getJSON('/flight-path/countries-50m.json'),
  getJSON('/flight-path/routes.json?v=1'),
]).then(([topo, json]) => {
  data = parseData(json);
  lookup = buildLookup(data.countries);
  suggestions = suggestionIndex(data.countries);
  shapes = buildShapes(topo);
  borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const land = feature(topo, topo.objects.land);
  const g = land.features ? land.features[0].geometry : land.geometry;
  globe.setLand(g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g);
  for (const b of tierButtons) {
    b.addEventListener('click', () => { band = b.dataset.band; startRound(); });
  }
  setLoading(false);
  globe.render();
}).catch(() => {
  setLoading(true, 'The map did not load. Refresh the page to try again.');
});
