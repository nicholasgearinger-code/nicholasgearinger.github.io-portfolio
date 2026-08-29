// Fluid V5 M6.6 resampled Houdini-style waterfall surface.
// The PBF stream is intentionally low resolution and hidden from normal SSFR. This renderer samples
// the same source geometry/ballistic trajectory at a much finer visual resolution, analogous to
// FLIP -> surface reconstruction -> whitewater. No solver-sized waterfall parcel is drawn directly.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.6 waterfall renderer: runtime unavailable.');
const dev=sim.dev,format=ssfr.format;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const COLS=q==='low'?16:q==='high'?30:22;
const ROWS=q==='low'?30:q==='high'?58:44;
const BODY_VERTS=(COLS-1)*(ROWS-1)*6;
const MIST_CAP=q==='low'?140:q==='high'?520:300;
const active=()=>state.scenario==='waterfall-m62';
if(!Number.isFinite(Number(state.waterfallBody)))state.waterfallBody=.90;
if(!Number.isFinite(Number(state.waterfallMist)))state.waterfallMist=.68;
state.waterfallBody=clamp(Number(state.waterfallBody),.25,1.25);
state.waterfallMist=clamp(Number(state.waterfallMist),0,1.25);

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const layers=Math.max(1,Math.ceil((sim.scene?.nFluid||sim.n)/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55),surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.74,b[1]*.295),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.55,b[0]*.036),vx=.225+.075*flow,vy=-.085-.025*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface),fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const requested=b[2]*clamp(Number(state.waterfallWidth)||.78,.48,.92);
 const width=clamp(requested,b[2]*.46,b[2]*.88);
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width,centreZ:b[2]*.5};
}
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}

const bodyUni=dev.createBuffer({label:'fluidV5M66BodyUniform',size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const BF=new Float32Array(36),BU=new Uint32Array(BF.buffer);
const bodyWGSL=`
struct U{vp:mat4x4f,geo0:vec4f,geo1:vec4f,style:vec4f,screen:vec4f,dims:vec4u}
@group(0)@binding(0)var<uniform>C:U;
struct O{@builtin(position)p:vec4f,@location(0)uv:vec2f,@location(1)n:f32,@location(2)fall:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));return a[i];}
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)inst:u32)->O{
 var o:O;let cols=max(C.dims.x,2u);let rows=max(C.dims.y,2u);let q=corner(vi%6u);let cell=vi/6u;let cx=cell%(cols-1u);let cy=cell/(cols-1u);
 let u=(f32(cx)+q.x)/f32(cols-1u);let t=(f32(cy)+q.y)/f32(rows-1u);
 let surface=C.geo0.x;let topY=C.geo0.y;let nozzleX=C.geo0.z;let centreZ=C.geo0.w;let width=C.geo1.x;let spacing=C.geo1.y;let vx=C.geo1.z;let vy=C.geo1.w;let gravity=max(C.style.x,.01);let time=C.style.y;
 let y=mix(topY,surface+spacing*.10,t);let drop=max(topY-y,0.0);let ft=(vy+sqrt(max(vy*vy+2.0*gravity*drop,0.0)))/gravity;
 let lower=smoothstep(.28,1.0,t);let breakZone=smoothstep(.68,1.0,t);
 let taper=mix(1.0,.84,t);let band=sin(u*43.0+time*2.1+sin(t*9.0-time*.63)*1.35);let broad=sin(u*10.5+t*6.4+time*.72);let fine=sin(u*91.0-t*12.0+time*3.3);
 var x=nozzleX+vx*ft;var z=centreZ+(u-.5)*width*taper;
 z+=spacing*(broad*.16+band*.065)*lower;
 x+=spacing*(sin(t*15.0+u*11.0+time*.85)*.10+broad*.055)*lower;
 x+=(f32(inst)-.5)*spacing*.055;
 // Mild ribbon breakup near impact, never enough to destroy the continuous primary sheet.
 z+=spacing*fine*.055*breakZone;
 let pc=C.vp*vec4f(x,y,z,1.0);o.p=pc;o.uv=vec2f(u,t);o.n=.5+.5*(band*.58+broad*.30+fine*.12);o.fall=t;return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let u=v.uv.x;let t=v.uv.y;let edge=smoothstep(0.0,.075,u)*smoothstep(0.0,.075,1.0-u);
 let streakA=pow(.5+.5*sin(u*71.0+t*8.0+C.style.y*2.6+v.n*2.0),5.0);
 let streakB=pow(.5+.5*sin(u*29.0-t*15.0-C.style.y*1.35),7.0);
 let breakup=smoothstep(.62,1.0,t);let aer=clamp(.12+breakup*.52+streakA*.28+streakB*.18,0.0,1.0);
 let water=vec3f(.075,.30,.43);let clear=vec3f(.34,.68,.80);let foam=vec3f(.94,.985,1.0);
 var col=mix(water,clear,.46+streakB*.16);col=mix(col,foam,aer*.58);
 let density=.34+streakA*.15+streakB*.09+breakup*.12;let alpha=edge*density*C.style.z;
 // Preserve thin transparent edges and a denser aerated lower core.
 alpha*=mix(.82,1.12,breakup);if(alpha<.018){discard;}return vec4f(col,clamp(alpha,0.0,.78));
}`;
const bodyMod=dev.createShaderModule({code:bodyWGSL,label:'fluidV5M66BodyWGSL'});
if(typeof bodyMod.getCompilationInfo==='function'){const info=await bodyMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.6 body WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const bodyPipe=await dev.createRenderPipelineAsync({label:'fluidV5M66ResampledCurtain',layout:'auto',vertex:{module:bodyMod,entryPoint:'vs'},fragment:{module:bodyMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const mistUni=dev.createBuffer({label:'fluidV5M66MistUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const MF=new Float32Array(28),MU=new Uint32Array(MF.buffer);
const mistWGSL=`
struct U{vp:mat4x4f,geo:vec4f,screen:vec4f,tune:vec4f,mdata:vec4u}
@group(0)@binding(0)var<uniform>C:U;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)a:f32}
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;let h0=hash1(ii*9187u+17u);let h1=hash1(ii*6151u+89u);let h2=hash1(ii*3761u+227u);let life=fract(h2+C.tune.x*(.23+.27*h0));let x=C.geo.x+(h0-.5)*C.geo.w*.18+.10*life;let z=C.geo.y+(h1-.5)*C.geo.z*.78;let y=C.screen.z+.015+.24*life-.15*life*life;let pc=C.vp*vec4f(x,y,z,1);if(pc.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.a=0;return o;}let q=corner(vi);let px=1.15*2.0/max(C.screen.x,1.0);let py=2.2*2.0/max(C.screen.y,1.0);let ndc=pc.xy/pc.w+q*vec2f(px,py);o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.a=(1.0-life)*C.tune.y;return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{let r=length(v.q);if(r>1){discard;}let a=(1.0-smoothstep(.08,1.0,r))*v.a*.16;return vec4f(vec3f(.91,.97,1.0),a);}
}`;
const mistMod=dev.createShaderModule({code:mistWGSL,label:'fluidV5M66MistWGSL'});
if(typeof mistMod.getCompilationInfo==='function'){const info=await mistMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.6 mist WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const mistPipe=await dev.createRenderPipelineAsync({label:'fluidV5M66ImpactMist',layout:'auto',vertex:{module:mistMod,entryPoint:'vs'},fragment:{module:mistMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const out=baseRender.apply(this,args);const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 if(!active()||ui?.paused||window.__v5DebugMode!=='final'||!enc||!target||!view||!proj)return out;
 const g=geom(),now=performance.now()*.001;
 BF.set(matMul(proj,view),0);BF[16]=g.surface;BF[17]=g.topY;BF[18]=g.nozzleX;BF[19]=g.centreZ;BF[20]=g.width;BF[21]=g.d;BF[22]=g.vx;BF[23]=g.vy;BF[24]=g.g;BF[25]=now;BF[26]=state.waterfallBody;BF[27]=g.flow;BF[28]=w;BF[29]=h;BF[30]=g.impactX;BF[31]=g.fallT;BU[32]=COLS;BU[33]=ROWS;BU[34]=2;BU[35]=0;dev.queue.writeBuffer(bodyUni,0,BF);
 const bbg=dev.createBindGroup({layout:bodyPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:bodyUni}}]});let pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(bodyPipe);pass.setBindGroup(0,bbg);pass.draw(BODY_VERTS,2);pass.end();
 MF.set(matMul(proj,view),0);MF[16]=g.impactX;MF[17]=g.centreZ;MF[18]=g.width;MF[19]=0;MF[20]=w;MF[21]=h;MF[22]=g.surface;MF[23]=0;MF[24]=now;MF[25]=state.waterfallMist;MF[26]=g.flow;MF[27]=0;dev.queue.writeBuffer(mistUni,0,MF);const mbg=dev.createBindGroup({layout:mistPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:mistUni}}]});pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(mistPipe);pass.setBindGroup(0,mbg);pass.draw(6,MIST_CAP);pass.end();
 const S=window.__v5WaterfallM66;if(S){S.frames++;S.surfaceY=g.surface;S.impactX=g.impactX;S.width=g.width;}
 return out;
};

function mount(){const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM66UI'))return;const d=document.createElement('div');d.id='v5WaterfallM66UI';d.style.cssText='margin-top:9px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">RESAMPLED WATERFALL · M6.6</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Houdini-style separation: hidden PBF parcels carry real momentum into the pool while a dense ballistic surface reconstructs the visible curtain. Solver-sized waterfall particles are never the final image.</div>`;host.appendChild(d);}
setInterval(mount,650);mount();
window.__v5WaterfallM60={online:true,backend:'resampled-ballistic-curtain-m66',densitySurface:false,mist:true,resampled:true};
window.__v5WaterfallM66={online:true,backend:'resampled-ballistic-curtain-m66',frames:0,surfaceY:0,impactX:0,width:0,cols:COLS,rows:ROWS,mist:MIST_CAP};
console.info('[Fluid V5 M6.6] resampled ballistic waterfall body + impact mist online.');
