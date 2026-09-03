// Fluid V5 M7.5.0 — physical effect test scenes on the proven single-submit scheduler.
// All new scene behavior is encoded by ONE mode-switched compute pass inside the existing
// M7.3.9 compute+render GPUCommandEncoder. There are no feature queue.submit() calls.
// Source tests conserve the existing fluid particle count: they reposition a fraction of the
// pool into an elevated initial condition, then let the normal PBF solver + gravity determine
// the result. Continuous tests modify velocities of the same real PBF particles.

const sim=window.__sim, ui=window.__ui, scenes=window.__v5M743Scenes, wave=window.__v5M745WaveLab;
if(!sim?.dev||!ui||!scenes?.online||!wave?.online||!window.__v5M739Unified?.online)
  throw new Error('M7.5.0 physical scenes: stable unified scene runtime unavailable.');
const dev=sim.dev;

const shader=`
struct SceneU {
  box:vec4f,
  control:vec4f,
  motion:vec4f,
  flags:vec4u,
}
@group(0) @binding(0) var<uniform> U:SceneU;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;

fn hash11(x:u32)->f32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  h=(h>>22u)^h;
  return f32(h & 0x00ffffffu)/16777215.0;
}
fn safeDir(v:vec2f)->vec2f {
  let m=max(length(v),1.0e-5);
  return v/m;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  let n=U.flags.x;
  if(i>=n){return;}
  let mode=U.flags.y;
  let fresh=U.flags.z;
  let d=max(U.box.w,0.001);
  let bx=U.box.x;
  let by=U.box.y;
  let bz=U.box.z;
  let time=U.control.x;
  let strength=U.control.y;
  let amount=U.control.z;
  let surface=U.control.w;
  let freq=U.motion.x;
  var p=pos[i];
  var v=vel[i];

  // One-shot source initial conditions. The rest of the particles stay in the pool
  // seeded immediately before this pass, so no water mass is created or deleted.
  if(fresh!=0u && mode>=1u && mode<=4u){
    var fraction=amount;
    if(mode==1u){fraction=amount*0.45;}
    if(mode==3u){fraction=amount*0.18;}
    if(mode==4u){fraction=amount*0.95;}
    let sourceCount=u32(clamp(f32(n)*fraction,1.0,f32(n)));
    if(i<sourceCount){
      if(mode==1u){
        // RAIN BURST — separated droplets throughout the upper air volume.
        let hx=hash11(i*3u+11u);
        let hy=hash11(i*3u+23u);
        let hz=hash11(i*3u+37u);
        p=vec4f(d*1.8+hx*(bx-d*3.6),by*(0.57+0.36*hy),d*1.8+hz*(bz-d*3.6),1.0);
        v=vec4f((hx-0.5)*0.10,-(0.42+0.55*hy)*strength,(hz-0.5)*0.10,0.0);
      }else if(mode==2u){
        // GRAVITY POUR — compact elevated reservoir with a small outward launch.
        let nx=max(3u,u32(floor((bx*0.34)/d)));
        let nz=max(4u,u32(floor((bz*0.66)/d)));
        let layer=nx*nz;
        let ix=i%nx;
        let iz=(i/nx)%nz;
        let iy=i/layer;
        let jx=(hash11(i*5u+7u)-0.5)*d*0.10;
        let jy=(hash11(i*5u+13u)-0.5)*d*0.10;
        let jz=(hash11(i*5u+19u)-0.5)*d*0.10;
        p=vec4f(bx*0.08+(f32(ix)+0.5)*d+jx,by*0.48+(f32(iy)+0.5)*d+jy,bz*0.17+(f32(iz)+0.5)*d+jz,1.0);
        p.y=min(p.y,by*0.90);
        v=vec4f(0.64*strength,-0.12*strength,(hash11(i+91u)-0.5)*0.04,0.0);
      }else if(mode==3u){
        // FAUCET DROP — narrow falling column above one side of the pool.
        let nx=4u;
        let nz=6u;
        let layer=nx*nz;
        let ix=i%nx;
        let iz=(i/nx)%nz;
        let iy=i/layer;
        p=vec4f(bx*0.22+(f32(ix)-1.5)*d*0.86,by*0.43+(f32(iy)+0.5)*d*0.88,bz*0.50+(f32(iz)-2.5)*d*0.78,1.0);
        p.y=min(p.y,by*0.93);
        v=vec4f(0.10*strength,-1.05*strength,(hash11(i+141u)-0.5)*0.05,0.0);
      }else if(mode==4u){
        // WATERFALL DROP — a wide, coherent elevated sheet made from the same pool water.
        let nx=max(6u,u32(floor((bx*0.22)/d)));
        let nz=max(10u,u32(floor((bz*0.78)/d)));
        let layer=nx*nz;
        let ix=i%nx;
        let iz=(i/nx)%nz;
        let iy=i/layer;
        let jitter=(hash11(i*7u+31u)-0.5)*d*0.10;
        p=vec4f(bx*0.07+(f32(ix)+0.5)*d,by*0.42+(f32(iy)+0.5)*d+jitter,bz*0.10+(f32(iz)+0.5)*d,1.0);
        p.y=min(p.y,by*0.94);
        v=vec4f(0.54*strength,-0.86*strength,(hash11(i+223u)-0.5)*0.035,0.0);
      }
      pred[i]=p;
    }
  }

  // Small aerodynamic-style continuation only while source water is airborne.
  if((mode==2u || mode==3u || mode==4u) && p.y>surface*1.04){
    if(mode==2u){v.x+=0.010*strength;}
    if(mode==3u){v.y-=0.010*strength;}
    if(mode==4u){v.x+=0.008*strength;v.y-=0.009*strength;}
  }

  // PADDLE — broad oscillating wall forcing on the real pool volume.
  if(mode==5u){
    let band=max(d*5.0,bx*0.23);
    let q=clamp(p.x/band,0.0,1.0);
    let wall=(1.0-q)*(1.0-q)*(1.0+2.0*q);
    let phase=sin(time*6.2831853*freq);
    let wet=1.0-smoothstep(surface*1.02,surface*1.28,p.y);
    v.x+=phase*strength*0.052*wall*wet;
    v.y+=phase*strength*0.006*wall*wet;
  }

  // WHIRLPOOL — tangential target velocity plus a mild downward core.
  if(mode==6u){
    let centre=vec2f(bx*0.50,bz*0.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=min(bx,bz)*0.42;
    let w=1.0-smoothstep(R*0.20,R,r);
    let dir=safeDir(q);
    let tangent=vec2f(-dir.y,dir.x);
    let targetSpeed=strength*(0.28+1.10*clamp(r/R,0.0,1.0));
    let blend=0.018+0.040*w;
    v.x=mix(v.x,tangent.x*targetSpeed,blend*w);
    v.z=mix(v.z,tangent.y*targetSpeed,blend*w);
    let core=1.0-smoothstep(0.0,R*0.34,r);
    v.y-=core*strength*0.016;
  }

  // FOUNTAIN — bottom-centre jet; once particles leave the nozzle the PBF solver owns them.
  if(mode==7u){
    let centre=vec2f(bx*0.50,bz*0.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=max(d*3.0,min(bx,bz)*0.10);
    let radial=1.0-smoothstep(R*0.28,R,r);
    let low=1.0-smoothstep(surface*0.28,surface*0.62,p.y);
    let nozzle=radial*low;
    let up=0.85+1.55*strength;
    v.y=mix(v.y,up,0.095*nozzle);
    let dir=safeDir(q);
    v.x+=dir.x*strength*0.006*nozzle;
    v.z+=dir.y*strength*0.006*nozzle;
  }

  // DRAIN — converging sink field. It does not delete particles; useful for vortex/suction tests.
  if(mode==8u){
    let centre=vec2f(bx*0.50,bz*0.50);
    let q=p.xz-centre;
    let r=length(q);
    let R=min(bx,bz)*0.34;
    let w=1.0-smoothstep(R*0.12,R,r);
    let wet=1.0-smoothstep(surface*1.0,surface*1.30,p.y);
    let dir=safeDir(q);
    let blend=0.025*w*wet;
    v.x=mix(v.x,-dir.x*strength*0.72,blend);
    v.z=mix(v.z,-dir.y*strength*0.72,blend);
    let core=1.0-smoothstep(0.0,R*0.28,r);
    v.y-=strength*(0.012*w+0.032*core)*wet;
  }

  pos[i]=p;
  vel[i]=v;
}`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5M750PhysicalScenesWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.5.0 physical scene WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M750PhysicalScenes',layout:'auto',compute:{module:mod,entryPoint:'main'}});
const uni=dev.createBuffer({label:'fluidV5M750SceneUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16),U32=new Uint32Array(F.buffer);

const MODE={none:0,rain:1,pour:2,faucet:3,waterfall:4,paddle:5,whirlpool:6,fountain:7,drain:8};
const LABEL={rain:'RAIN BURST',pour:'GRAVITY POUR',faucet:'FAUCET DROP',waterfall:'WATERFALL',paddle:'PADDLE',whirlpool:'WHIRLPOOL',fountain:'FOUNTAIN',drain:'DRAIN'};
let active='none',fresh=false,passCount=0,inStep=false,lastDt=1/60,time=0,seed=1;
let strength=0.86,amount=0.28,frequency=0.72;
const baseStep=sim.step.bind(sim),baseCreate=dev.createCommandEncoder.bind(dev),baseSceneChoose=scenes.choose.bind(scenes);

function encodeScene(enc){
  if(active==='none')return false;
  if(wave.enabled){active='none';fresh=false;syncUI();return false;}
  const b=sim.params.box,d=sim.params.spacing||0.04,n=Math.max(1,sim.scene?.nFluid||sim.n||1);
  time+=Math.min(0.05,Math.max(0.001,lastDt));
  F.fill(0);
  F[0]=b[0];F[1]=b[1];F[2]=b[2];F[3]=d;
  F[4]=time;F[5]=strength;F[6]=amount;F[7]=b[1]*0.37;
  F[8]=frequency;F[9]=0;F[10]=0;F[11]=0;
  U32[12]=n;U32[13]=MODE[active]||0;U32[14]=fresh?1:0;U32[15]=seed;
  dev.queue.writeBuffer(uni,0,F);
  const pos=sim.livePos?.(),vel=sim.liveVel?.();
  const pred=sim.buf?.[sim.parity===0?'predA':'predB'];
  if(!pos||!vel||!pred)return false;
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},
    {binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:pred}},
  ]});
  const pass=enc.beginComputePass({label:'fluidV5M750PhysicalScenePass'});
  pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(n/256));pass.end();
  passCount++;fresh=false;return true;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);
  if(inStep&&active!=='none'){
    try{encodeScene(enc)}catch(err){console.error('[M7.5.0 physical scene pass]',err);active='none';fresh=false;syncUI()}
  }
  return enc;
};
sim.step=function(dt){lastDt=Number.isFinite(dt)?dt:lastDt;inStep=true;try{return baseStep(dt)}finally{inStep=false}};

function disable(){active='none';fresh=false;syncUI()}
function choose(name){
  if(!(name in MODE)||name==='none')return;
  wave.disable();
  // Rebuild a calm pool inside the next already-unified frame, then this module's pass
  // transforms only the required subset/velocity field. No Sim.reset()/primeGrid submit.
  baseSceneChoose('pool');
  active=name;fresh=true;time=0;seed++;
  if(ui.paused)ui.paused=false;
  syncUI();
}

// If callers use the public scene API, leave these physical tests cleanly.
scenes.choose=function(name){disable();return baseSceneChoose(name)};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');let scenePage=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='scenes');if(idx>=0)scenePage=host.children[idx]||null;}
let status=null;const buttons=[];
function slider(parent,label,min,max,step,value,onchange,format=v=>Number(v).toFixed(2)){
  const row=document.createElement('div');row.className='m742Row';
  const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
  const val=document.createElement('div');val.className='m742Val';val.textContent=format(value);
  input.oninput=e=>{e.stopPropagation();onchange(Number(input.value));val.textContent=format(Number(input.value));syncUI()};
  row.append(l,input,val);parent.appendChild(row);return input;
}
function syncUI(){
  for(const b of buttons)b.classList.toggle('active',b.dataset.scene===active);
  if(status)status.textContent=`ACTIVE ${active==='none'?'POOL / WAVE LAB':LABEL[active]}\nphysical scene passes ${passCount} · feature queue submits 0\nstrength ${strength.toFixed(2)} · source amount ${amount.toFixed(2)} · frequency ${frequency.toFixed(2)} Hz\nSource tests reuse existing pool particles; click the active source button again to replay its initial condition.`;
}
if(scenePage){
  scenePage.querySelectorAll('.m742Locked').forEach(n=>n.remove());
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">PHYSICAL EFFECT TESTS · M7.5.0</div><div class="m742Note">Each button changes the real PBF water. Rain, Pour, Faucet and Waterfall rearrange part of the existing pool into an elevated one-shot initial condition; Paddle, Whirlpool, Fountain and Drain continuously force the same particles. One mode-switched compute pass, zero extra GPU submissions.</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  for(const [name,label] of [['rain','RAIN BURST'],['pour','GRAVITY POUR'],['faucet','FAUCET'],['waterfall','WATERFALL'],['paddle','PADDLE'],['whirlpool','WHIRLPOOL'],['fountain','FOUNTAIN'],['drain','DRAIN']]){
    const b=document.createElement('button');b.className='m742Btn';b.dataset.scene=name;b.textContent=label;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(name)};buttons.push(b);grid.appendChild(b);
  }
  sec.appendChild(grid);
  slider(sec,'FORCE / SPEED',0.30,1.80,0.05,strength,v=>strength=v);
  slider(sec,'SOURCE AMOUNT',0.08,0.52,0.02,amount,v=>amount=v);
  slider(sec,'PADDLE FREQ',0.20,1.60,0.05,frequency,v=>frequency=v,v=>`${Number(v).toFixed(2)} Hz`);
  scenePage.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';scenePage.appendChild(status);
  // Existing closure-based Pool/Dam buttons do not call the public scenes.choose property,
  // so explicitly turn off our mode when they are pressed.
  for(const b of scenePage.querySelectorAll('button')){
    const t=(b.textContent||'').trim();
    if(t==='POOL'||t==='DAM BREAK')b.addEventListener('click',disable,{capture:true});
  }
  syncUI();
}

window.__v5M750PhysicalScenes={online:true,backend:'one-unified-mode-pass-m750',gpuPassesAddedWhenActive:1,gpuSubmitsAdded:0,choose,disable,get active(){return active},get passCount(){return passCount},get strength(){return strength},get amount(){return amount}};
window.__fluidV5Version='7.5.0';window.__fluidV5Build='M7.5.0 PHYSICAL SCENE LAB / M7.3.9 ONE-SUBMIT CORE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.5.0';
document.title='Fluid V5 · M7.5.0 Physical Scene Lab';
console.info('[Fluid V5 M7.5.0] physical scene lab online; one mode-switched pass, zero added queue submits.');
