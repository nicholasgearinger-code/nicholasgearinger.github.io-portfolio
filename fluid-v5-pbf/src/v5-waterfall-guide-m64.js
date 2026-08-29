// Fluid V5 M6.4 FLIP-like waterfall guide field.
// The PBF particles remain the real liquid. This post-solve guide keeps a coherent spill near the lip,
// follows the same forward ballistic arc as the renderer, then releases control before impact so the
// receiving pool's PBF pressure solve owns the plunge cavity, rebound and turbulence.

const sim=window.__sim,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!state)throw new Error('Fluid V5 M6.4 guide: PBF runtime unavailable.');
const dev=sim.dev,TAG=window.__v5WaterfallTag||0x5746;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quality=new URLSearchParams(location.search).get('quality')||'medium';
if(!Number.isFinite(Number(state.waterfallCoherence)))state.waterfallCoherence=1.0;
state.waterfallCoherence=clamp(Number(state.waterfallCoherence),.55,1.25);
const active=()=>state.scenario==='waterfall-m62';
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55),surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.88,b[1]*.335),surface+d*7,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.20,b[0]*.022),vx=.155+.045*flow,vy=-.025-.015*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface),fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const requested=b[2]*clamp(Number(state.waterfallWidth)||.94,.70,.985);
 const minAcross=quality==='low'?18:quality==='high'?32:26,maxAcross=quality==='low'?30:quality==='high'?56:44;
 const across=clamp(Math.round(requested/d),minAcross,maxAcross),width=(across-1)*d;
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width,centreZ:b[2]*.5};
}

const uni=dev.createBuffer({label:'fluidV5M64GuideUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16),U=new Uint32Array(F.buffer);
const wgsl=`
struct Cfg{g0:vec4f,g1:vec4f,g2:vec4f,ids:vec4u}
@group(0)@binding(0)var<uniform>C:Cfg;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read>B:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.ids.x){return;}let ph=B[i];if(ph.w!=C.ids.y){return;}
 var p=P[i];var v=V[i];
 let surface=C.g0.x;let topY=C.g0.y;let nozzleX=C.g0.z;let centreZ=C.g0.w;
 let width=C.g1.x;let spacing=C.g1.y;let vx0=C.g1.z;let vy0=C.g1.w;
 let gravity=max(C.g2.x,.01);let coherence=C.g2.z;
 let fall=clamp((topY-p.y)/max(topY-surface,1e-4),0.0,1.0);
 let release=smoothstep(.44,.91,fall);
 let drop=max(topY-p.y,0.0);
 let t=(vy0+sqrt(max(vy0*vy0+2.0*gravity*drop,0.0)))/gravity;
 let seed=hash1(ph.y*747796405u+17u);
 let ribbonA=sin((p.z-centreZ)/max(spacing,1e-4)*.68+seed*6.28318);
 let ribbonB=sin((p.z-centreZ)/max(spacing,1e-4)*1.43-seed*4.2);
 let ribbon=(ribbonA*.68+ribbonB*.32)*spacing*.14*release;
 let targetX=nozzleX+vx0*t+ribbon;
 // Coherence is intentionally strong only in the upper sheet. Close to the receiving pool the
 // correction becomes negligible so particles can collide, compress locally and rebound naturally.
 let upperStrength=.90*coherence;let lowerStrength=.025*coherence;
 let strength=mix(upperStrength,lowerStrength,release);
 let maxCorr=spacing*mix(.17,.015,release);
 p.x+=clamp((targetX-p.x)*strength,-maxCorr,maxCorr);
 let halfW=width*.5;let lo=centreZ-halfW;let hi=centreZ+halfW;
 if(p.z<lo){p.z+=min((lo-p.z)*.42*strength,spacing*.11);}else if(p.z>hi){p.z-=min((p.z-hi)*.42*strength,spacing*.11);}
 let targetVy=vy0-gravity*t;
 let lateral=(seed-.5)*mix(.008,.080,release)+(ribbonA*.020+ribbonB*.012)*release;
 let targetV=vec3f(vx0,targetVy,lateral);
 let vk=mix(.36,.012,release)*strength;
 v.xyz=mix(v.xyz,targetV,clamp(vk,0.0,.54));
 P[i]=p;V[i]=v;
}`;
const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M64GuideWGSL'});
if(typeof mod.getCompilationInfo==='function'){
 const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.4 guide WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'fluidV5M64WaterfallGuide',layout:'auto',compute:{module:mod,entryPoint:'main'}});
let submits=0;
function guide(){
 if(!active()||!sim.n||ui?.paused)return;const g=geom();
 F[0]=g.surface;F[1]=g.topY;F[2]=g.nozzleX;F[3]=g.centreZ;
 F[4]=g.width;F[5]=g.d;F[6]=g.vx;F[7]=g.vy;
 F[8]=g.g;F[9]=g.impactX;F[10]=state.waterfallCoherence;F[11]=0;
 U[12]=sim.n;U[13]=TAG;U[14]=0;U[15]=0;dev.queue.writeBuffer(uni,0,F);
 const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}
 ]});
 const enc=dev.createCommandEncoder({label:'fluidV5M64GuideEncoder'}),cp=enc.beginComputePass();cp.setPipeline(pipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();dev.queue.submit([enc.finish()]);submits++;
 const S=window.__v5WaterfallGuideM64;if(S){S.submits=submits;S.surfaceY=g.surface;S.impactX=g.impactX;S.width=g.width;S.coherence=state.waterfallCoherence;S.physicalRelease=true;S.forwardArc=g.impactX-g.nozzleX;}
}
const baseStep=sim.step.bind(sim);sim.step=function(frameDt){const out=baseStep(frameDt);try{guide();}catch(err){const S=window.__v5WaterfallGuideM64;if(S){S.online=false;S.error=String(err?.message||err);}console.error('[Fluid V5 M6.4 guide]',err);}return out;};

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallGuideM64UI'))return;
 const d=document.createElement('div');d.id='v5WaterfallGuideM64UI';d.style.cssText='margin-top:8px';d.innerHTML=`<div class="v5Slider"><label>CURTAIN COHERENCE</label><input type="range" min="0.55" max="1.25" step="0.05"><div class="v5Val"></div></div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:4px">Ballistic physical coupling: coherent spill at the lip, increasing ribbon freedom during the fall, then almost complete guide release before pool contact so PBF pressure and collision response own the plunge.</div>`;host.appendChild(d);const r=d.querySelector('input'),v=d.querySelector('.v5Val');r.value=state.waterfallCoherence;const sync=()=>v.textContent=Number(state.waterfallCoherence).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state.waterfallCoherence=Number(r.value);save();sync();};d.onpointerdown=e=>e.stopPropagation();
}
setInterval(mount,600);mount();
window.__v5WaterfallGuideM64={online:true,backend:'post-pbf-ballistic-release-guide-m64',submits:0,error:'',surfaceY:0,impactX:0,width:0,forwardArc:0,coherence:state.waterfallCoherence,physicalRelease:true};
console.info('[Fluid V5 M6.4] ballistic lip guide with free PBF plunge release online.');
