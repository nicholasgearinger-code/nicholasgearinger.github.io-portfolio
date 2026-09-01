// Fluid V8 M8.7.2 — transparent moving pitcher + receiving glass renderer.
import {dev,queue,cam,canvas,ctx,format,add,sub,mul3,dot,cross,norm,glass,pitcher,profile,outerProfile,spoutPath,scene} from './v5-pitcher-fluid-physics-m872.js';

// ---------------------------------------------------------------------------
// Vessel meshes. Glass is stored in world space. Pitcher vertices stay in local space and
// are transformed in the vertex shader every frame, so visuals and collision share one angle.
// ---------------------------------------------------------------------------
const verts=[];
function pushVertex(p,n,m,obj){verts.push(p[0],p[1],p[2],n[0],n[1],n[2],m,obj,0);}
function pushTri(a,na,b,nb,c,nc,m,obj){pushVertex(a,na,m,obj);pushVertex(b,nb,m,obj);pushVertex(c,nc,m,obj);}
function addFrustum(cx,cz,y0,y1,r0,r1,segments,m,obj,inward=false){
  const dy=y1-y0,dr=r1-r0;
  for(let i=0;i<segments;i++){
    const a0=i*Math.PI*2/segments,a1=(i+1)*Math.PI*2/segments;
    const ring=(a,y,r)=>[cx+Math.cos(a)*r,y,cz+Math.sin(a)*r];
    const p00=ring(a0,y0,r0),p01=ring(a1,y0,r0),p10=ring(a0,y1,r1),p11=ring(a1,y1,r1);
    let n0=norm([Math.cos(a0)*dy,-dr,Math.sin(a0)*dy]),n1=norm([Math.cos(a1)*dy,-dr,Math.sin(a1)*dy]);
    if(inward){n0=mul3(n0,-1);n1=mul3(n1,-1);}
    if(!inward){pushTri(p00,n0,p10,n0,p11,n1,m,obj);pushTri(p00,n0,p11,n1,p01,n1,m,obj);}
    else{pushTri(p00,n0,p11,n1,p10,n0,m,obj);pushTri(p00,n0,p01,n1,p11,n1,m,obj);}
  }
}
function addAnnulus(cx,cz,y,rin,rout,segments,m,obj,up=1){
  const n=[0,up,0];for(let i=0;i<segments;i++){
    const a0=i*Math.PI*2/segments,a1=(i+1)*Math.PI*2/segments;
    const p0=[cx+Math.cos(a0)*rin,y,cz+Math.sin(a0)*rin],p1=[cx+Math.cos(a1)*rin,y,cz+Math.sin(a1)*rin];
    const q0=[cx+Math.cos(a0)*rout,y,cz+Math.sin(a0)*rout],q1=[cx+Math.cos(a1)*rout,y,cz+Math.sin(a1)*rout];
    if(up>0){pushTri(p0,n,q0,n,q1,n,m,obj);pushTri(p0,n,q1,n,p1,n,m,obj);}
    else{pushTri(p0,n,q1,n,q0,n,m,obj);pushTri(p0,n,p1,n,q1,n,m,obj);}
  }
}
function addProfile(points,segments,m,obj,inward=false){for(let j=0;j<points.length-1;j++){const[y0,r0]=points[j],[y1,r1]=points[j+1];addFrustum(0,0,y0,y1,r0,r1,segments,m,obj,inward);}}
function addTubePath(points,radius,around,m,obj){
  const rings=[];for(let i=0;i<points.length;i++){
    const t=norm(sub(points[Math.min(points.length-1,i+1)],points[Math.max(0,i-1)]));let n1=norm(cross(t,[0,0,1]));if(Math.hypot(...n1)<.1)n1=[1,0,0];const n2=norm(cross(t,n1)),ring=[];
    for(let k=0;k<around;k++){const a=k*Math.PI*2/around,rad=add(mul3(n1,Math.cos(a)),mul3(n2,Math.sin(a)));ring.push({p:add(points[i],mul3(rad,radius)),n:rad});}rings.push(ring);
  }
  for(let i=0;i<rings.length-1;i++)for(let k=0;k<around;k++){const k1=(k+1)%around,a=rings[i][k],b=rings[i+1][k],c=rings[i+1][k1],d=rings[i][k1];pushTri(a.p,a.n,b.p,b.n,c.p,c.n,m,obj);pushTri(a.p,a.n,c.p,c.n,d.p,d.n,m,obj);}
}

// Receiving tumbler: outer wall, inner wall, thick base, open rim.
addFrustum(glass.cx,glass.cz,glass.bottom,glass.rim,glass.outerBottom,glass.outerTop,40,0,0,false);
addFrustum(glass.cx,glass.cz,glass.baseTop,glass.rim,glass.innerBottom,glass.innerTop,40,0,0,true);
addAnnulus(glass.cx,glass.cz,glass.rim,glass.innerTop,glass.outerTop,40,2,0,1);
addAnnulus(glass.cx,glass.cz,glass.baseTop,0,glass.innerBottom,40,2,0,1);
addFrustum(glass.cx,glass.cz,glass.bottom,glass.baseTop,glass.outerBottom,glass.outerBottom,40,2,0,false);

// Pitcher: local-space outer/inner body, rim, bottom, spout and handle.
addProfile(outerProfile,44,1,1,false);addProfile(profile,44,1,1,true);
addAnnulus(0,0,.222,.070,.090,44,2,1,1);addAnnulus(0,0,-.255,0,.095,44,2,1,-1);
addTubePath(spoutPath,.047,14,1,1);
const handle=[];for(let i=0;i<=30;i++){const a=.92+(5.36-.92)*i/30;handle.push([-.105+.170*Math.cos(a),.000+.210*Math.sin(a),0]);}addTubePath(handle,.018,10,2,1);

const vertexData=new Float32Array(verts),vertexBuf=dev.createBuffer({label:'m872VesselVertices',size:Math.max(36,vertexData.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
queue.writeBuffer(vertexBuf,0,vertexData);const vertexCount=vertexData.length/9;

const renderWGSL=`
struct UData{vp:mat4x4f,eye:vec4f,light:vec4f,pitch:vec4f}
@group(0) @binding(0) var<uniform> U:UData;
struct VO{@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) mat:f32}
@vertex fn vs(@location(0) p0:vec3f,@location(1) n0:vec3f,@location(2) mat:f32,@location(3) obj:f32)->VO{
 var p=p0;var n=n0;if(obj>.5){let c=cos(U.pitch.w);let s=sin(U.pitch.w);p=U.pitch.xyz+vec3f(c*p0.x-s*p0.y,s*p0.x+c*p0.y,p0.z);n=normalize(vec3f(c*n0.x-s*n0.y,s*n0.x+c*n0.y,n0.z));}
 var o:VO;o.clip=U.vp*vec4f(p,1.0);o.world=p;o.normal=n;o.mat=mat;return o;
}
@fragment fn fs(i:VO,@builtin(front_facing) front:bool)->@location(0) vec4f{
 var n=normalize(i.normal);if(!front){n=-n;}let v=normalize(U.eye.xyz-i.world);let l=normalize(U.light.xyz);let ndv=clamp(abs(dot(n,v)),0.0,1.0);let fres=pow(1.0-ndv,2.2);let spec=pow(max(dot(reflect(-l,n),v),0.0),80.0);
 var base=vec3f(.69,.89,.96);var alpha=.060+.29*fres;if(i.mat>.5&&i.mat<1.5){base=vec3f(.76,.92,.98);alpha=.075+.31*fres;}if(i.mat>1.5){base=vec3f(.86,.96,1.0);alpha=.15+.34*fres;}
 let col=base*(.78+.12*max(n.y,0.0))+vec3f(1.0)*spec*.82;return vec4f(col,clamp(alpha,.04,.56));
}`;
const renderMod=dev.createShaderModule({code:renderWGSL,label:'m872VesselRenderWGSL'});
if(typeof renderMod.getCompilationInfo==='function'){
  const info=await renderMod.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.7.2 render WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const renderPipe=dev.createRenderPipeline({label:'m872TransparentVessels',layout:'auto',vertex:{module:renderMod,entryPoint:'vs',buffers:[{arrayStride:36,attributes:[
  {shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},
  {shaderLocation:2,offset:24,format:'float32'},{shaderLocation:3,offset:28,format:'float32'}
]}]},fragment:{module:renderMod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'}});
const renderUni=dev.createBuffer({label:'m872VesselRenderUniform',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const renderBG=dev.createBindGroup({layout:renderPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderUni}}]}),RF=new Float32Array(28);
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];}
function lookAt(eye,target,up){const z=norm(sub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function matMul(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function encodeVisual(enc){
  if(!scene.active)return;const eye=cam.eye(),aspect=Math.max(1,canvas.width)/Math.max(1,canvas.height),vp=matMul(perspective(Math.PI/4,aspect,.05,100),lookAt(eye,cam.target,[0,1,0]));
  RF.fill(0);RF.set(vp,0);RF[16]=eye[0];RF[17]=eye[1];RF[18]=eye[2];RF[19]=1;RF[20]=-.35;RF[21]=.82;RF[22]=.45;RF[23]=0;RF[24]=pitcher.cx;RF[25]=pitcher.cy;RF[26]=pitcher.cz;RF[27]=pitcher.angle;queue.writeBuffer(renderUni,0,RF);
  const target=ctx.getCurrentTexture().createView(),pass=enc.beginRenderPass({label:'m872TransparentVesselPass',colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});
  pass.setPipeline(renderPipe);pass.setBindGroup(0,renderBG);pass.setVertexBuffer(0,vertexBuf);pass.draw(vertexCount);pass.end();scene.renderPasses++;
}

export {encodeVisual};
