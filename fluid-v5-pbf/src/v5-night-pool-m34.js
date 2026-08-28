// Fluid V5 M3.4.3 true-night-pool loader.
// Starts from the validated six-fixture source, applies the iOS WGSL fix and M3.4.2 tuning, then
// hard-gates the renderer to Night and suppresses inherited ambient light before adding pool lamps.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.3 night source unavailable (${response.status}).`);
let src = await response.text();
const swap = (a,b,label) => {
  if (!src.includes(a)) throw new Error(`Fluid V5 M3.4.3 night tuning: ${label} signature changed.`);
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

// More restrained water transmission: fixture color should be local, not a full-pool wash.
src = src.replace("blue:    { base:[0.035,0.34,1.00], accent:[0.46,0.08,1.00], transmit:[0.055,0.25,1.00] },",
                  "blue:    { base:[0.035,0.34,1.00], accent:[0.46,0.08,1.00], transmit:[0.07,0.18,0.38] },");
src = src.replace("aqua:    { base:[0.04,1.00,0.74], accent:[0.10,1.00,0.26], transmit:[0.055,1.00,0.68] },",
                  "aqua:    { base:[0.04,1.00,0.74], accent:[0.10,1.00,0.26], transmit:[0.07,0.31,0.28] },");
src = src.replace("red:     { base:[1.00,0.055,0.035], accent:[1.00,0.03,0.58], transmit:[1.00,0.055,0.04] },",
                  "red:     { base:[1.00,0.055,0.035], accent:[1.00,0.03,0.58], transmit:[0.30,0.07,0.08] },");
src = src.replace("rainbow: { base:[1.00,1.00,1.00], accent:[1.00,1.00,1.00], transmit:[0.42,0.48,0.72] },",
                  "rainbow: { base:[1.00,1.00,1.00], accent:[1.00,1.00,1.00], transmit:[0.11,0.15,0.22] },");

// Keep colored receiver lighting below the pool water zone instead of painting the tall walls.
swap(
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;',
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;let waterTop=lo.y+(hi.y-lo.y)*.40;',
  'receiver waterline'
);
src = src.replaceAll('p.y<=hi.y', 'p.y<=waterTop');

// Shimmer breaks up local illumination without multiplying its energy.
swap('return .72+line*.72;', 'return .96+line*.08;', 'shimmer amplitude');
swap(
  'let caustic=shimmer(p,i);return fixtureColor(i)*N.cfg.y*atten*pool*caustic*.86;',
  'let caustic=shimmer(p,i);return fixtureColor(i)*N.cfg.y*atten*pool*caustic*.22;',
  'receiver energy'
);

// Narrow, short underwater volumetric beams.
swap(
  'let r=lp+axis*s;let d=length(q-r);let width=.045+s*.145;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*5.5,1e-4))*.24;',
  'let r=lp+axis*s;let d=length(q-r);let width=.026+s*.062;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*3.2,1e-4))*.07;',
  'beam shape'
);
swap(
  'return fixtureColor(i)*(core+halo)*(1.0-s/N.tune.x)*N.tune.y*N.cfg.y*.15;',
  'return fixtureColor(i)*(core+halo)*(1.0-s/N.tune.x)*N.tune.y*N.cfg.y*.026;',
  'beam energy'
);

// Smaller fixture cores and halos.
swap(
  'let core=exp(-d*d/.00032);let halo=exp(-d*d/.0065)*.32;return fixtureColor(i)*(core*2.4+halo)*N.cfg.y;',
  'let core=exp(-d*d/.00022);let halo=exp(-d*d/.0028)*.10;return fixtureColor(i)*(core*.58+halo)*N.cfg.y;',
  'lamp sprite energy'
);

// Compress accumulated fixture light before additive compositing so hue survives instead of clipping white.
swap(
  'if(h.t<1e29){c+=sixLights(h.p,h.n);let depthGlow=1.0-exp(-min(h.t,5.0)*.18);c+=N.colA.rgb*N.cfg.y*depthGlow*.028;}\n return vec4f(c,0);',
  'if(h.t<1e29){c+=sixLights(h.p,h.n);let depthGlow=1.0-exp(-min(h.t,5.0)*.14);c+=N.colA.rgb*N.cfg.y*depthGlow*.006;}\n c=c/(vec3f(1.0)+c*1.45);\n return vec4f(c*.72,0);',
  'night tonemap'
);

// Local fixture reach instead of flooding the entire pool width from every lamp.
swap('F[12]=3.45;', 'F[12]=1.58;', 'fixture range');

// Rainbow comes from six phase-shifted fixtures, never from globally cycling the water material.
swap(
  "if(mode==='rainbow'){\n        const c=P.color||[.2,.5,1];this.transmit=[.055+.945*c[0],.055+.945*c[1],.055+.945*c[2]];\n      }else this.transmit=pal.transmit.slice();",
  "if(mode==='rainbow'){\n        this.transmit=[.11,.15,.22];\n      }else this.transmit=pal.transmit.slice();",
  'rainbow transmission'
);
swap('this.exposure=Math.min(this.exposure,0.98);', 'this.exposure=Math.min(this.exposure,0.70);', 'night exposure');
swap('Math.min(this.env.intensity,0.018)', 'Math.min(this.env.intensity,0.012)', 'night environment');

// Hard gate: this module must be completely inert during Day and Sunset.
swap(
  "    const night=lab.state?.time==='night';const mode=lab.state?.poolLight||'blue';const P=lab.getPackedState(performance.now());const pal=palettes[mode]||palettes.blue;",
  "    const night=lab.state?.time==='night';if(!night)return baseRender.apply(this,args);const mode=lab.state?.poolLight||'blue';const P=lab.getPackedState(performance.now());const pal=palettes[mode]||palettes.blue;",
  'night-only render guard'
);

// The inherited V4 receiver has a permanent ambient term. In Night, suppress it before adding
// fixture light so the visible illumination really comes from the submerged pool lamps.
const pipeNeedle="  const pipe=await dev.createRenderPipelineAsync({label:'fluidV5TrueNightPoolM34',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});";
const dimCode=`
  const dimMod=dev.createShaderModule({label:'fluidV5NightDimM343WGSL',code:\`
struct DOut{@builtin(position)pos:vec4f}
@vertex fn vs(@builtin(vertex_index)i:u32)->DOut{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:DOut;o.pos=vec4f(p,0,1);return o;
}
@fragment fn fs()->@location(0)vec4f{return vec4f(0,0,0,.32);}
\`});
  const dimPipe=await dev.createRenderPipelineAsync({label:'fluidV5NightDimM343',layout:'auto',vertex:{module:dimMod,entryPoint:'vs'},fragment:{module:dimMod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'zero',dstFactor:'src-alpha',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});`;
if(!src.includes(pipeNeedle))throw new Error('Fluid V5 M3.4.3 night tuning: dim pipeline signature changed.');
src=src.replace(pipeNeedle,pipeNeedle+dimCode);

swap(
  "if(night){try{const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}",
  "if(night){try{const dimPass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});dimPass.setPipeline(dimPipe);dimPass.draw(3);dimPass.end();const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}",
  'night ambient suppression'
);

src = src.replaceAll("backend:'six-fixture-m34'", "backend:'six-fixture-m343'");
src = src.replaceAll('fluidV5NightPoolM34', 'fluidV5NightPoolM343');
src = src.replaceAll('fluidV5TrueNightPoolM34', 'fluidV5TrueNightPoolM343');
src = src.replaceAll("lab.version='M3.4'", "lab.version='M3.4.3'");
src = src.replaceAll('Fluid V5 M3.4', 'Fluid V5 M3.4.3');

window.__v5DedicatedNightPool = false;
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
  window.__v5DedicatedNightPool = true;
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5NightPoolStatus) window.__v5NightPoolStatus.backend = 'six-fixture-m343';
setTimeout(() => {
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M3.4.3';
  document.title = 'Fluid V5 · M3.4.3 HDR TIME OF DAY';
  window.__fluidV5Version = '5.1.4.3-m343';
}, 900);
console.info('[Fluid V5 M3.4.3] Night-only six-fixture renderer with ambient suppression enabled.');
