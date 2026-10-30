import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountains,getDifficulty} from '../aspen/mountains.js';
import {onRequestGet} from '../functions/aspen/config.js';
import {onRequest} from '../functions/aspen/_middleware.js';
test('public configuration fails clearly without token and never caches it',async()=>{
 const missing=onRequestGet({env:{}});assert.equal(missing.status,503);
 const ready=onRequestGet({env:{CESIUM_ION_TOKEN:' test-browser-token '}});assert.equal(ready.headers.get('cache-control'),'no-store');assert.deepEqual(await ready.json(),{token:'test-browser-token'});
});
test('explorer replaces rather than duplicates restrictive CSP',async()=>{
 const response=await onRequest({next:async()=>new Response('page',{headers:{'Content-Security-Policy':"default-src 'none'",'X-Test':'preserved'}})});
 assert.equal(response.headers.get('X-Test'),'preserved');const policy=response.headers.get('Content-Security-Policy');assert.ok(policy.includes('worker-src'));assert.equal(policy.match(/default-src/g).length,1);assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
});
test('difficulty remains distinguishable without color and unknown is honest',()=>{
 assert.equal(getDifficulty('easy').dash,true);assert.equal(getDifficulty('intermediate').symbol,'■');assert.equal(getDifficulty('advanced').symbol,'◆');assert.equal(getDifficulty('expert').symbol,'◆◆');assert.equal(getDifficulty('invalid').label,'Unrated');
});
test('every mountain has valid static runs and lifts',async()=>{
 for(const m of mountains){const data=JSON.parse(await readFile(new URL(`../aspen/data/${m.id}.geojson`,import.meta.url)));assert.equal(data.type,'FeatureCollection');assert.ok(data.features.some(f=>f.properties['piste:type']==='downhill'),m.id+' runs');assert.ok(data.features.some(f=>f.properties.aerialway),m.id+' lifts');const ids=new Set();for(const f of data.features){assert.ok(!ids.has(f.id));ids.add(f.id);assert.equal(f.geometry.type,'LineString');assert.ok(f.geometry.coordinates.length>1);for(const [lon,lat] of f.geometry.coordinates){assert.ok(lon>-107.1&&lon<-106.7&&lat>39.05&&lat<39.3);}}}
});
