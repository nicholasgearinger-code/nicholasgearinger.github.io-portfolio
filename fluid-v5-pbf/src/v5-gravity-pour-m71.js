// Fluid V5 M7.1 isolated gravity-pour benchmark.
// Standalone/local source: no remote fetch, no shader curtain, no launch velocity, no trajectory guide.
// The same primary PBF water starts at rest in a sampled elevated trough. Opening the physical gate
// removes collision support only; pressure, gravity, density constraints, viscosity and collisions
// determine the outflow, free fall, breakup and lower-pool impact.

const sim=window.__sim,ui=window.__ui,state=window.__v5State,ssfr=window.__ssfr;
if(!sim?.dev||!ui||!state||!ssfr)throw new Error('Fluid V5 M7.1 gravity pour: runtime unavailable.');
const dev=sim.dev;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quality=new URLSearchParams(location.search).get('quality')||'medium';
const ACTIVE='gravity-pour-m71';
const active=()=>state.scenario===ACTIVE;
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}};

if(Number(state.gravityPourRev||0)<4){
 state.gravityPourHeight=.82;
 state.gravityPourWidth=.995;
 state.gravityPourVolume=.52;
 state.gravityPourAutoRelease=true;
 state.gravityPourRev=4;
}
if(!Number.isFinite(Number(state.gravityPourHeight)))state.gravityPourHeight=.82;
if(!Number.isFinite(Number(state.gravityPourWidth)))state.gravityPourWidth=.995;
if(!Number.isFinite(Number(state.gravityPourVolume)))state.gravityPourVolume=.52;
if(typeof state.gravityPourAutoRelease!=='boolean')state.gravityPourAutoRelease=true;
state.gravityPourHeight=clamp(Number(state.gravityPourHeight),.70,.88);
state.gravityPourWidth=clamp(Number(state.gravityPourWidth),.76,.998);
state.gravityPourVolume=clamp(Number(state.gravityPourVolume),.28,.64);
save();

let baselineBoundaryPts=null;
let gateClosed=true;
let releaseTimer=0;
let releasedAt=0;
let savedMaterial=null;
let massReference=0;
let actualSubsteps=0,actualIterations=0;

function geom(){
 const b=sim.params.box,d=sim.params.spacing;
 // Keep enough vertical room above the shelf for a genuinely deep reservoir head while retaining a tall fall.
 const floorY=b[1]*clamp(Number(state.gravityPourHeight)||.82,.70,.88);
 const lipX=b[0]*.70;
 const backX=Math.max(d*1.10,b[0]*.035);
 const width=b[2]*clamp(Number(state.gravityPourWidth)||.995,.76,.998);
 const z0=(b[2]-width)*.5,z1=z0+width;
 const wallTop=Math.min(b[1]-d*.75,floorY+Math.max(d*8.0,b[1]*.15));
 const upperNx=Math.max(3,Math.floor((lipX-backX-d*2.0)/d));
 const upperNz=Math.max(3,Math.floor((width-d*2.2)/d));
 const lowerNx=Math.max(3,Math.floor((b[0]-3*d)/d));
 const lowerNz=Math.max(3,Math.floor((b[2]-3*d)/d));
 const nFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const upperWanted=Math.round(nFluid*clamp(Number(state.gravityPourVolume)||.52,.28,.64));
 const maxUpperLayers=Math.max(4,Math.floor((wallTop-floorY-d*.55)/d));
 const upperCap=Math.max(1,upperNx*upperNz*maxUpperLayers);
 const upperN=Math.min(upperWanted,upperCap),lowerN=Math.max(1,nFluid-upperN);
 const lowerLayers=Math.ceil(lowerN/(lowerNx*lowerNz));
 const lowerSurface=Math.min(floorY-d*7,d*(.78+lowerLayers));
 const drop=Math.max(0,floorY-lowerSurface);
 const headLayers=Math.max(1,Math.ceil(upperN/Math.max(1,upperNx*upperNz)));
 return{b,d,floorY,lipX,backX,width,z0,z1,wallTop,upperNx,upperNz,lowerNx,lowerNz,nFluid,upperN,lowerN,lowerSurface,drop,headLayers,maxUpperLayers};
}

function buildBoundary(includeGate){
 const g=geom(),d=g.d,h=sim.h,b=g.b;
 const pts=[],seen=new Set(),qstep=d*.38;
 const add=(x,y,z)=>{
  x=clamp(x,0,b[0]);y=clamp(y,0,b[1]);z=clamp(z,0,b[2]);
  const key=`${Math.round(x/qstep)},${Math.round(y/qstep)},${Math.round(z/qstep)}`;
  if(seen.has(key))return;seen.add(key);pts.push(x,y,z);
 };
 const base=baselineBoundaryPts||sim.scene?.boundary?.pts||[];
 for(let i=0;i<base.length;i+=3)add(base[i],base[i+1],base[i+2]);
 const step=d*.88;
 // Real elevated floor. It terminates sharply at lipX: there is no hidden support beyond the edge.
 for(let x=g.backX;x<=g.lipX+step*.12;x+=step)
  for(let z=g.z0;z<=g.z1+step*.12;z+=step){add(x,g.floorY,z);add(x,g.floorY-d*.50,z);}
 // Rear wall and full-width side walls contain a hydrostatic reservoir.
 for(let y=g.floorY;y<=g.wallTop+step*.12;y+=step)
  for(let z=g.z0;z<=g.z1+step*.12;z+=step)add(g.backX,y,z);
 for(const z of [g.z0,g.z1])
  for(let x=g.backX;x<=g.lipX+step*.12;x+=step)
   for(let y=g.floorY;y<=g.wallTop+step*.12;y+=step)add(x,y,z);
 // The removable gate is the ONLY initial restraint on the front face of the elevated water.
 if(includeGate){
  for(let y=g.floorY;y<=g.wallTop+step*.12;y+=step)
   for(let z=g.z0;z<=g.z1+step*.12;z+=step)add(g.lipX,y,z);
 }
 const n=pts.length/3,dim=sim.gridDim;
 const cellOf=(x,y,z)=>[
  Math.min(dim[0]-1,Math.max(0,Math.floor(x/h))),
  Math.min(dim[1]-1,Math.max(0,Math.floor(y/h))),
  Math.min(dim[2]-1,Math.max(0,Math.floor(z/h)))
 ];
 const keyOf=(a,c,e)=>(e*dim[1]+c)*dim[0]+a,buckets=new Map();
 for(let i=0;i<n;i++){
  const [a,c,e]=cellOf(pts[i*3],pts[i*3+1],pts[i*3+2]),k=keyOf(a,c,e);
  let arr=buckets.get(k);if(!arr){arr=[];buckets.set(k,arr);}arr.push(i);
 }
 const coef=315/(64*Math.PI*Math.pow(h,9)),h2=h*h,psi=new Float32Array(Math.max(1,n));
 for(let i=0;i<n;i++){
  const [a,c,e]=cellOf(pts[i*3],pts[i*3+1],pts[i*3+2]);let sum=0;
  for(let dz=-1;dz<=1;dz++){const zz=e+dz;if(zz<0||zz>=dim[2])continue;
   for(let dy=-1;dy<=1;dy++){const yy=c+dy;if(yy<0||yy>=dim[1])continue;
    for(let dx=-1;dx<=1;dx++){const xx=a+dx;if(xx<0||xx>=dim[0])continue;
     const arr=buckets.get(keyOf(xx,yy,zz));if(!arr)continue;
     for(const j of arr){const rx=pts[i*3]-pts[j*3],ry=pts[i*3+1]-pts[j*3+1],rz=pts[i*3+2]-pts[j*3+2];const r2=rx*rx+ry*ry+rz*rz;if(r2>=h2)continue;const t=h2-r2;sum+=t*t*t;}
    }
   }
  }
  sum*=coef;psi[i]=sum>0?sim.params.restDensity/sum:0;
 }
 return{pts,psi,count:n,g};
}

function installBoundary(includeGate){
 const bd=buildBoundary(includeGate),n=bd.count,raw=new Float32Array(Math.max(1,n)*4);
 for(let i=0;i<n;i++){raw[i*4]=bd.pts[i*3];raw[i*4+1]=bd.pts[i*3+1];raw[i*4+2]=bd.pts[i*3+2];}
 const sorted=sim.sortBoundary(raw,bd.psi,n),ST=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 sim.buf.bpos?.destroy?.();sim.buf.bpsi?.destroy?.();sim.buf.bcellStart?.destroy?.();
 sim.buf.bpos=dev.createBuffer({label:'fluidV5M71BoundaryPos',size:Math.max(16,n*16),usage:ST});
 sim.buf.bpsi=dev.createBuffer({label:'fluidV5M71BoundaryPsi',size:Math.max(16,n*4),usage:ST});
 sim.buf.bcellStart=dev.createBuffer({label:'fluidV5M71BoundaryCellStart',size:Math.max(16,(sim.nCells+2)*4),usage:ST});
 dev.queue.writeBuffer(sim.buf.bpos,0,sorted.sortedPos);dev.queue.writeBuffer(sim.buf.bpsi,0,sorted.sortedPsi);dev.queue.writeBuffer(sim.buf.bcellStart,0,sorted.cellStart);
 sim.nBoundary=n;sim.scene.boundary={pts:bd.pts,psi:bd.psi,count:n};sim.uploadParams(1/240);sim.buildBindGroups();
 const S=window.__v5GravityPourM71;if(S){S.boundarySamples=n;S.gateClosed=includeGate;S.dropHeight=bd.g.drop;}
}

const seedUni=dev.createBuffer({label:'fluidV5M71SeedUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(28),SU=new Uint32Array(SF.buffer);
const seedCounter=dev.createBuffer({label:'fluidV5M71SeedCounter',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
const seedWGSL=`
struct Cfg{g0:vec4<f32>,g1:vec4<f32>,g2:vec4<f32>,dims:vec4<u32>,meta:vec4<u32>,pad0:vec4<f32>,pad1:vec4<f32>}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4<f32>>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4<f32>>;
@group(0)@binding(3)var<storage,read>B:array<vec4<u32>>;
@group(0)@binding(4)var<storage,read_write>counter:atomic<u32>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3<u32>){
 let i=gid.x;if(i>=C.meta.x||B[i].x!=0u){return;}let rank=atomicAdd(&counter,1u);let d=C.g0.w;var p=vec3<f32>(0.0);
 if(rank<C.meta.y){
  let nx=max(C.dims.x,1u),nz=max(C.dims.y,1u);let ix=rank%nx;let q=rank/nx;let iz=q%nz;let iy=q/nz;
  // Uniform full-width lattice: no narrow nozzle and no velocity assignment.
  p=vec3<f32>(C.g0.x+d*(1.10+f32(ix)),C.g0.y+d*(.82+f32(iy)),C.g0.z+d*(1.10+f32(iz)));
 }else{
  let r=rank-C.meta.y;let nx=max(C.dims.z,1u),nz=max(C.dims.w,1u);let ix=r%nx;let q=r/nx;let iz=q%nz;let iy=q/nz;
  p=vec3<f32>(d*(1.55+f32(ix)),d*(.78+f32(iy)),d*(1.55+f32(iz)));
 }
 P[i]=vec4<f32>(p,1.0);V[i]=vec4<f32>(0.0,0.0,0.0,0.0);
}`;
const seedMod=dev.createShaderModule({code:seedWGSL,label:'fluidV5M71SeedWGSL'});
if(typeof seedMod.getCompilationInfo==='function'){
 const info=await seedMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M7.1 seed WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const seedPipe=await dev.createComputePipelineAsync({label:'fluidV5M71Seed',layout:'auto',compute:{module:seedMod,entryPoint:'main'}});

function seedWater(){
 const g=geom();SF.fill(0);SF[0]=g.backX;SF[1]=g.floorY;SF[2]=g.z0;SF[3]=g.d;SF[4]=g.lipX;SF[5]=g.z1;SF[6]=g.lowerSurface;SF[7]=0;
 SU[8]=g.upperNx;SU[9]=g.upperNz;SU[10]=g.lowerNx;SU[11]=g.lowerNz;SU[12]=sim.n;SU[13]=g.upperN;SU[14]=g.nFluid;SU[15]=0;
 dev.queue.writeBuffer(seedUni,0,SF);const enc=dev.createCommandEncoder({label:'fluidV5M71SeedEncoder'});enc.clearBuffer(seedCounter);
 const bg=dev.createBindGroup({layout:seedPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:seedUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}},{binding:4,resource:{buffer:seedCounter}}]});
 const cp=enc.beginComputePass();cp.setPipeline(seedPipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();dev.queue.submit([enc.finish()]);sim.primeGrid();
 massReference=Number(sim.n)||0;
 const S=window.__v5GravityPourM71;if(S){S.upperParticles=g.upperN;S.lowerParticles=g.lowerN;S.dropHeight=g.drop;S.width=g.width;S.headLayers=g.headLayers;S.massReference=massReference;}
}

function tune(on){
 if(on){
  window.__v5SolverFloor={owner:'m71',substeps:quality==='low'?4:quality==='high'?6:5,iterations:quality==='low'?6:quality==='high'?10:8,maxSubsteps:quality==='low'?7:quality==='high'?10:9,cfl:true};
  if(!savedMaterial)savedMaterial={xsphC:sim.params.xsphC,sCorrK:sim.params.sCorrK,surfaceTensionK:sim.params.surfaceTensionK,xpbd:Number(state.xpbdDensity)};
  sim.params.xsphC=clamp(Number(sim.params.xsphC)||.034,.026,.042);
  sim.params.sCorrK=Math.min(Number(sim.params.sCorrK)||.032,.042);
  sim.params.surfaceTensionK=Math.min(Number(sim.params.surfaceTensionK)||.050,.065);
  state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.92);
 }else{
  if(window.__v5SolverFloor?.owner==='m71')window.__v5SolverFloor=null;
  if(savedMaterial){sim.params.xsphC=savedMaterial.xsphC;sim.params.sCorrK=savedMaterial.sCorrK;sim.params.surfaceTensionK=savedMaterial.surfaceTensionK;if(Number.isFinite(savedMaterial.xpbd))state.xpbdDensity=savedMaterial.xpbd;savedMaterial=null;}
 }
}

function release(){
 if(!active()||!gateClosed)return;gateClosed=false;clearTimeout(releaseTimer);releaseTimer=0;installBoundary(false);sim.primeGrid();releasedAt=performance.now();sync();
}
function scheduleAutoRelease(){clearTimeout(releaseTimer);if(active()&&state.gravityPourAutoRelease&&gateClosed)releaseTimer=setTimeout(release,1450);}
function setupAfterReset(){
 if(!active())return;
 baselineBoundaryPts=[...(sim.scene?.boundary?.pts||[])];gateClosed=true;releasedAt=0;installBoundary(true);seedWater();tune(true);scheduleAutoRelease();
 const S=window.__v5GravityPourM71;if(S){S.active=true;S.ready=true;S.gateClosed=true;S.error='';}
}
const baseReset=sim.reset.bind(sim);
sim.reset=function(params){const out=baseReset(params);try{setupAfterReset();}catch(err){const S=window.__v5GravityPourM71;if(S){S.ready=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M7.1 gravity pour setup]',err);}return out;};
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
 tune(active());const out=baseStep(frameDt);
 if(active()){
  actualSubsteps=Math.max(1,Number(sim.lastSubsteps)||Number(sim.params.substeps)||0);
  actualIterations=Math.max(1,Number(sim.lastIterations)||Number(sim.params.iterations)||0);
  const S=window.__v5GravityPourM71;if(S){S.actualSubsteps=actualSubsteps;S.actualIterations=actualIterations;S.massCurrent=Number(sim.n)||0;S.massDrift=(Number(sim.n)||0)-massReference;S.massConserved=S.massDrift===0;}
 }
 return out;
};

// Strict benchmark isolation: legacy source modules cannot inject new primary PBF water while M7.1 is active.
if(sim.appendFluid&&!sim.__m71AppendGuard){
 const append=sim.appendFluid.bind(sim);sim.__m71AppendGuard={base:append,blockedParticles:0};
 sim.appendFluid=function(points,vels,...rest){
  if(active()){const n=Math.floor((points?.length||0)/3);sim.__m71AppendGuard.blockedParticles+=n;const S=window.__v5GravityPourM71;if(S)S.blockedAppendParticles=sim.__m71AppendGuard.blockedParticles;return 0;}
  return append(points,vels,...rest);
 };
}

function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function resetScene(){const b=document.getElementById('reset')||document.getElementById('resetV4');if(b)b.click();else sim.reset(sim.params);}
function choose(){state.scenario=ACTIVE;ui.pouring=false;stopWave();save();resetScene();state.scenario=ACTIVE;save();sync();}
function scheduleRebuild(){clearTimeout(releaseTimer);releaseTimer=setTimeout(()=>{if(active())resetScene();},360);}

function sync(){
 const g=geom(),S=window.__v5GravityPourM71,drift=(Number(sim.n)||0)-massReference;
 const st=document.getElementById('v5GravityPourM71Status');if(st)st.textContent=`${g.upperN.toLocaleString()} elevated + ${g.lowerN.toLocaleString()} pool · ${g.headLayers} head layers · ${g.drop.toFixed(2)} m drop · gate ${gateClosed?'CLOSED':'OPEN'}`;
 const hv=document.getElementById('v5M71HeightVal');if(hv)hv.textContent=`${g.drop.toFixed(2)} m`;
 const wv=document.getElementById('v5M71WidthVal');if(wv)wv.textContent=`${Math.round(state.gravityPourWidth*100)}%`;
 const vv=document.getElementById('v5M71VolumeVal');if(vv)vv.textContent=`${Math.round(g.upperN/g.nFluid*100)}% actual`;
 const rb=document.getElementById('v5M71Release');if(rb){rb.disabled=!active()||!gateClosed;rb.textContent=gateClosed?'RELEASE GATE':'GATE OPEN';}
 const ab=document.getElementById('v5M71Auto');if(ab){ab.textContent=`AUTO RELEASE: ${state.gravityPourAutoRelease?'ON':'OFF'}`;ab.classList.toggle('active',state.gravityPourAutoRelease);}
 const stats=document.getElementById('v4stats');
 if(stats&&active()){
  const base=stats.textContent.split('\n').filter(x=>!x.startsWith('M7.1 SOLVE')).slice(0,7);
  base.push(`M7.1 SOLVE ${actualSubsteps||sim.params.substeps} sub · ${actualIterations||sim.params.iterations} iter · mass Δ${drift} · gate ${gateClosed?'CLOSED':'OPEN'}`);
  stats.textContent=base.join('\n');
 }
 const mode=document.getElementById('v4mode');if(mode&&active())mode.textContent='M7.1 GRAVITY POUR';
 if(S){S.active=active();S.gateClosed=gateClosed;S.massDrift=drift;S.massConserved=drift===0;S.solverFloor=window.__v5SolverFloor||null;}
}

function mount(){
 const h=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!h||document.getElementById('v5GravityPourM71'))return;
 const d=document.createElement('div');d.id='v5GravityPourM71';d.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.22);border-radius:10px;background:rgba(4,17,24,.62)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">ISOLATED GRAVITY POUR · M7.1</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Primary PBF water only. Full-width water begins motionless behind a sampled gate; there are no legacy waterfall/rain sources, no analytic curtain, no launch velocity and no trajectory guide.</div><div class="v5Slider" style="margin-top:8px"><label>POUR HEIGHT</label><input id="v5M71Height" type="range" min="0.70" max="0.88" step="0.005"><div class="v5Val" id="v5M71HeightVal"></div></div><div class="v5Slider"><label>OPENING WIDTH</label><input id="v5M71Width" type="range" min="0.76" max="0.998" step="0.005"><div class="v5Val" id="v5M71WidthVal"></div></div><div class="v5Slider"><label>ELEVATED WATER</label><input id="v5M71Volume" type="range" min="0.28" max="0.64" step="0.02"><div class="v5Val" id="v5M71VolumeVal"></div></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px"><button id="v5M71Release" class="v5Btn" type="button">RELEASE GATE</button><button id="v5M71Replay" class="v5Btn" type="button">RESET POUR</button><button id="v5M71Auto" class="v5Btn" type="button"></button></div><div id="v5GravityPourM71Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;h.appendChild(d);
 const height=d.querySelector('#v5M71Height'),width=d.querySelector('#v5M71Width'),volume=d.querySelector('#v5M71Volume');height.value=state.gravityPourHeight;width.value=state.gravityPourWidth;volume.value=state.gravityPourVolume;
 height.oninput=e=>{state.gravityPourHeight=clamp(Number(e.target.value),.70,.88);save();sync();scheduleRebuild();};width.oninput=e=>{state.gravityPourWidth=clamp(Number(e.target.value),.76,.998);save();sync();scheduleRebuild();};volume.oninput=e=>{state.gravityPourVolume=clamp(Number(e.target.value),.28,.64);save();sync();scheduleRebuild();};
 d.querySelector('#v5M71Release').onclick=e=>{e.stopPropagation();release();};d.querySelector('#v5M71Replay').onclick=e=>{e.stopPropagation();if(active())resetScene();else choose();};d.querySelector('#v5M71Auto').onclick=e=>{e.stopPropagation();state.gravityPourAutoRelease=!state.gravityPourAutoRelease;save();if(state.gravityPourAutoRelease)scheduleAutoRelease();else{clearTimeout(releaseTimer);releaseTimer=0;}sync();};d.onpointerdown=e=>e.stopPropagation();sync();
}

window.__v5GravityPourM71={online:true,backend:'isolated-local-gated-pour-pbf-m71',active:false,ready:false,error:'',gateClosed:true,boundarySamples:0,upperParticles:0,lowerParticles:0,dropHeight:0,width:0,headLayers:0,releasedAt:0,zeroLaunchVelocity:true,physicalGate:true,fixedPrimaryMass:true,legacySources:false,actualSubsteps:0,actualIterations:0,massReference:0,massCurrent:0,massDrift:0,massConserved:true,blockedAppendParticles:0};
setInterval(()=>{mount();sync();},220);mount();sync();
if(new URLSearchParams(location.search).get('m71')==='pour')setTimeout(()=>{try{choose();}catch(err){console.error('[Fluid V5 M7.1 auto-select]',err);}},120);
console.info('[Fluid V5 M7.1] isolated local gravity-pour benchmark online.');
