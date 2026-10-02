// /borderline/: date an old political map from its borders and names.
import { mapMarkup } from './render.js';
import { windowYears } from './window.js';
import { scoreGuess, yearsOff, square, ROUNDS, MAX, HINT_COST } from './score.js';
import { dailyKey, dailyPicks, pick, rng, hashString } from './seed.js';
import { titleCase } from './text.js';

const DATA = '/borderline/data/';
const MIN_YEAR = 1640;
const STORE = 'borderline:v1';
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');

const cache = new Map();
function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(DATA + path).then((r) => {
      if (!r.ok) throw new Error(path + ': ' + r.status);
      return r.json();
    }));
  }
  return cache.get(path);
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* private mode */ }
}

const nowYear = Number(dailyKey().slice(0, 4));
const MAX_YEAR = nowYear;

let index = null;
let game = null;

function show(screen) {
  for (const id of ['screen-start', 'screen-round', 'screen-end']) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

function announce(text) {
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

// ---------- puzzles and geometry

async function puzzle(id) {
  if (id[0] === 'C') {
    const list = await getJSON(index.curated.file);
    return list.find((p) => p.id === id);
  }
  const n = Number(id.slice(1));
  const shard = await getJSON('bank/' + id[0] + '-' + String(Math.floor(n / index.shard)).padStart(2, '0') + '.json');
  return shard.find((p) => p.id === id);
}

// Each puzzle names the one small map file (records and coastline for its
// part of the world) that it draws from.
const prepare = (p) => getJSON(p.geo);

// ---------- start screen

function describeDaily(diff) {
  const key = dailyKey();
  const done = load().daily?.[key + '|' + diff];
  const el = document.querySelector('[data-best="daily-' + diff + '"]');
  if (el) el.textContent = done ? 'Played today: ' + fmt(done.total) : '';
}

async function init() {
  $('load-status').textContent = 'Loading the atlas...';
  try {
    index = await getJSON('index.json');
  } catch (err) {
    $('load-status').textContent = 'The map data did not load. Check your connection and reload the page.';
    return;
  }
  $('load-status').textContent = '';
  $('today').textContent = "Today's maps: " + dailyKey() + ' (New York time).';
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.disabled = false;
    b.addEventListener('click', () => start(b.dataset.mode, b.dataset.diff));
  }
  describeDaily('N');
  describeDaily('H');
  $('lock').addEventListener('click', lockIn);
  $('hint').addEventListener('click', useHint);
  $('next').addEventListener('click', nextRound);
  $('copy').addEventListener('click', copyShare);
  $('again').addEventListener('click', () => { show('screen-start'); describeDaily('N'); describeDaily('H'); $('title').focus(); });
  const range = $('year-range');
  const input = $('year-input');
  for (const el of [range, input]) { el.min = MIN_YEAR; el.max = MAX_YEAR; }
  range.addEventListener('input', () => { input.value = range.value; updateLock(); });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR) range.value = v;
    updateLock();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('lock').disabled) lockIn(); });
}

async function start(mode, diff) {
  const key = dailyKey();
  if (mode === 'daily') {
    const done = load().daily?.[key + '|' + diff];
    if (done) { game = { mode, diff, key, rounds: done.rounds, total: done.total }; return finish(true); }
  }
  const seen = new Set(load().seen?.[diff] || []);
  const ids = mode === 'daily'
    ? dailyPicks(index, diff, key, ROUNDS)
    : pick(index, diff, rng(crypto.getRandomValues(new Uint32Array(1))[0]), ROUNDS, seen);
  game = { mode, diff, key, ids, rounds: [], round: 0, total: 0 };
  show('screen-round');
  await playRound();
}

// ---------- a round

async function playRound() {
  const id = game.ids[game.round];
  $('round-count').textContent = 'Map ' + (game.round + 1) + ' of ' + ROUNDS + (game.diff === 'H' ? ' · Hard' : '');
  $('round-total').textContent = fmt(game.total) + ' points';
  $('reveal').hidden = true;
  $('guess-area').hidden = false;
  $('hint-text').textContent = '';
  $('hint').disabled = false;
  $('year-input').value = '';
  $('year-range').value = Math.round((MIN_YEAR + MAX_YEAR) / 2);
  updateLock();
  const svg = $('map');
  svg.innerHTML = '';
  svg.setAttribute('aria-busy', 'true');
  const p = await puzzle(id);
  const topo = await prepare(p);
  game.current = { id, p, hinted: false };
  svg.innerHTML = mapMarkup(p, topo, { idPrefix: 'm' + game.round });
  svg.removeAttribute('aria-busy');
  const names = p.labels.map((l) => titleCase(l.t.join(' ')));
  svg.setAttribute('aria-label', 'Political map with no date. Countries labeled: ' + names.join(', ') + '.');
  // Prefetch the next map's data while this one is played.
  if (game.round + 1 < ROUNDS) puzzle(game.ids[game.round + 1]).then(prepare).catch(() => {});
  $('round-heading').focus();
}

function guessValue() {
  const v = Number($('year-input').value || $('year-range').value);
  return Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR ? v : null;
}

function updateLock() {
  const v = guessValue();
  $('lock').disabled = v === null;
  $('lock').textContent = v === null ? 'Lock in a year' : 'Lock in ' + v;
}

function span(p) {
  return windowYears(p.win, nowYear);
}

function tellLine(p, side) {
  const [sy, ey] = span(p);
  const t = p.tells[side];
  if (side === 'end' && !t) return { text: 'Nothing on this map has changed since.', so: 'It could be a map of today.' };
  return { text: t.text, so: side === 'start' ? 'So this map is from ' + sy + ' or later.' : 'So this map is from ' + ey + ' or earlier.', source: t.source };
}

function useHint() {
  const { p } = game.current;
  game.current.hinted = true;
  $('hint').disabled = true;
  let side = hashString(p.id) % 2 ? 'start' : 'end';
  if (!p.tells[side]) side = 'start';
  const t = tellLine(p, side);
  $('hint-text').textContent = t.text + ' ' + t.so;
  announce('Tell: ' + t.text + ' ' + t.so);
}

function lockIn() {
  const year = guessValue();
  if (year === null) return;
  const { p, hinted } = game.current;
  const s = span(p);
  const points = scoreGuess(year, s, game.diff, hinted);
  const off = yearsOff(year, s[0], s[1]);
  game.rounds.push({ id: p.id, year, from: s[0], to: s[1], off, points, hinted });
  game.total += points;
  $('round-total').textContent = fmt(game.total) + ' points';
  $('guess-area').hidden = true;
  showReveal(p, year, s, off, points, hinted);
}

function showReveal(p, year, s, off, points, hinted) {
  $('reveal').hidden = false;
  $('reveal-title').textContent = off === 0 ? 'Inside the window' : off + (off === 1 ? ' year off' : ' years off');
  $('reveal-points').textContent = '+' + fmt(points) + ' points' + (hinted ? ' (after the ' + fmt(HINT_COST) + ' for the tell)' : '');
  $('reveal-window').textContent = s[0] === s[1]
    ? 'Everything on this map fits only ' + s[0] + '. You guessed ' + year + '.'
    : 'Everything on this map fits ' + s[0] + ' to ' + (p.win.ey === 'present' ? 'today' : s[1]) + '. You guessed ' + year + '.';
  drawTimeline(year, s);
  const list = $('tells');
  list.innerHTML = '';
  for (const side of ['start', 'end']) {
    const t = tellLine(p, side);
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tell-edge';
    tag.textContent = side === 'start' ? 'Earliest' : 'Latest';
    li.append(tag, document.createTextNode(' ' + t.text + ' '));
    const so = document.createElement('strong');
    so.textContent = t.so;
    li.append(so);
    if (t.source) {
      const a = document.createElement('a');
      a.href = t.source;
      a.textContent = 'Source';
      a.className = 'tell-source';
      a.rel = 'noopener';
      li.append(' ', a);
    }
    list.append(li);
  }
  $('next').textContent = game.round + 1 < ROUNDS ? 'Next map' : 'See your score';
  announce($('reveal-title').textContent + '. ' + $('reveal-points').textContent + '. ' + $('reveal-window').textContent);
  $('reveal-title').focus();
}

// Guess marker and the shaded window on a strip that covers both.
function drawTimeline(year, [from, to]) {
  const lo = Math.min(year, from) - 8;
  const hi = Math.max(year, to) + 8;
  const W = 600, x = (y) => 20 + ((y - lo) / (hi - lo)) * (W - 40);
  const ticks = [];
  const step = hi - lo > 120 ? 50 : hi - lo > 50 ? 20 : hi - lo > 25 ? 10 : 5;
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const svg = $('timeline');
  svg.innerHTML =
    '<rect class="tl-window" x="' + x(from - 0.5) + '" y="34" width="' + Math.max(5, x(to + 0.5) - x(from - 0.5)) + '" height="22" rx="2"/>' +
    '<line class="tl-axis" x1="20" y1="45" x2="' + (W - 20) + '" y2="45"/>' +
    ticks.map((t) => '<line class="tl-tick" x1="' + x(t) + '" y1="40" x2="' + x(t) + '" y2="50"/><text class="tl-label" x="' + x(t) + '" y="78">' + t + '</text>').join('') +
    '<path class="tl-guess" d="M' + x(year) + ' 34 l-9 -13 h18 z"/>' +
    '<text class="tl-guess-label" x="' + x(year) + '" y="16">' + year + '</text>';
  svg.setAttribute('aria-label', 'Timeline: the window runs from ' + from + ' to ' + to + '; your guess was ' + year + '.');
}

async function nextRound() {
  game.round++;
  if (game.round < ROUNDS) return playRound();
  const data = load();
  if (game.mode === 'daily') {
    data.daily = data.daily || {};
    data.daily[game.key + '|' + game.diff] = { total: game.total, rounds: game.rounds };
  } else {
    data.seen = data.seen || {};
    data.seen[game.diff] = [...(data.seen[game.diff] || []), ...game.ids].slice(-300);
    data.best = data.best || {};
    data.best[game.diff] = Math.max(data.best[game.diff] || 0, game.total);
  }
  save(data);
  finish(false);
}

// ---------- end screen

function shareText() {
  const label = game.mode === 'daily' ? 'Borderline ' + game.key : 'Borderline practice';
  const hints = game.rounds.filter((r) => r.hinted).length;
  return label + ' · ' + (game.diff === 'H' ? 'Hard' : 'Normal') + '\n' +
    game.rounds.map(square).join('') + ' ' + fmt(game.total) + '/' + fmt(MAX * ROUNDS) +
    (hints ? ' (' + hints + ' tell' + (hints > 1 ? 's' : '') + ')' : '') + '\n' +
    'conradgelber.com/borderline/';
}

function finish(replay) {
  show('screen-end');
  $('end-total').textContent = fmt(game.total) + ' of ' + fmt(MAX * ROUNDS);
  $('end-note').textContent = replay ? "You played today's " + (game.diff === 'H' ? 'Hard' : 'Normal') + ' maps already. New maps at midnight, New York time.' : '';
  const body = $('end-rounds');
  body.innerHTML = '';
  game.rounds.forEach((r, i) => {
    const tr = document.createElement('tr');
    const win = r.from === r.to ? String(r.from) : r.from + ' to ' + r.to;
    for (const [cls, text] of [['', String(i + 1)], ['', win], ['num', String(r.year)], ['num', fmt(r.points) + (r.hinted ? ' 💡' : '')]]) {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  });
  $('share').textContent = shareText();
  $('copy-status').textContent = '';
  $('end-title').focus();
}

async function copyShare() {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    $('copy-status').textContent = 'Copied. Paste it anywhere.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('share'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    $('copy-status').textContent = "Selected. Copy it with your device's copy command.";
  }
}

init();
