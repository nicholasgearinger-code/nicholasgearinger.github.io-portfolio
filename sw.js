// Ghostwire / portfolio service worker — caches the app shell so the site
// (including the Ghostwire game) loads offline or on a flaky connection.
//
// FFT TEST NOTE: v8 explicitly treats the Rift game modules as network-first.
// The previous worker only considered a small shell list "core", which meant
// main.js/liquid.js/FFT modules were cache-first and could keep an older ocean
// implementation alive even after a successful Pages deployment.
const CACHE_NAME = 'ngearinger-shell-v8';

// Rarely change — safe to serve cache-first for instant loads.
const STATIC_SHELL = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Change frequently during active development — always prefer the network
// so deploys are visible immediately; cache is only a fallback for offline.
const CORE_SHELL = [
  './',
  './index.html',
  './ghostwire.js',
  './webcam-ai.js',
  './music/tracks.js',

  // Rift / Coral Shallows runtime. These MUST be network-first while the FFT
  // ocean is under active development or an old cached module graph can mask
  // a successful GitHub Pages deployment.
  './main.js',
  './liquid.js',
  './liquid_legacy.js',
  './gpu_fft_ocean.js',
  './gpu_fft_ocean_v2.js',
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
