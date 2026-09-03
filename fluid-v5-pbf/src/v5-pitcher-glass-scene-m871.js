// Fluid V8 M8.7.1 — realistic pitcher + receiving-glass container scene.
// Option A: finite kinematic pitcher emitter + physical open tumbler. No extra queue submits.

const sim=window.__sim,ui=window.__ui,cam=window.__cam,ssfr=window.__ssfr;
const faucet=window.__v5M861Faucet;
if(!sim?.dev||!ui||!cam||!ssfr||!faucet?.online||!window.__v5M739Unified?.online)
  throw new Error('M8.7.1 pitcher/glass: M8.6.1 unified faucet runtime unavailable.');
const dev=sim.dev,queue=dev.queue;
const canvas=document.getElementById('view');
const ctx=canvas?.getContext?.('webgpu');
const format=navigator.gpu.getPreferredCanvasFormat();
if(!canvas||!ctx)throw new Error('M8.7.1 pitcher/glass: WebGPU canvas context unavailable.');

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul3=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]};

const fullCapacity=Math.max(1,sim.cap||sim.n||1);
const scene={active:true,target:1650,emitted:0,sourcePhase:0,sourceLayers:0,collisionPasses:0,renderPasses:0,started:false,lastDt:1/60,flightTime:.24};
const glass={cx:.725,cz:.370,bottom:.030,baseTop:.067,rim:.505,innerBottom:.122,innerTop:.134,outerBottom:.143,outerTop:.154};
const pitcher={cx:.285,cy:.825,cz:.370,tilt:-.62};
const pc=Math.cos(pitcher.tilt),ps=Math.sin(pitcher.tilt);
const pPoint=p=>[pitcher.cx+pc*p[0]-ps*p[1],pitcher.cy+ps*p[0]+pc*p[1],pitcher.cz+p[2]];
const pDir=v=>[pc*v[0]-ps*v[1],ps*v[0]+pc*v[1],v[2]];
const spoutLocal=[[.082,.155,0],[.125,.178,0],[.165,.202,0],[.205,.188,0]];
const lip=pPoint(spoutLocal[spoutLocal.length-1]);

function aimVelocity(){
  const g=Math.max(1,Number(sim.params?.gravity)||9.81),t=scene.flightTime;
  const target=[glass.cx,glass.rim-.038,glass.cz];
  return[(target[0]-lip[0])/t,(target[1]-lip[1]+.5*g*t*t)/t,(target[2]-lip[2])/t];
}
function sourceCrossSection(d,parity){
  const step=d*.90,R=d*2.15,off=parity?step*.45:0,out=[],e=Math.ceil(R/step)+1;
  for(let a=-e;a<=e;a++)for(let b=-e;b<=e;b++){const x=a*step+off,z=b*step+off;if(x*x+z*z<=R*R)out.push([x,z]);}
  return out;
}
function sourceBasis(v){
  const dir=norm(v);let side=[0,0,1];if(Math.abs(dot(dir,side))>.92)side=[1,0,0];
  const b1=norm(cross(dir,side)),b2=norm(cross(dir,b1));return{dir,b1,b2};
}
function writeRange(start,P,V){
  const count=P.length/4;if(!count)return 0;const byte=start*16;
  for(const name of ['posA','posB','predA','predB'])queue.writeBuffer(sim.buf[name],byte,P);
  for(const name of ['velA','velB'])queue.writeBuffer(sim.buf[name],byte,V);
  const zero=new Float32Array(count*4);
  if(sim.buf.bodyA)queue.writeBuffer(sim.buf.bodyA,byte,zero);if(sim.buf.bodyB)queue.writeBuffer(sim.buf.bodyB,byte,zero);
  return count;
}
function setActiveCount(n){
  n=Math.max(1,Math.min(fullCapacity,n|0));sim.n=n;
  if(sim.scene){sim.scene.n=n;sim.scene.nFluid=n;sim.scene.nBody=0;}
  sim.uploadParams?.(1/120);
}
function buildPlanes(planes,maxParticles,ageBase=0){
  const d=Math.max(.001,Number(sim.params?.spacing)||.025),g=Math.max(1,Number(sim.params?.gravity)||9.81);
  const v0=aimVelocity(),speed=Math.hypot(...v0),basis=sourceBasis(v0),axial=d*.92,P=[],V=[];let made=0;
  for(let k=0;k<planes&&made<maxParticles;k++){
    const cs=sourceCrossSection(d,(scene.sourceLayers+k)&1),age=ageBase+(planes-k-.35)*axial/Math.max(speed,.1);
    const centre=[lip[0]+v0[0]*age,lip[1]+v0[1]*age-.5*g*age*age,lip[2]+v0[2]*age],vy=v0[1]-g*age;
    for(const q of cs){if(made>=maxParticles)break;const p=add(centre,add(mul3(basis.b1,q[0]),mul3(basis.b2,q[1])));P.push(p[0],p[1],p[2],1);V.push(v0[0],vy,v0[2],0);made++;}
  }
  scene.sourceLayers+=planes;return{P:new Float32Array(P),V:new Float32Array(V),count:made};
}
function emitInitial(){scene.sourceLayers=0;const b=buildPlanes(5,Math.min(scene.target,180));writeRange(0,b.P,b.V);scene.emitted=b.count;setActiveCount(scene.emitted);}
function prepareEmission(dt){
  if(!scene.active||ui.paused||scene.emitted>=scene.target)return;
  dt=clamp(Number(dt)||1/60,1/300,.05);scene.lastDt=dt;
  const d=Math.max(.001,Number(sim.params?.spacing)||.025),speed=Math.hypot(...aimVelocity()),axial=d*.92;
  scene.sourcePhase+=speed*dt;let planes=Math.floor(scene.sourcePhase/axial);if(planes<1)return;
  planes=Math.min(planes,5);scene.sourcePhase-=planes*axial;
  const left=Math.min(scene.target-scene.emitted,fullCapacity-scene.emitted);if(left<=0)return;
  const b=buildPlanes(planes,left);if(!b.count)return;writeRange(scene.emitted,b.P,b.V);scene.emitted+=b.count;setActiveCount(scene.emitted);
}

const collisionWGSL=`
struct UData { centre:vec4f, shape:vec4f, base:vec4f, info:vec4u }
@group(0) @binding(0) var<uniform> U:UData;
@group(0) @binding(1) var<storage,read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pred:array<vec4f>;
fn safe2(q:vec2f)->vec2f{let m=length(q);return select(vec2f(1.0,0.0),q/m,m>1.0e-6);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=U.info.x){return;}
  var p=pos[i].xyz;var v=vel[i].xyz;let c=vec2f(U.centre.x,U.centre.z);
  var q=p.xz-c;var r=length(q);var dir=safe2(q);
  let h=max(U.shape.w-U.base.x,1.0e-4);let ty=clamp((p.y-U.base.x)/h,0.0,1.0);
  let inner=mix(U.centre.w,U.shape.x,ty);let outer=mix(U.shape.y,U.shape.z,ty);
  let pr=max(U.base.y*.46,.004);let innerSafe=max(.01,inner-pr);let outerSafe=outer+pr*.72;
  let prev=p-v*max(U.base.z,1.0/300.0);let prevQ=prev.xz-c;let prevR=length(prevQ);
  let prevTy=clamp((prev.y-U.base.x)/h,0.0,1.0);let prevInner=mix(U.centre.w,U.shape.x,prevTy)-pr;let prevOuter=mix(U.shape.y,U.shape.z,prevTy)+pr*.72;
  let rim=U.shape.w;let baseTop=U.base.x;let entryBand=max(U.base.y*2.8,.045);
  if(p.y<baseTop+pr && p.y>U.centre.y-pr*1.5 && r<outerSafe){
    let cameFromInside=(prevR<=max(prevInner,.01)) || (prev.y>rim && prevR<inner);
    if(cameFromInside || r<innerSafe){p.y=baseTop+pr;if(v.y<0.0){v.y=-v.y*U.base.w;}v.x*=.86;v.z*=.86;}
    else{let outXZ=c+dir*outerSafe;p.x=outXZ.x;p.z=outXZ.y;let vxz=vec2f(v.x,v.z);let rv=dot(vxz,dir);if(rv<0.0){let nv=vxz-dir*rv*1.08;v.x=nv.x;v.z=nv.y;}}
  }
  if(p.y<rim-pr*.10 && p.y>baseTop+pr*.35){
    q=p.xz-c;r=length(q);dir=safe2(q);let enteredFromTop=prev.y>=rim-pr*.2 && prevR<inner+pr*.25 && v.y<=.35;
    if(r>innerSafe && r<outerSafe){
      let fromInside=(prevR<=max(prevInner,.01)) || enteredFromTop;
      if(fromInside){let inXZ=c+dir*innerSafe;p.x=inXZ.x;p.z=inXZ.y;let vxz=vec2f(v.x,v.z);let rv=dot(vxz,dir);if(rv>0.0){let nv=vxz-dir*rv*1.10;v.x=nv.x;v.z=nv.y;}v.y*=.985;}
      else{let outXZ=c+dir*outerSafe;p.x=outXZ.x;p.z=outXZ.y;let vxz=vec2f(v.x,v.z);let rv=dot(vxz,dir);if(rv<0.0){let nv=vxz-dir*rv*1.10;v.x=nv.x;v.z=nv.y;}}
    }else if(r<=innerSafe && prevR>prevOuter && prev.y<rim-entryBand*.15){let outXZ=c+dir*outerSafe;p.x=outXZ.x;p.z=outXZ.y;let vxz=vec2f(v.x,v.z);let rv=dot(vxz,dir);if(rv<0.0){let nv=vxz-dir*rv*1.12;v.x=nv.x;v.z=nv.y;}}
    else if(r>=outerSafe && prevR<prevInner && prev.y<rim-entryBand*.15){let inXZ=c+dir*innerSafe;p.x=inXZ.x;p.z=inXZ.y;let vxz=vec2f(v.x,v.z);let rv=dot(vxz,dir);if(rv>0.0){let nv=vxz-dir*rv*1.12;v.x=nv.x;v.z=nv.y;}}
  }
  if(abs(p.y-rim)<pr*1.15){q=p.xz-c;r=length(q);dir=safe2(q);if(r>innerSafe && r<outerSafe){if(prev.y>rim+pr*.25){p.y=rim+pr*1.15;if(v.y<0.0){v.y=-v.y*.08;}}else if(prevR<innerSafe){let inXZ=c+dir*innerSafe;p.x=inXZ.x;p.z=inXZ.y;}else{let outXZ=c+dir*outerSafe;p.x=outXZ.x;p.z=outXZ.y;}}}
  pos[i]=vec4f(p,1.0);pred[i]=vec4f(p,1.0);vel[i]=vec4f(v,0.0);
}`;
const collisionMod=dev.createShaderModule({code:collisionWGSL,label:'m871GlassColliderWGSL'});
if(typeof collisionMod.getCompilationInfo==='function'){const info=await collisionMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('M8.7.1 glass collider WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const collisionPipe=await dev.createComputePipelineAsync({label:'m871GlassCollider',layout:'auto',compute:{module:collisionMod,entryPoint:'main'}});
const collisionUni=dev.createBuffer({label:'m871GlassColliderUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const CF=new Float32Array(16),CU=new Uint32Array(CF.buffer);
function encodeCollider(enc){
  if(!scene.active||!sim.n)return;CF.fill(0);
  CF[0]=glass.cx;CF[1]=glass.bottom;CF[2]=glass.cz;CF[3]=glass.innerBottom;CF[4]=glass.innerTop;CF[5]=glass.outerBottom;CF[6]=glass.outerTop;CF[7]=glass.rim;
  CF[8]=glass.baseTop;CF[9]=Number(sim.params?.spacing)||.025;CF[10]=scene.lastDt;CF[11]=.08;CU[12]=sim.n;queue.writeBuffer(collisionUni,0,CF);
  const s=sim.parity===0?'A':'B',bg=dev.createBindGroup({layout:collisionPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:collisionUni}},{binding:1,resource:{buffer:sim.buf['pos'+s]}},{binding:2,resource:{buffer:sim.buf['vel'+s]}},{binding:3,resource:{buffer:sim.buf['pred'+s]}}]});
  const pass=enc.beginComputePass({label:'m871OpenGlassContainment'});pass.setPipeline(collisionPipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(sim.n/256));pass.end();scene.collisionPasses++;
}

const verts=[];
function pushVertex(p,n,m){verts.push(p[0],p[1],p[2],n[0],n[1],n[2],m,0);}
function pushTri(a,na,b,nb,c,nc,m){pushVertex(a,na,m);pushVertex(b,nb,m);pushVertex(c,nc,m);}
function addFrustum(cx,cz,y0,y1,r0,r1,segments,m,inward=false,tf=null){
  const dy=y1-y0,dr=r1-r0;
  for(let i=0;i<segments;i++){
    const a0=i*Math.PI*2/segments,a1=(i+1)*Math.PI*2/segments,ring=(a,y,r)=>[cx+Math.cos(a)*r,y,cz+Math.sin(a)*r];
    let p00=ring(a0,y0,r0),p01=ring(a1,y0,r0),p10=ring(a0,y1,r1),p11=ring(a1,y1,r1),n0=norm([Math.cos(a0)*dy,-dr,Math.sin(a0)*dy]),n1=norm([Math.cos(a1)*dy,-dr,Math.sin(a1)*dy]);
    if(inward){n0=mul3(n0,-1);n1=mul3(n1,-1);}if(tf){p00=tf.p(p00);p01=tf.p(p01);p10=tf.p(p10);p11=tf.p(p11);n0=tf.n(n0);n1=tf.n(n1);}
    if(!inward){pushTri(p00,n0,p10,n0,p11,n1,m);pushTri(p00,n0,p11,n1,p01,n1,m);}else{pushTri(p00,n0,p11,n1,p10,n0,m);pushTri(p00,n0,p01,n1,p11,n1,m);}
  }
}
function addAnnulus(cx,cz,y,rin,rout,segments,m,up=1,tf=null){
  const n=[0,up,0];for(let i=0;i<segments;i++){
    const a0=i*Math.PI*2/segments,a1=(i+1)*Math.PI*2/segments;let p0=[cx+Math.cos(a0)*rin,y,cz+Math.sin(a0)*rin],p1=[cx+Math.cos(a1)*rin,y,cz+Math.sin(a1)*rin],q0=[cx+Math.cos(a0)*rout,y,cz+Math.sin(a0)*rout],q1=[cx+Math.cos(a1)*rout,y,cz+Math.sin(a1)*rout],nn=n;
    if(tf){p0=tf.p(p0);p1=tf.p(p1);q0=tf.p(q0);q1=tf.p(q1);nn=tf.n(n);}if(up>0){pushTri(p0,nn,q0,nn,q1,nn,m);pushTri(p0,nn,q1,nn,p1,nn,m);}else{pushTri(p0,nn,q1,nn,q0,nn,m);pushTri(p0,nn,p1,nn,q1,nn,m);}
  }
}
function addProfile(profile,segments,m,tf){for(let j=0;j<profile.length-1;j++){const[y0,r0]=profile[j],[y1,r1]=profile[j+1];addFrustum(0,0,y0,y1,r0,r1,segments,m,false,tf);}}
function addTubePath(points,radius,around,m){
  const rings=[];for(let i=0;i<points.length;i++){
    const t=norm(sub(points[Math.min(points.length-1,i+1)],points[Math.max(0,i-1)]));let n1=norm(cross(t,[0,0,1]));if(Math.hypot(...n1)<.1)n1=[1,0,0];const n2=norm(cross(t,n1)),ring=[];
    for(let k=0;k<around;k++){const a=k*Math.PI*2/around,rad=add(mul3(n1,Math.cos(a)),mul3(n2,Math.sin(a)));ring.push({p:add(points[i],mul3(rad,radius)),n:rad});}rings.push(ring);
  }
  for(let i=0;i<rings.length-1;i++)for(let k=0;k<around;k++){const k1=(k+1)%around,a=rings[i][k],b=rings[i+1][k],c=rings[i+1][k1],d=rings[i][k1];pushTri(a.p,a.n,b.p,b.n,c.p,c.n,m);pushTri(a.p,a.n,c.p,c.n,d.p,d.n,m);}
}
addFrustum(glass.cx,glass.cz,glass.bottom,glass.rim,glass.outerBottom,glass.outerTop,36,0,false);
addFrustum(glass.cx,glass.cz,glass.baseTop,glass.rim,glass.innerBottom,glass.innerTop,36,0,true);
addAnnulus(glass.cx,glass.cz,glass.rim,glass.innerTop,glass.outerTop,36,2,1);addAnnulus(glass.cx,glass.cz,glass.baseTop,0,glass.innerBottom,36,2,1);addFrustum(glass.cx,glass.cz,glass.bottom,glass.baseTop,glass.outerBottom,glass.outerBottom,36,2,false);
const pitcherTF={p:p=>pPoint([p[0],p[1],p[2]]),n:n=>norm(pDir(n))};
addProfile([[-.255,.095],[-.220,.125],[-.135,.158],[-.020,.166],[.095,.147],[.165,.118],[.225,.090]],40,1,pitcherTF);addAnnulus(0,0,.225,.072,.093,40,2,1,pitcherTF);addAnnulus(0,0,-.255,0,.095,40,2,-1,pitcherTF);
addTubePath(spoutLocal.map(pPoint),.050,14,1);const handleLocal=[];for(let i=0;i<=28;i++){const a=.95+(5.33-.95)*i/28;handleLocal.push([-.105+.165*Math.cos(a),.005+.205*Math.sin(a),0]);}addTubePath(handleLocal.map(pPoint),.018,10,2);
const vertexData=new Float32Array(verts),vertexBuf=dev.createBuffer({label:'m871GlassPitcherVertices',size:Math.max(32,vertexData.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});queue.writeBuffer(vertexBuf,0,vertexData);const vertexCount=vertexData.length/8;

const renderWGSL=`
struct UData{vp:mat4x4f,eye:vec4f,light:vec4f}
@group(0) @binding(0) var<uniform> U:UData;
struct VO{@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) mat:f32}
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) mat:f32)->VO{var o:VO;o.clip=U.vp*vec4f(p,1.0);o.world=p;o.normal=n;o.mat=mat;return o;}
@fragment fn fs(i:VO,@builtin(front_facing) front:bool)->@location(0) vec4f{
 var n=normalize(i.normal);if(!front){n=-n;}let v=normalize(U.eye.xyz-i.world);let l=normalize(U.light.xyz);let ndv=clamp(abs(dot(n,v)),0.0,1.0);let fres=pow(1.0-ndv,2.35);let spec=pow(max(dot(reflect(-l,n),v),0.0),72.0);
 var base=vec3f(.67,.88,.96);var alpha=.065+.30*fres;if(i.mat>.5&&i.mat<1.5){base=vec3f(.74,.91,.97);alpha=.085+.34*fres;}if(i.mat>1.5){base=vec3f(.82,.95,1.0);alpha=.16+.35*fres;}let sky=.08+.13*max(n.y,0.0);let col=base*(.72+sky)+vec3f(1.0)*spec*.78;return vec4f(col,clamp(alpha,0.04,.58));
}`;
const renderMod=dev.createShaderModule({code:renderWGSL,label:'m871GlassPitcherRenderWGSL'});
if(typeof renderMod.getCompilationInfo==='function'){const info=await renderMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('M8.7.1 vessel render WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
const renderPipe=dev.createRenderPipeline({label:'m871TransparentVessels',layout:'auto',vertex:{module:renderMod,entryPoint:'vs',buffers:[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32'}]}]},fragment:{module:renderMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
const renderUni=dev.createBuffer({label:'m871VesselRenderUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const renderBG=dev.createBindGroup({layout:renderPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderUni}}]}),RF=new Float32Array(24);
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];}
function lookAt(eye,target,up){const z=norm(sub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function matMul(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function encodeVisual(enc){
 if(!scene.active)return;const eye=cam.eye(),aspect=Math.max(1,canvas.width)/Math.max(1,canvas.height),vp=matMul(perspective(Math.PI/4,aspect,.05,100),lookAt(eye,cam.target,[0,1,0]));RF.fill(0);RF.set(vp,0);RF[16]=eye[0];RF[17]=eye[1];RF[18]=eye[2];RF[19]=1;RF[20]=-.35;RF[21]=.82;RF[22]=.45;queue.writeBuffer(renderUni,0,RF);
 const target=ctx.getCurrentTexture().createView(),pass=enc.beginRenderPass({label:'m871TransparentVesselPass',colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(renderPipe);pass.setBindGroup(0,renderBG);pass.setVertexBuffer(0,vertexBuf);pass.draw(vertexCount);pass.end();scene.renderPasses++;
}

let inStep=false,expectRender=false;const baseCreate=dev.createCommandEncoder.bind(dev),baseStep=sim.step.bind(sim);
dev.createCommandEncoder=function(desc){
 const phase=inStep?'sim':(expectRender?'render':'other');if(phase==='render')expectRender=false;const enc=baseCreate(desc);let appended=false;if(phase==='other')return enc;
 return new Proxy(enc,{get(target,prop){if(prop==='finish')return(...args)=>{if(!appended){appended=true;try{if(phase==='sim')encodeCollider(target);else encodeVisual(target);}catch(err){console.error(`[M8.7.1 ${phase}]`,err);}}return target.finish(...args);};const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;}});
};
sim.step=function(dt){if(scene.started)prepareEmission(dt);inStep=true;try{return baseStep(dt)}finally{inStep=false;expectRender=true;}};
function frameCamera(){cam.az=-.58;cam.el=.27;cam.dist=1.66;cam.target=[.535,.665,.370];}
function hardReset(){scene.active=true;scene.started=false;scene.emitted=0;scene.sourcePhase=0;scene.sourceLayers=0;scene.collisionPasses=0;scene.renderPasses=0;scene.lastDt=1/60;ui.pouring=false;ui.pourLeft=0;ui.paused=false;sim.timeBank=0;emitInitial();frameCamera();scene.started=true;sync();}
function startScene(){try{faucet.choose('pool')}catch(err){console.warn('[M8.7.1 faucet disable]',err)}requestAnimationFrame(()=>requestAnimationFrame(()=>hardReset()));}

document.getElementById('m861Dock')?.style.setProperty('display','none','important');document.getElementById('m871Hud')?.remove();
const hud=document.createElement('div');hud.id='m871Hud';hud.style.cssText='position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:40;width:min(310px,calc(100vw - 24px));padding:10px;border:1px solid rgba(112,225,235,.42);border-radius:13px;background:rgba(5,20,27,.88);backdrop-filter:blur(9px);font:9px/1.45 ui-monospace;color:#bfeaf0;pointer-events:auto';
hud.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="color:#86f6ff;letter-spacing:.10em">M8.7.1 · REAL CONTAINERS</b><button id="m871Again" style="border:1px solid rgba(241,173,67,.65);border-radius:9px;background:#201708;color:#ffd890;padding:7px 9px;font:800 8px ui-monospace">POUR AGAIN</button></div><div id="m871Status" style="margin-top:7px;white-space:pre-line"></div>';
document.body.appendChild(hud);hud.addEventListener('pointerdown',e=>e.stopPropagation());hud.addEventListener('click',e=>e.stopPropagation());document.getElementById('m871Again').onclick=e=>{e.preventDefault();hardReset()};
const status=document.getElementById('m871Status');function sync(){if(!status)return;const v=aimVelocity(),pct=Math.min(100,100*scene.emitted/scene.target);status.textContent=`FINITE PITCHER ${scene.emitted.toLocaleString()} / ${scene.target.toLocaleString()} · ${pct.toFixed(0)}%\nspout ${lip[0].toFixed(2)}, ${lip[1].toFixed(2)} m · jet ${Math.hypot(...v).toFixed(2)} m/s\nOPEN GLASS · inner ${(glass.innerTop*2*100).toFixed(0)} cm · wall ${((glass.outerTop-glass.innerTop)*1000).toFixed(0)} mm\ncontainer passes ${scene.collisionPasses.toLocaleString()} · vessel renders ${scene.renderPasses.toLocaleString()} · added submits 0`;}
setInterval(sync,500);setTimeout(startScene,520);setTimeout(()=>{document.getElementById('m861Dock')?.style.setProperty('display','none','important');frameCamera();},900);
window.__v5M871Scene={online:true,backend:'finite-spout-open-tumbler-transparent-vessels-m871',gpuSubmitsAdded:0,restart:hardReset,get active(){return scene.active},get emitted(){return scene.emitted},get target(){return scene.target},get collisionPasses(){return scene.collisionPasses},get renderPasses(){return scene.renderPasses},glass:{...glass},pitcher:{...pitcher,lip:[...lip]}};
window.__fluidV5Version='8.7.1';window.__fluidV5Build='M8.7.1 REAL CONTAINER PASS / FINITE PITCHER / OPEN TUMBLER / M8.6.7 WATER';const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.7.1';document.title='Fluid V8 · M8.7.1 Real Container Pour';console.info('[Fluid V8 M8.7.1] realistic pitcher + open tapered tumbler + finite spout online; added submits 0.');