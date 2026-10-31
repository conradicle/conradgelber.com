import {loadCesium} from '../aspen/viewer.js';
import {MIAMI,COLORS,level} from './model.js';

export async function createScene(container) {
 const C=await loadCesium(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const phone=matchMedia('(max-width:700px)').matches;
 // Stream detailed satellite tiles as the camera approaches the coast.
 // Cesium preserves the service's source attribution in its credit display.
 const imagery=await C.ArcGisMapServerImageryProvider.fromUrl(
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  {enablePickFeatures:false,maximumLevel:19},
 );
 const viewer=new C.Viewer(container,{baseLayer:new C.ImageryLayer(imagery),geocoder:false,animation:false,timeline:false,baseLayerPicker:false,sceneModePicker:false,navigationHelpButton:false,homeButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,msaaSamples:4,useBrowserRecommendedResolution:false});
 viewer.resolutionScale=Math.min(1,(phone?1.5:2)/(devicePixelRatio||1));
 viewer.scene.globe.maximumScreenSpaceError=phone?1.5:1;
 viewer.scene.globe.tileCacheSize=phone?150:400;
 viewer.targetFrameRate=phone?30:60;
 viewer.scene.screenSpaceCameraController.minimumZoomDistance=10000;
 viewer.scene.screenSpaceCameraController.maximumZoomDistance=30000000;
 const render=()=>viewer.scene.requestRender();
 const position=p=>C.Cartesian3.fromDegrees(p.lon,p.lat,5000);
 const miami=C.Cartesian3.fromDegrees(...MIAMI);
 const makeLabel=text=>({text,font:'500 13px "IBM Plex Sans", sans-serif',fillColor:C.Color.WHITE,showBackground:true,backgroundColor:C.Color.fromCssColorString('#13233c').withAlpha(.9),pixelOffset:new C.Cartesian2(0,-20),disableDepthTestDistance:Infinity});
 viewer.entities.add({position:miami,point:{pixelSize:9,color:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:2},label:{...makeLabel('MIAMI'),pixelOffset:new C.Cartesian2(0,22)}});
 let target=miami,range=1800000,heading=0,paused=reduced,holding=false,flying=false,idleUntil=0,recenter=false,dead=false,frame;
 let segments=[],landfalls=[],marker=null;
 // Aspen's flyToBoundingSphere / HeadingPitchRange camera pattern, 180-second
 // orbit, six-second input grace period and smooth return after manual input.
 function fly(duration=2.5) {
  flying=true;recenter=false;
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target,100),{duration:reduced?0:duration,offset:new C.HeadingPitchRange(heading,-.75,range),complete:()=>{flying=false;},cancel:()=>{flying=false;}});
 }
 function loop(now) {
  if(dead)return;
  const dt=Math.min((now-(loop.last||now))/1000,.1);loop.last=now;
  if(!document.hidden&&!paused&&!holding&&!flying&&now>idleUntil){
   if(recenter)fly(1.5);
   else {heading+=dt*Math.PI*2/180;viewer.camera.lookAt(target,new C.HeadingPitchRange(heading,-.75,range));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);render();}
  }
  frame=requestAnimationFrame(loop);
 }
 function interact(){recenter=true;idleUntil=performance.now()+6000;if(flying)viewer.camera.cancelFlight();}
 const listeners=[[viewer.canvas,'pointerdown',()=>{holding=true;interact();}],[window,'pointerup',()=>{holding=false;idleUntil=performance.now()+6000;}],[window,'pointercancel',()=>{holding=false;}],[viewer.canvas,'wheel',interact]];
 for(const [el,type,fn] of listeners)el.addEventListener(type,fn,{passive:true});
 viewer.camera.setView({destination:C.Cartesian3.fromDegrees(-65,30,15000000)});fly(3);frame=requestAnimationFrame(loop);
 return {
  get paused(){return paused;},
  togglePause(){paused=!paused;return paused;},
  miami(){target=miami;range=1800000;heading=0;fly();},
  fit(storm){const sphere=C.BoundingSphere.fromPoints(storm.points.map(position));target=sphere.center;range=Math.max(600000,sphere.radius*3.3);heading=0;fly();},
  load(storm){
   for(const e of [...segments.map(s=>s.entity),...landfalls.map(l=>l.entity),marker].filter(Boolean))viewer.entities.remove(e);
   segments=[];landfalls=[];
   viewer.entities.suspendEvents();
   for(let i=0;i<storm.points.length-1;i++){
    const a=storm.points[i],b=storm.points[i+1];
    const entity=viewer.entities.add({show:false,polyline:{positions:[position(a),position(b)],width:5,arcType:C.ArcType.GEODESIC,material:new C.PolylineOutlineMaterialProperty({color:C.Color.fromCssColorString(COLORS[level(a.wind)]),outlineColor:C.Color.fromCssColorString('#13233c'),outlineWidth:1})}});
    segments.push({a,b,entity,complete:false});
   }
   for(const [i,p] of storm.points.filter(p=>p.record==='L').entries())landfalls.push({time:p.time,entity:viewer.entities.add({show:false,position:position(p),label:{...makeLabel('◆ '+new Date(p.time).toISOString().slice(0,10)),pixelOffset:new C.Cartesian2(12,-25-(i%4)*25),horizontalOrigin:C.HorizontalOrigin.LEFT},point:{pixelSize:6,color:C.Color.WHITE}})});
   marker=viewer.entities.add({position:position(storm.points[0]),point:{pixelSize:14,color:C.Color.WHITE,outlineColor:C.Color.fromCssColorString('#13233c'),outlineWidth:3,disableDepthTestDistance:Infinity}});
   viewer.entities.resumeEvents();render();
  },
  update(p){
   for(const s of segments){
    s.entity.show=p.time>s.a.time;
    if(p.time>=s.b.time){if(!s.complete)s.entity.polyline.positions=[position(s.a),position(s.b)];s.complete=true;}
    else if(p.time>s.a.time){s.entity.polyline.positions=[position(s.a),position(p)];s.complete=false;}
    else s.complete=false;
   }
   for(const l of landfalls)l.entity.show=p.time>=l.time;
   if(marker)marker.position=position(p);render();
  },
  destroy(){dead=true;cancelAnimationFrame(frame);for(const [el,type,fn] of listeners)el.removeEventListener(type,fn);viewer.destroy();},
 };
}
