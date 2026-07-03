/**
 * 真价助手 - Service Worker
 * Cache-first app shell for the standalone price tool.
 */

const CACHE_NAME = 'zhenjia-assistant-v1';
const APP_SHELL = [
  '/tools/price/',
  '/tools/price/index.html',
  '/tools/price/manifest.json',
  '/tools/price/css/style.css?v=100',
  '/tools/price/js/link-parser.js?v=100',
  '/tools/price/js/price-judge.js?v=100',
  '/tools/price/js/export.js?v=100',
  '/tools/price/js/sample-data.js?v=100',
  '/tools/price/js/db.js?v=100',
  '/tools/price/js/chart.js?v=100',
  '/tools/price/js/app.js?v=100',
  '/shared/css/pwa.css?v=2',
  '/shared/js/site-analytics-utils.js?v=1',
  '/shared/js/site-analytics.js?v=1',
  '/icons/icon-192x192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => console.warn('[Zhenjia SW] Cache install failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith('zhenjia-assistant-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
