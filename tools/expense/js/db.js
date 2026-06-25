/**
 * Expense Tracker - IndexedDB Data Layer
 * Provides CRUD operations for expenses, tags, and settings.
 * All data is stored locally in the browser.
 */

const DB_NAME = 'expense-tracker-db';
const DB_VERSION = 2;

// Object store names
const STORE_EXPENSES = 'expenses';
const STORE_TAGS = 'tags';
const STORE_TAG_GROUPS = 'tagGroups';
const STORE_SETTINGS = 'settings';
const SNAPSHOT_KEYS = ['expenses', 'tags', 'settings', 'tagGroups'];
const tagManagementUtils = typeof module !== 'undefined' && module.exports
  ? require('./tag-management-utils')
  : window.TagManagementUtils;
const dbBackupUtils = typeof module !== 'undefined' && module.exports
  ? require('./db-backup-utils')
  : window.ExpenseDBBackupUtils;
const DEFAULT_TAG_GROUPS = tagManagementUtils.DEFAULT_TAG_GROUPS;
const DEFAULT_REPAIR_OPTIONS = tagManagementUtils.DEFAULT_REPAIR_OPTIONS;

function normalizeRecordArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(name + ' must be an array');
  }
  return value.filter(record => record !== undefined);
}

function normalizeSnapshotRecords(value, name) {
  const records = normalizeRecordArray(value, name);
  if (name === 'settings') {
    return records.filter(record => record && record.key !== undefined);
  }
  return records.filter(record => record && record.id);
}

function normalizeDatabaseSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Snapshot must be an object');
  }

  return SNAPSHOT_KEYS.reduce((normalized, key) => {
    normalized[key] = normalizeSnapshotRecords(snapshot[key], key);
    return normalized;
  }, {});
}

function mapSnapshotRecordsToStores(snapshot, storeNames) {
  const normalized = normalizeDatabaseSnapshot(snapshot);
  return SNAPSHOT_KEYS.reduce((recordsByStore, key) => {
    recordsByStore[storeNames[key]] = normalized[key];
    return recordsByStore;
  }, {});
}

function requireTagGroupRepairPlanner(planner) {
  if (typeof planner !== 'function') {
    throw new Error('Tag group repair planner is required');
  }
  return planner;
}

function applyTagUpdates(tags, tagsToUpdate) {
  const updatesById = new Map(tagsToUpdate.map(tag => [tag.id, tag]));
  return tags.map(tag => updatesById.get(tag.id) || tag);
}

function prepareReplacementSnapshot(
  snapshot,
  planner,
  defaultGroups,
  repairOptions
) {
  return dbBackupUtils.prepareReplacementTagIntegrity(
    snapshot,
    planner,
    defaultGroups,
    repairOptions
  );
}

function prepareMergeTransactionRecords(
  input,
  planner,
  defaultGroups,
  repairOptions
) {
  const expensesToAdd = normalizeRecordArray(input.expensesToAdd, 'expensesToAdd');
  const tagsToAdd = normalizeRecordArray(input.tagsToAdd, 'tagsToAdd');
  const tagGroupsToAdd = normalizeRecordArray(
    input.tagGroupsToAdd,
    'tagGroupsToAdd'
  );
  const combinedTags = [
    ...normalizeRecordArray(input.currentTags, 'currentTags'),
    ...tagsToAdd
  ];
  const combinedGroups = [
    ...normalizeRecordArray(input.currentTagGroups, 'currentTagGroups'),
    ...tagGroupsToAdd
  ];
  const repairPlan = requireTagGroupRepairPlanner(planner)(
    combinedTags,
    combinedGroups,
    defaultGroups,
    repairOptions
  );

  return {
    expenses: expensesToAdd,
    tags: [...tagsToAdd, ...repairPlan.tagsToUpdate],
    tagGroups: [...tagGroupsToAdd, ...repairPlan.groupsToAdd]
  };
}

function queueTransactionWrites(tx, recordsByStore, options = {}) {
  try {
    for (const [storeName, records] of Object.entries(recordsByStore)) {
      const store = tx.objectStore(storeName);
      if (options.clear) store.clear();
      for (const record of records) {
        store.put(record);
      }
    }
  } catch (error) {
    try {
      tx.abort();
    } catch (abortError) {
      // Preserve the original synchronous IndexedDB error.
    }
    throw error;
  }
}

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
      // Reset cache when DB connection is closed (e.g., after deleteDatabase)
      dbInstance.onclose = () => {
        console.log('IndexedDB connection closed, resetting cache');
        dbInstance = null;
      };
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

      // Tag Groups store (v2)
      if (!db.objectStoreNames.contains(STORE_TAG_GROUPS)) {
        db.createObjectStore(STORE_TAG_GROUPS, { keyPath: 'id' });
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

  // Initialize tag groups if empty
  const existingGroups = await getTagGroups();
  if (existingGroups.length === 0) {
    const tx = db.transaction(STORE_TAG_GROUPS, 'readwrite');
    const store = tx.objectStore(STORE_TAG_GROUPS);
    for (const g of DEFAULT_TAG_GROUPS) {
      store.put(g);
    }
    await transactionComplete(tx);
    console.log('Default tag groups initialized');
  }

  // Check if tags already exist
  const existingTags = await getTags();
  if (existingTags.length === 0) {
    const tx = db.transaction(STORE_TAGS, 'readwrite');
    const store = tx.objectStore(STORE_TAGS);
    for (const tag of DEFAULT_TAGS) {
      store.put({ ...tag, parentId: 'group-category' });
    }
    await transactionComplete(tx);
    console.log('Default tags initialized');
  } else {
    // Migrate: set parentId for any tag missing it (v1 -> v2)
    const needsMigration = existingTags.some(t => t.parentId === undefined);
    if (needsMigration) {
      const tx = db.transaction(STORE_TAGS, 'readwrite');
      const store = tx.objectStore(STORE_TAGS);
      for (const tag of existingTags) {
        if (tag.parentId === undefined) {
          tag.parentId = 'group-category';
          store.put(tag);
        }
      }
      await transactionComplete(tx);
      console.log('Tags migrated: parentId set to group-category');
    }
  }

  await repairTagGroupIntegrity();
}

async function repairTagGroupIntegrity() {
  const db = await openDB();
  const [groups, tags] = await Promise.all([getTagGroups(), getTags()]);
  const planner = window.TagManagementUtils && window.TagManagementUtils.planTagGroupRepair;
  if (typeof planner !== 'function') {
    return;
  }

  const plan = planner(tags, groups, DEFAULT_TAG_GROUPS, {
    defaultTagParentId: 'group-category',
    fallbackGroupId: 'group-uncategorized'
  });

  if (plan.groupsToAdd.length === 0 && plan.tagsToUpdate.length === 0) {
    return;
  }

  const tx = db.transaction([STORE_TAG_GROUPS, STORE_TAGS], 'readwrite');
  const groupStore = tx.objectStore(STORE_TAG_GROUPS);
  const tagStore = tx.objectStore(STORE_TAGS);

  for (const group of plan.groupsToAdd) {
    groupStore.put(group);
  }
  for (const tag of plan.tagsToUpdate) {
    tagStore.put(tag);
  }

  await transactionComplete(tx);
  console.log('[Tags] Repaired tag groups:', {
    groupsAdded: plan.groupsToAdd.length,
    tagsUpdated: plan.tagsToUpdate.length
  });
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
// Tag Group CRUD (v2)
// ============================================

/**
 * Add a new tag group.
 * @param {Object} group - { name, color?, order? }
 * @returns {Promise<Object>}
 */
async function addTagGroup(group) {
  const db = await openDB();
  const tx = db.transaction(STORE_TAG_GROUPS, 'readwrite');
  const store = tx.objectStore(STORE_TAG_GROUPS);

  // Use a single transaction for both read and write to avoid auto-commit issues
  return new Promise((resolve, reject) => {
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const allGroups = getAllReq.result || [];
      const maxOrder = allGroups.reduce((m, g) => Math.max(m, g.order || 0), 0);

      const record = {
        id: 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: group.name.trim(),
        color: group.color || '#95a5a6',
        order: group.order !== undefined ? group.order : maxOrder + 1,
        createdAt: new Date().toISOString()
      };

      store.put(record);
      // Use oncomplete/onerror directly instead of transactionComplete to avoid async gaps
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    };
    getAllReq.onerror = () => reject(getAllReq.error);
  });
}

/**
 * Get all tag groups sorted by order.
 * @returns {Promise<Array>}
 */
async function getTagGroups() {
  const db = await openDB();
  const tx = db.transaction(STORE_TAG_GROUPS, 'readonly');
  const store = tx.objectStore(STORE_TAG_GROUPS);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const groups = request.result || [];
      groups.sort((a, b) => (a.order || 0) - (b.order || 0));
      resolve(groups);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a tag group.
 * @param {Object} group - Must include id.
 * @returns {Promise<Object>}
 */
async function updateTagGroup(group) {
  if (!group.id) throw new Error('Group id is required');

  const db = await openDB();
  const tx = db.transaction(STORE_TAG_GROUPS, 'readwrite');
  const store = tx.objectStore(STORE_TAG_GROUPS);

  return new Promise((resolve, reject) => {
    const getReq = store.get(group.id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error('Group not found: ' + group.id)); return; }

      const updated = { ...existing };
      if (group.name !== undefined) updated.name = group.name.trim();
      if (group.color !== undefined) updated.color = group.color;
      if (group.order !== undefined) updated.order = group.order;

      store.put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Delete a tag group, moving child tags to 'group-uncategorized'.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteTagGroup(id) {
  const db = await openDB();
  const tags = await getTags();
  const affectedTags = tags.filter(t => (t.parentId || 'group-uncategorized') === id);

  const tx = db.transaction([STORE_TAGS, STORE_TAG_GROUPS], 'readwrite');
  const tagStore = tx.objectStore(STORE_TAGS);
  const groupStore = tx.objectStore(STORE_TAG_GROUPS);

  for (const tag of affectedTags) {
    tag.parentId = 'group-uncategorized';
    tagStore.put(tag);
  }

  groupStore.delete(id);
  await transactionComplete(tx);
}

/**
 * Move a tag to a different group.
 * @param {string} tagId
 * @param {string} groupId
 * @returns {Promise<Object>}
 */
async function moveTagToGroup(tagId, groupId) {
  const db = await openDB();
  const tx = db.transaction(STORE_TAGS, 'readwrite');
  const store = tx.objectStore(STORE_TAGS);

  return new Promise((resolve, reject) => {
    const getReq = store.get(tagId);
    getReq.onsuccess = () => {
      const tag = getReq.result;
      if (!tag) { reject(new Error('Tag not found')); return; }
      tag.parentId = groupId;
      store.put(tag);
      tx.oncomplete = () => resolve(tag);
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
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
    color: tag.color || '#2DBAA3',
    parentId: tag.parentId || 'group-uncategorized'
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
 * Get all setting records.
 * @returns {Promise<Array>}
 */
async function getAllSettings() {
  const db = await openDB();
  const tx = db.transaction(STORE_SETTINGS, 'readonly');
  const request = tx.objectStore(STORE_SETTINGS).getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
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
  const [expenses, tags, settings, tagGroups] = await Promise.all([
    getExpenses(),
    getTags(),
    getAllSettings(),
    getTagGroups()
  ]);

  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    expenses,
    tags,
    settings,
    tagGroups
  };
}

/**
 * Create a raw snapshot of all persisted stores.
 * @returns {Promise<Object>}
 */
async function createDatabaseSnapshot() {
  const [expenses, tags, settings, tagGroups] = await Promise.all([
    getExpenses(),
    getTags(),
    getAllSettings(),
    getTagGroups()
  ]);

  return { expenses, tags, settings, tagGroups };
}

/**
 * Atomically replace all persisted stores with a snapshot.
 * @param {Object} snapshot
 * @returns {Promise<void>}
 */
async function replaceDatabaseSnapshot(snapshot) {
  const planner = window.TagManagementUtils
    && window.TagManagementUtils.planTagGroupRepair;
  const prepared = prepareReplacementSnapshot(
    snapshot,
    planner,
    DEFAULT_TAG_GROUPS,
    DEFAULT_REPAIR_OPTIONS
  );
  const db = await openDB();
  const stores = [STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS, STORE_TAG_GROUPS];
  const recordsByStore = mapSnapshotRecordsToStores(prepared, {
    expenses: STORE_EXPENSES,
    tags: STORE_TAGS,
    settings: STORE_SETTINGS,
    tagGroups: STORE_TAG_GROUPS
  });
  const tx = db.transaction(stores, 'readwrite');

  queueTransactionWrites(tx, recordsByStore, { clear: true });

  await transactionComplete(tx);
}

/**
 * Atomically apply the additive writes from a backup merge plan.
 * @param {Object} plan
 * @returns {Promise<void>}
 */
async function applyBackupMergePlan(plan = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Merge plan must be an object');
  }

  const [currentTags, currentTagGroups] = await Promise.all([
    getTags(),
    getTagGroups()
  ]);
  const planner = window.TagManagementUtils
    && window.TagManagementUtils.planTagGroupRepair;
  const records = prepareMergeTransactionRecords({
    currentTags,
    currentTagGroups,
    expensesToAdd: plan.expensesToAdd,
    tagsToAdd: plan.tagsToAdd,
    tagGroupsToAdd: plan.tagGroupsToAdd
  }, planner, DEFAULT_TAG_GROUPS, DEFAULT_REPAIR_OPTIONS);
  const db = await openDB();
  const tx = db.transaction([
    STORE_EXPENSES,
    STORE_TAGS,
    STORE_TAG_GROUPS
  ], 'readwrite');

  queueTransactionWrites(tx, {
    [STORE_EXPENSES]: records.expenses,
    [STORE_TAGS]: records.tags,
    [STORE_TAG_GROUPS]: records.tagGroups
  });

  await transactionComplete(tx);
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

  await replaceDatabaseSnapshot({
    expenses: data.expenses || [],
    tags: data.tags || [],
    settings: data.settings || [],
    tagGroups: data.tagGroups || []
  });
}

/**
 * Clear all data from the database.
 * @returns {Promise<void>}
 */
async function clearAllData() {
  const db = await openDB();
  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS, STORE_TAG_GROUPS], 'readwrite');
  tx.objectStore(STORE_EXPENSES).clear();
  tx.objectStore(STORE_TAGS).clear();
  tx.objectStore(STORE_SETTINGS).clear();
  tx.objectStore(STORE_TAG_GROUPS).clear();
  await transactionComplete(tx);
}

// ============================================
// Auto-initialize on module load
// ============================================

if (typeof window !== 'undefined') {
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
  window.getAllSettings = getAllSettings;
  window.setSettings = setSettings;
  window.exportAllData = exportAllData;
  window.createDatabaseSnapshot = createDatabaseSnapshot;
  window.replaceDatabaseSnapshot = replaceDatabaseSnapshot;
  window.applyBackupMergePlan = applyBackupMergePlan;
  window.importData = importData;
  window.clearAllData = clearAllData;
  window.addTagGroup = addTagGroup;
  window.getTagGroups = getTagGroups;
  window.updateTagGroup = updateTagGroup;
  window.deleteTagGroup = deleteTagGroup;
  window.moveTagToGroup = moveTagToGroup;
  window.repairTagGroupIntegrity = repairTagGroupIntegrity;

  openDB().then(() => {
    initDB().catch(err => console.error('DB init error:', err));
  }).catch(err => console.error('DB open error:', err));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeDatabaseSnapshot,
    mapSnapshotRecordsToStores,
    prepareReplacementSnapshot,
    prepareMergeTransactionRecords,
    queueTransactionWrites,
    transactionComplete
  };
}
