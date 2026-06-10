/**
 * Expense Tracker - IndexedDB Data Layer
 * Provides CRUD operations for expenses, tags, and settings.
 * All data is stored locally in the browser.
 */

const DB_NAME = 'expense-tracker-db';
const DB_VERSION = 1;

// Object store names
const STORE_EXPENSES = 'expenses';
const STORE_TAGS = 'tags';
const STORE_SETTINGS = 'settings';

// Default categories (pre-populated tags)
const DEFAULT_TAGS = [
  { id: 'cat-food', name: '餐饮', color: '#e74c3c' },
  { id: 'cat-transport', name: '交通', color: '#3498db' },
  { id: 'cat-shopping', name: '购物', color: '#f39c12' },
  { id: 'cat-entertainment', name: '娱乐', color: '#9b59b6' },
  { id: 'cat-housing', name: '居住', color: '#2ecc71' },
  { id: 'cat-medical', name: '医疗', color: '#e67e22' },
  { id: 'cat-education', name: '教育', color: '#1abc9c' },
  { id: 'cat-other', name: '其他', color: '#95a5a6' }
];

let dbInstance = null;

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      console.log('IndexedDB opened successfully:', DB_NAME, 'v' + DB_VERSION);
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log('IndexedDB upgrading to version', DB_VERSION);

      // Expenses store
      if (!db.objectStoreNames.contains(STORE_EXPENSES)) {
        const expenseStore = db.createObjectStore(STORE_EXPENSES, { keyPath: 'id' });
        expenseStore.createIndex('date', 'date', { unique: false });
        expenseStore.createIndex('category', 'category', { unique: false });
        expenseStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }

      // Tags store
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagStore = db.createObjectStore(STORE_TAGS, { keyPath: 'id' });
        tagStore.createIndex('name', 'name', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Initialize the database with default data.
 * @returns {Promise<void>}
 */
async function initDB() {
  const db = await openDB();

  // Check if tags already exist
  const existingTags = await getTags();
  if (existingTags.length === 0) {
    const tx = db.transaction(STORE_TAGS, 'readwrite');
    const store = tx.objectStore(STORE_TAGS);
    for (const tag of DEFAULT_TAGS) {
      store.put(tag);
    }
    await transactionComplete(tx);
    console.log('Default tags initialized');
  }
}

/**
 * Wait for a transaction to complete.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function transactionComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}

// ============================================
// Expense CRUD
// ============================================

/**
 * Add a new expense.
 * @param {Object} expense - { amount, date, category, note?, tags? }
 * @returns {Promise<Object>} The saved expense with generated id.
 */
async function addExpense(expense) {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPENSES, 'readwrite');
  const store = tx.objectStore(STORE_EXPENSES);

  const record = {
    id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    amount: parseFloat(expense.amount) || 0,
    date: expense.date || new Date().toISOString().slice(0, 10),
    category: expense.category || '',
    note: expense.note || '',
    tags: Array.isArray(expense.tags) ? expense.tags : [],
    createdAt: new Date().toISOString()
  };

  store.put(record);
  await transactionComplete(tx);
  return record;
}

/**
 * Get all expenses, optionally filtered.
 * @param {Object} options - { startDate?, endDate?, category?, tag? }
 * @returns {Promise<Array>}
 */
async function getExpenses(options = {}) {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPENSES, 'readonly');
  const store = tx.objectStore(STORE_EXPENSES);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      let results = request.result || [];

      // Apply filters
      if (options.startDate) {
        results = results.filter(e => e.date >= options.startDate);
      }
      if (options.endDate) {
        results = results.filter(e => e.date <= options.endDate);
      }
      if (options.category) {
        results = results.filter(e => e.category === options.category);
      }
      if (options.tag) {
        results = results.filter(e => e.tags && e.tags.includes(options.tag));
      }

      // Default sort by date desc
      results.sort((a, b) => b.date.localeCompare(a.date));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update an existing expense.
 * @param {Object} expense - Must include id.
 * @returns {Promise<Object>}
 */
async function updateExpense(expense) {
  if (!expense.id) {
    throw new Error('Expense id is required for update');
  }

  const db = await openDB();
  const tx = db.transaction(STORE_EXPENSES, 'readwrite');
  const store = tx.objectStore(STORE_EXPENSES);

  return new Promise((resolve, reject) => {
    const getReq = store.get(expense.id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error('Expense not found: ' + expense.id));
        return;
      }

      const updated = {
        ...existing,
        amount: parseFloat(expense.amount) || existing.amount,
        date: expense.date !== undefined ? expense.date : existing.date,
        category: expense.category !== undefined ? expense.category : existing.category,
        note: expense.note !== undefined ? expense.note : existing.note,
        tags: expense.tags !== undefined ? (Array.isArray(expense.tags) ? expense.tags : []) : existing.tags,
        updatedAt: new Date().toISOString()
      };

      store.put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Delete an expense by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteExpense(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPENSES, 'readwrite');
  const store = tx.objectStore(STORE_EXPENSES);
  store.delete(id);
  await transactionComplete(tx);
}

// ============================================
// Tag CRUD
// ============================================

/**
 * Add a new tag.
 * @param {Object} tag - { name, color? }
 * @returns {Promise<Object>}
 */
async function addTag(tag) {
  const db = await openDB();
  const tx = db.transaction(STORE_TAGS, 'readwrite');
  const store = tx.objectStore(STORE_TAGS);

  const record = {
    id: 'tag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: tag.name.trim(),
    color: tag.color || '#2DBAA3'
  };

  store.put(record);
  await transactionComplete(tx);
  return record;
}

/**
 * Get all tags.
 * @returns {Promise<Array>}
 */
async function getTags() {
  const db = await openDB();
  const tx = db.transaction(STORE_TAGS, 'readonly');
  const store = tx.objectStore(STORE_TAGS);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update an existing tag.
 * @param {Object} tag - Must include id.
 * @returns {Promise<Object>}
 */
async function updateTag(tag) {
  if (!tag.id) {
    throw new Error('Tag id is required for update');
  }

  const db = await openDB();
  const tx = db.transaction(STORE_TAGS, 'readwrite');
  const store = tx.objectStore(STORE_TAGS);

  return new Promise((resolve, reject) => {
    const getReq = store.get(tag.id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error('Tag not found: ' + tag.id));
        return;
      }

      const updated = {
        ...existing,
        name: tag.name !== undefined ? tag.name.trim() : existing.name,
        color: tag.color !== undefined ? tag.color : existing.color
      };

      store.put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Delete a tag by id.
 * Also removes the tag from all expenses that reference it.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteTag(id) {
  const db = await openDB();

  // Remove tag from expenses
  const expenses = await getExpenses();
  const affected = expenses.filter(e => e.tags && e.tags.includes(id));

  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS], 'readwrite');
  const expStore = tx.objectStore(STORE_EXPENSES);
  const tagStore = tx.objectStore(STORE_TAGS);

  for (const exp of affected) {
    exp.tags = exp.tags.filter(t => t !== id);
    expStore.put(exp);
  }

  tagStore.delete(id);
  await transactionComplete(tx);
}

/**
 * Merge two tags: move all expenses from sourceTagId to targetTagId, then delete source.
 * @param {string} sourceTagId
 * @param {string} targetTagId
 * @returns {Promise<void>}
 */
async function mergeTag(sourceTagId, targetTagId) {
  if (sourceTagId === targetTagId) {
    throw new Error('Cannot merge a tag into itself');
  }

  const db = await openDB();
  const expenses = await getExpenses();
  const affected = expenses.filter(e => e.tags && e.tags.includes(sourceTagId));

  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS], 'readwrite');
  const expStore = tx.objectStore(STORE_EXPENSES);
  const tagStore = tx.objectStore(STORE_TAGS);

  for (const exp of affected) {
    // Replace source with target, avoid duplicates
    const newTags = exp.tags.filter(t => t !== sourceTagId);
    if (!newTags.includes(targetTagId)) {
      newTags.push(targetTagId);
    }
    exp.tags = newTags;
    expStore.put(exp);
  }

  tagStore.delete(sourceTagId);
  await transactionComplete(tx);
}

// ============================================
// Settings
// ============================================

/**
 * Get a setting value by key.
 * @param {string} key
 * @param {any} defaultValue
 * @returns {Promise<any>}
 */
async function getSettings(key, defaultValue = null) {
  const db = await openDB();
  const tx = db.transaction(STORE_SETTINGS, 'readonly');
  const store = tx.objectStore(STORE_SETTINGS);

  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value);
      } else {
        resolve(defaultValue);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Set a setting value.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
async function setSettings(key, value) {
  const db = await openDB();
  const tx = db.transaction(STORE_SETTINGS, 'readwrite');
  const store = tx.objectStore(STORE_SETTINGS);
  store.put({ key, value });
  await transactionComplete(tx);
}

// ============================================
// Export / Import
// ============================================

/**
 * Export all data as a JSON object.
 * @returns {Promise<Object>}
 */
async function exportAllData() {
  const [expenses, tags, settings] = await Promise.all([
    getExpenses(),
    getTags(),
    (async () => {
      const db = await openDB();
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const store = tx.objectStore(STORE_SETTINGS);
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    })()
  ]);

  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    expenses,
    tags,
    settings
  };
}

/**
 * Import data from a JSON object.
 * WARNING: This will overwrite existing data.
 * @param {Object} data
 * @returns {Promise<void>}
 */
async function importData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid import data');
  }

  const db = await openDB();

  // Clear existing data
  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS], 'readwrite');
  tx.objectStore(STORE_EXPENSES).clear();
  tx.objectStore(STORE_TAGS).clear();
  tx.objectStore(STORE_SETTINGS).clear();
  await transactionComplete(tx);

  // Import expenses
  if (Array.isArray(data.expenses)) {
    const tx2 = db.transaction(STORE_EXPENSES, 'readwrite');
    const store = tx2.objectStore(STORE_EXPENSES);
    for (const exp of data.expenses) {
      if (exp.id) store.put(exp);
    }
    await transactionComplete(tx2);
  }

  // Import tags
  if (Array.isArray(data.tags)) {
    const tx3 = db.transaction(STORE_TAGS, 'readwrite');
    const store = tx3.objectStore(STORE_TAGS);
    for (const tag of data.tags) {
      if (tag.id) store.put(tag);
    }
    await transactionComplete(tx3);
  }

  // Import settings
  if (Array.isArray(data.settings)) {
    const tx4 = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx4.objectStore(STORE_SETTINGS);
    for (const setting of data.settings) {
      if (setting.key !== undefined) store.put(setting);
    }
    await transactionComplete(tx4);
  }
}

/**
 * Clear all data from the database.
 * @returns {Promise<void>}
 */
async function clearAllData() {
  const db = await openDB();
  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS], 'readwrite');
  tx.objectStore(STORE_EXPENSES).clear();
  tx.objectStore(STORE_TAGS).clear();
  tx.objectStore(STORE_SETTINGS).clear();
  await transactionComplete(tx);
}

// ============================================
// Auto-initialize on module load
// ============================================

window.openDB = openDB;
window.initDB = initDB;
window.addExpense = addExpense;
window.getExpenses = getExpenses;
window.updateExpense = updateExpense;
window.deleteExpense = deleteExpense;
window.addTag = addTag;
window.getTags = getTags;
window.updateTag = updateTag;
window.deleteTag = deleteTag;
window.mergeTag = mergeTag;
window.getSettings = getSettings;
window.setSettings = setSettings;
window.exportAllData = exportAllData;
window.importData = importData;
window.clearAllData = clearAllData;

openDB().then(() => {
  initDB().catch(err => console.error('DB init error:', err));
}).catch(err => console.error('DB open error:', err));
