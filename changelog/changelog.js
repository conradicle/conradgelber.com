// Renders /changelog.json, newest first. Entries go in as text, never as HTML.
(function () {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Read the date as written: new Date("2026-10-30") is UTC midnight, which
  // shows as the day before in Miami.
  function formatDate(iso) {
    var parts = iso.split("-");
    return MONTHS[Number(parts[1]) - 1] + " " + Number(parts[2]) + ", " + parts[0];
  }

  function compareVersions(a, b) {
    var x = a.version.split(".").map(Number);
    var y = b.version.split(".").map(Number);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderEntry(entry) {
    var row = el("div", "entry");

    var when = el("div", "when");
    var time = el("time", "", formatDate(entry.date));
    time.dateTime = entry.date;
    when.appendChild(time);
    row.appendChild(when);

    var what = el("div", "what");
    what.appendChild(el("h2", "", entry.title));
    what.appendChild(el("p", "role", "v" + entry.version));
    var list = el("ul");
    entry.bullets.forEach(function (bullet) {
      list.appendChild(el("li", "", bullet));
    });
    what.appendChild(list);
    row.appendChild(what);

    return row;
  }

  var status = document.getElementById("changelog-status");
  var target = document.getElementById("changelog");

  // no-cache: always check for a newer file, whatever the browser has kept.
  fetch("/changelog.json", { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (entries) {
      entries.slice().sort(compareVersions).forEach(function (entry) {
        target.appendChild(renderEntry(entry));
      });
      status.textContent = "";
    })
    .catch(function () {
      status.textContent = "The changelog could not be loaded. Please try again later.";
    });
})();
