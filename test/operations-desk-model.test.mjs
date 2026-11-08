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
