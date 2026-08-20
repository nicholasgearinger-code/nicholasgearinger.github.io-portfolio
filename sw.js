// Ghostwire / portfolio service worker — caches the lightweight portfolio shell
// immediately, while Rift Islands assets are cached ON DEMAND as they are used.
// This prevents a fresh portfolio visit from downloading the full game stack,
// shaders and simulation modules before the visitor ever presses Play.
const CACHE_NAME = 'ngearinger-shell-v36';

const STATIC_SHELL = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Keep install deliberately small. Rift files are NOT listed here; /rift/
// requests are network-first below and are cached only after the game requests
// them. That preserves repeat/offline behavior without taxing normal site load.
const CORE_SHELL = [
  './',
  './index.html',
  './ghostwire.js',
  './webcam-ai.js',
  './music/tracks.js',
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

function isRiftRequest(req) {
  const path = new URL(req.url).pathname;
  return path.includes('/rift/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Portfolio core and Rift runtime code are network-first so new fixes are not
  // hidden by an old cache. Rift is cached here only once a real request occurs.
  if (isCoreRequest(req) || isRiftRequest(req)) {
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