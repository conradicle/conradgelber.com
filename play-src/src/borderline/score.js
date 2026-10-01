// Scoring. Tune here: a guess inside the window scores MAX; outside it
// decays with the years d to the nearer edge as MAX * exp(-d / K).
export const MAX = 5000;
export const K = { N: 15, H: 8 };
export const HINT_COST = 1000;
export const ROUNDS = 5;

/** Years from `year` to the window [from, to] (0 inside it). */
export function yearsOff(year, from, to) {
  if (year < from) return from - year;
  if (year > to) return year - to;
  return 0;
}

/**
 * @param {number} year  the guess
 * @param {[number, number]} span  inclusive window years
 * @param {'N'|'H'} diff
 * @param {boolean} hinted
 */
export function scoreGuess(year, span, diff, hinted) {
  const d = yearsOff(year, span[0], span[1]);
  const raw = d === 0 ? MAX : Math.round(MAX * Math.exp(-d / K[diff]));
  return Math.max(0, raw - (hinted ? HINT_COST : 0));
}

/** One square per round for the share line. */
export function square(round) {
  if (round.off === 0) return '🟩';
  if (round.points >= 2500) return '🟨';
  if (round.points >= 800) return '🟧';
  return '🟥';
}
