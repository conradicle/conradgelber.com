import {getDifficulty} from './mountains.js';
const $=id=>document.getElementById(id);
const CESIUM_ROOT='https://cesium.com/downloads/cesiumjs/releases/1.133/Build/Cesium/';
let library;
function loadCesium(){
 if(window.Cesium)return Promise.resolve(window.Cesium);
 if(!library)library=new Promise((resolve,reject)=>{window.CESIUM_BASE_URL=CESIUM_ROOT;const css=document.createElement('link');css.rel='stylesheet';css.href=CESIUM_ROOT+'Widgets/widgets.css';document.head.append(css);const s=document.createElement('script');s.src=CESIUM_ROOT+'Cesium.js';s.onload=()=>resolve(window.Cesium);s.onerror=()=>{s.remove();library=null;reject(new Error('The 3D engine could not load. Check your connection and try again.'))};document.head.append(s)});
 return library;
}
export async function startExplorer(m,isCurrent,onCleanup){
 const controller=new AbortController();
 const response=await fetch('/aspen/config',{signal:controller.signal});
 if(!response.ok)throw new Error('The mountain viewer is awaiting its Cesium ion access token. The valley map is ready to explore.');
 const {token}=await response.json();if(!token)throw new Error('The mountain viewer is awaiting its Cesium ion access token.');
 if(!isCurrent())return;const C=await loadCesium();if(!isCurrent())return;
 C.Ion.defaultAccessToken=token;
 let viewer,handler,frame,tileset;const removes=[];let dead=false;
 const cleanup=()=>{if(dead)return;dead=true;controller.abort();cancelAnimationFrame(frame);removes.forEach(fn=>fn());if(handler&&!handler.isDestroyed())handler.destroy();if(viewer&&!viewer.isDestroyed())viewer.destroy();$('orbit').onclick=null;$('reset').onclick=null;$('trail-select').onchange=null;};
 onCleanup(cleanup);
 try{
 viewer=new C.Viewer('cesium',{globe:false,baseLayer:false,geocoder:false,animation:false,timeline:false,baseLayerPicker:false,sceneModePicker:false,navigationHelpButton:false,homeButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,msaaSamples:1});
 viewer.resolutionScale=Math.min(1,1.5/(window.devicePixelRatio||1));viewer.targetFrameRate=30;
 viewer.scene.screenSpaceCameraController.minimumZoomDistance=150;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let recenter=false,paused=reduced,holding=false,idleUntil=0,flying=true,last=performance.now(),heading=0;
 const target=C.Cartesian3.fromDegrees(m.lon,m.lat,m.height);
 const orbitButton=$('orbit');orbitButton.disabled=false;$('reset').disabled=false;
 const updateButton=()=>{orbitButton.textContent=paused?'Resume orbit':'Pause orbit';orbitButton.setAttribute('aria-pressed',String(!paused));};updateButton();
 const interact=()=>{recenter=true;idleUntil=performance.now()+6000;flying=false;viewer.camera.cancelFlight();};
 const down=()=>{holding=true;interact()};const up=()=>{holding=false;idleUntil=performance.now()+6000};
 for(const [el,type,fn] of [[viewer.canvas,'pointerdown',down],[window,'pointerup',up],[window,'pointercancel',up],[viewer.canvas,'wheel',interact],[viewer.canvas,'keydown',interact],[$('panel'),'pointerdown',interact],[$('panel'),'keydown',interact]]){el.addEventListener(type,fn,{passive:true});removes.push(()=>el.removeEventListener(type,fn));}
 orbitButton.onclick=()=>{paused=!paused;idleUntil=0;updateButton()};
 function fly(){recenter=false;flying=true;heading=0;viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.camera.setView({destination:C.Cartesian3.fromDegrees(-106.89,39.20,24000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target,100),{duration:reduced?0:4,offset:new C.HeadingPitchRange(0,-.48,m.range),complete:()=>{flying=false},cancel:()=>{flying=false}});}
 $('reset').onclick=fly;fly();
 function loop(now){const dt=Math.min((now-last)/1000,.1);last=now;if(!dead&&!document.hidden&&!paused&&!holding&&!flying&&now>idleUntil){if(recenter){recenter=false;flying=true;viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target,100),{duration:1.5,offset:new C.HeadingPitchRange(heading,-.48,m.range),complete:()=>{flying=false},cancel:()=>{flying=false}});}else{heading+=dt*Math.PI*2/180;viewer.camera.lookAt(target,new C.HeadingPitchRange(heading,-.48,m.range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();}}if(!dead)frame=requestAnimationFrame(loop);}frame=requestAnimationFrame(loop);
 tileset=await C.createGooglePhotorealistic3DTileset({onlyUsingWithGoogleGeocoder:true},{maximumScreenSpaceError:matchMedia('(max-width:700px)').matches?24:16,cacheBytes:96*1024*1024,maximumCacheOverflowBytes:32*1024*1024,enableCollision:true});
 if(dead||!isCurrent()){tileset.destroy();cleanup();return;}
 viewer.scene.primitives.add(tileset);
 removes.push(tileset.loadProgress.addEventListener((pending,processing)=>{if(!isCurrent())return;$('status').hidden=pending+processing===0;$('status').textContent='Loading mountain detail…';}));
 removes.push(tileset.tileFailed.addEventListener(()=>{if(!isCurrent())return;$('status').hidden=false;$('status').textContent='Some tiles could not load. Check your connection or retry.';}));
 const dataResponse=await fetch(`/aspen/data/${m.id}.geojson`,{signal:controller.signal});if(!dataResponse.ok)throw new Error('Trail data could not load. Please try again.');const data=await dataResponse.json();if(dead||!isCurrent()){cleanup();return;}
 const entries=new Map();
 function show(entity){const p=entries.get(entity?.id);if(!p)return;interact();const d=getDifficulty(p['piste:difficulty']);$('run-detail').textContent=p.aerialway?`${p.name||'Unnamed lift'} · Lift (${p.aerialway.replaceAll('_',' ')})`:`${d.symbol} ${p.name||p['piste:name']||'Unnamed run'} · ${d.label}`;$('trail-select').value=entity.id;}
 viewer.entities.suspendEvents();
 for(const f of data.features){const p=f.properties,coords=f.geometry.coordinates,d=getDifficulty(p['piste:difficulty']),lift=!!p.aerialway;const color=C.Color.fromCssColorString(lift?'#f4bd53':d.color);const mid=coords[Math.floor(coords.length/2)];
 const entity=viewer.entities.add({id:String(f.id),name:p.name||p['piste:name']||'Unnamed run',polyline:{positions:C.Cartesian3.fromDegreesArray(coords.flat()),width:lift?3:5,clampToGround:true,classificationType:C.ClassificationType.CESIUM_3D_TILE,material:lift||d.dash?new C.PolylineDashMaterialProperty({color,gapColor:C.Color.WHITE.withAlpha(.5),dashLength:lift?16:10}):new C.PolylineOutlineMaterialProperty({color,outlineColor:C.Color.WHITE,outlineWidth:1})},position:C.Cartesian3.fromDegrees(...mid),label:{text:lift?'↟':d.symbol,font:'bold 16px sans-serif',fillColor:color,outlineColor:C.Color.WHITE,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,heightReference:C.HeightReference.CLAMP_TO_3D_TILE,showBackground:true,backgroundColor:C.Color.WHITE.withAlpha(.8),distanceDisplayCondition:new C.DistanceDisplayCondition(0,18000),pixelOffset:new C.Cartesian2(0,-9),scale:.85}});entries.set(entity.id,p);
 }
 viewer.entities.resumeEvents();
 for(const [id,p] of [...entries].sort((a,b)=>(a[1].name||'').localeCompare(b[1].name||''))){const d=getDifficulty(p['piste:difficulty']);$('trail-select').add(new Option(`${p.aerialway?'↟':d.symbol} ${p.name||p['piste:name']||'Unnamed'} · ${p.aerialway?'Lift':d.label}`,id));}
 $('trail-select').onchange=()=>show(viewer.entities.getById($('trail-select').value));
 handler=new C.ScreenSpaceEventHandler(viewer.canvas);handler.setInputAction(e=>{const picked=viewer.scene.pick(e.position);if(picked?.id)show(picked.id)},C.ScreenSpaceEventType.LEFT_CLICK);
 viewer.scene.requestRender();return cleanup;
 }catch(e){console.error('Aspen viewer initialization failed:', e);cleanup();throw new Error(e.message?.includes('Trail data')?e.message:'The 3D view could not start. Check the Cesium token, Google 3D Tiles access, your connection, and WebGL support, then try again.');}
}
