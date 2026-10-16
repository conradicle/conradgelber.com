// Scoring, as in the 12axes source: each answer adds weight x direction to
// its axis (direction +1 when the statement leans to the axis's left pole,
// -1 when it leans right; the source ignores how strongly a statement
// leans). The sum is then scaled against the most this user's own questions
// could have moved that axis, so every length lands on the same 0-100 scale.
import { AXES } from './axes.js';

// Answer index 0..4. The source's weights for these five of its seven options.
export const ANSWERS = ['Strongly agree', 'Agree', 'Neutral/Unsure', 'Disagree', 'Strongly disagree'];
export const WEIGHTS = [2, 1, 0, -1, -2];
export const MAX_WEIGHT = 2;
export const NEUTRAL = 2;

const clamp = (x) => Math.min(100, Math.max(0, x));

// served: question objects; answers: answer index per served question.
// Returns the left-pole percentage for every axis (50 for an axis with no
// questions).
export function scoreAxes(served, answers) {
  const sum = new Array(AXES.length).fill(0);
  const count = new Array(AXES.length).fill(0);
  served.forEach((q, i) => {
    count[q.axis]++;
    const a = answers[i];
    if (a != null) sum[q.axis] += WEIGHTS[a] * q.dir;
  });
  return sum.map((s, ax) => (count[ax] ? clamp(50 + (50 * s) / (MAX_WEIGHT * count[ax])) : 50));
}

export function axisCounts(served) {
  const count = new Array(AXES.length).fill(0);
  for (const q of served) count[q.axis]++;
  return count;
}

// Points this one answer moved its axis toward the left pole (negative =
// toward the right pole).
export function impact(q, answer, countOnAxis) {
  if (answer == null || !countOnAxis) return 0;
  return (50 * WEIGHTS[answer] * q.dir) / (MAX_WEIGHT * countOnAxis);
}
