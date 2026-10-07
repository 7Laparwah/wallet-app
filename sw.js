// ===== Service Worker =====
// Offline-first caching for DayToDay Smart Expense & Budget Tracker.
const CACHE_NAME = 'daytoday-wallet-cache-v25';

// Core App Shell files for offline usage
const CACHE_URLS = [
  './',
  './index.html',
  './script.js',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
  './favicon-32.png',
  './hero-dark.png',
  './hero-light.png',
  './theme-moon.png',
  './theme-sun.png'
];

// URLs that must NEVER be cached (Dynamic APIs, Auth, Sync)
const IGNORE_CACHE_PATTERNS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'accounts.google.com',
  'generativelanguage.googleapis.com',
  'www.googleapis.com',
  'firebaseinstallations.googleapis.com'
];

// ── INSTALL: Cache initial core assets ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        CACHE_URLS.map((url) => cache.add(url))
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: Clear outdated caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ── FETCH: Smart network-first with cache fallback ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Skip browser extensions and non-HTTP protocols
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // Never cache Firestore WebChannel or Google Auth endpoints
  if (IGNORE_CACHE_PATTERNS.some((pattern) => url.includes(pattern))) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache valid response clones (only 200 responses)
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline -> return from cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          // If navigation fails offline, serve root index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }

          return new Response(
            'Offline mode: resource not in cache.',
            { status: 503, statusText: 'Offline' }
          );
        });
      })
  );
});
