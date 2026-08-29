// Fluid V5 M6.2 closed-loop reservoir waterfall pump.
// Replaces time/contact recycling of airborne parcels. Ordinary pool particles are selected from a
// broad submerged intake region, moved to a wide waterfall inlet, simulated normally by PBF, then
// have only their waterfall render tag cleared when they contact the pool. No airborne particle is
// ever teleported back to the lip, so the curtain cannot form the horizontal recycle bands seen in
// M6.1. Total particle count remains exactly constant.

const sim=window.__sim,ssfr=window.__ssfr,ui=window.__ui,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state||!ui)throw new Error('Fluid V5 M6.2 waterfall pump: runtime unavailable.');
const dev=sim.dev,TAG=0x5746;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}};save();
const active=()=>state.scenario==='waterfall-m62';

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=state.waterfallFlow,surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.79,b[1]*.315),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.55,b[0]*.036);
 const vx=.235+.082*flow,vy=-.070-.030*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface),fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const requested=b[2]*state.waterfallWidth;
 const minAcross=quality==='low'?14:quality==='high'?28:20;
 const maxAcross=quality==='low'?24:quality==='high'?42:32;
 const width=clamp(requested,d*minAcross,b[2]*.92);
 const across=clamp(Math.round(width/d),minAcross,maxAcross);
 const actualWidth=(across-1)*d;
 const thick=quality==='low'?1:2;
 const maxSpawn=Math.round((quality==='low'?48:quality==='high'?118:82)*(.78+.28*flow));
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width:actualWidth,across,thick,maxSpawn,centreZ:b[2]*.50};
}

function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){state.scenario='waterfall-m62';ui.pouring=false;stopWave();save();document.getElementById('reset')?.click();sync();}
function installButton(){
 const old=document.querySelector('[data-m46="waterfall-m62"]')||document.querySelector('[data-m46="waterfall-m58"]')||document.querySelector('[data-m46="waterfall"]');
 if(!old)return false;
 if(old.dataset.m46==='waterfall-m62')return true;
 const b=old.cloneNode(true);b.dataset.m46='waterfall-m62';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose();},{capture:true});old.replaceWith(b);return true;
}
installButton();setInterval(()=>{if(!document.querySelector('[data-m46="waterfall-m62"]'))installButton();},500);

const uni=dev.createBuffer({label:'fluidV5M62PumpUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const counter=dev.createBuffer({label:'fluidV5M62PumpCounter',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
const F=new Float32Array(24),U=new Uint32Array(F.buffer);
const wgsl=`
struct Cfg{geo0:vec4f,geo1:vec4f,geo2:vec4f,sink:vec4f,meta:vec4u,shape:vec4u}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>body:array<vec4u>;
@group(0)@binding(4)var<storage,read_write>spawnCount:atomic<u32>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x){return;}var ph=body[i];let p=P[i].xyz;
 // Waterfall parcels are never recycled in air. At actual surface contact/overshoot they simply
 // lose the render tag and become ordinary pool fluid at their existing physical state.
 if(ph.w==C.meta.y){
  if(C.shape.z==0u||p.y<=C.geo0.x+C.geo1.y*.50||p.x>=C.geo2.x+C.geo1.y*.70){body[i]=vec4u(ph.x,ph.y,0u,0u);}
  return;
 }
 if(C.shape.z==0u||ph.x!=0u){return;}
 // Hidden reservoir intake: broad/deep region on the opposite half of the pool. Using a broad
 // volume avoids creating a visible point drain while still producing true closed-loop flow.
 if(p.x<C.sink.x||p.y>C.sink.y||p.z<C.sink.z||p.z>C.sink.w){return;}
 let stable=select(i+1u,ph.y,ph.y!=0u);let h=hash1(stable^(C.meta.w*747796405u));
 if(h>.34){return;}
 let j=atomicAdd(&spawnCount,1u);if(j>=C.meta.z){return;}
 let across=max(C.shape.x,1u);let thick=max(C.shape.y,1u);let lane=(j+C.meta.w*7u)%across;let layer=(j/across)%thick;let row=j/max(across*thick,1u);
 let hz=hash1(stable+C.meta.w*1597334677u);let hx=hash1(stable+C.meta.w*3812015801u);let hv=hash1(stable+C.meta.w*9586891u);
 let u=(f32(lane)+.5)/f32(across);let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.08;
 let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.48+(hx-.5)*C.geo1.y*.06;
 let y=C.geo0.y-f32(row)*C.geo1.y*.34-hv*C.geo1.y*.12;
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(hx-.5)*.012,C.geo1.w-hv*.018,(hz-.5)*.022,0.0);
 body[i]=vec4u(ph.x,stable,0u,C.meta.y);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M62PumpWGSL'});
if(typeof mod.getCompilationInfo==='function'){
 const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.2 pump WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M62ReservoirPump',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let frame=1,wasActive=false,pumped=0,lastSpawn=0,lastRipple=0;
function encodePump(enc,on){
 if(!enc||!sim.n)return;const g=geom();enc.clearBuffer(counter);
 F[0]=g.surface;F[1]=g.topY;F[2]=g.nozzleX;F[3]=g.centreZ;
 F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;
 F[8]=g.impactX;F[9]=g.fallT;F[10]=g.flow;F[11]=0;
 F[12]=g.b[0]*.46;F[13]=Math.max(g.d*2.4,g.surface-g.d*1.35);F[14]=g.d*1.6;F[15]=g.b[2]-g.d*1.6;
 U[16]=sim.n;U[17]=TAG;U[18]=g.maxSpawn;U[19]=frame++;
 U[20]=g.across;U[21]=g.thick;U[22]=on?1:0;U[23]=0;
 dev.queue.writeBuffer(uni,0,F);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}},{binding:4,resource:{buffer:counter}}]});
 const cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 // The exact atomic count is intentionally not mapped back every frame on mobile; maxSpawn is the
 // requested throughput and the actual visible curtain provides the meaningful acceptance check.
 lastSpawn=on?g.maxSpawn:0;if(on)pumped+=g.maxSpawn;
 const S=window.__v5WaterfallM62;if(S){S.active=on;S.maxSpawn=g.maxSpawn;S.lastSpawn=lastSpawn;S.pumped=pumped;S.surfaceY=g.surface;S.impactX=g.impactX;S.across=g.across;S.thickness=g.thick;S.width=g.width;}
}

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],on=active();if(enc&&(on||wasActive))encodePump(enc,on);wasActive=on;return baseRender.apply(this,args);
};

function rippleTick(){
 if(!active()||ui.paused||document.hidden)return;const now=performance.now();if(now-lastRipple<145)return;lastRipple=now;const g=geom(),bus=window.__v5RippleM57;if(!bus?.emit)return;
 const a=1.12+.42*g.flow;for(const f of [-.40,-.20,0,.20,.40])bus.emit(g.impactX,g.centreZ+g.width*f,a*(1-.16*Math.abs(f)),Math.round((f+.5)*177+frame));
}
setInterval(rippleTick,80);

function sync(){
 const b=document.querySelector('[data-m46="waterfall-m62"]');if(b)b.classList.toggle('active',active());
 const s=document.getElementById('v5WaterfallM62Status');if(s){const g=geom();s.textContent=`CLOSED-LOOP PBF · ${g.across}×${g.thick} inlet · ${(g.width/g.b[2]*100).toFixed(0)}% width · ${g.maxSpawn}/frame reservoir throughput · fixed ${sim.n.toLocaleString()} particles`;}
}
function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM62'))return;
 const d=document.createElement('div');d.id='v5WaterfallM62';d.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">RESERVOIR WATERFALL · M6.2</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">A hidden submerged intake continuously feeds ordinary pool particles into a wide PBF inlet. Falling parcels are never teleported in air; after impact they simply rejoin the pool. Total mass and particle count stay constant.</div><div class="v5Slider"><label>WATERFALL WIDTH</label><input data-k="waterfallWidth" type="range" min="0.48" max="0.92" step="0.01"><div class="v5Val"></div></div><div class="v5Slider"><label>WATERFALL FLOW</label><input data-k="waterfallFlow" type="range" min="0.45" max="1.55" step="0.05"><div class="v5Val"></div></div><div id="v5WaterfallM62Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 host.appendChild(d);d.onpointerdown=e=>e.stopPropagation();d.querySelectorAll('input').forEach(r=>{const k=r.dataset.k,v=r.nextElementSibling;r.value=state[k];const sv=()=>v.textContent=k==='waterfallWidth'?`${Math.round(state[k]*100)}%`:Number(state[k]).toFixed(2);sv();r.oninput=e=>{e.stopPropagation();state[k]=Number(r.value);save();sv();sync();};});sync();
}
setInterval(()=>{installButton();mount();sync();},520);mount();
window.__v5WaterfallTag=TAG;
window.__v5WaterfallM62={online:true,backend:'closed-loop-reservoir-pump-m62',active:false,maxSpawn:0,lastSpawn:0,pumped:0,surfaceY:0,impactX:0,across:0,thickness:0,width:0,target:0};
// Compatibility handle for renderer/slab accounting; no extra particles are appended in M6.2.
window.__v5WaterfallM57=window.__v5WaterfallM62;
console.info('[Fluid V5 M6.2] closed-loop reservoir PBF waterfall pump online; no airborne recycling.');
