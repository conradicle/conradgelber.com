// Small page helpers shared by the reader, the review screen and the match
// simulator.

import { checkAnswer as checkLocal } from './answer.js';
import { checkRemote } from './api.js';

export const $ = (id) => document.getElementById(id);

export function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

export function announce(text) {
  const box = $('announce');
  box.textContent = '';
  setTimeout(() => {
    box.textContent = text;
  }, 30);
}

export const pct = (f) => (f === null || f === undefined ? '-' : `${Math.round(f * 100)}%`);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Build an answerline from its safe HTML using only the emphasis tags. */
export function renderAnswerline(target, html) {
  target.textContent = '';
  const stack = [target];
  for (const part of String(html).split(/(<\/?(?:b|u|i|em|strong)>)/i)) {
    const open = part.match(/^<(b|u|i|em|strong)>$/i);
    const close = part.match(/^<\/(b|u|i|em|strong)>$/i);
    if (open) {
      const e = document.createElement(open[1].toLowerCase());
      stack[stack.length - 1].appendChild(e);
      stack.push(e);
    } else if (close) {
      if (stack.length > 1) stack.pop();
    } else if (part) {
      const t = document.createElement('textarea');
      t.innerHTML = part; // decodes entities only; a textarea never parses tags
      stack[stack.length - 1].appendChild(document.createTextNode(t.value));
    }
  }
}

/** QB Reader's checker first; the local one if it is slow or out of reach. */
export async function judge(answerHtml, given, { remote = true, timeoutMs = 2500 } = {}) {
  if (!given) return { directive: 'reject', by: 'none' };
  if (remote) {
    try {
      const r = await checkRemote(answerHtml, given, timeoutMs);
      return { directive: r.directive, by: 'QB Reader' };
    } catch (e) {
      // fall through
    }
  }
  return { directive: checkLocal(answerHtml, given).directive, by: remote ? 'this page (QB Reader was out of reach)' : 'this page' };
}

export function isTyping(t) {
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
