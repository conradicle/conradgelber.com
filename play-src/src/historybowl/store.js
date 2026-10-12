// History Bowl Study's memory on this device: every tossup heard, the
// flashcards made from missed clues, and settings. All in localStorage;
// every read and write is wrapped so the page still works when storage is
// empty, full or blocked. Export and import move it between devices.

export const KEYS = {
  records: 'historybowl:records',
  cards: 'historybowl:cards',
  settings: 'historybowl:settings',
  seen: 'historybowl:seen',
  queue: 'historybowl:queue',
};
export const EXPORT_KIND = 'conradgelber-historybowl';
export const EXPORT_VERSION = 1;
const SEEN_MAX = 1500;

export function readJSON(storage, key, fallback) {
  try {
    const raw = storage && storage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Private mode, full or blocked storage: play goes on, it just forgets.
    return false;
  }
}

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A record of one tossup heard, or null if malformed. */
export function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (!isStr(r.id) || !isStr(r.qid) || !isNum(r.ts) || typeof r.ok !== 'boolean') return null;
  const buzz = isNum(r.buzz) ? Math.min(1, Math.max(0, r.buzz)) : null;
  return {
    id: r.id,
    qid: r.qid,
    src: isStr(r.src) ? r.src : 'unknown',
    cat: isStr(r.cat) ? r.cat : 'Unknown',
    sub: isStr(r.sub) ? r.sub : 'Unknown',
    era: isStr(r.era) ? r.era : 'unknown',
    region: isStr(r.region) ? r.region : 'Region unclear',
    ok: r.ok,
    buzz,
    ovr: r.ovr === true,
    ts: r.ts,
  };
}

/** A flashcard, or null if malformed. `fsrs` is filled in by the review screen. */
export function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  if (!isStr(c.id) || !isStr(c.front) || !isStr(c.back) || !c.front.trim() || !isNum(c.created)) return null;
  return {
    id: c.id,
    front: c.front.slice(0, 1000),
    back: c.back.slice(0, 300),
    qid: isStr(c.qid) ? c.qid : null,
    src: isStr(c.src) ? c.src : 'unknown',
    cat: isStr(c.cat) ? c.cat : 'Unknown',
    sub: isStr(c.sub) ? c.sub : 'Unknown',
    era: isStr(c.era) ? c.era : 'unknown',
    created: c.created,
    fsrs: c.fsrs && typeof c.fsrs === 'object' ? c.fsrs : null,
  };
}

const cleanList = (list, fn) => (Array.isArray(list) ? list.map(fn).filter(Boolean) : []);

export function loadRecords(storage) {
  return cleanList(readJSON(storage, KEYS.records, []), cleanRecord);
}
export function saveRecords(storage, records) {
  return writeJSON(storage, KEYS.records, records);
}
export function loadCards(storage) {
  return cleanList(readJSON(storage, KEYS.cards, []), cleanCard);
}
export function saveCards(storage, cards) {
  return writeJSON(storage, KEYS.cards, cards);
}

/** Recently heard question ids, newest last, so a session does not repeat itself. */
export function loadSeen(storage) {
  const v = readJSON(storage, KEYS.seen, []);
  return Array.isArray(v) ? v.filter(isStr) : [];
}
export function addSeen(storage, seen, qid) {
  const next = seen.filter((id) => id !== qid).concat(qid).slice(-SEEN_MAX);
  writeJSON(storage, KEYS.seen, next);
  return next;
}

export const DEFAULT_SETTINGS = {
  sources: ['bee', 'qb'],
  cats: ['History', 'Geography', 'Fine Arts', 'Literature'],
  subs: [],
  level: 'regional',
  wpm: 230,
  answerSecs: 8,
  buzzSecs: 5,
};
export const SPEED_RANGE = [120, 450];

export function loadSettings(storage) {
  const v = readJSON(storage, KEYS.settings, {});
  const s = { ...DEFAULT_SETTINGS };
  if (v && typeof v === 'object') {
    if (Array.isArray(v.sources) && v.sources.every(isStr) && v.sources.length) s.sources = v.sources;
    if (Array.isArray(v.cats) && v.cats.every(isStr) && v.cats.length) s.cats = v.cats;
    if (Array.isArray(v.subs) && v.subs.every(isStr)) s.subs = v.subs;
    if (['regional', 'harder', 'all'].includes(v.level)) s.level = v.level;
    if (isNum(v.wpm)) s.wpm = Math.min(SPEED_RANGE[1], Math.max(SPEED_RANGE[0], Math.round(v.wpm)));
    if (isNum(v.answerSecs)) s.answerSecs = Math.min(30, Math.max(3, Math.round(v.answerSecs)));
    if (isNum(v.buzzSecs)) s.buzzSecs = Math.min(15, Math.max(2, Math.round(v.buzzSecs)));
  }
  return s;
}
export function saveSettings(storage, s) {
  return writeJSON(storage, KEYS.settings, s);
}

/** Everything worth carrying to another device, as one JSON-ready object. */
export function exportData(storage, now = Date.now()) {
  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    records: loadRecords(storage),
    cards: loadCards(storage),
    settings: loadSettings(storage),
  };
}

/**
 * Merge an exported file into this device. Records and cards are matched by
 * id; for a card on both sides, the one reviewed most recently wins.
 * Returns { ok, records, cards, error } with counts of what was added.
 */
export function importData(storage, data) {
  if (!data || data.kind !== EXPORT_KIND || !isNum(data.version)) return { ok: false, error: 'That file is not a History Bowl Study export.' };
  if (data.version > EXPORT_VERSION) return { ok: false, error: 'That file is from a newer version. Reload this page and try again.' };
  const records = loadRecords(storage);
  const haveR = new Set(records.map((r) => r.id));
  let addedR = 0;
  for (const r of cleanList(data.records, cleanRecord)) {
    if (haveR.has(r.id)) continue;
    records.push(r);
    haveR.add(r.id);
    addedR++;
  }
  records.sort((a, b) => a.ts - b.ts);

  const cards = loadCards(storage);
  const byId = new Map(cards.map((c, i) => [c.id, i]));
  let addedC = 0;
  const reviewed = (c) => (c.fsrs && isNum(c.fsrs.lastReview) ? c.fsrs.lastReview : c.created);
  for (const c of cleanList(data.cards, cleanCard)) {
    if (!byId.has(c.id)) {
      byId.set(c.id, cards.length);
      cards.push(c);
      addedC++;
    } else if (reviewed(c) > reviewed(cards[byId.get(c.id)])) {
      cards[byId.get(c.id)] = c;
    }
  }
  const saved = saveRecords(storage, records) && saveCards(storage, cards);
  if (!saved) return { ok: false, error: 'This browser would not save the data (storage is full or blocked).' };
  return { ok: true, records: addedR, cards: addedC };
}

/**
 * Accuracy and buzz point grouped by one field ('cat', 'sub', 'era', 'region').
 * Buzz point averages only correct buzzes: how early you knew it.
 */
export function aggregate(records, field, filter = () => true) {
  const groups = new Map();
  for (const r of records) {
    if (!filter(r)) continue;
    const k = r[field];
    const g = groups.get(k) || { key: k, heard: 0, correct: 0, buzzSum: 0, buzzN: 0 };
    g.heard++;
    if (r.ok) {
      g.correct++;
      if (r.buzz !== null) {
        g.buzzSum += r.buzz;
        g.buzzN++;
      }
    }
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, heard: g.heard, correct: g.correct, accuracy: g.correct / g.heard, avgBuzz: g.buzzN ? g.buzzSum / g.buzzN : null }))
    .sort((a, b) => b.heard - a.heard || String(a.key).localeCompare(String(b.key)));
}
