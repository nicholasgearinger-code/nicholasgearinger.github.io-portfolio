// Fluid V5 M5.8 tagged thin-sheet PBF waterfall.
// Airborne waterfall particles remain ordinary conserved PBF fluid (phase.x == 0), but phase.w
// carries a render-only marker. The marker survives GPU spatial sorting and is cleared after impact
// by the M5.8 sheet renderer, allowing the normal SSFR pool surface to take over seamlessly.

const sim=window.__sim,ui=window.__ui,state=window.__v5State;
if(!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.8 waterfall: PBF runtime unavailable.');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const TAG=0x5746; // "WF" in phase.w; phase.x remains zero so solver semantics are unchanged.
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
if(!Number.isFinite(Number(state.waterfallWidth)))state.waterfallWidth=.78;
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
state.waterfallWidth=clamp(Number(state.waterfallWidth),.48,.92);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();
let seed=0x57415452,extruded=0,nextLayer=0,added=0,last=performance.now(),lastRing=0;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const budget=()=>Math.max(0,Math.min(9000,(sim.cap||sim.n)-sim.n-64));
function resetEmitter(){extruded=0;nextLayer=0;added=0;last=performance.now();lastRing=0;}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(){state.scenario='waterfall-m58';ui.pouring=false;stopWave();save();document.getElementById('reset')?.click();resetEmitter();sync();}

function installButton(){
 const old=document.querySelector('[data-m46="waterfall"]')||document.querySelector('[data-m46="waterfall-m57"]')||document.querySelector('[data-m46="waterfall-m571"]')||document.querySelector('[data-m46="waterfall-m572"]');
 if(!old)return false;
 const b=old.cloneNode(true);b.dataset.m46='waterfall-m58';b.textContent='WATERFALL';
 b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();choose();},{capture:true});
 old.replaceWith(b);return true;
}
installButton();
const buttonTimer=setInterval(()=>{if(!document.querySelector('[data-m46="waterfall-m58"]'))installButton();},550);void buttonTimer;

function config(){
 const b=sim.params.box,d=sim.params.spacing,flow=state.waterfallFlow;
 const requested=b[2]*state.waterfallWidth;
 const minAcross=quality==='low'?14:quality==='high'?28:20;
 const maxAcross=quality==='low'?22:quality==='high'?40:30;
 const width=clamp(requested,d*minAcross,b[2]*.92);
 const across=clamp(Math.round(width/d),minAcross,maxAcross);
 const actualWidth=(across-1)*d;
 // Thin physical curtain: more closely spaced extrusion layers preserve mass without a 3–4
 // particle-deep airborne slab that visually breaks into balls.
 const thick=quality==='low'?1:2;
 const extrusionSpeed=1.03+.31*flow;
 const vx=.23+.085*flow;
 const vy=-.055-.030*flow;
 const topY=waterTop()+Math.min(.79,b[1]*.315);
 const nozzleX=Math.max(d*1.65,b[0]*.038);
 return{b,d,flow,width:actualWidth,across,thick,extrusionSpeed,vx,vy,topY,nozzleX,centreZ:b[2]*.50,g:Math.max(1,Number(sim.params.gravity)||9.81),layerStep:d*.62};
}
function impactPoint(c){
 const h=Math.max(0,c.topY-waterTop());
 const disc=c.vy*c.vy+2*c.g*h;
 const t=(c.vy+Math.sqrt(Math.max(0,disc)))/c.g;
 return{x:c.nozzleX+c.vx*t,z:c.centreZ,t};
}
function emitImpactRipples(now,c){
 if(now-lastRing<120)return;lastRing=now;const hit=impactPoint(c),bus=window.__v5RippleM57;if(!bus?.emit)return;
 const a=1.05+.48*c.flow;
 for(const f of [-.42,-.28,-.14,0,.14,.28,.42])bus.emit(hit.x,hit.z+c.width*f,a*(1-.20*Math.abs(f)),Math.round((f+.45)*83));
}
function tagAppended(start,count){
 if(count<=0)return;
 const tag=new Uint32Array(count*4);
 for(let i=0;i<count;i++)tag[i*4+3]=TAG;
 const off=start*16;
 // appendFluid initializes both phase buffers to zero. Overwrite only the unused .w marker;
 // scatterPhase copies the complete vec4u so the tag follows the particles through every sort.
 for(const s of ['A','B'])sim.dev.queue.writeBuffer(sim.buf['body'+s],off,tag);
}

function step(now){
 requestAnimationFrame(step);
 const dt=clamp((now-last)/1000,0,.05);last=now;
 if(state.scenario!=='waterfall-m58'||ui.paused||document.hidden||dt<=0||budget()<=0)return;
 const c=config();extruded+=c.extrusionSpeed*dt;
 let layers=0;while((nextLayer+layers)*c.layerStep<=extruded&&layers<22)layers++;
 if(layers<=0){emitImpactRipples(now,c);return;}
 const pos=[],vel=[],hitT=impactPoint(c).t;
 for(let l=0;l<layers;l++){
  const m=nextLayer+l,behind=extruded-m*c.layerStep,t=behind/Math.max(c.extrusionSpeed,1e-5);
  const cx=c.nozzleX+c.vx*t;
  const cy=c.topY+c.vy*t-.5*c.g*t*t;
  const vyNow=c.vy-c.g*t;
  if(cy<waterTop()-c.d*.03||cx>c.b[0]-c.d)continue;
  const vl=Math.hypot(c.vx,vyNow)||1,nx=-vyNow/vl,ny=c.vx/vl;
  const span=(c.across-1)*c.d;
  const age=clamp(t/Math.max(hitT,1e-4),0,1),breakAge=age*age;
  for(let tz=0;tz<c.across;tz++){
   const lane=tz/Math.max(1,c.across-1),side=lane*2-1;
   const ribbon=.70*Math.sin(lane*18.8496+m*.18)+.30*Math.sin(lane*37.699+t*5.5);
   const edge=Math.pow(Math.abs(side),1.8);
   const zBase=c.centreZ-span*.5+tz*c.d;
   const lateral=(ribbon*.012*breakAge+side*.009*edge*breakAge)*c.flow;
   const z=zBase+(rnd()-.5)*c.d*(.018+.020*breakAge);
   for(let th=0;th<c.thick;th++){
    const off=(th-(c.thick-1)*.5)*c.d*.56;
    const jitter=c.d*(.012+.018*breakAge);
    const x=cx+nx*off+(rnd()-.5)*jitter;
    const y=cy+ny*off+(rnd()-.5)*jitter;
    if(x<=c.d*.35||x>=c.b[0]-c.d*.35||y<=c.d*.22||y>=c.b[1]-c.d*.35)continue;
    const vxNoise=(rnd()-.5)*(.006+.012*breakAge);
    const vyNoise=(rnd()-.5)*(.009+.015*breakAge);
    const vzNoise=(rnd()-.5)*(.007+.014*breakAge);
    pos.push(x,y,z);vel.push(c.vx+vxNoise,vyNow+vyNoise,lateral+vzNoise);
   }
  }
 }
 nextLayer+=layers;
 const room=budget(),n=Math.min(room,Math.floor(pos.length/3));
 if(n>0){
  const before=sim.n;
  const a=sim.appendFluid(pos.slice(0,n*3),vel.slice(0,n*3));
  if(a>0){tagAppended(before,a);added+=a;}
 }
 emitImpactRipples(now,c);
 const S=window.__v5WaterfallM57;if(S){S.particlesAdded=added;S.remaining=budget();S.layers=nextLayer;S.width=c.width;S.thickness=c.thick;S.across=c.across;S.impactX=impactPoint(c).x;S.tag=TAG;}
}
requestAnimationFrame(step);

function sync(){
 const b=document.querySelector('[data-m46="waterfall-m58"]');if(b)b.classList.toggle('active',state.scenario==='waterfall-m58');
 const s=document.getElementById('v5WaterfallM57Status');if(s){const c=config();s.textContent=`THIN TAGGED PBF CURTAIN · ${c.across}×${c.thick} physical lattice · ${(c.width/c.b[2]*100).toFixed(0)}% width · +${added.toLocaleString()} particles`;}
}
function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM57'))return;
 const w=document.createElement('div');w.id='v5WaterfallM57';w.style.cssText='margin-top:10px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 w.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">PHYSICS WATERFALL · M5.8</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">A thin, densely extruded PBF curtain carries the real mass and momentum. Airborne particles are tagged for dedicated sheet surfacing; after impact the tag is cleared and they become ordinary pool water again.</div><div class="v5Slider"><label>WATERFALL WIDTH</label><input id="v5WaterfallWidth" type="range" min="0.48" max="0.92" step="0.01"><div id="v5WaterfallWidthVal" class="v5Val"></div></div><div id="v5WaterfallM57Status" style="font:7.5px/1.45 ui-monospace;color:#9fc5d0;margin-top:6px"></div>`;
 host.appendChild(w);w.onpointerdown=e=>e.stopPropagation();
 const input=w.querySelector('#v5WaterfallWidth'),val=w.querySelector('#v5WaterfallWidthVal');input.value=state.waterfallWidth;const sv=()=>val.textContent=`${Math.round(state.waterfallWidth*100)}%`;sv();input.oninput=e=>{e.stopPropagation();state.waterfallWidth=Number(input.value);save();sv();sync();};sync();
}
setInterval(()=>{installButton();mount();sync();},520);mount();
window.__v5WaterfallM57={online:true,backend:'tagged-thin-pbf-curtain-m58',particlesAdded:0,remaining:budget(),layers:0,width:0,thickness:0,across:0,impactX:0,tag:TAG};
window.__v5WaterfallTag=TAG;
console.info('[Fluid V5 M5.8] tagged thin-sheet PBF waterfall online.');
