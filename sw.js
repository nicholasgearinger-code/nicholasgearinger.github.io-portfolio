// Ghostwire / portfolio service worker — caches the app shell so the site
// (including the Ghostwire game) loads offline or on a flaky connection.
//
// CACHE_NAME no longer needs to be bumped on every deploy. The docs/scripts
// that actually change (HTML, JS) are served network-first below, so a
// fresh deploy shows up on the very next load with no manual step. Bump
// CACHE_NAME only if you rename/remove files from STATIC_SHELL, to flush
// old entries for files that no longer exist.
const CACHE_NAME = 'ngearinger-shell-v7';

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
  // Note: actual audio files are NOT pre-cached here — cache.addAll()
  // fails its whole install step if any single listed file 404s, and
  // there aren't any tracks yet. Once real files are added to music/tracks.js,
  // they'll still get cached automatically by the fetch handler below on
  // first play; add them here too if you want them available before that
  // first play (e.g. for full offline support from a cold install).
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(
        // {cache: 'reload'} bypasses the browser's own HTTP cache so the
        // service-worker cache is seeded from the network, not a possibly
        // stale disk-cached copy of the same files.
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

// A request counts as "core" (network-first) if it's a page navigation or
// its path ends in one of the frequently-changing shell files. Everything
// else (icons, manifest, CDN libs the browser already cached, etc.) stays
// cache-first.
function isCoreRequest(req) {
  if (req.mode === 'navigate') return true;
  const path = new URL(req.url).pathname;
  return CORE_SHELL.some((url) => path.endsWith(url.replace('./', '/')) || path === '/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs — leave the leaderboard API, fonts, CDN
  // scripts, EventSource stream, etc. to the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (isCoreRequest(req)) {
    // Network-first: always try to get the latest deploy. {cache: 'reload'}
    // bypasses the browser's HTTP cache too, so an unexpired Cache-Control
    // header on GitHub Pages can't mask a fresh deploy. Only fall back to
    // the last cached copy if the network is actually unreachable (offline).
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
      // Cache-first for instant loads; refresh the cache in the background
      // so the next visit picks up changes.
      return cached || network;
    })
  );
});
