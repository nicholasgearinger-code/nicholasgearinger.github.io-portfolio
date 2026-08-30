// Fluid V5 M7.4.4 — Wave Tank restored as ONE extra compute pass inside the proven
// M7.3.9 shared physics+render GPUCommandEncoder. No queue.submit calls are added.
// The pass behaves like a virtual paddle near the left wall: it gently drives the
// existing PBF water laterally with a sinusoidal target velocity.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes;
if(!sim?.dev||!ui||!scenes?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.4.4 wave: unified scene runtime unavailable.');
const dev=sim.dev;

const shader=`
struct WaveU {
  box:vec4f,
  drive:vec4f,
  info:vec4u,
}
@group(0) @binding(0) var<uniform> U:WaveU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=U.info.x){return;}
  let p=pos[i].xyz;
  let band=max(U.drive.z,0.001);
  let edge=1.0-clamp((p.x-U.drive.w)/band,0.0,1.0);
  if(edge<=0.0){return;}
  let surfaceWeight=0.35+0.65*clamp(p.y/max(U.box.y*0.48,0.001),0.0,1.0);
  let phaseValue=U.drive.x;
  let targetVelocity=sin(phaseValue)*U.drive.y*edge*surfaceWeight;
  var v=vel[i];
  let follow=clamp(0.12+0.22*edge,0.0,0.42);
  v.x=mix(v.x,targetVelocity,follow);
  v.y+=cos(phaseValue)*U.drive.y*0.012*edge*surfaceWeight;
  vel[i]=v;
}`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M744WaveWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M7.4.4 wave WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M744Wave',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M744WaveUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12), U32=new Uint32Array(F.buffer);

let enabled=false;
let phase=0;
let strength=0.55;
let frequency=0.92;
let passCount=0;
let inStep=false;
let lastDt=1/60;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

function encodeWave(enc){
  const b=sim.params.box;
  const n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  const d=sim.params.spacing||0.04;
  phase += Math.min(0.05,Math.max(0.001,lastDt))*frequency*6.28318530718;
  if(phase>628.318530718) phase-=628.318530718;
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=phase;F[5]=strength;F[6]=Math.max(d*5,b[0]*0.17);F[7]=d*0.8;
  U32[8]=n;U32[9]=0;U32[10]=0;U32[11]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  if(!pos||!vel)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},
    {binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M744WavePass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passCount++;
  return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&enabled){
    try{encodeWave(enc)}catch(err){console.error('[M7.4.4 wave pass]',err);enabled=false;syncUI();}
  }
  return enc;
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;inStep=true;try{return baseStep(dt)}finally{inStep=false}};

// Extend the existing Scenes page without replacing the proven M7.4.3 Pool/Dam controls.
const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let scenePage=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
let waveBtn=null,status=null,strengthInput=null,freqInput=null;
function disableWave(){enabled=false;syncUI()}
const oldChoose=scenes.choose.bind(scenes);
scenes.choose=function(name){if(name==='wave'){enableWave();return}disableWave();return oldChoose(name)};
function enableWave(){
  enabled=true;
  // Start from the same stable pool initial condition, then let the virtual paddle drive it.
  oldChoose('pool');
  if(ui.paused)ui.paused=false;
  syncUI();
}
function syncUI(){
  waveBtn?.classList.toggle('active',enabled);
  if(status)status.textContent=`WAVE ${enabled?'ON':'OFF'} · strength ${strength.toFixed(2)} · freq ${frequency.toFixed(2)} Hz\nwave passes ${passCount} · extra queue submits 0`;
  if(strengthInput)strengthInput.value=String(strength);
  if(freqInput)freqInput.value=String(frequency);
}
if(scenePage){
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">UNIFIED DYNAMIC SCENE · STEP 2</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  waveBtn=document.createElement('button');waveBtn.className='m742Btn';waveBtn.textContent='WAVE TANK';waveBtn.onclick=e=>{e.preventDefault();e.stopPropagation();enabled?disableWave():enableWave()};grid.appendChild(waveBtn);sec.appendChild(grid);
  const makeSlider=(label,min,max,step,value,oninput)=>{const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=Number(value).toFixed(2);input.oninput=()=>{const x=Number(input.value);val.textContent=x.toFixed(2);oninput(x);syncUI()};row.append(l,input,val);sec.appendChild(row);return input};
  strengthInput=makeSlider('WAVE POWER',0.10,1.10,0.05,strength,v=>strength=v);
  freqInput=makeSlider('FREQUENCY',0.35,1.55,0.05,frequency,v=>frequency=v);
  const note=document.createElement('div');note.className='m742Note';note.textContent='The wave maker changes real particle velocity near one wall. PBF pressure, viscosity and collisions propagate the wave through the basin. It adds one compute pass to the existing shared command buffer, but no new queue submission.';sec.appendChild(note);
  scenePage.appendChild(sec);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);syncUI();
}

window.__v5M744Wave={online:true,backend:'unified-wall-paddle-m744',enable:enableWave,disable:disableWave,get enabled(){return enabled},get passCount(){return passCount},get strength(){return strength},get frequency(){return frequency}};
console.info('[Fluid V5 M7.4.4] Wave Tank unified pass online; zero extra queue submits.');
