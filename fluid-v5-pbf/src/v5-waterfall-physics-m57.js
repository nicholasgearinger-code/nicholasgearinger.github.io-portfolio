// Fluid V5 M5.7 physics-based waterfall.
// The waterfall body is no longer a translucent render sheet. It uses the same continuous
// ballistic lattice idea as the upstream Pour source: new PBF layers are extruded every frame,
// inserted along the gravity trajectory with live velocities, and then fully solved/rendered by
// the existing PBF + SSFR stack. M4/M5 whitewater reacts to the real impact automatically.

const sim=window.__sim,ui=window.__ui,state=window.__v5State;
if(!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.7 waterfall: PBF runtime unavailable.');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};
let seed=0x57415452,extruded=0,nextLayer=0,added=0,last=performance.now(),lastRing=0;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const budget=()=>Math.max(0,Math.min(6800,(sim.cap||sim.n)-sim.n-64));
function resetEmitter(){extruded=0;nextLayer=0;added=0;last=performance.now();lastRing=0;}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){state.scenario='waterfall-m57';ui.pouring=false;stopWave();save();document.getElementById('reset')?.click();resetEmitter();sync();}

// Remove the older waterfall button listeners entirely. Changing data-m46 also prevents the
// M4.6/M5.6 rebinding loops from reclaiming this button.
function installButton(){
 const old=document.querySelector('[data-m46="waterfall"]');
 if(!old)return false;
 const b=old.cloneNode(true);b.dataset.m46='waterfall-m57';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose();},{capture:true});
 old.replaceWith(b);return true;
}
installButton();
const buttonTimer=setInterval(()=>{if(!document.querySelector('[data-m46="waterfall-m57"]'))installButton();},550);void buttonTimer;

function config(){
 const b=sim.params.box,d=sim.params.spacing,flow=state.waterfallFlow;
 const width=clamp(b[2]*(.34+(flow-1)*.045),d*6,b[2]*.52);
 const across=Math.max(5,Math.round(width/d));
 const thick=quality==='low'?1:quality==='high'?3:2;
 const extrusionSpeed=.92+.30*flow;
 const vx=.28+.10*flow;
 const vy=-.08-.04*flow;
 const topY=waterTop()+Math.min(.72,b[1]*.29);
 const nozzleX=Math.max(d*1.55,b[0]*.035);
 return{b,d,flow,width,across,thick,extrusionSpeed,vx,vy,topY,nozzleX,centreZ:b[2]*.50,g:Math.max(1,Number(sim.params.gravity)||9.81),layerStep:d*1.12};
}
function impactPoint(c){
 const h=Math.max(0,c.topY-waterTop());
 const disc=c.vy*c.vy+2*c.g*h;
 const t=(c.vy+Math.sqrt(Math.max(0,disc)))/c.g;
 return{x:c.nozzleX+c.vx*t,z:c.centreZ,t};
}
function emitImpactRipples(now,c){
 if(now-lastRing<135)return;lastRing=now;const hit=impactPoint(c),bus=window.__v5RippleM57;if(!bus?.emit)return;
 const a=.92+.42*c.flow;bus.emit(hit.x,hit.z-c.width*.24,a);bus.emit(hit.x,hit.z+c.width*.24,a*.88,28);bus.emit(hit.x,hit.z,a*1.12,55);
}

function step(now){
 requestAnimationFrame(step);
 const dt=clamp((now-last)/1000,0,.05);last=now;
 if(state.scenario!=='waterfall-m57'||ui.paused||document.hidden||dt<=0||budget()<=0)return;
 const c=config();extruded+=c.extrusionSpeed*dt;
 let layers=0;while((nextLayer+layers)*c.layerStep<=extruded&&layers<16)layers++;
 if(layers<=0){emitImpactRipples(now,c);return;}
 const pos=[],vel=[];
 for(let l=0;l<layers;l++){
  const m=nextLayer+l,behind=extruded-m*c.layerStep,t=behind/Math.max(c.extrusionSpeed,1e-5);
  const cx=c.nozzleX+c.vx*t;
  const cy=c.topY+c.vy*t-.5*c.g*t*t;
  const vyNow=c.vy-c.g*t;
  if(cy<waterTop()-c.d*.05||cx>c.b[0]-c.d)continue;
  const vl=Math.hypot(c.vx,vyNow)||1,nx=-vyNow/vl,ny=c.vx/vl;
  const span=(c.across-1)*c.d;
  for(let tz=0;tz<c.across;tz++){
   const z=c.centreZ-span*.5+tz*c.d+(rnd()-.5)*c.d*.10;
   for(let th=0;th<c.thick;th++){
    const off=(th-(c.thick-1)*.5)*c.d*.78;
    const x=cx+nx*off+(rnd()-.5)*c.d*.07;
    const y=cy+ny*off+(rnd()-.5)*c.d*.07;
    if(x<=c.d*.4||x>=c.b[0]-c.d*.4||y<=c.d*.25||y>=c.b[1]-c.d*.4)continue;
    pos.push(x,y,z);vel.push(c.vx+(rnd()-.5)*.025,vyNow+(rnd()-.5)*.035,(rnd()-.5)*.028);
   }
  }
 }
 nextLayer+=layers;
 const room=budget(),n=Math.min(room,Math.floor(pos.length/3));
 if(n>0){const a=sim.appendFluid(pos.slice(0,n*3),vel.slice(0,n*3));added+=a;}
 emitImpactRipples(now,c);
 const S=window.__v5WaterfallM57;if(S){S.particlesAdded=added;S.remaining=budget();S.layers=nextLayer;S.width=c.width;S.thickness=c.thick;S.impactX=impactPoint(c).x;}
}
requestAnimationFrame(step);

function sync(){
 const b=document.querySelector('[data-m46="waterfall-m57"]');if(b)b.classList.toggle('active',state.scenario==='waterfall-m57');
 const s=document.getElementById('v5WaterfallM57Status');if(s){const c=config();s.textContent=`REAL PBF SHEET · ${c.across}×${c.thick} nozzle lattice · +${added.toLocaleString()} particles · remaining ${budget().toLocaleString()}`;}
}
function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM57'))return;
 const w=document.createElement('div');w.id='v5WaterfallM57';w.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 w.innerHTML='<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">PHYSICS WATERFALL · M5.7</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Continuous ballistic PBF lattice based on the Pour emitter. Gravity, density constraints, surface reconstruction, whitewater and impact waves all act on the actual falling fluid—there is no fake waterfall body.</div><div id="v5WaterfallM57Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>';
 host.appendChild(w);w.onpointerdown=e=>e.stopPropagation();sync();
}
setInterval(()=>{installButton();mount();sync();},520);mount();
window.__v5WaterfallM57={online:true,backend:'ballistic-pbf-lattice-m57',particlesAdded:0,remaining:budget(),layers:0,width:0,thickness:0,impactX:0};
console.info('[Fluid V5 M5.7] physics-based waterfall emitter online.');
