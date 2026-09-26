// /play/: a globe pin drop game. Bundled by esbuild into ../play/play.js.
//
// The globe itself (projection, drag, zoom, keyboard, taps) lives in
// globe.js, shared with /flight-path/.

import { geoInterpolate } from 'd3-geo';
import { select } from 'd3-selection';
import { feature } from 'topojson-client';
import { createGlobe } from './globe.js';

const ROUNDS = 10;
const EARTH_KM = 6371;

const $ = (id) => document.getElementById(id);

// Screen reader announcements (a polite live region outside the screens, so
// it is in the page before anything is said into it).
function announce(text) {
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

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
const arcPath = svg.select('.arc');
const guessPin = svg.select('.pin-guess');
const answerPin = svg.select('.pin-answer');

let guess = null;   // [lon, lat]
let answer = null;  // [lon, lat]
let arc = null;     // GeoJSON LineString

const globe = createGlobe(svgEl, {
  rotation: [80, -25],
  onTap: dropPin,
  draw() {
    arcPath.attr('d', arc ? globe.path(arc) : null);
    globe.placePin(guessPin, guess);
    globe.placePin(answerPin, answer);
  },
});

function dropPin(xy) {
  if (state !== 'guessing') return;
  const lonlat = globe.invert(xy);
  if (!lonlat) return;
  guess = lonlat;
  lockBtn.disabled = false;
  announce('Pin dropped. Lock in your guess, or drop the pin again.');
  globe.schedule();
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
  if (globe.k !== 1) globe.flyTo(globe.center(), 1);
  globe.schedule();
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
  globe.frameBetween(guess, answer);
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
  globe.setLand(full);
  places = list;
  for (const b of tierButtons) b.addEventListener('click', () => startGame(b.dataset.tier));
  setLoading(false);
  globe.render();
}).catch(() => {
  setLoading(true, 'The map did not load. Refresh the page to try again.');
});
