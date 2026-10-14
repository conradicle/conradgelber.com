// The welcome cable on the front page. Loaded in <head> without defer so the
// first-visit class lands on <html> before the page paints; everything else
// waits for the DOM. The cable is plain HTML in index.html: this file only
// writes the date-time group, types it out once, and opens redacted lines.
(function () {
  'use strict';

  var SEEN_KEY = 'cable-seen';
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var root = document.documentElement;

  // Type the cable only on a first visit, only with motion allowed, and only
  // where the CSS Custom Highlight API can hide characters without touching
  // the text. If storage throws, show the whole cable at once.
  function shouldType() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !window.CSS || !CSS.highlights || typeof Highlight !== 'function') return false;
    try {
      if (window.localStorage.getItem(SEEN_KEY)) return false;
      window.localStorage.setItem(SEEN_KEY, '1');
      return true;
    } catch (e) {
      return false;
    }
  }

  var typing = shouldType();
  if (typing) root.classList.add('cable-anim');

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // Military date-time group in UTC: DDHHMMZ MON YY.
  function dtg(d) {
    return pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z ' +
      MONTHS[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(-2);
  }

  function setDtg() {
    var el = document.getElementById('cable-dtg');
    if (!el) return;
    var now = new Date();
    el.textContent = dtg(now);
    el.setAttribute('datetime', now.toISOString().slice(0, 16) + 'Z');
  }

  function reveal(btn) {
    if (btn.getAttribute('aria-expanded') === 'true') return;
    btn.setAttribute('aria-expanded', 'true');
    btn.removeAttribute('aria-label');
  }

  function setUpRedactions(sheet) {
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
    var buttons = sheet.querySelectorAll('.redact');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.disabled = false;
      btn.addEventListener('click', function (e) { reveal(e.currentTarget); });
      btn.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'mouse' && fine && fine.matches) reveal(e.currentTarget);
      });
    }
  }

  // The typed-out effect. Each block of the cable fades in as the typist
  // reaches it; inside the current block, a highlight range paints the
  // characters not yet typed transparent and a one-character range is the
  // caret. Any key, tap or focus inside the cable finishes it at once.
  function type(sheet) {
    var untyped = new Highlight();
    var caret = new Highlight();
    CSS.highlights.set('cable-untyped', untyped);
    CSS.highlights.set('cable-caret', caret);

    var steps = [];
    var blocks = sheet.children;
    for (var b = 0; b < blocks.length; b++) {
      steps.push({ block: blocks[b] });
      var walker = document.createTreeWalker(blocks[b], NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) {
            if (n.classList.contains('redact')) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          }
          var p = n.parentNode;
          while (p && p !== sheet) {
            if (p.classList && p.classList.contains('redact')) return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      // A redaction button is one step; the text inside it is rejected above.
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        steps.push(n.nodeType === 1 ? { button: n } : { text: n });
      }
    }

    var end = document.createRange();
    end.selectNodeContents(sheet);

    var timer = 0;
    var done = false;
    var s = 0;
    var offset = 0;
    var PER_TICK = 3;
    var TICK = 16;

    // Everything from (node, at) to the end of the cable is untyped. For a
    // button, `at` is null and the untyped part starts just after it.
    function paint(node, at) {
      var rest = document.createRange();
      if (at === null) rest.setStartAfter(node);
      else rest.setStart(node, at);
      rest.setEnd(end.endContainer, end.endOffset);
      untyped.clear();
      untyped.add(rest);
      caret.clear();
      if (at !== null && at < node.nodeValue.length) {
        var c = document.createRange();
        c.setStart(node, at);
        c.setEnd(node, at + 1);
        caret.add(c);
      }
    }

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      CSS.highlights.delete('cable-untyped');
      CSS.highlights.delete('cable-caret');
      root.classList.remove('cable-anim');
      document.removeEventListener('keydown', finish, true);
      document.removeEventListener('visibilitychange', finish);
      sheet.removeEventListener('pointerdown', finish);
      sheet.removeEventListener('focusin', finish);
    }

    function tick() {
      if (done) return;
      if (s >= steps.length) { finish(); return; }
      var step = steps[s];
      if (step.block) {
        step.block.classList.add('cable-on');
        s++;
        timer = setTimeout(tick, s === 1 ? 0 : 90);
        return;
      }
      if (step.button) {
        paint(step.button, null);
        step.button.classList.add('cable-on');
        s++;
        timer = setTimeout(tick, 160);
        return;
      }
      var len = step.text.nodeValue.length;
      offset = Math.min(len, offset + PER_TICK);
      paint(step.text, offset);
      if (offset >= len) { s++; offset = 0; }
      timer = setTimeout(tick, TICK);
    }

    // Hide everything typed so far as untyped before the first tick.
    untyped.add(end);
    document.addEventListener('keydown', finish, true);
    document.addEventListener('visibilitychange', finish);
    sheet.addEventListener('pointerdown', finish);
    sheet.addEventListener('focusin', finish);
    // A safety net: never leave the cable hidden if something goes wrong.
    setTimeout(finish, 15000);
    timer = setTimeout(tick, 250);
  }

  function init() {
    setDtg();
    var sheet = document.getElementById('cable-sheet');
    if (!sheet) { root.classList.remove('cable-anim'); return; }
    setUpRedactions(sheet);
    if (!typing) return;
    try {
      type(sheet);
    } catch (e) {
      root.classList.remove('cable-anim');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
