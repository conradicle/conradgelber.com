// The National History Bowl match format and the computer opponent, with no
// DOM: the simulator page uses it now, and multiplayer rooms can later.
//
// Regional format (no penalties, scores in tens):
//   Quarter 1: 10 short tossups, 10 points each.
//   Quarter 2: 8 slightly longer tossups, 10 each; a correct tossup earns
//              a one-part 10-point bonus that does not bounce.
//   Quarter 3: lightning round. Three categories; the team trailing at
//              halftime picks first. Each team gets 60 seconds for 8
//              questions, 10 each, 20 more for answering all 8. Missed
//              questions bounce to the other team.
//   Quarter 4: 8 long pyramidal tossups, 30, 20 or 10 points by whether the
//              buzz came in the first, middle or last third.
//   Tied after four quarters: sudden-death tossups.
// After a wrong buzz on a tossup, the other team hears the rest of it.

import { words, sentences } from './text.js';

export const QUARTERS = [
  { n: 1, name: 'First quarter', tossups: 10, maxWords: 45 },
  { n: 2, name: 'Second quarter', tossups: 8, maxWords: 75, bonus: true },
  { n: 3, name: 'Lightning round', lightning: true },
  { n: 4, name: 'Fourth quarter', tossups: 8, tiered: true },
];
export const LIGHTNING = { questions: 8, seconds: 60, points: 10, sweep: 20 };
export const TOSSUP_POINTS = 10;
export const BONUS_POINTS = 10;

/** Fourth-quarter points: 30 in the first third of the question, 20 in the middle, 10 after. */
export function tieredPoints(shown, total) {
  if (!total || shown > total) return 10;
  const f = shown / total;
  if (f <= 1 / 3) return 30;
  if (f <= 2 / 3) return 20;
  return 10;
}

export function tossupPoints(quarter, shown, total) {
  return quarter === 4 ? tieredPoints(shown, total) : TOSSUP_POINTS;
}

/** Lightning score for the team in control: 10 a question, 20 more for all 8. */
export function lightningPoints(results) {
  const right = results.filter((r) => r === true).length;
  return right * LIGHTNING.points + (right === LIGHTNING.questions ? LIGHTNING.sweep : 0);
}

/** Which team picks the lightning category first: the one trailing at halftime; a coin toss if tied. */
export function firstPick(scores, rnd = Math.random) {
  if (scores[0] < scores[1]) return 0;
  if (scores[1] < scores[0]) return 1;
  return rnd() < 0.5 ? 0 : 1;
}

/**
 * A shorter tossup from a long one: its last sentences (the easier clues
 * and the giveaway), at most `maxWords` words. Short tossups in the first
 * two quarters are made this way and labeled "shortened".
 */
export function shorten(text, maxWords) {
  const list = words(text);
  if (list.length <= maxWords) return { text: list.join(' '), shortened: false };
  const ranges = sentences(list);
  // Take whole sentences from the end while they fit. The last sentence is
  // always kept, even if it alone runs over: it holds the question.
  let start = ranges[ranges.length - 1][0];
  for (let i = ranges.length - 2; i >= 0; i--) {
    if (list.length - ranges[i][0] > maxWords) break;
    start = ranges[i][0];
  }
  return { text: list.slice(start).join(' '), shortened: start > 0 };
}

// ---------- the computer opponent ----------

/**
 * Bot strength from the slider: the point (fraction of the question heard)
 * where it usually buzzes when it knows the answer. Lower is stronger.
 */
export const BOT_PRESETS = { easy: 0.85, medium: 0.6, hard: 0.4 };

export function botProfile(buzzAt) {
  const mu = Math.min(0.95, Math.max(0.25, buzzAt));
  return {
    mu,
    // A strong bot knows more questions as well as buzzing earlier.
    know: Math.min(0.9, Math.max(0.4, 1.25 - mu)),
    // When it knows the answer, it is right this often.
    sure: 0.93,
    // When it does not, it sometimes guesses late.
    guess: 0.12,
    lightning: Math.min(0.8, Math.max(0.35, 1.05 - mu * 0.75)),
    // Seconds per lightning question.
    pace: 3 + mu * 4,
  };
}

function normal(rnd) {
  // Box-Muller.
  const u = 1 - rnd();
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * The bot's plan for one tossup: { buzz: fraction of words, or null for no
 * buzz; right: whether its answer will be right }. A buzz at 1 means after
 * the last word.
 */
export function botTossup(profile, rnd = Math.random) {
  if (rnd() < profile.know) {
    return { buzz: clamp(profile.mu + normal(rnd) * 0.15, 0.12, 1), right: rnd() < profile.sure };
  }
  if (rnd() < profile.guess) return { buzz: clamp(0.8 + normal(rnd) * 0.1, 0.5, 1), right: false };
  return { buzz: null, right: false };
}

/** After the player misses, the bot hears the rest; does it answer at the end? */
export function botAfterMiss(profile, plan, rnd = Math.random) {
  if (plan.buzz !== null && plan.right) return true;
  return rnd() < profile.know * 0.25;
}

export function botBonus(profile, rnd = Math.random) {
  return rnd() < Math.min(0.9, profile.know * 0.85);
}

export function botLightning(profile, rnd = Math.random) {
  return { right: rnd() < profile.lightning, seconds: clamp(profile.pace + normal(rnd) * 1.2, 1.5, 12) };
}

export function botBounce(profile, rnd = Math.random) {
  return rnd() < profile.lightning * 0.6;
}

/** The word the bot buzzes on (1-based count of words heard), or null. */
export function botBuzzWord(plan, total) {
  if (plan.buzz === null) return null;
  return Math.max(1, Math.min(total, Math.round(plan.buzz * total)));
}

// ---------- the lightning categories ----------

/** Categories a lightning round can offer, each a QB Reader category with optional subcategory. */
export const LIGHTNING_CATEGORIES = [
  { label: 'American History', cat: 'History', sub: 'American History' },
  { label: 'European History', cat: 'History', sub: 'European History' },
  { label: 'World History', cat: 'History', sub: 'World History' },
  { label: 'Ancient History', cat: 'History', sub: 'Ancient History' },
  { label: 'Geography', cat: 'Geography', sub: null },
  { label: 'Art History', cat: 'Fine Arts', sub: 'Visual Fine Arts' },
  { label: 'Music History', cat: 'Fine Arts', sub: 'Auditory Fine Arts' },
  { label: 'Literature', cat: 'Literature', sub: null },
  { label: 'Religion', cat: 'Religion', sub: null },
  { label: 'Mythology', cat: 'Mythology', sub: null },
];

/** Three categories: two from history, one from the rest. */
export function offerCategories(rnd = Math.random) {
  const hist = LIGHTNING_CATEGORIES.filter((c) => c.cat === 'History');
  const rest = LIGHTNING_CATEGORIES.filter((c) => c.cat !== 'History');
  const pick = (list) => list.splice(Math.floor(rnd() * list.length), 1)[0];
  const out = [pick(hist), pick(hist), pick(rest)];
  return out.sort(() => rnd() - 0.5);
}

/**
 * Lightning questions from bonuses. A bonus's first part, read after its
 * leadin, stands on its own; later parts often lean on it ("Akbar ruled
 * this empire"), so every bonus gives its first part before any gives a
 * second.
 */
export function lightningFromBonuses(bonuses, count = LIGHTNING.questions) {
  const pools = bonuses.map((b) => b.parts.map((p, i) => ({ ...p, bonusId: b.id, leadin: i === 0 ? b.leadin : '', category: b.category, subcategory: b.subcategory, source: b.source })));
  const out = [];
  for (let round = 0; out.length < count && round < 3; round++) {
    for (const pool of pools) if (pool[round] && out.length < count) out.push(pool[round]);
  }
  return out;
}

// ---------- the match ----------

export function newMatch(names = ['You', 'Computer']) {
  return {
    teams: names.map((name) => ({ name, score: 0, byQuarter: [0, 0, 0, 0, 0] })),
    quarter: 1,
    done: false,
    log: [],
  };
}

/** Add points to a team in the current quarter (quarter 5 is the tiebreaker). */
export function award(match, team, points, entry = {}) {
  const t = match.teams[team];
  t.score += points;
  t.byQuarter[match.quarter - 1] += points;
  match.log.push({ quarter: match.quarter, team, points, ...entry });
  return match;
}

/** Take back an award, as when the player overrules a ruling. */
export function unaward(match, team, points, quarter = match.quarter, entry = {}) {
  const t = match.teams[team];
  t.score -= points;
  t.byQuarter[quarter - 1] -= points;
  match.log.push({ quarter, team, points: -points, ...entry, undo: true });
  return match;
}

export function scores(match) {
  return match.teams.map((t) => t.score);
}

/** After quarter 4: tiebreaker if tied, else over. */
export function afterFourth(match) {
  const [a, b] = scores(match);
  if (a === b) {
    match.quarter = 5;
    return 'tiebreak';
  }
  match.done = true;
  return 'done';
}

export function winner(match) {
  const [a, b] = scores(match);
  return a === b ? null : a > b ? 0 : 1;
}

// ---------- lightning plans ----------
// The simulator draws every random lightning outcome through these two
// functions, so the odds can be checked by running them many times.

/**
 * The computer's whole 60-second turn, decided up front: for each question,
 * whether its clock reaches it and whether its answer is right.
 * [{ reached, right, seconds }], one per question.
 */
export function planBotLightning(profile, count = LIGHTNING.questions, rnd = Math.random) {
  const out = [];
  let used = 0;
  for (let i = 0; i < count; i++) {
    const { right, seconds } = botLightning(profile, rnd);
    if (used + seconds > LIGHTNING.seconds) {
      // Out of time: this question and the rest are not reached.
      for (let j = i; j < count; j++) out.push({ reached: false, right: false, seconds: 0 });
      break;
    }
    used += seconds;
    out.push({ reached: true, right, seconds });
  }
  return out;
}

/** The computer's answers to a list of bouncebacks: true for each it gets. */
export function planBotBounces(profile, count, rnd = Math.random) {
  return Array.from({ length: count }, () => botBounce(profile, rnd));
}
