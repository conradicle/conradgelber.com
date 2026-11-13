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
test('every mountain has a footprint on the real terrain around its runs',async()=>{
 const fp=JSON.parse(await readFile(new URL('../aspen/data/footprints.json',import.meta.url)));
 for(const m of mountains){const f=fp[m.id];assert.ok(f,m.id+' footprint');assert.ok(f.ring.length>=8,m.id+' ring');for(const [lon,lat] of f.ring){assert.ok(lon>-107.1&&lon<-106.7&&lat>39.05&&lat<39.3);}const [cx,cy]=f.center;assert.ok(Math.abs(cx-m.lon)<0.03&&Math.abs(cy-m.lat)<0.03,m.id+' center near camera target');}
});

// Execute startup with the real control flow, stopping before overlays are built.
// This catches construction order, fallback attachment and failed-attempt cleanup.
async function startupHarness({googleError, fallbackError} = {}) {
 const {runInNewContext} = await import('node:vm');
 const source = (await readFile(new URL('../aspen/viewer.js', import.meta.url), 'utf8'))
   .replace(/^import .*;$/m, '').replaceAll('export ', '');
 const calls = [], warnings = [], viewers = [];
 const event = {addEventListener: () => () => calls.push('remove-event')};
 const C = {
   Ion: {},
   Viewer: class {
     constructor() {
       calls.push('viewer'); viewers.push(this); this.destroyed = false;
       this.canvas = {addEventListener() {}, removeEventListener() {}};
       this.scene = {globe: {show: true}, renderError: event};
       this.imageryLayers = {addImageryProvider: p => { this.imagery = p; }};
     }
     resize() { calls.push('resize'); }
     render() { calls.push('render'); }
     isDestroyed() { return this.destroyed; }
     destroy() { assert.equal(this.destroyed, false); this.destroyed = true; calls.push('destroy'); }
   },
   createGooglePhotorealistic3DTileset: async () => {
     assert.deepEqual(calls.slice(0, 3), ['viewer', 'resize', 'render']);
     calls.push('google');
     if (googleError) throw googleError;
     return {isDestroyed: () => false, destroy: () => calls.push('destroy-tileset')};
   },
   ArcGISTiledElevationTerrainProvider: {fromUrl: async () => {
     if (fallbackError) throw fallbackError;
     return 'terrain';
   }},
   ArcGisMapServerImageryProvider: {fromUrl: async () => 'imagery'},
   ClassificationType: {TERRAIN: 'terrain', CESIUM_3D_TILE: 'tiles'},
   HeightReference: {CLAMP_TO_TERRAIN: 'terrain', CLAMP_TO_3D_TILE: 'tiles'},
 };
 const createScene = runInNewContext(source + '\ncreateScene', {
   window: {Cesium: C}, fetch: async () => ({ok: true, json: async () => ({token: 'test'})}),
   matchMedia: () => ({matches: false}), AbortController, cancelAnimationFrame() {},
   console: {warn: (...args) => warnings.push(args), error() {}}, queueMicrotask,
 });
 const stop = new Error('Stop before overlay construction');
 let selectedSource;
 let failure;
 try { await createScene('cesium', [], {onSource: source => { selectedSource = source; throw stop; }}); }
 catch (error) { failure = error; }
 return {calls, warnings, viewers, failure, stop, selectedSource};
}

test('graphics context is initialized before Google tileset construction', async () => {
 const result = await startupHarness();
 assert.equal(result.selectedSource, 'google');
 assert.equal(result.failure, result.stop);
 assert.equal(result.viewers[0].destroyed, true);
 assert.equal(result.calls.filter(c => c === 'destroy').length, 1);
});

for (const statusCode of [401, 403, 429, 503, undefined]) {
 test(`imagery startup failure ${statusCode ?? 'network'} uses the existing viewer for fallback`, async () => {
   const original = Object.assign(new Error('Imagery failed'), {statusCode});
   const result = await startupHarness({googleError: original});
   assert.equal(result.selectedSource, 'esri');
   assert.equal(result.viewers.length, 1);
   assert.equal(result.viewers[0].terrainProvider, 'terrain');
   assert.equal(result.viewers[0].imagery, 'imagery');
   assert.equal(result.viewers[0].scene.globe.show, true);
   assert.equal(result.warnings[0][1], original);
   assert.equal(result.failure, result.stop);
   assert.equal(result.viewers[0].destroyed, true);
 });
}

test('both startup failures preserve causes, report accurately and destroy the viewer', async () => {
 const original = new Error('Network failed'), alternate = new Error('Esri failed');
 const result = await startupHarness({googleError: original, fallbackError: alternate});
 assert.match(result.failure.message, /imagery and alternate terrain could not start/i);
 assert.equal(result.failure.code, undefined);
 assert.equal(result.failure.cause.errors[0], original);
 assert.equal(result.failure.cause.errors[1], alternate);
 assert.equal(result.viewers[0].destroyed, true);
});
