// Fluid V8 M8.9.4 — old-pitcher hydrostatic reservoir mapped into the GLB jug.
// Keeps M8.9.2's angle-aware GLB collision shell, but restores the successful M8.8
// startup behavior: a calm, zero-velocity belly reservoir with a flat free surface,
// conservative wall clearance, and no initial water packed into handle/spout features.
import {sim,queue,pitcherPoint,scene} from './v5-pitcher-fluid-physics-m872.js';
if(!sim?.dev||!queue||!scene)throw new Error('M8.9.4 jug reservoir runtime unavailable');

const q=new URLSearchParams(location.search),TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const spec=window.__v5JugShell892;
const jug=window.__v5M892JugState;
if(!spec?.ys?.length||!spec?.rows?.length)throw new Error('M8.9.4 GLB inner shell unavailable');
const ANG=spec.rows[0].length;

function quantile(a,t){
  const s=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!s.length)return 0;
  const p=clamp(t,0,1)*(s.length-1),i=Math.floor(p),f=p-i;
  return s[i]*(1-f)+s[Math.min(i+1,s.length-1)]*f;
}
function shellRadius(y,x,z){
  const ys=spec.ys,rows=spec.rows;
  y=clamp(y,ys[0],ys.at(-1));
  let iy=0;while(iy<ys.length-2&&y>ys[iy+1])iy++;
  const ty=clamp((y-ys[iy])/Math.max(1e-6,ys[iy+1]-ys[iy]),0,1);
  let a=Math.atan2(z,x);if(a<0)a+=TAU;
  const u=a/TAU*ANG,i0=Math.floor(u)%ANG,i1=(i0+1)%ANG,ta=u-Math.floor(u);
  const r0=rows[iy][i0]*(1-ta)+rows[iy][i1]*ta;
  const r1=rows[iy+1][i0]*(1-ta)+rows[iy+1][i1]*ta;
  return r0*(1-ty)+r1*ty;
}

// The old pitcher reservoir was essentially axisymmetric. Use the conservative middle of
// the GLB inner shell as a belly envelope, then still clip every particle by the true
// angle-aware shell. This prevents handle/spout cavities from becoming initial water volume.
const bellyRows=spec.rows.map(row=>quantile(row,.40));
function bellyRadius(y){
  const ys=spec.ys;y=clamp(y,ys[0],ys.at(-1));
  let i=0;while(i<ys.length-2&&y>ys[i+1])i++;
  const t=clamp((y-ys[i])/Math.max(1e-6,ys[i+1]-ys[i]),0,1);
  return bellyRows[i]*(1-t)+bellyRows[i+1]*t;
}
function reservoirTop(){
  const H=Math.max(1e-5,spec.top-spec.bottom);
  // M8.8's successful fillY=.100 over its -.225…+.205 body corresponds to ~75.6%.
  // Stay slightly lower in the real jug so the spout/neck remains dry until gravity tilts it.
  const frac=clamp(Number(q.get('jugfill'))||.735,.58,.77);
  let top=spec.bottom+H*frac;
  const maxB=Math.max(...bellyRows);
  // If the mesh narrows into a neck earlier than expected, stop below that transition.
  for(let i=2;i<bellyRows.length;i++){
    if(spec.ys[i]>spec.bottom+H*.58&&bellyRows[i]<maxB*.66){
      top=Math.min(top,spec.ys[Math.max(1,i-1)]-H*.018);break;
    }
  }
  return clamp(top,spec.bottom+H*.50,spec.top-H*.12);
}

let seedCount=0,seedRuns=0,lastFillY=0,lastCycle=scene.cycles,lastReason='boot';
function seedReservoir(reason='cycle'){
  const d=Math.max(.001,Number(sim.params?.spacing)||.019);
  const a=Math.cbrt(2)*d,dy=.5*a;
  const bottom=spec.bottom+d*.82,fillY=reservoirTop();
  // Match the successful M8.8 hydrostatic particle budget instead of overpacking the shell.
  const limit=Math.min(sim.cap||10500,Math.max(1200,Number(q.get('jugparticles'))||3600));
  const maxR=Math.max(...bellyRows),P=[],V=[];let layer=0;
  outer:for(let y=bottom;y<=fillY+1e-7;y+=dy,layer++){
    const offX=(layer&1)?a*.5:0;
    const offZ=(layer%3===1)?a*.34:0;
    const envelope=Math.max(.008,bellyRadius(y)-d*.46);
    const e=Math.ceil((Math.min(maxR,envelope)+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+offX,z=iz*a+offZ,r=Math.hypot(x,z);
      if(r>envelope)continue;
      const wall=shellRadius(y,x,z);
      const safe=Math.max(.008,Math.min(envelope,wall-d*.58));
      if(r>safe)continue;
      const p=pitcherPoint([x,y,z],0);
      P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=limit)break outer;
    }
  }
  const n=P.length/4;if(n<128)throw new Error(`M8.9.4 reservoir seed too small (${n})`);
  const p4=new Float32Array(P),v4=new Float32Array(V),zero4=new Float32Array(n*4);
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],0,p4);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],0,v4);
  for(const name of ['bodyA','bodyB','restA','restB'])if(sim.buf[name])queue.writeBuffer(sim.buf[name],0,zero4);
  if(sim.buf.density)queue.writeBuffer(sim.buf.density,0,new Float32Array(n).fill(Number(sim.params?.restDensity)||1000));
  sim.n=n;if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.timeBank=0;sim.simTime=0;sim.uploadParams?.(1/240);sim.bindCache=null;
  scene.seeded=n;seedCount=n;seedRuns++;lastFillY=fillY;lastReason=reason;
  return n;
}

// Keep the asset's material pipeline, only make the glass readable enough to validate water.
// v5-jug-model-m892.js keeps a live reference to this material object in its prepare() path.
if(jug?.material?.base){
  const m=jug.material;
  const alpha=clamp(Number(q.get('jugalpha'))||.36,.20,.58);
  m.base[0]=clamp(m.base[0]*1.18+.035,0,1);
  m.base[1]=clamp(m.base[1]*1.18+.035,0,1);
  m.base[2]=clamp(m.base[2]*1.18+.040,0,1);
  m.base[3]=alpha;
  m.roughness=clamp(Math.max(.035,Number(m.roughness)||0),.025,.14);
  m.clearcoat=clamp(Math.max(.85,Number(m.clearcoat)||0),0,1);
  m.clearcoatRoughness=clamp(Math.max(.025,Number(m.clearcoatRoughness)||0),.02,.10);
}

// M8.9.3's wrapper still runs first and may write its shell-packed seed. Replace it after
// that step whenever M8.8 hardReset advances scene.cycles; subsequent frames use this reservoir.
const baseStep=sim.step.bind(sim);
sim.step=function(dt){
  const changed=scene.active&&scene.cycles!==lastCycle;
  const out=baseStep(dt);
  if(changed){
    lastCycle=scene.cycles;
    try{seedReservoir('hard reset');}catch(err){console.error('[M8.9.4 reservoir]',err);}
  }
  return out;
};

// The moving-boundary scene schedules its first hard reset shortly after boot. This fallback
// handles cached/slow boot ordering and also makes direct module reloads deterministic.
setTimeout(()=>{
  if(!scene.active)return;
  try{seedReservoir(scene.started?'boot settle':'boot fallback');lastCycle=scene.cycles;}catch(err){console.error('[M8.9.4 boot reservoir]',err);}
},760);

const host=document.getElementById('m880Hud');
let line=null;if(host){line=document.createElement('div');line.id='m894ReservoirStatus';line.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#ffd890';host.appendChild(line);}
function sync(){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent='M8.9.4 · GLB JUG / PITCHER RESERVOIR';
  const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.4';
  if(line){
    const alpha=jug?.material?.base?.[3];
    line.textContent=`hydrostatic belly ${seedCount.toLocaleString()} PBF · flat waterline ${lastFillY.toFixed(3)} m · glass α ${Number(alpha||0).toFixed(2)} · reseeds ${seedRuns} (${lastReason})`;
  }
}
sync();setInterval(sync,300);

window.__v5M894JugReservoir={online:true,backend:'old-pitcher-hydrostatic-belly-clipped-to-glb-shell',reseed:seedReservoir,get particles(){return seedCount},get waterline(){return lastFillY},get runs(){return seedRuns},get bellyRows(){return bellyRows.slice()}};
window.__fluidV5Version='8.9.4';window.__fluidV5Build='M8.9.4 OLD-PITCHER HYDROSTATIC RESERVOIR / GLB INNER SHELL / READABLE ORIGINAL MATERIAL / M8.8.1 PBF';
document.title='Fluid V8 · M8.9.4 GLB Jug Pitcher Reservoir';
console.info('[Fluid V8 M8.9.4] old-pitcher hydrostatic reservoir mapped into the GLB jug; readable glass tuning online.');
