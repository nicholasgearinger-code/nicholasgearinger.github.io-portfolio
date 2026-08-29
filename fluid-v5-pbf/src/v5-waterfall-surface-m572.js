// Fluid V5 M5.9 deterministic fixed-mass waterfall circulation.
// The real PBF waterfall remains bounded and fully participates in the pressure solve, but the
// circulation no longer depends on particles successfully crossing one fragile impact plane.
// Tagged waterfall parcels carry a GPU-side age in phase.z. Contact/overshoot can recycle them
// early, while a flight-time watchdog guarantees every parcel returns to the lip eventually.
// The validated M5.8.1 thin-sheet renderer is retained with its obsolete recycle pass disabled and
// with substantially finer/narrower waterfall splats so solver-particle scale is not exposed.

const baseUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/5ed701b737ef39093c403e9933746a19685b0a28/fluid-v5-pbf/src/v5-waterfall-surface-m572.js';
const response=await fetch(baseUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M5.9 base waterfall surface unavailable (${response.status}).`);
let baseSrc=await response.text();

// Disable M5.8.1's render-time recycle pump. M5.9 owns circulation from sim.step, after the real
// PBF solve, so rendering no longer controls whether the waterfall continues.
const legacy=' if(enc&&sim.n>0){';
if(!baseSrc.includes(legacy))throw new Error('Fluid V5 M5.9: legacy waterfall recycle signature changed.');
baseSrc=baseSrc.replace(legacy,' if(false&&enc&&sim.n>0){');

// Make the dedicated waterfall representation much finer than a solver particle. The physical
// particle stays the same size; only its airborne visual footprint becomes a narrow fibrous streak.
baseSrc=baseSrc.replace('dir*C.tune.y*1.42','dir*C.tune.y*.72');
baseSrc=baseSrc.replace('side*C.tune.y*.68*C.tune.z','side*C.tune.y*.22*C.tune.z');
baseSrc=baseSrc.replace('let halfW=max(length(side2)*.92,1.0/max(C.screen.x,1.0));let halfL=max(al*(.76+.20*speedGain),1.7/max(C.screen.y,1.0));','let halfW=max(length(side2)*.68,.55/max(C.screen.x,1.0));let halfL=max(al*(1.05+.32*speedGain),.85/max(C.screen.y,1.0));');
baseSrc=baseSrc.replace('let sx=1.0-smoothstep(.58,1.0,ax);let sy=1.0-smoothstep(.76,1.0,ay);','let sx=1.0-smoothstep(.40,1.0,ax);let sy=1.0-smoothstep(.82,1.0,ay);');
baseSrc=baseSrc.replace('let alpha=mask*(.085+.072*aerate);','let alpha=mask*(.070+.060*aerate);');

const blobUrl=URL.createObjectURL(new Blob([baseSrc],{type:'text/javascript'}));
try{await import(blobUrl);}finally{URL.revokeObjectURL(blobUrl);}

const sim=window.__sim,state=window.__v5State;
if(!sim?.dev||!state)throw new Error('Fluid V5 M5.9 waterfall circulation: runtime unavailable.');
const dev=sim.dev,TAG=window.__v5WaterfallTag||0x5746;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const active=()=>state.scenario==='waterfall-m58';

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)-(window.__v5WaterfallM57?.target||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
window.__v5WaterfallSurfaceY=slabSurfaceY;

// 64-byte uniform.
// geo0 = topY, surfaceY, nozzleX, centreZ
// geo1 = width, spacing, vx, vy
// geo2 = impactX, contactY, overshootX, maxAgeMs
// meta = n, tag, dtMs, enabled
const uni=dev.createBuffer({label:'fluidV5M59WaterfallCycleUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
const cycleWGSL=`
struct U{geo0:vec4f,geo1:vec4f,geo2:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>phase:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x){return;}
 var ph=phase[i];if(ph.w!=C.meta.y){return;}
 if(C.meta.w==0u){phase[i]=vec4u(ph.x,ph.y,0u,0u);return;}
 let age=min(ph.z+C.meta.z,60000u);
 let p=P[i].xyz;let v=V[i].xyz;
 let contact=p.y<=C.geo2.y;
 let overshoot=p.x>=C.geo2.z;
 let timeout=f32(age)>=C.geo2.w;
 if(!(contact||overshoot||timeout)){
  phase[i]=vec4u(ph.x,ph.y,age,ph.w);
  return;
 }
 let base=select(i+1u,ph.y,ph.y!=0u);
 let cycle=max(1u,age/max(C.meta.z,1u));
 let s=base^(cycle*2246822519u)^(C.meta.x*3266489917u);
 let h0=hash1(s+17u);let h1=hash1(s+101u);let h2=hash1(s+313u);let h3=hash1(s+911u);
 // Stable broad curtain at the lip, with only millimetre-scale visual/physical jitter.
 let z=C.geo0.w+(h0-.5)*C.geo1.x*.97;
 let x=C.geo0.z+(h1-.5)*C.geo1.y*.12;
 let y=C.geo0.x-C.geo1.y*(.08+1.65*h2);
 let vz=(h3-.5)*.022;
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(h2-.5)*.012,C.geo1.w-h1*.020,vz,0.0);
 phase[i]=vec4u(ph.x,ph.y,0u,ph.w);
}`;
const mod=dev.createShaderModule({code:cycleWGSL,label:'fluidV5M59WaterfallCycleWGSL'});
if(typeof mod.getCompilationInfo==='function'){
 const info=await mod.getCompilationInfo();
 const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M5.9 cycle WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M59DeterministicWaterfallCycle',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let frame=0,lastRecycles=0;

function cycleAfterSolve(frameDt){
 if(!sim.n)return;
 const b=sim.params.box,d=sim.params.spacing;
 const flow=clamp(Number(state.waterfallFlow)||1,.45,1.55);
 const surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.79,b[1]*.315),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.65,b[0]*.038);
 const vx=.23+.085*flow,vy=-.055-.030*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface);
 const fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const width=Math.min(b[2]*.92,Math.max(d*14,b[2]*clamp(Number(state.waterfallWidth)||.78,.48,.92)));
 const advanced=Math.max(0,Number(sim.lastAdvanced)||Number(frameDt)||0);
 const dtMs=Math.max(1,Math.min(100,Math.round(advanced*1000)));
 UF[0]=topY;UF[1]=surface;UF[2]=nozzleX;UF[3]=b[2]*.50;
 UF[4]=width;UF[5]=d;UF[6]=vx;UF[7]=vy;
 UF[8]=impactX;
 // Contact still allows immediate reuse, but the watchdog is authoritative if the pressure solve
 // holds a parcel above the surface. Give roughly 0.22 s after ballistic impact before timeout.
 UF[9]=surface+d*.48;
 UF[10]=impactX+d*.80;
 UF[11]=(fallT+.22)*1000;
 UU[12]=sim.n;UU[13]=TAG;UU[14]=dtMs;UU[15]=active()?1:0;
 dev.queue.writeBuffer(uni,0,UF);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},
  {binding:1,resource:{buffer:sim.livePos()}},
  {binding:2,resource:{buffer:sim.liveVel()}},
  {binding:3,resource:{buffer:sim.liveBody()}},
 ]});
 const enc=dev.createCommandEncoder({label:'fluidV5M59WaterfallCycleEncoder'});
 const cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 dev.queue.submit([enc.finish()]);
 const S=window.__v5WaterfallCycleM59;if(S){S.surfaceY=surface;S.impactX=impactX;S.maxAgeMs=UF[11];S.frame=++frame;}
}

// Run circulation in the simulation path, never in rendering. Queue order guarantees the cycle
// pass sees the just-solved PBF positions and the next solve sees the returned inlet parcels.
const previousStep=sim.step.bind(sim);
sim.step=function(frameDt){
 const out=previousStep(frameDt);
 try{cycleAfterSolve(frameDt);}catch(err){console.error('[Fluid V5 M5.9 waterfall cycle] runtime pass failed',err);}
 return out;
};

window.__v5WaterfallCycleM59={online:true,backend:'deterministic-age-contact-cycle-m59',surfaceY:0,impactX:0,maxAgeMs:0,frame:0};
window.__v5WaterfallRecycleM583=window.__v5WaterfallCycleM59;
if(window.__v5WaterfallSurfaceM572)window.__v5WaterfallSurfaceM572.backend='fine-sheet-plus-deterministic-cycle-m59';
setTimeout(()=>{
 const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M5.9';
 document.title='Fluid V5 · M5.9 CONTINUOUS WATERFALL + MICRODROPS';
 window.__fluidV5Version='5.3.9-m59';
},1050);
console.info('[Fluid V5 M5.9] deterministic simulation-path waterfall circulation online.');
