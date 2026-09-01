// Fluid V8 M8.9.2 — high-poly GLB jug using the asset's own glTF material factors.
// GLTFLoader decodes geometry/materials (including Draco/Meshopt if present). Geometry stays
// in the existing native WebGPU vessel pass; the GLB's PBR factors drive the glass shader.
import {dev,queue,format,pitcher,scene} from './v5-pitcher-fluid-physics-m872.js';
if(!dev||!queue||!pitcher||!scene)throw new Error('M8.9.2 jug runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const KEY='__v5M892JugState';
const asset=new URL('../assets/glass_water_jug_high_poly.glb',import.meta.url);
const q=new URLSearchParams(location.search);
const THREE_URL='https://esm.sh/three@0.180.0';
const GLTF_URL='https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
const DRACO_URL='https://esm.sh/three@0.180.0/examples/jsm/loaders/DRACOLoader.js';
const MESHOPT_URL='https://esm.sh/three@0.180.0/examples/jsm/libs/meshopt_decoder.module.js';
const DRACO_DECODER='https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/';

function bounds(a){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<a.length;i+=6)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],a[i+k]);hi[k]=Math.max(hi[k],a[i+k]);}return{lo,hi,ext:[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]]};}
function materialInfo(m){
  const c=m?.color||{r:.3459307,g:.3459307,b:.3459307},s=m?.specularColor||{r:1,g:1,b:1};
  return{name:m?.name||'Material',base:[c.r,c.g,c.b,Number.isFinite(m?.opacity)?m.opacity:.618747],roughness:Number.isFinite(m?.roughness)?m.roughness:0,metalness:Number.isFinite(m?.metalness)?m.metalness:0,clearcoat:Number.isFinite(m?.clearcoat)?m.clearcoat:1,clearcoatRoughness:Number.isFinite(m?.clearcoatRoughness)?m.clearcoatRoughness:.04,specularIntensity:Number.isFinite(m?.specularIntensity)?m.specularIntensity:1,specular:[s.r,s.g,s.b],ior:Number.isFinite(m?.ior)?m.ior:1.5,hasMap:!!m?.map};
}
function fit(src){
  const b=bounds(src),h=Math.max(1e-6,b.ext[1]),targetH=Math.max(.46,Math.min(.60,Number(q.get('jugheight'))||.525)),s=targetH/h;
  const xz=[];for(let i=0;i<src.length;i+=6){const t=(src[i+1]-b.lo[1])/h;if(t>.12&&t<.62)xz.push([src[i],src[i+2]]);}
  const bx=xz.length?xz.reduce((a,p)=>a+p[0],0)/xz.length:(b.lo[0]+b.hi[0])*.5,bz=xz.length?xz.reduce((a,p)=>a+p[1],0)/xz.length:(b.lo[2]+b.hi[2])*.5;
  let sx=bx+1,sz=bz,best=-1;for(let i=0;i<src.length;i+=6){const t=(src[i+1]-b.lo[1])/h;if(t<.72)continue;const dx=src[i]-bx,dz=src[i+2]-bz,r=dx*dx+dz*dz;if(r>best){best=r;sx=src[i];sz=src[i+2];}}
  const autoYaw=Math.atan2(sz-bz,sx-bx),yaw=autoYaw+(Number(q.get('jugyaw'))||0)*Math.PI/180,c=Math.cos(yaw),sn=Math.sin(yaw),yOff=-.255-b.lo[1]*s;
  const out=new Float32Array(src.length);
  for(let i=0;i<src.length;i+=6){const x=(src[i]-bx)*s,z=(src[i+2]-bz)*s,y=src[i+1]*s+yOff,nx=src[i+3],ny=src[i+4],nz=src[i+5],rx=c*x+sn*z,rz=-sn*x+c*z,rnx=c*nx+sn*nz,rnz=-sn*nx+c*nz,l=Math.hypot(rnx,ny,rnz)||1;out[i]=rx;out[i+1]=y;out[i+2]=rz;out[i+3]=rnx/l;out[i+4]=ny/l;out[i+5]=rnz/l;}
  const f=bounds(out);if(!f.ext.every(Number.isFinite)||f.ext.some(v=>v>4)||f.ext[1]<.1)throw new Error(`invalid decoded jug bounds ${f.ext.join('x')}`);
  return{data:out,sourceExt:b.ext,fittedExt:f.ext,targetH,yaw};
}
async function decode(){
  const [THREE,{GLTFLoader},{DRACOLoader},{MeshoptDecoder}]=await Promise.all([import(THREE_URL),import(GLTF_URL),import(DRACO_URL),import(MESHOPT_URL)]);
  const r=await fetch(asset,{cache:'force-cache'});if(!r.ok)throw new Error(`jug HTTP ${r.status}`);const ab=await r.arrayBuffer();
  const loader=new GLTFLoader(),draco=new DRACOLoader();draco.setDecoderPath(DRACO_DECODER);draco.setDecoderConfig({type:'wasm'});loader.setDRACOLoader(draco);loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf=await new Promise((resolve,reject)=>loader.parse(ab,new URL('.',asset).href,resolve,reject));gltf.scene.updateMatrixWorld(true);
  const vals=[];let meshes=0,triangles=0,mat=null;const p=new THREE.Vector3(),n=new THREE.Vector3(),normalMat=new THREE.Matrix3();
  gltf.scene.traverse(obj=>{if(!obj.isMesh||!obj.geometry?.attributes?.position)return;const g=obj.geometry,pos=g.attributes.position,nor=g.attributes.normal,idx=g.index;normalMat.getNormalMatrix(obj.matrixWorld);meshes++;if(!mat)mat=materialInfo(Array.isArray(obj.material)?obj.material[0]:obj.material);const count=idx?idx.count:pos.count;const emit=i=>{p.fromBufferAttribute(pos,i).applyMatrix4(obj.matrixWorld);if(nor)n.fromBufferAttribute(nor,i).applyMatrix3(normalMat).normalize();else n.set(0,1,0);vals.push(p.x,p.y,p.z,n.x,n.y,n.z);};if(nor){for(let k=0;k<count;k++)emit(idx?idx.getX(k):k);triangles+=Math.floor(count/3);}else{for(let k=0;k+2<count;k+=3){const ia=idx?idx.getX(k):k,ib=idx?idx.getX(k+1):k+1,ic=idx?idx.getX(k+2):k+2,a=new THREE.Vector3().fromBufferAttribute(pos,ia).applyMatrix4(obj.matrixWorld),b=new THREE.Vector3().fromBufferAttribute(pos,ib).applyMatrix4(obj.matrixWorld),c=new THREE.Vector3().fromBufferAttribute(pos,ic).applyMatrix4(obj.matrixWorld),fn=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();for(const v of[a,b,c])vals.push(v.x,v.y,v.z,fn.x,fn.y,fn.z);triangles++;}}});draco.dispose();if(!vals.length)throw new Error('decoded GLB contains no renderable triangles');return{data:new Float32Array(vals),meshes,triangles,material:mat||materialInfo(null)};
}
async function build(){
  const decoded=await decode(),g=fit(decoded.data),M=decoded.material,vb=dev.createBuffer({label:'m892JugVB',size:g.data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});queue.writeBuffer(vb,0,g.data);
  const code=`
struct U{vp:mat4x4f,eye:vec4f,light:vec4f,pitch:vec4f,base:vec4f,mat:vec4f,spec:vec4f}
@group(0)@binding(0)var<uniform>u:U;
struct O{@builtin(position)p:vec4f,@location(0)w:vec3f,@location(1)n:vec3f}
@vertex fn vs(@location(0)p:vec3f,@location(1)n:vec3f)->O{
 let c=cos(u.pitch.w);let s=sin(u.pitch.w);let w=u.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
 let nn=normalize(vec3f(c*n.x-s*n.y,s*n.x+c*n.y,n.z));var o:O;o.p=u.vp*vec4f(w,1.0);o.w=w;o.n=nn;return o;
}
@fragment fn fs(i:O,@builtin(front_facing)front:bool)->@location(0)vec4f{
 var n=normalize(i.n);if(!front){n=-n;}let v=normalize(u.eye.xyz-i.w);let l=normalize(u.light.xyz);let h=normalize(v+l);
 let ndv=clamp(abs(dot(n,v)),0.0,1.0);let ndl=max(dot(n,l),0.0);let ndh=max(dot(n,h),0.0);
 let rough=clamp(u.mat.x,.015,1.0);let metal=clamp(u.mat.y,0.0,1.0);let cc=clamp(u.mat.z,0.0,1.0);let ccr=clamp(u.mat.w,.015,1.0);
 let fres=pow(1.0-ndv,5.0);let specPow=mix(18.0,480.0,1.0-rough);let ccPow=mix(36.0,760.0,1.0-ccr);
 let dielectric=.04*u.spec.rgb*u.spec.w;let f0=mix(dielectric,u.base.rgb,metal);let F=f0+(vec3f(1.0)-f0)*fres;
 let spec=pow(ndh,specPow);let clear=cc*pow(ndh,ccPow);let diffuse=u.base.rgb*(1.0-metal)*(.28+.72*ndl);
 let col=diffuse*(vec3f(1.0)-F)+F*(.32+spec*1.65)+vec3f(1.0)*clear*.72;
 let alpha=clamp(u.base.a*(.88+.12*fres)+cc*fres*.045,.03,.96);return vec4f(col,alpha);
}`;
  const sm=dev.createShaderModule({code,label:'m892JugWGSL'});if(typeof sm.getCompilationInfo==='function'){const info=await sm.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('M8.9.2 jug WGSL: '+errors.map(m=>m.message).join(' | '));}
  const pipe=dev.createRenderPipeline({label:'m892OriginalMaterialJug',layout:'auto',vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},fragment:{module:sm,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
  const ub=dev.createBuffer({label:'m892JugUniform',size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ub}}]}),F=new Float32Array(40);
  const state={ready:true,vb,count:g.data.length/6,pipe,ub,bg,F,g,draws:0,meshes:decoded.meshes,triangles:decoded.triangles,material:M,decoder:'GLTFLoader+Draco+Meshopt'};
  state.prepare=({vp,eye})=>{F.fill(0);F.set(vp,0);F[16]=eye[0];F[17]=eye[1];F[18]=eye[2];F[19]=1;F[20]=-.35;F[21]=.82;F[22]=.45;F[24]=pitcher.cx;F[25]=pitcher.cy;F[26]=pitcher.cz;F[27]=pitcher.angle;F.set(M.base,28);F[32]=M.roughness;F[33]=M.metalness;F[34]=M.clearcoat;F[35]=M.clearcoatRoughness;F[36]=M.specular[0];F[37]=M.specular[1];F[38]=M.specular[2];F[39]=M.specularIntensity;queue.writeBuffer(ub,0,F);};
  state.render=pass=>{pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,vb);pass.draw(state.count);state.draws++;};return state;
}
function hud(S){const h=document.querySelector('#m880Hud b');if(h)h.textContent=S?.ready?'M8.9.2 · ORIGINAL GLB MATERIAL':'M8.9.2 · JUG LOAD ERROR';const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.2';const host=document.getElementById('m880Hud');if(!host)return;let d=document.getElementById('m892Material');if(!d){d=document.createElement('div');d.id='m892Material';d.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#b6e7ff';host.appendChild(d);}const sync=()=>{if(!S?.ready){d.textContent='GLB material load error · '+(S?.error||'unknown');return;}const m=S.material;d.textContent=`GLB material · base ${m.base.slice(0,3).map(v=>v.toFixed(3)).join('/')} · α ${m.base[3].toFixed(3)} · rough ${m.roughness.toFixed(2)} · clearcoat ${m.clearcoat.toFixed(2)} · spec ${m.specularIntensity.toFixed(2)} · draws ${S.draws.toLocaleString()}`;};sync();setInterval(sync,500);}
let S=window[KEY];if(phase==='pre'){try{if(!S?.ready){S=await build();window[KEY]=S;}window.__v5PitcherVisualHook=S;}catch(e){console.error('[M8.9.2] jug decode/material failed',e);S={ready:false,error:String(e?.message||e)};window[KEY]=S;delete window.__v5PitcherVisualHook;}}else{if(S?.ready)window.__v5PitcherVisualHook=S;else delete window.__v5PitcherVisualHook;hud(S);}
window.__fluidV5Version='8.9.2';window.__fluidV5Build='M8.9.2 ORIGINAL GLB MATERIAL FACTORS / HIGH-POLY JUG / MESH INTERIOR';window.__v5M892Jug={online:true,phase,modelReady:!!S?.ready,error:S?.error||null,get material(){return S?.material||null},get vertexCount(){return S?.count||0},get draws(){return S?.draws||0}};document.title='Fluid V8 · M8.9.2 Original GLB Material';
