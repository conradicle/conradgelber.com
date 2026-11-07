import test from 'node:test';
import assert from 'node:assert/strict';
import { fleet, repoRequest, safePath, githubGet } from '../functions/_lib/github-desk.js';
import { onRequestPost } from '../functions/hub/api/desk/index.js';

test('repository scope, safe paths, previews and bounded listings', async()=>{
 const old=globalThis.fetch, calls=[];
 globalThis.fetch=async url=>{calls.push(url);let body;
 if(url.includes('/user/repos?'))body=[{full_name:'owner/allowed',private:true,default_branch:'main'}];
 else if(url.endsWith('/contents/'))body=[{name:'note.md',path:'note.md',type:'file',size:3},{name:'picture.txt',path:'picture.txt',type:'file',size:3},{name:'.env',path:'.env',type:'file',size:5}];
 else if(url.endsWith('/contents/note.md'))body={type:'file',size:3,encoding:'base64',content:btoa('hey')};
 else if(url.endsWith('/contents/picture.txt'))body={type:'file',size:3,encoding:'base64',content:btoa('\0xx')};
 else throw Error('Unexpected request '+url);
 return new Response(JSON.stringify(body),{status:200});};
 try {const f=await fleet('scope-test');assert.equal(f.repositories[0].name,'owner/allowed');const d=await repoRequest('scope-test','owner/allowed','contents','');assert.deepEqual(d.entries.map(x=>x.path),['note.md','picture.txt']);assert.equal((await repoRequest('scope-test','owner/allowed','contents','note.md')).content,'hey');assert.equal((await repoRequest('scope-test','owner/allowed','contents','picture.txt')).type,'unavailable');await assert.rejects(repoRequest('scope-test','owner/other','contents',''),e=>e.status===404);await assert.rejects(repoRequest('scope-test','owner/allowed','contents','../note.md'),e=>e.status===404);assert.equal(calls.some(x=>x.includes('owner/other')),false);assert.equal(safePath('.env.production'),false);assert.equal(safePath('a/private-key.pem'),false);} finally {globalThis.fetch=old;}
});
test('conditional fetch revalidates with ETag',async()=>{const old=globalThis.fetch;let count=0,header;globalThis.fetch=async (_url,options)=>{count++;header=options.headers['If-None-Match'];return count===1?new Response('{"ok":true}',{headers:{etag:'"v1"'}}):new Response(null,{status:304});};try{await githubGet('etag-test','/repos/a/b/languages');assert.deepEqual(await githubGet('etag-test','/repos/a/b/languages',true),{ok:true});assert.equal(header,'"v1"');}finally{globalThis.fetch=old;}});
test('API rejects cross-origin requests and fails closed without credential',async()=>{const request=new Request('https://example.com/hub/api/desk/',{method:'POST',headers:{Origin:'https://other.example'},body:'{}'});assert.equal((await onRequestPost({request,env:{}})).status,403);const own=new Request('https://example.com/hub/api/desk/',{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});const res=await onRequestPost({request:own,env:{}});assert.equal(res.status,503);assert.match(res.headers.get('cache-control'),/no-store/);});
test('rate limits are recoverable and are not cached as successes',async()=>{const old=globalThis.fetch;let n=0;globalThis.fetch=async()=>{n++;return n===1?new Response('{}',{status:403,headers:{'retry-after':'2'}}):new Response('{"ok":true}');};try{await assert.rejects(githubGet('rate-test','/repos/a/b/languages'),e=>e.status===403&&e.retry==='2');assert.deepEqual(await githubGet('rate-test','/repos/a/b/languages'),{ok:true});}finally{globalThis.fetch=old;}});
