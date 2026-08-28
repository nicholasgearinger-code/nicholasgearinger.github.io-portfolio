// Fluid V5 M2.8 atomic presentation patch.
// Keep the validated M2.7 full-surface photon projector, but reconstruct the atomic grid with a
// wider 5x5 kernel and add a faint transmitted-sun floor term so the receiver never has a hard
// rectangular on/off boundary. The focused pattern remains driven by the live PBF particle normals.

const srcUrl = new URL('./v5-atomic-fullsurface.js', import.meta.url);
const response = await fetch(srcUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M2.8: unable to load full-surface atomic source (${response.status}).`);
let src = await response.text();

const sampleNeedle = `fn sampleEnergy(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}`;
const sampleReplacement = `fn sampleEnergy(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 s+=(e(x-2,z)+e(x+2,z)+e(x,z-2)+e(x,z+2))*0.65;
 s+=(e(x-2,z-2)+e(x+2,z-2)+e(x-2,z+2)+e(x+2,z+2))*0.35;
 return s/20.0;
}`;
if (!src.includes(sampleNeedle)) throw new Error('Fluid V5 M2.8: atomic sample kernel signature changed.');
src = src.replace(sampleNeedle, sampleReplacement);

const lightNeedle = `fn light(v:f32)->vec3f{
 let focused=max(v-0.010,0.0);
 let c=1.0-exp(-focused*1.12*U.gain);
 let h=smoothstep(0.004,0.68,c);
 return vec3f(h,h*.955,h*.84);
}`;
const lightReplacement = `fn light(v:f32)->vec3f{
 let focused=max(v-0.0045,0.0);
 let c=1.0-exp(-focused*0.86*U.gain);
 let h=smoothstep(0.003,0.72,c);
 return vec3f(h,h*.955,h*.84);
}`;
if (!src.includes(lightNeedle)) throw new Error('Fluid V5 M2.8: atomic light curve signature changed.');
src = src.replace(lightNeedle, lightReplacement);

const receiverNeedle = ` let c=light(sampleEnergy(uv));let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.23,0.0,.44);
 return vec4f(c*(.72+U.strength*.25),alpha);`;
const receiverReplacement = ` let c=light(sampleEnergy(uv));let peak=max(max(c.r,c.g),c.b);
 // Direct transmitted sunlight exists across the whole sun-facing floor; atomic energy modulates
 // that baseline into focused caustic bands rather than acting like an isolated emissive decal.
 let sunBase=0.030*clamp(C.sunIntensity/5.0,0.0,1.5);
 let baseCol=vec3f(0.30,0.285,0.245)*sunBase;
 let alpha=clamp(0.026+peak*U.strength*.16,0.026,.30);
 return vec4f(baseCol+c*(.46+U.strength*.18),alpha);`;
if (!src.includes(receiverNeedle)) throw new Error('Fluid V5 M2.8: atomic receiver signature changed.');
src = src.replace(receiverNeedle, receiverReplacement);

src = src.replaceAll('particle-full', 'particle-full-wide');
src = src.replaceAll('M2.7', 'M2.8');

const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try { await import(blobUrl); }
finally { URL.revokeObjectURL(blobUrl); }

console.info('[Fluid V5 M2.8] wide full-floor atomic resolve enabled.');