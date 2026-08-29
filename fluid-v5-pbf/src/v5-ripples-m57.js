// Fluid V5 M5.7 global propagating ripple layer.
// Fine-scale ripple packets are seeded from real interaction events while the PBF solve remains
// responsible for the large displacement. Sources: append-based emitters (pour/faucet/fountain/
// waterfall), ray impulses/taps, and rigid-body water entry. Rain keeps its dedicated M5.6.2 ring
// layer to avoid double-seeding the storm.

const sim=window.__sim,ssfr=window.__ssfr,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M5.7 ripples: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const SLOTS=quality==='low'?18:quality==='high'?42:30;
const LIFE=2.65;
const events=new Float32Array(SLOTS*4);for(let i=0;i<SLOTS;i++)events[i*4+2]=-99;
let head=0,lastEmit=0;
const waterTop=()=>sim.params.box[1]*.28;
function emit(x,z,amp=.8,delay=0){
 const b=sim.params.box;
 x=clamp(Number(x)||0,0,b[0]);z=clamp(Number(z)||0,0,b[2]);amp=clamp(Number(amp)||.8,.08,2.4);
 const write=()=>{const o=(head++%SLOTS)*4;events[o]=x;events[o+1]=z;events[o+2]=performance.now()*.001;events[o+3]=amp;lastEmit=performance.now();};
 if(delay>8)setTimeout(write,Math.min(delay,2600));else write();
}
function clear(){events.fill(0);for(let i=0;i<SLOTS;i++)events[i*4+2]=-99;head=0;}
window.__v5RippleM57={online:true,visual:false,backend:'event-bus-m57',slots:SLOTS,emit,clear,lastEmit:0,error:''};

// Wrap appendFluid so every real emitter can seed a predicted impact ring. The storm already has
// a dedicated impact buffer, so skip rainstorm to prevent duplicate rings.
const baseAppend=sim.appendFluid.bind(sim);
sim.appendFluid=function(pos,vel){
 const added=baseAppend(pos,vel);
 try{
  if(added>0&&state.scenario!=='rainstorm'&&Array.isArray(pos)&&Array.isArray(vel)&&vel.length>=3){
   const n=Math.min(added,Math.floor(pos.length/3),Math.floor(vel.length/3));
   if(n>0){
    const step=Math.max(1,Math.floor(n/24));let sx=0,sy=0,sz=0,svx=0,svy=0,svz=0,c=0;
    for(let i=0;i<n;i+=step){const o=i*3;sx+=pos[o];sy+=pos[o+1];sz+=pos[o+2];svx+=vel[o];svy+=vel[o+1];svz+=vel[o+2];c++;}
    if(c){sx/=c;sy/=c;sz/=c;svx/=c;svy/=c;svz/=c;const wt=waterTop(),g=Math.max(1,Number(sim.params.gravity)||9.81);const h=sy-wt;
     if(h>-sim.params.spacing*.35){const disc=svy*svy+2*g*Math.max(h,0);let t=(svy+Math.sqrt(Math.max(disc,0)))/g;if(h<=0)t=0;t=clamp(t,0,2.4);const ix=sx+svx*t,iz=sz+svz*t;const speed=Math.hypot(svx,svy,svz);const spread=Math.min(1.8,Math.max(.32,Math.sqrt(Math.max(n,1))*.08));emit(ix,iz,clamp(.32+speed*.22+spread*.18,.30,1.65),t*1000);}
    }
   }
  }
 }catch(err){console.warn('[Fluid V5 M5.7 ripple append hook]',err);}
 return added;
};

// Water taps, paddles and other ray impulses get immediate fine-scale rings at the surface plane.
if(typeof sim.applyRayImpulse==='function'){
 const baseImpulse=sim.applyRayImpulse.bind(sim);
 sim.applyRayImpulse=function(origin,dir,imp,radius,limit){
  const out=baseImpulse(origin,dir,imp,radius,limit);
  try{
   if(state.scenario!=='drain'&&origin&&dir&&imp&&Math.abs(dir[1])>.02){const t=(waterTop()-origin[1])/dir[1];if(t>=0&&t<8){const x=origin[0]+dir[0]*t,z=origin[2]+dir[2]*t;const strength=Math.hypot(imp[0]||0,imp[1]||0,imp[2]||0);if(strength>.03&&performance.now()-lastEmit>55)emit(x,z,clamp(.20+strength*.16,.20,1.55));}}
  }catch{}
  return out;
 };
}

// Detect a rigid body entering the free surface. This catches Drop Ball without needing to alter
// the core collision solver.
let prevBody=null,lastBodyRing=0,lastBodyT=performance.now();
function bodyLoop(now){requestAnimationFrame(bodyLoop);if(ui?.paused)return;const pose=sim.bodyPose?.[0],body=sim.bodies?.[0];if(!pose?.centre||!body)return;const c=pose.centre,dt=Math.max(.001,(now-lastBodyT)/1000),r=Math.max(sim.params.spacing*1.5,Number(body.size)||sim.params.spacing*2);if(prevBody){const vy=(c[1]-prevBody[1])/dt,threshold=waterTop()+r*.35;if(prevBody[1]>threshold&&c[1]<=threshold&&vy<-.12&&now-lastBodyRing>420){lastBodyRing=now;emit(c[0],c[2],clamp(.52+Math.abs(vy)*.22,.52,1.7));}}prevBody=[c[0],c[1],c[2]];lastBodyT=now;}
requestAnimationFrame(bodyLoop);

function currentDepthSlot(){const it=Math.max(ssfr.filterIterations||0,0);let s=(it*2)&1;if(ssfr.cleanupPass&&it>0)s=1-s;return s;}
let pipe=null,uni=null,UF=null,bind=null,bindKey='';
try{
 uni=dev.createBuffer({label:'fluidV5M57RippleUniform',size:(1+SLOTS)*16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});UF=new Float32Array((1+SLOTS)*4);
 const wgsl=`
struct Comp{invViewProj:mat4x4f,invView:mat4x4f,eye:vec4f,boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f}
struct R{meta:vec4f,ev:array<vec4f,${SLOTS}>}
@group(0)@binding(0)var<uniform>C:Comp;@group(0)@binding(1)var<uniform>U:R;@group(0)@binding(2)var depthTex:texture_2d<f32>;@group(0)@binding(3)var envTex:texture_cube<f32>;@group(0)@binding(4)var envSamp:sampler;
struct V{@builtin(position)p:vec4f,@location(0)n:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let q=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.p=vec4f(q,0,1);o.n=q;return o;}
fn empty(z:f32)->bool{return z < -1e3;}fn vpos(ndc:vec2f,z:f32)->vec3f{return vec3f(-ndc.x*z/C.proj00,-ndc.y*z/C.proj11,z);}fn edir(d:vec3f)->vec3f{let c=cos(C.envYaw);let s=sin(C.envYaw);return vec3f(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);}
@fragment fn fs(v:V)->@location(0)vec4f{let dim=vec2i(textureDimensions(depthTex,0));let uv=vec2f(v.n.x*.5+.5,.5-v.n.y*.5);let fp=clamp(uv*vec2f(dim),vec2f(1),vec2f(dim)-vec2f(2));let p=vec2i(fp);let z=textureLoad(depthTex,p,0).r;if(empty(z)){discard;}let zx0=textureLoad(depthTex,p+vec2i(-1,0),0).r;let zx1=textureLoad(depthTex,p+vec2i(1,0),0).r;let zy0=textureLoad(depthTex,p+vec2i(0,-1),0).r;let zy1=textureLoad(depthTex,p+vec2i(0,1),0).r;if(empty(zx0)||empty(zx1)||empty(zy0)||empty(zy1)){discard;}let dx=vec2f(2.0/f32(dim.x),0);let dy=vec2f(0,-2.0/f32(dim.y));let pc=vpos(v.n,z);let vx=vpos(v.n+dx,zx1)-vpos(v.n-dx,zx0);let vy=vpos(v.n+dy,zy1)-vpos(v.n-dy,zy0);var nv=normalize(cross(vx,vy));if(nv.z<0){nv=-nv;}var nw=normalize((C.invView*vec4f(nv,0)).xyz);let pw=(C.invView*vec4f(pc,1)).xyz;let vd=normalize(pw-C.eye.xyz);if(dot(nw,-vd)<0){nw=-nw;}var slope=vec2f(0);var crest=0.0;for(var i:u32=0u;i<${SLOTS}u;i++){let e=U.ev[i];let age=U.meta.x-e.z;if(age<=0.0||age>U.meta.y){continue;}let d2=pw.xz-e.xy;let d=length(d2);let speed=.30+.075*e.w;let radius=age*speed;let width=.018+age*.010;let q=(d-radius)/max(width,1e-4);let packet=exp(-q*q*1.35)*exp(-age*.62)*e.w;let phase=cos(q*2.35);crest+=packet*phase;if(d>1e-4){slope+=d2/d*packet*sin(q*2.35)*.22;}}if(abs(crest)<.006&&length(slope)<.004){discard;}nw=normalize(nw+vec3f(-slope.x,0,-slope.y));let R=reflect(vd,nw);var spec=vec3f(.12,.20,.25);if(C.hasEnvMap!=0){spec=textureSampleLevel(envTex,envSamp,edir(R),clamp(C.roughness*3.0,0.0,5.0)).rgb*C.envIntensity;}let f=.0204+(1.0-.0204)*pow(1.0-clamp(dot(nw,-vd),0.0,1.0),5.0);let c=spec*(f*(.10+.18*min(length(slope),1.0)))+vec3f(.10,.16,.20)*max(crest,0.0)*.035;return vec4f(c,0);}
`;
 const mod=dev.createShaderModule({code:wgsl,label:'fluidV5M57RippleWGSL'});pipe=await dev.createRenderPipelineAsync({label:'fluidV5M57Ripple',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
 window.__v5RippleM57.visual=true;window.__v5RippleM57.backend='global-surface-ripples-m57';
}catch(err){window.__v5RippleM57.error=String(err?.message||err);console.error('[Fluid V5 M5.7] global ripple visual rejected; event hooks remain active.',err);}

if(pipe){const baseRender=ssfr.render;ssfr.render=function(...args){const out=baseRender.apply(this,args);const enc=args[0],target=args[1];if(!enc||!target||!this.views?.eyeZ||window.__v5DebugMode!=='final')return out;let active=false,now=performance.now()*.001;for(let i=0;i<SLOTS;i++){const age=now-events[i*4+2];if(age>0&&age<LIFE){active=true;break;}}if(!active)return out;const slot=currentDepthSlot(),key=`${this.gen}|${this.env?.gen||0}|${slot}`;if(!bind||bindKey!==key){bindKey=key;bind=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.compUni}},{binding:1,resource:{buffer:uni}},{binding:2,resource:this.views.eyeZ[slot]},{binding:3,resource:this.env.view},{binding:4,resource:this.env.sampler}]});}UF[0]=now;UF[1]=LIFE;UF[2]=SLOTS;UF[3]=0;UF.set(events,4);dev.queue.writeBuffer(uni,0,UF);const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(pipe);p.setBindGroup(0,bind);p.draw(3);p.end();return out;};}
setInterval(()=>{window.__v5RippleM57.lastEmit=lastEmit;},350);
console.info('[Fluid V5 M5.7] global propagating ripple bus online.');
