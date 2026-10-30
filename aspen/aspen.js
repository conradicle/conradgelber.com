import {mountains, getDifficulty} from './mountains.js?v=7';

const $ = id => document.getElementById(id);
const format = n => n.toLocaleString('en-US');
const statsLine = m => `${format(m.summit)}′ summit · ${format(m.vertical)}′ vertical · ${m.runs} runs`;
let scene = null;
let starting = null;
let active = null;
let entries = [];
let restoringFocus = false;

// Readout under the landing view.
function preview(m) {
  active = m?.id || null;
  $('readout-name').textContent = m ? m.name : 'Four mountains';
  $('readout-stats').textContent = m ? `${statsLine(m)}. ${m.tag}.` : 'Hover a mountain on the terrain, or pick one below.';
  document.querySelectorAll('.mountain-card').forEach(el => el.classList.toggle('active', el.dataset.mountain === active));
}

function status(text) {
  $('status').hidden = !text;
  $('status').textContent = text;
}

function fail(error) {
  console.error('Aspen 3D failed:', error);
  status('');
  $('error').hidden = false;
  $('error-text').textContent = error.message || 'The 3D view could not start. Check your connection and WebGL support, then try again.';
}

function start() {
  if (scene) return Promise.resolve(scene);
  if (starting) return starting;
  $('error').hidden = true;
  status('Loading the Roaring Fork Valley…');
  starting = import('./viewer.js?v=7')
    .then(({createScene}) => createScene('cesium', mountains, {
      onHover: preview,
      onEnter: m => openMountain(m),
      onRun: showRunDetail,
      onStatus: status,
    }))
    .then(s => { scene = s; return s; })
    .catch(e => { starting = null; fail(e); throw e; });
  return starting;
}

function showRunDetail(entity) {
  const p = entity.trail;
  const d = getDifficulty(p['piste:difficulty']);
  $('run-detail').textContent = p.aerialway
    ? `${p.name || 'Unnamed lift'} · Lift (${p.aerialway.replaceAll('_', ' ')})`
    : `${d.symbol} ${p.name || p['piste:name'] || 'Unnamed run'} · ${d.label}`;
  $('trail-select').value = entity.id;
}

async function openMountain(m) {
  preview(m);
  document.body.classList.add('exploring');
  $('explorer-tools').hidden = false;
  $('intro').hidden = true;
  $('readout').hidden = true;
  $('panel').hidden = false;
  $('choose').hidden = true;
  $('mountain-name').textContent = m.name;
  $('mountain-tag').textContent = m.tag;
  $('stats').innerHTML = `<div><strong>${format(m.summit)}′</strong><span>SUMMIT</span></div><div><strong>${format(m.vertical)}′</strong><span>VERTICAL</span></div><div><strong>${m.runs}</strong><span>RUNS</span></div>`;
  $('run-detail').textContent = 'Select a trail or lift to see its details.';
  $('trail-select').replaceChildren(new Option('Choose a trail or lift', ''));
  $('orbit').textContent = 'Pause orbit';
  window.scrollTo({top: 0, behavior: 'instant'});
  $('mountain-name').focus({preventScroll: true});
  try {
    const s = await start();
    entries = (await s.focus(m)) || [];
    if (active !== m.id) return;
    const sorted = [...entries].sort((a, b) => (a.trail.name || '').localeCompare(b.trail.name || ''));
    for (const e of sorted) {
      const p = e.trail;
      const d = getDifficulty(p['piste:difficulty']);
      $('trail-select').add(new Option(`${p.aerialway ? '↟' : d.symbol} ${p.name || p['piste:name'] || 'Unnamed'} · ${p.aerialway ? 'Lift' : d.label}`, e.id));
    }
  } catch (e) {
    if (!scene) return;
    fail(e);
  }
}

function backToValley() {
  document.body.classList.remove('exploring');
  $('explorer-tools').hidden = true;
  $('intro').hidden = false;
  $('readout').hidden = false;
  $('panel').hidden = true;
  $('choose').hidden = false;
  const was = active;
  preview(null);
  scene?.overview();
  // Return keyboard focus to the card without treating it as a hover.
  restoringFocus = true;
  document.querySelector(`.mountain-card[data-mountain="${was}"]`)?.focus({preventScroll: true});
  restoringFocus = false;
}

// Accessible cards under the 3D view; they mirror hover onto the terrain.
for (const m of mountains) {
  const b = document.createElement('button');
  b.className = 'mountain-card';
  b.dataset.mountain = m.id;
  b.innerHTML = `<strong>${m.name}</strong><span class="card-stats">${format(m.summit)}′ summit<br>${format(m.vertical)}′ vertical · ${m.runs} runs</span><span class="enter">Fly in ↗</span>`;
  b.setAttribute('aria-label', `${m.name}, ${statsLine(m)}. Fly in to explore in 3D`);
  const hover = () => { preview(m); scene?.hover(m.id); };
  b.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hover(); });
  b.addEventListener('focus', () => { if (!restoringFocus) hover(); });
  b.addEventListener('pointerleave', () => { if (active === m.id && !document.body.classList.contains('exploring')) { preview(null); scene?.hover(null); } });
  b.addEventListener('click', () => openMountain(m));
  $('mountain-cards').append(b);
}

// Panel registry: v2 can supply mount/unmount functions without changing the viewer.
for (const p of [{id: 'snow', title: 'Snow report'}, {id: 'webcams', title: 'Webcams'}]) {
  const s = document.createElement('section');
  s.className = 'future-panel';
  s.dataset.panel = p.id;
  s.innerHTML = `<h3>${p.title}</h3><p>Coming in v2</p>`;
  $('future-panels').append(s);
}

$('back').onclick = backToValley;
$('orbit').onclick = () => { if (scene) $('orbit').textContent = scene.togglePause() ? 'Resume orbit' : 'Pause orbit'; };
$('reset').onclick = () => scene?.reset();
$('retry').onclick = () => { start().then(() => { if (document.body.classList.contains('exploring')) openMountain(mountains.find(m => m.id === active)); }).catch(() => {}); };
$('trail-select').onchange = () => {
  const e = entries.find(x => x.id === $('trail-select').value);
  if (e) scene?.showRun(e);
};

preview(null);
start().catch(() => {});
