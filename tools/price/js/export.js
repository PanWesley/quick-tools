(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaExport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var APP_ID = 'zhenjia-assistant';
  var VERSION = 1;
  var REQUIRED_ARRAYS = ['products', 'priceSnapshots', 'watches', 'opLogs'];

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function fail(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function buildExportPayload(data, exportedAt) {
    var stores = data || {};
    return {
      app: APP_ID,
      version: VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      products: cloneArray(stores.products),
      priceSnapshots: cloneArray(stores.priceSnapshots),
      watches: cloneArray(stores.watches),
      opLogs: cloneArray(stores.opLogs)
    };
  }

  function validateImportPayload(payload) {
    if (!payload || payload.app !== APP_ID) {
      return fail('invalid_app', '导入文件不是买前省省的数据。');
    }
    if (payload.version !== VERSION) {
      return fail('invalid_version', '导入文件版本不受支持。');
    }
    var hasRequiredArrays = REQUIRED_ARRAYS.every(function(key) {
      return Array.isArray(payload[key]);
    });
    if (!hasRequiredArrays) {
      return fail('invalid_shape', '导入文件缺少必要的数据数组。');
    }
    return { ok: true, data: payload };
  }

  return {
    APP_ID: APP_ID,
    VERSION: VERSION,
    buildExportPayload: buildExportPayload,
    validateImportPayload: validateImportPayload
  };
});
