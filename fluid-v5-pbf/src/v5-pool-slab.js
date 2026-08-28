// Fluid V5 M2.8: pool-specific full-floor PBF initial condition.
// Particles4All intentionally seeds water as a tall block occupying 35% of box X for collapse tests.
// V5 pool-like scenarios instead need a shallow slab across the complete receiver so the physical
// water surface, not a lighting stretch, determines full-pool caustic coverage.

const sim = window.__sim;
const state = window.__v5State;
if (!sim?.dev || !state) throw new Error('Fluid V5 pool slab: runtime unavailable.');

const dev = sim.dev;

const slabWGSL = `
struct Slab {
  box : vec3f,
  spacing : f32,
  dims : vec3u,
  n : u32,
  margin : f32,
  jitter : f32,
  pad0 : vec2f,
}
@group(0) @binding(0) var<uniform> U : Slab;
@group(0) @binding(1) var<storage, read_write> pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> pred : array<vec4f>;
@group(0) @binding(4) var<storage, read> phase : array<vec4u>;

fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=U.n){return;}
  // Phase 0 is fluid. Rigid-body particles retain their solved/rest configuration untouched.
  if(phase[i].x!=0u){return;}
  let nx=max(U.dims.x,1u);
  let nz=max(U.dims.z,1u);
  let layer=nx*nz;
  let ix=i%nx;
  let iz=(i/nx)%nz;
  let iy=i/layer;
  let jx=(hash11(i*3u+1u)-0.5)*U.jitter;
  let jy=(hash11(i*3u+2u)-0.5)*U.jitter;
  let jz=(hash11(i*3u+3u)-0.5)*U.jitter;
  let p=vec3f(
    U.margin+(f32(ix)+0.5)*U.spacing+jx,
    U.margin+(f32(iy)+0.5)*U.spacing+jy,
    U.margin+(f32(iz)+0.5)*U.spacing+jz
  );
  pos[i]=vec4f(p,1.0);
  pred[i]=vec4f(p,1.0);
  vel[i]=vec4f(0.0);
}`;

const mod=dev.createShaderModule({code:slabWGSL,label:'fluidV5PoolSlabWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('Fluid V5 pool slab WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5PoolSlab',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5PoolSlabUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12);const U32=new Uint32Array(F.buffer);
let lastAppliedGen=-1;

function poolLike(){ return state.scenario!=='dam'; }
function reshapePool(reason='startup'){
  if(!poolLike() || !sim?.n || lastAppliedGen===sim.gen) return false;
  const box=sim.params.box;
  const d=sim.params.spacing;
  const margin=d;
  // Fill virtually the entire usable X/Z footprint. Particle count then determines slab depth.
  const nx=Math.max(1,Math.floor((box[0]-2*margin)/d));
  const nz=Math.max(1,Math.floor((box[2]-2*margin)/d));
  const layers=Math.max(1,Math.ceil((sim.scene?.nFluid||sim.n)/(nx*nz)));
  F[0]=box[0];F[1]=box[1];F[2]=box[2];F[3]=d;
  U32[4]=nx;U32[5]=layers;U32[6]=nz;U32[7]=sim.n;
  F[8]=margin;F[9]=d*0.055;F[10]=0;F[11]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.();const vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  const phase=sim.liveBody?.();
  if(!pos||!vel||!pred||!phase) return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},
    {binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},
    {binding:3,resource:{buffer:pred}},
    {binding:4,resource:{buffer:phase}},
  ]});
  const enc=dev.createCommandEncoder({label:'fluidV5PoolSlabEncoder'});
  const pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();
  dev.queue.submit([enc.finish()]);
  lastAppliedGen=sim.gen;
  // Normal/grid data will rebuild naturally on the next PBF step.
  sim.bindCache=null;
  console.info(`[Fluid V5 M2.8] full-floor pool slab applied (${nx}×${nz}×${layers}, ${reason}).`);
  return true;
}

// Future resets create fresh GPU buffers. Reapply the pool slab after the upstream reset/prime
// commands have been queued. Dam Break intentionally keeps the original compact 35%-width block.
const baseReset=sim.reset.bind(sim);
sim.reset=function(...args){
  const out=baseReset(...args);
  lastAppliedGen=-1;
  queueMicrotask(()=>{ try{reshapePool('reset');}catch(err){console.warn('[Fluid V5 pool slab] reset reshape skipped',err);} });
  return out;
};

// Apply once to the scene that existed before this module loaded.
reshapePool('startup');

window.__v5PoolSlab={
  version:'M2.8',
  reshape:reshapePool,
  get active(){return poolLike();},
};
console.info('[Fluid V5 M2.8] pool-like scenarios use full-floor PBF initialization; Dam Break preserves compact block.');
