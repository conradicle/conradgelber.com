const allowed = /^(projects|conversations|handoffs)\/[a-z0-9][a-z0-9-]*\.md$/;

let cached = null;
export function parse(path, text) {
  const title = text.match(/^#\s+(?:Project:\s*)?(.+)$/m)?.[1] || path;
  const field = name => text.match(new RegExp("^- " + name + ":\\s*(.+)$", "im"))?.[1] || "";
  const sections = {}; let key = "";
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.+)/);
    if (h) { key = h[1]; sections[key] = []; } else if (key) sections[key].push(line);
  }
  const permitted = /^(objective|current state|constraints and decisions|next actions|related records|reported as done|reported as planned or in progress \(status not verified\)|to verify|summary|context|decisions|milestones|notes)$/i;
  for (const k of Object.keys(sections)) {
    if (!permitted.test(k)) delete sections[k];
    else sections[k] = sections[k].join("\n").trim();
  }
  const related = [...(sections["Related records"] || "").matchAll(/(?:projects|conversations|handoffs)\/[a-z0-9][a-z0-9-]*\.md/g)].map(m => m[0]);
  const sourceText = field('Source') + '\n' + Object.values(sections).join('\n');
  const repos = [...sourceText.matchAll(/(?:https:\/\/github\.com\/|\b)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi)].map(m => m[1].replace(/\.git$/i, '').replace(/[.,;:]+$/, ''));
  return { repos: [...new Set(repos)], path, title, status: field("Status"), confidence: field("Confidence"), date: field("Date"), sections, related: [...new Set(related)].filter(x => allowed.test(x)) };
}
export { allowed };
async function github(path, token, repo) {
  const res = await fetch("https://api.github.com/repos/" + repo + path, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "private-operations-desk", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (!res.ok) throw new Error("GitHub unavailable"); return res.json();
}
export async function loadDesk(token, refresh = false, repo) {
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split("/").some(x => x === "." || x === "..")) throw new Error("Knowledge repository not configured");
  if (!refresh && cached && cached.token === token && cached.repo === repo && Date.now() - cached.at < 60000) return cached.value;
  const tree = await github("/git/trees/main?recursive=1", token, repo);
  if (tree.truncated) throw new Error("Incomplete tree");
  const paths = new Set(tree.tree.filter(x => x.type === "blob" && x.size <= 100000 && allowed.test(x.path)).map(x => x.path));
  const projectPaths = [...paths].filter(x => x.startsWith("projects/")).slice(0, 100);
  async function read(path) {
    const file = await github("/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=main", token, repo);
    if (file.encoding !== "base64" || file.size > 100000) throw new Error("Invalid file");
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0));
    return parse(path, new TextDecoder().decode(bytes));
  }
  const projects = [];
  for (let i=0; i<projectPaths.length; i+=4) projects.push(...await Promise.all(projectPaths.slice(i,i+4).map(read)));
  const linked = [...new Set(projects.flatMap(p => p.related))].filter(p => paths.has(p) && !projectPaths.includes(p)).slice(0, 100);
  const documents = [];
  for (let i=0; i<linked.length; i+=4) documents.push(...await Promise.all(linked.slice(i,i+4).map(read)));
  const commits = await github("/commits?per_page=15", token, repo);
  const activity = commits.map(c => ({ id: c.sha, title: c.commit.message.split("\n")[0], date: c.commit.author.date, url: "https://github.com/" + repo + "/commit/" + c.sha }));
  const value = { sourceRoot: "https://github.com/" + repo + "/blob/main/", state: "connected", syncedAt: new Date().toISOString(), projects, documents, activity };
  cached = { token, repo, at: Date.now(), value }; return value;
}
