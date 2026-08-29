// Fluid V5 M6.6 physically coupled resampled waterfall surface.
// The PBF stream is the real momentum carrier. This renderer reconstructs that coarse carrier as a
// fine ballistic curtain that reaches into the plunge pool, breaks into irregular vertical ribbons,
// aerates toward impact, and hides the solver-scale transition with physical whitewater and mist.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.6 waterfall renderer: runtime unavailable.');

const dev=sim.dev,format=ssfr.format;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';

const COLS=quality==='low'?24:quality==='high'?50:36;
const ROWS=quality==='low'?48:quality==='high'?96:72;
const BODY_VERTS=(COLS-1)*(ROWS-1)*6;
const BODY_INSTANCES=quality==='low'?6:quality==='high'?14:9;
const MIST_CAP=quality==='low'?380:quality==='high'?1500:900;

const active=()=>state.scenario==='waterfall-m62';

if(!Number.isFinite(Number(state.waterfallBody)))state.waterfallBody=.92;
if(!Number.isFinite(Number(state.waterfallMist)))state.waterfallMist=.84;
state.waterfallBody=clamp(Number(state.waterfallBody),.25,1.35);
state.waterfallMist=clamp(Number(state.waterfallMist),0,1.35);

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const layers=Math.max(1,Math.ceil((sim.scene?.nFluid||sim.n)/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}

function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55),surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.88,b[1]*.335),surface+d*7,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.20,b[0]*.022);
 const vx=.155+.045*flow;
 const vy=-.025-.015*flow;
 const g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface);
 const fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const requested=b[2]*clamp(Number(state.waterfallWidth)||.94,.70,.985);
 const width=clamp(requested,b[2]*.60,b[2]*.965);
 return{b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width,centreZ:b[2]*.5};
}

function matMul(a,b){
 const o=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){
  let s=0;
  for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];
  o[c*4+r]=s;
 }
 return o;
}

const bodyUni=dev.createBuffer({label:'fluidV5M66BodyUniform',size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const BF=new Float32Array(36),BU=new Uint32Array(BF.buffer);

const bodyWGSL=`
struct U {
  vp: mat4x4<f32>,
  geo0: vec4<f32>,
  geo1: vec4<f32>,
  style: vec4<f32>,
  screen: vec4<f32>,
  dims: vec4<u32>,
}

@group(0) @binding(0)
var<uniform> C: U;

struct O {
  @builtin(position) p: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) bandA: f32,
  @location(2) bandB: f32,
  @location(3) centerA: f32,
  @location(4) breakupA: f32,
  @location(5) lowerA: f32,
}

fn corner(i: u32) -> vec2<f32> {
  let a=array<vec2<f32>,6>(
    vec2<f32>(0.0,0.0), vec2<f32>(1.0,0.0), vec2<f32>(0.0,1.0),
    vec2<f32>(0.0,1.0), vec2<f32>(1.0,0.0), vec2<f32>(1.0,1.0)
  );
  return a[i];
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> O {
  var o: O;
  let cols=max(C.dims.x,2u);
  let rows=max(C.dims.y,2u);
  let q=corner(vi%6u);
  let cell=vi/6u;
  let cx=cell%(cols-1u);
  let cy=cell/(cols-1u);
  let u=(f32(cx)+q.x)/f32(cols-1u);
  let t=(f32(cy)+q.y)/f32(rows-1u);

  let surface=C.geo0.x;
  let topY=C.geo0.y;
  let nozzleX=C.geo0.z;
  let centreZ=C.geo0.w;
  let width=C.geo1.x;
  let spacing=C.geo1.y;
  let vx=C.geo1.z;
  let vy=C.geo1.w;
  let gravity=max(C.style.x,0.01);
  let time=C.style.y;

  let lipA=sin(u*5.3+time*0.17);
  let lipB=sin(u*13.1-time*0.29);
  let lipC=sin(u*27.7+time*0.11);
  let lip=lipA*0.52+lipB*0.31+lipC*0.17;

  let contactY=surface-spacing*0.72;
  let topOffset=spacing*0.34*lip;
  let y=mix(topY+topOffset,contactY,t);
  let drop=max(topY-y,0.0);
  let ft=(vy+sqrt(max(vy*vy+2.0*gravity*drop,0.0)))/gravity;

  let lower=smoothstep(0.22,1.0,t);
  let breakup=smoothstep(0.42,1.0,t);
  let heavy=smoothstep(0.62,1.0,t);
  let center=1.0-abs(u*2.0-1.0);

  let flowA=sin(u*7.4+time*0.21);
  let flowB=sin(u*16.8-time*0.19+sin(u*4.1)*0.7);
  let flowC=sin(u*34.5-t*4.8-time*0.47);
  let flowD=sin(u*73.0-t*11.5+time*1.31);
  let columnRaw=0.50+0.50*(flowA*0.44+flowB*0.31+flowC*0.18+flowD*0.07);
  let strandBias=pow(clamp(columnRaw,0.0,1.0),1.45);

  let layerCount=f32(max(C.dims.z,1u));
  var layerN=0.0;
  if(layerCount>1.0){layerN=f32(inst)/(layerCount-1.0)-0.5;}

  var x=nozzleX+vx*ft;
  x+=spacing*(0.035*flowA+0.026*flowC)*lower;
  x+=layerN*spacing*(0.46+0.82*breakup);
  x+=spacing*0.10*heavy*flowD;

  var localWidth=width*mix(1.00,0.87,t);
  localWidth*=mix(0.94,1.04,strandBias);
  var z=centreZ+(u-0.5)*localWidth;
  z+=spacing*lip*0.28*(1.0-t);
  z+=spacing*flowA*0.38*lower;
  z+=spacing*flowB*0.28*lower;
  z+=spacing*flowC*0.18*breakup;
  z+=spacing*flowD*0.08*heavy;
  z+=layerN*spacing*(0.10+0.34*center+0.22*heavy);
  z+=sign(u-0.5)*spacing*(1.0-center)*(0.08+0.16*breakup)*flowC;

  let pc=C.vp*vec4<f32>(x,y,z,1.0);
  o.p=pc;
  o.uv=vec2<f32>(u,t);
  o.bandA=strandBias;
  o.bandB=0.5+0.5*(flowC*0.63+flowD*0.37);
  o.centerA=center;
  o.breakupA=breakup;
  o.lowerA=lower;
  return o;
}

@fragment
fn fs(v: O) -> @location(0) vec4<f32> {
  let u=v.uv.x;
  let t=v.uv.y;
  let breakup=v.breakupA;
  let lower=v.lowerA;
  let heavy=smoothstep(0.62,1.0,t);

  let leftEdge=0.022+0.020*(0.5+0.5*sin(t*9.0+v.bandA*3.1));
  let rightEdge=0.022+0.018*(0.5+0.5*sin(t*7.0+v.bandB*4.2));
  let edge=smoothstep(0.0,leftEdge,u)*smoothstep(0.0,rightEdge,1.0-u);

  let broad=0.5+0.5*sin(u*15.7+sin(t*2.8)*0.8+v.bandA*2.4);
  let mid=0.5+0.5*sin(u*39.1-t*2.3+v.bandB*5.1);
  let fine=0.5+0.5*sin(u*91.3-t*9.7+v.bandA*4.6);
  let filament=pow(clamp(broad*0.47+mid*0.36+fine*0.17,0.0,1.0),1.35);
  let ribbonGate=smoothstep(0.23,0.58,filament+0.16*v.bandA);
  let broken=mix(1.0,mix(0.16,1.0,ribbonGate),smoothstep(0.24,0.88,t));

  let verticalA=pow(0.5+0.5*sin(u*24.0+v.bandA*1.7),2.1);
  let verticalB=pow(0.5+0.5*sin(u*53.0-t*2.0+v.bandB*3.7),3.0);
  let aeration=clamp(0.14+0.34*verticalA+0.34*verticalB+0.58*heavy,0.0,1.0);

  let deep=vec3<f32>(0.10,0.27,0.34);
  let clear=vec3<f32>(0.46,0.66,0.72);
  let milky=vec3<f32>(0.79,0.87,0.90);
  let foam=vec3<f32>(0.97,0.985,0.99);
  var col=mix(deep,clear,0.22+0.18*v.centerA+0.18*verticalA);
  col=mix(col,milky,0.18+0.42*aeration+0.18*lower);
  col=mix(col,foam,0.10+0.55*heavy+0.18*verticalB);

  let densityUpper=0.07+0.09*v.centerA+0.10*verticalA;
  let densityMid=0.08+0.12*verticalB+0.08*lower;
  let densityLower=0.10+0.18*heavy+0.08*filament;
  var alpha=edge*(densityUpper+densityMid+densityLower)*C.style.z;
  alpha*=mix(0.76,1.42,breakup);
  alpha*=broken;
  alpha*=mix(0.86,1.18,v.bandA);

  if(alpha<0.012){discard;}
  return vec4<f32>(col,clamp(alpha,0.0,0.94));
}
`;

const bodyMod=dev.createShaderModule({code:bodyWGSL,label:'fluidV5M66BodyWGSL'});
if(typeof bodyMod.getCompilationInfo==='function'){
 const info=await bodyMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.6 body WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const bodyPipe=await dev.createRenderPipelineAsync({label:'fluidV5M66BallisticCurtain',layout:'auto',vertex:{module:bodyMod,entryPoint:'vs'},fragment:{module:bodyMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const mistUni=dev.createBuffer({label:'fluidV5M66MistUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const MF=new Float32Array(32),MU=new Uint32Array(MF.buffer);
const mistWGSL=`
struct U {vp:mat4x4<f32>,geo:vec4<f32>,screen:vec4<f32>,tune:vec4<f32>,mdata:vec4<u32>}
@group(0) @binding(0)var<uniform>C:U;
struct O{@builtin(position)p:vec4<f32>,@location(0)q:vec2<f32>,@location(1)a:f32}
fn hash1(x0:u32)->f32{var x:u32=x0;x=x^(x>>16u);x=x*0x7feb352du;x=x^(x>>15u);x=x*0x846ca68bu;x=x^(x>>16u);return f32(x)/4294967295.0;}
fn corner(i:u32)->vec2<f32>{let a=array<vec2<f32>,6>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(1.0,1.0));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;let h0=hash1(ii*9187u+17u);let h1=hash1(ii*6151u+89u);let h2=hash1(ii*3761u+227u);
 let life=fract(h2+C.tune.x*(0.14+0.28*h0));let plume=1.0-(1.0-life)*(1.0-life);let spacing=max(C.geo.w,0.001);
 let spreadZ=C.geo.z*(0.28+0.64*plume);let spreadX=spacing*(1.1+4.2*plume);
 let x=C.geo.x+(h0-0.5)*spreadX+spacing*1.2*life;let z=C.geo.y+(h1-0.5)*spreadZ;
 let y=C.screen.z+spacing*(0.08+0.18*h0)+spacing*(1.0+4.8*h1)*plume-spacing*1.5*life*life;
 let pc=C.vp*vec4<f32>(x,y,z,1.0);if(pc.w<=0.00001){o.p=vec4<f32>(2.0);o.q=vec2<f32>(2.0);o.a=0.0;return o;}
 let q=corner(vi);let sx=(2.0+3.4*h0+3.8*plume)*2.0/max(C.screen.x,1.0);let sy=(2.2+4.0*h1+3.2*plume)*2.0/max(C.screen.y,1.0);
 let ndc=pc.xy/pc.w+q*vec2<f32>(sx,sy);o.p=vec4<f32>(ndc*pc.w,pc.z,pc.w);o.q=q;o.a=(1.0-life)*C.tune.y;return o;
}
@fragment fn fs(v:O)->@location(0)vec4<f32>{let r=length(v.q);if(r>1.0){discard;}let a=(1.0-smoothstep(0.05,1.0,r))*v.a*0.24;return vec4<f32>(0.95,0.975,0.985,a);}
`;
const mistMod=dev.createShaderModule({code:mistWGSL,label:'fluidV5M66MistWGSL'});
if(typeof mistMod.getCompilationInfo==='function'){
 const info=await mistMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.6 mist WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const mistPipe=await dev.createRenderPipelineAsync({label:'fluidV5M66ImpactMist',layout:'auto',vertex:{module:mistMod,entryPoint:'vs'},fragment:{module:mistMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const foamUni=dev.createBuffer({label:'fluidV5M66FoamUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const FF=new Float32Array(32),FU=new Uint32Array(FF.buffer);
const foamWGSL=`
struct U{vp:mat4x4<f32>,geo:vec4<f32>,tune0:vec4<f32>,tune1:vec4<f32>,udata:vec4<u32>}
@group(0) @binding(0)var<uniform>C:U;
struct O{@builtin(position)p:vec4<f32>,@location(0)uv:vec2<f32>,@location(1)n:f32}
fn corner(i:u32)->vec2<f32>{let a=array<vec2<f32>,6>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(1.0,1.0));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32)->O{var o:O;let q=corner(vi);let px=C.geo.x+q.x*C.geo.w;let pz=C.geo.z+q.y*C.tune0.x;let pc=C.vp*vec4<f32>(px,C.geo.y,pz,1.0);o.p=pc;o.uv=q;o.n=0.5+0.5*sin((q.x+1.0)*4.7+C.tune0.y*1.6);return o;}
@fragment fn fs(v:O)->@location(0)vec4<f32>{let rr=v.uv*vec2<f32>(1.0,0.70);let r=length(rr);let wobble=0.04*sin(atan2(rr.y,rr.x)*7.0+C.tune0.y*1.8)+0.025*sin(v.uv.x*12.0-C.tune0.y*1.1);let core=1.0-smoothstep(0.08,0.62+wobble,r);let ring=smoothstep(0.28,0.56,r)*(1.0-smoothstep(0.68,1.06+wobble,r));let foam=max(core*0.74,ring*(0.34+0.20*v.n));let col=mix(vec3<f32>(0.76,0.86,0.89),vec3<f32>(0.985,0.99,0.99),foam);let a=foam*C.tune0.z*0.46;if(a<0.008){discard;}return vec4<f32>(col,a);}
`;
const foamMod=dev.createShaderModule({code:foamWGSL,label:'fluidV5M66FoamWGSL'});
if(typeof foamMod.getCompilationInfo==='function'){
 const info=await foamMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.6 foam WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const foamPipe=await dev.createRenderPipelineAsync({label:'fluidV5M66ImpactFoam',layout:'auto',vertex:{module:foamMod,entryPoint:'vs'},fragment:{module:foamMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const out=baseRender.apply(this,args);
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 if(!active()||ui?.paused||window.__v5DebugMode!=='final'||!enc||!target||!view||!proj)return out;
 const g=geom(),now=performance.now()*.001;

 BF.set(matMul(proj,view),0);BF[16]=g.surface;BF[17]=g.topY;BF[18]=g.nozzleX;BF[19]=g.centreZ;BF[20]=g.width;BF[21]=g.d;BF[22]=g.vx;BF[23]=g.vy;BF[24]=g.g;BF[25]=now;BF[26]=state.waterfallBody;BF[27]=g.flow;BF[28]=w;BF[29]=h;BF[30]=g.impactX;BF[31]=g.fallT;BU[32]=COLS;BU[33]=ROWS;BU[34]=BODY_INSTANCES;BU[35]=0;dev.queue.writeBuffer(bodyUni,0,BF);
 const bbg=dev.createBindGroup({layout:bodyPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:bodyUni}}]});
 let pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(bodyPipe);pass.setBindGroup(0,bbg);pass.draw(BODY_VERTS,BODY_INSTANCES);pass.end();

 MF.set(matMul(proj,view),0);MF[16]=g.impactX;MF[17]=g.centreZ;MF[18]=g.width;MF[19]=g.d;MF[20]=w;MF[21]=h;MF[22]=g.surface;MF[23]=0;MF[24]=now;MF[25]=state.waterfallMist;MF[26]=g.flow;MF[27]=0;dev.queue.writeBuffer(mistUni,0,MF);
 const mbg=dev.createBindGroup({layout:mistPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:mistUni}}]});pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(mistPipe);pass.setBindGroup(0,mbg);pass.draw(6,MIST_CAP);pass.end();

 FF.set(matMul(proj,view),0);FF[16]=g.impactX+g.d*0.35;FF[17]=g.surface+g.d*0.035;FF[18]=g.centreZ;FF[19]=Math.max(g.d*2.3,g.width*0.15);FF[20]=Math.max(g.d*3.2,g.width*0.24);FF[21]=now;FF[22]=state.waterfallMist;FF[23]=g.flow;dev.queue.writeBuffer(foamUni,0,FF);
 const fbg=dev.createBindGroup({layout:foamPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:foamUni}}]});pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(foamPipe);pass.setBindGroup(0,fbg);pass.draw(6,1);pass.end();

 const S=window.__v5WaterfallM66;if(S){S.frames++;S.surfaceY=g.surface;S.impactX=g.impactX;S.width=g.width;S.forwardArc=g.impactX-g.nozzleX;S.contactsPool=true;}
 return out;
};

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM66UI'))return;
 const d=document.createElement('div');d.id='v5WaterfallM66UI';d.style.cssText='margin-top:9px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';
 d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">BALLISTIC WATERFALL · M6.6</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin-top:5px">Forward ballistic spill, irregular ribbon breakup, submerged visual contact, broad plunge mist, and PBF-driven impact whitewater. The coarse physical carrier and fine visible curtain share the same trajectory.</div>`;host.appendChild(d);
}
setInterval(mount,650);mount();
window.__v5WaterfallM60={online:true,backend:'ballistic-contact-curtain-m66',densitySurface:false,mist:true,resampled:true,foam:true,contactsPool:true};
window.__v5WaterfallM66={online:true,backend:'ballistic-contact-curtain-m66',frames:0,surfaceY:0,impactX:0,width:0,forwardArc:0,contactsPool:true,cols:COLS,rows:ROWS,layers:BODY_INSTANCES,mist:MIST_CAP,foam:true};
console.info('[Fluid V5 M6.6] ballistic contact waterfall + physical plunge coupling online.');
