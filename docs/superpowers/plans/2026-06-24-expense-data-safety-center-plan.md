# 生活账单数据安全中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 JSON 导出/导入升级为轻量的数据安全中心，支持备份提醒、格式校验、覆盖或合并恢复、失败回滚、持久存储申请和渐进增强的指定文件自动保存。

**Architecture:** 保留 IndexedDB 作为唯一业务数据源；新增纯函数模块负责备份格式、提醒判断、数据指纹和合并计划，新增服务模块负责浏览器下载、文件句柄、恢复事务与存储权限。设置页只调用服务并渲染状态，现有 `app.js` 不承载合并和校验算法。

**Tech Stack:** Vanilla JavaScript、IndexedDB、Web Crypto、File System Access API（渐进增强）、Node.js `assert` 测试、PWA Service Worker

---

## 范围边界

本计划只实现数据安全中心。以下内容分别进入后续计划：

- 定期账单与待确认记录
- 月总预算与分类预算
- 智能洞察与首页信息重组

本阶段备份格式预留 `recurringRules`、`pendingExpenses`、`budgets` 三个空数组，但不创建对应业务 UI。

## 文件结构

- Create: `tools/expense/js/backup-utils.js`
  纯函数：格式构建与验证、提醒判断、旧数据指纹、合并计划、恢复摘要。
- Create: `tools/expense/js/backup-utils.test.js`
  Node 单元测试，不依赖 DOM 或 IndexedDB。
- Create: `tools/expense/js/backup-crypto.js`
  Web Crypto 加密/解密及二进制编码。
- Create: `tools/expense/js/backup-crypto.test.js`
  使用 Node Web Crypto 验证正确密码、错误密码和格式错误。
- Create: `tools/expense/js/backup-service.js`
  下载、自动文件写入、持久存储请求、恢复编排和回滚。
- Create: `tools/expense/js/backup-file-handle-db.js`
  独立 IndexedDB 保存 File System Access 文件句柄，避免把不可序列化句柄写入业务 settings。
- Create: `tools/expense/js/backup-ui.js`
  数据安全中心状态渲染、提醒卡片和恢复弹窗协调。
- Modify: `tools/expense/js/db.js`
  导出完整快照、原子覆盖恢复、合并写入、短期快照设置。
- Modify: `tools/expense/js/app.js`
  在账单新增后增加备份计数，初始化与视图切换时刷新安全状态。
- Modify: `tools/expense/js/import-export.js`
  复用新备份格式；保留 CSV/Excel 数据导入。
- Modify: `tools/expense/index.html`
  替换设置页数据导出区，增加恢复文件输入、恢复弹窗、首页提醒容器和脚本。
- Modify: `tools/expense/css/style.css`
  新增紧凑安全卡片、提醒和恢复摘要样式。
- Modify: `tools/expense/sw.js`
  缓存新增脚本并升级缓存版本。
- Modify: `tools/expense/CHANGELOG.md`
  记录数据安全中心功能。

---

### Task 1: 备份格式、提醒与合并纯函数

**Files:**
- Create: `tools/expense/js/backup-utils.js`
- Create: `tools/expense/js/backup-utils.test.js`

- [ ] **Step 1: 写失败测试**

创建 `backup-utils.test.js`：

```js
const assert = require('assert');
const {
  BACKUP_FORMAT_VERSION,
  buildBackupEnvelope,
  validateBackupEnvelope,
  shouldRemindBackup,
  createExpenseFingerprint,
  planBackupMerge
} = require('./backup-utils');

const base = {
  databaseVersion: 2,
  appVersion: '1.6.0',
  exportedAt: '2026-06-24T12:00:00.000Z',
  expenses: [{ id: 'e1', date: '2026-06-01', amount: 20, note: '午餐', tags: ['food'] }],
  tags: [{ id: 'food', name: '餐饮', parentId: 'group-category' }],
  tagGroups: [{ id: 'group-category', name: '消费类型' }],
  settings: []
};

const envelope = buildBackupEnvelope(base);
assert.strictEqual(envelope.formatVersion, BACKUP_FORMAT_VERSION);
assert.deepStrictEqual(envelope.recurringRules, []);
assert.deepStrictEqual(validateBackupEnvelope(envelope), { valid: true, errors: [] });

assert.strictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: '2026-06-10T00:00:00.000Z',
    newExpenseCount: 0,
    snoozedUntil: null
  }).reason,
  'age'
);
assert.strictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: '2026-06-23T00:00:00.000Z',
    newExpenseCount: 30,
    snoozedUntil: null
  }).reason,
  'count'
);
assert.strictEqual(
  shouldRemindBackup({
    now: '2026-06-24T00:00:00.000Z',
    lastBackupAt: null,
    newExpenseCount: 1,
    snoozedUntil: '2026-06-25T00:00:00.000Z'
  }).remind,
  false
);

assert.strictEqual(
  createExpenseFingerprint({
    date: '2026-06-01',
    amount: 20,
    note: ' 午餐 ',
    tags: ['wechat', 'food']
  }),
  createExpenseFingerprint({
    date: '2026-06-01',
    amount: 20.0,
    note: '午餐',
    tags: ['food', 'wechat']
  })
);

const mergePlan = planBackupMerge(
  {
    expenses: [{ id: 'e1', date: '2026-06-01', amount: 20, note: '当前', tags: [] }],
    tags: [{ id: 't1', name: '当前标签' }],
    tagGroups: [],
    settings: []
  },
  {
    expenses: [
      { id: 'e1', date: '2026-06-01', amount: 99, note: '备份冲突', tags: [] },
      { id: 'e2', date: '2026-06-02', amount: 30, note: '新增', tags: [] }
    ],
    tags: [{ id: 't2', name: '新增标签' }],
    tagGroups: [],
    settings: []
  }
);
assert.strictEqual(mergePlan.expensesToAdd.length, 1);
assert.strictEqual(mergePlan.conflicts.length, 1);
assert.strictEqual(mergePlan.tagsToAdd.length, 1);

console.log('backup-utils tests passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tools/expense/js/backup-utils.test.js
```

Expected: FAIL，提示无法找到 `./backup-utils`。

- [ ] **Step 3: 实现最小纯函数模块**

创建 `backup-utils.js`：

```js
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseBackupUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const BACKUP_FORMAT_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function buildBackupEnvelope(input) {
    return {
      formatVersion: BACKUP_FORMAT_VERSION,
      databaseVersion: Number(input.databaseVersion || 0),
      appVersion: String(input.appVersion || ''),
      exportedAt: input.exportedAt || new Date().toISOString(),
      expenses: asArray(input.expenses),
      tags: asArray(input.tags),
      tagGroups: asArray(input.tagGroups),
      settings: asArray(input.settings),
      recurringRules: asArray(input.recurringRules),
      pendingExpenses: asArray(input.pendingExpenses),
      budgets: asArray(input.budgets)
    };
  }

  function validateBackupEnvelope(data) {
    const errors = [];
    if (!data || typeof data !== 'object') return { valid: false, errors: ['备份文件不是有效对象'] };
    if (!Number.isInteger(data.formatVersion)) errors.push('缺少备份格式版本');
    if (data.formatVersion > BACKUP_FORMAT_VERSION) errors.push('备份来自更新版本，请先升级应用');
    ['expenses', 'tags', 'tagGroups', 'settings'].forEach(key => {
      if (!Array.isArray(data[key])) errors.push(`${key} 必须是数组`);
    });
    if (!data.exportedAt || Number.isNaN(Date.parse(data.exportedAt))) errors.push('导出时间无效');
    asArray(data.expenses).forEach((expense, index) => {
      if (!expense || !expense.id) errors.push(`第 ${index + 1} 条账单缺少 id`);
      if (!expense || !expense.date) errors.push(`第 ${index + 1} 条账单缺少日期`);
      if (!expense || !Number.isFinite(Number(expense.amount))) errors.push(`第 ${index + 1} 条账单金额无效`);
    });
    return { valid: errors.length === 0, errors };
  }

  function shouldRemindBackup(input) {
    const now = Date.parse(input.now || new Date().toISOString());
    const snoozedUntil = input.snoozedUntil ? Date.parse(input.snoozedUntil) : 0;
    if (snoozedUntil > now) return { remind: false, reason: null };
    if (!input.lastBackupAt) return { remind: Number(input.newExpenseCount || 0) > 0, reason: 'never' };
    if (now - Date.parse(input.lastBackupAt) >= 14 * DAY_MS) return { remind: true, reason: 'age' };
    if (Number(input.newExpenseCount || 0) >= 30) return { remind: true, reason: 'count' };
    return { remind: false, reason: null };
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function createExpenseFingerprint(expense) {
    return JSON.stringify([
      String(expense.date || '').slice(0, 10),
      Number(expense.amount || 0).toFixed(2),
      normalizeText(expense.note || expense.itemName),
      asArray(expense.tags).map(String).sort()
    ]);
  }

  function equalRecord(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function additionsAndConflicts(current, incoming, fingerprint) {
    const currentById = new Map(current.filter(item => item && item.id).map(item => [item.id, item]));
    const fingerprints = new Set(current.map(fingerprint));
    const toAdd = [];
    const conflicts = [];
    for (const item of incoming) {
      if (item && item.id && currentById.has(item.id)) {
        if (!equalRecord(currentById.get(item.id), item)) conflicts.push({ current: currentById.get(item.id), incoming: item });
        continue;
      }
      if (fingerprints.has(fingerprint(item))) continue;
      toAdd.push(item);
      fingerprints.add(fingerprint(item));
    }
    return { toAdd, conflicts };
  }

  function idFingerprint(item) {
    return String(item && item.id || item && item.key || JSON.stringify(item));
  }

  function planBackupMerge(current, incoming) {
    const expenses = additionsAndConflicts(asArray(current.expenses), asArray(incoming.expenses), createExpenseFingerprint);
    const tags = additionsAndConflicts(asArray(current.tags), asArray(incoming.tags), idFingerprint);
    const groups = additionsAndConflicts(asArray(current.tagGroups), asArray(incoming.tagGroups), idFingerprint);
    return {
      expensesToAdd: expenses.toAdd,
      tagsToAdd: tags.toAdd,
      tagGroupsToAdd: groups.toAdd,
      conflicts: [...expenses.conflicts, ...tags.conflicts, ...groups.conflicts]
    };
  }

  return {
    BACKUP_FORMAT_VERSION,
    buildBackupEnvelope,
    validateBackupEnvelope,
    shouldRemindBackup,
    createExpenseFingerprint,
    planBackupMerge
  };
});
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
node tools/expense/js/backup-utils.test.js
```

Expected: `backup-utils tests passed`

- [ ] **Step 5: 提交**

```powershell
git add tools/expense/js/backup-utils.js tools/expense/js/backup-utils.test.js
git commit -m "test: define expense backup format and merge rules"
```

---

### Task 2: Web Crypto 可选加密备份

**Files:**
- Create: `tools/expense/js/backup-crypto.js`
- Create: `tools/expense/js/backup-crypto.test.js`

- [ ] **Step 1: 写失败测试**

创建 `backup-crypto.test.js`：

```js
const assert = require('assert');
globalThis.crypto = require('crypto').webcrypto;
const { encryptBackup, decryptBackup, isEncryptedBackup } = require('./backup-crypto');

(async () => {
  const source = JSON.stringify({ formatVersion: 1, expenses: [{ id: 'e1' }] });
  const encrypted = await encryptBackup(source, 'correct horse battery staple');
  assert.strictEqual(isEncryptedBackup(encrypted), true);
  assert.strictEqual(await decryptBackup(encrypted, 'correct horse battery staple'), source);
  await assert.rejects(() => decryptBackup(encrypted, 'wrong password'));
  assert.strictEqual(isEncryptedBackup({ format: 'plain' }), false);
  console.log('backup-crypto tests passed');
})();
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tools/expense/js/backup-crypto.test.js
```

Expected: FAIL，提示无法找到 `./backup-crypto`。

- [ ] **Step 3: 实现 PBKDF2 + AES-GCM**

创建 `backup-crypto.js`：

```js
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseBackupCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBackup(plainText, password) {
    if (!password) throw new Error('备份密码不能为空');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plainText));
    return {
      format: 'expense-tracker-encrypted-backup',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) }
    };
  }

  function isEncryptedBackup(value) {
    return Boolean(value && value.format === 'expense-tracker-encrypted-backup' && value.version === 1);
  }

  async function decryptBackup(envelope, password) {
    if (!isEncryptedBackup(envelope)) throw new Error('不是支持的加密备份');
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(envelope.cipher.data)
    );
    return decoder.decode(plain);
  }

  return { encryptBackup, decryptBackup, isEncryptedBackup };
});
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
node tools/expense/js/backup-crypto.test.js
```

Expected: `backup-crypto tests passed`

- [ ] **Step 5: 提交**

```powershell
git add tools/expense/js/backup-crypto.js tools/expense/js/backup-crypto.test.js
git commit -m "feat: add optional encrypted expense backups"
```

---

### Task 3: 扩展 IndexedDB 快照与恢复 API

**Files:**
- Modify: `tools/expense/js/db.js`

- [ ] **Step 1: 先运行现有数据层相关测试作为基线**

Run:

```powershell
node tools/expense/js/tag-management-utils.test.js
node tools/expense/js/tag-management-stress.test.js
```

Expected: 两项均 PASS。

- [ ] **Step 2: 增加读取全部 settings 的独立函数**

在 Settings CRUD 区域添加：

```js
async function getAllSettings() {
  const db = await openDB();
  const tx = db.transaction(STORE_SETTINGS, 'readonly');
  const request = tx.objectStore(STORE_SETTINGS).getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
```

将 `exportAllData()` 中的内联 settings 读取替换为 `getAllSettings()`。

- [ ] **Step 3: 增加原始快照与原子覆盖**

在 Export / Import 区域添加：

```js
async function createDatabaseSnapshot() {
  const [expenses, tags, settings, tagGroups] = await Promise.all([
    getExpenses(),
    getTags(),
    getAllSettings(),
    getTagGroups()
  ]);
  return { expenses, tags, settings, tagGroups };
}

async function replaceDatabaseSnapshot(snapshot) {
  const db = await openDB();
  const stores = [STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS, STORE_TAG_GROUPS];
  const tx = db.transaction(stores, 'readwrite');
  const recordsByStore = {
    [STORE_EXPENSES]: snapshot.expenses || [],
    [STORE_TAGS]: snapshot.tags || [],
    [STORE_SETTINGS]: snapshot.settings || [],
    [STORE_TAG_GROUPS]: snapshot.tagGroups || []
  };

  stores.forEach(storeName => {
    const store = tx.objectStore(storeName);
    store.clear();
    recordsByStore[storeName].forEach(record => store.put(record));
  });
  await transactionComplete(tx);
  await repairTagGroupIntegrity();
}
```

所有 clear 与 put 必须在同一个 `readwrite` transaction 内排队，禁止沿用旧 `importData()` 的“先提交清空、再分表写入”流程。

- [ ] **Step 4: 增加合并写入 API**

```js
async function applyBackupMergePlan(plan) {
  const db = await openDB();
  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS, STORE_TAG_GROUPS], 'readwrite');
  const expenseStore = tx.objectStore(STORE_EXPENSES);
  const tagStore = tx.objectStore(STORE_TAGS);
  const groupStore = tx.objectStore(STORE_TAG_GROUPS);
  (plan.expensesToAdd || []).forEach(record => expenseStore.put(record));
  (plan.tagsToAdd || []).forEach(record => tagStore.put(record));
  (plan.tagGroupsToAdd || []).forEach(record => groupStore.put(record));
  await transactionComplete(tx);
  await repairTagGroupIntegrity();
}
```

- [ ] **Step 5: 暴露新 API 并让旧导入走原子覆盖**

```js
window.getAllSettings = getAllSettings;
window.createDatabaseSnapshot = createDatabaseSnapshot;
window.replaceDatabaseSnapshot = replaceDatabaseSnapshot;
window.applyBackupMergePlan = applyBackupMergePlan;
```

将 `importData(data)` 改为：

```js
async function importData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data');
  await replaceDatabaseSnapshot({
    expenses: data.expenses || [],
    tags: data.tags || [],
    settings: data.settings || [],
    tagGroups: data.tagGroups || []
  });
}
```

- [ ] **Step 6: 运行现有测试和语法检查**

Run:

```powershell
node --check tools/expense/js/db.js
node tools/expense/js/tag-management-utils.test.js
node tools/expense/js/tag-management-stress.test.js
```

Expected: 语法检查无输出，测试均 PASS。

- [ ] **Step 7: 提交**

```powershell
git add tools/expense/js/db.js
git commit -m "refactor: make expense backup restores atomic"
```

---

### Task 4: 文件句柄存储与自动写入降级

**Files:**
- Create: `tools/expense/js/backup-file-handle-db.js`
- Create: `tools/expense/js/backup-service.js`

- [ ] **Step 1: 创建文件句柄专用数据库**

创建 `backup-file-handle-db.js`：

```js
(function(root) {
  const DB_NAME = 'ExpenseTrackerFileHandles';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'automatic-backup';

  function openHandleDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveBackupFileHandle(handle) {
    const db = await openHandleDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getBackupFileHandle() {
    const db = await openHandleDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function clearBackupFileHandle() {
    const db = await openHandleDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
  }

  root.ExpenseBackupFileHandles = {
    saveBackupFileHandle,
    getBackupFileHandle,
    clearBackupFileHandle
  };
})(globalThis);
```

- [ ] **Step 2: 创建备份服务骨架**

创建 `backup-service.js`，实现并暴露：

```js
const ExpenseBackupService = (() => {
  const META_KEY = 'backupMeta';
  let autoSaveTimer = null;

  async function getBackupMeta() {
    return (await getSettings(META_KEY)) || {
      lastBackupAt: null,
      lastBackupExpenseCount: 0,
      newExpenseCount: 0,
      snoozedUntil: null,
      automaticFileStatus: 'off'
    };
  }

  async function setBackupMeta(patch) {
    const current = await getBackupMeta();
    const next = { ...current, ...patch };
    await setSettings(META_KEY, next);
    return next;
  }

  async function buildCurrentBackup() {
    const snapshot = await createDatabaseSnapshot();
    return ExpenseBackupUtils.buildBackupEnvelope({
      databaseVersion: 2,
      appVersion: document.querySelector('.setting-version')?.textContent?.replace(/^v/, '') || '',
      ...snapshot,
      recurringRules: [],
      pendingExpenses: [],
      budgets: []
    });
  }

  function downloadText(text, filename, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function markBackupSuccessful(expenseCount) {
    return setBackupMeta({
      lastBackupAt: new Date().toISOString(),
      lastBackupExpenseCount: expenseCount,
      newExpenseCount: 0,
      snoozedUntil: null
    });
  }

  async function downloadPlainBackup() {
    const backup = await buildCurrentBackup();
    downloadText(
      JSON.stringify(backup, null, 2),
      `expense-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`
    );
    await markBackupSuccessful(backup.expenses.length);
    return backup;
  }

  async function downloadEncryptedBackup(password) {
    const backup = await buildCurrentBackup();
    const encrypted = await ExpenseBackupCrypto.encryptBackup(JSON.stringify(backup), password);
    downloadText(
      JSON.stringify(encrypted, null, 2),
      `expense-tracker-encrypted-${backup.exportedAt.slice(0, 10)}.json`
    );
    await markBackupSuccessful(backup.expenses.length);
    return backup;
  }

  return {
    getBackupMeta,
    setBackupMeta,
    buildCurrentBackup,
    downloadPlainBackup,
    downloadEncryptedBackup
  };
})();

window.ExpenseBackupService = ExpenseBackupService;
```

- [ ] **Step 3: 增加指定文件绑定和权限检查**

在服务返回对象前增加：

```js
async function chooseAutomaticBackupFile() {
  if (typeof showSaveFilePicker !== 'function') return { supported: false };
  const handle = await showSaveFilePicker({
    suggestedName: 'expense-tracker-auto-backup.json',
    types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }]
  });
  await ExpenseBackupFileHandles.saveBackupFileHandle(handle);
  await setBackupMeta({ automaticFileStatus: 'ready' });
  await writeAutomaticBackup();
  return { supported: true, handle };
}

async function ensureWritePermission(handle, request) {
  if (!handle) return false;
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return request && (await handle.requestPermission(options)) === 'granted';
}

async function writeAutomaticBackup(options = {}) {
  const handle = await ExpenseBackupFileHandles.getBackupFileHandle();
  if (!handle) return { written: false, reason: 'missing' };
  if (!(await ensureWritePermission(handle, Boolean(options.requestPermission)))) {
    await setBackupMeta({ automaticFileStatus: 'permission-needed' });
    return { written: false, reason: 'permission' };
  }
  try {
    const backup = await buildCurrentBackup();
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();
    await markBackupSuccessful(backup.expenses.length);
    await setBackupMeta({ automaticFileStatus: 'ready' });
    return { written: true };
  } catch (error) {
    await setBackupMeta({ automaticFileStatus: 'error' });
    return { written: false, reason: 'write', error };
  }
}

function scheduleAutomaticBackup() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    writeAutomaticBackup().catch(() => {});
  }, 1500);
}
```

将这些函数加入返回对象。

- [ ] **Step 4: 增加持久存储请求**

```js
async function requestPersistentStorage() {
  if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
    await setBackupMeta({ persistentStorage: 'unsupported' });
    return 'unsupported';
  }
  const granted = await navigator.storage.persist();
  const status = granted ? 'granted' : 'denied';
  await setBackupMeta({ persistentStorage: status });
  return status;
}
```

加入返回对象。该函数只能从用户点击数据安全中心或首次真实账单保存成功后的非阻塞流程调用。

- [ ] **Step 5: 语法检查并提交**

Run:

```powershell
node --check tools/expense/js/backup-file-handle-db.js
node --check tools/expense/js/backup-service.js
```

Expected: 无输出。

```powershell
git add tools/expense/js/backup-file-handle-db.js tools/expense/js/backup-service.js
git commit -m "feat: add local file backup service"
```

---

### Task 5: 恢复校验、覆盖、合并与回滚

**Files:**
- Modify: `tools/expense/js/backup-service.js`
- Modify: `tools/expense/js/backup-utils.js`
- Modify: `tools/expense/js/backup-utils.test.js`

- [ ] **Step 1: 增加恢复摘要失败测试**

在 `backup-utils.test.js` 追加：

```js
const { createRestoreSummary } = require('./backup-utils');
assert.deepStrictEqual(
  createRestoreSummary(
    { expenses: [{ id: 'e1' }], tags: [{ id: 't1' }], tagGroups: [] },
    { expenses: [{ id: 'e1' }, { id: 'e2' }], tags: [{ id: 't2' }], tagGroups: [] }
  ),
  { expenseCount: 2, tagCount: 1, conflictCount: 1, newExpenseCount: 1 }
);
```

- [ ] **Step 2: 运行并确认失败**

Run:

```powershell
node tools/expense/js/backup-utils.test.js
```

Expected: FAIL，`createRestoreSummary is not a function`。

- [ ] **Step 3: 实现摘要函数**

在 `backup-utils.js` 添加并导出：

```js
function createRestoreSummary(current, incoming) {
  const plan = planBackupMerge(current, incoming);
  return {
    expenseCount: asArray(incoming.expenses).length,
    tagCount: asArray(incoming.tags).length,
    conflictCount: plan.conflicts.length,
    newExpenseCount: plan.expensesToAdd.length
  };
}
```

- [ ] **Step 4: 实现文件解析和解密路由**

在 `backup-service.js` 添加：

```js
async function parseBackupText(text, password) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是有效 JSON');
  }
  if (ExpenseBackupCrypto.isEncryptedBackup(parsed)) {
    if (!password) return { encrypted: true, requiresPassword: true };
    try {
      parsed = JSON.parse(await ExpenseBackupCrypto.decryptBackup(parsed, password));
    } catch {
      throw new Error('密码错误或加密备份已损坏');
    }
  }
  const validation = ExpenseBackupUtils.validateBackupEnvelope(parsed);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  return { encrypted: false, requiresPassword: false, backup: parsed };
}

async function inspectBackupFile(file, password) {
  const result = await parseBackupText(await file.text(), password);
  if (!result.backup) return result;
  const current = await createDatabaseSnapshot();
  return {
    ...result,
    summary: ExpenseBackupUtils.createRestoreSummary(current, result.backup)
  };
}
```

- [ ] **Step 5: 实现带回滚的恢复**

```js
async function restoreBackup(backup, mode) {
  const validation = ExpenseBackupUtils.validateBackupEnvelope(backup);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  const safetySnapshot = await createDatabaseSnapshot();
  try {
    if (mode === 'replace') {
      await replaceDatabaseSnapshot(backup);
    } else if (mode === 'merge') {
      const current = await createDatabaseSnapshot();
      const plan = ExpenseBackupUtils.planBackupMerge(current, backup);
      await applyBackupMergePlan(plan);
    } else {
      throw new Error('未知恢复模式');
    }
    const verified = await createDatabaseSnapshot();
    if (!Array.isArray(verified.expenses) || !Array.isArray(verified.tags)) {
      throw new Error('恢复后校验失败');
    }
    await markBackupSuccessful(verified.expenses.length);
    return { restored: true, snapshot: verified };
  } catch (error) {
    await replaceDatabaseSnapshot(safetySnapshot);
    throw new Error(`恢复失败，已回滚：${error.message}`);
  }
}
```

加入返回对象。

- [ ] **Step 6: 运行纯函数测试和语法检查**

Run:

```powershell
node tools/expense/js/backup-utils.test.js
node --check tools/expense/js/backup-service.js
```

Expected: 测试 PASS，语法检查无输出。

- [ ] **Step 7: 提交**

```powershell
git add tools/expense/js/backup-utils.js tools/expense/js/backup-utils.test.js tools/expense/js/backup-service.js
git commit -m "feat: add validated backup restore with rollback"
```

---

### Task 6: 备份元数据计数与提醒生命周期

**Files:**
- Modify: `tools/expense/js/backup-service.js`
- Modify: `tools/expense/js/app.js`

- [ ] **Step 1: 在备份服务增加计数、稍后提醒和状态读取**

添加：

```js
async function recordExpenseCreated() {
  const meta = await getBackupMeta();
  await setBackupMeta({ newExpenseCount: Number(meta.newExpenseCount || 0) + 1 });
  scheduleAutomaticBackup();
}

async function snoozeBackupReminder() {
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return setBackupMeta({ snoozedUntil: until });
}

async function getBackupStatus() {
  const meta = await getBackupMeta();
  const decision = ExpenseBackupUtils.shouldRemindBackup({
    now: new Date().toISOString(),
    lastBackupAt: meta.lastBackupAt,
    newExpenseCount: meta.newExpenseCount,
    snoozedUntil: meta.snoozedUntil
  });
  return { meta, decision };
}
```

加入返回对象。

- [ ] **Step 2: 抽出账单保存后的统一钩子**

在 `app.js` 添加：

```js
async function afterExpenseCreated() {
  if (window.ExpenseBackupService) {
    await ExpenseBackupService.recordExpenseCreated();
    ExpenseBackupService.requestPersistentStorage().catch(() => {});
  }
}
```

在三个 `await addExpense(...)` 的真实用户录入路径成功后调用 `await afterExpenseCreated()`：

- 快捷表单保存
- 自然语言保存
- 导入预览确认不调用该钩子；批量导入完成后由导入流程按实际导入数量单独累加

- [ ] **Step 3: 为批量导入增加数量计数**

将服务的计数函数改为：

```js
async function recordExpensesCreated(count = 1) {
  const meta = await getBackupMeta();
  await setBackupMeta({
    newExpenseCount: Number(meta.newExpenseCount || 0) + Math.max(0, Number(count || 0))
  });
  scheduleAutomaticBackup();
}
```

导入成功取得 `result.imported` 后调用：

```js
await ExpenseBackupService.recordExpensesCreated(result.imported);
```

- [ ] **Step 4: 语法检查并提交**

Run:

```powershell
node --check tools/expense/js/backup-service.js
node --check tools/expense/js/app.js
```

Expected: 无输出。

```powershell
git add tools/expense/js/backup-service.js tools/expense/js/app.js
git commit -m "feat: track expense changes for backup reminders"
```

---

### Task 7: 数据安全中心与恢复 UI

**Files:**
- Create: `tools/expense/js/backup-ui.js`
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/css/style.css`

- [ ] **Step 1: 替换设置页数据导出区域**

用以下结构替换现有“数据导出”组；保留 CSV 入口在折叠区域：

```html
<div class="settings-group">
  <h3>数据安全</h3>
  <div class="safety-card" id="backup-safety-card">
    <div class="safety-card-main">
      <div>
        <span class="setting-title" id="backup-status-title">数据安全</span>
        <span class="setting-desc" id="backup-status-desc">正在检查备份状态…</span>
      </div>
      <button class="btn-primary" onclick="ExpenseBackupUI.downloadBackup()">立即备份</button>
    </div>
    <div class="safety-card-actions">
      <button class="btn-secondary" onclick="ExpenseBackupUI.chooseRestoreFile()">恢复备份</button>
      <button class="btn-text" type="button" aria-expanded="false"
        onclick="ExpenseBackupUI.toggleMore(this)">更多选项</button>
    </div>
    <div class="safety-more" id="backup-more-options" hidden>
      <button class="btn-secondary" onclick="ExpenseBackupUI.chooseAutomaticFile()">设置自动保存文件</button>
      <button class="btn-secondary" onclick="ExpenseBackupUI.openEncryptedBackup()">创建加密备份</button>
      <button class="btn-secondary" onclick="exportCSV()">导出 CSV</button>
      <span class="setting-desc" id="persistent-storage-status"></span>
    </div>
  </div>
  <input type="file" id="backup-restore-input" accept=".json,application/json" hidden>
</div>
```

原“数据导入”继续用于 CSV/Excel 导入，但标题改为“表格导入”，描述明确其不是完整备份恢复。

- [ ] **Step 2: 在概览 Hero 前增加唯一提醒容器**

```html
<div class="dashboard-attention" id="dashboard-attention" hidden></div>
```

安全提醒只能占用该容器；后续定期账单和预算洞察计划也必须通过统一优先级选择器使用这个容器，禁止叠加多张提醒卡片。

- [ ] **Step 3: 增加恢复弹窗**

在现有 modal 区域增加：

```html
<div class="modal-overlay" id="backup-restore-modal" style="display:none;">
  <div class="modal-card modal-small">
    <div class="modal-header">
      <h3>恢复备份</h3>
      <button class="btn-close" onclick="ExpenseBackupUI.closeRestore()" aria-label="关闭">✕</button>
    </div>
    <div class="modal-body">
      <div id="backup-password-area" hidden>
        <label for="backup-restore-password">备份密码</label>
        <input type="password" id="backup-restore-password" autocomplete="current-password">
        <button class="btn-secondary" onclick="ExpenseBackupUI.unlockRestore()">解密并检查</button>
      </div>
      <div id="backup-restore-summary"></div>
    </div>
    <div class="modal-footer" id="backup-restore-actions" hidden>
      <button class="btn-secondary" onclick="ExpenseBackupUI.restore('merge')">合并去重</button>
      <button class="btn-danger" onclick="ExpenseBackupUI.restore('replace')">覆盖恢复</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: 创建 UI 协调模块**

创建 `backup-ui.js`，至少实现：

```js
const ExpenseBackupUI = (() => {
  let selectedRestoreFile = null;
  let inspectedBackup = null;

  async function refresh() {
    const { meta, decision } = await ExpenseBackupService.getBackupStatus();
    const title = document.getElementById('backup-status-title');
    const desc = document.getElementById('backup-status-desc');
    const persistent = document.getElementById('persistent-storage-status');
    title.textContent = '数据安全';
    desc.textContent = meta.lastBackupAt
      ? `${formatRelativeDate(meta.lastBackupAt)}已备份 · ${meta.lastBackupExpenseCount || 0} 笔`
      : '尚未创建完整备份';
    persistent.textContent = {
      granted: '浏览器存储保护已开启',
      denied: '浏览器未授予存储保护',
      unsupported: '当前浏览器不支持存储保护'
    }[meta.persistentStorage] || '尚未检查存储保护';
    renderReminder(decision);
  }

  function formatRelativeDate(iso) {
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    if (days <= 0) return '今天';
    return `${days} 天前`;
  }

  function renderReminder(decision) {
    const container = document.getElementById('dashboard-attention');
    if (!decision.remind) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = `
      <div class="attention-card">
        <div><strong>建议备份账单</strong><span>一键保存完整数据，防止浏览器清理后丢失。</span></div>
        <div class="attention-actions">
          <button class="btn-primary" onclick="ExpenseBackupUI.downloadBackup()">立即备份</button>
          <button class="btn-text" onclick="ExpenseBackupUI.snooze()">稍后</button>
        </div>
      </div>`;
  }

  async function downloadBackup() {
    await ExpenseBackupService.downloadPlainBackup();
    showToast('完整备份已下载');
    await refresh();
  }

  function toggleMore(button) {
    const panel = document.getElementById('backup-more-options');
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  }

  function chooseRestoreFile() {
    document.getElementById('backup-restore-input').click();
  }

  async function handleRestoreFile(file) {
    selectedRestoreFile = file;
    inspectedBackup = null;
    const modal = document.getElementById('backup-restore-modal');
    modal.style.display = 'flex';
    const summary = document.getElementById('backup-restore-summary');
    const passwordArea = document.getElementById('backup-password-area');
    const actions = document.getElementById('backup-restore-actions');
    summary.textContent = '正在检查备份…';
    passwordArea.hidden = true;
    actions.hidden = true;
    try {
      const result = await ExpenseBackupService.inspectBackupFile(file);
      if (result.requiresPassword) {
        passwordArea.hidden = false;
        summary.textContent = '这是加密备份，请输入创建备份时使用的密码。';
        return;
      }
      showRestoreSummary(result);
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  function showRestoreSummary(result) {
    inspectedBackup = result.backup;
    const summary = result.summary;
    document.getElementById('backup-restore-summary').innerHTML = `
      <div class="restore-summary">
        <strong>${summary.expenseCount} 笔账单 · ${summary.tagCount} 个标签</strong>
        <span>${summary.newExpenseCount} 笔可合并，${summary.conflictCount} 项冲突将保留当前数据</span>
      </div>`;
    document.getElementById('backup-restore-actions').hidden = false;
  }

  async function unlockRestore() {
    const password = document.getElementById('backup-restore-password').value;
    try {
      const result = await ExpenseBackupService.inspectBackupFile(selectedRestoreFile, password);
      document.getElementById('backup-password-area').hidden = true;
      showRestoreSummary(result);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function restore(mode) {
    if (!inspectedBackup) return;
    try {
      await ExpenseBackupService.restoreBackup(inspectedBackup, mode);
      closeRestore();
      await refresh();
      await loadTags();
      await renderExpenseList();
      await refreshDashboard();
      showToast(mode === 'replace' ? '备份已覆盖恢复' : '备份已合并');
    } catch (error) {
      showToast(error.message);
    }
  }

  function closeRestore() {
    document.getElementById('backup-restore-modal').style.display = 'none';
    document.getElementById('backup-restore-password').value = '';
    selectedRestoreFile = null;
    inspectedBackup = null;
  }

  async function snooze() {
    await ExpenseBackupService.snoozeBackupReminder();
    await refresh();
  }

  async function chooseAutomaticFile() {
    const result = await ExpenseBackupService.chooseAutomaticBackupFile();
    if (!result.supported) {
      showToast('当前浏览器不支持自动保存文件，可继续使用普通备份');
      return;
    }
    showToast('自动备份文件已设置');
    await refresh();
  }

  async function openEncryptedBackup() {
    const password = window.prompt('输入加密备份密码（密码不可找回）');
    if (!password) return;
    const confirmation = window.prompt('再次输入相同密码');
    if (password !== confirmation) {
      showToast('两次输入的密码不一致');
      return;
    }
    await ExpenseBackupService.downloadEncryptedBackup(password);
    showToast('加密备份已下载');
    await refresh();
  }

  document.getElementById('backup-restore-input').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) handleRestoreFile(file);
  });

  return {
    refresh,
    downloadBackup,
    toggleMore,
    chooseRestoreFile,
    unlockRestore,
    restore,
    closeRestore,
    snooze,
    chooseAutomaticFile,
    openEncryptedBackup
  };
})();

window.ExpenseBackupUI = ExpenseBackupUI;
```

所有错误使用 `showToast()`，恢复解析失败时隐藏恢复操作按钮。

- [ ] **Step 5: 增加紧凑样式**

在 `style.css` 添加：

```css
.safety-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  background: var(--card-bg);
}

.safety-card-main,
.safety-card-actions,
.attention-card,
.attention-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.safety-card-main .setting-desc {
  display: block;
  margin-top: 4px;
}

.safety-card-actions {
  justify-content: flex-start;
  margin-top: 12px;
}

.safety-more {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.attention-card {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border));
  border-radius: 12px;
  background: var(--primary-light);
  margin-bottom: 14px;
}

.attention-card strong,
.attention-card span {
  display: block;
}

.attention-card span {
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 13px;
}

@media (max-width: 600px) {
  .safety-card-main,
  .attention-card {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 6: 语法检查并提交**

Run:

```powershell
node --check tools/expense/js/backup-ui.js
```

Expected: 无输出。

```powershell
git add tools/expense/index.html tools/expense/css/style.css tools/expense/js/backup-ui.js
git commit -m "feat: add lightweight data safety center UI"
```

---

### Task 8: 接入脚本顺序和页面生命周期

**Files:**
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/js/app.js`

- [ ] **Step 1: 按依赖顺序加载新脚本**

在 `db.js` 之后、`app.js` 之前加入：

```html
<script src="/tools/expense/js/backup-utils.js?v=1"></script>
<script src="/tools/expense/js/backup-crypto.js?v=1"></script>
<script src="/tools/expense/js/backup-file-handle-db.js?v=1"></script>
<script src="/tools/expense/js/backup-service.js?v=1"></script>
<script src="/tools/expense/js/backup-ui.js?v=1"></script>
```

- [ ] **Step 2: 初始化安全状态**

在应用初始化完成、数据库和标签加载完成后调用：

```js
if (window.ExpenseBackupUI) {
  ExpenseBackupUI.refresh().catch(error => console.warn('Backup status unavailable', error));
}
```

- [ ] **Step 3: 页面回到前台时刷新权限和提醒状态**

```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.ExpenseBackupUI) {
    ExpenseBackupUI.refresh().catch(() => {});
  }
});
```

在 `switchView('settings')` 和 `switchView('dashboard')` 的现有包装逻辑中刷新一次，不增加阻塞等待。

- [ ] **Step 4: 全量语法检查**

Run:

```powershell
Get-ChildItem tools/expense/js/*.js | ForEach-Object { node --check $_.FullName }
```

Expected: 无语法错误。

- [ ] **Step 5: 提交**

```powershell
git add tools/expense/index.html tools/expense/js/app.js
git commit -m "feat: integrate backup safety lifecycle"
```

---

### Task 9: PWA 缓存、版本与文档

**Files:**
- Modify: `tools/expense/sw.js`
- Modify: `tools/expense/index.html`
- Modify: `tools/expense/CHANGELOG.md`

- [ ] **Step 1: 升级版本和缓存名**

将设置页版本从 `v1.5.7` 升为 `v1.6.0`。

将：

```js
const CACHE_NAME = 'expense-tracker-v1.5.7';
```

改为：

```js
const CACHE_NAME = 'expense-tracker-v1.6.0';
```

- [ ] **Step 2: 缓存新增脚本**

在 `STATIC_ASSETS` 添加：

```js
'/tools/expense/js/backup-utils.js',
'/tools/expense/js/backup-crypto.js',
'/tools/expense/js/backup-file-handle-db.js',
'/tools/expense/js/backup-service.js',
'/tools/expense/js/backup-ui.js',
```

- [ ] **Step 3: 添加更新日志**

在 `CHANGELOG.md` 顶部添加：

```markdown
## v1.6.0 (2026-06-24)

### Data Safety
- 新增数据安全中心，集中展示备份状态、立即备份和恢复入口
- 距上次备份 14 天或新增 30 笔账单时轻量提醒
- 恢复前检查文件并创建安全快照，支持覆盖或合并去重
- 恢复失败时自动回滚当前数据
- 支持浏览器存储保护和指定本地文件自动保存
- 新增可选密码加密备份

### UX
- 高级备份能力默认折叠，普通备份保持一步完成
- 自动保存不可用时自动降级，不影响正常记账
```

- [ ] **Step 4: 提交**

```powershell
git add tools/expense/sw.js tools/expense/index.html tools/expense/CHANGELOG.md
git commit -m "chore: release expense data safety center v1.6.0"
```

---

### Task 10: 自动化与浏览器回归验证

**Files:**
- Test: `tools/expense/js/backup-utils.test.js`
- Test: `tools/expense/js/backup-crypto.test.js`
- Test: existing utility tests

- [ ] **Step 1: 运行全部 Node 测试**

Run:

```powershell
node tools/expense/js/backup-utils.test.js
node tools/expense/js/backup-crypto.test.js
node tools/expense/js/expense-list-utils.test.js
node tools/expense/js/tag-management-utils.test.js
node tools/expense/js/tag-management-stress.test.js
```

Expected: 五项全部 PASS。

- [ ] **Step 2: 运行静态检查**

Run:

```powershell
Get-ChildItem tools/expense/js/*.js | ForEach-Object { node --check $_.FullName }
git diff --check
```

Expected: 无错误、无尾随空格。

- [ ] **Step 3: 桌面浏览器验证普通备份**

在本地服务器打开 `/tools/expense/`：

1. 跳过或完成引导
2. 进入设置
3. 确认默认只显示状态、立即备份、恢复备份和更多选项
4. 点击立即备份
5. 验证下载文件名和 JSON 字段
6. 验证状态更新为“今天已备份”

Expected: 普通备份一步完成，没有密码或额外确认。

- [ ] **Step 4: 验证覆盖、合并和回滚**

1. 用当前数据创建备份
2. 新增一条账单
3. 恢复旧备份并选择合并，确认新账单保留、无重复记录
4. 再选择覆盖，确认数据与备份一致
5. 使用损坏文件，确认不出现覆盖按钮
6. 临时模拟 `replaceDatabaseSnapshot` 抛错，确认当前数据回滚

Expected: 三条恢复路径均符合设计。

- [ ] **Step 5: 验证渐进增强和移动端**

1. 支持 File System Access 的桌面浏览器绑定自动备份文件
2. 新增账单后确认文件在防抖时间后更新
3. 撤销文件权限，确认状态变为需要授权且记账仍成功
4. 375×812 视口检查安全卡片和恢复弹窗
5. 检查首页最多出现一张提醒卡片
6. 离线刷新，确认新增脚本可从 Service Worker 缓存加载

Expected: 不支持或权限失效时安全降级，移动端无横向溢出。

- [ ] **Step 6: 最终提交（仅在验证导致修正时）**

```powershell
git add tools/expense
git commit -m "fix: address data safety center verification findings"
```

若验证未产生文件修改，则不创建空提交。

---

## 完成条件

- 普通 JSON 备份保持一步完成
- 加密与自动文件保存只在更多选项中出现
- 14 天或 30 笔提醒可独立触发并可稍后处理
- 覆盖和合并恢复都先校验、可回滚
- 自动保存失败不影响新增账单
- 设置页和首页未增加新的常驻导航或复杂面板
- 所有 Node 测试、语法检查、桌面与移动端回归通过
