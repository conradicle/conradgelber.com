// Parse a National History Bowl packet (as text lines from its PDF) into
// quarters: short tossups, tossups with bonuses, lightning categories and
// long tossups. Pure, so it runs in the import script and in tests. It is
// tolerant of the small layout changes between years, and reports anything
// it could not place rather than guessing.
//
// Each input line is { text, html }, where html marks bold runs with <b>
// (the required part of an answer is printed in bold).

export const EXPECTED = { q1: 10, q2: 8, q3: 3, q3each: 8, q4: 8 };

const QUARTER_WORDS = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4 };

export function cleanLine(s) {
  return String(s || '')
    .replace(/\ufb01/g, 'fi')
    .replace(/\ufb02/g, 'fl')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A quarter heading: 1-4, 'extra' for tiebreakers, or null. */
export function quarterOf(text) {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(/^(first|1st|second|2nd|third|3rd|fourth|4th) quarter\b/);
  if (m) return QUARTER_WORDS[m[1]];
  m = t.match(/^quarter (\d|one|two|three|four)\b/);
  if (m) return Number(m[1]) || QUARTER_WORDS[m[1]];
  if (/^lightning round\b/.test(t)) return 3;
  if (/^(extra|tie ?breaker|overtime|replacement|alternate|backup)( questions?| tossups?)?\b/.test(t) && t.length < 40) return 'extra';
  return null;
}

const QUESTION = /^(?:\(\s*(\d{1,2})\s*\)|(\d{1,2})\s*[.)])\s*(.*)$/;
const TOSSUP = /^tossup\s*(\d{1,2})?\s*[.:)]?\s*(.*)$/i;
const ANSWER = /^answer\s*[:.]\s*(.*)$/i;
const BONUS = /^bonus\s*(\d{1,2})?\s*[.:)]?\s*(.*)$/i;
const ANSWER_HTML = /^(?:<b>)?\s*answer\s*[:.]\s*(?:<\/b>)?\s*/i;

/** Remove the point markers some sets print in fourth-quarter tossups. */
export function stripMarkers(s) {
  return s.replace(/\(\s*(?:\+|\*|30|20|10)\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function isHeaderish(text) {
  return /^(page \d+( of \d+)?|\d{1,3})$/i.test(text) || /^\u00a9|copyright/i.test(text);
}

/** Lines repeated on many pages (running headers and footers) are dropped. */
export function repeatedLines(lines, min = 3) {
  const count = new Map();
  for (const l of lines) {
    const k = cleanLine(l.text).replace(/\d+/g, '#');
    if (k.length > 0 && k.length < 120) count.set(k, (count.get(k) || 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= min).map(([k]) => k));
}

/** "Appian</b> Way" (left when a bold label and a bold answer ran together): reopen the bold. */
export function balanceBold(h) {
  const first = h.search(/<\/?b>/i);
  return first >= 0 && /^<\/b>/i.test(h.slice(first)) ? `<b>${h}` : h;
}

/** Merge two runs of html, closing and reopening bold across the join. */
const joinHtml = (a, b) => (a ? `${a} ${b}` : b).replace(/<\/b>\s*<b>/g, ' ');

/**
 * Parse lines into { meta, q1, q2, q3, q4, extra, problems }.
 * q1, q4, extra: [{ n, text, answer, answerHtml }]
 * q2: [{ n, text, answer, answerHtml, bonus: { text, answer, answerHtml } | null }]
 * q3: [{ category, questions: [{ n, text, answer, answerHtml }] }]
 */
export function parsePacket(rawLines, { file = '' } = {}) {
  const lines = rawLines.map((l) => ({ text: cleanLine(l.text), html: cleanLine(l.html ?? l.text) })).filter((l) => l.text);
  const repeated = repeatedLines(lines);
  const out = { meta: { file, title: '', set: '', year: '', round: null }, q1: [], q2: [], q3: [], q4: [], extra: [], problems: [] };
  let quarter = null;
  // The field continuation lines go into: { obj, key, htmlKey }.
  let field = null;
  let cur = null;
  let category = null;
  const problem = (msg, text) => out.problems.push(text ? `${msg}: ${text.slice(0, 120)}` : msg);

  const takeMeta = (text) => {
    const y = text.match(/\b(20\d\d)\s*[-\u2013\/]\s*(\d{2,4})\b/);
    if (y && !out.meta.year) out.meta.year = `${y[1]}-${y[2].length === 2 ? '20' + y[2] : y[2]}`;
    const s = text.match(/\b(?:set\s+([A-E])|([A-E])\s+set)\b/i);
    if (s && !out.meta.set) out.meta.set = (s[1] || s[2]).toUpperCase();
    const r = text.match(/\bround\s+(\d{1,2})\b/i);
    if (r && out.meta.round === null) out.meta.round = Number(r[1]);
    if (!out.meta.title && /history bowl|history bee/i.test(text)) out.meta.title = text;
  };

  const listFor = (q) => (q === 'extra' ? out.extra : out[`q${q}`]);

  for (const { text, html } of lines) {
    if (repeated.has(text.replace(/\d+/g, '#')) || isHeaderish(text)) {
      takeMeta(text);
      continue;
    }
    const q = quarterOf(text);
    if (q !== null) {
      quarter = q;
      field = null;
      cur = null;
      category = null;
      continue;
    }
    if (quarter === null) {
      // Before the first quarter: title lines.
      takeMeta(text);
      continue;
    }

    let m;
    if ((m = text.match(ANSWER))) {
      if (!field) {
        problem('Answer with no question', text);
        continue;
      }
      const target = field.obj;
      const answerKey = field.answerKey;
      target[answerKey] = m[1];
      target[`${answerKey}Html`] = balanceBold(html.replace(ANSWER_HTML, ''));
      field = { obj: target, key: answerKey, htmlKey: `${answerKey}Html`, answerKey };
      continue;
    }
    if (quarter === 2 && (m = text.match(BONUS)) && cur) {
      cur.bonus = { text: m[2], answer: '', answerHtml: '' };
      field = { obj: cur.bonus, key: 'text', answerKey: 'answer' };
      continue;
    }

    m = text.match(QUESTION) || text.match(TOSSUP);
    if (m) {
      const n = Number(m[1] || m[2]) || null;
      const body = m[3] !== undefined ? m[3] : m[2] || '';
      // In the lightning round a short numbered line with no question in it
      // can be a category title ("1. The Ottoman Empire").
      if (quarter === 3 && looksLikeCategory(body) && (!category || category.questions.length >= EXPECTED.q3each || (n === 1 && category.questions.length > 0))) {
        category = { category: body, questions: [] };
        out.q3.push(category);
        field = null;
        continue;
      }
      const item = { n: n || listCount(quarter, category) + 1, text: body, answer: '', answerHtml: '' };
      if (quarter === 2) item.bonus = null;
      if (quarter === 3) {
        if (!category) {
          category = { category: 'Lightning', questions: [] };
          out.q3.push(category);
          problem('Lightning question before any category');
        }
        category.questions.push(item);
      } else {
        listFor(quarter).push(item);
      }
      cur = item;
      field = { obj: item, key: 'text', answerKey: 'answer' };
      continue;
    }

    // The lightning round's opening line lists the categories; the titles come later.
    if (quarter === 3 && /\bcategor(?:y|ies) (?:is|are)\b/i.test(text)) continue;
    // A line on its own in the lightning round, between questions: a category title.
    if (quarter === 3 && looksLikeCategory(text) && !openBracket(field) && (!field || field.key !== 'text' || (cur && cur.answer))) {
      category = { category: text.replace(/^category\s*\d*\s*[:.)-]?\s*/i, ''), questions: [] };
      out.q3.push(category);
      field = null;
      continue;
    }

    if (field) {
      const k = field.key;
      field.obj[k] = field.obj[k] ? `${field.obj[k]} ${text}` : text;
      if (field.htmlKey) field.obj[field.htmlKey] = joinHtml(field.obj[field.htmlKey], html);
      continue;
    }
    problem('Line not placed', text);
  }

  // Tidy and check.
  const finish = (it, label) => {
    it.text = stripMarkers(it.text);
    if (!it.answer) problem(`${label} ${it.n} has no answer`);
    it.answerHtml = it.answerHtml || it.answer;
  };
  out.q1.forEach((it) => finish(it, 'Q1'));
  out.q2.forEach((it) => {
    finish(it, 'Q2');
    if (it.bonus) {
      it.bonus.text = stripMarkers(it.bonus.text);
      it.bonus.answerHtml = it.bonus.answerHtml || it.bonus.answer;
      if (!it.bonus.answer) problem(`Q2 ${it.n} bonus has no answer`);
    } else problem(`Q2 ${it.n} has no bonus`);
  });
  out.q3.forEach((c) => c.questions.forEach((it) => finish(it, `Q3 ${c.category}`)));
  out.q4.forEach((it) => finish(it, 'Q4'));
  out.extra.forEach((it) => finish(it, 'Extra'));
  if (out.q1.length !== EXPECTED.q1) problem(`Q1 has ${out.q1.length} tossups, expected ${EXPECTED.q1}`);
  if (out.q2.length !== EXPECTED.q2) problem(`Q2 has ${out.q2.length} tossups, expected ${EXPECTED.q2}`);
  if (out.q3.length !== EXPECTED.q3) problem(`Q3 has ${out.q3.length} categories, expected ${EXPECTED.q3}`);
  for (const c of out.q3) if (c.questions.length !== EXPECTED.q3each) problem(`Q3 "${c.category}" has ${c.questions.length} questions, expected ${EXPECTED.q3each}`);
  if (out.q4.length !== EXPECTED.q4) problem(`Q4 has ${out.q4.length} tossups, expected ${EXPECTED.q4}`);
  return out;
}

/** An answer still inside [brackets] or (parentheses) goes on to the next line. */
function openBracket(field) {
  if (!field || field.key === 'text') return false;
  const s = field.obj[field.key] || '';
  const count = (re) => (s.match(re) || []).length;
  return count(/\[/g) > count(/\]/g) || count(/\(/g) > count(/\)/g);
}

function listCount(quarter, category) {
  return quarter === 3 && category ? category.questions.length : 0;
}

/** Short, no question mark, no sentence end, no "this": a category title. */
export function looksLikeCategory(text) {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  if (/[?]$/.test(t) || /\.$/.test(t)) return false;
  if (/\b(this|these|name|identify|which|what|who)\b/i.test(t)) return false;
  return /^[A-Z0-9"'\u201c(]/.test(t);
}

/** True when a packet has everything a match needs. */
export function packetComplete(p) {
  return p.q1.length >= EXPECTED.q1 && p.q2.length >= EXPECTED.q2 && p.q3.length >= 2 && p.q3.every((c) => c.questions.length >= EXPECTED.q3each) && p.q4.length >= EXPECTED.q4;
}
