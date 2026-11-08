/* One atlas, one WebGL draw. Only glyphs are visible; anatomy stays invisible. */
import { JellyfishSchool, STRANDS } from './jellyfish-model.js?v=3';

(() => {
  'use strict';
  const canvas = document.querySelector('#jellyfish');
  if (!canvas) return;
  const hero = canvas.parentElement, desk = canvas.dataset.scene === 'desk';
  const specimen = canvas.dataset.scene === 'specimen';
  const mirror = document.querySelector('#jellyfish-repository');
  const mirrorContext = mirror && mirror.getContext('2d');
  let gl;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' }); } catch (_) { /* ordinary HTML remains usable */ }
  if (!gl) { canvas.style.display = 'none'; return; }
  const small = matchMedia('(max-width: 850px)').matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const amount = specimen ? 1 : desk || small ? 3 : 4;
  const school = new JellyfishSchool({ count: amount, specimen, desk, compact: small });
  const vertex = `
    precision highp float;
    attribute vec4 aPosition; // world XY, relative depth, organism scale
    attribute vec4 aGlyph; // atlas index, brightness, organism, anatomy kind
    uniform float uOpacity[4];
    uniform float uWaves[4];
    uniform float uDpr, uHeight, uAspect, uDim, uHover;
    uniform vec2 uPointer;
    varying float vGlyph, vLight, vAlpha;
    void main() {
      int id=int(aGlyph.z);
      float opacity=uOpacity[0], wave=uWaves[0];
      if(id==1){opacity=uOpacity[1];wave=uWaves[1];}
      if(id==2){opacity=uOpacity[2];wave=uWaves[2];}
      if(id==3){opacity=uOpacity[3];wave=uWaves[3];}
      vec2 pos=vec2(aPosition.x/uAspect,aPosition.y);
      gl_Position=vec4(pos,0.0,1.0);
      float depth=clamp(1.0+aPosition.z*.16,.8,1.2);
      gl_PointSize=clamp(uHeight*.037*aPosition.w,3.0*uDpr,8.5*uDpr)*depth;
      float cursor=exp(-length(pos-uPointer)*5.0)*uHover;
      vLight=aGlyph.y*(.82+.15*aPosition.z)+cursor*.09+wave*.12;
      float edgeFade=smoothstep(0.0,.075,1.0-max(abs(pos.x),abs(pos.y)));
      vAlpha=(aGlyph.w<.5?.37:.52)*opacity*uDim*edgeFade;
      vGlyph=aGlyph.x;
    }`;
  const fragment = `
    precision mediump float;
    uniform sampler2D uAtlas;
    varying float vGlyph, vLight, vAlpha;
    void main(){
      vec2 uv=vec2((vGlyph+gl_PointCoord.x)/16.0,gl_PointCoord.y);
      float ink=smoothstep(.10,.46,texture2D(uAtlas,uv).a);
      gl_FragColor=vec4(vec3(.78,.88,.94)*vLight,ink*vAlpha);
    }`;
  let program, buffer, positionBuffer, texture, observer, resizeObserver, themeObserver, removalObserver;
  let count = 0, raf = 0, alive = false, disposed = false, visible = true;
  let last = 0, hover = 0, explorerActive = false, pointerInExplorer = false, focusInExplorer = false;
  let pointer = [100,100], quality = 1, frames = [], lastMove = -10000;
  let positions, shapes, glyphs;
  const opacity = new Float32Array(4), waves = new Float32Array(4), point = new Float64Array(3), tangent = new Float64Array(3);
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), events = new AbortController();
  const locations = {};
  const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: events.signal });
  function shader(type, source) {
    const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
    if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) { const error=gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error(error); }
    return s;
  }
  function geometry() {
    const budget=specimen?3500:desk?3600:small?5400:8800, per=Math.floor(budget/amount);
    const data=[], meta=[];
    let seed=5831; const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    const add=(id,angle,d,kind,lane=0)=>{
      data.push(angle,d,kind,lane);
      meta.push(Math.floor(random()*16),.53+random()*.4,id,kind);
    };
    for(let id=0;id<amount;id++) {
      const bell=Math.floor(per*.52), rim=Math.floor(bell*.15), surface=bell-rim;
      for(let j=0;j<surface;j++) add(id,j*2.39996323,Math.acos(1-(j+.5)/surface)*2/Math.PI,0);
      for(let j=0;j<rim;j++) add(id,j*2.39996323,.96+.04*(j%3)/2,0);
      const thin=Math.floor(per*.19/16);
      for(let strand=0;strand<16;strand++) for(let j=0;j<thin;j++) add(id,strand,(j+.15)/(thin-.7),1);
      const arm=Math.floor(per*.29/20);
      for(let strand=16;strand<STRANDS;strand++) for(let j=0;j<arm;j++) for(let lane=-2;lane<=2;lane++) add(id,strand,(j+.1)/arm,2,lane/2);
    }
    shapes=Float32Array.from(data); glyphs=Float32Array.from(meta); count=glyphs.length/4; positions=new Float32Array(count*4);
  }
  function updatePositions() {
    for(let id=0;id<amount;id++) {
      const o=school.animals[id]; opacity[id]=.52+(o.depth-.8)*1.5;
      waves[id]=Math.exp(-Math.max(0,school.time-o.pulse)*2);
    }
    for(let i=0;i<count;i++) {
      const b=i*4, a=shapes[b], d=shapes[b+1], kind=shapes[b+2], o=school.animals[glyphs[b+2]];
      if(kind===0) school.surface(o,a,d,point);
      else {
        const chain=o.chains[a]; school.sampleChain(chain,d,point,kind===2?tangent:undefined);
        if(kind===2) {
          // Broad glyph ribbons follow the chain tangent, including through turns.
          const taper=Math.sin(Math.PI*Math.min(1,d)*.97)**.7;
          const width=chain.ribbonWidth*taper*(.82+.18*Math.sin(d*9.2-school.time*.34*chain.response+chain.phase));
          const twist=.55*Math.sin(d*3.8-school.time*.18+chain.seed)+.28*Math.sin(d*7.5+school.time*.13+chain.phase);
          const length=Math.hypot(tangent[0],tangent[1],tangent[2])||1, tx=tangent[0]/length, ty=tangent[1]/length, tz=tangent[2]/length;
          const planar=Math.hypot(tx,ty)||1, nx=-ty/planar, ny=tx/planar;
          const lane=shapes[b+3], edge=.012*Math.sin(d*18-school.time*.35+chain.seed)*lane*lane*(.2+.8*d);
          const offset=(width*lane+edge)*o.scale, c=Math.cos(twist), s=Math.sin(twist);
          point[0]+=offset*(nx*c-tz*ny*s);
          point[1]+=offset*(ny*c+tz*nx*s);
          point[2]+=offset*(tx*ny-ty*nx)*s;
        }
      }
      positions[b]=point[0]; positions[b+1]=point[1]; positions[b+2]=point[2]/o.scale; positions[b+3]=o.scale;
    }
  }
  function release() {
    gl.deleteBuffer(buffer); gl.deleteBuffer(positionBuffer); gl.deleteTexture(texture); gl.deleteProgram(program);
  }
  function init() {
    const vs=shader(gl.VERTEX_SHADER,vertex), fs=shader(gl.FRAGMENT_SHADER,fragment);
    program=gl.createProgram(); gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    ['uDpr','uHeight','uAspect','uDim','uHover','uPointer','uAtlas','uOpacity[0]','uWaves[0]'].forEach(n=>locations[n]=gl.getUniformLocation(program,n));
    if(!positions) geometry();
    buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,glyphs,gl.STATIC_DRAW);
    const glyph=gl.getAttribLocation(program,'aGlyph'); gl.enableVertexAttribArray(glyph); gl.vertexAttribPointer(glyph,4,gl.FLOAT,false,0,0);
    positionBuffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer); gl.bufferData(gl.ARRAY_BUFFER,positions,gl.DYNAMIC_DRAW);
    const pos=gl.getAttribLocation(program,'aPosition'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,4,gl.FLOAT,false,0,0);
    const atlas=document.createElement('canvas'); atlas.width=512; atlas.height=32;
    const ctx=atlas.getContext('2d'); ctx.fillStyle='#fff'; ctx.font='26px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    '01{}<>/=;ABCDEF_'.split('').forEach((c,i)=>ctx.fillText(c,i*32+16,17));
    texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(locations.uAtlas,0); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE); gl.clearColor(0,0,0,0);
    alive=true; resize(); updatePositions(); draw();
  }
  function resize() {
    if(!alive) return;
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,small?1.35:1.6)*quality;
    canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
    gl.viewport(0,0,canvas.width,canvas.height); gl.uniform1f(locations.uDpr,dpr); gl.uniform1f(locations.uHeight,canvas.height);
    school.resize(Math.max(.1,rect.width/Math.max(1,rect.height))); gl.uniform1f(locations.uAspect,school.aspect);
    updatePositions(); draw();
  }
  function draw() {
    if(!alive) return;
    gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1fv(locations['uOpacity[0]'],opacity); gl.uniform1fv(locations['uWaves[0]'],waves);
    gl.uniform1f(locations.uDim,desk?.5:small?.75:1); gl.uniform1f(locations.uHover,hover); gl.uniform2fv(locations.uPointer,pointer);
    gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer); gl.bufferSubData(gl.ARRAY_BUFFER,0,positions); gl.drawArrays(gl.POINTS,0,count);
    canvas.classList.add('is-live');
    if(mirrorContext && mirror.clientWidth && mirror.clientHeight) {
      const w=mirror.clientWidth,h=mirror.clientHeight,dpr=Math.min(devicePixelRatio||1,1.5)*quality;
      if(mirror.width!==Math.round(w*dpr)||mirror.height!==Math.round(h*dpr)){mirror.width=Math.round(w*dpr);mirror.height=Math.round(h*dpr);}
      const crop=Math.min(canvas.width,canvas.height*w/h);
      mirrorContext.clearRect(0,0,mirror.width,mirror.height);
      mirrorContext.drawImage(canvas,(canvas.width-crop)/2,0,crop,canvas.height,0,0,mirror.width,mirror.height); mirror.classList.add('is-live');
    }
  }
  function frame(now) {
    if(!alive) return;
    const elapsed=Math.max(0,(now-last)/1000),dt=Math.min(elapsed,.0667); last=now;
    hover+=(+(now-lastMove<1800)-hover)*(1-Math.exp(-dt*2));
    school.pointer[0]=pointer[0]*school.aspect; school.pointer[1]=pointer[1]; school.attention=hover;
    school.advance(dt); updatePositions(); draw();
    // Measure the real interval, not the bounded integration step.
    if(elapsed<.2) frames.push(elapsed);
    if(frames.length===120){if(frames.reduce((a,b)=>a+b,0)/frames.length>.025&&quality>.65){quality=Math.max(.64,quality*.8);resize();}frames=[];}
    raf=requestAnimationFrame(frame);
  }
  function refresh() {
    cancelAnimationFrame(raf); raf=0;
    if(!alive||!visible||document.hidden||explorerActive||document.documentElement.dataset.theme==='light') return;
    if(motion.matches){draw();return;}
    last=performance.now(); raf=requestAnimationFrame(frame);
  }
  function move(e){if(e.pointerType==='touch')return;const r=canvas.getBoundingClientRect();pointer=[(e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2];lastMove=performance.now();}
  function leave(){lastMove=-10000;}
  function click(e){if(motion.matches||e.target.closest('a,button,input,select,textarea'))return;const r=canvas.getBoundingClientRect(),x=((e.clientX-r.left)/r.width*2-1)*school.aspect,y=1-(e.clientY-r.top)/r.height*2;for(const o of school.animals)if(Math.hypot(o.x-x,o.y-y)<.45)o.pulse=school.time;}
  function lost(e){e.preventDefault();alive=false;cancelAnimationFrame(raf);canvas.classList.remove('is-live');mirror?.classList.remove('is-live');}
  function restored(){if(disposed)return;try{init();refresh();}catch(_){cleanup();canvas.style.display='none';}}
  function cleanup(){if(disposed)return;disposed=true;alive=false;cancelAnimationFrame(raf);events.abort();observer?.disconnect();resizeObserver?.disconnect();themeObserver?.disconnect();removalObserver?.disconnect();release();}
  try {
    init(); listen(hero,'pointermove',move); listen(hero,'pointerleave',leave); listen(hero,'click',click);
    listen(document,'visibilitychange',refresh); listen(motion,'change',refresh);
    listen(canvas,'webglcontextlost',lost); listen(canvas,'webglcontextrestored',restored);
    listen(window,'pagehide',e=>{if(e.persisted)cancelAnimationFrame(raf);else cleanup();});listen(window,'pageshow',e=>{if(e.persisted)refresh();});
    if('IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;refresh();});observer.observe(desk?document.querySelector('main'):canvas);}
    if('ResizeObserver' in window){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);}else listen(window,'resize',resize);
    themeObserver=new MutationObserver(refresh);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if(desk){
      const stage=document.querySelector('.scene-wrap');
      if(stage){
        pointerInExplorer=stage.matches(':hover');focusInExplorer=stage.contains(document.activeElement);explorerActive=pointerInExplorer||focusInExplorer;
        const updateExplorer=()=>{explorerActive=pointerInExplorer||focusInExplorer;refresh();};
        listen(stage,'pointerenter',()=>{pointerInExplorer=true;updateExplorer();});listen(stage,'pointerleave',()=>{pointerInExplorer=false;updateExplorer();});
        listen(stage,'focusin',()=>{focusInExplorer=true;updateExplorer();});listen(stage,'focusout',e=>{focusInExplorer=stage.contains(e.relatedTarget);updateExplorer();});
      }
    }
    removalObserver=new MutationObserver(()=>{if(!canvas.isConnected)cleanup();});removalObserver.observe(document.body,{childList:true,subtree:true});
    if(document.fonts?.ready)document.fonts.ready.then(()=>{if(!disposed)resize();});refresh();
  }catch(_){cleanup();canvas.style.display='none';}
})();
