// Upload the imported IAC packets to Workers KV (binding IAC).
//   npm run upload-iac             to the live namespace
//   npm run upload-iac -- --local  to local dev (wrangler dev)
// Reads play-src/data/historybowl/iac/kv.json, written by
// play-src/scripts/historybowl/import-packets.mjs. That folder is git-ignored.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = resolve(import.meta.dirname, '..');
const file = resolve(cwd, '../play-src/data/historybowl/iac/kv.json');
if (!existsSync(file)) {
  console.error(`No ${file}. Run play-src/scripts/historybowl/import-packets.mjs first.`);
  process.exit(1);
}
const local = process.argv.includes('--local');
const args = ['kv', 'bulk', 'put', file, '--binding', 'IAC', local ? '--local' : '--remote'];
if (local) args.push('-c', 'wrangler.dev.jsonc');
execFileSync(process.execPath, [resolve(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd, stdio: 'inherit' });
