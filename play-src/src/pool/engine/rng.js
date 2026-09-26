/**
 * Seeded generator (sfc32), the same one Cambio's tests use. It feeds rack
 * gaps and the computer player's errors, never the simulation itself, so a
 * game is replayable from its seed.
 */
export function seededRng(seed) {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed | 0;
  const next = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 16; i++) next();
  return next;
}

/** A float in [0, 1) from a uint32 source. */
export const unit = (rng) => rng() / 4294967296;
