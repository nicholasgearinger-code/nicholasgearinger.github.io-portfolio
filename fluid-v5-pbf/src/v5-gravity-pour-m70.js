// Fluid V5 M7.0 gravity-pour benchmark — solver-authoritative revision 3.
// This remains a geometry/initial-condition experiment: the same primary PBF water starts at rest
// behind a removable collision gate. M7 requests numerical accuracy, never a trajectory or velocity.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/b31bb85582209f7b20c06b51ec0bf1452653eb39/fluid-v5-pbf/src/v5-gravity-pour-m70.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M7.0 canonical gravity-pour source unavailable (${response.status}).`);
let src=await response.text();

// Revision 3: tall, essentially full-width, high-head reservoir.
src=src.replace('if(Number(state.gravityPourRev||0)<1){','if(Number(state.gravityPourRev||0)<3){');
src=src.replace('state.gravityPourHeight=.80;','state.gravityPourHeight=.93;');
src=src.replace('state.gravityPourWidth=.72;','state.gravityPourWidth=.992;');
src=src.replace('state.gravityPourVolume=.46;','state.gravityPourVolume=.68;');
src=src.replace('state.gravityPourRev=1;','state.gravityPourRev=3;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourHeight)))state.gravityPourHeight=.80;','if(!Number.isFinite(Number(state.gravityPourHeight)))state.gravityPourHeight=.93;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourWidth)))state.gravityPourWidth=.72;','if(!Number.isFinite(Number(state.gravityPourWidth)))state.gravityPourWidth=.992;');
src=src.replace('if(!Number.isFinite(Number(state.gravityPourVolume)))state.gravityPourVolume=.46;','if(!Number.isFinite(Number(state.gravityPourVolume)))state.gravityPourVolume=.68;');
src=src.replace('state.gravityPourHeight=clamp(Number(state.gravityPourHeight),.62,.88);','state.gravityPourHeight=clamp(Number(state.gravityPourHeight),.74,.965);');
src=src.replace('state.gravityPourWidth=clamp(Number(state.gravityPourWidth),.38,.92);','state.gravityPourWidth=clamp(Number(state.gravityPourWidth),.72,.998);');
src=src.replace('state.gravityPourVolume=clamp(Number(state.gravityPourVolume),.24,.62);','state.gravityPourVolume=clamp(Number(state.gravityPourVolume),.34,.74);');
src=src.replace('const floorY=b[1]*clamp(Number(state.gravityPourHeight)||.80,.62,.88);','const floorY=b[1]*clamp(Number(state.gravityPourHeight)||.93,.74,.965);');
src=src.replace('const lipX=b[0]*.46;','const lipX=b[0]*.64;');
src=src.replace('const width=b[2]*clamp(Number(state.gravityPourWidth)||.72,.38,.92);','const width=b[2]*clamp(Number(state.gravityPourWidth)||.992,.72,.998);');
src=src.replace('const wallTop=Math.min(b[1]-d*2.2,floorY+Math.max(d*8.5,b[1]*.20));','const wallTop=Math.min(b[1]-d*.72,floorY+Math.max(d*13.0,b[1]*.30));');
src=src.replace('const upperWanted=Math.round(nFluid*clamp(Number(state.gravityPourVolume)||.46,.24,.62));','const upperWanted=Math.round(nFluid*clamp(Number(state.gravityPourVolume)||.68,.34,.74));');

// The scene requests a numerical floor. M4.0 remains authoritative and may raise this further from
// its spacing/speed CFL test. The water itself still starts with zero velocity.
src=src.replace('function tune(on){\n if(on&&!wasActive)',`function tune(on){
 if(on){window.__v5SolverFloor={owner:'m70',substeps:quality==='low'?4:quality==='high'?6:5,iterations:quality==='low'?6:quality==='high'?10:8,maxSubsteps:quality==='high'?10:8,cfl:true};}
 else if(window.__v5SolverFloor?.owner==='m70'){window.__v5SolverFloor=null;}
 if(on&&!wasActive)`);

// M7 material settings are modest. Accuracy comes from the shared solver controller, not from
// scene-specific artificial cohesion or velocity forcing.
src=src.replace("sim.params.substeps=Math.max(Number(sim.params.substeps)||2,quality==='high'?5:4);","sim.params.substeps=Math.max(Number(sim.params.substeps)||2,quality==='low'?4:quality==='high'?6:5);");
src=src.replace("sim.params.iterations=Math.max(Number(sim.params.iterations)||4,quality==='high'?7:6);","sim.params.iterations=Math.max(Number(sim.params.iterations)||4,quality==='low'?6:quality==='high'?10:8);");
src=src.replace("sim.params.xsphC=Math.max(.025,Math.min(.050,Number(sim.params.xsphC)||.035));","sim.params.xsphC=Math.max(.026,Math.min(.042,Number(sim.params.xsphC)||.034));");
src=src.replace("sim.params.sCorrK=Math.min(Number(sim.params.sCorrK)||.05,.065);","sim.params.sCorrK=Math.min(Number(sim.params.sCorrK)||.032,.042);");
src=src.replace("sim.params.surfaceTensionK=Math.min(Number(sim.params.surfaceTensionK)||.08,.11);","sim.params.surfaceTensionK=Math.min(Number(sim.params.surfaceTensionK)||.050,.065);");
src=src.replace('state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.82);','state.xpbdDensity=Math.max(Number(state.xpbdDensity)||0,.92);');

// UI envelope follows the physical benchmark.
src=src.replace('min="0.62" max="0.88" step="0.01"','min="0.74" max="0.965" step="0.005"');
src=src.replace('min="0.38" max="0.92" step="0.02"','min="0.72" max="0.998" step="0.005"');
src=src.replace('min="0.24" max="0.62" step="0.02"','min="0.34" max="0.74" step="0.02"');
src=src.replace('clamp(Number(e.target.value),.62,.88)','clamp(Number(e.target.value),.74,.965)');
src=src.replace('clamp(Number(e.target.value),.38,.92)','clamp(Number(e.target.value),.72,.998)');
src=src.replace('clamp(Number(e.target.value),.24,.62)','clamp(Number(e.target.value),.34,.74)');
src=src.replace('controlled gravity-pour benchmark','solver-authoritative gravity-pour benchmark');
src=src.replace('gated-gravity-pour-pbf-m70','solver-authoritative-gated-pour-pbf-m70');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}

const sim=window.__sim,state=window.__v5State;
const active=()=>state?.scenario==='gravity-pour-m70';

// Strict benchmark isolation: no module may append new PRIMARY PBF mass while this experiment is
// active. Secondary spray/detail systems are separate buffers and continue to operate normally.
if(sim?.appendFluid&&!sim.__m70AppendGuard){
 const append=sim.appendFluid.bind(sim);
 sim.__m70AppendGuard={blockedParticles:0,base:append};
 sim.appendFluid=function(points,vels,...rest){
  if(active()){
   const n=Math.floor((points?.length||0)/3);sim.__m70AppendGuard.blockedParticles+=n;
   const S=window.__v5GravityPourM70;if(S)S.blockedAppendParticles=sim.__m70AppendGuard.blockedParticles;
   return 0;
  }
  return append(points,vels,...rest);
 };
}

// Mass telemetry is intentionally observational: if the total primary/rigid particle count changes,
// report it rather than hiding the defect. With appendFluid guarded, drift should remain exactly zero.
let wasActive=false,massReference=0;
setInterval(()=>{
 const on=active();
 if(on&&!wasActive)massReference=Number(sim?.n)||0;
 if(on){
  const S=window.__v5GravityPourM70;if(S){S.massReference=massReference;S.massCurrent=Number(sim?.n)||0;S.massDrift=(Number(sim?.n)||0)-massReference;S.solverFloor=window.__v5SolverFloor||null;S.revision=3;S.highVolume=true;S.massConserved=S.massDrift===0;}
 }
 if(!on&&window.__v5SolverFloor?.owner==='m70')window.__v5SolverFloor=null;
 wasActive=on;
},120);

if(window.__v5GravityPourM70){window.__v5GravityPourM70.backend='solver-authoritative-gated-pour-pbf-m70';window.__v5GravityPourM70.revision=3;window.__v5GravityPourM70.highVolume=true;window.__v5GravityPourM70.fixedPrimaryMass=true;}
console.info('[Fluid V5 M7.0] revision 3: CFL solver floor + fixed-primary-mass gravity pour online.');
