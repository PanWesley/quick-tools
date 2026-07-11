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
  var MAX_RETRY_ATTEMPTS = 5;
  var MAX_QUEUE_SIZE = 100;
  var DRAIN_LEASE_MS = 60 * 1000;

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
    var operationChain = Promise.resolve();
    var randomUUID = options.randomUUID
      || (root && root.crypto && typeof root.crypto.randomUUID === 'function'
        ? root.crypto.randomUUID.bind(root.crypto)
        : function() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); });
    var ownerId = randomUUID();

    function serialize(operation, args) {
      function run() { return operation.apply(null, args); }
      var result = operationChain.then(run, run);
      operationChain = result.catch(function() {});
      return result;
    }

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

    async function beginLifecycle(mode) {
      var database = await getDatabase();
      var stores = mode === 'disable' ? ['meta', 'installation', 'queue'] : ['meta', 'installation'];
      return runTransaction(database, stores, 'readwrite', function(transaction, finish) {
        var metaStore = transaction.objectStore('meta');
        var installationStore = transaction.objectStore('installation');
        var requests = [metaStore.get('lifecycle-epoch'), installationStore.get(INSTALLATION_KEY)];
        if (mode === 'disable') requests.push(transaction.objectStore('queue').getAll());
        afterReads(requests, function(values) {
          var installation = values[1];
          if (mode !== 'disable' && mode !== 'drain' && installation && installation.cleanupPending) {
            finish({ blocked: true, installation: installation });
            return;
          }
          var lifecycle = {
            epoch: Number.isSafeInteger(values[0]) ? values[0] + 1 : 1,
            ownerId: ownerId,
            mode: mode
          };
          metaStore.put(lifecycle.epoch, 'lifecycle-epoch');
          metaStore.put(lifecycle, 'lifecycle');
          if (mode === 'disable') {
            installation = installation || { enabled: true };
            installation.cleanupPending = true;
            installation.cleanupDeviceId = installation.cleanupDeviceId || installation.deviceId;
            installation.cleanupDeviceToken = installation.cleanupDeviceToken || installation.deviceToken;
            installation.cleanupServerDone = false;
            installation.cleanupAuthRejected = false;
            installationStore.put(installation, INSTALLATION_KEY);
            (values[2] || []).forEach(function(entry) { transaction.objectStore('queue').delete(entry.id); });
            lifecycle.installation = installation;
          }
          finish(lifecycle);
        });
      }, 'IndexedDB lifecycle update failed');
    }

    async function lifecycleIsCurrent(lifecycle, allowCleanup) {
      if (!lifecycle || lifecycle.blocked) return false;
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation'], 'readonly', function(transaction, finish) {
        afterReads([
          transaction.objectStore('meta').get('lifecycle'),
          transaction.objectStore('installation').get(INSTALLATION_KEY)
        ], function(values) {
          var current = values[0];
          var installation = values[1];
          finish(!!current && current.epoch === lifecycle.epoch && current.ownerId === lifecycle.ownerId
            && (allowCleanup || !installation || !installation.cleanupPending));
        });
      }, 'IndexedDB lifecycle validation failed');
    }

    async function saveInstallationIfCurrent(lifecycle, installation, allowCleanup) {
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation'], 'readwrite', function(transaction, finish) {
        var installationStore = transaction.objectStore('installation');
        afterReads([
          transaction.objectStore('meta').get('lifecycle'),
          installationStore.get(INSTALLATION_KEY)
        ], function(values) {
          var current = values[0];
          var stored = values[1];
          var valid = !!current && current.epoch === lifecycle.epoch && current.ownerId === lifecycle.ownerId
            && (allowCleanup || !stored || !stored.cleanupPending);
          if (valid) installationStore.put(installation, INSTALLATION_KEY);
          finish(valid);
        });
      }, 'IndexedDB lifecycle installation write failed');
    }

    async function commitSubscriptionSuccess(lifecycle, installation, logicalKey, endpoint) {
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation', 'queue'], 'readwrite', function(transaction, finish) {
        var installationStore = transaction.objectStore('installation');
        var queueStore = transaction.objectStore('queue');
        afterReads([
          transaction.objectStore('meta').get('lifecycle'),
          installationStore.get(INSTALLATION_KEY),
          queueStore.getAll()
        ], function(values) {
          var current = values[0];
          var stored = values[1];
          var valid = !!current && current.epoch === lifecycle.epoch && current.ownerId === lifecycle.ownerId
            && !!stored && !stored.cleanupPending;
          if (valid) {
            stored.subscriptionEndpoint = endpoint;
            installationStore.put(stored, INSTALLATION_KEY);
            (values[2] || []).forEach(function(entry) {
              if (entry.logicalKey === logicalKey) queueStore.delete(entry.id);
            });
          }
          finish(valid);
        });
      }, 'IndexedDB subscription commit failed');
    }

    async function nextSyncGeneration() {
      var database = await getDatabase();
      return runTransaction(database, 'meta', 'readwrite', function(transaction, finish) {
        var store = transaction.objectStore('meta');
        var request = store.get('sync-generation');
        request.onsuccess = function() {
          var generation = Number.isSafeInteger(request.result) ? request.result + 1 : 1;
          store.put(generation, 'sync-generation');
          finish(generation);
        };
      }, 'IndexedDB sync generation failed');
    }

    async function acquireServerWriteLock() {
      var database = await getDatabase();
      while (true) {
        var lock = await runTransaction(database, 'meta', 'readwrite', function(transaction, finish) {
          var store = transaction.objectStore('meta');
          var request = store.get('server-write-lock');
          request.onsuccess = function() {
            if (request.result) return;
            var acquired = { ownerId: ownerId, token: randomUUID() };
            store.put(acquired, 'server-write-lock');
            finish(acquired);
          };
        }, 'IndexedDB server write lock failed');
        if (lock) return lock;
        await new Promise(function(resolve) { setTimeout(resolve, 0); });
      }
    }

    async function releaseServerWriteLock(lock) {
      var database = await getDatabase();
      return runTransaction(database, 'meta', 'readwrite', function(transaction) {
        var store = transaction.objectStore('meta');
        var request = store.get('server-write-lock');
        request.onsuccess = function() {
          var current = request.result;
          if (current && current.ownerId === lock.ownerId && current.token === lock.token) {
            store.delete('server-write-lock');
          }
        };
      }, 'IndexedDB server write unlock failed');
    }

    async function lifecycleRequest(lifecycle, allowCleanup, send) {
      var lock = await acquireServerWriteLock();
      try {
        if (!await lifecycleIsCurrent(lifecycle, allowCleanup)) return { fenced: true };
        var response = await send();
        if (!await lifecycleIsCurrent(lifecycle, allowCleanup)) return { fenced: true, response: response };
        return { fenced: false, response: response };
      } finally {
        await releaseServerWriteLock(lock);
      }
    }

    async function queueOperation(kind, method, path, body, queueOptions) {
      queueOptions = queueOptions || {};
      var database = await getDatabase();
      return new Promise(function(resolve, reject) {
        var transaction;
        var queueStore;
        var metaStore;
        var installationValue;
        var entries;
        var sequenceValue;
        var entry;
        var limitError;
        var reads = 0;
        var requiredReads = queueOptions.requireEnabled ? 3 : 2;

        function mutate() {
          if (reads !== requiredReads) return;
          if (queueOptions.requireEnabled
            && (!installationValue || !installationValue.enabled || installationValue.cleanupPending)) return;
          if (queueOptions.replaceAll) {
            entries.forEach(function(queued) { queueStore.delete(queued.id); });
            entries = [];
          }
          if (queueOptions.logicalKey && !queueOptions.replaceAll) {
            entry = entries.find(function(queued) { return queued.logicalKey === queueOptions.logicalKey; });
          }
          if (entry && Number.isSafeInteger(queueOptions.version)
            && Number.isSafeInteger(entry.version) && entry.version > queueOptions.version) return;
          if (entry) {
            entry.kind = kind;
            entry.method = method;
            entry.path = path;
            entry.body = body || null;
            entry.version = queueOptions.version;
            entry.attempts = 0;
            entry.nextRetryAt = now();
            entry.terminal = false;
            queueStore.put(entry, entry.id);
            return;
          }
          if (entries.length >= MAX_QUEUE_SIZE) {
            limitError = new Error('Notification queue limit reached');
            limitError.name = 'QueueLimitError';
            return;
          }
          var sequence = Number.isSafeInteger(sequenceValue) ? sequenceValue + 1 : 1;
          entry = {
            id: 'notification-' + sequence + '-' + randomUUID(),
            sequence: sequence,
            logicalKey: queueOptions.logicalKey || null,
            version: queueOptions.version,
            kind: kind,
            method: method,
            path: path,
            body: body || null,
            attempts: 0,
            nextRetryAt: now(),
            terminal: false
          };
          metaStore.put(sequence, 'queue-sequence');
          queueStore.put(entry, entry.id);
        }

        try {
          transaction = database.transaction(
            queueOptions.requireEnabled ? ['meta', 'queue', 'installation'] : ['meta', 'queue'],
            'readwrite'
          );
          queueStore = transaction.objectStore('queue');
          metaStore = transaction.objectStore('meta');
          var queueRequest = queueStore.getAll();
          var sequenceRequest = metaStore.get('queue-sequence');
          queueRequest.onsuccess = function() {
            entries = queueRequest.result || [];
            reads += 1;
            mutate();
          };
          sequenceRequest.onsuccess = function() {
            sequenceValue = sequenceRequest.result;
            reads += 1;
            mutate();
          };
          if (queueOptions.requireEnabled) {
            var installationRequest = transaction.objectStore('installation').get(INSTALLATION_KEY);
            installationRequest.onsuccess = function() {
              installationValue = installationRequest.result;
              reads += 1;
              mutate();
            };
          }
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = function() {
          if (limitError) reject(limitError);
          else resolve(entry);
        };
        transaction.onerror = transaction.onabort = function() {
          reject(transaction.error || new Error('IndexedDB queue write failed'));
        };
      });
    }

    async function getQueue() {
      var entries = await readAllRecords(await getDatabase(), 'queue');
      return entries.sort(function(left, right) {
        return (left.sequence || 0) - (right.sequence || 0);
      });
    }

    async function acquireDrainLease() {
      var database = await getDatabase();
      return runTransaction(database, 'meta', 'readwrite', function(transaction, finish) {
        var store = transaction.objectStore('meta');
        afterReads([store.get('drain-lease'), store.get('drain-fence')], function(values) {
          var current = values[0];
          if (current && current.ownerId !== ownerId && current.expiresAt > now()) return;
          var fence = Number.isSafeInteger(values[1]) ? values[1] + 1 : 1;
          var lease = { ownerId: ownerId, fence: fence, expiresAt: now() + DRAIN_LEASE_MS };
          store.put(fence, 'drain-fence');
          store.put(lease, 'drain-lease');
          finish(lease);
        });
      }, 'IndexedDB drain lease failed');
    }

    async function validateDrainLease(lease, lifecycle, allowCleanup, renew) {
      var database = await getDatabase();
      return runTransaction(database, ['meta', 'installation'], renew ? 'readwrite' : 'readonly',
        function(transaction, finish) {
          var store = transaction.objectStore('meta');
          afterReads([
            store.get('drain-lease'),
            store.get('lifecycle'),
            transaction.objectStore('installation').get(INSTALLATION_KEY)
          ], function(values) {
            var current = values[0];
            var currentLifecycle = values[1];
            var installation = values[2];
            var valid = !!current && current.ownerId === lease.ownerId && current.fence === lease.fence
              && current.expiresAt > now() && !!currentLifecycle
              && currentLifecycle.ownerId === lifecycle.ownerId && currentLifecycle.epoch === lifecycle.epoch
              && (allowCleanup || !installation || !installation.cleanupPending);
            if (valid && renew) {
              lease.expiresAt = now() + DRAIN_LEASE_MS;
              store.put({ ownerId: lease.ownerId, fence: lease.fence, expiresAt: lease.expiresAt }, 'drain-lease');
            }
            finish(valid);
          });
        }, 'IndexedDB drain lease validation failed');
    }

    async function releaseDrainLease(lease) {
      var database = await getDatabase();
      return runTransaction(database, 'meta', 'readwrite', function(transaction) {
        var store = transaction.objectStore('meta');
        var request = store.get('drain-lease');
        request.onsuccess = function() {
          if (request.result && request.result.ownerId === lease.ownerId
            && request.result.fence === lease.fence) store.delete('drain-lease');
        };
      }, 'IndexedDB drain lease release failed');
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
      if (installation && installation.cleanupPending) {
        installation.deviceToken = undefined;
        installation.cleanupDeviceId = installation.cleanupDeviceId || installation.deviceId;
        installation.cleanupAuthRejected = true;
        installation.authenticationReset = true;
        await saveInstallation(installation);
        state = 'error';
        return;
      }
      await saveInstallation({
        enabled: !!installation.enabled,
        authenticationReset: true
      });
      state = 'error';
    }

    async function unsubscribeBrowser() {
      if (!registration || !registration.pushManager || typeof registration.pushManager.getSubscription !== 'function') return true;
      var current = await registration.pushManager.getSubscription();
      if (!current || typeof current.unsubscribe !== 'function') return true;
      return await current.unsubscribe() !== false;
    }

    async function completeDisable(installation) {
      installation.cleanupServerDone = true;
      try {
        if (!await unsubscribeBrowser()) {
          await saveInstallation(installation);
          state = 'pending';
          return false;
        }
      } catch (error) {
        await saveInstallation(installation);
        state = 'pending';
        return false;
      }
      installation.enabled = false;
      installation.authenticationReset = false;
      installation.cleanupPending = false;
      installation.cleanupServerDone = false;
      installation.cleanupAuthRejected = false;
      installation.subscriptionEndpoint = '';
      await saveInstallation(installation);
      state = 'disabled';
      return true;
    }

    async function flushQueue(forceRetry, lifecycle) {
      lifecycle = lifecycle || await beginLifecycle('drain');
      if (lifecycle.blocked) {
        return toPublicStatus(lifecycle.installation.cleanupAuthRejected ? 'error' : 'pending', lifecycle.installation);
      }
      var installation = await getInstallation();
      var entries = await getQueue();
      if (!entries.length) {
        if (installation && installation.cleanupPending) {
          if (installation.cleanupAuthRejected) return toPublicStatus('error');
          if (installation.cleanupServerDone && await completeDisable(installation)) return toPublicStatus('disabled');
          return toPublicStatus('pending', installation);
        }
        return toPublicStatus(installation && installation.enabled ? 'ready' : 'disabled', installation);
      }
      var drainLease = await acquireDrainLease();
      if (!drainLease) {
        var blockedStatus = entries.some(function(entry) { return entry.terminal; }) ? 'error' : 'pending';
        state = blockedStatus;
        return toPublicStatus(blockedStatus, installation);
      }
      try {
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
          if (entry.terminal) {
            state = 'error';
            return toPublicStatus('error');
          }
          if (!forceRetry && entry.nextRetryAt > now()) continue;
          var allowCleanup = entry.kind === 'disable';
          if (!await validateDrainLease(drainLease, lifecycle, allowCleanup, true)) return getStatus();
          var response;
          try {
            var write = await lifecycleRequest(lifecycle, allowCleanup, function() {
              return request(entry.method, entry.path, entry.body, installation, true);
            });
            if (write.fenced) return getStatus();
            response = write.response;
          } catch (error) {
            response = null;
          }
          if (!await validateDrainLease(drainLease, lifecycle, allowCleanup, false)) return getStatus();
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
          entry.terminal = entry.attempts >= MAX_RETRY_ATTEMPTS;
          entry.nextRetryAt = entry.terminal
            ? null
            : now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, entry.attempts - 1));
          await writeRecord(await getDatabase(), 'queue', entry.id, entry);
          state = entry.terminal ? 'error' : 'pending';
          break;
        }

        entries = await getQueue();
        if (entries.length) {
          if (entries.some(function(queued) { return queued.terminal; })) {
            state = 'error';
            return toPublicStatus('error');
          }
          state = 'pending';
          return toPublicStatus('pending', installation);
        }
        if (installation.cleanupPending) {
          state = installation.cleanupAuthRejected ? 'error' : 'pending';
          return toPublicStatus(state, installation);
        }
        state = installation.enabled ? 'ready' : 'disabled';
        return toPublicStatus(state, installation);
      } finally {
        await releaseDrainLease(drainLease);
      }
    }

    function permissionStatus() {
      if (!notificationApi || typeof notificationApi.permission !== 'string') return 'granted';
      return notificationApi.permission;
    }

    function subscriptionJson(subscription) {
      return subscription && typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    }

    async function setupImpl(nextRegistration) {
      if (nextRegistration) registration = nextRegistration;
      await beginLifecycle('setup');
      return getStatus();
    }

    async function getStatus() {
      var installation = await getInstallation();
      if (installation && installation.cleanupPending) {
        return toPublicStatus(installation.cleanupAuthRejected ? 'error' : 'pending', installation);
      }
      if (installation && installation.authenticationReset) return toPublicStatus('error');
      var entries = await getQueue();
      if (entries.some(function(entry) { return entry.terminal; })) return toPublicStatus('error');
      if (entries.length) return toPublicStatus('pending', installation);
      if (!installation || !installation.enabled) return toPublicStatus('disabled');
      if (!registration || !registration.pushManager) return toPublicStatus('unsupported');
      if (permissionStatus() !== 'granted') return toPublicStatus('permission-required');
      return toPublicStatus(state === 'syncing' || state === 'subscribing' ? state : 'ready', installation);
    }

    async function enableImpl() {
      var pendingInstallation = await getInstallation();
      if (pendingInstallation && pendingInstallation.cleanupPending) {
        return toPublicStatus(pendingInstallation.cleanupAuthRejected ? 'error' : 'pending', pendingInstallation);
      }
      var lifecycle = await beginLifecycle('enable');
      if (lifecycle.blocked) return toPublicStatus('pending', lifecycle.installation);
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
          var registrationWrite = await lifecycleRequest(lifecycle, false, function() {
            return request('POST', '/api/notifications/devices', {
              platform: 'web',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            }, null, false);
          });
          if (registrationWrite.fenced) return getStatus();
          var registrationResponse = registrationWrite.response;
          if (!registrationResponse.ok) throw new Error('Device registration failed');
          var credentials = await registrationResponse.json();
          installation = { deviceId: credentials.deviceId, deviceToken: credentials.deviceToken, enabled: true, authenticationReset: false };
          if (!await saveInstallationIfCurrent(lifecycle, installation, false)) return getStatus();
        } catch (error) {
          state = 'pending';
          return toPublicStatus('pending', installation);
        }
      } else {
        installation.enabled = true;
        if (!await saveInstallationIfCurrent(lifecycle, installation, false)) return getStatus();
      }

      var subscription;
      try {
        subscription = await registration.pushManager.getSubscription();
        if (subscription && Number.isFinite(subscription.expirationTime) && subscription.expirationTime <= now()) {
          await subscription.unsubscribe();
          subscription = null;
        }
        if (!subscription) {
          var applicationServerKey = notificationCrypto.base64UrlDecode(config.vapidPublicKey);
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
          });
        }
      } catch (error) {
        state = 'error';
        return toPublicStatus('error');
      }
      var subscriptionValue = subscriptionJson(subscription);
      try {
        var subscriptionWrite = await lifecycleRequest(lifecycle, false, function() {
          return request(
            'PUT',
            '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
            subscriptionValue,
            installation,
            true
          );
        });
        if (subscriptionWrite.fenced) return getStatus();
        var subscriptionResponse = subscriptionWrite.response;
        if (subscriptionResponse.status === 401 || subscriptionResponse.status === 403) {
          await resetAuthentication(installation);
          return toPublicStatus('error');
        }
        if (!subscriptionResponse.ok) throw new Error('Subscription update failed');
        var subscriptionLogicalKey = 'subscription:' + installation.deviceId;
        if (!await commitSubscriptionSuccess(
          lifecycle, installation, subscriptionLogicalKey, subscriptionValue.endpoint || ''
        )) return getStatus();
      } catch (error) {
        await queueOperation(
          'subscription',
          'PUT',
          '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
          subscriptionValue,
          { logicalKey: 'subscription:' + installation.deviceId, requireEnabled: true }
        );
        state = 'pending';
        return toPublicStatus('pending', installation);
      }
      state = 'syncing';
      return flushQueue(true, lifecycle);
    }

    async function syncImpl(data, todayKey) {
      var lifecycle = await beginLifecycle('sync');
      if (lifecycle.blocked) return getStatus();
      var installation = await getInstallation();
      if (!installation || !installation.enabled || !installation.deviceToken) return getStatus();
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
          summaries.push({ id: reminder.id, revision: reminder.revision });
          if (reminder.cancelled) {
            await queueOperation('cancel', 'DELETE', '/api/notifications/reminders/' + encodeURIComponent(reminder.id),
              { revision: reminder.revision }, {
                logicalKey: 'reminder:' + reminder.id, version: reminder.revision, requireEnabled: true
              });
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
          }, { logicalKey: 'reminder:' + reminder.id, version: reminder.revision, requireEnabled: true });
        }
        await queueOperation('reconcile', 'POST', '/api/notifications/reconcile', { reminders: summaries },
          { logicalKey: 'reconcile', version: reconcileVersion, requireEnabled: true });
        return flushQueue(false, lifecycle);
      } catch (error) {
        state = 'error';
        return toPublicStatus('error');
      }
    }

    async function sendTestImpl(value) {
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

    async function disableImpl() {
      var lifecycle = await beginLifecycle('disable');
      var installation = lifecycle.installation || await getInstallation();
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
          installation = installation || { enabled: true };
          installation.cleanupPending = true;
          await saveInstallation(installation);
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
      installation.cleanupPending = true;
      installation.cleanupDeviceId = installation.deviceId;
      installation.cleanupServerDone = false;
      installation.cleanupAuthRejected = false;
      await saveInstallation(installation);
      await queueOperation(
        'disable',
        'DELETE',
        '/api/notifications/devices/' + encodeURIComponent(installation.deviceId) + '/subscription',
        null,
        { logicalKey: 'disable', replaceAll: true }
      );
      state = 'pending';
      return flushQueue(false, lifecycle);
    }

    async function handleOnlineImpl() {
      var installation = await getInstallation();
      if (installation && installation.authenticationReset && !installation.cleanupPending) return getStatus();
      return flushQueue(true);
    }

    async function handleForegroundImpl() {
      return handleOnlineImpl();
    }

    return {
      setup: function() { return serialize(setupImpl, arguments); },
      getStatus: getStatus,
      enable: function() { return serialize(enableImpl, arguments); },
      disable: function() { return serialize(disableImpl, arguments); },
      sync: function() { return serialize(syncImpl, arguments); },
      sendTest: function() { return serialize(sendTestImpl, arguments); },
      handleOnline: function() { return serialize(handleOnlineImpl, arguments); },
      handleForeground: function() { return serialize(handleForegroundImpl, arguments); }
    };
  }

  return { create: create };
});
