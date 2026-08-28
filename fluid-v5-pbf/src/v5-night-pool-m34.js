// Fluid V5 M3.4.2 tuned true-night-pool loader.
// Starts from the validated M3.4 six-fixture source, applies the iOS WGSL identifier fix, then
// tightens receiver coverage, beam range and exposure so colored fixtures stay localized underwater.

const sourceUrl = 'https://raw.githubusercontent.com/nicholasgearinger-code/nicholasgearinger.github.io-portfolio/1e677b1526b684b1eb9cd044e640d322d5f2075a/fluid-v5-pbf/src/v5-night-pool-m34.js';
const response = await fetch(sourceUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.4.2 night source unavailable (${response.status}).`);
let src = await response.text();
const swap = (a,b,label) => {
  if (!src.includes(a)) throw new Error(`Fluid V5 M3.4.2 night tuning: ${label} signature changed.`);
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

// Keep colored receiver lighting below the real pool water zone instead of painting the tall walls.
swap(
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;',
  'var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;let waterTop=lo.y+(hi.y-lo.y)*.40;',
  'receiver waterline'
);
src = src.replaceAll('p.y<=hi.y', 'p.y<=waterTop');

// Shimmer should break up local illumination, not double its energy.
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

// Local fixture reach instead of flooding the entire 1.9 m pool width from every lamp.
swap('F[12]=3.45;', 'F[12]=1.58;', 'fixture range');

// Rainbow comes from six phase-shifted fixtures, never from globally cycling the whole water material.
swap(
  "if(mode==='rainbow'){\n        const c=P.color||[.2,.5,1];this.transmit=[.055+.945*c[0],.055+.945*c[1],.055+.945*c[2]];\n      }else this.transmit=pal.transmit.slice();",
  "if(mode==='rainbow'){\n        this.transmit=[.22,.34,.58];\n      }else this.transmit=pal.transmit.slice();",
  'rainbow transmission'
);
swap('this.exposure=Math.min(this.exposure,0.98);', 'this.exposure=Math.min(this.exposure,0.82);', 'night exposure');
swap('Math.min(this.env.intensity,0.018)', 'Math.min(this.env.intensity,0.012)', 'night environment');

src = src.replaceAll("backend:'six-fixture-m34'", "backend:'six-fixture-m342'");
src = src.replaceAll('fluidV5NightPoolM34', 'fluidV5NightPoolM342');
src = src.replaceAll('fluidV5TrueNightPoolM34', 'fluidV5TrueNightPoolM342');
src = src.replaceAll("lab.version='M3.4'", "lab.version='M3.4.2'");
src = src.replaceAll('Fluid V5 M3.4', 'Fluid V5 M3.4.2');

window.__v5DedicatedNightPool = false;
const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
  window.__v5DedicatedNightPool = true;
} finally {
  URL.revokeObjectURL(blobUrl);
}
if (window.__v5NightPoolStatus) window.__v5NightPoolStatus.backend = 'six-fixture-m342';
setTimeout(() => {
  const brand = document.querySelector('.hud.card.title');
  if (brand) brand.textContent = 'FLUID V5 · M3.4.2';
  document.title = 'Fluid V5 · M3.4.2 TUNED NIGHT POOL';
  window.__fluidV5Version = '5.1.4.2-m342';
}, 900);
console.info('[Fluid V5 M3.4.2] tuned six-fixture night pool renderer enabled.');
