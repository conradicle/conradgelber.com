import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, allowed, loadDesk } from '../functions/_lib/desk.js';
import { newSessionCookie, hasSession, revokeSession } from '../functions/_lib/auth.js';
import { onRequest as gate } from '../functions/_middleware.js';

test('importer admits only intended records and fields', () => {
  assert.ok(allowed.test('projects/example.md'));
  for (const p of ['.env','projects/.env','projects/key.pem','people/person.md','projects/../secret.md']) assert.equal(allowed.test(p), false);
  const doc=parse('projects/example.md','# Project: Example\n\n- Status: reported\n- Confidence: uncertain\n\n## Objective\nA goal\n\n## Passwords\nsecret\n\n## Related records\n- conversations/example.md\n- people/example.md');
  assert.equal(doc.status,'reported'); assert.equal(doc.sections.Objective,'A goal'); assert.equal(doc.sections.Passwords,undefined); assert.deepEqual(doc.related,['conversations/example.md']);
});
test('session revocation rejects copied cookies and private API requests', async () => {
  const rows=new Map(); const db={prepare(sql){return {bind(...v){return {async run(){if(sql.startsWith('INSERT'))rows.set(v[0],v[1]);if(sql.startsWith('DELETE FROM hub_sessions WHERE nonce'))rows.delete(v[0]);},async first(){return rows.has(v[0])?{}:null;}}}}}};
  const env={DB:db,PIN_SALT_B64:'a',PIN_HASH_B64:'a',SESSION_SECRET:'test-secret'};
  const cookie=(await newSessionCookie(env)).split(';')[0]; const req=new Request('https://example.com/hub/api/desk/',{headers:{cookie}});
  assert.equal(await hasSession(req,env),true); const realNow=Date.now; try { Date.now=()=>realNow()+31*86400000; assert.equal(await hasSession(req,env),false); } finally { Date.now=realNow; } await revokeSession(req,env); assert.equal(await hasSession(req,env),false);
  const response=await gate({request:req,env,next:()=>{throw Error('must not pass');}});assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
});

test('sync fetches allowed linked files only, uses cache and refresh bypasses it', async () => {
  const old=globalThis.fetch; let requests=[];
  globalThis.fetch=async url=>{requests.push(url);let body;if(url.includes('/git/trees/'))body={tree:[{type:'blob',path:'projects/demo.md',size:20},{type:'blob',path:'conversations/note.md',size:20},{type:'blob',path:'people/private.md',size:20}],truncated:false};else if(url.includes('/contents/projects/'))body={encoding:'base64',size:20,content:btoa('# Project: Demo\n\n## Related records\n- conversations/note.md\n- people/private.md')};else if(url.includes('/contents/conversations/'))body={encoding:'base64',size:20,content:btoa('# Note\n\n## Summary\nExample')};else if(url.includes('/commits?'))body=[];else throw Error('unexpected path');return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});};
  try { const a=await loadDesk('unit-test',false,'example/memory');assert.equal(a.projects.length,1);assert.equal(a.documents.length,1);assert.ok(!requests.some(x=>x.includes('people/')));let count=requests.length;await loadDesk('unit-test',false,'example/memory');assert.equal(requests.length,count);await loadDesk('unit-test',true,'example/memory');assert.ok(requests.length>count); } finally {globalThis.fetch=old;}
});
