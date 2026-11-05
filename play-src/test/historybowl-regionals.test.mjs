import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionalLinks } from '../scripts/historybowl/fetch-regionals.mjs';
import { loadSettings, saveSettings, KEYS } from '../src/historybowl/store.js';
import { fetchTossups } from '../src/historybowl/api.js';
import { parsePacket, packetComplete } from '../src/historybowl/packet.js';

test('archive discovery selects regional A/B/C links and excludes nationals', () => {
  const row = (...cells) => `<tr>${cells.map((s) => `<td>${s}</td>`).join('')}</tr>`;
  const link = (name) => `<a href="https://www.iacompetitions.com/${name}.pdf">Round 1</a>`;
  const html = row('2025-2026', '2021-2022') + row('V/JV Nationals', 'V/JV Regional A Set')
    + row(link('national-final'), link('regional-a')) + row('', 'V/JV Regional B Set')
    + row('', link('regional-b')) + row('', 'V/JV Regional C Set') + row('', link('regional-c'))
    + row('', 'V/JV Nationals') + row('', link('national-round'));
  const links = regionalLinks(html);
  assert.deepEqual(links.map((x) => x.set), ['A', 'B', 'C']);
  assert.ok(links.every((x) => x.year === '2021-2022' && !x.url.includes('national')));
});

test('existing settings move to regionals without losing reading preferences or records', () => {
  const data = new Map([[KEYS.settings, JSON.stringify({ sources: ['bee', 'qb'], wpm: 310, answerSecs: 12 })], [KEYS.records, '["untouched"]']]);
  const storage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
  const settings = loadSettings(storage);
  assert.deepEqual(settings.sources, ['iac']);
  assert.equal(settings.wpm, 310);
  assert.equal(settings.answerSecs, 12);
  saveSettings(storage, { ...settings, sources: ['qb'] });
  assert.deepEqual(loadSettings(storage).sources, ['qb']);
  assert.equal(data.get(KEYS.records), '["untouched"]');
});

test('regional practice requests packet questions, carries filters, and never asks for nationals', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return Response.json({ tossups: [{ id: 'iac:test', source: 'iac-packet' }] });
  });
  const questions = await fetchTossups({ sources: ['iac'], teamPass: 'test-only', cats: ['History'], subs: ['European History'] }, 8);
  assert.equal(questions.length, 1);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, 'https://example.test');
  assert.equal(url.pathname, '/historybowl/api/iac/tossups');
  assert.equal(url.searchParams.get('subs'), 'European History');
  assert.equal(calls[0].init.headers['X-Team-Passcode'], 'test-only');
});

test('missing or invalid team access never silently falls back to another source', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 401 }); });
  await assert.rejects(fetchTossups({ sources: ['iac'], cats: ['History'] }, 8), /team passcode/);
  assert.equal(calls, 0);
  await assert.rejects(fetchTossups({ sources: ['iac'], teamPass: 'wrong', cats: ['History'] }, 8), /401/);
  assert.equal(calls, 1);
});

test('numeric quarter headings survive repeated-header detection and hyphenated sets have metadata', () => {
  const lines = ['2020-21 B-Set History Bowl Round 3', ...[1, 2, 3, 4].flatMap((n) => [`Quarter ${n}`, `1. Name example ${n}.`, `ANSWER: Example ${n}`])];
  const p = parsePacket(lines.map((text) => ({ text })));
  assert.equal(p.meta.set, 'B');
  assert.equal(p.q1.length, 1);
  assert.equal(p.q2.length, 1);
  assert.equal(p.q4.length, 1);
  assert.equal(packetComplete(p), false);
});

test('lightning menus are skipped and the shared stem stays with each question', () => {
  const lines = ['Third Quarter', 'The categories are:', '1. Ancient rulers', '2. Explorers', '3. Composers', 'Ancient rulers', 'Which ancient ruler...', '1. Crossed the river?', 'ANSWER: Example'];
  const p = parsePacket(lines.map((text) => ({ text })));
  assert.equal(p.q3.length, 1);
  assert.equal(p.q3[0].category, 'Ancient rulers');
  assert.equal(p.q3[0].questions[0].text, 'Ancient rulers. Which ancient ruler... Crossed the river?');
});
