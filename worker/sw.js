// Lighthouse service worker.
//
// Caches the static shell only. Every data route and the dashboard HTML are
// network-only, so an installed app never shows a stale watchlist as though it
// were live.

const CACHE = 'lighthouse-v7';
const ASSETS = ['/login', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Per-entry, not cache.addAll: addAll is all-or-nothing, so one 404 during
      // install (a deploy mid-flight, a transient error) leaves the app with no
      // cache at all rather than a partial one.
      .then((cache) => Promise.all(ASSETS.map((path) => cache.add(path).catch(() => {}))))
  );
  // NOTE: no skipWaiting() here on purpose.
  //
  // The previous version called skipWaiting() in install and clients.claim() in
  // activate. On a FIRST visit that combination installs and claims the worker
  // while the login page is open, and claiming an uncontrolled client forces a
  // reload — so the login form the user had just started filling in was silently
  // discarded mid-typing. It reproduced on a clean profile every time.
  //
  // Without skipWaiting, a new worker waits until every tab of the app is closed,
  // which is the standard, non-destructive update path. The only cost is that an
  // app left open in a tab keeps the old shell until it is reopened, which is
  // invisible for a shell that is already network-first for data.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Also no clients.claim() here, for the same reason.
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Data and documents: always the network. Never cached.
  if (path.startsWith('/items')
    || path.startsWith('/stats')
    || path.startsWith('/auth')
    || path.startsWith('/pick')
    || path.startsWith('/setup')
    || path.startsWith('/admin')
    || path === '/dashboard'
    || path === '/') {
    if (request.mode === 'navigate') {
      // Offline fallback for a navigation: serve the login shell rather than a
      // browser error page.
      event.respondWith(fetch(request).catch(() => caches.match('/login')));
    }
    return;
  }

  // The sign-in page: network first, cache only when offline.
  //
  // It used to be cache-first like the icons, which meant the first visit after
  // a deploy always ran the PREVIOUS sign-in script. That is harmless for a PNG
  // and not for the one page whose script is the only way in: a fix to sign-in
  // stayed invisible until a second load, and a broken one lingered after it
  // was fixed.
  if (path === '/login') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/login', copy));
        }
        return response;
      }).catch(() => caches.match('/login'))
    );
    return;
  }

  // Icons: cache-first, refreshed in the background.
  if (ASSETS.includes(path)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
