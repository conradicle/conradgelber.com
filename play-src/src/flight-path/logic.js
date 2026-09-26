// Flight Path game rules, kept free of the DOM so the tests can run them in
// Node: reading routes.json, difficulty bands, type-ahead suggestions,
// judging guesses and picking routes.

import { SOVEREIGN, DISPUTED, disputedNote, buildLookup, normalize, ALIASES } from '../../lib/countries.mjs';

const EARTH_KM = 6371;

export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const BANDS = {
  short: { label: 'Short', test: (km) => km < 3000 },
  medium: { label: 'Medium', test: (km) => km >= 3000 && km <= 8000 },
  long: { label: 'Long', test: (km) => km > 8000 },
};

export function bandOf(km) {
  return Object.keys(BANDS).find((b) => BANDS[b].test(km));
}

// routes.json -> { countries, points, cities, routes } with names in place
// of indexes.
export function parseData(json) {
  const countries = json.countries;
  const cities = json.cities.map(([name, c, lat, lon]) => ({ name, country: countries[c], lat, lon }));
  const points = {};
  for (const [i, p] of Object.entries(json.points || {})) points[countries[i]] = p;
  const routes = json.routes.map(([i, j, list, crimea], id) => {
    const from = cities[i];
    const to = cities[j];
    const km = distanceKm([from.lon, from.lat], [to.lon, to.lat]);
    return { id, from, to, km, band: bandOf(km), countries: list.map((c) => countries[c]), crimea: crimea === 1 };
  });
  return { countries, points, cities, routes };
}

// ---------- guesses ----------

// Every name and alias the type-ahead offers, with the country it stands for.
export function suggestionIndex(countries) {
  const out = [];
  for (const name of countries) out.push({ label: name, name, key: normalize(name) });
  for (const [name, aliases] of Object.entries(ALIASES)) {
    if (!countries.includes(name)) continue;
    for (const a of aliases) {
      const key = normalize(a);
      if (key.length > 2 && !out.some((o) => o.key === key && o.name === name)) {
        out.push({ label: `${name} (${a})`, name, key });
      }
    }
  }
  return out;
}

// Up to `max` suggestions for what the player has typed, one row per
// country: names that start with it first ("gu": Guam, Guatemala), then
// names with a word that starts with it (Equatorial Guinea), then names
// that contain it anywhere.
export function suggest(index, text, max = 8, skip = new Set()) {
  const q = normalize(text);
  if (!q) return [];
  const starts = [];
  const words = [];
  const inside = [];
  for (const s of index) {
    if (skip.has(s.name)) continue;
    const at = s.key.indexOf(q);
    if (at === 0) starts.push(s);
    else if (s.key.includes(' ' + q)) words.push(s);
    else if (at > 0) inside.push(s);
  }
  const seen = new Set();
  const out = [];
  for (const s of [...starts, ...words, ...inside]) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    // Show the plain name when the country itself matched.
    out.push(normalize(s.name).includes(q) ? { label: s.name, name: s.name } : s);
    if (out.length === max) break;
  }
  return out;
}

export function createRound(route) {
  return { route, found: [], wrong: [], notes: [] };
}

// Judge one guess. Returns { kind, name, note } where kind is one of
//   found     a country on the route, newly found
//   already   found before
//   wrong     not on the route (counted once per country)
//   repeat    a wrong guess made before, not counted again
//   neutral   the claimant of a disputed place on the route; neither
//   endpoint  the origin or destination country; neither
//   unknown   not a country the game knows
export function judge(round, lookup, text) {
  const names = lookup.get(normalize(text));
  if (!names) return { kind: 'unknown', name: text.trim() };
  const { route } = round;
  const onRoute = (n) => route.countries.includes(n);
  const isFound = (n) => round.found.includes(n);

  const direct = names.find((n) => onRoute(n) && !isFound(n));
  if (direct) {
    round.found.push(direct);
    return { kind: 'found', name: direct };
  }
  // Naming the sovereign counts for its territory when only the territory
  // is on the route (Denmark for Greenland).
  const territories = Object.keys(SOVEREIGN).filter((t) => names.includes(SOVEREIGN[t]));
  const territory = territories.find((t) => onRoute(t) && !isFound(t));
  if (territory) {
    round.found.push(territory);
    return { kind: 'found', name: territory, via: names[0] };
  }
  const done = names.find(isFound) || territories.find(isFound);
  if (done) return { kind: 'already', name: done };

  for (const [place, claimant] of Object.entries(DISPUTED)) {
    const crossed = place === 'Crimea' ? route.crimea : onRoute(place);
    if (crossed && names.includes(claimant) && !onRoute(claimant)) {
      const note = disputedNote(place);
      if (!round.notes.includes(note)) round.notes.push(note);
      return { kind: 'neutral', name: claimant, note };
    }
  }
  const end = names.find((n) => n === route.from.country || n === route.to.country);
  if (end) return { kind: 'endpoint', name: end };

  const name = names[0];
  if (round.wrong.includes(name)) return { kind: 'repeat', name };
  round.wrong.push(name);
  return { kind: 'wrong', name };
}

export function isComplete(round) {
  return round.route.countries.every((c) => round.found.includes(c));
}

export { buildLookup };

// Random choice from the routes in `band`, skipping recently played ones
// while there are others left. `weight` (route -> number) tilts the odds.
export function pickRoute(routes, band, { recent = [], weight = () => 1, rand = Math.random } = {}) {
  let pool = routes.filter((r) => r.band === band && !recent.includes(r.id));
  if (!pool.length) pool = routes.filter((r) => r.band === band);
  const weights = pool.map(weight);
  let x = rand() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
