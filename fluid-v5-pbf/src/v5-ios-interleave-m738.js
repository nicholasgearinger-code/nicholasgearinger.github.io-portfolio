// Fluid V5 M7.3.8 — true one-command-buffer-per-RAF iOS stability gate.
// The upstream core normally submits one command buffer from Sim.step() and another from
// Renderer.draw() every animation frame. WebKit bug 311598 reports that even two command buffers
// in flight can stall iOS WebGPU. This diagnostic gate alternates SIM and RENDER frames so only
// one queue.submit() reaches WebGPU per browser repaint.

const sim = window.__sim;
const ui = window.__ui;
if (!sim?.dev?.queue || !ui) throw new Error('M7.3.8 interleave gate: PBF core unavailable.');

const queue = sim.dev.queue;
const nativeSubmit = queue.submit.bind(queue);
const baseStep = sim.step.bind(sim);
let phase = 0; // 0 = simulation frame, 1 = render frame
let inStep = false;
let submitted = 0;
let dropped = 0;
let simFrames = 0;
let renderFrames = 0;
let installed = false;

// Disable interactions that create their own one-shot command buffers while this diagnostic runs.
const baseImpulse = typeof sim.applyRayImpulse === 'function' ? sim.applyRayImpulse.bind(sim) : null;
if (baseImpulse) sim.applyRayImpulse = () => {};

sim.step = function(frameDt) {
  if (phase === 1) {
    this.lastSubsteps = 0;
    this.lastAdvanced = 0;
    return;
  }
  inStep = true;
  simFrames++;
  try { return baseStep(frameDt); }
  finally { inStep = false; }
};

function gatedSubmit(commandBuffers) {
  // During the SIM phase, allow only the Sim.step submission. Drop the renderer submission.
  if (phase === 0) {
    if (inStep) {
      submitted++;
      return nativeSubmit(commandBuffers);
    }
    dropped++;
    phase = 1;
    return;
  }

  // During the RENDER phase Sim.step is skipped, so the renderer is the only expected submit.
  if (!inStep) {
    renderFrames++;
    submitted++;
    const out = nativeSubmit(commandBuffers);
    phase = 0;
    return out;
  }
  dropped++;
}

try {
  Object.defineProperty(queue, 'submit', {
    configurable: true,
    writable: true,
    value: gatedSubmit,
  });
  installed = queue.submit === gatedSubmit;
} catch (err) {
  console.error('[M7.3.8] could not install queue gate', err);
}
if (!installed) throw new Error('M7.3.8: GPUQueue.submit could not be intercepted on this browser.');

// Keep the diagnostic deliberately light. Timestamp queries and bodies are disabled by the entry
// point, and advanced scene/FX modules are not loaded at all.
window.__v5M738Gate = {
  online: true,
  backend: 'ios-one-submit-per-raf-interleave',
  get phase() { return phase === 0 ? 'SIM' : 'RENDER'; },
  get submitted() { return submitted; },
  get dropped() { return dropped; },
  get simFrames() { return simFrames; },
  get renderFrames() { return renderFrames; },
};

const stat = document.getElementById('v4stats');
setInterval(() => {
  if (!stat) return;
  stat.textContent = `M7.3.8 ONE-SUBMIT · next ${phase===0?'SIM':'RENDER'} · submit ${submitted} · held ${dropped}`;
}, 500);
console.info('[Fluid V5 M7.3.8] true one-submit-per-RAF interleave gate online.');
