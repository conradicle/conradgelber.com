/* Runs on every public page. Loaded in <head> with no defer on purpose: it has to
   run before the first paint. Everything a visitor has to summon lives in other
   files that load on demand, so this one stays small. */
(function () {
  "use strict";

  // Game pages and other full-screen apps mark their script tag with data-app.
  // They draw with their own colors, so they stay in the light theme.
  var IS_APP = document.currentScript.hasAttribute("data-app");
  var UI_VERSION = "1";

  /* --------------------------------------------------------------- THEME
     The site is light unless a visitor picks dark from the command palette. */

  var THEME_KEY = "site-theme";

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (err) {
      return null;
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {}
    document.dispatchEvent(new Event("site:theme"));
  }

  if (!IS_APP && storedTheme() === "dark") document.documentElement.setAttribute("data-theme", "dark");

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

  function goTo(url) {
    finishRunningTransition();
    location.assign(url);
  }

  /* ------------------------------------------------- THINGS LOADED ON DEMAND */

  var uiReady = null;

  function loadUI() {
    if (uiReady) return uiReady;
    uiReady = new Promise(function (resolve, reject) {
      var style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = "/js/site-ui.css?v=" + UI_VERSION;
      var script = document.createElement("script");
      script.src = "/js/site-ui.js?v=" + UI_VERSION;
      var pending = 2;
      function done() {
        if (--pending === 0) resolve(window.Site.ui);
      }
      style.onload = script.onload = done;
      style.onerror = script.onerror = function () {
        uiReady = null;
        reject(new Error("site-ui did not load"));
      };
      document.head.appendChild(style);
      document.head.appendChild(script);
    });
    return uiReady;
  }

  function withUI(use) {
    loadUI().then(use, function () {});
  }

  /* ---------------------------------------------------------------- KEYS */

  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

  function typingIn(el) {
    if (!el) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(textbox|combobox|searchbox)$/.test(el.getAttribute("role") || "");
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.isComposing || e.repeat || typingIn(e.target)) return;
    var key = e.key.toLowerCase();

    var paletteCombo = key === "k" && !e.shiftKey && !e.altKey && (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
    var slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (paletteCombo || slash) {
      e.preventDefault();
      withUI(function (ui) {
        ui.openPalette();
      });
    }
  });

  window.Site = { isApp: IS_APP, currentTheme: currentTheme, toggleTheme: toggleTheme, goTo: goTo };
})();
