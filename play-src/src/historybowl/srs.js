// Flashcard scheduling with FSRS (the ts-fsrs package). A card's schedule is
// stored on the card as plain numbers so it survives JSON, export and import.
// A card with no schedule yet is new and due now.

import { fsrs, createEmptyCard, generatorParameters, Rating, State } from 'ts-fsrs';

export const RATINGS = [
  { rating: Rating.Again, key: 'again', label: 'Again', keyHint: '1' },
  { rating: Rating.Hard, key: 'hard', label: 'Hard', keyHint: '2' },
  { rating: Rating.Good, key: 'good', label: 'Good', keyHint: '3' },
  { rating: Rating.Easy, key: 'easy', label: 'Easy', keyHint: '4' },
];

const scheduler = (fuzz = true) => fsrs(generatorParameters({ enable_fuzz: fuzz }));
let defaultScheduler = null;
const getScheduler = () => (defaultScheduler = defaultScheduler || scheduler(true));

/** The stored schedule as a ts-fsrs Card. */
export function toFsrsCard(stored, now) {
  if (!stored) return createEmptyCard(new Date(now));
  return {
    due: new Date(stored.due),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    reps: stored.reps,
    lapses: stored.lapses,
    learning_steps: stored.learningSteps || 0,
    state: stored.state,
    last_review: stored.lastReview ? new Date(stored.lastReview) : undefined,
  };
}

export function fromFsrsCard(c) {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps || 0,
    state: c.state,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

/** The schedule after rating a card at `now`. */
export function rate(stored, rating, now = Date.now(), f = getScheduler()) {
  const next = f.next(toFsrsCard(stored, now), new Date(now), rating);
  return fromFsrsCard(next.card);
}

/** For each rating, how long until the card comes back ("10m", "3d"). */
export function preview(stored, now = Date.now(), f = getScheduler()) {
  const all = f.repeat(toFsrsCard(stored, now), new Date(now));
  const out = {};
  for (const r of RATINGS) out[r.key] = formatGap(all[r.rating].card.due.getTime() - now);
  return out;
}

export function formatGap(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/** The end of the local day containing `now`. */
export function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export const isNew = (card) => !card.fsrs || card.fsrs.state === State.New;

/** Cards due by the end of today: new cards and any whose review date has come. */
export function dueToday(cards, now = Date.now()) {
  const end = endOfDay(now);
  return cards.filter((c) => !c.fsrs || c.fsrs.due <= end);
}

/** Cards due right now (a card failed a minute ago waits its minute). */
export function dueNow(cards, now = Date.now()) {
  return cards.filter((c) => !c.fsrs || c.fsrs.due <= now);
}

/**
 * Interleave: shuffle, then avoid two cards from the same subcategory in a
 * row where another can go between them.
 */
export function interleave(cards, rnd = Math.random) {
  const pool = cards.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = [];
  while (pool.length) {
    const prev = out[out.length - 1];
    let i = prev ? pool.findIndex((c) => (c.sub || c.cat) !== (prev.sub || prev.cat)) : 0;
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

export { Rating, State };
export const testScheduler = () => scheduler(false);
