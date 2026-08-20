// Ghostwire / portfolio service worker — caches the app shell so the site
// (including the Ghostwire game) loads offline or on a flaky connection.
//
// Ocean simulation modules are explicitly network-first so physics changes
// cannot be hidden behind an older cached Rift build.
const CACHE_NAME = 'ngearinger-shell-v26';

const STATIC_SHELL = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

const CORE_SHELL = [
  './',
  './index.html',
  './ghostwire.js',
  './webcam-ai.js',
  './music/tracks.js',

  // Root duplicate game files.
  './main.js',
  './liquid.js',
  './liquid_legacy.js',
  './gpu_fft_ocean.js',
  './gpu_fft_ocean_v2.js',

  // Actual live Rift game files used by the embedded game.
  './rift/main.js',
  './rift/liquid.js',
  './rift/liquid_legacy.js',
  './rift/gpu_fft_ocean.js',
  './rift/gpu_fft_ocean_v2.js',
  './rift/gpu_fft_ocean_v3.js',
  './rift/gpu_fft_ocean_v4.js',
  './rift/gpu_fft_ocean_v5.js',
  './rift/gpu_shallow_water.js',
  './rift/gpu_surf_system.js',
  './rift/gpu_surf_system_v2.js',
  './rift/gpu_shore_breakers.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(
        [...STATIC_SHELL, ...CORE_SHELL].map((url) => new Request(url, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

function isCoreRequest(req) {
  if (req.mode === 'navigate') return true;
  const path = new URL(req.url).pathname;
  return CORE_SHELL.some((url) => path.endsWith(url.replace('./', '/')) || path === '/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (isCoreRequest(req)) {
    event.respondWith(
      fetch(req, { cache: 'reload' }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
