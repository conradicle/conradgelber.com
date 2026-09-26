import { R, FOOT_SPOT, HEAD_SPOT } from './table.js';
import { BALLS } from './physics.js';
import { seededRng, unit } from './rng.js';

/**
 * Racks. The server picks a seed per game, and the order of the balls and a
 * hundredth of a millimetre of jitter come from it, so no two breaks are
 * quite the same. The rack is frozen: neighbours touch, and the jitter
 * leaves some pairs a hair apart and some a hair overlapped. The simulation
 * resolves an overlapped pair at once when a push arrives, which carries
 * the break through the rack the way a tight rack does. Gaps of a tenth of
 * a millimetre or more soak up the break (tested over 200 racks: about half
 * as many balls reach a rail).
 */

/** Gap between neighbouring balls in the rack, before the jitter. */
const GAP = 0;
/** Each ball moves up to this far either way, in x and in y. */
const JITTER = 0.00001;
const ROW = Math.sqrt(3) / 2;

function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Rack slots as [row, offset] from the apex; offset is in ball spacings across the table. */
const TRIANGLE = [];
for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) TRIANGLE.push([k, j - k / 2]);
const DIAMOND = [[0, 0], [1, -0.5], [1, 0.5], [2, -1], [2, 0], [2, 1], [3, -0.5], [3, 0.5], [4, 0]];

function place(slots, balls, rng) {
  const d = 2 * R + GAP;
  const on = new Array(BALLS).fill(false);
  const x = new Array(BALLS).fill(0);
  const y = new Array(BALLS).fill(0);
  slots.forEach(([k, j], i) => {
    const n = balls[i];
    on[n] = true;
    x[n] = FOOT_SPOT.x + k * d * ROW + (2 * unit(rng) - 1) * JITTER;
    y[n] = FOOT_SPOT.y + j * d + (2 * unit(rng) - 1) * JITTER;
  });
  on[0] = true;
  x[0] = HEAD_SPOT.x;
  y[0] = HEAD_SPOT.y;
  return { on, x, y };
}

/** 8-ball: the 8 in the middle, a solid and a stripe in the back corners, the rest at random. */
export function rack8(seed) {
  const rng = seededRng(seed);
  const solids = shuffle(rng, [1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle(rng, [9, 10, 11, 12, 13, 14, 15]);
  const [cornerA, cornerB] = rng() & 1 ? [solids.pop(), stripes.pop()] : [stripes.pop(), solids.pop()];
  const rest = shuffle(rng, [...solids, ...stripes]);
  // Slot 4 is the middle of the third row; slots 10 and 14 are the back corners.
  const order = [];
  for (let i = 0; i < 15; i++) {
    if (i === 4) order.push(8);
    else if (i === 10) order.push(cornerA);
    else if (i === 14) order.push(cornerB);
    else order.push(rest.pop());
  }
  return place(TRIANGLE, order, rng);
}

/** 9-ball: the 1 at the apex, the 9 in the middle, the rest at random. */
export function rack9(seed) {
  const rng = seededRng(seed);
  const rest = shuffle(rng, [2, 3, 4, 5, 6, 7, 8]);
  const order = [];
  for (let i = 0; i < 9; i++) order.push(i === 0 ? 1 : i === 4 ? 9 : rest.pop());
  return place(DIAMOND, order, rng);
}

