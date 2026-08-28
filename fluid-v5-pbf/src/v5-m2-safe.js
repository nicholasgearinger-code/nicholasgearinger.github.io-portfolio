// Fluid V5 M2 safety loader.
// Keep v5-m2.js immutable as the Milestone 2 checkpoint, and apply the drain-normal ordering
// correction here before importing it. This mirrors the source-patch approach already used by
// the validated V4.4 realism stack.

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

const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
try {
  await import(blobUrl);
} finally {
  URL.revokeObjectURL(blobUrl);
}

console.info('[Fluid V5 M2] drain normals synchronized with compacted particle parity.');
