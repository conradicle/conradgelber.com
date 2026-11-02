import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {category,label,distance,sample} from '../hurricanes/model.js';
const read=async file=>JSON.parse(await readFile(new URL('../hurricanes/data/'+file,import.meta.url)));
test('category boundaries and missing wind',()=>{
 for(const [w,c] of [[63,0],[64,1],[82,1],[83,2],[95,2],[96,3],[112,3],[113,4],[136,4],[137,5]])assert.equal(category(w),c);
 assert.equal(category(null),null);assert.equal(label(33),'Below TS');assert.equal(label(34),'TS');assert.equal(label(null),'Unknown');
});
test('great-circle replay crosses dateline and holds observations until next fix',()=>{
 const a={time:0,lat:0,lon:179,wind:50},b={time:1000,lat:0,lon:-179,wind:100};
 const p=sample([a,b],500);assert.ok(Math.abs(Math.abs(p.lon)-180)<.001);assert.equal(p.wind,50);assert.equal(sample([a,b],1000).wind,100);
 assert.ok(distance(25.7617,-80.1918)<.001);
});
test('all static storms have consistent index, UTC order and reproducible closest approach',async()=>{
 const index=await read('index.json');assert.ok(index.length>1900);assert.equal(new Set(index.map(s=>s.id)).size,index.length);
 for(const row of index){const s=await read(row.id+'.json');assert.equal(s.id,row.id);assert.ok(s.points.length>0);assert.equal(s.peakCategory,category(s.peakWind));assert.equal(s.closest.miles,row.closestMiles);for(let i=0;i<s.points.length;i++){const p=s.points[i];assert.ok(Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180);assert.ok(p.pressure===null||p.pressure>0);if(i)assert.ok(p.time>s.points[i-1].time);}
 const p=sample(s.points,s.closest.time);assert.ok(Math.abs(distance(p.lat,p.lon)-s.closest.miles)<.01,s.id);
 }
 for(const [name,year] of [['Andrew',1992],['Irma',2017],['Wilma',2005],['Katrina',2005]])assert.equal(index.filter(s=>s.name===name&&s.year===year).length,1);
 const miami=index.filter(s=>s.displayName==='Great Miami Hurricane');assert.equal(miami.length,1);assert.equal(miami[0].year,1926);assert.ok(miami[0].closestMiles<20);
});
