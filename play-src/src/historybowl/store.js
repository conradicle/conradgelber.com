// History Bowl Study's memory on this device: every tossup heard, the
// flashcards made from missed clues, the player's own corrections to a
// question's tags, and settings. All in localStorage;
// every read and write is wrapped so the page still works when storage is
// empty, full or blocked. Export and import move it between devices.

export const KEYS = {
  records: 'historybowl:records',
  cards: 'historybowl:cards',
  settings: 'historybowl:settings',
  seen: 'historybowl:seen',
  queue: 'historybowl:queue',
  fixes: 'historybowl:fixes',
  deckFixes: 'historybowl:deck-fixes',
  team: 'historybowl:team',
  packetsUsed: 'historybowl:packets-used',
};
/** The tags a player can correct on a question. */
export const FIX_FIELDS = ['cat', 'sub', 'era', 'region'];
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
    // QB Reader difficulty (0 for the unrated Bee sets), when known.
    diff: isNum(r.diff) ? r.diff : null,
    // tossup (a full pyramid), short (a real first-quarter tossup) or lightning.
    fmt: ['short', 'lightning'].includes(r.fmt) ? r.fmt : 'tossup',
    // The subcategory is a guess (IAC packets carry none), until corrected.
    sg: r.sg === true,
    // Which tags the player corrected by hand.
    fx: Array.isArray(r.fx) ? r.fx.filter((k) => FIX_FIELDS.includes(k)) : [],
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
    deck: isStr(c.deck) ? c.deck : null,
    fx: Array.isArray(c.fx) ? c.fx.filter((k) => FIX_FIELDS.includes(k)) : [],
  };
}

const cleanList = (list, fn) => (Array.isArray(list) ? list.map(fn).filter(Boolean) : []);

export function loadRecords(storage) {
  return cleanList(readJSON(storage, KEYS.records, []), cleanRecord);
}
export function saveRecords(storage, records) {
  return writeJSON(storage, KEYS.records, records);
}
/** Corrections, by question id: { [qid]: { cat?, sub?, era?, region? } }. */
export function cleanFixes(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [qid, fix] of Object.entries(v)) {
    if (!fix || typeof fix !== 'object') continue;
    const clean = {};
    for (const k of FIX_FIELDS) if (isStr(fix[k]) && fix[k].trim()) clean[k] = fix[k].trim().slice(0, 60);
    if (Object.keys(clean).length) out[qid] = clean;
  }
  return out;
}
export function loadFixes(storage) {
  return cleanFixes(readJSON(storage, KEYS.fixes, {}));
}

/** A question or record with the player's corrections laid over it. */
export function withFix(item, fixes) {
  const fix = fixes[item.qid || item.id];
  if (!fix) return item;
  const out = { ...item };
  const fx = new Set(item.fx || []);
  for (const k of FIX_FIELDS) {
    if (!fix[k]) continue;
    // Questions name these fields in full; records and cards use short names.
    const long = { cat: 'category', sub: 'subcategory' }[k];
    if (long && long in item) out[long] = fix[k];
    else out[k] = fix[k];
    fx.add(k);
  }
  out.fx = [...fx];
  return out;
}

/**
 * Save a correction for one question and apply it to every record and card
 * from that question. Returns the new { fixes, records, cards }.
 */
export function saveFix(storage, state, qid, fix) {
  const fixes = { ...state.fixes, [qid]: { ...(state.fixes[qid] || {}), ...cleanFixes({ [qid]: fix })[qid] } };
  const records = state.records.map((r) => (r.qid === qid ? withFix(r, fixes) : r));
  const cards = state.cards.map((c) => (c.qid === qid ? withFix(c, fixes) : c));
  writeJSON(storage, KEYS.fixes, fixes);
  saveRecords(storage, records);
  saveCards(storage, cards);
  return { fixes, records, cards };
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
  // Lightning bouncebacks: after the 60 seconds (IAC in person) or one at a time (IAC online).
  bounceRule: 'in-person',
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
    if (['in-person', 'online'].includes(v.bounceRule)) s.bounceRule = v.bounceRule;
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
    fixes: loadFixes(storage),
    deckFixes: readJSON(storage, KEYS.deckFixes, {}),
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
  // Corrections made on this device win over imported ones for the same field.
  const fixes = loadFixes(storage);
  let addedF = 0;
  for (const [qid, fix] of Object.entries(cleanFixes(data.fixes))) {
    const mine = fixes[qid] || {};
    const merged = { ...fix, ...mine };
    if (JSON.stringify(merged) !== JSON.stringify(mine)) addedF++;
    fixes[qid] = merged;
  }
  for (let i = 0; i < records.length; i++) if (fixes[records[i].qid]) records[i] = withFix(records[i], fixes);
  for (let i = 0; i < cards.length; i++) if (cards[i].qid && fixes[cards[i].qid]) cards[i] = withFix(cards[i], fixes);
  // Starter-deck fixes: this device's win for the same card.
  const deckFixes = readJSON(storage, KEYS.deckFixes, {});
  if (data.deckFixes && typeof data.deckFixes === 'object' && !Array.isArray(data.deckFixes)) {
    for (const [id, f] of Object.entries(data.deckFixes)) {
      if (typeof id === 'string' && f && typeof f === 'object' && !deckFixes[id]) deckFixes[id] = f;
    }
  }
  const saved = saveRecords(storage, records) && saveCards(storage, cards) && writeJSON(storage, KEYS.fixes, fixes) && writeJSON(storage, KEYS.deckFixes, deckFixes);
  if (!saved) return { ok: false, error: 'This browser would not save the data (storage is full or blocked).' };
  return { ok: true, records: addedR, cards: addedC, fixes: addedF };
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
