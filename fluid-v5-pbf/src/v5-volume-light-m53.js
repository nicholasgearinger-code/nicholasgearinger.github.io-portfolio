// Fluid V5 M5.3 underwater volumetric fixture transport.
// Integrates the six submerged pool fixtures through the actual pool water volume using broad
// inward cones, inverse-square attenuation, RGB absorption and a forward-scattering phase term.
// Night only; Day/Sunset retain the existing sun shafts and HDR environment lighting.

const ssfr=window.__ssfr,sim=window.__sim,lab=window.__v5LightLab,state=window.__v5State;
if(!ssfr?.dev||!sim?.dev||!lab?.state)throw new Error('Fluid V5 M5.3 volume lighting: runtime unavailable.');
const dev=ssfr.dev,format=ssfr.format;
const uni=dev.createBuffer({label:'fluidV5M53VolumeUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
const shader=`
struct Comp{invViewProj:mat4x4f,invView:mat4x4f,eye:vec4f,boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f}
struct U{box:vec4f,water:vec4f,meta:vec4u,tune:vec4f}@group(0)@binding(0)var<uniform>C:Comp;@group(0)@binding(1)var<uniform>U0:U;
struct V{@builtin(position)p:vec4f,@location(0)n:vec2f}@vertex fn vs(@builtin(vertex_index)i:u32)->V{let q=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.p=vec4f(q,0,1);o.n=q;return o;}
fn hue(h:f32)->vec3f{let x=fract(h)*6.0;return clamp(vec3f(abs(x-3.0)-1.0,2.0-abs(x-2.0),2.0-abs(x-4.0)),vec3f(0),vec3f(1));}
fn col(i:u32)->vec3f{let m=U0.meta.x;if(m==0u){return mix(vec3f(.05,.38,1),vec3f(.35,.08,1),f32(i%2u));}if(m==1u){return mix(vec3f(.02,1,.76),vec3f(.03,.86,.25),f32(i%2u));}if(m==2u){return mix(vec3f(1,.05,.03),vec3f(1,.02,.5),f32(i%2u));}return hue(U0.tune.y+f32(i)*.16);}
fn lamp(i:u32)->vec3f{let z=array<f32,3>(.17,.50,.83)[i%3u]*U0.box.z;let x=select(U0.box.x-.018,.018,i<3u);return vec3f(x,U0.water.x*.42,z);}
fn lampDir(i:u32)->vec3f{return select(vec3f(-1,.02,0),vec3f(1,.02,0),i<3u);}
fn phaseHG(cosT:f32,g:f32)->f32{let gg=g*g;return (1.0-gg)/max(pow(1.0+gg-2.0*g*cosT,1.5),1e-4);}
fn boxHit(ro:vec3f,rd:vec3f,lo:vec3f,hi:vec3f)->vec2f{let inv=1.0/rd;let a=(lo-ro)*inv,b=(hi-ro)*inv;let mn=min(a,b),mx=max(a,b);let t0=max(max(mn.x,mn.y),mn.z),t1=min(min(mx.x,mx.y),mx.z);return vec2f(t0,t1);}
@fragment fn fs(v:V)->@location(0)vec4f{let nh=C.invViewProj*vec4f(v.n,-1,1),fh=C.invViewProj*vec4f(v.n,1,1);let ro=nh.xyz/nh.w,rd=normalize(fh.xyz/fh.w-ro);let lo=vec3f(0),hi=vec3f(U0.box.x,U0.water.x,U0.box.z);let hit=boxHit(ro,rd,lo,hi);let t0=max(hit.x,0.0),t1=hit.y;if(t1<=t0){return vec4f(0);}let steps=max(1u,U0.meta.y),dt=(t1-t0)/f32(steps);var sum=vec3f(0);let absorb=vec3f(.30,.12,.055)*U0.tune.z;for(var si=0u;si<8u;si++){if(si>=steps){break;}let t=t0+(f32(si)+.5)*dt,p=ro+rd*t;var Ls=vec3f(0);for(var li=0u;li<6u;li++){let lp=lamp(li),toP=p-lp,dist=max(length(toP),.04),ld=toP/dist,cone=smoothstep(.48,.82,dot(ld,lampDir(li)));let att=cone/(1.0+1.65*dist*dist);let ph=phaseHG(dot(-rd,ld),.58);let trans=exp(-absorb*dist);Ls+=col(li)*trans*att*ph;}sum+=Ls*dt;}sum*=U0.tune.x*.075;let mapped=sum/(vec3f(1)+sum*.7);let alpha=clamp(max(max(mapped.r,mapped.g),mapped.b)*.38,0.0,.24);return vec4f(mapped,alpha);}
`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M53VolumeWGSL'});
const pipe=await dev.createRenderPipelineAsync({label:'fluidV5M53Volume',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'zero',dstFactor:'one'}}}]},primitive:{topology:'triangle-list'}});
const baseRender=ssfr.render;ssfr.render=function(...args){let out=baseRender.apply(this,args),enc=args[0],target=args[1],mode=window.__v5LightState?.timeOfDay||lab.state.time||'day';if(mode!=='night'||window.__v5DebugMode!=='final'||!enc||!target)return out;let b=sim.params.box,pool=['blue','aqua','red','rainbow'].indexOf(lab.state.poolLight),pressure=window.__v5Workload?.pressure||0;UF[0]=b[0];UF[1]=b[1];UF[2]=b[2];UF[3]=0;UF[4]=b[1]*.28;UF[5]=sim.params.spacing;UF[6]=0;UF[7]=0;UU[8]=Math.max(0,pool);UU[9]=pressure>.72?4:pressure>.42?6:8;UU[10]=0;UU[11]=0;UF[12]=(lab.state.poolIntensity||1)*(1-pressure*.28);UF[13]=performance.now()*.001*(lab.state.rainbowSpeed||.16);UF[14]=.86;UF[15]=0;dev.queue.writeBuffer(uni,0,UF);let bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.compUni}},{binding:1,resource:{buffer:uni}}]});let p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(pipe);p.setBindGroup(0,bg);p.draw(3);p.end();return out;};
window.__v5VolumeLightM53={online:true,backend:'hg-six-fixture-volume-m53'};console.info('[Fluid V5 M5.3] six-fixture volumetric underwater transport online.');
