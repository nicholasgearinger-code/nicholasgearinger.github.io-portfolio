// Fluid V5 M3.0: high-pass atomic caustic presentation.
// Keep the validated full-surface particle photon projector, but remove broad transmitted-sun
// energy from this pass. The overlay now contributes only local photon-density concentration
// above its surrounding neighborhood, so uniform light cannot become a bright rectangular beam.

const srcUrl = new URL('./v5-atomic-fullsurface.js', import.meta.url);
const response = await fetch(srcUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M3.0: unable to load full-surface atomic source (${response.status}).`);
let src = await response.text();

const sampleNeedle = `fn sampleEnergy(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}`;
const sampleReplacement = `fn sampleFine(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}
fn sampleBroad(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=0.0;
 s+=(e(x-2,z)+e(x+2,z)+e(x,z-2)+e(x,z+2));
 s+=(e(x-2,z-2)+e(x+2,z-2)+e(x-2,z+2)+e(x+2,z+2))*0.72;
 s+=(e(x-3,z)+e(x+3,z)+e(x,z-3)+e(x,z+3))*0.44;
 return s/8.64;
}
fn causticFocus(uv:vec2f)->f32{
 let fine=sampleFine(uv);
 let broad=sampleBroad(uv);
 // High-pass the photon density. A spatially uniform beam produces ~zero output; only
 // real local concentration from refracted rays survives as visible caustic energy.
 return max(fine-broad,0.0);
}`;
if (!src.includes(sampleNeedle)) throw new Error('Fluid V5 M3.0: sample-energy signature changed.');
src = src.replace(sampleNeedle, sampleReplacement);

const lightNeedle = `fn light(v:f32)->vec3f{
 let focused=max(v-0.010,0.0);
 let c=1.0-exp(-focused*1.12*U.gain);
 let h=smoothstep(0.004,0.68,c);
 return vec3f(h,h*.955,h*.84);
}`;
const lightReplacement = `fn light(v:f32)->vec3f{
 let focused=max(v-0.0015,0.0);
 let c=1.0-exp(-focused*3.35*U.gain);
 let h=smoothstep(0.002,0.56,c);
 return vec3f(h,h*.965,h*.86);
}`;
if (!src.includes(lightNeedle)) throw new Error('Fluid V5 M3.0: light-curve signature changed.');
src = src.replace(lightNeedle, lightReplacement);

const debugNeedle = ` if(U.debug>.5){return vec4f(light(sampleEnergy(screenUV)),1.0);}`;
const debugReplacement = ` if(U.debug>.5){return vec4f(light(causticFocus(screenUV)),1.0);}`;
if (!src.includes(debugNeedle)) throw new Error('Fluid V5 M3.0: debug-view signature changed.');
src = src.replace(debugNeedle, debugReplacement);

const receiverNeedle = ` let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let c=light(sampleEnergy(uv));let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.23,0.0,.44);
 return vec4f(c*(.72+U.strength*.25),alpha);`;
const receiverReplacement = ` let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let focus=causticFocus(uv);
 let c=light(focus);let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.17,0.0,.30);
 // No direct-sun baseline here: V4/V5 water lighting already supplies ordinary transmitted
 // illumination. This pass adds only focused caustic contrast.
 return vec4f(c*(.54+U.strength*.42),alpha);`;
if (!src.includes(receiverNeedle)) throw new Error('Fluid V5 M3.0: receiver signature changed.');
src = src.replace(receiverNeedle, receiverReplacement);

src = src.replaceAll("backend:'particle-full'", "backend:'particle-contrast'");
src = src.replaceAll("backend:'particle-full',", "backend:'particle-contrast',");
src = src.replaceAll("backend:'particle-full'", "backend:'particle-contrast'");
src = src.replaceAll("full-surface particle caustics online", "high-pass full-surface caustics online");

const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try { await import(blobUrl); }
finally { URL.revokeObjectURL(blobUrl); }

if (window.__v5ProjectedCaustics) window.__v5ProjectedCaustics.backend = 'particle-contrast';
if (window.__v5AtomicStatus) window.__v5AtomicStatus.backend = 'particle-contrast';
console.info('[Fluid V5 M3.0] caustic high-pass contrast enabled; broad sun baseline removed.');
