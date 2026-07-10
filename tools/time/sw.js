/**
 * 今日有序 - Service Worker
 * Cache-first app shell + notification support for the standalone time tool.
 */

const CACHE_NAME = 'today-youxu-v28';
const APP_SHELL = [
  '/tools/time/',
  '/tools/time/index.html',
  '/tools/time/manifest.json',
  '/tools/time/css/style.css?v=135',
  '/tools/time/js/date-utils.js?v=135',
  '/tools/time/js/app-state.js?v=135',
  '/tools/time/js/export.js?v=135',
  '/tools/time/js/import-utils.js?v=135',
  '/tools/time/js/db.js?v=135',
  '/tools/time/js/notification.js?v=1',
  '/tools/time/js/app.js?v=135',
  '/shared/css/pwa.css?v=3',
  '/shared/js/app-update.js?v=1',
  '/icons/today-youxu-icon-72x72.png',
  '/icons/today-youxu-icon-96x96.png',
  '/icons/today-youxu-icon-152x152.png',
  '/icons/today-youxu-icon-192x192.png',
  '/icons/today-youxu-icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => console.warn('[TodayYouxu SW] Cache install failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith('today-youxu-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, Object.assign({
        icon: '/icons/today-youxu-icon-192x192.png',
        badge: '/icons/today-youxu-icon-72x72.png',
        vibrate: [200, 100, 200],
        renotify: true
      }, options || {}))
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/tools/time/#today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.indexOf('/tools/time/') !== -1 && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', data: data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  console.log('[TodayYouxu SW] Notification closed:', data);
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
