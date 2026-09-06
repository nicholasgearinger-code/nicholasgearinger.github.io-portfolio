// Fluid V5 M8.0.3 — scenario-aware rounded SSFR droplets.
// Sparse particles keep enough screen coverage to anti-alias in reduced-resolution scenarios,
// while native-resolution GLB Pour receives a much finer, rounder droplet reconstruction.
// Rendering only: no physics equation, compute pass, encoder, or queue submission is changed.

const ssfr=window.__ssfr;
if(!ssfr?.dev||!ssfr?.format) throw new Error('M8.0.3 splash render: SSFR runtime unavailable.');
const dev=ssfr.dev;
const pourMode=new URLSearchParams(location.search).get('scenario')==='pour';
const sparseScale=pourMode?.27:.52;
const sparseAspect=pourMode?1.24:1.42;

const UPSTREAM='https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/';
const SW=await import(UPSTREAM+'ssfr_wgsl.js');
let prelude=SW.splatPrelude;

function patch(needle,replacement,label){
  if(!prelude.includes(needle)) throw new Error(`M8.0.3 splash shader signature changed: ${label}`);
  prelude=prelude.replace(needle,replacement);
}

patch(`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n`,
`fn kernelG(i: u32) -> mat3x3f {\n  let a = gdata[i * 2u + 0u];\n  let b = gdata[i * 2u + 1u];\n  return mat3x3f(a.x, a.y, a.z,\n                 a.y, a.w, b.x,\n                 a.z, b.x, b.y);\n}\n\nfn neighbourBlend(i:u32)->f32 {\n  let neighbours=gdata[i*2u+1u].w;\n  return smoothstep(6.0,24.0,neighbours);\n}\n\nfn splashScale(i:u32)->f32 {\n  return mix(${sparseScale.toFixed(3)},1.0,neighbourBlend(i));\n}\n`, 'rounded neighbour scale helper');

patch(`    e = vec3f(S.quadRadius);`,
      `    e = vec3f(S.quadRadius * splashScale(ii));`, 'thickness quad radius');

patch(`    let M = mat3x3f(S.view[0].xyz, S.view[1].xyz, S.view[2].xyz)\n          * (kernelInverse(ii) * S.kernelScale);\n    e = vec3f(length(vec3f(M[0][0], M[1][0], M[2][0])),\n              length(vec3f(M[0][1], M[1][1], M[2][1])),\n              length(vec3f(M[0][2], M[1][2], M[2][2])));`,
`    let M = mat3x3f(S.view[0].xyz, S.view[1].xyz, S.view[2].xyz)\n          * (kernelInverse(ii) * S.kernelScale);\n    let rawE=vec3f(length(vec3f(M[0][0], M[1][0], M[2][0])),\n                   length(vec3f(M[0][1], M[1][1], M[2][1])),\n                   length(vec3f(M[0][2], M[1][2], M[2][2])));\n    let dense=neighbourBlend(ii);\n    let shortest=max(min(rawE.x,min(rawE.y,rawE.z)),1.0e-5);\n    let aspect=mix(${sparseAspect.toFixed(3)},10.0,dense);\n    let shaped=min(rawE,vec3f(shortest*aspect));\n    e = shaped * splashScale(ii);`, 'rounded depth ellipsoid + sparse aspect cap');

let thickFS=SW.thickFS;
const thickNeedle=`  let c = dot(oc, oc) - S.thickRadius * S.thickRadius;`;
if(!thickFS.includes(thickNeedle)) throw new Error('M8.0.3 splash shader signature changed: thickness sphere');
thickFS=thickFS.replace(thickNeedle,
`  let localRadius=S.thickRadius*splashScale(in.id);\n  let c = dot(oc, oc) - localRadius * localRadius;`);

const depthMod=dev.createShaderModule({code:prelude+SW.depthFS,label:'fluidV5M803RoundedDepthWGSL'});
const thickMod=dev.createShaderModule({code:prelude+thickFS,label:'fluidV5M803RoundedThicknessWGSL'});
for(const [shaderModule,label] of [[depthMod,'depth'],[thickMod,'thickness']]){
  if(typeof shaderModule.getCompilationInfo==='function'){
    const info=await shaderModule.getCompilationInfo();
    const errors=(info.messages||[]).filter(item=>item.type==='error');
    if(errors.length) throw new Error(`M8.0.3 ${label} WGSL: `+errors.map(item=>`${item.lineNum||'?'}:${item.linePos||'?'} ${item.message}`).join(' | '));
  }
}

ssfr.pipeDepth=await dev.createRenderPipelineAsync({
  label:'fluidV5M803RoundedDepth',layout:'auto',
  vertex:{module:depthMod,entryPoint:'vs'},
  fragment:{module:depthMod,entryPoint:'fs',targets:[{format:'r32float'}]},
  primitive:{topology:'triangle-strip'},
  depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
});
ssfr.pipeThick=await dev.createRenderPipelineAsync({
  label:'fluidV5M803RoundedThickness',layout:'auto',
  vertex:{module:thickMod,entryPoint:'vs'},
  fragment:{module:thickMod,entryPoint:'fs',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},
  primitive:{topology:'triangle-strip'},
});

if(pourMode){
  ssfr.splatRadius=Math.min(ssfr.splatRadius,1.04);
  ssfr.thicknessRadius=Math.min(ssfr.thicknessRadius,.88);
  ssfr.filterSigma=Math.min(ssfr.filterSigma,.52);
}else{
  // At reduced render scales, sub-pixel droplets need a slightly larger footprint so the
  // composite can anti-alias their circular silhouette instead of exposing one square texel.
  ssfr.splatRadius=Math.min(ssfr.splatRadius,.88);
  ssfr.thicknessRadius=Math.min(ssfr.thicknessRadius,.56);
  ssfr.filterSigma=Math.min(ssfr.filterSigma,.60);
}
ssfr.bindCache=null;

const api={online:true,backend:'scenario-aware-rounded-ssfr-m803',gpuPassesAdded:0,gpuSubmitsAdded:0,
  pourMode,minScale:sparseScale,denseScale:1.0,sparseAspect};
window.__v5M802Splash=api;
window.__v5M803Splash=api;
window.__fluidV5Version='8.0.3';
console.info(`[Fluid V5 M8.0.3] rounded droplets online: ${sparseScale.toFixed(2)}x sparse scale, ${sparseAspect.toFixed(2)}x aspect cap.`);
