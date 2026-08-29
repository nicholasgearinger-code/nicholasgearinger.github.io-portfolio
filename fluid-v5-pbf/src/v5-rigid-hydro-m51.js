// Fluid V5 M5.1 shape-aware rigid hydrodynamics.
// Adds two conservative-size neighbor passes after the solver: fluid particles receive local drag
// from nearby rigid boundary particles, then rigid particles receive the reciprocal local-flow drag.
// Because the force varies over each rigid particle cloud, the existing rigid shape-matching solve
// turns the differential response into angular torque on the following step.

const sim=window.__sim,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!state)throw new Error('Fluid V5 M5.1 rigid hydro: runtime unavailable.');
const dev=sim.dev,WG=256,groups=n=>Math.max(1,Math.ceil(n/WG));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
if(typeof state.shapeHydro!=='number')state.shapeHydro=.68;state.shapeHydro=clamp(Number(state.shapeHydro)||.68,0,1.25);
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}

const uni=dev.createBuffer({label:'fluidV5M51HydroUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
let shapeBuf=null,shapeCap=0,shapeGen=-1,cache=null;
const pre=`
struct U{box:vec4f,grid:vec4u,tune:vec4f,water:vec4f}@group(0)@binding(0)var<uniform>U0:U;
fn cellOf(p:vec3f)->vec3i{return clamp(vec3i(floor(p/U0.box.w)),vec3i(0),vec3i(U0.grid.xyz)-vec3i(1));}
fn w(r:vec3f)->f32{let d=length(r),h=U0.box.w;if(d>=h){return 0.0;}let q=1.0-d/h;return q*q;}
`;
const fluidWGSL=pre+`
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;@group(0)@binding(2)var<storage,read_write>vel:array<vec4f>;@group(0)@binding(3)var<storage,read>phase:array<vec4u>;@group(0)@binding(4)var<storage,read>cellStart:array<u32>;@group(0)@binding(5)var<storage,read>shape:array<vec4f>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.grid.w||phase[i].x!=0u){return;}let pi=pos[i].xyz,vi=vel[i].xyz,c=cellOf(pi);var acc=vec3f(0);var ws=0.0;
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}let ci=u32((z*i32(U0.grid.y)+y)*i32(U0.grid.x)+x);let b=cellStart[ci],e=cellStart[ci+1u];for(var j=b;j<e;j++){let ph=phase[j].x;if(ph==0u){continue;}let ww=w(pi-pos[j].xyz);if(ww<=0){continue;}let sf=shape[min(ph-1u,U0.grid.w-1u)].x;acc+=(vel[j].xyz-vi)*ww*sf;ws+=ww;}}}}
 if(ws>0){let dv=acc/ws*U0.tune.x*U0.tune.z;let m=length(dv);if(m>U0.tune.y){dv*=U0.tune.y/m;}vel[i]=vec4f(vi+dv,vel[i].w);}}
`;
const rigidWGSL=pre+`
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;@group(0)@binding(2)var<storage,read_write>vel:array<vec4f>;@group(0)@binding(3)var<storage,read>phase:array<vec4u>;@group(0)@binding(4)var<storage,read>cellStart:array<u32>;@group(0)@binding(5)var<storage,read>shape:array<vec4f>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.grid.w){return;}let ph=phase[i].x;if(ph==0u){return;}let pi=pos[i].xyz,vi=vel[i].xyz,c=cellOf(pi);var flow=vec3f(0);var ws=0.0;
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}let ci=u32((z*i32(U0.grid.y)+y)*i32(U0.grid.x)+x);let b=cellStart[ci],e=cellStart[ci+1u];for(var j=b;j<e;j++){if(phase[j].x!=0u){continue;}let ww=w(pi-pos[j].xyz);if(ww<=0){continue;}flow+=vel[j].xyz*ww;ws+=ww;}}}}
 if(ws>0){flow/=ws;let sf=shape[min(ph-1u,U0.grid.w-1u)];let rel=flow-vi;let speed=length(rel);let nonlinear=1.0+speed*U0.tune.w;let vertical=vec3f(rel.x,rel.y*sf.y,rel.z);let dv=vertical*(U0.tune.x*.72*sf.x*nonlinear);let m=length(dv);if(m>U0.tune.y){dv*=U0.tune.y/m;}vel[i]=vec4f(vi+dv,vel[i].w);}}
`;
const mk=async(code,label)=>dev.createComputePipelineAsync({label,layout:'auto',compute:{module:dev.createShaderModule({code,label:label+'WGSL'}),entryPoint:'main'}});
const [fluidPipe,rigidPipe]=await Promise.all([mk(fluidWGSL,'fluidV5M51FluidDrag'),mk(rigidWGSL,'fluidV5M51RigidDrag')]);
function ensureShapes(){let n=Math.max(1,sim.nBodies||1);if(shapeBuf&&shapeCap>=n&&shapeGen===sim.gen)return;shapeBuf?.destroy?.();shapeCap=n;shapeGen=sim.gen;shapeBuf=dev.createBuffer({label:'fluidV5M51ShapeFactors',size:n*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});let f=new Float32Array(n*4);for(let i=0;i<n;i++){let b=sim.bodies?.[i],shape=b?.shape||'sphere';f[i*4]=shape==='box'?1.28:shape==='torus'?.84:1.0;f[i*4+1]=shape==='torus'?.72:shape==='box'?1.12:1.0;f[i*4+2]=b?.density||1;f[i*4+3]=0;}dev.queue.writeBuffer(shapeBuf,0,f);cache=null;}
function binds(){ensureShapes();let key=`${sim.gen}|${sim.parity}|${shapeGen}`;if(cache?.key===key)return cache;let pos=sim.livePos(),vel=sim.liveVel(),phase=sim.liveBody();let entries=[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:sim.buf.cellStart}},{binding:5,resource:{buffer:shapeBuf}}];cache={key,f:dev.createBindGroup({layout:fluidPipe.getBindGroupLayout(0),entries}),r:dev.createBindGroup({layout:rigidPipe.getBindGroupLayout(0),entries})};return cache;}
const baseStep=sim.step.bind(sim);sim.step=function(frameDt){baseStep(frameDt);if(ui?.paused||document.hidden||state.shapeHydro<=.001||this.nBodies<1)return;let dt=Math.max(1/480,Math.min(1/60,(this.lastAdvanced||frameDt||1/60)/Math.max(1,this.lastSubsteps||1)));let pressure=window.__v5Workload?.pressure||0,scale=state.shapeHydro*(1-pressure*.35);UF[0]=this.params.box[0];UF[1]=this.params.box[1];UF[2]=this.params.box[2];UF[3]=this.h;UU[4]=this.gridDim[0];UU[5]=this.gridDim[1];UU[6]=this.gridDim[2];UU[7]=this.n;UF[8]=scale;UF[9]=this.h*(.42+.32*scale);UF[10]=clamp(dt*55,.18,1);UF[11]=.32;UF[12]=this.params.box[1]*.28;UF[13]=dt;UF[14]=0;UF[15]=0;dev.queue.writeBuffer(uni,0,UF);let bg=binds(),enc=dev.createCommandEncoder(),p=enc.beginComputePass();p.setPipeline(fluidPipe);p.setBindGroup(0,bg.f);p.dispatchWorkgroups(groups(this.n));p.setPipeline(rigidPipe);p.setBindGroup(0,bg.r);p.dispatchWorkgroups(groups(this.n));p.end();dev.queue.submit([enc.finish()]);};
window.__v5RigidHydroM51={online:true,backend:'shape-neighbor-hydro-m51',get strength(){return state.shapeHydro}};
console.info('[Fluid V5 M5.1] shape-aware two-way rigid hydrodynamics online.');
