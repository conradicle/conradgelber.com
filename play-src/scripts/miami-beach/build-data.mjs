import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';
import booleanIntersects from '@turf/boolean-intersects';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointOnFeature from '@turf/point-on-feature';
import simplify from '@turf/simplify';
import {point} from '@turf/helpers';
import pc from 'polygon-clipping';
import {project,tileKey,heightFor,styleFor,ORIGIN} from '../../src/miami-beach/geo.js';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const raw=path.join(root,'play-src/data/miami-beach/raw');
const out=path.join(root,'miami-beach/data');
await fs.mkdir(path.join(out,'tiles'),{recursive:true});
const read=async n=>JSON.parse(await fs.readFile(path.join(raw,`${n}.json`),'utf8'));
const meta=async n=>JSON.parse(await fs.readFile(path.join(raw,`${n}.metadata.json`),'utf8'));
const boundary=(await read('boundary')).features[0];
const asMulti=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const round=n=>Math.round(n*20)/20;
const localRing=r=>r.map(c=>project(c).map(round));
const localMulti=g=>asMulti(g).map(p=>p.map(localRing));
const boundsLocal=localMulti(boundary.geometry);
const inside=f=>booleanIntersects(f,boundary);
const center=f=>pointOnFeature(f).geometry.coordinates;
const polygonFeature=coords=>({type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:coords}});
const tiles=new Map();
function tile(c) {const key=tileKey(c);if(!tiles.has(key)) tiles.set(key,{id:key,buildings:[],trees:[]});return tiles.get(key);}
const floors=(await read('floors')).features;
const grid=new Map();
for(const f of floors){const c=project(center(f));const k=tileKey(c,100);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(f);}
const buildings=[];const stats={sourceBuildings:0,buildings:0,floorEstimates:0,fallbackEstimates:0,rawHeightAvailable:0,trees:0,roads:0,parks:0};
for(const f of (await read('buildings')).features) {
  if(!inside(f))continue;
  stats.sourceBuildings++;
  const c=center(f);const p=project(c);const gx=Math.floor(p[0]/100),gz=Math.floor(p[1]/100);
  let match;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++) {
    for(const candidate of grid.get(`${gx+dx}_${gz+dz}`)||[]) {
      if(candidate.properties.FLOORS>0 && booleanPointInPolygon(point(c),candidate)) {match=candidate;break;}
    }
  }
  const h=heightFor(f.properties,Number(match?.properties.FLOORS||0));
  const clipped=pc.intersection(localMulti(f.geometry),boundsLocal);
  if(!clipped.length)continue;
  const style=styleFor(f.properties.OBJECTID,c[1],h.height);
  const b={id:f.properties.OBJECTID,polygons:clipped,center:p.map(round),...h,...style,sourceHeight:f.properties.HEIGHT??null,year:f.properties.YEARUPDATE??null,floors:match?.properties.FLOORS||null};
  buildings.push(b);tile(b.center).buildings.push(b);
  stats[h.heightSource==='city-floor-estimate'?'floorEstimates':'fallbackEstimates']++;
  if(b.sourceHeight>0)stats.rawHeightAvailable++;
}
stats.buildings=buildings.length;
const roads=[];
for(const f of (await read('roads')).features){if(!inside(f))continue;const lines=f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates];for(const line of lines){roads.push({name:f.properties.FULL_NAME||'',class:f.properties.CLASS,points:line.map(c=>project(c).map(round))});}}
stats.roads=roads.length;
const parks=[];
for(const f of (await read('parks')).features){if(!inside(f))continue;const polygons=pc.intersection(localMulti(f.geometry),boundsLocal);if(polygons.length)parks.push({name:f.properties.NAME,polygons});}
stats.parks=parks.length;
for(const f of (await read('landuse')).features){if(!inside(f))continue;const polygons=pc.intersection(localMulti(f.geometry),boundsLocal);if(polygons.length)parks.push({name:'Recreation / conservation land use',kind:f.properties.LU===519?'beach':'green',polygons});}
// Golf-course zoning supplies the larger green areas that are absent from
// the county-owned parks inventory. Zoning is not a vegetation survey.
for(const f of (await read('zoning')).features){if(f.properties.ZONING_CODE!=='GC'||!inside(f))continue;const polygons=pc.intersection(localMulti(f.geometry),boundsLocal);if(polygons.length)parks.push({name:'Golf course zoning',polygons});}
stats.greenAreas=parks.length;
for(const f of (await read('trees')).features){if(!booleanPointInPolygon(f,boundary)||f.properties.CONDITION==='Dead')continue;const c=project(f.geometry.coordinates).map(round);tile(c).trees.push({p:c,palm:/palm|coconut/i.test(f.properties.TREE_SPECI||''),species:f.properties.TREE_SPECI||'Unknown'});stats.trees++;}
// Derive actual dry land from the county's planimetric water mask. Municipal
// boundary alone includes open water and cannot be used as a coastline.
const water=(await read('water')).features.filter(f=>Number(f.properties.WATER)===1).map(f=>localMulti(f.geometry));
const extent=[[[-7400,-8500],[4400,-8500],[4400,8500],[-7400,8500],[-7400,-8500]]];
const waterUnion=pc.union(...water);
const land=pc.difference(extent,waterUnion);
const cityLand=pc.intersection(boundsLocal,land);
const neighborhoods=(await read('neighborhoods')).features.filter(inside).map(f=>({name:f.properties.NAME||f.properties.NEIGHBORHD||f.properties.NEIGHBORHOOD||Object.values(f.properties).find(v=>typeof v==='string')||'Neighborhood',polygons:pc.intersection(localMulti(f.geometry),boundsLocal)}));
const manifest={version:1,origin:ORIGIN,tileSize:650,stats,tiles:[],sources:[],limitations:['Building heights are estimates from city floor counts or a 6.4 m fallback. County HEIGHT values have undocumented units and are retained without conversion.','Footprints include historical source vintages; completeness describes the selected GIS inventory, not every present-day structure.','Flat ground, approximate bridge elevations and interpretive facades. Not a surveyed or flood simulation model.']};
for(const [id,t] of [...tiles].sort()){const [x,z]=id.split('_').map(Number);manifest.tiles.push({id,bounds:[x*650,z*650,(x+1)*650,(z+1)*650],buildings:t.buildings.length,trees:t.trees.length});await fs.writeFile(path.join(out,'tiles',`${id}.json`),JSON.stringify(t));}
for(const name of ['boundary','buildings','floors','roads','neighborhoods','trees','water','parks','landuse','zoning']){const m=await meta(name);const checksum=createHash('sha256').update(await fs.readFile(path.join(raw,`${name}.json`))).digest('hex');manifest.sources.push({name,url:m.url,retrievedAt:m.retrievedAt,count:m.count,sha256:checksum,description:m.metadata.description||'',copyright:m.metadata.copyrightText||''});}
// Overview retains every footprint, simplifying vertices only, never substituting
// centroid boxes. Detail tiles are loaded on demand and evicted by distance.
const overview=buildings.map(({id,polygons,height,color,center})=>({id,polygons:simplify(polygonFeature(polygons),{tolerance:.75,highQuality:true}).geometry.coordinates,height,color,center}));
await fs.writeFile(path.join(out,'overview.json'),JSON.stringify(overview));
await fs.writeFile(path.join(out,'environment.json'),JSON.stringify({land,cityLand,boundary:boundsLocal,roads,parks,neighborhoods}));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(stats,null,2));
console.log(`Built ${tiles.size} spatial tiles`);
