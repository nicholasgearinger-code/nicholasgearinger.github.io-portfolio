// Fluid V5 entry tail. Keep the proven V4.4 physical wave driver, then mount V5 in layers.
await import('./wave-test-v44.js');
await import('./v5-lab.js');

// Milestone 2 is deliberately optional at boot. The safety loader preserves the immutable M2
// checkpoint while applying mobile/WebGPU synchronization fixes before evaluating it. If any
// experimental M2 subsystem is rejected, Milestone 1 and the validated V4.4 renderer survive.
try {
  await import('./v5-m2-safe.js');
} catch (err) {
  console.error('[Fluid V5 M2] milestone 2 module failed; retained M1/V4.4 stack.', err);
}

window.__fluidV5Version = window.__v5M2?.version || '5.0.0-m1';
setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);

console.info(`[Fluid V5] ${window.__fluidV5Version} isolated lab enabled; production V4.4 remains untouched.`);
