(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseBackupFileHandles = api.createExpenseBackupFileHandles({
      indexedDB: root.indexedDB
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DB_NAME = 'ExpenseTrackerFileHandles';
  const DB_VERSION = 1;
  const STORE_NAME = 'handles';
  const AUTOMATIC_BACKUP_KEY = 'automatic-backup';

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(
        transaction.error || new Error('Transaction aborted')
      );
      transaction.onerror = () => reject(
        transaction.error || new Error('Transaction failed')
      );
    });
  }

  function createExpenseBackupFileHandles(deps = {}) {
    const indexedDB = deps.indexedDB;
    let databasePromise;

    function openDatabase() {
      if (!indexedDB || typeof indexedDB.open !== 'function') {
        return Promise.reject(new Error('IndexedDB is not available'));
      }
      if (databasePromise) return databasePromise;

      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          databasePromise = null;
          reject(request.error);
        };
      });
      return databasePromise;
    }

    async function useStore(mode, operation) {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, mode);
      const completion = mode === 'readwrite'
        ? transactionToPromise(transaction)
        : null;
      let requestPromise;
      try {
        requestPromise = requestToPromise(
          operation(transaction.objectStore(STORE_NAME))
        );
      } catch (error) {
        requestPromise = Promise.reject(error);
      }
      if (!completion) return requestPromise;
      const [result] = await Promise.all([requestPromise, completion]);
      return result;
    }

    return {
      save(handle) {
        return useStore(
          'readwrite',
          store => store.put(handle, AUTOMATIC_BACKUP_KEY)
        );
      },
      async get() {
        const handle = await useStore(
          'readonly',
          store => store.get(AUTOMATIC_BACKUP_KEY)
        );
        return handle || null;
      },
      clear() {
        return useStore(
          'readwrite',
          store => store.delete(AUTOMATIC_BACKUP_KEY)
        );
      }
    };
  }

  return {
    DB_NAME,
    STORE_NAME,
    AUTOMATIC_BACKUP_KEY,
    transactionToPromise,
    createExpenseBackupFileHandles
  };
});
