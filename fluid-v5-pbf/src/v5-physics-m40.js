// Fluid V5 M4.0 Physics 2.0 — solver-floor / CFL revision.
// Loads the last known-good M4.0 implementation, then patches only its adaptive solver controller.
// Scenes may request a minimum numerical resolution through window.__v5SolverFloor without owning
// particle trajectories. The controller also raises substeps from a simple spacing/speed CFL test.

const sourceUrl='https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/59e7809baac6862265dbe1723d4942ee8db2bcb4/fluid-v5-pbf/src/v5-physics-m40.js';
const response=await fetch(sourceUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M4.0 canonical physics source unavailable (${response.status}).`);
let src=await response.text();

const oldAdapt=`let dynamic={substeps:baseParams.substeps,iterations:baseParams.iterations,pressure:0};
function adapt(){
 if(!state.physicsAuto){sim.params.substeps=baseParams.substeps;sim.params.iterations=baseParams.iterations;sim.params.xsphC=baseParams.xsphC;sim.params.cfmEpsilonRel=baseParams.cfm;return;}
 const speed=Number(sim.stats?.maxSpeed)||0,rho=Number(sim.stats?.maxRho)||1;
 const stress=Math.max(clamp((speed-1.6)/2.6,0,1),clamp((rho-1.025)/.10,0,1));
 const sub=baseParams.substeps+(stress>.72?2:stress>.30?1:0),it=baseParams.iterations+(rho>1.08?2:rho>1.035?1:0);
 sim.params.substeps=clamp(sub,baseParams.substeps,baseParams.substeps+2);sim.params.iterations=clamp(it,baseParams.iterations,baseParams.iterations+2);
 sim.params.xsphC=clamp(baseParams.xsphC*(1.0-.42*state.vorticity),.008,.08);
 // XPBD-inspired compliance normalization: smaller substep dt receives proportionally larger CFM.
 const ratio=sim.params.substeps/baseParams.substeps;sim.params.cfmEpsilonRel=clamp(baseParams.cfm*ratio*ratio,.002,.08);
 dynamic={substeps:sim.params.substeps,iterations:sim.params.iterations,pressure:stress};
}`;

const newAdapt=`let dynamic={substeps:baseParams.substeps,iterations:baseParams.iterations,pressure:0,cflSubsteps:baseParams.substeps,floorSubsteps:0,floorIterations:0};
function adapt(frameDt=1/60){
 const floor=window.__v5SolverFloor||null;
 const floorSub=Math.max(0,Number(floor?.substeps)||0);
 const floorIt=Math.max(0,Number(floor?.iterations)||0);
 const floorMax=Math.max(floorSub,Number(floor?.maxSubsteps)||8);
 const speed=Number(sim.stats?.maxSpeed)||0,rho=Number(sim.stats?.maxRho)||1;
 const stress=Math.max(clamp((speed-1.35)/2.8,0,1),clamp((rho-1.018)/.105,0,1));
 const dtFrame=clamp(Number(frameDt)||1/60,1/120,1/20);
 const spacing=Math.max(.004,Number(sim.params.spacing)||.03);
 // Keep a fluid parcel below roughly 0.45 particle spacings of travel per substep. The scene may
 // request a higher floor, but it cannot request a trajectory or velocity here.
 const cflSub=Math.max(baseParams.substeps,Math.ceil((speed*dtFrame)/Math.max(spacing*.45,1e-4)));
 const stressSub=baseParams.substeps+(stress>.78?3:stress>.48?2:stress>.20?1:0);
 const autoSub=state.physicsAuto?Math.max(stressSub,cflSub):baseParams.substeps;
 const autoIt=state.physicsAuto?baseParams.iterations+(rho>1.10?3:rho>1.055?2:rho>1.022?1:0):baseParams.iterations;
 const maxSub=Math.max(baseParams.substeps+2,Math.min(10,floorMax));
 sim.params.substeps=clamp(Math.max(autoSub,floorSub),baseParams.substeps,maxSub);
 sim.params.iterations=clamp(Math.max(autoIt,floorIt),baseParams.iterations,12);
 if(state.physicsAuto)sim.params.xsphC=clamp(baseParams.xsphC*(1.0-.42*state.vorticity),.008,.08);
 else sim.params.xsphC=baseParams.xsphC;
 // XPBD-inspired compliance normalization: smaller substep dt receives proportionally larger CFM.
 const ratio=sim.params.substeps/baseParams.substeps;sim.params.cfmEpsilonRel=clamp(baseParams.cfm*ratio*ratio,.002,.08);
 dynamic={substeps:sim.params.substeps,iterations:sim.params.iterations,pressure:stress,cflSubsteps:cflSub,floorSubsteps:floorSub,floorIterations:floorIt,owner:floor?.owner||''};
}`;

if(!src.includes(oldAdapt))throw new Error('Fluid V5 M4.0 patch: adaptive solver signature changed.');
src=src.replace(oldAdapt,newAdapt);
src=src.replace('sim.step=function(frameDt){adapt();const out=baseStep(frameDt);encodePostPhysics();return out;};','sim.step=function(frameDt){adapt(frameDt);const out=baseStep(frameDt);encodePostPhysics();return out;};');
src=src.replace("st.textContent=\`${dynamic.substeps} substeps · ${dynamic.iterations} density iterations · pressure ${Math.round(dynamic.pressure*100)}%\`;","st.textContent=\`${dynamic.substeps} substeps · ${dynamic.iterations} density iterations · CFL ${dynamic.cflSubsteps||0} · floor ${dynamic.floorSubsteps||0}/${dynamic.floorIterations||0} · pressure ${Math.round(dynamic.pressure*100)}%\`;");
src=src.replace("backend:'grid-vorticity-hydro-m40'","backend:'grid-vorticity-hydro-cfl-floor-m40'");
src=src.replace('Physics 2.0 online: adaptive solver + vorticity + hydrodynamic rigid coupling.','Physics 2.0 online: CFL adaptive solver + scene floors + vorticity + hydrodynamic rigid coupling.');

const blob=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blob);}finally{URL.revokeObjectURL(blob);}
if(window.__v5PhysicsM40){window.__v5PhysicsM40.backend='grid-vorticity-hydro-cfl-floor-m40';window.__v5PhysicsM40.cfl=true;window.__v5PhysicsM40.sceneFloors=true;}
