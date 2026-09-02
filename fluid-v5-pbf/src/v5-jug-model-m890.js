// Fluid V8 M8.9.0 hotfix — standards GLB jug replacement.
// Three.js decodes GLB/Draco/Meshopt only; rendering stays in the existing native WebGPU vessel pass.
import {dev,queue,format,pitcher,scene} from './v5-pitcher-fluid-physics-m872.js';
if(!dev||!queue||!pitcher||!scene)throw new Error('M8.9.0 jug runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const KEY='__v5M890JugState';
const asset=new URL('../assets/glass_water_jug_high_poly.glb',import.meta.url);
const q=new URLSearchParams(location.search);

const THREE_URL='https://esm.sh/three@0.180.0';
const GLTF_URL='https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
const DRACO_URL='https://esm.sh/three@0.180.0/examples/jsm/loaders/DRACOLoader.js';
const MESHOPT_URL='https://esm.sh/three@0.180.0/examples/jsm/libs/meshopt_decoder.module.js';
const DRACO_DECODER='https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/';

function rawBounds(a){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.length;i+=6)for(let k=0;k<3;k++){
    lo[k]=Math.min(lo[k],a[i+k]);hi[k]=Math.max(hi[k],a[i+k]);
  }
  return{lo,hi,ext:[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]]};
}

function fitToPitcher(src){
  const b=rawBounds(src),h=Math.max(1e-6,b.ext[1]);
  const targetH=Math.max(.46,Math.min(.60,Number(q.get('jugheight'))||.525));
  const scale=targetH/h;
  // Anchor the model from its lower, rotationally symmetric bowl. Averaging the
  // whole middle section includes the dense handle mesh and shifts the visible
  // jug away from the analytic fluid volume by roughly 7 cm after fitting.
  let coreLoX=Infinity,coreHiX=-Infinity,coreLoZ=Infinity,coreHiZ=-Infinity,coreN=0;
  for(let i=0;i<src.length;i+=6){
    const t=(src[i+1]-b.lo[1])/h;
    if(t>.12&&t<.30){
      coreLoX=Math.min(coreLoX,src[i]);coreHiX=Math.max(coreHiX,src[i]);
      coreLoZ=Math.min(coreLoZ,src[i+2]);coreHiZ=Math.max(coreHiZ,src[i+2]);coreN++;
    }
  }
  const bodyX=coreN?(coreLoX+coreHiX)*.5:(b.lo[0]+b.hi[0])*.5;
  const bodyZ=coreN?(coreLoZ+coreHiZ)*.5:(b.lo[2]+b.hi[2])*.5;
  let spoutX=bodyX+1,spoutZ=bodyZ,best=-1;
  for(let i=0;i<src.length;i+=6){
    const t=(src[i+1]-b.lo[1])/h;if(t<.72)continue;
    const dx=src[i]-bodyX,dz=src[i+2]-bodyZ,r=dx*dx+dz*dz;
    if(r>best){best=r;spoutX=src[i];spoutZ=src[i+2];}
  }
  // The farthest upper feature in this asset is the handle, not the pouring lip.
  // Face the opposite side (+local X) toward the receiver.
  const handleYaw=Math.atan2(spoutZ-bodyZ,spoutX-bodyX);
  const yaw=handleYaw+Math.PI+(Number(q.get('jugyaw'))||0)*Math.PI/180;
  const c=Math.cos(yaw),s=Math.sin(yaw),baseY=-.255,yOff=baseY-b.lo[1]*scale;
  const out=new Float32Array(src.length);
  for(let i=0;i<src.length;i+=6){
    const x=(src[i]-bodyX)*scale,y=src[i+1]*scale+yOff,z=(src[i+2]-bodyZ)*scale;
    const nx=src[i+3],ny=src[i+4],nz=src[i+5];
    const rx=c*x+s*z,rz=-s*x+c*z,rnx=c*nx+s*nz,rnz=-s*nx+c*nz,l=Math.hypot(rnx,ny,rnz)||1;
    out[i]=rx;out[i+1]=y;out[i+2]=rz;out[i+3]=rnx/l;out[i+4]=ny/l;out[i+5]=rnz/l;
  }
  const f=rawBounds(out);
  if(!f.ext.every(Number.isFinite)||f.ext.some(v=>v>4)||f.ext[1]<.1)throw new Error(`invalid decoded jug bounds ${f.ext.join('x')}`);
  return{data:out,sourceExt:b.ext,fittedExt:f.ext,targetH,yaw,bodyCenter:[bodyX,bodyZ],alignment:'lower-bowl-extents'};
}

async function decodeGLB(){
  const [THREE,{GLTFLoader},{DRACOLoader},{MeshoptDecoder}]=await Promise.all([
    import(THREE_URL),import(GLTF_URL),import(DRACO_URL),import(MESHOPT_URL)
  ]);
  const r=await fetch(asset,{cache:'force-cache'});if(!r.ok)throw new Error(`jug HTTP ${r.status}`);
  const ab=await r.arrayBuffer();
  const loader=new GLTFLoader();
  const draco=new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER);draco.setDecoderConfig({type:'wasm'});
  loader.setDRACOLoader(draco);loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf=await new Promise((resolve,reject)=>loader.parse(ab,new URL('.',asset).href,resolve,reject));
  gltf.scene.updateMatrixWorld(true);
  const vals=[];let meshes=0,triangles=0;
  const p=new THREE.Vector3(),n=new THREE.Vector3(),normalMat=new THREE.Matrix3();
  gltf.scene.traverse(obj=>{
    if(!obj.isMesh||!obj.geometry?.attributes?.position)return;
    const g=obj.geometry,pos=g.attributes.position,nor=g.attributes.normal,idx=g.index;
    normalMat.getNormalMatrix(obj.matrixWorld);meshes++;
    const count=idx?idx.count:pos.count;
    const emit=i=>{
      p.fromBufferAttribute(pos,i).applyMatrix4(obj.matrixWorld);
      if(nor)n.fromBufferAttribute(nor,i).applyMatrix3(normalMat).normalize();else n.set(0,1,0);
      vals.push(p.x,p.y,p.z,n.x,n.y,n.z);
    };
    if(nor){
      for(let k=0;k<count;k++)emit(idx?idx.getX(k):k);
      triangles+=Math.floor(count/3);
    }else{
      for(let k=0;k+2<count;k+=3){
        const ia=idx?idx.getX(k):k,ib=idx?idx.getX(k+1):k+1,ic=idx?idx.getX(k+2):k+2;
        const a=new THREE.Vector3().fromBufferAttribute(pos,ia).applyMatrix4(obj.matrixWorld);
        const b=new THREE.Vector3().fromBufferAttribute(pos,ib).applyMatrix4(obj.matrixWorld);
        const c=new THREE.Vector3().fromBufferAttribute(pos,ic).applyMatrix4(obj.matrixWorld);
        const fn=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
        for(const v of [a,b,c])vals.push(v.x,v.y,v.z,fn.x,fn.y,fn.z);
        triangles++;
      }
    }
  });
  draco.dispose();
  if(!vals.length)throw new Error('decoded GLB contains no renderable triangles');
  return{data:new Float32Array(vals),meshes,triangles};
}

async function build(){
  const decoded=await decodeGLB(),g=fitToPitcher(decoded.data);
  const vb=dev.createBuffer({label:'m890JugVB',size:g.data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  queue.writeBuffer(vb,0,g.data);
  const code=`
struct U{vp:mat4x4f,eye:vec4f,light:vec4f,pitch:vec4f}
@group(0) @binding(0) var<uniform> u:U;
struct O{@builtin(position) p:vec4f,@location(0) w:vec3f,@location(1) n:vec3f}
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f)->O{
  let c=cos(u.pitch.w);
  let s=sin(u.pitch.w);
  let w=u.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
  let nn=normalize(vec3f(c*n.x-s*n.y,s*n.x+c*n.y,n.z));
  var o:O;
  o.p=u.vp*vec4f(w,1.0);
  o.w=w;
  o.n=nn;
  return o;
}
@fragment fn fs(i:O,@builtin(front_facing) front:bool)->@location(0) vec4f{
  var n=normalize(i.n);
  if(!front){n=-n;}
  let v=normalize(u.eye.xyz-i.w);
  let l=normalize(u.light.xyz);
  let ndv=clamp(abs(dot(n,v)),0.0,1.0);
  let fres=pow(1.0-ndv,2.35);
  let spec=pow(max(dot(reflect(-l,n),v),0.0),120.0);
  let edge=pow(1.0-ndv,5.0);
  let col=vec3f(.76,.93,.985)*(.74+.15*max(n.y,0.0))+vec3f(1.0)*(spec*.90+edge*.34);
  return vec4f(col,clamp(.075+.38*fres+.10*edge,.065,.56));
}`;
  const sm=dev.createShaderModule({code,label:'m890JugWGSL'});
  if(typeof sm.getCompilationInfo==='function'){
    const info=await sm.getCompilationInfo();
    const errors=(info.messages||[]).filter(m=>m.type==='error');
    if(errors.length)throw new Error('M8.9.0 jug WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
  }
  const pipe=dev.createRenderPipeline({
    label:'m890DecodedHighPolyJug',layout:'auto',
    vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[
      {shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}
    ]}]},
    fragment:{module:sm,entryPoint:'fs',targets:[{format,blend:{
      color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
      alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
    }}]},primitive:{topology:'triangle-list',cullMode:'none'}
  });
  const ub=dev.createBuffer({label:'m890JugUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ub}}]});
  const F=new Float32Array(28);
  const state={ready:true,vb,count:g.data.length/6,pipe,ub,bg,F,g,draws:0,meshes:decoded.meshes,triangles:decoded.triangles,decoder:'GLTFLoader+Draco+Meshopt'};
  state.prepare=({vp,eye})=>{
    F.fill(0);F.set(vp,0);F[16]=eye[0];F[17]=eye[1];F[18]=eye[2];F[19]=1;
    F[20]=-.35;F[21]=.82;F[22]=.45;F[24]=pitcher.cx;F[25]=pitcher.cy;F[26]=pitcher.cz;F[27]=pitcher.angle;
    queue.writeBuffer(ub,0,F);
  };
  state.render=pass=>{
    pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,vb);pass.draw(state.count);state.draws++;
  };
  return state;
}

function installHud(S){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent=S?.ready?'M8.9.0 · GLB JUG REPLACEMENT':'M8.9.0 · JUG LOAD ERROR';
  const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.9.0';
  const hud=document.getElementById('m880Hud');if(!hud)return;
  let d=document.getElementById('m890Status');
  if(!d){d=document.createElement('div');d.id='m890Status';d.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#91dfe7';hud.appendChild(d);}
  const sync=()=>{
    if(!S?.ready){d.textContent='new jug load error · '+(S?.error||'unknown');return;}
    const f=S.g.fittedExt.map(v=>v.toFixed(2)).join('×');
    d.textContent=`NEW JUG ACTIVE · ${S.meshes} meshes · ${S.triangles.toLocaleString()} tris · fit ${f} m · draws ${S.draws.toLocaleString()}`;
  };
  sync();setInterval(sync,500);
}

let S=window[KEY];
if(phase==='pre'){
  try{
    if(!S?.ready){S=await build();window[KEY]=S;}
    window.__v5PitcherVisualHook=S;
  }catch(e){
    console.error('[M8.9.0] jug decode failed',e);
    S={ready:false,error:String(e?.message||e)};window[KEY]=S;delete window.__v5PitcherVisualHook;
  }
}else{
  if(S?.ready)window.__v5PitcherVisualHook=S;else delete window.__v5PitcherVisualHook;
  installHud(S);
}

window.__fluidV5Version='8.9.0';
window.__fluidV5Build='M8.9.0 STANDARDS GLB JUG REPLACEMENT / WGSL HOTFIX / DRACO + MESHOPT / M8.8.8 CLEAN CATCH';
window.__v5M890={online:true,phase,modelReady:!!S?.ready,error:S?.error||null,get vertexCount(){return S?.count||0},get draws(){return S?.draws||0},get meshes(){return S?.meshes||0},get triangles(){return S?.triangles||0}};
document.title='Fluid V8 · M8.9.0 High-Poly Jug Replacement';
