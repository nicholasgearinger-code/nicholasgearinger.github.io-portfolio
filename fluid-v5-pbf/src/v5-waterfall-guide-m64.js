// Fluid V5 M6.4 sheet-material pass for the native PBF waterfall.
// A short inlet boundary keeps the broad source well conditioned. Downstream, a local neighbour pass
// damps sideways atomization without pulling the liquid into gelatinous balls. The material support
// fades through the lower fall so streaks and breakup emerge naturally before the plunge.

const sim=window.__sim,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!state)throw new Error('Fluid V5 M6.4 waterfall sheet material: PBF runtime unavailable.');
const dev=sim.dev,TAG=window.__v5WaterfallTag||0x5746,WG=256;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quality=new URLSearchParams(location.search).get('quality')||'medium';
if(!Number.isFinite(Number(state.waterfallCoherence)))state.waterfallCoherence=.92;
state.waterfallCoherence=clamp(Number(state.waterfallCoherence),.50,1.15);
const active=()=>state.scenario==='waterfall-m62';
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55),surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.92,b[1]*.35),surface+d*8,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.10,b[0]*.020),vx=.175+.035*flow,vy=-.020-.010*flow;
 const requested=b[2]*clamp(Number(state.waterfallWidth)||.72,.64,.82);
 const minAcross=quality==='low'?18:quality==='high'?30:24,maxAcross=quality==='low'?26:quality==='high'?42:34;
 const across=clamp(Math.round(requested/d),minAcross,maxAcross),width=(across-1)*d;
 const thick=quality==='low'?3:4;
 return{b,d,surface,topY,nozzleX,vx,vy,width,across,thick,centreZ:b[2]*.5};
}

const uni=dev.createBuffer({label:'fluidV5M64SheetUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(20),U=new Uint32Array(F.buffer);
let tempVel=null,tempCapacity=0,submits=0,savedXpbd=null;

function ensureTemp(){
 const cap=Math.max(1,sim.cap||sim.n||1);
 if(tempVel&&cap<=tempCapacity)return;
 tempVel?.destroy?.();tempCapacity=cap;
 tempVel=dev.createBuffer({label:'fluidV5M64SheetTempVel',size:cap*16,usage:GPUBufferUsage.STORAGE});
}

const inletWGSL=`
struct Cfg {
 g0: vec4<f32>,
 g1: vec4<f32>,
 g2: vec4<f32>,
 ids: vec4<u32>,
 grid: vec4<u32>,
}
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage,read_write> P: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> V: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> B: array<vec4<u32>>;
fn hash1(x0:u32)->f32{
 var x:u32=x0;
 x=x^(x>>16u);x=x*0x7feb352du;x=x^(x>>15u);x=x*0x846ca68bu;x=x^(x>>16u);
 return f32(x)/4294967295.0;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=C.ids.x){return;}
 let ph=B[i];if(ph.w!=C.ids.y){return;}
 var p=P[i];var v=V[i];
 let surface=C.g0.x;let topY=C.g0.y;let nozzleX=C.g0.z;let centreZ=C.g0.w;
 let width=C.g1.x;let spacing=C.g1.y;let vx0=C.g1.z;let vy0=C.g1.w;
 let fall=clamp((topY-p.y)/max(topY-surface,0.0001),0.0,1.0);
 let lipWeight=1.0-smoothstep(0.06,0.30,fall);
 if(lipWeight<=0.0001){return;}
 let stable=select(i+1u,ph.y,ph.y!=0u);
 let across=max(C.ids.z,1u);let thick=max(C.ids.w,1u);
 let lane=stable%across;let layer=(stable/across)%thick;
 let laneU=(f32(lane)+0.5)/f32(across);
 let targetZ=centreZ+(laneU-0.5)*width;
 let targetX=nozzleX+(f32(layer)-f32(thick-1u)*0.5)*spacing*0.52;
 let seed=hash1(stable+37u);
 let strength=0.82*C.g2.y*lipWeight;
 let maxCorr=spacing*0.12*lipWeight;
 p.x=p.x+clamp((targetX-p.x)*strength,-maxCorr,maxCorr);
 p.z=p.z+clamp((targetZ-p.z)*strength,-maxCorr,maxCorr);
 let targetV=vec3<f32>(vx0+(seed-0.5)*0.003,vy0,(seed-0.5)*0.003);
 v.xyz=mix(v.xyz,targetV,clamp(0.27*strength,0.0,0.27));
 P[i]=p;V[i]=v;
}`;

const gatherWGSL=`
struct Cfg {
 g0: vec4<f32>,
 g1: vec4<f32>,
 g2: vec4<f32>,
 ids: vec4<u32>,
 grid: vec4<u32>,
}
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage,read> P: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> V: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> B: array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> cellStart: array<u32>;
@group(0) @binding(5) var<storage,read_write> outV: array<vec4<f32>>;
fn cellOf(p:vec3<f32>)->vec3<i32>{
 let h=max(C.g2.x,0.0001);
 let gx=i32(C.grid.x);let gy=i32(C.grid.y);let gz=i32(C.grid.z);
 return clamp(vec3<i32>(floor(p/h)),vec3<i32>(0),vec3<i32>(gx-1,gy-1,gz-1));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=C.ids.x){return;}
 let ph=B[i];if(ph.w!=C.ids.y){return;}
 let pi=P[i].xyz;let vi=V[i].xyz;let cell=cellOf(pi);let support=max(C.g2.x,0.0001);
 var sumW:f32=0.0;var sumV:vec3<f32>=vec3<f32>(0.0);var sumP:vec3<f32>=vec3<f32>(0.0);var count:u32=0u;
 for(var dz:i32=-1;dz<=1;dz=dz+1){
  let z=cell.z+dz;if(z<0||z>=i32(C.grid.z)){continue;}
  for(var dy:i32=-1;dy<=1;dy=dy+1){
   let y=cell.y+dy;if(y<0||y>=i32(C.grid.y)){continue;}
   for(var dx:i32=-1;dx<=1;dx=dx+1){
    let x=cell.x+dx;if(x<0||x>=i32(C.grid.x)){continue;}
    let ci=u32((z*i32(C.grid.y)+y)*i32(C.grid.x)+x);
    let begin=cellStart[ci];let end=cellStart[ci+1u];
    for(var j:u32=begin;j<end;j=j+1u){
     if(j==i||B[j].w!=C.ids.y){continue;}
     let pj=P[j].xyz;let r=pj-pi;let dist=length(r);
     if(dist>=support||dist<=0.00001){continue;}
     let q=1.0-dist/support;let w=q*q*(3.0-2.0*q);
     sumW=sumW+w;sumV=sumV+V[j].xyz*w;sumP=sumP+pj*w;count=count+1u;
    }
   }
  }
 }
 if(count<2u||sumW<=0.0001){outV[i]=vec4<f32>(vi,0.0);return;}
 let avgV=sumV/sumW;let avgP=sumP/sumW;
 let fall=clamp((C.g0.y-pi.y)/max(C.g0.y-C.g0.x,0.0001),0.0,1.2);
 // Strongest in the upper/middle sheet, then fades so the lower third can stretch and tear.
 let streamWeight=1.0-smoothstep(0.62,0.88,fall);
 let coherence=C.g2.y;
 // Prefer velocity alignment over positional attraction: suppress explosive lateral spray without
 // gathering the sheet into large PBF balls.
 let visc=(avgV-vi)*vec3<f32>(0.32,0.035,0.32)*coherence*streamWeight;
 let offset=avgP-pi;
 let coh=vec3<f32>(offset.x*0.42,offset.y*0.035,offset.z*0.42)*coherence*streamWeight;
 var dv=visc+coh;let mag=length(dv);let maxDv=0.038+0.012*coherence;
 if(mag>maxDv){dv=dv*(maxDv/mag);}
 outV[i]=vec4<f32>(vi+dv,0.0);
}`;

const applyWGSL=`
struct Cfg {
 g0: vec4<f32>,
 g1: vec4<f32>,
 g2: vec4<f32>,
 ids: vec4<u32>,
 grid: vec4<u32>,
}
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage,read_write> V: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> B: array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> inV: array<vec4<f32>>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=C.ids.x||B[i].w!=C.ids.y){return;}
 V[i]=vec4<f32>(inV[i].xyz,V[i].w);
}`;

async function makePipe(code,label){
 const mod=dev.createShaderModule({code,label:label+'WGSL'});
 if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error(`Fluid V5 M6.4 ${label} WGSL: `+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
 }
 return dev.createComputePipelineAsync({label,layout:'auto',compute:{module:mod,entryPoint:'main'}});
}
const [inletPipe,gatherPipe,applyPipe]=await Promise.all([
 makePipe(inletWGSL,'fluidV5M64InletBoundary'),
 makePipe(gatherWGSL,'fluidV5M64SheetGather'),
 makePipe(applyWGSL,'fluidV5M64SheetApply')
]);

function streamPhysics(){
 if(!active()||!sim.n||ui?.paused||!sim.buf?.cellStart||!sim.gridDim)return;
 ensureTemp();const g=geom();
 F[0]=g.surface;F[1]=g.topY;F[2]=g.nozzleX;F[3]=g.centreZ;
 F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;
 F[8]=Math.max(Number(sim.h)||g.d*2,g.d*1.25);F[9]=state.waterfallCoherence;F[10]=0;F[11]=0;
 U[12]=sim.n;U[13]=TAG;U[14]=g.across;U[15]=g.thick;
 U[16]=sim.gridDim[0];U[17]=sim.gridDim[1];U[18]=sim.gridDim[2];U[19]=0;
 dev.queue.writeBuffer(uni,0,F);
 const pos=sim.livePos(),vel=sim.liveVel(),body=sim.liveBody();
 const inletBG=dev.createBindGroup({layout:inletPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:body}}
 ]});
 const gatherBG=dev.createBindGroup({layout:gatherPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:body}},{binding:4,resource:{buffer:sim.buf.cellStart}},{binding:5,resource:{buffer:tempVel}}
 ]});
 const applyBG=dev.createBindGroup({layout:applyPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:vel}},{binding:2,resource:{buffer:body}},{binding:3,resource:{buffer:tempVel}}
 ]});
 const enc=dev.createCommandEncoder({label:'fluidV5M64SheetEncoder'});
 let cp=enc.beginComputePass();cp.setPipeline(inletPipe);cp.setBindGroup(0,inletBG);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/WG)));cp.end();
 cp=enc.beginComputePass();cp.setPipeline(gatherPipe);cp.setBindGroup(0,gatherBG);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/WG)));cp.end();
 cp=enc.beginComputePass();cp.setPipeline(applyPipe);cp.setBindGroup(0,applyBG);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/WG)));cp.end();
 dev.queue.submit([enc.finish()]);submits++;
 const S=window.__v5WaterfallGuideM64;if(S){S.submits=submits;S.surfaceY=g.surface;S.width=g.width;S.coherence=state.waterfallCoherence;S.inletOnly=true;S.neighborViscosity=true;S.physicalCohesion=true;S.support=F[8];S.lowerBreakup=true;}
}

const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
 const on=active();
 if(on){
  if(savedXpbd===null)savedXpbd=Number.isFinite(Number(state.xpbdDensity))?Number(state.xpbdDensity):.62;
  state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.82);
 }else if(savedXpbd!==null){state.xpbdDensity=savedXpbd;savedXpbd=null;}
 const out=baseStep(frameDt);
 if(on){try{streamPhysics();}catch(err){const S=window.__v5WaterfallGuideM64;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.4 waterfall sheet]',err);}}
 return out;
};

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallGuideM64UI'))return;
 const d=document.createElement('div');d.id='v5WaterfallGuideM64UI';d.style.cssText='margin-top:8px';
 d.innerHTML=`<div class="v5Slider"><label>SHEET COHERENCE</label><input type="range" min="0.50" max="1.15" step="0.05"><div class="v5Val"></div></div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:4px">Particle-neighbour viscosity stabilizes the upper sheet without clumping it. Support fades through the lower fall so ribbons, droplets and impact breakup remain solver-driven.</div>`;
 host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.waterfallCoherence;const sync=()=>v.textContent=Number(state.waterfallCoherence).toFixed(2);sync();
 r.oninput=e=>{e.stopPropagation();state.waterfallCoherence=Number(r.value);save();sync();};d.onpointerdown=e=>e.stopPropagation();
}
setInterval(mount,600);mount();
window.__v5WaterfallGuideM64={online:true,backend:'native-pbf-sheet-material-m64',submits:0,error:'',surfaceY:0,width:0,coherence:state.waterfallCoherence,inletOnly:true,neighborViscosity:true,physicalCohesion:true,lowerBreakup:true,support:0};
console.info('[Fluid V5 M6.4] PBF waterfall sheet material + lower-fall breakup pass online.');
