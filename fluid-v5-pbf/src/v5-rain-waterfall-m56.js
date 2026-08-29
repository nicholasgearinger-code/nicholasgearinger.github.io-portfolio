// Fluid V5 M5.6 rain + waterfall realism.
// Rain appearance is decoupled from conserved PBF mass: thousands of tiny render-only streaks
// provide the visual storm while sparse real fluid particles are deposited just above the live
// water surface. This avoids centimeter-scale PBF particles looking like giant raindrops.
// Waterfall uses a high-frequency staggered PBF source plus a translucent fluttering liquid sheet
// that progressively breaks up toward the impact region.

const sim=window.__sim,ssfr=window.__ssfr,ui=window.__ui,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!sim?.appendFluid||!state)throw new Error('Fluid V5 M5.6 weather: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const params=new URLSearchParams(location.search);
const quality=['low','medium','high'].includes(params.get('quality'))?params.get('quality'):'medium';
const RAIN_CAP=quality==='low'?900:quality==='high'?3200:2000;
const FALL_ROWS=18,FALL_COLS=10,FALL_VERTS=FALL_ROWS*FALL_COLS*6;
if(!Number.isFinite(Number(state.rainIntensity)))state.rainIntensity=1.0;
if(!Number.isFinite(Number(state.waterfallFlow)))state.waterfallFlow=1.0;
state.rainIntensity=clamp(Number(state.rainIntensity),.35,1.8);
state.waterfallFlow=clamp(Number(state.waterfallFlow),.45,1.55);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};

let seed=0x7261696e,physAdded=0,lastRainMass=0,lastFallMass=0,fallCursor=0,start=performance.now();
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const waterTop=()=>sim.params.box[1]*.28;
const room=()=>Math.max(0,Math.min(5200,(sim.cap||sim.n)-sim.n-48));
function resetScene(){document.getElementById('reset')?.click();physAdded=0;fallCursor=0;start=performance.now();}
function stopWave(){const t=document.getElementById('v4WaveToggle');if(t?.classList.contains('active'))t.click();}
function choose(name){state.scenario=name;ui.pouring=false;stopWave();save();resetScene();syncButtons();}

// ----- Conserved PBF mass ------------------------------------------------------------------
// The actual PBF particle spacing is centimeters, far larger than a real raindrop. Deposit these
// mass parcels immediately above the free surface so they create genuine impacts/ripples without
// appearing as marble-sized drops falling through the whole air column.
function rainMass(now){
 if(state.scenario!=='rainstorm'||ui.paused||document.hidden||room()<=0)return;
 const cadence=quality==='low'?78:quality==='high'?43:55;if(now-lastRainMass<cadence)return;lastRainMass=now;
 const b=sim.params.box,d=sim.params.spacing,n=Math.max(1,Math.round((quality==='low'?1:quality==='high'?3:2)*state.rainIntensity));
 const p=[],v=[];for(let i=0;i<n;i++){
   p.push(d*1.6+rnd()*(b[0]-d*3.2),waterTop()+d*(1.15+rnd()*.55),d*1.6+rnd()*(b[2]-d*3.2));
   v.push((rnd()-.5)*.18,-(2.4+rnd()*1.2),(rnd()-.5)*.15);
 }
 const take=Math.min(room(),n),a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));physAdded+=a;
}
function waterfallMass(now){
 if(state.scenario!=='waterfall-m56'||ui.paused||document.hidden||room()<=0)return;
 const cadence=quality==='low'?48:quality==='high'?24:32;if(now-lastFallMass<cadence)return;lastFallMass=now;
 const b=sim.params.box,d=sim.params.spacing,n=Math.max(2,Math.round((quality==='low'?3:quality==='high'?7:5)*state.waterfallFlow));
 const p=[],v=[],lanes=18;
 for(let i=0;i<n;i++){
   const lane=(fallCursor++)%lanes,u=(lane+.5)/lanes;
   const z=b[2]*(.18+.64*u)+(rnd()-.5)*d*.36;
   const flutter=Math.sin((now-start)*.006+u*13.0)*d*.20;
   p.push(b[0]*.095+(rnd()-.5)*d*.25,b[1]*(.815+(rnd()-.5)*.004),z+flutter);
   v.push(.34+(rnd()-.5)*.055,-(.16+rnd()*.11),(rnd()-.5)*.035);
 }
 const take=Math.min(room(),n),a=sim.appendFluid(p.slice(0,take*3),v.slice(0,take*3));physAdded+=a;
}
function sourceLoop(now){rainMass(now);waterfallMass(now);requestAnimationFrame(sourceLoop);}requestAnimationFrame(sourceLoop);

// ----- Procedural micro-rain ---------------------------------------------------------------
const rainUni=dev.createBuffer({label:'fluidV5M56RainUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const RF=new Float32Array(32);
const rainWGSL=`
struct R{vp:mat4x4f,box:vec4f,water:vec4f,screen:vec4f,style:vec4f}
@group(0)@binding(0)var<uniform>U:R;
struct V{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)bright:f32}
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->V{
 var o:V;let h0=hash1(ii*9781u+17u),h1=hash1(ii*6271u+91u),h2=hash1(ii*3917u+211u),h3=hash1(ii*1543u+617u);
 let top=U.box.y*.985,bot=U.water.x+U.style.x;let travel=max(top-bot,.1);let speed=mix(5.0,8.8,h2)*U.water.y;
 let phase=fract(h3+U.box.w*speed/travel);let wind=vec3f(U.water.z,-1.0,U.water.w);let dir=normalize(wind);
 var wp=vec3f(U.style.y+h0*(U.box.x-2.0*U.style.y),top-phase*travel,U.style.y+h1*(U.box.z-2.0*U.style.y));
 wp.x+=U.water.z*phase*.22;wp.z+=U.water.w*phase*.22;
 let streak=mix(.018,.052,h2)*(0.80+U.water.y*.22);let a=U.vp*vec4f(wp-dir*streak*.5,1),b=U.vp*vec4f(wp+dir*streak*.5,1),c=U.vp*vec4f(wp,1);
 if(c.w<=1e-4){o.p=vec4f(2);o.q=vec2f(2);o.bright=0;return o;}
 let an=a.xy/max(a.w,1e-4),bn=b.xy/max(b.w,1e-4),cn=c.xy/c.w;var along=bn-an;let al=length(along);along=select(vec2f(0,-1),along/max(al,1e-6),al>1e-6);let side=vec2f(-along.y,along.x);let q=corner(vi);
 let halfLen=max(al*.5,1.6/max(U.screen.y,1.0));let halfW=mix(.45,.82,h0)*2.0/max(U.screen.x,1.0);let ndc=cn+along*q.y*halfLen+side*q.x*halfW;
 o.p=vec4f(ndc*c.w,c.z,c.w);o.q=q;o.bright=mix(.65,1.0,h1);return o;}
@fragment fn fs(v:V)->@location(0)vec4f{let side=1.0-smoothstep(.18,1.0,abs(v.q.x));let tip=1.0-smoothstep(.62,1.0,abs(v.q.y));let a=side*tip*.32;let col=mix(vec3f(.60,.80,.92),vec3f(.94,.99,1.0),v.bright);return vec4f(col,a);}
`;
const rainMod=dev.createShaderModule({code:rainWGSL,label:'fluidV5M56RainWGSL'});
const rainPipe=await dev.createRenderPipelineAsync({label:'fluidV5M56Rain',layout:'auto',vertex:{module:rainMod,entryPoint:'vs'},fragment:{module:rainMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
const rainBG=dev.createBindGroup({layout:rainPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rainUni}}]});

// ----- Continuous waterfall sheet -----------------------------------------------------------
const fallUni=dev.createBuffer({label:'fluidV5M56FallUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const FF=new Float32Array(28);
const fallWGSL=`
struct F{vp:mat4x4f,box:vec4f,water:vec4f,style:vec4f}
@group(0)@binding(0)var<uniform>U:F;struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)foam:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{var o:V;let tri=i/6u,cx=tri%${FALL_COLS}u,cy=tri/${FALL_COLS}u,q=corner(i%6u);let u=(f32(cx)+q.x)/f32(${FALL_COLS}),t=(f32(cy)+q.y)/f32(${FALL_ROWS});
 let z=U.box.z*(.18+.64*u)+sin(u*21.0+U.box.w*4.4+t*7.0)*U.style.x*(.10+.90*t);let y=mix(U.box.y*.818,U.water.x+U.style.y,t);let x=U.box.x*.095+U.style.z*t+sin(t*12.0+u*8.0+U.box.w*5.2)*U.style.x*.55*t;
 let c=U.vp*vec4f(x,y,z,1);o.p=c;o.uv=vec2f(u,t);o.foam=t;return o;}
@fragment fn fs(v:V)->@location(0)vec4f{let flutter=.5+.5*sin(v.uv.x*47.0+v.uv.y*31.0+U.box.w*8.0)*sin(v.uv.x*19.0-v.uv.y*41.0-U.box.w*5.0);let breakup=smoothstep(.52,.98,v.uv.y);if(breakup>.15&&flutter<mix(.03,.42,breakup)){discard;}let edge=smoothstep(0,.055,v.uv.x)*smoothstep(0,.055,1.0-v.uv.x);let alpha=edge*mix(.29,.14,breakup)*mix(.72,1.0,flutter)*U.water.y;let foam=smoothstep(.70,1.0,v.uv.y);let col=mix(vec3f(.48,.78,.91),vec3f(.92,.99,1.0),.28+foam*.45+flutter*.12);return vec4f(col,alpha);}
`;
const fallMod=dev.createShaderModule({code:fallWGSL,label:'fluidV5M56FallWGSL'});
const fallPipe=await dev.createRenderPipelineAsync({label:'fluidV5M56Waterfall',layout:'auto',vertex:{module:fallMod,entryPoint:'vs'},fragment:{module:fallMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
const fallBG=dev.createBindGroup({layout:fallPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:fallUni}}]});

function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
const baseRender=ssfr.render;
ssfr.render=function(...args){
 const out=baseRender.apply(this,args),enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;if(!enc||!target||!view||!proj)return out;
 const vp=matMul(proj,view),b=sim.params.box,now=performance.now()*.001,pressure=window.__v5Workload?.pressure||0;
 if(state.scenario==='rainstorm'){
   RF.fill(0);RF.set(vp,0);RF[16]=b[0];RF[17]=b[1];RF[18]=b[2];RF[19]=now;RF[20]=waterTop();RF[21]=state.rainIntensity;RF[22]=.045;RF[23]=.012;RF[24]=w;RF[25]=h;RF[28]=sim.params.spacing*.30;RF[29]=sim.params.spacing*1.15;dev.queue.writeBuffer(rainUni,0,RF);
   const n=Math.max(240,Math.floor(RAIN_CAP*state.rainIntensity*(1-pressure*.62)));const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(rainPipe);p.setBindGroup(0,rainBG);p.draw(6,n);p.end();
 }
 if(state.scenario==='waterfall-m56'){
   FF.fill(0);FF.set(vp,0);FF[16]=b[0];FF[17]=b[1];FF[18]=b[2];FF[19]=now;FF[20]=waterTop();FF[21]=state.waterfallFlow*(1-pressure*.22);FF[24]=sim.params.spacing;FF[25]=sim.params.spacing*.18;FF[26]=b[0]*.10;dev.queue.writeBuffer(fallUni,0,FF);
   const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(fallPipe);p.setBindGroup(0,fallBG);p.draw(FALL_VERTS);p.end();
 }
 return out;
};

// ----- Hijack the existing scenario buttons without touching the older modules --------------
function bindButtons(){
 const rain=document.querySelector('[data-scenario="rain"]');if(rain&&!rain.dataset.m56){rain.dataset.m56='1';rain.onclick=e=>{e.preventDefault();e.stopPropagation();choose('rainstorm');};}
 const fall=document.querySelector('[data-m46="waterfall"]');if(fall&&!fall.dataset.m56){fall.dataset.m56='1';fall.onclick=e=>{e.preventDefault();e.stopPropagation();choose('waterfall-m56');};}
}
function syncButtons(){
 bindButtons();document.querySelectorAll('[data-scenario]').forEach(b=>b.classList.toggle('active',(state.scenario==='rainstorm'&&b.dataset.scenario==='rain')||b.dataset.scenario===state.scenario));
 document.querySelectorAll('[data-m46]').forEach(b=>{if(b.dataset.m46==='waterfall')b.classList.toggle('active',state.scenario==='waterfall-m56');});
}
setInterval(syncButtons,260);setTimeout(syncButtons,50);
window.__v5WeatherM56={online:true,backend:'micro-rain-sheet-waterfall-m56',rainVisual:RAIN_CAP,waterfallCells:FALL_ROWS*FALL_COLS};
console.info('[Fluid V5 M5.6] storm micro-rain + continuous breakup waterfall online.');
