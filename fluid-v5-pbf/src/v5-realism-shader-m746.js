// Fluid V5 M7.4.6 — iOS-safe realism shader restore on the proven M7.3.9 unified scheduler.
// This stage swaps ONLY the existing SSFR composite shader. It adds no GPUCommandEncoder,
// no extra render/compute pass, and no queue.submit call. Temporal accumulation stays OFF.

const ssfr=window.__ssfr, sim=window.__sim;
if(!ssfr?.dev||!ssfr?.format||!sim||!window.__v5M739Unified?.online)
  throw new Error('M7.4.6 realism: stable SSFR/unified runtime unavailable.');
const dev=ssfr.dev;

const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const CW=await import(UPSTREAM+'ssfr_composite_wgsl.js');
let src=CW.compositePrelude+CW.compositeFS;

function patch(needle,replacement,label){
  if(!src.includes(needle)) throw new Error(`M7.4.6 realism shader signature changed: ${label}`);
  src=src.replace(needle,replacement);
}

patch(`  mapScale    : vec2f,\n}`,
`  mapScale    : vec2f,\n  realism0    : vec4f, // time, micro, dispersion, scattering\n  realism1    : vec4f, // edge foam, shafts, receiver shadow, spare\n}`,'uniform extension');

patch(`fn floorColor(p: vec3f) -> vec3f {`,
`fn realismMicro(p: vec3f) -> vec2f {\n  let t=C.realism0.x;\n  let a=sin(p.x*29.0+p.z*17.0+t*3.70);\n  let b=sin(p.x*-23.0+p.z*31.0-t*3.10);\n  let c=sin((p.x+p.z)*47.0+t*5.20);\n  return vec2f(a+c*0.35,b-c*0.30)*(0.018*C.realism0.y);\n}\n\nfn realismReceiverShadow(p: vec3f) -> f32 {\n  if(C.bodyCount<=0 || C.realism1.z<=0.001){return 1.0;}\n  let centre=bdata[0u].xyz;\n  let radius=max(bdata[1u].x,1.0e-4);\n  let oc=p-centre;\n  let qb=dot(oc,C.sunDir);\n  let qc=dot(oc,oc)-radius*radius;\n  let disc=qb*qb-qc;\n  if(disc<=0.0){return 1.0;}\n  let root=sqrt(disc);\n  let tFar=-qb+root;\n  if(tFar<=0.0){return 1.0;}\n  let softness=smoothstep(0.0,radius*radius*0.24,disc);\n  return mix(1.0,0.24,softness*clamp(C.realism1.z,0.0,1.0));\n}\n\nfn floorColor(p: vec3f) -> vec3f {`,'realism helpers');

patch(`      return mix(floorColor(p), far, vec3f(fade));`,
`      var floorLit=floorColor(p);\n      floorLit*=realismReceiverShadow(p);\n      return mix(floorLit,far,vec3f(fade));`,'receiver shadow');

patch(`  let trans = hitCol * exp(-C.absorb * thick);`,
`  // Reconstructed-surface caustic focusing: neighboring refracted rays that converge add light.\n  let refrDx=dpdx(refrDir);\n  let refrDy=dpdy(refrDir);\n  let convergence=max(0.0,-(refrDx.x+refrDy.y));\n  let causticDepth=smoothstep(0.035,0.34,thick);\n  let causticDown=smoothstep(0.04,0.86,-refrDir.y);\n  let causticEnergy=min(2.45,convergence*42.0)*causticDepth*causticDown;\n  hitCol*=vec3f((1.0+causticEnergy)*1.035,(1.0+causticEnergy)*1.018,1.0+causticEnergy);\n\n  var trans = hitCol * exp(-C.absorb * thick);\n\n  // Depth-dependent participating-water look: a compact single-scattering approximation.\n  let scatterDepth=(1.0-exp(-max(thick,0.0)*3.2))*clamp(C.realism0.w,0.0,1.25);\n  let forward=pow(max(dot(-rd,C.sunDir),0.0),4.0);\n  trans+=vec3f(0.020,0.135,0.205)*scatterDepth*(0.58+1.20*forward);\n\n  // Water's true chromatic dispersion is subtle; keep this restrained and strongest at grazing angles.\n  let grazing=pow(1.0-max(dot(-rd,n),0.0),2.0);\n  let disp=clamp(C.realism0.z,0.0,1.25)*grazing*(1.0-exp(-max(thick,0.0)*4.0));\n  trans*=vec3f(1.0+0.030*disp,1.0,1.0-0.040*disp);\n\n  // Thin steep fragments are where spray/entrained-air whitening first appears.\n  let thinEdge=1.0-smoothstep(0.018,0.115,max(thick,0.0));\n  let steep=pow(clamp(1.0-abs(n.y),0.0,1.0),1.35);\n  let foamMask=clamp(thinEdge*(0.22+0.78*steep)*C.realism1.x,0.0,0.72);\n  trans=mix(trans,vec3f(0.78,0.91,0.97),vec3f(foamMask));\n\n  // Forward sun scatter gives a soft shaft/glow through meaningful water thickness.\n  let shaft=pow(max(dot(-rd,C.sunDir),0.0),8.0)*smoothstep(0.04,0.55,max(thick,0.0))*C.realism1.y;\n  trans+=vec3f(0.18,0.34,0.42)*shaft;`,'transmission realism');

patch(`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,
`  if (any(n != n)) { n = -rd; }\n  if (dot(n, rd) > 0.0) { n = -n; }\n  let microN=realismMicro(p);\n  n=normalize(n+vec3f(microN.x,0.0,microN.y));\n  if(dot(n,rd)>0.0){n=-n;}\n\n  if (C.debug == 1) { return vec4f(n * 0.5 + 0.5, 1.0); }`,'micro normal');

patch(`  return vec4f(tonemap(col), 1.0);`,
`  // Linearly filtered thickness supplies sub-pixel coverage at the reconstructed edge.
  // This hides the square depth texel and restores a round silhouette for sparse droplets.
  var resolvedColor=tonemap(col);
  let edgeWidth=max(fwidth(thick)*1.35,0.0015);
  let waterCoverage=smoothstep(0.0,edgeWidth,max(thick,0.0));
  if(waterCoverage<0.999){
    let sceneBehind=tonemap(sceneColor(ro,rd));
    resolvedColor=mix(sceneBehind,resolvedColor,vec3f(waterCoverage));
  }
  return vec4f(resolvedColor,1.0);`,'rounded sparse silhouette resolve');

const shaderMod=dev.createShaderModule({code:src,label:'fluidV5M746RealismWGSL'});
if(typeof shaderMod.getCompilationInfo==='function'){
  const info=await shaderMod.getCompilationInfo();
  const errors=(info.messages||[]).filter(m=>m.type==='error');
  if(errors.length) throw new Error('M7.4.6 realism WGSL: '+errors.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
}
const pipe=await dev.createRenderPipelineAsync({
  label:'fluidV5M746RealismComposite',layout:'auto',
  vertex:{module:shaderMod,entryPoint:'vs'},
  fragment:{module:shaderMod,entryPoint:'fs',targets:[{format:ssfr.format}]},
  primitive:{topology:'triangle-list'},
});

const oldCompUni=ssfr.compUni;
ssfr.compUni=dev.createBuffer({label:'fluidV5M746CompositeUniform',size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
void oldCompUni;
ssfr.pipeComposite=pipe;
ssfr.bindCache=null;

const realism={micro:0.28,dispersion:0.14,scattering:0.28,foam:0.14,shafts:0.16,shadow:0.78};
const RF=new Float32Array(8);
const baseRender=ssfr.render.bind(ssfr);
ssfr.render=function(...args){
  RF[0]=performance.now()*0.001;RF[1]=realism.micro;RF[2]=realism.dispersion;RF[3]=realism.scattering;
  RF[4]=realism.foam;RF[5]=realism.shafts;RF[6]=realism.shadow;RF[7]=0;
  dev.queue.writeBuffer(this.compUni,256,RF);
  return baseRender(...args);
};

const tabbar=document.getElementById('m742Tabs'),host=document.getElementById('m742Host');
let page=null;
if(tabbar&&host){const tabs=[...tabbar.children];const idx=tabs.findIndex(b=>b.dataset.key==='realism');if(idx>=0)page=host.children[idx]||null;}
let status=null;
function slider(parent,label,key,min,max,step){
  const row=document.createElement('div');row.className='m742Row';
  const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=realism[key];
  const val=document.createElement('div');val.className='m742Val';val.textContent=realism[key].toFixed(2);
  input.oninput=e=>{e.stopPropagation();realism[key]=Number(input.value);val.textContent=realism[key].toFixed(2);sync()};
  row.append(l,input,val);parent.appendChild(row);return input;
}
function preset(name){
  const p={
    OFF:{micro:0,dispersion:0,scattering:0,foam:0,shafts:0,shadow:0},
    NATURAL:{micro:.24,dispersion:.10,scattering:.24,foam:.10,shafts:.12,shadow:.72},
    LAKE:{micro:.34,dispersion:.08,scattering:.30,foam:.08,shafts:.18,shadow:.70},
    OCEAN:{micro:.42,dispersion:.18,scattering:.36,foam:.24,shafts:.28,shadow:.84},
    FULL:{micro:.56,dispersion:.28,scattering:.48,foam:.38,shafts:.42,shadow:.92},
  }[name];
  Object.assign(realism,p);for(const [k,input] of Object.entries(inputs))input.value=realism[k];sync(true);
}
const inputs={};
function sync(refresh=false){
  if(refresh){for(const [k,input] of Object.entries(inputs)){input.value=realism[k];const v=input.parentElement?.querySelector('.m742Val');if(v)v.textContent=realism[k].toFixed(2)}}
  if(status)status.textContent=`REALISM SHADER ACTIVE · zero extra passes · zero extra queue submits\nmicro ${realism.micro.toFixed(2)} · dispersion ${realism.dispersion.toFixed(2)} · scatter ${realism.scattering.toFixed(2)}\nedge foam ${realism.foam.toFixed(2)} · shafts ${realism.shafts.toFixed(2)} · shadow ${realism.shadow.toFixed(2)}\nTemporal history and the old Blob-module shader path remain disabled.`;
}
if(page){
  page.querySelectorAll('.m742Locked').forEach(n=>n.remove());
  const sec=document.createElement('div');sec.className='m742Section';sec.innerHTML='<div class="m742SectionTitle">REALISM SHADER · M7.4.6</div>';
  const grid=document.createElement('div');grid.className='m742Grid';
  for(const name of ['OFF','NATURAL','LAKE','OCEAN','FULL']){const b=document.createElement('button');b.className='m742Btn';b.textContent=name;b.onclick=e=>{e.preventDefault();e.stopPropagation();preset(name)};grid.appendChild(b)}
  sec.appendChild(grid);
  inputs.micro=slider(sec,'MICRO RIPPLE','micro',0,1,.02);
  inputs.dispersion=slider(sec,'DISPERSION','dispersion',0,1,.02);
  inputs.scattering=slider(sec,'DEPTH SCATTER','scattering',0,1,.02);
  inputs.foam=slider(sec,'EDGE FOAM','foam',0,1,.02);
  inputs.shafts=slider(sec,'LIGHT SHAFT','shafts',0,1,.02);
  inputs.shadow=slider(sec,'SUN SHADOW','shadow',0,1,.02);
  const note=document.createElement('div');note.className='m742Note';note.textContent='This restore changes only the existing SSFR composite shader: capillary normal detail, reconstructed caustic focus, subtle chromatic dispersion, depth scattering, thin-edge aeration/foam, forward sun scatter and receiver shadow. No extra render pass or command-buffer submission is created.';sec.appendChild(note);
  page.appendChild(sec);status=document.createElement('div');status.className='m742Status';status.style.marginTop='10px';page.appendChild(status);sync(true);
}

window.__fluidV44Realism=realism;
window.__v5M746Realism={online:true,backend:'single-composite-shader-m746',gpuPassesAdded:0,gpuSubmitsAdded:0,realism};
window.__fluidV5Version='7.4.6';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M7.4.6';
document.title='Fluid V5 · M7.4.6 Wave Lab + Realism';
console.info('[Fluid V5 M7.4.6] shader-only realism restored; zero added GPU passes/submits.');
