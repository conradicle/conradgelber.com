import * as T from 'three';

// One vertex-colored mesh per spatial tile. No per-building draw calls.
export function buildingMesh(buildings, material) {
  const positions=[], colors=[], ranges=[];
  const c=new T.Color();
  function triangle(a,b,d){positions.push(...a,...b,...d);for(let i=0;i<3;i++)colors.push(c.r,c.g,c.b);}
  for(const b of buildings) {
    const start=positions.length/3; c.set(b.color);
    for(const polygon of b.polygons) {
      const rings=polygon.map(r=>r.slice(0,-1).map(p=>new T.Vector2(p[0],p[1]))).filter(r=>r.length>=3);
      if(!rings.length)continue;
      const vertices=rings.flat();
      const faces=T.ShapeUtils.triangulateShape(rings[0],rings.slice(1));
      for(const face of faces){const [a,d,e]=face.map(i=>vertices[i]);triangle([a.x,b.height+2,a.y],[e.x,b.height+2,e.y],[d.x,b.height+2,d.y]);}
      for(const ring of rings)for(let i=0;i<ring.length;i++) {
        const a=ring[i],d=ring[(i+1)%ring.length];
        triangle([a.x,2,a.y],[d.x,2,d.y],[d.x,b.height+2,d.y]);
        triangle([a.x,2,a.y],[d.x,b.height+2,d.y],[a.x,b.height+2,a.y]);
      }
    }
    ranges.push({start,end:positions.length/3,building:b});
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();
  const mesh=new T.Mesh(g,material);mesh.userData.ranges=ranges;return mesh;
}
export function groundMesh(polygons,color,y=1) {
  const positions=[];
  for(const polygon of polygons) {
    const rings=polygon.map(r=>r.slice(0,-1).map(p=>new T.Vector2(...p))).filter(r=>r.length>=3);
    if(!rings.length)continue;
    const vertices=rings.flat();
    for(const face of T.ShapeUtils.triangulateShape(rings[0],rings.slice(1))) {
      const [a,b,c]=face.map(i=>vertices[i]);positions.push(a.x,y,a.y,c.x,y,c.y,b.x,y,b.y);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.computeVertexNormals();
  return new T.Mesh(g,new T.MeshStandardMaterial({color,roughness:1,side:T.DoubleSide}));
}
export function roadMesh(roads) {
  const positions=[];
  for(const road of roads){const width=/CSWY|CAUSEWAY|ALTON|COLLINS|HARDING|INDIAN CREEK/i.test(road.name)?11:6;
    for(let i=1;i<road.points.length;i++) {
      const [ax,az]=road.points[i-1],[bx,bz]=road.points[i];const length=Math.hypot(bx-ax,bz-az);if(!length)continue;
      const nx=-(bz-az)/length*width/2,nz=(bx-ax)/length*width/2;
      // Roads over water use an approximate deck, not surveyed bridge geometry.
      const y=/CSWY|CAUSEWAY/i.test(road.name)?4:1.7;
      const a=[ax+nx,y,az+nz],b=[bx+nx,y,bz+nz],c=[bx-nx,y,bz-nz],d=[ax-nx,y,az-nz];positions.push(...a,...b,...c,...a,...c,...d);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.computeVertexNormals();
  return new T.Mesh(g,new T.MeshStandardMaterial({color:'#d4c8ae',roughness:1,side:T.DoubleSide}));
}
export function outline(polygons,color,y=3) {
  const pos=[];for(const p of polygons)for(const r of p)for(let i=1;i<r.length;i++)pos.push(r[i-1][0],y,r[i-1][1],r[i][0],y,r[i][1]);
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  return new T.LineSegments(g,new T.LineBasicMaterial({color,transparent:true,opacity:.7}));
}
export function treesMesh(trees,detailed=false) {
  if(detailed)return naturalTrees(trees);
  const group=new T.Group();const dummy=new T.Object3D();
  const trunk=new T.InstancedMesh(new T.CylinderGeometry(.28,.45,7,5),new T.MeshStandardMaterial({color:'#99825c'}),trees.length);
  const crowns=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:'#5d8971',roughness:1}),trees.length);
  const palms=trees.filter(t=>t.palm);
  const fronds=new T.InstancedMesh(new T.ConeGeometry(1,1,4),new T.MeshStandardMaterial({color:'#4e8269',side:T.DoubleSide}),palms.length*5);
  trees.forEach((t,i)=>{const [x,z]=t.p;dummy.position.set(x,5.5,z);dummy.scale.set(1,1,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunk.setMatrixAt(i,dummy.matrix);dummy.position.y=t.palm?9:8;dummy.scale.set(t.palm?1.5:3,t.palm?.8:3,t.palm?1.5:3);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});
  palms.forEach((t,i)=>{for(let j=0;j<5;j++){const a=j*Math.PI*2/5;dummy.position.set(t.p[0]+Math.cos(a)*2,9,t.p[1]+Math.sin(a)*2);dummy.rotation.set(0,-a,Math.PI*.36);dummy.scale.set(1,5,1);dummy.updateMatrix();fronds.setMatrixAt(i*5+j,dummy.matrix);}});
  group.add(trunk,crowns,fronds);return group;
}
function naturalTrees(trees){
  const group=new T.Group(),dummy=new T.Object3D(),color=new T.Color();
  const palms=trees.filter(t=>t.palm),broadleaf=trees.filter(t=>!t.palm);
  const frondsPerPalm=18;
  const palmLength=h=>Math.max(3.4,Math.min(6.5,h*.38));
  const palmCrownY=(h,ground)=>ground+h-palmLength(h)*.2;
  const trunks=new T.InstancedMesh(new T.CylinderGeometry(.55,1,1,7,3),new T.MeshStandardMaterial({color:'#a39172',roughness:1}),trees.length);
  const crowns=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:'#4e724a',roughness:1}),broadleaf.length*3);
  const palmCenters=new T.InstancedMesh(new T.SphereGeometry(1,8,6),new T.MeshStandardMaterial({color:'#3f6735',roughness:1}),palms.length);
  const points=[];
  for(let i=0;i<14;i++){
    const a=i/14,b=(i+1)/14;
    const v=(t,side)=>[t,Math.sin(t*Math.PI)*.2-t*t*.26,(Math.sin(t*Math.PI)*.032+.008*(1-t))*side];
    points.push(...v(a,-1),...v(b,-1),...v(b,1),...v(a,-1),...v(b,1),...v(a,1));
  }
  // A filled central blade keeps each frond readable at aerial distances;
  // separated leaflets preserve the feathered outline when viewed close up.
  for(let i=1;i<25;i++){const t=i/25,y=Math.sin(t*Math.PI)*.2-t*t*.26,reach=Math.sin(t*Math.PI)*.16;for(const side of [-1,1]){points.push(t-.014,y,0,t+.014,y,0,t-.045,y-.012,side*reach);}}
  const frondGeometry=new T.BufferGeometry();frondGeometry.setAttribute('position',new T.Float32BufferAttribute(points,3));frondGeometry.computeVertexNormals();
  const leaves=new T.InstancedMesh(frondGeometry,new T.MeshStandardMaterial({color:'#507d4d',roughness:1,side:T.DoubleSide}),palms.length*frondsPerPalm);
  function set(mesh,index,position,scale,rotation=[0,0,0]){dummy.position.set(...position);dummy.scale.set(...scale);dummy.rotation.set(...rotation);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);}
  trees.forEach((t,i)=>{const h=t.height||(t.palm?11:8),ground=(t.ground??1)+1,trunkHeight=t.palm?palmCrownY(h,ground)-ground:h*.86;set(trunks,i,[t.p[0],ground+trunkHeight/2,t.p[1]],[t.palm?.32:.48,trunkHeight,t.palm?.32:.48]);});
  palms.forEach((t,i)=>{
    const h=t.height||11,ground=(t.ground??1)+1,length=palmLength(h),crownY=palmCrownY(h,ground);
    set(palmCenters,i,[t.p[0],crownY-.1,t.p[1]],[.65,.8,.65]);
    for(let j=0;j<frondsPerPalm;j++){
      const lower=j>=12,index=lower?j-12:j,count=lower?6:12;
      const angle=index*Math.PI*2/count+Math.sin(t.p[0])+(lower?.3:0),scale=length*(lower?.86:1);
      set(leaves,i*frondsPerPalm+j,[t.p[0],crownY-(lower?.25:0),t.p[1]],[scale,scale,scale],[0,angle,lower?-.18:0]);
      color.setHSL(.29+(j%3)*.01,.4,.3+(j%4)*.022);leaves.setColorAt(i*frondsPerPalm+j,color);
    }
  });
  broadleaf.forEach((t,i)=>{const h=t.height||8,ground=(t.ground??1)+1,r=Math.min(5,h*.3);for(let j=0;j<3;j++){const a=j*Math.PI*2/3;set(crowns,i*3+j,[t.p[0]+Math.cos(a)*r*.45,ground+h-r*.3+(j%2)*r*.3,t.p[1]+Math.sin(a)*r*.45],[r*.8,r*.75,r*.85]);color.setHSL(.22,.19,.3+(j%3)*.04);crowns.setColorAt(i*3+j,color);}});
  group.add(trunks,crowns,palmCenters,leaves);return group;
}
export function dispose(object,materials=false) {object.traverse(o=>{o.geometry?.dispose();if(materials){for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();}});}
