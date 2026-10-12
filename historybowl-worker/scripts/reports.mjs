// List or clear the error reports sent from the page's "Report an error" button.
//   npm run reports            list them (question id, source, note, time)
//   npm run reports -- --clear delete every report listed
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = resolve(import.meta.dirname, '..');
const wrangler = (args) => execFileSync(process.execPath, [resolve(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd, encoding: 'utf8' });
const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--binding', 'REPORTS', '--remote', '--prefix', 'report:']));
if (!keys.length) console.log('No reports.');
for (const { name } of keys) {
  const r = JSON.parse(wrangler(['kv', 'key', 'get', name, '--binding', 'REPORTS', '--remote']));
  console.log(`${r.at}  ${r.qid}  [${r.source}]  ${r.note || '(no note)'}`);
  if (process.argv.includes('--clear')) wrangler(['kv', 'key', 'delete', name, '--binding', 'REPORTS', '--remote']);
}
if (process.argv.includes('--clear') && keys.length) console.log(`Deleted ${keys.length}.`);
