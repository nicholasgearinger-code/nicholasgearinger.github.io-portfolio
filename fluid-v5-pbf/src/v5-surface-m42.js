// Fluid V5 M4.2 Surface Reconstruction 2.0
// Retunes the existing anisotropic-kernel + narrow-range SSFR stack and adds a conservative
// temporal depth/normal stabilizer. The history pass only accepts previous depth when it closely
// matches the current surface, so silhouettes and splashes reject stale history automatically.

const sim=window.__sim,mesh=window.__mesh,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!mesh||!ssfr?.dev)throw new Error('Fluid V5 M4.2 surface: runtime unavailable.');
const dev=ssfr.dev,format=ssfr.format,q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
if(!Number.isFinite(Number(state.surfaceTemporal)))state.surfaceTemporal=.68;state.surfaceTemporal=Math.min(1,Math.max(0,Number(state.surfaceTemporal)));
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

const profile={
 low:{ratio:3.5,stretch:1.75,lambda:.88,minN:13,radius:1.85,delta:8.0,mu:1.00,bilateral:2.0},
 medium:{ratio:4.2,stretch:2.05,lambda:.91,minN:17,radius:2.0,delta:9.0,mu:1.06,bilateral:2.15},
 high:{ratio:4.8,stretch:2.30,lambda:.93,minN:21,radius:2.15,delta:9.8,mu:1.10,bilateral:2.3},
}[quality];
mesh.anisoRatio=profile.ratio;mesh.anisoStretch=profile.stretch;mesh.anisoLambda=profile.lambda;mesh.anisoMinNeighbours=profile.minN;mesh.anisoRadiusScale=profile.radius;mesh.anisoKs=1.0;mesh.anisoLonely=.92;
ssfr.narrowDelta=profile.delta;ssfr.narrowMu=profile.mu;ssfr.bilateralRange=profile.bilateral;ssfr.cleanupPass=true;ssfr.cleanupRadius=3;

const histUni=dev.createBuffer({label:'fluidV5M42TemporalUniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const HF=new Float32Array(4);
let history=null,hW=0,hH=0,hValid=false,bind=null,bindKey='';
const shader=`
struct Comp{invViewProj:mat4x4f,invView:mat4x4f,eye:vec4f,boxMin:vec3f,proj00:f32,boxMax:vec3f,proj11:f32,absorb:vec3f,ior:f32,sunDir:vec3f,sunIntensity:f32,roughness:f32,exposure:f32,groundReflection:f32,thicknessScale:f32,bodyCount:i32,floorPlane:i32,debug:i32,hasEnvMap:i32,envIntensity:f32,envYaw:f32,mapScale:vec2f}
struct T{blend:f32,threshold:f32,maxLod:f32,pad:f32}
@group(0)@binding(0)var<uniform>C:Comp;@group(0)@binding(1)var<uniform>U:T;@group(0)@binding(2)var cur:texture_2d<f32>;@group(0)@binding(3)var prev:texture_2d<f32>;@group(0)@binding(4)var envTex:texture_cube<f32>;@group(0)@binding(5)var envSamp:sampler;
struct V{@builtin(position)p:vec4f,@location(0)n:vec2f}@vertex fn vs(@builtin(vertex_index)i:u32)->V{let q=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.p=vec4f(q,0,1);o.n=q;return o;}
fn empty(z:f32)->bool{return z < -1e3;}fn viewPos(ndc:vec2f,z:f32)->vec3f{return vec3f(-ndc.x*z/C.proj00,-ndc.y*z/C.proj11,z);}fn stable(p:vec2i,dim:vec2i)->f32{let z=textureLoad(cur,p,0).r;if(empty(z)){return z;}let h=textureLoad(prev,p,0).r;if(empty(h)){return z;}let e=abs(z-h);let w=(1.0-smoothstep(U.threshold,U.threshold*3.0,e))*U.blend;return mix(z,h,w);}
fn envDir(d:vec3f)->vec3f{let c=cos(C.envYaw);let s=sin(C.envYaw);return vec3f(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);}
@fragment fn fs(v:V)->@location(0)vec4f{let dim=vec2i(textureDimensions(cur,0));let uv=vec2f(v.n.x*.5+.5,.5-v.n.y*.5);let fp=clamp(uv*vec2f(dim),vec2f(1),vec2f(dim)-vec2f(2));let p=vec2i(fp);let z=stable(p,dim);if(empty(z)){return vec4f(0);}let zx0=stable(p+vec2i(-1,0),dim),zx1=stable(p+vec2i(1,0),dim),zy0=stable(p+vec2i(0,-1),dim),zy1=stable(p+vec2i(0,1),dim);if(empty(zx0)||empty(zx1)||empty(zy0)||empty(zy1)){return vec4f(0);}let ddx=vec2f(2.0/f32(dim.x),0),ddy=vec2f(0,-2.0/f32(dim.y));let pc=viewPos(v.n,z),vx=viewPos(v.n+ddx,zx1)-viewPos(v.n-ddx,zx0),vy=viewPos(v.n+ddy,zy1)-viewPos(v.n-ddy,zy0);var nv=normalize(cross(vx,vy));if(nv.z<0){nv=-nv;}var nw=normalize((C.invView*vec4f(nv,0)).xyz);let pw=(C.invView*vec4f(pc,1)).xyz;let vd=normalize(pw-C.eye.xyz);if(dot(nw,-vd)<0){nw=-nw;}let R=reflect(vd,nw);let ndv=clamp(dot(nw,-vd),0.0,1.0);let F=.0204+(1.0-.0204)*pow(1.0-ndv,5.0);let lod=clamp(C.roughness*U.maxLod*3.2,0.0,U.maxLod);let spec=select(vec3f(.12,.25,.34),textureSampleLevel(envTex,envSamp,envDir(R),lod).rgb*C.envIntensity,C.hasEnvMap!=0);let col=spec*F*.085;return vec4f(col,0);}
`;
const mod=dev.createShaderModule({code:shader,label:'fluidV5M42TemporalWGSL'});
const pipe=await dev.createRenderPipelineAsync({label:'fluidV5M42Temporal',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'zero',dstFactor:'one'}}}]},primitive:{topology:'triangle-list'}});
function ensureHistory(){if(ssfr.w===hW&&ssfr.h===hH&&history)return;history?.destroy?.();hW=Math.max(1,ssfr.w||1);hH=Math.max(1,ssfr.h||1);history=dev.createTexture({label:'fluidV5M42DepthHistory',size:[hW,hH],format:'r32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});hValid=false;bind=null;bindKey='';}
function currentDepthSlot(){const iterations=Math.max(ssfr.filterIterations,0);let src=(iterations*2)&1;if(ssfr.cleanupPass&&iterations>0)src=1-src;return src;}
const baseRender=ssfr.render;ssfr.render=function(...args){const out=baseRender.apply(this,args);if(!this.views?.eyeZ||!args[0]||!args[1])return out;ensureHistory();const enc=args[0],target=args[1],slot=currentDepthSlot(),curView=this.views.eyeZ[slot],mode=window.__v5LightState?.timeOfDay||'day';
 if(hValid&&state.surfaceTemporal>.002&&window.__v5DebugMode==='final'&&mode!=='night'){const k=`${this.gen}|${this.env?.gen||0}|${slot}|${hW}x${hH}`;if(!bind||bindKey!==k){bindKey=k;bind=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.compUni}},{binding:1,resource:{buffer:histUni}},{binding:2,resource:curView},{binding:3,resource:history.createView()},{binding:4,resource:this.env.view},{binding:5,resource:this.env.sampler}]});}HF[0]=state.surfaceTemporal;HF[1]=Math.max(.006,sim.params.spacing*.55);HF[2]=Math.max(1,Math.log2(Math.max(16,window.__v5EnvironmentStatus?.cubeSize||512)));HF[3]=0;dev.queue.writeBuffer(histUni,0,HF);const p=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});p.setPipeline(pipe);p.setBindGroup(0,bind);p.draw(3);p.end();}
 enc.copyTextureToTexture({texture:slot===0?this.eyeZ0:this.eyeZ1},{texture:history},[hW,hH,1]);hValid=true;return out;};

// Let the filter spend more work when the GPU has headroom; preserve silhouettes under pressure.
setInterval(()=>{const pressure=window.__v5AutoBudget?.pressure||0;if(pressure<.30)ssfr.filterIterations=Math.max(ssfr.filterIterations,quality==='high'?4:3);else if(pressure>.75)ssfr.filterIterations=Math.max(2,Math.min(ssfr.filterIterations,quality==='low'?2:3));},1100);
function mount(){const panel=document.getElementById('settingsPanel');if(!panel||document.getElementById('v5SurfaceM42'))return;const w=document.createElement('div');w.id='v5SurfaceM42';w.innerHTML=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)"><div style="font:800 10px ui-monospace;color:#8fffd1;letter-spacing:.12em">SURFACE 2.0 · M4.2</div><div style="font:8px/1.45 ui-monospace;color:#8caeba;margin:6px 0">Adaptive anisotropic kernels, narrow-range filtering and history-rejected temporal depth/normal stabilization.</div><div class="v4WaveRow"><label>TEMPORAL</label><input id="v5SurfaceTemporal" type="range" min="0" max="1" step=".05"><div id="v5SurfaceTemporalVal" class="v4WaveVal"></div></div><div style="font:8px/1.4 ui-monospace;color:#9fc5d0">ANISO ${profile.ratio.toFixed(1)}× · MIN N ${profile.minN} · NARROW ${profile.delta.toFixed(1)}</div></div>`;panel.appendChild(w);const r=w.querySelector('#v5SurfaceTemporal'),v=w.querySelector('#v5SurfaceTemporalVal');r.value=state.surfaceTemporal;const sync=()=>v.textContent=state.surfaceTemporal.toFixed(2);r.oninput=e=>{e.stopPropagation();state.surfaceTemporal=Number(r.value);save();sync()};w.onpointerdown=e=>e.stopPropagation();sync();}
mount();window.__v5SurfaceM42={online:true,backend:'aniso-narrow-temporal-m42',quality};console.info('[Fluid V5 M4.2] Surface Reconstruction 2.0 online.');
