// The starter deck page: every AI-written starter card on one screen, to
// check, edit or delete. Changes are kept on this device as fixes keyed by
// card id (KEYS.deckFixes), applied to cards already in review and to the
// deck when it is added later, and can be downloaded to correct the deck file.

import { KEYS, readJSON, writeJSON } from './store.js';
import { $, show, announce, el, plural } from './ui.js';

export const STARTER_URL = '/historybowl/data/decks/starter.json?v=1';

export function loadDeckFixes(storage) {
  const v = readJSON(storage, KEYS.deckFixes, {});
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [id, f] of Object.entries(v)) {
    if (!f || typeof f !== 'object') continue;
    const clean = {};
    if (typeof f.front === 'string' && f.front.trim()) clean.front = f.front.slice(0, 1000);
    if (typeof f.back === 'string' && f.back.trim()) clean.back = f.back.slice(0, 300);
    if (f.deleted === true) clean.deleted = true;
    if (Object.keys(clean).length) out[id] = clean;
  }
  return out;
}

/** The deck's cards with this device's fixes applied (deleted ones left out unless asked for). */
export function applyDeckFixes(deckCards, fixes, { keepDeleted = false } = {}) {
  return deckCards
    .map((c) => ({ ...c, ...(fixes[c.id] || {}), edited: Boolean(fixes[c.id] && (fixes[c.id].front || fixes[c.id].back)) }))
    .filter((c) => keepDeleted || !c.deleted);
}

export function initDeck(ctx) {
  // ctx: { storage, cards(), setCards(list), back() }
  let deck = null;
  let fixes = loadDeckFixes(ctx.storage);

  async function getDeck() {
    if (deck) return deck;
    const res = await fetch(STARTER_URL);
    if (!res.ok) throw new Error(String(res.status));
    deck = await res.json();
    return deck;
  }

  function saveFixes() {
    writeJSON(ctx.storage, KEYS.deckFixes, fixes);
  }

  /** Change the copy in review, if the deck has been added. */
  function updateLocal(id, patch) {
    const cards = ctx.cards();
    const i = cards.findIndex((c) => c.id === id);
    if (i < 0) return false;
    cards[i] = { ...cards[i], ...patch };
    ctx.setCards(cards);
    return true;
  }

  function render() {
    const list = $('deck-list');
    list.textContent = '';
    const rows = applyDeckFixes(deck.cards, fixes, { keepDeleted: true });
    const added = ctx.cards().some((c) => c.deck === 'starter');
    const edited = rows.filter((c) => c.edited).length;
    const deleted = rows.filter((c) => c.deleted).length;
    $('deck-summary').textContent = `${plural(rows.length, 'card')}${edited ? `, ${edited} edited` : ''}${deleted ? `, ${deleted} deleted` : ''}. ${added ? 'The deck is in your review.' : 'The deck is not in your review yet; changes apply when you add it.'}`;
    rows.forEach((c, i) => list.append(row(c, i)));
    $('deck-download').disabled = !edited && !deleted;
  }

  function row(c, i) {
    const li = el('li', 'deck-row' + (c.deleted ? ' deleted' : ''));
    li.dataset.id = c.id;
    const head = el('p', 'deck-head');
    head.append(el('span', 'deck-num', `${i + 1}.`), el('span', 'deck-tags', `${c.sub}${c.edited ? ' \u00b7 edited' : ''}${c.deleted ? ' \u00b7 deleted' : ''}`));
    li.append(head, el('p', 'deck-front', c.front), el('p', 'deck-back', c.back));
    const actions = el('div', 'deck-actions');
    if (c.deleted) {
      const undo = el('button', 'btn btn-quiet btn-small', 'Undo delete');
      undo.type = 'button';
      undo.addEventListener('click', () => restore(c.id));
      actions.append(undo);
    } else {
      const edit = el('button', 'btn btn-quiet btn-small', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit card ${i + 1}`);
      edit.addEventListener('click', () => openEdit(li, c));
      const del = el('button', 'btn btn-quiet btn-small', 'Delete');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete card ${i + 1}`);
      del.addEventListener('click', () => {
        // Two taps, so a stray one does not lose a card.
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1';
          del.textContent = 'Tap again to delete';
          return;
        }
        remove(c.id);
      });
      actions.append(edit, del);
    }
    li.append(actions);
    return li;
  }

  function openEdit(li, c) {
    const form = el('form', 'deck-edit');
    const fl = el('label', null, 'Front');
    const front = el('textarea');
    front.rows = 3;
    front.maxLength = 1000;
    front.value = c.front;
    front.id = `deck-front-${c.id}`;
    fl.htmlFor = front.id;
    const bl = el('label', null, 'Back');
    const back = el('input');
    back.type = 'text';
    back.maxLength = 300;
    back.value = c.back;
    back.id = `deck-back-${c.id}`;
    bl.htmlFor = back.id;
    const save = el('button', 'btn btn-lamp btn-small', 'Save');
    save.type = 'submit';
    const cancel = el('button', 'btn btn-quiet btn-small', 'Cancel');
    cancel.type = 'button';
    const acts = el('div', 'end-actions');
    acts.append(save, cancel);
    form.append(fl, front, bl, back, acts);
    li.querySelector('.deck-actions').replaceWith(form);
    front.focus();
    cancel.addEventListener('click', render);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = front.value.trim();
      const b = back.value.trim();
      if (!f || !b) {
        $('deck-status').textContent = 'A card needs a front and a back.';
        return;
      }
      const original = deck.cards.find((x) => x.id === c.id);
      const fix = { ...(fixes[c.id] || {}) };
      if (f !== original.front) fix.front = f;
      else delete fix.front;
      if (b !== original.back) fix.back = b;
      else delete fix.back;
      if (Object.keys(fix).length) fixes[c.id] = fix;
      else delete fixes[c.id];
      saveFixes();
      updateLocal(c.id, { front: f, back: b });
      $('deck-status').textContent = 'Saved.';
      render();
      focusRow(c.id, 'Edit');
    });
  }

  function remove(id) {
    fixes[id] = { ...(fixes[id] || {}), deleted: true };
    saveFixes();
    ctx.setCards(ctx.cards().filter((c) => c.id !== id));
    $('deck-status').textContent = 'Card deleted. Undo is on its row.';
    render();
    focusRow(id, 'Undo delete');
  }

  function restore(id) {
    const fix = { ...(fixes[id] || {}) };
    delete fix.deleted;
    if (Object.keys(fix).length) fixes[id] = fix;
    else delete fixes[id];
    saveFixes();
    // Back into review as a new card, if the deck is in review.
    const cards = ctx.cards();
    if (cards.some((c) => c.deck === 'starter') && !cards.some((c) => c.id === id)) {
      const c = applyDeckFixes(deck.cards.filter((x) => x.id === id), fixes)[0];
      cards.push({ id: c.id, front: c.front, back: c.back, qid: null, src: 'ai', cat: c.cat, sub: c.sub, era: c.era, created: Date.now(), fsrs: null, deck: 'starter', fx: [] });
      ctx.setCards(cards);
    }
    $('deck-status').textContent = 'Card restored.';
    render();
    focusRow(id, 'Edit');
  }

  function focusRow(id, label) {
    const li = $('deck-list').querySelector(`[data-id="${id}"]`);
    const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent === label);
    if (b) b.focus();
  }

  function download() {
    const changes = deck.cards.filter((c) => fixes[c.id]).map((c) => ({ id: c.id, was: { front: c.front, back: c.back }, ...fixes[c.id] }));
    const blob = new Blob([JSON.stringify({ deck: deck.id, changes }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historybowl-starter-deck-changes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('deck-status').textContent = `Downloaded ${plural(changes.length, 'change')}.`;
  }

  $('deck-download').addEventListener('click', download);
  $('deck-back').addEventListener('click', () => ctx.back());

  return {
    async open() {
      show('screen-deck');
      $('deck-title').focus({ preventScroll: true });
      $('deck-status').textContent = 'Loading...';
      try {
        await getDeck();
        fixes = loadDeckFixes(ctx.storage);
        $('deck-status').textContent = '';
        render();
        announce($('deck-summary').textContent);
      } catch (e) {
        $('deck-status').textContent = 'Could not load the deck. Check your connection and try again.';
      }
    },
    fixes: () => loadDeckFixes(ctx.storage),
  };
}
