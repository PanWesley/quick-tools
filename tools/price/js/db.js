(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaDB = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var DB_NAME = 'zhenjiaAssistantDB';
  var DB_VERSION = 2;
  var STORE_NAMES = ['products', 'priceSnapshots', 'watches', 'opLogs'];

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function entityTypeForStore(storeName) {
    if (storeName === 'priceSnapshots') return 'priceSnapshot';
    if (storeName === 'products') return 'product';
    if (storeName === 'watches') return 'watch';
    if (storeName === 'opLogs') return 'opLog';
    return String(storeName || '').replace(/s$/, '');
  }

  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, options || { unique: false });
    }
  }

  function normalizeIdentityPart(value) {
    return String(value || '').trim();
  }

  function buildProductIdentity(input) {
    var product = input || {};
    var platform = normalizeIdentityPart(product.platform || 'unknown').toLowerCase();
    var itemId = normalizeIdentityPart(product.itemId);
    var variantKey = normalizeIdentityPart(product.skuId) ||
      normalizeIdentityPart(product.canonicalUrl) ||
      normalizeIdentityPart(product.rawUrl);

    if (!itemId && !variantKey) return '';
    return [platform, itemId, variantKey].join('|');
  }

  function withProductIdentity(product) {
    var identity = buildProductIdentity(product);
    if (identity) {
      product.productIdentity = identity;
    } else {
      delete product.productIdentity;
    }
    return product;
  }

  function assertStoreName(storeName) {
    if (STORE_NAMES.indexOf(storeName) === -1) {
      throw new Error('Unknown store: ' + storeName);
    }
  }

  function openDatabase() {
    return new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available.'));
        return;
      }

      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        var products;
        var snapshots;
        var watches;
        var opLogs;

        if (!db.objectStoreNames.contains('products')) {
          products = db.createObjectStore('products', { keyPath: 'id' });
        } else {
          products = event.target.transaction.objectStore('products');
        }
        ensureIndex(products, 'platformItem', ['platform', 'itemId'], { unique: false });
        ensureIndex(products, 'productIdentity', 'productIdentity', { unique: true });
        ensureIndex(products, 'source', 'source', { unique: false });
        if (!db.objectStoreNames.contains('priceSnapshots')) {
          snapshots = db.createObjectStore('priceSnapshots', { keyPath: 'id' });
        } else {
          snapshots = event.target.transaction.objectStore('priceSnapshots');
        }
        ensureIndex(snapshots, 'productId', 'productId', { unique: false });
        ensureIndex(snapshots, 'capturedAt', 'capturedAt', { unique: false });
        if (!db.objectStoreNames.contains('watches')) {
          watches = db.createObjectStore('watches', { keyPath: 'id' });
        } else {
          watches = event.target.transaction.objectStore('watches');
        }
        ensureIndex(watches, 'productId', 'productId', { unique: false });
        ensureIndex(watches, 'enabled', 'enabled', { unique: false });
        if (!db.objectStoreNames.contains('opLogs')) {
          opLogs = db.createObjectStore('opLogs', { keyPath: 'id' });
        } else {
          opLogs = event.target.transaction.objectStore('opLogs');
        }
        ensureIndex(opLogs, 'entityType', 'entityType', { unique: false });
        ensureIndex(opLogs, 'syncState', 'syncState', { unique: false });
      };
      request.onsuccess = function(event) {
        resolve(event.target.result);
      };
      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function requestToPromise(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };
      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function transactionDone(transaction) {
    return new Promise(function(resolve, reject) {
      transaction.oncomplete = function() {
        resolve();
      };
      transaction.onerror = function() {
        reject(transaction.error);
      };
      transaction.onabort = function() {
        reject(transaction.error);
      };
    });
  }

  function closeDatabase(db) {
    if (db && typeof db.close === 'function') db.close();
  }

  function getAll(storeName) {
    assertStoreName(storeName);
    return openDatabase().then(function(db) {
      var transaction = db.transaction(storeName, 'readonly');
      var request = transaction.objectStore(storeName).getAll();
      return requestToPromise(request).then(function(records) {
        closeDatabase(db);
        return records;
      }, function(error) {
        closeDatabase(db);
        throw error;
      });
    });
  }

  function getAllData() {
    return Promise.all(STORE_NAMES.map(function(storeName) {
      return getAll(storeName);
    })).then(function(results) {
      return {
        products: results[0],
        priceSnapshots: results[1],
        watches: results[2],
        opLogs: results[3]
      };
    });
  }

  function writeWithOp(storeName, entity, action, payload) {
    assertStoreName(storeName);
    return openDatabase().then(function(db) {
      var transaction = db.transaction([storeName, 'opLogs'], 'readwrite');
      var opLog = {
        id: createId('op'),
        entityType: entityTypeForStore(storeName),
        entityId: entity.id,
        action: action,
        payload: payload || entity,
        clientTs: nowIso(),
        syncState: 'local'
      };

      transaction.objectStore(storeName).put(entity);
      transaction.objectStore('opLogs').put(opLog);

      return transactionDone(transaction).then(function() {
        closeDatabase(db);
        return entity;
      }, function(error) {
        closeDatabase(db);
        throw error;
      });
    });
  }

  function findExistingProduct(productIdentity) {
    if (!productIdentity) return Promise.resolve(null);

    return openDatabase().then(function(db) {
      var transaction = db.transaction('products', 'readonly');
      var store = transaction.objectStore('products');

      return requestToPromise(store.getAll()).then(function(products) {
        closeDatabase(db);
        return products.find(function(product) {
          return product.productIdentity === productIdentity ||
            buildProductIdentity(product) === productIdentity;
        }) || null;
      }, function(error) {
        closeDatabase(db);
        throw error;
      });
    });
  }

  function upsertProduct(input) {
    var timestamp = nowIso();
    var defaults = {
      platform: 'unknown',
      itemId: '',
      skuId: '',
      shopId: '',
      title: '',
      shopName: '',
      imageUrl: '',
      rawUrl: '',
      canonicalUrl: '',
      source: '',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    var incoming = withProductIdentity(Object.assign({}, defaults, input || {}, {
      updatedAt: timestamp
    }));

    if (incoming.id) {
      return writeWithOp('products', incoming, 'upsert');
    }

    return findExistingProduct(incoming.productIdentity).then(function(existing) {
      var product = withProductIdentity(Object.assign({}, existing || {}, incoming, {
        id: existing && existing.id ? existing.id : createId('product'),
        createdAt: existing && existing.createdAt ? existing.createdAt : incoming.createdAt,
        updatedAt: timestamp
      }));
      return writeWithOp('products', product, existing ? 'update' : 'create');
    });
  }

  function addPriceSnapshot(input) {
    var timestamp = nowIso();
    var snapshot = Object.assign({
      id: createId('snap'),
      productId: '',
      capturedAt: timestamp,
      finalPrice: 0,
      listPrice: 0,
      promoPrice: 0,
      couponPrice: 0,
      promotionInfo: '',
      couponInfo: '',
      stockStatus: 'unknown',
      source: 'manual',
      createdAt: timestamp
    }, input || {});
    return writeWithOp('priceSnapshots', snapshot, 'create');
  }

  function upsertWatch(input) {
    var timestamp = nowIso();
    var watch = Object.assign({
      id: createId('watch'),
      productId: '',
      targetPrice: 0,
      watchType: 'target_price',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }, input || {}, {
      updatedAt: timestamp
    });
    return writeWithOp('watches', watch, 'upsert');
  }

  function deleteOne(storeName, id) {
    assertStoreName(storeName);
    return openDatabase().then(function(db) {
      var transaction = db.transaction([storeName, 'opLogs'], 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.objectStore('opLogs').put({
        id: createId('op'),
        entityType: entityTypeForStore(storeName),
        entityId: id,
        action: 'delete',
        payload: { id: id },
        clientTs: nowIso(),
        syncState: 'local'
      });

      return transactionDone(transaction).then(function() {
        closeDatabase(db);
      }, function(error) {
        closeDatabase(db);
        throw error;
      });
    });
  }

  function clearAll() {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(STORE_NAMES, 'readwrite');
      STORE_NAMES.forEach(function(storeName) {
        transaction.objectStore(storeName).clear();
      });
      return transactionDone(transaction).then(function() {
        closeDatabase(db);
      }, function(error) {
        closeDatabase(db);
        throw error;
      });
    });
  }

  return {
    getAll: getAll,
    getAllData: getAllData,
    upsertProduct: upsertProduct,
    addPriceSnapshot: addPriceSnapshot,
    upsertWatch: upsertWatch,
    deleteOne: deleteOne,
    clearAll: clearAll
  };
});
