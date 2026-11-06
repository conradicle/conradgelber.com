// Offline conversion of the county's public I3S 1.6 mesh, retaining source IDs.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {project} from '../../src/miami-beach/geo.js';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const raw=`${root}/play-src/data/miami-beach/raw/i3s`;
const out=`${root}/miami-beach/data/realism`;
await fs.mkdir(raw,{recursive:true});await fs.mkdir(out,{recursive:true});
globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
const service='https://tiles.arcgis.com/tiles/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Buildings_Models_3D/SceneServer/layers/0';
const regions=[
 {id:'ocean-drive',name:'Ocean Drive realism pilot',bbox:[-80.1347,25.7748,-80.1292,25.7795],geo:[-80.1317,25.777],offset:[180,170,270]},
 {id:'diamond',name:'Blue & Green Diamond height check',bbox:[-80.123,25.822,-80.1192,25.8254],geo:[-80.121,25.8233],offset:[280,240,360]},
];
async function cached(relative,binary=false){const filename=`${raw}/${relative.replaceAll('/','_')}.${binary?'bin':'json'}`;try{const b=await fs.readFile(filename);return binary?b:JSON.parse(b);}catch{}
 for(let i=0;i<4;i++){try{const r=await fetch(`${service}/${relative}${binary?'':'?f=json'}`,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`${r.status} ${relative}`);const b=Buffer.from(await r.arrayBuffer());if(!binary&&JSON.parse(b).error)throw new Error(JSON.stringify(JSON.parse(b).error));await fs.writeFile(filename,b);return binary?b:JSON.parse(b);}catch(e){if(i===3)throw e;await new Promise(r=>setTimeout(r,1000*2**i));}}
}
const layer=await cached('');
if(layer.store.version!=='1.6'||layer.spatialReference.wkid!==4326||layer.heightModelInfo.heightUnit!=='meter')throw new Error('Unexpected source CRS/schema');
function intersects(mbs,b){const [x,z]=project(mbs),a=project([b[0],b[3]]),d=project([b[2],b[1]]);return Math.hypot(Math.max(a[0]-x,0,x-d[0]),Math.max(a[1]-z,0,z-d[1]))<mbs[3];}
function strings(b){const n=b.readUInt32LE(0);let offset=8+n*4;return Array.from({length:n},(_,i)=>{const count=b.readUInt32LE(8+i*4);const value=b.toString('utf8',offset,offset+count).replaceAll('\0','');offset+=count;return value;});}
const inventory=JSON.parse(await fs.readFile(`${root}/play-src/data/miami-beach/raw/buildings.json`,'utf8')).features;
const byUnique=new Map(inventory.map(f=>[f.properties.UNIQUEID,f]));
const report={version:1,service,geometryUnits:'metres',verticalDatum:'NAVD88',sourceItem:'https://www.arcgis.com/home/item.html?id=ce420278a45a4bf4a349c37c197263b3',retrievedAt:new Date().toISOString(),regions:[]};
const exporter=new GLTFExporter();
for(const region of regions){
 const leaves=[];let visits=0;
 async function visit(id){const n=await cached(`nodes/${id}`);visits++;if(n.children?.length){for(const child of n.children)if(intersects(child.mbs,region.bbox))await visit(child.id);}else if(n.geometryData?.length)leaves.push(n);}
 await visit('root');console.log(`${region.id}: ${visits} nodes, ${leaves.length} leaves`);
 const vertices=[],colors=[],records=[],seen=new Set();
 for(const node of leaves){
  const [b,features,unique,years]=await Promise.all([cached(`nodes/${node.id}/geometries/0`,true),cached(`nodes/${node.id}/features/0`),cached(`nodes/${node.id}/attributes/f_0/0`,true).then(strings),cached(`nodes/${node.id}/attributes/f_4/0`,true)]);
  const count=b.readUInt32LE(0),featureCount=b.readUInt32LE(4);if(count%3||featureCount!==features.featureData.length||unique.length!==featureCount)throw new Error(`Schema mismatch ${node.id}`);
  const coordinates=new Float32Array(b.buffer,b.byteOffset+8,count*3);
  for(let i=0;i<featureCount;i++){
   const f=features.featureData[i];if(seen.has(f.id))continue;seen.add(f.id);
   const [first,last]=f.geometries[0].params.faceRange;let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity,low=Infinity,high=-Infinity;
   for(let k=first*9;k<(last+1)*9;k+=3){const lon=node.mbs[0]+coordinates[k],lat=node.mbs[1]+coordinates[k+1],z=node.mbs[2]+coordinates[k+2];west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);low=Math.min(low,z);high=Math.max(high,z);}
   const center=[(west+east)/2,(south+north)/2],bbox=region.bbox;
   if(center[0]<bbox[0]||center[0]>bbox[2]||center[1]<bbox[1]||center[1]>bbox[3]||high-low<1)continue;
   const source=byUnique.get(unique[i]);const id=source?.properties.OBJECTID??null;const start=vertices.length/3;
   const color=new T.Color(high-low>40?'#d5dadd':'#e3decf');
   for(let k=first*9;k<(last+1)*9;k+=3){const lon=node.mbs[0]+coordinates[k],lat=node.mbs[1]+coordinates[k+1];const p=project([lon,lat]);vertices.push(p[0],node.mbs[2]+coordinates[k+2]-low+2,p[1]);colors.push(color.r,color.g,color.b);}
   records.push({id,sourceId:f.id,uniqueId:unique[i],year:years.readInt16LE(4+i*2),center:project(center),geo:center,sourceGround:low,sourceTop:high,height:high-low,start,end:vertices.length/3,node:node.id,polygons:source?(source.geometry.type==='Polygon'?[source.geometry.coordinates]:source.geometry.coordinates).map(p=>p.map(r=>r.map(project))):null});
  }
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
 const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.8,side:T.DoubleSide}));mesh.name=`County3D_${region.id}`;
 const glb=await exporter.parseAsync(mesh,{binary:true});await fs.writeFile(`${out}/${region.id}.glb`,Buffer.from(glb));await fs.writeFile(`${out}/${region.id}-records.json`,JSON.stringify(records));
 report.regions.push({...region,asset:`${region.id}.glb`,records:`${region.id}-records.json`,buildings:records.length,matchedFootprints:records.filter(r=>r.id!==null).length,triangles:vertices.length/9,bytes:glb.byteLength,maxHeight:Math.max(...records.map(r=>r.height))});
 console.log(`${region.id}: ${records.length} buildings, ${report.regions.at(-1).matchedFootprints} ID matches, max ${report.regions.at(-1).maxHeight.toFixed(2)} m`);
}
await fs.writeFile(`${out}/manifest.json`,JSON.stringify(report,null,2));
