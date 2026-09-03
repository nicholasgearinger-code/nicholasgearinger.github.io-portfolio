// Fluid V8 M8.9.5 — clean hydrostatic reservoir + GLB-specific pour tuning.
// Uses only the real PBF water and the cleaned M8.9.5 GLB body shell. No M8.9.3 full-shell
// seed is loaded. The initial free surface is flat and below the neck, surface tension is
// reduced to avoid wall beads, and the taller GLB jug rotates farther so it can actually drain.
import {sim,queue,pitcher,pitcherPoint,scene} from './v5-pitcher-fluid-physics-m872.js';
if(!sim?.dev||!queue||!pitcher||!scene)throw new Error('M8.9.5 jug reservoir runtime unavailable');

const q=new URLSearchParams(location.search),TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const spec=window.__v5JugShell892;
const jug=window.__v5M892JugState;
const shellFix=window.__v5M895ShellFix;
if(!spec?.ys?.length||!spec?.rows?.length||!shellFix?.online)throw new Error('M8.9.5 cleaned GLB shell unavailable');
const ANG=spec.rows[0].length;

function quantile(a,t){const s=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!s.length)return 0;const p=clamp(t,0,1)*(s.length-1),i=Math.floor(p),f=p-i;return s[i]*(1-f)+s[Math.min(i+1,s.length-1)]*f;}
function shellRadius(y,x,z){
  const ys=spec.ys,rows=spec.rows;y=clamp(y,ys[0],ys.at(-1));
  let iy=0;while(iy<ys.length-2&&y>ys[iy+1])iy++;
  const ty=clamp((y-ys[iy])/Math.max(1e-6,ys[iy+1]-ys[iy]),0,1);
  let a=Math.atan2(z,x);if(a<0)a+=TAU;
  const u=a/TAU*ANG,i0=Math.floor(u)%ANG,i1=(i0+1)%ANG,ta=u-Math.floor(u);
  const r0=rows[iy][i0]*(1-ta)+rows[iy][i1]*ta,r1=rows[iy+1][i0]*(1-ta)+rows[iy+1][i1]*ta;
  return r0*(1-ty)+r1*ty;
}

// The cleaned shell is already handle-free. The median radius gives a stable hydrostatic
// belly while true per-angle clipping below still preserves the actual jug wall.
const bellyRows=spec.rows.map(row=>quantile(row,.52));
function bellyRadius(y){
  const ys=spec.ys;y=clamp(y,ys[0],ys.at(-1));let i=0;while(i<ys.length-2&&y>ys[i+1])i++;
  const t=clamp((y-ys[i])/Math.max(1e-6,ys[i+1]-ys[i]),0,1);return bellyRows[i]*(1-t)+bellyRows[i+1]*t;
}
function reservoirTop(){
  const H=Math.max(1e-5,spec.top-spec.bottom);
  const frac=clamp(Number(q.get('jugfill'))||.735,.60,.77);
  let top=spec.bottom+H*frac,maxB=Math.max(...bellyRows);
  for(let i=2;i<bellyRows.length;i++)if(spec.ys[i]>spec.bottom+H*.58&&bellyRows[i]<maxB*.69){top=Math.min(top,spec.ys[Math.max(1,i-1)]-H*.020);break;}
  return clamp(top,spec.bottom+H*.52,spec.top-H*.13);
}
function tuneFluid(){
  if(!sim.params)return;
  sim.params.substeps=4;sim.params.iterations=6;
  sim.params.xsphC=.050;sim.params.sCorrK=.065;
  // M8.8's .015 surface tension is too bead-like on the smooth GLB wall.
  sim.params.surfaceTensionK=.0045;
}

// The real model has a taller shoulder/spout than the analytic M8.8 pitcher. ~84 degrees
// lowers its real lip enough for gravity to clear the remaining reservoir without fake emitters.
const tiltDeg=clamp(Number(q.get('jugtilt'))||84,74,91);
pitcher.maxAngle=-tiltDeg*Math.PI/180;

let seedCount=0,seedRuns=0,lastFillY=0,lastCycle=scene.cycles,lastReason='module load';
function seedReservoir(reason='cycle'){
  tuneFluid();
  const d=Math.max(.001,Number(sim.params?.spacing)||.019),a=Math.cbrt(2)*d,dy=.5*a;
  const bottom=spec.bottom+d*.90,fillY=reservoirTop();
  const limit=Math.min(sim.cap||10500,Math.max(900,Number(q.get('jugparticles'))||3600));
  const maxR=Math.max(...bellyRows),P=[],V=[];let layer=0;
  outer:for(let y=bottom;y<=fillY+1e-7;y+=dy,layer++){
    const offX=(layer&1)?a*.5:0,offZ=(layer%3===1)?a*.34:0;
    // Extra wall clearance prevents the first density correction from turning the free surface
    // into the vertical beads visible in M8.9.4.
    const envelope=Math.max(.008,bellyRadius(y)-d*.68),e=Math.ceil((Math.min(maxR,envelope)+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+offX,z=iz*a+offZ,r=Math.hypot(x,z);if(r>envelope)continue;
      const safe=Math.max(.008,Math.min(envelope,shellRadius(y,x,z)-d*.78));if(r>safe)continue;
      const p=pitcherPoint([x,y,z],0);P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=limit)break outer;
    }
  }
  const n=P.length/4;if(n<128)throw new Error(`M8.9.5 reservoir seed too small (${n})`);
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

// Keep the original GLB material model, just leave enough transmission to read the water.
if(jug?.material?.base){
  const m=jug.material,alpha=clamp(Number(q.get('jugalpha'))||.31,.18,.48);
  m.base[0]=clamp(m.base[0]*1.10+.025,0,1);m.base[1]=clamp(m.base[1]*1.10+.025,0,1);m.base[2]=clamp(m.base[2]*1.10+.030,0,1);m.base[3]=alpha;
  m.roughness=clamp(Math.max(.030,Number(m.roughness)||0),.025,.11);m.clearcoat=clamp(Math.max(.90,Number(m.clearcoat)||0),0,1);m.clearcoatRoughness=clamp(Math.max(.022,Number(m.clearcoatRoughness)||0),.02,.08);
}

// M8.8 hardReset writes its legacy seed and then increments scene.cycles. Replace that seed
// before the next solver step so no legacy or M8.9.3 volume ever gets one physics frame.
const baseStep=sim.step.bind(sim);
sim.step=function(dt){
  if(scene.active&&scene.cycles!==lastCycle){lastCycle=scene.cycles;try{seedReservoir('hard reset');}catch(err){console.error('[M8.9.5 reservoir]',err);}}
  return baseStep(dt);
};

// Seed once immediately. If M8.8's delayed startup reset fires later, the wrapper above
// deterministically replaces it again before simulation resumes.
try{seedReservoir('module load');lastCycle=scene.cycles;}catch(err){console.error('[M8.9.5 initial reservoir]',err);}

const host=document.getElementById('m880Hud');
let line=null;if(host){line=document.createElement('div');line.id='m895ReservoirStatus';line.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#ffd890';host.appendChild(line);}
function sync(){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent='M8.9.5 · CLEAN GLB POUR';
  const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.5';
  if(line){const alpha=jug?.material?.base?.[3];line.textContent=`clean reservoir ${seedCount.toLocaleString()} PBF · waterline ${lastFillY.toFixed(3)} m · tilt ${tiltDeg.toFixed(0)}° · shell ${spec.minR.toFixed(3)}…${spec.maxR.toFixed(3)} m · glass α ${Number(alpha||0).toFixed(2)} · reseeds ${seedRuns} (${lastReason})`;}
}
sync();setInterval(sync,300);

window.__v5M895JugReservoir={online:true,backend:'clean-hydrostatic-glb-body-reservoir-full-drain',reseed:seedReservoir,get particles(){return seedCount},get waterline(){return lastFillY},get tiltDeg(){return tiltDeg},get runs(){return seedRuns}};
window.__fluidV5Version='8.9.5';window.__fluidV5Build='M8.9.5 CLEAN GLB BODY SHELL / HYDROSTATIC RESERVOIR / REDUCED WALL BEADING / 84 DEG FULL DRAIN';
document.title='Fluid V8 · M8.9.5 Clean GLB Pour';
console.info('[Fluid V8 M8.9.5] clean GLB reservoir + full-drain pour tuning online.');
