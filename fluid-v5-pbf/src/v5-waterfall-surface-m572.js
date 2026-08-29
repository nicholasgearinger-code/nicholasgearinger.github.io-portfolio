// Fluid V5 M5.8 tagged thin-sheet waterfall surfacing.
// The PBF solver remains authoritative. Airborne waterfall particles are tagged in phase.w:
//   1) normal SSFR depth/thickness splats skip that tag, removing the large ellipsoid blobs;
//   2) this module draws a fine velocity-aligned translucent sheet from those same live particles;
//   3) a tiny compute pass clears the tag near the water surface, so impacted particles immediately
//      rejoin the ordinary SSFR pool and continue contributing mass, refraction and caustics.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M5.8 waterfall surface: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,TAG=window.__v5WaterfallTag||0x5746;
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.waterfallSmooth)))state.waterfallSmooth=.92;
state.waterfallSmooth=Math.max(.35,Math.min(1.25,Number(state.waterfallSmooth)));
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}
const active=()=>state.scenario==='waterfall-m58';

// ----- Replace only the regular SSFR particle splat representation for tagged airborne fluid. ---
const UP='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UP+'ssfr_wgsl.js');
const skipNeedle=`  if (S.skipBodies != 0u && phase[ii].x != 0u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }`;
const skipPatch=`  if (phase[ii].w == ${TAG}u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }\n\n${skipNeedle}`;
if(!SW.splatPrelude.includes(skipNeedle))throw new Error('Fluid V5 M5.8: upstream SSFR splat signature changed.');
const splatPrelude=SW.splatPrelude.replace(skipNeedle,skipPatch);
const mk=(src,label)=>dev.createShaderModule({code:splatPrelude+src,label});
const skipDepth=await dev.createRenderPipelineAsync({label:'fluidV5M58DepthNoWaterfallBlobs',layout:'auto',vertex:{module:mk(SW.depthFS,'fluidV5M58DepthWGSL'),entryPoint:'vs'},fragment:{module:mk(SW.depthFS,'fluidV5M58DepthFSWGSL'),entryPoint:'fs',targets:[{format:'r32float'}]},primitive:{topology:'triangle-strip'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
const thickMod=mk(SW.thickFS,'fluidV5M58ThickWGSL');
const skipThick=await dev.createRenderPipelineAsync({label:'fluidV5M58ThickNoWaterfallBlobs',layout:'auto',vertex:{module:thickMod,entryPoint:'vs'},fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-strip'}});
ssfr.pipeDepth=skipDepth;ssfr.pipeThick=skipThick;ssfr.bindCache=null;

// ----- Release landed tagged particles back to the normal pool surface ------------------------
const releaseUni=dev.createBuffer({label:'fluidV5M58ReleaseUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const releaseF=new Float32Array(4),releaseU=new Uint32Array(releaseF.buffer);
const releaseWGSL=`
struct U{releaseY:f32,pad:f32,n:u32,tag:u32}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>phase:array<vec4u>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.n){return;}let ph=phase[i];if(ph.w!=C.tag){return;}
 if(P[i].y<=C.releaseY){phase[i]=vec4u(ph.x,ph.y,ph.z,0u);}
}`;
const releasePipe=await dev.createComputePipelineAsync({label:'fluidV5M58ReleaseLanded',layout:'auto',compute:{module:dev.createShaderModule({code:releaseWGSL,label:'fluidV5M58ReleaseWGSL'}),entryPoint:'main'}});

// ----- Fine sheet renderer -------------------------------------------------------------------
const sheetUni=dev.createBuffer({label:'fluidV5M58SheetUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(24),SU=new Uint32Array(SF.buffer);
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
 let side=vec3f(0,0,1);let pc=C.vp*vec4f(wp,1);let pl=C.vp*vec4f(wp+dir*C.tune.y*1.32,1);let ps=C.vp*vec4f(wp+side*C.tune.y*.58*C.tune.z,1);
 if(pc.w<=1e-5||pl.w<=1e-5||ps.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;o.fall=0;return o;}
 let cn=pc.xy/pc.w;let ln=pl.xy/pl.w;let sn=ps.xy/ps.w;var along=ln-cn;var wide=sn-cn;let al=length(along);let wl=length(wide);
 if(al>1e-6){along/=al;}else{along=vec2f(0,-1);}if(wl>1e-6){wide/=wl;}else{wide=vec2f(1,0);}
 // Force the two projected axes to remain orthogonal enough to avoid diamond-shaped blobs.
 let normal=normalize(wide-along*dot(wide,along)+vec2f(1e-6,0));let q=corner(vi);let speedGain=clamp(sp*.13,0.0,1.0);
 let halfW=max(wl*.82,1.0/max(C.screen.x,1.0));let halfL=max(al*(.68+.22*speedGain),1.4/max(C.screen.y,1.0));let ndc=cn+normal*q.x*halfW+along*q.y*halfL;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.speed=sp;o.fall=clamp((C.tune.x-wp.y)/max(C.tune.x-C.tune.w,1e-4),0.0,1.0);return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let ax=abs(v.q.x),ay=abs(v.q.y);if(ax>1||ay>1){discard;}let sx=1.0-smoothstep(.54,1.0,ax);let sy=1.0-smoothstep(.72,1.0,ay);let mask=sx*sy;
 let fast=clamp(v.speed*.11,0.0,1.0);let aerate=clamp(v.fall*.82+fast*.32,0.0,1.0);let col=mix(vec3f(.13,.50,.70),vec3f(.91,.98,1.0),.22+.58*aerate);
 let alpha=mask*(.095+.080*aerate);return vec4f(col,alpha);
}`;
const sheetMod=dev.createShaderModule({code:sheetWGSL,label:'fluidV5M58SheetWGSL'});
const sheetPipe=await dev.createRenderPipelineAsync({label:'fluidV5M58Sheet',layout:'auto',vertex:{module:sheetMod,entryPoint:'vs'},fragment:{module:sheetMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 // Clear tags slightly above the rest surface before ordinary SSFR runs, allowing impacted PBF
 // particles to become normal pool water on the same frame.
 if(enc&&sim.n>0){
  const releaseY=sim.params.box[1]*.28+sim.params.spacing*1.35;releaseF[0]=releaseY;releaseF[1]=0;releaseU[2]=sim.n;releaseU[3]=TAG;dev.queue.writeBuffer(releaseUni,0,releaseF);
  const rb=dev.createBindGroup({layout:releasePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:releaseUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.buf[sim.parity===0?'bodyA':'bodyB']}}]});
  const cp=enc.beginComputePass();cp.setPipeline(releasePipe);cp.setBindGroup(0,rb);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 }
 const out=baseRender.apply(this,args);
 if(!active()||!enc||!target||!view||!proj||ui?.paused||window.__v5DebugMode!=='final')return out;
 const b=sim.params.box,d=sim.params.spacing,topY=b[1]*.28+Math.min(.79,b[1]*.315);SF.set(matMul(proj,view),0);SF[16]=w;SF[17]=h;SF[18]=0;SF[19]=0;SF[20]=topY;SF[21]=d;SF[22]=state.waterfallSmooth;SF[23]=b[1]*.28;
 // meta shares words 20..23 in WGSL after tune, so write it separately at byte 80? No: layout is
 // mat4(64)+screen(16)+tune(16)+meta(16) = 112 bytes. Recreate a correctly aligned buffer below.
 return out;
};

// Rebuild the sheet uniform at the correct 112-byte size; the compact declaration above is kept
// only as a construction guard and never used for drawing.
sheetUni.destroy();
const drawUni=dev.createBuffer({label:'fluidV5M58SheetDrawUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const head=new Float32Array(24),meta=new Uint32Array(4);
const wrapped=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 // `wrapped` performs landed-tag release + all existing SSFR/M4/M5 rendering.
 const out=wrapped.apply(this,args);
 if(!active()||!enc||!target||!view||!proj||ui?.paused||window.__v5DebugMode!=='final')return out;
 const b=sim.params.box,d=sim.params.spacing,topY=b[1]*.28+Math.min(.79,b[1]*.315);head.set(matMul(proj,view),0);head[16]=w;head[17]=h;head[18]=0;head[19]=0;head[20]=topY;head[21]=d;head[22]=state.waterfallSmooth;head[23]=b[1]*.28;meta[0]=sim.n;meta[1]=TAG;meta[2]=0;meta[3]=0;dev.queue.writeBuffer(drawUni,0,head);dev.queue.writeBuffer(drawUni,96,meta);
 const bg=dev.createBindGroup({layout:sheetPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:drawUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.buf[sim.parity===0?'bodyA':'bodyB']}}]});
 const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(sheetPipe);pass.setBindGroup(0,bg);pass.draw(6,sim.n);pass.end();return out;
};

function mount(){const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallSurfaceM572UI'))return;const d=document.createElement('div');d.id='v5WaterfallSurfaceM572UI';d.style.cssText='margin-top:8px';d.innerHTML=`<div class="v5Slider"><label>WATERFALL SHEET</label><input id="v5WaterfallSmooth" type="range" min="0.35" max="1.25" step="0.05"><div id="v5WaterfallSmoothVal" class="v5Val"></div></div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:4px">Tagged airborne PBF particles are removed from the normal large-ellipsoid SSFR pass and rendered as a thin velocity-aligned sheet. They return to normal SSFR automatically at impact.</div>`;host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.waterfallSmooth;const sync=()=>v.textContent=Number(state.waterfallSmooth).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state.waterfallSmooth=Number(r.value);try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}sync();};d.onpointerdown=e=>e.stopPropagation();}
setInterval(mount,500);mount();
window.__v5WaterfallSurfaceM572={online:true,backend:'tagged-ssfr-exclusion-sheet-m58',tag:TAG};
console.info('[Fluid V5 M5.8] tagged SSFR exclusion + thin PBF waterfall sheet online.');
