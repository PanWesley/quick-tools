(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root, require('./notification-crypto.js'));
  } else {
    root.TodayYouxuNotificationSync = factory(root, root.TodayYouxuNotificationCrypto);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function(root, defaultCrypto) {
  var DB_NAME = 'todayYouxuNotificationDB';
  var DB_VERSION = 1;
  var STORE_NAMES = ['secrets', 'installation', 'queue', 'meta'];
  var INSTALLATION_KEY = 'current';
  var RETRY_BASE_MS = 1000;
  var RETRY_MAX_MS = 30 * 60 * 1000;

  function openDatabase(indexedDBApi) {
    return new Promise(function(resolve, reject) {
      if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      var request = indexedDBApi.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function() {
        var database = request.result;
        STORE_NAMES.forEach(function(name) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
        });
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  function readRecord(database, storeName, key) {
    return new Promise(function(resolve, reject) {
      var request;
      try {
        request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('IndexedDB read failed')); };
    });
  }

  function readAllRecords(database, storeName) {
    return new Promise(function(resolve, reject) {
      var request;
      try {
        request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = function() { resolve(request.result || []); };
      request.onerror = function() { reject(request.error || new Error('IndexedDB read failed')); };
    });
  }

  function writeRecord(database, storeName, key, value) {
    return new Promise(function(resolve, reject) {
      var transaction;
      try {
        transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, key);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = function() { resolve(); };
      transaction.onerror = transaction.onabort = function() {
        reject(transaction.error || new Error('IndexedDB write failed'));
      };
    });
  }

  function deleteRecord(database, storeName, key) {
    return new Promise(function(resolve, reject) {
      var transaction;
      try {
        transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(key);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = function() { resolve(); };
      transaction.onerror = transaction.onabort = function() {
        reject(transaction.error || new Error('IndexedDB delete failed'));
      };
    });
  }

  function toPublicStatus(status, installation) {
    if (status === 'disabled' || status === 'unsupported' || status === 'permission-required' || status === 'error') {
      return { status: status };
    }
    return installation && installation.deviceId ? { status: status, deviceId: installation.deviceId } : { status: status };
  }

  function create(options) {
    options = options || {};
    var indexedDBApi = options.indexedDB || root && root.indexedDB;
    var notificationCrypto = options.crypto || defaultCrypto;
    var fetchImpl = options.fetch || root && root.fetch;
    var registration = options.registration || null;
    var notificationApi = options.notification || root && root.Notification;
    var clock = options.clock || function() { return Date.now(); };
    var online = options.online || function() {
      return !root || !root.navigator || root.navigator.onLine !== false;
    };
    var apiBase = options.apiBase || '';
    var databasePromise;
    var state = 'disabled';
    var queueCounter = 0;

    function now() {
      return typeof clock === 'function' ? clock() : clock.now();
    }

    function isOnline() {
      return typeof online === 'function' ? online() : online !== false;
    }

    function getDatabase() {
      if (!databasePromise) databasePromise = openDatabase(indexedDBApi);
      return databasePromise;
    }

    async function getInstallation() {
      return readRecord(await getDatabase(), 'installation', INSTALLATION_KEY);
    }

    async function saveInstallation(installation) {
      await writeRecord(await getDatabase(), 'installation', INSTALLATION_KEY, installation);
      return installation;
    }

    async function queueOperation(kind, method, path, body) {
      var entry = {
        id: 'notification-' + now() + '-' + (++queueCounter),
        kind: kind,
        method: method,
        path: path,
        body: body || null,
        attempts: 0,
        nextRetryAt: now()
      };
      await writeRecord(await getDatabase(), 'queue', entry.id, entry);
      return entry;
    }

    async function getQueue() {
      return readAllRecords(await getDatabase(), 'queue');
    }

    async function request(method, path, body, installation, authenticated) {
      if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available');
      var headers = {};
      if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
      if (authenticated) {
        if (!installation || !installation.deviceToken) throw new Error('Device credentials are required');
        headers.Authorization = 'Bearer ' + installation.deviceToken;
      }
      return fetchImpl(apiBase + path, {
        method: method,
        headers: headers,
        body: body === undefined || body === null ? undefined : JSON.stringify(body)
      });
    }

    async function resetAuthentication(installation) {
      var database = await getDatabase();
      var entries = await readAllRecords(database, 'queue');
      for (var index = 0; index < entries.length; index += 1) {
        await deleteRecord(database, 'queue', entries[index].id);
      }
      await saveInstallation({
        enabled: !!installation.enabled,
        authenticationReset: true
      });
      state = 'error';
    }

    async function unsubscribeBrowser() {
      if (!registration || !registration.pushManager || typeof registration.pushManager.getSubscription !== 'function') return;
      var current = await registration.pushManager.getSubscription();
      if (current && typeof current.unsubscribe === 'function') await current.unsubscribe();
    }

    async function completeDisable(installation) {
      await unsubscribeBrowser();
      installation.enabled = false;
      installation.authenticationReset = false;
      installation.subscriptionEndpoint = '';
      await saveInstallation(installation);
      state = 'disabled';
    }

    async function flushQueue(forceRetry) {
      var installation = await getInstallation();
      var entries = await getQueue();
      if (!entries.length) return toPublicStatus(installation && installation.enabled ? 'ready' : 'disabled', installation);
      if (!installation || !installation.deviceToken) {
        state = 'error';
        return toPublicStatus('error');
      }
      if (!isOnline()) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }

      for (var index = 0; index < entries.length; index += 1) {
        var entry = entries[index];
        if (!forceRetry && entry.nextRetryAt > now()) continue;
        var response;
        try {
          response = await request(entry.method, entry.path, entry.body, installation, true);
        } catch (error) {
          response = null;
        }
        if (response && response.ok) {
          if (entry.kind === 'disable') await completeDisable(installation);
          await deleteRecord(await getDatabase(), 'queue', entry.id);
          continue;
        }
        if (response && (response.status === 401 || response.status === 403)) {
          await resetAuthentication(installation);
          return toPublicStatus('error');
        }
        entry.attempts += 1;
        entry.nextRetryAt = now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, entry.attempts - 1));
        await writeRecord(await getDatabase(), 'queue', entry.id, entry);
        state = 'pending';
        break;
      }

      entries = await getQueue();
      if (entries.length) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
      state = installation.enabled ? 'ready' : 'disabled';
      return toPublicStatus(state, installation);
    }

    function permissionStatus() {
      if (!notificationApi || typeof notificationApi.permission !== 'string') return 'granted';
      return notificationApi.permission;
    }

    function subscriptionJson(subscription) {
      return subscription && typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    }

    async function setup(nextRegistration) {
      if (nextRegistration) registration = nextRegistration;
      return getStatus();
    }

    async function getStatus() {
      var installation = await getInstallation();
      if (installation && installation.authenticationReset) return toPublicStatus('error');
      var entries = await getQueue();
      if (entries.length) return toPublicStatus('pending', installation);
      if (!installation || !installation.enabled) return toPublicStatus('disabled');
      if (!registration || !registration.pushManager) return toPublicStatus('unsupported');
      if (permissionStatus() !== 'granted') return toPublicStatus('permission-required');
      return toPublicStatus(state === 'syncing' || state === 'subscribing' ? state : 'ready', installation);
    }

    async function enable() {
      if (!registration || !registration.pushManager || typeof registration.pushManager.getSubscription !== 'function') {
        state = 'unsupported';
        return toPublicStatus('unsupported');
      }
      if (permissionStatus() !== 'granted') {
        state = 'permission-required';
        return toPublicStatus('permission-required');
      }
      state = 'subscribing';
      if (!isOnline()) {
        state = 'pending';
        return toPublicStatus('pending', await getInstallation());
      }

      var config;
      try {
        var configResponse = await request('GET', '/api/notifications/config', null, null, false);
        if (!configResponse.ok) throw new Error('Notification config failed');
        config = await configResponse.json();
      } catch (error) {
        state = 'pending';
        return toPublicStatus('pending', await getInstallation());
      }

      var installation = await getInstallation();
      if (!installation || !installation.deviceId || !installation.deviceToken || installation.authenticationReset) {
        try {
          var registrationResponse = await request('POST', '/api/notifications/devices', {
            platform: 'web',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          }, null, false);
          if (!registrationResponse.ok) throw new Error('Device registration failed');
          var credentials = await registrationResponse.json();
          installation = { deviceId: credentials.deviceId, deviceToken: credentials.deviceToken, enabled: true, authenticationReset: false };
          await saveInstallation(installation);
        } catch (error) {
          state = 'pending';
          return toPublicStatus('pending', installation);
        }
      } else {
        installation.enabled = true;
        await saveInstallation(installation);
      }

      var subscription = await registration.pushManager.getSubscription();
      if (subscription && Number.isFinite(subscription.expirationTime) && subscription.expirationTime <= now()) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: notificationCrypto.base64UrlDecode(config.vapidPublicKey)
        });
      }
      var subscriptionValue = subscriptionJson(subscription);
      try {
        var subscriptionResponse = await request(
          'PUT',
          '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
          subscriptionValue,
          installation,
          true
        );
        if (subscriptionResponse.status === 401 || subscriptionResponse.status === 403) {
          await resetAuthentication(installation);
          return toPublicStatus('error');
        }
        if (!subscriptionResponse.ok) throw new Error('Subscription update failed');
        installation.subscriptionEndpoint = subscriptionValue.endpoint || '';
        await saveInstallation(installation);
      } catch (error) {
        await queueOperation(
          'subscription',
          'PUT',
          '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
          subscriptionValue
        );
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
      state = 'syncing';
      return flushQueue(true);
    }

    async function sync(data, todayKey) {
      var installation = await getInstallation();
      if (!installation || !installation.enabled || !installation.deviceToken) return getStatus();
      state = 'syncing';
      await writeRecord(await getDatabase(), 'meta', 'sync', {
        lastSyncAt: now(),
        todayKey: typeof todayKey === 'string' ? todayKey : ''
      });
      var reminders = data && Array.isArray(data.reminders) ? data.reminders : [];
      var summaries = [];
      for (var index = 0; index < reminders.length; index += 1) {
        var reminder = reminders[index];
        if (!reminder || typeof reminder.id !== 'string' || !Number.isSafeInteger(reminder.revision)) continue;
        summaries.push({ id: reminder.id, revision: reminder.revision });
        if (reminder.cancelled) {
          await queueOperation('cancel', 'DELETE', '/api/notifications/reminders/' + encodeURIComponent(reminder.id), { revision: reminder.revision });
          continue;
        }
        var encryptedPayload = reminder.encryptedPayload;
        if (!encryptedPayload) {
          var key = await notificationCrypto.getOrCreateKey();
          encryptedPayload = await notificationCrypto.encryptPayload(key, reminder.payload || {});
        }
        await queueOperation('upsert', 'PUT', '/api/notifications/reminders/' + encodeURIComponent(reminder.id), {
          tool: 'time',
          sourceIdHash: reminder.sourceIdHash,
          notifyAt: reminder.notifyAt,
          encryptedPayload: encryptedPayload,
          encryptionVersion: 1,
          revision: reminder.revision
        });
      }
      await queueOperation('reconcile', 'POST', '/api/notifications/reconcile', { reminders: summaries });
      return flushQueue();
    }

    async function sendTest(value) {
      var installation = await getInstallation();
      if (!installation || !installation.enabled || !installation.deviceToken) return getStatus();
      try {
        var key = await notificationCrypto.getOrCreateKey();
        var encryptedPayload = await notificationCrypto.encryptPayload(key, value || {
          title: '测试通知', body: '后台提醒已连接'
        });
        var response = await request('POST', '/api/notifications/test', {
          encryptedPayload: encryptedPayload,
          encryptionVersion: 1
        }, installation, true);
        if (response.status === 401 || response.status === 403) {
          await resetAuthentication(installation);
          return toPublicStatus('error');
        }
        if (!response.ok) {
          state = 'error';
          return toPublicStatus('error');
        }
        state = 'ready';
        return toPublicStatus('ready', installation);
      } catch (error) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
    }

    async function disable() {
      var installation = await getInstallation();
      if (!installation || !installation.deviceId || !installation.deviceToken) {
        if (installation) {
          installation.enabled = false;
          await saveInstallation(installation);
        }
        state = 'disabled';
        return toPublicStatus('disabled');
      }
      await queueOperation(
        'disable',
        'DELETE',
        '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
        null
      );
      state = 'pending';
      return flushQueue();
    }

    async function handleOnline() {
      var installation = await getInstallation();
      if (installation && installation.authenticationReset && installation.enabled) return enable();
      return flushQueue(true);
    }

    async function handleForeground() {
      return handleOnline();
    }

    return {
      setup: setup,
      getStatus: getStatus,
      enable: enable,
      disable: disable,
      sync: sync,
      sendTest: sendTest,
      handleOnline: handleOnline,
      handleForeground: handleForeground
    };
  }

  return { create: create };
});
