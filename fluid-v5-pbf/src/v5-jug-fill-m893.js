// Fluid V8 M8.9.3 — fill the actual GLB-derived jug interior with ordinary PBF water.
// M8.9.2 already supplies the angle-aware collision shell. This module replaces only the
// conservative circular startup seed by packing particles directly against that same 11x16 shell.
import {sim,ui,queue,pitcherPoint,scene} from './v5-pitcher-fluid-physics-m872.js';
if(!sim?.dev||!queue||!scene)throw new Error('M8.9.3 jug fill runtime unavailable');

const q=new URLSearchParams(location.search),TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const spec=window.__v5JugShell892;
if(!spec?.ys?.length||!spec?.rows?.length)throw new Error('M8.9.3 GLB inner shell unavailable');
const ANG=spec.rows[0].length;

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

let seedCount=0,seedRuns=0,lastFillY=0,lastCycle=scene.cycles;
function seedShellVolume(){
  const d=Math.max(.001,Number(sim.params?.spacing)||.019);
  const a=Math.cbrt(2)*d,dy=.5*a;
  const bottom=spec.bottom+d*.80;
  const fillFraction=clamp(Number(q.get('jugfill'))||.67,.42,.78);
  const fillY=Math.min(spec.top-d*2.2,spec.bottom+(spec.top-spec.bottom)*fillFraction);
  const limit=Math.min(sim.cap||10500,Number(q.get('jugparticles'))||5200);
  const maxR=Math.max(...spec.rows.flat());
  const P=[],V=[];let layer=0;
  outer:for(let y=bottom;y<=fillY+1e-7;y+=dy,layer++){
    const offX=(layer&1)?a*.5:0,offZ=(layer%3===1)?a*.34:0;
    const e=Math.ceil((maxR+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+offX,z=iz*a+offZ,r=Math.hypot(x,z);
      const wall=shellRadius(y,x,z);
      // Keep roughly half a particle radius away from the glass shell so the first PBF
      // projection settles rather than starting in penetration.
      const safe=Math.max(.010,wall-d*.58);
      if(r>safe)continue;
      const p=pitcherPoint([x,y,z],0);
      P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=limit)break outer;
    }
  }
  const n=P.length/4;if(n<64)throw new Error(`M8.9.3 shell seed too small (${n})`);
  const p4=new Float32Array(P),v4=new Float32Array(V),zero4=new Float32Array(n*4);
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],0,p4);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],0,v4);
  for(const name of ['bodyA','bodyB','restA','restB'])if(sim.buf[name])queue.writeBuffer(sim.buf[name],0,zero4);
  if(sim.buf.density)queue.writeBuffer(sim.buf.density,0,new Float32Array(n).fill(Number(sim.params?.restDensity)||1000));
  sim.n=n;if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.timeBank=0;sim.simTime=0;sim.uploadParams?.(1/240);sim.bindCache=null;
  scene.seeded=n;seedCount=n;seedRuns++;lastFillY=fillY;
  return n;
}

// M8.8's hardReset increments scene.cycles after writing its legacy seed. Install outside the
// existing energy-guard wrapper and replace that seed immediately before the next PBF step.
const baseStep=sim.step.bind(sim);
sim.step=function(dt){
  if(scene.active&&scene.cycles!==lastCycle){
    lastCycle=scene.cycles;
    try{seedShellVolume();}catch(err){console.error('[M8.9.3 shell fill]',err);}
  }
  return baseStep(dt);
};

const host=document.getElementById('m880Hud');
let line=null;if(host){line=document.createElement('div');line.id='m893FillStatus';line.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#9fe9c7';host.appendChild(line);}
function sync(){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent='M8.9.3 · GLB-SHELL WATER FILL';
  const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.3';
  if(line)line.textContent=`GLB volume fill ${seedCount.toLocaleString()} PBF particles · waterline ${lastFillY.toFixed(3)} m · reseeds ${seedRuns}`;
}
sync();setInterval(sync,300);

window.__v5M893JugFill={online:true,backend:'angle-aware-glb-shell-hydrostatic-seed',get particles(){return seedCount},get waterline(){return lastFillY},get runs(){return seedRuns},reseed:seedShellVolume};
window.__fluidV5Version='8.9.3';window.__fluidV5Build='M8.9.3 GLB-SHELL VOLUME FILL / ORIGINAL GLB MATERIAL / INNER-NORMAL COLLISION / M8.8.1 PBF';
document.title='Fluid V8 · M8.9.3 GLB-Shell Water Fill';
console.info('[Fluid V8 M8.9.3] angle-aware GLB shell water seeding online.');