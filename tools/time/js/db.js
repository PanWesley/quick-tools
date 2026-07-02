(function(root, factory) {
  root.TodayYouxuDB = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  var DB_NAME = 'todayYouxuDB';
  var DB_VERSION = 1;
  var STORE_NAMES = ['tasks', 'habits', 'habitLogs', 'journals', 'opLogs'];

  function createId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function openDatabase() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('tasks')) {
          var tasks = db.createObjectStore('tasks', { keyPath: 'id' });
          tasks.createIndex('date', 'date', { unique: false });
          tasks.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('habits')) {
          var habits = db.createObjectStore('habits', { keyPath: 'id' });
          habits.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('habitLogs')) {
          var logs = db.createObjectStore('habitLogs', { keyPath: 'id' });
          logs.createIndex('habitId', 'habitId', { unique: false });
          logs.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('journals')) {
          var journals = db.createObjectStore('journals', { keyPath: 'id' });
          journals.createIndex('date', 'date', { unique: true });
        }
        if (!db.objectStoreNames.contains('opLogs')) {
          var opLogs = db.createObjectStore('opLogs', { keyPath: 'id' });
          opLogs.createIndex('entityType', 'entityType', { unique: false });
          opLogs.createIndex('syncState', 'syncState', { unique: false });
        }
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
      transaction.oncomplete = resolve;
      transaction.onerror = function() { reject(transaction.error); };
      transaction.onabort = function() { reject(transaction.error); };
    });
  }

  function getAll(storeName) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(storeName, 'readonly');
      var request = transaction.objectStore(storeName).getAll();
      return requestToPromise(request).finally(function() { db.close(); });
    });
  }

  function getOne(storeName, id) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(storeName, 'readonly');
      var request = transaction.objectStore(storeName).get(id);
      return requestToPromise(request).finally(function() { db.close(); });
    });
  }

  function getAllData() {
    return Promise.all(STORE_NAMES.map(getAll)).then(function(results) {
      return {
        tasks: results[0],
        habits: results[1],
        habitLogs: results[2],
        journals: results[3],
        opLogs: results[4]
      };
    });
  }

  function writeWithOp(storeName, entity, action, payload) {
    return openDatabase().then(function(db) {
      var transaction = db.transaction([storeName, 'opLogs'], 'readwrite');
      transaction.objectStore(storeName).put(entity);
      transaction.objectStore('opLogs').put({
        id: createId('op'),
        entityType: storeName === 'habitLogs' ? 'habitLog' : storeName.replace(/s$/, ''),
        entityId: entity.id,
        action: action,
        payload: payload || entity,
        clientTs: nowIso(),
        syncState: 'local'
      });
      return transactionDone(transaction).then(function() {
        db.close();
        return entity;
      });
    });
  }

  function createTask(input) {
    var timestamp = nowIso();
    var task = {
      id: createId('task'),
      title: String(input.title || '').trim(),
      notes: String(input.notes || '').trim(),
      date: input.date || '',
      priority: input.priority || 'none',
      status: 'active',
      tags: input.tags || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: '',
      deletedAt: ''
    };
    return writeWithOp('tasks', task, 'create');
  }

  function updateTask(id, changes) {
    return getOne('tasks', id).then(function(task) {
      var next = Object.assign({}, task, changes, { updatedAt: nowIso() });
      return writeWithOp('tasks', next, changes.status === 'completed' ? 'complete' : 'update', changes);
    });
  }

  function completeTask(id) {
    return updateTask(id, { status: 'completed', completedAt: nowIso() });
  }

  function deleteTask(id) {
    return updateTask(id, { status: 'deleted', deletedAt: nowIso() });
  }

  function createHabit(input) {
    var timestamp = nowIso();
    var habit = {
      id: createId('habit'),
      title: String(input.title || '').trim(),
      schedule: input.schedule || 'daily',
      weekday: input.weekday === undefined ? new Date().getDay() : Number(input.weekday),
      targetCount: Number(input.targetCount || 1),
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return writeWithOp('habits', habit, 'create');
  }

  function updateHabit(id, changes) {
    return getOne('habits', id).then(function(habit) {
      var next = Object.assign({}, habit, changes, { updatedAt: nowIso() });
      return writeWithOp('habits', next, 'update', changes);
    });
  }

  function upsertHabitLog(habitId, date, state) {
    return getAll('habitLogs').then(function(logs) {
      var existing = logs.find(function(log) {
        return log.habitId === habitId && log.date === date;
      });
      var timestamp = nowIso();
      var log = existing ? Object.assign({}, existing, {
        state: state,
        updatedAt: timestamp
      }) : {
        id: createId('log'),
        habitId: habitId,
        date: date,
        state: state,
        count: state === 'done' ? 1 : 0,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return writeWithOp('habitLogs', log, state === 'skipped' ? 'skip' : 'complete');
    });
  }

  function upsertJournal(date, content, mood) {
    return getAll('journals').then(function(entries) {
      var existing = entries.find(function(entry) { return entry.date === date; });
      var timestamp = nowIso();
      var entry = existing ? Object.assign({}, existing, {
        content: content,
        mood: mood || '',
        updatedAt: timestamp
      }) : {
        id: createId('journal'),
        date: date,
        content: content,
        mood: mood || '',
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return writeWithOp('journals', entry, existing ? 'update' : 'create');
    });
  }

  function clearAll() {
    return openDatabase().then(function(db) {
      var transaction = db.transaction(STORE_NAMES, 'readwrite');
      STORE_NAMES.forEach(function(storeName) {
        transaction.objectStore(storeName).clear();
      });
      return transactionDone(transaction).then(function() {
        db.close();
      });
    });
  }

  return {
    createTask: createTask,
    updateTask: updateTask,
    completeTask: completeTask,
    deleteTask: deleteTask,
    createHabit: createHabit,
    updateHabit: updateHabit,
    upsertHabitLog: upsertHabitLog,
    upsertJournal: upsertJournal,
    getAllData: getAllData,
    clearAll: clearAll
  };
});
