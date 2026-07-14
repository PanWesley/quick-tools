/**
 * 今日有序 - Service Worker
 * Cache-first app shell + notification support for the standalone time tool.
 */

importScripts('/tools/time/js/notification-crypto.js?v=1');

const CACHE_NAME = 'today-youxu-v31';
const DEFAULT_TARGET_URL = '/tools/time/#today';
const GENERIC_NOTIFICATION_TAG = 'today-youxu-generic-reminder';
const GENERIC_NOTIFICATION = {
  title: '你有一项提醒',
  body: '打开今日有序查看详情',
  tag: GENERIC_NOTIFICATION_TAG,
  data: { url: DEFAULT_TARGET_URL }
};
const APP_SHELL = [
  '/tools/time/',
  '/tools/time/index.html',
  '/tools/time/manifest.json',
  '/tools/time/css/style.css?v=137',
  '/tools/time/js/date-utils.js?v=135',
  '/tools/time/js/app-state.js?v=135',
  '/tools/time/js/export.js?v=135',
  '/tools/time/js/import-utils.js?v=135',
  '/tools/time/js/db.js?v=135',
  '/tools/time/js/notification-crypto.js?v=1',
  '/tools/time/js/notification-model.js?v=2',
  '/tools/time/js/notification-sync.js?v=3',
  '/tools/time/js/notification.js?v=6',
  '/tools/time/js/app.js?v=138',
  '/shared/css/pwa.css?v=3',
  '/shared/js/app-update.js?v=1',
  '/icons/today-youxu-icon-72x72.png',
  '/icons/today-youxu-icon-96x96.png',
  '/icons/today-youxu-icon-152x152.png',
  '/icons/today-youxu-icon-192x192.png',
  '/icons/today-youxu-icon-512x512.png'
];

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedString(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2];
}

function validateNotificationPayload(payload) {
  if (!hasExactKeys(payload, ['title', 'body', 'tag', 'data', 'scheduledAt', 'v'])
    || payload.v !== 1
    || !isBoundedString(payload.title, 1, 120)
    || !isBoundedString(payload.body, 1, 240)
    || !isBoundedString(payload.tag, 1, 256)
    || payload.tag === GENERIC_NOTIFICATION_TAG
    || !isBoundedString(payload.scheduledAt, 1, 64)
    || !Number.isFinite(Date.parse(payload.scheduledAt))) {
    throw new Error('Invalid notification payload');
  }
  const data = payload.data;
  if (!hasExactKeys(data, ['type', 'id', 'date', 'url'])
    || !['task', 'habit'].includes(data.type)
    || !isBoundedString(data.id, 1, 256)
    || !isBoundedString(data.date, 10, 10)
    || !isValidDateKey(data.date)
    || !isBoundedString(data.url, 1, 512)) {
    throw new Error('Invalid notification target');
  }
  return payload;
}

function notificationOptions(payload) {
  return {
    body: payload.body,
    tag: payload.tag,
    data: payload.data,
    icon: '/icons/today-youxu-icon-192x192.png',
    badge: '/icons/today-youxu-icon-72x72.png'
  };
}

async function showNotificationOnce(payload) {
  let visible = [];
  try {
    visible = await self.registration.getNotifications({ tag: payload.tag });
  } catch (error) {}
  if (visible.length) return;
  await self.registration.showNotification(payload.title, notificationOptions(payload));
}

async function handlePush(event) {
  let payload = GENERIC_NOTIFICATION;
  try {
    if (!event.data) throw new Error('Push data is unavailable');
    const envelope = JSON.parse(event.data.text());
    const key = await self.TodayYouxuNotificationCrypto.getKey();
    if (!key) throw new Error('Notification key is unavailable');
    payload = validateNotificationPayload(
      await self.TodayYouxuNotificationCrypto.decryptPayload(key, envelope)
    );
  } catch (error) {
    payload = GENERIC_NOTIFICATION;
  }
  await showNotificationOnce(payload);
}

function safeTargetUrl(value) {
  try {
    const target = new URL(value || DEFAULT_TARGET_URL, self.location.origin);
    if (target.origin !== self.location.origin || !target.pathname.startsWith('/tools/time/')) {
      return DEFAULT_TARGET_URL;
    }
    return target.pathname + target.search + target.hash;
  } catch (error) {
    return DEFAULT_TARGET_URL;
  }
}

function isTimeClient(value) {
  try {
    const url = new URL(value);
    return url.origin === self.location.origin && url.pathname.startsWith('/tools/time/');
  } catch (error) {
    return false;
  }
}

function isNotificationApiPath(pathname) {
  return pathname === '/api/notifications' || pathname.startsWith('/api/notifications/');
}

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
        vibrate: [200, 100, 200]
      }, options || {}))
    );
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = Object.assign({}, event.notification.data || {});
  data.url = safeTargetUrl(data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (isTimeClient(client.url) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', data: data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(data.url);
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (isNotificationApiPath(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET') return;

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
