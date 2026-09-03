// Fluid V5 M5.0 XPBD density refinement.
// Adds one or two compliant post-PBF density projection iterations using a total-Lagrange-multiplier
// formulation. The upstream PBF solve remains the fallback and first-stage incompressibility solve.
// This module reuses the existing sorted cellStart grid and applies only small corrections so the
// cell topology remains valid during the refinement pass.

const sim=window.__sim,state=window.__v5State,ui=window.__ui;
if(!sim?.dev||!sim?.params||!state)throw new Error('Fluid V5 M5.0 XPBD: runtime unavailable.');
const dev=sim.dev,WG=256,groups=n=>Math.max(1,Math.ceil(n/WG));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
if(typeof state.xpbdDensity!=='number')state.xpbdDensity=.62;
state.xpbdDensity=clamp(Number(state.xpbdDensity)||.62,0,1);
const save=()=>{try{localStorage.setItem('fluidV5LabStateV1',JSON.stringify(state))}catch{}};save();

const uni=dev.createBuffer({label:'fluidV5M50XPBDUniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const UF=new Float32Array(16),UU=new Uint32Array(UF.buffer);
let lambda=null,delta=null,capacity=0,cache=null;

const pre=`
struct U{box:vec4f,grid:vec4u,fluid:vec4f,tune:vec4f}
@group(0)@binding(0)var<uniform>U0:U;
fn cellOf(p:vec3f)->vec3i{let h=U0.box.w;return clamp(vec3i(floor(p/h)),vec3i(0),vec3i(U0.grid.xyz)-vec3i(1));}
fn gradW(r:vec3f)->vec3f{let d=length(r),h=U0.box.w;if(d<1e-5||d>=h){return vec3f(0);}let q=(h-d)/h;return -(q*q/max(d,1e-5))*r;}
fn poly6(r2:f32)->f32{let h=U0.box.w,h2=h*h;if(r2>=h2){return 0.0;}let t=h2-r2;return U0.fluid.w*t*t*t;}
`;
const lambdaWGSL=pre+`
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read>phase:array<vec4u>;
@group(0)@binding(3)var<storage,read>cellStart:array<u32>;
@group(0)@binding(4)var<storage,read_write>L:array<f32>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.grid.w){return;}if(phase[i].x!=0u){L[i]=0;return;}let pi=pos[i].xyz,c=cellOf(pi);var rho=U0.fluid.x*poly6(0.0);var gi=vec3f(0);var sumg=0.0;
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}let ci=u32((z*i32(U0.grid.y)+y)*i32(U0.grid.x)+x);let b=cellStart[ci],e=cellStart[ci+1u];for(var j=b;j<e;j++){if(j==i||phase[j].x!=0u){continue;}let r=pi-pos[j].xyz;let r2=dot(r,r);rho+=U0.fluid.x*poly6(r2);let g=gradW(r)*U0.fluid.x/U0.fluid.y;gi+=g;sumg+=dot(g,g);}}}}
 sumg+=dot(gi,gi);let C=max(rho/U0.fluid.y-1.0,0.0);let alpha=U0.tune.x;L[i]=select(0.0,-C/(sumg+alpha+1e-8),C>0.0);}
`;
const deltaWGSL=pre+`
@group(0)@binding(1)var<storage,read>pos:array<vec4f>;
@group(0)@binding(2)var<storage,read>phase:array<vec4u>;
@group(0)@binding(3)var<storage,read>cellStart:array<u32>;
@group(0)@binding(4)var<storage,read>L:array<f32>;
@group(0)@binding(5)var<storage,read_write>D:array<vec4f>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.grid.w){return;}if(phase[i].x!=0u){D[i]=vec4f(0);return;}let pi=pos[i].xyz,c=cellOf(pi);var d=vec3f(0);
 for(var dz=-1;dz<=1;dz++){let z=c.z+dz;if(z<0||z>=i32(U0.grid.z)){continue;}for(var dy=-1;dy<=1;dy++){let y=c.y+dy;if(y<0||y>=i32(U0.grid.y)){continue;}for(var dx=-1;dx<=1;dx++){let x=c.x+dx;if(x<0||x>=i32(U0.grid.x)){continue;}let ci=u32((z*i32(U0.grid.y)+y)*i32(U0.grid.x)+x);let b=cellStart[ci],e=cellStart[ci+1u];for(var j=b;j<e;j++){if(j==i||phase[j].x!=0u){continue;}let r=pi-pos[j].xyz;d+=(L[i]+L[j])*gradW(r);}}}}
 d*=U0.fluid.x/U0.fluid.y;let m=length(d);if(m>U0.tune.y){d*=U0.tune.y/m;}D[i]=vec4f(d*U0.tune.z,0);}
`;
const applyWGSL=`
struct U{box:vec4f,grid:vec4u,fluid:vec4f,tune:vec4f}@group(0)@binding(0)var<uniform>U0:U;@group(0)@binding(1)var<storage,read_write>pos:array<vec4f>;@group(0)@binding(2)var<storage,read_write>vel:array<vec4f>;@group(0)@binding(3)var<storage,read>phase:array<vec4u>;@group(0)@binding(4)var<storage,read>D:array<vec4f>;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)gid:vec3u){let i=gid.x;if(i>=U0.grid.w||phase[i].x!=0u){return;}let d=D[i].xyz;var p=pos[i].xyz+d;p=clamp(p,vec3f(.001),U0.box.xyz-vec3f(.001));pos[i]=vec4f(p,pos[i].w);vel[i]=vec4f(vel[i].xyz+d*U0.tune.w,vel[i].w);}
`;
const mk=async(code,label)=>dev.createComputePipelineAsync({label,layout:'auto',compute:{module:dev.createShaderModule({code,label:label+'WGSL'}),entryPoint:'main'}});
const [pLambda,pDelta,pApply]=await Promise.all([mk(lambdaWGSL,'fluidV5M50Lambda'),mk(deltaWGSL,'fluidV5M50Delta'),mk(applyWGSL,'fluidV5M50Apply')]);

function ensure(){let cap=Math.max(1,sim.cap||sim.n);if(cap<=capacity&&lambda&&delta)return;lambda?.destroy?.();delta?.destroy?.();capacity=cap;lambda=dev.createBuffer({label:'fluidV5M50LambdaBuf',size:cap*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});delta=dev.createBuffer({label:'fluidV5M50DeltaBuf',size:cap*16,usage:GPUBufferUsage.STORAGE});cache=null;}
function binds(){ensure();let key=`${sim.gen}|${sim.parity}|${capacity}`;if(cache?.key===key)return cache;let pos=sim.livePos(),vel=sim.liveVel(),phase=sim.liveBody();cache={key,
 l:dev.createBindGroup({layout:pLambda.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:phase}},{binding:3,resource:{buffer:sim.buf.cellStart}},{binding:4,resource:{buffer:lambda}}]}),
 d:dev.createBindGroup({layout:pDelta.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:phase}},{binding:3,resource:{buffer:sim.buf.cellStart}},{binding:4,resource:{buffer:lambda}},{binding:5,resource:{buffer:delta}}]}),
 a:dev.createBindGroup({layout:pApply.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}},{binding:1,resource:{buffer:pos}},{binding:2,resource:{buffer:vel}},{binding:3,resource:{buffer:phase}},{binding:4,resource:{buffer:delta}}]})};return cache;}

const baseStep=sim.step.bind(sim);
sim.step=function(frameDt){baseStep(frameDt);if(ui?.paused||document.hidden||state.xpbdDensity<=.001||this.n<1)return;let dt=Math.max(1/480,Math.min(1/60,(this.lastAdvanced||frameDt||1/60)/Math.max(1,this.lastSubsteps||1)));let strength=state.xpbdDensity;let alpha=(2.5e-7+(1-strength)*1.6e-6)/(dt*dt);let maxCorr=this.h*(.065+.055*strength);let velGain=.08/dt;UF[0]=this.params.box[0];UF[1]=this.params.box[1];UF[2]=this.params.box[2];UF[3]=this.h;UU[4]=this.gridDim[0];UU[5]=this.gridDim[1];UU[6]=this.gridDim[2];UU[7]=this.n;UF[8]=this.scene.mass;UF[9]=this.params.restDensity;UF[10]=1/this.params.restDensity;UF[11]=315/(64*Math.PI*Math.pow(this.h,9));UF[12]=alpha;UF[13]=maxCorr;UF[14]=.46+.32*strength;UF[15]=velGain;dev.queue.writeBuffer(uni,0,UF);let bg=binds();let enc=dev.createCommandEncoder();let it=(window.__v5Workload?.pressure||0)>.7?1:(strength>.72?2:1);for(let k=0;k<it;k++){enc.clearBuffer(lambda);let p=enc.beginComputePass();p.setPipeline(pLambda);p.setBindGroup(0,bg.l);p.dispatchWorkgroups(groups(this.n));p.setPipeline(pDelta);p.setBindGroup(0,bg.d);p.dispatchWorkgroups(groups(this.n));p.setPipeline(pApply);p.setBindGroup(0,bg.a);p.dispatchWorkgroups(groups(this.n));p.end();}dev.queue.submit([enc.finish()]);window.__v5XPBDM50.lastIterations=it;};

window.__v5XPBDM50={online:true,backend:'compliant-density-refine-m50',get strength(){return state.xpbdDensity},lastIterations:0};
console.info('[Fluid V5 M5.0] XPBD-style compliant density refinement online.');
