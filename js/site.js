/* Runs on every public page. Loaded in <head> with no defer on purpose: it has to
   run before the first paint. Everything a visitor has to summon lives in other
   files that load on demand, so this one stays small. */
(function () {
  "use strict";

  /* ---------------------------------------------------- PAGE TRANSITIONS
     style.css turns on cross-document view transitions. If a visitor navigates
     again while one is running, it is finished on the spot and the next page
     swaps in with no transition, so rapid clicks can't stack or stutter.
     While a transition runs, the page underneath can't be hit-tested, so a press
     ends it and the click that follows is passed to the link under the pointer. */

  var cutShortAt = -Infinity;

  function finishRunningTransition() {
    var found = false;
    document.getAnimations().forEach(function (animation) {
      var pseudo = animation.effect && animation.effect.pseudoElement;
      if (pseudo && pseudo.indexOf("::view-transition") === 0) {
        found = true;
        animation.finish();
      }
    });
    if (found) cutShortAt = performance.now();
    return found;
  }

  function cutShortRecently() {
    return performance.now() - cutShortAt < 1500;
  }

  document.addEventListener("pointerdown", finishRunningTransition, true);

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target !== document.documentElement || !cutShortRecently()) return;
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var link = under && under.closest("a[href]");
    if (link) link.click();
  }, true);

  window.addEventListener("pageswap", function (e) {
    finishRunningTransition();
    if (e.viewTransition && cutShortRecently()) e.viewTransition.skipTransition();
  });
})();
