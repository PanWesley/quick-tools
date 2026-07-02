/**
 * Quick Tools - Service Worker
 * 提供离线缓存和 PWA 支持
 */

const CACHE_NAME = 'quick-tools-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/analytics/',
  '/analytics/index.html',
  '/analytics/css/style.css',
  '/analytics/js/dashboard-utils.js',
  '/analytics/js/dashboard.js',
  '/shared/js/site-analytics-utils.js',
  '/shared/js/site-analytics.js',
  '/tools/json/',
  '/tools/diff/',
  '/tools/expense/',
  '/tools/time/',
  '/manifest.json'
];

// 安装时缓存静态资源
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[SW] Cache failed:', err);
      })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// 拦截请求并提供缓存
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/analytics')) {
    return;
  }

  // 跳过非 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  // 跳过第三方请求
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // 网络成功：更新缓存
        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // 网络失败：回退到缓存
        return caches.match(request);
      })
  );
});

// 处理后台同步（用于离线操作）
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    console.log('[SW] Background sync');
  }
});

// 处理推送通知
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        data: data.data
      })
    );
  }
});

// 点击通知
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
