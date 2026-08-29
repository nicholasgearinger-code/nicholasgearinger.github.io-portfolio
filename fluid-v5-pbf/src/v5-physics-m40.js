// Fluid V5 M4.0 Physics 2.0
// Adds a GPU vorticity-confinement post solve, adaptive physics work, timestep-aware compliance
// stabilization, and an extra hydrodynamic rigid-body drag/wake pass. It reuses the solver's
// existing sorted cellStart grid; no second neighbour structure is built.

const sim=window.__sim,ui=window.__ui,state=window.__v5State;
if(!sim?.dev||!sim?.params||!state)throw new Error('Fluid V5 M4.0 physics: PBF runtime unavailable.');
const dev=sim.dev,WG=256,groups=n=>Math.max(1,Math.ceil(n/WG)),clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

if(typeof state.physicsAuto!=='boolean')state.physicsAuto=true;
if(!Number.isFinite(Number(state.vorticity)))state.vorticity=.72;
if(!Number.isFinite(Number(state.hydroDrag)))state.hydroDrag=.58;
state.vorticity=clamp(Number(state.vorticity),0,1.5);state.hydroDrag=clamp(Number(state.hydroDrag),0,1.25);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

const baseParams={
 substeps:Math.max(1,sim.params.substeps||2),
 iterations:Math.max(1,sim.params.iterations||4),
 xsphC:Number(sim.params.xsphC)||.03,
 cfm:Number(sim.params.cfmEpsilonRel)||.01,
};

const vortUni=dev.createBuffer({label:'fluidV5M40VortUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const VF=new Float32Array(16),VI=new Uint32Array(VF.buffer);
let vortBuf=null,vortCap=0,vortCurl=null,vortApply=null,vortCache=null;
const vortPrelude=`
struct U{box:vec4f,grid:vec4u,meta:vec4f}
@group(0) @binding(0) var<uniform> U0:U;
fn cellOf(p:vec3f)->vec3i{let h=U0.box.w;return clamp(vec3i(floor(p/h)),vec3i(0),vec3i(U0.grid.xyz)-vec3i(1));}
fn cellIndex(c:vec3i)->u32{return u32((c.z*i32(U0.grid.y)+c.y)*i32(U0.grid.x)+c.x);}
fn gradKernel(r:vec3f)->vec3f{let d=length(r);let h=U0.box.w;if(d<1e-5||d>=h){return vec3f(0);}let q=(h-d)/h;return -(q*q/max(d,1e-5))*r;}
`;
const vortCurlWGSL=vortPrelude+`
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> phase:array<vec4u>;
@group(0) @binding(4) var<storage,read> cellStart:array<u32>;
@group(0) @binding(5) var<storage,read_write> omega:array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=U0.grid.w){return;}if(phase[i].x!=0u){omega[i]=vec4f(0);return;}
 let pi=pos[i].xyz;let vi=vel[i].xyz;let c=cellOf(pi);var w=vec3f(0);var norm=0.0;
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}
  for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}
   for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}
    let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
    for(var j=b;j<e;j++){if(j==i||phase[j].x!=0u){continue;}let rij=pi-pos[j].xyz;let r2=dot(rij,rij);if(r2>=U0.box.w*U0.box.w){continue;}
     let g=gradKernel(rij);w+=cross(vel[j].xyz-vi,g);norm+=length(g);}
 }}}
 if(norm>1e-5){w/=norm;}omega[i]=vec4f(w,length(w));
}`;
const vortApplyWGSL=vortPrelude+`
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> phase:array<vec4u>;
@group(0) @binding(4) var<storage,read> cellStart:array<u32>;
@group(0) @binding(5) var<storage,read> omega:array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=U0.grid.w||phase[i].x!=0u){return;}let oi=omega[i].xyz;let om=omega[i].w;if(om<1e-5){return;}
 let pi=pos[i].xyz;let c=cellOf(pi);var grad=vec3f(0);var norm=0.0;
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}
  for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}
   for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}
    let ci=cellIndex(vec3i(x,y,z));let b=cellStart[ci];let e=cellStart[ci+1u];
    for(var j=b;j<e;j++){if(j==i||phase[j].x!=0u){continue;}let rij=pi-pos[j].xyz;if(dot(rij,rij)>=U0.box.w*U0.box.w){continue;}
     let g=gradKernel(rij);grad+=(omega[j].w-om)*g;norm+=length(g);}
 }}}
 if(norm<1e-5){return;}let N=normalize(grad/norm);let f=cross(N,oi);let fl=length(f);if(fl<1e-6){return;}
 let dt=U0.meta.x;let eps=U0.meta.y;let dv=f*(dt*eps);let cap=.18+U0.meta.z*.08;let dl=length(dv);if(dl>cap){dv*=cap/dl;}
 vel[i]=vec4f(vel[i].xyz+dv,vel[i].w);
}`;

const hydroUni=dev.createBuffer({label:'fluidV5M40HydroUniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const HF=new Float32Array(20),HU=new Uint32Array(HF.buffer);
const hydroAccum=dev.createBuffer({label:'fluidV5M40HydroAccum',size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
let hydroGather=null,hydroApply=null,hydroCache=null;
const hydroGatherWGSL=`
struct U{centre:vec4f,bodyVel:vec4f,meta:vec4f,count:vec4u}
@group(0)@binding(0)var<uniform>U0:U;
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read>vel:array<vec4f>;
@group(0)@binding(3)var<storage,read>phase:array<vec4u>;
@group(0)@binding(4)var<storage,read_write>A:array<atomic<i32>>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.count.x||phase[i].x!=0u){return;}
 let r=pos[i].xyz-U0.centre.xyz;let d=length(r);let rad=U0.centre.w;if(d>rad*2.6){return;}let w=1.0-smoothstep(rad*.85,rad*2.6,d);if(w<=0){return;}
 let rel=(vel[i].xyz-U0.bodyVel.xyz)*w;let tq=cross(r,rel);let S=2048.0;
 atomicAdd(&A[0],i32(rel.x*S));atomicAdd(&A[1],i32(rel.y*S));atomicAdd(&A[2],i32(rel.z*S));
 atomicAdd(&A[3],i32(tq.x*S));atomicAdd(&A[4],i32(tq.y*S));atomicAdd(&A[5],i32(tq.z*S));atomicAdd(&A[6],i32(w*S));}
`;
const hydroApplyWGSL=`
struct U{centre:vec4f,bodyVel:vec4f,meta:vec4f,count:vec4u}
@group(0)@binding(0)var<uniform>U0:U;
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>vel:array<vec4f>;
@group(0)@binding(3)var<storage,read>phase:array<vec4u>;
@group(0)@binding(4)var<storage,read>A:array<i32>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.count.x){return;}let S=2048.0;let W=max(f32(A[6])/S,.001);
 let fluid=vec3f(f32(A[0]),f32(A[1]),f32(A[2]))/(S*W);let torque=vec3f(f32(A[3]),f32(A[4]),f32(A[5]))/(S*W);
 let r=pos[i].xyz-U0.centre.xyz;let d=length(r);let rad=U0.centre.w;let strength=U0.meta.x;let dt=U0.meta.y;
 if(phase[i].x==1u){let target=U0.bodyVel.xyz+fluid*.34+cross(torque,r)*.08;let k=clamp(dt*(2.0+strength*3.5),0.0,.16);vel[i]=vec4f(mix(vel[i].xyz,target,k),vel[i].w);return;}
 if(phase[i].x!=0u||d>rad*3.0){return;}let w=1.0-smoothstep(rad*.65,rad*3.0,d);let radial=select(vec3f(0),normalize(r),d>1e-5);
 let wake=U0.bodyVel.xyz*(.16+.25*strength)+radial*dot(U0.bodyVel.xyz,radial)*.12;let k=clamp(w*dt*(1.4+strength*2.2),0.0,.12);
 vel[i]=vec4f(mix(vel[i].xyz,vel[i].xyz+wake,k),vel[i].w);}
`;

async function init(){
 const c=dev.createShaderModule({code:vortCurlWGSL,label:'fluidV5M40VorticityCurlWGSL'}),a=dev.createShaderModule({code:vortApplyWGSL,label:'fluidV5M40VorticityApplyWGSL'});
 const hg=dev.createShaderModule({code:hydroGatherWGSL,label:'fluidV5M40HydroGatherWGSL'}),ha=dev.createShaderModule({code:hydroApplyWGSL,label:'fluidV5M40HydroApplyWGSL'});
 [vortCurl,vortApply,hydroGather,hydroApply]=await Promise.all([
  dev.createComputePipelineAsync({label:'fluidV5M40VortCurl',layout:'auto',compute:{module:c,entryPoint:'main'}}),
  dev.createComputePipelineAsync({label:'fluidV5M40VortApply',layout:'auto',compute:{module:a,entryPoint:'main'}}),
  dev.createComputePipelineAsync({label:'fluidV5M40HydroGather',layout:'auto',compute:{module:hg,entryPoint:'main'}}),
  dev.createComputePipelineAsync({label:'fluidV5M40HydroApply',layout:'auto',compute:{module:ha,entryPoint:'main'}}),
 ]);
}
function ensureVort(){const cap=Math.max(1,sim.cap||sim.n);if(vortBuf&&vortCap===cap)return;vortBuf?.destroy?.();vortCap=cap;vortBuf=dev.createBuffer({label:'fluidV5M40Vorticity',size:cap*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});vortCache=null;}
function bindings(){
 ensureVort();const key=`${sim.gen}|${sim.parity}`;if(vortCache?.key===key&&hydroCache?.key===key)return {v:vortCache,h:hydroCache};
 const pos=sim.livePos(),vel=sim.liveVel(),phase=sim.liveBody();
 const v1=dev.createBindGroup({layout:vortCurl.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:vortUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:sim.buf.cellStart}},{binding:5,resource:{buffer:vortBuf}}]});
 const v2=dev.createBindGroup({layout:vortApply.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:vortUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:sim.buf.cellStart}},{binding:5,resource:{buffer:vortBuf}}]});
 const h1=dev.createBindGroup({layout:hydroGather.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:hydroUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:hydroAccum}}]});
 const h2=dev.createBindGroup({layout:hydroApply.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:hydroUni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:hydroAccum}}]});
 vortCache={key,curl:v1,apply:v2};hydroCache={key,gather:h1,apply:h2};return {v:vortCache,h:hydroCache};
}

let lastCentre=null,lastCentreAt=performance.now(),bodyVel=[0,0,0];
function updateBodyVelocity(){const p=sim.bodyPose?.[0]?.centre,now=performance.now();if(!p)return; if(lastCentre){const dt=clamp((now-lastCentreAt)/1000,.01,.12);bodyVel=[(p[0]-lastCentre[0])/dt,(p[1]-lastCentre[1])/dt,(p[2]-lastCentre[2])/dt];}lastCentre=[...p];lastCentreAt=now;}
setInterval(updateBodyVelocity,80);

let dynamic={substeps:baseParams.substeps,iterations:baseParams.iterations,pressure:0};
function adapt(){
 if(!state.physicsAuto){sim.params.substeps=baseParams.substeps;sim.params.iterations=baseParams.iterations;sim.params.xsphC=baseParams.xsphC;sim.params.cfmEpsilonRel=baseParams.cfm;return;}
 const speed=Number(sim.stats?.maxSpeed)||0,rho=Number(sim.stats?.maxRho)||1;
 const stress=Math.max(clamp((speed-1.6)/2.6,0,1),clamp((rho-1.025)/.10,0,1));
 const sub=baseParams.substeps+(stress>.72?2:stress>.30?1:0),it=baseParams.iterations+(rho>1.08?2:rho>1.035?1:0);
 sim.params.substeps=clamp(sub,baseParams.substeps,baseParams.substeps+2);sim.params.iterations=clamp(it,baseParams.iterations,baseParams.iterations+2);
 sim.params.xsphC=clamp(baseParams.xsphC*(1.0-.42*state.vorticity),.008,.08);
 // XPBD-inspired compliance normalization: smaller substep dt receives proportionally larger CFM.
 const ratio=sim.params.substeps/baseParams.substeps;sim.params.cfmEpsilonRel=clamp(baseParams.cfm*ratio*ratio,.002,.08);
 dynamic={substeps:sim.params.substeps,iterations:sim.params.iterations,pressure:stress};
}

function encodePostPhysics(){
 if(!vortCurl||!vortApply||ui?.paused||document.hidden||sim.lastAdvanced<=0)return;
 const b=sim.params.box,h=sim.h,n=sim.n,dt=Math.max(1/240,Math.min(.025,sim.lastAdvanced/Math.max(1,sim.lastSubsteps||1)));
 VF[0]=b[0];VF[1]=b[1];VF[2]=b[2];VF[3]=h;VI[4]=sim.gridDim[0];VI[5]=sim.gridDim[1];VI[6]=sim.gridDim[2];VI[7]=n;VF[8]=dt;VF[9]=state.vorticity;VF[10]=dynamic.pressure;VF[11]=0;dev.queue.writeBuffer(vortUni,0,VF);
 const pose=sim.bodyPose?.[0]?.centre||[0,0,0],rad=(sim.bodies?.[0]?.size||.1)*1.15;
 HF[0]=pose[0];HF[1]=pose[1];HF[2]=pose[2];HF[3]=rad;HF[4]=bodyVel[0];HF[5]=bodyVel[1];HF[6]=bodyVel[2];HF[7]=0;HF[8]=state.hydroDrag;HF[9]=dt;HF[10]=0;HF[11]=0;HU[12]=n;HU[13]=sim.nBodyParts||0;HU[14]=sim.nBodies||0;HU[15]=0;dev.queue.writeBuffer(hydroUni,0,HF);
 const bg=bindings(),enc=dev.createCommandEncoder();
 if(state.vorticity>.002){const p=enc.beginComputePass();p.setPipeline(vortCurl);p.setBindGroup(0,bg.v.curl);p.dispatchWorkgroups(groups(n));p.setPipeline(vortApply);p.setBindGroup(0,bg.v.apply);p.dispatchWorkgroups(groups(n));p.end();}
 if(state.hydroDrag>.002&&sim.nBodies>0){enc.clearBuffer(hydroAccum);const p=enc.beginComputePass();p.setPipeline(hydroGather);p.setBindGroup(0,bg.h.gather);p.dispatchWorkgroups(groups(n));p.setPipeline(hydroApply);p.setBindGroup(0,bg.h.apply);p.dispatchWorkgroups(groups(n));p.end();}
 dev.queue.submit([enc.finish()]);
}

await init();
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){adapt();const out=baseStep(frameDt);encodePostPhysics();return out;};

function mountUI(){const panel=document.getElementById('settingsPanel');if(!panel||document.getElementById('v5PhysicsM40'))return;const w=document.createElement('div');w.id='v5PhysicsM40';w.className='v5Section';w.innerHTML=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)"><div style="font:800 10px ui-monospace;color:#8fffd1;letter-spacing:.12em">PHYSICS 2.0 · M4.0</div><div style="font:8px/1.45 ui-monospace;color:#8caeba;margin:6px 0">Adaptive substeps/iterations, timestep-aware compliance, GPU vorticity confinement and hydrodynamic rigid-body drag/wakes.</div><button id="v5PhysicsAuto" class="v4WaveToggle" type="button"></button><div class="v4WaveRow"><label>VORTICITY</label><input id="v5Vorticity" type="range" min="0" max="1.5" step=".05"><div id="v5VorticityVal" class="v4WaveVal"></div></div><div class="v4WaveRow"><label>BODY HYDRO</label><input id="v5HydroDrag" type="range" min="0" max="1.25" step=".05"><div id="v5HydroDragVal" class="v4WaveVal"></div></div><div id="v5PhysicsStatus" style="font:8px/1.4 ui-monospace;color:#9fc5d0;margin-top:6px"></div></div>`;panel.appendChild(w);
 const a=w.querySelector('#v5PhysicsAuto'),v=w.querySelector('#v5Vorticity'),h=w.querySelector('#v5HydroDrag'),vv=w.querySelector('#v5VorticityVal'),hv=w.querySelector('#v5HydroDragVal'),st=w.querySelector('#v5PhysicsStatus');
 const sync=()=>{a.textContent=`ADAPTIVE PHYSICS: ${state.physicsAuto?'ON':'OFF'}`;a.classList.toggle('active',state.physicsAuto);v.value=state.vorticity;h.value=state.hydroDrag;vv.textContent=state.vorticity.toFixed(2);hv.textContent=state.hydroDrag.toFixed(2);st.textContent=`${dynamic.substeps} substeps · ${dynamic.iterations} density iterations · pressure ${Math.round(dynamic.pressure*100)}%`;};
 a.onclick=e=>{e.stopPropagation();state.physicsAuto=!state.physicsAuto;save();sync()};v.oninput=e=>{e.stopPropagation();state.vorticity=Number(v.value);save();sync()};h.oninput=e=>{e.stopPropagation();state.hydroDrag=Number(h.value);save();sync()};w.onpointerdown=e=>e.stopPropagation();setInterval(sync,500);sync();
}
mountUI();
window.__v5PhysicsM40={online:true,backend:'grid-vorticity-hydro-m40',state,dynamic};
console.info('[Fluid V5 M4.0] Physics 2.0 online: adaptive solver + vorticity + hydrodynamic rigid coupling.');
