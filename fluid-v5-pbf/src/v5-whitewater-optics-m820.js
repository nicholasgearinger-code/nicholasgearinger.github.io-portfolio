// Fluid V5 M8.2 — capillary ripples, receiver caustics, whitewater foam and entrained bubbles.
// Rendering-only whitewater layer: no extra render/compute pass, encoder, or queue.submit.
// Foam/bubbles are diffuse water-air detail driven by reconstructed surface activity; they do
// not alter the primary PBF/DFSPH-like water motion.

const ssfr=window.__ssfr,sim=window.__sim,realism=window.__fluidV44Realism;
if(!ssfr?.dev||!ssfr?.format||!sim||!realism||!window.__v5M739Unified?.online) throw new Error('M8.2 whitewater: stable SSFR runtime unavailable.');
const dev=ssfr.dev;
const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const CW=await import(UPSTREAM+'ssfr_composite_wgsl.js');let src=CW.compositePrelude+CW.compositeFS;
function patch(needle,replacement,label){if(!src.includes(needle))throw new Error(`M8.2 whitewater signature changed: ${label}`);src=src.replace(needle,replacement);}

patch(`  mapScale    : vec2f,\n}`,
`  mapScale    : vec2f,\n  realism0    : vec4f, // time, micro, dispersion, scattering\n  realism1    : vec4f, // whitewater, shafts, receiver shadow, spare\n}`,'uniform extension');
const suppress='  let suppress = (1.0 - clamp(C.groundReflection, 0.0, 1.0)) * topSurface * belowHorizon;';if(src.includes(suppress))src=src.replace(suppress,'  let suppress = 0.92 * topSurface * belowHorizon;');

const floorNeedle=`fn floorColor(p: vec3f) -> vec3f {
  let base = vec3f(0.30, 0.305, 0.315);
  let g = abs(fract(p.xz) - vec2f(0.5));
  let line = 1.0 - smoothstep(0.0, 0.015, min(g.x, g.y));
  var c = mix(base, vec3f(0.50, 0.51, 0.52), vec3f(line * 0.8));
  let chk = (floor(p.x) + floor(p.z)) - 2.0 * floor((floor(p.x) + floor(p.z)) * 0.5);
  c *= mix(0.88, 1.10, chk);
  return c;
}`;
const helpers=`fn capWave(p:vec3f,dir:vec2f,k:f32,omega:f32,phase:f32)->vec2f{
  let th=dot(p.xz,dir)*k-C.realism0.x*omega+phase;return dir*cos(th);
}
fn realismMicro(p:vec3f,n:vec3f)->vec2f{
  let activity=clamp((length(dpdx(n))+length(dpdy(n)))*8.0,0.0,1.0);
  let amp=0.0105*C.realism0.y*(0.26+0.74*activity);var s=vec2f(0.0);
  s+=capWave(p,normalize(vec2f(1.0,.31)),38.0,19.41,0.0);
  s+=capWave(p,normalize(vec2f(-.42,1.0)),55.0,23.48,1.7)*.76;
  s+=capWave(p,normalize(vec2f(.68,1.0)),78.0,28.27,3.1)*.52;
  s+=capWave(p,normalize(vec2f(-1.0,.21)),105.0,33.37,4.6)*.34;return s*amp;
}
fn hash31(p:vec3f)->f32{var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
fn foamNoise(p:vec3f)->f32{
  let a=.5+.5*sin(p.x*71.0+p.z*57.0+C.realism0.x*2.7);
  let b=.5+.5*sin(p.x*-43.0+p.z*89.0-C.realism0.x*2.1+1.9);return a*b;
}
fn bubbleField(ro:vec3f,rd:vec3f,thick:f32,activity:f32)->f32{
  if(thick<.035||activity<=.001){return 0.0;}var sum=0.0;
  for(var k=0;k<6;k++){
    let f=(f32(k)+.5)/6.0;let p=ro+rd*thick*f;
    let q=p*vec3f(19.0,16.0,19.0)+vec3f(0.0,-C.realism0.x*1.25,0.0);
    let cell=floor(q);let local=fract(q)-vec3f(.5);let seed=hash31(cell+vec3f(17.17,4.31,9.73));
    let radius=.075+.075*hash31(cell+vec3f(2.7,8.1,1.3));let sphere=1.0-smoothstep(radius*.42,radius,length(local));
    sum+=step(.80,seed)*sphere;
  }
  return clamp(sum*activity,0.0,1.0);
}
fn realismReceiverShadow(p:vec3f)->f32{
  if(C.bodyCount<=0||C.realism1.z<=.001){return 1.0;}let centre=bdata[0u].xyz;let radius=max(bdata[1u].x,1e-4);let oc=p-centre;
  let qb=dot(oc,C.sunDir);let qc=dot(oc,oc)-radius*radius;let disc=qb*qb-qc;if(disc<=0.0){return 1.0;}let root=sqrt(disc);let tFar=-qb+root;if(tFar<=0.0){return 1.0;}
  return mix(1.0,.24,smoothstep(0.0,radius*radius*.24,disc)*clamp(C.realism1.z,0.0,1.0));
}
fn poolTileColor(p:vec3f,n:vec3f)->vec3f{
  var uv=p.xz*8.5;if(abs(n.x)>.5){uv=p.zy*8.5;}if(abs(n.z)>.5){uv=p.xy*8.5;}
  let cell=floor(uv);let q=abs(fract(uv)-vec2f(.5));let grout=smoothstep(.435,.492,max(q.x,q.y));let alt=(cell.x+cell.y)-2.0*floor((cell.x+cell.y)*.5);
  var c=mix(vec3f(.31,.68,.74),vec3f(.45,.79,.82),vec3f(alt*.70));c=mix(c,vec3f(.88,.96,.97),vec3f(grout*.84));c*=.80+.30*max(dot(n,C.sunDir),0.0);c*=realismReceiverShadow(p);return c;
}
fn floorColor(p:vec3f)->vec3f{return poolTileColor(p,vec3f(0,1,0));}
struct PoolHit{t:f32,n:vec3f,p:vec3f}
fn tracePool(o:vec3f,d:vec3f)->PoolHit{
  var h:PoolHit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;let wallTop=lo.y+(hi.y-lo.y)*.37;
  if(abs(d.y)>1e-5){let t=(lo.y-o.y)/d.y;if(t>1e-4){let p=o+d*t;if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(0,1,0);h.p=p;}}}
  if(abs(d.x)>1e-5){var t=(lo.x-o.x)/d.x;var p=o+d*t;if(t>1e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(1,0,0);h.p=p;}t=(hi.x-o.x)/d.x;p=o+d*t;if(t>1e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.z>=lo.z-pad&&p.z<=hi.z+pad&&t<h.t){h.t=t;h.n=vec3f(-1,0,0);h.p=p;}}
  if(abs(d.z)>1e-5){var t=(lo.z-o.z)/d.z;var p=o+d*t;if(t>1e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0,0,1);h.p=p;}t=(hi.z-o.z)/d.z;p=o+d*t;if(t>1e-4&&p.y>=lo.y-pad&&p.y<=wallTop&&p.x>=lo.x-pad&&p.x<=hi.x+pad&&t<h.t){h.t=t;h.n=vec3f(0,0,-1);h.p=p;}}
  return h;
}`;
patch(floorNeedle,helpers,'pool + ripple + whitewater helpers');

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
patch(bgNeedle,`fn background(o:vec3f,d:vec3f)->vec3f{if(C.floorPlane!=0){let ph=tracePool(o,d);if(ph.t<1e29){let tile=poolTileColor(ph.p,ph.n);var far=kHaze;if(C.hasEnvMap!=0){far=envSample(d);}let haze=min(.075,1.0-exp(-.010*ph.t));return mix(tile,far,vec3f(haze));}}return skyColor(d);}`,'tiled background');

patch(`  let trans = hitCol * exp(-C.absorb * thick);`,
`  let poolHit=tracePool(ro2,refrDir);if(poolHit.t<1e29){thick=min(thick,poolHit.t);}
  let sdx=dpdx(p.xz);let sdy=dpdy(p.xz);let ddx=dpdx(poolHit.p.xz);let ddy=dpdy(poolHit.p.xz);
  let srcArea=abs(sdx.x*sdy.y-sdx.y*sdy.x);let dstArea=abs(ddx.x*ddy.y-ddx.y*ddy.x);let receiver=select(0.0,1.0,poolHit.t<1e29);
  let jacFocus=max(0.0,clamp(srcArea/max(dstArea,1e-7),0.0,6.0)-1.0);let refrDx=dpdx(refrDir);let refrDy=dpdy(refrDir);let angularFocus=max(0.0,-(refrDx.x+refrDy.y));
  let causticDepth=smoothstep(.02,.32,thick);let causticDown=smoothstep(.03,.88,-refrDir.y);let focus=min(3.4,jacFocus*.72+angularFocus*24.0)*causticDepth*causticDown*receiver;
  let causticGain=.42+1.05*clamp(C.groundReflection,0.0,2.0);hitCol*=vec3f(1.0+focus*causticGain*.82,1.0+focus*causticGain*.77,1.0+focus*causticGain*.58);hitCol+=vec3f(1.0,.97,.84)*focus*causticGain*.12;
  var trans=hitCol*exp(-C.absorb*thick);
  let scatterDepth=(1.0-exp(-max(thick,0.0)*3.2))*clamp(C.realism0.w,0.0,1.25);let forward=pow(max(dot(-rd,C.sunDir),0.0),4.0);trans+=vec3f(.020,.135,.205)*scatterDepth*(.58+1.20*forward);
  let grazing=pow(1.0-max(dot(-rd,n),0.0),2.0);let disp=clamp(C.realism0.z,0.0,1.25)*grazing*(1.0-exp(-max(thick,0.0)*4.0));trans*=vec3f(1.0+.030*disp,1.0,1.0-.040*disp);

  // Diffuse water-air mixture: foam at thin/curved/steep surface regions, plus small entrained
  // bubbles below those active regions. This is deliberately one-way visual detail.
  let activity=clamp((length(dpdx(n))+length(dpdy(n)))*7.5,0.0,1.0);
  let thinEdge=1.0-smoothstep(.020,.125,max(thick,0.0));let steep=pow(clamp(1.0-abs(n.y),0.0,1.0),1.25);
  let whiteStrength=clamp(C.realism1.x,0.0,1.25);let noise=.48+.52*foamNoise(p);
  let foamMask=clamp((activity*.72+thinEdge*steep*.88)*whiteStrength*noise,0.0,.90);
  let bubbleMask=bubbleField(ro2,refrDir,min(thick,.72),clamp(activity*whiteStrength*smoothstep(.055,.42,thick),0.0,1.0));
  trans=mix(trans,vec3f(.86,.95,.99),vec3f(foamMask*.82));
  trans=mix(trans,vec3f(.77,.91,.97),vec3f(bubbleMask*.34));
  let shaft=pow(max(dot(-rd,C.sunDir),0.0),8.0)*smoothstep(.04,.55,max(thick,0.0))*C.realism1.y;trans+=vec3f(.18,.34,.42)*shaft;`,'caustics + whitewater transmission');

patch(`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,
`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n  let microN=realismMicro(p,n);n=normalize(n+vec3f(microN.x,0.0,microN.y));if(dot(n,rd)>0.0){n=-n;}\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,'capillary normal');

patch(`  return vec4f(tonemap(col), 1.0);`,
`  // Coverage-aware silhouette resolve keeps isolated spray circular even when it spans only
  // a few reduced-resolution depth pixels.
  var resolvedColor=tonemap(col);
  let edgeWidth=max(fwidth(thick)*1.35,0.0015);
  let waterCoverage=smoothstep(0.0,edgeWidth,max(thick,0.0));
  if(waterCoverage<0.999){
    let sceneBehind=tonemap(sceneColor(ro,rd));
    resolvedColor=mix(sceneBehind,resolvedColor,vec3f(waterCoverage));
  }
  return vec4f(resolvedColor,1.0);`,'rounded sparse silhouette resolve');

const shaderMod=dev.createShaderModule({code:src,label:'fluidV5M820WhitewaterWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){const info=await shaderMod.getCompilationInfo();const errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error('M8.2 whitewater WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));}
ssfr.pipeComposite=await dev.createRenderPipelineAsync({label:'fluidV5M820WhitewaterComposite',layout:'auto',vertex:{module:shaderMod,entryPoint:'vs'},fragment:{module:shaderMod,entryPoint:'fs',targets:[{format:ssfr.format}]},primitive:{topology:'triangle-list'}});ssfr.bindCache=null;
realism.micro=Math.max(realism.micro,.42);realism.scattering=Math.max(realism.scattering,.20);realism.foam=Math.max(realism.foam,.50);realism.shafts=Math.max(realism.shafts,.16);ssfr.groundReflection=Math.max(ssfr.groundReflection,1.45);

// Rename the existing foam slider so the UI reflects that it now controls both surface foam and entrained bubbles.
for(const label of document.querySelectorAll('.m742Row label')){if(label.textContent==='EDGE FOAM')label.textContent='WHITEWATER';}
const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');if(tabbar&&host){const tabs=[...tabbar.children],idx=tabs.findIndex(b=>b.dataset.key==='realism');const page=idx>=0?host.children[idx]:null;if(page){const note=document.createElement('div');note.className='m742Status';note.style.marginTop='10px';note.textContent='M8.2 WHITEWATER\nSurface foam and entrained micro-bubbles are generated from reconstructed curvature, thin sheets and steep breaking regions. This is a one-way diffuse-material layer: it improves visual realism without pushing the primary fluid or adding another GPU submission.';page.appendChild(note);}}

window.__v5M820Whitewater={online:true,backend:'activity-driven-foam-bubbles-plus-capillary-caustics-m820',gpuPassesAdded:0,gpuSubmitsAdded:0};
window.__fluidV5Version='8.2.0';
console.info('[Fluid V5 M8.2] capillary ripples + Jacobian caustics + whitewater foam/bubbles online; zero added passes/submits.');
