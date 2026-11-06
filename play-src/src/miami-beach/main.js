import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {project,tileKey,unproject} from './geo.js';
import {buildingMesh,groundMesh,roadMesh,outline,treesMesh,dispose} from './geometry.js';
import {loadRealism} from './realism.js';

const $=id=>document.getElementById(id);
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const dataBase='/miami-beach/data/';
const state={mode:'orbit',dusk:false,tour:false,buildings:true,trees:true,roads:true,boundary:true,landmarks:true,realism:true,laser:false};
const views={
  city:{name:'Entire municipality',geo:[-80.141,25.815],offset:[6400,9500,10700]},
  south:{name:'South Beach',geo:[-80.1365,25.7815],offset:[1000,1700,2200]},
  mid:{name:'Mid-Beach',geo:[-80.127,25.821],offset:[1600,2200,2400]},
  north:{name:'North Beach',geo:[-80.128,25.856],offset:[1400,2000,2300]},
  islands:{name:'Bay islands',geo:[-80.161,25.791],offset:[1500,2000,2300]},
  pilot:{name:'Ocean Drive · realism pilot',geo:[-80.1317,25.777],offset:[330,300,440]},
  heights:{name:'Diamond towers · height check',geo:[-80.1212,25.823],offset:[280,240,360]},
};
const canvas=$('city');
let renderer,scene,camera,controls,environment,manifest,landmarks=[],realism,prototypeMesh;
let sun,ambient,water,buildingsMaterial,detailMaterial,coast,roadGroup,landmarkGroup,selectionMesh;
const overview=new Map(), loaded=new Map(),pending=new Map();
const keys=new Set(),raycaster=new T.Raycaster(),pointer=new T.Vector2();
let flight=null,tourTimer=0,epoch=0,lastStream=0,lastFrame=0,frameCount=0,fps=0,fpsTime=0;
let pointerDown=null,look=null,disposed=false,frameHandle;
const waterUniforms={time:{value:0},dusk:{value:0}};

async function json(name,signal){const r=await fetch(dataBase+name,{signal});if(!r.ok)throw new Error(`${name}: ${r.status}`);return r.json();}
function setStatus(text){if($('status').textContent!==text)$('status').textContent=text;}
function material(detail=false){
  const m=new T.MeshStandardMaterial({vertexColors:true,roughness:.82,metalness:.05,side:T.DoubleSide});
  if(detail){m.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cityPosition; varying vec3 cityNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\ncityPosition = position; cityNormal = normal;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 cityPosition; varying vec3 cityNormal;').replace('#include <color_fragment>',`#include <color_fragment>
      float horizontal = abs(cityNormal.x) > abs(cityNormal.z) ? cityPosition.z : cityPosition.x;
      vec2 cell = fract(vec2(horizontal / 3.1, (cityPosition.y-2.0) / 3.2));
      float windowMask = step(.24,cell.x)*step(cell.x,.76)*step(.25,cell.y)*step(cell.y,.79);
      float wall = 1.0-step(.5,abs(cityNormal.y));
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.24,.41,.43),windowMask*wall*.65);
      float band=step(.94,cell.y)*wall;
      diffuseColor.rgb *= 1.0-band*.12;
    `);
  };}
  return m;
}
function makeWater(){
  const m=new T.ShaderMaterial({uniforms:waterUniforms,vertexShader:'varying vec3 p; void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 p; uniform float time; uniform float dusk;
    void main(){float ripple=sin(p.x*.021+time*.45)*sin(p.z*.035-time*.32)*.5+.5;
    vec3 day=mix(vec3(.25,.55,.54),vec3(.33,.65,.61),ripple*.18);
    vec3 night=mix(vec3(.13,.28,.34),vec3(.25,.41,.43),ripple*.15);
    gl_FragColor=vec4(mix(day,night,dusk),1.);}`,side:T.DoubleSide});
  const g=new T.PlaneGeometry(100000,100000);g.rotateX(-Math.PI/2);const mesh=new T.Mesh(g,m);mesh.position.y=-2;return mesh;
}
function initRenderer(){
  renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<760?1.3:1.6));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  scene=new T.Scene();scene.background=new T.Color('#7caea6');scene.fog=new T.Fog('#7caea6',20000,55000);
  camera=new T.PerspectiveCamera(42,canvas.clientWidth/canvas.clientHeight,3,60000);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=35;controls.maxDistance=35000;controls.maxPolarAngle=Math.PI*.485;controls.screenSpacePanning=false;controls.target.set(-500,0,500);
  controls.addEventListener('start',()=>{flight=null;stopTour();});
  ambient=new T.HemisphereLight('#fffbe7','#719d98',2.2);scene.add(ambient);
  sun=new T.DirectionalLight('#fff1c8',3.2);sun.position.set(-4000,8000,2500);scene.add(sun);
  buildingsMaterial=material();detailMaterial=material(true);water=makeWater();scene.add(water);
  landmarkGroup=new T.Group();scene.add(landmarkGroup);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(frameHandle);setStatus('Graphics paused. Reload this page to restore the city.');$('fallback').hidden=false;$('fallback').querySelector('h2').textContent='The graphics connection was interrupted';});
  const resize=()=>{const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;if(innerWidth<760)camera.setViewOffset(w,h,0,h*.12,w,h);else camera.clearViewOffset();camera.updateProjectionMatrix();};
  resize();
  new ResizeObserver(resize).observe($('viewport'));
  flyTo(views.city,true);frameHandle=requestAnimationFrame(frame);
}
function flyTo(view,instant=false){
  if(!renderer)return;
  if(state.mode==='fly')setMode('orbit');
  const [x,z]=project(view.geo);const target=new T.Vector3(x,0,z);
  // On narrow screens shift the target down in the frame, keeping the city
  // above the controls, and increase distance enough for the municipality.
  const factor=innerWidth<760&&view===views.city?1.75:1;
  const destination=target.clone().add(new T.Vector3(...view.offset).multiplyScalar(factor));
  if(instant||reduced){camera.position.copy(destination);controls.target.copy(target);controls.update();flight=null;}
  else flight={from:camera.position.clone(),to:destination,start:performance.now(),duration:2100,targetFrom:controls.target.clone(),targetTo:target};
  $('place-name').textContent=view.name.toUpperCase();$('view-caption').textContent='MIAMI BEACH, FLORIDA';
  for(const button of document.querySelectorAll('[data-view]')){const active=views[button.dataset.view]===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
}
function setMode(mode){
  if(!controls)return;
  flight=null;state.mode=mode;controls.enabled=mode==='orbit';keys.clear();
  $('fly-pad').hidden=mode!=='fly';
  for(const name of ['orbit','fly']){$(name).classList.toggle('active',mode===name);$(name).setAttribute('aria-pressed',String(mode===name));}
  if(mode==='orbit'){const forward=new T.Vector3();camera.getWorldDirection(forward);const distance=Math.min(1800,Math.max(150,camera.position.y*1.4));controls.target.copy(camera.position).addScaledVector(forward,distance);controls.target.y=Math.max(0,controls.target.y);controls.update();}
  else {canvas.focus();$('selection').hidden=true;}
  $('hint').textContent=mode==='fly'?'FOCUS CITY · WASD TO FLY · R/F UP/DOWN · SHIFT FASTER · DRAG TO LOOK · ESC TO ORBIT':'DRAG TO ORBIT · SCROLL TO EXPLORE · CLICK A BUILDING';
  setStatus(mode==='fly'?'Fly: WASD to move, R/F up/down, drag to look, Esc to orbit.':'Orbit: drag to rotate, right-drag to pan, scroll to zoom.');
}
function stopTour(){if(!state.tour)return;state.tour=false;clearTimeout(tourTimer);$('tour').textContent='Start tour ↗';$('tour').setAttribute('aria-pressed','false');}
function startTour(){stopTour();state.tour=true;$('tour').textContent='Stop tour';$('tour').setAttribute('aria-pressed','true');let i=0;const stops=[views.south,views.islands,views.mid,views.north,views.city];const step=()=>{if(!state.tour)return;flyTo(stops[i++%stops.length]);tourTimer=setTimeout(step,reduced?8000:11000);};step();}
function tileDistance(tile,point){const [x1,z1,x2,z2]=tile.bounds;return Math.hypot(Math.max(x1-point.x,0,point.x-x2),Math.max(z1-point.z,0,point.z-z2));}
async function loadTile(tile){
  if(loaded.has(tile.id)||pending.has(tile.id))return;
  const abort=new AbortController();pending.set(tile.id,abort);
  try{
    const data=await json(`tiles/${tile.id}.json`,abort.signal);if(abort.signal.aborted||disposed)return;
    const mesh=buildingMesh(data.buildings.filter(b=>!realism?.ids.has(b.id)),detailMaterial);const trees=treesMesh(data.trees.filter(t=>!realism?.inside(t.p)));scene.add(mesh,trees);
    loaded.set(tile.id,{mesh,trees,data,last:epoch});const low=overview.get(tile.id);if(low)low.visible=false;mesh.visible=state.buildings;trees.visible=state.trees;
  }catch(e){if(e.name!=='AbortError'){console.warn('City tile unavailable',tile.id,e);setStatus('Some close-up detail is unavailable. The city overview remains visible.');}}
  finally{pending.delete(tile.id);}
}
function stream(){
  if(!manifest||!controls||!overview.size)return;epoch++;
  const distance=camera.position.distanceTo(controls.target);
  const point=state.mode==='fly'?camera.position:controls.target;
  const wanted=distance<6500||state.mode==='fly'?manifest.tiles.filter(t=>tileDistance(t,point)<(innerWidth<760?900:1550)).sort((a,b)=>tileDistance(a,point)-tileDistance(b,point)).slice(0,innerWidth<760?12:20):[];
  const ids=new Set(wanted.map(t=>t.id));
  for(const [id,abort] of pending)if(!ids.has(id))abort.abort();
  for(const [id,t]of loaded){if(ids.has(id)){t.last=epoch;continue;}scene.remove(t.mesh,t.trees);dispose(t.mesh);dispose(t.trees,true);loaded.delete(id);const low=overview.get(id);if(low)low.visible=state.buildings;}
  // Bounded queue; leave the complete overview present during downloads.
  for(const tile of wanted){if(pending.size>=2)break;void loadTile(tile);}
  landmarkGroup.visible=state.landmarks&&distance<6500;
  applyPilotVisibility();
  if(!state.tour&&state.mode!=='fly')setStatus(`${manifest.stats.buildings.toLocaleString()} footprints · ${loaded.size} detail tiles loaded`);
}
function applyPilotVisibility(){if(!realism)return;realism.group.visible=state.realism&&state.buildings;realism.ground.visible=state.realism;realism.vegetation.visible=state.realism&&state.trees;realism.prototypeVegetation.visible=!state.realism&&state.trees;realism.points.visible=state.laser;if(prototypeMesh)prototypeMesh.visible=!state.realism&&state.buildings;landmarkGroup.children.forEach(child=>{if(child.userData.landmark==='colony')child.visible=!state.realism;});}
function applyVisibility(){for(const mesh of overview.values())mesh.visible=state.buildings&&!loaded.has(mesh.userData.tile);for(const t of loaded.values()){t.mesh.visible=state.buildings;t.trees.visible=state.trees;}if(roadGroup)roadGroup.visible=state.roads;if(coast)coast.visible=state.boundary;if(landmarkGroup)landmarkGroup.visible=state.landmarks&&camera.position.distanceTo(controls.target)<6500;applyPilotVisibility();}
function updateFlight(now){if(!flight)return;const t=Math.min(1,(now-flight.start)/flight.duration);const eased=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,eased);controls.target.lerpVectors(flight.targetFrom,flight.targetTo,eased);if(t===1)flight=null;}
function flyMove(dt){
  if(state.mode!=='fly'||document.activeElement!==canvas)return;
  const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?550:130)*dt;
  const forward=new T.Vector3();camera.getWorldDirection(forward);const right=new T.Vector3().crossVectors(forward,camera.up).normalize();
  if(keys.has('KeyW'))camera.position.addScaledVector(forward,speed);if(keys.has('KeyS'))camera.position.addScaledVector(forward,-speed);if(keys.has('KeyA'))camera.position.addScaledVector(right,-speed);if(keys.has('KeyD'))camera.position.addScaledVector(right,speed);if(keys.has('KeyR'))camera.position.y+=speed;if(keys.has('KeyF'))camera.position.y-=speed;
  camera.position.y=T.MathUtils.clamp(camera.position.y,8,16000);camera.position.x=T.MathUtils.clamp(camera.position.x,-8000,5000);camera.position.z=T.MathUtils.clamp(camera.position.z,-9000,9000);
}
function frame(now){
  frameHandle=requestAnimationFrame(frame);if(document.hidden||now-lastFrame<1000/40)return;
  const dt=Math.min(.08,(now-lastFrame)/1000||.016);lastFrame=now;
  updateFlight(now);if(state.mode==='orbit')controls.update();else flyMove(dt);
  // A city overview and street-level flight need different depth precision.
  // Keep nearby ground/park surfaces distinct without clipping low flights.
  const near=Math.max(.5,Math.min(250,Math.round(camera.position.y/50*4)/4));
  if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}
  if(now-lastStream>450){stream();lastStream=now;}
  waterUniforms.time.value=reduced?0:now/1000;
  $('compass-arrow').style.transform=`rotate(${controls.getAzimuthalAngle()*180/Math.PI}deg)`;
  renderer.render(scene,camera);frameCount++;
  if(now-fpsTime>1500){fps=frameCount*1000/(now-fpsTime);frameCount=0;fpsTime=now;}
}
function selectBuilding(event){
  if(!renderer||state.mode==='fly')return;
  const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
  const candidates=[...loaded.values()].map(t=>t.mesh).concat([...overview.values()].filter(m=>m.visible),realism?.meshes()||[],prototypeMesh?.visible?[prototypeMesh]:[]).filter(m=>m.visible);
  const hit=raycaster.intersectObjects(candidates,false)[0];if(!hit)return;
  const vertex=hit.faceIndex*3;const b=hit.object.userData.ranges.find(r=>vertex>=r.start&&vertex<r.end)?.building;if(!b)return;
  $('selection-title').textContent=b.heightSource==='county-3d-mesh'?`County building ${b.sourceId}`:`Footprint ${b.id}`;
  let copy=b.heightSource==='county-3d-mesh'?`County 3D mesh height: ${b.height.toFixed(1)} m.\n`:`Rendered height: ${b.height.toFixed(1)} m (estimated).\n`;
  if(b.heightSource==='county-3d-mesh')copy+=b.laser?`2021 sampled roof height: ${b.laser.classifiedHeight.toFixed(1)} m.\nRoof elevation difference: ${b.laser.difference.toFixed(1)} m.${Math.abs(b.laser.difference)>2?' Review needed.':''}\n`:'Laser comparison unavailable.\n';
  else copy+=b.heightSource==='city-floor-estimate'?`${b.floors} city-recorded floors × 3.2 m.\n`:b.heightSource?'No matched floor count; 6.4 m fallback.\n':'Zoom in for the full source record.\n';
  if(b.year)copy+=`Source update: ${b.year}.\n`;if(b.sourceHeight>0)copy+=`County HEIGHT: ${b.sourceHeight} (unit unconfirmed).\n`;copy+='Facade colors and windows are procedural.';
  $('selection-copy').textContent=copy;$('selection').hidden=false;
  if(selectionMesh){scene.remove(selectionMesh);dispose(selectionMesh);selectionMesh.material.dispose();}
  if(b.polygons){selectionMesh=outline(b.polygons,'#d87c49',b.height+(b.laser?.ground??1)+1.2);scene.add(selectionMesh);}
}
function openAbout(){stopTour();$('about').showModal();}
function bind(){
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{stopTour();flyTo(views[button.dataset.view]);if(button.dataset.view==='heights'){$('selection-title').textContent='Roof geometry needs review';$('selection-copy').textContent='The county models omit upper roof detail on the Diamond towers. Their tops are about 16 m below the 2021 classified laser roof elevations. Published architectural heights include the crowns and use a different definition.\nEnable “Laser survey comparison” in Layers to inspect the source points. These towers have not passed height validation.';$('selection').hidden=false;}else if(button.dataset.view==='pilot'){$('selection').hidden=true;}});
  $('orbit').onclick=()=>{stopTour();setMode('orbit');};$('fly').onclick=()=>{stopTour();setMode('fly');};
  $('tour').onclick=()=>state.tour?stopTour():startTour();$('reset').onclick=()=>{stopTour();flyTo(views.city);};
  $('realism-toggle').onclick=()=>{if(!realism)return;state.realism=!state.realism;$('realism-toggle').setAttribute('aria-pressed',String(state.realism));$('realism-toggle').textContent=state.realism?'Compare':'Survey view';applyVisibility();$('pilot-note').textContent=state.realism?'Survey geometry + 2023 aerial photography':'Original massing shown for comparison';};
  $('show-laser').onchange=async e=>{if(!realism)return;state.laser=e.target.checked;try{await realism.showPoints(state.laser);}catch(error){state.laser=false;e.target.checked=false;setStatus('Laser comparison could not load.');console.warn(error);}};
  for(const [name,factor]of [['zoom-in',.7],['zoom-out',1.4]])$(name).onclick=()=>{if(!camera)return;stopTour();flight=null;camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();};
  $('lighting').onclick=()=>{state.dusk=!state.dusk;$('lighting').setAttribute('aria-pressed',String(state.dusk));$('lighting').textContent=state.dusk?'Daylight':'Dusk';if(!renderer)return;waterUniforms.dusk.value=state.dusk?1:0;sun.color.set(state.dusk?'#f5b89d':'#fff1c8');sun.intensity=state.dusk?1.5:3.2;sun.position.y=state.dusk?1500:8000;ambient.intensity=state.dusk?1.2:2.2;scene.background.set(state.dusk?'#82939d':'#7caea6');scene.fog.color.copy(scene.background);realism?.setDusk(state.dusk);};
  $('layers-open').onclick=()=>{const open=$('layers').hidden;$('layers').hidden=!open;$('layers-open').setAttribute('aria-expanded',String(open));};
  for(const name of ['buildings','trees','roads','boundary','landmarks'])$(`show-${name}`).onchange=e=>{state[name]=e.target.checked;applyVisibility();};
  $('about-open').onclick=openAbout;$('fallback-sources').onclick=openAbout;$('about-close').onclick=()=>$('about').close();$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
  $('selection-close').onclick=()=>{$('selection').hidden=true;if(selectionMesh)selectionMesh.visible=false;};
  $('landmark').onchange=e=>{const l=landmarks.find(l=>l.id===e.target.value);if(!l)return;stopTour();flyTo({name:l.name,geo:l.geo,offset:l.offset||[150,180,240]});$('selection-title').textContent=l.name;$('selection-copy').textContent=l.description+(l.survey?'\nCounty mesh height 14.02 m; sampled laser roof height 13.97 m.':'\nInterpretive model; dimensions and placement are approximate.');$('selection').hidden=false;};
  canvas.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY};if(state.mode==='fly'){canvas.setPointerCapture(e.pointerId);look={x:e.clientX,y:e.clientY,euler:new T.Euler().setFromQuaternion(camera.quaternion,'YXZ')};}});
  canvas.addEventListener('pointermove',e=>{if(!look||state.mode!=='fly')return;const a=look.euler.clone();a.y-=(e.clientX-look.x)*.003;a.x=T.MathUtils.clamp(a.x-(e.clientY-look.y)*.003,-1.45,1.45);camera.quaternion.setFromEuler(a);});
  canvas.addEventListener('pointerup',e=>{look=null;if(pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<5)selectBuilding(e);pointerDown=null;});
  canvas.addEventListener('keydown',e=>{if(e.code==='Escape'){setMode('orbit');return;}if(state.mode==='fly'&&['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}});
  for(const button of document.querySelectorAll('[data-move]')){
    button.addEventListener('pointerdown',e=>{e.preventDefault();canvas.focus();button.setPointerCapture(e.pointerId);keys.add(button.dataset.move);});
    const release=()=>keys.delete(button.dataset.move);button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('click',e=>{if(e.detail===0){canvas.focus();keys.add(button.dataset.move);flyMove(.15);keys.delete(button.dataset.move);}});
  }
  window.addEventListener('keyup',e=>keys.delete(e.code));canvas.addEventListener('blur',()=>keys.clear());window.addEventListener('blur',()=>keys.clear());
  window.addEventListener('pagehide',event=>{stopTour();keys.clear();cancelAnimationFrame(frameHandle);if(event.persisted)return;disposed=true;for(const c of pending.values())c.abort();controls?.dispose();renderer?.dispose();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!disposed){lastFrame=performance.now();frameHandle=requestAnimationFrame(frame);}});
  document.addEventListener('visibilitychange',()=>{keys.clear();if(document.hidden)stopTour();});
}
async function buildScene(){
  const env=await json('environment.json');environment=env;
  scene.add(groundMesh(env.land,'#7da798',.5));scene.add(groundMesh(env.cityLand,'#e9dfc4',1));
  // Thin coastal edge reads at the city scale without inventing beach geometry.
  scene.add(outline(env.cityLand,'#f3ebd5',1.2));
  const green=env.parks.filter(p=>p.kind!=='beach').flatMap(p=>p.polygons),beaches=env.parks.filter(p=>p.kind==='beach').flatMap(p=>p.polygons);
  scene.add(groundMesh(green,'#a8bd8c',1.45),groundMesh(beaches,'#f3e5c2',1.46));
  roadGroup=roadMesh(env.roads);scene.add(roadGroup);coast=outline(env.boundary,'#cf895e',2.2);scene.add(coast);
  setStatus('Loading the survey geometry pilot…');
  try{realism=await loadRealism();scene.add(realism.group,realism.ground,realism.vegetation,realism.prototypeVegetation,realism.points);$('realism-toggle').disabled=false;$('show-laser').disabled=false;}catch(error){realism=null;$('pilot-note').textContent='Survey pilot unavailable; original city remains visible.';console.warn('Pilot unavailable',error);}
  setStatus('Extruding the municipal building inventory…');
  const data=await json('overview.json');const groups=new Map();for(const b of data){const id=tileKey(b.center);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(b);}
  let count=0;for(const [id,buildings]of groups){const mesh=buildingMesh(buildings.filter(b=>!realism?.ids.has(b.id)),buildingsMaterial);mesh.userData.tile=id;overview.set(id,mesh);scene.add(mesh);if(++count%6===0)await new Promise(resolve=>setTimeout(resolve,0));}
  if(realism){prototypeMesh=buildingMesh(data.filter(b=>realism.ids.has(b.id)),detailMaterial);scene.add(prototypeMesh);applyPilotVisibility();}
  const loader=new GLTFLoader();
  for(const l of landmarks.filter(l=>l.asset)){
    loader.load(`/miami-beach/assets/${l.asset}`,gltf=>{const [x,z]=project(l.geo);gltf.scene.position.set(x,2,z);gltf.scene.rotation.y=l.rotation||0;gltf.scene.userData.landmark=l.id;landmarkGroup.add(gltf.scene);applyPilotVisibility();},undefined,e=>console.warn('Landmark unavailable',l.id,e));
  }
  setStatus(`${manifest.stats.buildings.toLocaleString()} building footprints · municipality-wide inventory`);
}
async function start(){
  bind();
  try{
    [manifest,landmarks]=await Promise.all([json('manifest.json'),json('landmarks.json')]);
    $('building-count').textContent=manifest.stats.buildings.toLocaleString();$('tree-count').textContent=manifest.stats.trees.toLocaleString();
    for(const l of landmarks){const option=document.createElement('option');option.value=l.id;option.textContent=l.name;$('landmark').append(option);}
    for(const s of manifest.sources){const li=document.createElement('li'),a=document.createElement('a');a.href=s.url;a.textContent=`${s.name} — ${s.count.toLocaleString()} source records`;li.append(a,document.createTextNode(` · retrieved ${s.retrievedAt.slice(0,10)}`));$('source-list').append(li);}
    $('source-summary').textContent=`${manifest.stats.floorEstimates.toLocaleString()} footprints use floor-based height estimates; ${manifest.stats.fallbackEstimates.toLocaleString()} use the fallback.`;
    try{initRenderer();}catch(e){$('fallback').hidden=false;setStatus('The source inventory is available; 3D rendering is unavailable.');console.warn('3D unavailable',e);return;}
    await buildScene();
    if(location.hash==='#pilot')flyTo(views.pilot,true);
    // Read-only diagnostics used by the data/performance smoke check.
    window.miamiBeach={get diagnostics(){return {ready:true,footprints:manifest.stats.buildings,pilotBuildings:realism?.records.length||0,realism:state.realism,overviewTiles:overview.size,detailTiles:loaded.size,pendingTiles:pending.size,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,fps:Math.round(fps),camera:camera.position.toArray(),target:controls.target.toArray(),mode:state.mode};}};
  }catch(e){setStatus('City data could not be loaded. Reload to try again.');$('fallback').hidden=false;$('fallback').querySelector('h2').textContent='The city data is unavailable';$('fallback').querySelector('p').textContent='Reload this page to retry. The source manifest is linked in About the model.';console.error(e);}
}
void start();
