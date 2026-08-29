// Fluid V5 M4.1 Whitewater 2.0
// Persistent GPU spray / surface foam / underwater bubbles. Spawn signals come from real PBF
// velocity, surface normal and depth. Spray is ballistic and motion-stretched, bubbles rise and
// wobble, and both can convert into longer-lived surface foam.

const sim=window.__sim,ui=window.__ui,ssfr=window.__ssfr,state=window.__v5State;
if(!sim?.dev||!ssfr?.dev||!state)throw new Error('Fluid V5 M4.1 whitewater: runtime unavailable.');
const dev=sim.dev,format=ssfr.format,WG=256,groups=n=>Math.max(1,Math.ceil(n/WG)),clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const q=new URLSearchParams(location.search),quality=['low','medium','high'].includes(q.get('quality'))?q.get('quality'):'medium';
const CAP=quality==='low'?4096:quality==='high'?12288:8192;
if(!Number.isFinite(Number(state.whitewater)))state.whitewater=.86;state.whitewater=clamp(Number(state.whitewater),0,1.5);
// Retire the older two-kind M2 visual pool when the richer M4.1 pool is active.
state.secondary=0;
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

const buffers=[0,1].map(i=>dev.createBuffer({label:`fluidV5M41Whitewater${i}`,size:CAP*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
const counts=[0,1].map(i=>dev.createBuffer({label:`fluidV5M41WhitewaterCount${i}`,size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
const zero=new Uint32Array(4);counts.forEach(b=>dev.queue.writeBuffer(b,0,zero));
const uni=dev.createBuffer({label:'fluidV5M41WhitewaterUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
const renderUni=dev.createBuffer({label:'fluidV5M41WhitewaterRenderUniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const RF=new Float32Array(24);

const updateWGSL=`
struct P{pl:vec4f,vt:vec4f} struct U{box:vec4f,water:vec4f,meta:vec4u,motion:vec4f}
@group(0)@binding(0)var<uniform>U0:U;@group(0)@binding(1)var<storage,read>src:array<P>;@group(0)@binding(2)var<storage,read>srcCount:array<u32>;@group(0)@binding(3)var<storage,read_write>dst:array<P>;@group(0)@binding(4)var<storage,read_write>dstCount:atomic<u32>;
fn emit(s:P){let j=atomicAdd(&dstCount,1u);if(j<U0.meta.x){dst[j]=s;}}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=min(srcCount[0],U0.meta.x)){return;}var s=src[i];var p=s.pl.xyz;var life=s.pl.w;var v=s.vt.xyz;var ty=s.vt.w;let dt=U0.water.y;if(dt<=0){emit(s);return;}life-=dt;if(life<=0){return;}
 if(ty<.5){v.y-=9.81*dt;v*=exp(-dt*.10);p+=v*dt;if(p.y<=U0.water.x){ty=1.0;p.y=U0.water.x+U0.water.z*.12;v=vec3f(v.x*.28,0,v.z*.28);life=max(life,1.6);}}
 else if(ty<1.5){let settle=U0.water.x+U0.water.z*.10;p.y=mix(p.y,settle,1.0-exp(-dt*6.0));let drag=exp(-dt*.42);v=vec3f(v.x*drag,0,v.z*drag);p+=v*dt;}
 else {let phase=U0.motion.y+p.x*9.0+p.z*11.0;v.y=mix(v.y,.18+.07*sin(phase),1.0-exp(-dt*3.0));v.x+=sin(phase*1.37)*dt*.035;v.z+=cos(phase*.91)*dt*.035;v*=vec3f(exp(-dt*.7),1,exp(-dt*.7));p+=v*dt;if(p.y>=U0.water.x-U0.water.z*.25){ty=1.0;p.y=U0.water.x+U0.water.z*.08;v=vec3f(v.x*.25,0,v.z*.25);life=max(life,1.8);}}
 if(p.x<-.08||p.z<-.08||p.x>U0.box.x+.08||p.z>U0.box.z+.08||p.y<-.08||p.y>U0.box.y+.25){return;}s.pl=vec4f(p,life);s.vt=vec4f(v,ty);emit(s);}
`;
const spawnWGSL=`
struct P{pl:vec4f,vt:vec4f} struct U{box:vec4f,water:vec4f,meta:vec4u,motion:vec4f}
@group(0)@binding(0)var<uniform>U0:U;@group(0)@binding(1)var<storage,read>pos:array<vec4f>;@group(0)@binding(2)var<storage,read>vel:array<vec4f>;@group(0)@binding(3)var<storage,read>normalBuf:array<vec4f>;@group(0)@binding(4)var<storage,read>phaseBuf:array<vec4u>;@group(0)@binding(5)var<storage,read_write>dst:array<P>;@group(0)@binding(6)var<storage,read_write>dstCount:atomic<u32>;
fn hash1(x0:u32)->f32{var x=x0;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967295.0;}fn emit(s:P){let j=atomicAdd(&dstCount,1u);if(j<U0.meta.x){dst[j]=s;}}
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let stride=max(U0.meta.z,1u);let i=gid.x*stride;if(i>=U0.meta.y||phaseBuf[i].x!=0u){return;}let p=pos[i].xyz;let v=vel[i].xyz;let sp=length(v);let raw=normalBuf[i].xyz;let nl=length(raw);let seed=i^(U0.meta.w*747796405u);let strength=U0.water.w*U0.motion.x;if(strength<.002){return;}
 let surface=abs(p.y-U0.water.x)<U0.water.z*5.0;var n=select(vec3f(0,1,0),normalize(raw),nl>1e-4);if(n.y<0){n=-n;}let slope=1.0-clamp(n.y,0.0,1.0);let impact=max(-v.y-.45,0.0);let eject=max(v.y-.30,0.0)+max(sp-1.10,0.0)*.52+slope*.55;
 if(surface&&hash1(seed)<clamp(max(eject-.18,0.0)*.010*strength,0.0,.095)){let k=.22+hash1(seed+7u)*.72;let pv=v*.76+n*k+vec3f((hash1(seed+11u)-.5)*.22,.10,(hash1(seed+17u)-.5)*.22);var s:P;s.pl=vec4f(p+n*U0.water.z*.36,.65+hash1(seed+21u)*1.25);s.vt=vec4f(pv,0);emit(s);return;}
 if(surface&&hash1(seed+31u)<clamp((max(sp-.48,0.0)*.003+slope*.006+impact*.004)*strength,0.0,.055)){var s:P;s.pl=vec4f(p.x,U0.water.x+U0.water.z*.10,p.z,2.4+hash1(seed+37u)*4.2);s.vt=vec4f(v.x*.30,0,v.z*.30,1);emit(s);return;}
 let below=U0.water.x-p.y;if(below>U0.water.z*1.5&&below<U0.water.x*.92&&sp>.58&&hash1(seed+47u)<clamp((sp-.5)*.0025*strength,0.0,.026)){var s:P;s.pl=vec4f(p,1.8+hash1(seed+53u)*3.0);s.vt=vec4f(v.x*.10,.10+hash1(seed+59u)*.12,v.z*.10,2);emit(s);}
}
`;
const renderWGSL=`
struct P{pl:vec4f,vt:vec4f} struct R{vp:mat4x4f,screen:vec4f,meta:vec4f}
@group(0)@binding(0)var<uniform>U:R;@group(0)@binding(1)var<storage,read>P0:array<P>;@group(0)@binding(2)var<storage,read>count:array<u32>;
struct V{@builtin(position)clip:vec4f,@location(0)uv:vec2f,@location(1)kind:f32,@location(2)alpha:f32}
fn corner(i:u32)->vec2f{let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return c[i];}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->V{var o:V;let n=min(count[0],u32(U.meta.x));if(ii>=n){o.clip=vec4f(2);o.uv=vec2f(2);o.kind=0;o.alpha=0;return o;}let s=P0[ii];let q=corner(vi);let kind=s.vt.w;let c0=U.vp*vec4f(s.pl.xyz,1);var c=c0;var px=mix(2.1,3.8,step(.5,kind));if(kind>1.5){px=3.0;}let base=vec2f(px*2.0/max(U.screen.x,1.0),px*2.0/max(U.screen.y,1.0));
 if(kind<.5){let c1=U.vp*vec4f(s.pl.xyz-s.vt.xyz*.035,1);let d=(c0.xy/max(abs(c0.w),1e-4)-c1.xy/max(abs(c1.w),1e-4));let dl=length(d);let dir=select(vec2f(0,1),d/dl,dl>1e-5);let side=vec2f(-dir.y,dir.x);c.xy+=(side*q.x*base.x+dir*q.y*base.y*2.6)*c.w;}else{c.xy+=q*base*c.w;}
 o.clip=c;o.uv=q;o.kind=kind;o.alpha=clamp(s.pl.w/mix(1.4,4.0,step(.5,kind)),.15,1.0);return o;}
@fragment fn fs(v:V)->@location(0)vec4f{let r=length(v.uv);if(r>1){discard;}let edge=1.0-smoothstep(.50,1.0,r);if(v.kind>1.5){let ring=smoothstep(.76,.48,r)*smoothstep(.18,.42,r);return vec4f(vec3f(.54,.90,1.0),ring*v.alpha*.42);}let foam=step(.5,v.kind);let col=mix(vec3f(.78,.94,1.0),vec3f(.96,1.0,.98),vec3f(foam));let a=edge*v.alpha*mix(.78,.58,foam);return vec4f(col,a);}
`;

const make=async(code,label,type='compute')=>{const m=dev.createShaderModule({code,label});return type==='compute'?dev.createComputePipelineAsync({label,layout:'auto',compute:{module:m,entryPoint:'main'}}):dev.createRenderPipelineAsync({label,layout:'auto',vertex:{module:m,entryPoint:'vs'},fragment:{module:m,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}})};
const [updatePipe,spawnPipe,renderPipe]=await Promise.all([make(updateWGSL,'fluidV5M41Update'),make(spawnWGSL,'fluidV5M41Spawn'),make(renderWGSL,'fluidV5M41Render','render')]);
let parity=0,frame=1,last=performance.now(),sourceA=sim.buf.posA;
function matMul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
function stride(){const pressure=window.__v5AutoBudget?.pressure||0;return quality==='low'?8+Math.round(pressure*5):quality==='high'?4+Math.round(pressure*4):5+Math.round(pressure*5);}
function encode(enc,target,args){if(sim.buf.posA!==sourceA){counts.forEach(b=>dev.queue.writeBuffer(b,0,zero));parity=0;sourceA=sim.buf.posA;}let now=performance.now(),dt=ui.paused?0:clamp((now-last)/1000,0,.04);last=now;let src=parity,dst=1-src,st=Math.max(2,stride()),strength=state.whitewater*(window.__v5AutoBudget?.secondaryScale??1),b=sim.params.box;
 UF[0]=b[0];UF[1]=b[1];UF[2]=b[2];UF[3]=0;UF[4]=b[1]*.28;UF[5]=dt;UF[6]=sim.params.spacing;UF[7]=strength;UU[8]=CAP;UU[9]=sim.n;UU[10]=st;UU[11]=frame++;UF[12]=window.__v5AutoBudget?.secondaryScale??1;UF[13]=now*.001;UF[14]=0;UF[15]=0;dev.queue.writeBuffer(uni,0,UF);enc.clearBuffer(counts[dst]);
 const upBG=dev.createBindGroup({layout:updatePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:buffers[src]}},{binding:2,resource:{buffer:counts[src]}},{binding:3,resource:{buffer:buffers[dst]}},{binding:4,resource:{buffer:counts[dst]}}]});let p=enc.beginComputePass();p.setPipeline(updatePipe);p.setBindGroup(0,upBG);p.dispatchWorkgroups(groups(CAP));p.end();
 if(!ui.paused&&strength>.002){const spBG=dev.createBindGroup({layout:spawnPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:sim.livePos()}},{binding:2,resource:{buffer:sim.liveVel()}},{binding:3,resource:{buffer:sim.buf.normal}},{binding:4,resource:{buffer:sim.liveBody()}},{binding:5,resource:{buffer:buffers[dst]}},{binding:6,resource:{buffer:counts[dst]}}]});p=enc.beginComputePass();p.setPipeline(spawnPipe);p.setBindGroup(0,spBG);p.dispatchWorkgroups(groups(Math.ceil(sim.n/st)));p.end();}parity=dst;
 const mode=window.__v5DebugMode;if(mode!=='final'&&mode!=='m4-whitewater')return;if(mode==='m4-whitewater'){const cp=enc.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:.003,g:.008,b:.012,a:1},loadOp:'clear',storeOp:'store'}]});cp.end();}
 const view=args[5],proj=args[6],w=args[10]||1,h=args[11]||1;if(!view||!proj)return;RF.set(matMul(proj,view),0);RF[16]=w;RF[17]=h;RF[18]=b[1]*.28;RF[19]=0;RF[20]=CAP;RF[21]=1;RF[22]=strength;RF[23]=0;dev.queue.writeBuffer(renderUni,0,RF);
 const rbg=dev.createBindGroup({layout:renderPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderUni}},{binding:1,resource:{buffer:buffers[parity]}},{binding:2,resource:{buffer:counts[parity]}}]});const rp=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});rp.setPipeline(renderPipe);rp.setBindGroup(0,rbg);rp.draw(6,CAP);rp.end();}

const baseRender=ssfr.render;ssfr.render=function(...args){const out=baseRender.apply(this,args);encode(args[0],args[1],args);return out;};
function mount(){const panel=document.getElementById('settingsPanel');if(!panel||document.getElementById('v5WhitewaterM41'))return;const w=document.createElement('div');w.id='v5WhitewaterM41';w.innerHTML=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(78,214,220,.22)"><div style="font:800 10px ui-monospace;color:#8fffd1;letter-spacing:.12em">WHITEWATER 2.0 · M4.1</div><div style="font:8px/1.45 ui-monospace;color:#8caeba;margin:6px 0">GPU spray, persistent surface foam and rising bubbles spawned from live PBF motion.</div><div class="v4WaveRow"><label>WHITEWATER</label><input id="v5Whitewater" type="range" min="0" max="1.5" step=".05"><div id="v5WhitewaterVal" class="v4WaveVal"></div></div><div style="font:8px/1.4 ui-monospace;color:#9fc5d0">POOL ${CAP.toLocaleString()} · SPRAY / FOAM / BUBBLES</div></div>`;panel.appendChild(w);const r=w.querySelector('#v5Whitewater'),v=w.querySelector('#v5WhitewaterVal');r.value=state.whitewater;const sync=()=>v.textContent=Number(state.whitewater).toFixed(2);r.oninput=e=>{e.stopPropagation();state.whitewater=Number(r.value);save();sync()};w.onpointerdown=e=>e.stopPropagation();sync();}
mount();window.__v5WhitewaterM41={online:true,backend:'spray-foam-bubble-m41',capacity:CAP};console.info('[Fluid V5 M4.1] Whitewater 2.0 online.');
