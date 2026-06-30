/**
 * Expense Tracker - Service Worker
 * Provides offline caching and installed PWA startup support.
 */

const CACHE_NAME = 'expense-tracker-v1.6.3';
const STATIC_ASSETS = [
  '/tools/expense/',
  '/tools/expense/index.html',
  '/tools/expense/manifest.json',
  '/tools/expense/css/style.css',
  '/tools/expense/js/db.js',
  '/tools/expense/js/tag-management-utils.js',
  '/tools/expense/js/db-backup-utils.js',
  '/tools/expense/js/chart.js',
  '/tools/expense/js/backup-utils.js',
  '/tools/expense/js/backup-crypto.js',
  '/tools/expense/js/backup-file-handle-db.js',
  '/tools/expense/js/backup-service.js',
  '/tools/expense/js/backup-ui.js',
  '/tools/expense/js/import-export.js',
  '/tools/expense/js/guide.js',
  '/tools/expense/js/expense-list-utils.js',
  '/tools/expense/js/app.js',
  '/shared/css/pwa.css',
  '/shared/js/pwa.js'
];

self.addEventListener('install', (event) => {
  console.log('[Expense SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Expense SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[Expense SW] Cache failed:', err);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Expense SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => {
          console.log('[Expense SW] Deleting old cache:', name);
          return caches.delete(name);
        })
    ))
  );
  self.clients.claim();
});

function shouldCacheResponse(response) {
  return response && response.ok && response.type !== 'opaque';
}

async function cacheNetworkResponse(request, response) {
  if (!shouldCacheResponse(response)) {
    return;
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function refreshCachedRequest(request) {
  try {
    const networkResponse = await fetch(request);
    await cacheNetworkResponse(request, networkResponse);
  } catch (error) {
    console.warn('[Expense SW] Background refresh failed:', request.url, error);
  }
}

async function fetchAndCache(request) {
  const networkResponse = await fetch(request);
  await cacheNetworkResponse(request, networkResponse);
  return networkResponse;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request, { ignoreSearch: true });
      if (cachedResponse) {
        event.waitUntil(refreshCachedRequest(request));
        return cachedResponse;
      }

      return fetchAndCache(request);
    })()
  );
});
