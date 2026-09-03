// Fluid V8 M8.7.3 — continuous vessel fluid.
// Dense BCC pitcher seed + single persistent-state collider + continuum-oriented PBF tuning.
// No hard particle sleep: unsupported water always remains free to fall under gravity.

import {sim,ui,ssfr,faucet,dev,queue,scene,pitcher,glass,profile,pitcherPoint} from './v5-pitcher-fluid-physics-m872.js';
const api=window.__v5M872Scene;
if(!sim?.dev||!ui||!api?.online)throw new Error('M8.7.3 continuum vessel: M8.7.2 scene unavailable.');

const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
let inStep=false,stateReady=false,lastClock=0,passes=0,resets=0;
const uni=dev.createBuffer({label:'m873ContinuumVesselUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(24),UU=new Uint32Array(UF.buffer);

function profileRadius(y){
  if(y<=profile[0][0])return profile[0][1];
  if(y>=profile.at(-1)[0])return profile.at(-1)[1];
  for(let i=0;i<profile.length-1;i++){
    const [y0,r0]=profile[i],[y1,r1]=profile[i+1];
    if(y<=y1){const t=(y-y0)/(y1-y0);return r0+(r1-r0)*t;}
  }
  return profile.at(-1)[1];
}

function denseSeed(){
  const d=Math.max(.001,Number(sim.params?.spacing)||.019),a=Math.cbrt(2)*d,dy=.5*a;
  const minY=profile[0][0]+d*.72,fillY=.100,P=[],V=[];let layer=0;
  const limit=Math.min(sim.cap||6000,3600);
  outer:for(let y=minY;y<=fillY+1e-6;y+=dy,layer++){
    const R=Math.max(0,profileRadius(y)-d*.52),off=(layer&1)?a*.5:0,e=Math.ceil((R+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+off,z=iz*a+off;if(x*x+z*z>R*R)continue;
      const p=pitcherPoint([x,y,z],0);P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=limit)break outer;
    }
  }
  const n=P.length/4,p4=new Float32Array(P),v4=new Float32Array(V),r4=new Float32Array(n*4),zero=new Float32Array(n*4);
  for(let i=0;i<n;i++)r4[i*4+3]=101;
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],0,p4);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],0,v4);
  for(const name of ['restA','restB'])queue.writeBuffer(sim.buf[name],0,r4);
  if(sim.buf.bodyA)queue.writeBuffer(sim.buf.bodyA,0,zero);
  if(sim.buf.bodyB)queue.writeBuffer(sim.buf.bodyB,0,zero);
  sim.n=n;if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.uploadParams?.(1/180);sim.bindCache=null;scene.seeded=n;stateReady=true;resets++;
  return n;
}

function continuumReset(){
  scene.started=false;scene.clock=0;scene.lastDt=1/60;pitcher.angle=0;pitcher.prevAngle=0;pitcher.omega=0;
  ui.pouring=false;ui.pourLeft=0;ui.paused=false;sim.timeBank=0;sim.simTime=0;lastClock=0;passes=0;
  denseSeed();scene.collisionPasses=0;scene.started=true;
}

const WGSL=`
struct UData {
  pitch:vec4f,
  motion:vec4f,
  glass0:vec4f,
  glass1:vec4f,
  glass2:vec4f,
  info:vec4u,
}
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> rest:array<vec4f>;

fn safe2(q:vec2f)->vec2f{let m=length(q);return select(vec2f(1.0,0.0),q/m,m>1.0e-6);}
fn toLocal(p:vec3f,a:f32)->vec3f{let q=p-U.pitch.xyz;let c=cos(a);let s=sin(a);return vec3f(c*q.x+s*q.y,-s*q.x+c*q.y,q.z);}
fn toWorld(p:vec3f)->vec3f{let a=U.pitch.w;let c=cos(a);let s=sin(a);return U.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
fn dirWorld(n:vec3f)->vec3f{let a=U.pitch.w;let c=cos(a);let s=sin(a);return normalize(vec3f(c*n.x-s*n.y,s*n.x+c*n.y,n.z));}
fn bodyR(y:f32)->f32{
  if(y<=-.225){return .074;} if(y<-.190){return mix(.074,.105,(y+.225)/.035);}
  if(y<-.100){return mix(.105,.137,(y+.190)/.090);} if(y<.020){return mix(.137,.145,(y+.100)/.120);}
  if(y<.105){return mix(.145,.127,(y-.020)/.085);} if(y<.165){return mix(.127,.095,(y-.105)/.060);}
  if(y<.205){return mix(.095,.070,(y-.165)/.040);} return .070;
}
fn spoutY(x:f32)->f32{
  if(x<=.060){return .145;} if(x<.105){return mix(.145,.165,(x-.060)/.045);}
  if(x<.155){return mix(.165,.192,(x-.105)/.050);} if(x<.205){return mix(.192,.198,(x-.155)/.050);}
  return mix(.198,.182,clamp((x-.205)/.045,0.0,1.0));
}
fn wallVelocity(worldP:vec3f)->vec3f{let r=worldP-U.pitch.xyz;let w=U.motion.y;return vec3f(-w*r.y,w*r.x,0.0);}
fn slipContact(v0:vec3f,p:vec3f,nLocal:vec3f)->vec3f{
  let n=dirWorld(nLocal);let wv=wallVelocity(p);var v=v0;let outward=dot(v-wv,n);
  if(outward>0.0){v-=n*outward*1.01;}return v;
}
fn markerState(w:f32)->u32{
  if(abs(w-101.0)<.5){return 101u;}if(abs(w-202.0)<.5){return 202u;}if(abs(w-303.0)<.5){return 303u;}return 101u;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  var p=pos[i].xyz;var v=vel[i].xyz;let pr=max(U.motion.w*.48,.0035);let dt=max(U.motion.z,1.0/300.0);
  var state=markerState(rest[i].w);

  // PITCHER: closed body. The only state transition to free flight is at the spout outlet.
  if(state==101u){
    var l=toLocal(p,U.pitch.w);let turned=abs(U.pitch.w)>.14;let sy=spoutY(clamp(l.x,.060,.250));
    let halfW=max(.030,.066-pr*.26);
    let inSpout=turned && l.x>.048-pr*.22 && l.x<.282+pr && abs(l.z)<halfW+pr && l.y>sy-.042-pr && l.y<sy+.102+pr;
    if(inSpout){
      var q=l;var nLocal=vec3f(0.0);var hit=false;let low=sy-.034+pr*.48;
      if(q.y<low){q.y=low;nLocal=vec3f(0.0,-1.0,0.0);hit=true;}
      if(abs(q.z)>halfW){let sg=select(-1.0,1.0,q.z>=0.0);q.z=sg*halfW;nLocal=vec3f(0.0,0.0,sg);hit=true;}
      if(q.x<.048){q.x=.048;nLocal=vec3f(-1.0,0.0,0.0);hit=true;}
      if(hit){p=toWorld(q);v=slipContact(v,p,nLocal);l=q;}
      if(l.x>=.254 && abs(l.z)<halfW+pr*.32 && l.y>spoutY(.250)-.050){state=202u;}
    }else{
      var q=l;var nLocal=vec3f(0.0);var hit=false;
      if(q.y<-.225+pr){q.y=-.225+pr;nLocal=vec3f(0.0,-1.0,0.0);hit=true;}
      if(q.y>.205-pr){q.y=.205-pr;nLocal=vec3f(0.0,1.0,0.0);hit=true;}
      let ys=clamp(q.y,-.225+pr,.205-pr);let rr=length(q.xz);let safe=max(.012,bodyR(ys)-pr*1.04);
      if(rr>safe){let d=safe2(q.xz);q.x=d.x*safe;q.z=d.y*safe;nLocal=normalize(vec3f(d.x,0.0,d.y));hit=true;}
      if(hit){p=toWorld(q);v=slipContact(v,p,nLocal);}
    }
    // Viscous settling, never sleep. Unsupported particles still receive gravity next substep.
    if(U.info.y==1u && U.info.z==1u){v*=.975;}
  }

  let gc=vec2f(U.glass0.x,U.glass0.z);let baseTop=U.glass2.x;let rim=U.glass1.w;let gh=max(rim-baseTop,1.0e-4);
  var gq=p.xz-gc;var gr=length(gq);var gd=safe2(gq);let ty=clamp((p.y-baseTop)/gh,0.0,1.0);
  let inner=mix(U.glass0.w,U.glass1.x,ty);let outer=mix(U.glass1.y,U.glass1.z,ty);
  let innerSafe=max(.01,inner-pr*1.04);let outerSafe=outer+pr*.82;
  let prev=p-v*dt;let prevQ=prev.xz-gc;let prevR=length(prevQ);

  // FREE FLIGHT: capture only through the open center of the tumbler rim.
  if(state==202u){
    var crossed=false;let dy=prev.y-p.y;
    if(prev.y>=rim-pr*.15 && p.y<rim+pr*.08 && dy>1.0e-6){
      let t=clamp((prev.y-rim)/dy,0.0,1.0);let crossXZ=prev.xz+(p.xz-prev.xz)*t;
      if(length(crossXZ-gc)<U.glass1.x-pr*.34){crossed=true;}
    }
    if(!crossed && p.y<rim && p.y>baseTop-pr*1.5 && gr<innerSafe && prev.y>rim-pr*1.6){crossed=true;}
    if(crossed){state=303u;}
    else{
      if(p.y>baseTop-pr && p.y<rim+pr && gr>innerSafe && gr<outerSafe){
        let o=gc+gd*outerSafe;p.x=o.x;p.z=o.y;let rv=dot(vec2f(v.x,v.z),gd);
        if(rv<0.0){let vv=vec2f(v.x,v.z)-gd*rv*1.04;v.x=vv.x;v.z=vv.y;}
      }
      if(abs(p.y-rim)<pr*1.05 && gr>innerSafe && gr<outerSafe){p.y=rim+pr*1.05;if(v.y<0.0){v.y=-v.y*.015;}}
    }
  }

  // GLASS: hard base and inner wall. Only a clear energetic rise well above the rim may splash out.
  if(state==303u){
    if(p.y>rim+pr*2.6 && gr<U.glass1.x-pr*.65 && v.y>.65){state=202u;}
    else{
      if(p.y<baseTop+pr){p.y=baseTop+pr;if(v.y<0.0){v.y=-v.y*.01;}v.x*=.94;v.z*=.94;}
      let gy=clamp((p.y-baseTop)/gh,0.0,1.0);let gi=mix(U.glass0.w,U.glass1.x,gy);let gs=max(.01,gi-pr*1.06);
      gq=p.xz-gc;gr=length(gq);gd=safe2(gq);
      if(p.y<rim+pr*1.4 && gr>gs){let o=gc+gd*gs;p.x=o.x;p.z=o.y;let rv=dot(vec2f(v.x,v.z),gd);if(rv>0.0){let vv=vec2f(v.x,v.z)-gd*rv*1.05;v.x=vv.x;v.z=vv.y;}}
      if(U.info.y==1u && p.y<rim){v*=.988;}
    }
  }

  pos[i]=vec4f(p,1.0);pred[i]=vec4f(p,1.0);vel[i]=vec4f(v,0.0);rest[i]=vec4f(rest[i].xyz,f32(state));
}`;

const mod=dev.createShaderModule({code:WGSL,label:'m873ContinuumVesselWGSL'});
if(typeof mod.getCompilationInfo==='function'){
  const info=await mod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.7.3 vessel WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createComputePipelineAsync({label:'m873ContinuumVessel',layout:'auto',compute:{module:mod,entryPoint:'main'}});

function applyContinuumFluid(){
  if(!sim.params)return;
  sim.params.substeps=3;sim.params.iterations=5;sim.params.xsphC=.055;sim.params.sCorrK=.065;sim.params.surfaceTensionK=.020;
}
function applyContinuumSurface(){
  if(!ssfr)return;
  ssfr.splatRadius=1.18;ssfr.filter=2;ssfr.filterIterations=2;ssfr.thicknessRadius=1.20;ssfr.thicknessFilterSize=4;ssfr.bindCache=null;
}
function encode(enc,post=false){
  if(!api.seeded||!sim.n)return;UF.fill(0);
  const current=Number(api.angle)||0,previous=Number(sim.__m873PrevAngle??current),dt=Math.min(.05,Math.max(1/300,Number(sim.__m873Dt)||1/60));
  UF[0]=pitcher.cx;UF[1]=pitcher.cy;UF[2]=pitcher.cz;UF[3]=current;UF[4]=previous;UF[5]=(current-previous)/dt;UF[6]=dt;UF[7]=Number(sim.params?.spacing)||.019;
  UF[8]=glass.cx;UF[9]=glass.bottom;UF[10]=glass.cz;UF[11]=glass.innerBottom;UF[12]=glass.innerTop;UF[13]=glass.outerBottom;UF[14]=glass.outerTop;UF[15]=glass.rim;UF[16]=glass.baseTop;
  UU[20]=sim.n;UU[21]=post?1:0;UU[22]=(Number(api.clock)<2.60&&Math.abs(current)<.012)?1:0;
  queue.writeBuffer(uni,0,UF);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.buf['pos'+s]}},{binding:2,resource:{buffer:sim.buf['vel'+s]}},
    {binding:3,resource:{buffer:sim.buf['pred'+s]}},{binding:4,resource:{buffer:sim.buf['rest'+s]}}
  ]});
  const pass=enc.beginComputePass({label:post?'m873VesselPostSolve':'m873VesselPreSolve'});pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();passes++;
  scene.collisionPasses=passes;
}

dev.createCommandEncoder=function(desc){
  const enc=baseCreate(desc);if(!inStep)return enc;
  try{encode(enc,false)}catch(err){console.error('[M8.7.3 pre]',err)}
  return new Proxy(enc,{get(target,prop){
    if(prop==='finish')return(...args)=>{try{encode(target,true)}catch(err){console.error('[M8.7.3 post]',err)}return target.finish(...args);};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
};

sim.step=function(dt){
  const clock=Number(api.clock)||0;
  if(api.seeded>0&&(!stateReady||clock+.20<lastClock)){denseSeed();}
  applyContinuumFluid();sim.__m873PrevAngle=Number(api.angle)||0;sim.__m873Dt=Number(dt)||1/60;
  const wasActive=scene.active;scene.active=false;inStep=true;let out;
  try{out=baseStep(dt)}finally{inStep=false;scene.active=wasActive;}
  lastClock=Number(api.clock)||clock;return out;
};

// Remove the old reset listener so every replay uses the dense continuum seed.
const oldAgain=document.getElementById('m872Again');
if(oldAgain){const fresh=oldAgain.cloneNode(true);oldAgain.replaceWith(fresh);fresh.onclick=e=>{e.preventDefault();e.stopPropagation();continuumReset();};}

applyContinuumFluid();applyContinuumSurface();
setTimeout(()=>{applyContinuumFluid();applyContinuumSurface();continuumReset();},720);
window.__v5M873Continuum={online:true,backend:'dense-bcc-single-stateful-vessel-continuum',gpuSubmitsAdded:0,get passes(){return passes},get resets(){return resets},restart:continuumReset};
window.__fluidV5Version='8.7.3';window.__fluidV5Build='M8.7.3 CONTINUOUS VESSEL FLUID / DENSE BCC / ANTI-CLUMP PBF / HARD GLASS';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.7.3';
const htitle=document.querySelector('#m872Hud b');if(htitle)htitle.textContent='M8.7.3 · CONTINUOUS VESSEL FLUID';
document.title='Fluid V8 · M8.7.3 Continuous Vessel Fluid';
console.info('[Fluid V8 M8.7.3] dense continuum vessel fluid online; hard sleep removed; added submits 0.');
