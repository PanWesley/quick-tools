(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    var nodeCrypto = require('crypto').webcrypto;
    var nodeUtil = require('util');
    module.exports = factory(root, nodeCrypto, nodeUtil.TextEncoder, nodeUtil.TextDecoder);
  } else {
    root.TodayYouxuNotificationCrypto = factory(root, root.crypto, root.TextEncoder, root.TextDecoder);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function(root, defaultCrypto, TextEncoderApi, TextDecoderApi) {
  var DB_NAME = 'todayYouxuNotificationDB';
  var DB_VERSION = 1;
  var KEY_STORE = 'secrets';
  var LEGACY_KEY_ID = 'payload-key-v1';
  var CURRENT_KEY_ID = 'payload-key-v2';
  var CURRENT_ENCRYPTION_VERSION = 2;
  var STORE_NAMES = ['secrets', 'installation', 'queue', 'meta'];
  var IV_BYTES = 12;
  var KEY_BYTES = 32;

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Expected byte data');
  }

  function base64UrlEncode(value) {
    var bytes = toBytes(value);
    var base64;
    if (root && typeof root.btoa === 'function') {
      var binary = '';
      for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      base64 = root.btoa(binary);
    } else if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(bytes).toString('base64');
    } else {
      throw new Error('Base64 encoding is not available');
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
      throw new Error('Invalid base64url value');
    }
    var padded = value.replace(/-/g, '+').replace(/_/g, '/');
    if (padded.length % 4 === 1) throw new Error('Invalid base64url value');
    while (padded.length % 4) padded += '=';
    var bytes;
    if (root && typeof root.atob === 'function') {
      var binary = root.atob(padded);
      bytes = new Uint8Array(binary.length);
      for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(padded, 'base64'));
    } else {
      throw new Error('Base64 decoding is not available');
    }
    if (base64UrlEncode(bytes) !== value) throw new Error('Invalid base64url value');
    return bytes;
  }

  function validateEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.getPrototypeOf(envelope) !== Object.prototype
      || !Object.prototype.hasOwnProperty.call(envelope, 'v')
      || !Object.prototype.hasOwnProperty.call(envelope, 'iv')
      || !Object.prototype.hasOwnProperty.call(envelope, 'ciphertext')
      || Object.keys(envelope).sort().join(',') !== 'ciphertext,iv,v'
      || (envelope.v !== 1 && envelope.v !== 2)
      || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string') {
      throw new Error('Unsupported notification payload version');
    }
    var iv = base64UrlDecode(envelope.iv);
    var ciphertext = base64UrlDecode(envelope.ciphertext);
    if (iv.length !== IV_BYTES || ciphertext.length < 16) {
      throw new Error('Invalid notification payload');
    }
    return { version: envelope.v, iv: iv, ciphertext: ciphertext };
  }

  function validateCurrentKeyRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).sort().join(',') !== 'algorithm,rawKey,version'
      || value.version !== CURRENT_ENCRYPTION_VERSION
      || value.algorithm !== 'AES-GCM'
      || typeof value.rawKey !== 'string') {
      throw new Error('Notification key record is invalid');
    }
    var bytes;
    try {
      bytes = base64UrlDecode(value.rawKey);
    } catch (error) {
      throw new Error('Notification key record is invalid');
    }
    if (bytes.length !== KEY_BYTES) throw new Error('Notification key record is invalid');
    return bytes;
  }

  function importAesKey(cryptoApi, bytes) {
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.importKey !== 'function') {
      return Promise.reject(new Error('Web Crypto is not available'));
    }
    return cryptoApi.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

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

  function addRecord(database, storeName, key, value) {
    return new Promise(function(resolve, reject) {
      var transaction;
      var request;
      var constraintError = false;
      try {
        transaction = database.transaction(storeName, 'readwrite');
        request = transaction.objectStore(storeName).add(value, key);
      } catch (error) {
        reject(error);
        return;
      }
      request.onerror = function(event) {
        if (request.error && request.error.name === 'ConstraintError') {
          constraintError = true;
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        }
      };
      transaction.oncomplete = function() { resolve(!constraintError); };
      transaction.onerror = transaction.onabort = function() {
        if (constraintError) resolve(false);
        else reject(transaction.error || request.error || new Error('IndexedDB write failed'));
      };
    });
  }

  function create(options) {
    options = options || {};
    var cryptoApi = options.crypto || defaultCrypto;
    var indexedDBApi = options.indexedDB || root && root.indexedDB;
    var databasePromise;
    var currentKeyPromise;

    function getDatabase() {
      if (!databasePromise) databasePromise = openDatabase(indexedDBApi);
      return databasePromise;
    }

    async function getKey(version) {
      var database = await getDatabase();
      var selectedVersion = version === undefined ? CURRENT_ENCRYPTION_VERSION : version;
      if (selectedVersion === 1) return await readRecord(database, KEY_STORE, LEGACY_KEY_ID) || null;
      if (selectedVersion !== CURRENT_ENCRYPTION_VERSION) return null;
      var record = await readRecord(database, KEY_STORE, CURRENT_KEY_ID);
      return record ? importAesKey(cryptoApi, validateCurrentKeyRecord(record)) : null;
    }

    async function getOrCreateKey() {
      if (currentKeyPromise) return currentKeyPromise;
      if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function'
        || !cryptoApi.subtle || typeof cryptoApi.subtle.importKey !== 'function') {
        throw new Error('Web Crypto is not available');
      }
      currentKeyPromise = (async function() {
        var database = await getDatabase();
        var record = await readRecord(database, KEY_STORE, CURRENT_KEY_ID);
        if (!record) {
          var bytes = cryptoApi.getRandomValues(new Uint8Array(KEY_BYTES));
          var candidate = {
            version: CURRENT_ENCRYPTION_VERSION,
            algorithm: 'AES-GCM',
            rawKey: base64UrlEncode(bytes)
          };
          if (await addRecord(database, KEY_STORE, CURRENT_KEY_ID, candidate)) {
            record = candidate;
          } else {
            record = await readRecord(database, KEY_STORE, CURRENT_KEY_ID);
          }
        }
        if (!record) throw new Error('IndexedDB key winner is unavailable');
        return importAesKey(cryptoApi, validateCurrentKeyRecord(record));
      })().catch(function(error) {
        currentKeyPromise = null;
        throw error;
      });
      return currentKeyPromise;
    }

    return { getKey: getKey, getOrCreateKey: getOrCreateKey };
  }

  async function encryptPayload(key, value, version) {
    if (!defaultCrypto || !defaultCrypto.subtle || !defaultCrypto.getRandomValues) {
      throw new Error('Web Crypto is not available');
    }
    var selectedVersion = version === undefined ? CURRENT_ENCRYPTION_VERSION : version;
    if (selectedVersion !== 1 && selectedVersion !== CURRENT_ENCRYPTION_VERSION) {
      throw new Error('Unsupported notification payload version');
    }
    var iv = defaultCrypto.getRandomValues(new Uint8Array(IV_BYTES));
    var plainText = new TextEncoderApi().encode(JSON.stringify(value));
    var ciphertext = await defaultCrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainText);
    return { v: selectedVersion, iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(ciphertext) };
  }

  async function decryptPayload(key, envelope) {
    if (!defaultCrypto || !defaultCrypto.subtle) throw new Error('Web Crypto is not available');
    var decoded = validateEnvelope(envelope);
    var plainText = await defaultCrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decoded.iv },
      key,
      decoded.ciphertext
    );
    try {
      return JSON.parse(new TextDecoderApi().decode(plainText));
    } catch (error) {
      throw new Error('Notification payload is invalid');
    }
  }

  var defaultStore = create();

  return {
    CURRENT_ENCRYPTION_VERSION: CURRENT_ENCRYPTION_VERSION,
    getKey: defaultStore.getKey,
    getOrCreateKey: defaultStore.getOrCreateKey,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload,
    base64UrlEncode: base64UrlEncode,
    base64UrlDecode: base64UrlDecode,
    create: create
  };
});
