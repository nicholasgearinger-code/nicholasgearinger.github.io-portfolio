// Fluid V5 M6.2.1 closed-loop reservoir waterfall pump.
// Mobile-safe revision: no atomic counter, no readback, no airborne recycling.
// A deterministic subset of ordinary submerged pool particles is promoted to the inlet each frame.
// Falling parcels keep ordinary PBF mass/phase, hit the pool naturally, then lose only the render tag.

const sim=window.__sim,ssfr=window.__ssfr,ui=window.__ui,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state||!ui)throw new Error('Fluid V5 M6.2.1 waterfall pump: runtime unavailable.');
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
 // No atomic quota is used. Throughput is set by a deterministic period over the broad intake.
 // Smaller period = more particles promoted per frame.
 const basePeriod=quality==='low'?88:quality==='high'?46:62;
 const period=clamp(Math.round(basePeriod/flow),30,128);
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width:actualWidth,across,thick,period,centreZ:b[2]*.50};
}

function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){
 state.scenario='waterfall-m62';ui.pouring=false;stopWave();save();
 document.getElementById('reset')?.click();
 // Reset does not own V5 scenario state, but restamp after the synchronous reset for safety.
 state.scenario='waterfall-m62';save();sync();
}
function waterfallButton(){
 return document.querySelector('[data-m46="waterfall-m62"]')||
        document.querySelector('#v5ScenariosM46 [data-m46="waterfall-m58"]')||
        document.querySelector('#v5ScenariosM46 [data-m46="waterfall"]')||
        [...document.querySelectorAll('#v5ScenariosM46 button')].find(b=>/WATERFALL/i.test(b.textContent||''));
}
function installButton(){
 const old=waterfallButton();if(!old)return false;
 if(old.dataset.m46==='waterfall-m62'&&old.dataset.m621==='1')return true;
 const b=old.cloneNode(true);b.dataset.m46='waterfall-m62';b.dataset.m621='1';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();choose();},{capture:true});
 old.replaceWith(b);return true;
}
installButton();
const buttonObserver=new MutationObserver(()=>installButton());
const scenarioHost=document.getElementById('settingsPanel');if(scenarioHost)buttonObserver.observe(scenarioHost,{childList:true,subtree:true});
setInterval(()=>{if(!document.querySelector('[data-m46="waterfall-m62"][data-m621="1"]'))installButton();},650);

const uni=dev.createBuffer({label:'fluidV5M621PumpUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(24),U=new Uint32Array(F.buffer);
const wgsl=`
struct Cfg{geo0:vec4f,geo1:vec4f,geo2:vec4f,sink:vec4f,meta:vec4u,shape:vec4u}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>body:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x){return;}var ph=body[i];let p=P[i].xyz;
 // Tagged waterfall fluid is NEVER teleported while airborne. On contact it simply becomes pool fluid.
 if(ph.w==C.meta.y){
  if(C.shape.z==0u||p.y<=C.geo0.x+C.geo1.y*.55||p.x>=C.geo2.x+C.geo1.y*.90){body[i]=vec4u(ph.x,ph.y,0u,0u);}
  return;
 }
 if(C.shape.z==0u||ph.x!=0u){return;}
 // Wide hidden intake on the opposite/deep side of the pool.
 if(p.x<C.sink.x||p.y>C.sink.y||p.z<C.sink.z||p.z>C.sink.w){return;}
 let stable=select(i+1u,ph.y,ph.y!=0u);
 let period=max(C.meta.z,1u);
 // Deterministic per-frame gate: no atomic append counter and no GPU readback.
 let gate=(stable+C.meta.w*1664525u)%period;if(gate!=0u){return;}
 let across=max(C.shape.x,1u);let thick=max(C.shape.y,1u);
 let lane=stable%across;let layer=(stable/across)%thick;let row=(stable/max(across*thick,1u)+C.meta.w)%4u;
 let s=stable^(C.meta.w*747796405u);let hz=hash1(s+17u);let hx=hash1(s+101u);let hv=hash1(s+313u);
 let u=(f32(lane)+.5)/f32(across);let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.07;
 let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.42+(hx-.5)*C.geo1.y*.05;
 let y=C.geo0.y-f32(row)*C.geo1.y*.23-hv*C.geo1.y*.10;
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(hx-.5)*.010,C.geo1.w-hv*.015,(hz-.5)*.018,0.0);
 body[i]=vec4u(ph.x,stable,0u,C.meta.y);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M621PumpWGSL'});
if(typeof mod.getCompilationInfo==='function'){
 const info=await mod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.2.1 pump WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M621ReservoirPump',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let frame=1,wasActive=false,lastRipple=0;
function encodePump(enc,on){
 if(!enc||!sim.n)return;const g=geom();
 F[0]=g.surface;F[1]=g.topY;F[2]=g.nozzleX;F[3]=g.centreZ;
 F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;
 F[8]=g.impactX;F[9]=g.fallT;F[10]=g.flow;F[11]=0;
 F[12]=g.b[0]*.46;F[13]=Math.max(g.d*2.4,g.surface-g.d*1.35);F[14]=g.d*1.6;F[15]=g.b[2]-g.d*1.6;
 U[16]=sim.n;U[17]=TAG;U[18]=g.period;U[19]=frame++;
 U[20]=g.across;U[21]=g.thick;U[22]=on?1:0;U[23]=0;
 dev.queue.writeBuffer(uni,0,F);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}
 ]});
 const cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();
 const S=window.__v5WaterfallM62;if(S){S.active=on;S.period=g.period;S.estimatedSpawn=Math.max(1,Math.round(sim.n*.18/g.period));S.surfaceY=g.surface;S.impactX=g.impactX;S.across=g.across;S.thickness=g.thick;S.width=g.width;S.frames=frame;}
}
const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],on=active();
 if(enc&&(on||wasActive)){
  try{encodePump(enc,on);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.2.1 pump encode]',err);}
 }
 wasActive=on;return baseRender.apply(this,args);
};

function rippleTick(){
 if(!active()||ui.paused||document.hidden)return;const now=performance.now();if(now-lastRipple<145)return;lastRipple=now;const g=geom(),bus=window.__v5RippleM57;if(!bus?.emit)return;
 const a=1.12+.42*g.flow;for(const f of [-.40,-.20,0,.20,.40])bus.emit(g.impactX,g.centreZ+g.width*f,a*(1-.16*Math.abs(f)),Math.round((f+.5)*177+frame));
}
setInterval(rippleTick,80);

function sync(){
 const b=document.querySelector('[data-m46="waterfall-m62"]');if(b)b.classList.toggle('active',active());
 const s=document.getElementById('v5WaterfallM62Status');if(s){const g=geom();const est=Math.max(1,Math.round(sim.n*.18/g.period));s.textContent=`CLOSED-LOOP PBF · ${g.across}×${g.thick} inlet · ${(g.width/g.b[2]*100).toFixed(0)}% width · ~${est}/frame · atomic-free · fixed ${sim.n.toLocaleString()} particles`;}
}
function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM62'))return;
 const d=document.createElement('div');d.id='v5WaterfallM62';d.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">RESERVOIR WATERFALL · M6.2.1</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Mobile-safe closed loop: a broad submerged intake feeds real PBF particles into the waterfall without atomic append counters or airborne recycling.</div><div class="v5Slider"><label>WATERFALL WIDTH</label><input data-k="waterfallWidth" type="range" min="0.48" max="0.92" step="0.01"><div class="v5Val"></div></div><div class="v5Slider"><label>WATERFALL FLOW</label><input data-k="waterfallFlow" type="range" min="0.45" max="1.55" step="0.05"><div class="v5Val"></div></div><div id="v5WaterfallM62Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 host.appendChild(d);d.onpointerdown=e=>e.stopPropagation();d.querySelectorAll('input').forEach(r=>{const k=r.dataset.k,v=r.nextElementSibling;r.value=state[k];const sv=()=>v.textContent=k==='waterfallWidth'?`${Math.round(state[k]*100)}%`:Number(state[k]).toFixed(2);sv();r.oninput=e=>{e.stopPropagation();state[k]=Number(r.value);save();sv();sync();};});sync();
}
setInterval(()=>{installButton();mount();sync();},520);mount();
window.__v5WaterfallTag=TAG;
window.__v5WaterfallM62={online:true,backend:'closed-loop-reservoir-pump-m621-atomic-free',active:false,period:0,estimatedSpawn:0,surfaceY:0,impactX:0,across:0,thickness:0,width:0,target:0,frames:0,error:''};
window.__v5WaterfallM57=window.__v5WaterfallM62;
console.info('[Fluid V5 M6.2.1] atomic-free closed-loop reservoir PBF waterfall pump online.');
