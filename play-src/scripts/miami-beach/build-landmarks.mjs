import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
// GLTFExporter uses the browser FileReader API for binary buffers.
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();});}
};
const out=fileURLToPath(new URL('../../../miami-beach/assets/',import.meta.url));
await fs.mkdir(out,{recursive:true});
const white=new T.MeshStandardMaterial({color:'#eee8db',roughness:.8});
const glass=new T.MeshStandardMaterial({color:'#709a9f',roughness:.35,metalness:.2});
const trim=new T.MeshStandardMaterial({color:'#bad2cf',roughness:.75});
const neon=new T.MeshStandardMaterial({color:'#7ad3db',emissive:'#248c99',emissiveIntensity:.5});
function block(g,w,h,d,x,y,z,m=white){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),m);mesh.position.set(x,y+h/2,z);g.add(mesh);return mesh;}
const colony=new T.Group();colony.name='Interpretive Colony Hotel';
block(colony,24,10,32,0,0,0);block(colony,5,15,4,0,0,17,trim);
for(const y of [3.2,6.4,9.6]){block(colony,25,.35,33,0,y,0,trim);for(const x of [-9,-5,5,9])block(colony,2,1.6,.15,x,y-2,16.1,glass);}
block(colony,1.8,11,.25,0,2,19.1,neon);block(colony,26,.6,4,0,2.6,17,trim);
const fontainebleau=new T.Group();fontainebleau.name='Interpretive Fontainebleau curved wing';
// Curved slab and horizontal balcony bands. All dimensions are artistic;
// this is an optional first-pass massing asset, not a surveyed replacement.
const shape=new T.Shape();const a0=-1.06,a1=1.06,r=85,thickness=20;
shape.moveTo(Math.cos(a0)*r,Math.sin(a0)*r);
shape.absarc(0,0,r,a0,a1,false);shape.lineTo(Math.cos(a1)*(r-thickness),Math.sin(a1)*(r-thickness));shape.absarc(0,0,r-thickness,a1,a0,true);shape.closePath();
function curved(y,h,m){const geom=new T.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:24});geom.rotateX(-Math.PI/2);geom.translate(-65,y,0);const mesh=new T.Mesh(geom,m);fontainebleau.add(mesh);}
curved(0,43,white);for(let y=3.2;y<43;y+=3.2)curved(y,.35,trim);
for(let i=0;i<32;i++){const a=a0+(a1-a0)*i/31;const x=Math.cos(a)*r-65,z=-Math.sin(a)*r;for(let y=3;y<40;y+=3.2){const win=block(fontainebleau,2.6,1.8,.3,x,y,z,glass);win.rotation.y=-a+Math.PI/2;}}
const tower=new T.Group();tower.name='Interpretive Miami Beach lifeguard tower';
const coral=new T.MeshStandardMaterial({color:'#e9ad93',roughness:.85});
for(const x of [-1.6,1.6])for(const z of [-1.6,1.6])block(tower,.3,2.5,.3,x,0,z,white);
block(tower,5,.35,5,0,2.5,0,trim);block(tower,3.7,2.1,3.7,0,2.85,0,coral);block(tower,5.4,.4,5.4,0,4.95,0,trim);
block(tower,3,1.1,.15,0,3.35,1.9,glass);
const exporter=new GLTFExporter();
for(const [name,model] of [['colony',colony],['fontainebleau',fontainebleau],['lifeguard',tower]]){
  model.updateMatrixWorld(true);const groups=new Map();
  model.traverse(o=>{if(!o.isMesh)return;if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(o.geometry.clone().applyMatrix4(o.matrixWorld));});
  const optimized=new T.Group();optimized.name=model.name;
  for(const [mat,geometries]of groups){optimized.add(new T.Mesh(mergeGeometries(geometries),mat));}
  const glb=await exporter.parseAsync(optimized,{binary:true,onlyVisible:true});await fs.writeFile(`${out}${name}.glb`,Buffer.from(glb));console.log(`${name}: ${glb.byteLength} bytes`);
}
const catalog=[
  {id:'colony',name:'Colony Hotel · survey pilot',geo:[-80.1315786,25.7774804],offset:[65,35,20],description:'County 3D geometry checked against the 2021 laser survey. The facade sign and horizontal bands follow the hotel’s own exterior reference; smaller proportions and materials are interpreted.',reference:'https://www.colonymiami.com/',survey:true},
  {id:'fontainebleau',name:'Fontainebleau',geo:[-80.1223,25.81755],asset:'fontainebleau.glb',rotation:0,offset:[230,220,300],description:'A curved hotel wing interpreted with horizontal bands. The complete hotel complex and exact facade have not been reconstructed.',reference:'https://www.fontainebleau.com/miamibeach/'},
  {id:'lifeguard',name:'Oceanfront lifeguard tower',geo:[-80.1295,25.7762],asset:'lifeguard.glb',rotation:0,offset:[35,30,45],description:'A representative Miami Beach lifeguard tower, placed approximately on the oceanfront. This is a generic artistic asset, not a specific surveyed tower.',reference:'https://www.miamibeachfl.gov/city-hall/fire/ocean-rescue/'},
  {id:'cityhall',name:'Miami Beach City Hall',geo:[-80.1338,25.7931],offset:[180,220,260],description:'A camera stop at the civic center. The surrounding buildings use GIS footprint massing; a custom verified City Hall model is still pending.',reference:'https://www.miamibeachfl.gov/city-hall/'},
  {id:'southpointe',name:'South Pointe',geo:[-80.1333,25.7668],offset:[350,400,500],description:'The southern end of Miami Beach at Government Cut. Park geometry and water boundaries follow the downloaded public datasets.',reference:'https://www.miamibeachfl.gov/city-hall/parks-and-recreation/parks-facilities-directory/south-pointe-park/'},
  {id:'normandy',name:'Normandy Isles',geo:[-80.1448,25.8545],offset:[700,850,1100],description:'A neighborhood camera stop in the northern bay islands. Buildings, streets and mapped trees stream in as the camera approaches.',reference:'https://gis.miamibeachfl.gov/public/rest/services/gc/gc_Cadastral/MapServer/12'},
];
await fs.writeFile(fileURLToPath(new URL('../../../miami-beach/data/landmarks.json',import.meta.url)),JSON.stringify(catalog,null,2));
