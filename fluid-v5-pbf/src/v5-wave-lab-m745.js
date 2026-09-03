// Fluid V5 M7.4.5 — Wave Laboratory on the proven M7.3.9 single-submit scheduler.
// One additional compute PASS inside the already-shared physics+render GPUCommandEncoder.
// ZERO extra queue.submit calls. The driver supports regular, packets, resonant/standing,
// JONSWAP-like irregular seas, focused groups and directional crossing waves, plus a passive
// sponge beach. Lake/ocean buttons are explicitly scaled physical-model presets, not km-scale CFD.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes;
if(!sim?.dev||!ui||!scenes?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.4.5 wave lab: unified scene runtime unavailable.');
const dev=sim.dev;

const shader=`
struct WaveU {
  box:vec4f,
  control:vec4f,
  water:vec4f,
  timing:vec4f,
  flags:vec4u,
  comps:array<vec4f,8>,
  dirs:array<vec4f,8>,
}
@group(0) @binding(0) var<uniform> U:WaveU;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;

fn packetEnvelope(t:f32, ramp:f32, duration:f32)->f32 {
  let up=smoothstep(0.0,max(ramp,0.02),t);
  let down=1.0-smoothstep(max(duration-ramp,0.03),max(duration,0.04),t);
  return clamp(up*down,0.0,1.0);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=U.flags.x){return;}
  let p=pos[i].xyz;
  var v=vel[i];
  let band=max(U.control.z,0.001);
  let wallX=U.water.y;
  let q=clamp((p.x-wallX)/band,0.0,1.0);
  let edge=(1.0-q)*(1.0-q)*(1.0+2.0*q);
  let waterDepth=max(U.water.x,0.001);
  let depth01=clamp(p.y/waterDepth,0.0,1.4);
  let columnWeight=0.68+0.32*clamp(depth01,0.0,1.0);
  let surfaceWeight=smoothstep(0.48,1.18,depth01);
  let t=U.control.x;
  let ramp=max(U.timing.x,0.02);
  let mode=U.flags.y;
  let nComp=min(U.flags.w,8u);

  var envelope=smoothstep(0.0,ramp,t);
  if(mode==1u){
    envelope=packetEnvelope(t,ramp,max(U.timing.y,0.1));
  }

  if(edge>0.0001 && envelope>0.0001){
    var desiredX=0.0;
    var desiredZ=0.0;
    var crestLift=0.0;
    for(var c:u32=0u;c<8u;c=c+1u){
      if(c>=nComp){break;}
      let a=U.comps[c].x;
      let w=U.comps[c].y;
      let phi=U.comps[c].z;
      let kz=U.comps[c].w;
      let dz=clamp(U.dirs[c].x,-0.94,0.94);
      let dx=sqrt(max(0.01,1.0-dz*dz));
      let ang=w*t+phi+kz*(p.z-U.box.z*0.5);
      let fundamental=a*w*cos(ang);
      let second=U.timing.w*0.32*a*w*2.0*cos(2.0*ang);
      let driveVel=fundamental+second;
      desiredX+=driveVel*dx;
      desiredZ+=driveVel*dz;
      crestLift+=sin(ang)*abs(driveVel);
    }
    let gain=clamp(U.control.y*edge*(0.76+0.24*surfaceWeight),0.0,0.94);
    v.x=mix(v.x,desiredX*columnWeight*envelope,gain);
    v.z=mix(v.z,desiredZ*columnWeight*envelope,gain*0.82);
    v.y+=crestLift*0.028*edge*surfaceWeight*envelope;
  }

  // Passive numerical beach / sponge layer. This is deliberately local to the same pass.
  // mode 0 = reflective wall, 1 = damped beach, 2 = strong open-boundary approximation.
  let absorbMode=U.flags.z;
  if(absorbMode>0u){
    let absorbWidth=max(U.water.z,0.001);
    let beginX=U.box.x-absorbWidth;
    let aq=smoothstep(beginX,U.box.x,p.x);
    let baseLoss=select(0.12,0.22,absorbMode==2u);
    let loss=clamp(aq*U.control.w*baseLoss,0.0,0.42);
    v.x*=1.0-loss;
    v.y*=1.0-loss*0.72;
    v.z*=1.0-loss*0.62;
    // In the stronger mode suppress back-travel preferentially near the far wall.
    if(absorbMode==2u && v.x<0.0){v.x*=1.0-clamp(aq*U.control.w*0.18,0.0,0.28);}
  }
  vel[i]=v;
}`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M745WaveLabWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M7.4.5 wave lab WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M745WaveLab',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uniformBytes=16*(5+8+8);
const uni=dev.createBuffer({label:'fluidV5M745WaveLabUniform',size:uniformBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(uniformBytes/4), U32=new Uint32Array(F.buffer);

const G=9.81, TAU=Math.PI*2;
const MODE={regular:0,packet:1,standing:2,jonswap:3,focused:4,cross:5};
let enabled=false, kind='regular', absorb='beach';
let power=0.62, frequency=0.82, rampTime=1.4, burstCycles=7, nonlinearity=0.10;
let spreadDeg=18, gamma=3.3, focusTime=5.0, focusPos=0.58;
let absorbStrength=0.78, passCount=0, inStep=false, elapsed=0, lastDt=1/60;
let presetName='CUSTOM';
const baseStep=sim.step.bind(sim), baseCreate=dev.createCommandEncoder.bind(dev);

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function dispersionK(omega,h){
  h=Math.max(0.05,h);let k=Math.max(0.02,omega*omega/G);
  for(let n=0;n<7;n++){
    const kh=k*h,t=Math.tanh(kh),sech2=1/(Math.cosh(kh)*Math.cosh(kh));
    const f=G*k*t-omega*omega;
    const df=G*(t+k*h*sech2);
    k=Math.max(0.001,k-f/Math.max(df,1e-5));
  }
  return k;
}
function strokeAmplitude(){
  const s=clamp(power,0.03,1.45);
  return 0.012+0.205*Math.pow(s/1.45,1.52);
}
function seededPhase(i){return ((i*2.399963229728653)+0.73)%(TAU)}
function spectrumWeight(f,fp,gam){
  const ratio=Math.max(0.08,fp/f);
  const sigma=f<=fp?0.07:0.09;
  const r=Math.exp(-Math.pow(f-fp,2)/(2*sigma*sigma*fp*fp));
  const base=Math.pow(Math.max(f,0.05),-5)*Math.exp(-1.25*Math.pow(ratio,4));
  return base*Math.pow(clamp(gam,1,7),r);
}
function buildComponents(depth){
  const out=[];const amp=strokeAmplitude();const fp=clamp(frequency,0.18,1.90);
  const spread=clamp(spreadDeg,0,42)*Math.PI/180;
  if(kind==='regular'||kind==='packet'||kind==='standing'){
    const w=TAU*fp,k=dispersionK(w,depth);out.push({a:amp,w,phi:0,dz:0,kz:0,k});
  }else if(kind==='jonswap'){
    const raw=[];let sumA=0;
    for(let i=0;i<8;i++){
      const f=fp*(0.56+i*(1.12/7));const w=TAU*f;const sw=spectrumWeight(f,fp,gamma);
      const a=Math.sqrt(Math.max(sw,0));const angle=spread*Math.sin(i*2.17+0.4);
      const k=dispersionK(w,depth),dz=Math.sin(angle);raw.push({a,w,phi:seededPhase(i),dz,kz:k*dz,k});sumA+=a;
    }
    for(const c of raw){c.a=amp*(c.a/Math.max(sumA,1e-8))*2.65;out.push(c)}
  }else if(kind==='focused'){
    let sum=0;const tmp=[];const xFocus=(sim.params.box?.[0]||2)*clamp(focusPos,0.25,0.82);
    for(let i=0;i<8;i++){
      const t=i/7;const f=fp*(0.58+0.86*t);const w=TAU*f;const k=dispersionK(w,depth);
      const weight=0.25+0.75*Math.pow(Math.sin(Math.PI*(i+0.5)/8),2);sum+=weight;
      // Components are phase scheduled to arrive approximately together at xFocus, t=focusTime.
      const phi=-w*focusTime+k*xFocus;tmp.push({a:weight,w,phi,dz:0,kz:0,k});
    }
    for(const c of tmp){c.a=amp*(c.a/sum)*3.05;out.push(c)}
  }else if(kind==='cross'){
    const angles=[-1,-0.55,0.55,1,-0.82,0.82,-0.28,0.28];
    for(let i=0;i<8;i++){
      const f=fp*(0.82+0.36*(i%4)/3);const w=TAU*f,k=dispersionK(w,depth);const dz=Math.sin(spread*angles[i]);
      out.push({a:amp/5.0,w,phi:seededPhase(i)*0.45,dz,kz:k*dz,k});
    }
  }
  return out.slice(0,8);
}
function absorbCode(){return absorb==='reflective'?0:(absorb==='open'?2:1)}
function encodeWave(enc){
  const b=sim.params.box,n=Math.max(1,sim.scene?.nFluid||sim.n||1),d=sim.params.spacing||0.04;
  const dt=Math.min(0.05,Math.max(0.001,lastDt));elapsed+=dt;
  const depth=Math.max(d*6,b[1]*0.30);const comps=buildComponents(depth);
  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=elapsed;F[5]=clamp(0.50+0.27*(power/1.45),0.48,0.78);F[6]=Math.max(d*9,b[0]*0.27);F[7]=clamp(absorbStrength,0,1.5);
  F[8]=depth;F[9]=d*0.62;F[10]=Math.max(d*8,b[0]*0.24);F[11]=b[0]*focusPos;
  const duration=Math.max(0.4,burstCycles/Math.max(frequency,0.05));
  F[12]=rampTime;F[13]=duration;F[14]=focusTime;F[15]=nonlinearity;
  U32[16]=n;U32[17]=MODE[kind]??0;U32[18]=absorbCode();U32[19]=comps.length;
  const compBase=20,dirBase=20+8*4;
  for(let i=0;i<8;i++){
    const c=comps[i];if(!c)continue;const o=compBase+i*4;F[o]=c.a;F[o+1]=c.w;F[o+2]=c.phi;F[o+3]=c.kz;
    const q=dirBase+i*4;F[q]=c.dz;F[q+1]=0;F[q+2]=0;F[q+3]=0;
  }
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();if(!pos||!vel)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}}]});
  const pass=enc.beginComputePass({label:'fluidV5M745WaveLabPass'});pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();passCount++;return true;
}

dev.createCommandEncoder=function(desc){const enc=baseCreate(desc);if(inStep&&enabled){try{encodeWave(enc)}catch(err){console.error('[M7.4.5 wave lab pass]',err);enabled=false;syncUI()}}return enc};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;inStep=true;try{return baseStep(dt)}finally{inStep=false}};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let scenePage=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
let status=null,modeBtns=[],absorbBtns=[],powerInput=null,freqInput=null,rampInput=null,burstInput=null,spreadInput=null,gammaInput=null,focusTimeInput=null,focusPosInput=null,nonlinInput=null;
const oldChoose=scenes.choose.bind(scenes);
function disable(){enabled=false;syncUI()}
function enable(nextKind=kind){kind=nextKind;enabled=true;elapsed=0;oldChoose('pool');if(ui.paused)ui.paused=false;syncUI()}
scenes.choose=function(name){if(name==='wave'||name==='wavelab'){enable(kind);return}disable();return oldChoose(name)};
function setEngine(id,v){const e=document.getElementById(id);if(!e)return;e.value=String(v);try{if(typeof e.oninput==='function')e.oninput();else e.dispatchEvent(new Event('input',{bubbles:true}))}catch{}}
function applyWaterLook(name){
  if(name==='LAKE'){setEngine('ior',1.333);setEngine('absorption',0.72);setEngine('roughness',0.075)}
  else if(name==='COASTAL'){setEngine('ior',1.333);setEngine('absorption',0.88);setEngine('roughness',0.065)}
  else if(name==='OCEAN'||name==='STORM OCEAN'){setEngine('ior',1.333);setEngine('absorption',1.02);setEngine('roughness',0.055)}
}
function preset(name){
  presetName=name;
  if(name==='LAKE'){kind='jonswap';power=.34;frequency=.62;spreadDeg=11;gamma=4.2;rampTime=2.4;nonlinearity=.05;absorb='beach';absorbStrength=.82}
  if(name==='COASTAL'){kind='jonswap';power=.68;frequency=.88;spreadDeg=18;gamma=3.3;rampTime=2.0;nonlinearity=.14;absorb='beach';absorbStrength=.88}
  if(name==='OCEAN'){kind='jonswap';power=.88;frequency=.54;spreadDeg=27;gamma=2.8;rampTime=3.0;nonlinearity=.18;absorb='open';absorbStrength=1.0}
  if(name==='STORM OCEAN'){kind='jonswap';power=1.18;frequency=.76;spreadDeg=32;gamma=3.8;rampTime=2.2;nonlinearity=.28;absorb='open';absorbStrength=1.12}
  applyWaterLook(name);enable(kind);syncUI();
}
function syncUI(){
  for(const b of modeBtns)b.classList.toggle('active',b.dataset.mode===kind&&enabled);
  for(const b of absorbBtns)b.classList.toggle('active',b.dataset.absorb===absorb);
  const values=[[powerInput,power],[freqInput,frequency],[rampInput,rampTime],[burstInput,burstCycles],[spreadInput,spreadDeg],[gammaInput,gamma],[focusTimeInput,focusTime],[focusPosInput,focusPos],[nonlinInput,nonlinearity]];for(const [e,v] of values)if(e)e.value=String(v);
  const amp=strokeAmplitude();const peakSpeed=amp*TAU*frequency;
  if(status)status.textContent=`${enabled?'RUNNING':'OFF'} · ${kind.toUpperCase()} · ${presetName}\n`+
    `stroke ${(amp*100).toFixed(1)} cm · peak piston ${peakSpeed.toFixed(2)} m/s · spread ${spreadDeg.toFixed(0)}°\n`+
    `ramp ${rampTime.toFixed(1)} s · absorber ${absorb.toUpperCase()} · pass ${passCount}\nextra queue submits 0 · unified scheduler preserved`;
}
function makeSlider(parent,label,min,max,step,value,oninput,fmt=x=>Number(x).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const val=document.createElement('div');val.className='m742Val';val.textContent=fmt(value);input.oninput=()=>{const x=Number(input.value);val.textContent=fmt(x);presetName='CUSTOM';oninput(x);syncUI()};row.append(l,input,val);parent.appendChild(row);return input;
}
function buttonGrid(parent,items,handler,dataKey){const g=document.createElement('div');g.className='m742Grid';for(const [label,value] of items){const b=document.createElement('button');b.className='m742Btn';b.textContent=label;b.dataset[dataKey]=value;b.onclick=e=>{e.preventDefault();e.stopPropagation();handler(value)};g.appendChild(b)}parent.appendChild(g);return [...g.children]}

if(scenePage){
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">WAVE LABORATORY · M7.4.5</div><div class="m742Note">All modes use the same physical PBF water and one shared GPU submission per frame. Spectral/focused modes alter the virtual wavemaker signal rather than animating the rendered surface.</div>';
  modeBtns=buttonGrid(sec,[['REGULAR','regular'],['PACKET','packet'],['STANDING','standing'],['JONSWAP','jonswap'],['FOCUSED','focused'],['CROSS SEA','cross']],v=>{presetName='CUSTOM';kind=v;if(v==='standing'){absorb='reflective';const L=sim.params.box?.[0]||2;const h=Math.max(.1,(sim.params.box?.[1]||1)*.30);frequency=clamp(Math.sqrt(G*h)/(2*L),.22,1.4)}enable(v)},'mode');
  powerInput=makeSlider(sec,'WAVE HEIGHT',.03,1.45,.04,power,v=>power=v);
  freqInput=makeSlider(sec,'PEAK FREQ',.18,1.90,.04,frequency,v=>frequency=v,x=>Number(x).toFixed(2)+' Hz');
  rampInput=makeSlider(sec,'RAMP TIME',.1,5,.1,rampTime,v=>rampTime=v,x=>Number(x).toFixed(1)+' s');
  burstInput=makeSlider(sec,'BURST WAVES',1,16,1,burstCycles,v=>burstCycles=v,x=>String(Math.round(x)));
  nonlinInput=makeSlider(sec,'NONLINEAR',0,.65,.025,nonlinearity,v=>nonlinearity=v);
  spreadInput=makeSlider(sec,'DIR SPREAD',0,42,1,spreadDeg,v=>spreadDeg=v,x=>Math.round(x)+'°');
  gammaInput=makeSlider(sec,'JONSWAP γ',1,7,.1,gamma,v=>gamma=v);
  focusTimeInput=makeSlider(sec,'FOCUS TIME',1.5,10,.25,focusTime,v=>focusTime=v,x=>Number(x).toFixed(1)+' s');
  focusPosInput=makeSlider(sec,'FOCUS X',.25,.82,.01,focusPos,v=>focusPos=v,x=>Math.round(x*100)+'%');
  const resetGrid=document.createElement('div');resetGrid.className='m742Grid';resetGrid.style.marginTop='8px';const resetPhase=document.createElement('button');resetPhase.className='m742Btn';resetPhase.textContent='RESET PHASE';resetPhase.onclick=()=>{elapsed=0;syncUI()};const stop=document.createElement('button');stop.className='m742Btn';stop.textContent='STOP WAVES';stop.onclick=disable;const start=document.createElement('button');start.className='m742Btn';start.textContent='START';start.onclick=()=>enable(kind);resetGrid.append(start,resetPhase,stop);sec.appendChild(resetGrid);
  const ab=document.createElement('div');ab.className='m742Section';ab.innerHTML='<div class="m742SectionTitle">FAR BOUNDARY</div>';absorbBtns=buttonGrid(ab,[['REFLECT','reflective'],['BEACH','beach'],['OPEN','open']],v=>{absorb=v;syncUI()},'absorb');const abs=makeSlider(ab,'ABSORB',0,1.5,.05,absorbStrength,v=>absorbStrength=v);void abs;
  const bodies=document.createElement('div');bodies.className='m742Section';bodies.innerHTML='<div class="m742SectionTitle">SCALED MINI WATER BODIES</div><div class="m742Note">These are laboratory-scale analog presets. They reproduce characteristic lake/coastal/ocean wave spectra and directionality inside the small PBF basin; they are not pretending the box is kilometers wide.</div>';buttonGrid(bodies,[['MINI LAKE','LAKE'],['COASTAL SEA','COASTAL'],['OPEN OCEAN','OCEAN'],['STORM OCEAN','STORM OCEAN']],preset,'preset');
  scenePage.append(sec,ab,bodies);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);syncUI();
}

window.__v5M745WaveLab={online:true,backend:'unified-spectral-wave-lab-m745',enable,disable,preset,get kind(){return kind},get enabled(){return enabled},get passCount(){return passCount},get absorb(){return absorb}};
window.__fluidV5Version='7.4.5';window.__fluidV5Build='M7.4.5 UNIFIED WAVE LAB';
console.info('[Fluid V5 M7.4.5] Wave Lab online; zero extra queue submits.');
