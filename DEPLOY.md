# Deploying conradgelber.com

Static site, no build step on deploy. Cloudflare Pages serves the repo root
as-is. The one generated file, `play/play.js`, is built locally and committed;
see [The /play/ game](#the-play-game) below.

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
disabled, the CSP is blocking the script).

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
  is `no-cache`; `/fonts/*`, `/img/*` and `/play/land.json` are cached for a
  year as immutable. So: never overwrite an image, font or `land.json` in
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

`/play/` and `/cambio/` do not get the tab bar. `/play/` has a single
"← Games" link in its header instead.

`/cambio/` is not part of this repo: it is a separate Worker (`cambio`,
source in `conradicle/cambio-game`) routed at `conradgelber.com/cambio` and
`conradgelber.com/cambio/*`, with its own security headers. Worker routes
exist only on the custom domain, so `/cambio/` 404s on `*.pages.dev` preview
deploys; test that link on the live site. The game loads `/fonts/*.woff2` and
`/favicon.svg` from this site, so do not rename those.

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

## After the first deploy

### Run the live URL through LinkedIn's Post Inspector first

Before adding the site as a Featured card on LinkedIn, open
<https://www.linkedin.com/post-inspector/> and inspect
`https://conradgelber.com/`. LinkedIn caches Open Graph data aggressively,
and a bad first scrape (a 404, a half-deployed page, a missing preview image)
is hard to clear afterwards. The inspector both shows you what LinkedIn sees
and forces a fresh scrape. You want: title "Conrad Gelber", the description,
and the 1200x630 preview image. Only then add the Featured card.

The preview image is `img/og-suit-1200x630.jpg`, named in the `og:image` tag
in `index.html`. Like every file in `img/`, it is cached for a year, and
LinkedIn and other sites cache previews by URL, so a new preview image always
gets a new filename (and the `og:image` and `og:image:alt` tags change with
it). Run the inspector again afterwards.

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
