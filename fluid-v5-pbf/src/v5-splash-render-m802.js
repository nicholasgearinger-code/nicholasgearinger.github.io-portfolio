// Fluid V5 M8.0.2 — fine adaptive SSFR splash reconstruction.
// Rendering-only correction: sparse / airborne water uses much smaller, less-anisotropic
// reconstruction splats while dense connected water keeps a smooth continuous surface.
// No physics equation, particle spacing, compute pass, encoder, or queue submission is changed.

const ssfr=window.__ssfr;
if(!ssfr?.dev||!ssfr?.format) throw new Error('M8.0.2 splash render: SSFR runtime unavailable.');
const dev=ssfr.dev;

const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UPSTREAM+'ssfr_wgsl.js');
let prelude=SW.splatPrelude;

function patch(needle,replacement,label){
  if(!prelude.includes(needle)) throw new Error(`M8.0.2 splash shader signature changed: ${label}`);
  prelude=prelude.replace(needle,replacement);
}

patch(`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n`,
`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n\nfn neighbourBlend(i:u32)->f32 {\n  let neighbours=gdata[i*2u+1u].w;\n  return smoothstep(6.0,24.0,neighbours);\n}\n\nfn splashScale(i:u32)->f32 {\n  // Isolated spray is only ~34% of the dense-liquid reconstruction radius.\n  return mix(0.34,1.0,neighbourBlend(i));\n}\n`, 'fine neighbour scale helper');

patch(`    e = vec3f(S.quadRadius);`,
      `    e = vec3f(S.quadRadius * splashScale(ii));`, 'thickness quad radius');

patch(`    let M = mat3x3f(S.view[0].xyz, S.view[1].xyz, S.view[2].xyz)\n          * (kernelInverse(ii) * S.kernelScale);\n    e = vec3f(length(vec3f(M[0][0], M[1][0], M[2][0])),\n              length(vec3f(M[0][1], M[1][1], M[2][1])),\n              length(vec3f(M[0][2], M[1][2], M[2][2])));`,
`    let M = mat3x3f(S.view[0].xyz, S.view[1].xyz, S.view[2].xyz)\n          * (kernelInverse(ii) * S.kernelScale);\n    let rawE=vec3f(length(vec3f(M[0][0], M[1][0], M[2][0])),\n                   length(vec3f(M[0][1], M[1][1], M[2][1])),\n                   length(vec3f(M[0][2], M[1][2], M[2][2])));\n    // Sparse ballistic particles should read as droplets, not stretched ribbons.\n    // Dense water retains the anisotropic reconstruction used to make sheets continuous.\n    let dense=neighbourBlend(ii);\n    let emin=max(min(rawE.x,min(rawE.y,rawE.z)),1.0e-5);\n    let aspect=mix(1.45,10.0,dense);\n    let shaped=min(rawE,vec3f(emin*aspect));\n    e = shaped * splashScale(ii);`, 'fine depth ellipsoid + sparse aspect cap');

let thickFS=SW.thickFS;
const thickNeedle=`  let c = dot(oc, oc) - S.thickRadius * S.thickRadius;`;
if(!thickFS.includes(thickNeedle)) throw new Error('M8.0.2 splash shader signature changed: thickness sphere');
thickFS=thickFS.replace(thickNeedle,
`  let localRadius=S.thickRadius*splashScale(in.id);\n  let c = dot(oc, oc) - localRadius * localRadius;`);

const depthMod=dev.createShaderModule({code:prelude+SW.depthFS,label:'fluidV5M802FineDepthWGSL'});
const thickMod=dev.createShaderModule({code:prelude+thickFS,label:'fluidV5M802FineThicknessWGSL'});
for(const [m,label] of [[depthMod,'depth'],[thickMod,'thickness']]){
  if(typeof m.getCompilationInfo==='function'){
    const info=await m.getCompilationInfo();
    const errors=(info.messages||[]).filter(x=>x.type==='error');
    if(errors.length) throw new Error(`M8.0.2 ${label} WGSL: `+errors.map(x=>`${x.lineNum||'?'}:${x.linePos||'?'} ${x.message}`).join(' | '));
  }
}

ssfr.pipeDepth=await dev.createRenderPipelineAsync({
  label:'fluidV5M802FineDepth',layout:'auto',
  vertex:{module:depthMod,entryPoint:'vs'},
  fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},
  primitive:{topology:'triangle-strip'},
  depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
});
ssfr.pipeThick=await dev.createRenderPipelineAsync({
  label:'fluidV5M802FineThickness',layout:'auto',
  vertex:{module:thickMod,entryPoint:'vs'},
  fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
  primitive:{topology:'triangle-strip'},
});

// Tighten the dense reconstruction slightly, but preserve continuity in the pool body.
ssfr.splatRadius=Math.min(ssfr.splatRadius,0.86);
ssfr.thicknessRadius=Math.min(ssfr.thicknessRadius,0.52);
ssfr.filterSigma=Math.min(ssfr.filterSigma,0.62);
ssfr.bindCache=null;

window.__v5M802Splash={online:true,backend:'fine-neighbor-adaptive-ssfr-m802',gpuPassesAdded:0,gpuSubmitsAdded:0,minScale:0.34,denseScale:1.0,sparseAspect:1.45};
window.__fluidV5Version='8.0.2';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V5 · M8.0.2';
document.title='Fluid V5 · M8.0.2 Fine Splash';
console.info('[Fluid V5 M8.0.2] fine sparse spray online: 0.34x minimum radius + sparse anisotropy cap; bulk water preserved.');