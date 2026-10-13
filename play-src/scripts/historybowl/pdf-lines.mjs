// Text lines from a PDF, in reading order, with bold runs marked <b>...</b>
// (the required part of an NHBB answer is printed in bold). Uses pdfjs-dist.
// Local tooling only: never part of the page.

import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** [{ text, html, page }] for every line of every page. */
export async function pdfLines(file) {
  const data = new Uint8Array(readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    // Loading the operator list makes the page's fonts (and their names) available.
    await page.getOperatorList();
    const content = await page.getTextContent();
    const bold = new Map();
    const isBold = (fontName) => {
      if (!bold.has(fontName)) {
        let name = '';
        try {
          const f = page.commonObjs.get(fontName);
          name = `${f.name || ''} ${f.loadedName || ''} ${f.bold ? 'bold' : ''}`;
        } catch (e) {
          name = (content.styles[fontName] && content.styles[fontName].fontFamily) || '';
        }
        bold.set(fontName, /bold|black|heavy|semibold|demi/i.test(name));
      }
      return bold.get(fontName);
    };
    // Group text runs into lines by their baseline.
    const rows = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, runs: [] }));
      row.runs.push({ x, end: x + (it.width || 0), str: it.str, bold: isBold(it.fontName) });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.runs.sort((a, b) => a.x - b.x);
      let text = '';
      let html = '';
      let prevEnd = null;
      for (const r of row.runs) {
        // A visible gap between runs is a space.
        const gap = prevEnd !== null && r.x - prevEnd > 1.2 && !/\s$/.test(text) && !/^\s/.test(r.str) ? ' ' : '';
        text += gap + r.str;
        html += gap + (r.bold && r.str.trim() ? `<b>${escape(r.str)}</b>` : escape(r.str));
        prevEnd = r.end;
      }
      html = html.replace(/<\/b>(\s*)<b>/g, '$1');
      if (text.trim()) out.push({ text: text.trim(), html: html.trim(), page: p });
    }
  }
  await doc.cleanup();
  return out;
}
