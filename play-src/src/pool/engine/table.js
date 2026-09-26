/**
 * Table geometry, in metres. x runs along the table (0 at the head rail,
 * where the breaker stands), y across it, both measured to the cushion noses.
 * Everything here is computed once at load, so it may use any math; the
 * simulation only reads the numbers.
 */

/** Ball radius (57.15 mm balls). */
export const R = 0.028575;
/** Playing surface of a 7-foot bar table. */
export const L = 1.9812;
export const W = 0.9906;

/** Corner mouth, measured jaw point to jaw point. */
const CORNER_MOUTH = 0.125;
/** Side mouth, jaw point to jaw point. */
const SIDE_MOUTH = 0.132;
/** How far the jaw faces run back from the jaw points. */
const JAW_DEPTH = 0.1;
/** A ball drops once its centre is this far past the mouth line. */
const CORNER_DROP = 0.014;
const SIDE_DROP = 0.018;

export const HEAD_SPOT = { x: L / 4, y: W / 2 };
export const FOOT_SPOT = { x: (3 * L) / 4, y: W / 2 };
/** Where the cue ball starts for a break: anywhere behind this line. */
export const HEAD_STRING = L / 4;

const S2 = Math.SQRT1_2;
const c = CORNER_MOUTH * S2;
const s = SIDE_MOUTH / 2;

/**
 * Pockets, numbered anticlockwise from the head-left corner. `mx, my` is the
 * middle of the mouth, `ox, oy` points out of the table into the pocket and
 * `half` is half the mouth width, for the lateral check.
 */
export const POCKETS = [
  { name: 'bottom left corner', mx: c / 2, my: c / 2, ox: -S2, oy: -S2, half: CORNER_MOUTH / 2, drop: CORNER_DROP },
  { name: 'bottom side', mx: L / 2, my: 0, ox: 0, oy: -1, half: s, drop: SIDE_DROP },
  { name: 'bottom right corner', mx: L - c / 2, my: c / 2, ox: S2, oy: -S2, half: CORNER_MOUTH / 2, drop: CORNER_DROP },
  { name: 'top right corner', mx: L - c / 2, my: W - c / 2, ox: S2, oy: S2, half: CORNER_MOUTH / 2, drop: CORNER_DROP },
  { name: 'top side', mx: L / 2, my: W, ox: 0, oy: 1, half: s, drop: SIDE_DROP },
  { name: 'top left corner', mx: c / 2, my: W - c / 2, ox: -S2, oy: S2, half: CORNER_MOUTH / 2, drop: CORNER_DROP },
];

function railSegments() {
  const segs = [
    // The four rails, broken at the pockets.
    [c, 0, L / 2 - s, 0],
    [L / 2 + s, 0, L - c, 0],
    [L, c, L, W - c],
    [L - c, W, L / 2 + s, W],
    [L / 2 - s, W, c, W],
    [0, W - c, 0, c],
  ];
  // Jaws: two faces per pocket, running back from each jaw point along the pocket's axis.
  for (const p of POCKETS) {
    const lx = -p.oy;
    const ly = p.ox;
    for (const side of [-1, 1]) {
      const ax = p.mx + side * p.half * lx;
      const ay = p.my + side * p.half * ly;
      segs.push([ax, ay, ax + JAW_DEPTH * p.ox, ay + JAW_DEPTH * p.oy]);
    }
  }
  return segs;
}

/**
 * Cushion segments packed for the simulation: per segment
 * ax, ay, bx, by, ex, ey (unit direction), nx, ny (unit left normal), length.
 */
export const SEG_STRIDE = 9;
export const SEGS = (() => {
  const list = railSegments();
  const out = new Float64Array(list.length * SEG_STRIDE);
  list.forEach(([ax, ay, bx, by], i) => {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const ex = (bx - ax) / len;
    const ey = (by - ay) / len;
    out.set([ax, ay, bx, by, ex, ey, -ey, ex, len], i * SEG_STRIDE);
  });
  return out;
})();
export const SEG_COUNT = SEGS.length / SEG_STRIDE;
