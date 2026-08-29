// Fluid V5 M5.7.2 wide physics-based waterfall.
// The waterfall body remains conserved PBF fluid. M5.7.2 exposes the contiguous emitted-particle
// range so the dedicated anisotropic reconstruction pass can visually refine the airborne curtain
// without changing mass, density, pressure or the solver particle radius.

const sim=window.__sim,ui=window.__ui,state=window.__v5State;
if(!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.7.2 waterfall: PBF runtime unavailable.');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.74;
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
state.waterfallWidth=clamp(Number(state.waterfallWidth),.45,.90);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();
let seed=0x57415452,extruded=0,nextLayer=0,added=0,last=performance.now(),lastRing=0,firstIndex=-1,lastIndex=-1;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const budget=()=>Math.max(0,Math.min(9000,(sim.cap||sim.n)-sim.n-64));
function resetEmitter(){extruded=0;nextLayer=0;added=0;last=performance.now();lastRing=0;firstIndex=-1;lastIndex=-1;publishRange();}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){state.scenario='waterfall-m572';ui.pouring=false;stopWave();save();document.getElementById('reset')?.click();resetEmitter();sync();}

function installButton(){
 const old=document.querySelector('[data-m46="waterfall"]')||document.querySelector('[data-m46="waterfall-m57"]')||document.querySelector('[data-m46="waterfall-m571"]');
 if(!old)return false;
 const b=old.cloneNode(true);b.dataset.m46='waterfall-m572';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose();},{capture:true});
 old.replaceWith(b);return true;
}
installButton();
const buttonTimer=setInterval(()=>{if(!document.querySelector('[data-m46="waterfall-m572"]'))installButton();},550);void buttonTimer;

function config(){
 const b=sim.params.box,d=sim.params.spacing,flow=state.waterfallFlow;
 const requested=b[2]*state.waterfallWidth;
 const minAcross=quality==='low'?12:quality==='high'?24:18;
 const maxAcross=quality==='low'?20:quality==='high'?36:28;
 const width=clamp(requested,d*minAcross,b[2]*.90);
 const across=clamp(Math.round(width/d),minAcross,maxAcross);
 const actualWidth=(across-1)*d;
 const thick=quality==='low'?2:quality==='high'?4:3;
 const extrusionSpeed=1.02+.34*flow;
 const vx=.24+.09*flow;
 const vy=-.06-.035*flow;
 const topY=waterTop()+Math.min(.77,b[1]*.31);
 const nozzleX=Math.max(d*1.7,b[0]*.04);
 return{b,d,flow,width:actualWidth,across,thick,extrusionSpeed,vx,vy,topY,nozzleX,centreZ:b[2]*.50,g:Math.max(1,Number(sim.params.gravity)||9.81),layerStep:d*1.05};
}
function impactPoint(c){
 const h=Math.max(0,c.topY-waterTop());
 const disc=c.vy*c.vy+2*c.g*h;
 const t=(c.vy+Math.sqrt(Math.max(0,disc)))/c.g;
 return{x:c.nozzleX+c.vx*t,z:c.centreZ,t};
}
function emitImpactRipples(now,c){
 if(now-lastRing<125)return;lastRing=now;const hit=impactPoint(c),bus=window.__v5RippleM57;if(!bus?.emit)return;
 const a=1.02+.46*c.flow;
 for(const f of [-.38,-.19,0,.19,.38])bus.emit(hit.x,hit.z+c.width*f,a*(1-.22*Math.abs(f)),Math.round((f+.4)*70));
}
function publishRange(){const S=window.__v5WaterfallM57;if(S){S.firstIndex=firstIndex;S.lastIndex=lastIndex;S.particlesAdded=added;}}

function step(now){
 requestAnimationFrame(step);
 const dt=clamp((now-last)/1000,0,.05);last=now;
 if(state.scenario!=='waterfall-m572'||ui.paused||document.hidden||dt<=0||budget()<=0)return;
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
  const age=clamp(t/Math.max(impactPoint(c).t,1e-4),0,1);
  for(let tz=0;tz<c.across;tz++){
   const lane=tz/Math.max(1,c.across-1),side=lane*2-1;
   const ribbon=.65*Math.sin(lane*18.8496+m*.37)+.35*Math.sin(lane*43.982+t*7.0);
   const edge=Math.pow(Math.abs(side),1.7);
   const zBase=c.centreZ-span*.5+tz*c.d;
   const lateral=(ribbon*.025*age + side*.018*edge*age)*c.flow;
   const z=zBase+(rnd()-.5)*c.d*.075;
   for(let th=0;th<c.thick;th++){
    const off=(th-(c.thick-1)*.5)*c.d*.74;
    const x=cx+nx*off+(rnd()-.5)*c.d*.055;
    const y=cy+ny*off+(rnd()-.5)*c.d*.055;
    if(x<=c.d*.4||x>=c.b[0]-c.d*.4||y<=c.d*.25||y>=c.b[1]-c.d*.4)continue;
    const breakup=.014*age*age*ribbon;
    pos.push(x,y,z);
    vel.push(c.vx+(rnd()-.5)*.022,vyNow+(rnd()-.5)*.032,lateral+breakup+(rnd()-.5)*.022);
   }
  }
 }
 nextLayer+=layers;
 const room=budget(),n=Math.min(room,Math.floor(pos.length/3));
 if(n>0){
   const before=sim.n;
   const a=sim.appendFluid(pos.slice(0,n*3),vel.slice(0,n*3));
   if(a>0){if(firstIndex<0)firstIndex=before;lastIndex=Math.max(lastIndex,before+a);added+=a;publishRange();}
 }
 emitImpactRipples(now,c);
 const S=window.__v5WaterfallM57;if(S){S.remaining=budget();S.layers=nextLayer;S.width=c.width;S.thickness=c.thick;S.across=c.across;S.impactX=impactPoint(c).x;}
}
requestAnimationFrame(step);

function sync(){
 const b=document.querySelector('[data-m46="waterfall-m572"]');if(b)b.classList.toggle('active',state.scenario==='waterfall-m572');
 const s=document.getElementById('v5WaterfallM57Status');if(s){const c=config();s.textContent=`WIDE REAL PBF CURTAIN · ${c.across}×${c.thick} lattice · ${(c.width/c.b[2]*100).toFixed(0)}% pool width · +${added.toLocaleString()} particles · M5.7.2 reconstruction`;}
}
function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM57'))return;
 const w=document.createElement('div');w.id='v5WaterfallM57';w.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 w.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">PHYSICS WATERFALL · M5.7.2</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">The falling mass remains real PBF fluid. M5.7.2 adds a waterfall-specific anisotropic reconstruction profile so isolated solver particles render smaller while connected particles stretch into a continuous curtain.</div><div class="v5Slider"><label>WATERFALL WIDTH</label><input id="v5WaterfallWidth" type="range" min="0.45" max="0.90" step="0.01"><div id="v5WaterfallWidthVal" class="v5Val"></div></div><div id="v5WaterfallM57Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 host.appendChild(w);w.onpointerdown=e=>e.stopPropagation();
 const input=w.querySelector('#v5WaterfallWidth'),val=w.querySelector('#v5WaterfallWidthVal');input.value=state.waterfallWidth;const sv=()=>val.textContent=`${Math.round(state.waterfallWidth*100)}%`;sv();input.oninput=e=>{e.stopPropagation();state.waterfallWidth=Number(input.value);save();sv();sync();};sync();
}
setInterval(()=>{installButton();mount();sync();},520);mount();
window.__v5WaterfallM57={online:true,backend:'wide-ballistic-pbf-curtain-m572',particlesAdded:0,remaining:budget(),layers:0,width:0,thickness:0,across:0,impactX:0,firstIndex:-1,lastIndex:-1};
console.info('[Fluid V5 M5.7.2] wide physics waterfall with reconstruction range online.');
