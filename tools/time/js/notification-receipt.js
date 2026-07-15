(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    var nodeCrypto = require('crypto').webcrypto;
    var nodeUtil = require('util');
    module.exports = factory(root, nodeCrypto, nodeUtil.TextEncoder, typeof Response === 'function' ? Response : null);
  } else {
    root.TodayYouxuNotificationReceipt = factory(root, root.crypto, root.TextEncoder, root.Response);
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function(root, defaultCrypto, TextEncoderApi, ResponseApi) {
  var CACHE_NAME = 'today-youxu-notification-receipts-v1';
  var RECEIPT_PATH = '/tools/time/__notification_receipt__/';
  var FAILURE_PATH = RECEIPT_PATH + 'failure';
  var TTL_MS = 48 * 60 * 60 * 1000;
  var FAILURE_CODES = Object.freeze([
    'missing_data',
    'missing_key',
    'invalid_envelope',
    'decrypt_failed',
    'invalid_payload'
  ]);

  function hasExactKeys(value, keys) {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
  }

  function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isReceipt(value) {
    return hasExactKeys(value, ['shownAt', 'scheduledAt'])
      && isTimestamp(value.shownAt)
      && isTimestamp(value.scheduledAt);
  }

  function isFailure(value) {
    return hasExactKeys(value, ['code', 'at'])
      && FAILURE_CODES.indexOf(value.code) !== -1
      && isTimestamp(value.at);
  }

  function toHex(value) {
    return Array.from(new Uint8Array(value), function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function create(options) {
    options = options || {};
    var cachesApi = Object.prototype.hasOwnProperty.call(options, 'caches') ? options.caches : root && root.caches;
    var cryptoApi = Object.prototype.hasOwnProperty.call(options, 'crypto') ? options.crypto : defaultCrypto;
    var Encoder = options.TextEncoder || TextEncoderApi;
    var ResponseConstructor = options.Response || ResponseApi;
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var origin = options.origin || (root && root.location && root.location.origin) || 'https://billnest.top';

    function cacheUrl(path) {
      return new URL(path, origin).toString();
    }

    function openCache() {
      if (!cachesApi || typeof cachesApi.open !== 'function') return Promise.reject(new Error('Cache API is unavailable'));
      return cachesApi.open(CACHE_NAME);
    }

    async function receiptUrl(tag) {
      if (typeof tag !== 'string' || !tag || !cryptoApi || !cryptoApi.subtle || !Encoder) {
        throw new Error('Receipt hashing is unavailable');
      }
      var digest = await cryptoApi.subtle.digest('SHA-256', new Encoder().encode(tag));
      return cacheUrl(RECEIPT_PATH + toHex(digest));
    }

    function makeResponse(value) {
      if (typeof ResponseConstructor !== 'function') throw new Error('Response is unavailable');
      return new ResponseConstructor(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    function isExpired(timestamp) {
      return now() - timestamp > TTL_MS;
    }

    async function read(cache, url, validator) {
      var response = await cache.match(url);
      if (!response) return null;
      var value;
      try {
        value = await response.json();
      } catch (error) {
        await cache.delete(url);
        return null;
      }
      if (!validator(value) || isExpired(value.shownAt === undefined ? value.at : value.shownAt)) {
        await cache.delete(url);
        return null;
      }
      return value;
    }

    return {
      async has(tag) {
        try {
          var cache = await openCache();
          return Boolean(await read(cache, await receiptUrl(tag), isReceipt));
        } catch (error) {
          return false;
        }
      },

      async record(tag, scheduledAt) {
        if (!isTimestamp(scheduledAt)) return false;
        try {
          var cache = await openCache();
          await cache.put(await receiptUrl(tag), makeResponse({ shownAt: now(), scheduledAt: scheduledAt }));
          return true;
        } catch (error) {
          return false;
        }
      },

      async clearExpired() {
        try {
          var cache = await openCache();
          var keys = await cache.keys();
          var failureUrl = cacheUrl(FAILURE_PATH);
          await Promise.all(keys.map(async function(request) {
            var url = typeof request === 'string' ? request : request.url;
            if (url === failureUrl) {
              await read(cache, url, isFailure);
            } else if (url.indexOf(cacheUrl(RECEIPT_PATH)) === 0) {
              await read(cache, url, isReceipt);
            }
          }));
          return true;
        } catch (error) {
          return false;
        }
      },

      async recordFailure(code) {
        if (FAILURE_CODES.indexOf(code) === -1) return false;
        try {
          var cache = await openCache();
          await cache.put(cacheUrl(FAILURE_PATH), makeResponse({ code: code, at: now() }));
          return true;
        } catch (error) {
          return false;
        }
      },

      async getFailure() {
        try {
          return await read(await openCache(), cacheUrl(FAILURE_PATH), isFailure);
        } catch (error) {
          return null;
        }
      },

      async clearFailure() {
        try {
          var cache = await openCache();
          await cache.delete(cacheUrl(FAILURE_PATH));
          return true;
        } catch (error) {
          return false;
        }
      }
    };
  }

  return {
    CACHE_NAME: CACHE_NAME,
    FAILURE_CODES: FAILURE_CODES,
    create: create
  };
});
