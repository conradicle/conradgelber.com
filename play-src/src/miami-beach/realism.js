import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {project} from './geo.js';
import {treesMesh} from './geometry.js';
import {colonyFacade} from './colony.js';
const base='/miami-beach/data/realism/';
async function json(name){const r=await fetch(base+name);if(!r.ok)throw new Error(`${name}: ${r.status}`);return r.json();}
function hasPoint(p,bbox){const geo=[p[0]/(111320*Math.cos(25.815*Math.PI/180))-80.135,25.815-p[1]/111320];return geo[0]>=bbox[0]&&geo[0]<=bbox[2]&&geo[1]>=bbox[1]&&geo[1]<=bbox[3];}

export async function loadRealism(){
  const [manifest,noaa,validation]=await Promise.all([json('manifest.json'),json('noaa.json'),json('validation.json')]);
  const group=new T.Group(),ground=new T.Group(),vegetation=new T.Group(),prototypeVegetation=new T.Group(),points=new T.Group();
  const records=[],ids=new Set(),meshes=[],surfaces=[];
  const loader=new GLTFLoader(),textureLoader=new T.TextureLoader();
  async function model(region){if(region.compressedAsset&&'DecompressionStream'in window){const response=await fetch(base+region.compressedAsset);if(!response.ok)throw new Error(`Model download: ${response.status}`);const input=await response.arrayBuffer();const header=new Uint8Array(input,0,2);const bytes=header[0]===31&&header[1]===139?await new Response(new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():input;return loader.parseAsync(bytes,base);}return loader.loadAsync(base+region.asset);}
  const regions=[],facades=[];
  for(const region of manifest.regions){
    const [gltf,source,environment]=await Promise.all([model(region),json(region.records),json(`${region.id}-environment.json`)]);
    const image=noaa.regions.find(r=>r.id===region.id)?.imagery;
    const texture=image?await textureLoader.loadAsync(base+image.file):null;
    if(texture){texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;}
    const bounds=image?{a:project([image.bbox[0],image.bbox[3]]),b:project([image.bbox[2],image.bbox[1]])}:null;
    for(const record of source){record.heightSource='county-3d-mesh';record.color='#d7d9ce';ids.add(record.id);records.push(record);}
    gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;
      const positions=mesh.geometry.attributes.position;
      // Source geometry is normalized to ground=2 by the offline importer.
      // Move each foundation to the nearby laser-survey ground elevation.
      for(const r of source){const groundZ=r.laser?.ground??r.sourceGround;for(let i=r.start;i<r.end;i++)positions.setY(i,positions.getY(i)+groundZ-1);}
      positions.needsUpdate=true;mesh.geometry.computeBoundingSphere();
      mesh.userData.ranges=source.map(building=>({start:building.start,end:building.end,building}));
      const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.9,side:T.DoubleSide});
      material.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 pilotPosition; varying vec3 pilotNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\npilotPosition=position; pilotNormal=normal;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 pilotPosition; varying vec3 pilotNormal; ${texture?'uniform sampler2D roofPhoto; uniform vec4 photoBounds;':''}`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          float wall=1.-step(.5,abs(pilotNormal.y));
          float axis=abs(pilotNormal.x)>abs(pilotNormal.z)?pilotPosition.z:pilotPosition.x;
          vec2 cell=fract(vec2(axis/2.8,pilotPosition.y/3.1));
          float windowMask=step(.23,cell.x)*step(cell.x,.77)*step(.25,cell.y)*step(cell.y,.77)*wall;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.29,.39,.39),windowMask*.42);
          ${texture?`vec2 aerialUv=vec2((pilotPosition.x-photoBounds.x)/(photoBounds.z-photoBounds.x),1.-(pilotPosition.z-photoBounds.y)/(photoBounds.w-photoBounds.y));
          float roof=step(.55,pilotNormal.y)*step(0.,aerialUv.x)*step(aerialUv.x,1.)*step(0.,aerialUv.y)*step(aerialUv.y,1.);
          diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(roofPhoto,aerialUv).rgb*.75,roof);`:''}
        `);
        if(texture){shader.uniforms.roofPhoto={value:texture};shader.uniforms.photoBounds={value:new T.Vector4(...bounds.a,...bounds.b)};}
      };
      material.customProgramCacheKey=()=>texture?'pilot-photo':'pilot-neutral';mesh.material=material;meshes.push(mesh);
    });
    group.add(gltf.scene);
    const colony=source.find(r=>r.id===402658);if(colony){const facade=colonyFacade(colony);group.add(facade.group);facades.push(facade);}
    const terrain=environment.terrain,size=terrain.size;
    if(image){
      const geom=new T.PlaneGeometry(bounds.b[0]-bounds.a[0],bounds.b[1]-bounds.a[1],size-1,size-1);geom.rotateX(-Math.PI/2);
      const p=geom.attributes.position;
      // PlaneGeometry rows run from north to south after rotating onto X/Z.
      for(let i=0;i<p.count;i++){p.setXYZ(i,p.getX(i)+(bounds.a[0]+bounds.b[0])/2,terrain.elevations[i]+terrain.renderOffset+.08,p.getZ(i)+(bounds.a[1]+bounds.b[1])/2);}
      geom.computeVertexNormals();const mat=new T.MeshBasicMaterial({map:texture,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
      mat.transparent=true;mat.depthWrite=false;mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','float edge=min(min(vMapUv.x,1.-vMapUv.x),min(vMapUv.y,1.-vMapUv.y)); diffuseColor.a*=smoothstep(0.,.025,edge);\n#include <opaque_fragment>');};
      const surface=new T.Mesh(geom,mat);surface.renderOrder=2;ground.add(surface);surfaces.push(surface);
    }
    const trees=treesMesh(environment.trees,true);vegetation.add(trees);prototypeVegetation.add(treesMesh(environment.trees));
    regions.push({...region,hasImagery:!!image,trees:environment.trees.length,canopyEstimates:environment.trees.filter(t=>t.height).length});
  }
  ids.delete(null);
  const visibleMeshes=()=>group.visible?meshes.filter(m=>m.visible):[];
  let pointLoaded=false;
  async function showPoints(show){points.visible=show;if(!show||pointLoaded)return;pointLoaded=true;try{
    // Laser view is an optional diagnostic, not a claimed complete reconstruction.
    for(const region of manifest.regions){const data=await json(`${region.id}-laser.json`);const positions=[],colors=[];for(const [x,y,z,classification]of data.points){if(classification!==6&&classification!==1)continue;positions.push(x,y+1,z);colors.push(classification===6?.82:1,classification===6?.55:.76,classification===6?.26:.45);}
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));points.add(new T.Points(geometry,new T.PointsMaterial({vertexColors:true,size:.7,sizeAttenuation:true,depthTest:true})));}
  }catch(e){pointLoaded=false;throw e;}}
  return {manifest,noaa,validation,regions,group,ground,vegetation,prototypeVegetation,points,records,ids,meshes:visibleMeshes,inside:p=>regions.some(r=>hasPoint(p,r.bbox)),hasImagery:p=>regions.some(r=>r.hasImagery&&hasPoint(p,r.bbox)),showPoints,setDusk:dusk=>{surfaces.forEach(s=>s.material.color.set(dusk?'#84929e':'#ffffff'));facades.forEach(f=>f.setDusk(dusk));}};
}
