(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuImport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var STORE_NAMES = ['tasks', 'habits', 'habitLogs', 'journals', 'opLogs'];

  function asList(value) {
    return Array.isArray(value) ? value : [];
  }

  function validateImportPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, reason: '导入文件不是有效的 JSON 对象' };
    }
    if (payload.app !== 'today-youxu') {
      return { valid: false, reason: '这不是今日有序导出的数据文件' };
    }
    if (payload.version !== 1) {
      return { valid: false, reason: '暂不支持该数据版本' };
    }
    return { valid: true, reason: '' };
  }

  function summarizeImportPayload(payload) {
    return STORE_NAMES.reduce(function(summary, storeName) {
      summary[storeName] = asList(payload && payload[storeName]).length;
      return summary;
    }, {});
  }

  function incomingIsNewer(localRecord, incomingRecord) {
    if (!incomingRecord.updatedAt) return false;
    if (!localRecord.updatedAt) return true;
    return String(incomingRecord.updatedAt) > String(localRecord.updatedAt);
  }

  function mergeRecords(localRecords, incomingRecords) {
    var stats = { inserted: 0, updated: 0, skipped: 0 };
    var byId = new Map();
    asList(localRecords).forEach(function(record) {
      if (record && record.id) byId.set(record.id, record);
    });

    asList(incomingRecords).forEach(function(record) {
      if (!record || !record.id) {
        stats.skipped += 1;
        return;
      }
      var local = byId.get(record.id);
      if (!local) {
        byId.set(record.id, record);
        stats.inserted += 1;
      } else if (incomingIsNewer(local, record)) {
        byId.set(record.id, record);
        stats.updated += 1;
      } else {
        stats.skipped += 1;
      }
    });

    return {
      records: Array.from(byId.values()),
      stats: stats
    };
  }

  function addStats(left, right) {
    left.inserted += right.inserted;
    left.updated += right.updated;
    left.skipped += right.skipped;
  }

  function buildImportResult(localData, incomingPayload) {
    var validation = validateImportPayload(incomingPayload);
    if (!validation.valid) {
      return {
        valid: false,
        reason: validation.reason,
        data: localData,
        stats: {
          stores: {},
          totals: { inserted: 0, updated: 0, skipped: 0 }
        }
      };
    }

    var data = {};
    var stores = {};
    var totals = { inserted: 0, updated: 0, skipped: 0 };
    STORE_NAMES.forEach(function(storeName) {
      var result = mergeRecords(asList(localData && localData[storeName]), asList(incomingPayload[storeName]));
      data[storeName] = result.records;
      stores[storeName] = result.stats;
      addStats(totals, result.stats);
    });

    return {
      valid: true,
      reason: '',
      data: data,
      stats: {
        stores: stores,
        totals: totals
      },
      summary: summarizeImportPayload(incomingPayload)
    };
  }

  return {
    validateImportPayload: validateImportPayload,
    summarizeImportPayload: summarizeImportPayload,
    mergeRecords: mergeRecords,
    buildImportResult: buildImportResult
  };
});
