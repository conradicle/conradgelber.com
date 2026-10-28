# Adding a tool to the hub

The hub at `/hub/` is a private dashboard behind the PIN login. Each tool is
one folder plus one entry in a registry file. This guide is written for a
future Claude Code session that has just been handed a GitHub link: read it
all before starting.

## How the hub works (one minute)

- **Hosting.** The site is Cloudflare Pages, Git-connected: a push to `main`
  deploys the repo root as-is, no build step. Server code is Pages Functions
  in `functions/`. Data is a D1 database bound as `DB` (see `wrangler.jsonc`).
- **The gate.** `functions/_middleware.js` runs before every request to the
  site and checks the session for anything whose canonical path is under
  `/hub/` (however it is spelled: `//hub/`, `/hub%2f`, `/HUB/`), then
  `functions/hub/_middleware.js` checks again. No valid session cookie means
  a redirect to `/login/` for a page, or a 401 for anything else (scripts,
  JSON, images, `/hub/api/*`). So a file
  you put anywhere under `hub/` is private on the site automatically.
  You never write auth code in a tool.
- **But the repo is public.** `conradicle/conradgelber.com` is a public
  GitHub repo. A tool's *code* is visible there; only its *data* (in D1) and
  its served pages are private. Never commit a secret, an API key, personal
  data, or anything private inside a tool folder. If a tool needs a secret,
  it has to go through a Pages Function and a Pages secret (see "A tool that
  needs its own server code" below).
- **The CSP.** Every hub page is served with:
  `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'self'`
  (set in `functions/_lib/auth.js`, `PRIVATE_CSP`). In practice:
  - No inline `<script>` blocks and no `onclick="..."` attributes. Scripts
    must be files on this site (`<script src>`, ES modules are fine).
  - No inline `style="..."` attributes and no `<style>` blocks. Use a CSS
    file. (Setting `element.style.foo` from a script file *is* allowed; only
    the markup forms are blocked.)
  - No CDNs, no Google Fonts, no third-party APIs from the browser. Copy any
    library into the tool folder. Fonts are already on the site in `/fonts/`.
  - `fetch` only to this site. A tool that must call an outside API needs a
    Pages Function to proxy it.
  - Frames only of this site's own pages.

## Add a tool: the steps

Say the tool is called `reading-log`.

1. **Make the folder** `hub/tools/reading-log/` with at least:
   - `index.html` (the tool's page; copy the skeleton below)
   - `icon.svg` (40x40 square, used on the hub tile; navy `#13233C`,
     paper `#EEF0F3`, teal `#14675E` or the lighter `#4FB3A6` on navy)
   - any `.js` and `.css` files it needs
2. **Register it** in `hub/tools.json`, by adding an object to `tools`:

   ```json
   {
     "id": "reading-log",
     "name": "Reading log",
     "description": "Books in progress and pages read per day.",
     "icon": "/hub/tools/reading-log/icon.svg",
     "route": "/hub/tools/reading-log/"
   }
   ```

   `id` must equal the folder name: lowercase letters, digits and hyphens.
   It is also the tool's storage namespace. Tiles appear in array order.
3. **Commit and push to `main`.** Pages deploys in a minute or two. Nothing
   else changes: no hub code, no function, no database migration.
4. **Check it** on <https://conradgelber.com/hub/> (sign in first): the tile
   shows, the page loads, the DevTools console has no CSP errors, and data
   saved on one device shows up on another after a reload.

### Page skeleton

Copy `hub/tools/daily-tasks/index.html` and change the title, the stylesheet
and script names, and the `<main>` contents. Keep:

- `<meta name="robots" content="noindex, nofollow">`
- `/style.css?v=N` (the site's fonts and colours; use the same `?v=` as the
  other pages) and `/hub/hub.css?v=N`
- the `<header class="mast-sub hub-bar">` block, which has the "Hub" link
  home and the Log out button (a form posting to `/logout`)
- `<main id="main">` and the skip link

Bump the `?v=` on a tool's own CSS/JS links whenever those files change
(Cloudflare's browser cache can otherwise serve the old file; see DEPLOY.md).

### Look and feel

Use the site's tokens from `style.css`: `--paper`, `--ink`, `--ink-soft`,
`--rule`, `--accent`. Headings in Spectral, body in IBM Plex Sans. `hub.css`
has shared controls: `.hub-btn` (solid), `.hub-quiet` (outlined), `.hub-input`,
`.hub-note`, `.visually-hidden`. Touch targets at least 44px. Conrad is
red-green colourblind: never show state (done, error, overdue, on/off) by
red versus green. Use an icon, text, strikethrough or position as well.

## Saving data: the storage API

Every tool gets server-side storage, namespaced by its `id`, stored in D1, so
it is the same on Conrad's phone and laptop.

From a tool's script:

```js
import { toolStore } from "/hub/lib/store.js";
const store = toolStore("reading-log");

const doc = await store.get("books");          // { value, version, updatedAt } or null
await store.set("books", [{ title: "Candide" }]); // overwrite (last write wins)

// Safe read-modify-write. Retries if another device saved in between.
// fn gets the latest value (or a copy of the initial one) and returns the new
// value. It may run more than once, so set values outright: "mark X done",
// not "toggle X".
const saved = await store.update("books", (books) => {
  books.push({ title: "Walden" });
  return books;
}, []);

await store.remove("books");
const keys = await store.list();                // [{ key, version, updatedAt }]
```

Any signed-out call sends the browser to `/login/`.

Raw HTTP, if a tool can't use the module (all same-origin, cookie sent
automatically; writes must carry the page's `Origin`, which browsers do):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/hub/api/store/<tool>/` | list keys |
| GET | `/hub/api/store/<tool>/<key>` | `{ value, version, updatedAt }`, 404 if none |
| PUT | `/hub/api/store/<tool>/<key>` | body is any JSON; `If-Match: "<version>"` or `If-None-Match: *` for conditional writes (412 on conflict) |
| DELETE | `/hub/api/store/<tool>/<key>` | 204 |

Keys: letters, digits, `.`, `_`, `-`, up to 128 characters. Values: up to
512 KB of JSON each. Store a tool's state as one or a few documents, not one
key per tiny item; D1's free tier is 100,000 writes a day.

A tool that only needs to remember things on one device can use
`localStorage` instead, but the point of the hub is sync, so prefer the API.

## Wrapping an outside GitHub project

When handed a GitHub link, first work out which kind of project it is.
Read its README, `package.json` and source. Then check the licence allows
copying it (MIT, Apache-2.0, BSD, ISC, etc.; keep its LICENSE file in the
tool folder). If it has no licence, ask Conrad before copying.

### A. A static JS app (HTML/CSS/JS, maybe with a build step)

Most common. Put the built files straight into the tool folder.

1. Clone it somewhere outside this repo (a scratch folder).
2. If it has a build step (`npm run build`, Vite, etc.), build it with a
   relative base path so assets load from the tool folder, e.g. Vite:
   `npx vite build --base=/hub/tools/<id>/`. Create React App:
   `"homepage": "/hub/tools/<id>/"` in package.json. Copy only the build
   output (`dist/` or `build/`), never `node_modules`.
3. Copy the files into `hub/tools/<id>/`. Its `index.html` becomes the tool
   page.
4. Make it pass the CSP (above). The usual fixes:
   - move inline `<script>` contents into a `.js` file in the folder;
   - move inline `<style>` and `style=""` into a `.css` file;
   - download any CDN script, stylesheet or font into the folder and point
     the tag at the local copy;
   - Vite/webpack builds sometimes inline a small script; disable that
     (`build.modulePreload.polyfill: false` in Vite) or move it out.
5. Add the hub header (the "Hub" link and Log out) if it fits the app's
   layout; if the app takes the full screen, at least add a small "Hub"
   link back.
6. If the app saves to `localStorage` and should sync, swap those calls for
   `toolStore("<id>")` (see above). Keep it simple: load once on start, save
   on change.
7. Register it in `tools.json`, push, check the console for CSP errors.

Keep a `SOURCE.md` in the tool folder with the upstream repo URL, the commit
copied, and what was changed, so it can be updated later.

### B. A self-contained app that should stay untouched: iframe it

If the app already works as a standalone page and editing it for the CSP or
the header isn't worth it, put its files in a subfolder and frame them:

```
hub/tools/<id>/index.html     <- hub page with the header and an <iframe>
hub/tools/<id>/app/...        <- the upstream files, as built
```

```html
<main id="main">
  <iframe class="hub-frame" src="/hub/tools/<id>/app/index.html" title="<Tool name>"></iframe>
</main>
```

The framed files are still under `/hub/`, so they are still private, and
they can still call `/hub/lib/store.js`. They are still subject to the same
CSP, so step 4 above applies to them too. Only same-origin frames are allowed:
an app hosted elsewhere (its own domain, a third-party service) cannot be
framed, and should just be linked from a tile instead.

### C. A project that needs a server (Node, Python, a database)

It can't run on Pages as-is. Options, in order of preference: rewrite the
server part as a Pages Function under `functions/hub/api/<id>/` (Workers
runtime: `fetch`, WebCrypto, D1; no Node filesystem); or host it elsewhere
and link to it from a tile. Ask Conrad before adding a paid service.

### A tool that needs its own server code

Put it in `functions/hub/api/<id>/...` (for example
`functions/hub/api/reading-log/search.js` serves `/hub/api/reading-log/search`).
The middleware already checks the session for everything under `/hub/`, so
the function doesn't need to. Use `json()` and `sameOrigin()` from
`functions/_lib/auth.js`, and check `sameOrigin(request)` on anything that
changes data. A secret goes in as a Pages secret:

```bash
npx wrangler@4.150.0 pages secret put READING_API_KEY --project-name conradgelber-com
```

and is read as `env.READING_API_KEY`. If the tool needs its own D1 table,
add a numbered migration in `db/migrations/` and apply it:

```bash
npx wrangler@4.150.0 d1 migrations apply conradgelber-hub --remote
```

## Testing locally

```bash
npx wrangler@4.150.0 d1 migrations apply conradgelber-hub --local
npx wrangler@4.150.0 pages dev . --port 8788
```

Local secrets come from `.dev.vars` (git-ignored), with a test PIN rather
than the real one:

```bash
node -e 'const c=require("crypto"),s=c.randomBytes(16);console.log("PIN_SALT_B64="+s.toString("base64")+"\nPIN_HASH_B64="+c.pbkdf2Sync(process.argv[1],s,100000,32,"sha256").toString("base64")+"\nSESSION_SECRET="+c.randomBytes(32).toString("base64url"))' 2468013579 > .dev.vars
```

Then sign in at <http://127.0.0.1:8788/login/> with that test PIN.
`test/hub-flow.sh` checks the whole sign-in flow (see the comment at its top),
and `node --test test/*.test.mjs` runs the Daily tasks model tests.
