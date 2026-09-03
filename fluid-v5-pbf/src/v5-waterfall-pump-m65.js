// Fluid V5 M6.5 bounded reservoir waterfall source.
// A small, fixed-rate subset of deep pool particles is promoted into a one-layer primary curtain.
// Tagged particles are always handed back to ordinary pool water at contact OR after one flight-age
// budget, preventing the whole pool from ever becoming classified/rendered as waterfall fluid.

const sim=window.__sim,ui=window.__ui,state=window.__v5State;
if(!sim?.dev||!state||!ui)throw new Error('Fluid V5 M6.5 waterfall pump: runtime unavailable.');
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
 const layers=Math.max(1,Math.ceil((sim.scene?.nFluid||sim.n)/(nx*nz)));
 // Match the initialized slab's top particle layer, plus half a spacing as the free-surface envelope.
 return clamp(margin+(layers-.5)*d+d*.5,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=state.waterfallFlow,surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.55,b[0]*.036);
 const vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface),fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const minAcross=quality==='low'?14:quality==='high'?28:20,maxAcross=quality==='low'?24:quality==='high'?42:32;
 const across=clamp(Math.round((b[2]*state.waterfallWidth)/d),minAcross,maxAcross);
 const width=(across-1)*d;
 const thick=quality==='high'?2:1;
 const basePeriod=quality==='low'?260:quality==='high'?350:300;
 const period=clamp(Math.round(basePeriod/flow),150,600);
 const maxAgeMs=Math.round((fallT+.22)*1000);
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width,across,thick,period,maxAgeMs,centreZ:b[2]*.5};
}

function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){state.scenario='waterfall-m62';ui.pouring=false;stopWave();save();document.getElementById('reset')?.click();state.scenario='waterfall-m62';save();sync();}
function waterfallButton(){return document.querySelector('[data-m46="waterfall-m62"]')||[...document.querySelectorAll('#v5ScenariosM46 button')].find(b=>/WATERFALL/i.test(b.textContent||''));}
function installButton(){const old=waterfallButton();if(!old)return false;if(old.dataset.m65==='1')return true;const b=old.cloneNode(true);b.dataset.m46='waterfall-m62';b.dataset.m65='1';b.textContent='WATERFALL';b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();choose();},{capture:true});old.replaceWith(b);return true;}
installButton();
const host=document.getElementById('settingsPanel');if(host)new MutationObserver(()=>installButton()).observe(host,{childList:true,subtree:true});

const uni=dev.createBuffer({label:'fluidV5M65PumpUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(24),U=new Uint32Array(F.buffer);
const wgsl=`
struct Cfg{geo0:vec4f,geo1:vec4f,geo2:vec4f,sink:vec4f,mdata:vec4u,shape:vec4u}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>body:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.mdata.x){return;}var ph=body[i];let p=P[i].xyz;
 // Lifecycle: a primary waterfall parcel is temporary classification only.
 if(ph.w==C.mdata.y){
  let age=min(ph.z+C.shape.w,60000u);
  let landed=p.y<=C.geo0.x+C.geo1.y*.90;
  let overshot=p.x>=C.geo2.x+C.geo1.y*1.25;
  let expired=f32(age)>=C.geo2.w;
  if(C.shape.z==0u||landed||overshot||expired){body[i]=vec4u(ph.x,ph.y,0u,0u);return;}
  body[i]=vec4u(ph.x,ph.y,age,ph.w);return;
 }
 if(C.shape.z==0u||ph.x!=0u||ph.w!=0u){return;}
 // Deep, far-side reservoir intake. Never pull from the visible surface layer.
 if(p.x<C.sink.x||p.y>C.sink.y||p.z<C.sink.z||p.z>C.sink.w){return;}
 let stable=select(i+1u,ph.y,ph.y!=0u);let period=max(C.mdata.z,1u);
 if((stable+C.mdata.w*1664525u)%period!=0u){return;}
 let across=max(C.shape.x,1u);let thick=max(C.shape.y,1u);let lane=stable%across;let layer=(stable/across)%thick;
 let row=(stable/max(across*thick,1u)+C.mdata.w)%3u;let s=stable^(C.mdata.w*747796405u);
 let hz=hash1(s+17u);let hx=hash1(s+101u);let hv=hash1(s+313u);
 let u=(f32(lane)+.5)/f32(across);let z=C.geo0.w+(u-.5)*C.geo1.x+(hz-.5)*C.geo1.y*.035;
 let x=C.geo0.z+(f32(layer)-f32(thick-1u)*.5)*C.geo1.y*.30+(hx-.5)*C.geo1.y*.025;
 let y=C.geo0.y-f32(row)*C.geo1.y*.18-hv*C.geo1.y*.055;
 P[i]=vec4f(x,y,z,1.0);V[i]=vec4f(C.geo1.z+(hx-.5)*.006,C.geo1.w-hv*.009,(hz-.5)*.010,0.0);
 body[i]=vec4u(ph.x,stable,0u,C.mdata.y);
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M65PumpWGSL'});
if(typeof mod.getCompilationInfo==='function'){const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.5 pump WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M65ReservoirPump',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let frame=1,wasActive=false,submits=0,lastRipple=0;
function submitPump(on,frameDt){if(!sim.n)return;const g=geom();const dtMs=Math.max(1,Math.min(100,Math.round((Number(sim.lastAdvanced)||Number(frameDt)||.02)*1000)));
 F[0]=g.surface;F[1]=g.topY;F[2]=g.nozzleX;F[3]=g.centreZ;F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;F[8]=g.impactX;F[9]=g.fallT;F[10]=g.flow;F[11]=g.maxAgeMs;
 F[12]=g.b[0]*.62;F[13]=Math.max(g.d*2.2,g.surface-g.d*1.8);F[14]=g.d*1.8;F[15]=g.b[2]-g.d*1.8;
 U[16]=sim.n;U[17]=TAG;U[18]=g.period;U[19]=frame++;U[20]=g.across;U[21]=g.thick;U[22]=on?1:0;U[23]=dtMs;dev.queue.writeBuffer(uni,0,F);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}]});
 const enc=dev.createCommandEncoder({label:'fluidV5M65PumpEncoder'}),cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();dev.queue.submit([enc.finish()]);
 const S=window.__v5WaterfallM62;if(S){S.online=true;S.error='';S.active=on;S.submits=++submits;S.period=g.period;S.estimatedSpawn=Math.max(1,Math.round(sim.n*.18/g.period));S.surfaceY=g.surface;S.impactX=g.impactX;S.across=g.across;S.thickness=g.thick;S.width=g.width;S.maxAgeMs=g.maxAgeMs;S.estimatedActive=Math.round(S.estimatedSpawn*Math.max(1,g.maxAgeMs/50));}
}
const baseStep=sim.step.bind(sim);sim.step=function(frameDt){const out=baseStep(frameDt);const on=active();if(on||wasActive){try{submitPump(on,frameDt);}catch(err){const S=window.__v5WaterfallM62;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.5 pump]',err);}}wasActive=on;return out;};

function rippleTick(){if(!active()||ui.paused||document.hidden)return;const now=performance.now();if(now-lastRipple<155)return;lastRipple=now;const g=geom(),bus=window.__v5RippleM57;if(!bus?.emit)return;const a=.95+.32*g.flow;for(const f of [-.38,-.19,0,.19,.38])bus.emit(g.impactX,g.centreZ+g.width*f,a*(1-.18*Math.abs(f)),Math.round((f+.5)*197+frame));}
setInterval(rippleTick,90);
function sync(){const b=document.querySelector('[data-m46="waterfall-m62"]');if(b)b.classList.toggle('active',active());const s=document.getElementById('v5WaterfallM65Status');if(s){const g=geom(),S=window.__v5WaterfallM62;s.textContent=`THIN PRIMARY PBF · ${g.across}×${g.thick} inlet · ~${S?.estimatedSpawn||Math.round(sim.n*.18/g.period)}/frame · ${g.maxAgeMs} ms lifecycle · fixed ${sim.n.toLocaleString()} particles${S?.error?' · ERROR '+S.error:''}`;}}
function mount(){const h=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!h||document.getElementById('v5WaterfallM65'))return;const d=document.createElement('div');d.id='v5WaterfallM65';d.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">BOUNDED WATERFALL · M6.5</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Only a small temporary primary curtain is tagged as waterfall fluid. Contact or a hard flight-age budget hands every parcel back to ordinary pool water.</div><div id="v5WaterfallM65Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;h.appendChild(d);}
setInterval(()=>{installButton();mount();sync();},500);mount();
window.__v5WaterfallTag=TAG;window.__v5WaterfallM62={online:true,backend:'bounded-reservoir-primary-m65',active:false,period:0,estimatedSpawn:0,estimatedActive:0,surfaceY:0,impactX:0,across:0,thickness:0,width:0,maxAgeMs:0,submits:0,error:''};window.__v5WaterfallM57=window.__v5WaterfallM62;
console.info('[Fluid V5 M6.5] bounded thin-primary reservoir waterfall online.');