// Fluid V5 M7.3.2 — non-invasive WebGPU boot diagnostics.
// IMPORTANT: do not wrap navigator.gpu.requestAdapter(). The native browser path was already
// fast on this project; M7.3.1's Promise.race/fallback wrapper could turn one adapter request
// into multiple sequential 6.5s waits when WebKit was slow to resolve. This module now only
// observes startup and exposes a retry UI if the native engine genuinely stalls.
(() => {
  const gpu = navigator.gpu;
  const load = document.getElementById('loading');
  const note = document.getElementById('loadnote');
  const title = document.querySelector('#loading h2');
  if (title) title.textContent = 'FLUID V5 · M7.3.2';

  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    window.__v5GpuBootGuard = { online:false, version:'M7.3.2', reason:'navigator.gpu unavailable', isiOS };
    return;
  }

  // Let the upstream engine call the browser's native requestAdapter() exactly as before.
  // We deliberately do not monkey-patch the GPU object here.
  if (note) note.textContent = 'starting native WebGPU…';
  const started = performance.now();
  let warned = false;
  const watchdog = setInterval(() => {
    if (window.__sim || load?.classList.contains('gone')) {
      clearInterval(watchdog);
      return;
    }
    const age = performance.now() - started;
    if (age > 5000 && !warned) {
      warned = true;
      if (note) note.textContent = 'WebGPU startup is unusually slow…';
    }
    if (age > 12000 && load && !document.getElementById('v5GpuRetryM732')) {
      const box = document.createElement('div');
      box.id = 'v5GpuRetryM732';
      box.style.cssText = 'max-width:290px;text-align:center;color:#9fc1cf;font:11px/1.45 ui-monospace';
      box.innerHTML = '<div>The native WebGPU request is not responding. A fresh page load usually resets the browser GPU process.</div><button type="button" style="margin-top:10px;border:1px solid #4ed6dc;border-radius:999px;background:#06161d;color:#dffcff;padding:9px 14px;font:800 10px ui-monospace">RETRY</button>';
      box.querySelector('button').onclick = () => location.reload();
      load.appendChild(box);
    }
  }, 500);

  window.__v5GpuBootGuard = { online:true, version:'M7.3.2', isiOS, nativeRequestAdapter:true };
  console.info(`[Fluid V5 M7.3.2] native WebGPU startup preserved · iOS=${isiOS}`);
})();
