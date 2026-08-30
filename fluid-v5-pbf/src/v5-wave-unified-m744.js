// Fluid V5 M7.4.4.1 — stronger physically-scaled Wave Tank on the proven unified scheduler.
// Still adds ZERO queue.submit calls. The virtual piston acts over the full local water column
// and uses piston displacement/velocity X=A sin(wt), U=A*w*cos(wt), which makes the UI controls
// produce a much wider, immediately visible range of real PBF responses.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes;
if(!sim?.dev||!ui||!scenes?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.4.4.1 wave: unified scene runtime unavailable.');
const dev=sim.dev;

const shader=`
struct WaveU {
  box:vec4f,
  drive:vec4f,
  shape:vec4f,
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
  let band=max(U.shape.x,0.001);
  let wallX=U.shape.y;
  let waterDepth=max(U.shape.z,0.001);
  let gain=clamp(U.shape.w,0.0,0.92);
  let q=clamp((p.x-wallX)/band,0.0,1.0);
  let edge=(1.0-q)*(1.0-q)*(1.0+2.0*q);
  if(edge<=0.0001){return;}

  // A piston wavemaker primarily imposes horizontal velocity through the water column.
  // Give the free-surface region a modest extra response without turning this into a VFX wave.
  let depth01=clamp(p.y/waterDepth,0.0,1.35);
  let columnWeight=0.72+0.28*clamp(depth01,0.0,1.0);
  let surfaceWeight=smoothstep(0.48,1.18,depth01);
  let pistonVelocity=U.drive.w;
  let desiredX=pistonVelocity*columnWeight;

  var v=vel[i];
  let follow=clamp(gain*edge*(0.78+0.22*surfaceWeight),0.0,0.90);
  v.x=mix(v.x,desiredX,follow);

  // Small physically-coupled crest bias. Most elevation still comes from PBF pressure response;
  // this only compensates for approximating a moving solid wall with a velocity boundary band.
  let lift=sin(U.drive.x)*abs(pistonVelocity)*0.055*edge*surfaceWeight;
  v.y+=lift;
  vel[i]=v;
}`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M7441WaveWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M7.4.4.1 wave WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M7441Wave',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M7441WaveUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16), U32=new Uint32Array(F.buffer);

let enabled=false;
let phase=0;
let strength=0.62;
let frequency=0.82;
let passCount=0;
let inStep=false;
let lastDt=1/60;
let lastStroke=0;
let lastPistonVelocity=0;
const baseStep=sim.step.bind(sim);
const baseCreate=dev.createCommandEncoder.bind(dev);

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function waveKinematics(){
  const s=clamp(strength,0.05,1.35);
  const strokeAmp=0.018+0.185*Math.pow(s/1.35,1.55);
  const omega=6.28318530718*clamp(frequency,0.22,1.80);
  const rawVelocity=strokeAmp*omega*Math.cos(phase);
  return {strokeAmp,omega,pistonVelocity:clamp(rawVelocity,-1.75,1.75)};
}
function encodeWave(enc){
  const b=sim.params.box;
  const n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  const d=sim.params.spacing||0.04;
  const dt=Math.min(0.05,Math.max(0.001,lastDt));
  const kin0=waveKinematics();
  phase += dt*kin0.omega;
  if(phase>628.318530718) phase-=628.318530718;
  const kin=waveKinematics();
  lastStroke=kin.strokeAmp;
  lastPistonVelocity=kin.pistonVelocity;

  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=phase;F[5]=kin.strokeAmp;F[6]=kin.omega;F[7]=kin.pistonVelocity;
  F[8]=Math.max(d*8,b[0]*0.245);
  F[9]=d*0.65;
  F[10]=Math.max(d*6,b[1]*0.30);
  F[11]=clamp(0.48+0.25*(strength/1.35),0.48,0.74);
  U32[12]=n;U32[13]=0;U32[14]=0;U32[15]=0;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  if(!pos||!vel)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},
    {binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M7441WavePass'});
  pass.setPipeline(pipe);
  pass.setBindGroup(0,bg);
  pass.dispatchWorkgroups(Math.ceil(n/256));
  pass.end();
  passCount++;
  return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&enabled){
    try{encodeWave(enc)}catch(err){console.error('[M7.4.4.1 wave pass]',err);enabled=false;syncUI();}
  }
  return enc;
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;inStep=true;try{return baseStep(dt)}finally{inStep=false}};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let scenePage=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
let waveBtn=null,status=null,strengthInput=null,freqInput=null;
function disableWave(){enabled=false;syncUI()}
const oldChoose=scenes.choose.bind(scenes);
scenes.choose=function(name){if(name==='wave'){enableWave();return}disableWave();return oldChoose(name)};
function enableWave(){
  enabled=true;
  phase=0;
  oldChoose('pool');
  if(ui.paused)ui.paused=false;
  syncUI();
}
function syncUI(){
  waveBtn?.classList.toggle('active',enabled);
  if(status)status.textContent=`WAVE ${enabled?'ON':'OFF'} · power ${strength.toFixed(2)} · freq ${frequency.toFixed(2)} Hz\n`+
    `piston amplitude ${(lastStroke*100).toFixed(1)} cm · speed ${Math.abs(lastPistonVelocity).toFixed(2)} m/s\n`+
    `wave passes ${passCount} · extra queue submits 0`;
  if(strengthInput)strengthInput.value=String(strength);
  if(freqInput)freqInput.value=String(frequency);
}
if(scenePage){
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">UNIFIED PISTON WAVE TANK · M7.4.4.1</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  waveBtn=document.createElement('button');waveBtn.className='m742Btn';waveBtn.textContent='WAVE TANK';waveBtn.onclick=e=>{e.preventDefault();e.stopPropagation();enabled?disableWave():enableWave()};grid.appendChild(waveBtn);sec.appendChild(grid);
  const makeSlider=(label,min,max,step,value,oninput)=>{const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=Number(value).toFixed(2);input.oninput=()=>{const x=Number(input.value);val.textContent=x.toFixed(2);oninput(x);syncUI()};row.append(l,input,val);sec.appendChild(row);return input};
  strengthInput=makeSlider('WAVE POWER',0.05,1.35,0.05,strength,v=>strength=v);
  freqInput=makeSlider('FREQUENCY',0.22,1.80,0.04,frequency,v=>frequency=v);
  const presets=document.createElement('div');presets.className='m742Grid';presets.style.marginTop='8px';
  for(const [label,pow,freq] of [['CALM',0.28,0.55],['CHOPPY',0.70,0.95],['STORM',1.18,1.30]]){
    const b=document.createElement('button');b.className='m742Btn';b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();strength=pow;frequency=freq;enableWave();syncUI()};presets.appendChild(b);
  }
  sec.appendChild(presets);
  const note=document.createElement('div');note.className='m742Note';note.textContent='This version approximates a piston wavemaker: X=A sin(ωt), U=Aω cos(ωt). WAVE POWER changes physical piston stroke, FREQUENCY changes both oscillation rate and piston speed. The forcing acts through a full-depth wall band, so changes should now be obvious in the real PBF water while still using the same single GPU submission per frame.';sec.appendChild(note);
  scenePage.appendChild(sec);
  status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);syncUI();
}

window.__v5M744Wave={online:true,backend:'unified-physical-piston-m7441',enable:enableWave,disable:disableWave,get enabled(){return enabled},get passCount(){return passCount},get strength(){return strength},get frequency(){return frequency},get stroke(){return lastStroke},get pistonVelocity(){return lastPistonVelocity}};
window.__fluidV5Version='7.4.4.1';
console.info('[Fluid V5 M7.4.4.1] stronger physical piston wavemaker online; zero extra queue submits.');
