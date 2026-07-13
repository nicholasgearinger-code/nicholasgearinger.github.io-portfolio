// Ghostwire / portfolio service worker — caches the app shell so the site
// (including the Ghostwire game) loads offline or on a flaky connection.
// Bump CACHE_NAME on any deploy that changes cached files to invalidate old
// caches; the activate handler below sweeps everything not in the new list.
const CACHE_NAME = 'ngearinger-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './ghostwire.js',
  './webcam-ai.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs — leave the leaderboard API, fonts, CDN
  // scripts, EventSource stream, etc. to the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      // Cache-first for instant loads; refresh the cache in the background
      // so the next visit picks up changes.
      return cached || network;
    })
  );
});
