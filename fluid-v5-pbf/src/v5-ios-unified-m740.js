// Fluid V5 M7.4.0 — unified iOS/WebKit frame scheduler.
// Keeps the M7.3.9 breakthrough: PBF compute + all renderer/SSFR feature passes are encoded into
// one GPUCommandEncoder and submitted once per visible frame. Adds deferred interaction impulses,
// post-submit CPU readbacks and a pre-step hook for safe feature modules.

const q = new URLSearchParams(location.search);
const safe = {
  quality:'low', timing:'0', bodies:'1', bodyphases:'0',
  substeps:'2', iters:'3', tension:'0.12', ssfrscale:'0.34',
  ssfriters:'2', ssfrthickblur:'14'
};
for (const [k,v] of Object.entries(safe)) if (!q.has(k)) q.set(k,v);
history.replaceState(null,'',location.pathname+'?'+q.toString()+location.hash);

await import('./main.js');

const sim = window.__sim;
const ui = window.__ui;
if (!sim?.dev?.queue || !ui) throw new Error('M7.4 unified scheduler: PBF runtime unavailable.');

const dev = sim.dev;
const queue = dev.queue;
const nativeCreate = dev.createCommandEncoder.bind(dev);
const nativeSubmit = queue.submit.bind(queue);
const nativeDone = queue.onSubmittedWorkDone ? queue.onSubmittedWorkDone.bind(queue) : async()=>{};
const baseStep = sim.step.bind(sim);

let inStep=false;
let sharedReal=null;
let sharedProxy=null;
let simFinished=false;
let submitted=0;
let held=0;
let unifiedFrames=0;
let renderOnlyFrames=0;
let unexpected=0;
let externalSubmits=0;
let suspended=false;
let externalMode=false;
let frameSerial=0;
const SENTINEL=Object.freeze({m740Held:true});
const preStepHooks=new Set();

// Upstream starts MAP_READ before its submit. Unified mode delays that submit until rendering has
// been encoded, so own the optional readbacks here and map only after the combined submission.
sim.statsBusy=true;
sim.poseBusy=true;
let statsBusy=false,poseBusy=false,pendingStats=null,pendingPose=null;

// ----- Deferred impulses ----------------------------------------------------
// Upstream applyRayImpulse normally creates + submits a separate command buffer immediately.
// Queue the interaction instead, then encode it at the front of the next unified frame.
const IMPULSE_SLOTS=12;
const impulseUniforms=Array.from({length:IMPULSE_SLOTS},(_,i)=>dev.createBuffer({
  label:`fluidV5M740Impulse${i}`, size:48,
  usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST
}));
let impulses=[];
let impulseDropped=0;
sim.applyRayImpulse=function(origin,dir,impulse,radius,speedLimit){
  if(!sim.n||!(radius>0)||!origin||!dir||!impulse)return;
  const len=Math.hypot(Number(impulse[0])||0,Number(impulse[1])||0,Number(impulse[2])||0);
  if(!(len>0))return;
  const dl=Math.hypot(Number(dir[0])||0,Number(dir[1])||0,Number(dir[2])||0)||1;
  const item={
    origin:[Number(origin[0])||0,Number(origin[1])||0,Number(origin[2])||0],
    dir:[(Number(dir[0])||0)/dl,(Number(dir[1])||0)/dl,(Number(dir[2])||0)/dl],
    impulse:[Number(impulse[0])||0,Number(impulse[1])||0,Number(impulse[2])||0],
    radius:Number(radius)||0.2,
    limit:Number(speedLimit)||8,
  };
  if(impulses.length>=IMPULSE_SLOTS){impulses.shift();impulseDropped++;}
  impulses.push(item);
};

function encodeImpulses(enc){
  if(!impulses.length||!sim.pipe?.impulse||!sim.buf)return;
  const batch=impulses.splice(0,IMPULSE_SLOTS);
  const par=sim.parity;
  const s=par===0?'A':'B';
  const pos=sim.buf['pos'+s],vel=sim.buf['vel'+s];
  if(!pos||!vel)return;
  const pass=enc.beginComputePass({label:'fluidV5M740DeferredImpulses'});
  for(let i=0;i<batch.length;i++){
    const e=batch[i],F=new Float32Array(12),U=new Uint32Array(F.buffer);
    F[0]=e.origin[0];F[1]=e.origin[1];F[2]=e.origin[2];F[3]=e.radius;
    F[4]=e.dir[0];F[5]=e.dir[1];F[6]=e.dir[2];F[7]=e.limit;
    F[8]=e.impulse[0];F[9]=e.impulse[1];F[10]=e.impulse[2];U[11]=sim.n;
    dev.queue.writeBuffer(impulseUniforms[i],0,F);
    const bg=dev.createBindGroup({layout:sim.pipe.impulse.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:impulseUniforms[i]}},
      {binding:1,resource:{buffer:pos}},
      {binding:2,resource:{buffer:vel}},
    ]});
    pass.setPipeline(sim.pipe.impulse);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));
  }
  pass.end();
}

function runPreStep(enc){
  encodeImpulses(enc);
  for(const fn of [...preStepHooks]){
    try{fn(enc,sim)}catch(err){console.error('[M7.4 pre-step hook]',err);preStepHooks.delete(fn)}
  }
}

function proxyEncoder(real){
  return new Proxy(real,{
    get(target,prop){
      if(prop==='finish')return(...args)=>{
        if(inStep){simFinished=true;return SENTINEL;}
        return target.finish(...args);
      };
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
}

function createUnified(desc){
  if(inStep){
    if(sharedReal){unexpected++;return nativeCreate(desc);}
    sharedReal=nativeCreate(desc);
    sharedProxy=proxyEncoder(sharedReal);
    simFinished=false;
    runPreStep(sharedReal);
    return sharedProxy;
  }
  if(sharedReal&&simFinished)return sharedProxy;
  renderOnlyFrames++;
  return nativeCreate(desc);
}

function beginReadbacks(){
  // Reduced cadence keeps CPU/GPU synchronization light while restoring body hit-testing and HUD data.
  frameSerial++;
  if(sharedReal&&sim.buf?.statsOut&&sim.statsRead&&!statsBusy&&frameSerial%6===0){
    const buf=sim.statsRead;
    try{sharedReal.copyBufferToBuffer(sim.buf.statsOut,0,buf,0,32);statsBusy=true;pendingStats={buf,n:sim.n,gen:sim.gen};}catch{}
  }
  if(sharedReal&&sim.nBodies>0&&sim.buf?.bodyCentre&&sim.buf?.bodyRot&&sim.poseRead&&!poseBusy&&frameSerial%2===0){
    const buf=sim.poseRead,n=sim.nBodies;
    try{
      sharedReal.copyBufferToBuffer(sim.buf.bodyCentre,0,buf,0,n*16);
      sharedReal.copyBufferToBuffer(sim.buf.bodyRot,0,buf,n*16,n*48);
      poseBusy=true;pendingPose={buf,n,gen:sim.gen};
    }catch{}
  }
}

function mapPending(){
  const st=pendingStats;pendingStats=null;
  if(st){
    st.buf.mapAsync(GPUMapMode.READ).then(()=>{
      if(sim.statsRead!==st.buf||sim.gen!==st.gen){try{st.buf.unmap()}catch{};statsBusy=false;return;}
      const v=new Uint32Array(st.buf.getMappedRange()),S=1024;
      sim.stats.avgRho=v[0]/S/Math.max(1,st.n);sim.stats.maxRho=v[1]/S;sim.stats.maxSpeed=v[2]/S;sim.stats.ke=v[3]/S;
      st.buf.unmap();statsBusy=false;
    }).catch(()=>{statsBusy=false});
  }
  const ps=pendingPose;pendingPose=null;
  if(ps){
    ps.buf.mapAsync(GPUMapMode.READ).then(()=>{
      if(sim.poseRead!==ps.buf||sim.gen!==ps.gen){try{ps.buf.unmap()}catch{};poseBusy=false;return;}
      const v=new Float32Array(ps.buf.getMappedRange()),rotBase=ps.n*4;
      for(let i=0;i<Math.min(ps.n,sim.bodyPose?.length||0);i++){
        const p=sim.bodyPose[i];p.centre[0]=v[i*4];p.centre[1]=v[i*4+1];p.centre[2]=v[i*4+2];
        for(let r=0;r<3;r++)for(let c=0;c<3;c++)p.rot[c*3+r]=v[rotBase+(i*3+r)*4+c];
      }
      ps.buf.unmap();poseBusy=false;
    }).catch(()=>{poseBusy=false});
  }
}

function submitUnified(commandBuffers){
  const list=Array.from(commandBuffers||[]);
  if(list.length===1&&list[0]===SENTINEL){held++;return;}
  if(suspended&&!externalMode){held++;return;}
  const out=nativeSubmit(list);submitted++;
  if(externalMode)externalSubmits++;
  if(sharedReal){unifiedFrames++;sharedReal=null;sharedProxy=null;simFinished=false;mapPending();}
  return out;
}

try{
  Object.defineProperty(dev,'createCommandEncoder',{configurable:true,writable:true,value:createUnified});
  Object.defineProperty(queue,'submit',{configurable:true,writable:true,value:submitUnified});
}catch(err){throw new Error('M7.4 could not install unified encoder shim: '+String(err?.message||err));}

sim.step=function(frameDt){
  inStep=true;
  try{
    const out=baseStep(frameDt);
    beginReadbacks();
    return out;
  }finally{inStep=false;}
};

// Serialize reset/prime-grid one-shot work so it never overlaps the normal visible-frame stream.
const resetEl=document.getElementById('reset');
if(resetEl&&typeof resetEl.onclick==='function'){
  const baseResetClick=resetEl.onclick;
  let resetBusy=false;
  resetEl.onclick=async function(...args){
    if(resetBusy)return;resetBusy=true;
    const wasPaused=!!ui.paused;ui.paused=true;suspended=true;
    try{
      await nativeDone();
      externalMode=true;baseResetClick.apply(this,args);externalMode=false;
      await nativeDone();
    }catch(err){console.error('[M7.4 serialized reset]',err);externalMode=false;}
    finally{suspended=false;ui.paused=wasPaused;resetBusy=false;}
  };
}

window.__v5M740Unified={
  online:true,backend:'ios-unified-feature-frame-m740',
  addPreStep(fn){if(typeof fn==='function')preStepHooks.add(fn);return()=>preStepHooks.delete(fn)},
  get submitted(){return submitted},get held(){return held},get unifiedFrames(){return unifiedFrames},
  get renderOnlyFrames(){return renderOnlyFrames},get unexpected(){return unexpected},get externalSubmits(){return externalSubmits},
  get impulsesQueued(){return impulses.length},get impulseDropped(){return impulseDropped},get open(){return!!sharedReal},
};
window.__fluidV5Version='7.4.0';window.__fluidV5Build='M7.4 UNIFIED FEATURE FRAME';
console.info('[Fluid V5 M7.4] unified frame scheduler + deferred impulses online.');
