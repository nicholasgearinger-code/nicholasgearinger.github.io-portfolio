// Rift Water Lab 22.0 — validated native WebGPU inverse spectral FFT.
// Keep CPU initialization deterministic and finite; GPU performs dispersion,
// two radix-2 inverse FFT axes, and keeps its height field resident in storage.
// Separate GPU device from Three.js: readback currently supplies mesh/boat
// sampling, until native Three.js WebGPU buffer sharing is implemented.
export async function createGPUFFTOcean({resolution=64,domain=96,onError=()=>{},sharedDevice=null}={}){
 if(!navigator.gpu)throw Error('WebGPU API unavailable');
 const n=resolution|0;
 if(![64,128].includes(n))throw Error('FFT grid must be 64 or 128');
 const ownsDevice=!sharedDevice;
 const adapter=ownsDevice?await navigator.gpu.requestAdapter({powerPreference:'high-performance'}):null;
 if(ownsDevice&&!adapter)throw Error('WebGPU compute adapter unavailable');
 const device=sharedDevice||await adapter.requestDevice();
 const cells=n*n,bytes=cells*8,stages=Math.log2(n),tau=Math.PI*2;
 let rng=0x7b5d32e1;
 function random(){
  rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;
  return ((rng>>>0)+.5)/4294967296;
 }
 function gaussian(){
  const r=Math.sqrt(-2*Math.log(Math.max(1e-7,random())));
  const a=tau*random();return [r*Math.cos(a),r*Math.sin(a)];
 }
 const initial=new Float32Array(cells*2);
 let energy=0;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const fx=x<=n/2?x:x-n,fy=y<=n/2?y:y-n;
  const kx=tau*fx/domain,kz=tau*fy/domain,k=Math.hypot(kx,kz);
  const i=(y*n+x)*2;
  if(k<.025||k>3){initial[i]=0;initial[i+1]=0;continue;}
  const wind=(kx*.86+kz*.51)/k;
  const spread=.18+.82*Math.pow(Math.max(0,wind),3);
  const amp=(.9*Math.exp(-.5*((k-.11)/.065)**2)
   +.30*Math.exp(-.5*((k-.36)/.21)**2)
   +.06*Math.exp(-.5*((k-1.05)/.57)**2))*spread;
  const [real,imag]=gaussian();
  initial[i]=real*amp;initial[i+1]=imag*amp;
  energy+=initial[i]*initial[i]+initial[i+1]*initial[i+1];
 }
 if(!Number.isFinite(energy)||energy<.001)throw Error('Invalid initial spectral energy');
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const h0=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const a=device.createBuffer({size:bytes,usage:storage});
 const b=device.createBuffer({size:bytes,usage:storage});
 const staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(h0,0,initial);
 const evolution=device.createShaderModule({code:`
const N:u32=${n}u;
const DOMAIN:f32=${domain}.0;
const TAU:f32=6.283185307179586;
struct Params { time:f32, strength:f32, _pad0:f32, _pad1:f32 };
@group(0) @binding(0) var<storage,read> seed:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> field:array<vec2f>;
@group(0) @binding(2) var<uniform> p:Params;
fn complexMul(a:vec2f,b:vec2f)->vec2f{
 return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);
}
fn reversed(v:u32)->u32{
 var x=v;var r=0u;
 for(var j=0u;j<${stages}u;j=j+1u){r=(r<<1u)|(x&1u);x=x>>1u;}
 return r;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let x=id.x;let y=id.y;
 if(x>=N||y>=N){return;}
 let fx=select(i32(x),i32(x)-i32(N),x>N/2u);
 let fy=select(i32(y),i32(y)-i32(N),y>N/2u);
 let k=vec2f(f32(fx),f32(fy))*(TAU/DOMAIN);
 let w=sqrt(9.81*length(k)*tanh(length(k)*60.0));
 let angle=w*p.time;
 let plus=vec2f(cos(angle),sin(angle));
 let minus=vec2f(cos(angle),-sin(angle));
 let h=seed[y*N+x];
 let opposite=seed[((N-y)%N)*N+((N-x)%N)];
 let conjugate=vec2f(opposite.x,-opposite.y);
 let value=complexMul(h,plus)+complexMul(conjugate,minus);
 // Normalize in spatial domain after the two inverse transforms.
 // Fixed amplitude is calibrated in meters and clamped only at readback.
 field[reversed(y)*N+reversed(x)]=value*p.strength;
}`});
 const butterfly=device.createShaderModule({code:`
const N:u32=${n}u;
const TAU:f32=6.283185307179586;
struct Step { half:u32, axis:u32, _pad0:u32, _pad1:u32 };
@group(0) @binding(0) var<storage,read> sourceField:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> targetField:array<vec2f>;
@group(0) @binding(2) var<uniform> step:Step;
fn cmul(a:vec2f,b:vec2f)->vec2f {
 return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let x=id.x;let y=id.y;
 if(x>=N||y>=N){return;}
 let j=select(x,y,step.axis==1u);
 let width=step.half*2u;
 let offset=j%width;
 let k=offset%step.half;
 let start=(j/width)*width;
 let index0=start+k;
 let index1=index0+step.half;
 var ia:u32;var ib:u32;
 if(step.axis==0u){ia=y*N+index0;ib=y*N+index1;}
 else{ia=index0*N+x;ib=index1*N+x;}
 let a=sourceField[ia];let b=sourceField[ib];
 let phase=TAU*f32(k)/f32(width);
 let rotating=cmul(b,vec2f(cos(phase),sin(phase)));
 targetField[y*N+x]=select(a+rotating,a-rotating,offset>=step.half);
}`});
 for(const [name,shader]of [['evolution',evolution],['butterfly',butterfly]]){
  const info=await shader.getCompilationInfo();
  const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(name+': '+errors.map(m=>m.message).join('; ').slice(0,350));
 }
 const evolutionPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:evolution,entryPoint:'main'}});
 const butterflyPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:butterfly,entryPoint:'main'}});
 const initBG=device.createBindGroup({layout:evolutionPipeline.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:h0}},{binding:1,resource:{buffer:a}},
  {binding:2,resource:{buffer:params}}
 ]});
 let src=a,dst=b,passes=[],uniforms=[];
 for(let axis=0;axis<2;axis++)for(let j=0;j<stages;j++){
  const cfg=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(cfg,0,new Uint32Array([1<<j,axis,0,0]));
  uniforms.push(cfg);
  passes.push(device.createBindGroup({layout:butterflyPipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:src}},{binding:1,resource:{buffer:dst}},
   {binding:2,resource:{buffer:cfg}}
  ]}));
  [src,dst]=[dst,src];
 }
 let latest=null,busy=false,disposed=false,frameCount=0,failures=0,rms=0,
  peak=0,imaginaryLeak=0,verifiedFrames=0,lastRequest=-100;
 device.lost.then(info=>{
  if(!disposed){disposed=true;onError('GPU compute device lost: '+info.message);}
 }).catch(()=>{});

 let renderTarget=null,packPipeline=null,packBuffer=null,packGroup=null,renderFrames=0,renderFault='',renderPending=false;
 async function attachRenderTexture(texture){
  if(disposed||!texture||texture.format!=='rgba8unorm'||texture.width!==n||texture.height!==n||!(texture.usage&GPUTextureUsage.COPY_DST))return false;
  if(renderTarget===texture&&packPipeline)return true;
  if(renderPending)return false;renderPending=true;
  try{
   if(!packPipeline){
    const module=device.createShaderModule({code:`
@group(0) @binding(0) var<storage,read> field:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> pixels:array<u32>;
@compute @workgroup_size(64) fn pack(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${cells}u){return;}
 let h=clamp(field[i].x/f32(${cells}u),-12.,12.);
 let v=u32(round((h+12.)/24.*65535.));
 pixels[i]=(v>>8u)|((v&255u)<<8u)|0xff000000u;
}`});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error('FFT texture pack shader compilation');
    packPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'pack'}});
    if(disposed)return false;
    packBuffer=device.createBuffer({size:cells*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    packGroup=device.createBindGroup({layout:packPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:src}},{binding:1,resource:{buffer:packBuffer}}]});
   }
   renderTarget=texture;renderFrames=0;return true;
  }catch(e){renderFault=String(e?.message||e);return false;}finally{renderPending=false;}
 }
 function detachRenderTexture(texture){if(!texture||renderTarget===texture){renderTarget=null;renderFrames=0;}}
 function publishRenderTexture(){
  if(!renderTarget||!packPipeline||renderFault)return;
  let scoped=false;
  try{
   device.pushErrorScope('validation');scoped=true;
   const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(packPipeline);pass.setBindGroup(0,packGroup);pass.dispatchWorkgroups(Math.ceil(cells/64));pass.end();
   enc.copyBufferToTexture({buffer:packBuffer,bytesPerRow:n*4,rowsPerImage:n},{texture:renderTarget},{width:n,height:n,depthOrArrayLayers:1});
   device.queue.submit([enc.finish()]);const target=renderTarget;
   const validation=device.popErrorScope();scoped=false;
   validation.then(err=>{if(err){renderFault=err.message;renderFrames=0;}else if(renderTarget===target&&!disposed)renderFrames++;}).catch(e=>{renderFault=String(e);renderFrames=0;});
  }catch(e){if(scoped)device.popErrorScope().catch(()=>{});renderFault=String(e);renderFrames=0;}
 }

 function request(t,{power=1}={}){
  if(disposed||busy||t-lastRequest<.10)return;
  busy=true;lastRequest=t;
  try{
   // Spatial IFFT yields N² times the inverse DFT; normalize in CPU
   // readback, allowing the spectral seed to retain its natural scale.
   device.queue.writeBuffer(params,0,new Float32Array([t,Math.max(0,Math.min(5,power))*48,0,0]));
   const encoder=device.createCommandEncoder();
   let pass=encoder.beginComputePass();
   pass.setPipeline(evolutionPipeline);pass.setBindGroup(0,initBG);
   pass.dispatchWorkgroups(n/8,n/8);pass.end();
   for(const bg of passes){
    pass=encoder.beginComputePass();pass.setPipeline(butterflyPipeline);
    pass.setBindGroup(0,bg);pass.dispatchWorkgroups(n/8,n/8);pass.end();
   }
   encoder.copyBufferToBuffer(src,0,staging,0,bytes);
   device.queue.submit([encoder.finish()]);
   staging.mapAsync(GPUMapMode.READ).then(()=>{
    if(disposed){staging.unmap();staging.destroy();return;}
    const candidate=new Float32Array(staging.getMappedRange()).slice();
    staging.unmap();
    let squares=0,imagSquares=0,nextPeak=0,finite=true;
    for(let i=0;i<candidate.length;i+=2){
     const re=candidate[i]/cells,im=candidate[i+1]/cells;
     if(!Number.isFinite(re)||!Number.isFinite(im)){finite=false;break;}
     squares+=re*re;imagSquares+=im*im;
     nextPeak=Math.max(nextPeak,Math.abs(re));
    }
    const nextRms=Math.sqrt(squares/cells),nextLeak=Math.sqrt(imagSquares/cells);
    if(!finite||!Number.isFinite(nextRms)||nextPeak>12||nextLeak>Math.max(.01,nextRms*.04)){
     failures++;verifiedFrames=0;latest=null;rms=0;busy=false;
     if(failures<=2)onError('FFT validation failed: '+(!finite?'nonfinite field':nextLeak>Math.max(.01,nextRms*.04)?'conjugate symmetry':'excess height'));
     return;
    }
    latest=candidate;rms=nextRms;peak=nextPeak;imaginaryLeak=nextLeak;
    frameCount++;verifiedFrames++;publishRenderTexture();busy=false;
   }).catch(error=>{busy=false;failures++;if(failures<=2)onError(String(error));});
  }catch(error){busy=false;failures++;if(failures<=2)onError(String(error));}
 }
 function sample(x,z){
  if(!latest||!Number.isFinite(x)||!Number.isFinite(z))return 0;
  const u=((x/domain)%1+1)%1*n,v=((z/domain)%1+1)%1*n;
  const ix=Math.floor(u),iy=Math.floor(v),tx=u-ix,ty=v-iy;
  const a=latest[(iy*n+ix)*2],b=latest[(iy*n+(ix+1)%n)*2];
  const c=latest[(((iy+1)%n)*n+ix)*2];
  const d=latest[(((iy+1)%n)*n+(ix+1)%n)*2];
  const result=((a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty)/cells;
  return Number.isFinite(result)?Math.max(-12,Math.min(12,result)):0;
 }
 function dispose(){
  disposed=true;renderTarget=null;packBuffer?.destroy();h0.destroy();a.destroy();b.destroy();params.destroy();
  for(const uniform of uniforms)uniform.destroy();
  if(!busy)staging.destroy();if(ownsDevice)device.destroy();
 }
 return {request,sample,dispose,device,shared:!ownsDevice,attachRenderTexture,detachRenderTexture,get renderFrames(){return renderFrames;},get renderFault(){return renderFault;} ,get ready(){return latest!==null&&verifiedFrames>=3;},
  get validationFrames(){return verifiedFrames;},get rms(){return rms;},
  get peak(){return peak;},get imaginaryLeak(){return imaginaryLeak;},
  get frameCount(){return frameCount;},get failures(){return failures;},
  size:n,domain,initialEnergy:energy};
}
