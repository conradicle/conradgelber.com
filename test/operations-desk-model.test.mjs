import test from 'node:test';
import assert from 'node:assert/strict';
import {makeModel, visibleEntries, ancestors, PAGE_SIZE} from '../hub/tools/operations-desk/model.js';

const base = {view:'structure',repos:[],pins:[],selected:'owner/repo',folder:'src/lib',directory:{entries:[{name:'nested',path:'src/lib/nested',type:'dir'},{name:'file.js',path:'src/lib/file.js',type:'file'}]},offset:0};
test('structure preserves exact ancestor and immediate-child containment',()=>{
  const model=makeModel(base);
  assert.deepEqual(model.edges,[{from:'repo:owner/repo',to:'path:src'},{from:'path:src',to:'path:src/lib'},{from:'path:src/lib',to:'path:src/lib/nested'},{from:'path:src/lib',to:'path:src/lib/file.js'}]);
  assert.ok(new Set(model.nodes.map(n=>n.position[1])).size>1);
  assert.ok(new Set(model.nodes.map(n=>n.position[2])).size>1);
  assert.deepEqual(ancestors('src/lib'),['','src','src/lib']);
});
test('folder pagination keeps every entry reachable without accumulating a graph',()=>{
  const entries=Array.from({length:37},(_,i)=>({name:'file'+String(i).padStart(2,'0'),path:'src/lib/file'+i,type:'file'}));
  const all=[0,PAGE_SIZE,PAGE_SIZE*2].flatMap(offset=>visibleEntries(entries,offset));
  assert.equal(all.length,37);assert.equal(new Set(all.map(e=>e.path)).size,37);
  assert.equal(makeModel({...base,directory:{entries},offset:PAGE_SIZE}).nodes.length,PAGE_SIZE+3);
});
test('workflow membership does not fabricate job or step execution dependencies',()=>{
  const model=makeModel({...base,view:'workflow',detail:{},run:{id:1,name:'Build',status:'completed'},jobs:{jobs:[{id:2,name:'Check',status:'completed',steps:[{number:1,name:'Install',status:'completed'},{number:2,name:'Test',status:'completed'}]}]}});
  assert.deepEqual(model.edges,[{from:'run:1',to:'job:2'},{from:'job:2',to:'step:2:1'},{from:'job:2',to:'step:2:2'}]);
});
test('knowledge only connects explicit references to displayed records',()=>{
  const model=makeModel({...base,view:'knowledge',knowledge:{projects:[{path:'projects/a.md',title:'A',related:['projects/b.md','people/private.md']},{path:'projects/b.md',title:'B',related:[]}],documents:[]}});
  assert.deepEqual(model.edges,[{from:'knowledge:projects/a.md',to:'knowledge:projects/b.md'}]);
});
test('fleet shows all available destinations unless pinned-only is requested',()=>{
  const repos=[{name:'owner/a',visibility:'private'},{name:'owner/b',visibility:'public'}];
  assert.equal(makeModel({...base,view:'fleet',repos,pins:['owner/a']}).nodes.length,2);
  assert.deepEqual(makeModel({...base,view:'fleet',repos,pins:['owner/a'],pinnedOnly:true}).nodes.map(n=>n.id),['repo:owner/a']);
});
test('fleet tiers follow saved preferences and fall back safely',()=>{
  const repos=[{name:'owner/a',visibility:'private'},{name:'owner/b',visibility:'public'},{name:'owner/c',visibility:'private'},{name:'owner/d',visibility:'public'}];
  const nodes=makeModel({...base,view:'fleet',repos,tiers:{'owner/b':2,'owner/c':3,'owner/d':99}}).nodes;
  assert.deepEqual(nodes.map(n=>n.tier),[1,2,3,1]);
  assert.deepEqual(makeModel({...base,view:'fleet',repos,tiers:{'owner/b':2},pins:['owner/b'],pinnedOnly:true}).nodes.map(n=>[n.id,n.tier]),[['repo:owner/b',2]]);
});
test('fleet tiers form ordered, separated rings regardless of repository order',()=>{
  const repos=Array.from({length:40},(_,i)=>({name:'owner/repo-'+String(i).padStart(2,'0'),visibility:'private'}));
  const tiers=Object.fromEntries(repos.map((r,i)=>[r.name,i<3?3:i<12?2:1]));
  const nodes=makeModel({...base,view:'fleet',repos,tiers}).nodes;
  const radius=n=>Math.hypot(n.position[0],n.position[2]);
  const ranges=[1,2,3].map(t=>nodes.filter(n=>n.tier===t).map(radius));
  assert.ok(Math.max(...ranges[2])<Math.min(...ranges[1]));
  assert.ok(Math.max(...ranges[1])<Math.min(...ranges[0]));
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)assert.ok(Math.hypot(nodes[i].position[0]-nodes[j].position[0],nodes[i].position[2]-nodes[j].position[2])>10);
  const reordered=makeModel({...base,view:'fleet',repos:[...repos].reverse(),tiers}).nodes;
  const positions=new Map(nodes.map(n=>[n.id,n.position]));
  for(const node of reordered)assert.deepEqual(node.position,positions.get(node.id));
});
test('fleet honors favorites and handles an empty tier',()=>{
  const repos=[{name:'owner/a'},{name:'owner/b'},{name:'owner/c'}];
  const nodes=makeModel({...base,view:'fleet',repos,tiers:{'owner/a':3,'owner/b':1},pins:['owner/a','owner/b'],pinnedOnly:true}).nodes;
  assert.equal(nodes.length,2);assert.equal(Math.hypot(...[nodes[0].position[0],nodes[0].position[2]]),0);
  assert.ok(Math.hypot(nodes[1].position[0],nodes[1].position[2])>0);
});
