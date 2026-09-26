// Copy the parts of the site the pool page needs into .wrangler/dev-assets
// (ignored by git), for `npm run dev`. Includes the site's _headers, so the
// local page gets the production CSP.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const site = resolve(import.meta.dirname, '../..');
const out = resolve(import.meta.dirname, '../.wrangler/dev-assets');
mkdirSync(out, { recursive: true });
// Empty the folder rather than deleting it: a running `wrangler dev` holds it open on Windows.
for (const entry of readdirSync(out)) rmSync(resolve(out, entry), { recursive: true, force: true });
for (const p of ['_headers', '404.html', 'style.css', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'icon-192.png', 'icon-512.png', 'fonts', 'play/play.css', 'pool', 'games', 'accessibility']) {
  cpSync(resolve(site, p), resolve(out, p), { recursive: true });
}
// The copy's bundle is built with POOL_DEV true: it adds a handle for scripted
// test play (see the end of play-src/src/pool/main.js). Production never has it.
const src = resolve(site, 'play-src');
const built = spawnSync('npx esbuild src/pool/main.js --bundle --format=iife --target=es2019 --define:POOL_DEV=true --outfile=' + JSON.stringify(resolve(out, 'pool/pool.js')), { cwd: src, shell: true, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

// The browser half of the determinism test, at /pool-test/ (local only).
mkdirSync(resolve(out, 'pool-test'), { recursive: true });
cpSync(resolve(src, 'test/pool/browser.html'), resolve(out, 'pool-test/index.html'));
const test = spawnSync('npx esbuild test/pool/browser-entry.mjs --bundle --format=iife --target=es2019 --outfile=' + JSON.stringify(resolve(out, 'pool-test/determinism.js')), { cwd: src, shell: true, stdio: 'inherit' });
if (test.status !== 0) process.exit(test.status ?? 1);

// wrangler dev can answer a revalidation with 304 for a file rebuilt since it
// started, so the copy's links get a fresh ?v= each time.
const page = resolve(out, 'pool/index.html');
const stamp = Date.now().toString(36);
writeFileSync(page, readFileSync(page, 'utf8').replace(/(\/pool\/pool\.(?:js|css))\?v=\d+/g, `$1?v=dev-${stamp}`));
console.log('Dev assets ready in', out);
