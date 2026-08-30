// Fluid V5 M8.1 — sub-grid capillary ripples + improved refractive caustics.
// Shader-only refinement: no new render pass, compute pass, command encoder, or queue.submit.
// The PBF particle spacing cannot resolve millimetre/centimetre capillary detail, so the
// unresolved high-frequency surface spectrum is represented as a physically-inspired normal
// perturbation. Amplitude is driven by reconstructed surface curvature/activity, while dense
// large-scale motion still comes from the simulated water itself.

const ssfr=window.__ssfr,sim=window.__sim;
const realism=window.__fluidV44Realism;
if(!ssfr?.dev||!ssfr?.format||!sim||!realism||!window.__v5M739Unified?.online)
  throw new Error('M8.1 optics: stable pool/realism runtime unavailable.');
const dev=ssfr.dev;
const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const CW=await import(UPSTREAM+'ssfr_composite_wgsl.js');
let src=CW.compositePrelude+CW.compositeFS;
function patch(needle,replacement,label){if(!src.includes(needle))throw new Error(`M8.1 optics signature changed: ${label}`);src=src.replace(needle,replacement);}

patch(`  mapScale    : vec2f,\n}`,
`  mapScale    : vec2f,\n  realism0    : vec4f, // time, micro, dispersion, scattering\n  realism1    : vec4f, // edge foam, shafts, receiver shadow, spare\n}`,'uniform extension');

const suppressNeedle='  let suppress = (1.0 - clamp(C.groundReflection, 0.0, 1.0)) * topSurface * belowHorizon;';
if(src.includes(suppressNeedle))src=src.replace(suppressNeedle,'  let suppress = 0.92 * topSurface * belowHorizon;');

const floorNeedle=`fn floorColor(p: vec3f) -> vec3f {
  let base = vec3f(0.30, 0.305, 0.315);
  let g = abs(fract(p.xz) - vec2f(0.5));
  let line = 1.0 - smoothstep(0.0, 0.015, min(g.x, g.y));
  var c = mix(base, vec3f(0.50, 0.51, 0.52), vec3f(line * 0.8));
  let chk = (floor(p.x) + floor(p.z)) - 2.0 * floor((floor(p.x) + floor(p.z)) * 0.5);
  c *= mix(0.88, 1.10, chk);
  return c;
}`;
const poolFns=`fn capWave(p:vec3f,dir:vec2f,k:f32,omega:f32,phase:f32)->vec2f{
  let th=dot(p.xz,dir)*k-C.realism0.x*omega+phase;
  return dir*cos(th);
}

fn realismMicro(p:vec3f,n:vec3f)->vec2f{
  // Deep-water gravity-capillary dispersion: omega^2 = g k + (sigma/rho) k^3.
  // The constants below correspond to k = 38,55,78,105 rad/m for water near room temperature.
  let surfaceActivity=clamp((length(dpdx(n))+length(dpdy(n)))*8.0,0.0,1.0);
  let amp=0.0105*C.realism0.y*(0.28+0.72*surfaceActivity);
  var s=vec2f(0.0);
  s+=capWave(p,normalize(vec2f(1.0,0.31)),38.0,19.41,0.0)*1.00;
  s+=capWave(p,normalize(vec2f(-0.42,1.0)),55.0,23.48,1.7)*0.76;
  s+=capWave(p,normalize(vec2f(0.68,1.0)),78.0,28.27,3.1)*0.52;
  s+=capWave(p,normalize(vec2f(-1.0,0.21)),105.0,33.37,4.6)*0.34;
  return s*amp;
}

fn realismReceiverShadow(p: vec3f) -> f32 {
  if(C.bodyCount<=0 || C.realism1.z<=0.001){return 1.0;}
  let centre=bdata[0u].xyz;let radius=max(bdata[1u].x,1.0e-4);let oc=p-centre;
  let qb=dot(oc,C.sunDir);let qc=dot(oc,oc)-radius*radius;let disc=qb*qb-qc;
  if(disc<=0.0){return 1.0;}let root=sqrt(disc);let tFar=-qb+root;if(tFar<=0.0){return 1.0;}
  let softness=smoothstep(0.0,radius*radius*0.24,disc);return mix(1.0,0.24,softness*clamp(C.realism1.z,0.0,1.0));
}

fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {
  var uv=p.xz*8.5;if(abs(n.x)>0.5){uv=p.zy*8.5;}if(abs(n.z)>0.5){uv=p.xy*8.5;}
  let cell=floor(uv);let q=abs(fract(uv)-vec2f(0.5));let grout=smoothstep(0.435,0.492,max(q.x,q.y));
  let alt=(cell.x+cell.y)-2.0*floor((cell.x+cell.y)*0.5);
  var c=mix(vec3f(0.31,0.68,0.74),vec3f(0.45,0.79,0.82),vec3f(alt*0.70));
  c=mix(c,vec3f(0.88,0.96,0.97),vec3f(grout*0.84));let ndl=max(dot(n,C.sunDir),0.0);c*=0.80+0.30*ndl;c*=realismReceiverShadow(p);return c;
}
fn floorColor(p:vec3f)->vec3f{return poolTileColor(p,vec3f(0.0,1.0,0.0));}
struct PoolHit { t:f32,n:vec3f,p:vec3f }
fn tracePool(o:vec3f,d:vec3f)->PoolHit{
  var h:PoolHit;h.t=1.0e30;h.n=vec3f(0.0,1.0,0.0);h.p=vec3f(0.0);let lo=C.boxMin;let hi=C.boxMax;let pad=0.025;let wallTop=lo.y+(hi.y-lo.y)*0.37;
  if(abs(d.y)>1.0e-5){let t=(lo.y-o.y)/d.y;if(t>1.0e-4){let p=o+d*t;if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(0,1,0);h.p=p;}}}
  if(abs(d.x)>1.0e-5){var t=(lo.x-o.x)/d.x;var p=o+d*t;if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(1,0,0);h.p=p;}t=(hi.x-o.x)/d.x;p=o+d*t;if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(-1,0,0);h.p=p;}}
  if(abs(d.z)>1.0e-5){var t=(lo.z-o.z)/d.z;var p=o+d*t;if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0,0,1);h.p=p;}t=(hi.z-o.z)/d.z;p=o+d*t;if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0,0,-1);h.p=p;}}
  return h;
}`;
patch(floorNeedle,poolFns,'pool + capillary helpers');

const bgNeedle=`fn background(o: vec3f, d: vec3f) -> vec3f {
  if (C.floorPlane != 0 && d.y < -1.0e-4) {
    let t = (C.boxMin.y - o.y) / d.y;
    if (t > 0.0) {
      let p = o + d * t;

      let fade = 1.0 - exp(-0.02 * t);
      var far = kHaze;
      if (C.hasEnvMap != 0) { far = envSample(d); }
      return mix(floorColor(p), far, vec3f(fade));
    }
  }
  return skyColor(d);
}`;
patch(bgNeedle,`fn background(o:vec3f,d:vec3f)->vec3f{
  if(C.floorPlane!=0){let ph=tracePool(o,d);if(ph.t<1.0e29){let tile=poolTileColor(ph.p,ph.n);var far=kHaze;if(C.hasEnvMap!=0){far=envSample(d);}let haze=min(0.075,1.0-exp(-0.010*ph.t));return mix(tile,far,vec3f(haze));}}
  return skyColor(d);
}`,'tiled background');

patch(`  let trans = hitCol * exp(-C.absorb * thick);`,
`  let poolHit=tracePool(ro2,refrDir);if(poolHit.t<1.0e29){thick=min(thick,poolHit.t);}

  // Refractive focusing from the local Jacobian of the surface->receiver mapping.
  // When a screen-space patch of water maps to a smaller patch on the receiver, light density rises.
  let sdx=dpdx(p.xz);let sdy=dpdy(p.xz);let ddx=dpdx(poolHit.p.xz);let ddy=dpdy(poolHit.p.xz);
  let srcArea=abs(sdx.x*sdy.y-sdx.y*sdy.x);let dstArea=abs(ddx.x*ddy.y-ddx.y*ddy.x);
  let receiver=select(0.0,1.0,poolHit.t<1.0e29);let areaRatio=clamp(srcArea/max(dstArea,1.0e-7),0.0,6.0);
  let jacFocus=max(0.0,areaRatio-1.0);
  let refrDx=dpdx(refrDir);let refrDy=dpdy(refrDir);let angularFocus=max(0.0,-(refrDx.x+refrDy.y));
  let causticDepth=smoothstep(0.02,0.32,thick);let causticDown=smoothstep(0.03,0.88,-refrDir.y);
  let focus=min(3.4,jacFocus*0.72+angularFocus*24.0)*causticDepth*causticDown*receiver;
  let causticGain=0.42+1.05*clamp(C.groundReflection,0.0,2.0);
  hitCol*=vec3f(1.0+focus*causticGain*0.82,1.0+focus*causticGain*0.77,1.0+focus*causticGain*0.58);
  hitCol+=vec3f(1.0,0.97,0.84)*focus*causticGain*0.12;

  var trans=hitCol*exp(-C.absorb*thick);
  let scatterDepth=(1.0-exp(-max(thick,0.0)*3.2))*clamp(C.realism0.w,0.0,1.25);let forward=pow(max(dot(-rd,C.sunDir),0.0),4.0);
  trans+=vec3f(0.020,0.135,0.205)*scatterDepth*(0.58+1.20*forward);
  let grazing=pow(1.0-max(dot(-rd,n),0.0),2.0);let disp=clamp(C.realism0.z,0.0,1.25)*grazing*(1.0-exp(-max(thick,0.0)*4.0));trans*=vec3f(1.0+0.030*disp,1.0,1.0-0.040*disp);
  let thinEdge=1.0-smoothstep(0.018,0.115,max(thick,0.0));let steep=pow(clamp(1.0-abs(n.y),0.0,1.0),1.35);let foamMask=clamp(thinEdge*(0.22+0.78*steep)*C.realism1.x,0.0,0.72);trans=mix(trans,vec3f(0.78,0.91,0.97),vec3f(foamMask));
  let shaft=pow(max(dot(-rd,C.sunDir),0.0),8.0)*smoothstep(0.04,0.55,max(thick,0.0))*C.realism1.y;trans+=vec3f(0.18,0.34,0.42)*shaft;`,'jacobian caustics + transmission');

patch(`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,
`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n  let microN=realismMicro(p,n);\n  n=normalize(n+vec3f(microN.x,0.0,microN.y));\n  if(dot(n,rd)>0.0){n=-n;}\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,'gravity-capillary normal');

const shaderMod=dev.createShaderModule({code:src,label:'fluidV5M810RippleCausticWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M8.1 optics WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createRenderPipelineAsync({label:'fluidV5M810RippleCausticComposite',layout:'auto',vertex:{module:shaderMod,entryPoint:'vs'},fragment:{module:shaderMod,entryPoint:'fs',targets:[{format:ssfr.format}]},primitive:{topology:'triangle-list'}});
ssfr.pipeComposite=pipe;ssfr.bindCache=null;

// Give the new high-frequency surface spectrum enough energy to be visible, while retaining
// the existing Realism controls and clear-pool optical material.
realism.micro=Math.max(realism.micro,0.38);realism.scattering=Math.max(realism.scattering,0.18);realism.shafts=Math.max(realism.shafts,0.14);
ssfr.groundReflection=Math.max(ssfr.groundReflection,1.45);

window.__v5M810Optics={online:true,backend:'gravity-capillary-normal-plus-jacobian-caustics-m810',gpuPassesAdded:0,gpuSubmitsAdded:0};
window.__fluidV5Version='8.1.0';
console.info('[Fluid V5 M8.1] gravity-capillary subgrid ripples + receiver-Jacobian caustics online; zero added passes/submits.');