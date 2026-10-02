// Downloads the pinned Borderline inputs into data/borderline/raw/ (git
// ignored), checks each SHA-256, and unpacks the CShapes TopoJSON from the
// cshapes R package. Files already present with the right hash are kept.
//
//   node scripts/borderline/fetch-sources.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import xz from 'xz-decompress';
import { RAW_DIR, SOURCES } from './config.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchOne(key, src) {
  const dest = path.join(RAW_DIR, src.file);
  if (existsSync(dest) && sha256(readFileSync(dest)) === src.sha256) {
    console.log('ok      ' + src.file);
    return dest;
  }
  for (const url of src.urls) {
    const res = await fetch(url);
    if (!res.ok) { console.log('miss    ' + url + ' (' + res.status + ')'); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== src.sha256) {
      throw new Error(key + ': hash mismatch from ' + url + '\n  want ' + src.sha256 + '\n  got  ' + got);
    }
    writeFileSync(dest, buf);
    console.log('fetched ' + src.file + ' (' + buf.length + ' bytes)');
    return dest;
  }
  throw new Error(key + ': no URL answered');
}

// Minimal ustar reader: enough for a CRAN source tarball.
function untar(buf) {
  const files = new Map();
  for (let o = 0; o + 512 <= buf.length;) {
    const name = buf.toString('utf8', o, o + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const prefix = buf.toString('utf8', o + 345, o + 500).replace(/\0.*$/s, '');
    const size = parseInt(buf.toString('utf8', o + 124, o + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    files.set(prefix ? prefix + '/' + name : name, buf.subarray(o + 512, o + 512 + size));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function unxz(buf) {
  const stream = new xz.XzReadableStream(new Blob([buf]).stream());
  return Buffer.from(await new Response(stream).arrayBuffer());
}

mkdirSync(RAW_DIR, { recursive: true });
const got = {};
for (const [key, src] of Object.entries(SOURCES)) got[key] = await fetchOne(key, src);

const topoOut = path.join(RAW_DIR, 'cshapes_2_gw.topojson');
if (!existsSync(topoOut)) {
  const files = untar(gunzipSync(readFileSync(got.cshapes)));
  const xz = files.get('cshapes/inst/extdata/cshapes_2_gw.topojson.xz');
  if (!xz) throw new Error('cshapes tarball: topojson not found');
  writeFileSync(topoOut, await unxz(xz));
  console.log('unpacked cshapes_2_gw.topojson');
}
