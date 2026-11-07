import { json, sameOrigin } from '../../../_lib/auth.js';
import { loadDesk } from '../../../_lib/desk.js';
import { fleet, repoRequest, GitHubError } from '../../../_lib/github-desk.js';
export async function onRequestPost({ env, request }) {
  if (!sameOrigin(request)) return json({error:'Forbidden'},403);
  if (!env.DESK_GITHUB_TOKEN) return json({state:'disconnected'},503);
  if (Number(request.headers.get('content-length')||0)>4096) return json({error:'Request too large'},413);
  let q; try {const raw=await request.text();if(raw.length>4096) return json({error:'Request too large'},413);q=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
  if (!q || typeof q !== 'object' || Array.isArray(q)) return json({error:'Invalid request'},400);
  const action=q.action||'knowledge', refresh=q.refresh==='1';
  try {
    if (action==='knowledge') { if(!env.DESK_KNOWLEDGE_REPO) return json({state:'knowledge repository not configured'},503); return json(await loadDesk(env.DESK_GITHUB_TOKEN,refresh,env.DESK_KNOWLEDGE_REPO)); }
    if (action==='fleet') return json(await fleet(env.DESK_GITHUB_TOKEN,refresh));
    if (['detail','contents','jobs','commit','runs'].includes(action)) return json(await repoRequest(env.DESK_GITHUB_TOKEN,q.repo,action,q.path||'',refresh,q.id||''));
    return json({error:'Not found'},404);
  } catch(e) {return json({state:'error',error:e instanceof GitHubError&&e.status===404?'Not found or not authorized':e.retry?'GitHub rate limit reached; try again later':'GitHub is unavailable'},e instanceof GitHubError&&e.status===404?404:502);}
}
