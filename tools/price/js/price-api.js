(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaPriceApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var CLIENT_ID_KEY = 'price-anonymous-client-id';
  var SNAPSHOT_FIELDS = [
    'platform',
    'itemId',
    'finalPrice',
    'listPrice',
    'promoPrice',
    'couponPrice',
    'stockStatus',
    'title'
  ];

  function fallbackClientId(cryptoImpl) {
    if (cryptoImpl && typeof cryptoImpl.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      cryptoImpl.getRandomValues(bytes);
      return 'client-' + Array.from(bytes).map(function(byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    return 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  function create(options) {
    var config = options || {};
    var baseUrl = config.baseUrl || '/api/price';
    var fetchImpl = config.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    var storage = config.storage ||
      (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
    var cryptoImpl = config.cryptoImpl || (typeof crypto !== 'undefined' ? crypto : null);

    function getClientId() {
      var existing = storage && storage.getItem(CLIENT_ID_KEY);
      if (existing && existing.length >= 8) return existing;
      var created = cryptoImpl && typeof cryptoImpl.randomUUID === 'function'
        ? cryptoImpl.randomUUID()
        : fallbackClientId(cryptoImpl);
      if (storage) storage.setItem(CLIENT_ID_KEY, created);
      return created;
    }

    function requestJson(path, requestOptions) {
      if (!fetchImpl) {
        return Promise.resolve({
          ok: false,
          error: { code: 'fetch_unavailable', message: 'Network access is unavailable.', retryable: true }
        });
      }
      return fetchImpl(baseUrl + path, requestOptions).then(function(response) {
        return response.json().catch(function() { return {}; }).then(function(data) {
          if (response.ok) return { ok: true, data: data };
          return {
            ok: false,
            error: data.error || {
              code: 'request_failed',
              message: 'Request failed.',
              retryable: response.status >= 500
            }
          };
        });
      }).catch(function() {
        return {
          ok: false,
          error: { code: 'network_error', message: 'Network request failed.', retryable: true }
        };
      });
    }

    var api = {
      enabled: false,

      init: function() {
        return requestJson('/config', { method: 'GET' }).then(function(result) {
          api.enabled = result.ok;
          return result.ok;
        });
      },

      resolve: function(input) {
        if (!api.enabled) return Promise.resolve(null);
        return requestJson('/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: '', text: input })
        }).then(function(result) {
          return result.ok ? result.data : null;
        });
      },

      getHistory: function(platform, itemId) {
        if (!api.enabled || !platform || !itemId) return Promise.resolve([]);
        var query = '?platform=' + encodeURIComponent(platform) + '&item_id=' + encodeURIComponent(itemId);
        return requestJson('/history' + query, { method: 'GET' }).then(function(result) {
          return result.ok && Array.isArray(result.data.snapshots) ? result.data.snapshots : [];
        });
      },

      recordSnapshot: function(data) {
        if (!api.enabled) {
          return Promise.resolve({
            ok: false,
            error: { code: 'api_disabled', message: 'Shared history is unavailable.', retryable: true }
          });
        }
        var payload = {};
        SNAPSHOT_FIELDS.forEach(function(field) {
          if (Object.prototype.hasOwnProperty.call(data || {}, field)) {
            payload[field] = data[field];
          }
        });
        return requestJson('/snapshot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Price-Client-ID': getClientId()
          },
          body: JSON.stringify(payload)
        });
      }
    };

    return api;
  }

  return { create: create };
});
