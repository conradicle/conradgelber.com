import { toolStore } from '/hub/lib/store.js';
import { makeModel, visibleEntries, ancestors, parentPath, PAGE_SIZE } from './model.js?v=4';
const $ = s => document.querySelector(s), store = toolStore('operations-desk');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const state = {repos: [], fleetStatus: 'loading', pins: [], tiers: {}, pinnedOnly: false, knowledge: null, selected: null, detail: null, view: 'fleet', folder: '', directory: null, offset: 0, run: null, jobs: null, selectedId: null};
let graphicsAvailable = null, inspectorEpoch = 0, initialFavoritesApplied = false, filterChosen = false, tiersRevision = 0;
let scene = null, locked = false, paused = motionPreference.matches, epoch = 0, fileEpoch = 0, lastInput = Date.now(), pending = new Set(), directories = new Map(), loadingFolder = false, folderError = '', renderedModel = {nodes: [], edges: []}, renderedSignature = null;
const text = (tag, value, cls) => { const e = document.createElement(tag); e.textContent = value ?? ''; if (cls) e.className = cls; return e; };
const button = (label, fn, cls = 'list-button') => { const b = text('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
function link(label, url) { const a = text('a', label); try { const u = new URL(url); if (u.protocol !== 'https:' || u.hostname !== 'github.com') throw Error(); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; } catch { return text('span', label); } return a; }
function notice(message, error = false) { if (locked) return; $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
function clearPrivate() {
  for (const controller of pending) controller.abort(); pending.clear(); epoch++; fileEpoch++;
  Object.assign(state, {repos: [], pins: [], tiers: {}, knowledge: null, selected: null, detail: null, directory: null, run: null, jobs: null, selectedId: null});
  directories.clear(); renderedModel = {nodes: [], edges: []}; renderedSignature = null; scene?.dispose(); scene = null;
  for (const id of ['#project-list', '#detail', '#alternate', '#results', '#scene-labels', '#breadcrumbs']) $(id)?.replaceChildren();
  if ($('#search')) $('#search').value = '';
}
function lockScreen(message) { document.body.className = 'lock-screen'; document.body.replaceChildren(text('p', message)); }
async function lock() {
  if (locked) return; locked = true; clearPrivate(); lockScreen('Locking your workspace…');
  try { const res = await fetch('/logout', {method: 'POST', redirect: 'manual'}); if (!res.ok && res.type !== 'opaqueredirect' && res.status !== 303) throw Error(); location.replace('/login/'); }
  catch { lockScreen('The server could not confirm the lock. Reconnect and retry to end this session.'); document.body.append(button('Retry lock', () => { locked = false; lock(); })); }
}
async function api(params = {}) {
  const controller = new AbortController(); pending.add(controller);
  try {
    const res = await fetch('/hub/api/desk/', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(params), cache: 'no-store', signal: controller.signal});
    if (res.status === 401 || res.redirected) { locked = true; clearPrivate(); lockScreen('Your session has ended. Returning to sign-in…'); location.replace('/login/'); throw Error('Session expired'); }
    const body = await res.json(); if (!res.ok) throw Error(body.error || body.state || 'Request unavailable'); if (locked) throw Error('Locked'); return body;
  } finally { pending.delete(controller); }
}
$('#lock').addEventListener('click', lock);
for (const event of ['pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(event, () => lastInput = Date.now(), {passive: true});
setInterval(() => { if (Date.now() - lastInput > 900000) lock(); }, 10000);
addEventListener('pageshow', e => { if (e.persisted) { clearPrivate(); location.reload(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastInput > 900000) lock(); });
if (matchMedia('(max-width: 600px)').matches) $('#library').open = false;

async function sync(force = false) {
  notice('Refreshing your repository library and project context…'); $('#refresh').disabled = true;
  const extra = force ? {refresh: '1'} : {};
  const syncTiersRevision = tiersRevision;
  try {
    const [fleet, knowledge, pins, tiers] = await Promise.allSettled([api({action: 'fleet', ...extra}), api({action: 'knowledge', ...extra}), store.get('pins'), store.get('tiers')]);
    if (locked) return;
    const warnings = [];
    if (fleet.status === 'fulfilled') { state.fleetStatus = 'connected'; state.repos = fleet.value.repositories; $('#sync').textContent = 'Fetched ' + new Date(fleet.value.syncedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}); if (fleet.value.incomplete) warnings.push('Repository discovery is limited to 2,000 results.'); }
    else { state.fleetStatus = 'error'; warnings.push('Repository connection unavailable. ' + fleet.reason.message + (state.repos.length ? ' Previous results remain visible.' : ' Use Refresh to retry.')); }
    if (knowledge.status === 'fulfilled') state.knowledge = knowledge.value; else warnings.push('Knowledge refresh is unavailable.' + (state.knowledge ? ' Showing earlier knowledge records.' : ' Repository browsing still works.'));
    if (pins.status === 'fulfilled' && Array.isArray(pins.value?.value)) state.pins = pins.value.value.filter(n => typeof n === 'string').slice(0,100);
    else if (pins.status === 'rejected') warnings.push('Favorites could not be loaded.');
    if (tiers.status === 'fulfilled' && tiersRevision === syncTiersRevision) { const value = tiers.value?.value; state.tiers = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, tier]) => [1, 2, 3].includes(tier))) : {}; }
    else if (tiers.status === 'rejected') warnings.push('Repository tiers could not be loaded.');
    if (pins.status === 'fulfilled' && !initialFavoritesApplied) { if (!filterChosen) state.pinnedOnly = state.pins.length > 0; initialFavoritesApplied = true; }
    $('#repo-count').textContent = state.repos.length; $('#library-count').textContent = state.repos.length; $('#knowledge-count').textContent = state.knowledge?.projects.length ?? '—';
    notice(warnings.join(' '), !!warnings.length);
    renderLibrary(); render(true);
  } finally { if (!locked) $('#refresh').disabled = false; }
}
$('#refresh').addEventListener('click', () => sync(true));
async function pin(name) {
  const shouldPin = !state.pins.includes(name);
  try { const saved = await store.update('pins', value => { const pins = new Set(Array.isArray(value) ? value : []); shouldPin ? pins.add(name) : pins.delete(name); return [...pins].slice(0, 100); }, []); if (locked) return; state.pins = saved.value; renderLibrary(); if (state.view === 'fleet') render(false); }
  catch { notice('Your favorites could not be saved. Try again.', true); }
}
async function setTier(name, tier) {
  if (![1, 2, 3].includes(tier)) return;
  try {
    const saved = await store.update('tiers', value => {
      const next = value && typeof value === 'object' && !Array.isArray(value) ? {...value} : {};
      if (tier === 1) delete next[name]; else next[name] = tier;
      return next;
    }, {});
    if (locked) return;
    tiersRevision++; state.tiers = saved.value;
    renderLibrary(); if (state.view === 'fleet') render(false);
  } catch { notice('The repository tier could not be saved. Try again.', true); renderLibrary(); }
}
function setFilter(pinned) { filterChosen = true; state.pinnedOnly = pinned; renderLibrary(); if (state.view === 'fleet') render(true); }
$('#filter-all').onclick = () => setFilter(false); $('#filter-pins').onclick = () => setFilter(true);
$('#knowledge-labels').onclick = () => { const shown = $('#knowledge-labels').getAttribute('aria-pressed') !== 'true'; $('#knowledge-labels').setAttribute('aria-pressed', String(shown)); $('#knowledge-labels').textContent = shown ? 'Hide labels' : 'Show labels'; $('#scene-wrap').classList.toggle('show-knowledge-labels', shown); };
$('#manage-favorites').onclick = () => { $('#library').open = true; setFilter(false); $('#search').focus(); if (matchMedia('(max-width: 600px)').matches) $('#library').scrollIntoView({behavior: motionPreference.matches ? 'instant' : 'smooth', block: 'start'}); };
function renderLibrary() {
  const out = $('#project-list'), query = $('#search').value.trim().toLowerCase(), focusKey = out.contains(document.activeElement) ? document.activeElement.dataset.focus : null; out.replaceChildren();
  $('#pin-count').textContent = state.pins.length;
  for (const [id, active] of [['#filter-all', !state.pinnedOnly], ['#filter-pins', state.pinnedOnly]]) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active)); }
  const repos = state.repos.filter(r => (!state.pinnedOnly || state.pins.includes(r.name)) && (r.name + ' ' + (r.description || '')).toLowerCase().includes(query));
  for (const repo of repos) {
    const row = text('div', '', 'repo-row'), open = button(repo.name.split('/')[1], () => selectRepo(repo.name), 'repo-open' + (state.selected === repo.name ? ' selected' : ''));
    open.dataset.focus = 'open:' + repo.name; open.setAttribute('aria-label', 'Open repository ' + repo.name); open.append(text('small', (repo.language || 'Repository') + ' · ' + repo.visibility));
    const pinned = state.pins.includes(repo.name), toggle = button(pinned ? '★' : '☆', () => pin(repo.name), 'pin'); toggle.dataset.focus = 'pin:' + repo.name; toggle.setAttribute('aria-label', (pinned ? 'Remove from favorites: ' : 'Add to favorites: ') + repo.name); toggle.setAttribute('aria-pressed', String(pinned));
    const choice = document.createElement('select'); choice.className = 'tier-select'; choice.dataset.focus = 'tier:' + repo.name; choice.setAttribute('aria-label', 'Fleet tier for ' + repo.name);
    for (const [value, label] of [[1, 'Tier 1 · Teal'], [2, 'Tier 2 · Blue'], [3, 'Tier 3 · Gold']]) { const option = document.createElement('option'); option.value = String(value); option.textContent = label; choice.append(option); }
    choice.value = String([1, 2, 3].includes(state.tiers[repo.name]) ? state.tiers[repo.name] : 1);
    choice.addEventListener('change', () => { choice.disabled = true; setTier(repo.name, Number(choice.value)); });
    const info = text('div', '', 'repo-info'); info.append(open, choice); row.append(info, toggle); out.append(row);
  }
  if (!repos.length) out.append(text('p', state.pinnedOnly ? 'No favorites match. Choose All repos and star a repository to add it.' : query ? 'No repositories match this search.' : 'No repositories loaded. Try Refresh.', 'muted'));
  if (focusKey) ([...out.querySelectorAll('[data-focus]')].find(b => b.dataset.focus === focusKey) || $('#filter-pins')).focus({preventScroll:true});
}
$('#search').addEventListener('input', () => {
  renderLibrary(); const query = $('#search').value.trim().toLowerCase(), results = $('#results'); results.replaceChildren();
  if (!query) return;
  for (const record of [...(state.knowledge?.projects || []), ...(state.knowledge?.documents || [])].filter(p => (p.title + ' ' + Object.values(p.sections).join(' ')).toLowerCase().includes(query)).slice(0, 6)) results.append(button('Knowledge · ' + record.title, () => { setView('knowledge'); showKnowledge(record); scene?.focus('knowledge:' + record.path); }));
});
function inspectorIntro(label, title) { inspectorEpoch++; const d = $('#detail'), restoreFocus = d.contains(document.activeElement); d.replaceChildren(text('p', label, 'eyebrow'), text('h2', title)); d.scrollTop = 0; if(restoreFocus){d.querySelector('h2').tabIndex=-1;d.querySelector('h2').focus({preventScroll:true});} return d; }
function focusStage() { $('#view-title').focus({preventScroll:true}); }
function revealInspector() { const heading=$('#detail h2'); if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} if(matchMedia('(max-width:850px)').matches) $('.inspector').scrollIntoView({behavior:motionPreference.matches?'instant':'smooth',block:'start'}); }
function actions(...entries) { const row = text('div', '', 'action-row'); for (const [label, fn, primary] of entries) row.append(button(label, fn, primary ? 'primary' : '')); return row; }
async function selectRepo(name, targetView = state.view === 'workflow' ? 'workflow' : 'structure', force = false) {
  if (locked) return; const current = ++epoch; fileEpoch++; const oldDetail = state.selected === name ? state.detail : null;
  Object.assign(state, {selected: name, detail: null, folder: '', directory: null, offset: 0, run: null, jobs: null, selectedId: 'repo:' + name, view: targetView}); directories.clear(); loadingFolder = true; folderError = '';
  const d = inspectorIntro('GITHUB / REPOSITORY', name.split('/')[1]), inspectorTicket = inspectorEpoch; d.append(text('p', 'Loading source information…', 'muted'));
  renderLibrary(); render(true); focusStage(); if(matchMedia('(max-width:600px)').matches) $('.stage').scrollIntoView({behavior:motionPreference.matches?'instant':'smooth',block:'start'});
  const loadContents = openDirectory('', current);
  try {
    const detail = await api({action: 'detail', repo: name, ...(force ? {refresh: '1'} : {})}); if (locked || current !== epoch) return;
    if (oldDetail) for (const [key, value] of Object.entries(detail.sections)) if (!value.available && oldDetail.sections[key]?.available) detail.sections[key] = {...oldDetail.sections[key], stale: true};
    state.detail = detail; if (inspectorTicket === inspectorEpoch) showRepo(); render(false);
  } catch (error) { if (!locked && current === epoch) { state.detail = oldDetail; if (oldDetail) showRepo(); $('#detail').append(text('p', 'Repository details unavailable: ' + error.message, 'muted'), button('Retry repository', () => selectRepo(name, targetView, true))); } }
  await loadContents;
}
function section(container, title, data, fn, empty = 'None reported.') {
  container.append(text('h3', title)); if (!data?.available) { container.append(text('p', data?.reason || 'Unavailable', 'muted')); return; }
  if (data.stale) container.append(text('p', 'Showing older results after a failed refresh.', 'tag'));
  const values = Array.isArray(data.value) ? data.value : []; if (!values.length) container.append(text('p', empty, 'muted'));
  values.slice(0, title.includes('first 15') ? 15 : 30).forEach(x => container.append(fn(x)));
}
function showRepo() {
  if (locked || !state.selected) return;
  const repo = state.detail?.repo || state.repos.find(r => r.name === state.selected); if (!repo) return;
  const d = inspectorIntro('GITHUB / REPOSITORY', repo.name.split('/')[1]);
  d.append(text('p', repo.description || 'No description provided.', 'muted'), text('p', `${repo.visibility} · ${repo.language || 'Language unknown'} · ${repo.archived ? 'Archived' : 'Not archived'}`, 'tag'));
  d.append(actions(['Explore files', () => setView('structure'), true], ['Workflow runs', () => setView('workflow')], [state.pins.includes(repo.name) ? 'Remove from favorites' : 'Add to favorites', async () => { await pin(repo.name); if (!locked) showRepo(); }]));
  d.append(link('Open repository on GitHub ↗', repo.url), text('p', 'Default branch: ' + (repo.branch || 'Unknown') + ' · Last push: ' + (repo.pushedAt ? new Date(repo.pushedAt).toLocaleDateString() : 'Unknown'), 'muted'));
  if (!state.detail) return;
  d.append(text('p', 'Details fetched ' + new Date(state.detail.fetchedAt).toLocaleString(), 'muted'));
  const sections = state.detail.sections;
  if (sections.languages?.available) { d.append(text('h3', 'Languages / source bytes')); d.append(text('p', Object.entries(sections.languages.value).map(([language, bytes]) => language + ' ' + Number(bytes).toLocaleString()).join(' · ') || 'Not reported.', 'muted')); }
  d.append(text('h3', 'Knowledge / explicit repository links'));
  const related = state.knowledge?.projects.filter(p => (p.repos || []).some(r => r.toLowerCase() === repo.name.toLowerCase())) || [];
  if (!related.length) d.append(text('p', 'No explicit link in the indexed records.', 'muted'));
  for (const p of related) d.append(button(p.title, () => { setView('knowledge'); showKnowledge(p); }));
  section(d, 'Recent commits / first 15', sections.commits, commit => button((commit.commit?.message || 'Commit').split('\n')[0] + ' →', () => showCommit(commit)));
  section(d, 'Open pull requests / first 30', sections.pulls, pr => link('#' + pr.number + ' ' + pr.title + ' ↗', `https://github.com/${repo.name}/pull/${pr.number}`));
  section(d, 'Open issues / first 30', sections.issues, issue => link('#' + issue.number + ' ' + issue.title + ' ↗', `https://github.com/${repo.name}/issues/${issue.number}`));
  section(d, 'Milestones / first 30', sections.milestones, milestone => link(milestone.title + ' ↗', `https://github.com/${repo.name}/milestone/${milestone.number}`));
}
async function openDirectory(path, expectedEpoch = epoch) {
  if (!state.selected || locked) return; const name = state.selected; const requestId = ++fileEpoch;
  loadingFolder = true; folderError = ''; render(false);
  try {
    const data = directories.get(path) || await api({action: 'contents', repo: name, path}); if (locked || state.selected !== name || expectedEpoch !== epoch || requestId !== fileEpoch) return;
    if (data.type !== 'directory') throw Error('This item is not a folder.');
    directories.set(path, data); state.folder = path; state.directory = data; state.offset = 0; state.selectedId = path ? 'path:' + path : 'repo:' + name;
    if (data.incomplete) notice('GitHub limits this folder to 1,000 entries. The list and scene show a page at a time.');
    loadingFolder = false; render(true); focusStage();
  } catch (error) { if (!locked && expectedEpoch === epoch && requestId === fileEpoch) { loadingFolder = false; folderError = error.message; render(false); } }
}
async function previewFile(path) {
  if (!state.selected || locked) return; const name = state.selected, current = epoch, requestId = ++fileEpoch;
  state.selectedId = 'path:' + path; scene?.select(state.selectedId); scene?.focus(state.selectedId);
  const d = inspectorIntro('GITHUB / FILE PREVIEW', path.split('/').pop()), inspectorTicket = inspectorEpoch; d.append(text('p', path, 'file-summary'), text('p', 'Loading read-only preview…', 'muted'));
  try {
    const data = await api({action: 'contents', repo: name, path}); if (locked || current !== epoch || requestId !== fileEpoch || inspectorTicket !== inspectorEpoch) return;
    d.replaceChildren(text('p', 'GITHUB / FILE PREVIEW', 'eyebrow'), text('h2', path.split('/').pop()), text('p', path, 'file-summary'));
    d.append(actions(['← Back to repository', showRepo], ['Containing folder', () => { setView('structure'); openDirectory(parentPath(path)); }]));
    if (data.type === 'file') d.append(link('Open file on GitHub ↗', data.url), text('pre', data.content));
    else d.append(text('p', data.reason || 'Preview unavailable for this item.', 'muted'));
    revealInspector();
  } catch (error) { if (!locked && current === epoch && requestId === fileEpoch) d.append(text('p', 'File unavailable: ' + error.message, 'muted'), button('Retry preview', () => previewFile(path))); }
}
function showKnowledge(record) {
  if (locked || !state.knowledge) return;
  state.selectedId = 'knowledge:' + record.path; scene?.select(state.selectedId);
  const d = inspectorIntro('KNOWLEDGE / DOCUMENTED CLAIM', record.title);
  d.append(text('p', [record.status && 'Recorded status: ' + record.status, record.confidence && 'Confidence: ' + record.confidence, record.date].filter(Boolean).join(' · ') || 'Status not documented.', 'tag'), text('p', 'These are knowledge-base statements, not measured repository progress.', 'muted'), link('Open original record ↗', state.knowledge.sourceRoot + record.path.split('/').map(encodeURIComponent).join('/')));
  for (const [title, value] of Object.entries(record.sections || {})) if (value) d.append(text('h3', title), text('pre', value));
  revealInspector();
}
async function showCommit(commit) {
  const name = state.selected, current = epoch, d = inspectorIntro('GITHUB / COMMIT', (commit.commit?.message || 'Commit').split('\n')[0]), inspectorTicket = inspectorEpoch;
  d.append(link('Open commit ↗', `https://github.com/${name}/commit/${commit.sha}`), button('← Back to repository', showRepo), text('p', 'Loading changed files…', 'muted'));
  try { const result = await api({action: 'commit', repo: name, id: commit.sha}); if (locked || current !== epoch || inspectorTicket !== inspectorEpoch || !d.isConnected) return; d.lastChild.remove(); result.files.forEach(file => d.append(link(file.path + ' · ' + file.status, `https://github.com/${name}/commit/${commit.sha}`))); if (result.incomplete) d.append(text('p', 'The changed-file list may be incomplete.', 'tag')); }
  catch (error) { if (!locked && current === epoch) d.append(text('p', 'Changed files unavailable: ' + error.message, 'muted')); }
}
async function selectRun(run) {
  if (!state.selected || locked) return; const name = state.selected, current = epoch, requestId = ++fileEpoch;
  state.run = run; state.jobs = null; state.selectedId = 'run:' + run.id; render(false);
  const d = inspectorIntro('GITHUB ACTIONS / RETRIEVED EXECUTION', run.name || 'Workflow run'), inspectorTicket = inspectorEpoch;
  d.append(text('p', (run.conclusion || run.status) + ' · run #' + (run.run_number || run.id), 'tag'), link('Open run on GitHub ↗', `https://github.com/${name}/actions/runs/${run.id}`), button('← All workflow runs', () => { state.run = null; state.jobs = null; render(true); showRepo(); }), text('p', 'Loading jobs and steps…', 'muted'));
  try {
    const data = await api({action: 'jobs', repo: name, id: String(run.id)}); if (locked || current !== epoch || requestId !== fileEpoch || inspectorTicket !== inspectorEpoch) return;
    state.jobs = data; d.lastChild.remove(); d.append(text('p', 'Retrieved status; refresh the repository for newer runs. The scene shows up to 6 jobs and 5 steps each. The full retrieved list is below.', 'muted'));
    if (!data.jobs.length) d.append(text('p', 'No jobs available for this run.', 'muted'));
    for (const job of data.jobs) { d.append(text('h3', job.name), text('p', job.conclusion || job.status, 'tag')); for (const step of job.steps) d.append(text('p', `${step.number}. ${step.name} · ${step.conclusion || step.status}`, 'step-row')); }
    if (data.incomplete) d.append(text('p', 'Showing the first 100 jobs.', 'tag')); render(true); revealInspector();
  } catch (error) { if (!locked && current === epoch && requestId === fileEpoch) d.append(text('p', 'Jobs unavailable: ' + error.message, 'muted'), button('Retry jobs', () => selectRun(run))); }
}
async function moreRuns() {
  if (!state.detail?.sections.runs?.available || locked) return;
  const name = state.selected, current = epoch, section = state.detail.sections.runs, page = (section.loadedPage || 1) + 1;
  try { const result = await api({action: 'runs', repo: name, id: String(page)}); if (locked || current !== epoch) return; const ids = new Set(section.value.workflow_runs.map(r => r.id)); section.value.workflow_runs.push(...result.runs.filter(r => !ids.has(r.id))); section.value.total_count = result.runs.length ? result.total : section.value.workflow_runs.length; section.loadedPage = page; render(false); }
  catch (error) { notice('More runs could not be loaded. ' + error.message, true); }
}
function setView(view) {
  if (locked) return; state.view = view; state.run = null; state.jobs = null;
  render(true);
  if (view === 'structure' && state.selected && !state.directory) openDirectory('');
}
for (const control of document.querySelectorAll('[data-view]')) control.onclick = () => setView(control.dataset.view);
function back() {
  if (state.view === 'structure' && state.folder) { openDirectory(parentPath(state.folder)); return; }
  if (state.view === 'workflow' && state.run) { state.run = null; state.jobs = null; showRepo(); render(true); return; }
  setView('fleet'); if (state.selected) showRepo();
}
$('#back').onclick = back; $('#reset').onclick = () => scene?.reset(); $('#zoom-in').onclick = () => scene?.zoom(.8); $('#zoom-out').onclick = () => scene?.zoom(1.25);
function toggleOutline(open = $('#outline').hidden) { $('#outline').hidden = !open; $('#toggle-outline').setAttribute('aria-expanded', String(open)); }
$('#toggle-outline').onclick = () => toggleOutline();
function activate(node) {
  if (locked) return;
  state.selectedId = node.id; scene?.select(node.id);
  if (node.action === 'repo') selectRepo(node.value);
  if (node.action === 'folder') openDirectory(node.value);
  if (node.action === 'file') previewFile(node.value);
  if (node.action === 'knowledge') { const record = [...(state.knowledge?.projects || []), ...(state.knowledge?.documents || [])].find(r => r.path === node.value); if (record) { showKnowledge(record); scene?.focus(node.id); } }
  if (node.action === 'run') selectRun(node.value);
  if (node.action === 'definition') { const d = inspectorIntro('GITHUB ACTIONS / DEFINITION', node.value.name); d.append(text('p', 'A workflow definition is configuration, not an execution.', 'muted'), link('Open workflow definition ↗', `https://github.com/${state.selected}/blob/${encodeURIComponent(state.detail.repo.branch)}/${node.value.path}`)); scene?.focus(node.id); }
  if (node.action === 'job' || node.action === 'step') { const d = inspectorIntro('GITHUB ACTIONS / RETRIEVED ' + node.action.toUpperCase(), node.value.name); d.append(text('p', node.value.conclusion || node.value.status, 'tag'), button('← Back to selected run', () => selectRun(state.run))); scene?.focus(node.id); }
}
function renderBreadcrumbs() {
  const out = $('#breadcrumbs'); out.replaceChildren(button('Fleet', () => setView('fleet'), ''));
  const crumb = (label, fn, current = false) => { out.append(text('span', '/')); const b = button(label, fn, ''); if (current) b.setAttribute('aria-current', 'location'); out.append(b); };
  if (state.view === 'knowledge') { crumb('Knowledge', () => setView('knowledge'), true); return; }
  if (!state.selected || state.view === 'fleet') return;
  crumb(state.selected.split('/')[1], () => { setView('structure'); openDirectory(''); }, state.view === 'structure' && !state.folder);
  if (state.view === 'structure') for (const path of ancestors(state.folder).slice(1)) crumb(path.split('/').pop(), () => openDirectory(path), path === state.folder);
  if (state.view === 'workflow') crumb(state.run ? 'Run #' + (state.run.run_number || state.run.id) : 'Workflow runs', () => { state.run = null; state.jobs = null; render(true); }, true);
}
function showMessage(title, message, action) {
  const out = $('#scene-message'); out.hidden = !title; out.replaceChildren(); if (!title) return;
  out.append(text('span', '◈'), text('h3', title), text('p', message)); if (action) out.append(button(action[0], action[1], ''));
}
function renderOutline() {
  const out = $('#alternate'); out.replaceChildren(); const pagination = $('#pagination'); pagination.replaceChildren(); pagination.hidden = true;
  $('#outline-title').textContent = {fleet: 'Repository destinations', structure: 'Current folder', workflow: 'Workflow runs & definitions', knowledge: 'Knowledge records'}[state.view];
  $('#outline-count').textContent = renderedModel.nodes.length + ' visible destinations';
  if (state.view === 'structure' && state.directory) {
    const entries = visibleEntries(state.directory.entries, state.offset);
    for (const entry of entries) out.append(button((entry.type === 'dir' ? '▸ ' : '◇ ') + entry.name, () => entry.type === 'dir' ? openDirectory(entry.path) : previewFile(entry.path)));
    if (!entries.length) out.append(text('p', 'This folder has no visible entries.', 'muted'));
    if (state.directory.entries.length > PAGE_SIZE) { pagination.hidden = false; const previous = button('← Previous', () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); render(true); }, ''), next = button('Next →', () => { state.offset += PAGE_SIZE; render(true); }, ''); previous.disabled = state.offset === 0; next.disabled = state.offset + PAGE_SIZE >= state.directory.entries.length; pagination.append(previous, text('span', `${state.offset + 1}–${Math.min(state.offset + PAGE_SIZE, state.directory.entries.length)} of ${state.directory.entries.length}`), next); }
  } else if (state.view === 'workflow' && state.detail) {
    if (state.run && state.jobs) for (const node of renderedModel.nodes) out.append(button(node.label + ' · ' + node.subtitle, () => activate(node)));
    else {
      const {workflows, runs} = state.detail.sections;
      if (!workflows?.available) out.append(text('p', 'Workflow definitions: ' + (workflows?.reason || 'Unavailable'), 'muted'));
      for (const w of workflows?.value?.workflows || []) out.append(button('Definition · ' + w.name, () => activate({id: 'workflow:' + w.id, action: 'definition', value: w})));
      if (!runs?.available) out.append(text('p', 'Runs: ' + (runs?.reason || 'Unavailable'), 'muted'));
      for (const run of runs?.value?.workflow_runs || []) out.append(button((run.name || 'Run') + ' · ' + (run.conclusion || run.status), () => selectRun(run)));
      if (runs?.available && (runs.loadedPage || 1) < 20 && runs.value.workflow_runs.length < (runs.value.total_count || 0)) out.append(button('Load more runs', moreRuns));
    }
  } else for (const node of renderedModel.nodes) out.append(button(node.label + ' · ' + node.subtitle, () => activate(node)));
  if (state.view === 'knowledge' && state.knowledge) {
    out.append(text('h3', 'Knowledge repository activity'));
    for (const item of state.knowledge.activity || []) { const a = link(item.title + ' ↗', item.url); a.className = 'list-button wide'; out.append(a); }
  }
}
function render(reset = false) {
  if (locked) return;
  for (const b of document.querySelectorAll('[data-view]')) { const active = b.dataset.view === state.view; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }
  $('#scene-wrap').dataset.view = state.view;
  $('#manage-favorites').hidden = state.view !== 'fleet';
  $('#knowledge-labels').hidden = state.view !== 'knowledge';
  $('#view-title').textContent = {fleet: 'Repository fleet', structure: state.folder ? state.folder.split('/').pop() : 'Repository structure', workflow: state.run ? 'Inside the run' : 'Workflows & runs', knowledge: 'Knowledge constellation'}[state.view];
  $('#scene-caption').textContent = {fleet: state.pinnedOnly ? 'Favorites only. Use Manage favorites to add more.' : 'All repositories. Star the ones you want in Favorites.', structure: 'Lines show folder containment. Open a folder to move deeper; preview a file in the inspector.', workflow: 'Lines show membership. Moving dots are decorative, not live execution. Open Explorer list for all retrieved runs.', knowledge: 'Select a bright point or use Explorer list. Lines are explicit references; background particles are decorative.'}[state.view];
  renderedModel = makeModel(state);
  const knowledgeSummary = $('#knowledge-summary'); knowledgeSummary.hidden = state.view !== 'knowledge' || !state.knowledge;
  knowledgeSummary.replaceChildren();
  if (!knowledgeSummary.hidden) {
    const total = (state.knowledge.projects || []).length + (state.knowledge.documents || []).length;
    for (const [value, label] of [[total, 'Records indexed'], [renderedModel.nodes.length, 'Points shown'], [renderedModel.edges.length, 'Links shown']]) { const cell = text('div', '', 'knowledge-stat'); cell.append(text('strong', String(value)), text('span', label)); knowledgeSummary.append(cell); }
  }
  const signature = state.view + ':' + JSON.stringify(renderedModel);
  if (scene && signature !== renderedSignature) { scene.setModel(renderedModel, {selected: state.selectedId, reset, animateConnections: state.view === 'workflow' || state.view === 'knowledge', knowledgeMode: state.view === 'knowledge'}); renderedSignature = signature; }
  else if (scene) { scene.select(state.selectedId); if (reset) scene.reset(); }
  renderBreadcrumbs(); renderOutline();
  if (!state.repos.length && state.view !== 'knowledge' && state.fleetStatus === 'connected') showMessage('No repositories available.', 'The configured connection returned no accessible repositories. Check its repository selection or refresh.', ['Refresh connection', () => sync(true)]);
  else if (!state.repos.length && state.view !== 'knowledge') showMessage('Your fleet is not connected', 'Use Refresh to retry the repository connection.', ['Refresh connection', () => sync(true)]);
  else if (state.view === 'fleet' && !renderedModel.nodes.length) showMessage('Choose your favorites.', 'Select All repos, then use the star beside each repository to add it.', ['Show all repositories', () => setFilter(false)]);
  else if (['structure', 'workflow'].includes(state.view) && !state.selected) showMessage('Choose a repository first.', 'Open the library and select a destination to start exploring.', ['Open repository library', () => { $('#library').open = true; $('#search').focus(); }]);
  else if (state.view === 'structure' && loadingFolder) showMessage('Opening folder…', 'Retrieving its immediate contents.');
  else if (state.view === 'structure' && folderError) showMessage('This folder could not be opened.', folderError, ['Retry folder', () => openDirectory(state.folder)]);
  else if (state.view === 'structure' && !state.directory?.entries.length) showMessage('This folder is empty.', 'Use the breadcrumbs or Back to return to its parent.');
  else if (state.view === 'workflow' && !state.detail) showMessage('Loading workflow information…', 'Retrieving definitions and actual executions.');
  else if (state.view === 'workflow' && !renderedModel.nodes.length) showMessage('No workflows to display.', 'This repository has no available workflow definitions or runs. Check the explorer list for permission details.');
  else if (state.view === 'knowledge' && !state.knowledge) showMessage('Knowledge is unavailable.', 'Repository browsing still works. Refresh to retry the knowledge index.');
  else if (state.view === 'knowledge' && !renderedModel.nodes.length) showMessage('No indexed project records.', 'The configured knowledge source has no allowed records to show.');
  else if (graphicsAvailable === false) showMessage('Explore with the list.', '3D graphics are unavailable. Every destination is accessible in the explorer list below.');
  else showMessage('', '');
}
function updateMotion() { const reduced = motionPreference.matches; $('#motion').textContent = reduced ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion'; $('#motion').disabled = reduced; $('#motion').setAttribute('aria-pressed', String(paused || reduced)); scene?.setMotion(paused || reduced, reduced); }
$('#motion').onclick = () => { paused = !paused; updateMotion(); };
motionPreference.addEventListener('change', e => { paused = e.matches; updateMotion(); });
function graphicsMode(available) {
  if (locked) return;
  graphicsAvailable = available;
  for(const id of ['#zoom-in','#zoom-out','#reset']) $(id).disabled = !available;
  document.body.classList.toggle('fallback', !available); $('#render-mode').textContent = available ? '3D / WEBGL' : 'EXPLORER / LIST';
  if (!available) { toggleOutline(true); render(false); $('#scene-help').textContent = '3D graphics unavailable. Use the explorer list and breadcrumbs.'; }
  else $('#scene-help').textContent = matchMedia('(max-width: 600px)').matches ? 'One finger orbits · Pinch zooms · Two fingers pan' : 'Drag to orbit · Scroll to zoom · Right-drag to pan';
}
async function initScene() {
  try { const {createScene} = await import('./scene.js?v=10'); if (locked) return; scene = createScene({canvas: $('#graph'), labels: $('#scene-labels'), onActivate: activate, onMode: graphicsMode}); updateMotion(); if (scene) { scene.setModel(renderedModel, {selected: state.selectedId, reset: true, animateConnections: state.view === 'workflow' || state.view === 'knowledge', knowledgeMode: state.view === 'knowledge'}); renderedSignature = state.view + ':' + JSON.stringify(renderedModel); } }
  catch { graphicsMode(false); }
}
updateMotion(); initScene(); sync();

function sizeLibrary() {
  const list = $('#project-list');
  if (matchMedia('(min-width: 851px)').matches && $('#library').open) list.style.maxHeight = Math.max(110, $('.rail').getBoundingClientRect().bottom - list.getBoundingClientRect().top - 90) + 'px';
  else list.style.removeProperty('max-height');
}
new ResizeObserver(sizeLibrary).observe($('.rail'));
$('#library').addEventListener('toggle', sizeLibrary);
