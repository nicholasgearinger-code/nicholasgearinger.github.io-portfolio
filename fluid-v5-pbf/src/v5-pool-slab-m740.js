// Fluid V5 M7.4.0 — unified full-floor pool initial condition.
// Same physical slab layout as M2.8, but the GPU reshape is encoded into M7.4's next shared
// command buffer instead of submitting a separate command buffer on iOS.

const sim=window.__sim,state=window.__v5State,U=window.__v5M740Unified;
if(!sim?.dev||!state||!U?.addPreStep)throw new Error('M7.4 pool slab: unified runtime unavailable.');
const dev=sim.dev;
const wgsl=`
struct Slab{box:vec3f,spacing:f32,dims:vec3u,n:u32,margin:f32,jitter:f32,pad0:vec2f}
@group(0)@binding(0)var<uniform>U:Slab;
@group(0)@binding(1)var<storage,read_write>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>vel:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>pred:array<vec4f>;
@group(0)@binding(4)var<storage,read>phase:array<vec4u>;
fn hash11(x:u32)->f32{var h=x*747796405u+2891336453u;h=((h>>((h>>28u)+4u))^h)*277803737u;h=(h>>22u)^h;return f32(h&0x00ffffffu)/16777215.0;}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U.n||phase[i].x!=0u){return;}let nx=max(U.dims.x,1u);let nz=max(U.dims.z,1u);let layer=nx*nz;let ix=i%nx;let iz=(i/nx)%nz;let iy=i/layer;let p=vec3f(U.margin+(f32(ix)+.5)*U.spacing+(hash11(i*3u+1u)-.5)*U.jitter,U.margin+(f32(iy)+.5)*U.spacing+(hash11(i*3u+2u)-.5)*U.jitter,U.margin+(f32(iz)+.5)*U.spacing+(hash11(i*3u+3u)-.5)*U.jitter);pos[i]=vec4f(p,1);pred[i]=vec4f(p,1);vel[i]=vec4f(0);}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M740PoolSlabWGSL'});
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M740PoolSlab',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M740PoolSlabUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12),I=new Uint32Array(F.buffer);
let requested=true,lastGen=-1,lastReason='startup';
const poolLike=()=>state.scenario!=='dam';
function request(reason='manual'){requested=true;lastReason=reason;}

U.addPreStep(enc=>{
  if(!requested||!poolLike()||!sim.n||lastGen===sim.gen)return;
  requested=false;lastGen=sim.gen;
  const box=sim.params.box,d=sim.params.spacing,margin=d;
  const nx=Math.max(1,Math.floor((box[0]-2*margin)/d));
  const nz=Math.max(1,Math.floor((box[2]-2*margin)/d));
  const layers=Math.max(1,Math.ceil((sim.scene?.nFluid||sim.n)/(nx*nz)));
  F[0]=box[0];F[1]=box[1];F[2]=box[2];F[3]=d;I[4]=nx;I[5]=layers;I[6]=nz;I[7]=sim.n;F[8]=margin;F[9]=d*.055;F[10]=0;F[11]=0;dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.(),pred=sim.buf?.[sim.parity===0?'predA':'predB'],phase=sim.liveBody?.();
  if(!pos||!vel||!pred||!phase){requested=true;return;}
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},{binding:4,resource:{buffer:phase}}]});
  const p=enc.beginComputePass({label:'fluidV5M740PoolSlab'});p.setPipeline(pipe);p.setBindGroup(0,bg);p.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));p.end();
  sim.bindCache=null;
  console.info(`[Fluid V5 M7.4] unified pool slab encoded ${nx}×${nz}×${layers} (${lastReason}).`);
});

const baseReset=sim.reset.bind(sim);
sim.reset=function(...args){const out=baseReset(...args);lastGen=-1;request('reset');return out;};
window.__v5PoolSlab={version:'M7.4 unified',reshape:request,get active(){return poolLike();}};
console.info('[Fluid V5 M7.4] full-floor PBF slab will execute inside the unified frame.');
