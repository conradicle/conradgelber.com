/* A single WebGL point draw: every point samples one glyph from a local atlas.
   The organism is procedural, with no mesh or external rendering library. */
(() => {
  'use strict';
  const canvas = document.querySelector('#jellyfish');
  const mirror = document.querySelector('#jellyfish-repository');
  const mirrorContext = mirror && mirror.getContext('2d');
  const hero = canvas && canvas.parentElement;
  const desk = canvas && canvas.dataset.scene === 'desk';
  if (!hero) return;
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) { canvas.style.display = 'none'; return; }
  const vertex = `
    precision highp float;
    attribute vec4 aShape; // angle, distance down, kind, seed
    attribute vec3 aGlyph; // atlas index, brightness, organism
    attribute vec2 aLag; // interpolated flexible strand displacement
    uniform vec4 uJellies[5];
    uniform float uWaves[5];
    uniform float uOpacity[5];
    uniform float uAngles[5];
    uniform float uBeats[5];
    uniform float uDim;
    uniform float uTime, uDpr, uHeight, uAspect, uPulse, uHover;
    uniform vec2 uPointer, uTilt;
    varying float vGlyph, vLight, vAlpha;
    void main() {
      float a=aShape.x, d=aShape.y, kind=aShape.z, seed=aShape.w;
      int id=int(aGlyph.z);
      vec4 jelly=uJellies[0]; float waveTime=uWaves[0]; float opacity=uOpacity[0]; float angle=uAngles[0]; float beat=uBeats[0];
      if(id==1){jelly=uJellies[1];waveTime=uWaves[1];opacity=uOpacity[1];angle=uAngles[1];beat=uBeats[1];}
      if(id==2){jelly=uJellies[2];waveTime=uWaves[2];opacity=uOpacity[2];angle=uAngles[2];beat=uBeats[2];}
      if(id==3){jelly=uJellies[3];waveTime=uWaves[3];opacity=uOpacity[3];angle=uAngles[3];beat=uBeats[3];}
      if(id==4){jelly=uJellies[4];waveTime=uWaves[4];opacity=uOpacity[4];angle=uAngles[4];beat=uBeats[4];}
      float influence=exp(-length(jelly.xy-uPointer)*3.0)*uHover;
      float t=uTime*(.76+float(id)*.095)+jelly.w;
      vec3 p;
      if(kind < .5) {
        float theta=d*1.5707963;
        float r=sin(theta)*(1.06-.20*beat*pow(d,1.5))*(1.0+.035*sin(a*3.0+t*.7)*d);
        p=vec3(cos(a)*r, .12+cos(theta)*(.66+.16*beat), sin(a)*r);
        p.y += .035*sin(a*8.0+t*.6)*pow(d,3.0);
      } else {
        float oral=step(1.5,kind);
        float radius=mix(1.06-.20*beat,.18,oral);
        float len=mix(2.4,1.55,oral)*(0.82+.18*sin(a*3.0+1.0));
        float sway=sin(t*.7-d*4.8+a*2.0)*.12*d + sin(t*.31-d*8.0+a)*.10*d;
        float frill=oral*sin(d*32.0+a*3.0+t*.5)*.13*(.3+d);
        p=vec3(cos(a)*(radius+frill)+sway, .10-d*len, sin(a)*(radius+frill)+cos(t*.45-d*4.0+a*3.0)*.12*d);
        p.x += uTilt.x*d*.3*influence;
      }
      float ry=.18*sin(t*.21)+uTilt.x*.22*influence;
      float rx=.12+ .08*sin(t*.17)+uTilt.y*.14*influence;
      p.xz=mat2(cos(ry),-sin(ry),sin(ry),cos(ry))*p.xz;
      p.yz=mat2(cos(rx),-sin(rx),sin(rx),cos(rx))*p.yz;
      p.x+=.08*sin(t*.24); p.y+=.07*sin(t*.43);
      float perspective=4.8/(4.8-p.z);
      vec2 body=vec2(p.x, p.y+.38)*perspective;
      body=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*body;
      vec2 pos=kind>.5 ? aLag : jelly.xy+vec2(body.x/uAspect,body.y)*jelly.z;
      gl_Position=vec4(pos, 0.0, 1.0);
      gl_PointSize=clamp((5.0+2.0*aGlyph.y)*uDpr*perspective, 2.0, 14.0);
      float wave=exp(-pow((d-waveTime*1.6)*7.0,2.0))*step(0.0,waveTime)*step(waveTime,1.5);
      float nearCursor=exp(-length(pos-uPointer)*5.0)*uHover;
      vLight=aGlyph.y*(.62+.18*perspective)+wave*.38+nearCursor*.20;
      float edgeFade=smoothstep(0.0,.16,1.0-max(abs(pos.x),abs(pos.y)));
      vAlpha=mix(.47,.62,step(.5,kind))*uDim*opacity*edgeFade;
      vGlyph=aGlyph.x;
    }`;
  const fragment = `
    precision mediump float;
    uniform sampler2D uAtlas;
    varying float vGlyph, vLight, vAlpha;
    void main(){
      vec2 uv=vec2((vGlyph+gl_PointCoord.x)/16.0, gl_PointCoord.y);
      float ink=smoothstep(.12,.48,texture2D(uAtlas,uv).a);
      gl_FragColor=vec4(vec3(.78,.88,.94)*vLight,ink*vAlpha);
    }`;
  let program, buffer, lagBuffer, texture, observer, resizeObserver, themeObserver, removalObserver, count = 0, raf = 0, alive = false, aspect = 1;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true, time = 0, last = 0, hover = 0, explorerActive = false, pointerInExplorer = false, focusInExplorer = false;
  const amount = desk ? 3 : 5;
  // Separate heading, momentum and water velocity. The bell turns toward an
  // evolving intention before its pulse applies thrust along its own axis.
  let randomSeed=72913;
  function random(){randomSeed=(1664525*randomSeed+1013904223)>>>0;return randomSeed/4294967296;}
  const strands=32, segments=7;
  const organisms=Array.from({length:5},(_,i)=>({
    x:[-.7,-.25,.20,.60,.78][i], y:[.48,-.33,.38,-.45,.05][i],
    vx:[.006,-.006,.004,-.004,.003][i], vy:[.008,.007,.005,.008,.009][i],
    heading:[-.45,.5,-.4,.65,-.25][i], intention:(random()-.5)*1.7,
    change:1+random()*4, phase:random()*6.28, rhythm:.9+random()*.55,
    scale:.105+random()*.045, depth:.75+random()*.35, depthGoal:.75+random()*.35,
    pulse:-100, activity:.55+random()*.45
  }));
  const centers=new Float32Array(20), waves=new Float32Array(5), opacity=new Float32Array(5), angles=new Float32Array(5), beats=new Float32Array(5);
  const tails=new Float32Array(5*strands*segments*4);
  let lags, owners, strandIds, distances, kinds;
  // Smooth value noise produces a shared, slowly changing water current.
  function hash3(x,y,z){const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return (n-Math.floor(n))*2-1;}
  function noise3(x,y,z){
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
    let fx=x-ix,fy=y-iy,fz=z-iz;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);fz=fz*fz*(3-2*fz);
    const lerp=(a,b,t)=>a+(b-a)*t;
    return lerp(lerp(lerp(hash3(ix,iy,iz),hash3(ix+1,iy,iz),fx),lerp(hash3(ix,iy+1,iz),hash3(ix+1,iy+1,iz),fx),fy),lerp(lerp(hash3(ix,iy,iz+1),hash3(ix+1,iy,iz+1),fx),lerp(hash3(ix,iy+1,iz+1),hash3(ix+1,iy+1,iz+1),fx),fy),fz);
  }
  function strandAngle(strand){return (strand>=24?strand-24:strand)/(strand>=24?8:24)*Math.PI*2;}
  const lengths=Float32Array.from({length:strands},(_,j)=>{
    const a=strandAngle(j);return (j>=24?1.55:2.45)*(.70+.30*(.5+.5*Math.sin(a*3+1.3)));
  });
  // Project the attachment point with the same bell transform as the shader.
  function anchor(o,id,strand,out){
    const a=strandAngle(strand),oral=strand>=24,t=time*(.76+id*.095)+id*2.17;
    const beat=Math.pow(Math.max(0,Math.sin(o.phase)),2);
    const r=oral?.18:(1.06-.20*beat)*(1+.035*Math.sin(a*3+t*.7));
    let x=Math.cos(a)*r,y=oral?.10:.12+.035*Math.sin(a*8+t*.6),z=Math.sin(a)*r;
    const influence=Math.exp(-Math.hypot(o.x-pointer[0],o.y-pointer[1])*3)*hover;
    const ry=.18*Math.sin(t*.21)+tilt[0]*.22*influence,rx=.12+.08*Math.sin(t*.17)+tilt[1]*.14*influence;
    let nextX=Math.cos(ry)*x+Math.sin(ry)*z; z=-Math.sin(ry)*x+Math.cos(ry)*z;x=nextX;
    let nextY=Math.cos(rx)*y+Math.sin(rx)*z;z=-Math.sin(rx)*y+Math.cos(rx)*z;y=nextY;
    x+=.08*Math.sin(t*.24);y+=.07*Math.sin(t*.43);
    const perspective=4.8/(4.8-z),bx=x*perspective,by=(y+.38)*perspective,scale=o.scale*o.depth*(desk?1.55:1);
    out[0]=o.x+(Math.cos(o.heading)*bx-Math.sin(o.heading)*by)*scale/aspect;
    out[1]=o.y+(Math.sin(o.heading)*bx+Math.cos(o.heading)*by)*scale;
  }
  const attachment=new Float32Array(2), attachmentPoints=new Float32Array(5*strands*2);
  function resetTails(){
    for(let i=0;i<amount;i++) for(let j=0;j<strands;j++){
      const o=organisms[i],scale=o.scale*o.depth*(desk?1.55:1),len=lengths[j];anchor(o,i,j,attachment);
      attachmentPoints[(i*strands+j)*2]=attachment[0];attachmentPoints[(i*strands+j)*2+1]=attachment[1];
      for(let k=0;k<segments;k++){
        const b=((i*strands+j)*segments+k)*4,d=(k+1)/segments;
        tails[b]=attachment[0]+Math.sin(o.heading)*len*scale*d/aspect;
        tails[b+1]=attachment[1]-Math.cos(o.heading)*len*scale*d;
        tails[b+2]=tails[b+3]=0;
      }
    }
  }
  function updateSchool(dt){
    for(let i=0;i<amount;i++){
      const o=organisms[i];
      const flowX=noise3(o.x*1.3+11,o.y*1.3,time*.035)*.013;
      const flowY=noise3(o.x*1.3-8,o.y*1.3+5,time*.035+17)*.016;
      if(dt){
        o.change-=dt;
        if(o.change<=0){o.intention=Math.max(-1.18,Math.min(1.18,o.intention+(random()-.5)*1.35));o.change=4+random()*7;o.depthGoal=.36+random()*.85;o.activity=.35+random()*.7;}
        o.phase+=dt*o.rhythm;
        const contraction=Math.pow(Math.max(0,Math.sin(o.phase)),2);
        let desired=o.intention+flowX*8;
        desired+=Math.max(0,o.x-.58)*1.9-Math.max(0,-o.x-.58)*1.9;
        for(let j=0;j<amount;j++) if(i!==j){
          const other=organisms[j],dx=o.x-other.x,dy=o.y-other.y,dist=Math.hypot(dx*aspect,dy);
          if(dist>.001 && dist<.25) desired-=Math.sign(dx)*(.25-dist)*.7;
        }
        const near=Math.exp(-Math.hypot((o.x-pointer[0])*aspect,o.y-pointer[1])*5)*hover;
        desired-=(pointer[0]-o.x)*near*.18;
        desired=Math.max(-1.18,Math.min(1.18,desired));
        o.heading+=(desired-o.heading)*(1-Math.exp(-dt*.38));
        // The contraction gives thrust in the bell direction, not toward the
        // target; water velocity and soft boundaries produce passive drifting.
        const thrust=(.0018+.016*contraction)*o.activity;
        const ax=-Math.sin(o.heading)*thrust/aspect+(flowX-o.vx)*.25;
        const ay=Math.cos(o.heading)*thrust+(flowY-o.vy)*.25-Math.max(0,o.y-.60)*.045+Math.max(0,-o.y-.72)*.04;
        o.vx+=ax*dt; o.vy+=ay*dt;
        const max=.045, speed=Math.hypot(o.vx*aspect,o.vy);
        if(speed>max){o.vx*=max/speed;o.vy*=max/speed;}
        o.x+=o.vx*dt;o.y+=o.vy*dt;
        o.depth+=(o.depthGoal-o.depth)*(1-Math.exp(-dt*.12));
      }
      const scale=o.scale*o.depth*(desk?1.55:1),beat=Math.pow(Math.max(0,Math.sin(o.phase)),2);
      centers.set([o.x,o.y,scale,i*2.17],i*4);
      angles[i]=o.heading;beats[i]=beat;
      opacity[i]=Math.max(.20,Math.min(.86,.18+(o.depth-.25)*.75));waves[i]=time-o.pulse;
      if(!dt)continue;
      for(let j=0;j<strands;j++){
        const len=lengths[j],step=len*scale/segments,a=strandAngle(j),oral=j>=24;
        anchor(o,i,j,attachment);attachmentPoints[(i*strands+j)*2]=attachment[0];attachmentPoints[(i*strands+j)*2+1]=attachment[1];let px=attachment[0],py=attachment[1];
        for(let k=0;k<segments;k++){
          const b=((i*strands+j)*segments+k)*4,portion=(k+1)/segments;
          const splay=(oral?.12:.18)*Math.cos(a)*step*(1-portion*.6);
          const currentX=noise3(tails[b]*1.3+j*.13,tails[b+1]*1.3,time*.035+i)*.009;
          const currentY=noise3(tails[b]*1.3-3,tails[b+1]*1.3+j*.13,time*.035+13)*.009;
          const flex=noise3(j*.33,k*.31,time*.10+i*4)*step*(oral?.20:.12)*portion;
          const tx=px+(Math.sin(o.heading)*step+Math.cos(o.heading)*(splay+flex))/aspect;
          const ty=py-Math.cos(o.heading)*step+Math.sin(o.heading)*(splay+flex);
          const stiffness=20-k*.9,damping=Math.exp(-5.8*dt);
          tails[b+2]=(tails[b+2]+(tx-tails[b])*stiffness*dt+currentX*dt)*damping;
          tails[b+3]=(tails[b+3]+(ty-tails[b+1])*stiffness*dt+currentY*dt)*damping;
          tails[b]+=tails[b+2]*dt; tails[b+1]+=tails[b+3]*dt;px=tails[b];py=tails[b+1];
        }
      }
    }
    for(let i=amount;i<5;i++){centers.set([3,3,0,0],i*4);waves[i]=100;opacity[i]=0;angles[i]=0;beats[i]=0;}
    if(!lags)return;
    for(let i=0;i<count;i++){
      if(kinds[i]===0){lags[i*2]=lags[i*2+1]=0;continue;}
      const id=owners[i],strand=strandIds[i],d=distances[i],scaled=d*segments;
      const k=Math.min(segments-1,Math.floor(scaled)),mix=scaled-k,base=((id*strands+strand)*segments+k)*4;
      if(k){lags[i*2]=tails[base-4]+(tails[base]-tails[base-4])*mix;lags[i*2+1]=tails[base-3]+(tails[base+1]-tails[base-3])*mix;}
      else {const a=(id*strands+strand)*2,ax=attachmentPoints[a],ay=attachmentPoints[a+1];lags[i*2]=ax+(tails[base]-ax)*mix;lags[i*2+1]=ay+(tails[base+1]-ay)*mix;}
    }
  }
  let pointer = [0, 0], target = [0, 0], tilt = [0, 0], quality = 1, frames = [];
  const locations = {};
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error(error); }
    return s;
  }
  function init() {
    const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    ['uTime','uDpr','uHeight','uAspect','uHover','uPointer','uTilt','uAtlas','uJellies[0]','uWaves[0]','uOpacity[0]','uAngles[0]','uBeats[0]','uDim'].forEach(n => locations[n] = gl.getUniformLocation(program,n));
    // Seeded random positions keep glyphs stable across frames.
    let seed = 5831; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const small = matchMedia('(max-width: 850px)').matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    count = desk ? 3000 : small ? 5000 : 8000; const data = new Float32Array(count * 7);
    lags=new Float32Array(count*2); owners=new Uint8Array(count); strandIds=new Uint8Array(count); distances=new Float32Array(count); kinds=new Uint8Array(count);
    for (let i=0;i<count;i++) {
      const q=random(), kind=q<.57?0:q<.84?1:2;
      // Tentacles are grouped into strands, with slight variation in each glyph's position.
      const strand=Math.floor(random()*(kind===1?24:8));
      const angle=kind===0?random()*Math.PI*2:strand/(kind===1?24:8)*Math.PI*2;
      const d=kind===0?(random()<.30 ? 1-.16*random()*random() : Math.acos(1-random())/(Math.PI/2)):random();
      const j=i*7; data[j]=angle; data[j+1]=d; data[j+2]=kind; data[j+3]=random(); data[j+4]=Math.floor(random()*16); data[j+5]=.48+random()*.38; data[j+6]=i%amount; owners[i]=i%amount; strandIds[i]=strand+(kind===2?24:0); distances[i]=d; kinds[i]=kind;
    }
    buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    const shape=gl.getAttribLocation(program,'aShape'), glyph=gl.getAttribLocation(program,'aGlyph');
    gl.enableVertexAttribArray(shape); gl.vertexAttribPointer(shape,4,gl.FLOAT,false,28,0);
    gl.enableVertexAttribArray(glyph); gl.vertexAttribPointer(glyph,3,gl.FLOAT,false,28,16);
    lagBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,lagBuffer);gl.bufferData(gl.ARRAY_BUFFER,lags,gl.DYNAMIC_DRAW);
    const lag=gl.getAttribLocation(program,'aLag');gl.enableVertexAttribArray(lag);gl.vertexAttribPointer(lag,2,gl.FLOAT,false,0,0);
    const atlas=document.createElement('canvas'); atlas.width=512; atlas.height=32;
    const ctx=atlas.getContext('2d'); ctx.clearRect(0,0,512,32); ctx.fillStyle='#fff'; ctx.font='26px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    '011{}<>/=;ABCDEF'.split('').forEach((c,i)=>ctx.fillText(c,i*32+16,17));
    texture=gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(locations.uAtlas,0); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE); gl.clearColor(0,0,0,0);
    alive=true; resize(); resetTails(); updateSchool(0); draw();
  }
  function resize() {
    if (!alive) return;
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,1.6)*quality;
    canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
    gl.viewport(0,0,canvas.width,canvas.height); gl.uniform1f(locations.uDpr,dpr); gl.uniform1f(locations.uHeight,canvas.height);
    aspect=rect.width/rect.height; gl.uniform1f(locations.uAspect,aspect);
    if (motion.matches) { resetTails(); updateSchool(0); draw(); }
  }
  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(locations.uTime,time); gl.uniform4fv(locations['uJellies[0]'],centers); gl.uniform1fv(locations['uWaves[0]'],waves); gl.uniform1fv(locations['uOpacity[0]'],opacity); gl.uniform1fv(locations['uAngles[0]'],angles); gl.uniform1fv(locations['uBeats[0]'],beats); gl.uniform1f(locations.uDim,desk?.45:1);
    gl.uniform1f(locations.uHover,hover); gl.uniform2fv(locations.uPointer,pointer); gl.uniform2fv(locations.uTilt,tilt);
    gl.bindBuffer(gl.ARRAY_BUFFER,lagBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,lags);
    gl.drawArrays(gl.POINTS,0,count);
    canvas.classList.add('is-live');
    if(mirrorContext && mirror.clientWidth && mirror.clientHeight){
      const w=mirror.clientWidth,h=mirror.clientHeight,dpr=Math.min(devicePixelRatio||1,1.5)*quality;
      if(mirror.width!==Math.round(w*dpr)||mirror.height!==Math.round(h*dpr)){mirror.width=Math.round(w*dpr);mirror.height=Math.round(h*dpr);}
      const crop=Math.min(canvas.width,canvas.height*w/h);
      mirrorContext.clearRect(0,0,mirror.width,mirror.height);
      mirrorContext.drawImage(canvas,(canvas.width-crop)/2,0,crop,canvas.height,0,0,mirror.width,mirror.height);
      mirror.classList.add('is-live');
    }
  }
  function frame(now) {
    if (!alive) return;
    const dt=Math.min((now-last)/1000,.05); last=now; time+=dt;
    tilt[0]+=(target[0]-tilt[0])*Math.min(1,dt*1.5); tilt[1]+=(target[1]-tilt[1])*Math.min(1,dt*1.5);
    hover+=(+(performance.now()-lastMove<1800)-hover)*Math.min(1,dt*2);
    updateSchool(dt); draw();
    if (dt<.2) frames.push(dt); if(frames.length===120){ if(frames.reduce((a,b)=>a+b,0)/frames.length>.025 && quality>.65){quality*=.8;resize();} frames=[]; }
    raf=requestAnimationFrame(frame);
  }
  function refresh() {
    cancelAnimationFrame(raf); raf=0;
    if (!alive || !visible || document.hidden || explorerActive || document.documentElement.dataset.theme === 'light') return;
    if (motion.matches) { draw(); return; }
    last=performance.now(); raf=requestAnimationFrame(frame);
  }
  let lastMove=-10000;
  function move(e){ if(e.pointerType==='touch') return; const r=canvas.getBoundingClientRect(); pointer=[(e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2]; target=[pointer[0],pointer[1]]; lastMove=performance.now(); }
  function leave(){target=[0,0];lastMove=-10000;}
  function click(e){ if(motion.matches || e.target.closest('a,button,input,select,textarea')) return; const r=canvas.getBoundingClientRect(), x=(e.clientX-r.left)/r.width*2-1, y=1-(e.clientY-r.top)/r.height*2; organisms.slice(0,amount).forEach(o=>{const distance=Math.hypot(o.x-x,o.y-y); if(distance<.45) o.pulse=time-(distance>.22?.18:0);}); }
  function lost(e){ e.preventDefault(); alive=false; cancelAnimationFrame(raf); canvas.classList.remove('is-live'); }
  function restored(){ try { init(); refresh(); } catch (_) { canvas.classList.remove('is-live'); } }
  function cleanup(){ alive=false; cancelAnimationFrame(raf); observer?.disconnect(); resizeObserver?.disconnect(); themeObserver?.disconnect(); removalObserver?.disconnect(); gl.deleteBuffer(buffer); gl.deleteBuffer(lagBuffer); gl.deleteTexture(texture); gl.deleteProgram(program); }
  try {
    init(); hero.addEventListener('pointermove',move); hero.addEventListener('pointerleave',leave); hero.addEventListener('click',click);
    document.addEventListener('visibilitychange',refresh); motion.addEventListener('change',refresh);
    canvas.addEventListener('webglcontextlost',lost); canvas.addEventListener('webglcontextrestored',restored);
    window.addEventListener('pagehide', e => { if (e.persisted) { cancelAnimationFrame(raf); } else cleanup(); });
    window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
    if ('IntersectionObserver' in window) { observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;refresh();}); observer.observe(desk ? document.querySelector('main') : canvas); }
    if ('ResizeObserver' in window) { resizeObserver=new ResizeObserver(resize); resizeObserver.observe(canvas); } else window.addEventListener('resize',resize);
    themeObserver=new MutationObserver(refresh); themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if (desk) {
      const stage=document.querySelector('.scene-wrap');
      if(stage){
        pointerInExplorer=stage.matches(':hover'); focusInExplorer=stage.contains(document.activeElement);
        explorerActive=pointerInExplorer || focusInExplorer;
        const updateExplorer=()=>{explorerActive=pointerInExplorer || focusInExplorer;refresh();};
        stage.addEventListener('pointerenter',()=>{pointerInExplorer=true;updateExplorer();});
        stage.addEventListener('pointerleave',()=>{pointerInExplorer=false;updateExplorer();});
        stage.addEventListener('focusin',()=>{focusInExplorer=true;updateExplorer();});
        stage.addEventListener('focusout',e=>{focusInExplorer=stage.contains(e.relatedTarget);updateExplorer();});
      }
      removalObserver=new MutationObserver(()=>{if(!canvas.isConnected) cleanup();}); removalObserver.observe(document.body,{childList:true,subtree:true});
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
    refresh();
  } catch (_) { cleanup(); canvas.style.display = 'none'; }
})();
