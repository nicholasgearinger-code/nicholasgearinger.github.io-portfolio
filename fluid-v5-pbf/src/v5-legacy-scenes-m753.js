// Fluid V5 M7.5.3 — restore the actual M4.6 source/impulse semantics on the stable M7.3.9 scheduler.
// Faucet, waterfall and fountain use Sim.appendFluid() exactly like M4.6. appendFluid performs
// queue.writeBuffer updates only; it does not create or submit a GPUCommandBuffer.
// Paddle and whirlpool reproduce the old applyRayImpulse mathematics in ONE custom compute pass
// encoded into the already-shared PBF+SSFR command encoder.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes,
      wave=window.__v5M745WaveLab, modern=window.__v5M752PhysicalScenes;
if(!sim?.dev||!sim?.appendFluid||!ui||!scenes?.online||!wave?.online||!modern?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.3 legacy fidelity: required unified runtime unavailable.');
const dev=sim.dev;
const baseN=Math.max(1,sim.scene?.nFluid||sim.n||1);
const LEGACY=new Set(['faucet','waterfall','paddle','whirlpool','fountain']);
let active='none', added=0, sourceLast=0, forceLast=0, readyAt=0, start=performance.now();
let seed=0x31415926, forceScale=1.0, sourceRate=1.0, forcePasses=0;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};

const forceWGSL=`
struct LegacyU { box:vec4f, ctrl:vec4f, data:vec4u }
@group(0) @binding(0) var<uniform> U:LegacyU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
fn applyCylinder(p:vec3f,vin:vec3f,origin:vec3f,impulse:vec3f,radius:f32,speedLimit:f32)->vec3f{
  let toP=p-origin;let along=-toP.y;if(along<=0.0){return vin;}
  let radial=vec2f(toP.x,toP.z);let d2=dot(radial,radial);if(d2>=radius*radius){return vin;}
  let fall=1.0-sqrt(d2)/radius;let oldSpeed=length(vin);var outV=vin+(fall*fall)*impulse;
  let newSpeed=length(outV);let allowed=max(oldSpeed,speedLimit);
  if(newSpeed>allowed){outV*=allowed/max(newSpeed,1.0e-6);}return outV;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;let n=U.data.x;if(i>=n){return;}let mode=U.data.y;let b=U.box.xyz;
  let t=U.ctrl.x;let gain=U.ctrl.y;let p=pos[i].xyz;var v=vel[i].xyz;
  if(mode==1u){
    let phase=sin(t*4.2);let origin=vec3f(b.x*.08,b.y*.94,b.z*.50);let radius=max(.24,b.z*.32);
    let impulse=vec3f(.22*phase,.035*phase,.018*sin(t*2.1))*gain;
    v=applyCylinder(p,v,origin,impulse,radius,2.0);
  }
  if(mode==2u){
    let centre=vec2f(b.x*.50,b.z*.50);let y=b.y*.34;let ringR=min(b.x,b.z)*.24;let radius=max(.15,ringR*.62);
    for(var k:u32=0u;k<4u;k=k+1u){
      let a=t*.45+f32(k)*1.57079632679;
      let origin=vec3f(centre.x+cos(a)*ringR,y,centre.y+sin(a)*ringR);
      let impulse=vec3f(-sin(a)*.13,-.025,cos(a)*.13)*gain;
      v=applyCylinder(p,v,origin,impulse,radius,1.75);
    }
  }
  vel[i]=vec4f(v,0.0);
}`;
const mod=dev.createShaderModule({code:forceWGSL,label:'fluidV5M753LegacyImpulseWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.3 legacy impulse WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M753LegacyImpulse',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M753LegacyImpulseUniform',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(12),I=new Uint32Array(F.buffer);
function budget(){return Math.max(0,Math.min(4200,(sim.cap||sim.n)-sim.n-32));}
function restoreBaseCount(){if(sim.n!==baseN){sim.n=baseN;sim.uploadParams?.(1/240);sim.bindCache=null;}added=0;}
function appendCloud(points,vels){const room=budget();if(room<=0)return 0;const n=Math.min(room,points.length/3|0);if(n<=0)return 0;const a=sim.appendFluid(points.slice(0,n*3),vels.slice(0,n*3));added+=a;return a;}
function sourceFaucet(){const b=sim.params.box,d=sim.params.spacing,p=[],v=[],n=6;for(let i=0;i<n;i++){p.push(b[0]*.14+(rnd()-.5)*d*2.2,b[1]*.79+(rnd()-.5)*d,b[2]*.50+(rnd()-.5)*d*3.2);v.push((.72+(rnd()-.5)*.10)*forceScale,(-.28-rnd()*.15)*forceScale,(rnd()-.5)*.12*forceScale);}appendCloud(p,v);}
function sourceWaterfall(){const b=sim.params.box,d=sim.params.spacing,p=[],v=[],n=12;for(let i=0;i<n;i++){const z=b[2]*(.18+.64*i/Math.max(1,n-1));p.push(b[0]*.10+(rnd()-.5)*d,b[1]*.82+(rnd()-.5)*d,z+(rnd()-.5)*d*.8);v.push(.48*forceScale,(-1.05-rnd()*.22)*forceScale,(rnd()-.5)*.04*forceScale);}appendCloud(p,v);}
function sourceFountain(){const b=sim.params.box,d=sim.params.spacing,p=[],v=[],n=5;for(let i=0;i<n;i++){const a=rnd()*Math.PI*2,r=d*(.4+rnd()*1.4);p.push(b[0]*.5+Math.cos(a)*r,b[1]*.16,b[2]*.5+Math.sin(a)*r);v.push(Math.cos(a)*.12*forceScale,(1.25+rnd()*.34)*forceScale,Math.sin(a)*.12*forceScale);}appendCloud(p,v);}
function legacyMode(){return active==='paddle'?1:active==='whirlpool'?2:0;}
function encodeForce(enc){const mode=legacyMode();if(!mode)return false;const now=performance.now();const cadence=(active==='paddle'?58:70)/Math.max(.25,sourceRate);if(now-forceLast<cadence)return false;forceLast=now;const b=sim.params.box;F.fill(0);F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=sim.params.spacing||.04;F[4]=(now-start)*.001;F[5]=forceScale;I[8]=Math.max(1,sim.n||1);I[9]=mode;dev.queue.writeBuffer(uni,0,F);const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}}]});const pass=enc.beginComputePass({label:'fluidV5M753LegacyImpulsePass'});pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();forcePasses++;return true;}
let inStep=false;const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev);
dev.createCommandEncoder=function(desc){const enc=baseCreate(desc);if(inStep&&(active==='paddle'||active==='whirlpool')){try{encodeForce(enc)}catch(err){console.error('[M7.5.3 legacy force]',err);}}return enc;};
sim.step=function(dt){inStep=true;try{return baseStep(dt)}finally{inStep=false;}};
function disableLegacy(resetCount=true){if(active==='none')return;active='none';if(resetCount)restoreBaseCount();syncUI();}
function chooseLegacy(name){if(!LEGACY.has(name))return;modern.disable();wave.disable();restoreBaseCount();scenes.choose('pool');active=name;added=0;sourceLast=0;forceLast=0;start=performance.now();readyAt=start+140;seed=(seed+0x9e3779b9)>>>0;if(ui.paused)ui.paused=false;syncUI();}
function sourceLoop(now){requestAnimationFrame(sourceLoop);if(document.hidden||ui.paused||now<readyAt)return;if(active!=='faucet'&&active!=='waterfall'&&active!=='fountain')return;const cadence=90/Math.max(.25,sourceRate);if(now-sourceLast<cadence||budget()<=0)return;sourceLast=now;if(active==='faucet')sourceFaucet();else if(active==='waterfall')sourceWaterfall();else sourceFountain();}
requestAnimationFrame(sourceLoop);
const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let scenePage=null,status=null;
if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
function buttonsFor(name){if(!scenePage)return[];const label=name.toUpperCase();return[...scenePage.querySelectorAll('button')].filter(b=>(b.textContent||'').trim().toUpperCase()===label);}
function syncUI(){if(scenePage){for(const name of LEGACY)for(const b of buttonsFor(name))b.classList.toggle('active',active===name);}if(status)status.textContent=`M7.5.3 ${active==='none'?'STANDBY':active.toUpperCase()}\noriginal M4.6 source/impulse semantics · feature queue submits 0\nappended real water ${added.toLocaleString()} / 4,200 · remaining source budget ${budget().toLocaleString()}\nlegacy force ${forceScale.toFixed(2)} · cadence ${sourceRate.toFixed(2)}× · unified force passes ${forcePasses}`;}
function addSlider(parent,label,min,max,step,value,onchange,fmt=v=>Number(v).toFixed(2)){const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);input.oninput=e=>{e.stopPropagation();const v=Number(input.value);onchange(v);val.textContent=fmt(v);syncUI();};row.append(l,input,val);parent.appendChild(row);return input;}
if(scenePage){const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">LEGACY PHYSICS FIDELITY · M7.5.3</div><div class="m742Note">FAUCET / WATERFALL / FOUNTAIN now use the actual M4.6 appendFluid source behavior. PADDLE / WHIRLPOOL use the original ray-impulse math, combined into one unified GPU pass instead of extra submissions. Rain, Gravity Pour and Drain remain on M7.5.2.</div>';addSlider(sec,'LEGACY FORCE',.55,1.80,.05,forceScale,v=>forceScale=v);addSlider(sec,'SOURCE / IMPULSE RATE',.50,1.75,.05,sourceRate,v=>sourceRate=v,v=>`${Number(v).toFixed(2)}×`);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';sec.appendChild(status);scenePage.appendChild(sec);scenePage.addEventListener('click',e=>{const btn=e.target.closest?.('button');if(!btn)return;const text=(btn.textContent||'').trim().toLowerCase();if(LEGACY.has(text)){e.preventDefault();e.stopImmediatePropagation();chooseLegacy(text);return;}if(active!=='none')disableLegacy(true);},true);setInterval(syncUI,500);syncUI();}
window.__v5M753LegacyScenes={online:true,backend:'m46-exact-sources-unified-impulses-m753',gpuSubmitsAdded:0,choose:chooseLegacy,disable:disableLegacy,get active(){return active},get added(){return added},get forcePasses(){return forcePasses},get budget(){return budget()},get forceScale(){return forceScale},get sourceRate(){return sourceRate}};
window.__fluidV5Version='7.5.3';window.__fluidV5Build='M7.5.3 LEGACY SOURCE + IMPULSE FIDELITY / M7.3.9 ONE-SUBMIT CORE';const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.3';document.title='Fluid V5 · M7.5.3 Legacy Physics Fidelity';console.info('[Fluid V5 M7.5.3] actual M4.6 appendFluid sources + unified old impulse kernel online; zero added queue submits.');