// Two late checks on a judged crop: the countries its tells name must have
// readable labels, and it must not show an area in CONTESTED_REJECT.
import { geoDistance } from 'd3-geo';
import { makeProjection, FRAME_W as W, FRAME_H as H } from '../../../src/borderline/projection.js';
import { CONTESTED_REJECT, LABEL_INSET, LABEL_READABLE, MISSING_LAND_MIN_PX } from '../config.mjs';
import { boxH } from './labels.mjs';
import { addDays } from '../../../src/borderline/window.js';

const EARTH_KM = 6371.0088;

const NOT_A_UNIT = new Set(['blank', 'sea']);

/**
 * The units a tell asks the player to find on the shown map. `side` is the
 * window edge it sets; the shown map is the after side of a start tell and
 * the before side of an end tell. A tell about an absence ("There is no
 * Norway yet") names nothing that is drawn.
 */
export function tellNeeds(t, side) {
  const near = side === 'start' ? t.b : t.a;
  const far = side === 'start' ? t.a : t.b;
  if (t.kind === 'name' || t.kind === 'transfer') return [near.unit];
  if (side === 'start' && t.gone) return [];
  if (side === 'end' && t.born) return [];
  if (t.born || t.gone) return [t.born ? t.b.unit : t.a.unit];
  return [near.unit, far.unit].filter((u) => !NOT_A_UNIT.has(u));
}

/** Font size of a label, or 0 when any of its box falls outside the inner frame. */
export function readableSize(l) {
  const w = l.w, h = boxH(l.size, l.lines.length);
  const inside = l.x - w / 2 >= LABEL_INSET && l.x + w / 2 <= W - LABEL_INSET &&
    l.y - h / 2 >= LABEL_INSET && l.y + h / 2 <= H - LABEL_INSET;
  return inside ? l.size : 0;
}

/**
 * Smallest readable label size among the units both tells need, 0 when one
 * of them has no label inside the frame, Infinity when they need none.
 * @param {Map<string, object>} labelOf  unit -> placed label
 */
export function tellLabelSize(labelOf, startTell, endTell) {
  let min = Infinity;
  for (const [t, side] of [[startTell, 'start'], [endTell, 'end']]) {
    if (!t) continue;
    for (const unit of tellNeeds(t, side)) {
      const l = labelOf.get(unit);
      min = Math.min(min, l ? readableSize(l) : 0);
    }
  }
  return min;
}

export const legible = (size) => size >= LABEL_READABLE;

/** Is the point drawn inside the frame of crop p? */
export function inFrame(p, pt) {
  if (geoDistance(p.c, pt) >= Math.PI / 2) return false;
  const xy = makeProjection(p)(pt);
  return !!xy && xy[0] >= 0 && xy[0] <= W && xy[1] >= 0 && xy[1] <= H;
}

/**
 * Name of the contested area the crop shows within its window, or null.
 * `end` is the last day of the window or 'present'.
 */
export function contestedIn(p, start, end) {
  // Equal-area projection: one frame unit is EARTH_KM / s kilometres.
  const km2PerUnit = (EARTH_KM / p.s) ** 2;
  for (const area of CONTESTED_REJECT) {
    const last = area.endsOn ? addDays(area.from, -1) : area.from;
    const reaches = end === 'present' || end >= last;
    const before = area.to && start > area.to;
    const seen = !area.km2 || area.km2 / km2PerUnit >= MISSING_LAND_MIN_PX;
    if (reaches && !before && seen && area.points.some((pt) => inFrame(p, pt))) return area.name;
  }
  return null;
}
