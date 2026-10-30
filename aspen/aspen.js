import {mountains} from './mountains.js';
const $ = id => document.getElementById(id);
let active=null, dispose=null, generation=0;
const format=n=>n.toLocaleString('en-US');
const project=(lon,lat)=>[(lon+107.015)/.23*1000,(39.245-lat)/.135*540];
const [tx,ty]=project(-106.818,39.191);
$('town').innerHTML=`<circle cx="${tx}" cy="${ty}" r="5" fill="#13233c"/><text x="${tx+12}" y="${ty-8}" class="map-label">ASPEN</text>`;
function highlight(id){active=id;const m=mountains.find(m=>m.id===id);$('map-detail').textContent=`${m.name} · ${format(m.summit)}′ summit · ${format(m.vertical)}′ vertical · ${m.runs} runs`;document.querySelectorAll('[data-mountain]').forEach(el=>el.classList.toggle('active',el.dataset.mountain===id));}
function choose(m,event){if(event.pointerType==='touch'&&active!==m.id){highlight(m.id);return;}openMountain(m);}
for(const m of mountains){
 const [x,y]=project(m.lon,m.lat);
 const g=document.createElementNS('http://www.w3.org/2000/svg','g');
 g.classList.add('marker');g.dataset.mountain=m.id;g.setAttribute('transform',`translate(${x},${y})`);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',`${m.name}, summit ${format(m.summit)} feet, vertical ${format(m.vertical)} feet, ${m.runs} runs. Explore in 3D`);
 g.innerHTML=`<title>${m.name} · ${format(m.summit)} ft summit · ${format(m.vertical)} ft vertical · ${m.runs} runs</title><rect class="hit" x="-70" y="-70" width="150" height="110"/><path class="peak" d="M-38 8L0-53 38 8Z M-13-32L0-53 14-30 1-36Z"/><text text-anchor="middle" y="36">${m.name}</text>`;
 g.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')highlight(m.id)});g.addEventListener('click',e=>choose(m,e));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMountain(m)}});$('mountain-markers').append(g);
 const b=document.createElement('button');b.className='mountain-card';b.dataset.mountain=m.id;b.innerHTML=`<strong>${m.name}</strong><span class="card-stats">${format(m.summit)}′ summit<br>${format(m.vertical)}′ vertical · ${m.runs} runs</span><span class="enter">Explore mountain ↗</span>`;b.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')highlight(m.id)});b.addEventListener('click',e=>choose(m,e));$('mountain-cards').append(b);
}
// Panel registry: v2 can supply mount/unmount functions without changing the viewer.
const panels=[{id:'snow',title:'Snow report'},{id:'webcams',title:'Webcams'}];
for(const p of panels){const s=document.createElement('section');s.className='future-panel';s.dataset.panel=p.id;s.innerHTML=`<h3>${p.title}</h3><p>Coming in v2</p>`;$('future-panels').append(s)}
async function openMountain(m){
 const version=++generation;dispose?.();dispose=null;highlight(m.id);$('valley').hidden=true;$('explorer').hidden=false;$('error').hidden=true;$('status').hidden=false;$('status').textContent='Preparing mountain…';$('mountain-name').textContent=m.name;$('mountain-tag').textContent=m.tag;$('mountain-name').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});$('stats').innerHTML=`<div><strong>${format(m.summit)}′</strong><span>SUMMIT</span></div><div><strong>${format(m.vertical)}′</strong><span>VERTICAL</span></div><div><strong>${m.runs}</strong><span>RUNS</span></div>`;$('run-detail').textContent='Select a trail or lift to see its details.';$('trail-select').replaceChildren(new Option('Choose a trail or lift',''));$('orbit').disabled=true;$('reset').disabled=true;
 try{const {startExplorer}=await import('./viewer.js');if(version!==generation)return;const cleanup=await startExplorer(m,()=>version===generation,cleanup=>{if(version===generation)dispose=cleanup;else cleanup();});if(version!==generation){cleanup?.();return}dispose=cleanup;}catch(e){if(version!==generation)return;$('status').hidden=true;$('error').hidden=false;$('error-text').textContent=e.message;}
}
$('back').onclick=()=>{generation++;dispose?.();dispose=null;$('explorer').hidden=true;$('valley').hidden=false;document.querySelector(`.mountain-card[data-mountain="${active}"]`)?.focus();};
$('retry').onclick=()=>openMountain(mountains.find(m=>m.id===active));
