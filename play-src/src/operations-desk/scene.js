import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = {repo: 0x8de8e0, dir: 0x84aef5, file: 0xa4b8ce, record: 0xc1a8ea, run: 0xedc585, job: 0xedc585};
export function createScene({canvas, labels, onActivate, onMode}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'low-power'}); }
  catch { onMode(false); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08111f, .011);
  const camera = new THREE.PerspectiveCamera(46, 1, .1, 220);
  camera.position.set(30, 32, 42);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .085;
  controls.minDistance = 9; controls.maxDistance = 110;
  controls.maxPolarAngle = Math.PI * .47;
  controls.minPolarAngle = .12;
  controls.rotateSpeed = .6; controls.zoomSpeed = .75;
  controls.target.set(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xa7c8f0, 0x101724, 2.1));
  const key = new THREE.DirectionalLight(0xc8e4ff, 3.3); key.position.set(10, 30, 10); scene.add(key);
  const amber = new THREE.PointLight(0xf2b86e, 70, 55, 1.7); amber.position.set(-18, 9, 6); scene.add(amber);
  const cyan = new THREE.PointLight(0x72e6df, 90, 60, 1.8); cyan.position.set(18, 6, -8); scene.add(cyan);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(180,180), new THREE.MeshStandardMaterial({color:0x091422, roughness:.7, metalness:.5, transparent:true,opacity:.7}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-4;scene.add(floor);
  const grid = new THREE.GridHelper(160,64,0x29475b,0x183246);grid.position.y=-3.98;grid.material.transparent=true;grid.material.opacity=.33;scene.add(grid);
  const orbital = new THREE.Group();
  for (const radius of [21,38,57]) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(radius,radius+.025,160),new THREE.MeshBasicMaterial({color:0x40566d,transparent:true,opacity:.35,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.y=-3.94;orbital.add(ring);
  }
  scene.add(orbital);
  const stars = new THREE.BufferGeometry(), positions=[];
  for(let i=0;i<160;i++)positions.push(Math.sin(i*83.2)*80,2+((i*13)%40),Math.cos(i*17.3)*80);
  stars.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const atmosphere=new THREE.Points(stars,new THREE.PointsMaterial({color:0x8ea9c5,size:.065,transparent:true,opacity:.45}));scene.add(atmosphere);
  let objects=new THREE.Group(), items=[], paths=[], model={nodes:[],edges:[]}, selectedId=null, paused=false, reduced=false, disposed=false, contextLost=false, frame=0, lastTime=0, lastRendered=0, pointerStart=null, tween=null, dirty=true;
  scene.add(objects);
  const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
  const targetPoint=new THREE.Vector3();
  const glowTexture=(()=>{
    const size=64, data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=Math.hypot(x-31.5,y-31.5)/31.5, p=(y*size+x)*4;data[p]=data[p+1]=data[p+2]=255;data[p+3]=Math.max(0,Math.pow(1-Math.min(1,d),2)*170);}
    const texture=new THREE.DataTexture(data,size,size);texture.needsUpdate=true;return texture;
  })();
  function glow(color,size,position) { const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));sprite.scale.set(size,size,1);sprite.position.copy(position);return sprite; }
  function release(group) {group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
  function makeObject(node) {
    const color=COLORS[node.kind]||COLORS.file, group=new THREE.Group(), major=node.kind==='repo';
    const base=new THREE.Mesh(new THREE.CylinderGeometry(major?2.6:1.75,major?2.9:1.95,.28,6),new THREE.MeshStandardMaterial({color:0x132638,roughness:.45,metalness:.65}));
    base.position.y=-.8;group.add(base);
    const rim=new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:.5}));rim.position.copy(base.position);group.add(rim);
    const height=major?2.9:node.kind==='dir'?1.7:.6;
    const geometry=major?new THREE.CylinderGeometry(.9,1.2,height,6):new THREE.BoxGeometry(node.kind==='dir'?2:1.5,height,node.kind==='dir'?1.3:1);
    const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:major?0x204558:node.kind==='dir'?0x243b62:0x28354b,emissive:color,emissiveIntensity:.16,metalness:.6,roughness:.35}));body.position.y=.1+height/2;group.add(body);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:.8}));outline.position.copy(body.position);group.add(outline);
    if(major){
      for(let i=0;i<3;i++){const band=new THREE.Mesh(new THREE.TorusGeometry(1.14,.025,5,6),new THREE.MeshBasicMaterial({color}));band.rotation.x=Math.PI/2;band.position.y=.65+i*.8;group.add(band);}
      const spire=new THREE.Mesh(new THREE.OctahedronGeometry(.46),new THREE.MeshStandardMaterial({color:0xd6f8f5,emissive:color,emissiveIntensity:.6,metalness:.5,roughness:.2}));spire.position.y=4.05;group.add(spire);
    } else if(node.kind==='dir') {
      const tab=new THREE.Mesh(new THREE.BoxGeometry(.85,.35,.25),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.18}));tab.position.set(-.5,2,0);group.add(tab);
    }
    const halo=glow(color,major?6:3.8,new THREE.Vector3(0,height/2,0));group.add(halo);
    const marker=new THREE.Mesh(new THREE.RingGeometry(major?3:2.1,major?3.08:2.18,64),new THREE.MeshBasicMaterial({color:0xf0c789,side:THREE.DoubleSide,transparent:true,opacity:.9}));marker.rotation.x=-Math.PI/2;marker.position.y=-.58;marker.visible=false;group.add(marker);
    group.position.set(...node.position);objects.add(group);
    const label=document.createElement('button');label.type='button';label.className='scene-label';label.dataset.kind=node.kind;label.dataset.node=node.id;
    const name=document.createElement('span');name.textContent=node.label;
    const meta=document.createElement('small');meta.textContent=node.subtitle;
    label.append(name,meta);label.setAttribute('aria-label',`${node.label} · ${node.subtitle}`);
    label.title=`${node.label} · ${node.subtitle}`;
    label.addEventListener('click',()=>onActivate(node));label.addEventListener('focus',()=>select(node.id));labels.append(label);
    body.userData.node=node;
    return {node,group,body,label,marker,halo,labelPoint:new THREE.Vector3(...node.position).add(new THREE.Vector3(0,major?5:3,0))};
  }
  function setModel(next,{selected=null,reset=true}={}) {
    release(objects);scene.remove(objects);objects=new THREE.Group();scene.add(objects);labels.replaceChildren();paths=[];model=next;
    items=model.nodes.map(makeObject);const map=new Map(items.map(i=>[i.node.id,i]));
    for(const edge of model.edges){const from=map.get(edge.from),to=map.get(edge.to);if(!from||!to)continue;
      const a=from.group.position.clone().add(new THREE.Vector3(0,1,0)),b=to.group.position.clone().add(new THREE.Vector3(0,1,0));
      const middle=a.clone().lerp(b,.5);middle.y+=Math.min(5,a.distanceTo(b)*.18);
      const curve=new THREE.QuadraticBezierCurve3(a,middle,b);
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(36)),new THREE.LineBasicMaterial({color:0x6abfc5,transparent:true,opacity:.28}));objects.add(line);
      const pulse=new THREE.Mesh(new THREE.SphereGeometry(.11,6,6),new THREE.MeshBasicMaterial({color:0xffdc9d}));pulse.visible=false;objects.add(pulse);paths.push({edge,line,pulse,curve});
    }
    select(selected);if(reset)resetCamera();dirty=true;requestFrame();
  }
  function move(target,position) {tween={start:performance.now(),from:camera.position.clone(),to:position.clone(),oldTarget:controls.target.clone(),target:target.clone()};if(reduced){camera.position.copy(position);controls.target.copy(target);tween=null;controls.update();}dirty=true;requestFrame();}
  function resetCamera() {
    const bounds=new THREE.Box3();for(const item of items)bounds.expandByPoint(item.group.position);
    if(bounds.isEmpty()){move(new THREE.Vector3(),new THREE.Vector3(28,30,38));return;}
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const extent=Math.max(size.x,size.z,15), distance=THREE.MathUtils.clamp((extent*.94+16)*Math.max(1,1.3/camera.aspect),26,85);
    move(center.clone().add(new THREE.Vector3(0,-1,0)),center.clone().add(new THREE.Vector3(distance*.52,distance*.7,distance*.93)));
  }
  function focus(id) {const item=items.find(x=>x.node.id===id);if(!item)return;const point=item.group.position.clone().add(new THREE.Vector3(0,1,0));move(point,point.clone().add(new THREE.Vector3(11,13,20)));select(id);}
  function select(id) {selectedId=id;for(const item of items){const active=item.node.id===id;item.marker.visible=active;item.label.classList.toggle('selected',active);item.body.material.emissiveIntensity=active?.5:.16;}for(const p of paths){const active=[p.edge.from,p.edge.to].includes(id);p.line.material.opacity=active?.8:.23;p.line.material.color.setHex(active?0xe9c58c:0x6abfc5);p.pulse.visible=active&&!paused&&!reduced;}dirty=true;requestFrame();}
  function projectLabels() {
    const w=canvas.clientWidth,h=canvas.clientHeight,placed=[];
    const ordered=[...items].sort((a,b)=>(b.node.id===selectedId)-(a.node.id===selectedId)||a.group.position.distanceTo(camera.position)-b.group.position.distanceTo(camera.position));
    for(const item of ordered){const p=item.labelPoint.clone().project(camera),x=(p.x*.5+.5)*w,y=(-p.y*.5+.5)*h;
      const width=Math.min(w<500?120:150,Math.max(80,item.node.label.length*5.4+20));
      const candidates=[[0,0],[0,-43],[0,43],[-65,-24],[65,-24],[0,-86],[0,86],[-80,40],[80,40]];
      const candidate=candidates.map(([dx,dy])=>({x:x+dx,y:y+dy,width})).find(q=>q.x>width/2+4&&q.x<w-width/2-4&&q.y>25&&q.y<h-72&&!placed.some(other=>Math.abs(other.x-q.x)<(other.width+width)/2+5&&Math.abs(other.y-q.y)<42));
      const visible=p.z<1&&p.z>-1&&!!candidate;
      item.label.hidden=!visible;if(visible){item.label.style.transform=`translate(${candidate.x}px,${candidate.y}px) translate(-50%, -50%)`;placed.push(candidate);}
    }
  }
  function render(now) {
    frame=0;if(disposed||contextLost||document.hidden)return;
    if(!paused&&!reduced&&!tween&&now-lastRendered<1000/30){requestFrame();return;}lastRendered=now;
    const delta=Math.min((now-lastTime)/1000,.05);lastTime=now;
    if(tween){const t=Math.min(1,(now-tween.start)/(paused||reduced?1:850)),ease=1-Math.pow(1-t,4);camera.position.lerpVectors(tween.from,tween.to,ease);controls.target.lerpVectors(tween.oldTarget,tween.target,ease);if(t===1)tween=null;dirty=true;}
    controls.update();
    if(!paused&&!reduced){atmosphere.rotation.y+=delta*.004;for(let i=0;i<paths.length;i++){const p=paths[i];if(p.pulse.visible)p.pulse.position.copy(p.curve.getPoint((now/2400+i*.19)%1));}dirty=true;}
    if(dirty){renderer.render(scene,camera);projectLabels();dirty=false;}
    if(!paused&&!reduced||tween)requestFrame();
  }
  function requestFrame(){if(!frame&&!document.hidden&&!disposed&&!contextLost)frame=requestAnimationFrame(render);}
  const changed=()=>{dirty=true;requestFrame();};controls.addEventListener('change',changed);
  controls.addEventListener('start',()=>{tween=null;});
  function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();dirty=true;requestFrame();}
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function pointerDown(e){pointerStart={x:e.clientX,y:e.clientY};}
  function pointerUp(e){if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;pointerStart=null;const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(items.map(x=>x.body))[0];if(hit)onActivate(hit.object.userData.node);}
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);
  function keydown(e){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){resetCamera();return;}const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')spherical.theta-=.12;if(e.key==='ArrowRight')spherical.theta+=.12;if(e.key==='ArrowUp')spherical.phi=Math.max(.12,spherical.phi-.1);if(e.key==='ArrowDown')spherical.phi=Math.min(Math.PI*.47,spherical.phi+.1);if(e.key==='+')spherical.radius=Math.max(9,spherical.radius*.9);if(e.key==='-')spherical.radius=Math.min(110,spherical.radius*1.1);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();changed();}
  canvas.addEventListener('keydown',keydown);
  function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{lastTime=performance.now();changed();}}
  document.addEventListener('visibilitychange',visibility);
  function lost(e){e.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;labels.replaceChildren();onMode(false);}
  canvas.addEventListener('webglcontextlost',lost);
  onMode(true);resize();requestFrame();
  return {setModel,focus,select,reset:resetCamera,zoom(factor){const offset=camera.position.clone().sub(controls.target).multiplyScalar(factor);offset.clampLength(9,110);move(controls.target,controls.target.clone().add(offset));},setMotion(value,isReduced=false){paused=value;reduced=isReduced;controls.enableDamping=!paused&&!reduced;for(const p of paths)p.pulse.visible=!paused&&!reduced&&[p.edge.from,p.edge.to].includes(selectedId);changed();},clear(){setModel({nodes:[],edges:[]});},dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('keydown',keydown);canvas.removeEventListener('webglcontextlost',lost);release(scene);glowTexture.dispose();renderer.dispose();labels.replaceChildren();}};
}
