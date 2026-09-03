// Fluid V5 M3.5 roughness-aware HDR IBL overlay.
// The base SSFR composite already displays mip 0 of the environment as the sky. This pass adds
// derivative-free water-only specular IBL using the environment mip chain: sharp at low roughness,
// progressively softer as roughness rises. A very small high-mip irradiance term ties the water
// to the environment without washing out the tiles. Night is intentionally excluded.

const ssfr=window.__ssfr;
const dev=ssfr?.dev;
if(!dev||!ssfr?.format)throw new Error('Fluid V5 M3.5 IBL: SSFR runtime unavailable.');

window.__v5IBLStatus={online:false,stage:'pipeline',backend:'mip-ibl-m35',error:''};

const uni=dev.createBuffer({label:'fluidV5IBLM35Uniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(4);
const shader=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct IBL { reflectGain:f32, diffuseGain:f32, maxLod:f32, sunset:f32 }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<uniform> I:IBL;
@group(0) @binding(2) var eyeZ:texture_2d<f32>;
@group(0) @binding(3) var envTex:texture_cube<f32>;
@group(0) @binding(4) var envSamp:sampler;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;
 var o:V;o.pos=vec4f(p,0,1);o.ndc=p;return o;
}
fn empty(z:f32)->bool{return z < -1e3;}
fn vpos(ndc:vec2f,z:f32)->vec3f{return vec3f(-ndc.x*z/C.proj00,-ndc.y*z/C.proj11,z);}
fn envDir(d:vec3f)->vec3f{
 let c=cos(C.envYaw);let s=sin(C.envYaw);return vec3f(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);
}
fn sampleEnv(d:vec3f,lod:f32)->vec3f{return textureSampleLevel(envTex,envSamp,envDir(d),lod).rgb*C.envIntensity;}
fn aces(c:vec3f)->vec3f{
 let x=max(c,vec3f(0));let a=2.51;let b=.03;let cc=2.43;let d=.59;let e=.14;
 let y=clamp((x*(a*x+b))/(x*(cc*x+d)+e),vec3f(0),vec3f(1));
 return pow(y,vec3f(1.0/2.2));
}
@fragment fn fs(v:V)->@location(0) vec4f{
 if(C.hasEnvMap==0){return vec4f(0);}
 let dim=vec2i(textureDimensions(eyeZ,0));
 let uv=vec2f(v.ndc.x*.5+.5,.5-v.ndc.y*.5);
 let fp=clamp(uv*vec2f(dim),vec2f(0),vec2f(dim)-vec2f(1));
 let p=vec2i(fp);let z=textureLoad(eyeZ,p,0).r;if(empty(z)){return vec4f(0);}
 let px=vec2i(min(p.x+1,dim.x-1),p.y);let mx=vec2i(max(p.x-1,0),p.y);
 let py=vec2i(p.x,min(p.y+1,dim.y-1));let my=vec2i(p.x,max(p.y-1,0));
 let zx=textureLoad(eyeZ,px,0).r;let zmx=textureLoad(eyeZ,mx,0).r;
 let zy=textureLoad(eyeZ,py,0).r;let zmy=textureLoad(eyeZ,my,0).r;
 if(empty(zx)||empty(zmx)||empty(zy)||empty(zmy)){return vec4f(0);}
 let ndcDx=vec2f(2.0/f32(dim.x),0);let ndcDy=vec2f(0,-2.0/f32(dim.y));
 let pc=vpos(v.ndc,z);
 let vx=vpos(v.ndc+ndcDx,zx)-vpos(v.ndc-ndcDx,zmx);
 let vy=vpos(v.ndc+ndcDy,zy)-vpos(v.ndc-ndcDy,zmy);
 var nv=normalize(cross(vx,vy));if(nv.z<0){nv=-nv;}
 var nw=normalize((C.invView*vec4f(nv,0)).xyz);
 let pw=(C.invView*vec4f(pc,1)).xyz;
 let viewDir=normalize(pw-C.eye.xyz);
 if(dot(nw,-viewDir)<0){nw=-nw;}
 let R=reflect(viewDir,nw);
 let ndv=clamp(dot(nw,-viewDir),0.0,1.0);
 let f0=.0204;let F=f0+(1.0-f0)*pow(1.0-ndv,5.0);
 let rough=clamp(C.roughness,0.0,1.0);
 let specLod=clamp(rough*I.maxLod*3.6,0.0,I.maxLod);
 let spec=sampleEnv(R,specLod);
 let diffuse=sampleEnv(nw,max(I.maxLod-1.0,0.0));
 let sunsetGain=mix(1.0,1.22,I.sunset);
 let hdr=spec*(F*I.reflectGain*sunsetGain)+diffuse*(I.diffuseGain*(1.0-F));
 let mapped=aces(hdr);
 let scale=mix(.12,.16,I.sunset);
 return vec4f(mapped*scale,0.0);
}`;

const mod=dev.createShaderModule({code:shader,label:'fluidV5IBLM35WGSL'});
const pipe=await dev.createRenderPipelineAsync({
 label:'fluidV5IBLM35',layout:'auto',
 vertex:{module:mod,entryPoint:'vs'},
 fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{
   color:{srcFactor:'one',dstFactor:'one',operation:'add'},
   alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}
 }}]},
 primitive:{topology:'triangle-list'},
});

let bind=null,key='';
const baseRender=ssfr.render;
ssfr.render=function(...args){
  const out=baseRender.apply(this,args);
  const mode=window.__v5LightState?.timeOfDay||window.__v5LightLab?.state?.time||'day';
  const es=window.__v5EnvironmentStatus;
  if(mode==='night'||!this.env?.has||!es?.online)return out;
  const enc=args[0],target=args[1];
  if(!enc||!target||!this.views?.eyeZ)return out;

  const depthSlot=(this.filterIterations>0&&this.cleanupPass)?1:0;
  const envGen=this.env.gen||0,ssfrGen=this.gen||0;
  const nextKey=`${envGen}|${ssfrGen}|${depthSlot}`;
  if(!bind||key!==nextKey){
    bind=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:this.compUni}},
      {binding:1,resource:{buffer:uni}},
      {binding:2,resource:this.views.eyeZ[depthSlot]},
      {binding:3,resource:this.env.view},
      {binding:4,resource:this.env.sampler},
    ]});key=nextKey;
  }
  const cube=Math.max(16,Number(es.cubeSize)||512);
  UF[0]=mode==='sunset'?.34:.25;
  UF[1]=mode==='sunset'?.035:.026;
  UF[2]=Math.max(1,Math.floor(Math.log2(cube)));
  UF[3]=mode==='sunset'?1:0;
  dev.queue.writeBuffer(uni,0,UF);
  const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});
  pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
  return out;
};
window.__v5IBLStatus={online:true,stage:'online',backend:'mip-ibl-m35',error:''};
console.info('[Fluid V5 M3.5] roughness-aware HDR reflection/irradiance overlay online.');
