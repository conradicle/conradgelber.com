// Judges one crop: paints the map it shows, places labels, then walks out
// from the shown date through every change touching the crop until the
// first visible one on each side. Returns a puzzle or a rejection reason.
import { makeProjection, FRAME_W as W, FRAME_H as H } from '../../../src/borderline/projection.js';
import { addDays, yearOf } from '../../../src/borderline/window.js';
import {
  CS_FIRST, EU_FIRST_YEAR, VISIBLE_MIN_AREA, MAX_WINDOW_YEARS, MAX_OCEAN_SHARE,
  MAX_BLANK_SHARE, LABEL_MAX, CURRENT_YEAR,
} from '../config.mjs';
import { projectRings, fillRings, largestChange, matchRegions, regionAreas, adjacency, SEA, BLANK } from './raster.mjs';
import { placeLabels } from './labels.mjs';
import { labelFor, nameDates } from './names.mjs';
import { contestedIn, legible, tellLabelSize } from './fairness.mjs';
import { OPEN } from './world.mjs';

const EU_FIRST = EU_FIRST_YEAR + '-01-01';
const PALETTE = 6;

export class Crop {
  constructor(world, names, p) {
    this.world = world;
    this.names = names;
    this.p = p;
    this.proj = makeProjection(p);
    const rho = Math.hypot(W / 2 + 4, H / 2 + 4);
    const reach = 2 * Math.asin(Math.min(1, rho / (2 * p.s)));
    const c = p.c;
    this.cands = world.records.filter((r) => {
      const d = angular(c, r.cap.c);
      return d <= reach + r.cap.r;
    });
    this.rings = new Map();
    this.unitId = new Map();
    this.paints = new Map();
    this.landRings = projectRings(world.land.geometry, this.proj);
    // Widest window allowed; the tests lift it to see full windows.
    this.maxYears = MAX_WINDOW_YEARS;
    // Label and contested-territory checks; the window tests turn them off.
    this.checkFairness = true;
  }

  ringsOf(r) {
    let g = this.rings.get(r.rid);
    if (!g) { g = projectRings(r.geometry, this.proj); this.rings.set(r.rid, g); }
    return g;
  }

  regionOf(unit) {
    if (!this.unitId.has(unit)) this.unitId.set(unit, this.unitId.size + 1);
    return this.unitId.get(unit);
  }

  /**
   * Records drawn on `date`, in paint order: newest first, so where two
   * records overlap the older one stays on top until its record ends (a new
   * claim shows only once the old one lets go); then largest first, so
   * enclaves sit on top of what surrounds them.
   */
  recordsAt(date) {
    const src = date < CS_FIRST ? 'eu' : 'cs';
    return this.cands
      .filter((r) => r.src === src && r.start <= date && date <= r.end && this.ringsOf(r).length)
      .sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0) || b.area - a.area || (a.rid < b.rid ? -1 : 1));
  }

  paint(date) {
    const recs = this.recordsAt(date);
    const key = recs.map((r) => r.rid).join(',');
    let st = this.paints.get(key);
    if (st) return { ...st, date };
    const buf = new Int16Array(W * H).fill(SEA);
    fillRings(buf, W, H, this.landRings, BLANK);
    const recOf = new Map();
    for (const r of recs) {
      const id = this.regionOf(r.unit);
      fillRings(buf, W, H, this.ringsOf(r), id);
      recOf.set(id, r);
    }
    st = { buf, recs, recOf };
    this.paints.set(key, st);
    return { ...st, date };
  }

  label(state, id) {
    const r = state.recOf.get(id);
    return r ? labelFor(this.names, r, state.date) : null;
  }

  sourcedNameDate(date) {
    return Object.values(this.names.units).some((list) => list.some((e) => e.source && e.from === date));
  }

  precisionOf(t) {
    if (t.date < CS_FIRST) {
      const v = this.world.euVerified.get(t.date);
      if (v) return v.precision || 'day';
    }
    for (const list of Object.values(this.names.units)) {
      for (const e of list) if (e.from === t.date && e.precision) return e.precision;
    }
    return t.date < CS_FIRST && !this.world.euVerified.has(t.date) ? 'year' : 'day';
  }

  /** Every date on which the crop could change. */
  events() {
    const s = new Set([CS_FIRST]);
    const units = new Set();
    for (const r of this.cands) {
      s.add(r.start);
      if (r.end !== OPEN) s.add(addDays(r.end, 1));
      units.add(r.unit);
    }
    for (const u of units) {
      for (const e of this.names.units[u] || []) {
        s.add(e.from);
        if (e.to !== 'present') s.add(addDays(e.to, 1));
      }
    }
    return [...s].filter((d) => d >= EU_FIRST).sort();
  }

  /**
   * Compare the day before `date` with `date`. `near` is the side closer to
   * the shown date; `labeled` holds its labeled region ids.
   */
  change(date, labeled, near) {
    const A = this.paint(addDays(date, -1));
    const B = this.paint(date);
    const match = matchRegions(A.buf, B.buf);
    const big = largestChange(A.buf, B.buf, W, H, match);
    // Follow labeled regions across the change.
    const next = new Set();
    const bToA = new Map([...match.aToB].map(([a, b]) => [b, a]));
    for (const id of labeled) {
      const other = near === 'B' ? bToA.get(id) : match.aToB.get(id);
      if (other !== undefined && other > 0) next.add(other);
    }
    let tell = null;
    if (big.area >= VISIBLE_MIN_AREA) {
      tell = this.borderTell(date, A, B, big.pairs);
    } else {
      for (const id of labeled) {
        const a = near === 'B' ? bToA.get(id) : id;
        const b = near === 'B' ? id : match.aToB.get(id);
        if (a === undefined || b === undefined) continue;
        // A labeled country whose whole visible part becomes unclaimed land
        // (or appears on it) keeps its outline but loses or gains its fill
        // and label: a visible change.
        if (a <= 0 || b <= 0) {
          if (a > 0 || b > 0) { tell = this.borderTell(date, A, B, [[a, b, 0]]); break; }
          continue;
        }
        const la = this.label(A, a), lb = this.label(B, b);
        if (la && lb && la.text !== lb.text) {
          // Same outline, new label: a rename when the unit is the same,
          // otherwise the area passed whole to a unit drawn beyond the crop.
          const same = A.recOf.get(a).unit === B.recOf.get(b).unit;
          tell = {
            kind: same ? 'name' : 'transfer', date,
            a: { unit: A.recOf.get(a).unit, label: la.text, base: la.base, owner: la.owner },
            b: { unit: B.recOf.get(b).unit, label: lb.text, base: lb.base, owner: lb.owner },
          };
          break;
        }
      }
    }
    return { tell, labeled: next, area: big.area };
  }

  borderTell(date, A, B, pairs) {
    // Name the pair of different units that swapped the most pixels.
    const unitOf = (st, id) => (id > 0 ? st.recOf.get(id).unit : String(id));
    const [ra, rb] = pairs.find(([a, b]) => unitOf(A, a) !== unitOf(B, b)) || pairs[0];
    const inA = new Set(A.recOf.keys()), inB = new Set(B.recOf.keys());
    const side = (st, id) => {
      if (id === SEA) return { unit: 'sea', label: 'the sea' };
      if (id === BLANK) return { unit: 'blank', label: 'unclaimed land' };
      const l = this.label(st, id);
      return { unit: st.recOf.get(id).unit, label: l.text };
    };
    // A region that vanishes or appears names itself even when the
    // dominant pixels belong to a neighbour.
    let a = side(A, ra), b = side(B, rb);
    const gone = ra > 0 && !inB.has(ra);
    const born = rb > 0 && !inA.has(rb);
    if (!gone && !born) {
      const biggest = (st, ids) => {
        const areas = regionAreas(st.buf);
        let best = null, top = VISIBLE_MIN_AREA - 1;
        for (const id of ids) if ((areas.get(id) || 0) > top) { top = areas.get(id); best = id; }
        return best;
      };
      const n = biggest(B, [...inB].filter((id) => !inA.has(id)));
      if (n !== null) { b = side(B, n); return { kind: 'border', date, a, b, born: true, gone: false }; }
      const g = biggest(A, [...inA].filter((id) => !inB.has(id)));
      if (g !== null) { a = side(A, g); return { kind: 'border', date, a, b, born: false, gone: true }; }
    }
    return { kind: 'border', date, a, b, born, gone };
  }

  /**
   * Full judgement for the map shown on `shown`.
   * @param {'N'|'H'} diff
   */
  /** Fill colours: greedy over the region graph, most-connected first. */
  colors(st) {
    const adj = adjacency(st.buf, W, H);
    const color = new Map();
    const ids = [...st.recOf.keys()].sort((p, q) => (adj.get(q)?.size || 0) - (adj.get(p)?.size || 0) || p - q);
    for (const id of ids) {
      const used = new Set([...(adj.get(id) || [])].map((q) => color.get(q)));
      // Each unit starts from its own tint, so the palette is spread out
      // and a country keeps its colour from puzzle to puzzle when it can.
      const first = hash(st.recOf.get(id).unit) % PALETTE;
      let c = first;
      for (let k = 0; k < PALETTE && used.has(c); k++) c = (first + k + 1) % PALETTE;
      color.set(id, c);
    }
    return color;
  }

  /**
   * The records the page draws, in paint order: those with pixels on the
   * shown map, less any record its own unit already covers in full (a
   * record extended by cs-dates.json can sit over a smaller one of the same
   * unit). The renderer merges what is left per unit.
   */
  drawn(st) {
    const areas = regionAreas(st.buf);
    const byUnit = new Map();
    for (const r of st.recs) {
      if (!areas.get(this.unitId.get(r.unit))) continue;
      if (!byUnit.has(r.unit)) byUnit.set(r.unit, []);
      byUnit.get(r.unit).push(r);
    }
    const keep = new Set();
    for (const list of byUnit.values()) {
      if (list.length === 1) { keep.add(list[0]); continue; }
      const union = new Uint8Array(W * H);
      for (const r of [...list].sort((a, b) => b.area - a.area)) {
        const mask = new Int16Array(W * H);
        fillRings(mask, W, H, this.ringsOf(r), 1);
        let added = false;
        for (let i = 0; i < mask.length; i++) if (mask[i] && !union[i]) { union[i] = 1; added = true; }
        if (added) keep.add(r);
      }
    }
    return st.recs.filter((r) => keep.has(r));
  }

  /** The shown map: sea and blank shares, and its labels. */
  view(shown, diff, { maxBlank = MAX_BLANK_SHARE, maxSea = MAX_OCEAN_SHARE } = {}) {
    const st = this.paint(shown);
    const areas = regionAreas(st.buf);
    const n = W * H;
    const sea = (areas.get(SEA) || 0) / n;
    if (sea > maxSea) return { reject: 'ocean', sea };
    const blank = (areas.get(BLANK) || 0) / (n * (1 - sea));
    if (blank > maxBlank) return { reject: 'blank', blank };
    const regions = [];
    for (const [id, area] of areas) {
      if (id <= 0) continue;
      regions.push({ id, area, text: this.label(st, id).text });
    }
    const placed = placeLabels(st.buf, W, H, regions, LABEL_MAX[diff]);
    return { st, sea, blank, placed, nLabels: placed.size };
  }

  judge(shown, diff, v = this.view(shown, diff)) {
    if (v.reject) return v;
    const { st, sea, blank, placed, nLabels } = v;

    // Walk back to the latest visible change on or before `shown`.
    const ev = this.events();
    let labeled = new Set(placed.keys());
    let startTell = null;
    const minYear = yearOf(shown) - this.maxYears;
    for (let i = ev.length - 1; i >= 0; i--) {
      const d = ev[i];
      if (d > shown) continue;
      if (yearOf(d) < minYear) return { reject: 'wide', nLabels };
      if (d === EU_FIRST) return { reject: 'censored-start', nLabels };
      const c = this.change(d, labeled, 'B');
      if (c.tell) {
        if (d === CS_FIRST) return { reject: 'seam-start', nLabels };
        startTell = c.tell;
        break;
      }
      labeled = c.labeled;
    }
    if (!startTell) return { reject: 'censored-start', nLabels };
    const startYear = yearOf(startTell.date);

    labeled = new Set(placed.keys());
    let endTell = null;
    for (const d of ev) {
      if (d <= shown) continue;
      if (yearOf(addDays(d, -1)) - startYear > this.maxYears) return { reject: 'wide', nLabels };
      const c = this.change(d, labeled, 'A');
      if (c.tell) {
        if (d === CS_FIRST) return { reject: 'seam-end', nLabels };
        endTell = c.tell;
        break;
      }
      labeled = c.labeled;
    }
    if (!endTell && CURRENT_YEAR - startYear > this.maxYears) return { reject: 'wide', nLabels };
    // A 1816-1885 tell must fall on a change whose real date is sourced.
    const unverified = [startTell, endTell].filter((t) => t && t.date < CS_FIRST &&
      !this.world.euVerified.has(t.date) && !(t.kind === 'name' && this.sourcedNameDate(t.date)));
    if (unverified.length) return { reject: 'unverified', nLabels, unverified };
    // After 2019 the bank only claims "still standing today" where nothing
    // has been disputed since (names.json post2019).
    if (!endTell) {
      const shownUnits = new Set(st.recs.map((r) => r.unit));
      if ((this.names.post2019?.noPresentWithUnits || []).some((u) => shownUnits.has(u))) return { reject: 'post2019', nLabels };
    }
    for (const t of [startTell, endTell]) if (t) t.precision = this.precisionOf(t);
    const end = endTell ? addDays(endTell.date, -1) : 'present';

    const contested = contestedIn(this.p, startTell.date, end);
    if (contested && this.checkFairness) return { reject: 'contested', nLabels, contested };
    const labelOf = new Map([...placed].map(([id, l]) => [st.recOf.get(id).unit, l]));
    const tellLabel = tellLabelSize(labelOf, startTell, endTell);
    if (!legible(tellLabel) && this.checkFairness) return { reject: 'illegible', nLabels, tellLabel };

    const color = this.colors(st);

    return {
      nLabels,
      sea,
      blank,
      tellLabel,
      draw: this.drawn(st).map((r) => [r.rid, color.get(this.unitId.get(r.unit))]),
      labels: [...placed].map(([id, l]) => ({ ...l, unit: st.recOf.get(id).unit })),
      start: startTell.date,
      end,
      startTell,
      endTell,
    };
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function angular(a, b) {
  const r = Math.PI / 180;
  const s = Math.sin((b[1] - a[1]) * r / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
