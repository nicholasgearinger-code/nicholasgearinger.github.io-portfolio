// Fluid V5 M5.7.2 waterfall-specific surface reconstruction.
// The physical waterfall remains the conserved PBF lattice. This module changes only rendering:
// - connected airborne PBF particles receive a stronger anisotropic sheet profile;
// - isolated airborne particles render much smaller;
// - extra render-only micro-splats interpolate visual density between physical samples.
// No proxy enters the density/pressure solve.

const sim=window.__sim,ssfr=window.__ssfr,mesh=window.__mesh,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!mesh||!state)throw new Error('Fluid V5 M5.7.2 waterfall reconstruction: runtime unavailable.');
const dev=sim.dev,format=ssfr.format;
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const SUBS=quality==='low'?2:quality==='high'?5:4;
const MAX_PHYS=quality==='low'?5000:quality==='high'?10000:7500;
if(!Number.isFinite(Number(state.waterfallSmooth)))state.waterfallSmooth=.92;
state.waterfallSmooth=Math.max(0,Math.min(1.25,Number(state.waterfallSmooth)));
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}

const base={ratio:mesh.anisoRatio,stretch:mesh.anisoStretch,lambda:mesh.anisoLambda,minN:mesh.anisoMinNeighbours,radius:mesh.anisoRadiusScale,lonely:mesh.anisoLonely,delta:ssfr.narrowDelta,mu:ssfr.narrowMu,bilateral:ssfr.bilateralRange,cleanup:ssfr.cleanupRadius,filter:ssfr.filterIterations};
let tuned=false;
function active(){return state.scenario==='waterfall-m572';}
function tuneSurface(){
 if(active()){
  const s=Math.max(0,Math.min(1.25,state.waterfallSmooth));
  mesh.anisoRatio=Math.max(base.ratio||0,4.8+1.7*s);
  mesh.anisoStretch=Math.max(base.stretch||0,2.15+1.20*s);
  mesh.anisoLambda=Math.max(base.lambda||0,.91+.035*s);
  mesh.anisoMinNeighbours=Math.min(Number.isFinite(base.minN)?base.minN:17,Math.max(6,Math.round(12-4*s)));
  mesh.anisoRadiusScale=Math.max(base.radius||0,1.95+.22*s);
  mesh.anisoLonely=Math.min(Number.isFinite(base.lonely)?base.lonely:.92,Math.max(.30,.66-.25*s));
  ssfr.narrowDelta=Math.max(base.delta||0,9.0+1.8*s);
  ssfr.narrowMu=Math.max(base.mu||0,1.02+.16*s);
  ssfr.bilateralRange=Math.max(base.bilateral||0,2.15+.30*s);
  ssfr.cleanupPass=true;ssfr.cleanupRadius=Math.max(base.cleanup||3,4);
  const pressure=window.__v5Workload?.pressure||0;
  ssfr.filterIterations=Math.max(ssfr.filterIterations||0,pressure>.72?3:(quality==='high'?5:4));
  tuned=true;
 }else if(tuned){
  mesh.anisoRatio=base.ratio;mesh.anisoStretch=base.stretch;mesh.anisoLambda=base.lambda;mesh.anisoMinNeighbours=base.minN;mesh.anisoRadiusScale=base.radius;mesh.anisoLonely=base.lonely;
  ssfr.narrowDelta=base.delta;ssfr.narrowMu=base.mu;ssfr.bilateralRange=base.bilateral;ssfr.cleanupRadius=base.cleanup;ssfr.filterIterations=Math.max(ssfr.filterIterations||0,base.filter||0);tuned=false;
 }
}
setInterval(tuneSurface,120);tuneSurface();

const uni=dev.createBuffer({label:'fluidV5M572WaterfallVisualUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const headF=new Float32Array(20),metaU=new Uint32Array(4),tuneF=new Float32Array(4);
const shader=`
struct U{vp:mat4x4f,screen:vec4f,meta:vec4u,tune:vec4f}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read>V0:array<vec4f>;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)speed:f32,@location(2)age:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
fn suboff(k:u32)->vec2f{let a=array<vec2f,5>(vec2f(-.31,-.12),vec2f(.30,.10),vec2f(-.10,.31),vec2f(.12,-.30),vec2f(0,0));return a[min(k,4u)];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;let subs=max(C.meta.z,1u);let local=ii/subs;let sub=ii-local*subs;
 if(local>=C.meta.y){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.age=0;return o;}
 let idx=C.meta.x+local;if(idx>=C.meta.w){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.age=0;return o;}
 let p0=P[idx].xyz;let vv=V0[idx].xyz;let sp=length(vv);
 if(p0.y<=C.tune.x+C.tune.y*.25){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.age=0;return o;}
 var dir=vec3f(0,-1,0);if(sp>.02){dir=vv/sp;}let side=normalize(cross(dir,vec3f(0,0,1))+.001*vec3f(1,0,0));let across=normalize(cross(dir,side));let so=suboff(sub)*C.tune.y*.34;let wp=p0+side*so.x+across*so.y;
 let pc=C.vp*vec4f(wp,1);let pe=C.vp*vec4f(wp+dir*C.tune.y*.75,1);if(pc.w<=1e-5||pe.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.age=0;return o;}
 let cn=pc.xy/pc.w;let en=pe.xy/pe.w;var along=en-cn;let al=length(along);if(al>1e-5){along/=al;}else{along=vec2f(0,-1);}let normal=vec2f(-along.y,along.x);let q=corner(vi);
 let px=mix(.52,.80,clamp(sp*.22,0.0,1.0))*C.tune.z;let halfW=px*2.0/max(C.screen.x,1.0);let halfL=max(al*.78,px*3.1/max(C.screen.y,1.0));let ndc=cn+normal*q.x*halfW+along*q.y*halfL;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.speed=sp;o.age=clamp((p0.y-C.tune.x)/max(C.tune.w,1e-4),0.0,1.0);return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let r=dot(v.q,v.q);if(r>1){discard;}let core=1.0-smoothstep(.04,1.0,r);let rim=pow(1.0-sqrt(max(0.0,1.0-r)),.42);let fast=clamp(v.speed*.18,0.0,1.0);let col=mix(vec3f(.19,.63,.84),vec3f(.91,.98,1.0),.30+fast*.42+rim*.16);let a=core*(.065+.070*fast)*(1.0-.18*v.age);return vec4f(col,a);
}`;
let pipe=null;
try{
 const mod=dev.createShaderModule({code:shader,label:'fluidV5M572WaterfallVisualWGSL'});
 pipe=await dev.createRenderPipelineAsync({label:'fluidV5M572WaterfallVisual',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
}catch(err){window.__v5WaterfallSurfaceM572={online:false,error:String(err?.message||err)};throw err;}
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
const baseRender=ssfr.render;
ssfr.render=function(...args){
 const out=baseRender.apply(this,args);if(!active()||!pipe||ui?.paused||window.__v5DebugMode!=='final')return out;
 const W=window.__v5WaterfallM57,first=W?.firstIndex??-1,last=W?.lastIndex??-1;if(first<0||last<=first)return out;
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;if(!enc||!target||!view||!proj)return out;
 const count=Math.min(MAX_PHYS,last-first);headF.set(matMul(proj,view),0);headF[16]=w;headF[17]=h;headF[18]=0;headF[19]=0;metaU[0]=first;metaU[1]=count;metaU[2]=SUBS;metaU[3]=last;
 const b=sim.params.box,d=sim.params.spacing;tuneF[0]=b[1]*.28;tuneF[1]=d;tuneF[2]=Math.max(.60,state.waterfallSmooth);tuneF[3]=Math.max(.2,b[1]*.31);
 dev.queue.writeBuffer(uni,0,headF);dev.queue.writeBuffer(uni,80,metaU);dev.queue.writeBuffer(uni,96,tuneF);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}}]});
 const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.draw(6,count*SUBS);pass.end();return out;
};
function mount(){const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallSurfaceM572UI'))return;const d=document.createElement('div');d.id='v5WaterfallSurfaceM572UI';d.style.cssText='margin-top:8px';d.innerHTML=`<div class="v5Slider"><label>WATERFALL SMOOTH</label><input id="v5WaterfallSmooth" type="range" min="0" max="1.25" step="0.05"><div id="v5WaterfallSmoothVal" class="v5Val"></div></div>`;host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.waterfallSmooth;const sync=()=>v.textContent=Number(state.waterfallSmooth).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state.waterfallSmooth=Number(r.value);try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}sync();};d.onpointerdown=e=>e.stopPropagation();}
setInterval(mount,500);mount();
window.__v5WaterfallSurfaceM572={online:true,backend:'anisotropic-microsplat-m572',subsplats:SUBS};
console.info('[Fluid V5 M5.7.2] waterfall anisotropic reconstruction + micro-splats online.');
