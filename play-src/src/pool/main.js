/* global POOL_DEV */
import { Sim, AIM_MAX, POWER_MAX, SPIN_MAX } from './engine/physics.js';
import { R } from './engine/table.js';
import {
  newGame, checkInput, applyResult, tableForShot, timeout, targets, onTheEight, legalSpot, suggestedSpot, PLACE_SCALE, lowestBall,
} from './engine/rules.js';
import { aimGuide } from './engine/guide.js';
import { createThinker } from './engine/ai.js';
import { seededRng } from './engine/rng.js';
import { Renderer, pocketName, outer, RAIL, RAIL_COMPACT } from './render.js';
import { describe, summary } from './words.js';
import { drawSpinBall, spinFromPoint, spinWords, drawWheel } from './widgets.js';
import { Online, rejoinable, rejoin } from './online.js';

const $ = (id) => document.getElementById(id);
const SHOT_CLOCK_MS = 60_000;
/** Shots play back a little faster than real time: snappier, as in GamePigeon. */
const PLAYBACK = 1.2;
const DEG = Math.PI / 180;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ─── Settings kept per browser (conveniences only) ─────────────────────────

const SETTINGS_KEY = 'pool-settings';
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    /* private mode or blocked storage: nothing to keep */
  }
}

// ─── State ────────────────────────────────────────────────────────────────

const ui = {
  mode: null, // 'computer' | 'online'
  state: null,
  names: ['You', 'Computer'],
  me: 0,
  level: 'easy',
  setup: null,
  aim: { x: 1, y: 0 },
  power: 0.5,
  side: 0,
  top: 0,
  /** Proposed cue ball spot with ball in hand, in table metres (already on the placement grid). */
  place: null,
  placeOk: true,
  keyPlacing: false,
  called: null,
  anim: null,
  thinking: null,
  clock: null, // { endsAt } while a clock is running, or { left } when paused
  waiting: null, // online: { name, endsAt } while the other player is away
  rng: null,
  breaker: 0,
  drag: null,
  opponentAim: null,
};

const renderer = new Renderer($('table'));
const online = new Online({
  onRoom: (r) => roomUpdate(r),
  onState: (g) => serverState(g),
  onShot: (s) => opponentShot(s),
  onResult: (r) => serverResult(r),
  onAim: (a) => {
    ui.opponentAim = a;
    schedule();
  },
  onError: (msg) => setStatus(msg),
  onEnded: (msg) => endOnline(msg),
});

// ─── Screens ──────────────────────────────────────────────────────────────

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  document.body.classList.toggle('playing', id === 'screen-play');
  if (id !== 'screen-play') document.body.classList.remove('compact');
  // Size the table now, while the screen is known to be showing.
  if (id === 'screen-play') layout();
}

function setStatus(msg) {
  const el = document.querySelector('.screen:not([hidden]) [role="status"]');
  if (el) el.textContent = msg;
  else banner(msg, true);
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => openSetup(b.dataset.mode));
}

function openSetup(mode) {
  ui.setup = mode;
  const saved = loadSettings();
  $('setup-title').textContent = mode === 'computer' ? 'Play the computer' : mode === 'host' ? 'Start a room' : 'Join a room';
  $('name-field').hidden = mode === 'computer';
  $('code-field').hidden = mode !== 'join';
  $('game-field').hidden = mode === 'join';
  $('guide-field').hidden = mode === 'join';
  $('level-field').hidden = mode !== 'computer';
  $('setup-go').textContent = mode === 'computer' ? 'Start' : mode === 'host' ? 'Get a code' : 'Join';
  $('setup-status').textContent = '';
  if (saved.name) $('name').value = saved.name;
  for (const [field, key] of [['game', 'game'], ['guide', 'guide'], ['level', 'level']]) {
    const v = saved[key];
    const input = v && document.querySelector(`input[name="${field}"][value="${v}"]`);
    if (input) input.checked = true;
  }
  const fromUrl = new URLSearchParams(location.search).get('room');
  if (mode === 'join' && fromUrl) $('code').value = fromUrl.toUpperCase().slice(0, 6);
  show('screen-setup');
  $('setup-title').focus();
}

$('setup-back').addEventListener('click', () => {
  show('screen-start');
});

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pick = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const game = Number(pick('game'));
  const guide = pick('guide');
  const level = pick('level');
  if (ui.setup === 'computer') {
    saveSettings({ game, guide, level });
    startComputer({ game, guide, level, breaker: 0 });
    return;
  }
  const name = $('name').value.trim();
  if (!name) {
    $('setup-status').textContent = 'Enter a name.';
    $('name').focus();
    return;
  }
  saveSettings({ name, ...(ui.setup === 'host' ? { game, guide } : {}) });
  $('setup-go').disabled = true;
  $('setup-status').textContent = 'Connecting.';
  try {
    if (ui.setup === 'host') {
      const code = await online.create({ name, game: String(game), guide });
      $('room-code').textContent = code;
      $('wait-status').textContent = '';
      show('screen-wait');
      $('wait-title').focus();
    } else {
      const code = $('code').value.trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(code)) {
        $('setup-status').textContent = 'Room codes are six letters.';
        $('code').focus();
        return;
      }
      await online.join({ name, code });
      $('setup-status').textContent = 'Joined. Waiting for the game to start.';
    }
  } catch (err) {
    $('setup-status').textContent = err.message || 'Could not reach the game server.';
  } finally {
    $('setup-go').disabled = false;
  }
});

$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('room-code').textContent);
    $('wait-status').textContent = 'Code copied.';
  } catch {
    $('wait-status').textContent = 'Could not copy. Select the code and copy it by hand.';
  }
});
$('wait-cancel').addEventListener('click', () => {
  online.leave();
  show('screen-start');
});

// ─── Starting games ───────────────────────────────────────────────────────

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function startComputer({ game, guide, level, breaker }) {
  ui.mode = 'computer';
  ui.level = level;
  ui.me = 0;
  ui.names = ['You', 'Computer'];
  ui.breaker = breaker;
  const seed = randomSeed();
  ui.rng = seededRng(seed ^ 0x5bd1e995);
  ui.state = newGame({ game, guide, seed, breaker });
  ui.lastSettings = { game, guide, level };
  enterPlay();
}

function enterPlay() {
  ui.anim = null;
  ui.thinking = null;
  ui.side = 0;
  ui.top = 0;
  $('end-actions').hidden = true;
  $('shot-row').hidden = false;
  $('fine').hidden = false;
  show('screen-play');
  afterState(true);
  $('table').focus({ preventScroll: true });
}

$('rematch').addEventListener('click', () => {
  if (ui.mode === 'computer') startComputer({ ...ui.lastSettings, breaker: 1 - ui.breaker });
  else online.rematch();
});
$('new-game').addEventListener('click', () => {
  if (ui.mode === 'online') online.leave();
  ui.mode = null;
  stopClock();
  show('screen-start');
});
$('leave').addEventListener('click', () => {
  if (ui.mode === 'online') online.leave();
  ui.mode = null;
  ui.anim = null;
  ui.thinking = null;
  stopClock();
  show('screen-start');
});

// ─── Turn flow ────────────────────────────────────────────────────────────

const myTurn = () => ui.state && ui.state.phase !== 'over' && ui.state.turn === ui.me && !ui.anim && !ui.thinking && !ui.waiting && !ui.pendingShot;

/** Everything after the state changes: words, bars, the next player's turn. */
function afterState(fresh = false) {
  const s = ui.state;
  if (POOL_DEV && window.poolDev && s.last) window.poolDev.log.push({ ...s.last, groups: s.groups, onTable: s.table.on.map((o, i) => (o ? i : -1)).filter((i) => i >= 0) });
  ui.called = null;
  ui.keyPlacing = false;
  ui.opponentAim = null;
  if (s.turn === ui.me && s.ballInHand) {
    const spot = suggestedSpot(s);
    setPlace(spot.x, spot.y);
  } else ui.place = null;
  if (s.phase !== 'over') aimAtTarget();
  updatePlayers();
  // A fresh game (or a reconnect) gets a short line on screen and the full summary read out.
  const words = fresh ? opening(s) : describe(s, ui.names, ui.me);
  banner(words, !fresh && !!s.last && ((s.last.fouls && s.last.fouls.length > 0) || (s.last.win && s.last.win.winner !== ui.me)));
  announce(fresh ? summary(s, ui.names, ui.me) : words);
  $('table-summary').textContent = summary(s, ui.names, ui.me);
  if (s.phase === 'over') {
    stopClock();
    $('end-actions').hidden = false;
    $('shot-row').hidden = true;
    $('fine').hidden = true;
    $('rematch').textContent = ui.mode === 'online' ? 'Rematch' : 'Play again';
  } else if (ui.mode === 'computer') {
    if (s.turn === ui.me) startClock(SHOT_CLOCK_MS);
    else {
      stopClock();
      startThinking();
    }
  }
  updateControls();
  schedule();
}

function opening(s) {
  const game = s.game === 9 ? '9-ball' : '8-ball';
  if (s.phase === 'over') return s.winner === ui.me ? 'You won.' : `${ui.names[s.winner]} won.`;
  if (s.phase === 'break') return s.turn === ui.me ? `${game}. Your break: place the cue ball behind the line.` : `${game}. ${ui.names[s.turn]} breaks.`;
  return s.turn === ui.me ? 'Your turn.' : `${ui.names[s.turn]}'s turn.`;
}

function updatePlayers() {
  const s = ui.state;
  for (const p of [0, 1]) {
    $(`name-${p}`).textContent = ui.names[p] + (p === ui.me && ui.mode === 'online' ? ' (you)' : '');
    let g = '';
    if (s.game === 8) g = s.groups ? s.groups[p] : 'open table';
    else if (s.turn === p && s.phase !== 'over') g = `on the ${lowestBall(s.table)}`;
    if (s.game === 8 && s.groups && onTheEight(s, p)) g = 'on the 8';
    $(`group-${p}`).textContent = g;
    $(`player-${p}`).classList.toggle('turn', s.phase !== 'over' && s.turn === p);
  }
}

function aimAtTarget() {
  const s = ui.state;
  const t = s.table;
  const cue = ui.place ?? (t.on[0] ? { x: t.x[0], y: t.y[0] } : null);
  if (!cue) return;
  let want = targets(s);
  if (!want.length) want = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  let best = null;
  for (const n of want) {
    if (!t.on[n]) continue;
    const d = Math.hypot(t.x[n] - cue.x, t.y[n] - cue.y);
    if (!best || d < best.d) best = { n, d };
  }
  if (best) setAim(t.x[best.n] - cue.x, t.y[best.n] - cue.y);
}

function setAim(dx, dy) {
  const m = Math.hypot(dx, dy);
  if (m < 1e-9) return;
  ui.aim = { x: dx / m, y: dy / m };
  const deg = ((Math.atan2(ui.aim.y, ui.aim.x) / DEG) % 360 + 360) % 360;
  $('wheel').setAttribute('aria-valuenow', deg.toFixed(1));
  $('wheel').setAttribute('aria-valuetext', `${deg.toFixed(1)} degrees`);
  shareAim();
  schedule();
}

function rotateAim(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  setAim(ui.aim.x * c - ui.aim.y * s, ui.aim.x * s + ui.aim.y * c);
}

function setPlace(x, y) {
  const s = ui.state;
  const px = Math.round(x * PLACE_SCALE);
  const py = Math.round(y * PLACE_SCALE);
  const ok = legalSpot(s, px / PLACE_SCALE, py / PLACE_SCALE);
  ui.place = { x: px / PLACE_SCALE, y: py / PLACE_SCALE };
  ui.placeOk = ok;
  if (ok) ui.lastGoodPlace = ui.place;
  shareAim();
  schedule();
}

function cuePos() {
  const t = ui.state.table;
  if (ui.place) return ui.place;
  return t.on[0] ? { x: t.x[0], y: t.y[0] } : null;
}

function buildInput() {
  const s = ui.state;
  const shot = {
    ax: Math.round(ui.aim.x * AIM_MAX),
    ay: Math.round(ui.aim.y * AIM_MAX),
    power: Math.max(1, Math.min(POWER_MAX, Math.round(ui.power * POWER_MAX))),
    side: Math.round(ui.side * SPIN_MAX),
    top: Math.round(ui.top * SPIN_MAX),
  };
  while (shot.side * shot.side + shot.top * shot.top > SPIN_MAX * SPIN_MAX) {
    shot.side = Math.trunc(shot.side * 0.999);
    shot.top = Math.trunc(shot.top * 0.999);
  }
  const input = { shot };
  if (s.ballInHand && ui.place) input.place = { x: Math.round(ui.place.x * PLACE_SCALE), y: Math.round(ui.place.y * PLACE_SCALE) };
  if (onTheEight(s, ui.me)) input.call = ui.called;
  return input;
}

function shoot() {
  if (!myTurn()) return;
  const s = ui.state;
  if (onTheEight(s, ui.me) && ui.called == null) {
    banner('Call a pocket for the 8 first: tap a pocket, or press 1 to 6.', true);
    announce('Call a pocket for the 8 first.');
    return;
  }
  if (ui.place && !ui.placeOk) {
    banner('The cue ball needs a clear spot on the table.', true);
    announce('The cue ball needs a clear spot on the table.');
    return;
  }
  const input = buildInput();
  const err = checkInput(s, ui.me, input);
  if (err) {
    banner(err, true);
    announce(err);
    return;
  }
  stopClock();
  closeSpin();
  if (ui.mode === 'online') {
    ui.pendingShot = { seq: ui.seq };
    online.shoot(ui.seq, input).catch((e) => {
      // The server refused it: put everything back.
      ui.pendingShot = null;
      ui.anim = null;
      banner(e.message, true);
      announce(e.message);
      updateControls();
      schedule();
    });
  }
  playShot(input, ui.me);
}

/** Animate a shot from the current state; when it ends, apply it (or wait for the server's result). */
function playShot(input, shooter) {
  const s = ui.state;
  const start = tableForShot(s, input);
  const sim = new Sim(start, input.shot);
  const aim = { x: input.shot.ax, y: input.shot.ay };
  const m = Math.hypot(aim.x, aim.y);
  ui.anim = {
    sim,
    input,
    shooter,
    seq: ui.seq,
    aim: { x: aim.x / m, y: aim.y / m },
    cueFrom: { x: start.x[0], y: start.y[0] },
    strikeAt: null,
    startAt: null,
    pull: input.shot.power / POWER_MAX,
  };
  ui.place = null;
  $('announce').textContent = '';
  updateControls();
  schedule();
}

function finishShot() {
  const a = ui.anim;
  const local = applyResult(ui.state, a.input, a.sim);
  if (ui.mode === 'online') {
    // The server's result is the truth; ours is only checked against it.
    a.local = local;
    a.finished = true;
    if (ui.pendingResult && ui.pendingResult.seq === a.seq) applyServerResult(ui.pendingResult);
    else {
      updateControls();
      schedule();
    }
    return;
  }
  ui.anim = null;
  ui.state = local;
  afterState();
}

$('skip').addEventListener('click', () => {
  const a = ui.anim;
  if (!a) return;
  while (!a.sim.done) a.sim.step();
  a.startAt = a.startAt ?? performance.now();
  schedule();
});

// ─── The computer's turn ──────────────────────────────────────────────────

function startThinking() {
  const s = ui.state;
  const th = createThinker(s, 1, ui.level, ui.rng);
  const started = performance.now();
  const pause = reducedMotion.matches ? 600 : 1000 + (ui.level === 'hard' ? 300 : 0);
  ui.thinking = { th, started, pause, input: null, stage: 'think' };
  // Shown in the players bar, so the result of the last shot stays on screen.
  $('group-1').textContent = 'thinking';
  updateControls();
  schedule();
}

function thinkFrame(now) {
  const t = ui.thinking;
  if (t.stage === 'think') {
    if (!t.input) t.input = t.th.think(2500);
    if (t.input && now - t.started >= t.pause) {
      t.stage = 'show';
      updatePlayers();
      t.showAt = now;
      const cur = cuePos() ?? suggestedSpot(ui.state);
      t.fromCue = cur;
      t.toCue = t.input.place ? { x: t.input.place.x / PLACE_SCALE, y: t.input.place.y / PLACE_SCALE } : cur;
      t.fromAng = Math.atan2(ui.aim.y, ui.aim.x);
      let to = Math.atan2(t.input.shot.ay, t.input.shot.ax);
      while (to - t.fromAng > Math.PI) to -= 2 * Math.PI;
      while (to - t.fromAng < -Math.PI) to += 2 * Math.PI;
      t.toAng = to;
      if (t.input.call != null) {
        const words = `${ui.names[1]} calls the ${pocketName(t.input.call, renderer.portrait)} pocket for the 8.`;
        banner(words, false);
        announce(words);
        ui.called = t.input.call;
      }
    }
    return;
  }
  const dur = reducedMotion.matches ? 1 : 700;
  const k = Math.min(1, (now - t.showAt) / dur);
  const ease = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
  if (t.input.place) ui.ghost = { x: t.fromCue.x + (t.toCue.x - t.fromCue.x) * Math.min(1, ease * 1.6), y: t.fromCue.y + (t.toCue.y - t.fromCue.y) * Math.min(1, ease * 1.6), ok: true };
  const ang = t.fromAng + (t.toAng - t.fromAng) * ease;
  ui.aim = { x: Math.cos(ang), y: Math.sin(ang) };
  if (k >= 1) {
    ui.ghost = null;
    ui.thinking = null;
    playShot(t.input, 1);
  }
}

// ─── Shot clock ───────────────────────────────────────────────────────────

function startClock(ms) {
  ui.clock = { endsAt: performance.now() + ms };
  $('clock-box').hidden = false;
  schedule();
}
function stopClock() {
  ui.clock = null;
  $('clock-box').hidden = true;
}
function pauseClock(left) {
  ui.clock = { left };
  $('clock-box').hidden = false;
}

function clockFrame(now) {
  const c = ui.clock;
  const left = c.endsAt != null ? Math.max(0, c.endsAt - now) : c.left;
  const secs = Math.ceil(left / 1000);
  const text = `0:${String(Math.min(59, secs)).padStart(2, '0')}`;
  const el = $('clock-text');
  const shown = secs >= 60 ? '1:00' : text;
  if (el.textContent !== shown) {
    el.textContent = shown;
    $('clock-bar').value = left / 1000;
    $('clock-box').classList.toggle('low', secs <= 10);
    if (secs === 10 && ui.state.turn === ui.me) announce('10 seconds left.');
  }
  if (c.endsAt != null && left <= 0 && ui.mode === 'computer' && ui.state.turn === ui.me) {
    stopClock();
    ui.state = timeout(ui.state);
    afterState();
  }
}

// ─── Words ────────────────────────────────────────────────────────────────

let bannerTimer = null;
function banner(text, bad) {
  const el = $('banner');
  el.textContent = text;
  el.classList.toggle('foul', !!bad);
  el.classList.remove('gone');
  // On a phone the line floats over the table, so it steps aside after a few
  // seconds (it was announced, and the players bar keeps the essentials).
  clearTimeout(bannerTimer);
  if (document.body.classList.contains('compact') && !ui.waiting) {
    bannerTimer = setTimeout(() => el.classList.add('gone'), bad ? 6000 : 4000);
  }
}
function announce(text) {
  // Clear first so a repeated sentence is read again.
  const el = $('announce');
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = text;
  });
}

// ─── Controls ─────────────────────────────────────────────────────────────

function updateControls() {
  const mine = myTurn();
  const shooting = !!ui.anim;
  $('shot-row').classList.toggle('shooting', shooting);
  $('skip').hidden = !shooting;
  $('shoot').disabled = !mine;
  $('power').disabled = !mine;
  for (const id of ['fine-left', 'fine-right', 'row-left', 'row-right']) $(id).disabled = !mine;
  $('spin-btn').disabled = !mine;
  const eight = mine && onTheEight(ui.state, ui.me);
  $('shoot').textContent = eight && ui.called == null ? 'Call a pocket' : 'Shoot';
  $('table').setAttribute('aria-label', mine ? 'Pool table, your shot' : 'Pool table');
  drawWheel($('wheel'), Math.atan2(ui.aim.y, ui.aim.x), mine);
  drawSpinBall($('spin-mini'), ui.side, ui.top, false);
}

// Power: drag and let go to shoot (the pull-back), or set it and press Shoot.
const power = $('power');
let powerDrag = false;
power.addEventListener('input', () => {
  ui.power = Number(power.value) / 100;
  $('power-value').textContent = `${power.value}%`;
  shareAim();
  schedule();
});
power.addEventListener('pointerdown', () => {
  powerDrag = true;
  ui.pulling = true;
});
const powerRelease = () => {
  if (!powerDrag) return;
  powerDrag = false;
  ui.pulling = false;
  shoot();
};
power.addEventListener('pointerup', powerRelease);
power.addEventListener('pointercancel', () => {
  powerDrag = false;
  ui.pulling = false;
  schedule();
});
power.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    shoot();
  }
});
$('shoot').addEventListener('click', shoot);

function setPower(v) {
  ui.power = Math.max(0.01, Math.min(1, v));
  power.value = String(Math.round(ui.power * 100));
  $('power-value').textContent = `${power.value}%`;
  shareAim();
  schedule();
}

// Fine aim.
/**
 * A nudge button: one tenth of a degree per press, and held down it keeps
 * turning (the first repeat after a pause, so a tap never double-counts).
 */
function nudge(id, rad) {
  const btn = $(id);
  let delay = null;
  let every = null;
  let repeated = false;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(every);
    delay = every = null;
  };
  btn.addEventListener('pointerdown', () => {
    if (!myTurn()) return;
    repeated = false;
    stop();
    delay = setTimeout(() => {
      every = setInterval(() => {
        repeated = true;
        if (myTurn()) rotateAim(rad);
      }, 50);
    }, 350);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', () => {
    if (!repeated) rotateAim(rad);
    repeated = false;
  });
}
nudge('fine-left', 0.1 * DEG);
nudge('fine-right', -0.1 * DEG);
nudge('row-left', 0.1 * DEG);
nudge('row-right', -0.1 * DEG);

$('corner-back').addEventListener('click', (e) => {
  const live = ui.state && ui.state.phase !== 'over' && ui.mode;
  if (live && !window.confirm('Leave this game?')) {
    e.preventDefault();
    return;
  }
  if (ui.mode === 'online') online.leave();
});
const wheel = $('wheel');
let wheelDrag = null;
wheel.addEventListener('pointerdown', (e) => {
  if (!myTurn()) return;
  wheelDrag = { x: e.clientX };
  wheel.setPointerCapture(e.pointerId);
});
wheel.addEventListener('pointermove', (e) => {
  if (!wheelDrag) return;
  const dx = e.clientX - wheelDrag.x;
  wheelDrag.x = e.clientX;
  rotateAim(-dx * 0.04 * DEG);
  drawWheel(wheel, Math.atan2(ui.aim.y, ui.aim.x), true);
});
const wheelUp = () => {
  wheelDrag = null;
};
wheel.addEventListener('pointerup', wheelUp);
wheel.addEventListener('pointercancel', wheelUp);
wheel.addEventListener('keydown', (e) => {
  if (!myTurn()) return;
  const step = (e.shiftKey ? 0.02 : 0.1) * DEG;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') rotateAim(step);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') rotateAim(-step);
  else return;
  e.preventDefault();
  drawWheel(wheel, Math.atan2(ui.aim.y, ui.aim.x), true);
});

// Spin.
function setSpin(side, top) {
  const m = Math.hypot(side, top);
  if (m > 1) {
    side /= m;
    top /= m;
  }
  ui.side = Math.abs(side) < 0.02 ? 0 : side;
  ui.top = Math.abs(top) < 0.02 ? 0 : top;
  const words = spinWords(ui.side, ui.top);
  $('spin-btn-text').textContent = `Spin: ${words}`;
  const ball = $('spin-ball');
  ball.setAttribute('aria-valuenow', String(Math.round(ui.top * 100)));
  ball.setAttribute('aria-valuetext', words);
  drawSpinBall($('spin-mini'), ui.side, ui.top, false);
  if (!$('spin-panel').hidden) drawSpinBall(ball, ui.side, ui.top, true);
  shareAim();
  schedule();
}
function closeSpin() {
  $('spin-panel').hidden = true;
  $('spin-btn').setAttribute('aria-expanded', 'false');
}
$('spin-btn').addEventListener('click', () => {
  const open = $('spin-panel').hidden;
  $('spin-panel').hidden = !open;
  $('spin-btn').setAttribute('aria-expanded', String(open));
  if (open) {
    drawSpinBall($('spin-ball'), ui.side, ui.top, true);
    $('spin-ball').focus();
  }
});
$('spin-done').addEventListener('click', () => {
  closeSpin();
  $('spin-btn').focus();
});
$('spin-reset').addEventListener('click', () => setSpin(0, 0));
const spinBall = $('spin-ball');
let spinDrag = false;
spinBall.addEventListener('pointerdown', (e) => {
  spinDrag = true;
  spinBall.setPointerCapture(e.pointerId);
  const p = spinFromPoint(spinBall, e.clientX, e.clientY);
  setSpin(p.side, p.top);
});
spinBall.addEventListener('pointermove', (e) => {
  if (!spinDrag) return;
  const p = spinFromPoint(spinBall, e.clientX, e.clientY);
  setSpin(p.side, p.top);
});
spinBall.addEventListener('pointerup', () => {
  spinDrag = false;
});
spinBall.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowUp') setSpin(ui.side, ui.top + 0.1);
  else if (k === 'ArrowDown') setSpin(ui.side, ui.top - 0.1);
  else if (k === 'ArrowLeft') setSpin(ui.side - 0.1, ui.top);
  else if (k === 'ArrowRight') setSpin(ui.side + 0.1, ui.top);
  else if (k === 'Escape' || k === 'Enter') {
    closeSpin();
    $('spin-btn').focus();
  } else return;
  e.preventDefault();
});

// The table: drag to turn the aim, tap to aim at a point, drag the cue ball with ball in hand, tap a pocket to call it.
const canvas = $('table');
function tablePoint(e) {
  const rect = canvas.getBoundingClientRect();
  return renderer.toTable(e.clientX - rect.left, e.clientY - rect.top);
}
function nearestHole(x, y) {
  const holes = renderer.holes();
  let best = -1;
  let bd = 0.1;
  holes.forEach((h, i) => {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!myTurn()) return;
  const [x, y] = tablePoint(e);
  const s = ui.state;
  if (onTheEight(s, ui.me)) {
    const p = nearestHole(x, y);
    if (p >= 0) {
      callPocket(p);
      return;
    }
  }
  const cue = cuePos();
  canvas.setPointerCapture(e.pointerId);
  if (s.ballInHand && cue && Math.hypot(cue.x - x, cue.y - y) < 3 * R) {
    ui.drag = { kind: 'cue' };
    return;
  }
  if (!cue) return;
  ui.drag = { kind: 'aim', ang: Math.atan2(y - cue.y, x - cue.x), sx: e.clientX, sy: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const d = ui.drag;
  if (!d) return;
  const [x, y] = tablePoint(e);
  if (d.kind === 'cue') {
    setPlace(x, y);
    return;
  }
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
  d.moved = true;
  const cue = cuePos();
  // Near the cue ball the angle swings wildly; hold still there.
  if (Math.hypot(x - cue.x, y - cue.y) < 0.06) return;
  const ang = Math.atan2(y - cue.y, x - cue.x);
  let delta = ang - d.ang;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  d.ang = ang;
  rotateAim(delta);
});
const tableUp = (e) => {
  const d = ui.drag;
  ui.drag = null;
  if (!d) return;
  if (d.kind === 'cue') {
    if (!ui.placeOk && ui.lastGoodPlace) setPlace(ui.lastGoodPlace.x, ui.lastGoodPlace.y);
    return;
  }
  if (d.moved || e.type === 'pointercancel') return;
  // A tap: aim at the ball under the finger, or at the point.
  const [x, y] = tablePoint(e);
  const cue = cuePos();
  const t = ui.state.table;
  let target = null;
  for (let n = 1; n < 16; n++) {
    if (!t.on[n]) continue;
    const dd = Math.hypot(t.x[n] - x, t.y[n] - y);
    if (dd < 1.8 * R && (!target || dd < target.d)) target = { x: t.x[n], y: t.y[n], d: dd };
  }
  if (target) setAim(target.x - cue.x, target.y - cue.y);
  else setAim(x - cue.x, y - cue.y);
};
canvas.addEventListener('pointerup', tableUp);
canvas.addEventListener('pointercancel', tableUp);

function callPocket(p) {
  ui.called = p;
  const words = `Calling the ${pocketName(p, renderer.portrait)} pocket.`;
  banner(words, false);
  announce(words);
  updateControls();
  shareAim();
  schedule();
}

canvas.addEventListener('keydown', (e) => {
  if (!myTurn()) return;
  const k = e.key;
  const s = ui.state;
  const screenMove = (sx, sy) => {
    // Screen direction to table direction.
    const dx = renderer.portrait ? -sy : sx;
    const dy = renderer.portrait ? -sx : -sy;
    const step = e.shiftKey ? 0.001 : 0.005;
    const c = cuePos();
    setPlace(c.x + dx * step, c.y + dy * step);
  };
  if (ui.keyPlacing) {
    if (k === 'ArrowUp') screenMove(0, -1);
    else if (k === 'ArrowDown') screenMove(0, 1);
    else if (k === 'ArrowLeft') screenMove(-1, 0);
    else if (k === 'ArrowRight') screenMove(1, 0);
    else if (k === 'Enter' || k === 'm' || k === 'M' || k === 'Escape') {
      if (!ui.placeOk && ui.lastGoodPlace) setPlace(ui.lastGoodPlace.x, ui.lastGoodPlace.y);
      ui.keyPlacing = false;
      announce('Cue ball placed. Arrow keys aim again.');
    } else return;
    e.preventDefault();
    return;
  }
  const fine = e.shiftKey ? 0.1 * DEG : 1 * DEG;
  if (k === 'ArrowLeft' || k === 'ArrowUp') rotateAim(fine);
  else if (k === 'ArrowRight' || k === 'ArrowDown') rotateAim(-fine);
  else if (k === '+' || k === '=' || k === 'PageUp') setPower(ui.power + 0.05);
  else if (k === '-' || k === '_' || k === 'PageDown') setPower(ui.power - 0.05);
  else if (k === 'w' || k === 'W') setSpin(ui.side, ui.top + 0.1);
  else if (k === 's' || k === 'S') setSpin(ui.side, ui.top - 0.1);
  else if (k === 'a' || k === 'A') setSpin(ui.side - 0.1, ui.top);
  else if (k === 'd' || k === 'D') setSpin(ui.side + 0.1, ui.top);
  else if (k === '0') setSpin(0, 0);
  else if ((k === 'm' || k === 'M') && s.ballInHand) {
    ui.keyPlacing = true;
    announce('Moving the cue ball: arrow keys move it, Shift for small steps, Enter places it.');
  } else if (k >= '1' && k <= '6' && onTheEight(s, ui.me)) callPocket(Number(k) - 1);
  else if (k === 'Enter') shoot();
  else return;
  e.preventDefault();
});

// ─── Online hooks ─────────────────────────────────────────────────────────

/** Send our aim to the other player now and then, so they can watch. */
let lastShare = 0;
function shareAim() {
  if (ui.mode !== 'online' || !myTurn()) return;
  const now = performance.now();
  if (now - lastShare < 120) {
    ui.shareLater = true;
    return;
  }
  lastShare = now;
  ui.shareLater = false;
  online.aim({
    ax: Math.round(ui.aim.x * AIM_MAX),
    ay: Math.round(ui.aim.y * AIM_MAX),
    power: Math.round(ui.power * 100),
    place: ui.place ? { x: Math.round(ui.place.x * PLACE_SCALE), y: Math.round(ui.place.y * PLACE_SCALE) } : null,
    call: ui.called,
  });
}

function roomUpdate(r) {
  ui.room = r;
  if (r.status === 'waiting') {
    if (document.getElementById('screen-wait').hidden && ui.mode !== 'online') return;
    $('wait-status').textContent = r.players.length > 1 ? 'Starting.' : '';
  }
  if (ui.mode === 'online' && ui.state) {
    ui.names = r.players.map((p) => p.name);
    updatePlayers();
  }
}

function serverState(g) {
  ui.mode = 'online';
  ui.me = g.me;
  ui.names = g.names;
  ui.seq = g.seq;
  ui.pendingShot = null;
  ui.pendingResult = null;
  ui.anim = null;
  ui.thinking = null;
  ui.waiting = g.waiting ? { name: g.names[g.waiting.player], endsAt: performance.now() + g.waiting.left } : null;
  const wasPlaying = !document.getElementById('screen-play').hidden;
  ui.state = g.state;
  if (!wasPlaying) {
    enterPlay();
  } else afterState(true);
  applyClock(g.clock);
  if (g.pending) {
    // We came back in the middle of a shot: its result is on the way.
    ui.pendingShot = { seq: g.pending.seq };
    banner('A shot is on the table.', false);
    updateControls();
  }
}

/** A clock from the server; `since` is when it arrived, so time spent waiting here counts. */
function applyClock(clock, since = performance.now()) {
  if (!clock || ui.state.phase === 'over') stopClock();
  else if (clock.running) startClock(Math.max(0, clock.left - (performance.now() - since)));
  else pauseClock(clock.left);
}

function opponentShot({ seq, input, shooter }) {
  if (shooter === ui.me) return; // our own, already playing
  if (seq !== ui.seq || ui.anim) return;
  stopClock();
  ui.ghost = null;
  playShot(input, shooter);
}

function serverResult(r) {
  if (ui.anim && ui.anim.seq === r.seq && !ui.anim.finished) {
    ui.pendingResult = r;
    return;
  }
  applyServerResult(r);
}

function applyServerResult(r) {
  const a = ui.anim;
  if (a && a.local) {
    const mine = JSON.stringify(a.local.table);
    const theirs = JSON.stringify(r.state.table);
    if (mine !== theirs) console.warn('pool: this browser finished the shot differently from the server; using the server table.', { seq: r.seq });
  }
  ui.anim = null;
  ui.pendingShot = null;
  ui.pendingResult = null;
  ui.seq = r.seq + 1;
  ui.state = r.state;
  afterState();
  applyClock(r.clock, r.receivedAt);
}

function endOnline(msg) {
  ui.mode = null;
  ui.anim = null;
  stopClock();
  show('screen-start');
  if (msg) {
    const intro = document.querySelector('#screen-start .game-intro');
    if (intro) intro.textContent = msg;
  }
}

// ─── Drawing ──────────────────────────────────────────────────────────────

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(frame);
}

function frame(now) {
  scheduled = false;
  if (!ui.state || document.getElementById('screen-play').hidden) return;
  let again = false;
  if (ui.shareLater) {
    shareAim();
    again = true;
  }
  if (ui.thinking) {
    thinkFrame(now);
    again = true;
  }
  const a = ui.anim;
  if (a && !a.finished) {
    again = true;
    // A short push of the cue before the balls move (skipped with reduced motion).
    if (a.strikeAt === null) a.strikeAt = now;
    const strike = reducedMotion.matches ? 0 : 140;
    if (now - a.strikeAt >= strike) {
      if (a.startAt === null) a.startAt = now;
      const target = Math.floor(((now - a.startAt) / 1000) * 1024 * PLAYBACK);
      let n = 0;
      while (!a.sim.done && a.sim.steps < target && n < 3000) {
        a.sim.step();
        n++;
      }
      if (a.sim.done) finishShot();
    }
  }
  if (ui.clock) {
    clockFrame(now);
    if (ui.clock?.endsAt != null) again = true;
  }
  if (ui.waiting) {
    const left = Math.max(0, ui.waiting.endsAt - now);
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    const text = `Waiting for ${ui.waiting.name} to reconnect: ${m}:${String(sec).padStart(2, '0')}`;
    if ($('banner').textContent !== text) banner(text, false);
    again = true;
  }
  draw(now);
  if (again) schedule();
}

function draw(now) {
  const s = ui.state;
  const a = ui.anim;
  const view = { table: s.table };
  if (a) {
    const sim = a.sim;
    view.table = { on: Array.from(sim.on, (b) => b === 1), x: sim.x, y: sim.y };
    if (a.startAt === null && a.strikeAt !== null) {
      const k = Math.min(1, (now - a.strikeAt) / 140);
      view.cue = { pull: a.pull * (1 - k) };
      view.aim = a.aim;
      view.cueFrom = a.cueFrom;
      view.table = { ...view.table, on: view.table.on.map((o, i) => (i === 0 ? true : o)), x: [...view.table.x], y: [...view.table.y] };
      view.table.x[0] = a.cueFrom.x;
      view.table.y[0] = a.cueFrom.y;
    }
  } else if (s.phase !== 'over') {
    const mine = s.turn === ui.me;
    let place = mine ? ui.place : null;
    let aim = ui.aim;
    let pull = ui.pulling ? ui.power : 0.15;
    if (!mine && ui.mode === 'online' && ui.opponentAim) {
      const o = ui.opponentAim;
      const m = Math.hypot(o.ax, o.ay) || 1;
      aim = { x: o.ax / m, y: o.ay / m };
      place = o.place ? { x: o.place.x / PLACE_SCALE, y: o.place.y / PLACE_SCALE } : null;
      pull = 0.15;
      view.called = o.call;
      view.callPockets = o.call != null;
    }
    if (ui.ghost) view.ghostCue = ui.ghost;
    else if (place) view.ghostCue = { ...place, ok: mine ? ui.placeOk : true };
    const cue = view.ghostCue ?? (s.table.on[0] ? { x: s.table.x[0], y: s.table.y[0] } : null);
    if (cue && !(mine && ui.drag?.kind === 'cue')) {
      view.aim = aim;
      view.cue = { pull };
      view.cueFrom = cue;
    }
    if (mine && myTurn() && cue) {
      const t = { on: [...s.table.on], x: [...s.table.x], y: [...s.table.y] };
      t.on[0] = true;
      t.x[0] = cue.x;
      t.y[0] = cue.y;
      view.guide = aimGuide(t, s.guide, ui.aim, ui.power * POWER_MAX, ui.side * SPIN_MAX, ui.top * SPIN_MAX);
      view.highlight = targets(s).filter((n) => s.table.on[n]);
      view.kitchen = s.ballInHand === 'kitchen';
      if (onTheEight(s, ui.me)) {
        view.callPockets = true;
        view.called = ui.called;
      }
    } else if (ui.thinking && ui.called != null) {
      view.callPockets = true;
      view.called = ui.called;
    }
  }
  renderer.draw(view);
}

// ─── Layout ───────────────────────────────────────────────────────────────

/** Narrow screens get the compact play screen: no site header, thin rails, one control row. */
const COMPACT_BELOW = 600;

function layout() {
  const compact = window.innerWidth < COMPACT_BELOW;
  document.body.classList.toggle('compact', compact);
  const box = $('table-box');
  const w = box.clientWidth;
  const css = getComputedStyle(document.documentElement);
  const chrome = parseFloat(css.getPropertyValue(compact ? '--chrome-compact' : '--chrome')) || 272;
  const h = Math.max(200, window.innerHeight - chrome);
  let portrait = true;
  if (!compact) {
    const o = outer(RAIL);
    const sLand = Math.min(w / o.l, h / o.w);
    const sPort = Math.min(w / o.w, h / o.l);
    portrait = sPort > sLand * 1.05;
  }
  canvas.classList.toggle('portrait', portrait);
  canvas.classList.toggle('landscape', !portrait);
  renderer.resize(portrait, compact ? RAIL_COMPACT : RAIL);
  drawWheel($('wheel'), Math.atan2(ui.aim.y, ui.aim.x), myTurn());
  drawSpinBall($('spin-mini'), ui.side, ui.top, false);
  if (!$('spin-panel').hidden) drawSpinBall($('spin-ball'), ui.side, ui.top, true);
  schedule();
}
window.addEventListener('resize', () => {
  if (!document.getElementById('screen-play').hidden) layout();
});
reducedMotion.addEventListener?.('change', schedule);

// A seat from a tab that closed in the last few minutes can be taken back.
const held = rejoinable();
if (held) {
  $('rejoin-box').hidden = false;
  $('rejoin').textContent = `Rejoin your game (${held.code})`;
}
$('rejoin').addEventListener('click', () => {
  $('rejoin-box').hidden = true;
  rejoin(online, held);
});

// A link with ?room=CODE opens the join form.
if (new URLSearchParams(location.search).has('room')) openSetup('join');
online.resumeIfAny();

/**
 * Local testing only. The dev server's copy of the bundle is built with
 * POOL_DEV true and gets this read-and-drive handle for scripted play; the
 * production build defines it false, so none of this ships.
 */
if (POOL_DEV) {
  window.poolDev = { ui, setAim, setPower, setSpin, setPlace, callPocket, myTurn, log: [] };
}
