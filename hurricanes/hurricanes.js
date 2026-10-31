import {COLORS,label,distance,sample} from './model.js';
import {createScene} from './viewer.js?v=2';
const $=id=>document.getElementById(id);
const utc=t=>new Date(t).toISOString().replace('T',' ').slice(0,16)+' UTC';
const name=s=>`${s.displayName||s.name} · ${s.year}`;
const cache=new Map();
let index=[],storm=null,scene=null,time=0,playing=false,request=0,previous=null;
function message(s){$('data-status').textContent=s;}
function play(value){playing=value;$('play').textContent=value?'Pause':'Play';}
for(const [i,text] of ['Below TS','TS','Cat 1','Cat 2','Cat 3','Cat 4','Cat 5'].entries()){
 const item=document.createElement('span');item.className='key';const swatch=document.createElement('span');swatch.className='swatch';swatch.style.backgroundColor=COLORS[i];item.append(swatch,text);$('legend').append(item);
}
function paint(){
 if(!storm)return;
 const p=sample(storm.points,time);scene?.update(p);
 $('time').textContent=utc(time);$('time').dateTime=new Date(time).toISOString();
 const statuses={HU:'Hurricane',TS:'Tropical storm',TD:'Tropical depression',EX:'Extratropical',SD:'Subtropical depression',SS:'Subtropical storm',LO:'Low',WV:'Tropical wave',DB:'Disturbance'};
 $('status').textContent=`${p.status} · ${statuses[p.status]||p.status}`;
 $('category').textContent=label(p.wind);
 $('wind').textContent=p.wind==null?'Not recorded':`${Math.round(p.wind*1.15078)} mph / ${p.wind} kt`;
 $('pressure').textContent=p.pressure==null?'Not recorded':`${p.pressure} mb`;
 $('distance').textContent=`${distance(p.lat,p.lon).toFixed(1)} miles`;
 $('scrubber').value=Math.round((time-storm.points[0].time)/(storm.points.at(-1).time-storm.points[0].time)*1000)||0;
 $('scrubber').setAttribute('aria-valuetext',utc(time));
 const reached=time>=storm.closest.time;
 $('callout').hidden=!reached;
 const callout=`Closest approach: ${storm.closest.miles.toFixed(1)} miles from Miami · ${utc(storm.closest.time)} (interpolated).`;
 if(reached&&$('callout').textContent!==callout)$('callout').textContent=callout;
}
function filter(){
 const q=$('search').value.trim().toLowerCase();
 const matches=index.filter(s=>(`${name(s)} ${s.id}`.toLowerCase().includes(q))&&(!$('near').checked||s.closestMiles<=100)).sort((a,b)=>b.year-a.year||a.name.localeCompare(b.name));
 $('storms').replaceChildren(...matches.map(s=>new Option(`${name(s)} · ${label(s.peakWind)} peak · ${Math.round(s.closestMiles)} mi`,s.id)));
 $('storms').value=storm?.id||'';$('count').textContent=`(${matches.length})`;
}
async function open(id,fit=true){
 const seq=++request;play(false);$('controls').disabled=true;message('Loading storm…');
 try{
  if(!cache.has(id)){const r=await fetch(`/hurricanes/data/${id}.json`);if(!r.ok)throw new Error('Storm data could not load. Select the storm again to retry.');cache.set(id,await r.json());}
  if(seq!==request)return;
  storm=cache.get(id);time=storm.points[0].time;scene?.load(storm);if(fit)scene?.fit(storm);
  $('storm-title').textContent=name(storm);$('controls').disabled=false;
  $('landfalls').replaceChildren(...storm.points.filter(p=>p.record==='L').map(p=>{const li=document.createElement('li');li.textContent=`◆ ${utc(p.time)} · ${label(p.wind)}`;return li;}));
  if(!$('landfalls').children.length){const li=document.createElement('li');li.textContent='No landfall records in this track.';$('landfalls').append(li);}
  document.querySelectorAll('#featured button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));
  $('storms').value=id;message(`${storm.points.length} NOAA observations · ${Math.round(storm.closest.miles)} mi closest to Miami`);paint();
 }catch(e){if(seq===request){message(e.message);$('controls').disabled=!storm;}}
}
async function archive(){
 $('retry-data').hidden=true;
 try{
  const [r,s]=await Promise.all([fetch('/hurricanes/data/index.json'),fetch('/hurricanes/data/source.json')]);
  if(!r.ok||!s.ok)throw new Error('Archive could not load. Please retry.');
  index=await r.json();const source=await s.json();$('source').href=source.url;$('source').textContent=`NOAA / NHC HURDAT2 · 1851–${source.through}`;
  $('featured').replaceChildren();
  for(const [n,y] of [['Andrew',1992],['Irma',2017],['Wilma',2005],['Katrina',2005],['Great Miami Hurricane',1926]]){
   const s=index.find(s=>s.year===y&&(s.name===n||s.displayName===n));if(!s)continue;
   const b=document.createElement('button');b.textContent=name(s);b.dataset.id=s.id;b.setAttribute('aria-pressed','false');b.onclick=()=>open(s.id);$('featured').append(b);
  }
  filter();const initial=index.find(s=>s.name==='Andrew'&&s.year===1992);if(initial)await open(initial.id,false);
 }catch(e){message(e.message);$('retry-data').hidden=false;}
}
async function map(){
 $('map-error').hidden=true;
 try{scene=await createScene('cesium');for(const id of ['orbit','miami','fit'])$(id).disabled=false;$('orbit').textContent=scene.paused?'Resume orbit':'Pause orbit';if(storm){scene.load(storm);paint();}}
 catch(e){$('map-message').textContent=e.message||'Check your connection and WebGL support. The archive and readout remain available.';$('map-error').hidden=false;}
}
$('play').onclick=()=>{if(!storm)return;if(time>=storm.points.at(-1).time)time=storm.points[0].time;play(!playing);paint();};
$('scrubber').oninput=()=>{if(!storm)return;play(false);time=storm.points[0].time+Number($('scrubber').value)/1000*(storm.points.at(-1).time-storm.points[0].time);paint();};
$('search').oninput=filter;$('near').onchange=filter;$('storms').onchange=()=>{if($('storms').value)open($('storms').value);};
$('miami').onclick=()=>scene?.miami();$('fit').onclick=()=>{if(storm)scene?.fit(storm);};$('orbit').onclick=()=>{$('orbit').textContent=scene.togglePause()?'Resume orbit':'Pause orbit';};
$('retry-data').onclick=archive;$('retry-map').onclick=map;
function tick(now){const dt=previous==null?0:Math.min(now-previous,100);previous=now;if(playing&&storm&&!document.hidden){time=Math.min(storm.points.at(-1).time,time+dt*21600*Number($('speed').value));paint();if(time>=storm.points.at(-1).time)play(false);}requestAnimationFrame(tick);}
window.addEventListener('pagehide',()=>{play(false);});
archive();map();requestAnimationFrame(tick);
