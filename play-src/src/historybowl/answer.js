// Local answer checking for History Bowl Study. The page asks QB Reader's
// checker first (through the Worker); this is the fallback when that fails,
// and the parser behind "Show the accept and prompt lines".
//
// An answerline looks like
//   Charles <b><u>de Gaulle</u></b> [accept ...; prompt on <u>X</u>; do not accept Y]
// The underlined (or else bold) part of each option is what a player must say.

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on']);

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stem(t) {
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOPWORDS.has(t)).map(stem);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3})$/;
/** The numbers in a phrase (digits and regnal numerals), which must match exactly. */
const numbersIn = (s) => s.split(' ').filter((t) => /\d/.test(t) || ROMAN.test(t)).join(' ');

/** Two words or phrases close enough to be the same answer. Short ones must match exactly. */
export function close(a, b) {
  if (a === b) return true;
  const n = Math.max(a.length, b.length);
  if (n <= 3) return false;
  if (numbersIn(a) !== numbersIn(b)) return false;
  return levenshtein(a, b) <= (n <= 6 ? 1 : Math.floor(n * 0.2));
}

const stripTags = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The required part of one option: its underlined text, else its bold text, else all of it. */
function requiredOf(html) {
  const pick = (tag) => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
    const parts = [];
    let m;
    while ((m = re.exec(html))) parts.push(stripTags(m[1]));
    return parts.join(' ').trim();
  };
  return pick('u') || pick('b') || stripTags(html);
}

// Words that end an option early: "Peking before it is read".
const QUALIFIER = /\s+(?:before|after|until|once|if|when|since|by)\s+(?:["\u201c]|it\b|the\b|mention\b|read\b|[a-z]+\s+is\s+read).*$/i;

function splitOptions(clauseHtml, commas = true) {
  return clauseHtml
    .split(commas ? /\s*,?\s+or\s+|\s*,\s+/i : /\s+or\s+/i)
    .map((s) => s.replace(QUALIFIER, '').trim())
    .filter(Boolean);
}

/**
 * Parse an answerline (HTML from QB Reader, or plain text) into
 * { main, options: [{ kind: 'accept'|'prompt'|'reject', text, required }] }.
 */
export function parseAnswerline(answerline) {
  let html = String(answerline || '').replace(/\[\[[^\]]*\]\]/g, ' ');
  // Split the main answer from the bracketed or parenthesized notes.
  let depth = 0;
  let main = '';
  let notes = '';
  for (const ch of html) {
    if (ch === '[' || ch === '(') {
      depth++;
      if (depth === 1) {
        notes += ';';
        continue;
      }
    } else if (ch === ']' || ch === ')') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) continue;
    }
    if (depth === 0) main += ch;
    else notes += ch;
  }
  const options = [];
  // A main answer can itself hold alternatives: "Scotland or Alba", or
  // "Arthur <u>Wellesley</u>, 1st Duke of <u>Wellington</u>", where each
  // comma-separated piece has its own underlined name.
  const mainOptions = splitOptions(main, false).flatMap((opt) => {
    const pieces = opt.split(/,\s+/);
    return pieces.length > 1 && pieces.every((p) => /<[ub]>/i.test(p)) ? pieces : [opt];
  });
  for (const opt of mainOptions) {
    const text = stripTags(opt);
    if (text) options.push({ kind: 'accept', text, required: requiredOf(opt), plain: !/<[ub]>/i.test(opt) });
  }
  const mainText = stripTags(main);

  for (let clause of notes.split(';')) {
    clause = clause.trim();
    if (!clause) continue;
    const plain = stripTags(clause).toLowerCase();
    let kind = null;
    let body = clause;
    const lead = (re, k) => {
      const m = clause.match(re);
      if (m && !kind) {
        kind = k;
        body = clause.slice(m[0].length);
      }
    };
    lead(/^\s*(?:do\s+not|don['\u2019]t)\s+(?:accept|take)(?:\s+or\s+prompt)?(?:\s+on)?\s*:?/i, 'reject');
    lead(/^\s*reject\s*:?/i, 'reject');
    lead(/^\s*(?:also\s+)?prompt\s+on\s*:?/i, 'prompt');
    lead(/^\s*(?:also\s+)?(?:accept|or|take)\s*:?/i, 'accept');
    if (!kind) kind = 'accept';
    if (/\bdescri(?:ptions|ptive|be)|\bequivalents?\b|\bsimilar answers\b/.test(plain)) {
      // Descriptions can only be judged by a person; keep any quoted examples.
      const quoted = [...stripTags(body).matchAll(/["\u201c]([^"\u201d]+)["\u201d]/g)].map((m) => m[1]);
      for (const q of quoted) options.push({ kind, text: q, required: q, loose: true });
      continue;
    }
    for (const opt of splitOptions(body)) {
      const text = stripTags(opt).replace(/^["\u201c]|["\u201d]$/g, '');
      if (text) options.push({ kind, text, required: requiredOf(opt).replace(/^["\u201c]|["\u201d]$/g, ''), plain: !/<[ub]>/i.test(opt) });
    }
  }
  return { main: mainText, options };
}

function matches(given, opt) {
  const g = normalize(given);
  if (!g) return false;
  if (close(g, normalize(opt.text)) || close(g, normalize(opt.required))) return true;
  const req = tokens(opt.required);
  const got = tokens(given);
  if (!req.length || !got.length) return false;
  // Every required word present, and not much else said.
  const allThere = req.every((r) => got.some((t) => close(t, r)));
  if (allThere && got.length <= req.length + 4) return true;
  // With nothing underlined, the last word is enough, as with a surname:
  // "Du Bois" for "W. E. B. Du Bois", "Isandlwana" for "Battle of Isandlwana".
  if (opt.plain) {
    const last = req[req.length - 1];
    return got.some((t) => close(t, last)) && got.every((t) => req.some((r) => close(t, r)));
  }
  return false;
}

/**
 * Judge a typed answer locally. Returns { directive: 'accept'|'prompt'|'reject' }
 * in the same shape as QB Reader's checker.
 */
export function checkAnswer(answerline, given) {
  const { options } = parseAnswerline(answerline);
  const g = String(given || '').trim();
  if (!g) return { directive: 'reject', directedPrompt: null };
  for (const o of options) if (o.kind === 'reject' && close(normalize(g), normalize(o.text))) return { directive: 'reject', directedPrompt: null };
  for (const o of options) if (o.kind === 'accept' && matches(g, o)) return { directive: 'accept', directedPrompt: null };
  for (const o of options) if (o.kind === 'prompt' && matches(g, o)) return { directive: 'prompt', directedPrompt: null };
  return { directive: 'reject', directedPrompt: null };
}

/** The main answer as plain text, for a flashcard's back. */
export function mainAnswer(answerline) {
  return parseAnswerline(answerline).main;
}
