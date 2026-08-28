// Fluid V5 entry tail. Keep the proven V4.4 physical wave driver, then mount the V5 lab.
await import('./wave-test-v44.js');
await import('./v5-lab.js');
window.__fluidV5Version = '5.0.0-m1';
setTimeout(() => {
  const toggle = document.getElementById('v4WaveToggle');
  const want = window.__v5State?.scenario === 'wave';
  if (toggle && toggle.classList.contains('active') !== want) toggle.click();
}, 420);
