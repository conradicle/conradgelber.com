import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyfishSchool, bellPoint, stroke, NODES } from '../js/jellyfish-model.js';

const almost = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);
test('bell changes aperture and curvature rather than scaling the body', () => {
  const p=new Float64Array(3), q=new Float64Array(3);
  bellPoint(0,1,0,0,0,p); bellPoint(0,1,1,0,0,q);
  assert.ok(q[0]/p[0]<.7); assert.ok(q[1]>p[1]+.1);
  bellPoint(0,0,0,0,0,p); bellPoint(0,0,1,0,0,q);
  almost(p[0],q[0]); assert.ok(q[1]>p[1]);
  almost(stroke(.16),0); almost(stroke(.37),1); almost(stroke(1),0);
});
test('jet acts during inward stroke and rests during refill', () => {
  const s=new JellyfishSchool({count:1});const o=s.animals[0];
  for (const [phase,thrust] of [[.25,true],[.5,false],[.9,false]]) {
    o.phase=phase;o.contraction=stroke(phase);s.step(1/90);
    assert.equal(o.thrust>0,thrust);
  }
});
test('fixed steps agree across display refresh rates', () => {
  const a=new JellyfishSchool({count:1}),b=new JellyfishSchool({count:1});
  for(let k=0;k<240;k++)a.advance(1/30);
  for(let k=0;k<960;k++)b.advance(1/120);
  almost(a.time,b.time);almost(a.animals[0].x,b.animals[0].x);almost(a.animals[0].y,b.animals[0].y);
});
test('filament roots follow the exact bell and lengths stay constrained through turns', () => {
  const s=new JellyfishSchool({count:1}),p=new Float64Array(3);let curved=false;
  for(let f=0;f<1200;f++) {
    s.advance(1/60);const o=s.animals[0];
    for(const c of o.chains) {
      s.root(o,c,p);for(let j=0;j<3;j++)almost(c.points[j],p[j]);
      const rest=c.length*o.scale/(NODES-1);
      for(let k=1;k<NODES;k++) {
        const b=k*3;const length=Math.hypot(c.points[b]-c.points[b-3],c.points[b+1]-c.points[b-2],c.points[b+2]-c.points[b-1]);
        almost(length,rest,1e-6);
      }
      const mid=(NODES>>1)*3,end=(NODES-1)*3;
      curved ||= Math.abs(c.points[mid]-(c.points[0]+c.points[end])/2)>.015;
    }
  }
  assert.ok(curved,'world-space filaments must bend');
  const o=s.animals[0];o.heading=2.5;const heading=o.heading;s.advance(1/60);
  assert.ok(o.heading>2.4,'downward heading is not clamped upright');
  assert.ok(Math.abs(o.heading-heading)<.01,'turning is gradual');
});
test('long-running school stays finite and on stage without wrapping', () => {
  for(const aspect of [.4,1.5,2.2]) {
    const s=new JellyfishSchool({count:3,aspect});
    for(let f=0;f<60*90;f++) {
      const previous=s.animals.map(o=>[o.x,o.y]);s.advance(1/60);
      for(const [i,o] of s.animals.entries()) {
        assert.ok(Number.isFinite(o.x+o.y+o.heading));
        assert.ok(Math.abs(o.x)<aspect+.05&&Math.abs(o.y)<.9);
        assert.ok(Math.hypot(o.x-previous[i][0],o.y-previous[i][1])<.01,'no teleport');
      }
    }
  }
});
test('resizing a still scene preserves anatomy and exact root attachment', () => {
  const s=new JellyfishSchool({count:3,compact:true}),p=new Float64Array(3);
  for(const aspect of [.39,2,1]) {
    s.resize(aspect);
    for(const o of s.animals)for(const c of o.chains){s.root(o,c,p);for(let j=0;j<3;j++)almost(c.points[j],p[j]);}
  }
});
test('a folded filament unfolds behind the wake while preserving its root and lengths', () => {
  const s=new JellyfishSchool({count:1,specimen:true}),o=s.animals[0],c=o.chains[0],p=c.points;
  const rest=c.length*o.scale/(NODES-1),back=[Math.sin(o.heading),-Math.cos(o.heading)];
  for(let k=1;k<NODES;k++){const b=k*3;p[b]=p[0]-back[0]*rest*k;p[b+1]=p[1]-back[1]*rest*k;p[b+2]=p[2];}
  c.previous.set(p);
  for(let k=0;k<90;k++){s.time+=1/90;s.stepChain(o,c,1/90,0,0);}
  const root=new Float64Array(3);s.root(o,c,root);for(let j=0;j<3;j++)almost(p[j],root[j]);
  for(let k=1;k<NODES;k++){
    const b=k*3,x=p[b]-p[b-3],y=p[b+1]-p[b-2],z=p[b+2]-p[b-1];
    almost(Math.hypot(x,y,z),rest);assert.ok((x*back[0]+y*back[1])/rest>0,'no link curls toward the crown');
  }
});
test('a turn guides the attachment before the free tip, retaining curvature', () => {
  const s=new JellyfishSchool({count:1,specimen:true}),o=s.animals[0],c=o.chains[4];
  for(let k=0;k<300;k++)s.advance(1/60);
  const old=Array.from(c.points);o.heading+=.6;s.advance(1/60);
  const rootMove=Math.hypot(c.points[0]-old[0],c.points[1]-old[1]);
  const tipMove=Math.hypot(c.points[54]-old[54],c.points[55]-old[55]);
  assert.ok(rootMove>.02);assert.ok(tipMove<rootMove*.7,'the chain must not rotate rigidly with the bell');
  const span=Math.hypot(c.points[54]-c.points[0],c.points[55]-c.points[1],c.points[56]-c.points[2]);
  assert.ok(span/(c.length*o.scale)<.99,'the filament retains a curved path');
});
test('oral arms smooth sharp local bends more than fine tentacles', () => {
  const s=new JellyfishSchool({count:1,specimen:true}),o=s.animals[0];
  const fine=structuredClone(o.chains[0]),oral=structuredClone(fine);oral.oral=true;
  for(const c of [fine,oral]) {
    const root=new Float64Array(3);s.root(o,c,root);const rest=c.length*o.scale/(NODES-1);
    for(let k=0;k<NODES;k++){const b=k*3;c.points[b]=root[0]+Math.sin(o.heading)*rest*k+Math.cos(o.heading)*rest*.4*(k%2);c.points[b+1]=root[1]-Math.cos(o.heading)*rest*k+Math.sin(o.heading)*rest*.4*(k%2);c.points[b+2]=root[2];}
    c.previous.set(c.points);
  }
  for(let k=0;k<30;k++){s.time+=1/90;s.stepChain(o,fine,1/90,0,0);s.stepChain(o,oral,1/90,0,0);}
  const bending=c=>{let sum=0;for(let k=1;k<NODES-1;k++){const p=c.points,b=k*3,a=[p[b]-p[b-3],p[b+1]-p[b-2],p[b+2]-p[b-1]],d=[p[b+3]-p[b],p[b+4]-p[b+1],p[b+5]-p[b+2]];sum+=1-a.reduce((v,x,j)=>v+x*d[j],0)/Math.hypot(...a)/Math.hypot(...d);}return sum;};
  assert.ok(bending(oral)<bending(fine));
});
test('strand traits are reproducible, distinct and break uniform attachment spacing', () => {
  const a=new JellyfishSchool({count:1}),b=new JellyfishSchool({count:1});
  assert.deepEqual(a.animals[0].chains,b.animals[0].chains);
  const fine=a.animals[0].chains.slice(0,16),gaps=fine.map((c,i)=>((fine[(i+1)%16].angle-c.angle+Math.PI*2)%(Math.PI*2)));
  assert.ok(Math.max(...gaps)-Math.min(...gaps)>.05);
  assert.ok(gaps.every(g=>g>.2&&g<.6),'irregular roots remain separated');
  for(const field of ['drag','response','flex','tipResponse','current','frequency','length'])assert.ok(new Set(fine.map(c=>c[field])).size>12,field+' varies independently');
  for(let k=0;k<90;k++)a.advance(1/30);
  for(let k=0;k<360;k++)b.advance(1/120);
  for(let j=0;j<20;j++)assert.deepEqual(a.animals[0].chains[j].points,b.animals[0].chains[j].points,'motion is independent of refresh rate');
});
test('different strand traits change tip follow-through while keeping roots stable', () => {
  const s=new JellyfishSchool({count:1,specimen:true}),o=s.animals[0],a=structuredClone(o.chains[0]),b=structuredClone(a);
  for(const field of ['drag','response','flex','current','tipResponse','frequency','phase'])b[field]=o.chains[1][field];
  o.heading+=.65;
  for(let k=0;k<180;k++){s.time+=1/90;s.stepChain(o,a,1/90,0,0);s.stepChain(o,b,1/90,0,0);}
  let root=0,tip=0;
  for(let k=1;k<NODES;k++){
    const base=k*3,distance=Math.hypot(a.points[base]-b.points[base],a.points[base+1]-b.points[base+1],a.points[base+2]-b.points[base+2]);
    if(k<=3)root+=distance/3;if(k>=12)tip+=distance/7;
  }
  assert.ok(tip>.01,'neighboring tips have distinct motion');
  assert.ok(root<.002&&tip>root*5,'extra variation stays concentrated away from the attachments');
});
test('ribbon tangent follows the smooth strand through a curve', () => {
  const s=new JellyfishSchool({count:1}),c=s.animals[0].chains[16],p=new Float64Array(3),before=new Float64Array(3),after=new Float64Array(3),tangent=new Float64Array(3);
  for(let k=0;k<300;k++)s.advance(1/60);
  for(const d of [.15,.41,.73,.95]){
    s.sampleChain(c,d,p,tangent);s.sampleChain(c,d-.0001,before);s.sampleChain(c,d+.0001,after);
    const delta=after.map((v,i)=>v-before[i]);
    const dot=delta.reduce((sum,v,i)=>sum+v*tangent[i],0)/Math.hypot(...delta)/Math.hypot(...tangent);
    assert.ok(dot>.9999,'ribbon frame must follow the interpolated curve, not the body heading');
  }
});
