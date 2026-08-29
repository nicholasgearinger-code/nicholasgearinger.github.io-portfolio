// Fluid V5 M5.6.1 rain + waterfall hotfix.
// IMPORTANT: scenario takeover and conserved PBF impact sources install BEFORE any optional GPU
// visual pipeline is compiled. If Safari rejects a weather shader, the old centimeter-scale
// airborne PBF rain/waterfall can no longer silently return.

const sim=window.__sim;
const ssfr=window.__ssfr;
const ui=window.__ui;
const state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.6.1 weather: runtime unavailable.');
const dev=sim.dev;
const format=ssfr.format;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const params=new URLSearchParams(location.search);
const quality=['low','medium','high'].includes(params.get('quality'))?params.get('quality'):'medium';
const RAIN_CAP=quality==='low'?1200:quality==='high'?4200:2600;
const FALL_ROWS=20;
const FALL_COLS=12;
const FALL_VERTS=FALL_ROWS*FALL_COLS*6;
if(!Number.isFinite(Number(state.rainIntensity)))state.rainIntensity=1.15;
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
state.rainIntensity=clamp(Number(state.rainIntensity),.35,1.8);
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};

let seed=0x7261696e;
let physAdded=0;
let lastRainMass=0;
let lastFallMass=0;
let fallCursor=0;
let start=performance.now();
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const room=()=>Math.max(0,Math.min(5200,(sim.cap||sim.n)-sim.n-48));
function resetScene(){document.getElementById('reset')?.click();physAdded=0;fallCursor=0;start=performance.now();}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(name){state.scenario=name;ui.pouring=false;stopWave();save();resetScene();syncButtons();}

// ----- Install scenario takeover FIRST -------------------------------------------------------
// Capture-phase listeners stop the older onclick handlers before they can select `rain` or
// `waterfall`. Rebinding is harmless and also survives late tab/UI reconstruction.
function captureScenario(button,name,mark){
 if(!button||button.dataset[mark]==='1')return;
 button.dataset[mark]='1';
 button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose(name);},{capture:true});
}
function bindButtons(){
 captureScenario(document.querySelector('[data-scenario="rain"]'),'rainstorm','m561');
 captureScenario(document.querySelector('[data-m46="waterfall"]'),'waterfall-m561','m561');
}
function syncButtons(){
 bindButtons();
 document.querySelectorAll('[data-scenario]').forEach(b=>{
   const active=(state.scenario==='rainstorm'&&b.dataset.scenario==='rain')||b.dataset.scenario===state.scenario;
   b.classList.toggle('active',active);
 });
 document.querySelectorAll('[data-m46]').forEach(b=>{
   const active=(state.scenario==='waterfall-m561'&&b.dataset.m46==='waterfall')||b.dataset.m46===state.scenario;
   b.classList.toggle('active',active);
 });
}
bindButtons();
const buttonTimer=setInterval(bindButtons,500);
void buttonTimer;

window.__v5WeatherM56={
 online:true,controls:true,rainVisual:false,waterfallVisual:false,
 backend:'weather-control-m561',rainCount:RAIN_CAP,physicalAdded:0,error:''
};

// ----- Conserved PBF mass ------------------------------------------------------------------
// The solver particle spacing is centimeters. Real rain is millimeters, so solver parcels are
// deposited immediately above the free surface to add mass/momentum without ever becoming the
// giant airborne drops visible in the older scenario.
function rainMass(now){
 if(state.scenario!=='rainstorm'||ui.paused||document.hidden||room()<=0)return;
 const cadence=quality==='low'?76:quality==='high'?38:50;
 if(now-lastRainMass<cadence)return;
 lastRainMass=now;
 const b=sim.params.box;
 const d=sim.params.spacing;
 const base=quality==='low'?1:quality==='high'?3:2;
 const n=Math.max(1,Math.round(base*state.rainIntensity));
 const p=[];
 const v=[];
 for(let i=0;i<n;i++){
   const x=d*1.6+rnd()*(b[0]-d*3.2);
   const z=d*1.6+rnd()*(b[2]-d*3.2);
   const y=waterTop()+d*(.72+rnd()*.28);
   p.push(x,y,z);
   v.push((rnd()-.5)*.12,-(2.8+rnd()*1.0),(rnd()-.5)*.10);
 }
 const take=Math.min(room(),n);
 const a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));
 physAdded+=a;
 window.__v5WeatherM56.physicalAdded=physAdded;
}

// Waterfall appearance is a render sheet. Conserved PBF parcels enter only at the impact zone,
// preserving flow/mass while avoiding a train of visible centimeter-scale balls in the air.
function waterfallMass(now){
 if(state.scenario!=='waterfall-m561'||ui.paused||document.hidden||room()<=0)return;
 const cadence=quality==='low'?52:quality==='high'?24:32;
 if(now-lastFallMass<cadence)return;
 lastFallMass=now;
 const b=sim.params.box;
 const d=sim.params.spacing;
 const base=quality==='low'?2:quality==='high'?6:4;
 const n=Math.max(2,Math.round(base*state.waterfallFlow));
 const p=[];
 const v=[];
 const lanes=20;
 for(let i=0;i<n;i++){
   const lane=(fallCursor++)%lanes;
   const u=(lane+.5)/lanes;
   const z=b[2]*(.18+.64*u)+(rnd()-.5)*d*.30;
   const x=b[0]*.15+(rnd()-.5)*d*.22;
   const y=waterTop()+d*(.78+rnd()*.30);
   p.push(x,y,z);
   v.push(.42+(rnd()-.5)*.07,-(1.05+rnd()*.30),(rnd()-.5)*.05);
 }
 const take=Math.min(room(),n);
 const a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));
 physAdded+=a;
 window.__v5WeatherM56.physicalAdded=physAdded;
}
function sourceLoop(now){rainMass(now);waterfallMass(now);requestAnimationFrame(sourceLoop);}
requestAnimationFrame(sourceLoop);

function matMul(a,b){
 const o=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){
   let s=0;
   for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];
   o[c*4+r]=s;
 }
 return o;
}

// ----- Optional micro-rain visual ------------------------------------------------------------
let rainPipe=null;
let rainBG=null;
let rainUni=null;
let RF=null;
try{
 rainUni=dev.createBuffer({label:'fluidV5M561RainUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 RF=new Float32Array(32);
 const rainWGSL=`
struct R { vp:mat4x4f, box:vec4f, water:vec4f, screen:vec4f, style:vec4f }
@group(0) @binding(0) var<uniform> U:R;
struct V { @builtin(position) p:vec4f, @location(0) q:vec2f, @location(1) bright:f32 }
fn hash1(x0:u32)->f32 {
 var x=x0;
 x^=x>>16u;
 x*=0x7feb352du;
 x^=x>>15u;
 x*=0x846ca68bu;
 x^=x>>16u;
 return f32(x)/4294967295.0;
}
fn corner(i:u32)->vec2f {
 let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
 return a[i];
}
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V {
 var o:V;
 let h0=hash1(ii*9781u+17u);
 let h1=hash1(ii*6271u+91u);
 let h2=hash1(ii*3917u+211u);
 let h3=hash1(ii*1543u+617u);
 let top=U.box.y*.985;
 let bot=U.water.x+U.style.x;
 let travel=max(top-bot,.1);
 let speed=mix(5.4,9.0,h2)*U.water.y;
 let phase=fract(h3+U.box.w*speed/travel);
 let wind=vec3f(U.water.z,-1.0,U.water.w);
 let dir=normalize(wind);
 var wp=vec3f(U.style.y+h0*(U.box.x-2.0*U.style.y),top-phase*travel,U.style.y+h1*(U.box.z-2.0*U.style.y));
 wp.x+=U.water.z*phase*.22;
 wp.z+=U.water.w*phase*.22;
 let streak=mix(.012,.034,h2)*(0.82+U.water.y*.18);
 let pa=U.vp*vec4f(wp-dir*streak*.5,1.0);
 let pb=U.vp*vec4f(wp+dir*streak*.5,1.0);
 let pc=U.vp*vec4f(wp,1.0);
 if(pc.w<=1e-4){o.p=vec4f(2);o.q=vec2f(2);o.bright=0;return o;}
 let an=pa.xy/max(pa.w,1e-4);
 let bn=pb.xy/max(pb.w,1e-4);
 let cn=pc.xy/pc.w;
 var along=bn-an;
 let al=length(along);
 if(al>1e-6){along=along/al;}else{along=vec2f(0,-1);}
 let side=vec2f(-along.y,along.x);
 let q=corner(vi);
 let halfLen=max(al*.5,1.3/max(U.screen.y,1.0));
 let halfW=mix(.30,.58,h0)*2.0/max(U.screen.x,1.0);
 let ndc=cn+along*q.y*halfLen+side*q.x*halfW;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);
 o.q=q;
 o.bright=mix(.62,1.0,h1);
 return o;
}
@fragment fn fs(v:V)->@location(0) vec4f {
 let sideFade=1.0-smoothstep(.12,1.0,abs(v.q.x));
 let tipFade=1.0-smoothstep(.58,1.0,abs(v.q.y));
 let alpha=sideFade*tipFade*.26;
 let col=mix(vec3f(.62,.81,.93),vec3f(.96,1.0,1.0),v.bright);
 return vec4f(col,alpha);
}`;
 const mod=dev.createShaderModule({code:rainWGSL,label:'fluidV5M561RainWGSL'});
 rainPipe=await dev.createRenderPipelineAsync({label:'fluidV5M561Rain',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
 rainBG=dev.createBindGroup({layout:rainPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rainUni}}]});
 window.__v5WeatherM56.rainVisual=true;
}catch(err){
 window.__v5WeatherM56.rainError=String(err?.message||err);
 console.error('[Fluid V5 M5.6.1] micro-rain visual rejected; physical near-surface impacts remain active.',err);
}

// ----- Optional continuous waterfall visual -------------------------------------------------
let fallPipe=null;
let fallBG=null;
let fallUni=null;
let FF=null;
try{
 fallUni=dev.createBuffer({label:'fluidV5M561FallUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 FF=new Float32Array(28);
 const fallWGSL=`
struct F { vp:mat4x4f, box:vec4f, water:vec4f, style:vec4f }
@group(0) @binding(0) var<uniform> U:F;
struct V { @builtin(position) p:vec4f, @location(0) uv:vec2f, @location(1) foam:f32 }
fn corner(i:u32)->vec2f {
 let a=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
 return a[i];
}
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 var o:V;
 let tri=i/6u;
 let cx=tri%${FALL_COLS}u;
 let cy=tri/${FALL_COLS}u;
 let q=corner(i%6u);
 let u=(f32(cx)+q.x)/f32(${FALL_COLS});
 let t=(f32(cy)+q.y)/f32(${FALL_ROWS});
 let flutter=sin(u*21.0+U.box.w*4.4+t*7.0)*U.style.x*(.10+.90*t);
 let z=U.box.z*(.18+.64*u)+flutter;
 let y=mix(U.box.y*.818,U.water.x+U.style.y,t);
 let x=U.box.x*.095+U.style.z*t+sin(t*12.0+u*8.0+U.box.w*5.2)*U.style.x*.55*t;
 let clip=U.vp*vec4f(x,y,z,1.0);
 o.p=clip;
 o.uv=vec2f(u,t);
 o.foam=t;
 return o;
}
@fragment fn fs(v:V)->@location(0) vec4f {
 let waveA=sin(v.uv.x*47.0+v.uv.y*31.0+U.box.w*8.0);
 let waveB=sin(v.uv.x*19.0-v.uv.y*41.0-U.box.w*5.0);
 let flutter=.5+.5*waveA*waveB;
 let breakup=smoothstep(.52,.98,v.uv.y);
 if(breakup>.15&&flutter<mix(.03,.42,breakup)){discard;}
 let edgeA=smoothstep(0.0,.055,v.uv.x);
 let edgeB=smoothstep(0.0,.055,1.0-v.uv.x);
 let edge=edgeA*edgeB;
 let alpha=edge*mix(.30,.14,breakup)*mix(.72,1.0,flutter)*U.water.y;
 let foam=smoothstep(.70,1.0,v.uv.y);
 let col=mix(vec3f(.48,.78,.91),vec3f(.94,.995,1.0),.28+foam*.45+flutter*.12);
 return vec4f(col,alpha);
}`;
 const mod=dev.createShaderModule({code:fallWGSL,label:'fluidV5M561FallWGSL'});
 fallPipe=await dev.createRenderPipelineAsync({label:'fluidV5M561Waterfall',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
 fallBG=dev.createBindGroup({layout:fallPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:fallUni}}]});
 window.__v5WeatherM56.waterfallVisual=true;
}catch(err){
 window.__v5WeatherM56.waterfallError=String(err?.message||err);
 console.error('[Fluid V5 M5.6.1] waterfall sheet rejected; physical impact source remains active.',err);
}

// Wrap render only after independent pipeline attempts. A failed visual cannot disable controls.
if(rainPipe||fallPipe){
 const baseRender=ssfr.render;
 ssfr.render=function(...args){
   const out=baseRender.apply(this,args);
   const enc=args[0];
   const target=args[1];
   const view=args[5];
   const proj=args[6];
   const w=args[10]||1;
   const h=args[11]||1;
   if(!enc||!target||!view||!proj)return out;
   const vp=matMul(proj,view);
   const b=sim.params.box;
   const now=performance.now()*.001;
   const pressure=window.__v5Workload?.pressure||0;
   if(state.scenario==='rainstorm'&&rainPipe){
     RF.fill(0);
     RF.set(vp,0);
     RF[16]=b[0];RF[17]=b[1];RF[18]=b[2];RF[19]=now;
     RF[20]=waterTop();RF[21]=state.rainIntensity;RF[22]=.045;RF[23]=.012;
     RF[24]=w;RF[25]=h;
     RF[28]=sim.params.spacing*.20;RF[29]=sim.params.spacing*1.10;
     dev.queue.writeBuffer(rainUni,0,RF);
     const n=Math.max(320,Math.floor(RAIN_CAP*state.rainIntensity*(1-pressure*.58)));
     const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});
     pass.setPipeline(rainPipe);pass.setBindGroup(0,rainBG);pass.draw(6,n);pass.end();
   }
   if(state.scenario==='waterfall-m561'&&fallPipe){
     FF.fill(0);
     FF.set(vp,0);
     FF[16]=b[0];FF[17]=b[1];FF[18]=b[2];FF[19]=now;
     FF[20]=waterTop();FF[21]=state.waterfallFlow*(1-pressure*.20);
     FF[24]=sim.params.spacing;FF[25]=sim.params.spacing*.16;FF[26]=b[0]*.10;
     dev.queue.writeBuffer(fallUni,0,FF);
     const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});
     pass.setPipeline(fallPipe);pass.setBindGroup(0,fallBG);pass.draw(FALL_VERTS);pass.end();
   }
   return out;
 };
}

function mountControls(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');
 if(!host||document.getElementById('v5WeatherM561'))return;
 const box=document.createElement('div');
 box.id='v5WeatherM561';
 box.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 box.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">RAIN + WATERFALL · M5.6.1</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Rain uses tiny GPU micro-streaks while conserved PBF mass lands only at the surface. Waterfall uses a continuous visual sheet with PBF momentum deposited at its impact zone.</div><div class="v5Slider"><label>RAIN RATE</label><input id="v5RainM561" type="range" min=".35" max="1.8" step=".05"><div class="v5Val" id="v5RainM561V"></div></div><div class="v5Slider"><label>FALL FLOW</label><input id="v5FallM561" type="range" min=".45" max="1.55" step=".05"><div class="v5Val" id="v5FallM561V"></div></div><div id="v5WeatherM561Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 host.appendChild(box);
 const rr=box.querySelector('#v5RainM561');
 const rv=box.querySelector('#v5RainM561V');
 const fr=box.querySelector('#v5FallM561');
 const fv=box.querySelector('#v5FallM561V');
 rr.value=state.rainIntensity;fr.value=state.waterfallFlow;
 const sync=()=>{rv.textContent=Number(state.rainIntensity).toFixed(2);fv.textContent=Number(state.waterfallFlow).toFixed(2);};
 rr.oninput=e=>{e.stopPropagation();state.rainIntensity=Number(rr.value);save();sync();};
 fr.oninput=e=>{e.stopPropagation();state.waterfallFlow=Number(fr.value);save();sync();};
 box.onpointerdown=e=>e.stopPropagation();sync();
}
function statusTick(){
 syncButtons();
 mountControls();
 const s=document.getElementById('v5WeatherM561Status');
 const W=window.__v5WeatherM56;
 if(s)s.textContent=`CTRL ON · RAIN VIS ${W.rainVisual?'ON':'fallback'} · FALL VIS ${W.waterfallVisual?'ON':'fallback'} · PBF IMPACT +${physAdded.toLocaleString()}`;
}
setInterval(statusTick,450);
statusTick();
window.__v5WeatherM56.backend='storm-sheet-m561';
console.info('[Fluid V5 M5.6.1] weather controls installed before visuals; micro-rain and waterfall validate independently.');
