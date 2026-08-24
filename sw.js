// ===== Service Worker =====
// Basic offline-first caching for the wallet app.
// Version badalne se purana cache automatically clear ho jayega.
const CACHE_NAME = 'dharm-wallet-cache-v2';

// App shell files jo cache honi chahiye.
const CACHE_URLS = [
  './',
  './index.html',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './hero-dark.png',
  './hero-light.png'
];

// ── INSTALL: pehli baar service worker install hote waqt files cache karo ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Agar koi file cache nahi ho payi, to bhi baaki files cache ho jayen —
      // isliye Promise.allSettled use kiya, ek file fail hone se sab fail nahi hoga.
      return Promise.allSettled(
        CACHE_URLS.map((url) => cache.add(url))
      );
    })
  );
  self.skipWaiting(); // naya service worker turant activate ho
});

// ── ACTIVATE: purane cache versions delete karo ──
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
  self.clients.claim(); // turant control le lo
});

// ── FETCH: pehle network try karo, fail ho to cache se serve karo ──
self.addEventListener('fetch', (event) => {
  // Sirf GET requests handle karo (POST/PUT waghera skip)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone).catch(() => {});
        });
        return networkResponse;
      })
      .catch(() => {
        // Internet nahi hai -> cache se dhoondo
        return caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || new Response(
            'Offline hai aur ye file cache mein bhi nahi mili.',
            { status: 503, statusText: 'Offline' }
          );
        });
      })
  );
});
