// Imports the 12axes question bank and ideology coordinates from the MIT
// licensed politicaltests/12axes source, pinned to one commit, into
// data/12axes/questions.json and data/12axes/ideologies.json. Each file is
// hash-checked, then evaluated as plain data in an empty vm context (the
// source files are `questions = [...]` and `ideologies = [...]`).
//
//   node scripts/12axes/import-source.mjs
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const COMMIT = '5a508de557cc88eb7e9a44d89f45501dbe912d61';
const BASE = `https://raw.githubusercontent.com/politicaltests/politicaltests.github.io/${COMMIT}/`;
const SOURCES = {
  questions: { file: '12axes/questions.js', sha256: '7706bda173d53c894595e47a2391445829fc21d3befabe7ca3d2f085a153e176' },
  ideologies: { file: '12axes/ideologies.js', sha256: 'd56fd5e0a8cf5ab800a8ae1955a21073069667421a2b7f3a658c2c3881e962bc' },
};

// The source's bucket order inside each axis: +4, +3, +2, +1, -1, -2, -3, -4.
// Positive buckets lean to the axis's first pole (see src/12axes/axes.js).
const BUCKETS = [4, 3, 2, 1, -1, -2, -3, -4];
const PER_BUCKET = 3;

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../data/12axes');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function load(key) {
  const src = SOURCES[key];
  const res = await fetch(BASE + src.file);
  if (!res.ok) throw new Error(src.file + ': ' + res.status);
  const text = await res.text();
  const got = sha256(text);
  if (got !== src.sha256) throw new Error(`${src.file}: hash mismatch\n  want ${src.sha256}\n  got  ${got}`);
  const ctx = vm.createContext(Object.create(null));
  vm.runInContext(text, ctx, { timeout: 1000 });
  return ctx[key];
}

const raw = await load('questions');
if (raw.length !== 12) throw new Error('expected 12 axes, got ' + raw.length);
const questions = [];
raw.forEach((axis, a) => {
  if (axis.length !== BUCKETS.length) throw new Error(`axis ${a}: ${axis.length} buckets`);
  axis.forEach((bucket, b) => {
    if (bucket.length !== PER_BUCKET) throw new Error(`axis ${a} bucket ${b}: ${bucket.length} statements`);
    bucket.forEach((text, k) => {
      questions.push({
        id: a * 24 + b * PER_BUCKET + k,
        axis: a,
        bucket: BUCKETS[b],
        dir: BUCKETS[b] > 0 ? 1 : -1,
        text: text.trim(),
      });
    });
  });
});

const ideologies = (await load('ideologies')).map((x) => ({
  name: x.name,
  link: x.link,
  stats: { econ: x.stats.econ, govt: x.stats.govt, dipl: x.stats.dipl, scty: x.stats.scty },
}));

mkdirSync(OUT, { recursive: true });
const header = { source: `https://github.com/politicaltests/politicaltests.github.io/tree/${COMMIT}/12axes`, license: 'MIT, Copyright (c) 2020 8values (SapplyValues); see /12axes/LICENSE-12axes.txt' };
writeFileSync(path.join(OUT, 'questions.json'), JSON.stringify({ ...header, questions }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'ideologies.json'), JSON.stringify({ ...header, ideologies }, null, 1) + '\n');
console.log(`wrote ${questions.length} questions and ${ideologies.length} ideologies to ${OUT}`);
