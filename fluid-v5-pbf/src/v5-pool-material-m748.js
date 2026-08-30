// Fluid V5 M7.4.8 — restore the V4 clear-pool optical material and tiled liner.
// This runs AFTER M7.4.6 realism + M7.4.7 water controls. It replaces only the
// existing SSFR composite pipeline and material uniforms. No render/compute pass,
// command encoder, temporal history, or queue.submit is added.

const ssfr=window.__ssfr;
const sim=window.__sim;
const realism=window.__fluidV44Realism;
const water=window.__v5M747WaterLook;
if(!ssfr?.dev||!ssfr?.format||!sim||!realism||!water?.online||!window.__v5M739Unified?.online){
  throw new Error('M7.4.8 pool restore: M7.4.6/M7.4.7 stable runtime unavailable.');
}
const dev=ssfr.dev;

const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const CW=await import(UPSTREAM+'ssfr_composite_wgsl.js');
let src=CW.compositePrelude+CW.compositeFS;

function patch(needle,replacement,label){
  if(!src.includes(needle)) throw new Error(`M7.4.8 pool shader signature changed: ${label}`);
  src=src.replace(needle,replacement);
}

// Keep the exact M7.4.6 extended uniform layout so the existing 288-byte
// composite uniform buffer and render wrapper remain compatible.
patch(`  mapScale    : vec2f,\n}`,
`  mapScale    : vec2f,\n  realism0    : vec4f, // time, micro, dispersion, scattering\n  realism1    : vec4f, // edge foam, shafts, receiver shadow, spare\n}`,'uniform extension');

// Restore the old pool reflection response: groundReflection is used as the
// caustic-strength control rather than globally blackening the top surface.
const suppressNeedle='  let suppress = (1.0 - clamp(C.groundReflection, 0.0, 1.0)) * topSurface * belowHorizon;';
if(src.includes(suppressNeedle)){
  src=src.replace(suppressNeedle,'  let suppress = 0.92 * topSurface * belowHorizon;');
}

const floorNeedle=`fn floorColor(p: vec3f) -> vec3f {
  let base = vec3f(0.30, 0.305, 0.315);
  let g = abs(fract(p.xz) - vec2f(0.5));
  let line = 1.0 - smoothstep(0.0, 0.015, min(g.x, g.y));
  var c = mix(base, vec3f(0.50, 0.51, 0.52), vec3f(line * 0.8));
  let chk = (floor(p.x) + floor(p.z)) - 2.0 * floor((floor(p.x) + floor(p.z)) * 0.5);
  c *= mix(0.88, 1.10, chk);
  return c;
}`;

const poolFns=`fn realismMicro(p: vec3f) -> vec2f {
  let t=C.realism0.x;
  let a=sin(p.x*29.0+p.z*17.0+t*3.70);
  let b=sin(p.x*-23.0+p.z*31.0-t*3.10);
  let c=sin((p.x+p.z)*47.0+t*5.20);
  return vec2f(a+c*0.35,b-c*0.30)*(0.018*C.realism0.y);
}

fn realismReceiverShadow(p: vec3f) -> f32 {
  if(C.bodyCount<=0 || C.realism1.z<=0.001){return 1.0;}
  let centre=bdata[0u].xyz;
  let radius=max(bdata[1u].x,1.0e-4);
  let oc=p-centre;
  let qb=dot(oc,C.sunDir);
  let qc=dot(oc,oc)-radius*radius;
  let disc=qb*qb-qc;
  if(disc<=0.0){return 1.0;}
  let root=sqrt(disc);
  let tFar=-qb+root;
  if(tFar<=0.0){return 1.0;}
  let softness=smoothstep(0.0,radius*radius*0.24,disc);
  return mix(1.0,0.24,softness*clamp(C.realism1.z,0.0,1.0));
}

fn poolTileColor(p: vec3f, n: vec3f) -> vec3f {
  var uv=p.xz*8.5;
  if(abs(n.x)>0.5){uv=p.zy*8.5;}
  if(abs(n.z)>0.5){uv=p.xy*8.5;}
  let cell=floor(uv);
  let q=abs(fract(uv)-vec2f(0.5));
  let grout=smoothstep(0.435,0.492,max(q.x,q.y));
  let alt=(cell.x+cell.y)-2.0*floor((cell.x+cell.y)*0.5);
  let aquaA=vec3f(0.31,0.68,0.74);
  let aquaB=vec3f(0.45,0.79,0.82);
  var c=mix(aquaA,aquaB,vec3f(alt*0.70));
  c=mix(c,vec3f(0.88,0.96,0.97),vec3f(grout*0.84));
  let ndl=max(dot(n,C.sunDir),0.0);
  c*=0.80+0.30*ndl;
  c*=realismReceiverShadow(p);
  return c;
}

fn floorColor(p: vec3f) -> vec3f {
  return poolTileColor(p,vec3f(0.0,1.0,0.0));
}

struct PoolHit { t:f32, n:vec3f, p:vec3f }

fn tracePool(o:vec3f,d:vec3f)->PoolHit{
  var h:PoolHit;
  h.t=1.0e30;
  h.n=vec3f(0.0,1.0,0.0);
  h.p=vec3f(0.0);
  let lo=C.boxMin;
  let hi=C.boxMax;
  let pad=0.025;
  // Match the later V4 pool: the visual tile liner ends slightly above the
  // normal resting waterline instead of becoming a tall aquarium box.
  let wallTop=lo.y+(hi.y-lo.y)*0.37;

  if(abs(d.y)>1.0e-5){
    let t=(lo.y-o.y)/d.y;
    if(t>1.0e-4){
      let p=o+d*t;
      if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){
        h.t=t;h.n=vec3f(0.0,1.0,0.0);h.p=p;
      }
    }
  }
  if(abs(d.x)>1.0e-5){
    var t=(lo.x-o.x)/d.x;var p=o+d*t;
    if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(1.0,0.0,0.0);h.p=p;}
    t=(hi.x-o.x)/d.x;p=o+d*t;
    if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(-1.0,0.0,0.0);h.p=p;}
  }
  if(abs(d.z)>1.0e-5){
    var t=(lo.z-o.z)/d.z;var p=o+d*t;
    if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0.0,0.0,1.0);h.p=p;}
    t=(hi.z-o.z)/d.z;p=o+d*t;
    if(t>1.0e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0.0,0.0,-1.0);h.p=p;}
  }
  return h;
}`;
patch(floorNeedle,poolFns,'V4 tiled liner');

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
const bgPatch=`fn background(o:vec3f,d:vec3f)->vec3f{
  if(C.floorPlane!=0){
    let ph=tracePool(o,d);
    if(ph.t<1.0e29){
      let tile=poolTileColor(ph.p,ph.n);
      var far=kHaze;
      if(C.hasEnvMap!=0){far=envSample(d);}
      let haze=min(0.075,1.0-exp(-0.010*ph.t));
      return mix(tile,far,vec3f(haze));
    }
  }
  return skyColor(d);
}`;
patch(bgNeedle,bgPatch,'V4 tiled background');

patch(`  let trans = hitCol * exp(-C.absorb * thick);`,
`  // Bound absorption by the actual tiled receiver. This is what made the old
  // deep pool stay clear instead of reading as a solid cyan block.
  let poolHit=tracePool(ro2,refrDir);
  if(poolHit.t<1.0e29){thick=min(thick,poolHit.t);}

  // M7.4.6 reconstructed-surface caustic focusing, now landing on the restored tiles.
  let refrDx=dpdx(refrDir);
  let refrDy=dpdy(refrDir);
  let convergence=max(0.0,-(refrDx.x+refrDy.y));
  let receiver=select(0.0,1.0,poolHit.t<1.0e29);
  let causticDepth=smoothstep(0.025,0.30,thick);
  let causticDown=smoothstep(0.04,0.86,-refrDir.y);
  let causticEnergy=min(2.45,convergence*42.0)*causticDepth*causticDown*receiver;
  let causticGain=0.30+1.15*clamp(C.groundReflection,0.0,2.0);
  hitCol*=vec3f(1.0+causticEnergy*causticGain*0.74,
                1.0+causticEnergy*causticGain*0.70,
                1.0+causticEnergy*causticGain*0.55);
  hitCol+=vec3f(1.0,0.97,0.86)*causticEnergy*causticGain*0.10;

  var trans=hitCol*exp(-C.absorb*thick);

  let scatterDepth=(1.0-exp(-max(thick,0.0)*3.2))*clamp(C.realism0.w,0.0,1.25);
  let forward=pow(max(dot(-rd,C.sunDir),0.0),4.0);
  trans+=vec3f(0.020,0.135,0.205)*scatterDepth*(0.58+1.20*forward);

  let grazing=pow(1.0-max(dot(-rd,n),0.0),2.0);
  let disp=clamp(C.realism0.z,0.0,1.25)*grazing*(1.0-exp(-max(thick,0.0)*4.0));
  trans*=vec3f(1.0+0.030*disp,1.0,1.0-0.040*disp);

  let thinEdge=1.0-smoothstep(0.018,0.115,max(thick,0.0));
  let steep=pow(clamp(1.0-abs(n.y),0.0,1.0),1.35);
  let foamMask=clamp(thinEdge*(0.22+0.78*steep)*C.realism1.x,0.0,0.72);
  trans=mix(trans,vec3f(0.78,0.91,0.97),vec3f(foamMask));

  let shaft=pow(max(dot(-rd,C.sunDir),0.0),8.0)*smoothstep(0.04,0.55,max(thick,0.0))*C.realism1.y;
  trans+=vec3f(0.18,0.34,0.42)*shaft;`,'pool transmission + realism');

patch(`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,
`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n  let microN=realismMicro(p);\n  n=normalize(n+vec3f(microN.x,0.0,microN.y));\n  if(dot(n,rd)>0.0){n=-n;}\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,'micro normal');

const shaderMod=dev.createShaderModule({code:src,label:'fluidV5M748PoolRealismWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length)throw new Error('M7.4.8 pool WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createRenderPipelineAsync({
  label:'fluidV5M748PoolComposite',layout:'auto',
  vertex:{module:shaderMod,entryPoint:'vs'},
  fragment:{module:shaderMod,entryPoint:'fs',targets:[{format:ssfr.format}]},
  primitive:{topology:'triangle-list'},
});
ssfr.pipeComposite=pipe;
ssfr.bindCache=null;

// Restore the actual tuned V4 pool material, not merely a screen tint.
const restored={
  transmit:[0.34902,0.705882,0.894118],
  ior:1.333,
  absorption:0.30,
  roughness:0.038,
  thickness:0.155,
  sunIntensity:4.85,
  sunElevation:31.0,
  sunAzimuth:42.75,
  exposure:1.62,
  envIntensity:1.08,
  envYaw:0.0,
  caustics:1.35,
  micro:0.24,
  dispersion:0.10,
  scattering:0.18,
  foam:0.08,
  shafts:0.12,
  shadow:0.78,
};

// Replace M7.4.7's POOL preset in-place so its existing buttons/sliders continue
// to represent the material that is actually being rendered.
Object.assign(water.looks.POOL,{
  transmit:[...restored.transmit],absorption:restored.absorption,
  roughness:restored.roughness,thickness:restored.thickness,
  scattering:restored.scattering,dispersion:restored.dispersion,
  foam:restored.foam,shafts:restored.shafts,micro:restored.micro,
  note:'Restored V4 clear pool material over the original procedural aqua tile liner.'
});
water.applyPreset('POOL');

ssfr.transmit=[...restored.transmit];
ssfr.ior=restored.ior;
ssfr.absorption=restored.absorption;
ssfr.roughness=restored.roughness;
ssfr.thicknessScale=restored.thickness;
ssfr.sunIntensity=restored.sunIntensity;
ssfr.sunElevation=restored.sunElevation;
ssfr.sunAzimuth=restored.sunAzimuth;
ssfr.exposure=restored.exposure;
ssfr.groundReflection=restored.caustics;
ssfr.floorPlane=true;
if(ssfr.env){ssfr.env.intensity=restored.envIntensity;ssfr.env.yaw=restored.envYaw;}
Object.assign(realism,{
  micro:restored.micro,dispersion:restored.dispersion,scattering:restored.scattering,
  foam:restored.foam,shafts:restored.shafts,shadow:restored.shadow,
});
ssfr.bindCache=null;

// M7.4.7 clamps optical depth >= 0.45 when a slider is moved. Lower that UI
// minimum for this isolated build so the restored 0.155 V4 thickness remains reachable.
const waterTab=document.getElementById('m742Host');
function restorePoolLighting(){
  ssfr.ior=restored.ior;
  ssfr.sunIntensity=restored.sunIntensity;
  ssfr.sunElevation=restored.sunElevation;
  ssfr.sunAzimuth=restored.sunAzimuth;
  ssfr.exposure=restored.exposure;
  ssfr.groundReflection=restored.caustics;
  if(ssfr.env){ssfr.env.intensity=restored.envIntensity;ssfr.env.yaw=restored.envYaw;}
}
function enforceLowOpticalDepth(){
  // M7.4.7's internal clamp predates the original V4 0.155 thickness. Re-apply
  // the visible WATER state after its handler so Pool/Custom edits keep the old range.
  if(water.active==='POOL'||water.active==='CUSTOM'){
    ssfr.thicknessScale=Math.min(1.8,Math.max(0.10,Number(water.state.thickness)));
  }
}
if(waterTab){
  for(const row of waterTab.querySelectorAll('.m742Row')){
    const label=row.querySelector('label')?.textContent||'';
    const input=row.querySelector('input[type="range"]');
    if(label==='OPTICAL DEPTH'&&input){input.min='0.10';input.value=String(restored.thickness);}
    if(input)input.addEventListener('input',()=>queueMicrotask(enforceLowOpticalDepth));
  }
  for(const button of waterTab.querySelectorAll('button')){
    if(button.textContent==='POOL')button.addEventListener('click',()=>queueMicrotask(()=>{
      enforceLowOpticalDepth();restorePoolLighting();
    }));
  }
}

window.__v5M748PoolMaterial={
  online:true,backend:'single-ssfr-composite-v4-tiles-plus-m746-realism',
  gpuPassesAdded:0,gpuSubmitsAdded:0,restored
};
window.__fluidV5Version='7.4.8';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.4.8';
document.title='Fluid V5 · M7.4.8 Clear Pool Restore';
console.info('[Fluid V5 M7.4.8] V4 clear-pool material + tiled liner restored; zero added GPU passes/submits.');
