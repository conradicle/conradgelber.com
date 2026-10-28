# Deploying conradgelber.com

Static site, no build step on deploy. Cloudflare Pages serves the repo root
as-is. The one dynamic part is the private hub (`/login/`, `/hub/`), which
runs as Pages Functions from `functions/`; see [The private hub](#the-private-hub). The generated files (`play/play.js`, `flight-path/flight-path.js`,
`flight-path/routes.json`, `pool/pool.js`, `borderline/borderline.js`,
`borderline/data/` and `historybowl/historybowl.js`) are built locally and
committed; see
[The /play/ game](#the-play-game),
[The /flight-path/ game](#the-flight-path-game),
[The /borderline/ game](#the-borderline-game),
[The /pool/ game](#the-pool-game) and
[The /historybowl/ page](#the-historybowl-page) below. Pool's online rooms
and History Bowl Study's question API are separate Workers, deployed by
hand from `pool-worker/` and `historybowl-worker/`.

## 1. Push the repo

Create an empty public GitHub repo at <https://github.com/new> named
`conradgelber.com` under `conradicle` (no README, no .gitignore, no licence:
the repo already has its history). Then:

```bash
git remote add origin https://github.com/conradicle/conradgelber.com.git
git push -u origin main
```

## 2. Create the Pages project

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick the repo.

| Setting                | Value                     |
| ---------------------- | ------------------------- |
| Production branch      | `main`                    |
| Framework preset       | None                      |
| Build command          | *(leave blank)*           |
| Build output directory | `/`                       |
| Root directory         | *(leave blank)*           |

**Save and Deploy.** The first build takes under a minute and lands on
`<project>.pages.dev`. Check that page before attaching the domain.

## 3. Attach the custom domains

Pages project → **Custom domains** → **Set up a custom domain**.

1. Enter `conradgelber.com` → **Continue** → **Activate domain**.
   The zone is already on Cloudflare, so it creates the (flattened) CNAME
   record for you. No manual DNS.
2. Repeat for `www.conradgelber.com`.

Both hostnames go active once the certificate issues, usually within a few
minutes. www does not serve a duplicate: a **zone-level Redirect Rule**
(Cloudflare dashboard -> conradgelber.com -> Rules -> Redirect Rules) 301s
every `www.conradgelber.com` request to the same path on the apex, and
`<link rel="canonical">` points at the apex as well.

This cannot be done with a Pages `_redirects` file: the source of a
`_redirects` rule must be a relative path, so cross-hostname redirects are
rejected at build time with "Only relative URLs are allowed". Check the
rule with:

```bash
curl -sI https://www.conradgelber.com/ | grep -i "^HTTP\|^location"
```

Expect `301` and `location: https://conradgelber.com/`.

## 4. Verify

```bash
curl -sI https://conradgelber.com/ | grep -i "content-security-policy\|x-content-type\|referrer-policy"
```

You should see the three headers from `_headers`. Then open the site with
DevTools → Network: every request should be same-origin (HTML, `style.css`,
four woff2 files, favicon). The console should be empty. On `/play/`, expect
`play.css`, `play.js`, `land.json` and `places.json` as well, and the three
difficulty buttons should become clickable once the map loads (if they stay
disabled, the CSP is blocking the script). On `/flight-path/`, expect
`play.css`, `flight-path.css`, `flight-path.js`, `countries-50m.json` and
`routes.json`, and the same three-button check. On `/pool/`, expect
`play.css`, `pool.css` and `pool.js`; "Play the computer" should open the
setup form, and a started game should draw the table. Online rooms open a
socket to `wss://conradgelber.com/pool/ws`, which is the pool Worker (see
below), so check them on the live site.

## Notes

- **HSTS.** `_headers` sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` (two years, no preload). Browsers that have seen it will only use HTTPS for conradgelber.com **and every subdomain** for two years, so any new subdomain must serve HTTPS from day one. Proxied records get Cloudflare's wildcard certificate automatically; a DNS-only record pointing elsewhere needs its own certificate. Checked 2026-09-24: only the apex and www resolve, and both serve valid HTTPS. The `cambio` Worker sends the same header.
- `_headers` also sends `Permissions-Policy` (every browser feature the site does not use is turned off) and `Cross-Origin-Opener-Policy: same-origin` on every path, and serves `/.well-known/security.txt` as plain text. Update its `Expires` line before 2027-09-24. Every page starts with a "Skip to main content" link to `<main id="main">`, and every footer links `/accessibility/`; keep both when adding a page.
- `_headers` applies to every path (`/*`). The CSP is
  `default-src 'none'` with `script-src`, `connect-src`, `style-src`,
  `font-src`, `img-src` and `manifest-src` set to `'self'`. Only
  same-origin script files run; inline scripts, inline `style` attributes and
  requests to any other host are blocked. The JSON-LD block is a data block,
  not a script; the browser never executes it and the CSP does not apply to it.
- Keep a single CSP rule. A second rule for a subpath (say `/play/*`) does not
  override `/*`: Pages sends both, joined with a comma, and the browser
  enforces each policy separately, so anything either one blocks stays blocked.
- Caching (`_headers`): HTML is served with `max-age=0` by Pages; `style.css`
  is `no-cache`; `/fonts/*`, `/img/*`, `/play/land.json` and
  `/flight-path/countries-50m.json` are cached for a year as immutable. So:
  never overwrite an image, font, `land.json` or `countries-50m.json` in
  place. A new crop or a new face
  gets a new filename (the images carry their dimensions in the name for
  this reason).
- `fonts/spectral-latin-ext-600.woff2` is declared only in `play/play.css`,
  with the latin-ext `unicode-range`, so the front page never loads it and
  `/play/` fetches it only when a name like Chișinău is on screen. It is the
  same Spectral build as the latin files (byte-identical to
  `@fontsource/spectral` 5.3.0).
- **Browser Cache TTL.** The zone setting (Caching -> Configuration) overrides
  any origin `Cache-Control` shorter than itself; the free-plan default is
  4 hours, which turns `no-cache` into `max-age=14400` and left returning
  visitors with new HTML and a stale stylesheet. Set it to **Respect Existing
  Headers**. Until that is set, bump the query string on the stylesheet link
  (`/style.css?v=5` -> `?v=6`) whenever `style.css` changes, in every page
  that links it (see the list under [Pages and the tab bar](#pages-and-the-tab-bar));
  it is harmless to keep doing so afterwards.
- Every deploy is a plain git push to `main`; Cloudflare builds it within a
  minute or two. Preview deploys for other branches are on by default and
  get their own `*.pages.dev` URL.

## Pages and the tab bar

Each section has its own page, a plain `index.html` in its own folder:

| Page | File |
| --- | --- |
| `/` | `index.html` |
| `/work/` | `work/index.html` |
| `/built/` | `built/index.html` |
| `/writing/` | `writing/index.html` |
| `/next/` | `next/index.html` |
| `/off-the-clock/` | `off-the-clock/index.html` |
| `/games/` | `games/index.html` |
| `/accessibility/` | `accessibility/index.html` |
| any missing path | `404.html` |

All nine carry the same `<nav class="tabs" aria-label="Site">` block under
the masthead. There is no build step and no include, so **a change to the tab
bar (a label, a new tab, a reordering) has to be made by hand in all eight
files**, identically. The one difference between copies is
`aria-current="page"`, which sits on the current page's tab (the front page
and the 404 page have none). After editing, check that the copies still match:

```bash
grep -h --no-group-separator -A7 '<nav class="tabs"' index.html 404.html */index.html | sed 's/ aria-current="page"//' | sort | uniq -c
```

Every line should show a count of 9. The same goes for the head (font
preloads, favicon, `style.css?v=`) and the footer, which are also copied.

`/play/`, `/flight-path/`, `/pool/`, `/cambio/` and `/poker/` do not get the tab bar.
`/play/`, `/flight-path/`, `/pool/`, `/borderline/`, `/historybowl/` and `/12axes/` have a single "← Games" link in
their header instead. During a game on a screen narrower than 600 px,
`/pool/` hides that header and shows a round back button in its players bar,
so the table can fill the screen; the skip link and the footer stay.

`/cambio/` is not part of this repo: it is a separate Worker (`cambio`,
source in `conradicle/cambio-game`) routed at `conradgelber.com/cambio` and
`conradgelber.com/cambio/*`, with its own security headers. Worker routes
exist only on the custom domain, so `/cambio/` 404s on `*.pages.dev` preview
deploys; test that link on the live site. The game loads `/fonts/*.woff2` and
`/favicon.svg` from this site, so do not rename those.

`/poker/` works the same way: the `poker` Worker, from the same
`conradicle/cambio-game` repo (`packages/poker-worker`), routed at
`conradgelber.com/poker` and `conradgelber.com/poker/*`, deployed by hand
with `npm run deploy:poker` there. It also loads `/fonts/*.woff2` and
`/favicon.svg` from this site.

## The front page cable

The front page opens with a mock diplomatic cable (`<section class="cable">`
in `index.html`), styled by `cable.css` and driven by `cable.js`. Only
`index.html` loads them, so its head has three lines the other pages lack: the
IBM Plex Mono preload, `cable.css?v=` and `cable.js?v=`. Bump the `?v=` on
either file when it changes.

- The whole cable is plain HTML. `cable.js` only writes the date-time group
  (UTC, `DDHHMMZ MON YY`; the HTML holds a fixed fallback for visitors without
  JavaScript), enables the redaction buttons, and types the cable out.
- `cable.js` loads in `<head>` without `defer` on purpose: it has to put
  `cable-anim` on `<html>` before the first paint, or a first-time visitor
  sees the full cable flash before it is hidden and typed.
- Typing happens once per browser (`localStorage` key `cable-seen`) and never
  with reduced motion, without storage, or in a browser without the CSS Custom
  Highlight API. It hides untyped characters with a highlight range, so the
  text is never split or rewritten and screen readers get it whole. Any key,
  a tap in the cable, focus in the cable, or hiding the tab finishes it, and a
  15-second timer finishes it regardless. To see it again, clear
  `cable-seen` in DevTools (Application, Local Storage).
- Each redacted line is a `<button class="redact">` with `aria-expanded` and an
  `aria-label`; revealing it removes the label so the button's name becomes
  the revealed text. The buttons ship `disabled` and `cable.js` enables them.
- Guardrails for edits: the only marking is `UNCLASSIFIED`, there is no seal or
  State Department branding, and the "Personal website. Not affiliated with
  the U.S. Department of State." line stays on the cable.
- The fonts are `fonts/ibm-plex-mono-latin-400.woff2` and `-500.woff2`,
  byte-identical to `@fontsource/ibm-plex-mono` 5.3.0. No CSP change was
  needed.

## The /play/ game

`play/` is what Pages serves: `index.html`, `play.css`, the bundled
`play.js`, `land.json` and `places.json`. The source lives in `play-src/`
(d3-geo, d3-selection, d3-zoom and topojson-client, bundled by esbuild).
After editing `play-src/src/main.js`, rebuild from the repo root and commit
the new `play/play.js`:

```bash
npm --prefix play-src ci && npm --prefix play-src run build
```

(In Windows PowerShell 5.1, use `npm.cmd` and run the two commands
separately.) Bump `?v=` on the `play.js` or `play.css` link in
`play/index.html` whenever either changes, for the same Browser Cache TTL
reason as the stylesheet.

Data:

- `play/land.json` is `land-50m.json` from the `world-atlas` package
  (Natural Earth, public domain). `npm --prefix play-src run land` copies it.
- `play/places.json` is generated. `play-src/scripts/place-list.mjs` holds
  the curated names per tier; `build-places.mjs` looks each one up in
  Natural Earth's `ne_10m_populated_places_simple.geojson` (download it from
  the natural-earth-vector repo; it is not committed) and fails on any name
  that is missing or ambiguous. Coordinates are never typed by hand.

  ```bash
  node play-src/scripts/build-places.mjs path/to/ne_10m_populated_places_simple.geojson
  ```

- `npm --prefix play-src run check-places` confirms every place is on land,
  or within 50 km of it, in `land.json`, and lists any that are not.

Pages also serves `play-src/` itself (its source and package files, not
`node_modules`). That is harmless; the same files are public on GitHub.

## The /flight-path/ game

`flight-path/` is what Pages serves: `index.html`, `flight-path.css`, the
bundled `flight-path.js`, `countries-50m.json` (for drawing) and
`routes.json` (every playable route and the countries it crosses). The page
also loads `/play/play.css` for the header, buttons, difficulty rows and
globe, so check `/flight-path/` after changing that file. The source is in
`play-src/` next to /play/'s: `src/flight-path/` for the game, `src/globe.js`
for the globe both games share, `lib/` for the great-circle math and the
country model (names, aliases, territories, disputed places). After editing
any of it, rebuild and commit the bundle, and bump `?v=` on its link in
`flight-path/index.html`:

```bash
npm --prefix play-src run build:flight
```

A change to `src/globe.js` changes /play/ too: run `npm --prefix play-src run build`
as well, bump `play.js?v=`, and check /play/ still behaves the same.

Data:

- `play-src/data/city-list.json` is the curated list of cities (same entry
  format as `place-list.mjs`). `build-cities.mjs` looks each one up in
  Natural Earth's populated places (the same download as for /play/, not
  committed) and writes `play-src/data/cities.json`, checking each city
  falls inside the right 1:10m country:

  ```bash
  node play-src/scripts/build-cities.mjs path/to/ne_10m_populated_places_simple.geojson
  ```

- `npm --prefix play-src run routes` rebuilds `flight-path/routes.json` from
  `cities.json` against world-atlas's `countries-10m.json` (Natural Earth
  1:10m, used only here, never shipped). A country counts when 2 km or more
  of the route lies over its land. Add `-- --report some/file.txt` to write
  every crossing under 10 km, for review. Bump `routes.json?v=` in
  `play-src/src/flight-path/main.js` and rebuild the bundle after.
- `npm --prefix play-src run countries` copies world-atlas's
  `countries-50m.json` into `flight-path/`. It is cached as immutable; give
  a new copy a new filename.
- `npm --prefix play-src test` runs the tests: the great-circle math, known
  routes (New York to Hong Kong, London to Tokyo, a Pacific crossing),
  aliases, the disputed-place rules and the weak-spot memory.

The weak-spot memory lives in `localStorage` under `flight-path-stats`.

## The /borderline/ game

Date an old political map from its borders and names. Static, no Worker:
`borderline/` is what Pages serves (`index.html`, `borderline.css`, the
bundled `borderline.js`) plus the generated data in `borderline/data/`. The
page also loads `/play/play.css`. Bump `?v=` on the `borderline.js` or
`borderline.css` link whenever either changes.

Source, in `play-src/`:

- `src/borderline/`: the page (`main.js`), the map drawing shared with the
  PNG renderer (`render.js`, `projection.js`), the window function
  (`window.js`), scoring with its tunable constants (`score.js`: `K.N`,
  `K.H`, `HINT_COST`) and the daily schedule (`seed.js`: one fixed shuffle
  dealt five a day, so a puzzle repeats only after the whole bank).
- `scripts/borderline/`: the data pipeline. Tunable fairness settings are in
  `config.mjs` (`VISIBLE_MIN_AREA`, `MAX_WINDOW_YEARS`, crop widths,
  `LABEL_READABLE` for tell labels, `CONTESTED_REJECT`).
- `data/borderline/`: the hand-made tables, each date with a source:
  `names.json` (labels and renames), `cs-dates.json` (sourced fixes to
  CShapes dates, such as Kosovo on 17 February 2008), `eu-dates.json` (real dates for
  CShapes-Europe changes), `curated.json` (the pre-1886 maps).

Rebuild the data (downloads about 20 MB into the git-ignored
`play-src/data/borderline/raw/`; the bank takes about an hour):

```bash
npm --prefix play-src run borderline:data
```

That fetches and hash-checks the sources, builds the geometry, judges a few
thousand crops into `borderline/data/bank/`, adds the curated maps, and cuts
the map files in `borderline/data/geo/` (one per difficulty, era and grid
cell, holding only what its puzzles draw, so a game downloads a few hundred
KB). After a rules change, `node play-src/scripts/borderline/build-bank.mjs
--rejudge` re-checks the committed bank in about a minute, and `--resume`
also refills the quotas; run `build-curated.mjs` and `build-maps.mjs` after
either.
`borderline/data/bank.csv` lists every puzzle for skimming. Spot-check any
puzzle as a PNG (written to `play-src/data/borderline/build/png/`):

```bash
node play-src/scripts/borderline/render-puzzle.mjs N0042 H0007 C01
```

`--blind 20 --curated 5 --out dir` instead writes shuffled maps with no ids
and an `answer-key.txt`, to test whether the curated maps stand out.

After a change to the names or the judge, also regenerate the test fixture
with `node play-src/scripts/borderline/make-fixture.mjs`. Then rebuild the
page bundle:

```bash
npm --prefix play-src run build:borderline
```

Tests (`borderline.test.mjs`, run by `npm --prefix play-src test`): the
window function, scoring, the New York daily date, the renames, the known
cases through the real judge on the fixture (Austria-Hungary ends in 1918,
the U.S.S.R. in 1991, Zaire starts in 1971 and so on), the Russian Alaska
map ending in 1867, and checks over every committed puzzle.

Licenses: the files in `borderline/data/` made from CShapes and
CShapes-Europe are CC BY-NC-SA 4.0 like their sources, and the curated
map files `geo/g-C*.json` (from historical-basemaps) are GPL-3.0. The About section on the page
credits all three.

## The /pool/ game

8-ball and 9-ball, against the computer (entirely in the browser) or a
friend (online rooms with six-letter codes). `pool/` is what Pages serves:
`index.html`, `pool.css` and the bundled `pool.js`; the page also loads
`/play/play.css` for the header and buttons. Bump `?v=` on the `pool.js` or
`pool.css` link in `pool/index.html` whenever either changes.

Source, in `play-src/src/pool/`:

- `engine/` is shared by the page, the Worker and the computer player:
  `physics.js` (the deterministic simulation: fixed 1/1024 s step, only
  `+ - * /` and `Math.sqrt`, no randomness), `table.js`, `rack.js`,
  `rules.js`, `guide.js` (the aim guide), `ai.js`, `protocol.js` (socket
  path, room codes as in Cambio) and `version.js`.
- `version.js` is generated: a hash of the other engine files. The page sends
  it when it joins a room and the Worker turns away a page built from other
  rules or physics ("Pool has been updated. Reload the page"). Deploying one
  side before the other is therefore safe, only briefly unplayable.
- The rest (`main.js`, `render.js`, `widgets.js`, `words.js`,
  `online.js`) is the page.

After any change there, rebuild and commit the bundle (the build also
regenerates `version.js`):

```bash
npm --prefix play-src run build:pool
```

The production build defines `POOL_DEV` false, which removes the dev-only
test handle at the end of `main.js`. Check with
`grep -c poolDev pool/pool.js`: it should print 0.

Tests (`npm --prefix play-src test` runs them with the rest):

- `pool-rules.test.mjs`: every foul, groups, the 8 and the 9 on the break,
  combinations on the 9, a scratch on the 8, the shot clock, input checks.
- `pool-ai.test.mjs`: whole computer games finish with legal inputs and
  replay exactly from their seeds.
- `pool-determinism.test.mjs`: a frozen set of 200 shots
  (`test/pool/shots.json`), run twice, must give the recorded hash. After a
  change to the physics, the test says so; regenerate the set with
  `node play-src/test/pool/make-fixture.mjs` and commit it.
- `npm test` also fails if `version.js` is stale.

### The pool Worker

`pool-worker/` is a separate Cloudflare Worker, `pool`, routed only at
`conradgelber.com/pool/ws*` (the `*` lets the route match the socket's query
string): one Durable Object per room (SQLite-backed,
free plan), plus the per-IP `Limiter` from Cambio's Worker. The rest of
`/pool/` stays on Pages. The socket is same-origin, so the site's
`connect-src 'self'` covers it and `_headers` needs no change.

- Pages serves `pool-worker/` publicly like everything else in the repo.
  Never put a secret, key or token in it; if one is ever needed, use
  `npx wrangler secret put` from `pool-worker/`.
- The server runs every shot through the same engine, in slices (256 steps,
  then 1,024 per alarm) so no single invocation comes near the free plan's
  CPU limit; a slice is saved, so an evicted room carries on.
- Worker routes exist only on the custom domain, so online rooms fail on
  `*.pages.dev` previews (the page says so). Test them locally or live.

Deploy (Wrangler must be logged in to the Cloudflare account):

```bash
npm --prefix pool-worker ci
npm --prefix pool-worker run deploy
```

Local development runs the Worker with a copy of the site's files (and its
`_headers`, so the production CSP) on one origin, at
http://localhost:8797/pool/. The copy's bundle includes the dev-only test
handle; `/pool-test/` runs the determinism set in the browser.

```bash
npm --prefix pool-worker run dev
```

Checks: `npm --prefix pool-worker test` (the room: codes, turns, bad input,
sliced shots, the clock, disconnects, rematch), and against a running copy:

```bash
node pool-worker/test/ws-check.mjs http://localhost:8797
```

The last of its checks trips the per-IP limit on wrong room codes, so that
address is turned away from joining rooms for a minute afterwards.

After each online shot, every browser sends a hash of the table it ended
with, and the Worker logs any that differ from its own result: one line
starting `pool mismatch`, with the room code, the shot number, both hashes
and the browser's user agent (nothing else about the player). Workers Logs
are off, so nothing is stored; watch them live from `pool-worker/`:

```bash
npx wrangler tail pool --search "pool mismatch" --format pretty
```

Settings are kept per browser in `localStorage` under `pool-settings` (name,
game, guide, level). An online seat's token is in `sessionStorage` (a refresh
takes the seat back) and `localStorage` (`pool-session`, so a reopened tab
can offer to rejoin within five minutes).

## The /historybowl/ page

History Bowl Study: National History Bowl practice. `historybowl/` is what
Pages serves (`index.html`, `historybowl.css`, the bundled
`historybowl.js`); the page also loads `/play/play.css`. Bump `?v=` on the
`historybowl.js` or `historybowl.css` link whenever either changes.

Source, in `play-src/src/historybowl/`: `main.js` (the page), `text.js`
(words, sentences, the reading schedule), `answer.js` (the answerline parser
and the local answer checker), `tags.js` (estimated era and region),
`question.js` (the one question shape every source is turned into; shared
with the Worker), `store.js` (localStorage, tag corrections, export and
import), `areas.js` (the weakest-areas ranking), `srs.js` (flashcard
scheduling with the `ts-fsrs` package, pinned at 5.4.2), `match.js` (the
four-quarter regional format, scoring and the computer opponent, with no DOM
so multiplayer rooms can reuse it), `sim.js` (the match simulator screens),
`ui.js` (small helpers shared by the screens), `api.js`.
Rebuild and commit the bundle after any change:

```bash
npm --prefix play-src run build:historybowl
```

Tests: `historybowl.test.mjs` in `npm --prefix play-src test` (answer
checking on real answerline shapes, era and region, the reading schedule,
blocked and corrupt storage, export then import), and
`npm --prefix historybowl-worker test` (query checks, the category mix,
answerline cleaning). Against a running Worker,
`node historybowl-worker/test/api-check.mjs http://localhost:8801` (or
`https://conradgelber.com`) checks tossups, bonuses, answer checks and the
400, 403 and 404 cases over real HTTP. It is read-only: it never posts a
report or touches the team-only packet routes.

Storage, per browser: `historybowl:records` (one entry per tossup heard:
question id, source, category, era, region, right or wrong, buzz point,
override), `historybowl:cards`, `historybowl:settings`, `historybowl:seen`
(recent question ids, so a session does not repeat) and `historybowl:queue`
(the next few questions, so the page still works on bad wifi) and
`historybowl:fixes` (the player's own category, subcategory, era and region
for a question, which replace the guessed tags in stats and the
weakest-areas filter). Each card carries its FSRS schedule. The Stats screen
exports and imports records, cards and corrections as one JSON file.

Weakest areas rank subcategories first (at least 8 tossups each); the
estimated era and region tags only fill the list when fewer than three
subcategories qualify. IAC History Bee nationals tossups count half there,
and the Stats screen shows them apart from the regional-level sources.

`historybowl/data/decks/starter.json` is the optional starter deck: AI-written
cards, marked as such in the page, each with a "Report an error" button.
Add a card by adding a row; never change an existing card's `id`, since
schedules on players' devices are keyed by it. Bump `?v=` on `STARTER_URL`
in `main.js` after a change.

### The historybowl Worker

`historybowl-worker/` is a separate Worker, `historybowl`, routed only at
`conradgelber.com/historybowl/api*`. The CSP allows connections to this site
only, so the page cannot call QB Reader (qbreader.org) itself; the Worker does,
passing on only whitelisted parameters:

- `GET /historybowl/api/tossups?src=bee,qb&cats=History&subs=&level=regional&n=8`:
  `bee` draws from the IAC History Bee Nationals sets (2015 to 2022) that QB
  Reader hosts, by whole packet (kept in the edge cache for 30 days); `qb` is
  QB Reader's random tossups at difficulty 2 to 3 (`regional`), 3 to 4
  (`harder`) or 2 to 5 (`all`), weighted toward History.
- `GET /historybowl/api/bonuses?cat=History&sub=World%20History&level=regional&n=10`:
  random QB Reader bonuses in one category, for second-quarter bonuses and
  lightning rounds (each bonus's first part, with its leadin, stands alone).
- `POST /historybowl/api/check` `{answerline, given}`: QB Reader's answer
  checker. The page falls back on its own checker if this takes over 2.5 s.
- `POST /historybowl/api/report` `{qid, source, note}`: the "Report an error"
  button. Reports go into the Workers KV namespace `historybowl-reports`
  (question id, note and time; no IP or name). List them, or clear them once
  dealt with:

  ```bash
  npm --prefix historybowl-worker run reports
  npm --prefix historybowl-worker run reports -- --clear
  ```

- `GET /historybowl/api/iac/{check,index,packet,tossups}`: IAC National History
  Bowl regional packets, for the team only (see below).

Rate limits per IP, per minute (the `Limiter` Durable Object from Pool and
Cambio): 120 API calls, 10 reports, 10 wrong team passcodes. The passcode
limit is checked before the passcode itself, so a guess made during a
lockout reveals nothing.

### IAC packets (team only)

IAC's past questions are not ours to publish, and this repo is public, so
packet text never enters git. The pipeline:

1. Put the packet PDFs anywhere outside the repo, then import them:

   ```bash
   node play-src/scripts/historybowl/import-packets.mjs "C:/path/to/packets"
   ```

   This reads each PDF with `pdfjs-dist` (the bold in an answer is its
   required part), parses the quarters (`play-src/src/historybowl/packet.js`)
   and writes `play-src/data/historybowl/iac/` (git-ignored): one JSON file
   per packet, `kv.json` for upload, and `report.txt`, which lists every
   packet with its counts and anything the parser could not place. A packet
   needs 10 + 8 tossups, 8 bonuses, three lightning categories of 8 and 8
   fourth-quarter tossups to count as complete.
2. Upload to the `historybowl-iac` KV namespace (binding `IAC`):

   ```bash
   npm --prefix historybowl-worker run upload-iac
   ```

   (`-- --local` uploads to local dev instead.)
3. The passcode is a Worker secret, set once (and again to change it):

   ```bash
   npx --prefix historybowl-worker wrangler secret put TEAM_PASSCODE -c historybowl-worker/wrangler.jsonc
   ```

   For local dev, put `TEAM_PASSCODE=...` in `historybowl-worker/.dev.vars`
   (git-ignored).

The page's settings take the passcode once per device (kept in
`historybowl:team`, never exported). With it, the simulator plays a whole
packet (real short tossups, bonuses, lightning categories and long tossups;
QB Reader fills any quarter a packet lacks), and the reader can mix packet
tossups in. Packet questions carry no categories: their subcategory is a
guess from the text, flagged so the weakest-areas ranking ignores it until
corrected. Real first-quarter tossups count in stats as their own source
(`iac-packet-short`). Nothing secret belongs in the folder;
Pages serves it like the rest of the repo.

Deploy (Wrangler must be logged in):

```bash
npm --prefix historybowl-worker ci
npm --prefix historybowl-worker run deploy
```

Local development serves a copy of the site's files (with the production
`_headers`) and the Worker on one origin, at http://localhost:8801/historybowl/:

```bash
npm --prefix historybowl-worker run dev
```

## The /12axes/ page

12 Axes, a political values test. Static, no Worker, nothing stored on a
server: `12axes/` is what Pages serves (`index.html`, `12axes.css`, the
bundled `12axes.js`, and `LICENSE-12axes.txt`). The page also loads
`/play/play.css`. Bump `?v=` on the `12axes.js` or `12axes.css` link
whenever either changes.

The question bank and scoring model come from the MIT-licensed
[politicaltests/12axes](https://github.com/politicaltests/politicaltests.github.io/tree/5a508de557cc88eb7e9a44d89f45501dbe912d61/12axes),
pinned to commit `5a508de`. Its license is `12axes/LICENSE-12axes.txt`, and
the page footer credits it. Nothing from 12axes.net is used: every axis
explanation, ideology description and library entry here was written for
this site.

Source, in `play-src/`:

- `src/12axes/`: `axes.js` (the twelve axes and display order),
  `score.js` (answer weights and the normalized 0-100 score), `select.js`
  (per-mode picking, balanced across both poles, and the order that never
  puts two statements on one axis in a row), `match.js` (distance on the four
  reference dimensions), `share.js` (the `#r=` and `#c=` link format),
  `radar.js`, `store.js` (one localStorage key, every access wrapped), and
  `main.js` (the page).
- `data/12axes/`: `questions.json` and `ideologies.json` are generated from
  the pinned source; `axes.json`, `ideology-text.json` and `reference.json`
  (thinkers and countries, with illustrative coordinates) are hand-written.
- `scripts/12axes/import-source.mjs`: re-downloads the two source files,
  checks their SHA-256 and rewrites the generated JSON:

```bash
npm --prefix play-src run 12axes:data
```

Question ids (0 to 287) are part of every share link, so never reorder
`questions.json`; if the format of a link must change, bump `VERSION` in
`share.js`. Rebuild the page bundle after any change:

```bash
npm --prefix play-src run build:12axes
```

Tests (`12axes.test.mjs`, run by `npm --prefix play-src test`): the bank's
counts, scores at both poles and at Neutral in every mode, scores staying in
0-100, per-mode counts and balance, no two statements on one axis in a row,
the trade-dimension fix in matching, share links round-tripping, blocked
storage, and checks over the hand-written text and library.

## The private hub

`/login/` and everything under `/hub/` are Conrad's private area: a PIN
login and a dashboard of tools. How to add a tool is in
[ADDING_TOOLS.md](ADDING_TOOLS.md); this section is the deploy side.

- **Entry.** The front page portrait links to `/login/` (`a.portrait` in
  `index.html`), styled with no underline and no hand cursor so nothing
  hints at it. `robots.txt` disallows `/login/` and `/hub/`; every response
  there also sends `X-Robots-Tag: noindex, nofollow` and the pages carry a
  robots meta tag. None of it is in `sitemap.xml`.
- **Pages Functions.** `functions/login/index.js` (GET shows the static
  `login/index.html` with an error message filled in by HTMLRewriter; POST
  checks the PIN), `functions/logout.js`, `functions/_middleware.js` (the
  hub gate: runs on every request to the site and requires a session for
  anything whose canonical path is in `/hub`, see below),
  `functions/hub/_middleware.js` (a second session check on canonical
  `/hub/` requests, and marks them private) and `functions/hub/api/store/`
  (the storage API). Shared code is in
  `functions/_lib/`. Pages deploys these with every push, like the static
  files. Pages also serves the `functions/` folder as plain files, which is
  harmless: the same code is public on GitHub and holds no secrets.
- **Why the gate runs on every request.** Pages' static file server
  normalizes paths before looking up a file, so `//hub/`, `/hub%2f` and
  `/%68ub/` all serve `hub/index.html`, while the Functions router matches
  the raw path and so never ran `functions/hub/_middleware.js` for them.
  `_routes.json` (`"include": ["/*"]`, no excludes) makes Functions run
  before the static files for every request, and `functions/_middleware.js`
  decodes, collapses slashes, resolves `.`/`..` and ignores case
  (`functions/_lib/paths.js`) before deciding. Never add an `exclude` to
  `_routes.json`: excludes match the raw path too, so `/fonts/..%2fhub/`
  could slip past. The cost is a Functions invocation per page view.
  Signed out, a page gets a 303 to `/login/` and anything else (scripts,
  JSON, icons, the API) a 401.
- **PIN check.** PBKDF2-SHA256, 100,000 iterations (the Workers WebCrypto
  maximum), against the `PIN_SALT_B64` and `PIN_HASH_B64` secrets, compared in
  constant time. Never on the client. The server accepts 8 to 128
  characters, any characters, so a passphrase works. To change it, run
  `scripts/set-hub-pin.sh` (asks for the new PIN twice, puts both secrets),
  then push or retry the latest deployment.
- **Rate limit.** In D1, one row per failure (`login_failures`: an HMAC of
  the IPv4 address or IPv6 /64, and a timestamp). Checked before the PIN:
  five failures from one client in 15 minutes, or 30 from everyone in 24
  hours, and logins get `429` with `Retry-After` until the window clears.
  A right PIN clears that client's rows. If Conrad locks himself out (it
  takes up to a minute to apply, as each isolate caches a lockout briefly):

  ```bash
  npx wrangler@4.150.0 d1 execute conradgelber-hub --remote --command "DELETE FROM login_failures"
  ```

- **Session.** A signed cookie, `__Host-hub` (HttpOnly, Secure,
  SameSite=Strict, 30 days): expiry and a random nonce, HMAC-SHA256 with the
  `SESSION_SECRET` secret. Log out clears the cookie on that device. To sign
  out every device, put a new `SESSION_SECRET`.
- **Headers.** `_headers` covers only static files Pages serves directly.
  The Functions replace its CSP on `/login/` and `/hub/` responses with one
  that also allows `form-action 'self'` (the login and logout forms) and
  same-origin frames, and send `Cache-Control: private, no-store`. Still a
  single CSP header, per the note above.
- **Config.** `wrangler.jsonc` at the repo root binds the D1 database
  `conradgelber-hub` as `DB`. Because it exists, Pages takes bindings from
  it rather than the dashboard. Secrets are separate and are set with
  wrangler:

  ```bash
  npx wrangler@4.150.0 pages secret put PIN_SALT_B64 --project-name conradgelber-com
  npx wrangler@4.150.0 pages secret put PIN_HASH_B64 --project-name conradgelber-com
  npx wrangler@4.150.0 pages secret put SESSION_SECRET --project-name conradgelber-com
  ```

  The Cloudflare login can see two accounts, so wrangler asks which one;
  prefix commands with `CLOUDFLARE_ACCOUNT_ID=371108a86979f6f53d469d7250e1f924`
  (Conrad's own account, which holds the Pages project and the database).
  A secret change takes effect on the next deploy (push, or retry the latest
  deployment in the dashboard). Preview deploys have no secrets, so the hub
  stays shut there.
- **Schema.** `db/migrations/`. Apply new ones with
  `npx wrangler@4.150.0 d1 migrations apply conradgelber-hub --remote`.
- **Tests.** `test/hub-flow.sh <base-url> [pin]` runs the whole sign-in flow
  (signed-out blocks, wrong PIN, lockout, sign-in, storage API, logout).
  Against the live site it locks out the IP it runs from; clear it with the
  command above. `test/hub-security.sh <base-url>` tries the odd `/hub`
  spellings signed out (safe against the live site); add `--limit` on local
  dev to check the 429. `node --test test/*.test.mjs` tests the Daily tasks model.

## After the first deploy

### Run the live URL through LinkedIn's Post Inspector first

Before adding the site as a Featured card on LinkedIn, open
<https://www.linkedin.com/post-inspector/> and inspect
`https://conradgelber.com/`. LinkedIn caches Open Graph data aggressively,
and a bad first scrape (a 404, a half-deployed page, a missing preview image)
is hard to clear afterwards. The inspector both shows you what LinkedIn sees
and forces a fresh scrape. You want: title "Conrad Gelber", the description,
and the 1200x627 preview image. Only then add the Featured card.

The preview image is `img/og-image-2026.jpg`, named in the `og:image` tag
in `index.html`. Like every file in `img/`, it is cached for a year, and
LinkedIn and other sites cache previews by URL, so a new preview image always
gets a new filename (and the `og:image`, `og:image:alt`, `twitter:image` and
`twitter:image:alt` tags change with it). Run the inspector again afterwards.

### If you turn on Cloudflare Web Analytics

Do it from the dashboard with the *automatic* option (Cloudflare injects the
beacon at the edge for proxied zones). The beacon is a script, so the CSP in
`_headers` will block it silently unless you add its hosts to the two
directives that already exist, so they read:

```
script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com
```

Edit the existing directives in place; do not append a second `script-src`,
since browsers ignore a repeated directive. Commit, push, then enable
analytics. It is cookieless and needs no banner.

### Updating alumniOf after graduation (2027)

The JSON-LD Person block in `index.html` deliberately has no `alumniOf`
while you are still enrolled. After graduating, add this property to the
block (after `worksFor`, before `sameAs`):

```json
"alumniOf": {
  "@type": "HighSchool",
  "name": "Miami Beach Senior High School"
},
```

Then paste the page URL into <https://validator.schema.org/> to confirm the
block still parses, and update `<lastmod>` in `sitemap.xml`.
