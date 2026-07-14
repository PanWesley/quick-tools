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
  var LIFECYCLE_LOCK = 'today-youxu-notification-lifecycle';
  var RETRY_BASE_MS = 1000;
  var RETRY_MAX_MS = 30 * 60 * 1000;
  var MAX_RETRY_ATTEMPTS = 5;
  var MAX_QUEUE_SIZE = 500;

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

  function runTransaction(database, storeNames, mode, execute, failureMessage) {
    return new Promise(function(resolve, reject) {
      var transaction;
      var result;
      try {
        transaction = database.transaction(storeNames, mode);
        execute(transaction, function(value) { result = value; });
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = function() { resolve(result); };
      transaction.onerror = transaction.onabort = function() {
        reject(transaction.error || new Error(failureMessage));
      };
    });
  }

  function afterReads(requests, callback) {
    var values = new Array(requests.length);
    var remaining = requests.length;
    requests.forEach(function(request, index) {
      request.onsuccess = function() {
        values[index] = request.result;
        remaining -= 1;
        if (!remaining) callback(values);
      };
    });
  }

  function toPublicStatus(status, installation) {
    if (status === 'disabled' || status === 'unsupported' || status === 'permission-required' || status === 'error') {
      return { status: status };
    }
    return installation && installation.deviceId
      ? { status: status, deviceId: installation.deviceId }
      : { status: status };
  }

  function create(options) {
    options = options || {};
    var indexedDBApi = options.indexedDB || root && root.indexedDB;
    var notificationCrypto = options.crypto || defaultCrypto;
    var fetchImpl = options.fetch || root && root.fetch;
    var registration = options.registration || null;
    var notificationApi = Object.prototype.hasOwnProperty.call(options, 'notification')
      ? options.notification : root && root.Notification;
    var clock = options.clock || function() { return Date.now(); };
    var online = options.online || function() {
      return !root || !root.navigator || root.navigator.onLine !== false;
    };
    var locks = Object.prototype.hasOwnProperty.call(options, 'locks')
      ? options.locks : root && root.navigator && root.navigator.locks;
    var apiBase = options.apiBase || '';
    var requestTimeoutMs = options.requestTimeoutMs === undefined ? 15 * 1000 : options.requestTimeoutMs;
    var subscriptionTimeoutMs = options.subscriptionTimeoutMs === undefined ? 20 * 1000 : options.subscriptionTimeoutMs;
    var AbortControllerImpl = options.AbortController || root && root.AbortController;
    var setTimer = options.setTimer || (root && root.setTimeout ? root.setTimeout.bind(root) : setTimeout);
    var clearTimer = options.clearTimer || (root && root.clearTimeout ? root.clearTimeout.bind(root) : clearTimeout);
    var databasePromise;
    var state = 'disabled';
    var activeControllers = new Set();
    var randomUUID = options.randomUUID
      || (root && root.crypto && typeof root.crypto.randomUUID === 'function'
        ? root.crypto.randomUUID.bind(root.crypto)
        : function() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); });

    function now() {
      return typeof clock === 'function' ? clock() : clock.now();
    }

    function isOnline() {
      return typeof online === 'function' ? online() : online !== false;
    }

    function hasLocks() {
      return !!locks && typeof locks.request === 'function';
    }

    function hasPushAndNotification() {
      return !!registration && !!registration.pushManager
        && !!notificationApi && typeof notificationApi.permission === 'string';
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

    async function incrementMeta(key, failureMessage) {
      var database = await getDatabase();
      return runTransaction(database, 'meta', 'readwrite', function(transaction, finish) {
        var store = transaction.objectStore('meta');
        var request = store.get(key);
        request.onsuccess = function() {
          var value = Number.isSafeInteger(request.result) ? request.result + 1 : 1;
          store.put(value, key);
          finish(value);
        };
      }, failureMessage);
    }

    function nextSyncGeneration() {
      return incrementMeta('sync-generation', 'IndexedDB sync generation failed');
    }

    function installationStatus(installation) {
      if (!installation) return 'disabled';
      if (installation.enabled && installation.subscriptionReady) return 'ready';
      if (installation.enableFailed) return 'error';
      if (installation.enablePending && !installation.subscriptionReady) return 'pending';
      return installation.enabled ? 'error' : 'disabled';
    }

    async function hasCompactedQueueError() {
      return (await readRecord(await getDatabase(), 'meta', 'queue-compact-error')) === true;
    }

    function reconcileBodySignature(body) {
      if (!body || !Array.isArray(body.reminders)) return null;
      return JSON.stringify(body.reminders.map(function(item) {
        return [item && item.id, item && item.revision];
      }).sort(function(left, right) {
        return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1];
      }));
    }

    function sameReconcileBody(left, right) {
      var leftSignature = reconcileBodySignature(left);
      return leftSignature !== null && leftSignature === reconcileBodySignature(right);
    }

    async function queueOperation(kind, method, path, body, queueOptions) {
      queueOptions = queueOptions || {};
      var database = await getDatabase();
      var requiresInstallation = queueOptions.requireEnabled || queueOptions.deviceId;
      var stores = requiresInstallation ? ['meta', 'queue', 'installation'] : ['meta', 'queue'];
      var result = await runTransaction(database, stores, 'readwrite', function(transaction, finish) {
        var queueStore = transaction.objectStore('queue');
        var metaStore = transaction.objectStore('meta');
        var requests = [queueStore.getAll(), metaStore.get('queue-sequence')];
        if (requiresInstallation) requests.push(transaction.objectStore('installation').get(INSTALLATION_KEY));
        afterReads(requests, function(values) {
          var entries = values[0] || [];
          var installation = values[2];
          if (queueOptions.requireEnabled
            && (!installation || !installation.enabled || !installation.subscriptionReady || installation.cleanupPending)) {
            finish({ skipped: true });
            return;
          }
          if (queueOptions.deviceId
            && (!installation || installation.deviceId !== queueOptions.deviceId
              || !installation.deviceToken || installation.cleanupPending)) {
            finish({ skipped: true });
            return;
          }
          var entry = queueOptions.logicalKey
            ? entries.find(function(queued) { return queued.logicalKey === queueOptions.logicalKey; })
            : null;
          if (entry && Number.isSafeInteger(queueOptions.version)
            && Number.isSafeInteger(entry.version) && entry.version > queueOptions.version) {
            finish({ entry: entry });
            return;
          }
          if (entry) {
            var sameVersion = Number.isSafeInteger(queueOptions.version)
              && Number.isSafeInteger(entry.version) && entry.version === queueOptions.version;
            var sameIntent = sameVersion || (kind === 'reconcile' && entry.kind === 'reconcile'
              && sameReconcileBody(entry.body, body));
            entry.kind = kind;
            entry.method = method;
            entry.path = path;
            entry.body = body || null;
            entry.version = queueOptions.version;
            entry.generation = Number.isSafeInteger(entry.generation) ? entry.generation + 1 : 1;
            if (!sameIntent) {
              entry.attempts = 0;
              entry.nextRetryAt = now();
              entry.terminal = false;
            }
            queueStore.put(entry, entry.id);
            finish({ entry: entry });
            return;
          }
          if (entries.length >= MAX_QUEUE_SIZE) {
            var terminalEntries = entries.filter(function(queued) { return queued.terminal; })
              .sort(function(left, right) { return (left.sequence || 0) - (right.sequence || 0); });
            var removalsNeeded = entries.length - MAX_QUEUE_SIZE + 1;
            for (var terminalIndex = 0; terminalIndex < removalsNeeded && terminalIndex < terminalEntries.length;
              terminalIndex += 1) {
              queueStore.delete(terminalEntries[terminalIndex].id);
            }
            if (terminalEntries.length >= removalsNeeded) {
              metaStore.put(true, 'queue-compact-error');
              entries = entries.filter(function(queued) {
                return terminalEntries.slice(0, removalsNeeded).every(function(removed) { return removed.id !== queued.id; });
              });
            }
          }
          if (entries.length >= MAX_QUEUE_SIZE) {
            finish({ limit: true });
            return;
          }
          var sequence = Number.isSafeInteger(values[1]) ? values[1] + 1 : 1;
          entry = createQueueEntry(sequence, kind, method, path, queueOptions.logicalKey || null);
          entry.version = queueOptions.version;
          entry.body = body || null;
          metaStore.put(sequence, 'queue-sequence');
          queueStore.put(entry, entry.id);
          finish({ entry: entry });
        });
      }, 'IndexedDB queue write failed');
      if (result && result.limit) {
        var error = new Error('Notification queue limit reached');
        error.name = 'QueueLimitError';
        throw error;
      }
      return result && result.entry;
    }

    async function getQueue() {
      var entries = await readAllRecords(await getDatabase(), 'queue');
      return entries.sort(function(left, right) {
        return (left.sequence || 0) - (right.sequence || 0);
      });
    }

    async function getQueuedLogical(logicalKey) {
      var entries = await getQueue();
      return entries.find(function(entry) { return entry.logicalKey === logicalKey; });
    }

    function withDeadline(promise, timeoutMs, onTimeout) {
      return new Promise(function(resolve, reject) {
        var timer = setTimer(function() {
          if (onTimeout) onTimeout();
          var error = new Error('Notification operation timed out');
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
        Promise.resolve(promise).then(function(value) {
          clearTimer(timer);
          resolve(value);
        }, function(error) {
          clearTimer(timer);
          reject(error);
        });
      });
    }

    async function request(method, path, body, installation, authenticated) {
      if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available');
      var headers = {};
      if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
      if (authenticated) {
        if (!installation || !installation.deviceToken) throw new Error('Device credentials are required');
        headers.Authorization = 'Bearer ' + installation.deviceToken;
      }
      var controller = AbortControllerImpl ? new AbortControllerImpl() : null;
      if (controller) activeControllers.add(controller);
      try {
        var init = { method: method, headers: headers,
          body: body === undefined || body === null ? undefined : JSON.stringify(body) };
        if (controller) init.signal = controller.signal;
        return await withDeadline(fetchImpl(apiBase + path, init), requestTimeoutMs, function() {
          if (controller) controller.abort();
        });
      } finally {
        if (controller) activeControllers.delete(controller);
      }
    }

    function applyAuthenticationReset(installationStore, queueStore, installation, entries, current) {
      installation = installation || {};
      if (installation.cleanupPending) {
        installation.deviceToken = undefined;
        installation.cleanupAuthRejected = true;
        installation.authenticationReset = true;
        installationStore.put(installation, INSTALLATION_KEY);
        (entries || []).forEach(function(entry) {
          if ((current && entry.id === current.id) || (!current && entry.kind === 'disable')) {
            entry.attempts = MAX_RETRY_ATTEMPTS;
            entry.nextRetryAt = null;
            entry.terminal = true;
            queueStore.put(entry, entry.id);
          } else {
            queueStore.delete(entry.id);
          }
        });
        return;
      }
      (entries || []).forEach(function(entry) { queueStore.delete(entry.id); });
      installationStore.put({
        enabled: !!installation.enabled,
        authenticationReset: true,
        forceNewSubscription: false
      }, INSTALLATION_KEY);
    }

    async function resetAuthentication() {
      var database = await getDatabase();
      await runTransaction(database, ['installation', 'queue'], 'readwrite', function(transaction) {
        var installationStore = transaction.objectStore('installation');
        var queueStore = transaction.objectStore('queue');
        afterReads([installationStore.get(INSTALLATION_KEY), queueStore.getAll()], function(values) {
          applyAuthenticationReset(installationStore, queueStore, values[0], values[1]);
        });
      }, 'IndexedDB authentication reset failed');
      state = 'error';
    }

    function createQueueEntry(sequence, kind, method, path, logicalKey) {
      return { id: 'notification-' + sequence + '-' + randomUUID(), sequence: sequence, generation: 1,
        logicalKey: logicalKey, kind: kind, method: method, path: path, body: null,
        attempts: 0, nextRetryAt: now(), terminal: false };
    }

    function buildServerReminderId(deviceId, reminderId) {
      var value = String(deviceId || '') + ':' + String(reminderId || '');
      return value.length > 1 && value.length <= 128 ? value : null;
    }

    async function prepareDisable() {
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation', 'queue'], 'readwrite', function(transaction, finish) {
        var metaStore = transaction.objectStore('meta');
        var installationStore = transaction.objectStore('installation');
        var queueStore = transaction.objectStore('queue');
        afterReads([metaStore.get('queue-sequence'), installationStore.get(INSTALLATION_KEY),
          queueStore.getAll()], function(values) {
          var installation = values[1] || { enabled: true, subscriptionReady: false };
          installation.cleanupPending = true;
          installation.cleanupDeviceId = installation.cleanupDeviceId || installation.deviceId;
          installation.cleanupServerDone = false;
          installation.cleanupAuthRejected = false;
          installationStore.put(installation, INSTALLATION_KEY);
          (values[2] || []).forEach(function(entry) { queueStore.delete(entry.id); });
          if (installation.cleanupDeviceId) {
            var sequence = Number.isSafeInteger(values[0]) ? values[0] + 1 : 1;
            var entry = createQueueEntry(sequence, 'disable', 'DELETE',
              '/api/notifications/devices/' + encodeURIComponent(installation.cleanupDeviceId) + '/subscription', 'disable');
            metaStore.put(sequence, 'queue-sequence');
            queueStore.put(entry, entry.id);
          }
          finish(installation);
        });
      }, 'IndexedDB disable preparation failed');
    }

    async function ensureCleanupIntent() {
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation', 'queue'], 'readwrite', function(transaction, finish) {
        var metaStore = transaction.objectStore('meta');
        var installationStore = transaction.objectStore('installation');
        var queueStore = transaction.objectStore('queue');
        afterReads([installationStore.get(INSTALLATION_KEY), queueStore.getAll(),
          metaStore.get('queue-sequence')], function(values) {
          var installation = values[0];
          var entries = values[1] || [];
          if (!installation || !installation.cleanupPending || installation.cleanupServerDone
            || installation.cleanupAuthRejected || !installation.cleanupDeviceId) {
            finish(false);
            return;
          }
          var existing = entries.find(function(entry) { return entry.kind === 'disable'; });
          if (existing && !existing.terminal) {
            finish(false);
            return;
          }
          if (existing) {
            existing.generation = Number.isSafeInteger(existing.generation) ? existing.generation + 1 : 1;
            existing.attempts = 0;
            existing.nextRetryAt = now();
            existing.terminal = false;
            queueStore.put(existing, existing.id);
            finish(true);
            return;
          }
          var sequence = Number.isSafeInteger(values[2]) ? values[2] + 1 : 1;
          var entry = createQueueEntry(sequence, 'disable', 'DELETE',
            '/api/notifications/devices/' + encodeURIComponent(installation.cleanupDeviceId) + '/subscription', 'disable');
          metaStore.put(sequence, 'queue-sequence');
          queueStore.put(entry, entry.id);
          finish(true);
        });
      }, 'IndexedDB cleanup recovery failed');
    }

    async function unsubscribeBrowser() {
      if (!registration || !registration.pushManager || typeof registration.pushManager.getSubscription !== 'function') return true;
      var current = await registration.pushManager.getSubscription();
      if (!current || typeof current.unsubscribe !== 'function') return true;
      return await current.unsubscribe() !== false;
    }

    async function retireAuthenticationSubscription(installation) {
      if (!installation || !installation.authenticationReset || installation.forceNewSubscription) return true;
      try {
        if (!await unsubscribeBrowser()) return false;
      } catch (error) {
        return false;
      }
      installation.forceNewSubscription = true;
      await saveInstallation(installation);
      return true;
    }

    async function completeDisable() {
      var installation = await getInstallation();
      if (!installation || !installation.cleanupPending || !installation.cleanupServerDone) return false;
      try {
        if (!await unsubscribeBrowser()) {
          state = installation.cleanupAuthRejected ? 'error' : 'pending';
          return false;
        }
      } catch (error) {
        state = installation.cleanupAuthRejected ? 'error' : 'pending';
        return false;
      }
      installation.enabled = false;
      installation.subscriptionReady = false;
      installation.enablePending = false;
      installation.enableFailed = false;
      installation.authenticationReset = false;
      installation.cleanupPending = false;
      installation.cleanupServerDone = false;
      installation.cleanupAuthRejected = false;
      installation.subscriptionEndpoint = '';
      installation.forceNewSubscription = false;
      await saveInstallation(installation);
      state = 'disabled';
      return true;
    }

    async function commitQueueResponse(snapshot, response) {
      var database = await getDatabase();
      return runTransaction(database, ['queue', 'installation'], 'readwrite', function(transaction, finish) {
        var queueStore = transaction.objectStore('queue');
        var installationStore = transaction.objectStore('installation');
        afterReads([queueStore.get(snapshot.id), installationStore.get(INSTALLATION_KEY),
          queueStore.getAll()], function(values) {
          var current = values[0];
          var installation = values[1] || {};
          if (!current || current.generation !== snapshot.generation) {
            finish({ stale: true });
            return;
          }
          if (response && response.ok) {
            queueStore.delete(current.id);
            if (current.kind === 'disable') {
              installation.cleanupServerDone = true;
              installationStore.put(installation, INSTALLATION_KEY);
            }
            if (current.kind === 'subscription'
              && current.logicalKey === 'subscription:' + installation.deviceId
              && !installation.cleanupPending) {
              installation.enabled = true;
              installation.subscriptionReady = true;
              installation.enablePending = false;
              installation.enableFailed = false;
              installation.subscriptionEndpoint = current.body && current.body.endpoint || '';
              installation.authenticationReset = false;
              installation.forceNewSubscription = false;
              installationStore.put(installation, INSTALLATION_KEY);
            }
            finish({ success: true, disable: current.kind === 'disable' });
            return;
          }
          if (response && (response.status === 401 || response.status === 403)) {
            if (current.kind === 'disable' && installation.cleanupPending) {
              queueStore.delete(current.id);
              installation.deviceToken = undefined;
              installation.cleanupServerDone = true;
              installation.cleanupAuthRejected = true;
              installation.authenticationReset = true;
              installationStore.put(installation, INSTALLATION_KEY);
              finish({ disableAuthenticationError: true });
              return;
            }
            applyAuthenticationReset(installationStore, queueStore, installation, values[2], current);
            finish({ authenticationError: true });
            return;
          }
          current.attempts += 1;
          current.terminal = current.attempts >= MAX_RETRY_ATTEMPTS;
          current.nextRetryAt = current.terminal
            ? null
            : now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, current.attempts - 1));
          queueStore.put(current, current.id);
          finish({ failed: true, terminal: current.terminal });
        });
      }, 'IndexedDB queue response commit failed');
    }

    async function flushQueue(forceRetry) {
      var installation = await getInstallation();
      if (installation && installation.cleanupPending) {
        if (installation.cleanupServerDone) {
          if (await completeDisable()) return toPublicStatus('disabled');
          return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
        }
        if (installation.cleanupAuthRejected) return toPublicStatus('error');
        await ensureCleanupIntent();
      }
      var entries = await getQueue();
      if (!entries.length) {
        if (installation && installation.cleanupPending) {
          state = installation.cleanupDeviceId && installation.deviceToken ? 'pending' : 'error';
          return toPublicStatus(state, installation);
        }
        state = installationStatus(installation);
        if (state === 'ready' && await hasCompactedQueueError()) state = 'error';
        return toPublicStatus(state, installation);
      }
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
        if (entry.terminal || (!forceRetry && entry.nextRetryAt > now())) continue;
        var response;
        try {
          response = await request(entry.method, entry.path, entry.body, installation, true);
        } catch (error) {
          response = null;
        }
        var committed = await commitQueueResponse(entry, response);
        if (committed.authenticationError) {
          state = 'error';
          return toPublicStatus('error');
        }
        if (committed.disableAuthenticationError) {
          if (await completeDisable()) return toPublicStatus('disabled');
          return toPublicStatus('error');
        }
        if (committed.disable) {
          if (await completeDisable()) return toPublicStatus('disabled');
          return toPublicStatus('pending', await getInstallation());
        }
        if (committed.failed && !committed.terminal) break;
      }

      installation = await getInstallation();
      entries = await getQueue();
      if (installation && installation.cleanupPending) {
        state = installation.cleanupAuthRejected ? 'error' : 'pending';
        return toPublicStatus(state, installation);
      }
      if (entries.some(function(entry) { return !entry.terminal; })) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
      if (entries.some(function(entry) { return entry.terminal; }) || await hasCompactedQueueError()) {
        state = 'error';
        return toPublicStatus('error');
      }
      state = installationStatus(installation);
      return toPublicStatus(state, installation);
    }

    function permissionStatus() {
      if (!notificationApi || typeof notificationApi.permission !== 'string') return 'granted';
      return notificationApi.permission;
    }

    async function setupImpl(nextRegistration) {
      if (nextRegistration) registration = nextRegistration;
      if (!hasPushAndNotification()) return toPublicStatus('unsupported');
      return getStatusImpl();
    }

    async function getStatusImpl() {
      if (!hasPushAndNotification()) return toPublicStatus('unsupported');
      var installation = await getInstallation();
      var entries = await getQueue();
      if (installation && installation.cleanupPending) {
        if (installation.cleanupAuthRejected || entries.some(function(entry) { return entry.terminal; })) {
          return toPublicStatus('error');
        }
        return toPublicStatus('pending', installation);
      }
      if (installation && installation.enableFailed) return toPublicStatus('error');
      if (installation && installation.enablePending) return toPublicStatus('pending', installation);
      if (installation && installation.authenticationReset) return toPublicStatus('error');
      if (entries.some(function(entry) { return !entry.terminal; })) return toPublicStatus('pending', installation);
      if (!installation || (!installation.enabled && !installation.deviceToken)) return toPublicStatus('disabled');
      if (entries.some(function(entry) { return entry.terminal; }) || await hasCompactedQueueError()) {
        return toPublicStatus('error');
      }
      if (!registration || !registration.pushManager) return toPublicStatus('unsupported');
      if (permissionStatus() !== 'granted') return toPublicStatus('permission-required');
      var persistedState = installationStatus(installation);
      return toPublicStatus(state === 'syncing' || state === 'subscribing' ? state : persistedState, installation);
    }

    async function commitSubscriptionSuccess(installation, queued, endpoint) {
      var database = await getDatabase();
      return runTransaction(database, ['installation', 'queue'], 'readwrite', function(transaction, finish) {
        var installationStore = transaction.objectStore('installation');
        var queueStore = transaction.objectStore('queue');
        var requests = [installationStore.get(INSTALLATION_KEY)];
        if (queued) requests.push(queueStore.get(queued.id));
        afterReads(requests, function(values) {
          var stored = values[0];
          if (!stored || stored.cleanupPending || stored.deviceId !== installation.deviceId) {
            finish(false);
            return;
          }
          stored.subscriptionEndpoint = endpoint;
          stored.subscriptionReady = true;
          stored.enabled = true;
          stored.enablePending = false;
          stored.enableFailed = false;
          stored.authenticationReset = false;
          stored.forceNewSubscription = false;
          installationStore.put(stored, INSTALLATION_KEY);
          if (queued && values[1] && values[1].generation === queued.generation) queueStore.delete(queued.id);
          finish(true);
        });
      }, 'IndexedDB subscription commit failed');
    }

    async function enableImpl() {
      var installation = await getInstallation();
      if (installation && installation.cleanupPending) {
        return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
      }
      if (!hasPushAndNotification()
        || typeof registration.pushManager.getSubscription !== 'function') {
        state = 'unsupported';
        return toPublicStatus('unsupported');
      }
      if (permissionStatus() !== 'granted') {
        state = 'permission-required';
        return toPublicStatus('permission-required');
      }
      if (installation && installation.authenticationReset
        && !await retireAuthenticationSubscription(installation)) {
        state = 'error';
        return toPublicStatus('error');
      }
      installation = await getInstallation();
      state = 'subscribing';
      installation = installation || {
        enabled: false,
        subscriptionReady: false,
        authenticationReset: false
      };
      installation.enabled = false;
      installation.subscriptionReady = false;
      installation.enablePending = true;
      installation.enableFailed = false;
      await saveInstallation(installation);
      if (!isOnline()) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }

      var config;
      try {
        var configResponse = await request('GET', '/api/notifications/config', null, null, false);
        if (!configResponse.ok) throw new Error('Notification config failed');
        config = await configResponse.json();
      } catch (error) {
        state = 'pending';
        return toPublicStatus('pending', installation);
      }

      if (!installation || !installation.deviceId || !installation.deviceToken || installation.authenticationReset) {
        try {
          var registrationResponse = await request('POST', '/api/notifications/devices', {
            platform: 'web',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          }, null, false);
          if (!registrationResponse.ok) throw new Error('Device registration failed');
          var credentials = await registrationResponse.json();
          var forceNewSubscription = !!(installation && installation.forceNewSubscription);
          installation = {
            deviceId: credentials.deviceId,
            deviceToken: credentials.deviceToken,
            enabled: false,
            subscriptionReady: false,
            enablePending: true,
            authenticationReset: false,
            forceNewSubscription: forceNewSubscription
          };
          await saveInstallation(installation);
        } catch (error) {
          state = 'pending';
          return toPublicStatus('pending', installation);
        }
      }

      var subscription;
      var subscriptionValue;
      try {
        subscription = installation.forceNewSubscription
          ? null
          : await registration.pushManager.getSubscription();
        if (subscription && Number.isFinite(subscription.expirationTime) && subscription.expirationTime <= now()) {
          if (await subscription.unsubscribe() === false) throw new Error('Expired subscription cleanup failed');
          subscription = null;
        }
        if (!subscription) {
          subscription = await withDeadline(registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: notificationCrypto.base64UrlDecode(config.vapidPublicKey)
          }), subscriptionTimeoutMs);
        }
        subscriptionValue = subscription && typeof subscription.toJSON === 'function'
          ? subscription.toJSON()
          : subscription;
      } catch (error) {
        installation.enablePending = false;
        installation.enableFailed = true;
        await saveInstallation(installation);
        state = 'error';
        return toPublicStatus('error');
      }

      var logicalKey = 'subscription:' + installation.deviceId;
      var queued = await getQueuedLogical(logicalKey);
      try {
        var subscriptionResponse = await request(
          'PUT',
          '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
          subscriptionValue,
          installation,
          true
        );
        if (subscriptionResponse.status === 401 || subscriptionResponse.status === 403) {
          await resetAuthentication();
          return toPublicStatus('error');
        }
        if (!subscriptionResponse.ok) throw new Error('Subscription update failed');
        if (!await commitSubscriptionSuccess(installation, queued, subscriptionValue.endpoint || '')) {
          return getStatusImpl();
        }
      } catch (error) {
        try {
          await queueOperation(
            'subscription',
            'PUT',
            '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
            subscriptionValue,
            { logicalKey: logicalKey, deviceId: installation.deviceId }
          );
        } catch (queueError) {
          state = 'error';
          return toPublicStatus('error');
        }
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
      state = 'syncing';
      return flushQueue(true);
    }

    async function syncImpl(data, todayKey) {
      var installation = await getInstallation();
      if (!installation || !installation.enabled || !installation.subscriptionReady
        || !installation.deviceToken || installation.cleanupPending) {
        return getStatusImpl();
      }
      try {
        state = 'syncing';
        await writeRecord(await getDatabase(), 'meta', 'sync', {
          lastSyncAt: now(),
          todayKey: typeof todayKey === 'string' ? todayKey : ''
        });
        var reminders = data && Array.isArray(data.reminders) ? data.reminders : [];
        var summaries = [];
        var reconcileVersion = await nextSyncGeneration();
        for (var index = 0; index < reminders.length; index += 1) {
          var reminder = reminders[index];
          if (!reminder || typeof reminder.id !== 'string' || !Number.isSafeInteger(reminder.revision)) continue;
          var serverId = buildServerReminderId(installation.deviceId, reminder.id);
          if (!serverId) throw new Error('Notification reminder ID is invalid');
          summaries.push({ id: serverId, revision: reminder.revision });
          if (reminder.cancelled) {
            await queueOperation('cancel', 'DELETE', '/api/notifications/reminders/' + encodeURIComponent(serverId),
              { revision: reminder.revision }, {
                logicalKey: 'reminder:' + serverId,
                version: reminder.revision,
                requireEnabled: true
              });
            continue;
          }
          var encryptedPayload = reminder.encryptedPayload;
          if (!encryptedPayload) {
            var key = await notificationCrypto.getOrCreateKey();
            encryptedPayload = await notificationCrypto.encryptPayload(key, reminder.payload || {});
          }
          await queueOperation('upsert', 'PUT', '/api/notifications/reminders/' + encodeURIComponent(serverId), {
            tool: 'time',
            sourceIdHash: reminder.sourceIdHash,
            notifyAt: reminder.notifyAt,
            encryptedPayload: encryptedPayload,
            encryptionVersion: 1,
            revision: reminder.revision
          }, {
            logicalKey: 'reminder:' + serverId,
            version: reminder.revision,
            requireEnabled: true
          });
        }
        summaries.sort(function(left, right) {
          return left.id < right.id ? -1 : left.id > right.id ? 1 : left.revision - right.revision;
        });
        await queueOperation('reconcile', 'POST', '/api/notifications/reconcile', { reminders: summaries }, {
          logicalKey: 'reconcile',
          version: reconcileVersion,
          requireEnabled: true
        });
        return flushQueue(false);
      } catch (error) {
        state = 'error';
        return toPublicStatus('error');
      }
    }

    async function sendTestImpl(value) {
      var installation = await getInstallation();
      if (installation && installation.cleanupPending) {
        return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
      }
      if (!installation || !installation.enabled || !installation.subscriptionReady || !installation.deviceToken) {
        return getStatusImpl();
      }
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
          await resetAuthentication();
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

    async function disableImpl() {
      var installation = await getInstallation();
      if (installation && installation.cleanupPending) {
        if (installation.cleanupServerDone) {
          if (await completeDisable()) return toPublicStatus('disabled');
          return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
        }
        if (installation.cleanupAuthRejected) return toPublicStatus('error');
        await ensureCleanupIntent();
        return flushQueue(false);
      }

      if (!installation || !installation.deviceId || !installation.deviceToken) {
        var currentSubscription;
        try {
          currentSubscription = registration && registration.pushManager
            && typeof registration.pushManager.getSubscription === 'function'
            ? await registration.pushManager.getSubscription()
            : null;
        } catch (error) {
          currentSubscription = true;
        }
        if (currentSubscription) {
          await prepareDisable();
          state = 'error';
          return toPublicStatus('error');
        }
        if (installation) {
          installation.enabled = false;
          installation.cleanupPending = false;
          await saveInstallation(installation);
        }
        state = 'disabled';
        return toPublicStatus('disabled');
      }

      installation = await prepareDisable();
      state = 'pending';
      return flushQueue(false);
    }

    async function handleOnlineImpl() {
      var installation = await getInstallation();
      if (installation && installation.enablePending && !installation.cleanupPending) return enableImpl();
      if (installation && installation.authenticationReset && !installation.cleanupPending) return getStatusImpl();
      if (installation && installation.cleanupPending) {
        if (installation.cleanupServerDone) {
          if (await completeDisable()) return toPublicStatus('disabled');
          return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
        }
        if (installation.cleanupAuthRejected) return toPublicStatus('error');
        await ensureCleanupIntent();
      }
      return flushQueue(false);
    }

    function runLocked(operation, args) {
      if (!hasLocks()) return Promise.resolve(toPublicStatus('unsupported'));
      return Promise.resolve().then(function() {
        return locks.request(LIFECYCLE_LOCK, { ifAvailable: true }, function(lock) {
          if (!lock) {
            state = 'pending';
            return toPublicStatus('pending');
          }
          return operation.apply(null, args);
        });
      }).catch(function() {
        state = 'error';
        return toPublicStatus('error');
      });
    }

    function getStatus() {
      if (!hasLocks()) return Promise.resolve(toPublicStatus('unsupported'));
      return getStatusImpl().catch(function() {
        state = 'error';
        return toPublicStatus('error');
      });
    }

    function cancelActiveRequests() {
      activeControllers.forEach(function(controller) {
        try {
          controller.abort();
        } catch (error) {}
      });
      activeControllers.clear();
    }

    return {
      setup: function() { return runLocked(setupImpl, arguments); },
      getStatus: getStatus,
      enable: function() { return runLocked(enableImpl, arguments); },
      disable: function() { return runLocked(disableImpl, arguments); },
      sync: function() { return runLocked(syncImpl, arguments); },
      sendTest: function() { return runLocked(sendTestImpl, arguments); },
      handleOnline: function() { return runLocked(handleOnlineImpl, arguments); },
      handleForeground: function() { return runLocked(handleOnlineImpl, arguments); },
      cancelActiveRequests: cancelActiveRequests
    };
  }

  return { create: create };
});
