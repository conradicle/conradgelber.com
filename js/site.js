/* Runs on every public page. Loaded in <head> with no defer on purpose: it has to
   run before the first paint. Everything a visitor has to summon lives in other
   files that load on demand, so this one stays small. */
(function () {
  "use strict";

  // Game pages and other full-screen apps mark their script tag with data-app.
  // This flag keeps single-key site shortcuts out of interactive apps.
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

  if (storedTheme() === "dark") document.documentElement.setAttribute("data-theme", "dark");

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

  // A transition can be dropped for ordinary reasons, like a slow page. The
  // navigation still works, so that is not worth an error in the console.
  function ignoreDropped(transition) {
    function ignore() {}
    transition.ready.catch(ignore);
    transition.updateCallbackDone.catch(ignore);
    transition.finished.catch(ignore);
  }

  window.addEventListener("pagereveal", function (e) {
    if (e.viewTransition) ignoreDropped(e.viewTransition);
  });

  window.addEventListener("pageswap", function (e) {
    finishRunningTransition();
    if (!e.viewTransition) return;
    ignoreDropped(e.viewTransition);
    if (cutShortRecently()) e.viewTransition.skipTransition();
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
  var GO = {
    h: "/",
    1: "/work/",
    2: "/built/",
    3: "/writing/",
    4: "/next/",
    5: "/off-the-clock/",
    6: "/games/",
  };

  function typingIn(el) {
    if (!el || !el.getAttribute) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(textbox|combobox|searchbox)$/.test(el.getAttribute("role") || "");
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.isComposing || e.repeat || typingIn(e.target)) return;
    var key = e.key.toLowerCase();

    var paletteCombo = key === "k" && !e.shiftKey && !e.altKey && (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
    if (paletteCombo) {
      e.preventDefault();
      withUI(function (ui) {
        ui.openPalette();
      });
      return;
    }

    // Single keys are off on game pages, where the game may use them.
    if (IS_APP || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "?") {
      e.preventDefault();
      withUI(function (ui) {
        ui.toggleShortcuts();
      });
      return;
    }
    if (e.shiftKey) return;

    if (e.key === "/") {
      e.preventDefault();
      withUI(function (ui) {
        ui.openPalette();
      });
    } else if (key === "x") {
      e.preventDefault();
      withUI(function (ui) {
        ui.toggleXray();
      });
    } else if (GO[key]) {
      e.preventDefault();
      goTo(GO[key]);
    }
  });

  /* ---------------------------------------------------- CHANGELOG FRESHNESS
     scripts/build-site-index.mjs writes the next line from /changelog.json. With
     no JS the footer link simply reads "Changelog". Phone widths keep that too,
     so the footer doesn't wrap differently there. */

  var LAST_UPDATED = "2026-11-07T18:49:00-05:00";
  var FRESHNESS_WIDTH = "(min-width: 641px)";

  function plural(count, unit) {
    return count + " " + unit + (count === 1 ? "" : "s") + " ago";
  }

  function timeSince(iso) {
    var hours = Math.max(0, Date.now() - new Date(iso).getTime()) / 3600000;
    if (hours < 1) return "under an hour ago";
    if (hours < 24) return plural(Math.floor(hours), "hour");
    var days = hours / 24;
    if (days < 30) return plural(Math.floor(days), "day");
    if (days < 365) return plural(Math.floor(days / 30), "month");
    return plural(Math.floor(days / 365), "year");
  }

  function showFreshness() {
    var wide = window.matchMedia(FRESHNESS_WIDTH).matches;
    document.querySelectorAll('footer a[href="/changelog/"]').forEach(function (link) {
      link.textContent = wide ? "Changelog, updated " + timeSince(LAST_UPDATED) : "Changelog";
    });
  }

  /* ------------------------------------------------------------ CONSOLE NOTE
     For anyone who opens DevTools. The only thing this site prints. */

  function printConsoleNote() {
    console.log(
      "%cHi, I'm Conrad Gelber.%c\nI built this site by hand: plain HTML, CSS and JavaScript, no framework.\n\n" +
        "Hidden shortcuts:\n  Cmd/Ctrl+K  search\n  1 to 6      tabs\n  H           home\n  X           X-ray mode\n  ?           list of shortcuts\n\n" +
        "Source: https://github.com/conradicle/conradgelber.com",
      "font:600 15px Georgia,serif;color:#14675E",
      "font:12px/1.5 ui-monospace,Menlo,Consolas,monospace"
    );
  }

  /* ---------------------------------------------------------- ON PAGE READY */

  function whenShown(run) {
    if (document.prerendering) document.addEventListener("prerenderingchange", run, { once: true });
    else run();
  }

  function pageReady() {
    showFreshness();
    window.matchMedia(FRESHNESS_WIDTH).addEventListener("change", showFreshness);
    whenShown(showFreshness);
    whenShown(printConsoleNote);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pageReady);
  else pageReady();

  window.Site = { isApp: IS_APP, uiVersion: UI_VERSION, currentTheme: currentTheme, toggleTheme: toggleTheme, goTo: goTo };
})();
