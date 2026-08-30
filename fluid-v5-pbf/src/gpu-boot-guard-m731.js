// Fluid V5 M7.3.1 — WebGPU boot guard for iOS/WebKit.
// The upstream Particles4All bootstrap requests a high-performance adapter first. On iPhone/iPad
// there is only one practical Metal-backed adapter and WebKit's own WebGPU examples recommend the
// default requestAdapter() path. This guard keeps desktop behavior intact but makes iOS requests
// default-first, bounded, and recoverable instead of letting the loading screen wait forever.
(() => {
  const gpu = navigator.gpu;
  const load = document.getElementById('loading');
  const note = document.getElementById('loadnote');
  const title = document.querySelector('#loading h2');
  if (title) title.textContent = 'FLUID V5 · M7.3.1';
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    window.__v5GpuBootGuard = { online:false, reason:'navigator.gpu unavailable' };
    return;
  }

  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const raw = gpu.requestAdapter.bind(gpu);
  const timeoutMs = 6500;
  let calls = 0;

  const attempt = async (opts, label) => {
    calls++;
    if (note) note.textContent = `requesting GPU · ${label}…`;
    let timer = 0;
    try {
      return await Promise.race([
        (opts === undefined ? raw() : raw(opts)).catch(err => {
          console.warn(`[Fluid V5 M7.3.1] ${label} adapter request rejected`, err);
          return null;
        }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  async function safeRequestAdapter(options) {
    // iOS/Chrome is WebKit underneath. Ignore a high-performance hint and ask WebKit for its
    // default adapter first. On other platforms preserve the caller's requested preference.
    if (isiOS) {
      let adapter = await attempt(undefined, 'iOS default');
      if (!adapter) adapter = await attempt({ powerPreference:'low-power' }, 'iOS fallback');
      return adapter;
    }
    let adapter = await attempt(options, options?.powerPreference || 'default');
    if (!adapter && options !== undefined) adapter = await attempt(undefined, 'default fallback');
    return adapter;
  }

  let installed = false;
  try {
    Object.defineProperty(gpu, 'requestAdapter', {
      configurable:true,
      writable:true,
      value:safeRequestAdapter,
    });
    installed = gpu.requestAdapter === safeRequestAdapter;
  } catch (err) {
    try {
      const proto = Object.getPrototypeOf(gpu);
      Object.defineProperty(proto, 'requestAdapter', {
        configurable:true,
        writable:true,
        value:function(options){ return safeRequestAdapter(options); },
      });
      installed = true;
    } catch (err2) {
      console.warn('[Fluid V5 M7.3.1] unable to wrap GPU.requestAdapter', err, err2);
    }
  }

  // Independent boot watchdog. It never touches the simulation; it only turns an indefinite wait
  // into useful diagnostics/retry UI if the browser's GPU process has become unhealthy.
  const started = performance.now();
  const watchdog = setInterval(() => {
    if (window.__sim || load?.classList.contains('gone')) { clearInterval(watchdog); return; }
    const age = performance.now() - started;
    if (age > 8000 && note) note.textContent = `GPU adapter still pending · safe retry ${calls}`;
    if (age > 15500 && load && !document.getElementById('v5GpuRetryM731')) {
      const box = document.createElement('div');
      box.id = 'v5GpuRetryM731';
      box.style.cssText = 'max-width:290px;text-align:center;color:#9fc1cf;font:11px/1.45 ui-monospace';
      box.innerHTML = '<div>WebGPU did not start. The browser GPU process may need a fresh request.</div><button type="button" style="margin-top:10px;border:1px solid #4ed6dc;border-radius:999px;background:#06161d;color:#dffcff;padding:9px 14px;font:800 10px ui-monospace">RETRY GPU</button>';
      box.querySelector('button').onclick = () => location.reload();
      load.appendChild(box);
    }
  }, 500);

  window.__v5GpuBootGuard = { online:installed, version:'M7.3.1', isiOS, timeoutMs, get calls(){ return calls; } };
  console.info(`[Fluid V5 M7.3.1] GPU boot guard ${installed?'online':'fallback'} · iOS=${isiOS}`);
})();
