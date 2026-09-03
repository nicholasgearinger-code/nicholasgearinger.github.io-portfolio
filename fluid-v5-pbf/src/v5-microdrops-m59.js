// Fluid V5 M5.9 microdroplet surfacing.
// Solver particles remain unchanged for mass/density. Sparse airborne fluid is tagged render-only,
// removed from the normal solver-sized SSFR splat, and rendered as much smaller velocity-aligned
// refractive droplets. Waterfall-tagged particles keep their dedicated M5.9 curtain representation.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M5.9 microdrops: runtime unavailable.');
const dev=sim.dev,format=ssfr.format;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const DROP_TAG=0x4452; // "DR"
const WF_TAG=window.__v5WaterfallTag||0x5746;
if(!Number.isFinite(Number(state.microDropSize)))state.microDropSize=.62;
state.microDropSize=clamp(Number(state.microDropSize),.32,1.0);
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)-(window.__v5WaterfallM57?.target||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}

// --- Classify sparse airborne PBF fluid --------------------------------------------------------
const classUni=dev.createBuffer({label:'fluidV5M59DropClassUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const CF=new Float32Array(12),CU=new Uint32Array(CF.buffer);
const classWGSL=`
struct U{water:vec4f,tune:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read>V:array<vec4f>;
@group(0)@binding(3)var<storage,read>D:array<f32>;
@group(0)@binding(4)var<storage,read_write>phase:array<vec4u>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x){return;}
 var ph=phase[i];if(ph.x!=0u||ph.w==C.meta.z){return;}
 let p=P[i].xyz;let v=V[i].xyz;
 if(ph.w==C.meta.y){
  if(p.y<=C.tune.w){phase[i]=vec4u(ph.x,ph.y,ph.z,0u);}
  return;
 }
 if(ph.w!=0u){return;}
 let airborne=p.y>C.tune.z;
 let sparse=D[i]<C.water.z*C.tune.x;
 let moving=length(v)>C.tune.y;
 if(airborne&&sparse&&moving){phase[i]=vec4u(ph.x,ph.y,ph.z,C.meta.y);}
}`;
const classMod=dev.createShaderModule({code:classWGSL,label:'fluidV5M59DropClassWGSL'});
if(typeof classMod.getCompilationInfo==='function'){
 const info=await classMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M5.9 microdrop classifier WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const classPipe=await dev.createComputePipelineAsync({label:'fluidV5M59DropClass',layout:'auto',compute:{module:classMod,entryPoint:'main'}});

// --- Replace normal SSFR splats with a variant that skips waterfall + microdrop tags -----------
const UP='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UP+'ssfr_wgsl.js');
const skipNeedle=`  if (S.skipBodies != 0u && phase[ii].x != 0u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }`;
if(!SW.splatPrelude.includes(skipNeedle))throw new Error('Fluid V5 M5.9: upstream SSFR splat signature changed.');
const skipPrelude=SW.splatPrelude.replace(skipNeedle,`  if (phase[ii].w == ${WF_TAG}u || phase[ii].w == ${DROP_TAG}u) {\n    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);\n    return o;\n  }\n\n${skipNeedle}`);
const smod=(src,label)=>dev.createShaderModule({code:skipPrelude+src,label});
const depthMod=smod(SW.depthFS,'fluidV5M59DepthNoMacroDropsWGSL');
const thickMod=smod(SW.thickFS,'fluidV5M59ThickNoMacroDropsWGSL');
const skipDepth=await dev.createRenderPipelineAsync({label:'fluidV5M59DepthNoMacroDrops',layout:'auto',vertex:{module:depthMod,entryPoint:'vs'},fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},primitive:{topology:'triangle-strip'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
const skipThick=await dev.createRenderPipelineAsync({label:'fluidV5M59ThickNoMacroDrops',layout:'auto',vertex:{module:thickMod,entryPoint:'vs'},fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-strip'}});
ssfr.pipeDepth=skipDepth;ssfr.pipeThick=skipThick;ssfr.bindCache=null;

// --- Render tagged PBF splash parcels as tiny velocity-aligned water droplets ------------------
const drawUni=dev.createBuffer({label:'fluidV5M59MicroDropUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const DF=new Float32Array(28),DU=new Uint32Array(DF.buffer);
const drawWGSL=`
struct U{vp:mat4x4f,screen:vec4f,tune:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read>V:array<vec4f>;
@group(0)@binding(3)var<storage,read>phase:array<vec4u>;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)speed:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;if(ii>=C.meta.x||phase[ii].w!=C.meta.y){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;return o;}
 let wp=P[ii].xyz;let vv=V[ii].xyz;let sp=length(vv);var dir=vec3f(0,-1,0);if(sp>.02){dir=vv/sp;}
 var side=cross(dir,vec3f(0,0,1));if(length(side)<.05){side=vec3f(1,0,0);}else{side=normalize(side);}
 let pc=C.vp*vec4f(wp,1);let pl=C.vp*vec4f(wp+dir*C.tune.x*C.tune.y*.55,1);let ps=C.vp*vec4f(wp+side*C.tune.x*C.tune.y*.13,1);
 if(pc.w<=1e-5||pl.w<=1e-5||ps.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.speed=0;return o;}
 let cn=pc.xy/pc.w;let ln=pl.xy/pl.w;let sn=ps.xy/ps.w;var along=ln-cn;let al=length(along);if(al>1e-6){along/=al;}else{along=vec2f(0,-1);}
 var normal=sn-cn;normal-=along*dot(normal,along);let nl=length(normal);if(nl>1e-6){normal/=nl;}else{normal=vec2f(-along.y,along.x);}
 let q=corner(vi);let px=vec2f(.75/max(C.screen.x,1.0),.75/max(C.screen.y,1.0));let halfW=max(length(sn-cn)*.72,px.x);let halfL=max(length(ln-cn)*(.85+clamp(sp*.12,0.0,.75)),px.y*1.35);let ndc=cn+normal*q.x*halfW+along*q.y*halfL;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.speed=sp;return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let r=length(v.q);if(r>1){discard;}let z=sqrt(max(0.0,1.0-r*r));let fres=.0204+(1.0-.0204)*pow(1.0-z,5.0);let rim=smoothstep(.50,1.0,r);let core=(1.0-smoothstep(.0,.86,r));let col=vec3f(.20,.61,.82)*(.16+.13*core)+vec3f(.82,.96,1.0)*(fres*.90+rim*.16);let a=.055*core+.28*rim+.30*fres;return vec4f(col,a);
}`;
const drawMod=dev.createShaderModule({code:drawWGSL,label:'fluidV5M59MicroDropWGSL'});
if(typeof drawMod.getCompilationInfo==='function'){
 const info=await drawMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M5.9 microdrop render WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const drawPipe=await dev.createRenderPipelineAsync({label:'fluidV5M59MicroDrops',layout:'auto',vertex:{module:drawMod,entryPoint:'vs'},fragment:{module:drawMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 if(enc&&sim.n>0){
  const surface=slabSurfaceY(),d=sim.params.spacing;
  CF[0]=surface;CF[1]=d;CF[2]=sim.params.restDensity;CF[3]=state.microDropSize;
  CF[4]=.93;CF[5]=.28;CF[6]=surface+d*1.10;CF[7]=surface+d*.55;
  CU[8]=sim.n;CU[9]=DROP_TAG;CU[10]=WF_TAG;CU[11]=1;
  dev.queue.writeBuffer(classUni,0,CF);
  const bg=dev.createBindGroup({layout:classPipe.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:classUni}},
   {binding:1,resource:{buffer:sim.livePos()}},
   {binding:2,resource:{buffer:sim.liveVel()}},
   {binding:3,resource:{buffer:sim.buf.density}},
   {binding:4,resource:{buffer:sim.liveBody()}},
  ]});
  const cp=enc.beginComputePass();cp.setPipeline(classPipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 }
 const out=baseRender.apply(this,args);
 if(!enc||!target||!view||!proj||window.__v5DebugMode!=='final')return out;
 DF.set(matMul(proj,view),0);DF[16]=w;DF[17]=h;DF[18]=0;DF[19]=0;DF[20]=sim.params.spacing;DF[21]=state.microDropSize;DF[22]=0;DF[23]=0;DU[24]=sim.n;DU[25]=DROP_TAG;DU[26]=0;DU[27]=0;dev.queue.writeBuffer(drawUni,0,DF);
 const bg=dev.createBindGroup({layout:drawPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:drawUni}},
  {binding:1,resource:{buffer:sim.livePos()}},
  {binding:2,resource:{buffer:sim.liveVel()}},
  {binding:3,resource:{buffer:sim.liveBody()}},
 ]});
 const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(drawPipe);pass.setBindGroup(0,bg);pass.draw(6,sim.n);pass.end();
 return out;
};

function mount(){
 const host=document.querySelector('[data-panel="realism"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5MicroDropM59UI'))return;
 const d=document.createElement('div');d.id='v5MicroDropM59UI';d.style.cssText='margin-top:8px';d.innerHTML=`<div class="v5Slider"><label>SPLASH DROPLET SIZE</label><input type="range" min="0.32" max="1.00" step="0.02"><div class="v5Val"></div></div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:4px">Sparse airborne PBF fluid keeps its real solver mass but renders as fine refractive microdroplets instead of solver-sized blobs.</div>`;host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.microDropSize;const sync=()=>v.textContent=Number(state.microDropSize).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state.microDropSize=Number(r.value);try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}sync();};d.onpointerdown=e=>e.stopPropagation();
}
setInterval(mount,600);mount();
window.__v5MicroDropsM59={online:true,backend:'pbf-microdrop-surface-m59',dropTag:DROP_TAG,waterfallTag:WF_TAG};
console.info('[Fluid V5 M5.9] sparse airborne PBF fluid uses microdroplet surfacing.');
