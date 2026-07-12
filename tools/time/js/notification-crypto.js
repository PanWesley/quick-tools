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
  var KEY_ID = 'payload-key-v1';
  var STORE_NAMES = ['secrets', 'installation', 'queue', 'meta'];
  var IV_BYTES = 12;

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
      || Object.keys(envelope).length !== 3
      || envelope.v !== 1
      || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string') {
      throw new Error('Unsupported notification payload version');
    }
    var iv = base64UrlDecode(envelope.iv);
    var ciphertext = base64UrlDecode(envelope.ciphertext);
    if (iv.length !== IV_BYTES || ciphertext.length < 16) {
      throw new Error('Invalid notification payload');
    }
    return { iv: iv, ciphertext: ciphertext };
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

    function getDatabase() {
      if (!databasePromise) databasePromise = openDatabase(indexedDBApi);
      return databasePromise;
    }

    async function getKey() {
      var database = await getDatabase();
      return await readRecord(database, KEY_STORE, KEY_ID) || null;
    }

    async function getOrCreateKey() {
      if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.generateKey !== 'function') {
        throw new Error('Web Crypto is not available');
      }
      var database = await getDatabase();
      var key = await readRecord(database, KEY_STORE, KEY_ID);
      if (key) return key;
      key = await cryptoApi.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      if (await addRecord(database, KEY_STORE, KEY_ID, key)) return key;
      var winner = await readRecord(database, KEY_STORE, KEY_ID);
      if (!winner) throw new Error('IndexedDB key winner is unavailable');
      return winner;
    }

    return { getKey: getKey, getOrCreateKey: getOrCreateKey };
  }

  async function encryptPayload(key, value) {
    if (!defaultCrypto || !defaultCrypto.subtle || !defaultCrypto.getRandomValues) {
      throw new Error('Web Crypto is not available');
    }
    var iv = defaultCrypto.getRandomValues(new Uint8Array(IV_BYTES));
    var plainText = new TextEncoderApi().encode(JSON.stringify(value));
    var ciphertext = await defaultCrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainText);
    return { v: 1, iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(ciphertext) };
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
    getKey: defaultStore.getKey,
    getOrCreateKey: defaultStore.getOrCreateKey,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload,
    base64UrlEncode: base64UrlEncode,
    base64UrlDecode: base64UrlDecode,
    create: create
  };
});
