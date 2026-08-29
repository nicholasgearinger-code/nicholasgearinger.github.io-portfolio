// Fluid V5 M5.6.2 rain ripple + waterfall sheet refinement.
// Rain keeps millimeter-scale visuals decoupled from conserved PBF mass, then adds analytical
// capillary/gravity ring packets on the reconstructed SSFR surface. Waterfall is a short,
// accelerating wall-fed sheet that narrows, corrugates, breaks into strands and throws mist.
// Scenario takeover is installed before any optional GPU pipeline is compiled so a Safari shader
// rejection can never silently restore the old centimeter-scale airborne particle sources.

const sim=window.__sim;
const ssfr=window.__ssfr;
const ui=window.__ui;
const state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.6.2 weather: runtime unavailable.');
const dev=sim.dev;
const format=ssfr.format;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const params=new URLSearchParams(location.search);
const quality=['low','medium','high'].includes(params.get('quality'))?params.get('quality'):'medium';
const RAIN_CAP=quality==='low'?1200:quality==='high'?4200:2600;
const RIPPLE_SLOTS=quality==='low'?12:quality==='high'?28:20;
const FALL_ROWS=24;
const FALL_COLS=14;
const FALL_VERTS=FALL_ROWS*FALL_COLS*6;
const FALL_LAYERS=3;
const FALL_MIST_CAP=quality==='low'?160:quality==='high'?520:320;
if(!Number.isFinite(Number(state.rainIntensity)))state.rainIntensity=1.15;
if(!Number.isFinite(Number(state.rainRipple)))state.rainRipple=1.0;
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
state.rainIntensity=clamp(Number(state.rainIntensity),.35,1.8);
state.rainRipple=clamp(Number(state.rainRipple),.25,1.8);
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

let seed=0x7261696e;
let physAdded=0;
let lastRainMass=0;
let lastFallMass=0;
let lastFallRipple=0;
let fallCursor=0;
let start=performance.now();
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const room=()=>Math.max(0,Math.min(5200,(sim.cap||sim.n)-sim.n-48));
const fallGeom=()=>{const b=sim.params.box,d=sim.params.spacing;return{startX:b[0]*.055,impactX:b[0]*.255,centreZ:b[2]*.40,halfTop:b[2]*.155,halfBottom:b[2]*.115,topY:waterTop()+Math.min(b[1]*.275,.69),bottomY:waterTop()+d*.06};};
function resetScene(){document.getElementById('reset')?.click();physAdded=0;fallCursor=0;start=performance.now();clearRipples();}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(name){state.scenario=name;ui.pouring=false;stopWave();save();resetScene();syncButtons();}

// Install scenario takeover first.
function captureScenario(button,name,mark){if(!button||button.dataset[mark]==='1')return;button.dataset[mark]='1';button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose(name);},{capture:true});}
function bindButtons(){captureScenario(document.querySelector('[data-scenario="rain"]'),'rainstorm','m562');captureScenario(document.querySelector('[data-m46="waterfall"]'),'waterfall-m562','m562');}
function syncButtons(){bindButtons();document.querySelectorAll('[data-scenario]').forEach(b=>{const active=(state.scenario==='rainstorm'&&b.dataset.scenario==='rain')||b.dataset.scenario===state.scenario;b.classList.toggle('active',active);});document.querySelectorAll('[data-m46]').forEach(b=>{const active=(state.scenario==='waterfall-m562'&&b.dataset.m46==='waterfall')||b.dataset.m46===state.scenario;b.classList.toggle('active',active);});}
bindButtons();setInterval(bindButtons,500);
window.__v5WeatherM56={online:true,controls:true,rainVisual:false,rippleVisual:false,waterfallVisual:false,waterfallMist:false,backend:'weather-control-m562',rainCount:RAIN_CAP,rippleSlots:RIPPLE_SLOTS,physicalAdded:0,error:''};

// Impact ring buffer: x, z, birth seconds, amplitude.
const rippleEvents=new Float32Array(RIPPLE_SLOTS*4);for(let i=0;i<RIPPLE_SLOTS;i++)rippleEvents[i*4+2]=-99;let rippleHead=0;
function clearRipples(){rippleEvents.fill(0);for(let i=0;i<RIPPLE_SLOTS;i++)rippleEvents[i*4+2]=-99;rippleHead=0;}
function pushRipple(x,z,amp,nowMs){const o=(rippleHead++%RIPPLE_SLOTS)*4;rippleEvents[o]=x;rippleEvents[o+1]=z;rippleEvents[o+2]=nowMs*.001;rippleEvents[o+3]=amp;}

// Conserved PBF mass is inserted essentially on the free surface so it cannot read as giant rain.
function rainMass(now){if(state.scenario!=='rainstorm'||ui.paused||document.hidden||room()<=0)return;const cadence=quality==='low'?76:quality==='high'?38:50;if(now-lastRainMass<cadence)return;lastRainMass=now;const b=sim.params.box,d=sim.params.spacing,base=quality==='low'?1:quality==='high'?3:2,n=Math.max(1,Math.round(base*state.rainIntensity)),p=[],v=[];let rx=0,rz=0;for(let i=0;i<n;i++){const x=d*1.6+rnd()*(b[0]-d*3.2),z=d*1.6+rnd()*(b[2]-d*3.2),y=waterTop()+d*(.18+rnd()*.12);if(i===0){rx=x;rz=z;}p.push(x,y,z);v.push((rnd()-.5)*.10,-(2.4+rnd()*.8),(rnd()-.5)*.08);}const take=Math.min(room(),n),a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));physAdded+=a;if(a>0)pushRipple(rx,rz,(.62+rnd()*.30)*state.rainRipple,now);window.__v5WeatherM56.physicalAdded=physAdded;}
function waterfallMass(now){if(state.scenario!=='waterfall-m562'||ui.paused||document.hidden||room()<=0)return;const cadence=quality==='low'?52:quality==='high'?24:32;if(now-lastFallMass<cadence)return;lastFallMass=now;const d=sim.params.spacing,g=fallGeom(),base=quality==='low'?2:quality==='high'?6:4,n=Math.max(2,Math.round(base*state.waterfallFlow)),p=[],v=[],lanes=18;for(let i=0;i<n;i++){const lane=(fallCursor++)%lanes,u=(lane+.5)/lanes,z=g.centreZ+(u-.5)*g.halfBottom*2+(rnd()-.5)*d*.22,x=g.impactX+(rnd()-.5)*d*.20,y=waterTop()+d*(.04+rnd()*.08);p.push(x,y,z);v.push(.32+(rnd()-.5)*.08,-(1.35+rnd()*.42),(rnd()-.5)*.10);}const take=Math.min(room(),n),a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));physAdded+=a;if(a>0&&now-lastFallRipple>150){lastFallRipple=now;pushRipple(g.impactX,g.centreZ+(rnd()-.5)*g.halfBottom*.75,(1.10+rnd()*.35)*state.waterfallFlow,now);}window.__v5WeatherM56.physicalAdded=physAdded;}
function sourceLoop(now){rainMass(now);waterfallMass(now);requestAnimationFrame(sourceLoop);}requestAnimationFrame(sourceLoop);
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function currentDepthSlot(){const iterations=Math.max(ssfr.filterIterations||0,0);let src=(iterations*2)&1;if(ssfr.cleanupPass&&iterations>0)src=1-src;return src;}

// Micro-rain visual.
let rainPipe=null,rainBG=null,rainUni=null,RF=null;
try{
 rainUni=dev.createBuffer({label:'fluidV5M562RainUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});RF=new Float32Array(32);
 const rainWGSL=`
struct R { vp:mat4x4f, box:vec4f, water:vec4f, screen:vec4f, style:vec4f }
@group(0) @binding(0) var<uniform> U:R;
struct V { @builtin(position) p:vec4f, @location(0) q:vec2f, @location(1) bright:f32 }
fn hash1(x0:u32)->f32 { var x=x0; x^=x>>16u; x*=0x7feb352du; x^=x>>15u; x*=0x846ca68bu; x^=x>>16u; return f32(x)/4294967295.0; }
fn corner(i:u32)->vec2f { let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1)); return a[i]; }
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V { var o:V; let h0=hash1(ii*9781u+17u); let h1=hash1(ii*6271u+91u); let h2=hash1(ii*3917u+211u); let h3=hash1(ii*1543u+617u); let top=U.box.y*.985; let bot=U.water.x+U.style.x; let travel=max(top-bot,.1); let speed=mix(5.8,9.8,h2)*U.water.y; let phase=fract(h3+U.box.w*speed/travel); let gust=.65+.35*sin(U.box.w*.73+h1*6.2831); let wind=vec3f(U.water.z*gust,-1.0,U.water.w*gust); let dir=normalize(wind); var wp=vec3f(U.style.y+h0*(U.box.x-2.0*U.style.y),top-phase*travel,U.style.y+h1*(U.box.z-2.0*U.style.y)); wp.x+=U.water.z*phase*.25; wp.z+=U.water.w*phase*.25; let streak=mix(.008,.030,h2)*(0.82+U.water.y*.16); let pa=U.vp*vec4f(wp-dir*streak*.5,1.0); let pb=U.vp*vec4f(wp+dir*streak*.5,1.0); let pc=U.vp*vec4f(wp,1.0); if(pc.w<=1e-4){o.p=vec4f(2);o.q=vec2f(2);o.bright=0;return o;} let an=pa.xy/max(pa.w,1e-4); let bn=pb.xy/max(pb.w,1e-4); let cn=pc.xy/pc.w; var along=bn-an; let al=length(along); if(al>1e-6){along=along/al;}else{along=vec2f(0,-1);} let side=vec2f(-along.y,along.x); let q=corner(vi); let halfLen=max(al*.5,1.0/max(U.screen.y,1.0)); let halfW=mix(.24,.50,h0)*2.0/max(U.screen.x,1.0); let ndc=cn+along*q.y*halfLen+side*q.x*halfW; o.p=vec4f(ndc*pc.w,pc.z,pc.w); o.q=q; o.bright=mix(.56,1.0,h1); return o; }
@fragment fn fs(v:V)->@location(0) vec4f { let sideFade=1.0-smoothstep(.08,1.0,abs(v.q.x)); let tipFade=1.0-smoothstep(.50,1.0,abs(v.q.y)); let alpha=sideFade*tipFade*.24; let col=mix(vec3f(.58,.78,.91),vec3f(.97,1.0,1.0),v.bright); return vec4f(col,alpha); }`;
 const mod=dev.createShaderModule({code:rainWGSL,label:'fluidV5M562RainWGSL'});rainPipe=await dev.createRenderPipelineAsync({label:'fluidV5M562Rain',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});rainBG=dev.createBindGroup({layout:rainPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rainUni}}]});window.__v5WeatherM56.rainVisual=true;
}catch(err){window.__v5WeatherM56.rainError=String(err?.message||err);console.error('[Fluid V5 M5.6.2] micro-rain visual rejected.',err);}

// Propagating ring-wave pass on the reconstructed SSFR surface.
let ripplePipe=null,rippleUni=null,RPF=null,rippleBind=null,rippleBindKey='';
try{
 rippleUni=dev.createBuffer({label:'fluidV5M562RippleUniform',size:(1+RIPPLE_SLOTS)*16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});RPF=new Float32Array((1+RIPPLE_SLOTS)*4);
 const rippleWGSL=`
struct Comp { invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f, boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32, absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32, roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32, bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32, envIntensity:f32, envYaw:f32, mapScale:vec2f }
struct Ripples { meta:vec4f, events:array<vec4f,${RIPPLE_SLOTS}> }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<uniform> U:Ripples;
@group(0) @binding(2) var depthTex:texture_2d<f32>;
struct V { @builtin(position) p:vec4f, @location(0) ndc:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V { let q=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0; var o:V; o.p=vec4f(q,0,1); o.ndc=q; return o; }
fn empty(z:f32)->bool{return z < -1e3;}
fn viewPos(ndc:vec2f,z:f32)->vec3f{return vec3f(-ndc.x*z/C.proj00,-ndc.y*z/C.proj11,z);}
@fragment fn fs(v:V)->@location(0) vec4f { let dim=vec2i(textureDimensions(depthTex,0)); let uv=vec2f(v.ndc.x*.5+.5,.5-v.ndc.y*.5); let fp=clamp(uv*vec2f(dim),vec2f(1),vec2f(dim)-vec2f(2)); let p=vec2i(fp); let z=textureLoad(depthTex,p,0).r; if(empty(z)){discard;} let zx0=textureLoad(depthTex,p+vec2i(-1,0),0).r; let zx1=textureLoad(depthTex,p+vec2i(1,0),0).r; let zy0=textureLoad(depthTex,p+vec2i(0,-1),0).r; let zy1=textureLoad(depthTex,p+vec2i(0,1),0).r; let pc=viewPos(v.ndc,z); let pw=(C.invView*vec4f(pc,1)).xyz; var nw=vec3f(0,1,0); if(!empty(zx0)&&!empty(zx1)&&!empty(zy0)&&!empty(zy1)){ let ddx=vec2f(2.0/f32(dim.x),0); let ddy=vec2f(0,-2.0/f32(dim.y)); let vx=viewPos(v.ndc+ddx,zx1)-viewPos(v.ndc-ddx,zx0); let vy=viewPos(v.ndc+ddy,zy1)-viewPos(v.ndc-ddy,zy0); var nv=normalize(cross(vx,vy)); if(nv.z<0){nv=-nv;} nw=normalize((C.invView*vec4f(nv,0)).xyz); } var wave=0.0; var grad=vec2f(0); for(var i:u32=0u;i<${RIPPLE_SLOTS}u;i=i+1u){ let e=U.events[i]; let age=U.meta.x-e.z; if(e.w>.001&&age>0.0&&age<1.35){ let d=vec2f(pw.x-e.x,pw.z-e.y); let r=max(length(d),1e-4); let dir=d/r; let speed=.30+.045*clamp(e.w,0.0,1.8); let front=speed*age; let delta=r-front; let sigma=.026+age*.014; let invSig=1.0/max(sigma*sigma,1e-5); let env=exp(-.5*delta*delta*invSig)*exp(-age*1.28); let phase=delta*74.0; let s=sin(phase); let c=cos(phase); wave+=e.w*env*s; let deriv=e.w*env*(74.0*c-delta*invSig*s); grad+=dir*deriv; } } grad=clamp(grad,vec2f(-20),vec2f(20)); let strength=U.meta.w; let perturbed=normalize(nw-vec3f(grad.x,0,grad.y)*(.015*strength)); let vd=normalize(pw-C.eye.xyz); let hdir=normalize(C.sunDir-vd); let glint=pow(max(dot(perturbed,hdir),0.0),82.0)*clamp(C.sunIntensity*.17,0.0,1.4); let energy=clamp(length(grad)*.010*strength+abs(wave)*.18*strength,0.0,.30); if(energy<.003&&glint<.003){discard;} let crest=smoothstep(-.12,.14,wave); var col=mix(vec3f(.035,.115,.17),vec3f(.80,.965,1.0),crest); col+=vec3f(.72,.90,1.0)*glint*.72; let alpha=clamp(energy+glint*.10,0.0,.30); return vec4f(col,alpha); }`;
 const mod=dev.createShaderModule({code:rippleWGSL,label:'fluidV5M562RippleWGSL'});ripplePipe=await dev.createRenderPipelineAsync({label:'fluidV5M562Ripple',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});window.__v5WeatherM56.rippleVisual=true;
}catch(err){window.__v5WeatherM56.rippleError=String(err?.message||err);console.error('[Fluid V5 M5.6.2] propagating ripple pass rejected.',err);}

// Coherent, accelerating waterfall sheet.
let fallPipe=null,fallBG=null,fallUni=null,FF=null;
try{
 fallUni=dev.createBuffer({label:'fluidV5M562FallUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});FF=new Float32Array(32);
 const fallWGSL=`
struct F { vp:mat4x4f, box:vec4f, water:vec4f, style:vec4f, geom:vec4f }
@group(0) @binding(0) var<uniform> U:F;
struct V { @builtin(position) p:vec4f, @location(0) uv:vec2f, @location(1) layer:f32 }
fn corner(i:u32)->vec2f { let a=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1)); return a[i]; }
@vertex fn vs(@builtin(vertex_index) i:u32,@builtin(instance_index) inst:u32)->V { var o:V; let tri=i/6u; let cx=tri%${FALL_COLS}u; let cy=tri/${FALL_COLS}u; let q=corner(i%6u); let u=(f32(cx)+q.x)/f32(${FALL_COLS}); let t=(f32(cy)+q.y)/f32(${FALL_ROWS}); let layer=f32(inst)-1.0; let fall=t*t; let halfW=mix(U.geom.x,U.geom.y,t); let corr=sin(u*18.0+U.box.w*3.7+t*11.0)*sin(u*7.0-U.box.w*2.1+t*5.0); let edgeFlutter=U.style.x*(.12+.88*t)*corr; let z=U.style.w+(u-.5)*halfW*2.0+edgeFlutter+layer*U.style.x*.16; let x=U.style.y+(U.style.z-U.style.y)*t+sin(t*10.0+u*9.0+U.box.w*4.1)*U.style.x*.30*t+layer*U.style.x*.20; let y=mix(U.water.z,U.water.x,fall)+layer*U.style.x*.05; o.p=U.vp*vec4f(x,y,z,1.0); o.uv=vec2f(u,t); o.layer=layer; return o; }
@fragment fn fs(v:V)->@location(0) vec4f { let n1=.5+.5*sin(v.uv.x*61.0+v.uv.y*27.0+U.box.w*8.0); let n2=.5+.5*sin(v.uv.x*23.0-v.uv.y*49.0-U.box.w*5.3); let grain=n1*n2; let breakup=smoothstep(.62,.98,v.uv.y); let threshold=mix(-.10,.40,breakup); if(grain<threshold){discard;} let edge=smoothstep(0.0,.045,v.uv.x)*smoothstep(0.0,.045,1.0-v.uv.x); let ridge=pow(.5+.5*sin(v.uv.x*92.0+v.uv.y*18.0+U.box.w*7.0),6.0); let stretch=mix(1.0,.68,v.uv.y); let layerFade=1.0-abs(v.layer)*.20; let alpha=edge*(.105+ridge*.085)*stretch*layerFade*U.water.y; let aeration=smoothstep(.68,1.0,v.uv.y); let col=mix(vec3f(.35,.68,.82),vec3f(.90,.985,1.0),.30+ridge*.28+aeration*.28); return vec4f(col,alpha); }`;
 const mod=dev.createShaderModule({code:fallWGSL,label:'fluidV5M562FallWGSL'});fallPipe=await dev.createRenderPipelineAsync({label:'fluidV5M562Waterfall',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});fallBG=dev.createBindGroup({layout:fallPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:fallUni}}]});window.__v5WeatherM56.waterfallVisual=true;
}catch(err){window.__v5WeatherM56.waterfallError=String(err?.message||err);console.error('[Fluid V5 M5.6.2] waterfall sheet rejected.',err);}

// Independent waterfall mist/splash, intentionally using the same conservative billboard pattern as rain.
let mistPipe=null,mistBG=null,mistUni=null,MF=null;
try{
 mistUni=dev.createBuffer({label:'fluidV5M562MistUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});MF=new Float32Array(32);
 const mistWGSL=`
struct M { vp:mat4x4f, box:vec4f, water:vec4f, screen:vec4f, style:vec4f }
@group(0) @binding(0) var<uniform> U:M;
struct V { @builtin(position) p:vec4f, @location(0) q:vec2f, @location(1) a:f32 }
fn hash1(x0:u32)->f32 { var x=x0; x^=x>>16u; x*=0x7feb352du; x^=x>>15u; x*=0x846ca68bu; x^=x>>16u; return f32(x)/4294967295.0; }
fn corner(i:u32)->vec2f { let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1)); return a[i]; }
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V { var o:V; let h0=hash1(ii*92821u+13u); let h1=hash1(ii*68917u+71u); let h2=hash1(ii*41761u+233u); let h3=hash1(ii*19391u+911u); let cycle=mix(.62,1.08,h2); let age=fract(h3+U.box.w/cycle)*cycle; let vz=(h0-.5)*U.style.w*.95; let vx=.10+h1*.34; let vy=.48+h2*1.05; var wp=vec3f(U.style.y,U.water.x+U.style.x*.10,U.style.z); wp+=vec3f(vx,vy,vz)*age; wp.y-=4.905*age*age; if(wp.y<U.water.x-U.style.x*.10){o.p=vec4f(2);o.q=vec2f(2);o.a=0;return o;} let c=U.vp*vec4f(wp,1.0); if(c.w<=1e-4){o.p=vec4f(2);o.q=vec2f(2);o.a=0;return o;} let q=corner(vi); let px=mix(1.2,2.7,h1)*U.water.y; let ndc=q*vec2f(px*2.0/max(U.screen.x,1.0),px*2.0/max(U.screen.y,1.0)); c.xy+=ndc*c.w; o.p=c; o.q=q; o.a=(1.0-age/cycle)*mix(.28,.72,h0); return o; }
@fragment fn fs(v:V)->@location(0) vec4f { let r=length(v.q); if(r>1.0){discard;} let a=(1.0-smoothstep(.38,1.0,r))*v.a*.42; return vec4f(vec3f(.80,.95,1.0),a); }`;
 const mod=dev.createShaderModule({code:mistWGSL,label:'fluidV5M562MistWGSL'});mistPipe=await dev.createRenderPipelineAsync({label:'fluidV5M562Mist',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});mistBG=dev.createBindGroup({layout:mistPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:mistUni}}]});window.__v5WeatherM56.waterfallMist=true;
}catch(err){window.__v5WeatherM56.mistError=String(err?.message||err);console.error('[Fluid V5 M5.6.2] waterfall mist rejected.',err);}

if(rainPipe||ripplePipe||fallPipe||mistPipe){const baseRender=ssfr.render;ssfr.render=function(...args){const out=baseRender.apply(this,args),enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;if(!enc||!target||!view||!proj)return out;const vp=matMul(proj,view),b=sim.params.box,now=performance.now()*.001,pressure=window.__v5Workload?.pressure||0;if(state.scenario==='rainstorm'&&rainPipe){RF.fill(0);RF.set(vp,0);RF[16]=b[0];RF[17]=b[1];RF[18]=b[2];RF[19]=now;RF[20]=waterTop();RF[21]=state.rainIntensity;RF[22]=.040;RF[23]=.010;RF[24]=w;RF[25]=h;RF[28]=sim.params.spacing*.12;RF[29]=sim.params.spacing*1.06;dev.queue.writeBuffer(rainUni,0,RF);const n=Math.max(360,Math.floor(RAIN_CAP*state.rainIntensity*(1-pressure*.58))),pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(rainPipe);pass.setBindGroup(0,rainBG);pass.draw(6,n);pass.end();}
if(ripplePipe&&(state.scenario==='rainstorm'||state.scenario==='waterfall-m562')&&ssfr.views?.eyeZ){RPF.fill(0);RPF[0]=now;RPF[1]=waterTop();RPF[2]=state.scenario==='rainstorm'?1.0:1.25;RPF[3]=state.rainRipple;RPF.set(rippleEvents,4);dev.queue.writeBuffer(rippleUni,0,RPF);const slot=currentDepthSlot(),depthView=ssfr.views.eyeZ[slot],key=`${ssfr.gen||0}|${slot}`;if(!rippleBind||rippleBindKey!==key){rippleBindKey=key;rippleBind=dev.createBindGroup({layout:ripplePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:{buffer:rippleUni}},{binding:2,resource:depthView}]});}const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(ripplePipe);pass.setBindGroup(0,rippleBind);pass.draw(3);pass.end();}
if(state.scenario==='waterfall-m562'){const g=fallGeom();if(fallPipe){FF.fill(0);FF.set(vp,0);FF[16]=b[0];FF[17]=b[1];FF[18]=b[2];FF[19]=now;FF[20]=g.bottomY;FF[21]=state.waterfallFlow*(1-pressure*.16);FF[22]=g.topY;FF[23]=0;FF[24]=sim.params.spacing;FF[25]=g.startX;FF[26]=g.impactX;FF[27]=g.centreZ;FF[28]=g.halfTop;FF[29]=g.halfBottom;dev.queue.writeBuffer(fallUni,0,FF);const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(fallPipe);pass.setBindGroup(0,fallBG);pass.draw(FALL_VERTS,FALL_LAYERS);pass.end();}if(mistPipe){MF.fill(0);MF.set(vp,0);MF[16]=b[0];MF[17]=b[1];MF[18]=b[2];MF[19]=now;MF[20]=waterTop();MF[21]=state.waterfallFlow*(1-pressure*.25);MF[24]=w;MF[25]=h;MF[28]=sim.params.spacing;MF[29]=g.impactX;MF[30]=g.centreZ;MF[31]=g.halfBottom;dev.queue.writeBuffer(mistUni,0,MF);const n=Math.max(80,Math.floor(FALL_MIST_CAP*state.waterfallFlow*(1-pressure*.52))),pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(mistPipe);pass.setBindGroup(0,mistBG);pass.draw(6,n);pass.end();}}return out;};}

function mountControls(){const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WeatherM562'))return;const box=document.createElement('div');box.id='v5WeatherM562';box.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';box.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">RAIN + WATERFALL · M5.6.2</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Rain impacts launch expanding capillary/gravity ring packets across the reconstructed water. Waterfall starts from a short wall-fed lip, accelerates, narrows, breaks into strands and throws mist at impact.</div><div class="v5Slider"><label>RAIN RATE</label><input id="v5RainM562" type="range" min=".35" max="1.8" step=".05"><div class="v5Val" id="v5RainM562V"></div></div><div class="v5Slider"><label>RIPPLE</label><input id="v5RippleM562" type="range" min=".25" max="1.8" step=".05"><div class="v5Val" id="v5RippleM562V"></div></div><div class="v5Slider"><label>FALL FLOW</label><input id="v5FallM562" type="range" min=".45" max="1.55" step=".05"><div class="v5Val" id="v5FallM562V"></div></div><div id="v5WeatherM562Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;host.appendChild(box);const rr=box.querySelector('#v5RainM562'),rv=box.querySelector('#v5RainM562V'),rp=box.querySelector('#v5RippleM562'),rpv=box.querySelector('#v5RippleM562V'),fr=box.querySelector('#v5FallM562'),fv=box.querySelector('#v5FallM562V');rr.value=state.rainIntensity;rp.value=state.rainRipple;fr.value=state.waterfallFlow;const sync=()=>{rv.textContent=Number(state.rainIntensity).toFixed(2);rpv.textContent=Number(state.rainRipple).toFixed(2);fv.textContent=Number(state.waterfallFlow).toFixed(2);};rr.oninput=e=>{e.stopPropagation();state.rainIntensity=Number(rr.value);save();sync();};rp.oninput=e=>{e.stopPropagation();state.rainRipple=Number(rp.value);save();sync();};fr.oninput=e=>{e.stopPropagation();state.waterfallFlow=Number(fr.value);save();sync();};box.onpointerdown=e=>e.stopPropagation();sync();}
function statusTick(){syncButtons();mountControls();const s=document.getElementById('v5WeatherM562Status'),W=window.__v5WeatherM56;if(s)s.textContent=`CTRL ON · RAIN ${W.rainVisual?'ON':'fallback'} · RIPPLE ${W.rippleVisual?'ON':'fallback'} · FALL ${W.waterfallVisual?'ON':'fallback'} · MIST ${W.waterfallMist?'ON':'fallback'} · PBF +${physAdded.toLocaleString()}`;}
setInterval(statusTick,450);statusTick();window.__v5WeatherM56.backend='rain-ripple-sheet-m562';console.info('[Fluid V5 M5.6.2] propagating rain ripples + coherent waterfall sheet/mist enabled.');