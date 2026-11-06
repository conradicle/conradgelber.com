import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Facade features checked against the hotel's own exterior photograph. Width and
// placement follow the GIS front edge; smaller proportions are interpretations.
export function colonyFacade(record){
  const ring=record.polygons[0][0];let edge;
  for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];if(!edge||(a[0]+b[0])>(edge[0][0]+edge[1][0]))edge=[a,b];}
  let [a,b]=edge;if(a[1]<b[1])[a,b]=[b,a];
  const width=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/width,tz=(b[1]-a[1])/width;
  const normal=new T.Vector3(-tz,0,tx),basis=new T.Matrix4().makeBasis(new T.Vector3(tx,0,tz),new T.Vector3(0,1,0),normal);
  const group=new T.Group();group.quaternion.setFromRotationMatrix(basis);group.position.set((a[0]+b[0])/2+normal.x*.18,(record.laser?.ground??record.sourceGround)+1,(a[1]+b[1])/2+normal.z*.18);
  const cream=new T.MeshStandardMaterial({color:'#e6e8de',roughness:.85}),glass=new T.MeshStandardMaterial({color:'#4f6770',roughness:.32,metalness:.15});
  const blue=new T.MeshStandardMaterial({color:'#8cabc7',emissive:'#1967c6',emissiveIntensity:.2}),neon=new T.MeshStandardMaterial({color:'#e3f2ff',emissive:'#3796ff',emissiveIntensity:.3});
  function box(w,h,d,x,y,z,mat){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y+h/2,z);group.add(m);}
  box(width,12.7,.12,0,0,0,cream);
  for(const y of [.5,4.1,7.3]){
    for(const direction of [-1,1]){
      const h=y===.5?2.9:2.35;box(width*.33,h,.08,direction*width*.3,y,.09,glass);
      for(let j=0;j<5;j++)box(.055,h+.12,.12,direction*width*.3+(j-2)*width*.33/4,y-.04,.16,cream);
    }
  }
  for(const y of [3.5,6.85,10.2,12.9])box(width+.3,.16,.5,0,y,.1,cream);
  box(1.1,9.6,.32,0,4.5,.2,blue);box(5,1.2,.6,0,3.35,.6,blue);
  const paths={C:[[[.9,1],[.2,1],[0,.8],[0,.2],[.2,0],[.9,0]]],O:[[[.2,0],[.8,0],[1,.2],[1,.8],[.8,1],[.2,1],[0,.8],[0,.2],[.2,0]]],L:[[[0,1],[0,0],[1,0]]],N:[[[0,0],[0,1],[1,0],[1,1]]],Y:[[[0,1],[.5,.5],[1,1]],[[.5,.5],[.5,0]]],H:[[[0,0],[0,1]],[[1,0],[1,1]],[[0,.5],[1,.5]]],T:[[[0,1],[1,1]],[[.5,1],[.5,0]]],E:[[[1,1],[0,1],[0,0],[1,0]],[[0,.5],[.8,.5]]]};
  function letter(char,x,y,w,h,z){for(const line of paths[char]){const curve=new T.CatmullRomCurve3(line.map(p=>new T.Vector3(x+(p[0]-.5)*w,y+p[1]*h,z)),false,'centripetal');group.add(new T.Mesh(new T.TubeGeometry(curve,line.length*4,.035,5,false),neon));}}
  [...'COLONY'].forEach((c,i)=>letter(c,0,12.65-i*1.42,.62,.98,.43));
  [...'HOTEL'].forEach((c,i)=>letter(c,(i-2)*.87,3.55,.65,.83,.94));
  group.name='Colony facade — reference checked, interpreted proportions';
  const batches=new Map();for(const child of [...group.children]){child.updateMatrix();if(!batches.has(child.material))batches.set(child.material,[]);batches.get(child.material).push(child.geometry.clone().applyMatrix4(child.matrix));group.remove(child);child.geometry.dispose();}
  for(const [material,geometries]of batches){group.add(new T.Mesh(mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g)),material));geometries.forEach(g=>g.dispose());}
  return {group,setDusk:dusk=>{blue.emissiveIntensity=dusk?1:.2;neon.emissiveIntensity=dusk?3:.3;}};
}
