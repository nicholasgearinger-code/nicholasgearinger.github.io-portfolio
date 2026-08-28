// Fluid V5 M3.4.4 bright true-night-pool loader.
// Keeps Night isolated from Day/Sunset, but upgrades the six submerged fixtures to broad side-wall
// floods with stronger receiver light, visible underwater scattering and a saturated water-volume fill.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.4 night source unavailable (${response.status}).`);
let src = await response.text();
const swap = (a,b,label) => {
  if (!src.includes(a)) throw new Error(`Fluid V5 M3.4.4 night tuning: ${label} signature changed.`);
  src = src.replace(a,b);
};

// iOS/WebKit WGSL reserved words.
swap(
  'struct Night { meta:vec4f, base:vec4f, accent:vec4f, extra:vec4f }',
  'struct Night { cfg:vec4f, colA:vec4f, colB:vec4f, tune:vec4f }',
  'uniform identifiers'
);
src = src.replaceAll('N.meta', 'N.cfg');
src = src.replaceAll('N.base', 'N.colA');
src = src.replaceAll('N.accent', 'N.colB');
src = src.replaceAll('N.extra', 'N.tune');

// Stronger but still saturated water transmission. This colors the actual SSFR water instead of
// relying only on bright sprites painted over the finished frame.
src = src.replace("blue:    { base:[0.035,0.34,1.00], accent:[0.46,0.08,1.00], transmit:[0.055,0.25,1.00] },",
                  "blue:    { base:[0.035,0.34,1.00], accent:[0.46,0.08,1.00], transmit:[0.10,0.36,0.70] },");
src = src.replace("aqua:    { base:[0.04,1.00,0.74], accent:[0.10,1.00,0.26], transmit:[0.055,1.00,0.68] },",
                  "aqua:    { base:[0.04,1.00,0.74], accent:[0.10,1.00,0.26], transmit:[0.09,0.54,0.46] },");
src = src.replace("red:     { base:[1.00,0.055,0.035], accent:[1.00,0.03,0.58], transmit:[1.00,0.055,0.04] },",
                  "red:     { base:[1.00,0.055,0.035], accent:[1.00,0.03,0.58], transmit:[0.48,0.10,0.12] },");
src = src.replace("rainbow: { base:[1.00,1.00,1.00], accent:[1.00,1.00,1.00], transmit:[0.42,0.48,0.72] },",
                  "rainbow: { base:[1.00,1.00,1.00], accent:[1.00,1.00,1.00], transmit:[0.17,0.25,0.37] },");

// Keep receiver lighting below the pool water zone.
swap(
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;',
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;let waterTop=lo.y+(hi.y-lo.y)*.40;',
  'receiver waterline'
);
src = src.replaceAll('p.y<=hi.y', 'p.y<=waterTop');

// Moving shimmer remains a modulation, not the source of brightness.
swap('return .72+line*.72;', 'return .94+line*.14;', 'shimmer amplitude');
swap(
  'let caustic=shimmer(p,i);return fixtureColor(i)*N.cfg.y*atten*pool*caustic*.86;',
  'let caustic=shimmer(p,i);return fixtureColor(i)*N.cfg.y*atten*pool*caustic*.42;',
  'receiver energy'
);

// Wide side-wall flood beams. Real pool fixtures mounted on side walls use broad coverage to throw
// light across the width rather than behaving like pencil spotlights.
swap(
  'let r=lp+axis*s;let d=length(q-r);let width=.045+s*.145;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*5.5,1e-4))*.24;',
  'let r=lp+axis*s;let d=length(q-r);let width=.040+s*.095;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*4.0,1e-4))*.13;let floodWidth=.15+s*.19;let flood=exp(-d*d/max(floodWidth*floodWidth,1e-4))*.22;',
  'flood beam shape'
);
swap(
  'return fixtureColor(i)*(core+halo)*(1.0-s/N.tune.x)*N.tune.y*N.cfg.y*.15;',
  'return fixtureColor(i)*(core+halo+flood)*(1.0-s/N.tune.x)*N.tune.y*N.cfg.y*.060;',
  'flood beam energy'
);

// Brighter physical fixture faces, but retain soft halos so they do not clip to giant white disks.
swap(
  'let core=exp(-d*d/.00032);let halo=exp(-d*d/.0065)*.32;return fixtureColor(i)*(core*2.4+halo)*N.cfg.y;',
  'let core=exp(-d*d/.00025);let halo=exp(-d*d/.0042)*.18;return fixtureColor(i)*(core*.92+halo)*N.cfg.y;',
  'lamp sprite energy'
);

// Fill the submerged water volume with low-energy in-scattering from the nearest fixture zone.
// This is deliberately much broader than the direct beam, so the pool glows between fixtures.
swap(
  'if(h.t<1e29){c+=sixLights(h.p,h.n);let depthGlow=1.0-exp(-min(h.t,5.0)*.18);c+=N.colA.rgb*N.cfg.y*depthGlow*.028;}\n return vec4f(c,0);',
  'if(h.t<1e29){let lo=C.boxMin;let hi=C.boxMax;let waterTop=lo.y+(hi.y-lo.y)*.40;c+=sixLights(h.p,h.n);let depthGlow=1.0-exp(-min(h.t,5.0)*.30);let zone=clamp(floor((h.p.z-lo.z)/max(hi.z-lo.z,1e-4)*6.0),0.0,5.0);let fillCol=fixtureColor(zone);let submerged=clamp((waterTop-h.p.y)/max(waterTop-lo.y,1e-4),0.0,1.0);c+=fillCol*N.cfg.y*N.tune.y*depthGlow*(.075+.105*submerged);}\n c=c/(vec3f(1.0)+c*.82);\n return vec4f(c*.92,0);',
  'water volume fill and tonemap'
);

// Side-wall floods need enough reach to overlap across the 1.9 m pool width.
swap('F[12]=3.45;', 'F[12]=2.30;', 'fixture range');

// Rainbow comes from six phase-shifted fixtures; the actual water gets a restrained cool base so
// individual colored light zones remain visible instead of averaging into white.
swap(
  "if(mode==='rainbow'){\n        const c=P.color||[.2,.5,1];this.transmit=[.055+.945*c[0],.055+.945*c[1],.055+.945*c[2]];\n      }else this.transmit=pal.transmit.slice();",
  "if(mode==='rainbow'){\n        this.transmit=[.17,.25,.37];\n      }else this.transmit=pal.transmit.slice();",
  'rainbow transmission'
);
swap('this.exposure=Math.min(this.exposure,0.98);', 'this.exposure=Math.min(this.exposure,0.82);', 'night exposure');
swap('Math.min(this.env.intensity,0.018)', 'Math.min(this.env.intensity,0.004)', 'night environment');

// Hard gate: the six submerged fixtures are completely inert during Day and Sunset.
swap(
  "    const night=lab.state?.time==='night';const mode=lab.state?.poolLight||'blue';const P=lab.getPackedState(performance.now());const pal=palettes[mode]||palettes.blue;",
  "    const night=lab.state?.time==='night';if(!night)return baseRender.apply(this,args);const mode=lab.state?.poolLight||'blue';const P=lab.getPackedState(performance.now());const pal=palettes[mode]||palettes.blue;",
  'night-only render guard'
);

// The inherited V4 receiver has a permanent ambient term. Retain only a dark structural base, then
// let the brighter pool fixtures and water-volume scattering provide the visible Night illumination.
const pipeNeedle="  const pipe=await dev.createRenderPipelineAsync({label:'fluidV5TrueNightPoolM34',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});";
const dimCode=`
  const dimMod=dev.createShaderModule({label:'fluidV5NightDimM344WGSL',code:\`
struct DOut{@builtin(position)pos:vec4f}
@vertex fn vs(@builtin(vertex_index)i:u32)->DOut{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:DOut;o.pos=vec4f(p,0,1);return o;
}
@fragment fn fs()->@location(0)vec4f{return vec4f(0,0,0,.30);}
\`});
  const dimPipe=await dev.createRenderPipelineAsync({label:'fluidV5NightDimM344',layout:'auto',vertex:{module:dimMod,entryPoint:'vs'},fragment:{module:dimMod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'zero',dstFactor:'src-alpha',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});`;
if(!src.includes(pipeNeedle))throw new Error('Fluid V5 M3.4.4 night tuning: dim pipeline signature changed.');
src=src.replace(pipeNeedle,pipeNeedle+dimCode);

swap(
  "if(night){try{const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}",
  "if(night){try{const dimPass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});dimPass.setPipeline(dimPipe);dimPass.draw(3);dimPass.end();const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}",
  'night ambient suppression'
);

src = src.replaceAll("backend:'six-fixture-m34'", "backend:'six-fixture-flood-m344'");
src = src.replaceAll('fluidV5NightPoolM34', 'fluidV5NightPoolM344');
src = src.replaceAll('fluidV5TrueNightPoolM34', 'fluidV5TrueNightPoolM344');
src = src.replaceAll("lab.version='M3.4'", "lab.version='M3.4.4'");
src = src.replaceAll('Fluid V5 M3.4', 'Fluid V5 M3.4.4');

window.__v5DedicatedNightPool = false;
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
  window.__v5DedicatedNightPool = true;
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5NightPoolStatus) window.__v5NightPoolStatus.backend = 'six-fixture-flood-m344';
setTimeout(() => {
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M3.4.4';
  document.title = 'Fluid V5 · M3.4.4 BRIGHT NIGHT POOL';
  window.__fluidV5Version = '5.1.4.4-m344';
}, 900);
console.info('[Fluid V5 M3.4.4] broad-flood six-fixture night lighting and water-volume fill enabled.');
