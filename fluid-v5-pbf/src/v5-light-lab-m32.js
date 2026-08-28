// Fluid V5 M3.2 distinctive-light character pass.
// Patch the validated M3.1 light lab rather than adding another independent lighting overlay.
// The new response deliberately makes every preset readable from the pool itself, not just HDRI.

const srcUrl=new URL('./v5-light-lab.js',import.meta.url);
const response=await fetch(srcUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M3.2: unable to load M3.1 light lab (${response.status}).`);
let src=await response.text();
const swap=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 M3.2: ${label} signature changed.`);src=src.replace(a,b)};

swap(
"    softness:soft, volumetric:clamp(r.volumetric??0,0,1.5), shadow:state.shadow,\n    envPreset:state.envPreset,",
"    softness:soft, volumetric:clamp(r.volumetric??0,0,1.5), shadow:state.shadow,\n    causticGain:clamp(r.causticGain??1,0,2), character:r.character||'custom',\n    envPreset:state.envPreset,",
'packed light character');

swap(
" if(typ==0){let toLight=-normalize(L.dir.xyz);let ndl=max(dot(n,toLight),0.0);return col*ndl*power*.045;}",
" if(typ==0){\n  let toLight=-normalize(L.dir.xyz);let ndl=max(dot(n,toLight),0.0);\n  let wall=1.0-max(n.y,0.0);let shape=.10+.31*ndl+.055*wall;\n  return col*power*shape;\n }",
'directional receiver gain');

swap(
" if(typ==4){let hemi=.28+.72*max(n.y,0.0);return col*power*hemi*.038;}",
" if(typ==4){\n  let up=max(n.y,0.0);let hemi=.34+.66*up;\n  return col*power*(.055+.105*hemi);\n }",
'skylight receiver gain');

swap(
" let waterLoss=select(1.0,exp(-dist*.36),typ==3);let gain=select(.105,.145,typ==3);\n return col*(power*ndl*atten*waterLoss*gain);",
" let waterLoss=select(1.0,exp(-dist*.28),typ==3);\n let localGain=select(.34,.64,typ==3);\n let hotspot=pow(max(ndl,0.0),select(1.15,.78,typ==3));\n return col*(power*(.18*ndl+.82*hotspot)*atten*waterLoss*localGain);",
'local light gain');

swap(
" let typ=i32(L.meta.x+.5);if(typ!=3||L.extra.x<=.001){return vec3f(0);}",
" let typ=i32(L.meta.x+.5);if((typ!=1&&typ!=3)||L.extra.x<=.001){return vec3f(0);}",
'beam light types');

swap(
" let glow=exp(-dist*dist/max(width*width,1e-4))*(1.0-s/L.meta.z)*L.extra.x*L.meta.y*.026;\n return L.color.rgb*glow;",
" let beamGain=select(.095,.19,typ==3);\n let core=exp(-dist*dist/max(width*width,1e-4));\n let halo=exp(-dist*dist/max(width*width*4.0,1e-4))*.22;\n let glow=(core+halo)*(1.0-s/L.meta.z)*L.extra.x*L.meta.y*beamGain;\n return L.color.rgb*glow;",
'volumetric beam gain');

// Non-sun rigs should not be washed out by inherited directional light. Sun keeps its actual
// directional engine lighting, skylight keeps only ambient, and local rigs get a very small fill.
swap(
"  }else if(state.activeType==='skylight'){\n    upstreamSet('sunint',0.08);\n  }else{\n    // Retain a tiny base directional fill so the inherited PBR material never collapses to black.\n    upstreamSet('sunint',0.22);\n  }",
"  }else if(state.activeType==='skylight'){\n    upstreamSet('sunint',0.035);\n  }else{\n    // Local lights should define the scene. Keep only enough directional fill for stable PBR.\n    upstreamSet('sunint',0.055);\n  }",
'legacy directional fill');

src=src.replaceAll('[Fluid V5 Light Lab] initialized.','[Fluid V5 Light Lab M3.2] distinctive preset response initialized.');
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
if(window.__v5LightLab){window.__v5LightLab.version='M3.2';window.__v5LightLab.characterPass=true;}
console.info('[Fluid V5 M3.2] high-contrast receiver lighting and volumetric character enabled.');
