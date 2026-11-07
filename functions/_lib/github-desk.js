// Fixed, read-only GitHub endpoints. Never accept an upstream URL from a client.
const ROOT = 'https://api.github.com';
const cache = new Map();
const TTL = 60000;
let active = 0;
const waiting = [];
async function limit(fn) {
  if (active >= 4) await new Promise(resolve => waiting.push(resolve));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
export class GitHubError extends Error {
  constructor(status, retry) { super(status === 429 || status === 403 && retry ? 'GitHub rate limit reached' : 'GitHub request unavailable'); this.status = status; this.retry = retry; }
}
export async function githubGet(token, path, refresh = false) {
  if (!/^\/(?:user\/repos|repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/)/.test(path)) throw new Error('Invalid API path');
  const key = token + '\n' + path, old = cache.get(key);
  if (old && !refresh && Date.now() - old.at < TTL) return old.data;
  return limit(async () => {
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'personal-operations-desk', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (old?.etag) headers['If-None-Match'] = old.etag;
    const res = await fetch(ROOT + path, { headers, redirect: 'manual' });
    if (res.status === 304 && old) { old.at = Date.now(); return old.data; }
    if (!res.ok) throw new GitHubError(res.status, res.headers.get('retry-after') || (res.headers.get('x-ratelimit-remaining') === '0' ? res.headers.get('x-ratelimit-reset') : null));
    const data = await res.json();
    cache.set(key, { at: Date.now(), etag: res.headers.get('etag'), data });
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return data;
  });
}
function safeName(name) { return typeof name === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(name) && !name.split('/').some(x => x === '.' || x === '..'); }
export function safePath(path) {
  if (typeof path !== 'string' || path.length > 1000 || /[\x00-\x1f\\]/.test(path)) return false;
  if (!path) return true;
  return path.split('/').every(s => s && s !== '.' && s !== '..' && !/^\.(?:env|ssh|aws|gnupg|npmrc|pypirc|netrc)(?:$|\.)/i.test(s) && !/(?:^|[._-])(?:credentials?|secrets?|private[-_]?keys?)(?:[._-]|$)/i.test(s) && !/\.(?:pem|key|p12|pfx)$/i.test(s));
}
const textFile = /(?:\.(?:md|txt|json|ya?ml|toml|csv|js|mjs|cjs|ts|tsx|jsx|css|html|py|sql|sh|xml|svg|java|c|h|cpp|rs|go|ini|cfg|gitignore)|(?:^|\/)(?:README|LICENSE|Makefile|Dockerfile))$/i;
const encPath = s => s.split('/').map(encodeURIComponent).join('/');
export async function fleet(token, refresh = false) {
  const all = []; let incomplete = false, checkedAt = Date.now();
  for (let page=1; page<=20; page++) {
    const part = await githubGet(token, `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`, refresh);
    checkedAt = Math.min(checkedAt, cache.get(token + '\n' + `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`)?.at || checkedAt);
    if (!Array.isArray(part)) throw new Error('Invalid repository list');
    all.push(...part.filter(r => safeName(r.full_name)).map(r => ({name:r.full_name, description:r.description, language:r.language, visibility:r.private?'private':'public', archived:!!r.archived, branch:r.default_branch, pushedAt:r.pushed_at, url:`https://github.com/${r.full_name}`})));
    if (part.length < 100) break;
    if (page === 20) incomplete = true;
  }
  return { repositories:all, incomplete, syncedAt:new Date(checkedAt).toISOString() };
}
async function authorized(token, name) {
  if (!safeName(name)) throw new GitHubError(404);
  const found = (await fleet(token)).repositories.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new GitHubError(404);
  return found;
}
export async function repoRequest(token, name, action, path = '', refresh = false, id = '') {
  const repo = await authorized(token, name);
  const base = `/repos/${repo.name}`;
  const get = p => githubGet(token, base + p, refresh);
  if (action === 'contents') {
    if (!safePath(path)) throw new GitHubError(404);
    if (path) {
      const parent=path.split('/').slice(0,-1).join('/');
      const listing=await get('/contents/'+encPath(parent));
      const entry=Array.isArray(listing)?listing.find(x=>x.path===path):null;
      if (!entry || !['file','dir'].includes(entry.type)) return {type:'unavailable',path,reason:'Entry is unavailable, a link, or outside the accessible listing.'};
      if (entry.type==='file' && (!textFile.test(path) || entry.size > 100000)) return {type:'unavailable',path,reason:'Preview unavailable: unsupported or larger than 100 KB.'};
    }
    const value = await get('/contents/' + encPath(path));
    if (Array.isArray(value)) return {type:'directory',path,entries:value.slice(0,1000).filter(x=>safePath(x.path) && ['file','dir'].includes(x.type)).map(x=>({name:x.name,path:x.path,type:x.type,size:x.size})),incomplete:value.length>=1000};
    if (!value || value.type !== 'file' || !textFile.test(path) || value.size > 100000 || value.encoding !== 'base64') return {type:'unavailable',path,reason:'Preview unavailable: unsupported, binary, or larger than 100 KB.'};
    const bytes=Uint8Array.from(atob(value.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
    if (bytes.includes(0)) return {type:'unavailable',path,reason:'Binary files cannot be previewed.'};
    let content; try {content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {return {type:'unavailable',path,reason:'Not UTF-8 text.'};}
    return {type:'file',path,content,url:`https://github.com/${repo.name}/blob/${encodeURIComponent(repo.branch)}/${encPath(path)}`};
  }
  if (action === 'runs') {
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(id)) throw new GitHubError(404);
    const value=await get('/actions/runs?per_page=30&page='+id);
    return {runs:value.workflow_runs||[],total:value.total_count||0,page:Number(id)};
  }
  if (action === 'commit') {
    if (!/^[a-f0-9]{40}$/i.test(id)) throw new GitHubError(404);
    const value=await get('/commits/'+id+'?per_page=100');
    const files=(value.files||[]).filter(f=>safePath(f.filename)).map(f=>({path:f.filename,status:f.status}));
    return {files,incomplete:(value.files||[]).length>=100};
  }
  if (action === 'jobs') {
    if (!/^\d{1,20}$/.test(id)) throw new GitHubError(404);
    const v=await get(`/actions/runs/${id}/jobs?per_page=100`);
    return {jobs:(v.jobs||[]).map(j=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,steps:(j.steps||[]).map(s=>({name:s.name,status:s.status,conclusion:s.conclusion,number:s.number})),url:j.html_url})),incomplete:(v.total_count||0)>100};
  }
  if (action === 'detail') {
    const specs={languages:'/languages', commits:'/commits?per_page=15', issues:'/issues?state=open&per_page=30', pulls:'/pulls?state=open&per_page=30', milestones:'/milestones?state=open&per_page=30', workflows:'/actions/workflows?per_page=30', runs:'/actions/runs?per_page=30'};
    const result={repo, fetchedAt:null, sections:{}}; let checkedAt=Date.now();
    // Serial requests keep bursts and secondary rate limits down; failures remain isolated.
    for (const [key,p] of Object.entries(specs)) {
      try { const value=await get(p); checkedAt=Math.min(checkedAt,cache.get(token+'\n'+base+p)?.at||checkedAt); result.sections[key]={available:true,value:key==='issues'?value.filter(x=>!x.pull_request):value}; }
      catch (e) {result.sections[key]={available:false,reason:e.status===404?'Unavailable or no permission':e.retry?'Rate limited; retry later':'Could not load'};}
    }
    result.fetchedAt=new Date(checkedAt).toISOString();
    return result;
  }
  throw new GitHubError(404);
}
