// Rift Water Lab — experimental native WebGPU spectral ocean.
// Real radix-2 inverse FFT (N=64/128): frequency-domain Phillips-like wind
// spectrum, conjugate time evolution, bit-reversal, horizontal/vertical
// butterfly passes. Readback is asynchronous and optional; the existing
// analytic ocean remains active until a complete grid is available.
// This self-contained compute implementation uses its own GPUDevice and
// does not claim shared GPU buffers with Three.js WebGPURenderer.
export async function createGPUFFTOcean({resolution=64,domain=96,onError=()=>{}}={}){
 if(!navigator.gpu)throw Error('WebGPU API unavailable');
 const n=resolution;
 if(n!==64&&n!==128)throw Error('FFT size must be 64 or 128');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter)throw Error('WebGPU compute adapter unavailable');
 const device=await adapter.requestDevice();
 const length=n*n,bytes=length*8,stages=Math.log2(n);
 const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
 const a=device.createBuffer({size:bytes,usage});
 const b=device.createBuffer({size:bytes,usage});
 const staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const timeBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const fftShader=device.createShaderModule({code:`
const N:u32=${n}u;
const PI:f32=3.141592653589793;
struct Config { half:u32, axis:u32, _pad0:u32, _pad1:u32 };
@group(0) @binding(0) var<storage,read> inputField:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> outputField:array<vec2f>;
@group(0) @binding(2) var<uniform> cfg:Config;
fn cmul(a:vec2f,b:vec2f)->vec2f {
 return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let x=id.x;let y=id.y;
 if(x>=N||y>=N){return;}
 let j=select(x,y,cfg.axis==1u);
 let butterflyWidth=cfg.half*2u;
 let low=j%butterflyWidth;
 let k=j%cfg.half;
 let base=(j/butterflyWidth)*butterflyWidth;
 let u=base+k;
 let v=u+cfg.half;
 var indexA:u32;var indexB:u32;
 if(cfg.axis==0u){indexA=y*N+u;indexB=y*N+v;}
 else{indexA=u*N+x;indexB=v*N+x;}
 let av=inputField[indexA];
 let bv=inputField[indexB];
 let angle=2.0*PI*f32(k)/f32(butterflyWidth);
 let twiddle=vec2f(cos(angle),sin(angle));
 let rotated=cmul(bv,twiddle);
 let result=select(av+rotated,av-rotated,low>=cfg.half);
 outputField[y*N+x]=result;
}`});
 const initShader=device.createShaderModule({code:`
const N:u32=${n}u;
const PI:f32=3.141592653589793;
const DOMAIN:f32=${domain}.0;
struct Time { t:f32, power:f32,_pad0:f32,_pad1:f32 };
@group(0) @binding(0) var<storage,read_write> outputField:array<vec2f>;
@group(0) @binding(1) var<uniform> params:Time;
fn rand(q:vec2f)->f32{return fract(sin(dot(q,vec2f(127.1,311.7)))*43758.5453123);}
fn gauss(q:vec2f)->vec2f {
 let a=max(.0001,rand(q+vec2f(13.3,71.7)));
 let b=rand(q+vec2f(78.3,39.7));
 let r=sqrt(-2.0*log(a));let angle=2.0*PI*b;
 return r*vec2f(cos(angle),sin(angle));
}
fn amplitude(k:vec2f)->f32 {
 let m=length(k);
 if(m<.025||m>3.0){return 0.0;}
 let wind=normalize(vec2f(.86,.51));
 let along=dot(k/m,wind);
 let spread=.16+.84*pow(max(0.0,along),3.0);
 let swell=exp(-.5*pow((m-.10)/.060,2.0));
 let mid=exp(-.5*pow((m-.35)/.22,2.0));
 let detail=exp(-.5*pow((m-1.1)/.65,2.0));
 return (swell*.9+mid*.32+detail*.08)*spread;
}
fn reversed(x:u32)->u32{
 var out:u32=0u;var v=x;
 for(var k=0u;k<${stages}u;k=k+1u){out=(out<<1u)|(v&1u);v=v>>1u;}
 return out;
}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let x=id.x;let y=id.y;
 if(x>=N||y>=N){return;}
 let fx=select(i32(x),i32(x)-i32(N),x>N/2u);
 let fy=select(i32(y),i32(y)-i32(N),y>N/2u);
 let mx=(N-x)%N;let my=(N-y)%N;
 let k=vec2f(f32(fx),f32(fy))*(2.0*PI/DOMAIN);
 let km=length(k);
 let amplitudeHere=amplitude(k);
 let opposite=-k;
 let amplitudeOther=amplitude(opposite);
 let h0=gauss(vec2f(f32(x),f32(y)))*amplitudeHere;
 let h0minus=gauss(vec2f(f32(mx),f32(my)))*amplitudeOther;
 let omega=sqrt(9.81*km*tanh(km*60.0));
 let angle=omega*params.t;
 let e=vec2f(cos(angle),sin(angle));
 let a=vec2f(h0.x*e.x-h0.y*e.y,h0.x*e.y+h0.y*e.x);
 let b=vec2f(h0minus.x*e.x-h0minus.y*e.y,-h0minus.x*e.y-h0minus.y*e.x);
 // N² normalization is applied here to produce a bounded real height field.
 let raw=(a+b)*params.power*36.0;
 outputField[reversed(y)*N+reversed(x)]=raw;
}`});
 for(const [name,shader] of [['spectrum',initShader],['butterflies',fftShader]]){
  const info=await shader.getCompilationInfo();
  const errors=info.messages.filter(item=>item.type==='error');
  if(errors.length)throw Error(name+' WGSL: '+errors.map(e=>e.message).join('; ').slice(0,300));
 }
 const fftPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:fftShader,entryPoint:'main'}});
 const initPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:initShader,entryPoint:'main'}});
 const initBG=device.createBindGroup({layout:initPipeline.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:timeBuffer}}
 ]});
 let configs=[],bindGroups=[],source=a,target=b;
 for(let axis=0;axis<2;axis++)for(let step=0;step<stages;step++){
  const config=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(config,0,new Uint32Array([1<<step,axis,0,0]));
  configs.push(config);
  bindGroups.push(device.createBindGroup({layout:fftPipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:target}},
   {binding:2,resource:{buffer:config}}
  ]}));
  [source,target]=[target,source];
 }
 let latest=null,busy=false,disposed=false,lastSampleTime=-1,frames=0,failures=0,rms=0;
 device.lost.then(info=>{if(!disposed){disposed=true;onError('FFT device lost: '+info.message);}}).catch(()=>{});
 function request(t,{power=1}={}){
  if(disposed||busy||t-lastSampleTime<.105)return;
  busy=true;lastSampleTime=t;
  try{
   device.queue.writeBuffer(timeBuffer,0,new Float32Array([t,power,0,0]));
   const encoder=device.createCommandEncoder();
   let pass=encoder.beginComputePass();
   pass.setPipeline(initPipeline);pass.setBindGroup(0,initBG);
   pass.dispatchWorkgroups(Math.ceil(n/8),Math.ceil(n/8));
   pass.end();
   for(const bg of bindGroups){
    pass=encoder.beginComputePass();
    pass.setPipeline(fftPipeline);pass.setBindGroup(0,bg);
    pass.dispatchWorkgroups(Math.ceil(n/8),Math.ceil(n/8));
    pass.end();
   }
   encoder.copyBufferToBuffer(source,0,staging,0,bytes);
   device.queue.submit([encoder.finish()]);
   staging.mapAsync(GPUMapMode.READ).then(()=>{
    if(disposed)return;
    latest=new Float32Array(staging.getMappedRange()).slice();
    staging.unmap();
    let squares=0;
    for(let i=0;i<latest.length;i+=2){
      const value=latest[i]/(n*n);
      squares+=value*value;
    }
    rms=Math.sqrt(squares/(n*n));
    frames++;busy=false;
   }).catch(error=>{busy=false;failures++;if(failures===1)onError(String(error));});
  }catch(error){busy=false;failures++;if(failures===1)onError(String(error));}
 }
 function sample(x,z){
  if(!latest)return 0;
  const ux=((x/domain)%1+1)%1*n,uz=((z/domain)%1+1)%1*n;
  const ix=Math.floor(ux),iz=Math.floor(uz),tx=ux-ix,tz=uz-iz;
  const ax=ix%n,bx=(ix+1)%n,az=iz%n,bz=(iz+1)%n;
  const a=latest[(az*n+ax)*2],b=latest[(az*n+bx)*2];
  const c=latest[(bz*n+ax)*2],d=latest[(bz*n+bx)*2];
  return ((a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz)/(n*n);
 }
 function dispose(){
  disposed=true;
  for(const b of configs)b.destroy();
  a.destroy();b.destroy();timeBuffer.destroy();
  if(!busy)staging.destroy();
  device.destroy();
 }
 return {request,sample,dispose,get ready(){return latest!==null;},get frameCount(){return frames;},get rms(){return rms;},get failures(){return failures;},size:n,domain};
}
