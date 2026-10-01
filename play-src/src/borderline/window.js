// The date window of a map, from the changes around the date it shows.
// Shared by the bank builder (CShapes crops), the curated puzzles, the
// tests and the browser (scoring), so it has no dependencies.
//
// A change is { date, visible, tell }: `date` is the first day of the new
// state (ISO yyyy-mm-dd). The window runs from the latest visible change on
// or before the shown date to the day before the earliest visible change
// after it. When no visible change exists on one side, that side ends at a
// dataset edge and is reported as censored.

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const yearOf = (iso) => Number(iso.slice(0, 4));

/**
 * @param {string} shown  date the map shows
 * @param {{date:string, visible:boolean, tell?:object}[]} changes any order
 * @param {{first:string, last:string}} edges  first and last day of data;
 *   `last` may be 'present'
 * @returns {{start:string, end:string, startTell:object|null,
 *   endTell:object|null, startCensored:boolean, endCensored:boolean}}
 */
export function windowAround(shown, changes, edges) {
  let before = null;
  let after = null;
  for (const c of changes) {
    if (!c.visible) continue;
    if (c.date <= shown) {
      if (!before || c.date > before.date) before = c;
    } else if (!after || c.date < after.date) {
      after = c;
    }
  }
  return {
    start: before ? before.date : edges.first,
    end: after ? addDays(after.date, -1) : edges.last,
    startTell: before ? before.tell || null : null,
    endTell: after ? after.tell || null : null,
    startCensored: !before,
    endCensored: !after,
  };
}

/**
 * Curated puzzles: each visible unit is valid over [from, to] (inclusive;
 * `to` may be 'present'). Its first day and the day after its last are
 * the changes it contributes.
 */
export function windowFromSpans(shown, spans, edges) {
  const changes = [];
  for (const s of spans) {
    changes.push({ date: s.from, visible: true, tell: { ...s.tell, side: 'start', unit: s.unit, date: s.from } });
    if (s.to !== 'present') {
      const date = addDays(s.to, 1);
      changes.push({ date, visible: true, tell: { ...s.tell, side: 'end', unit: s.unit, date } });
    }
  }
  return windowAround(shown, changes, edges);
}

/** Inclusive year span of a window; `present` counts as `currentYear`. */
export function windowYears(win, currentYear) {
  const end = win.end === 'present' ? currentYear : yearOf(win.end);
  return [yearOf(win.start), end];
}
