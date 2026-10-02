// Plain-English tells. Each sentence states what the map shows and when
// that changed; the page adds "so this map is from YEAR or later" or "from
// YEAR or earlier" from the window itself.
import { addDays } from '../../../src/borderline/window.js';
import { titleCase } from '../../../src/borderline/text.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/**
 * "3 November 1918", or "1918" when the source only knows the year (CShapes
 * uses 1 January when the day is unknown, CShapes-Europe has years only).
 */
export function when(date, precision = 'day') {
  const [y, m, d] = date.split('-').map(Number);
  if (precision === 'year' || (m === 1 && d === 1)) return 'in ' + y;
  if (precision === 'month') return 'in ' + MONTHS[m - 1] + ' ' + y;
  return 'on ' + d + ' ' + MONTHS[m - 1] + ' ' + y;
}

// Labels are stored in capitals for the map; tells use title case.
export const nice = titleCase;

/**
 * @param {object} t  tell from the judge
 * @param {'start'|'end'} side  which edge of the window it sets
 * @param {object} owners  names.json owners
 * @param {string} precision
 */
export function tellText(t, side, owners, precision = 'day') {
  const on = when(t.date, precision);
  const A = nice(t.a.label), B = nice(t.b.label);
  if (t.kind === 'name') {
    const oa = t.a.owner && owners[t.a.owner], ob = t.b.owner && owners[t.b.owner];
    const sameBase = t.a.base === t.b.base;
    if (sameBase && oa && !ob) {
      return side === 'end'
        ? nice(t.a.base) + ' is still marked ' + oa.word + '. It became independent ' + on + '.'
        : nice(t.b.base) + ' is shown independent, which it became ' + on + '.';
    }
    if (sameBase && !oa && ob) {
      return side === 'end'
        ? nice(t.a.base) + ' is not yet marked ' + ob.word + '. It came under ' + ob.word + ' rule ' + on + '.'
        : nice(t.b.base) + ' is marked ' + ob.word + ', which it became ' + on + '.';
    }
    if (sameBase && oa && ob) {
      return side === 'end'
        ? nice(t.a.base) + ' is still marked ' + oa.word + '. It passed to ' + ob.word + ' control ' + on + '.'
        : nice(t.b.base) + ' is marked ' + ob.word + ', which it became ' + on + '.';
    }
    return side === 'end'
      ? 'The map still says ' + A + '. The name changed to ' + B + ' ' + on + '.'
      : 'The map says ' + B + ', a name in use from ' + on.replace(/^(on|in) /, '') + '.';
  }
  if (t.kind === 'transfer') {
    return side === 'end'
      ? A + ' still holds this area. It passed to ' + B + ' ' + on + '.'
      : B + ' holds this area, which passed to it from ' + A + ' ' + on + '.';
  }
  // Border changes.
  if (side === 'end') {
    if (t.born) return 'There is no ' + B + ' yet. It appeared ' + on + '.';
    if (t.gone) return A + ' is still on the map. It disappeared ' + on + '.';
    if (t.b.unit === 'blank' || t.b.unit === 'sea') return A + ' still holds land it gave up ' + on + '.';
    if (t.a.unit === 'blank') return B + ' has not yet taken in land it gained ' + on + '.';
    return 'The border between ' + A + ' and ' + B + ' has not moved yet. It moved ' + on + '.';
  }
  if (t.born) return B + ' is on the map. It appeared ' + on + '.';
  if (t.gone) return 'There is no ' + A + '. It disappeared ' + on + '.';
  if (t.a.unit === 'blank' || t.a.unit === 'sea') return B + ' already holds land it gained ' + on + '.';
  if (t.b.unit === 'blank') return A + ' has already given up land, ' + on + '.';
  return 'The border between ' + A + ' and ' + B + ' is already in its new place, set ' + on + '.';
}

/** Last day the map can show, as text for the end edge. */
export const lastDay = (endTell) => addDays(endTell.date, -1);
