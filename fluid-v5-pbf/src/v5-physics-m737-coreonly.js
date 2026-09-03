// Fluid V5 M7.3.7 — iOS-safe core-only physics controller.
// IMPORTANT: this module intentionally performs NO extra GPU queue.submit() calls.
// iOS/WebKit can stall when multiple WebGPU command buffers remain in flight, so the
// stability path keeps all persistent fluid work inside the upstream PBF step.

const sim=window.__sim,state=window.__v5State;
if(!sim?.params||!state)throw new Error('M7.3.7 core physics: runtime unavailable.');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search);
const quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const safeMax=quality==='low'?4:quality==='high'?6:5;
const base={substeps:Math.max(1,Number(sim.params.substeps)||2),iterations:Math.max(1,Number(sim.params.iterations)||4),xsphC:Number(sim.params.xsphC)||.03,cfm:Number(sim.params.cfmEpsilonRel)||.01};

// Start conservative on iOS. Users can re-enable adaptive work later after stability is proven.
state.physicsAuto=false;
state.vorticity=0;
state.hydroDrag=0;
state.xpbdDensity=0;
try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state));}catch{}

let dynamic={substeps:base.substeps,iterations:base.iterations,floorSubsteps:0,floorIterations:0,safeMax};
const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){
 const floor=window.__v5SolverFloor||null;
 const floorSub=Math.max(0,Number(floor?.substeps)||0);
 const floorIt=Math.max(0,Number(floor?.iterations)||0);
 const requestedSub=state.physicsAuto?Math.max(base.substeps,floorSub):base.substeps;
 const requestedIt=state.physicsAuto?Math.max(base.iterations,floorIt):base.iterations;
 this.params.substeps=clamp(requestedSub,base.substeps,safeMax);
 this.params.iterations=clamp(requestedIt,base.iterations,Math.max(base.iterations,6));
 this.params.xsphC=base.xsphC;
 this.params.cfmEpsilonRel=base.cfm;
 dynamic={substeps:this.params.substeps,iterations:this.params.iterations,floorSubsteps:floorSub,floorIterations:floorIt,safeMax};
 return baseStep(frameDt);
};

window.__v5PhysicsM40={online:true,backend:'ios-core-only-single-submit-m737',state,dynamic,cfl:false,sceneFloors:true,extraGpuSubmit:false};
window.__v5XPBDM50={online:false,backend:'disabled-ios-stability-m737',strength:0,lastIterations:0};
window.__v5RigidHydroM51={online:false,backend:'disabled-ios-stability-m737'};
console.info('[Fluid V5 M7.3.7] core-only physics active: no persistent post-PBF queue submissions.');
