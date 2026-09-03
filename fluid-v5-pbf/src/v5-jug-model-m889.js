// Fluid V8 M8.8.9 hotfix — high-poly GLB jug visual swap.
// M8.8.8 analytic pitcher boundaries still own the water. This module replaces only
// the visible pitcher and plugs directly into the existing M8.8 vessel render pass.
import {dev,queue,format,pitcher,scene,norm,sub,cross} from './v5-pitcher-fluid-physics-m872.js';
if(!dev||!queue||!pitcher||!scene)throw new Error('M8.8.9 jug runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const KEY='__v5M889JugState';
const asset=new URL('../assets/glass_water_jug_high_poly.glb',import.meta.url);
const q=new URLSearchParams(location.search);
const mul=(a,b)=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o};
const I=()=>[1,0,0,0,0,1,0,0,0,1,0,0,0,0,1];

function nm(n){
  if(n.matrix?.length===16)return n.matrix;
  const t=n.translation||[0,0,0],s=n.scale||[1,1,1],r=n.rotation||[0,0,0,1];
  const [x,y,z,w]=r,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  return[(1-2*(yy+zz))*s[0],(2*(xy+wz))*s[0],(2*(xz-wy))*s[0],0,
    (2*(xy-wz))*s[1],(1-2*(xx+zz))*s[1],(2*(yz+wx))*s[1],0,
    (2*(xz+wy))*s[2],(2*(yz-wx))*s[2],(1-2*(xx+yy))*s[2],0,t[0],t[1],t[2],1];
}
const pt=(m,x,y,z)=>[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
const nv=(m,x,y,z)=>{const a=m[0]*x+m[4]*y+m[8]*z,b=m[1]*x+m[5]*y+m[9]*z,c=m[2]*x+m[6]*y+m[10]*z,l=Math.hypot(a,b,c)||1;return[a/l,b/l,c/l]};

function glb(ab){
  const d=new DataView(ab);
  if(d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2)throw Error('invalid GLB');
  let o=12,j,b;
  while(o+8<=d.byteLength){
    const n=d.getUint32(o,true),t=d.getUint32(o+4,true),s=o+8;
    if(t===0x4e4f534a)j=JSON.parse(new TextDecoder().decode(new Uint8Array(ab,s,n)).replace(/\0+$/,'').trim());
    if(t===0x004e4942)b=new Uint8Array(ab,s,n);o=s+n;
  }
  if(!j||!b)throw Error('GLB chunks missing');
  if(j.extensionsRequired?.some(x=>/draco|meshopt/i.test(x)))throw Error('compressed GLB unsupported');
  return[j,b];
}

function mesh(j,b){
  const D=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const cs={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
  const comps={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  const rd=i=>{
    const a=j.accessors[i],v=j.bufferViews[a?.bufferView],c=cs[a?.componentType],z=comps[a?.type];
    if(!a||!v||!c||!z||a.sparse||v.extensions?.EXT_meshopt_compression)throw Error('unsupported GLB accessor');
    const st=v.byteStride||c[0]*z,base=(v.byteOffset||0)+(a.byteOffset||0),out=[];
    for(let k=0;k<a.count;k++)for(let x=0;x<z;x++)out.push(D[c[1]](base+k*st+x*c[0],true));
    return out;
  };
  const out=[];
  function walk(ni,p){
    const n=j.nodes[ni],w=mul(p,nm(n));
    if(n.mesh!=null)for(const g of j.meshes[n.mesh].primitives||[]){
      if((g.mode??4)!==4||g.attributes.POSITION==null)continue;
      if(g.extensions?.KHR_draco_mesh_compression)throw Error('Draco GLB unsupported');
      const P=rd(g.attributes.POSITION),N=g.attributes.NORMAL!=null?rd(g.attributes.NORMAL):null;
      const ids=g.indices!=null?rd(g.indices):Array.from({length:P.length/3},(_,i)=>i);
      for(let k=0;k+2<ids.length;k+=3){
        const tri=ids.slice(k,k+3),wp=tri.map(i=>pt(w,P[i*3],P[i*3+1],P[i*3+2]));
        let fn;if(!N){const a=sub(wp[1],wp[0]),c=sub(wp[2],wp[0]);fn=norm(cross(a,c));}
        for(let x=0;x<3;x++){
          const i=tri[x],nn=N?nv(w,N[i*3],N[i*3+1],N[i*3+2]):fn;out.push(...wp[x],...nn);
        }
      }
    }
    for(const c of n.children||[])walk(c,w);
  }
  for(const r of j.scenes?.[j.scene||0]?.nodes||[])walk(r,I());
  if(!out.length)throw Error('GLB has no triangles');
  return new Float32Array(out);
}

function bounds(a){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.length;i+=6)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],a[i+k]);hi[k]=Math.max(hi[k],a[i+k]);}
  return{lo,hi,ext:[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]]};
}
const axisName=i=>['X','Y','Z'][i];
const permSign=p=>((p[0]-p[1])*(p[0]-p[2])*(p[1]-p[2])<0?-1:1);

function chooseAxes(ext,H){
  const forced=(q.get('jugup')||'').toLowerCase();
  const forcedAxis=forced==='x'?0:forced==='y'?1:forced==='z'?2:null;
  let best=null;
  for(let up=0;up<3;up++){
    if(forcedAxis!==null&&up!==forcedAxis)continue;
    const rem=[0,1,2].filter(i=>i!==up).sort((a,b)=>ext[b]-ext[a]),xAxis=rem[0],zAxis=rem[1];
    const sc=H/Math.max(ext[up],1e-6),w=ext[xAxis]*sc,d=ext[zAxis]*sc;
    const score=Math.abs(Math.log(Math.max(w,1e-6)/.46))+Math.abs(Math.log(Math.max(d,1e-6)/.28))
      +(w>.72?(w-.72)*8:0)+(d>.56?(d-.56)*8:0)+(w<.18?(.18-w)*8:0)+(d<.08?(.08-d)*8:0);
    if(!best||score<best.score)best={up,xAxis,zAxis,sc,w,d,score};
  }
  return best;
}

function fit(a){
  const src=bounds(a),c=[(src.lo[0]+src.hi[0])/2,(src.lo[1]+src.hi[1])/2,(src.lo[2]+src.hi[2])/2];
  const H=Math.max(.42,Math.min(.62,Number(q.get('jugheight'))||.50)),ax=chooseAxes(src.ext,H);
  if(!ax)throw Error('jug axis fit failed');
  const handed=permSign([ax.xAxis,ax.up,ax.zAxis]);
  const tmp=new Float32Array(a.length);
  for(let i=0;i<a.length;i+=6){
    const p=[a[i]-c[0],a[i+1]-c[1],a[i+2]-c[2]],n=[a[i+3],a[i+4],a[i+5]];
    tmp[i]=p[ax.xAxis]*ax.sc;tmp[i+1]=p[ax.up]*ax.sc-.015;tmp[i+2]=p[ax.zAxis]*ax.sc*handed;
    tmp[i+3]=n[ax.xAxis];tmp[i+4]=n[ax.up];tmp[i+5]=n[ax.zAxis]*handed;
  }
  const b0=bounds(tmp),h=Math.max(1e-6,b0.ext[1]);let fx=1,fz=0,best=-1;
  for(let i=0;i<tmp.length;i+=6){
    if((tmp[i+1]-b0.lo[1])/h<.70)continue;
    const x=tmp[i],z=tmp[i+2],r=x*x+z*z;if(r>best){best=r;fx=x;fz=z;}
  }
  const yaw=Math.atan2(fz,fx)+(Number(q.get('jugyaw'))||0)*Math.PI/180,co=Math.cos(yaw),si=Math.sin(yaw),o=new Float32Array(tmp.length);
  for(let i=0;i<tmp.length;i+=6){
    const x=tmp[i],y=tmp[i+1],z=tmp[i+2],nx=tmp[i+3],ny=tmp[i+4],nz=tmp[i+5];
    const rx=co*x+si*z,rz=-si*x+co*z,rnx=co*nx+si*nz,rnz=-si*nx+co*nz,l=Math.hypot(rnx,ny,rnz)||1;
    o[i]=rx;o[i+1]=y;o[i+2]=rz;o[i+3]=rnx/l;o[i+4]=ny/l;o[i+5]=rnz/l;
  }
  const fitted=bounds(o);
  if(!fitted.ext.every(Number.isFinite)||fitted.ext[0]>.80||fitted.ext[2]>.65||fitted.ext[1]<.38||fitted.ext[1]>.70)
    throw Error(`unsafe jug fit ${fitted.ext.map(v=>v.toFixed(3)).join('x')}`);
  return{data:o,yaw,H,up:axisName(ax.up),sourceExt:src.ext,fittedExt:fitted.ext};
}

async function build(){
  const r=await fetch(asset,{cache:'force-cache'});if(!r.ok)throw Error(`jug HTTP ${r.status}`);
  const[j,b]=glb(await r.arrayBuffer()),g=fit(mesh(j,b));
  const vb=dev.createBuffer({label:'m889JugVB',size:g.data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});queue.writeBuffer(vb,0,g.data);
  const code=`
struct U{vp:mat4x4f,eye:vec4f,light:vec4f,pitch:vec4f}
@group(0)@binding(0)var<uniform>u:U;
struct O{@builtin(position)p:vec4f,@location(0)w:vec3f,@location(1)n:vec3f}
@vertex fn vs(@location(0)p:vec3f,@location(1)n:vec3f)->O{
 let c=cos(u.pitch.w);let s=sin(u.pitch.w);let w=u.pitch.xyz+vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
 let nn=normalize(vec3f(c*n.x-s*n.y,s*n.x+c*n.y,n.z));var o:O;o.p=u.vp*vec4f(w,1);o.w=w;o.n=nn;return o
}
@fragment fn fs(i:O,@builtin(front_facing)f:bool)->@location(0)vec4f{
 var n=normalize(i.n);if(!f){n=-n}let v=normalize(u.eye.xyz-i.w);let l=normalize(u.light.xyz);let d=clamp(abs(dot(n,v)),0,1);
 let fr=pow(1-d,2.6);let sp=pow(max(dot(reflect(-l,n),v),0),110);let col=vec3f(.72,.91,.98)*(.76+.14*max(n.y,0))+vec3f(1)*(sp*.95+fr*.30);
 return vec4f(col,clamp(.09+.40*fr,.075,.52))
}`;
  const sm=dev.createShaderModule({code,label:'m889JugWGSL'});
  if(typeof sm.getCompilationInfo==='function'){
    const info=await sm.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
    if(errors.length)throw Error('M8.8.9 jug WGSL: '+errors.map(m=>m.message).join(' | '));
  }
  const pipe=dev.createRenderPipeline({label:'m889HighPolyJug',layout:'auto',vertex:{module:sm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[
    {shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}
  ]}]},fragment:{module:sm,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
  const ub=dev.createBuffer({label:'m889JugUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ub}}]});
  const F=new Float32Array(28);
  const state={ready:true,vb,count:g.data.length/6,pipe,ub,bg,F,g,draws:0};
  state.prepare=({vp,eye})=>{
    F.fill(0);F.set(vp,0);F[16]=eye[0];F[17]=eye[1];F[18]=eye[2];F[19]=1;F[20]=-.35;F[21]=.82;F[22]=.45;
    F[24]=pitcher.cx;F[25]=pitcher.cy;F[26]=pitcher.cz;F[27]=pitcher.angle;queue.writeBuffer(ub,0,F);
  };
  state.render=pass=>{pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.setVertexBuffer(0,vb);pass.draw(state.count);state.draws++;};
  return state;
}

function installHud(S){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent=S?.ready?'M8.8.9 · HIGH-POLY GLASS JUG':'M8.8.9 · JUG FALLBACK';
  const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.8.9';
  const hud=document.getElementById('m880Hud');if(!hud)return;
  let d=document.getElementById('m889Status');if(!d){d=document.createElement('div');d.id='m889Status';d.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#91dfe7';hud.appendChild(d);}
  const sync=()=>{
    if(!S?.ready){d.textContent='jug visual fallback · '+(S?.error||'model unavailable');return;}
    const f=S.g.fittedExt.map(v=>v.toFixed(2)).join('×');d.textContent=`jug ${S.count.toLocaleString()} verts · Y-up from ${S.g.up} · fit ${f} m · draws ${S.draws.toLocaleString()}`;
  };
  sync();setInterval(sync,500);
}

let S=window[KEY];
if(phase==='pre'){
  try{
    if(!S?.ready){S=await build();window[KEY]=S;}
    window.__v5PitcherVisualHook=S;
  }catch(e){
    console.error('[M8.8.9] jug fallback',e);S={ready:false,error:String(e?.message||e)};window[KEY]=S;delete window.__v5PitcherVisualHook;
  }
}else{
  if(S?.ready)window.__v5PitcherVisualHook=S;else delete window.__v5PitcherVisualHook;
  installHud(S);
}

window.__fluidV5Version='8.8.9';
window.__fluidV5Build='M8.8.9 HIGH-POLY GLASS JUG / SAME-PASS RENDER HOTFIX / M8.8.8 CLEAN CATCH / M8.8.1 FLUID PHYSICS';
window.__v5M889={online:true,phase,modelReady:!!S?.ready,error:S?.error||null,get vertexCount(){return S?.count||0},get draws(){return S?.draws||0},get upAxis(){return S?.g?.up||null},get yawDeg(){return S?.g?S.g.yaw*180/Math.PI:0}};
document.title='Fluid V8 · M8.8.9 High-Poly Glass Jug';
