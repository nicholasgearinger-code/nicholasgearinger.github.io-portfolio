// Fluid V5 M4.5 adaptive workload + neighbour-grid telemetry.
// The PBF core already uses GPU count/scan/scatter spatial sorting. This controller preserves that
// mandatory solve and scales optional neighbourhood/detail work around it according to frame and
// physical stress. It never deletes pressure particles merely to recover FPS.

const sim=window.__sim,ssfr=window.__ssfr,mesh=window.__mesh,state=window.__v5State;
if(!sim?.params||!ssfr||!mesh)throw new Error('Fluid V5 M4.5 workload: runtime unavailable.');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const coarse=matchMedia?.('(pointer:coarse)')?.matches??false,target=coarse?30:55;
const W=window.__v5Workload={online:true,backend:'gpu-grid-adaptive-m45',targetFps:target,fps:target,ema:target,pressure:0,activity:0,secondaryScale:1,temporalScale:1,detailEvery:1,particlesPerCell:0,grid:'count-scan-scatter'};
let last=performance.now();
function readFps(){const m=(document.getElementById('v4fps')?.textContent||'').match(/([0-9.]+)/);return m?Number(m[1])||0:0;}
function tick(){const now=performance.now(),dt=clamp((now-last)/1000,.25,2);last=now;const fps=readFps();if(fps>0)W.ema=W.ema*.76+fps*.24;W.fps=fps;const gpu=window.__v5AutoBudget?.pressure||0,speed=Number(sim.stats?.maxSpeed)||0,rho=Number(sim.stats?.maxRho)||1;const physical=Math.max(clamp((speed-1.0)/3.2,0,1),clamp((rho-1.01)/.12,0,1));const frame=clamp((target-W.ema+3)/15,0,1);W.pressure=Math.max(gpu,frame);W.activity=physical;W.particlesPerCell=sim.n/Math.max(1,sim.nCells||1);
 // Preserve more visual detail when the water is physically violent; otherwise optional work yields first.
 W.secondaryScale=clamp(1.0-W.pressure*.68+physical*.18,.28,1.08);W.temporalScale=clamp(1.0-W.pressure*.52,.42,1);W.detailEvery=W.pressure>.82?3:W.pressure>.55?2:1;
 if(window.__v5AutoBudget)window.__v5AutoBudget.secondaryScale=W.secondaryScale;
 if(state.autoQuality){const min=coarse?2:3,max=coarse?3:4;ssfr.filterIterations=W.pressure>.72?min:max;mesh.anisoMinNeighbours=W.pressure>.72?Math.max(12,mesh.anisoMinNeighbours-2):mesh.anisoMinNeighbours;}
 const el=document.getElementById('v5WorkloadStatus');if(el)el.textContent=`${W.grid} · ${W.particlesPerCell.toFixed(1)} p/cell · activity ${Math.round(W.activity*100)}% · pressure ${Math.round(W.pressure*100)}% · detail 1/${W.detailEvery}`;
}
setInterval(tick,850);tick();
function mount(){const panel=document.getElementById('settingsPanel');if(!panel||document.getElementById('v5WorkloadM45'))return;const w=document.createElement('div');w.id='v5WorkloadM45';w.innerHTML=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)"><div style="font:800 10px ui-monospace;color:#8fffd1;letter-spacing:.12em">ADAPTIVE WORKLOAD · M4.5</div><div style="font:8px/1.45 ui-monospace;color:#8caeba;margin:6px 0">Keeps the full pressure solve, then sheds/rebuilds optional surface, whitewater and detail work around the existing GPU sorted neighbour grid.</div><div id="v5WorkloadStatus" style="font:8px/1.45 ui-monospace;color:#9fc5d0"></div></div>`;panel.appendChild(w);w.onpointerdown=e=>e.stopPropagation();tick();}
mount();console.info('[Fluid V5 M4.5] adaptive workload manager online; core neighbour search = GPU count/scan/scatter.');
