// Fluid V5 M2 safety loader.
// Keep v5-m2.js immutable as the Milestone 2 checkpoint, and apply synchronization/diagnostic
// corrections here before importing it.

const srcUrl = new URL('./v5-m2.js', import.meta.url);
const response = await fetch(srcUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Fluid V5 M2 safety loader: unable to load base module (${response.status}).`);
let src = await response.text();

const earlyCopy = "enc.copyBufferToBuffer(drainNormalTemp,0,sim.buf.normal,0,oldN*16);enc.copyBufferToBuffer(drainCount,0,drainRead,0,4);dev.queue.submit([enc.finish()]);drainBusy=true;";
const deferredCopy = "enc.copyBufferToBuffer(drainCount,0,drainRead,0,4);dev.queue.submit([enc.finish()]);drainBusy=true;";
if (!src.includes(earlyCopy)) throw new Error('Fluid V5 M2 safety loader: drain submission signature changed.');
src = src.replace(earlyCopy, deferredCopy);

const oldSwitch = "if(removed>0){sim.n=kept;sim.parity=dstParity;sim.predParity=dstParity;sim.timeBank=0;sim.gen++;if(sim.scene){sim.scene.n=kept;sim.scene.nFluid=Math.max(0,oldFluid-removed);}drainedTotal+=removed;drainLastRemoved=removed;drainCache=null;}drainBusy=false;";
const safeSwitch = "if(removed>0){const syncEnc=dev.createCommandEncoder({label:'fluidV5M2DrainNormalSync'});syncEnc.copyBufferToBuffer(drainNormalTemp,0,sim.buf.normal,0,kept*16);dev.queue.submit([syncEnc.finish()]);sim.n=kept;sim.parity=dstParity;sim.predParity=dstParity;sim.timeBank=0;sim.gen++;if(sim.scene){sim.scene.n=kept;sim.scene.nFluid=Math.max(0,oldFluid-removed);}drainedTotal+=removed;drainLastRemoved=removed;drainCache=null;}drainBusy=false;";
if (!src.includes(oldSwitch)) throw new Error('Fluid V5 M2 safety loader: drain parity-switch signature changed.');
src = src.replace(oldSwitch, safeSwitch);

const oldAtomicDecl = "const atomic=window.__v5ProjectedCaustics;const show=state.devHud||window.__v5DebugMode!=='final';";
const newAtomicDecl = "const atomic=window.__v5ProjectedCaustics;const atomicStatus=window.__v5AtomicStatus;const show=state.devHud||window.__v5DebugMode!=='final';";
if (!src.includes(oldAtomicDecl)) throw new Error('Fluid V5 M2 safety loader: atomic HUD declaration signature changed.');
src = src.replace(oldAtomicDecl, newAtomicDecl);

const oldAtomicText = "atomic caustics ${atomic?atomic.width+'×'+atomic.height:'offline'} · UW depth ${uwDepth.toFixed(2)} m";
const newAtomicText = "atomic caustics ${atomic?atomic.width+'×'+atomic.height+(atomic.backend?' '+atomic.backend:''):(atomicStatus?.stage||'offline')} · UW depth ${uwDepth.toFixed(2)} m";
if (!src.includes(oldAtomicText)) throw new Error('Fluid V5 M2 safety loader: atomic HUD text signature changed.');
src = src.replace(oldAtomicText, newAtomicText);

const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}

console.info('[Fluid V5 M2] drain parity + atomic diagnostics safety patches enabled.');
