// Fluid V5 Milestone 2: real drain compaction, adaptive graphics, underwater optics,
// developer instrumentation, and GPU secondary spray/foam particles.
// Loaded only by the isolated fluid-v5-development branch after V5 Milestone 1.

const sim = window.__sim;
const ui = window.__ui;
const cam = window.__cam;
const ssfr = window.__ssfr;
const state = window.__v5State;
if (!sim?.dev || !ui || !cam || !ssfr?.dev || !state) {
  throw new Error('Fluid V5 M2: required V5/PBF handles are unavailable.');
}

const dev = ssfr.dev;
const format = ssfr.format;
const q = new URLSearchParams(location.search);
const quality = ['low', 'medium', 'high'].includes(q.get('quality')) ? q.get('quality') : 'medium';
const coarse = matchMedia?.('(pointer: coarse)')?.matches ?? false;
const WG = 256;
const groups = n => Math.max(1, Math.ceil(Math.max(0, n) / WG));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const STORAGE_KEY = 'fluidV5LabStateV1';
const saveState = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} };

if (!Number.isFinite(Number(state.secondary))) state.secondary = 0.82;
if (!Number.isFinite(Number(state.drainRate))) state.drainRate = 0.78;
if (!Number.isFinite(Number(state.underwaterHaze))) state.underwaterHaze = 0.68;
if (typeof state.devHud !== 'boolean') state.devHud = false;
state.secondary = clamp(Number(state.secondary), 0, 1.5);
state.drainRate = clamp(Number(state.drainRate), 0.25, 1.4);
state.underwaterHaze = clamp(Number(state.underwaterHaze), 0, 1.25);
saveState();

function matMul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// ---------------------------------------------------------------------------
// AUTO GRAPHICS 2.0
// Fine-grained adaptation happens inside the current tier first. The M1 controller can still
// reload to a different tier after sustained pressure, but M2 continuously adjusts SSFR scale,
// filter work, and secondary-particle budget without a page reload.
// ---------------------------------------------------------------------------

const autoRanges = {
  low:    { min: 0.28, max: 0.40, filtMin: 1, filtMax: 2 },
  medium: { min: 0.36, max: 0.56, filtMin: 2, filtMax: 3 },
  high:   { min: 0.48, max: 0.70, filtMin: 2, filtMax: 4 },
};
const autoRange = autoRanges[quality];
const autoTarget = coarse ? 30 : 55;
const autoBudget = window.__v5AutoBudget = {
  fps: autoTarget,
  ema: autoTarget,
  target: autoTarget,
  renderScale: ssfr.renderScale,
  secondaryScale: 1,
  pressure: 0,
};
let autoLast = performance.now();

function readHudFps() {
  const m = (document.getElementById('v4fps')?.textContent || '').match(/([0-9.]+)/);
  const v = m ? Number(m[1]) : 0;
  return Number.isFinite(v) ? v : 0;
}

function autoGraphicsTick() {
  const now = performance.now();
  const dt = clamp((now - autoLast) / 1000, 0.2, 2.0);
  autoLast = now;
  const fps = readHudFps();
  if (fps > 0) autoBudget.ema = autoBudget.ema * 0.72 + fps * 0.28;
  autoBudget.fps = fps;

  if (state.autoQuality && !ui.paused && !document.hidden && fps > 0) {
    const err = autoBudget.ema - autoTarget;
    let scale = ssfr.renderScale;
    if (err < -2.0) scale -= (err < -8 ? 0.045 : 0.025) * dt;
    else if (err > 8.0) scale += 0.014 * dt;
    scale = clamp(scale, autoRange.min, autoRange.max);
    if (Math.abs(scale - ssfr.renderScale) > 0.002) ssfr.renderScale = scale;

    const pressure = clamp((autoTarget - autoBudget.ema + 4) / 16, 0, 1);
    autoBudget.pressure = pressure;
    autoBudget.secondaryScale = 1.0 - pressure * 0.62;
    ssfr.filterIterations = pressure > 0.66 ? autoRange.filtMin : autoRange.filtMax;
  } else {
    autoBudget.pressure *= 0.86;
    autoBudget.secondaryScale += (1 - autoBudget.secondaryScale) * 0.12;
  }
  autoBudget.renderScale = ssfr.renderScale;

  const autoBtn = document.getElementById('v5AutoQuality');
  if (autoBtn && state.autoQuality) autoBtn.textContent = `AUTO ${Math.round(ssfr.renderScale * 100)}%`;
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn && state.autoQuality) settingsBtn.textContent = `AUTO ${quality.toUpperCase()} · ${Math.round(ssfr.renderScale * 100)}%`;
}
setInterval(autoGraphicsTick, 900);

// Keep scene accounting correct when M1 rain/pour appends fluid after this module loads.
const baseAppendFluid = sim.appendFluid.bind(sim);
sim.appendFluid = function(pos, vel) {
  const before = this.n;
  const added = baseAppendFluid(pos, vel);
  if (added > 0 && this.scene) {
    this.scene.nFluid = Math.max(0, (this.scene.nFluid || (before - this.nBodyParts)) + added);
    this.scene.n = this.n;
  }
  return added;
};

// ---------------------------------------------------------------------------
// REAL DRAIN: GPU COMPACTION
// Fluid particles entering a small floor throat are removed from all live particle attributes.
// Rigid-body particles are always preserved. We compact into the opposite ping-pong buffers,
// read back only a single u32 count, then atomically switch the simulation parity.
// ---------------------------------------------------------------------------

let drainMapPipe = null;
let drainCopyAPipe = null;
let drainCopyBPipe = null;
let drainUni = null;
let drainF = null;
let drainU = null;
let drainCount = null;
let drainRead = null;
let drainBusy = false;
let drainLastLaunch = 0;
let drainEpoch = 1;
let drainCache = null;
let drainNormalTemp = null;
let drainNormalCap = 0;
let drainedTotal = 0;
let drainLastRemoved = 0;

// Pass 1 only decides keep/remove and writes a compact destination index into the solver's
// existing slot buffer. Passes 2/3 copy attributes using that map. Keeping each pipeline at
// <= 7 storage buffers preserves WebGPU portability on mobile adapters with conservative limits.
const drainMapWGSL = `
struct D { mouth:vec4f, meta:vec4u }
@group(0) @binding(0) var<uniform> U:D;
@group(0) @binding(1) var<storage,read> srcPos:array<vec4f>;
@group(0) @binding(2) var<storage,read> srcBody:array<vec4u>;
@group(0) @binding(3) var<storage,read_write> slot:array<u32>;
@group(0) @binding(4) var<storage,read_write> outCount:atomic<u32>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=U.meta.x){return;}let p=srcPos[i];let phase=srcBody[i].x;var remove=false;
 if(phase==0u){let d=distance(p.xz,U.mouth.xy);let throat=U.mouth.z*(0.76+0.24*clamp(p.y/max(U.mouth.w,1.0e-4),0.0,1.0));
  if(d<throat&&p.y<U.mouth.w){let centre=1.0-clamp(d/max(throat,1.0e-4),0.0,1.0);let chance=clamp(0.46+centre*0.48,0.0,0.96);remove=hash1(i^(U.meta.y*747796405u))<chance;}}
 if(remove){slot[i]=0xffffffffu;return;}slot[i]=atomicAdd(&outCount,1u);
}`;
const drainCopyAWGSL = `
struct D { mouth:vec4f, meta:vec4u }
@group(0) @binding(0) var<uniform> U:D;
@group(0) @binding(1) var<storage,read> slot:array<u32>;
@group(0) @binding(2) var<storage,read> srcPos:array<vec4f>;
@group(0) @binding(3) var<storage,read> srcVel:array<vec4f>;
@group(0) @binding(4) var<storage,read> srcPred:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> dstPos:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> dstVel:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> dstPred:array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=U.meta.x){return;}let j=slot[i];if(j==0xffffffffu){return;}dstPos[j]=srcPos[i];dstVel[j]=srcVel[i];dstPred[j]=srcPred[i];}
`;
const drainCopyBWGSL = `
struct D { mouth:vec4f, meta:vec4u }
@group(0) @binding(0) var<uniform> U:D;
@group(0) @binding(1) var<storage,read> slot:array<u32>;
@group(0) @binding(2) var<storage,read> srcBody:array<vec4u>;
@group(0) @binding(3) var<storage,read> srcRest:array<vec4f>;
@group(0) @binding(4) var<storage,read> srcNormal:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> dstBody:array<vec4u>;
@group(0) @binding(6) var<storage,read_write> dstRest:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> dstNormal:array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=U.meta.x){return;}let j=slot[i];if(j==0xffffffffu){return;}dstBody[j]=srcBody[i];dstRest[j]=srcRest[i];dstNormal[j]=srcNormal[i];}
`;

async function initDrain() {
  try {
    drainUni = dev.createBuffer({ label:'fluidV5M2DrainUniform', size:32, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    drainF = new Float32Array(8); drainU = new Uint32Array(drainF.buffer);
    drainCount = dev.createBuffer({ label:'fluidV5M2DrainCount', size:16, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST });
    drainRead = dev.createBuffer({ label:'fluidV5M2DrainRead', size:16, usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST });
    const mm=dev.createShaderModule({code:drainMapWGSL,label:'fluidV5M2DrainMapWGSL'});
    const ma=dev.createShaderModule({code:drainCopyAWGSL,label:'fluidV5M2DrainCopyAWGSL'});
    const mb=dev.createShaderModule({code:drainCopyBWGSL,label:'fluidV5M2DrainCopyBWGSL'});
    [drainMapPipe,drainCopyAPipe,drainCopyBPipe]=await Promise.all([
      dev.createComputePipelineAsync({label:'fluidV5M2DrainMap',layout:'auto',compute:{module:mm,entryPoint:'main'}}),
      dev.createComputePipelineAsync({label:'fluidV5M2DrainCopyA',layout:'auto',compute:{module:ma,entryPoint:'main'}}),
      dev.createComputePipelineAsync({label:'fluidV5M2DrainCopyB',layout:'auto',compute:{module:mb,entryPoint:'main'}}),
    ]);
    return true;
  } catch (err) {
    console.error('[Fluid V5 M2] drain pipeline rejected', err);
    drainMapPipe=drainCopyAPipe=drainCopyBPipe=null; return false;
  }
}

function ensureDrainNormalTemp(){
 const cap=Math.max(1,sim.cap||sim.n);if(drainNormalTemp&&drainNormalCap===cap)return;
 drainNormalTemp?.destroy?.();drainNormalCap=cap;drainNormalTemp=dev.createBuffer({label:'fluidV5M2DrainNormalTemp',size:cap*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});drainCache=null;
}
function drainBindGroups(srcParity){
 if(!drainMapPipe||!drainCopyAPipe||!drainCopyBPipe)return null;ensureDrainNormalTemp();
 const key=`${sim.gen}|${srcParity}`;if(drainCache?.key===key)return drainCache;
 const s=srcParity===0?'A':'B',d=srcParity===0?'B':'A';
 const map=dev.createBindGroup({layout:drainMapPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:drainUni}},{binding:1,resource:{buffer:sim.buf['pos'+s]}},{binding:2,resource:{buffer:sim.buf['body'+s]}},{binding:3,resource:{buffer:sim.buf.slot}},{binding:4,resource:{buffer:drainCount}}]});
 const copyA=dev.createBindGroup({layout:drainCopyAPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:drainUni}},{binding:1,resource:{buffer:sim.buf.slot}},{binding:2,resource:{buffer:sim.buf['pos'+s]}},{binding:3,resource:{buffer:sim.buf['vel'+s]}},{binding:4,resource:{buffer:sim.buf['pred'+s]}},{binding:5,resource:{buffer:sim.buf['pos'+d]}},{binding:6,resource:{buffer:sim.buf['vel'+d]}},{binding:7,resource:{buffer:sim.buf['pred'+d]}}]});
 const copyB=dev.createBindGroup({layout:drainCopyBPipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:drainUni}},{binding:1,resource:{buffer:sim.buf.slot}},{binding:2,resource:{buffer:sim.buf['body'+s]}},{binding:3,resource:{buffer:sim.buf['rest'+s]}},{binding:4,resource:{buffer:sim.buf.normal}},{binding:5,resource:{buffer:sim.buf['body'+d]}},{binding:6,resource:{buffer:sim.buf['rest'+d]}},{binding:7,resource:{buffer:drainNormalTemp}}]});
 drainCache={key,map,copyA,copyB};return drainCache;
}

function launchDrainCompaction(){
 if(!drainMapPipe||drainBusy||state.scenario!=='drain'||ui.paused)return;
 const now=performance.now();const interval=230-90*clamp(state.drainRate,.25,1.4)/1.4;if(now-drainLastLaunch<interval)return;if(sim.n<=sim.nBodyParts+64)return;drainLastLaunch=now;
 const box=sim.params.box;const radius=Math.max(.075,box[2]*(.060+.035*state.drainRate));const yCut=Math.max(sim.params.spacing*4.2,.105+.045*state.drainRate);
 drainF[0]=box[0]*.52;drainF[1]=box[2]*.52;drainF[2]=radius;drainF[3]=yCut;drainU[4]=sim.n;drainU[5]=drainEpoch++;drainU[6]=0;drainU[7]=0;dev.queue.writeBuffer(drainUni,0,drainF);
 const generation=sim.gen,oldN=sim.n,oldFluid=sim.scene?.nFluid??Math.max(0,oldN-sim.nBodyParts),srcParity=sim.parity,dstParity=1-srcParity;const bg=drainBindGroups(srcParity);if(!bg)return;
 const enc=dev.createCommandEncoder({label:'fluidV5M2DrainEncoder'});enc.clearBuffer(drainCount);
 {const p=enc.beginComputePass();p.setPipeline(drainMapPipe);p.setBindGroup(0,bg.map);p.dispatchWorkgroups(groups(oldN));p.end();}
 {const p=enc.beginComputePass();p.setPipeline(drainCopyAPipe);p.setBindGroup(0,bg.copyA);p.dispatchWorkgroups(groups(oldN));p.end();}
 {const p=enc.beginComputePass();p.setPipeline(drainCopyBPipe);p.setBindGroup(0,bg.copyB);p.dispatchWorkgroups(groups(oldN));p.end();}
 enc.copyBufferToBuffer(drainNormalTemp,0,sim.buf.normal,0,oldN*16);enc.copyBufferToBuffer(drainCount,0,drainRead,0,4);dev.queue.submit([enc.finish()]);drainBusy=true;
 drainRead.mapAsync(GPUMapMode.READ).then(()=>{const keptRaw=new Uint32Array(drainRead.getMappedRange())[0];drainRead.unmap();const kept=Math.min(oldN,keptRaw);if(sim.gen!==generation){drainBusy=false;return;}const removed=Math.max(0,oldN-kept);
  if(removed>0){sim.n=kept;sim.parity=dstParity;sim.predParity=dstParity;sim.timeBank=0;sim.gen++;if(sim.scene){sim.scene.n=kept;sim.scene.nFluid=Math.max(0,oldFluid-removed);}drainedTotal+=removed;drainLastRemoved=removed;drainCache=null;}drainBusy=false;
 }).catch(err=>{console.warn('[Fluid V5 M2] drain count readback failed',err);try{drainRead.unmap();}catch{}drainBusy=false;});
}

const baseStep = sim.step.bind(sim);
sim.step = function(frameDt) {
  if (drainBusy) {
    this.lastAdvanced = 0;
    return;
  }
  const out = baseStep(frameDt);
  if (state.scenario === 'drain' && !ui.paused) launchDrainCompaction();
  return out;
};

// ---------------------------------------------------------------------------
// SECONDARY PARTICLES
// Fixed-capacity GPU pool with atomic append counters. Primary PBF surface particles spawn
// energetic spray/foam. Spray follows ballistic motion; on water re-entry it becomes foam.
// Foam persists, drifts, damps, and slowly expires without becoming part of the pressure solve.
// ---------------------------------------------------------------------------

const SEC_CAP = quality === 'low' ? 3072 : quality === 'high' ? 9216 : 6144;
const secBuffers = [0, 1].map(i => dev.createBuffer({
  label: `fluidV5M2Secondary${i}`, size: SEC_CAP * 32,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
}));
const secCounts = [0, 1].map(i => dev.createBuffer({
  label: `fluidV5M2SecondaryCount${i}`, size: 16,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
}));
const zero16 = new Uint32Array(4);
dev.queue.writeBuffer(secCounts[0], 0, zero16);
dev.queue.writeBuffer(secCounts[1], 0, zero16);

const secUni = dev.createBuffer({ label: 'fluidV5M2SecondaryUniform', size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const secF = new Float32Array(16);
const secU = new Uint32Array(secF.buffer);
const secRenderUni = dev.createBuffer({ label: 'fluidV5M2SecondaryRenderUniform', size: 96,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const secRF = new Float32Array(24);

const secUpdateWGSL = `
struct Sec { pl:vec4f, vt:vec4f }
struct U { box:vec4f, water:vec4f, meta:vec4u, motion:vec4f }
@group(0) @binding(0) var<uniform> U0:U;
@group(0) @binding(1) var<storage,read> src:array<Sec>;
@group(0) @binding(2) var<storage,read> srcCount:array<u32>;
@group(0) @binding(3) var<storage,read_write> dst:array<Sec>;
@group(0) @binding(4) var<storage,read_write> dstCount:atomic<u32>;
fn emit(s:Sec){let j=atomicAdd(&dstCount,1u);if(j<U0.meta.x){dst[j]=s;}}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let count=min(srcCount[0],U0.meta.x);let i=gid.x;if(i>=count){return;}
 var s=src[i];var life=s.pl.w-U0.water.y;if(life<=0.0){return;}
 var p=s.pl.xyz;var v=s.vt.xyz;var ty=s.vt.w;let dt=U0.water.y;
 if(ty<0.5){
   v.y-=9.81*dt*0.72;v=v*exp(-dt*0.48);p=p+v*dt;
   if(p.y<=U0.water.x+U0.water.z*0.45 && v.y<0.0){
     ty=1.0;p.y=U0.water.x+U0.water.z*0.16;v=vec3f(v.x*0.28,0.0,v.z*0.28);life=max(life,1.8+U0.motion.z*1.4);
   }
 }else{
   let settle=U0.water.x+U0.water.z*(0.12+0.05*sin(U0.motion.y*1.7+f32(i)*0.37));
   p.y=mix(p.y,settle,1.0-exp(-dt*4.0));v.y=0.0;let drag=exp(-dt*0.55);v=vec3f(v.x*drag,0.0,v.z*drag);p=p+vec3f(v.x*dt,0.0,v.z*dt);
 }
 if(p.y<-0.05||p.y>U0.box.y+0.35){return;}
 if(p.x<-0.10||p.z<-0.10||p.x>U0.box.x+0.10||p.z>U0.box.z+0.10){return;}
 s.pl=vec4f(p,life);s.vt=vec4f(v,ty);emit(s);
}`;

const secSpawnWGSL = `
struct Sec { pl:vec4f, vt:vec4f }
struct U { box:vec4f, water:vec4f, meta:vec4u, motion:vec4f }
@group(0) @binding(0) var<uniform> U0:U;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read> normalBuf:array<vec4f>;
@group(0) @binding(4) var<storage,read> phase:array<vec4u>;
@group(0) @binding(5) var<storage,read_write> dst:array<Sec>;
@group(0) @binding(6) var<storage,read_write> dstCount:atomic<u32>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
fn emit(s:Sec){let j=atomicAdd(&dstCount,1u);if(j<U0.meta.x){dst[j]=s;}}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let stride=max(U0.meta.z,1u);let i=gid.x*stride;if(i>=U0.meta.y||phase[i].x!=0u){return;}
 let p=pos[i].xyz;let v=vel[i].xyz;let rawN=normalBuf[i].xyz;let nl=length(rawN);
 if(nl<1.0e-4){return;}var n=rawN/nl;if(n.y<0.0){n=-n;}
 let band=abs(p.y-U0.water.x);if(band>U0.water.z*5.0){return;}
 let speed=length(v);let slope=1.0-clamp(n.y,0.0,1.0);let seed=i^(U0.meta.w*1664525u);
 let energy=max(v.y-0.35,0.0)+max(speed-1.20,0.0)*0.48+slope*0.52;
 let scale=U0.water.w*U0.motion.x;
 let sprayChance=clamp(max(energy-0.22,0.0)*0.0065*scale,0.0,0.055);
 let foamChance=clamp((max(speed-0.55,0.0)*0.0017+slope*0.0038)*scale,0.0,0.026);
 let r=hash1(seed);
 if(r<sprayChance){
   let kick=0.28+hash1(seed+17u)*0.72;
   let pv=v*0.72+n*kick+vec3f((hash1(seed+3u)-0.5)*0.24,0.12,(hash1(seed+7u)-0.5)*0.24);
   let life=0.75+hash1(seed+29u)*1.20;
   var s:Sec;s.pl=vec4f(p+n*U0.water.z*0.42,life);s.vt=vec4f(pv,0.0);emit(s);
 }else if(hash1(seed+101u)<foamChance){
   let life=2.2+hash1(seed+131u)*3.6;
   var s:Sec;s.pl=vec4f(p.x,U0.water.x+U0.water.z*0.15,p.z,life);s.vt=vec4f(v.x*0.32,0.0,v.z*0.32,1.0);emit(s);
 }
}`;

const secRenderWGSL = `
struct Sec { pl:vec4f, vt:vec4f }
struct R { vp:mat4x4f, screen:vec4f, meta:vec4f }
@group(0) @binding(0) var<uniform> U:R;
@group(0) @binding(1) var<storage,read> p:array<Sec>;
@group(0) @binding(2) var<storage,read> count:array<u32>;
struct V{@builtin(position)clip:vec4f,@location(0)uv:vec2f,@location(1)kind:f32,@location(2)alpha:f32}
fn corner(i:u32)->vec2f{
 let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return c[i];
}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->V{
 var o:V;let n=min(count[0],u32(U.meta.x));
 if(ii>=n){o.clip=vec4f(2,2,2,1);o.uv=vec2f(2);o.kind=0;o.alpha=0;return o;}
 let s=p[ii];let q=corner(vi);var c=U.vp*vec4f(s.pl.xyz,1.0);let kind=s.vt.w;
 let px=mix(2.2,3.4,step(0.5,kind))*U.meta.y;
 c.xy+=q*vec2f(px*2.0/max(U.screen.x,1.0),px*2.0/max(U.screen.y,1.0))*c.w;
 o.clip=c;o.uv=q;o.kind=kind;o.alpha=clamp(s.pl.w/mix(1.4,4.0,step(0.5,kind)),0.18,1.0);return o;
}
@fragment fn fs(v:V)->@location(0)vec4f{
 let r=length(v.uv);if(r>1.0){discard;}let edge=1.0-smoothstep(0.52,1.0,r);
 let foam=step(0.5,v.kind);let col=mix(vec3f(0.78,0.94,1.0),vec3f(0.94,1.0,0.98),vec3f(foam));
 let a=edge*v.alpha*mix(0.78,0.56,foam);return vec4f(col,a);
}`;

let secUpdatePipe = null, secSpawnPipe = null, secRenderPipe = null;
let secParity = 0;
let secFrame = 1;
let secLastTime = performance.now();
let secSourcePosA = sim.buf.posA;
let secPipelineReady = false;

async function initSecondary() {
  try {
    const um = dev.createShaderModule({ code:secUpdateWGSL, label:'fluidV5M2SecondaryUpdateWGSL' });
    const sm = dev.createShaderModule({ code:secSpawnWGSL, label:'fluidV5M2SecondarySpawnWGSL' });
    const rm = dev.createShaderModule({ code:secRenderWGSL, label:'fluidV5M2SecondaryRenderWGSL' });
    secUpdatePipe = await dev.createComputePipelineAsync({ label:'fluidV5M2SecondaryUpdate', layout:'auto', compute:{module:um,entryPoint:'main'} });
    secSpawnPipe = await dev.createComputePipelineAsync({ label:'fluidV5M2SecondarySpawn', layout:'auto', compute:{module:sm,entryPoint:'main'} });
    secRenderPipe = await dev.createRenderPipelineAsync({
      label:'fluidV5M2SecondaryRender', layout:'auto',
      vertex:{module:rm,entryPoint:'vs'},
      fragment:{module:rm,entryPoint:'fs',targets:[{format,blend:{
        color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},
        alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},
      }}]},
      primitive:{topology:'triangle-list'},
    });
    secPipelineReady = true;
    return true;
  } catch (err) {
    console.error('[Fluid V5 M2] secondary particle pipeline rejected', err);
    secPipelineReady = false;
    return false;
  }
}

function resetSecondaryPool() {
  dev.queue.writeBuffer(secCounts[0], 0, zero16);
  dev.queue.writeBuffer(secCounts[1], 0, zero16);
  secParity = 0;
  secSourcePosA = sim.buf.posA;
}

function secondaryStride() {
  const base = quality === 'low' ? 8 : quality === 'high' ? 4 : 5;
  const pressureExtra = Math.round((1 - autoBudget.secondaryScale) * 7);
  return Math.max(2, base + pressureExtra);
}

function secondaryComputeBindings(srcSec, dstSec) {
  return {
    update: dev.createBindGroup({ layout:secUpdatePipe.getBindGroupLayout(0), entries:[
      {binding:0,resource:{buffer:secUni}},
      {binding:1,resource:{buffer:secBuffers[srcSec]}},
      {binding:2,resource:{buffer:secCounts[srcSec]}},
      {binding:3,resource:{buffer:secBuffers[dstSec]}},
      {binding:4,resource:{buffer:secCounts[dstSec]}},
    ]}),
    spawn: dev.createBindGroup({ layout:secSpawnPipe.getBindGroupLayout(0), entries:[
      {binding:0,resource:{buffer:secUni}},
      {binding:1,resource:{buffer:sim.livePos()}},
      {binding:2,resource:{buffer:sim.liveVel()}},
      {binding:3,resource:{buffer:sim.buf.normal}},
      {binding:4,resource:{buffer:sim.liveBody()}},
      {binding:5,resource:{buffer:secBuffers[dstSec]}},
      {binding:6,resource:{buffer:secCounts[dstSec]}},
    ]}),
  };
}

function encodeSecondary(enc, target, args) {
  if (!secPipelineReady) return;
  if (sim.buf.posA !== secSourcePosA) resetSecondaryPool();

  const now = performance.now();
  const dt = ui.paused ? 0 : clamp((now - secLastTime) / 1000, 0, 0.04);
  secLastTime = now;
  const src = secParity, dst = 1 - src;
  const stride = secondaryStride();
  const strength = state.secondary * autoBudget.secondaryScale;
  const b = sim.params.box;

  secF[0]=b[0];secF[1]=b[1];secF[2]=b[2];secF[3]=0;
  secF[4]=b[1]*0.28;secF[5]=dt;secF[6]=sim.params.spacing;secF[7]=strength;
  secU[8]=SEC_CAP;secU[9]=sim.n;secU[10]=stride;secU[11]=secFrame++;
  secF[12]=autoBudget.secondaryScale;secF[13]=now*.001;secF[14]=(secFrame&1023)/1023;secF[15]=0;
  dev.queue.writeBuffer(secUni,0,secF);
  enc.clearBuffer(secCounts[dst]);
  const bg = secondaryComputeBindings(src,dst);

  const up = enc.beginComputePass();
  up.setPipeline(secUpdatePipe);up.setBindGroup(0,bg.update);up.dispatchWorkgroups(groups(SEC_CAP));up.end();

  if (!ui.paused && strength > 0.002 && window.__v5DebugMode !== 'particles') {
    const sp = enc.beginComputePass();
    sp.setPipeline(secSpawnPipe);sp.setBindGroup(0,bg.spawn);
    sp.dispatchWorkgroups(groups(Math.ceil(sim.n/stride)));sp.end();
  }
  secParity = dst;

  const debugSecondary = window.__v5DebugMode === 'm2-secondary';
  const finalMode = window.__v5DebugMode === 'final';
  if (!debugSecondary && !finalMode) return;

  if (debugSecondary) {
    const clearPass=enc.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:0.005,g:0.012,b:0.018,a:1},loadOp:'clear',storeOp:'store'}]});
    clearPass.end();
  }

  const view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
  const vp=matMul(proj,view);
  secRF.set(vp,0);
  secRF[16]=w;secRF[17]=h;secRF[18]=b[1]*0.28;secRF[19]=0;
  secRF[20]=SEC_CAP;secRF[21]=debugSecondary?1.45:1.0;secRF[22]=strength;secRF[23]=0;
  dev.queue.writeBuffer(secRenderUni,0,secRF);
  const rbg=dev.createBindGroup({layout:secRenderPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:secRenderUni}},
    {binding:1,resource:{buffer:secBuffers[secParity]}},
    {binding:2,resource:{buffer:secCounts[secParity]}},
  ]});
  const rp=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});
  rp.setPipeline(secRenderPipe);rp.setBindGroup(0,rbg);rp.draw(6,SEC_CAP);rp.end();
}

// ---------------------------------------------------------------------------
// UNDERWATER CAMERA OPTICS
// The camera remains a real camera in the same scene. M2 clamps its eye beneath the free surface
// while underwater mode is enabled and adds a conservative optical-medium overlay after SSFR.
// ---------------------------------------------------------------------------

const uwUni=dev.createBuffer({label:'fluidV5M2UnderwaterUniform',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const uwF=new Float32Array(8);
const uwWGSL=`
struct U{medium:vec4f,sun:vec4f}
@group(0)@binding(0)var<uniform>U0:U;
struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let q=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:V;o.uv=vec2f(q.x,1.0-q.y);o.p=vec4f(q*2.0-1.0,0,1);return o;}
@fragment fn fs(v:V)->@location(0)vec4f{
 let depth=max(U0.medium.x,0.0);let strength=U0.medium.y;
 let sunGlow=pow(max(0.0,1.0-distance(v.uv,vec2f(0.52,0.16))*1.25),3.0)*U0.sun.w;
 let tint=mix(vec3f(0.025,0.155,0.205),vec3f(0.075,0.285,0.31),vec3f(clamp(sunGlow,0.0,1.0)));
 let edge=smoothstep(0.95,0.25,length((v.uv-0.5)*vec2f(1.0,0.78)));
 let alpha=clamp((0.055+depth*0.30)*strength*(0.86+0.14*edge),0.0,0.38);
 return vec4f(tint,alpha);
}`;
let uwPipe=null;
async function initUnderwaterOverlay(){
 try{const m=dev.createShaderModule({code:uwWGSL,label:'fluidV5M2UnderwaterWGSL'});uwPipe=await dev.createRenderPipelineAsync({
  label:'fluidV5M2UnderwaterOverlay',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});return true;
 }catch(err){console.error('[Fluid V5 M2] underwater overlay rejected',err);uwPipe=null;return false;}
}

function enforceUnderwaterCamera(){
  if(!state.underwater)return;
  const waterY=sim.params.box[1]*0.28;
  const eye=cam.eye();
  const maxY=waterY-Math.max(0.028,sim.params.spacing*0.75);
  const minY=Math.max(0.055,sim.params.spacing*1.4);
  if(eye[1]>maxY)cam.target[1]-=eye[1]-maxY;
  else if(eye[1]<minY)cam.target[1]+=minY-eye[1];
}
function underwaterCameraLoop(){enforceUnderwaterCamera();requestAnimationFrame(underwaterCameraLoop)}
requestAnimationFrame(underwaterCameraLoop);

function encodeUnderwater(enc,target){
 if(!uwPipe||!state.underwater||window.__v5DebugMode!=='final'||state.underwaterHaze<=0.002)return;
 const waterY=sim.params.box[1]*0.28;const eye=cam.eye();const depth=Math.max(0,waterY-eye[1]);
 const el=ssfr.sunElevation*Math.PI/180,az=ssfr.sunAzimuth*Math.PI/180;
 uwF[0]=depth;uwF[1]=state.underwaterHaze;uwF[2]=waterY;uwF[3]=performance.now()*.001;
 uwF[4]=Math.cos(el)*Math.sin(az);uwF[5]=Math.sin(el);uwF[6]=Math.cos(el)*Math.cos(az);uwF[7]=clamp(ssfr.sunIntensity/5,0,1.3);
 dev.queue.writeBuffer(uwUni,0,uwF);
 const bg=dev.createBindGroup({layout:uwPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uwUni}}]});
 const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(uwPipe);p.setBindGroup(0,bg);p.draw(3);p.end();
}

// ---------------------------------------------------------------------------
// DEVELOPER MODE 2.0
// Adds a drain-mouth geometry view, a secondary-only view, and a live instrumentation HUD.
// Atomic caustics are routed to the M1 caustic debug texture.
// ---------------------------------------------------------------------------

const devUni=dev.createBuffer({label:'fluidV5M2DevUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const devF=new Float32Array(4);
const devWGSL=`
struct Comp{invViewProj:mat4x4f,invView:mat4x4f,eye:vec4f,boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f}
struct D{cx:f32,cz:f32,r:f32,pad:f32}
@group(0)@binding(0)var<uniform>C:Comp;@group(0)@binding(1)var<uniform>U:D;
struct V{@builtin(position)p:vec4f,@location(0)n:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.p=vec4f(p,0,1);o.n=p;return o;}
@fragment fn fs(v:V)->@location(0)vec4f{
 let a=C.invViewProj*vec4f(v.n,-1,1);let b=C.invViewProj*vec4f(v.n,1,1);let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 if(abs(rd.y)<1.0e-5){return vec4f(0);}let t=(C.boxMin.y-ro.y)/rd.y;if(t<=0){return vec4f(0);}let p=ro+rd*t;
 let d=distance(p.xz,vec2f(U.cx,U.cz));let ring=1.0-smoothstep(U.r*0.82,U.r*1.12,d);let core=1.0-smoothstep(0.0,U.r*0.72,d);
 let alpha=clamp(ring*0.62+core*0.22,0.0,0.72);return vec4f(mix(vec3f(0.08,0.72,0.92),vec3f(1.0,0.28,0.12),vec3f(core)),alpha);
}`;
let devPipe=null;
async function initDevOverlay(){
 try{const m=dev.createShaderModule({code:devWGSL,label:'fluidV5M2DevWGSL'});devPipe=await dev.createRenderPipelineAsync({label:'fluidV5M2DrainDebug',layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});return true;
 }catch(err){console.error('[Fluid V5 M2] developer overlay rejected',err);devPipe=null;return false;}
}
function encodeDevOverlay(enc,target){
 if(!devPipe||window.__v5DebugMode!=='m2-drain')return;
 const b=sim.params.box;devF[0]=b[0]*.52;devF[1]=b[2]*.52;devF[2]=Math.max(.075,b[2]*(.060+.035*state.drainRate));devF[3]=0;dev.queue.writeBuffer(devUni,0,devF);
 const bg=dev.createBindGroup({layout:devPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:{buffer:devUni}}]});
 const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(devPipe);p.setBindGroup(0,bg);p.draw(3);p.end();
}

// Wrap the complete M1 renderer. M1 projected caustics + V4.4 temporal remain untouched.
const m1Render=ssfr.render;
ssfr.render=function(...args){
 const out=m1Render.apply(this,args);const enc=args[0],target=args[1];
 try{encodeSecondary(enc,target,args);}catch(err){console.warn('[Fluid V5 M2] secondary pass skipped',err);}
 try{encodeDevOverlay(enc,target);}catch(err){console.warn('[Fluid V5 M2] developer overlay skipped',err);}
 try{encodeUnderwater(enc,target);}catch(err){console.warn('[Fluid V5 M2] underwater overlay skipped',err);}
 return out;
};

// ---------------------------------------------------------------------------
// M2 UI + HUD
// ---------------------------------------------------------------------------

function setM2Debug(mode){
  state.debug=mode;window.__v5DebugMode=mode;ssfr.debug=0;ui.display=3;saveState();
  document.querySelectorAll('#v5Lab [data-debug]').forEach(b=>b.classList.toggle('active',b.dataset.debug===mode));
  document.querySelectorAll('#v5Milestone2 [data-m2debug]').forEach(b=>b.classList.toggle('active',b.dataset.m2debug===mode));
}
function selectAtomicDebug(){
 const b=document.querySelector('#v5Lab [data-debug="caustics"]');
 if(b){b.click();return;}setM2Debug('caustics');
}
function selectFinalDebug(){
 const b=document.querySelector('#v5Lab [data-debug="final"]');
 if(b){b.click();return;}setM2Debug('final');
}

function addSlider(parent,label,id,min,max,step,value,onValue){
 const r=document.createElement('div');r.className='v5Slider';
 r.innerHTML=`<label>${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="v5Val"></div>`;
 const input=r.querySelector('input'),val=r.querySelector('.v5Val');
 const sync=()=>{val.textContent=Number(input.value).toFixed(2);};sync();
 input.oninput=e=>{e.stopPropagation();onValue(Number(input.value));sync();};
 r.addEventListener('pointerdown',e=>e.stopPropagation());parent.appendChild(r);return input;
}

function installM2UI(){
 const lab=document.getElementById('v5Lab');if(!lab||document.getElementById('v5Milestone2'))return !!lab;
 const wrap=document.createElement('div');wrap.id='v5Milestone2';wrap.className='v5Lab';
 wrap.innerHTML='<div class="v5Top"><div class="v5Title">MILESTONE 2 · GPU FLUID EXTRAS</div><div class="v5Badge">ATOMIC + SECONDARY</div></div>';
 const secTitle=document.createElement('div');secTitle.className='v5SectionTitle';secTitle.textContent='SECONDARY PARTICLES';wrap.appendChild(secTitle);
 addSlider(wrap,'SECONDARY','v5Secondary',0,1.5,.05,state.secondary,v=>{state.secondary=v;saveState();});
 const drainTitle=document.createElement('div');drainTitle.className='v5SectionTitle';drainTitle.textContent='DRAIN + UNDERWATER';wrap.appendChild(drainTitle);
 addSlider(wrap,'DRAIN RATE','v5DrainRate',.25,1.4,.05,state.drainRate,v=>{state.drainRate=v;saveState();});
 addSlider(wrap,'UW HAZE','v5UnderwaterHaze',0,1.25,.05,state.underwaterHaze,v=>{state.underwaterHaze=v;saveState();});
 const devTitle=document.createElement('div');devTitle.className='v5SectionTitle';devTitle.textContent='DEVELOPER MODE 2.0';wrap.appendChild(devTitle);
 const grid=document.createElement('div');grid.className='v5Grid four';
 const mk=(label,mode,fn)=>{const b=document.createElement('button');b.type='button';b.className='v5Btn';b.textContent=label;b.dataset.m2debug=mode;b.onclick=e=>{e.preventDefault();e.stopPropagation();fn?fn():setM2Debug(mode)};grid.appendChild(b);return b;};
 mk('FINAL','final',selectFinalDebug);mk('SECONDARY','m2-secondary');mk('DRAIN MASK','m2-drain');mk('ATOMIC','caustics',selectAtomicDebug);wrap.appendChild(grid);
 const hudBtn=document.createElement('button');hudBtn.type='button';hudBtn.className='v5Btn v5Wide';hudBtn.id='v5DevHudToggle';hudBtn.onclick=e=>{e.preventDefault();e.stopPropagation();state.devHud=!state.devHud;saveState();syncDevHudToggle();};wrap.appendChild(hudBtn);
 const note=document.createElement('div');note.className='v5Note';note.textContent=`GPU pool: ${SEC_CAP.toLocaleString()} secondary particles. The drain now removes primary fluid by compacting all PBF attributes; rigid-body particles are never deleted. ATOMIC opens the projected-caustic accumulation texture.`;wrap.appendChild(note);
 wrap.addEventListener('pointerdown',e=>e.stopPropagation());wrap.addEventListener('click',e=>e.stopPropagation());lab.appendChild(wrap);
 const drainBtn=document.querySelector('#v5Lab [data-scenario="drain"]');if(drainBtn)drainBtn.textContent='DRAIN';
 document.querySelectorAll('#v5Lab .v5Note').forEach(n=>{if(n.textContent.includes('DRAIN β'))n.textContent='Projected caustics use the live atomic accumulation map; Milestone 2 adds true GPU drain compaction plus persistent secondary spray/foam.';});
 syncDevHudToggle();return true;
}
function syncDevHudToggle(){const b=document.getElementById('v5DevHudToggle');if(b){b.classList.toggle('active',state.devHud);b.textContent=state.devHud?'DEVELOPER HUD: ON':'DEVELOPER HUD';}}
function bootM2UI(){if(!installM2UI())setTimeout(bootM2UI,80)}bootM2UI();

const devHud=document.createElement('div');devHud.id='v5M2DevHud';devHud.className='hud card';
devHud.style.cssText='left:max(12px,env(safe-area-inset-left));top:max(72px,calc(env(safe-area-inset-top) + 72px));padding:8px 10px;font-size:8px;line-height:1.5;color:#aeeaf0;white-space:pre;pointer-events:none;max-width:48vw;';document.body.appendChild(devHud);
function hudTick(){
 const eye=cam.eye();const waterY=sim.params.box[1]*.28;const uwDepth=Math.max(0,waterY-eye[1]);
 const atomic=window.__v5ProjectedCaustics;const show=state.devHud||window.__v5DebugMode!=='final';devHud.style.display=show?'block':'none';
 if(show)devHud.textContent=`V5 M2 · ${quality.toUpperCase()}${state.autoQuality?' AUTO':''}\nSSFR ${Math.round(ssfr.renderScale*100)}% · FPS ${autoBudget.ema.toFixed(1)} · GPU pressure ${Math.round(autoBudget.pressure*100)}%\nprimary ${sim.n.toLocaleString()} · fluid ${(sim.scene?.nFluid||0).toLocaleString()} · rigid ${sim.nBodyParts.toLocaleString()}\nsecondary cap ${SEC_CAP.toLocaleString()} · budget ${Math.round(autoBudget.secondaryScale*100)}%\ndrain removed ${drainedTotal.toLocaleString()}${drainBusy?' · compacting…':''}${drainLastRemoved?` · last ${drainLastRemoved}`:''}\natomic caustics ${atomic?atomic.width+'×'+atomic.height:'offline'} · UW depth ${uwDepth.toFixed(2)} m`;
 const stats=document.getElementById('v4stats');if(stats&& !stats.textContent.includes('M2'))stats.textContent+=' · M2';
}
setInterval(hudTick,300);

window.__v5M2={
  version:'5.0.0-m2',
  secondaryCapacity:SEC_CAP,
  get drainedTotal(){return drainedTotal;},
  get drainBusy(){return drainBusy;},
  autoBudget,
  resetSecondaryPool,
};

await Promise.all([initDrain(),initSecondary(),initUnderwaterOverlay(),initDevOverlay()]);
console.info(`[Fluid V5 M2] real drain + auto graphics + underwater optics + developer HUD + ${SEC_CAP} secondary particles ready.`);
