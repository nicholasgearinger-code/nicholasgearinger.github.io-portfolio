// Fluid V5 M7.3.9 — one real GPUCommandBuffer per visible frame on iOS/WebKit.
// Unlike M7.3.8, this does NOT alternate simulation and rendering. It lets the normal PBF
// compute work and the normal SSFR render work encode into the SAME GPUCommandEncoder, then
// submits that encoder once at the end of Renderer.draw(). This is a compatibility shim for
// testing the architecture before we permanently refactor the upstream Sim/Renderer APIs.

const q = new URLSearchParams(location.search);
const safe = {
  quality: 'low', timing: '0', bodies: '0', bodyphases: '0',
  substeps: '2', iters: '3', tension: '0.12', ssfrscale: '0.34',
  ssfriters: '2', ssfrthickblur: '14'
};
for (const [k,v] of Object.entries(safe)) if (!q.has(k)) q.set(k,v);
history.replaceState(null,'',location.pathname+'?'+q.toString()+location.hash);

// main.js loads the pinned Particles4All core. Its first RAF is only scheduled during module
// evaluation, so this continuation runs before that first RAF and can install the shim in time.
await import('./main.js?v=maincam1');

const sim = window.__sim;
const ui = window.__ui;
if (!sim?.dev?.queue || !ui) throw new Error('M7.3.9 unified gate: PBF runtime unavailable.');

const dev = sim.dev;
const queue = dev.queue;
const nativeCreate = dev.createCommandEncoder.bind(dev);
const nativeSubmit = queue.submit.bind(queue);
const baseStep = sim.step.bind(sim);

let inStep = false;
let sharedReal = null;
let sharedProxy = null;
let simFinished = false;
let submitted = 0;
let held = 0;
let unifiedFrames = 0;
let renderOnlyFrames = 0;
let unexpected = 0;
const SENTINEL = Object.freeze({m739Held:true});

// The original Sim.step starts asynchronous stats/pose mappings immediately after its submit.
// In unified mode that submit is intentionally delayed until rendering is encoded. Keep those
// optional CPU readbacks disabled so no buffer enters MAP_PENDING before the combined submit.
sim.statsBusy = true;
sim.poseBusy = true;

function proxyEncoder(real){
  return new Proxy(real, {
    get(target, prop){
      if (prop === 'finish') {
        return (...args) => {
          if (inStep) {
            simFinished = true;
            return SENTINEL;
          }
          const out = target.finish(...args);
          return out;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function createUnified(desc){
  if (inStep) {
    // One physics encoder starts the visible frame.
    if (sharedReal) {
      // A second encoder requested inside Sim.step would violate the contract; use a native
      // encoder rather than corrupting the shared one and surface it in telemetry.
      unexpected++;
      return nativeCreate(desc);
    }
    sharedReal = nativeCreate(desc);
    sharedProxy = proxyEncoder(sharedReal);
    simFinished = false;
    return sharedProxy;
  }

  // Renderer.draw() immediately follows Sim.step(). Reuse the still-open physics encoder so
  // render passes naturally execute after the compute passes in the same command buffer.
  if (sharedReal && simFinished) return sharedProxy;

  // If the time-bank produced no physics work this RAF, rendering gets its own single buffer.
  renderOnlyFrames++;
  return nativeCreate(desc);
}

function submitUnified(commandBuffers){
  const list = Array.from(commandBuffers || []);
  if (list.length === 1 && list[0] === SENTINEL) {
    held++;
    return;
  }

  // This is normally Renderer.draw() finishing the shared encoder. Submit once, then clear the
  // frame state. A render-only frame also passes straight through here once.
  const out = nativeSubmit(list);
  submitted++;
  if (sharedReal) {
    unifiedFrames++;
    sharedReal = null;
    sharedProxy = null;
    simFinished = false;
  }
  return out;
}

try {
  Object.defineProperty(dev,'createCommandEncoder',{configurable:true,writable:true,value:createUnified});
  Object.defineProperty(queue,'submit',{configurable:true,writable:true,value:submitUnified});
} catch (err) {
  throw new Error('M7.3.9 could not install unified encoder shim: '+String(err?.message||err));
}

sim.step = function(frameDt){
  inStep = true;
  try { return baseStep(frameDt); }
  finally { inStep = false; }
};

window.__v5M739Unified = {
  online:true,
  backend:'ios-shared-compute-render-command-buffer-m739',
  get submitted(){return submitted},
  get held(){return held},
  get unifiedFrames(){return unifiedFrames},
  get renderOnlyFrames(){return renderOnlyFrames},
  get unexpected(){return unexpected},
  get open(){return !!sharedReal},
};
window.__fluidV5Version='7.3.9';
window.__fluidV5Build='M7.3.9 UNIFIED COMPUTE+RENDER';

const title=document.querySelector('.hud.card.title');
if(title) title.textContent='FLUID V5 · M7.3.9';
document.title='Fluid V5 · M7.3.9 Unified iOS';
console.info('[Fluid V5 M7.3.9] unified compute + render command-buffer shim online.');
