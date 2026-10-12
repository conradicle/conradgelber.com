// History Bowl Study: the page. Solo tossup reader with a buzzer, answer
// checking, buzz-point stats and card-the-clue flashcards.
// Built to /historybowl/historybowl.js by `npm run build:historybowl`.

import { checkAnswer as checkLocal, mainAnswer } from './answer.js';
import { words as splitWords, sentences, schedule, shownAt, buzzFraction } from './text.js';
import { CATEGORIES, SUBCATEGORIES, SOURCE_LABEL } from './question.js';
import { ERA_LABEL } from './tags.js';
import {
  KEYS, readJSON, writeJSON, loadRecords, saveRecords, loadCards, saveCards,
  loadSeen, addSeen, loadSettings, saveSettings, exportData, importData, aggregate,
} from './store.js';
import { fetchTossups, checkRemote, sendReport } from './api.js';

const $ = (id) => document.getElementById(id);
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

let settings = loadSettings(storage);
let records = loadRecords(storage);
let cards = loadCards(storage);
let seen = loadSeen(storage);
let queue = [];
let fetching = null;

// The tossup in play.
let cur = null;
let session = { heard: 0, right: 0, buzzes: [] };

// ---------- small helpers ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}
function announce(text) {
  const el = $('announce');
  el.textContent = '';
  setTimeout(() => {
    el.textContent = text;
  }, 30);
}
const pct = (f) => (f === null || f === undefined ? '-' : `${Math.round(f * 100)}%`);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Build an answerline from its safe HTML using only the emphasis tags. */
function renderAnswerline(target, html) {
  target.textContent = '';
  const stack = [target];
  for (const part of String(html).split(/(<\/?(?:b|u|i|em|strong)>)/i)) {
    const open = part.match(/^<(b|u|i|em|strong)>$/i);
    const close = part.match(/^<\/(b|u|i|em|strong)>$/i);
    if (open) {
      const e = document.createElement(open[1].toLowerCase());
      stack[stack.length - 1].appendChild(e);
      stack.push(e);
    } else if (close) {
      if (stack.length > 1) stack.pop();
    } else if (part) {
      const t = document.createElement('textarea');
      t.innerHTML = part; // decodes entities only; a textarea never parses tags
      stack[stack.length - 1].appendChild(document.createTextNode(t.value));
    }
  }
}

// ---------- home ----------

function refreshHome() {
  const ok = records.filter((r) => r.ok);
  const buzzes = ok.map((r) => r.buzz).filter((b) => b !== null);
  $('home-heard').textContent = String(records.length);
  $('home-acc').textContent = records.length ? pct(ok.length / records.length) : '-';
  $('home-buzz').textContent = buzzes.length ? pct(buzzes.reduce((a, b) => a + b, 0) / buzzes.length) : '-';
  $('home-cards').textContent = String(cards.length);
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
  form.addEventListener('input', onSettingsChange);
  form.addEventListener('change', onSettingsChange);
  form.addEventListener('submit', (e) => e.preventDefault());
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
  saveSettings(storage, settings);
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
  fetching = fetchTossups(settings, BATCH)
    .then((list) => {
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
  if (!queue.length) {
    // Offline: questions fetched last time are kept on the device.
    const saved = readJSON(storage, KEYS.queue, []);
    if (Array.isArray(saved) && saved.length) queue = saved.filter((q) => q && q.id && q.text && q.answerHtml);
  }
  if (!queue.length) {
    try {
      await refill();
    } catch (e) {
      // handled below
    }
  }
  if (!queue.length) return null;
  const q = queue.shift();
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
  const badge = el('span', 'badge' + (q.source === 'ai' ? ' badge-ai' : ''), q.source === 'ai' ? 'AI-written' : q.source === 'iac-bee-qbreader' ? 'IAC Bee' : 'QB Reader');
  meta.append(badge, ` ${q.category}${q.subcategory && q.subcategory !== q.category ? ' / ' + q.subcategory.replace(' History', '') : ''}`);
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
  const { directive, by } = await judge(cur.q, given);
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

/** QB Reader's checker first; the local one if it is slow or out of reach. */
async function judge(q, given) {
  if (!given) return { directive: 'reject', by: 'none' };
  try {
    const r = await checkRemote(q.answerHtml, given, 2500);
    return { directive: r.directive, by: 'QB Reader' };
  } catch (e) {
    return { directive: checkLocal(q.answerHtml, given).directive, by: 'this page (QB Reader was out of reach)' };
  }
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
  $('q-source').textContent = `Source: ${SOURCE_LABEL[q.source] || q.source}${where ? ` (${where})` : ''}. Era: ${ERA_LABEL[q.era] || q.era} (estimated). Region: ${q.region} (estimated).`;
  $('report-form').hidden = true;
  $('report-open').setAttribute('aria-expanded', 'false');
  $('report-status').textContent = '';
  title.focus({ preventScroll: true });
  announce(`${title.textContent}. The answer was ${$('answer-main').textContent}.`);
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

function renderStats() {
  const src = $('stats-source').value;
  const filter = (r) => !src || r.src === src;
  const box = $('stats-tables');
  box.textContent = '';
  const mine = records.filter(filter);
  if (!mine.length) {
    box.append(el('p', 'game-status', 'Nothing yet. Read a few tossups first.'));
    return;
  }
  const ok = mine.filter((r) => r.ok);
  const buzzes = ok.map((r) => r.buzz).filter((b) => b !== null);
  box.append(el('p', 'stats-total', `${plural(mine.length, 'tossup')} heard, ${pct(ok.length / mine.length)} right, average correct buzz at ${buzzes.length ? pct(buzzes.reduce((a, b) => a + b, 0) / buzzes.length) : '-'}.`));
  for (const [field, title, label] of DIMENSIONS) {
    const rows = aggregate(records, field, filter);
    const block = el('section', 'stats-block');
    block.append(el('h2', null, title));
    const table = el('table', 'rounds stats-table');
    const head = el('tr');
    for (const [t, cls] of [['', ''], ['Heard', 'num'], ['Right', 'num'], ['', 'bar-cell'], ['Buzz', 'num']]) {
      const th = el('th', cls, t);
      th.scope = 'col';
      head.append(th);
    }
    if (head.firstChild) head.firstChild.textContent = title.replace('By ', '').replace(/^./, (c) => c.toUpperCase());
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
      tr.append(barCell, el('td', 'num', pct(r.avgBuzz)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    block.append(table);
    box.append(block);
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
    status.textContent = `Imported ${plural(res.records, 'new tossup')} and ${plural(res.cards, 'new card')}.`;
    renderStats();
    refreshHome();
  };
  reader.onerror = () => {
    status.textContent = 'Could not read that file.';
  };
  reader.readAsText(file);
}

// ---------- wiring ----------

function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
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
  $('go-read').addEventListener('click', () => {
    session = { heard: 0, right: 0, buzzes: [] };
    $('b-right').textContent = '0';
    $('b-buzz').textContent = '-';
    startTossup();
  });
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
