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
