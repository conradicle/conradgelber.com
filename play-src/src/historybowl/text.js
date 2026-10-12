// Question text helpers shared by the reader, the results screen and (later)
// the multiplayer rooms: words, the reading schedule, sentences, buzz point.

export function cleanText(s) {
  return String(s || '')
    .replace(/\(\*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text) {
  const t = cleanText(text);
  return t ? t.split(' ') : [];
}

const ABBREV = new Set(['mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'mt.', 'ft.', 'jr.', 'sr.', 'vs.', 'gen.', 'col.', 'capt.', 'lt.', 'sgt.', 'gov.', 'sen.', 'rep.', 'rev.', 'no.', 'vol.', 'c.', 'ca.', 'u.s.', 'u.k.', 'e.g.', 'i.e.', 'etc.']);

/** Does this word end a sentence, given the word after it? */
export function endsSentence(word, next) {
  if (!/[.!?]["'\u201d\u2019)]*$/.test(word)) return false;
  if (next === undefined) return true;
  const w = word.toLowerCase().replace(/["'\u201d\u2019)]+$/, '');
  if (ABBREV.has(w)) return false;
  // Initials like "W." or "E.B."
  if (/^(?:[a-z]\.)+$/i.test(w)) return false;
  return /^["'\u201c\u2018(]?[A-Z0-9]/.test(next);
}

/** Sentences as [startWord, endWord) ranges over words(text). */
export function sentences(list) {
  const out = [];
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (endsSentence(list[i], list[i + 1])) {
      out.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < list.length) out.push([start, list.length]);
  return out;
}

/**
 * When each word appears, in ms from the start, at `wpm` words a minute.
 * A sentence end holds a beat longer, as a reader would.
 * Returns an array one longer than the word list: the last entry is when
 * reading finishes.
 */
export function schedule(list, wpm) {
  const base = 60000 / wpm;
  const times = [0];
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    t += base * (endsSentence(list[i], list[i + 1]) ? 1.8 : /[,;:]$/.test(list[i]) ? 1.3 : 1);
    times.push(Math.round(t));
  }
  return times;
}

/** How many words are showing `elapsed` ms after the start. */
export function shownAt(times, elapsed) {
  let n = 0;
  while (n < times.length - 1 && times[n] <= elapsed) n++;
  return n;
}

/** Buzz point as a fraction of the question heard (1 once it has all been read). */
export function buzzFraction(shown, total) {
  if (!total) return 1;
  return Math.min(1, Math.max(0, shown / total));
}
