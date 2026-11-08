// Pure scene descriptions. Edges describe only relationships present in source data.
export const PAGE_SIZE = 15;
export const parentPath = path => path.split('/').slice(0, -1).join('/');
export function ancestors(path) {
  const result = [''];
  const parts = path.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) result.push(parts.slice(0, i).join('/'));
  return result;
}
export function visibleEntries(entries, offset = 0) {
  return [...entries].sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)).slice(offset, offset + PAGE_SIZE);
}
const grid = (i, count, spacing = 7, maxColumns = 4) => {
  const cols = Math.min(maxColumns, Math.ceil(Math.sqrt(count)));
  return [(i % cols - (cols - 1) / 2) * spacing, (i % 3) * .85, (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * spacing];
};
// A spatial arrangement for display only; edges still come solely from records.
const knowledgePosition = (i, count) => {
  const n = Math.max(1, Math.min(count, 40));
  const angle = i * 2.399963229728653;
  const y = 1 - 2 * ((i + .5) / n);
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return [x * 21 + (x < 0 ? -1.2 : 1.2), 5 + y * 10, z * 11];
};
export function makeModel(state) {
  const {view, repos, selected, folder, directory, offset, knowledge, detail, run, jobs} = state;
  const nodes = [], edges = [];
  const add = (node, parent) => { nodes.push(node); if (parent) edges.push({from: parent, to: node.id}); };
  if (view === 'fleet') {
    const fleet = repos.filter(r => !state.pinnedOnly || state.pins.includes(r.name));
    fleet.slice(0, 40).forEach((r, i) => add({id: 'repo:' + r.name, label: r.name.split('/')[1], subtitle: r.language || r.visibility, kind: 'repo', position: grid(i, Math.min(fleet.length, 40), 13, 7), action: 'repo', value: r.name}));
  } else if (view === 'structure' && selected) {
    const chain = ancestors(folder);
    chain.forEach((path, i) => add({id: path ? 'path:' + path : 'repo:' + selected, label: path ? path.split('/').pop() : selected.split('/')[1], subtitle: i === chain.length - 1 ? 'Current folder' : 'Parent', kind: path ? 'dir' : 'repo', position: [0, 5 + (chain.length - 1 - i) * 2.5, -9 - (chain.length - 1 - i) * 7], action: 'folder', value: path}, i ? (chain[i - 1] ? 'path:' + chain[i - 1] : 'repo:' + selected) : null));
    const contents = visibleEntries(directory?.entries || [], offset);
    contents.forEach((entry, i) => {
      const col = i % 5, row = Math.floor(i / 5);
      add({id: 'path:' + entry.path, label: entry.name, subtitle: entry.type === 'dir' ? 'Open folder' : 'Preview file', kind: entry.type === 'dir' ? 'dir' : 'file', position: [(col - Math.min(4, contents.length - 1) / 2) * 6.5, .4 + row * .8, 1 + row * 7], action: entry.type === 'dir' ? 'folder' : 'file', value: entry.path}, folder ? 'path:' + folder : 'repo:' + selected);
    });
  } else if (view === 'knowledge') {
    const records = [...(knowledge?.projects || []), ...(knowledge?.documents || [])];
    records.slice(0, 40).forEach((record, i) => add({id: 'knowledge:' + record.path, label: record.title, subtitle: record.status || 'Documented record', kind: 'record', position: knowledgePosition(i, records.length), action: 'knowledge', value: record.path}));
    const ids = new Set(nodes.map(n => n.id));
    for (const record of records) for (const path of record.related || []) if (ids.has('knowledge:' + path)) edges.push({from: 'knowledge:' + record.path, to: 'knowledge:' + path});
  } else if (view === 'workflow' && selected && detail) {
    if (run && jobs) {
      add({id: 'run:' + run.id, label: run.name || 'Workflow run', subtitle: run.conclusion || run.status, status: run.status, kind: 'run', position: [0, 6, -10], action: 'run', value: run});
      jobs.jobs.slice(0, 6).forEach((job, i) => {
        const x = (i - (Math.min(6, jobs.jobs.length) - 1) / 2) * 8;
        add({id: 'job:' + job.id, label: job.name, subtitle: job.conclusion || job.status, status: job.status, kind: 'job', position: [x, 2, 0], action: 'job', value: job}, 'run:' + run.id);
        job.steps.slice(0, 5).forEach((step, j) => add({id: `step:${job.id}:${step.number}`, label: step.name, subtitle: step.conclusion || step.status, status: step.status, kind: 'file', position: [x + (j - (Math.min(5, job.steps.length) - 1) / 2) * (jobs.jobs.length <= 2 ? 4 : 2), .5, 8 + (j % 2) * 5], action: 'step', value: step}, 'job:' + job.id));
      });
    } else {
      const definitions = detail.sections.workflows?.value?.workflows || [];
      const runs = detail.sections.runs?.value?.workflow_runs || [];
      definitions.slice(0, 4).forEach((w, i) => add({id: 'workflow:' + w.id, label: w.name, subtitle: 'Workflow definition', kind: 'dir', position: [(i - (Math.min(4, definitions.length) - 1) / 2) * 10, 5, -10], action: 'definition', value: w}));
      runs.slice(0, 12).forEach((r, i) => {
        const position = grid(i, Math.min(12, runs.length), 8); position[2] += 3;
        add({id: 'run:' + r.id, label: r.name || 'Workflow run', subtitle: r.conclusion || r.status, status: r.status, kind: 'run', position, action: 'run', value: r}, nodes.some(n => n.id === 'workflow:' + r.workflow_id) ? 'workflow:' + r.workflow_id : null);
      });
    }
  }
  return {nodes, edges};
}
