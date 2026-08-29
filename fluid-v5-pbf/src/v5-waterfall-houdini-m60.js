// Fluid V5 M6.0 Houdini-style waterfall rendering.
// Architecture: real tagged PBF particles provide dynamics; a separate screen-space density surface
// reconstructs them into a coherent waterfall body; aerated whitewater is derived from density/fall;
// a lightweight mist/spray layer is composited at impact. This mirrors the production FLIP -> mesh
// -> whitewater -> mist workflow without changing PBF particle mass.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M6.0 waterfall renderer: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,TAG=window.__v5WaterfallTag||0x5746;
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const active=()=>String(state.scenario||'').startsWith('waterfall-m58');
if(!Number.isFinite(Number(state.waterfallBody)))state.waterfallBody=.90;
if(!Number.isFinite(Number(state.waterfallMist)))state.waterfallMist=.78;
state.waterfallBody=clamp(Number(state.waterfallBody),.35,1.25);
state.waterfallMist=clamp(Number(state.waterfallMist),0,1.35);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

function slabSurfaceY(){
 const b=sim.params.box,d=sim.params.spacing,margin=d;
 const nx=Math.max(1,Math.floor((b[0]-2*margin)/d));
 const nz=Math.max(1,Math.floor((b[2]-2*margin)/d));
 const baseFluid=Math.max(1,Number(sim.scene?.nFluid)||Math.max(1,sim.n-(sim.nBodyParts||0)-(window.__v5WaterfallM57?.target||0)));
 const layers=Math.max(1,Math.ceil(baseFluid/(nx*nz)));
 return clamp(margin+layers*d,d*2,b[1]-d*2);
}
function geom(){
 const b=sim.params.box,d=sim.params.spacing,flow=clamp(Number(state.waterfallFlow)||1,.45,1.55);
 const surface=slabSurfaceY();
 const topY=clamp(surface+Math.min(.79,b[1]*.315),surface+d*6,b[1]-d*2.5);
 const nozzleX=Math.max(d*1.65,b[0]*.038);
 const vx=.23+.085*flow,vy=-.055-.030*flow,g=Math.max(1,Number(sim.params.gravity)||9.81);
 const h=Math.max(0,topY-surface),fallT=(vy+Math.sqrt(Math.max(0,vy*vy+2*g*h)))/g;
 const impactX=nozzleX+vx*fallT;
 const width=Math.min(b[2]*.92,Math.max(d*14,b[2]*clamp(Number(state.waterfallWidth)||.78,.48,.92)));
 return {b,d,flow,surface,topY,nozzleX,vx,vy,g,fallT,impactX,width,centreZ:b[2]*.50};
}
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}

// --- Deterministic fixed-mass circulation -----------------------------------------------------
// Contact gives the pool one solve to absorb momentum; a lifetime watchdog guarantees circulation.
const cycleUni=dev.createBuffer({label:'fluidV5M60CycleUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const CF=new Float32Array(16),CU=new Uint32Array(CF.buffer);
const cycleWGSL=`
struct U{geo0:vec4f,geo1:vec4f,geo2:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read_write>P:array<vec4f>;
@group(0)@binding(2)var<storage,read_write>V:array<vec4f>;
@group(0)@binding(3)var<storage,read_write>phase:array<vec4u>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){
 let i=gid.x;if(i>=C.meta.x){return;}var ph=phase[i];if(ph.w!=C.meta.y){return;}
 if(C.meta.w==0u){phase[i]=vec4u(ph.x,ph.y,0u,0u);return;}
 let age=min(ph.z+C.meta.z,60000u);let p=P[i].xyz;let v=V[i].xyz;
 let contact=p.y<=C.geo2.y;let overshoot=p.x>=C.geo2.z;let timeout=f32(age)>=C.geo2.w;
 if(!(contact||overshoot||timeout)){phase[i]=vec4u(ph.x,ph.y,age,ph.w);return;}
 let base=select(i+1u,ph.y,ph.y!=0u);let s=base^(age*2246822519u)^(C.meta.x*3266489917u);
 let h0=hash1(s+17u);let h1=hash1(s+101u);let h2=hash1(s+313u);let h3=hash1(s+911u);
 let z=C.geo0.w+(h0-.5)*C.geo1.x*.985;
 let x=C.geo0.z+(h1-.5)*C.geo1.y*.10;
 let y=C.geo0.x-C.geo1.y*(.10+2.6*h2);
 P[i]=vec4f(x,y,z,1.0);
 V[i]=vec4f(C.geo1.z+(h2-.5)*.010,C.geo1.w-h1*.018,(h3-.5)*.018,0.0);
 phase[i]=vec4u(ph.x,ph.y,0u,ph.w);
}`;
const cycleMod=dev.createShaderModule({code:cycleWGSL,label:'fluidV5M60CycleWGSL'});
if(typeof cycleMod.getCompilationInfo==='function'){
 const info=await cycleMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
 if(errors.length)throw new Error('Fluid V5 M6.0 cycle WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const cyclePipe=await dev.createComputePipelineAsync({label:'fluidV5M60Cycle',layout:'auto',compute:{module:cycleMod,entryPoint:'main'}});
let cycleFrame=0;
function cycleAfterSolve(frameDt){
 if(!sim.n)return;const g=geom();const advanced=Math.max(0,Number(sim.lastAdvanced)||Number(frameDt)||0);const dtMs=Math.max(1,Math.min(100,Math.round(advanced*1000)));
 CF[0]=g.topY;CF[1]=g.surface;CF[2]=g.nozzleX;CF[3]=g.centreZ;
 CF[4]=g.width;CF[5]=g.d;CF[6]=g.vx;CF[7]=g.vy;
 CF[8]=g.impactX;CF[9]=g.surface+g.d*.22;CF[10]=g.impactX+g.d*.72;CF[11]=(g.fallT+.16)*1000;
 CU[12]=sim.n;CU[13]=TAG;CU[14]=dtMs;CU[15]=active()?1:0;
 dev.queue.writeBuffer(cycleUni,0,CF);
 const bg=dev.createBindGroup({layout:cyclePipe.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:cycleUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}
 ]});
 const enc=dev.createCommandEncoder({label:'fluidV5M60CycleEncoder'});const cp=enc.beginComputePass();cp.setPipeline(cyclePipe);cp.setBindGroup(0,bg);cp.dispatchWorkgroups(Math.max(1,Math.ceil(sim.n/256)));cp.end();dev.queue.submit([enc.finish()]);
 const s=window.__v5WaterfallM60;if(s){s.cycleFrame=++cycleFrame;s.maxAgeMs=CF[11];s.surfaceY=g.surface;}
}
const prevStep=sim.step.bind(sim);sim.step=function(frameDt){const out=prevStep(frameDt);try{cycleAfterSolve(frameDt);}catch(err){console.error('[Fluid V5 M6.0 waterfall cycle]',err);}return out;};

// --- Houdini-style screen-space particle-fluid surface ---------------------------------------
// PBF points are first splatted to a density/aeration field. The field is then reconstructed as one
// continuous body, rather than shading each solver particle as an individual droplet.
let surfTex=null,surfView=null,surfW=0,surfH=0;
function ensureSurface(w,h){
 const scale=quality==='low'?.42:quality==='high'?.62:.52;const nw=Math.max(96,Math.round(w*scale)),nh=Math.max(96,Math.round(h*scale));
 if(surfTex&&nw===surfW&&nh===surfH)return;surfTex?.destroy?.();surfW=nw;surfH=nh;surfTex=dev.createTexture({label:'fluidV5M60WaterfallField',size:[surfW,surfH],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});surfView=surfTex.createView();
}
const splatUni=dev.createBuffer({label:'fluidV5M60SplatUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const SF=new Float32Array(32),SU=new Uint32Array(SF.buffer);
const splatWGSL=`
struct U{vp:mat4x4f,screen:vec4f,geo:vec4f,tune:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var<storage,read>P:array<vec4f>;
@group(0)@binding(2)var<storage,read>V:array<vec4f>;
@group(0)@binding(3)var<storage,read>phase:array<vec4u>;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)fall:f32,@location(2)speed:f32,@location(3)seed:f32}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;if(ii>=C.meta.x||phase[ii].w!=C.meta.y){o.p=vec4f(2);o.q=vec2f(2);o.fall=0;o.speed=0;o.seed=0;return o;}
 let wp=P[ii].xyz;let vv=V[ii].xyz;let sp=length(vv);var dir=vec3f(0,-1,0);if(sp>.025){dir=vv/sp;}
 var side=vec3f(0,0,1);if(abs(dot(dir,side))>.92){side=vec3f(1,0,0);}
 let pc=C.vp*vec4f(wp,1);let pl=C.vp*vec4f(wp+dir*C.geo.z*(1.35+clamp(sp*.08,0.0,.65)),1);let ps=C.vp*vec4f(wp+side*C.geo.z*.72,1);
 if(pc.w<=1e-5||pl.w<=1e-5||ps.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.fall=0;o.speed=0;o.seed=0;return o;}
 let cn=pc.xy/pc.w;let ln=pl.xy/pl.w;let sn=ps.xy/ps.w;var along=ln-cn;let al=length(along);if(al>1e-6){along/=al;}else{along=vec2f(0,-1);}var normal=sn-cn;normal-=along*dot(normal,along);let nl=length(normal);if(nl>1e-6){normal/=nl;}else{normal=vec2f(-along.y,along.x);}
 let q=corner(vi);let px=vec2f(1.0/max(C.screen.x,1.0),1.0/max(C.screen.y,1.0));let halfW=max(length(sn-cn)*1.30,px.x*1.4);let halfL=max(length(ln-cn)*1.28,px.y*2.0);let ndc=cn+normal*q.x*halfW+along*q.y*halfL;
 o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.fall=clamp((C.geo.x-wp.y)/max(C.geo.x-C.geo.y,1e-4),0.0,1.0);o.speed=sp;o.seed=hash1(ii*977u+phase[ii].y);return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{
 let r2=dot(v.q,v.q);if(r2>1.0){discard;}let core=(1.0-r2);let w=core*core*(.16+.08*v.seed);let aer=clamp(.08+v.fall*.68+clamp(v.speed*.10,0.0,.30),0.0,1.0);return vec4f(w,w*aer,w*clamp(v.speed*.12,0.0,1.0),w);
}`;
const splatMod=dev.createShaderModule({code:splatWGSL,label:'fluidV5M60FieldSplatWGSL'});
if(typeof splatMod.getCompilationInfo==='function'){const info=await splatMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.0 field splat WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const splatPipe=await dev.createRenderPipelineAsync({label:'fluidV5M60FieldSplat',layout:'auto',vertex:{module:splatMod,entryPoint:'vs'},fragment:{module:splatMod,entryPoint:'fs',targets:[{format:'rgba8unorm',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const compUni=dev.createBuffer({label:'fluidV5M60CompositeUniform',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const PF=new Float32Array(8);
const compWGSL=`
struct U{screen:vec4f,tune:vec4f}
@group(0)@binding(0)var<uniform>C:U;
@group(0)@binding(1)var fieldTex:texture_2d<f32>;
struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.p=vec4f(p,0,1);o.uv=vec2f(p.x*.5+.5,.5-p.y*.5);return o;}
fn S(p:vec2i,dim:vec2i)->vec4f{return textureLoad(fieldTex,clamp(p,vec2i(0),dim-vec2i(1)),0);}
@fragment fn fs(v:V)->@location(0)vec4f{
 let dim=vec2i(textureDimensions(fieldTex,0));let p=vec2i(clamp(v.uv*vec2f(dim),vec2f(1),vec2f(dim)-vec2f(2)));
 let c=S(p,dim);let l=S(p+vec2i(-1,0),dim);let r=S(p+vec2i(1,0),dim);let u=S(p+vec2i(0,-1),dim);let d=S(p+vec2i(0,1),dim);
 let ul=S(p+vec2i(-1,-1),dim);let ur=S(p+vec2i(1,-1),dim);let dl=S(p+vec2i(-1,1),dim);let dr=S(p+vec2i(1,1),dim);
 let b=c*.30+(l+r+u+d)*.115+(ul+ur+dl+dr)*.06;let den=b.x;if(den<.012){discard;}
 let aer=clamp(b.y/max(den,.001),0.0,1.0);let speed=clamp(b.z/max(den,.001),0.0,1.0);let gx=r.x-l.x;let gy=d.x-u.x;let edge=clamp(length(vec2f(gx,gy))*4.5,0.0,1.0);
 let px=vec2f(p);let streak=.5+.5*sin(px.x*.19+sin(px.y*.053+C.screen.z*2.1)*2.4+C.screen.z*5.4);let fine=.5+.5*sin(px.x*.47+px.y*.083-C.screen.z*8.3);
 let body=smoothstep(.035,.24,den*C.tune.x);let white=clamp(.22+aer*.56+edge*.24+streak*.12+fine*.05+speed*.08,0.0,1.0);
 let water=vec3f(.13,.39,.52);let foam=vec3f(.94,.985,1.0);let col=mix(water,foam,white);let alpha=clamp(body*(.58+.28*aer+.10*edge)*C.tune.x,0.0,.94);return vec4f(col,alpha);
}`;
const compMod=dev.createShaderModule({code:compWGSL,label:'fluidV5M60CompositeWGSL'});
if(typeof compMod.getCompilationInfo==='function'){const info=await compMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.0 composite WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const compPipe=await dev.createRenderPipelineAsync({label:'fluidV5M60Composite',layout:'auto',vertex:{module:compMod,entryPoint:'vs'},fragment:{module:compMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

// --- Impact mist + fine spray ----------------------------------------------------------------
const MIST_CAP=quality==='low'?180:quality==='high'?720:420;
const mistUni=dev.createBuffer({label:'fluidV5M60MistUniform',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const MF=new Float32Array(32),MU=new Uint32Array(MF.buffer);
const mistWGSL=`
struct U{vp:mat4x4f,geo:vec4f,screen:vec4f,tune:vec4f,meta:vec4u}
@group(0)@binding(0)var<uniform>C:U;
struct O{@builtin(position)p:vec4f,@location(0)q:vec2f,@location(1)a:f32,@location(2)kind:f32}
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}
fn corner(i:u32)->vec2f{let a=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return a[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->O{
 var o:O;if(C.meta.y==0u){o.p=vec4f(2);o.q=vec2f(2);o.a=0;o.kind=0;return o;}let h0=hash1(ii*9187u+17u);let h1=hash1(ii*6151u+89u);let h2=hash1(ii*3761u+227u);let h3=hash1(ii*1597u+601u);let kind=step(.72,h3);let life=fract(h2+C.tune.x*mix(.21,.52,kind));let spread=C.geo.z*mix(.42,.64,kind);let x=C.geo.x+(h0-.5)*C.geo.w*.15+mix(.03,.16,kind)*life;let z=C.geo.y+(h1-.5)*spread;let y=C.geo.w+mix(.02,.30,kind)*life-mix(.01,.16,kind)*life*life;let wp=vec3f(x,y,z);let pc=C.vp*vec4f(wp,1);if(pc.w<=1e-5){o.p=vec4f(2);o.q=vec2f(2);o.a=0;o.kind=kind;return o;}let q=corner(vi);let px=mix(1.4,1.0,kind)*2.0/max(C.screen.x,1.0);let py=mix(1.4,3.1,kind)*2.0/max(C.screen.y,1.0);let ndc=pc.xy/pc.w+q*vec2f(px,py);o.p=vec4f(ndc*pc.w,pc.z,pc.w);o.q=q;o.a=(1.0-life)*C.tune.y;o.kind=kind;return o;
}
@fragment fn fs(v:O)->@location(0)vec4f{let r=length(v.q);if(r>1){discard;}let soft=1.0-smoothstep(.10,1.0,r);let a=soft*v.a*mix(.055,.22,v.kind);let col=mix(vec3f(.82,.92,.96),vec3f(.96,1.0,1.0),v.kind);return vec4f(col,a);}
}`;
const mistMod=dev.createShaderModule({code:mistWGSL,label:'fluidV5M60MistWGSL'});
if(typeof mistMod.getCompilationInfo==='function'){const info=await mistMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('Fluid V5 M6.0 mist WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const mistPipe=await dev.createRenderPipelineAsync({label:'fluidV5M60Mist',layout:'auto',vertex:{module:mistMod,entryPoint:'vs'},fragment:{module:mistMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});

const baseRender=ssfr.render;
ssfr.render=function(...args){
 const enc=args[0],target=args[1],view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;
 if(!enc||!target||!view||!proj)return baseRender.apply(this,args);
 ensureSurface(w,h);const g=geom();
 SF.set(matMul(proj,view),0);SF[16]=surfW;SF[17]=surfH;SF[18]=0;SF[19]=0;SF[20]=g.topY;SF[21]=g.surface;SF[22]=g.d;SF[23]=g.width;SF[24]=state.waterfallBody;SF[25]=performance.now()*.001;SF[26]=0;SF[27]=0;SU[28]=sim.n;SU[29]=TAG;SU[30]=active()?1:0;SU[31]=0;dev.queue.writeBuffer(splatUni,0,SF);
 const sbg=dev.createBindGroup({layout:splatPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:splatUni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.liveBody()}}]});
 const fp=enc.beginRenderPass({colorAttachments:[{view:surfView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});fp.setPipeline(splatPipe);fp.setBindGroup(0,sbg);fp.draw(6,sim.n);fp.end();
 const out=baseRender.apply(this,args);
 if(!active()||ui?.paused||window.__v5DebugMode!=='final')return out;
 PF[0]=surfW;PF[1]=surfH;PF[2]=performance.now()*.001;PF[3]=0;PF[4]=state.waterfallBody;PF[5]=0;PF[6]=0;PF[7]=0;dev.queue.writeBuffer(compUni,0,PF);
 const cbg=dev.createBindGroup({layout:compPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:compUni}},{binding:1,resource:surfView}]});
 let pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(compPipe);pass.setBindGroup(0,cbg);pass.draw(3);pass.end();
 MF.set(matMul(proj,view),0);MF[16]=g.impactX;MF[17]=g.centreZ;MF[18]=g.width;MF[19]=g.surface;MF[20]=w;MF[21]=h;MF[22]=0;MF[23]=0;MF[24]=performance.now()*.001;MF[25]=state.waterfallMist;MF[26]=g.flow;MF[27]=0;MU[28]=MIST_CAP;MU[29]=1;MU[30]=0;MU[31]=0;dev.queue.writeBuffer(mistUni,0,MF);
 const mbg=dev.createBindGroup({layout:mistPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:mistUni}}]});pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(mistPipe);pass.setBindGroup(0,mbg);pass.draw(6,MIST_CAP);pass.end();
 return out;
};

function mount(){
 const host=document.querySelector('[data-panel="scenes"]')||document.getElementById('settingsPanel');if(!host||document.getElementById('v5WaterfallM60UI'))return;
 const d=document.createElement('div');d.id='v5WaterfallM60UI';d.style.cssText='margin-top:8px;padding:9px;border:1px solid rgba(78,214,220,.18);border-radius:10px;background:rgba(4,17,24,.58)';d.innerHTML=`<div style="font:800 9px ui-monospace;color:#9dffc8;letter-spacing:.10em">HOUDINI-STYLE WATERFALL · M6.0</div><div style="font:7.4px/1.45 ui-monospace;color:#86a8b5;margin:5px 0 7px">Real PBF dynamics are reconstructed into a continuous density surface, then layered with aerated whitewater, motion streaking and impact mist instead of exposing solver-sized droplets.</div><div class="v5Slider"><label>WATERFALL BODY</label><input data-k="waterfallBody" type="range" min="0.35" max="1.25" step="0.05"><div class="v5Val"></div></div><div class="v5Slider"><label>IMPACT MIST</label><input data-k="waterfallMist" type="range" min="0" max="1.35" step="0.05"><div class="v5Val"></div></div>`;host.appendChild(d);d.onpointerdown=e=>e.stopPropagation();d.querySelectorAll('input').forEach(r=>{const k=r.dataset.k,v=r.nextElementSibling;r.value=state[k];const sync=()=>v.textContent=Number(state[k]).toFixed(2);sync();r.oninput=e=>{e.stopPropagation();state[k]=Number(r.value);save();sync();};});
}
setInterval(mount,650);mount();
window.__v5WaterfallM60={online:true,backend:'pbf-density-surface-whitewater-mist-m60',cycleFrame:0,maxAgeMs:0,surfaceY:0,densitySurface:true,mist:true};
setTimeout(()=>{const brand=document.querySelector('.hud.card.title');if(brand)brand.textContent='FLUID V5 · M6.0';document.title='Fluid V5 · M6.0 HOUDINI WATERFALL';window.__fluidV5Version='5.4.0-m60';},1000);
console.info('[Fluid V5 M6.0] Houdini-style PBF density surface + whitewater + mist waterfall online.');