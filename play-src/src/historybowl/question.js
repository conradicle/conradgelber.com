// One question shape for every source, used by the page and the Worker.
//
// { id, source, sourceLabel, set, year, difficulty, category, subcategory,
//   era, region, text, answerHtml, answerPlain }
//
// `answerHtml` keeps only <b>, <u>, <i>, <em> and <strong>; everything else
// in it is escaped text. The page builds the answerline from those tags
// itself and never assigns the string to innerHTML.

import { cleanText } from './text.js';
import { estimateEra, estimateRegion } from './tags.js';

export const SOURCES = {
  bee: { key: 'iac-bee-qbreader', label: 'IAC History Bee Nationals, via QB Reader' },
  qb: { key: 'qbreader', label: 'QB Reader' },
};
export const SOURCE_LABEL = {
  'iac-bee-qbreader': 'IAC History Bee Nationals, via QB Reader',
  qbreader: 'QB Reader',
  ai: 'AI-written',
  'iac-packet': 'IAC regional packet',
};

/** The History Bee Nationals sets QB Reader holds, with their packet counts (checked 2026-10-12). */
export const BEE_SETS = [
  ['2015 History Bee Nationals', 9],
  ['2016 History Bee Nationals', 9],
  ['2017 History Bee Nationals', 10],
  ['2018 History Bee Nationals', 10],
  ['2019 History Bee Nationals', 9],
  ['2020 History Bee Nationals', 8],
  ['2021 History Bee Nationals', 10],
  ['2022 History Bee Nationals', 9],
];

export const CATEGORIES = ['History', 'Geography', 'Fine Arts', 'Literature', 'Current Events', 'Religion', 'Mythology', 'Philosophy', 'Social Science'];
export const SUBCATEGORIES = {
  History: ['American History', 'Ancient History', 'European History', 'World History', 'Other History'],
  'Fine Arts': ['Visual Fine Arts', 'Auditory Fine Arts', 'Other Fine Arts'],
  Literature: ['American Literature', 'British Literature', 'Classical Literature', 'European Literature', 'World Literature', 'Other Literature'],
};
export const LEVELS = {
  regional: [2, 3],
  harder: [3, 4],
  all: [2, 3, 4, 5],
};

const ALLOWED = /^<\/?(b|u|i|em|strong)>$/i;
const escapeHtml = (s) => s.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Keep the emphasis tags of an answerline, escape everything else. */
export function safeAnswerHtml(html) {
  return String(html || '')
    .split(/(<[^>]*>)/)
    .map((part) => (ALLOWED.test(part) ? part.toLowerCase() : part.startsWith('<') && part.endsWith('>') ? '' : escapeHtml(part)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// Some packets were converted from PDFs with the accent split off before
// its letter: "Gust\u00b4av Hus\u00b4ak". Put each accent back on its letter.
const SPACING_ACCENTS = { '\u00b4': '\u0301', '\u02ca': '\u0301', '\u00a8': '\u0308', '\u02c7': '\u030c', '\u02c6': '\u0302' };
export function joinAccents(s) {
  return String(s || '')
    .replace(/[\u00b4\u02ca\u00a8\u02c7\u02c6]([A-Za-z])/g, (m, letter) => (letter + SPACING_ACCENTS[m[0]]).normalize('NFC'))
    .replace(/[\u00b4\u02ca\u00a8\u02c7\u02c6]/g, '');
}

/** A QB Reader tossup, in the shared shape. */
export function fromQbTossup(t, sourceKey) {
  const src = sourceKey === 'bee' ? SOURCES.bee : SOURCES.qb;
  const text = cleanText(joinAccents(t.question_sanitized || ''));
  const category = String(t.category || 'Unknown');
  const subcategory = String(t.subcategory || category);
  return {
    id: `qb:${t._id}`,
    source: src.key,
    sourceLabel: src.label,
    set: t.set && t.set.name ? String(t.set.name) : '',
    year: t.set && Number.isFinite(t.set.year) ? t.set.year : null,
    packet: t.packet && Number.isFinite(t.packet.number) ? t.packet.number : null,
    number: Number.isFinite(t.number) ? t.number : null,
    difficulty: Number.isFinite(t.difficulty) ? t.difficulty : null,
    category,
    subcategory,
    era: estimateEra(text, subcategory),
    region: estimateRegion(text, category, subcategory),
    text,
    answerHtml: safeAnswerHtml(joinAccents(t.answer || t.answer_sanitized || '')),
    answerPlain: cleanText(joinAccents(t.answer_sanitized || '')),
  };
}

/** A QB Reader bonus: a leadin and its parts, each part usable on its own. */
export function fromQbBonus(b) {
  const category = String(b.category || 'Unknown');
  const subcategory = String(b.subcategory || category);
  const parts = (b.parts_sanitized || []).map((p, i) => ({
    id: `qbb:${b._id}:${i}`,
    text: cleanText(joinAccents(p)).replace(/^\[\d+[ehm]?\]\s*/i, ''),
    answerHtml: safeAnswerHtml(joinAccents((b.answers || [])[i] || (b.answers_sanitized || [])[i] || '')),
    answerPlain: cleanText(joinAccents((b.answers_sanitized || [])[i] || '')),
    level: (b.difficultyModifiers || [])[i] || null,
  }));
  return {
    id: `qbb:${b._id}`,
    source: SOURCES.qb.key,
    sourceLabel: SOURCES.qb.label,
    set: b.set && b.set.name ? String(b.set.name) : '',
    year: b.set && Number.isFinite(b.set.year) ? b.set.year : null,
    difficulty: Number.isFinite(b.difficulty) ? b.difficulty : null,
    category,
    subcategory,
    // "For 10 points each" belongs to the full bonus; a single part stands without it.
    leadin: cleanText(joinAccents(b.leadin_sanitized || ''))
      .replace(/^For (?:10|ten) points each[,:.]?\s*/i, '')
      .replace(/\s*For (?:10|ten) points each[,:.]?\s*(?:answer the following[^.]*\.?)?\s*$/i, '')
      .replace(/^./, (c) => c.toUpperCase())
      .trim(),
    parts: parts.filter((p) => p.text && p.answerPlain),
  };
}

// ---------- IAC regional packets ----------

export const PACKET_SOURCE = 'iac-packet';
export const PACKET_SHORT_SOURCE = 'iac-packet-short';
Object.assign(SOURCE_LABEL, {
  [PACKET_SOURCE]: 'IAC regional packet',
  [PACKET_SHORT_SOURCE]: 'IAC regional packet, short tossup',
});

const SUB_FROM_REGION = { 'United States': 'American History', Europe: 'European History', 'Ancient world': 'Ancient History' };
const plainOf = (html) => cleanText(String(html || '').replace(/<[^>]*>/g, ''));

/** The packet's id: year, set and round, as in "2018-2019-A-r3". */
export function packetId(meta) {
  const parts = [meta.year, meta.set, meta.round !== null && meta.round !== undefined ? `r${meta.round}` : ''].filter(Boolean);
  if (parts.length >= 2) return parts.join('-');
  return String(meta.file || 'packet').replace(/\.[a-z]+$/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/**
 * A packet question in the shared shape. Packets carry no categories, so the
 * subcategory is a guess from the question's region, marked `subGuess`:
 * the weakest-areas ranking treats it as an estimate until corrected.
 */
function fromPacketItem(it, pid, tag, label, short = false) {
  const text = cleanText(joinAccents(it.text));
  const region = estimateRegion(text, 'History', '');
  const era = estimateEra(text, '');
  // A question set before 500 is ancient history wherever it is set.
  const subcategory = era === 'ancient' ? 'Ancient History' : SUB_FROM_REGION[region] || 'World History';
  const answerHtml = safeAnswerHtml(joinAccents(it.answerHtml || it.answer || ''));
  return {
    id: `iac:${pid}:${tag}`,
    source: short ? PACKET_SHORT_SOURCE : PACKET_SOURCE,
    sourceLabel: SOURCE_LABEL[short ? PACKET_SHORT_SOURCE : PACKET_SOURCE],
    set: label,
    year: null,
    packet: null,
    number: it.n || null,
    difficulty: null,
    category: 'History',
    subcategory,
    subGuess: true,
    era: era === 'unknown' && subcategory === 'Ancient History' ? 'ancient' : era,
    region,
    text,
    answerHtml,
    answerPlain: plainOf(answerHtml),
  };
}

/** A parsed packet (see packet.js) as questions ready for the reader and the simulator. */
export function fromPacket(p) {
  const pid = packetId(p.meta);
  const label = [p.meta.year, p.meta.set ? `${p.meta.set} Set` : '', p.meta.round !== null ? `Round ${p.meta.round}` : ''].filter(Boolean).join(' ') || pid;
  const part = (it, tag, category) => {
    const q = fromPacketItem(it, pid, tag, label);
    return { id: q.id, text: q.text, answerHtml: q.answerHtml, answerPlain: q.answerPlain, leadin: '', level: null, category, subcategory: q.subcategory, source: PACKET_SOURCE, era: q.era, region: q.region };
  };
  return {
    id: pid,
    label,
    q1: p.q1.map((it, i) => fromPacketItem(it, pid, `q1-${i + 1}`, label, true)),
    q2: p.q2.map((it, i) => ({
      tossup: fromPacketItem(it, pid, `q2-${i + 1}`, label),
      bonus: it.bonus && it.bonus.answer ? part(it.bonus, `q2-${i + 1}-bonus`, 'History') : null,
    })),
    q3: p.q3.map((c, ci) => ({ label: c.category, questions: c.questions.map((it, i) => part(it, `q3-${ci + 1}-${i + 1}`, c.category)) })),
    q4: p.q4.map((it, i) => fromPacketItem(it, pid, `q4-${i + 1}`, label)),
    extra: p.extra.map((it, i) => fromPacketItem(it, pid, `x-${i + 1}`, label)),
  };
}
