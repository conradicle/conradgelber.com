// Download only the regional A/B/C packets linked by IAC. The PDFs and
// source manifest stay in the git-ignored IAC folder, outside public assets.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHIVE = 'https://www.iacompetitions.com/resources-national-history-bowl/';
export function regionalLinks(html) {
  const years = [];
  const sections = [];
  const links = new Map();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    cells.forEach((cell, i) => {
      const text = cell.replace(/<[^>]*>/g, '').trim();
      if (/^20\d\d-20\d\d$/.test(text)) years[i] = text;
      const set = text.match(/^V\/JV Regional ([ABC]) Set$/i);
      if (set) sections[i] = set[1].toUpperCase();
      else if (/^V\/JV Nationals$/i.test(text)) sections[i] = null;
      if (!sections[i] || !years[i]) return;
      for (const a of cell.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const url = new URL(a[1].replace(/&amp;/g, '&'), ARCHIVE);
        if (url.hostname !== 'www.iacompetitions.com' || !/\.pdf$/i.test(url.pathname)) continue;
        links.set(url.href, { url: url.href, file: basename(url.pathname), year: years[i], set: sections[i] });
      }
    });
  }
  return [...links.values()];
}

async function main() {
  const out = resolve(import.meta.dirname, '../../data/historybowl/iac/raw');
  mkdirSync(out, { recursive: true });
  const res = await fetch(ARCHIVE);
  if (!res.ok) throw new Error(`Archive: HTTP ${res.status}`);
  const links = regionalLinks(await res.text());
  if (!links.length) throw new Error('No regional links found; check the archive layout.');
  writeFileSync(resolve(out, 'sources.json'), JSON.stringify({ archive: ARCHIVE, packets: links }, null, 2));
  let next = 0;
  let done = 0;
  const failures = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < links.length) {
      const item = links[next++];
      const file = resolve(out, item.file);
      try {
        if (!existsSync(file)) {
          const pdf = await fetch(item.url, { signal: AbortSignal.timeout(45000) });
          if (!pdf.ok) throw new Error(`HTTP ${pdf.status}`);
          const bytes = Buffer.from(await pdf.arrayBuffer());
          if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Not a PDF');
          writeFileSync(file, bytes);
        }
        if (++done % 25 === 0) console.log(`${done}/${links.length} regional PDFs downloaded`);
      } catch (e) { failures.push(`${item.file}: ${e.message}`); }
    }
  }));
  console.log(`${done}/${links.length} regional PDFs available in ${out}`);
  if (failures.length) throw new Error(failures.join('\n'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
