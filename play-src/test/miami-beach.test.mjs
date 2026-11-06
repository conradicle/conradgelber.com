import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as T from 'three';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {point,multiPolygon} from '@turf/helpers';
import {project,unproject,heightFor,tileKey} from '../src/miami-beach/geo.js';
import {buildingMesh} from '../src/miami-beach/geometry.js';
const base=fileURLToPath(new URL('../../miami-beach/data/',import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(base+n,'utf8'));
const manifest=read('manifest.json'),overview=read('overview.json'),environment=read('environment.json');
const all=manifest.tiles.map(t=>read(`tiles/${t.id}.json`));

test('projection round trips at municipality extremes and negative tile edges',()=>{
  for(const p of [[-80.19,25.765],[-80.12,25.878],[-80.135,25.815]])assert.ok(Math.hypot(...unproject(project(p)).map((n,i)=>n-p[i]))<1e-9);
  assert.equal(tileKey([-1,-1]),'-1_-1');assert.equal(tileKey([650,0]),'1_0');
});
test('undocumented source height is never silently converted; estimates remain explicit',()=>{
  assert.deepEqual(heightFor({HEIGHT:100},4),{height:12.8,heightSource:'city-floor-estimate'});
  assert.deepEqual(heightFor({HEIGHT:100}),{height:6.4,heightSource:'fallback-estimate'});
  assert.deepEqual(heightFor({},90),{height:6.4,heightSource:'fallback-estimate'});
});
test('every inventory footprint appears exactly once in overview and detail, across all districts',()=>{
  const buildings=all.flatMap(t=>t.buildings),ids=buildings.map(b=>b.id);
  assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,manifest.stats.buildings);
  assert.deepEqual([...ids].sort((a,b)=>a-b),overview.map(b=>b.id).sort((a,b)=>a-b));
  assert.equal(manifest.stats.sourceBuildings,manifest.stats.buildings);
  assert.equal(all.reduce((n,t)=>n+t.trees.length,0),manifest.stats.trees);
  for(const geo of [[-80.134,25.779],[-80.126,25.82],[-80.128,25.86],[-80.158,25.79]]){
    const p=project(geo);assert.ok(buildings.some(b=>Math.hypot(b.center[0]-p[0],b.center[1]-p[1])<900),`No coverage near ${geo}`);
  }
  for(const t of all)for(const b of t.buildings){assert.equal(tileKey(b.center),t.id);assert.ok(b.height>=3.2&&Number.isFinite(b.height));}
});
test('coastline mask leaves Atlantic and bay as water, and preserves South Beach land',()=>{
  const land=multiPolygon(environment.land);
  for(const geo of [[-80.115,25.81],[-80.16,25.82],[-80.18,25.79]])assert.equal(booleanPointInPolygon(point(project(geo)),land),false,`Water became land at ${geo}`);
  assert.equal(booleanPointInPolygon(point(project([-80.14,25.78])),land),true);
  assert.ok(environment.parks.length>20,'City green spaces missing');
});
test('roof triangulation preserves holes and per-building selection ranges',()=>{
  const material=new T.MeshStandardMaterial();
  const b={id:1,color:'#ffffff',height:10,polygons:[[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[4,6],[6,6],[6,4],[4,4]]]]};
  const mesh=buildingMesh([b],material),a=mesh.geometry.attributes.position;
  let area=0;for(let i=0;i<a.count;i+=3){if(a.getY(i)!==12||a.getY(i+1)!==12||a.getY(i+2)!==12)continue;area+=Math.abs((a.getX(i+1)-a.getX(i))*(a.getZ(i+2)-a.getZ(i))-(a.getX(i+2)-a.getX(i))*(a.getZ(i+1)-a.getZ(i)))/2;}
  assert.equal(area,96);assert.equal(mesh.userData.ranges[0].end,a.count);assert.ok([...a.array].every(Number.isFinite));mesh.geometry.dispose();material.dispose();
});
test('source manifest is traceable and every glTF landmark is a real binary asset',()=>{
  for(const source of manifest.sources){assert.match(source.url,/^https:\/\//);assert.match(source.sha256,/^[0-9a-f]{64}$/);assert.ok(source.count>0);}
  for(const l of read('landmarks.json').filter(l=>l.asset)){const bytes=fs.readFileSync(fileURLToPath(new URL(`../../miami-beach/assets/${l.asset}`,import.meta.url)));assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(8),bytes.length);}
});
test('pilot meshes preserve metre geometry, record ranges and exact compressed round trips',()=>{
  const pilot=read('realism/manifest.json');
  assert.equal(pilot.geometryUnits,'metres');assert.equal(pilot.verticalDatum,'NAVD88');
  const used=new Set();
  for(const region of pilot.regions){
    const bytes=fs.readFileSync(base+'realism/'+region.asset),compressed=fs.readFileSync(base+'realism/'+region.compressedAsset);
    assert.deepEqual(gunzipSync(compressed),bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),region.sha256);
    assert.ok(compressed.length<bytes.length/4);
    const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
    const count=gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION].count;
    const records=read('realism/'+region.records);let end=0;
    assert.equal(records.length,region.buildings);
    for(const r of records){assert.equal(r.start,end);end=r.end;assert.ok(r.end>r.start);assert.ok(r.height>1&&r.height<250);assert.ok(Math.abs(r.sourceTop-r.sourceGround-r.height)<1e-5);if(r.id!==null){assert.ok(!used.has(r.id));used.add(r.id);}}
    assert.equal(end,count);
  }
});
test('pilot distinguishes validated low-rise roofs, unresolved towers and actual imagery coverage',()=>{
  const v=read('realism/validation.json'),o=v.regions.find(r=>r.id==='ocean-drive'),d=v.regions.find(r=>r.id==='diamond');
  assert.ok(o.checked>100&&o.within2m/o.checked>.8);assert.ok(o.medianAbsDifference<1);
  assert.ok(d.largest.some(r=>Math.abs(r.laser.difference)>10),'Tower discrepancy must remain visible');
  const noaa=read('realism/noaa.json'),photo=noaa.regions.find(r=>r.id==='ocean-drive').imagery;
  assert.equal(photo.license,'CC0-1.0');assert.ok(photo.coverage>.95);assert.ok(fs.statSync(base+'realism/'+photo.file).size>100000);
  assert.equal(noaa.regions.find(r=>r.id==='diamond').imagery,null);
  for(const id of ['ocean-drive','diamond']){const env=read('realism/'+id+'-environment.json');assert.equal(env.terrain.elevations.length,env.terrain.size**2);assert.ok(env.terrain.elevations.every(Number.isFinite));assert.ok(env.trees.length>0);assert.ok(env.trees.some(t=>t.heightSource==='nearby-laser-canopy'));}
});
