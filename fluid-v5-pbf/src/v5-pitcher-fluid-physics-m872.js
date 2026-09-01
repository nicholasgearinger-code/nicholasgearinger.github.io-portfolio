// Fluid V8 M8.7.2 — true vessel-to-vessel pour, containment revision.
// Water starts at rest below the pitcher spout as ordinary PBF particles. The upright
// pitcher is a closed containment volume except for the physically elevated spout throat.
// After a long settling period the pitcher rotates slowly; wall contact only prevents
// penetration, while gravity moves the free surface to the spout and drains it into the
// receiving tumbler. The glass is open at the top with hard inner-wall/base containment.
// All extra collision + vessel rendering is appended to the existing unified command buffer.

const sim=window.__sim,ui=window.__ui,cam=window.__cam,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet;
if(!sim?.dev||!ui||!cam||!ssfr||!faucet?.online||!window.__v5M739Unified?.online)
  throw new Error('M8.7.2 vessel pour: M8.6.7 unified runtime unavailable.');
const dev=sim.dev,queue=dev.queue;
const canvas=document.getElementById('view');
const ctx=canvas?.getContext?.('webgpu');
const format=navigator.gpu.getPreferredCanvasFormat();
if(!canvas||!ctx)throw new Error('M8.7.2 vessel pour: WebGPU canvas unavailable.');

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul3=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]};
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};

const fullCapacity=Math.max(1,sim.cap||sim.n||1);
const glass={cx:.705,cz:.370,bottom:.030,baseTop:.067,rim:.505,innerBottom:.122,innerTop:.134,outerBottom:.143,outerTop:.154};
const pitcher={cx:.300,cy:.820,cz:.370,angle:0,prevAngle:0,omega:0,maxAngle:-1.30};
const profile=[[-.225,.074],[-.190,.105],[-.100,.137],[.020,.145],[.105,.127],[.165,.095],[.205,.070]];
const outerProfile=[[-.255,.095],[-.220,.125],[-.135,.158],[-.020,.166],[.095,.147],[.165,.118],[.225,.090]];
const spoutPath=[[.060,.145,0],[.105,.165,0],[.155,.192,0],[.205,.198,0],[.250,.182,0]];
const scene={active:true,started:false,clock:0,lastDt:1/60,seeded:0,collisionPasses:0,renderPasses:0,cycles:0};

function profileRadius(y){
  if(y<=profile[0][0])return profile[0][1];
  if(y>=profile.at(-1)[0])return profile.at(-1)[1];
  for(let i=0;i<profile.length-1;i++){
    const [y0,r0]=profile[i],[y1,r1]=profile[i+1];
    if(y<=y1){const t=(y-y0)/(y1-y0);return r0+(r1-r0)*t;}
  }
  return profile.at(-1)[1];
}
function pitcherPoint(local,angle=pitcher.angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return[pitcher.cx+c*local[0]-s*local[1],pitcher.cy+s*local[0]+c*local[1],pitcher.cz+local[2]];
}
function pitcherDir(local,angle=pitcher.angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return[c*local[0]-s*local[1],s*local[0]+c*local[1],local[2]];
}
function writeSeed(P,V){
  const n=P.length/4,zero=new Float32Array(n*4);
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],0,P);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],0,V);
  if(sim.buf.bodyA)queue.writeBuffer(sim.buf.bodyA,0,zero);
  if(sim.buf.bodyB)queue.writeBuffer(sim.buf.bodyB,0,zero);
  sim.n=n;
  if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.uploadParams?.(1/120);sim.bindCache=null;
  return n;
}
function seedPitcher(){
  const d=Math.max(.001,Number(sim.params?.spacing)||.025),a=Math.cbrt(2)*d,dy=.5*a;
  // Deliberately keep the initial free surface below the .145 m spout throat. This makes
  // the upright pitcher a real reservoir: zero-velocity water can settle without draining.
  const minY=profile[0][0]+d*.72,fillY=.100,P=[],V=[];let layer=0;
  for(let y=minY;y<=fillY+1e-6;y+=dy,layer++){
    const R=Math.max(0,profileRadius(y)-d*.52),off=(layer&1)?a*.5:0,e=Math.ceil((R+a)/a);
    for(let ix=-e;ix<=e;ix++)for(let iz=-e;iz<=e;iz++){
      const x=ix*a+off,z=iz*a+off;if(x*x+z*z>R*R)continue;
      const p=pitcherPoint([x,y,z],0);P.push(p[0],p[1],p[2],1);V.push(0,0,0,0);
      if(P.length/4>=Math.min(fullCapacity,1200))break;
    }
  }
  const n=writeSeed(new Float32Array(P),new Float32Array(V));scene.seeded=n;return n;
}

function angleAt(t){
  // Long upright rest -> slow deliberate turn -> gravity drain -> slow return.
  if(t<2.60)return 0;
  if(t<5.00)return pitcher.maxAngle*smooth((t-2.60)/2.40);
  if(t<7.80)return pitcher.maxAngle;
  if(t<9.80)return pitcher.maxAngle*(1-smooth((t-7.80)/2.00));
  return 0;
}
function stageAt(t){
  if(t<2.60)return 'WATER RESTING IN PITCHER';
  if(t<5.00)return 'GRAVITY POUR — TURNING';
  if(t<7.80)return 'GRAVITY POUR — DRAINING';
  if(t<9.80)return 'RETURNING UPRIGHT';
  return 'POUR COMPLETE';
}
function advanceMotion(dt){
  dt=clamp(Number(dt)||1/60,1/300,.05);scene.lastDt=dt;scene.clock+=dt;
  pitcher.prevAngle=pitcher.angle;pitcher.angle=angleAt(scene.clock);
  pitcher.omega=(pitcher.angle-pitcher.prevAngle)/dt;
}

const collisionWGSL=`
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

fn safe2(q:vec2f)->vec2f{let m=length(q);return select(vec2f(1.0,0.0),q/m,m>1.0e-6);}
fn toLocal(p:vec3f,a:f32)->vec3f{
  let q=p-U.pitch.xyz;let c=cos(a);let s=sin(a);
  return vec3f(c*q.x+s*q.y,-s*q.x+c*q.y,q.z);
}
fn toWorld(p:vec3f)->vec3f{
  let a=U.pitch.w;let c=cos(a);let s=sin(a);
  return U.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
}
fn dirWorld(n:vec3f)->vec3f{
  let a=U.pitch.w;let c=cos(a);let s=sin(a);
  return normalize(vec3f(c*n.x-s*n.y,s*n.x+c*n.y,n.z));
}
fn bodyR(y:f32)->f32{
  if(y<=-.225){return .074;}
  if(y<-.190){let t=(y+.225)/.035;return mix(.074,.105,t);}
  if(y<-.100){let t=(y+.190)/.090;return mix(.105,.137,t);}
  if(y<.020){let t=(y+.100)/.120;return mix(.137,.145,t);}
  if(y<.105){let t=(y-.020)/.085;return mix(.145,.127,t);}
  if(y<.165){let t=(y-.105)/.060;return mix(.127,.095,t);}
  if(y<.205){let t=(y-.165)/.040;return mix(.095,.070,t);}
  return .070;
}
fn spoutY(x:f32)->f32{
  if(x<=.060){return .145;}
  if(x<.105){return mix(.145,.165,(x-.060)/.045);}
  if(x<.155){return mix(.165,.192,(x-.105)/.050);}
  if(x<.205){return mix(.192,.198,(x-.155)/.050);}
  return mix(.198,.182,clamp((x-.205)/.045,0.0,1.0));
}
fn trackedBody(l:vec3f,pr:f32)->bool{
  let r=length(l.xz);return l.y>-.225-pr*2.0 && l.y<.205+pr*2.0 && r<bodyR(clamp(l.y,-.225,.205))+pr*2.0;
}
fn trackedSpout(l:vec3f,pr:f32)->bool{
  if(l.x<.050-pr || l.x>.260+pr){return false;}
  let sy=spoutY(clamp(l.x,.060,.250));
  return abs(l.z)<.070+pr && l.y>sy-.038-pr*.45 && l.y<sy+.090+pr;
}
fn portal(l:vec3f,pr:f32)->bool{
  // The throat is intentionally high and narrow. Upright water at ~.10 m cannot enter it;
  // when the pitcher rotates, gravity raises the free surface against this side naturally.
  if(l.x<.050 || l.x>.275 || abs(l.z)>.073+pr*.45){return false;}
  let sy=spoutY(clamp(l.x,.060,.250));
  return l.y>sy-.020-pr*.20;
}
fn wallVelocity(worldP:vec3f)->vec3f{
  let r=worldP-U.pitch.xyz;let w=U.motion.y;return vec3f(-w*r.y,w*r.x,0.0);
}
fn contactVelocity(v0:vec3f,p:vec3f,nLocal:vec3f)->vec3f{
  // Slip wall: inherit only the wall's normal motion needed to prevent penetration.
  // Tangential pitcher motion does not drag/launch the liquid; gravity remains the driver.
  let n=dirWorld(nLocal);let wv=wallVelocity(p);var v=v0;let relOut=dot(v-wv,n);
  if(relOut>0.0){v-=n*relOut*1.025;}
  let vn=n*dot(v,n);let vt=v-vn;return vn+vt*.997;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  var p=pos[i].xyz;var v=vel[i].xyz;let pr=max(U.motion.w*.48,.004);let dt=max(U.motion.z,1.0/300.0);
  let prevWorld=p-v*dt;let lc=toLocal(p,U.pitch.w);let lp=toLocal(prevWorld,U.motion.x);
  let wasBody=trackedBody(lp,pr);let wasSpout=trackedSpout(lp,pr);

  if(wasBody){
    let allowPortal=portal(lc,pr);
    if(!allowPortal){
      var q=lc;var nLocal=vec3f(0.0);var hit=false;
      let ySafe=clamp(q.y,-.225+pr,.205-pr);
      if(q.y<-.225+pr){q.y=-.225+pr;nLocal=vec3f(0.0,-1.0,0.0);hit=true;}
      else if(q.y>.205-pr){q.y=.205-pr;nLocal=vec3f(0.0,1.0,0.0);hit=true;}
      let rr=length(q.xz);let safe=max(.012,bodyR(ySafe)-pr);
      if(rr>safe){let d=safe2(q.xz);q.x=d.x*safe;q.z=d.y*safe;nLocal=normalize(vec3f(d.x,0.0,d.y));hit=true;}
      if(hit){p=toWorld(q);v=contactVelocity(v,p,nLocal);}
    }
  }

  // Open spout trough: bottom + side rails contain the sheet, while top and outlet stay open.
  let l2=toLocal(p,U.pitch.w);let prevSp=wasSpout || (wasBody && portal(l2,pr));
  if(prevSp && l2.x<.258+pr){
    let sy=spoutY(clamp(l2.x,.060,.250));var q=l2;var nLocal=vec3f(0.0);var hit=false;
    let halfW=max(.030,.066-pr*.30);let low=sy-.034+pr*.50;
    if(q.y<low){q.y=low;nLocal=vec3f(0.0,-1.0,0.0);hit=true;}
    if(abs(q.z)>halfW){let sg=select(-1.0,1.0,q.z>=0.0);q.z=sg*halfW;nLocal=vec3f(0.0,0.0,sg);hit=true;}
    if(q.x<.052-pr*.20){q.x=.052-pr*.20;nLocal=vec3f(-1.0,0.0,0.0);hit=true;}
    if(hit){p=toWorld(q);v=contactVelocity(v,p,nLocal);}
  }

  // Static open tumbler. The center of the rim is open. Once a particle crosses that opening,
  // the inside base and radial wall are hard containment boundaries so water cannot seep out.
  let gc=vec2f(U.glass0.x,U.glass0.z);var gq=p.xz-gc;var gr=length(gq);var gd=safe2(gq);
  let baseTop=U.glass2.x;let rim=U.glass1.w;let gh=max(rim-baseTop,1.0e-4);let ty=clamp((p.y-baseTop)/gh,0.0,1.0);
  let inner=mix(U.glass0.w,U.glass1.x,ty);let outer=mix(U.glass1.y,U.glass1.z,ty);let innerSafe=max(.01,inner-pr*1.05);let outerSafe=outer+pr*.85;
  let gp=p-v*dt;let gpq=gp.xz-gc;let gpr=length(gpq);let pty=clamp((gp.y-baseTop)/gh,0.0,1.0);let prevInner=max(.01,mix(U.glass0.w,U.glass1.x,pty)-pr*1.05);let prevOuter=mix(U.glass1.y,U.glass1.z,pty)+pr*.85;
  let enteredFromTop=gp.y>=rim-pr*.30 && p.y<rim && gr<inner+pr*.25 && v.y<1.0;
  let wasInside=gpr<=prevInner+pr*.12 || enteredFromTop;

  // Solid base for every particle already in/captured by the glass footprint.
  if(p.y<baseTop+pr && p.y>U.glass0.y-pr*1.5 && gr<inner+pr*.35){
    if(wasInside || gr<innerSafe){p.y=baseTop+pr;if(v.y<0.0){v.y=-v.y*.035;}v.x*=.91;v.z*=.91;}
  }

  // Interior radial wall. This catches both ordinary wall contact and a one-step wall skip.
  if(p.y<rim-pr*.04 && p.y>baseTop+pr*.12){
    gq=p.xz-gc;gr=length(gq);gd=safe2(gq);
    if(wasInside){
      if(gr>innerSafe){let o=gc+gd*innerSafe;p.x=o.x;p.z=o.y;let rv=dot(vec2f(v.x,v.z),gd);if(rv>0.0){let vv=vec2f(v.x,v.z)-gd*rv*1.08;v.x=vv.x;v.z=vv.y;}v.y*=.995;}
    }else{
      // Outside particles cannot tunnel inward through the glass wall.
      if(gr<outerSafe && gr>innerSafe){let o=gc+gd*outerSafe;p.x=o.x;p.z=o.y;let rv=dot(vec2f(v.x,v.z),gd);if(rv<0.0){let vv=vec2f(v.x,v.z)-gd*rv*1.08;v.x=vv.x;v.z=vv.y;}}
      else if(gr<=innerSafe && gpr>prevOuter && gp.y<rim-pr*.25){let o=gc+gd*outerSafe;p.x=o.x;p.z=o.y;}
    }
    // A captured interior particle that skips completely past wall thickness is pulled back in.
    if(wasInside && gr>=outerSafe){let o=gc+gd*innerSafe;p.x=o.x;p.z=o.y;}
  }

  // Thick rim ring, but leave its center unobstructed for falling water.
  if(abs(p.y-rim)<pr*1.15){
    gq=p.xz-gc;gr=length(gq);gd=safe2(gq);
    if(gr>innerSafe&&gr<outerSafe){
      if(gp.y>rim+pr*.18 && !enteredFromTop){p.y=rim+pr*1.15;if(v.y<0.0){v.y=-v.y*.025;}}
      else if(wasInside){let o=gc+gd*innerSafe;p.x=o.x;p.z=o.y;}
      else{let o=gc+gd*outerSafe;p.x=o.x;p.z=o.y;}
    }
  }

  pos[i]=vec4f(p,1.0);pred[i]=vec4f(p,1.0);vel[i]=vec4f(v,0.0);
}`;

const collisionMod=dev.createShaderModule({code:collisionWGSL,label:'m872VesselCollisionWGSL'});
if(typeof collisionMod.getCompilationInfo==='function'){
  const info=await collisionMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.7.2 vessel WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const collisionPipe=await dev.createComputePipelineAsync({label:'m872VesselCollision',layout:'auto',compute:{module:collisionMod,entryPoint:'main'}});
const collisionUni=dev.createBuffer({label:'m872VesselCollisionUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const CF=new Float32Array(24),CU=new Uint32Array(CF.buffer);
function encodeCollider(enc){
  if(!scene.active||!sim.n)return;CF.fill(0);
  CF[0]=pitcher.cx;CF[1]=pitcher.cy;CF[2]=pitcher.cz;CF[3]=pitcher.angle;
  CF[4]=pitcher.prevAngle;CF[5]=pitcher.omega;CF[6]=scene.lastDt;CF[7]=Number(sim.params?.spacing)||.025;
  CF[8]=glass.cx;CF[9]=glass.bottom;CF[10]=glass.cz;CF[11]=glass.innerBottom;
  CF[12]=glass.innerTop;CF[13]=glass.outerBottom;CF[14]=glass.outerTop;CF[15]=glass.rim;
  CF[16]=glass.baseTop;CU[20]=sim.n;queue.writeBuffer(collisionUni,0,CF);
  const s=sim.parity===0?'A':'B';
  const bg=dev.createBindGroup({layout:collisionPipe.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:collisionUni}},{binding:1,resource:{buffer:sim.buf['pos'+s]}},
    {binding:2,resource:{buffer:sim.buf['vel'+s]}},{binding:3,resource:{buffer:sim.buf['pred'+s]}}
  ]});
  const pass=enc.beginComputePass({label:'m872MovingPitcherAndGlass'});
  pass.setPipeline(collisionPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();scene.collisionPasses++;
}

export {sim,ui,cam,ssfr,faucet,dev,queue,canvas,ctx,format,add,sub,mul3,dot,cross,norm,glass,pitcher,profile,outerProfile,spoutPath,scene,pitcherPoint,stageAt,advanceMotion,seedPitcher,encodeCollider};
