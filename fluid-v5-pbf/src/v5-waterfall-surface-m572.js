// Fluid V5 M5.8.1 fixed-mass waterfall surfacing.
// Tagged waterfall particles remain ordinary PBF fluid. Normal SSFR omits them while airborne and
// a thin live sheet renders the same positions. At impact the particles are physically pumped back
// to the lip instead of being released into the pool, creating a steady closed-loop waterfall with
// bounded mass and no long-term pool filling.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M5.8.1 waterfall surface: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,TAG=window.__v5WaterfallTag||0x5746;
if(!Number.isFinite(Number(state.waterfallSmooth)))state.waterfallSmooth=.92;
state.waterfallSmooth=Math.max(.35,Math.min(1.25,Number(state.waterfallSmooth)));
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}
const active=()=>state.scenario==='waterfall-m58';

// --- Compile a normal SSFR variant that omits only tagged waterfall particles -----------------
const UP='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UP+'ssfr_wgsl.js');
const skipNeedle=`  if (S.skipBodies != 0u && phase[ii].x != 0u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }`;
if(!SW.splatPrelude.includes(skipNeedle))throw new Error('Fluid V5 M5.8.1: upstream SSFR splat signature changed.');
const skipPrelude=SW.splatPrelude.replace(skipNeedle,`  if (phase[ii].w == ${TAG}u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }\n\n${skipNeedle}`);
const smod=(src,label)=>dev.createShaderModule({code:skipPrelude+src,label});
const depthMod=smod(SW.depthFS,'fluidV5M581DepthWGSL');
const thickMod=smod(SW.thickFS,'fluidV5M581ThickWGSL');
const skipDepth=await dev.createRenderPipelineAsync({label:'fluidV5M581DepthNoWaterfallBlobs',layout:'auto',vertex:{module:depthMod,entryPoint:'vs'},fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},primitive:{topology:'triangle-strip'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
const skipThick=await dev.createRenderPipelineAsync({label:'fluidV5M581ThickNoWaterfallBlobs',layout:'auto',vertex:{module:thickMod,entryPoint:'vs'},fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-strip'}});

// --- Closed-loop GPU pump ---------------------------------------------------------------------
// The PBF solve gets a genuine impact step first. During rendering, tagged particles that have
// reached the free surface are moved back to the lip and given a new inlet velocity. The next PBF
// step then advances them normally again. No particle creation occurs after the small priming set.
const recycleUni=dev.createBuffer({label:'fluidV5M581RecycleUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const recycleF=new Float32Array(12),recycleU=new Uint32Array(recycleF.buffer);
const recycleWGSL=`
struct U{
 topY:f32,recycleY:f32,nozzleX:f32,centreZ:f32,
 width:f32,spacing:f32,vx:f32,vy:f32,
 n:u32,tag:u32,frame:u32,enabled:u32
}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>phase:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.n){return;}var ph=phase[i];if(ph.w!=C.tag){return;}
 if(C.enabled==0u){phase[i]=vec4u(ph.x,ph.y,ph.z,0u);return;}
 if(P[i].y>C.recycleY){return;}
 let base=select(i+1u,ph.y,ph.y!=0u);let s=base^(C.frame*747796405u);
 let h0=hash1(s+17u),h1=hash1(s+101u),h2=hash1(s+313u),h3=hash1(s+911u);
 let z=C.centreZ+(h0-.5)*C.width*.96;
 let x=C.nozzleX+(h1-.5)*C.spacing*.22;
 let y=C.topY-C.spacing*(.10+.88*h2);
 let vz=(h3-.5)*.035;
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.vx+(h2-.5)*.020,C.vy-h1*.035,vz,0.0);
}`;
const recyclePipe=await dev.createComputePipelineAsync({label:'fluidV5M581RecyclePump',layout:'auto',compute:{module:dev.createShaderModule({code:recycleWGSL,label:'fluidV5M581RecycleWGSL'}),entryPoint:'main'}});
let recycleFrame=0;

// --- Fine live-particle sheet -----------------------------------------------------------------
const drawUni=dev.createBuffer({label:'fluidV5M581SheetUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const head=new Float32Array(24),meta=new Uint32Array(4);
const sheetWGSL=`
struct U{vp:mat4x4f,screen:vec4f,tune:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read>V:array<vec4f>;
@group(0)@binding(3)var<storage,read>phase:array<vec4u>;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)speed:f32,@location(2)fall:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;if(ii>=C.meta.x||phase[ii].w!=C.meta.y){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.fall=0;return o;}
 let wp=P[ii].xyz;let vv=V[ii].xyz;let sp=length(vv);var dir=vec3f(0,-1,0);if(sp>.02){dir=vv/sp;}
 let side=vec3f(0,0,1);let pc=C.vp*vec4f(wp,1);let pl=C.vp*vec4f(wp+dir*C.tune.y*1.42,1);let ps=C.vp*vec4f(wp+side*C.tune.y*.68*C.tune.z,1);
 if(pc.w<=1e-5||pl.w<=1e-5||ps.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.fall=0;return o;}
 let cn=pc.xy/pc.w;let ln=pl.xy/pl.w;let sn=ps.xy/ps.w;var along=ln-cn;let side2=sn-cn;let al=length(along);
 if(al>1e-6){along/=al;}else{along=vec2f(0,-1);}var normal=side2-along*dot(side2,along);let nl=length(normal);if(nl>1e-6){normal/=nl;}else{normal=vec2f(-along.y,along.x);}
 let q=corner(vi);let speedGain=clamp(sp*.13,0.0,1.0);let halfW=max(length(side2)*.92,1.0/max(C.screen.x,1.0));let halfL=max(al*(.76+.20*speedGain),1.7/max(C.screen.y,1.0));let ndc=cn+normal*q.x*halfW+along*q.y*halfL;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.speed=sp;o.fall=clamp((C.tune.x-wp.y)/max(C.tune.x-C.tune.w,1e-4),0.0,1.0);return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let ax=abs(v.q.x),ay=abs(v.q.y);if(ax>1||ay>1){discard;}let sx=1.0-smoothstep(.58,1.0,ax);let sy=1.0-smoothstep(.76,1.0,ay);let mask=sx*sy;
 let fast=clamp(v.speed*.11,0.0,1.0);let aerate=clamp(v.fall*.78+fast*.28,0.0,1.0);let col=mix(vec3f(.11,.47,.69),vec3f(.93,.985,1.0),.18+.58*aerate);let alpha=mask*(.085+.072*aerate);return vec4f(col,alpha);
}`;
const sheetMod=dev.createShaderModule({code:sheetWGSL,label:'fluidV5M581SheetWGSL'});
const sheetPipe=await dev.createRenderPipelineAsync({label:'fluidV5M581Sheet',layout:'auto',vertex:{module:sheetMod,entryPoint:'vs'},fragment:{module:sheetMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}

// Install the SSFR exclusion only after every M5.8.1 pipeline has validated. If the custom sheet
// rejects on a device, ordinary SSFR stays intact rather than making the waterfall invisible.
ssfr.pipeDepth=skipDepth;ssfr.pipeThick=skipThick;ssfr.bindCache=null;

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 if(enc&&sim.n>0){
  const b=sim.params.box,d=sim.params.spacing,flow=Math.max(.45,Math.min(1.55,Number(state.waterfallFlow)||1));
  recycleF[0]=b[1]*.28+Math.min(.79,b[1]*.315);
  recycleF[1]=b[1]*.28+d*.10;
  recycleF[2]=Math.max(d*1.65,b[0]*.038);
  recycleF[3]=b[2]*.50;
  recycleF[4]=Math.min(b[2]*.92,Math.max(d*14,b[2]*Math.max(.48,Math.min(.92,Number(state.waterfallWidth)||.78))));
  recycleF[5]=d;
  recycleF[6]=.23+.085*flow;
  recycleF[7]=-.055-.030*flow;
  recycleU[8]=sim.n;recycleU[9]=TAG;recycleU[10]=(recycleFrame++>>>0);recycleU[11]=active()?1:0;
  dev.queue.writeBuffer(recycleUni,0,recycleF);
  const phase=sim.buf[sim.parity===0?'bodyA':'bodyB'];
  const rb=dev.createBindGroup({layout:recyclePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:recycleUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:phase}}]});
  const cp=enc.beginComputePass();cp.setPipeline(recyclePipe);cp.setBindGroup(0,rb);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 }
 const out=baseRender.apply(this,args);
 if(!active()||!enc||!target||!view||!proj||ui?.paused||window.__v5DebugMode!=='final')return out;
 const b=sim.params.box,d=sim.params.spacing,topY=b[1]*.28+Math.min(.79,b[1]*.315);head.set(matMul(proj,view),0);head[16]=w;head[17]=h;head[18]=0;head[19]=0;head[20]=topY;head[21]=d;head[22]=state.waterfallSmooth;head[23]=b[1]*.28;meta[0]=sim.n;meta[1]=TAG;meta[2]=0;meta[3]=0;dev.queue.writeBuffer(drawUni,0,head);dev.queue.writeBuffer(drawUni,96,meta);
 const phase=sim.buf[sim.parity===0?'bodyA':'bodyB'];
 const bg=dev.createBindGroup({layout:sheetPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:drawUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:phase}}]});
 const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(sheetPipe);pass.setBindGroup(0,bg);pass.draw(6,sim.n);pass.end();return out;
};

function mount(){const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallSurfaceM572UI'))return;const d=document.createElement('div');d.id='v5WaterfallSurfaceM572UI';d.style.cssText='margin-top:8px';d.innerHTML=`<div class="v5Slider"><label>WATERFALL SHEET</label><input id="v5WaterfallSmooth" type="range" min="0.35" max="1.25" step="0.05"><div id="v5WaterfallSmoothVal" class="v5Val"></div></div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:4px">The waterfall now uses a fixed circulating set of real PBF particles. They impact the pool, then the GPU pump returns the same mass to the lip; the large airborne SSFR ellipsoids remain disabled.</div>`;host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.waterfallSmooth;const sync=()=>v.textContent=Number(state.waterfallSmooth).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state.waterfallSmooth=Number(r.value);try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}sync();};d.onpointerdown=e=>e.stopPropagation();}
setInterval(mount,500);mount();
window.__v5WaterfallSurfaceM572={online:true,backend:'fixed-mass-recycle-sheet-m581',tag:TAG};
console.info('[Fluid V5 M5.8.1] fixed-mass SSFR exclusion + GPU recycle sheet online.');