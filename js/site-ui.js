/* The command palette. js/site.js loads this file the first time a visitor asks
   for it, along with js/site-ui.css. All text goes in as text, never as HTML. */
(function () {
  "use strict";

  var Site = window.Site;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /* ---------------------------------------------------------- CONFIRMATION */

  var note = el("div", "site-note");
  note.setAttribute("role", "status");
  document.body.appendChild(note);
  var noteTimer = 0;

  function showNote(text) {
    note.textContent = text;
    note.classList.add("is-on");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      note.classList.remove("is-on");
      note.textContent = "";
    }, 1800);
  }

  /* ---------------------------------------------------------------- SEARCH */

  // Higher is better; -1 is no match. Every query letter has to appear in order.
  // Runs of letters, the start of a word and a shorter title all score higher.
  function fold(value) {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function score(query, target) {
    var text = fold(target);
    var at = text.indexOf(query);
    var total = 0;
    if (at !== -1) total += 60 + (at === 0 || text[at - 1] === " " ? 40 : 0);
    var from = 0, last = -2;
    for (var i = 0; i < query.length; i++) {
      var found = text.indexOf(query[i], from);
      if (found === -1) return -1;
      if (found === last + 1) total += 6;
      if (found === 0 || text[found - 1] === " ") total += 8;
      total -= Math.min(found - from, 8) * 0.5;
      last = found;
      from = found + 1;
    }
    return total - text.length * 0.05;
  }

  function rank(items, rawQuery) {
    var query = fold(rawQuery.trim()).replace(/\s+/g, " ");
    if (!query) return items;
    var scored = [];
    items.forEach(function (item, order) {
      var best = score(query, item.title);
      if (item.keywords) best = Math.max(best, score(query, item.keywords) - 5);
      if (best > -1) scored.push({ item: item, best: best, order: order });
    });
    scored.sort(function (a, b) {
      return b.best - a.best || a.order - b.order;
    });
    return scored.map(function (entry) {
      return entry.item;
    });
  }

  /* ---------------------------------------------------------------- X-RAY */

  var xrayReady = null;

  function toggleXray() {
    if (!xrayReady) {
      xrayReady = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "/js/site-xray.js?v=" + Site.uiVersion;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    xrayReady.then(function () {
      Site.xray.toggle();
    }, function () {
      xrayReady = null;
    });
  }

  /* --------------------------------------------------------------- ACTIONS */

  var indexData = { links: {}, items: [] };

  function copyEmail() {
    var email = indexData.links.email;
    navigator.clipboard.writeText(email).then(function () {
      showNote("Copied");
    }, function () {
      showNote("Could not copy. The address is " + email);
    });
  }

  function actions() {
    var links = indexData.links;
    var list = [];
    if (links.email) list.push({ title: "Copy email address", keywords: "contact mail " + links.email, run: copyEmail });
    if (!Site.isApp) {
      list.push({
        title: Site.currentTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme",
        keywords: "toggle theme light dark mode",
        run: Site.toggleTheme,
      });
    }
    if (links.linkedin) list.push({ title: "Open LinkedIn", url: links.linkedin });
    if (links.github) list.push({ title: "Open GitHub", url: links.github });
    list.push({
      title: Site.xray && Site.xray.isOn() ? "Turn off X-ray mode" : "Turn on X-ray mode",
      keywords: "xray layout grid inspect sliders ink field",
      run: toggleXray,
    });
    list.push({ title: "Show keyboard shortcuts", keywords: "help keys", run: toggleShortcuts });
    list.forEach(function (item) {
      item.group = "Action";
    });
    return list;
  }

  /* --------------------------------------------------------------- PALETTE */

  var dialog = el("dialog", "site-palette");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Search this site");

  var input = el("input", "site-palette-input");
  input.type = "text";
  input.placeholder = "Search pages, games and writing";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search this site");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "site-palette-list");

  var list = el("div", "site-palette-list");
  list.id = "site-palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");

  var empty = el("p", "site-palette-empty", "No matches.");
  empty.hidden = true;
  var count = el("div", "site-sr");
  count.setAttribute("role", "status");

  var panel = el("div", "site-palette-panel");
  panel.append(input, list, empty, count);
  dialog.appendChild(panel);
  document.body.appendChild(dialog);

  var results = [];
  var active = 0;
  var opener = null;

  function setActive(index) {
    if (!results.length) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    active = (index + results.length) % results.length;
    var rows = list.children;
    for (var i = 0; i < rows.length; i++) rows[i].setAttribute("aria-selected", i === active ? "true" : "false");
    input.setAttribute("aria-activedescendant", rows[active].id);
    rows[active].scrollIntoView({ block: "nearest" });
  }

  function render() {
    results = rank(indexData.items.concat(actions()), input.value);
    list.textContent = "";
    results.forEach(function (item, i) {
      var row = el("div", "site-palette-row");
      row.id = "site-palette-row-" + i;
      row.setAttribute("role", "option");
      row.dataset.index = String(i);
      row.append(el("span", "site-palette-title", item.title), el("span", "site-palette-group", item.group));
      list.appendChild(row);
    });
    empty.hidden = results.length > 0;
    list.hidden = results.length === 0;
    count.textContent = results.length === 1 ? "1 result" : results.length + " results";
    setActive(0);
  }

  function run(item) {
    closePalette();
    if (item.run) item.run();
    else Site.goTo(item.url);
  }

  function openPalette() {
    if (dialog.open) return;
    opener = document.activeElement;
    input.value = "";
    render();
    dialog.showModal();
    input.focus();
  }

  function closePalette() {
    if (!dialog.open) return;
    dialog.close();
    if (opener && opener.isConnected && opener.focus) opener.focus();
    opener = null;
  }

  input.addEventListener("input", render);

  // While the palette is open its keys stay inside it, away from the page's own
  // keyboard handlers. Input is the only stop for Tab, which keeps focus here.
  dialog.addEventListener("keydown", function (e) {
    e.stopPropagation();
    var key = e.key.toLowerCase();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "Tab") {
      e.preventDefault();
    } else if (key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      closePalette();
    }
  });
  // Browsers can close a modal dialog on their own, such as with a held Esc.
  dialog.addEventListener("cancel", function (e) {
    e.preventDefault();
    closePalette();
  });

  // The panel fills the dialog's box only where it has content, so a click on the
  // dialog itself is a click on the backdrop.
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) closePalette();
  });
  list.addEventListener("click", function (e) {
    var row = e.target.closest("[role=option]");
    if (row) run(results[Number(row.dataset.index)]);
  });
  list.addEventListener("mousemove", function (e) {
    var row = e.target.closest("[role=option]");
    if (row && Number(row.dataset.index) !== active) setActive(Number(row.dataset.index));
  });

  /* ------------------------------------------------------- SHORTCUTS CARD */

  var SHORTCUTS = [
    [searchKey() + " or /", "Search"],
    ["1", "Work"],
    ["2", "Built"],
    ["3", "Writing"],
    ["4", "Next"],
    ["5", "Off the clock"],
    ["6", "Games"],
    ["H", "Home"],
    ["X", "X-ray mode"],
    ["?", "This list"],
  ];

  function searchKey() {
    return /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd+K" : "Ctrl+K";
  }

  var card = el("dialog", "site-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "site-card-title");
  card.tabIndex = -1;
  var cardTitle = el("h2", "site-card-title", "Keyboard shortcuts");
  cardTitle.id = "site-card-title";
  var cardList = el("dl", "site-card-list");
  SHORTCUTS.forEach(function (row) {
    var line = el("div");
    var key = el("dt");
    key.appendChild(el("kbd", "", row[0]));
    line.append(key, el("dd", "", row[1]));
    cardList.appendChild(line);
  });
  card.append(cardTitle, cardList);
  if (Site.isApp) card.appendChild(el("p", "site-card-note", "Only the search key works on this page, because the game uses the keyboard."));
  document.body.appendChild(card);

  var cardOpener = null;

  function closeShortcuts() {
    if (!card.open) return;
    card.close();
    if (cardOpener && cardOpener.isConnected && cardOpener.focus) cardOpener.focus();
    cardOpener = null;
  }

  function toggleShortcuts() {
    if (card.open) return closeShortcuts();
    cardOpener = document.activeElement;
    card.showModal();
    card.focus();
  }

  card.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      closeShortcuts();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  });
  card.addEventListener("cancel", function (e) {
    e.preventDefault();
    closeShortcuts();
  });
  card.addEventListener("click", function (e) {
    if (e.target === card) {
      var box = card.getBoundingClientRect();
      var inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (!inside) closeShortcuts();
    }
  });

  fetch("/js/site-index.json").then(function (response) {
    if (!response.ok) throw new Error("no index");
    return response.json();
  }).then(function (data) {
    indexData = data;
    if (dialog.open) render();
  }).catch(function () {});

  Site.ui = { openPalette: openPalette, closePalette: closePalette, showNote: showNote, toggleShortcuts: toggleShortcuts, toggleXray: toggleXray };
})();
