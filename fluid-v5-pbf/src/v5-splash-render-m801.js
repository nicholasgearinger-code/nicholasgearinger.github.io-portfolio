// Fluid V5 M8.0.1 — adaptive SSFR splash reconstruction.
// Rendering-only correction: isolated / low-neighbour spray uses a smaller screen-space
// reconstruction kernel, while dense connected water keeps the full surface radius.
// No physics equation, particle spacing, compute pass, encoder, or queue submission is changed.

const ssfr=window.__ssfr;
if(!ssfr?.dev||!ssfr?.format) throw new Error('M8.0.1 splash render: SSFR runtime unavailable.');
const dev=ssfr.dev;

const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UPSTREAM+'ssfr_wgsl.js');
let prelude=SW.splatPrelude;

function patch(needle,replacement,label){
  if(!prelude.includes(needle)) throw new Error(`M8.0.1 splash shader signature changed: ${label}`);
  prelude=prelude.replace(needle,replacement);
}

// aniso_wgsl stores each particle's neighbour count in gdata[i*2+1].w.
// Dense liquid therefore renders at normal SSFR size, while sparse ballistic spray shrinks
// toward roughly half radius instead of becoming giant floating ellipsoids.
patch(`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n`,
`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n\nfn splashScale(i:u32)->f32 {\n  let neighbours=gdata[i*2u+1u].w;\n  return mix(0.52,1.0,smoothstep(4.0,18.0,neighbours));\n}\n`, 'neighbour scale helper');

patch(`    e = vec3f(S.quadRadius);`,
      `    e = vec3f(S.quadRadius * splashScale(ii));`, 'thickness quad radius');
patch(`          * (kernelInverse(ii) * S.kernelScale);`,
      `          * (kernelInverse(ii) * (S.kernelScale * splashScale(ii)));`, 'depth ellipsoid radius');

let thickFS=SW.thickFS;
const thickNeedle=`  let c = dot(oc, oc) - S.thickRadius * S.thickRadius;`;
if(!thickFS.includes(thickNeedle)) throw new Error('M8.0.1 splash shader signature changed: thickness sphere');
thickFS=thickFS.replace(thickNeedle,
`  let localRadius=S.thickRadius*splashScale(in.id);\n  let c = dot(oc, oc) - localRadius * localRadius;`);

function checkedModule(code,label){
  return dev.createShaderModule({code,label});
}
const depthMod=checkedModule(prelude+SW.depthFS,'fluidV5M801AdaptiveDepthWGSL');
const thickMod=checkedModule(prelude+thickFS,'fluidV5M801AdaptiveThicknessWGSL');
for(const [m,label] of [[depthMod,'depth'],[thickMod,'thickness']]){
  if(typeof m.getCompilationInfo==='function'){
    const info=await m.getCompilationInfo();
    const errors=(info.messages||[]).filter(x=>x.type==='error');
    if(errors.length) throw new Error(`M8.0.1 ${label} WGSL: `+errors.map(x=>`${x.lineNum||'?'}:${x.linePos||'?'} ${x.message}`).join(' | '));
  }
}

ssfr.pipeDepth=await dev.createRenderPipelineAsync({
  label:'fluidV5M801AdaptiveDepth',layout:'auto',
  vertex:{module:depthMod,entryPoint:'vs'},
  fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},
  primitive:{topology:'triangle-strip'},
  depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
});
ssfr.pipeThick=await dev.createRenderPipelineAsync({
  label:'fluidV5M801AdaptiveThickness',layout:'auto',
  vertex:{module:thickMod,entryPoint:'vs'},
  fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
  primitive:{topology:'triangle-strip'},
});

// Slightly tighten the dense surface too, but most of the change comes from neighbour-adaptive sizing.
ssfr.splatRadius=Math.min(ssfr.splatRadius,0.90);
ssfr.thicknessRadius=Math.min(ssfr.thicknessRadius,0.58);
ssfr.bindCache=null;

window.__v5M801Splash={online:true,backend:'neighbor-adaptive-ssfr-splats-m801',gpuPassesAdded:0,gpuSubmitsAdded:0,minScale:0.52,denseScale:1.0};
window.__fluidV5Version='8.0.1';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M8.0.1';
document.title='Fluid V5 · M8.0.1 Adaptive Splash';
console.info('[Fluid V5 M8.0.1] sparse splash reconstruction shrunk by neighbour count; bulk surface preserved.');