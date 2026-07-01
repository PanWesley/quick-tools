/**
 * Expense Tracker - Service Worker
 * 提供离线缓存和 PWA 支持（生活账单子模块独立 SW）
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

// 安装时缓存静态资源
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

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[Expense SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[Expense SW] Deleting old cache:', name);
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
        return caches.match(request, { ignoreSearch: true });
      })
  );
});
