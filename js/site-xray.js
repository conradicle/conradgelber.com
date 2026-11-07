/* X-ray mode: the layout grid, a size label on each major element and, on the front
   page, live sliders for the ink field. Loaded on demand from js/site-ui.js. Nothing
   here is saved, so a new page or a reload starts with it off. */
(function () {
  "use strict";

  var Site = window.Site;

  // Largest first, so the label list keeps the structure if it hits the limit.
  var MAJOR = "header, nav, main, footer, .hero, .inkfield, .mast-grid, .portrait img, .stamp, section, .intro, .prose, h1, .standfirst, h2, h3, .entry, .paper";
  var MAX_LABELS = 150;
  var LABEL_HEIGHT = 14;
  var MAIN_SLIDERS = [
    { label: "Particle count", key: null, min: 1000, max: 200000, step: 1000 },
    { label: "Current speed", key: "FLOW_SPEED", min: 0.002, max: 0.3, step: 0.002 },
    { label: "Noise scale", key: "FIELD_SCALE", min: 100, max: 1400, step: 10 },
    { label: "Cursor strength", key: "CURSOR_STRENGTH", min: 0, max: 4, step: 0.02 },
  ];

  var on = false;
  var overlay, exitButton, panel, announcer, observer;
  var measurePending = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------- GRID AND LABELS */

  function line(x, top, height, kind) {
    var node = el("div", "site-xray-line" + (kind ? " " + kind : ""));
    node.style.left = Math.round(x) + "px";
    node.style.top = Math.round(top) + "px";
    node.style.height = Math.round(height) + "px";
    overlay.appendChild(node);
  }

  function band(left, width) {
    var node = el("div", "site-xray-margin");
    node.style.left = Math.round(left) + "px";
    node.style.width = Math.round(width) + "px";
    overlay.appendChild(node);
  }

  function pageBox(node) {
    var r = node.getBoundingClientRect();
    return { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY, width: r.width, height: r.height };
  }

  function drawGrid(pageHeight) {
    var wrap = document.querySelector(".wrap");
    var viewWidth = document.documentElement.clientWidth;
    if (wrap) {
      var box = pageBox(wrap);
      var cs = getComputedStyle(wrap);
      var contentLeft = box.left + parseFloat(cs.paddingLeft);
      var contentRight = box.right - parseFloat(cs.paddingRight);
      band(0, contentLeft);
      band(contentRight, viewWidth - contentRight);
      line(contentLeft, 0, pageHeight);
      line(contentRight, 0, pageHeight);
      if (box.left > 0) {
        line(box.left, 0, pageHeight, "is-soft");
        line(box.right, 0, pageHeight, "is-soft");
      }
    }
    // The columns of any CSS grid on the page.
    document.querySelectorAll(".mast-grid, .entry").forEach(function (grid) {
      var tracks = getComputedStyle(grid).gridTemplateColumns.split(" ").map(parseFloat);
      if (tracks.length < 2) return;
      var gridBox = pageBox(grid);
      var gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      var x = gridBox.left;
      for (var i = 0; i < tracks.length - 1; i++) {
        x += tracks[i];
        line(x, gridBox.top, gridBox.height, "is-soft");
        line(x + gap, gridBox.top, gridBox.height, "is-soft");
        x += gap;
      }
    });
  }

  function labelText(node) {
    var name = node.tagName.toLowerCase();
    var first = node.classList[0];
    var r = node.getBoundingClientRect();
    return name + (first ? "." + first : "") + " " + Math.round(r.width) + "x" + Math.round(r.height);
  }

  function drawLabels() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(MAJOR)).slice(0, MAX_LABELS);
    var placed = [];
    nodes.forEach(function (node) {
      if (node.closest(".site-xray-panel, .site-palette, .site-card")) return;
      var box = pageBox(node);
      if (box.width < 1 || box.height < 1) return;
      var outline = el("div", "site-xray-box");
      outline.style.left = box.left + "px";
      outline.style.top = box.top + "px";
      outline.style.width = box.width + "px";
      outline.style.height = box.height + "px";
      var label = el("span", "site-xray-label", labelText(node));
      // Sits on the box's top edge, clear of its text, and steps down past any
      // label already there.
      var width = label.textContent.length * 6.4 + 6;
      var top = Math.max(0, box.top - LABEL_HEIGHT);
      var clash = true;
      while (clash) {
        clash = false;
        for (var i = 0; i < placed.length; i++) {
          var other = placed[i];
          if (Math.abs(other.top - top) < LABEL_HEIGHT && box.left < other.left + other.width && other.left < box.left + width) {
            top = other.top + LABEL_HEIGHT;
            clash = true;
            break;
          }
        }
      }
      placed.push({ left: box.left, top: top, width: width });
      label.style.left = box.left + "px";
      label.style.top = top + "px";
      overlay.append(outline, label);
    });
  }

  function measure() {
    measurePending = 0;
    if (!on) return;
    overlay.textContent = "";
    overlay.style.height = "0";
    var pageHeight = document.documentElement.scrollHeight;
    overlay.style.height = pageHeight + "px";
    drawGrid(pageHeight);
    drawLabels();
  }

  function scheduleMeasure() {
    if (on && !measurePending) measurePending = requestAnimationFrame(measure);
  }

  /* ------------------------------------------------------- INK FIELD PANEL */

  function words(key) {
    var text = key.toLowerCase().replace(/_/g, " ");
    return text[0].toUpperCase() + text.slice(1);
  }

  function neat(value) {
    return String(Number(value.toFixed(5)));
  }

  // A range from a setting's default: a tenth of it up to three times it. Shares
  // stop at 1 and values that can go negative get a range around zero.
  function rangeFor(key, start) {
    if (Number.isInteger(start)) {
      var top = /OCTAVES/.test(key) ? 6 : Math.max(start * 3, 2);
      return { min: 1, max: top, step: Math.max(1, Math.round(start / 100)) };
    }
    if (/^DRIFT_/.test(key)) return { min: -Math.abs(start) * 5, max: Math.abs(start) * 5, step: Math.abs(start) / 20 };
    var max = /OPACITY|TINT|WASH|QUIET$|SHARE|LANDING|RENDER_SCALE/.test(key) ? 1 : start * 3;
    var min = start / 10;
    return { min: min, max: max, step: (max - min) / 100 };
  }

  function sliderRow(label, key, range, ink) {
    var row = el("div", "site-xray-row");
    var id = "site-xray-" + key.toLowerCase();
    var title = el("label", "", label);
    title.htmlFor = id;
    var value = el("output", "site-xray-value", neat(ink.config[key]));
    value.htmlFor = id;
    var input = el("input");
    input.type = "range";
    input.id = id;
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(ink.config[key]);
    input.addEventListener("input", function () {
      var next = Number(input.value);
      value.textContent = neat(next);
      ink.set(key, next);
    });
    row.append(title, value, input);
    return row;
  }

  function buildPanel(ink) {
    var box = el("section", "site-xray-panel");
    box.setAttribute("aria-label", "Ink field settings");
    box.appendChild(el("h2", "site-xray-title", "Ink field"));

    var countKey = innerWidth < ink.config.SMALL_SCREEN_WIDTH ? "PARTICLE_COUNT_SMALL" : "PARTICLE_COUNT";
    var mainKeys = [];
    MAIN_SLIDERS.forEach(function (slider) {
      var key = slider.key || countKey;
      mainKeys.push(key);
      box.appendChild(sliderRow(slider.label, key, slider, ink));
    });

    Object.keys(ink.groups).forEach(function (name) {
      var keys = ink.groups[name].filter(function (key) {
        return mainKeys.indexOf(key) === -1 && key !== "PARTICLE_COUNT" && key !== "PARTICLE_COUNT_SMALL";
      });
      if (!keys.length) return;
      var details = el("details", "site-xray-group");
      details.appendChild(el("summary", "", name));
      keys.forEach(function (key) {
        details.appendChild(sliderRow(words(key), key, rangeFor(key, ink.config[key]), ink));
      });
      if (name === "The name in particles") {
        var replay = el("button", "site-xray-button", "Replay the opening");
        replay.type = "button";
        replay.addEventListener("click", ink.replayIntro);
        details.appendChild(replay);
      }
      box.appendChild(details);
    });
    return box;
  }

  /* ------------------------------------------------------------ ON AND OFF */

  function turnOn() {
    if (on) return;
    on = true;
    overlay = el("div", "site-xray");
    overlay.setAttribute("aria-hidden", "true");
    exitButton = el("button", "site-xray-exit", "Exit X-ray");
    exitButton.type = "button";
    exitButton.addEventListener("click", turnOff);
    announcer = el("div", "site-sr");
    announcer.setAttribute("role", "status");
    document.body.append(overlay, announcer);

    // window.inkfield is the canvas itself (by its id) if the ink field never started.
    var ink = window.inkfield;
    if (ink && ink.isLive && ink.isLive()) {
      panel = buildPanel(ink);
      document.body.appendChild(panel);
    }
    document.body.appendChild(exitButton);

    measure();
    observer = new ResizeObserver(scheduleMeasure);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    addEventListener("resize", scheduleMeasure);
    document.addEventListener("keydown", onKey);
    announcer.textContent = "X-ray mode on. Press Escape to exit.";
  }

  function turnOff() {
    if (!on) return;
    on = false;
    var hadFocus = (panel && panel.contains(document.activeElement)) || document.activeElement === exitButton;
    observer.disconnect();
    removeEventListener("resize", scheduleMeasure);
    document.removeEventListener("keydown", onKey);
    [overlay, exitButton, panel, announcer].forEach(function (node) {
      if (node) node.remove();
    });
    panel = null;
    if (hadFocus) document.body.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      turnOff();
    }
  }

  Site.xray = {
    isOn: function () {
      return on;
    },
    toggle: function () {
      if (on) turnOff();
      else turnOn();
    },
  };
})();
