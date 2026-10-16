// /12axes/: the twelve-axis political values test. Everything runs here in
// the browser; answers are kept only in localStorage and in the #fragment of
// share links, and nothing is sent to any server.
import questionsData from '../../data/12axes/questions.json';
import ideologiesData from '../../data/12axes/ideologies.json';
import ideologyText from '../../data/12axes/ideology-text.json';
import referenceData from '../../data/12axes/reference.json';
import axesText from '../../data/12axes/axes.json';
import { AXES, DISPLAY_ORDER } from './axes.js';
import { ANSWERS, scoreAxes, impact, axisCounts } from './score.js';
import { MODES, pickQuestions, rng } from './select.js';
import { refPoint, rank, DIM_LABELS, DIMS } from './match.js';
import { encodeResult, decodeResult, parseHash, extractCode } from './share.js';
import { radarMarkup, radarSummary, W, H } from './radar.js';
import * as store from './store.js';

const bank = questionsData.questions;
const ideologies = ideologiesData.ideologies;
const library = referenceData.items;
const $ = (id) => document.getElementById(id);
const SCREENS = ['screen-start', 'screen-quiz', 'screen-result', 'screen-compare'];
const PAGE = '/12axes/';

let session = null; // test in progress: { mode, ids, answers, at }
let view = null; // result on screen: { mode, served, answers, current, own, code }
let ownCode = null; // this visit's finished result, in case storage is blocked
let filter = 'all';

// ---------- small helpers

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

function show(screen) {
  for (const id of SCREENS) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}
const visible = (id) => !$(id).hidden;

function announce(text) {
  $('announce').textContent = '';
  setTimeout(() => { $('announce').textContent = text; }, 30);
}

const round = (x) => Math.round(x);
const points = (x) => (round(x) === 1 ? '1 point' : `${round(x)} points`);
function leanText(ax, s) {
  const r = round(s);
  if (r === 50) return '50% each way';
  return r > 50 ? `${r}% ${AXES[ax].left}` : `${100 - r}% ${AXES[ax].right}`;
}

function readingFor(ax, s) {
  const off = Math.abs(s - 50);
  const t = axesText[ax];
  if (off < 10) return 'Near the middle, with no strong lean either way.';
  const word = off >= 35 ? 'Strong' : off >= 20 ? 'Clear' : 'Slight';
  const pole = s > 50 ? AXES[ax].left : AXES[ax].right;
  return `${word} lean toward ${pole}. ${s > 50 ? t.leftReading : t.rightReading}`;
}

const isOwn = (code) => code === ownCode || code === (store.load().last || {}).code;
const linkFor = (hash) => location.origin + PAGE + '#' + hash;

function go(hash) {
  history.pushState(null, '', hash ? PAGE + '#' + hash : PAGE);
  route();
}

async function copyText(text, statusId) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back below */ }
  if (!ok) {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.className = 'visually-hidden';
    document.body.append(input);
    input.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    input.remove();
  }
  $(statusId).textContent = ok ? 'Link copied.' : 'Could not copy. Select the link and copy it by hand.';
}

// ---------- start screen

function refreshStart() {
  const data = store.load();
  const p = data.progress;
  const canResume = p && MODES[p.mode] && Array.isArray(p.ids) && p.ids.length && p.at < p.ids.length;
  $('resume').hidden = !canResume;
  if (canResume) $('resume').textContent = `Resume where you left off (${MODES[p.mode].label}, question ${p.at + 1} of ${p.ids.length})`;
  $('last').hidden = !(data.last && data.last.code);
  const ok = store.save(data);
  $('storage-note').textContent = ok ? '' : 'Your browser is blocking storage, so an unfinished test cannot be saved if you leave the page.';
}

function seed() {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 2 ** 32); }
}

function startTest(mode) {
  const p = store.load().progress;
  if (p && p.at > 0 && p.at < (p.ids || []).length &&
      !window.confirm('Start a new test? Your unfinished test will be replaced.')) return;
  const served = pickQuestions(bank, mode, rng(seed()));
  session = { mode, ids: served.map((q) => q.id), answers: [], at: 0 };
  persist();
  if (location.hash) history.pushState(null, '', PAGE);
  show('screen-quiz');
  renderQuestion();
}

function resume() {
  const p = store.load().progress;
  if (!p) return refreshStart();
  session = { mode: p.mode, ids: p.ids, answers: p.answers || [], at: p.at || 0 };
  if (location.hash) history.pushState(null, '', PAGE);
  show('screen-quiz');
  renderQuestion();
}

function persist() {
  store.update((d) => { d.progress = session; });
}

// ---------- quiz

function buildAnswerButtons() {
  ANSWERS.forEach((label, i) => {
    const b = el('button', { type: 'button', class: 'ax-answer', 'data-answer': i, 'aria-pressed': 'false' },
      el('span', { class: 'ax-key', 'aria-hidden': 'true', text: String(i + 1) }), el('span', { text: label }));
    b.addEventListener('click', () => answer(i));
    $('answers').append(b);
  });
}

function renderQuestion() {
  const q = bank[session.ids[session.at]];
  const n = session.ids.length;
  $('q-count').textContent = `Question ${session.at + 1} of ${n}`;
  $('q-mode').textContent = `${MODES[session.mode].label} test`;
  $('q-progress').style.width = `${(100 * session.at) / n}%`;
  $('statement').textContent = q.text;
  const prev = session.answers[session.at];
  for (const b of $('answers').children) b.setAttribute('aria-pressed', String(Number(b.dataset.answer) === prev));
  $('back').disabled = session.at === 0;
  $('statement').focus({ preventScroll: true });
  announce(`Question ${session.at + 1} of ${n}`);
}

function answer(i) {
  if (!session) return;
  session.answers[session.at] = i;
  session.at++;
  if (session.at >= session.ids.length) return finish();
  persist();
  renderQuestion();
}

function back() {
  if (!session || session.at === 0) return;
  session.at--;
  persist();
  renderQuestion();
}

function finish() {
  const served = session.ids.map((id) => bank[id]);
  const scores = scoreAxes(served, session.answers);
  const code = encodeResult({ mode: session.mode, scores, ids: session.ids, answers: session.answers });
  ownCode = code;
  store.update((d) => { delete d.progress; d.last = { code }; });
  session = null;
  go('r=' + code);
}

// ---------- results

function decodeFull(code) {
  const d = decodeResult(code);
  if (d.ids.some((id) => !bank[id])) throw new Error('unknown question');
  const served = d.ids.map((id) => bank[id]);
  const scores = scoreAxes(served, d.answers);
  const changed = scores.some((s, i) => Math.abs(s - d.scores[i]) > 0.5);
  return { ...d, served, scores, changed };
}

function showResult(code) {
  let d;
  try { d = decodeFull(code); } catch {
    $('load-status').textContent = 'That result link is damaged or from an older version of the test.';
    show('screen-start');
    return;
  }
  const own = isOwn(code);
  view = { mode: d.mode, served: d.served, answers: d.answers, current: d.answers.slice(), own, code };
  $('load-status').textContent = '';
  $('result-title').textContent = own ? 'Your results' : 'Shared result';
  $('result-meta').textContent = `${MODES[d.mode].label} test, ${d.served.length} statements.` +
    (d.changed ? ' This link was made with a different version of the scoring, so the scores have been recalculated.' : '');
  $('shared-banner').hidden = own;
  $('evidence-help').textContent = own
    ? 'Every statement you saw, grouped by axis and sorted by how much it moved that score. Change any answer to see what the results would be; your saved result stays as it was.'
    : 'Every statement this person saw, grouped by axis and sorted by how much it moved that score.';
  $('share-link').value = linkFor('r=' + code);
  $('copy-status').textContent = '';
  $('compare-status').textContent = '';
  renderEvidence();
  update();
  show('screen-result');
  $('result-title').focus({ preventScroll: true });
}

function currentScores() {
  return scoreAxes(view.served, view.current);
}

function update() {
  const scores = currentScores();
  const radar = $('radar');
  radar.setAttribute('viewBox', `0 0 ${W} ${H}`);
  radar.innerHTML = radarMarkup([{ scores, cls: 'a' }]);
  radar.setAttribute('aria-label', 'Radar chart: ' + radarSummary(scores));
  renderBars(scores);
  renderMatches(scores);
  const edited = view.current.some((a, i) => a !== view.answers[i]);
  $('whatif-banner').hidden = !edited;
  updateEvidence();
}

function renderBars(scores) {
  const list = $('bars');
  list.textContent = '';
  for (const ax of DISPLAY_ORDER) {
    const a = round(scores[ax]);
    const spanA = el('span', { class: 'a' });
    const spanB = el('span', { class: 'b' });
    spanA.style.width = a + '%';
    spanB.style.width = 100 - a + '%';
    list.append(el('li', null,
      el('p', { class: 'ax-bar-name', text: AXES[ax].name }),
      el('div', { class: 'ax-bar-labels' },
        el('span', { class: 'a', text: `${AXES[ax].left} ${a}%` }),
        el('span', { class: 'b', text: `${100 - a}% ${AXES[ax].right}` })),
      el('div', { class: 'ax-bar', 'aria-hidden': 'true' }, spanA, spanB),
      el('p', { class: 'ax-reading', text: readingFor(ax, scores[ax]) })));
  }
}

function coordText(stats) {
  return DIMS.map((d) => `${DIM_LABELS[d].toLowerCase()} ${stats[d]}`).join(', ');
}

function sourceName(url) {
  return url.includes('plato.stanford.edu') ? 'Stanford Encyclopedia of Philosophy' : 'Britannica';
}

function refItem({ item, similarity }) {
  return el('li', null,
    el('div', { class: 'ax-match-head' },
      el('span', { class: 'ax-match-name', text: item.name }),
      el('span', { class: 'ax-match-score', text: `${round(similarity)}% similar` })),
    el('span', { class: 'ax-match-when', text: `${item.when}, ${item.where}` }),
    el('p', { class: 'ax-match-desc', text: item.summary }),
    el('p', { class: 'ax-match-meta' },
      `Estimated position (illustrative editorial estimate): ${coordText(item.stats)}. Source: `,
      el('a', { href: item.source, rel: 'noopener', text: sourceName(item.source) }), '.'));
}

function renderMatches(scores) {
  const point = refPoint(scores);
  const ideo = $('ideologies');
  ideo.textContent = '';
  for (const { item, similarity } of rank(ideologies, point, 10)) {
    ideo.append(el('li', null,
      el('div', { class: 'ax-match-head' },
        el('a', { class: 'ax-match-name', href: item.link, rel: 'noopener', text: item.name }),
        el('span', { class: 'ax-match-score', text: `${round(similarity)}% similar` })),
      el('p', { class: 'ax-match-desc', text: ideologyText[item.name] })));
  }
  for (const [id, kind] of [['thinkers', 'thinker'], ['countries', 'country']]) {
    const list = $(id);
    list.textContent = '';
    for (const r of rank(library.filter((x) => x.kind === kind), point, 5)) list.append(refItem(r));
  }
  renderLibrary(point);
}

function renderLibrary(point) {
  const list = $('library');
  list.textContent = '';
  for (const r of rank(library.filter((x) => filter === 'all' || x.kind === filter), point)) list.append(refItem(r));
}

// Evidence rows are built once per result and updated in place, so editing
// an answer never reorders the list under the person's cursor.
let evRows = [];
let evSummaries = [];

function renderEvidence() {
  const box = $('evidence');
  box.textContent = '';
  evRows = [];
  evSummaries = [];
  const counts = axisCounts(view.served);
  for (const ax of DISPLAY_ORDER) {
    const idx = view.served.map((q, i) => i).filter((i) => view.served[i].axis === ax)
      .sort((x, y) => Math.abs(impact(view.served[y], view.answers[y], counts[ax])) -
        Math.abs(impact(view.served[x], view.answers[x], counts[ax])));
    const score = el('span', { class: 'ax-axis-score' });
    evSummaries.push({ ax, el: score });
    const list = el('ul', { class: 'ax-ev' });
    for (const i of idx) {
      const q = view.served[i];
      const impactEl = el('span', { class: 'ax-ev-impact' });
      let control;
      if (view.own) {
        control = el('select', { class: 'ax-select', 'aria-label': 'Answer to: ' + q.text });
        ANSWERS.forEach((label, a) => control.append(el('option', { value: a, text: label })));
        control.value = String(view.answers[i]);
        control.addEventListener('change', () => { view.current[i] = Number(control.value); update(); });
      } else {
        control = el('span', { text: 'Answer: ' + ANSWERS[view.answers[i]] });
      }
      const changed = el('span', { class: 'ax-changed', text: 'changed', hidden: true });
      list.append(el('li', null,
        el('p', { class: 'ax-ev-text', text: q.text }),
        el('div', { class: 'ax-ev-row' }, el('span', null, control, changed), impactEl)));
      evRows.push({ i, q, impactEl, changed, control, count: counts[ax] });
    }
    box.append(el('details', { class: 'ax-axis' },
      el('summary', null,
        el('span', { class: 'ax-axis-name', text: `${AXES[ax].name}: ${AXES[ax].left} vs. ${AXES[ax].right}` }), score),
      list));
  }
}

function updateEvidence() {
  const scores = currentScores();
  for (const { ax, el: s } of evSummaries) s.textContent = `${leanText(ax, scores[ax])}, ${axisCount(ax)} statements`;
  for (const r of evRows) {
    const a = view.current[r.i];
    const v = impact(r.q, a, r.count);
    const ax = AXES[r.q.axis];
    if (Math.abs(v) < 0.05) {
      r.impactEl.textContent = 'No effect';
      r.impactEl.classList.add('zero');
    } else {
      r.impactEl.textContent = `Moved ${Math.abs(v).toFixed(1)} points toward ${v > 0 ? ax.left : ax.right}`;
      r.impactEl.classList.remove('zero');
    }
    r.changed.hidden = a === view.answers[r.i];
    if (r.control.tagName === 'SELECT' && r.control.value !== String(a)) r.control.value = String(a);
  }
}
const axisCount = (ax) => view.served.filter((q) => q.axis === ax).length;

function whatIfReset() {
  view.current = view.answers.slice();
  update();
  $('share-link').value = linkFor('r=' + view.code);
  $('copy-status').textContent = '';
}

function whatIfShare() {
  const code = encodeResult({ mode: view.mode, scores: currentScores(), ids: view.served.map((q) => q.id), answers: view.current });
  $('share-link').value = linkFor('r=' + code);
  $('copy-status').textContent = 'The link above now holds your what-if answers.';
}

function compareFromResult() {
  const code = extractCode($('friend-link').value);
  if (!code) {
    $('compare-status').textContent = "That doesn't look like a 12 Axes result link. It should contain #r= followed by a code.";
    return;
  }
  try { decodeFull(code); } catch {
    $('compare-status').textContent = 'That link is damaged or from an older version of the test.';
    return;
  }
  const mine = view.current.some((a, i) => a !== view.answers[i])
    ? encodeResult({ mode: view.mode, scores: currentScores(), ids: view.served.map((q) => q.id), answers: view.current })
    : view.code;
  go(`c=${mine}.${code}`);
}

// ---------- compare

function showCompare(codeA, codeB) {
  let a;
  let b;
  try { a = decodeFull(codeA); b = decodeFull(codeB); } catch {
    $('load-status').textContent = 'That comparison link is damaged or from an older version of the test.';
    show('screen-start');
    return;
  }
  const mine = isOwn(codeA);
  const nameA = mine ? 'You' : 'Result A';
  const nameB = mine ? 'Friend' : 'Result B';
  $('compare-meta').textContent = `${nameA}: ${MODES[a.mode].label} test, ${a.served.length} statements. ` +
    `${nameB}: ${MODES[b.mode].label} test, ${b.served.length} statements.`;
  const legend = $('compare-legend');
  legend.textContent = '';
  for (const [name, cls, desc] of [[nameA, 'a', 'blue, solid line, round points'], [nameB, 'b', 'orange, dashed line, square points']]) {
    const sample = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sample.setAttribute('viewBox', '0 0 42 16');
    sample.setAttribute('aria-hidden', 'true');
    sample.innerHTML = `<line class="line-${cls}" x1="2" y1="8" x2="40" y2="8"/>`;
    legend.append(el('li', null, sample, el('span', null, el('strong', { text: name }), ` (${desc})`)));
  }
  const radar = $('compare-radar');
  radar.setAttribute('viewBox', `0 0 ${W} ${H}`);
  radar.innerHTML = radarMarkup([{ scores: a.scores, cls: 'a' }, { scores: b.scores, cls: 'b' }]);
  radar.setAttribute('aria-label', `Radar chart. ${nameA}: ${radarSummary(a.scores)}. ${nameB}: ${radarSummary(b.scores)}.`);
  $('col-a').textContent = nameA;
  $('col-b').textContent = nameB;

  const rows = DISPLAY_ORDER.map((ax) => ({ ax, gap: Math.abs(a.scores[ax] - b.scores[ax]) }));
  const body = $('diff');
  body.textContent = '';
  for (const { ax, gap } of rows) {
    body.append(el('tr', null,
      el('td', null, el('span', { text: AXES[ax].name }), el('span', { class: 'tag', text: `${AXES[ax].left} vs. ${AXES[ax].right}` })),
      el('td', { text: leanText(ax, a.scores[ax]) }),
      el('td', { text: leanText(ax, b.scores[ax]) }),
      el('td', { class: 'num', text: points(gap) })));
  }
  const line = ({ ax, gap }) => el('li', { text:
    `${AXES[ax].name}: ${points(gap)} apart (${nameA}: ${leanText(ax, a.scores[ax])}; ${nameB}: ${leanText(ax, b.scores[ax])})` });
  const sorted = rows.slice().sort((x, y) => y.gap - x.gap || x.ax - y.ax);
  $('gaps').replaceChildren(...sorted.slice(0, 3).map(line));
  $('agree').replaceChildren(...sorted.slice(-3).reverse().map(line));
  $('compare-link').value = linkFor(`c=${codeA}.${codeB}`);
  $('copy-compare-status').textContent = '';
  $('compare-back').onclick = () => go('r=' + codeA);
  show('screen-compare');
  $('compare-heading').focus({ preventScroll: true });
}

// ---------- routing

function route() {
  const p = parseHash(location.hash);
  if (p && p.kind === 'result') return showResult(p.a);
  if (p && p.kind === 'compare') return showCompare(p.a, p.b);
  if (visible('screen-result') || visible('screen-compare') || !location.hash) {
    if (!visible('screen-quiz')) {
      refreshStart();
      show('screen-start');
    }
  }
}

function renderAbout() {
  const list = $('about-list');
  for (const ax of DISPLAY_ORDER) {
    list.append(el('dt', { text: `${AXES[ax].name}: ${AXES[ax].left} vs. ${AXES[ax].right}` }), el('dd', { text: axesText[ax].about }));
  }
}

function init() {
  buildAnswerButtons();
  renderAbout();
  for (const b of document.querySelectorAll('.tier[data-mode]')) b.addEventListener('click', () => startTest(b.dataset.mode));
  $('resume').addEventListener('click', resume);
  $('last').addEventListener('click', () => go('r=' + store.load().last.code));
  $('back').addEventListener('click', back);
  $('quit').addEventListener('click', () => { persist(); session = null; refreshStart(); show('screen-start'); });
  $('again').addEventListener('click', () => go(''));
  $('take-own').addEventListener('click', () => go(''));
  $('copy').addEventListener('click', () => copyText($('share-link').value, 'copy-status'));
  $('copy-compare').addEventListener('click', () => copyText($('compare-link').value, 'copy-compare-status'));
  $('compare').addEventListener('click', compareFromResult);
  $('friend-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') compareFromResult(); });
  $('whatif-reset').addEventListener('click', whatIfReset);
  $('whatif-share').addEventListener('click', whatIfShare);
  for (const b of document.querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      for (const o of document.querySelectorAll('[data-filter]')) o.setAttribute('aria-pressed', String(o === b));
      renderLibrary(refPoint(currentScores()));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (!visible('screen-quiz') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key >= '1' && e.key <= '5') { e.preventDefault(); answer(Number(e.key) - 1); }
  });
  window.addEventListener('popstate', route);
  refreshStart();
  route();
}

init();
