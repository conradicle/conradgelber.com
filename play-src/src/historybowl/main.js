// History Bowl Study: the page. Solo tossup reader with a buzzer, answer
// checking, buzz-point stats, card-the-clue flashcards reviewed with FSRS,
// tag corrections and the weakest-areas filter.
// Built to /historybowl/historybowl.js by `npm run build:historybowl`.

import { checkAnswer as checkLocal, mainAnswer } from './answer.js';
import { words as splitWords, sentences, schedule, shownAt, buzzFraction } from './text.js';
import { CATEGORIES, SUBCATEGORIES, SOURCE_LABEL } from './question.js';
import { ERA_LABEL, ERAS, REGIONS } from './tags.js';
import {
  KEYS, readJSON, writeJSON, loadRecords, saveRecords, loadCards, saveCards,
  loadSeen, addSeen, loadSettings, saveSettings, exportData, importData, aggregate,
  loadFixes, saveFix, withFix,
} from './store.js';
import { weakestAreas, inAreas, MIN_IN_AREA, BEE_SOURCE } from './areas.js';
import { RATINGS, rate, preview, dueToday, dueNow, interleave } from './srs.js';
import { fetchTossups, sendReport, iacCheck } from './api.js';
import { $, show, announce, pct, el, plural, uid, renderAnswerline, judge as judgeAnswer, isTyping, badgeOf, catLine } from './ui.js';
import { initSim } from './sim.js';
import { initDeck, loadDeckFixes, applyDeckFixes, STARTER_URL } from './deck.js';

let storage = null;
try {
  storage = window.localStorage;
} catch (e) {
  storage = null;
}

// Shown in the category picker, in this order.
const PICK_CATS = ['History', 'Geography', 'Fine Arts', 'Literature', 'Current Events', 'Religion', 'Mythology'].filter((c) => CATEGORIES.includes(c));
const BATCH = 8;
const LOW_WATER = 3;

let settings = { ...loadSettings(storage), teamPass: readJSON(storage, KEYS.team, '') || '' };
let records = loadRecords(storage);
let cards = loadCards(storage);
let seen = loadSeen(storage);
let fixes = loadFixes(storage);
let queue = [];
let fetching = null;
// The weakest-areas filter, while it is on: { areas, misses }.
let focus = null;

// The tossup in play.
let cur = null;
let session = { heard: 0, right: 0, buzzes: [] };

// ---------- home ----------

function refreshHome() {
  const tossups = records.filter((r) => r.fmt !== 'lightning');
  const ok = tossups.filter((r) => r.ok);
  const buzzes = ok.map((r) => r.buzz).filter((b) => b !== null);
  $('home-heard').textContent = String(tossups.length);
  $('home-acc').textContent = tossups.length ? pct(ok.length / tossups.length) : '-';
  $('home-buzz').textContent = buzzes.length ? pct(buzzes.reduce((a, b) => a + b, 0) / buzzes.length) : '-';
  const due = dueToday(cards).length;
  $('home-due').textContent = String(due);
  $('review-due').textContent = due ? plural(due, 'card') + ' due today' : cards.length ? 'Nothing due today' : '';
  $('review-desc').textContent = cards.length
    ? `${plural(cards.length, 'card')} in your deck. Cards you miss come back sooner.`
    : 'Flashcards from the clues you missed, spaced so the hard ones come back sooner.';
  renderWeak($('weak-list'), $('weak-note'), $('weak-go'));
}

// ---------- weakest areas ----------

function renderWeak(list, note, go) {
  const areas = weakestAreas(records);
  list.textContent = '';
  for (const a of areas) {
    const li = el('li');
    li.append(el('span', 'weak-name', a.label), el('span', 'weak-detail', `${pct(a.accuracy)} right, buzz ${pct(a.avgBuzz)}, ${plural(a.n, 'tossup')}`));
    list.append(li);
  }
  list.hidden = !areas.length;
  if (go) go.hidden = !areas.length;
  if (!areas.length) {
    note.textContent = `An area is ranked once you have heard ${MIN_IN_AREA} tossups in it. Read a few more.`;
  } else {
    note.textContent = areas.some((a) => a.estimated)
      ? 'Ranked by subcategory first; estimated era or region areas fill in until three subcategories qualify. IAC Bee nationals tossups count half.'
      : 'Ranked by subcategory (your own tags where you fixed them). IAC Bee nationals tossups count half.';
  }
  return areas;
}

function startFocus() {
  const areas = weakestAreas(records);
  if (!areas.length) return;
  focus = { areas, misses: 0 };
  queue = [];
  startSession();
}

function clearFocus() {
  focus = null;
  queue = [];
  writeJSON(storage, KEYS.queue, []);
  $('focus-note').hidden = true;
}

/** The fetch settings: the player's own, or narrowed to the weak areas. */
function fetchSettings() {
  if (!focus) return settings;
  const subs = new Set();
  const cats = new Set();
  for (const a of focus.areas) {
    if (a.kind === 'sub') {
      if ((SUBCATEGORIES[a.category] || []).includes(a.key)) subs.add(a.key);
      if (CATEGORIES.includes(a.category)) cats.add(a.category);
    } else {
      for (const c of settings.cats) cats.add(c);
    }
  }
  return { ...settings, cats: [...cats].length ? [...cats] : settings.cats, subs: [...subs] };
}

function buildSettings() {
  const form = $('settings-form');
  const catBox = $('cat-boxes');
  for (const c of PICK_CATS) {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'cat';
    input.value = c;
    label.append(input, ' ' + c);
    catBox.append(label);
  }
  const subBox = $('sub-boxes');
  for (const s of SUBCATEGORIES.History) {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.name = 'sub';
    input.value = s;
    label.append(input, ' ' + s.replace(' History', ''));
    subBox.append(label);
  }
  for (const i of form.querySelectorAll('input[name=src]')) i.checked = settings.sources.includes(i.value);
  for (const i of form.querySelectorAll('input[name=cat]')) i.checked = settings.cats.includes(i.value);
  for (const i of form.querySelectorAll('input[name=sub]')) i.checked = (settings.subs || []).includes(i.value);
  for (const i of form.querySelectorAll('input[name=level]')) i.checked = settings.level === i.value;
  $('wpm').value = settings.wpm;
  $('answer-secs').value = settings.answerSecs;
  $('buzz-secs').value = settings.buzzSecs;
  showSliderValues();
  showTeam();
  $('team-form').addEventListener('submit', unlockTeam);
  form.addEventListener('input', onSettingsChange);
  form.addEventListener('change', onSettingsChange);
  form.addEventListener('submit', (e) => e.preventDefault());
}

function showTeam() {
  const on = Boolean(settings.teamPass);
  const box = form$('src', 'iac');
  box.disabled = !on;
  box.checked = on && settings.sources.includes('iac');
  $('team-forget').hidden = !on;
  if (on && !$('team-status').textContent) $('team-status').textContent = 'IAC packets unlocked on this device.';
}
const form$ = (name, value) => $('settings-form').querySelector(`input[name=${name}][value=${value}]`);

async function unlockTeam(e) {
  e.preventDefault();
  const pass = $('team-pass').value.trim();
  const status = $('team-status');
  if (!pass) return;
  status.textContent = 'Checking...';
  try {
    const r = await iacCheck(pass);
    settings = { ...settings, teamPass: pass, sources: settings.sources.includes('iac') ? settings.sources : [...settings.sources, 'iac'] };
    writeJSON(storage, KEYS.team, pass);
    const { teamPass, ...toSave } = settings;
    saveSettings(storage, toSave);
    $('team-pass').value = '';
    status.textContent = `Unlocked: ${plural(r.packets, 'packet')}${r.packets ? `, ${r.complete} complete` : ', none uploaded yet'}. Matches use them first.`;
    queue = [];
    writeJSON(storage, KEYS.queue, []);
  } catch (err) {
    status.textContent = err.status === 401 ? 'That passcode is not right.' : err.status === 429 ? 'Too many tries. Wait a minute.' : err.status === 503 ? 'IAC packets are not set up on the server yet.' : 'Could not check the passcode. Try again.';
  }
  showTeam();
}

function forgetTeam() {
  const left = settings.sources.filter((s) => s !== 'iac');
  settings = { ...settings, teamPass: '', sources: left.length ? left : ['bee', 'qb'] };
  try {
    storage.removeItem(KEYS.team);
  } catch (e) {
    // nothing to forget
  }
  const { teamPass, ...toSave } = settings;
  saveSettings(storage, toSave);
  $('team-status').textContent = 'Forgotten on this device.';
  queue = [];
  showTeam();
}

function showSliderValues() {
  $('wpm-out').textContent = `${$('wpm').value} wpm`;
  $('answer-out').textContent = `${$('answer-secs').value} s`;
  $('buzz-out').textContent = `${$('buzz-secs').value} s`;
}

function onSettingsChange() {
  const form = $('settings-form');
  const vals = (name) => [...form.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.value);
  const sources = vals('src');
  const cats = vals('cat');
  const status = $('settings-status');
  showSliderValues();
  if (!sources.length || !cats.length) {
    status.textContent = !sources.length ? 'Pick at least one source.' : 'Pick at least one category.';
    return;
  }
  status.textContent = '';
  const next = {
    ...settings,
    sources,
    cats,
    subs: vals('sub'),
    level: (form.querySelector('input[name=level]:checked') || {}).value || 'regional',
    wpm: Number($('wpm').value),
    answerSecs: Number($('answer-secs').value),
    buzzSecs: Number($('buzz-secs').value),
  };
  const filtersChanged = ['sources', 'cats', 'subs', 'level'].some((k) => JSON.stringify(next[k]) !== JSON.stringify(settings[k]));
  settings = next;
  const { teamPass, ...toSave } = settings;
  saveSettings(storage, toSave);
  if (filtersChanged) {
    // Questions already fetched were picked under the old filters.
    queue = [];
    writeJSON(storage, KEYS.queue, []);
  }
}

// ---------- question supply ----------

function storeQueue() {
  writeJSON(storage, KEYS.queue, queue.slice(0, 12));
}

function refill() {
  if (fetching || queue.length >= LOW_WATER) return fetching;
  fetching = fetchTossups(fetchSettings(), BATCH)
    .then((raw) => {
      let list = raw.map((q) => withFix(q, fixes));
      if (focus) {
        // Era and region areas, and corrected tags, are matched here.
        const hits = list.filter((q) => inAreas(q, focus.areas));
        if (hits.length) list = hits;
        else if (++focus.misses < 3) list = [];
      }
      const have = new Set(queue.map((q) => q.id));
      const recent = new Set(seen);
      const fresh = list.filter((q) => !have.has(q.id) && !recent.has(q.id));
      // If everything was heard before (narrow filters), repeats beat nothing.
      queue.push(...(fresh.length ? fresh : list.filter((q) => !have.has(q.id))));
      storeQueue();
    })
    .finally(() => {
      fetching = null;
    });
  return fetching;
}

async function nextQuestion() {
  if (!queue.length && !focus) {
    // Offline: questions fetched last time are kept on the device.
    const saved = readJSON(storage, KEYS.queue, []);
    if (Array.isArray(saved) && saved.length) queue = saved.filter((q) => q && q.id && q.text && q.answerHtml);
  }
  for (let i = 0; i < 4 && !queue.length; i++) {
    try {
      await refill();
    } catch (e) {
      break;
    }
  }
  if (!queue.length) return null;
  // A correction made since the question was fetched still applies.
  const q = withFix(queue.shift(), fixes);
  storeQueue();
  refill()?.catch(() => {});
  return q;
}

// ---------- the reader ----------

// `read` steps the words (a timer, so reading keeps time even when the tab is
// not painting); `timer` runs the scoreboard countdowns.
const clock = { read: 0, timer: 0 };
const READ_STEP_MS = 40;

function stopClocks() {
  clearTimeout(clock.read);
  clearInterval(clock.timer);
  clock.read = 0;
  clock.timer = 0;
}

async function startTossup() {
  stopClocks();
  show('screen-read');
  $('read-title').focus({ preventScroll: true });
  setBuzzEnabled(false);
  $('answer-form').hidden = true;
  $('buzz-dock').hidden = false;
  $('q-text').textContent = '';
  $('q-meta').textContent = '';
  $('read-status').textContent = 'Fetching a question...';
  $('b-clock').textContent = '-';
  $('pause').disabled = true;
  $('skip').disabled = true;
  let q;
  try {
    q = await nextQuestion();
  } catch (e) {
    q = null;
  }
  if (!q) {
    $('read-status').textContent = 'Could not reach the question database. Check your connection and try again.';
    const retry = el('button', 'btn btn-lamp', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', startTossup);
    $('read-status').append(' ', retry);
    return;
  }
  const list = splitWords(q.text);
  cur = {
    q,
    words: list,
    times: schedule(list, settings.wpm),
    start: performance.now(),
    pausedAt: null,
    shown: 0,
    phase: 'reading', // reading | window | answering | judging | done
    buzzShown: null,
    given: '',
    prompted: false,
    judgedBy: null,
    ok: false,
    recordId: null,
  };
  $('read-status').textContent = '';
  renderMeta(q);
  $('b-num').textContent = String(session.heard + 1);
  $('pause').disabled = false;
  $('pause').textContent = 'Pause';
  $('skip').disabled = false;
  $('q-card').classList.remove('paused');
  setBuzzEnabled(true);
  $('b-clock-label').textContent = 'Read';
  clock.read = setTimeout(tick, READ_STEP_MS);
}

function renderMeta(q) {
  const meta = $('q-meta');
  meta.textContent = '';
  const badge = el('span', 'badge' + (q.source === 'ai' ? ' badge-ai' : ''), badgeOf(q.source));
  meta.append(badge, ` ${catLine(q)}`);
}

function paintWords(n) {
  if (n === cur.shown && $('q-text').childNodes.length) return;
  cur.shown = n;
  const t = $('q-text');
  t.textContent = cur.words.slice(0, n).join(' ');
  const caret = el('span', 'caret' + (cur.phase === 'reading' ? '' : ' blink'));
  caret.setAttribute('aria-hidden', 'true');
  t.append(caret);
}

function tick() {
  if (!cur || cur.phase !== 'reading' || cur.pausedAt !== null) return;
  const elapsed = performance.now() - cur.start;
  const n = shownAt(cur.times, elapsed);
  paintWords(n);
  $('b-clock').textContent = pct(n / cur.words.length);
  if (n >= cur.words.length && elapsed >= cur.times[cur.times.length - 1]) {
    endOfReading();
    return;
  }
  clock.read = setTimeout(tick, READ_STEP_MS);
}

function endOfReading() {
  cur.phase = 'window';
  paintWords(cur.words.length);
  const deadline = performance.now() + settings.buzzSecs * 1000;
  $('b-clock-label').textContent = 'Buzz';
  countdown(deadline, () => {
    if (cur && cur.phase === 'window') finish({ ok: false, buzz: null, reason: 'nobuzz' });
  });
}

/** Run the scoreboard clock down to `deadline`, then call `done`. */
function countdown(deadline, done, bar) {
  clearInterval(clock.timer);
  const total = deadline - performance.now();
  const step = () => {
    if (cur && cur.pausedAt !== null) return;
    const left = Math.max(0, deadline - performance.now());
    const num = $('b-clock');
    num.textContent = (left / 1000).toFixed(left < 10000 ? 1 : 0);
    num.classList.toggle('urgent', left < 3000);
    if (bar) bar.style.transform = `scaleX(${total > 0 ? left / total : 0})`;
    if (left <= 0) {
      clearInterval(clock.timer);
      num.classList.remove('urgent');
      done();
    }
  };
  step();
  clock.timer = setInterval(step, 100);
}

function setBuzzEnabled(on) {
  $('buzz').disabled = !on;
}

function buzz() {
  if (!cur || (cur.phase !== 'reading' && cur.phase !== 'window') || cur.pausedAt !== null) return;
  clearTimeout(clock.read);
  clearInterval(clock.timer);
  // The buzz point is what was on screen when the button went down.
  cur.buzzShown = cur.phase === 'window' ? cur.words.length : Math.max(1, shownAt(cur.times, performance.now() - cur.start));
  paintWords(cur.buzzShown);
  cur.phase = 'answering';
  setBuzzEnabled(false);
  $('pause').disabled = true;
  $('skip').disabled = true;
  $('b-buzz').textContent = pct(buzzFraction(cur.buzzShown, cur.words.length));
  openAnswer('Your answer');
}

function openAnswer(label) {
  const form = $('answer-form');
  form.hidden = false;
  // The buzzer steps aside so the phone keyboard does not push the answer box under it.
  $('buzz-dock').hidden = true;
  $('answer-label').textContent = label;
  const input = $('answer-input');
  input.value = '';
  input.focus();
  $('b-clock-label').textContent = 'Answer';
  countdown(performance.now() + settings.answerSecs * 1000, () => submitAnswer(), $('answer-bar'));
}

async function submitAnswer() {
  if (!cur || cur.phase !== 'answering') return;
  clearInterval(clock.timer);
  const given = $('answer-input').value.trim();
  cur.phase = 'judging';
  $('answer-form').hidden = true;
  $('read-status').textContent = 'Checking...';
  const { directive, by } = await judgeAnswer(cur.q.answerHtml, given);
  cur.judgedBy = by;
  $('read-status').textContent = '';
  if (directive === 'prompt' && !cur.prompted) {
    cur.prompted = true;
    cur.phase = 'answering';
    cur.given = given;
    announce('Prompt. Be more specific.');
    openAnswer(`Prompt on "${given}": be more specific`);
    return;
  }
  cur.given = cur.prompted ? `${cur.given}, then ${given || '(nothing)'}` : given;
  finish({ ok: directive === 'accept', buzz: buzzFraction(cur.buzzShown, cur.words.length), reason: given ? 'answered' : 'blank' });
}

function finish({ ok, buzz, reason }) {
  stopClocks();
  cur.phase = 'done';
  cur.ok = ok;
  cur.reason = reason;
  const q = cur.q;
  const rec = {
    id: `${Date.now()}-${q.id}`,
    qid: q.id,
    src: q.source,
    cat: q.category,
    sub: q.subcategory,
    era: q.era,
    region: q.region,
    ok,
    buzz: cur.buzzShown === null ? null : buzz,
    ovr: false,
    ts: Date.now(),
    diff: Number.isFinite(q.difficulty) ? q.difficulty : null,
    fx: q.fx || [],
    fmt: q.source === 'iac-packet-short' ? 'short' : 'tossup',
    sg: q.subGuess === true,
  };
  cur.recordId = rec.id;
  records.push(rec);
  saveRecords(storage, records);
  seen = addSeen(storage, seen, q.id);
  session.heard++;
  if (ok) {
    session.right++;
    session.buzzes.push(buzz);
  }
  $('b-right').textContent = String(session.right);
  showResult();
}

// ---------- result and card-the-clue ----------

function showResult() {
  const q = cur.q;
  show('screen-result');
  const title = $('result-title');
  const buzzPct = cur.buzzShown === null ? null : buzzFraction(cur.buzzShown, cur.words.length);
  title.className = 'result-title ' + (cur.ok ? 'ok' : 'no');
  if (cur.ok) title.textContent = `Correct, at ${pct(buzzPct)}`;
  else if (cur.reason === 'nobuzz') title.textContent = 'No buzz';
  else title.textContent = 'Not this time';
  const sub = $('result-sub');
  if (cur.reason === 'nobuzz') sub.textContent = 'The question ran out before you buzzed.';
  else sub.textContent = `You said "${cur.given || '(nothing)'}"${cur.judgedBy && cur.judgedBy !== 'none' ? `, judged by ${cur.judgedBy}` : ''}.`;
  updateOverrideButton();
  $('answer-lines').hidden = true;
  $('show-lines').setAttribute('aria-expanded', 'false');
  $('show-lines').textContent = 'Show the accept and prompt lines';
  renderAnswerline($('answerline'), q.answerHtml);
  $('answer-main').textContent = mainAnswer(q.answerHtml) || q.answerPlain;
  renderClues();
  $('card-editor').hidden = true;
  $('card-status').textContent = '';
  const where = [q.set, q.packet ? `packet ${q.packet}` : '', q.number ? `question ${q.number}` : ''].filter(Boolean).join(', ');
  $('q-source').textContent = sourceLine(q, where);
  $('fix-form').hidden = true;
  $('fix-open').setAttribute('aria-expanded', 'false');
  $('fix-status').textContent = '';
  $('report-form').hidden = true;
  $('report-open').setAttribute('aria-expanded', 'false');
  $('report-status').textContent = '';
  title.focus({ preventScroll: true });
  announce(`${title.textContent}. The answer was ${$('answer-main').textContent}.`);
  refreshHome();
}

function sourceLine(q, where) {
  const tag = (field, text) => `${text} (${(q.fx || []).includes(field) ? 'your tag' : 'estimated'})`;
  const cat = (q.fx || []).some((k) => k === 'cat' || k === 'sub') ? ` Category: ${q.category} / ${q.subcategory} (your tag).` : '';
  return `Source: ${SOURCE_LABEL[q.source] || q.source}${where ? ` (${where})` : ''}.${cat} Era: ${tag('era', ERA_LABEL[q.era] || q.era)}. Region: ${tag('region', q.region)}.`;
}

// ---------- fixing a question's tags ----------

function fillSelect(select, options, value) {
  select.textContent = '';
  for (const [v, label] of options) {
    const o = el('option', null, label);
    o.value = v;
    select.append(o);
  }
  if (!options.some(([v]) => v === value)) {
    const o = el('option', null, value);
    o.value = value;
    select.prepend(o);
  }
  select.value = value;
}

const subOptions = (cat) => (SUBCATEGORIES[cat] || [cat]).map((s) => [s, s]);

function openFix() {
  const q = cur.q;
  const form = $('fix-form');
  form.hidden = !form.hidden;
  $('fix-open').setAttribute('aria-expanded', String(!form.hidden));
  if (form.hidden) return;
  fillSelect($('fix-cat'), CATEGORIES.map((c) => [c, c]), q.category);
  fillSelect($('fix-sub'), subOptions(q.category), q.subcategory);
  fillSelect($('fix-era'), [...ERAS.map((e) => [e.key, e.label]), ['unknown', 'Era unclear']], q.era);
  fillSelect($('fix-region'), [...REGIONS, 'Ancient world', 'Geography', 'Region unclear'].map((r) => [r, r]), q.region);
  $('fix-status').textContent = '';
  $('fix-cat').focus();
}

function saveFixForm(e) {
  e.preventDefault();
  const q = cur.q;
  const next = { cat: $('fix-cat').value, sub: $('fix-sub').value, era: $('fix-era').value, region: $('fix-region').value };
  // Only what changed is stored as a correction.
  const was = { cat: q.category, sub: q.subcategory, era: q.era, region: q.region };
  const fix = {};
  for (const k of Object.keys(next)) if (next[k] !== was[k]) fix[k] = next[k];
  if (!Object.keys(fix).length) {
    $('fix-status').textContent = 'Nothing changed.';
    return;
  }
  const st = saveFix(storage, { fixes, records, cards }, q.id, fix);
  fixes = st.fixes;
  records = st.records;
  cards = st.cards;
  cur.q = withFix(q, fixes);
  $('fix-form').hidden = true;
  $('fix-open').setAttribute('aria-expanded', 'false');
  const where = [cur.q.set, cur.q.packet ? `packet ${cur.q.packet}` : '', cur.q.number ? `question ${cur.q.number}` : ''].filter(Boolean).join(', ');
  $('q-source').textContent = sourceLine(cur.q, where);
  $('fix-status').textContent = 'Saved. Stats and the weakest-areas filter now use your tags for this question.';
  $('fix-open').focus();
  refreshHome();
}

function updateOverrideButton() {
  const b = $('override');
  b.textContent = cur.ok ? 'Actually, I was wrong' : 'I was right';
  // With no answer given there is nothing to overrule.
  b.hidden = cur.reason === 'nobuzz' || cur.reason === 'blank';
}

function override() {
  const rec = records.find((r) => r.id === cur.recordId);
  if (!rec) return;
  const buzz = cur.buzzShown === null ? null : buzzFraction(cur.buzzShown, cur.words.length);
  rec.ok = !rec.ok;
  rec.ovr = !rec.ovr;
  cur.ok = rec.ok;
  if (rec.ok) {
    session.right++;
    session.buzzes.push(buzz);
  } else {
    session.right--;
    const i = session.buzzes.indexOf(buzz);
    if (i >= 0) session.buzzes.splice(i, 1);
  }
  saveRecords(storage, records);
  $('b-right').textContent = String(session.right);
  const title = $('result-title');
  title.className = 'result-title ' + (cur.ok ? 'ok' : 'no');
  title.textContent = cur.ok ? `Correct, at ${pct(buzz)} (your call)` : 'Not this time (your call)';
  updateOverrideButton();
  announce(title.textContent);
  refreshHome();
}

function renderClues() {
  const box = $('clues');
  box.textContent = '';
  const marker = cur.buzzShown === null ? cur.words.length : cur.buzzShown;
  for (const [a, b] of sentences(cur.words)) {
    const btn = el('button', 'clue');
    btn.type = 'button';
    const text = cur.words.slice(a, b).join(' ');
    if (marker > a && marker < b) {
      btn.append(cur.words.slice(a, marker).join(' '));
      const m = el('span', 'buzz-mark', cur.buzzShown === null ? 'end' : 'buzz');
      btn.append(m, cur.words.slice(marker, b).join(' '));
    } else {
      btn.append(text);
      if (marker === b) btn.append(el('span', 'buzz-mark', cur.buzzShown === null ? 'end' : 'buzz'));
    }
    if (a >= marker) btn.classList.add('unheard');
    if (cards.some((c) => c.qid === cur.q.id && c.front === text)) btn.classList.add('carded');
    btn.setAttribute('aria-label', `Make a card: ${text}`);
    btn.addEventListener('click', () => openCardEditor(text, btn));
    box.append(btn);
  }
}

let editingClue = null;
function openCardEditor(text, btn) {
  editingClue = btn;
  $('card-editor').hidden = false;
  $('card-front').value = text;
  $('card-back').value = mainAnswer(cur.q.answerHtml) || cur.q.answerPlain;
  $('card-status').textContent = '';
  $('card-front').focus();
}

function saveCard(e) {
  e.preventDefault();
  const front = $('card-front').value.trim();
  const back = $('card-back').value.trim();
  if (!front || !back) {
    $('card-status').textContent = 'A card needs a front and a back.';
    return;
  }
  const q = cur.q;
  cards.push({ id: uid(), front, back, qid: q.id, src: q.source, cat: q.category, sub: q.subcategory, era: q.era, created: Date.now(), fsrs: null });
  const ok = saveCards(storage, cards);
  if (editingClue) editingClue.classList.add('carded');
  $('card-editor').hidden = true;
  $('card-status').textContent = ok ? `Card saved. You have ${cards.length}.` : 'This browser would not save the card (storage is full or blocked).';
  if (editingClue) editingClue.focus();
  refreshHome();
}

async function report(e) {
  e.preventDefault();
  const status = $('report-status');
  status.textContent = 'Sending...';
  try {
    await sendReport({ qid: cur.q.id, source: cur.q.source, note: $('report-note').value.trim() });
    status.textContent = 'Thanks. The report was logged with this question\'s id.';
    $('report-form').hidden = true;
    $('report-open').setAttribute('aria-expanded', 'false');
    $('report-note').value = '';
  } catch (err) {
    status.textContent = 'The report did not go through. Try again in a moment.';
  }
}

// ---------- pause and skip ----------

function togglePause() {
  if (!cur || (cur.phase !== 'reading' && cur.phase !== 'window')) return;
  const now = performance.now();
  if (cur.pausedAt === null) {
    cur.pausedAt = now;
    clearTimeout(clock.read);
    $('pause').textContent = 'Resume';
    $('q-card').classList.add('paused');
    setBuzzEnabled(false);
    announce('Paused');
  } else {
    const gap = now - cur.pausedAt;
    cur.start += gap;
    cur.pausedAt = null;
    $('pause').textContent = 'Pause';
    $('q-card').classList.remove('paused');
    setBuzzEnabled(true);
    if (cur.phase === 'reading') clock.read = setTimeout(tick, READ_STEP_MS);
    else endOfReading();
  }
}

function skip() {
  if (!cur || (cur.phase !== 'reading' && cur.phase !== 'window')) return;
  // A skipped question is not recorded, but it is shown so a clue can still be carded.
  stopClocks();
  cur.phase = 'done';
  cur.reason = 'nobuzz';
  cur.ok = false;
  cur.recordId = null;
  seen = addSeen(storage, seen, cur.q.id);
  showResult();
  $('result-title').textContent = 'Skipped';
  $('result-sub').textContent = 'Not counted in your stats.';
  $('override').hidden = true;
}

function startSession() {
  session = { heard: 0, right: 0, buzzes: [] };
  $('b-right').textContent = '0';
  $('b-buzz').textContent = '-';
  const note = $('focus-note');
  note.hidden = !focus;
  if (focus) $('focus-text').textContent = `Focus: ${focus.areas.map((a) => a.label).join(', ')}.`;
  startTossup();
}

function leaveReader() {
  stopClocks();
  cur = null;
  refreshHome();
  show('screen-home');
  $('home-title').focus({ preventScroll: true });
}

// ---------- stats ----------

const DIMENSIONS = [
  ['cat', 'By category', (k) => k],
  ['sub', 'By subcategory', (k) => k],
  ['era', 'By era (estimated)', (k) => ERA_LABEL[k] || k],
  ['region', 'By region (estimated)', (k) => k],
];

// Each source and format is shown apart: the Bee runs harder than a
// regional set, and short tossups and lightning answers are different skills.
const PACKET_SHORT = 'iac-packet-short';
const SOURCE_FILTERS = {
  regional: (r) => r.src !== BEE_SOURCE && r.fmt === 'tossup',
  [PACKET_SHORT]: (r) => r.fmt === 'short',
  [BEE_SOURCE]: (r) => r.src === BEE_SOURCE,
  all: () => true,
};

function summary(list, noun = 'tossup') {
  const ok = list.filter((r) => r.ok);
  const buzzes = ok.map((r) => r.buzz).filter((b) => b !== null);
  if (!list.length) return 'none yet';
  const buzz = buzzes.length ? `, average correct buzz at ${pct(buzzes.reduce((a, b) => a + b, 0) / buzzes.length)}` : '';
  return `${plural(list.length, noun)}, ${pct(ok.length / list.length)} right${buzz}`;
}

function statsTable(title, rows, label, withBuzz = true) {
  const block = el('section', 'stats-block');
  block.append(el('h2', null, title));
  const table = el('table', 'rounds stats-table');
  const head = el('tr');
  const cols = [[title.replace('By ', '').replace(/^./, (c) => c.toUpperCase()), ''], ['Heard', 'num'], ['Right', 'num'], ['', 'bar-cell']];
  if (withBuzz) cols.push(['Buzz', 'num']);
  for (const [t, cls] of cols) {
    const th = el('th', cls, t);
    th.scope = 'col';
    head.append(th);
  }
  head.children[3].append(el('span', 'visually-hidden', 'Accuracy bar'));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', 'name', label(r.key)), el('td', 'num', String(r.heard)), el('td', 'num', pct(r.accuracy)));
    const barCell = el('td', 'bar-cell');
    const bar = el('span', 'acc-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span');
    fill.style.width = `${Math.round(r.accuracy * 100)}%`;
    bar.append(fill);
    barCell.append(bar);
    tr.append(barCell);
    if (withBuzz) tr.append(el('td', 'num', pct(r.avgBuzz)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  block.append(table);
  return block;
}

function renderStats() {
  const filter = SOURCE_FILTERS[$('stats-source').value] || SOURCE_FILTERS.regional;
  const box = $('stats-tables');
  box.textContent = '';
  const weakBox = $('stats-weak');
  weakBox.textContent = '';
  const lightningAll = records.filter((r) => r.fmt === 'lightning');
  if (records.length) {
    const totals = el('dl', 'stats-split');
    const line = (label, list, noun) => totals.append(el('dt', null, label), el('dd', null, summary(list, noun)));
    line('Regional level', records.filter(SOURCE_FILTERS.regional));
    if (records.some(SOURCE_FILTERS[PACKET_SHORT])) line('IAC packet short tossups (Q1)', records.filter(SOURCE_FILTERS[PACKET_SHORT]));
    line('IAC Bee nationals (harder)', records.filter(SOURCE_FILTERS[BEE_SOURCE]));
    if (lightningAll.length) line('Lightning round', lightningAll, 'question');
    weakBox.append(totals);
    const h = el('h2', 'weak-title', 'Your weakest areas');
    const list = el('ol', 'weak-list');
    const note = el('p', 'weak-note');
    weakBox.append(h, list, note);
    renderWeak(list, note, null);
  }
  const mine = records.filter((r) => r.fmt !== 'lightning' && filter(r));
  if (!mine.length && !lightningAll.length) {
    box.append(el('p', 'game-status', records.length ? 'No tossups from this source yet.' : 'Nothing yet. Read a few tossups first.'));
    return;
  }
  for (const [field, title, label] of DIMENSIONS) {
    const rows = aggregate(records, field, (r) => r.fmt !== 'lightning' && filter(r));
    if (rows.length) box.append(statsTable(title, rows, label));
  }
  if (lightningAll.length) {
    // Lightning answers have no buzz point; they are shown by category from every source.
    box.append(statsTable('Lightning round, by category', aggregate(lightningAll, 'cat'), (k) => k, false));
  }
}

function doExport() {
  const data = exportData(storage);
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `historybowl-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('stats-status').textContent = `Exported ${plural(data.records.length, 'tossup')} and ${plural(data.cards.length, 'card')}.`;
}

function doImport(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('stats-status');
  if (file.size > 20 * 1024 * 1024) {
    status.textContent = 'That file is too large to be an export from here.';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch (err) {
      status.textContent = 'That file is not valid JSON.';
      return;
    }
    const res = importData(storage, data);
    if (!res.ok) {
      status.textContent = res.error;
      return;
    }
    records = loadRecords(storage);
    cards = loadCards(storage);
    fixes = loadFixes(storage);
    status.textContent = `Imported ${plural(res.records, 'new tossup')}, ${plural(res.cards, 'new card')} and ${plural(res.fixes, 'tag correction')}.`;
    renderStats();
    refreshHome();
  };
  reader.onerror = () => {
    status.textContent = 'Could not read that file.';
  };
  reader.readAsText(file);
}

// ---------- flashcard review ----------

let review = null;

function startReview() {
  const list = interleave(dueToday(cards));
  // Cards due now first; ones waiting out a short step today go last.
  const now = Date.now();
  const ready = list.filter((c) => dueNow([c], now).length);
  const later = list.filter((c) => !dueNow([c], now).length);
  review = { order: [...ready, ...later].map((c) => c.id), done: 0, again: 0, cur: null, revealed: false };
  show('screen-review');
  $('review-title').focus({ preventScroll: true });
  $('deck-offer').hidden = cards.some((c) => c.deck === 'starter');
  nextCard();
}

function cardById(id) {
  return cards.find((c) => c.id === id);
}

function reviewBoard() {
  $('r-left').textContent = String(review.order.length);
  $('r-done').textContent = String(review.done);
  $('r-again').textContent = String(review.again);
  $('r-total').textContent = String(cards.length);
}

function nextCard() {
  let card = null;
  while (review.order.length && !card) card = cardById(review.order.shift());
  review.cur = card;
  review.revealed = false;
  reviewBoard();
  const has = Boolean(card);
  $('review-card').hidden = !has;
  $('review-empty').hidden = has;
  if (!has) {
    const upcoming = cards.filter((c) => c.fsrs).map((c) => c.fsrs.due).sort((a, b) => a - b)[0];
    const msg = !cards.length
      ? 'No cards yet. Miss a tossup, tap the clue that would have told you the answer, and it lands here. Or add the starter deck below.'
      : review.done
        ? `Done for now: ${plural(review.done, 'card')} reviewed.${upcoming ? ` The next card is due ${whenText(upcoming)}.` : ''}`
        : `Nothing due.${upcoming ? ` The next card is due ${whenText(upcoming)}.` : ''}`;
    $('review-empty-text').textContent = msg;
    announce(msg);
    refreshHome();
    return;
  }
  const meta = $('r-meta');
  meta.textContent = '';
  const ai = card.src === 'ai';
  meta.append(el('span', 'badge' + (ai ? ' badge-ai' : ''), ai ? 'AI-written' : card.src === BEE_SOURCE ? 'IAC Bee clue' : 'Your card'), ` ${card.cat}${card.sub && card.sub !== card.cat ? ' / ' + card.sub.replace(' History', '') : ''}`);
  $('r-front').textContent = card.front;
  $('r-input').value = '';
  $('r-form').hidden = false;
  $('r-back-box').hidden = true;
  $('r-status').textContent = '';
  $('r-report').hidden = !ai;
  $('r-input').focus({ preventScroll: true });
}

function whenText(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `at ${time} today` : `on ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

function revealCard(e) {
  if (e) e.preventDefault();
  if (!review || !review.cur || review.revealed) return;
  review.revealed = true;
  const card = review.cur;
  const typed = $('r-input').value.trim();
  $('r-form').hidden = true;
  $('r-back-box').hidden = false;
  $('r-back').textContent = card.back;
  $('r-hint').textContent = typed
    ? `You said "${typed}". ${checkLocal(card.back, typed).directive === 'accept' ? 'That looks right.' : 'Compare it with the answer.'}`
    : '';
  const row = $('rate-row');
  row.textContent = '';
  const gaps = preview(card.fsrs);
  for (const r of RATINGS) {
    const b = el('button', 'btn rate rate-' + r.key);
    b.type = 'button';
    b.dataset.rating = String(r.rating);
    b.append(el('span', 'rate-name', r.label), el('span', 'rate-gap', gaps[r.key]));
    b.setAttribute('aria-label', `${r.label}, back in ${gaps[r.key]} (key ${r.keyHint})`);
    b.addEventListener('click', () => rateCard(r.rating));
    row.append(b);
  }
  const good = row.querySelector('.rate-good');
  if (good) good.focus({ preventScroll: true });
  announce(`Answer: ${card.back}`);
}

function rateCard(rating) {
  if (!review || !review.cur || !review.revealed) return;
  const card = review.cur;
  const now = Date.now();
  card.fsrs = rate(card.fsrs, rating, now);
  saveCards(storage, cards);
  review.done++;
  if (rating === RATINGS[0].rating) {
    review.again++;
    // Missed: it comes back at the end of this session.
    review.order.push(card.id);
  }
  nextCard();
}

function deleteCard() {
  if (!review || !review.cur) return;
  const b = $('r-delete');
  // Two taps, so a stray one does not lose a card.
  if (b.dataset.armed !== review.cur.id) {
    b.dataset.armed = review.cur.id;
    b.textContent = 'Tap again to delete';
    return;
  }
  delete b.dataset.armed;
  b.textContent = 'Delete this card';
  cards = cards.filter((c) => c.id !== review.cur.id);
  saveCards(storage, cards);
  $('r-status').textContent = 'Card deleted.';
  nextCard();
}

async function reportCard() {
  if (!review || !review.cur) return;
  const status = $('r-status');
  status.textContent = 'Sending...';
  try {
    await sendReport({ qid: `deck:${review.cur.id}`, source: 'ai', note: `Card: ${review.cur.front.slice(0, 200)} => ${review.cur.back}` });
    status.textContent = "Thanks. The report was logged with this card's id.";
  } catch (err) {
    status.textContent = 'The report did not go through. Try again in a moment.';
  }
}

async function addStarterDeck() {
  const status = $('r-status');
  const btn = $('deck-add');
  btn.disabled = true;
  try {
    const res = await fetch(STARTER_URL);
    if (!res.ok) throw new Error(String(res.status));
    const deck = await res.json();
    const have = new Set(cards.map((c) => c.id));
    const now = Date.now();
    let added = 0;
    // Cards edited or deleted on the deck page stay that way.
    for (const c of applyDeckFixes(deck.cards || [], loadDeckFixes(storage))) {
      if (have.has(c.id)) continue;
      cards.push({ id: c.id, front: c.front, back: c.back, qid: null, src: 'ai', cat: c.cat, sub: c.sub, era: c.era, created: now, fsrs: null, deck: deck.id, fx: [] });
      added++;
    }
    saveCards(storage, cards);
    $('deck-offer').hidden = true;
    $('review-empty-text').textContent = '';
    announce(`Added ${plural(added, 'card')} from the starter deck.`);
    startReview();
  } catch (e) {
    btn.disabled = false;
    $('review-empty-text').textContent = 'Could not load the starter deck. Check your connection and try again.';
  }
}

// ---------- wiring ----------

function onKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (!$('screen-review').hidden && review && review.cur) {
    if (review.revealed && /^[1-4]$/.test(e.key) && !isTyping(document.activeElement)) {
      e.preventDefault();
      rateCard(RATINGS[Number(e.key) - 1].rating);
    }
    return;
  }
  const reading = !$('screen-read').hidden;
  const result = !$('screen-result').hidden;
  if (reading && (e.code === 'Space' || e.key === ' ')) {
    const t = document.activeElement;
    if (isTyping(t)) return;
    // Space on another button presses that button, as usual.
    if (t && t.tagName === 'BUTTON' && t.id !== 'buzz') return;
    e.preventDefault();
    if (!e.repeat) buzz();
  } else if (result && (e.key === 'n' || e.key === 'N') && !isTyping(document.activeElement)) {
    e.preventDefault();
    startTossup();
  }
}

function init() {
  buildSettings();
  refreshHome();
  const sim = initSim({
    settings: () => settings,
    fixes: () => fixes,
    seen: () => seen,
    addRecord(rec) {
      records.push(rec);
      saveRecords(storage, records);
      seen = addSeen(storage, seen, rec.qid);
    },
    updateRecord(id, patch) {
      const r = records.find((x) => x.id === id);
      if (!r) return;
      Object.assign(r, patch);
      saveRecords(storage, records);
    },
    addCard(card) {
      cards.push({ ...card, deck: null, fx: [] });
      return saveCards(storage, cards);
    },
    hasCard: (qid, front) => cards.some((c) => c.qid === qid && c.front === front),
    hasCardFor: (qid) => cards.some((c) => c.qid === qid),
    removeCardsFor(qid) {
      const before = cards.length;
      cards = cards.filter((c) => c.qid !== qid);
      saveCards(storage, cards);
      return before - cards.length;
    },
    saveSetting(key, value) {
      settings = { ...settings, [key]: value };
      const { teamPass, ...toSave } = settings;
      saveSettings(storage, toSave);
    },
    packetsUsed: () => {
      const v = readJSON(storage, KEYS.packetsUsed, []);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    },
    usePacket(id) {
      const v = readJSON(storage, KEYS.packetsUsed, []);
      const list = (Array.isArray(v) ? v : []).filter((x) => x !== id).concat(id).slice(-60);
      writeJSON(storage, KEYS.packetsUsed, list);
    },
    refreshHome,
    home: leaveReader,
  });
  $('go-sim').addEventListener('click', () => sim.open());
  $('team-forget').addEventListener('click', forgetTeam);
  const deckPage = initDeck({
    storage,
    cards: () => cards,
    setCards(list) {
      cards = list;
      saveCards(storage, cards);
    },
    back: () => startReview(),
  });
  $('deck-manage').addEventListener('click', () => deckPage.open());
  $('go-read').addEventListener('click', () => {
    if (focus) clearFocus();
    startSession();
  });
  $('weak-go').addEventListener('click', startFocus);
  $('focus-clear').addEventListener('click', () => {
    clearFocus();
    startTossup();
  });
  $('go-review').addEventListener('click', startReview);
  $('r-form').addEventListener('submit', revealCard);
  $('r-delete').addEventListener('click', deleteCard);
  $('r-report').addEventListener('click', reportCard);
  $('deck-add').addEventListener('click', addStarterDeck);
  $('review-home').addEventListener('click', () => {
    review = null;
    leaveReader();
  });
  $('fix-open').addEventListener('click', openFix);
  $('fix-cancel').addEventListener('click', () => {
    $('fix-form').hidden = true;
    $('fix-open').setAttribute('aria-expanded', 'false');
    $('fix-open').focus();
  });
  $('fix-cat').addEventListener('change', () => fillSelect($('fix-sub'), subOptions($('fix-cat').value), subOptions($('fix-cat').value)[0][0]));
  $('fix-form').addEventListener('submit', saveFixForm);
  $('go-stats').addEventListener('click', () => {
    renderStats();
    show('screen-stats');
    $('stats-title').focus({ preventScroll: true });
  });
  // pointerdown so a tap registers the moment the finger lands.
  $('buzz').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    buzz();
  });
  $('buzz').addEventListener('click', (e) => {
    // Keyboard presses arrive as clicks with no pointer (detail 0).
    if (e.detail === 0) buzz();
  });
  $('answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAnswer();
  });
  $('pause').addEventListener('click', togglePause);
  $('skip').addEventListener('click', skip);
  $('read-home').addEventListener('click', leaveReader);
  $('result-home').addEventListener('click', leaveReader);
  $('next').addEventListener('click', startTossup);
  $('override').addEventListener('click', override);
  $('show-lines').addEventListener('click', () => {
    const box = $('answer-lines');
    box.hidden = !box.hidden;
    $('show-lines').setAttribute('aria-expanded', String(!box.hidden));
    $('show-lines').textContent = box.hidden ? 'Show the accept and prompt lines' : 'Hide the accept and prompt lines';
  });
  $('card-editor').addEventListener('submit', saveCard);
  $('card-cancel').addEventListener('click', () => {
    $('card-editor').hidden = true;
    if (editingClue) editingClue.focus();
  });
  $('report-open').addEventListener('click', () => {
    const f = $('report-form');
    f.hidden = !f.hidden;
    $('report-open').setAttribute('aria-expanded', String(!f.hidden));
    if (!f.hidden) $('report-note').focus();
  });
  $('report-form').addEventListener('submit', report);
  $('stats-source').addEventListener('change', renderStats);
  $('stats-home').addEventListener('click', leaveReader);
  $('export').addEventListener('click', doExport);
  $('import').addEventListener('change', doImport);
  document.addEventListener('keydown', onKey);
  // A question fetched ahead makes the first tap instant.
  refill()?.catch(() => {});
}

init();
