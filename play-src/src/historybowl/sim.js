// The match simulator: a full four-quarter National History Bowl match
// against the computer. Rules and the computer's play are in match.js;
// this file runs the screens.

import { mainAnswer } from './answer.js';
import { words as splitWords, sentences, schedule, shownAt, buzzFraction } from './text.js';
import { fetchTossups, fetchBonuses } from './api.js';
import { withFix } from './store.js';
import { $, show, announce, pct, el, plural, uid, renderAnswerline, judge, isTyping, sleep } from './ui.js';
import {
  QUARTERS, LIGHTNING, BONUS_POINTS, TOSSUP_POINTS, tossupPoints, lightningPoints, firstPick, shorten,
  botProfile, botTossup, botAfterMiss, botBonus, botLightning, botBounce, botBuzzWord, BOT_PRESETS,
  offerCategories, lightningFromBonuses, newMatch, award, unaward, scores, afterFourth, winner,
} from './match.js';

const YOU = 0;
const BOT = 1;
const READ_STEP_MS = 40;
const TIEBREAK_TOSSUPS = 4;
const ORDINAL = ['first', 'second', 'third', 'fourth'];

class Abort extends Error {}

export function initSim(ctx) {
  // ctx: { settings(), fixes(), seen(), addRecord(rec), addCard(card) -> bool, hasCard(qid, front), refreshHome(), home() }
  let live = 0;
  let m = null;
  let profile = null;
  let pool = null;
  let items = [];
  let reading = null;
  let pending = null;
  let fast = false;

  // ---------- waiting on the player ----------

  /** A promise the page's buttons resolve; `kinds` lists the events that settle it. */
  function wait(kinds) {
    return new Promise((resolve, reject) => {
      pending = { kinds, resolve, reject };
    });
  }
  function fire(kind, value) {
    if (pending && pending.kinds.includes(kind)) {
      const p = pending;
      pending = null;
      p.resolve({ kind, value });
      return true;
    }
    return false;
  }
  function alive(id) {
    if (id !== live) throw new Abort();
  }

  // ---------- board ----------

  function board() {
    $('s-you').textContent = String(m.teams[YOU].score);
    $('s-bot').textContent = String(m.teams[BOT].score);
  }
  function setQuarter(text) {
    $('s-quarter').textContent = text;
  }
  function setClock(label, text) {
    $('s-clock-label').textContent = label;
    const num = $('s-clock');
    num.textContent = text;
    num.classList.remove('urgent');
  }
  function status(text) {
    $('s-status').textContent = text;
  }

  function resetStage() {
    $('s-form').hidden = true;
    $('s-ruling').hidden = true;
    $('s-cats').hidden = true;
    $('s-cats').textContent = '';
    $('s-pass').hidden = true;
    $('s-fast').hidden = true;
    $('s-buzz-dock').hidden = true;
    $('s-pause').hidden = true;
    $('s-text').textContent = '';
    $('s-meta').textContent = '';
    status('');
  }

  function meta(q, extra = []) {
    const box = $('s-meta');
    box.textContent = '';
    const ai = q.source === 'ai';
    box.append(el('span', 'badge' + (ai ? ' badge-ai' : ''), ai ? 'AI-written' : q.source === 'iac-bee-qbreader' ? 'IAC Bee' : 'QB Reader'));
    const cat = `${q.category}${q.subcategory && q.subcategory !== q.category ? ' / ' + q.subcategory.replace(' History', '') : ''}`;
    box.append(' ' + [cat, ...extra].join(' \u00b7 '));
  }

  // ---------- answering ----------

  /** Show the answer box with a countdown; resolves with what was typed when it is sent or time runs out. */
  async function ask(label, seconds, id, { pass = false } = {}) {
    const form = $('s-form');
    form.hidden = false;
    $('s-label').textContent = label;
    $('s-pass').hidden = !pass;
    const input = $('s-input');
    input.value = '';
    input.focus({ preventScroll: true });
    const until = performance.now() + seconds * 1000;
    const bar = $('s-bar');
    const timer = seconds
      ? setInterval(() => {
          const left = Math.max(0, until - performance.now());
          bar.style.transform = `scaleX(${left / (seconds * 1000)})`;
          if (left <= 0) fire('submit');
        }, 100)
      : 0;
    bar.style.transform = 'scaleX(1)';
    let ev;
    try {
      ev = await wait(['submit', 'pass']);
    } finally {
      clearInterval(timer);
    }
    alive(id);
    form.hidden = true;
    return ev.kind === 'pass' ? '' : input.value.trim();
  }

  /** Ask, judge, and allow one more try on a prompt. */
  async function answerFor(answerHtml, label, seconds, id, opts = {}) {
    let given = await ask(label, seconds, id, opts);
    status(given ? 'Checking...' : '');
    let r = await judge(answerHtml, given, { remote: !opts.local });
    alive(id);
    if (r.directive === 'prompt') {
      status('Prompt: be more specific.');
      announce('Prompt. Be more specific.');
      const again = await ask(`Prompt on "${given}": be more specific`, seconds, id, opts);
      r = await judge(answerHtml, again, { remote: !opts.local });
      alive(id);
      given = `${given}, then ${again || '(nothing)'}`;
    }
    status('');
    return { given, ok: r.directive === 'accept', by: r.by };
  }

  // ---------- reading ----------

  function paint(t, n) {
    t.shown = n;
    const box = $('s-text');
    box.textContent = t.list.slice(0, n).join(' ');
    const caret = el('span', 'caret');
    caret.setAttribute('aria-hidden', 'true');
    box.append(caret);
  }

  /** Read on until the player buzzes, the computer reaches `botWord`, or the text ends. */
  function readUntil(t, botWord) {
    return new Promise((resolve) => {
      $('s-buzz-dock').hidden = t.youOut;
      $('s-buzz').disabled = t.youOut;
      $('s-pause').hidden = false;
      const tick = () => {
        if (reading !== t) return;
        if (t.pausedAt !== null) {
          t.timer = setTimeout(tick, READ_STEP_MS);
          return;
        }
        const n = shownAt(t.times, performance.now() - t.start);
        if (n !== t.shown) paint(t, n);
        setClock('Read', pct(n / t.list.length));
        if (botWord !== null && n >= botWord) return done({ type: 'bot', shown: botWord });
        if (n >= t.list.length && performance.now() - t.start >= t.times[t.times.length - 1]) return done({ type: 'end', shown: n });
        t.timer = setTimeout(tick, READ_STEP_MS);
      };
      const done = (ev) => {
        clearTimeout(t.timer);
        t.onBuzz = null;
        $('s-pause').hidden = true;
        if (ev.shown !== undefined) paint(t, Math.min(ev.shown, t.list.length));
        resolve(ev);
      };
      t.onBuzz = () => {
        if (t.youOut || t.pausedAt !== null) return;
        done({ type: 'you', shown: Math.max(1, shownAt(t.times, performance.now() - t.start)) });
      };
      tick();
    });
  }

  /** After the last word: a few seconds to buzz. */
  async function buzzWindow(t, id) {
    const secs = ctx.settings().buzzSecs;
    $('s-buzz-dock').hidden = false;
    $('s-buzz').disabled = false;
    const until = performance.now() + secs * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, until - performance.now());
      setClock('Buzz', (left / 1000).toFixed(1));
      if (left <= 0) fire('timeout');
    }, 100);
    t.onBuzz = () => fire('buzz');
    let ev;
    try {
      ev = await wait(['buzz', 'timeout']);
    } finally {
      clearInterval(timer);
      t.onBuzz = null;
    }
    alive(id);
    $('s-buzz-dock').hidden = true;
    return ev.kind === 'buzz';
  }

  // ---------- one tossup ----------

  async function playTossup(q, quarter, number, total, id) {
    resetStage();
    const settings = ctx.settings();
    const spec = QUARTERS[quarter - 1] || QUARTERS[3];
    const short = spec.maxWords ? shorten(q.text, spec.maxWords) : { text: q.text, shortened: false };
    const list = splitWords(short.text);
    const n = list.length;
    meta(q, short.shortened ? ['shortened'] : []);
    setQuarter(quarter === 5 ? 'Tiebreak' : `Q${quarter} ${number}/${total}`);
    const t = { list, times: schedule(list, settings.wpm), start: performance.now(), pausedAt: null, shown: 0, youOut: false, botOut: false, onBuzz: null, timer: 0 };
    reading = t;
    paint(t, 0);
    const plan = botTossup(profile);
    let botWord = botBuzzWord(plan, n);
    const out = { kind: 'tossup', q, text: short.text, shortened: short.shortened, quarter, yourShown: null, botShown: null, given: '', ok: false, winner: null, points: 0, by: null, botRight: false };

    for (;;) {
      const ev = await readUntil(t, t.botOut ? null : botWord);
      alive(id);
      if (ev.type === 'you') {
        out.yourShown = ev.shown;
        $('s-buzz-dock').hidden = true;
        const pts = tossupPoints(quarter, ev.shown, n);
        const r = await answerFor(q.answerHtml, quarter === 4 ? `Your answer (for ${pts})` : 'Your answer', settings.answerSecs, id);
        Object.assign(out, { given: r.given, ok: r.ok, by: r.by });
        if (r.ok) {
          out.winner = YOU;
          out.points = quarter === 5 ? TOSSUP_POINTS : pts;
          break;
        }
        t.youOut = true;
        status('Incorrect. The computer hears the rest.');
        // The computer, if it would have buzzed already, buzzes now.
        if (!t.botOut && botWord !== null && botWord <= ev.shown) botWord = Math.min(n, ev.shown + 1);
        if (t.botOut) break;
        await sleep(700);
        alive(id);
        continue;
      }
      if (ev.type === 'bot') {
        out.botShown = ev.shown;
        $('s-buzz-dock').hidden = true;
        status('The computer buzzes.');
        setClock('Buzz', pct(ev.shown / n));
        await sleep(fast ? 300 : 1100);
        alive(id);
        if (plan.right) {
          out.winner = BOT;
          out.botRight = true;
          out.points = quarter === 5 ? TOSSUP_POINTS : tossupPoints(quarter, ev.shown, n);
          break;
        }
        t.botOut = true;
        status(t.youOut ? 'The computer is wrong too.' : 'The computer is wrong. You hear the rest.');
        if (t.youOut) break;
        await sleep(500);
        alive(id);
        continue;
      }
      // The whole question has been read.
      if (!t.youOut) {
        const buzzed = await buzzWindow(t, id);
        if (buzzed) {
          out.yourShown = n;
          const r = await answerFor(q.answerHtml, 'Your answer', settings.answerSecs, id);
          Object.assign(out, { given: r.given, ok: r.ok, by: r.by });
          if (r.ok) {
            out.winner = YOU;
            out.points = TOSSUP_POINTS;
            break;
          }
          t.youOut = true;
        }
      }
      if (!t.botOut && t.youOut && out.botShown === null && botAfterMiss(profile, plan)) {
        out.botShown = n;
        out.winner = BOT;
        out.botRight = true;
        out.points = TOSSUP_POINTS;
        status('The computer answers at the end.');
      }
      break;
    }
    reading = null;
    paint(t, n);
    $('s-buzz-dock').hidden = true;
    if (out.winner !== null) award(m, out.winner, out.points, { qid: q.id, kind: 'tossup' });
    board();
    items.push(out);
    recordForStats(out, n);
    return out;
  }

  /** Fourth-quarter and tiebreak tossups are full pyramids, so they count in stats like the reader's. */
  function recordForStats(out, n) {
    if (out.quarter < 4) return;
    // Beaten to it before buzzing: no evidence either way.
    if (out.yourShown === null && out.winner === BOT && out.botShown < n) return;
    const q = out.q;
    const rec = {
      id: `${Date.now()}-${q.id}`,
      qid: q.id,
      src: q.source,
      cat: q.category,
      sub: q.subcategory,
      era: q.era,
      region: q.region,
      ok: out.winner === YOU,
      buzz: out.yourShown === null ? null : buzzFraction(out.yourShown, n),
      ovr: false,
      ts: Date.now(),
      diff: Number.isFinite(q.difficulty) ? q.difficulty : null,
      fx: q.fx || [],
    };
    out.recordId = rec.id;
    ctx.addRecord(rec);
  }

  /** The ruling after a tossup or bonus, with the overrule button; resolves on Continue. */
  async function ruling(out, id, extra = '') {
    const box = $('s-ruling');
    box.hidden = false;
    const who = out.winner === YOU ? `You: +${out.points}.` : out.winner === BOT ? `Computer: +${out.points}.` : 'No points.';
    const text = out.kind === 'bonus'
      ? (out.ok ? `Bonus right: +${BONUS_POINTS}.` : 'Bonus missed.')
      : who;
    $('s-ruling-text').textContent = [text, out.given ? `You said "${out.given}".` : '', extra].filter(Boolean).join(' ');
    renderAnswerline($('s-answerline'), out.q.answerHtml);
    const ob = $('s-overrule');
    ob.hidden = !out.given;
    ob.textContent = out.ok ? 'Actually, I was wrong' : 'I was right';
    ob.onclick = () => overrule(out);
    $('s-next').focus({ preventScroll: true });
    announce(`${text}. Answer: ${mainAnswer(out.q.answerHtml) || out.q.answerPlain}.`);
    await wait(['next']);
    alive(id);
    ob.onclick = null;
  }

  function overrule(out) {
    const quarter = out.quarter;
    if (out.kind === 'bonus') {
      if (out.ok) unaward(m, YOU, BONUS_POINTS, quarter);
      else award(m, YOU, BONUS_POINTS, { kind: 'bonus', overrule: true });
      out.ok = !out.ok;
    } else if (!out.ok) {
      // Judged wrong, you say right: you get the points; the computer's later points on it go.
      if (out.winner === BOT) unaward(m, BOT, out.points, quarter);
      const n = splitWords(out.text).length;
      out.points = quarter === 5 ? TOSSUP_POINTS : tossupPoints(quarter, out.yourShown, n);
      award(m, YOU, out.points, { kind: 'tossup', overrule: true });
      out.ok = true;
      out.winner = YOU;
    } else {
      unaward(m, YOU, out.points, quarter);
      out.ok = false;
      out.winner = null;
      out.points = 0;
    }
    if (out.recordId) ctx.updateRecord(out.recordId, { ok: out.ok, ovr: true });
    board();
    const box = $('s-ruling-text');
    box.textContent = out.ok ? `Your call: right, +${out.kind === 'bonus' ? BONUS_POINTS : out.points}.` : 'Your call: wrong. Points taken back.';
    $('s-overrule').textContent = out.ok ? 'Actually, I was wrong' : 'I was right';
    announce(box.textContent);
  }

  // ---------- second-quarter bonus ----------

  async function playBonus(part, team, id) {
    resetStage();
    const q = { ...part, answerHtml: part.answerHtml, answerPlain: part.answerPlain, category: part.category, subcategory: part.subcategory, source: part.source };
    meta(q, ['bonus']);
    $('s-text').textContent = [part.leadin, part.text].filter(Boolean).join(' ');
    const out = { kind: 'bonus', q, text: $('s-text').textContent, quarter: 2, given: '', ok: false, winner: null, points: 0, team };
    if (team === YOU) {
      setClock('Bonus', String(BONUS_POINTS));
      const r = await answerFor(part.answerHtml, 'Bonus: your answer (you may confer)', ctx.settings().answerSecs + 5, id);
      Object.assign(out, { given: r.given, ok: r.ok });
      if (r.ok) {
        out.winner = YOU;
        out.points = BONUS_POINTS;
        award(m, YOU, BONUS_POINTS, { kind: 'bonus' });
      }
    } else {
      status('The computer takes its bonus.');
      await sleep(fast ? 300 : 1500);
      alive(id);
      out.ok = botBonus(profile);
      if (out.ok) {
        out.winner = BOT;
        out.points = BONUS_POINTS;
        award(m, BOT, BONUS_POINTS, { kind: 'bonus' });
      }
    }
    board();
    items.push(out);
    const extra = team === BOT ? (out.ok ? 'The computer got its bonus.' : 'The computer missed its bonus.') : '';
    if (team === BOT) out.given = '';
    await ruling(team === BOT ? { ...out, kind: 'tossup', points: out.points } : out, id, extra);
  }

  // ---------- lightning round ----------

  async function pickCategory(offer, picker, taken, id) {
    const left = offer.filter((c) => c !== taken);
    if (picker === BOT) {
      const c = left[Math.floor(Math.random() * left.length)];
      status(`The computer picks ${c.label}.`);
      announce(`The computer picks ${c.label}.`);
      await sleep(fast ? 300 : 1500);
      alive(id);
      return c;
    }
    const box = $('s-cats');
    box.hidden = false;
    box.textContent = '';
    for (const c of offer) {
      const b = el('button', 'btn btn-lamp cat-pick', c.label);
      b.type = 'button';
      b.disabled = c === taken;
      if (c === taken) b.append(el('span', 'visually-hidden', ' (taken)'));
      b.addEventListener('click', () => fire('pick', c));
      box.append(b);
    }
    status(taken ? 'Pick your category from the two left.' : 'You are behind, so you pick first.');
    const first = box.querySelector('button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
    const ev = await wait(['pick']);
    alive(id);
    box.hidden = true;
    return ev.value;
  }

  async function lightningQuestions(cat) {
    const level = ctx.settings().level;
    const bonuses = await fetchBonuses({ cat: cat.cat, sub: cat.sub || '', level, n: 10 });
    return lightningFromBonuses(bonuses);
  }

  /** Sixty seconds for one team; misses bounce to the other. */
  async function lightningTurn(team, cat, qs, id) {
    resetStage();
    setQuarter(`Lightning: ${team === YOU ? 'you' : 'computer'}`);
    const results = [];
    let used = 0;
    const clockStart = () => performance.now();
    let started = clockStart();
    let bankedMs = 0;
    const left = () => Math.max(0, LIGHTNING.seconds * 1000 - bankedMs - (started === null ? 0 : performance.now() - started));
    const pause = () => {
      bankedMs += performance.now() - started;
      started = null;
    };
    const resume = () => {
      started = performance.now();
    };
    const clockTimer = setInterval(() => {
      const ms = left();
      setClock('Clock', (ms / 1000).toFixed(ms < 10000 ? 1 : 0));
      if (ms < 10000) $('s-clock').classList.add('urgent');
      if (ms <= 0 && team === YOU) fire('submit');
    }, 100);
    $('s-fast').hidden = team !== BOT;
    try {
      for (const lq of qs) {
        if (left() <= 0) break;
        used++;
        const q = { ...lq, source: lq.source };
        const shown = mainAnswer(lq.answerHtml) || lq.answerPlain;
        meta({ ...q, category: cat.label, subcategory: cat.label }, [`${used} of ${LIGHTNING.questions}`]);
        $('s-text').textContent = [lq.leadin, lq.text].filter(Boolean).join(' ');
        const item = { kind: 'lightning', q, text: $('s-text').textContent, quarter: 3, team, ok: false, bounce: null, given: '' };
        items.push(item);
        if (team === YOU) {
          const given = await ask('Your answer (Enter to send)', 0, id, { pass: true });
          if (left() <= 0 && !given) break;
          const r = await judge(lq.answerHtml, given, { remote: false });
          alive(id);
          item.ok = r.directive === 'accept';
          item.given = given;
          results.push(item.ok);
          if (item.ok) {
            status(`Right: ${shown}`);
          } else {
            // Bounce: the computer answers at once.
            pause();
            const stolen = botBounce(profile);
            item.bounce = stolen ? BOT : null;
            if (stolen) award(m, BOT, LIGHTNING.points, { kind: 'bounce' });
            board();
            status(`${given ? 'Wrong' : 'Passed'}. Answer: ${shown}. Bounce: the computer ${stolen ? 'gets it (+10)' : 'misses'}.`);
            await sleep(fast ? 300 : 1300);
            alive(id);
            resume();
          }
        } else {
          const plan = botLightning(profile);
          const waitMs = Math.min(plan.seconds * 1000, left());
          const until = performance.now() + (fast ? Math.min(waitMs, 250) : waitMs);
          if (fast) bankedMs += waitMs - Math.min(waitMs, 250);
          while (performance.now() < until) {
            await sleep(50);
            alive(id);
          }
          if (left() <= 0) {
            results.push(null);
            break;
          }
          item.ok = plan.right;
          results.push(item.ok);
          if (plan.right) {
            status(`The computer: right (${shown}).`);
            await sleep(fast ? 150 : 700);
            alive(id);
          } else {
            pause();
            status('The computer misses. Bounce to you.');
            const r = await answerFor(lq.answerHtml, 'Bounce: your answer', 8, id, { local: true });
            item.given = r.given;
            item.bounce = r.ok ? YOU : null;
            if (r.ok) award(m, YOU, LIGHTNING.points, { kind: 'bounce' });
            board();
            status(r.ok ? `Bounce right (+10): ${shown}` : `Bounce missed. Answer: ${shown}`);
            await sleep(fast ? 300 : 1300);
            alive(id);
            resume();
          }
        }
      }
    } finally {
      clearInterval(clockTimer);
      $('s-form').hidden = true;
      $('s-fast').hidden = true;
    }
    const points = lightningPoints(results);
    award(m, team, points, { kind: 'lightning' });
    board();
    const right = results.filter((r) => r === true).length;
    const msg = `${team === YOU ? 'You' : 'The computer'}: ${right} of ${LIGHTNING.questions} right${right === LIGHTNING.questions ? ', plus 20 for the sweep' : ''}. +${points}.`;
    status(msg);
    announce(msg);
    await sleep(fast ? 400 : 1800);
    alive(id);
  }

  async function lightningRound(id) {
    resetStage();
    setQuarter('Lightning');
    setClock('Clock', '60');
    const half = scores(m);
    const first = firstPick(half);
    const offer = pool.offer;
    status(`Halftime: you ${half[YOU]}, the computer ${half[BOT]}. Categories: ${offer.map((c) => c.label).join(', ')}.`);
    await sleep(fast ? 300 : 1500);
    alive(id);
    const firstCat = await pickCategory(offer, first, null, id);
    const secondCat = await pickCategory(offer, 1 - first, firstCat, id);
    const want = [firstCat, secondCat];
    const sets = await Promise.all(want.map(async (c) => {
      const ready = await (pool.lightning.get(c.label) || Promise.resolve([]));
      return ready.length ? ready : lightningQuestions(c);
    }));
    alive(id);
    await lightningTurn(first, firstCat, sets[0], id);
    await lightningTurn(1 - first, secondCat, sets[1], id);
  }

  // ---------- quarter breaks ----------

  async function quarterBreak(quarter, id, final = false) {
    show('screen-sim-break');
    const s = scores(m);
    $('sb-title').textContent = quarter === 5 ? 'End of the tiebreak' : `End of the ${ORDINAL[quarter - 1]} quarter`;
    $('sb-score').textContent = `You ${s[YOU]}, the computer ${s[BOT]}.`;
    $('sb-next').textContent = final ? 'See the result' : quarter === 2 ? 'Start the lightning round' : quarter === 3 ? 'Start the fourth quarter' : quarter === 4 ? 'Start the tiebreak' : 'Start the second quarter';
    renderReview(items.filter((it) => it.quarter === quarter));
    $('sb-title').focus({ preventScroll: true });
    announce(`${$('sb-title').textContent}. ${$('sb-score').textContent}`);
    await wait(['continue']);
    alive(id);
    show('screen-sim');
  }

  function renderReview(list) {
    const box = $('sb-list');
    // The editor and its status may sit inside the old list (see openEditor).
    box.after($('sb-editor'));
    $('sb-editor').after($('sb-status'));
    box.textContent = '';
    $('sb-editor').hidden = true;
    $('sb-status').textContent = '';
    if (!list.length) {
      box.append(el('p', 'game-status', 'No questions this quarter.'));
      return;
    }
    list.forEach((it, i) => {
      const d = el('details', 'review-item');
      const sum = el('summary');
      const answer = mainAnswer(it.q.answerHtml) || it.q.answerPlain;
      const who = it.kind === 'lightning'
        ? (it.ok ? `${it.team === YOU ? 'you' : 'computer'}, right` : it.bounce === YOU ? 'your bounce' : it.bounce === BOT ? 'computer bounce' : 'missed')
        : it.kind === 'bonus'
          ? `${it.team === YOU ? 'your' : 'computer'} bonus, ${it.ok ? 'right' : 'missed'}`
          : it.winner === YOU ? `you, +${it.points}` : it.winner === BOT ? `computer, +${it.points}` : 'dead';
      sum.append(el('span', 'review-num', `${i + 1}.`), el('span', 'review-answer', answer), el('span', 'review-who', who));
      d.append(sum);
      const clues = el('div', 'clues');
      if (it.kind === 'tossup') {
        const list2 = splitWords(it.text);
        const marks = [];
        if (it.yourShown) marks.push([it.yourShown, 'you']);
        if (it.botShown) marks.push([it.botShown, 'cpu']);
        for (const [a, b] of sentences(list2)) {
          const btn = el('button', 'clue');
          btn.type = 'button';
          const sentence = list2.slice(a, b).join(' ');
          let at = a;
          for (const [w, label] of marks.filter(([w]) => w > a && w <= b).sort((x, y) => x[0] - y[0])) {
            btn.append(list2.slice(at, w).join(' '), el('span', 'buzz-mark' + (label === 'cpu' ? ' cpu-mark' : ''), label));
            at = w;
          }
          btn.append(list2.slice(at, b).join(' '));
          if (ctx.hasCard(it.q.id, sentence)) btn.classList.add('carded');
          btn.setAttribute('aria-label', `Make a card: ${sentence}`);
          btn.addEventListener('click', () => openEditor(sentence, answer, it, btn));
          clues.append(btn);
        }
      } else {
        const btn = el('button', 'clue', it.text);
        btn.type = 'button';
        if (ctx.hasCard(it.q.id, it.text)) btn.classList.add('carded');
        btn.setAttribute('aria-label', `Make a card: ${it.text}`);
        btn.addEventListener('click', () => openEditor(it.text, answer, it, btn));
        clues.append(btn);
      }
      d.append(clues);
      if (it.shortened) d.append(el('p', 'review-note', 'Shortened from a longer tossup for this quarter.'));
      if (!it.ok || it.winner !== YOU) d.open = list.length <= 4;
      box.append(d);
    });
  }

  let editing = null;
  function openEditor(front, back, it, btn) {
    editing = { it, btn };
    const form = $('sb-editor');
    // The editor sits under the question it is for.
    btn.parentElement.after(form);
    form.hidden = false;
    $('sb-front').value = front;
    $('sb-back').value = back;
    $('sb-status').textContent = '';
    $('sb-front').focus();
  }

  function saveCard(e) {
    e.preventDefault();
    const front = $('sb-front').value.trim();
    const back = $('sb-back').value.trim();
    if (!front || !back || !editing) {
      $('sb-status').textContent = 'A card needs a front and a back.';
      return;
    }
    const q = editing.it.q;
    const ok = ctx.addCard({ id: uid(), front, back, qid: q.id, src: q.source, cat: q.category, sub: q.subcategory, era: q.era || 'unknown', created: Date.now(), fsrs: null });
    editing.btn.classList.add('carded');
    $('sb-editor').hidden = true;
    $('sb-status').textContent = ok ? 'Card saved.' : 'This browser would not save the card (storage is full or blocked).';
    editing.btn.focus();
    editing.btn.parentElement.parentElement.after($('sb-status'));
  }

  // ---------- the match ----------

  async function getTossups(n, overrides = {}) {
    const base = { ...ctx.settings(), ...overrides };
    const out = [];
    const ids = new Set();
    const seen = new Set(ctx.seen());
    for (let tries = 0; tries < 5 && out.length < n; tries++) {
      const batch = await fetchTossups(base, Math.min(12, n - out.length + 2));
      for (const q of batch) {
        if (ids.has(q.id) || (seen.has(q.id) && tries < 3)) continue;
        ids.add(q.id);
        out.push(withFix(q, ctx.fixes()));
      }
    }
    return out.slice(0, n);
  }

  function prefetch() {
    const s = ctx.settings();
    const offer = offerCategories();
    const lightning = new Map();
    for (const c of offer) lightning.set(c.label, lightningQuestions(c).catch(() => []));
    // The fourth quarter prefers the Bee's full pyramids when that source is on.
    const q4src = s.sources.includes('bee') ? { sources: ['bee'] } : {};
    return {
      offer,
      lightning,
      q1: getTossups(QUARTERS[0].tossups),
      q2: getTossups(QUARTERS[1].tossups),
      q2b: fetchBonuses({ cat: 'History', level: s.level, n: QUARTERS[1].tossups }).catch(() => []),
      q4: getTossups(QUARTERS[3].tossups + TIEBREAK_TOSSUPS, q4src),
    };
  }

  async function run(id) {
    // Quarters 1 and 2.
    for (const quarter of [1, 2]) {
      m.quarter = quarter;
      const spec = QUARTERS[quarter - 1];
      status('Fetching questions...');
      const qs = await pool[`q${quarter}`];
      alive(id);
      const bonuses = quarter === 2 ? await pool.q2b : [];
      alive(id);
      if (!qs.length) throw new Error('no questions');
      for (let i = 0; i < Math.min(spec.tossups, qs.length); i++) {
        const out = await playTossup(qs[i], quarter, i + 1, spec.tossups, id);
        await ruling(out, id, out.winner === BOT ? `The computer said ${mainAnswer(out.q.answerHtml) || out.q.answerPlain}.` : '');
        if (spec.bonus && out.winner !== null && bonuses.length) {
          const b = bonuses.shift();
          if (b && b.parts[0]) await playBonus({ ...b.parts[0], leadin: b.leadin, category: b.category, subcategory: b.subcategory, source: b.source }, out.winner, id);
        }
      }
      await quarterBreak(quarter, id);
    }
    // Quarter 3.
    m.quarter = 3;
    await lightningRound(id);
    await quarterBreak(3, id);
    // Quarter 4.
    m.quarter = 4;
    status('Fetching questions...');
    const q4 = await pool.q4;
    alive(id);
    for (let i = 0; i < Math.min(QUARTERS[3].tossups, q4.length); i++) {
      const out = await playTossup(q4[i], 4, i + 1, QUARTERS[3].tossups, id);
      await ruling(out, id, out.winner === BOT ? `The computer buzzed at ${pct(out.botShown / splitWords(out.text).length)}.` : '');
    }
    if (afterFourth(m) === 'tiebreak') {
      await quarterBreak(4, id);
      const spare = q4.slice(QUARTERS[3].tossups);
      for (let i = 0; i < spare.length && !m.done; i++) {
        const out = await playTossup(spare[i], 5, i + 1, spare.length, id);
        await ruling(out, id);
        if (out.winner !== null) m.done = true;
      }
      await quarterBreak(5, id, true);
    } else {
      await quarterBreak(4, id, true);
    }
    finishMatch();
  }

  function finishMatch() {
    show('screen-sim-end');
    const s = scores(m);
    const w = winner(m);
    $('se-title').textContent = w === YOU ? `You win, ${s[YOU]} to ${s[BOT]}` : w === BOT ? `The computer wins, ${s[BOT]} to ${s[YOU]}` : `A tie, ${s[YOU]} all`;
    const tb = $('se-rows');
    tb.textContent = '';
    const quarters = m.teams[YOU].byQuarter[4] || m.teams[BOT].byQuarter[4] ? 5 : 4;
    for (let i = 0; i < quarters; i++) {
      const tr = el('tr');
      tr.append(el('td', 'name', i === 4 ? 'Tiebreak' : i === 2 ? 'Lightning' : `Quarter ${i + 1}`), el('td', 'num', String(m.teams[YOU].byQuarter[i])), el('td', 'num', String(m.teams[BOT].byQuarter[i])));
      tb.append(tr);
    }
    const yours = items.filter((it) => it.kind === 'tossup');
    const got = yours.filter((it) => it.winner === YOU).length;
    $('se-sub').textContent = `You took ${got} of ${yours.length} tossups. The computer was set to buzz right at about ${pct(profile.mu)}.`;
    $('se-title').focus({ preventScroll: true });
    announce($('se-title').textContent);
    ctx.refreshHome();
  }

  async function start() {
    const id = ++live;
    const mu = Number($('sim-strength').value) / 100;
    profile = botProfile(mu);
    m = newMatch(['You', 'Computer']);
    items = [];
    fast = false;
    pool = prefetch();
    show('screen-sim');
    resetStage();
    board();
    setQuarter('Q1');
    setClock('Clock', '-');
    $('sim-title').focus({ preventScroll: true });
    try {
      await run(id);
    } catch (e) {
      if (e instanceof Abort) return;
      console.error('historybowl match', e);
      show('screen-sim');
      resetStage();
      status('Could not reach the question database. Check your connection and start again.');
      $('s-quit').focus();
    }
  }

  function quit() {
    const b = $('s-quit');
    if (b.dataset.armed !== '1' && $('screen-sim').hidden === false) {
      b.dataset.armed = '1';
      b.textContent = 'Tap again to quit';
      setTimeout(() => {
        delete b.dataset.armed;
        b.textContent = 'Quit match';
      }, 3000);
      return;
    }
    delete b.dataset.armed;
    b.textContent = 'Quit match';
    leave();
  }

  function leave() {
    live++;
    if (reading) clearTimeout(reading.timer);
    reading = null;
    if (pending) {
      const p = pending;
      pending = null;
      p.reject(new Abort());
    }
    ctx.home();
  }

  function togglePause() {
    const t = reading;
    if (!t || !t.onBuzz) return;
    if (t.pausedAt === null) {
      t.pausedAt = performance.now();
      $('s-pause').textContent = 'Resume';
      $('s-buzz').disabled = true;
    } else {
      t.start += performance.now() - t.pausedAt;
      t.pausedAt = null;
      $('s-pause').textContent = 'Pause';
      $('s-buzz').disabled = t.youOut;
    }
  }

  function buzz() {
    if (reading && reading.onBuzz) reading.onBuzz();
  }

  // ---------- wiring ----------

  function showStrength() {
    $('sim-strength-out').textContent = `${$('sim-strength').value}%`;
    for (const b of document.querySelectorAll('.sim-preset')) b.setAttribute('aria-pressed', String(Number(b.dataset.mu) === Number($('sim-strength').value)));
  }
  $('sim-strength').addEventListener('input', showStrength);
  for (const b of document.querySelectorAll('.sim-preset')) {
    b.addEventListener('click', () => {
      $('sim-strength').value = b.dataset.mu;
      showStrength();
    });
  }
  showStrength();
  $('sim-start').addEventListener('click', start);
  $('sim-setup-back').addEventListener('click', () => ctx.home());
  $('s-buzz').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    buzz();
  });
  $('s-buzz').addEventListener('click', (e) => {
    if (e.detail === 0) buzz();
  });
  $('s-form').addEventListener('submit', (e) => {
    e.preventDefault();
    fire('submit');
  });
  $('s-pass').addEventListener('click', () => fire('pass'));
  $('s-next').addEventListener('click', () => fire('next'));
  $('s-pause').addEventListener('click', togglePause);
  $('s-fast').addEventListener('click', () => {
    fast = true;
    $('s-fast').hidden = true;
  });
  $('s-quit').addEventListener('click', quit);
  $('sb-next').addEventListener('click', () => fire('continue'));
  $('sb-quit').addEventListener('click', leave);
  $('sb-editor').addEventListener('submit', saveCard);
  $('sb-cancel').addEventListener('click', () => {
    $('sb-editor').hidden = true;
    if (editing) editing.btn.focus();
  });
  $('se-again').addEventListener('click', () => {
    show('screen-sim-setup');
    $('sim-setup-title').focus({ preventScroll: true });
  });
  $('se-home').addEventListener('click', () => ctx.home());

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || $('screen-sim').hidden) return;
    const typing = isTyping(document.activeElement);
    if ((e.code === 'Space' || e.key === ' ') && !typing) {
      const t = document.activeElement;
      if (t && t.tagName === 'BUTTON' && t.id !== 's-buzz') return;
      if (reading && reading.onBuzz) {
        e.preventDefault();
        if (!e.repeat) buzz();
      }
    } else if ((e.key === 'n' || e.key === 'N') && !typing && !$('s-ruling').hidden) {
      e.preventDefault();
      fire('next');
    }
  });

  return {
    open() {
      show('screen-sim-setup');
      $('sim-setup-title').focus({ preventScroll: true });
    },
  };
}

export { BOT_PRESETS };
