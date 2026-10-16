// Result links. Everything lives in the URL fragment (after #), which the
// browser never sends to a server.
//
// Payload bytes, then base64url:
//   [0]      format version (1)
//   [1]      mode: 0 short, 1 full, 2 extreme
//   [2..13]  the 12 scores, left-pole %, x2 (half-point steps, 0..200)
//   [14..49] which of the 288 questions were served, as a bitmap
//   [50..]   the answers (0..4) in question-id order, ten per three bytes
//            (5^10 < 2^24)
import { MODE_KEYS } from './select.js';

export const VERSION = 1;
export const BANK_SIZE = 288;
const BITMAP_BYTES = BANK_SIZE / 8;
const HEAD = 2 + 12 + BITMAP_BYTES;

export function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad characters');
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// result: { mode, scores[12], ids[] (served question ids), answers[] (same order as ids) }
export function encodeResult({ mode, scores, ids, answers }) {
  const pairs = ids.map((id, i) => [id, answers[i]]).sort((a, b) => a[0] - b[0]);
  const groups = Math.ceil(pairs.length / 10);
  const bytes = new Uint8Array(HEAD + groups * 3);
  bytes[0] = VERSION;
  bytes[1] = MODE_KEYS.indexOf(mode);
  scores.forEach((s, i) => { bytes[2 + i] = Math.round(Math.min(100, Math.max(0, s)) * 2); });
  for (const [id] of pairs) bytes[14 + (id >> 3)] |= 1 << (id & 7);
  for (let g = 0; g < groups; g++) {
    let v = 0;
    for (let k = Math.min(10, pairs.length - g * 10) - 1; k >= 0; k--) v = v * 5 + pairs[g * 10 + k][1];
    bytes[HEAD + g * 3] = v & 255;
    bytes[HEAD + g * 3 + 1] = (v >> 8) & 255;
    bytes[HEAD + g * 3 + 2] = (v >> 16) & 255;
  }
  return toBase64Url(bytes);
}

// Returns { mode, scores, ids, answers } with ids ascending, or throws.
export function decodeResult(str) {
  const bytes = fromBase64Url(str);
  if (bytes.length < HEAD || bytes[0] !== VERSION) throw new Error('unknown link format');
  const mode = MODE_KEYS[bytes[1]];
  if (!mode) throw new Error('unknown mode');
  const scores = [];
  for (let i = 0; i < 12; i++) {
    if (bytes[2 + i] > 200) throw new Error('bad score');
    scores.push(bytes[2 + i] / 2);
  }
  const ids = [];
  for (let id = 0; id < BANK_SIZE; id++) if (bytes[14 + (id >> 3)] & (1 << (id & 7))) ids.push(id);
  if (bytes.length !== HEAD + Math.ceil(ids.length / 10) * 3) throw new Error('wrong length');
  const answers = [];
  for (let g = 0; g * 10 < ids.length; g++) {
    let v = bytes[HEAD + g * 3] | (bytes[HEAD + g * 3 + 1] << 8) | (bytes[HEAD + g * 3 + 2] << 16);
    for (let k = 0; k < Math.min(10, ids.length - g * 10); k++) {
      answers.push(v % 5);
      v = Math.floor(v / 5);
    }
    if (v) throw new Error('bad answers');
  }
  return { mode, scores, ids, answers };
}

// The fragment forms: #r=<result> (one result), #c=<result>.<result> (compare).
export function parseHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  let m = /^r=([A-Za-z0-9_-]+)$/.exec(h);
  if (m) return { kind: 'result', a: m[1] };
  m = /^c=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
  if (m) return { kind: 'compare', a: m[1], b: m[2] };
  return null;
}

// Pull the result code out of anything a person might paste: a full link,
// a #r= fragment, or the bare code.
export function extractCode(text) {
  const t = (text || '').trim();
  const m = /[#&]r=([A-Za-z0-9_-]+)/.exec(t) || /^([A-Za-z0-9_-]{20,})$/.exec(t);
  return m ? m[1] : null;
}
