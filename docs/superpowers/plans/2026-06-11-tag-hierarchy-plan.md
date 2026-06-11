# 标签分级管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将标签系统从扁平列表升级为两级树形结构（分组 → 标签），支持预设分组、自由创建、分组内移动、按分组筛选、图表按分组聚合。

**Architecture:** 新增 IndexedDB tagGroups store 存储分组；tags 表增加 parentId 字段；标签管理页从列表改为树状可折叠结构；概览筛选弹出层改为分组+子标签两级展示；图表支持按分组/标签切换聚合。

**Tech Stack:** Vanilla JS + IndexedDB + Chart.js + CSS

---

### Task 1: DB 层 — 新增 tagGroups store + 数据迁移 + 分组 CRUD

**Files:**
- Modify: `tools/expense/js/db.js`

- [ ] **Step 1: 升级 DB_VERSION 到 2，添加 tagGroups store 迁移逻辑**

在 `db.js` 顶部：
```js
const DB_VERSION = 2; // was 1

// 新增 store name
const STORE_TAG_GROUPS = 'tagGroups';
```

预设分组常量（在 DEFAULT_TAGS 之后添加）：
```js
const DEFAULT_TAG_GROUPS = [
  { id: 'group-payment', name: '支付方式', color: '#3498db', order: 0 },
  { id: 'group-person', name: '人员', color: '#e91e63', order: 1 },
  { id: 'group-category', name: '消费类型', color: '#f39c12', order: 2 },
  { id: 'group-channel', name: '渠道', color: '#9b59b6', order: 3 },
  { id: 'group-uncategorized', name: '未分类', color: '#95a5a6', order: 99 }
];
```

- [ ] **Step 2: 修改 onupgradeneeded 添加 tagGroups store**

在 onupgradeneeded 中，标签 store 创建之后添加：
```js
// Tag Groups store (DB v2)
if (!db.objectStoreNames.contains(STORE_TAG_GROUPS)) {
  db.createObjectStore(STORE_TAG_GROUPS, { keyPath: 'id' });
}
```

- [ ] **Step 3: 修改 initDB — 插入预设分组 + 迁移旧标签 parentId**

```js
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
    // Migrate: set parentId to 'group-category' for any tag missing parentId
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
}
```

- [ ] **Step 4: 添加分组 CRUD 函数**

在 mergeTag 函数之后、Settings 之前添加：
```js
// ============================================
// Tag Group CRUD
// ============================================

async function addTagGroup(group) {
  const db = await openDB();
  const tx = db.transaction(STORE_TAG_GROUPS, 'readwrite');
  const store = tx.objectStore(STORE_TAG_GROUPS);

  const maxOrder = await getTagGroups().then(gs => gs.reduce((m, g) => Math.max(m, g.order || 0), 0));

  const record = {
    id: 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: group.name.trim(),
    color: group.color || '#95a5a6',
    order: group.order !== undefined ? group.order : maxOrder + 1,
    createdAt: new Date().toISOString()
  };

  store.put(record);
  await transactionComplete(tx);
  return record;
}

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

async function updateTagGroup(group) {
  if (!group.id) throw new Error('Group id required');
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

async function deleteTagGroup(id) {
  // Move child tags to 'group-uncategorized'
  const db = await openDB();
  const tags = await getTags();
  const affectedTags = tags.filter(t => t.parentId === id);

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

// Update exportAllData to include tagGroups
async function exportAllData() {
  const [expenses, tags, settings, tagGroups] = await Promise.all([
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
    })(),
    getTagGroups()
  ]);
  return { version: DB_VERSION, exportedAt: new Date().toISOString(), expenses, tags, settings, tagGroups };
}

// Update importData to handle tagGroups
// In importData, after importing tags, add:
  if (Array.isArray(data.tagGroups)) {
    const tx5 = db.transaction(STORE_TAG_GROUPS, 'readwrite');
    const store = tx5.objectStore(STORE_TAG_GROUPS);
    for (const g of data.tagGroups) { if (g.id) store.put(g); }
    await transactionComplete(tx5);
  }

// Update clearAllData to clear tagGroups too
async function clearAllData() {
  const db = await openDB();
  const tx = db.transaction([STORE_EXPENSES, STORE_TAGS, STORE_SETTINGS, STORE_TAG_GROUPS], 'readwrite');
  tx.objectStore(STORE_EXPENSES).clear();
  tx.objectStore(STORE_TAGS).clear();
  tx.objectStore(STORE_SETTINGS).clear();
  tx.objectStore(STORE_TAG_GROUPS).clear();
  await transactionComplete(tx);
}
```

- [ ] **Step 5: 暴露新函数到 window**

```js
window.addTagGroup = addTagGroup;
window.getTagGroups = getTagGroups;
window.updateTagGroup = updateTagGroup;
window.deleteTagGroup = deleteTagGroup;
window.moveTagToGroup = moveTagToGroup;
```

- [ ] **Step 6: Commit**

```bash
git add tools/expense/js/db.js
git commit -m "feat: add tagGroups store, migration, and group CRUD to DB layer"
```

---

### Task 2: 标签管理页 — 树状 UI

**Files:**
- Modify: `tools/expense/js/app.js` (renderTagsList, addNewTag 及相关函数)
- Modify: `tools/expense/css/style.css` (new tree CSS classes)
- Modify: `tools/expense/index.html` (新建分组表单)

- [ ] **Step 1: 修改 index.html — 标签管理页增加新建分组和分组下拉**

替换 add tag 表单区域（从 `<div class="form-card">` 开始到对应的关闭 `</div>`）为：

```html
  <div class="form-card">
    <div class="form-group inline">
      <input type="text" id="new-tag-name" placeholder="输入新标签名称...">
      <select id="new-tag-group" title="所属分组"></select>
      <input type="color" id="new-tag-color" value="#2DBAA3">
      <button class="btn-primary" onclick="addNewTag()">➕ 添加</button>
    </div>
  </div>
  <div class="form-card" style="margin-top:12px;">
    <div class="form-group inline">
      <input type="text" id="new-group-name" placeholder="输入新分组名称...">
      <input type="color" id="new-group-color" value="#95a5a6">
      <button class="btn-primary" onclick="addNewGroup()">➕ 新建分组</button>
    </div>
  </div>
```

- [ ] **Step 2: 重写 app.js 中的 renderTagsList() 为树状结构**

先添加全局变量 `allTagGroups`：
```js
let allTagGroups = []; // 在 allTags 附近
```

修改 loadTags：
```js
async function loadTags() {
  allTags = await getTags();
  allTagGroups = await getTagGroups();
  populateCategorySelects();
  renderTagCloud();
  renderTagsList();
}
```

重写 renderTagsList() — 完全替换旧实现：
```js
async function renderTagsList() {
  const container = document.getElementById('tags-list');
  if (!container) return;

  // Calculate tag usage counts
  const expenses = await getExpenses();
  const tagCounts = {};
  for (const exp of expenses) {
    for (const tid of (exp.tags || [])) {
      tagCounts[tid] = (tagCounts[tid] || 0) + 1;
    }
  }

  if (allTagGroups.length === 0 && allTags.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div><p>暂无标签</p></div>`;
    return;
  }

  // Populate new-tag-group dropdown
  const groupSelect = document.getElementById('new-tag-group');
  if (groupSelect) {
    groupSelect.innerHTML = allTagGroups.map(g =>
      `<option value="${g.id}">${g.name}</option>`
    ).join('');
  }

  let html = '';

  for (const group of allTagGroups) {
    const groupTags = allTags.filter(t => (t.parentId || 'group-uncategorized') === group.id);
    const groupTotal = groupTags.reduce((sum, t) => sum + (tagCounts[t.id] || 0), 0);

    html += `
    <div class="tag-group-card" data-group-id="${group.id}">
      <div class="tag-group-header" onclick="toggleGroupCollapse('${group.id}')">
        <div class="tag-group-left">
          <span class="tag-group-toggle" id="group-toggle-${group.id}">▼</span>
          <span class="tag-group-dot" style="background:${group.color}"></span>
          <span class="tag-group-name">${group.name}</span>
          <span class="tag-group-total">${groupTotal} 笔</span>
        </div>
        <div class="tag-group-actions">
          <button class="tag-group-action-btn" onclick="event.stopPropagation(); renameGroup('${group.id}')" title="重命名分组">✏️</button>
          ${group.id !== 'group-uncategorized' ? `<button class="tag-group-action-btn danger" onclick="event.stopPropagation(); removeGroup('${group.id}')" title="删除分组">🗑️</button>` : ''}
        </div>
      </div>
      <div class="tag-group-body" id="group-body-${group.id}">`;

    if (groupTags.length === 0) {
      html += `<div class="tree-tag-item empty-group">此分组下暂无标签</div>`;
    } else {
      for (const tag of groupTags) {
        const count = tagCounts[tag.id] || 0;
        html += `
        <div class="tree-tag-item">
          <div class="tag-display">
            <span class="tag-color-dot" style="background:${tag.color}"></span>
            <span class="tag-name">${tag.name}</span>
            <span class="tag-count" onclick="event.stopPropagation(); filterByTagFromList('${tag.id}')">${count} 笔</span>
          </div>
          <div class="tag-actions">
            <input type="color" class="tag-color-input" value="${tag.color}" onchange="changeTagColor('${tag.id}', this.value)" title="修改颜色">
            <button onclick="renameTag('${tag.id}')" title="重命名">✏️</button>
            <button onclick="moveTagPrompt('${tag.id}')" title="移动到其他分组">📦→</button>
            <button onclick="openMergeModal('${tag.id}')" title="合并标签">🔀</button>
            <button class="delete" onclick="removeTag('${tag.id}')" title="删除标签">🗑️</button>
          </div>
        </div>`;
      }
    }

    html += `
      </div>
    </div>`;
  }

  container.innerHTML = html;
}
```

- [ ] **Step 3: 添加新的 app.js 函数：分组管理 + 移动标签**

在现有 addNewTag / removeTag / renameTag 区域附近添加：
```js
// --- Tag Group Management ---

async function addNewGroup() {
  const nameInput = document.getElementById('new-group-name');
  const colorInput = document.getElementById('new-group-color');
  const name = nameInput.value.trim();
  if (!name) { showToast('请输入分组名称'); return; }
  await addTagGroup({ name, color: colorInput.value });
  allTagGroups = await getTagGroups();
  nameInput.value = '';
  colorInput.value = '#95a5a6';
  renderTagsList();
  showToast('分组已创建');
}
window.addNewGroup = addNewGroup;

function toggleGroupCollapse(groupId) {
  const body = document.getElementById('group-body-' + groupId);
  const toggle = document.getElementById('group-toggle-' + groupId);
  if (!body || !toggle) return;
  body.classList.toggle('collapsed');
  toggle.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
}

async function renameGroup(groupId) {
  const group = allTagGroups.find(g => g.id === groupId);
  if (!group) return;
  const newName = prompt('重命名分组：', group.name);
  if (!newName || !newName.trim()) return;
  await updateTagGroup({ id: groupId, name: newName.trim() });
  allTagGroups = await getTagGroups();
  renderTagsList();
  showToast('分组已重命名');
}

async function removeGroup(groupId) {
  if (groupId === 'group-uncategorized') return;
  // Check if group has tags
  const groupTags = allTags.filter(t => t.parentId === groupId);
  const msg = groupTags.length > 0
    ? `此分组下有 ${groupTags.length} 个标签，删除后这些标签将移入"未分类"。确定删除？`
    : `确定删除此分组？`;

  showCustomConfirm('删除分组', msg, async () => {
    await deleteTagGroup(groupId);
    allTagGroups = await getTagGroups();
    allTags = await getTags();
    renderTagsList();
    showToast('分组已删除');
  });
}

async function moveTagPrompt(tagId) {
  const tag = allTags.find(t => t.id === tagId);
  if (!tag) return;
  const currentGroup = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
  const options = allTagGroups
    .filter(g => g.id !== (tag.parentId || 'group-uncategorized'))
    .map(g => `<option value="${g.id}">${g.name}</option>`).join('');

  const html = `
    <div class="form-group">
      <label>将标签 <strong>${tag.name}</strong> 从「${currentGroup ? currentGroup.name : '未知'}」移动到：</label>
      <select id="move-target-select">${options}</select>
    </div>`;

  showCustomModal('移动标签', html, async () => {
    const select = document.getElementById('move-target-select');
    if (!select || !select.value) return;
    await moveTagToGroup(tagId, select.value);
    allTags = await getTags();
    renderTagsList();
    showToast('标签已移动');
  });
}
window.moveTagPrompt = moveTagPrompt;

// Update addNewTag to include parentId
async function addNewTag() {
  const nameInput = document.getElementById('new-tag-name');
  const colorInput = document.getElementById('new-tag-color');
  const groupSelect = document.getElementById('new-tag-group');
  const name = nameInput.value.trim();
  if (!name) { showToast('请输入标签名称'); return; }

  // Check for duplicate name
  if (allTags.some(t => t.name === name)) { showToast('标签名称已存在'); return; }

  const parentId = groupSelect ? groupSelect.value : 'group-uncategorized';
  const newTag = await addTag({ name, color: colorInput.value });
  // Set parentId after creation since addTag doesn't accept it
  await moveTagToGroup(newTag.id, parentId);
  allTags = await getTags();
  nameInput.value = '';
  colorInput.value = '#2DBAA3';
  renderTagsList();
  populateCategorySelects();
  renderTagCloud();
  showToast('标签已创建');
}

// Expose functions
window.toggleGroupCollapse = toggleGroupCollapse;
window.renameGroup = renameGroup;
window.removeGroup = removeGroup;
```

- [ ] **Step 4: 添加树状标签 CSS**

在 style.css 的 `.tags-card` 相关样式附近添加：
```css
/* Tag Group Tree */
.tag-group-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 12px;
  overflow: hidden;
  transition: background 0.3s;
}

.tag-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
  border-bottom: 1px solid transparent;
}

.tag-group-header:hover {
  background: var(--bg);
}

.tag-group-body.collapsed + .tag-group-header,
.tag-group-card:has(.tag-group-body:not(.collapsed)) .tag-group-header {
  border-bottom-color: var(--border);
}

.tag-group-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tag-group-toggle {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s;
  width: 14px;
  text-align: center;
}

.tag-group-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.tag-group-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.tag-group-total {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg);
  padding: 2px 8px;
  border-radius: 10px;
}

.tag-group-actions {
  display: flex;
  gap: 4px;
}

.tag-group-action-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card-bg);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.tag-group-action-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.tag-group-action-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.tag-group-body {
  transition: max-height 0.3s ease, opacity 0.3s ease;
  max-height: 2000px;
  opacity: 1;
  overflow: hidden;
}

.tag-group-body.collapsed {
  max-height: 0;
  opacity: 0;
}

.tree-tag-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px 12px 40px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.tree-tag-item:last-child {
  border-bottom: none;
}

.tree-tag-item:hover {
  background: var(--bg);
}

.tree-tag-item.empty-group {
  padding: 14px 18px 14px 40px;
  color: var(--text-secondary);
  font-size: 13px;
  justify-content: flex-start;
}
```

- [ ] **Step 5: Commit**

```bash
git add tools/expense/js/app.js tools/expense/css/style.css tools/expense/index.html
git commit -m "feat: tree-based tag management UI with collapsible groups and move-tag support"
```

---

### Task 3: 概览页筛选 — 分组+子标签两级弹出层

**Files:**
- Modify: `tools/expense/js/app.js` (renderTagCloud, toggleTagSelection, renderSelectedFilterTags)
- Modify: `tools/expense/css/style.css`

- [ ] **Step 1: 重写 renderTagCloud() 为分组结构**

完全替换旧 renderTagCloud：
```js
function renderTagCloud() {
  const cloud = document.getElementById('dash-tag-cloud');
  if (!cloud) return;

  if (allTagGroups.length === 0) {
    cloud.innerHTML = '<div class="empty-tip">暂无标签</div>';
    return;
  }

  let html = '';
  for (const group of allTagGroups) {
    const groupTags = allTags.filter(t => (t.parentId || 'group-uncategorized') === group.id);
    if (groupTags.length === 0) continue;

    // Check if all tags in this group are selected
    const allSelected = groupTags.every(t => selectedTagIds.includes(t.id));
    const someSelected = groupTags.some(t => selectedTagIds.includes(t.id));

    html += `<div class="popup-group-row">
      <div class="popup-group-header">
        <span class="popup-group-dot" style="background:${group.color}"></span>
        <span class="popup-group-name">${group.name}</span>
      </div>
      <button class="popup-group-select-all ${allSelected ? 'selected' : ''}"
        onclick="event.stopPropagation(); toggleGroupSelectAll('${group.id}')">
        ${allSelected ? '取消全选' : '选中全部'}
      </button>
    </div>`;

    html += '<div class="popup-tag-list">';
    for (const tag of groupTags) {
      const isSelected = selectedTagIds.includes(tag.id);
      html += `<span class="tag-chip ${isSelected ? 'selected' : ''}"
        data-id="${tag.id}"
        style="background:${tag.color}22; color:${tag.color}; border-color:${isSelected ? tag.color : 'transparent'}"
        onclick="toggleTagSelection('${tag.id}')">${tag.name}</span>`;
    }
    html += '</div>';
  }

  cloud.innerHTML = html;
}
```

- [ ] **Step 2: 添加 toggleGroupSelectAll 函数 + 更新 renderSelectedFilterTags**

```js
function toggleGroupSelectAll(groupId) {
  const groupTags = allTags.filter(t => (t.parentId || 'group-uncategorized') === groupId);
  const allSelected = groupTags.every(t => selectedTagIds.includes(t.id));

  if (allSelected) {
    // Deselect all tags in this group
    selectedTagIds = selectedTagIds.filter(id => !groupTags.find(t => t.id === id));
  } else {
    // Select all tags in this group
    for (const tag of groupTags) {
      if (!selectedTagIds.includes(tag.id)) {
        selectedTagIds.push(tag.id);
      }
    }
  }
  renderTagCloud();
  renderSelectedFilterTags();
}

// Update renderSelectedFilterTags to show group prefix
function renderSelectedFilterTags() {
  const container = document.getElementById('dash-selected-tags');
  if (!container) return;

  if (selectedTagIds.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  for (const tagId of selectedTagIds) {
    const tag = allTags.find(t => t.id === tagId);
    if (!tag) continue;
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    const groupName = group ? group.name : '';
    html += `<span class="tag-chip" style="background:${tag.color}22; color:${tag.color}; border-color:${tag.color}">
      ${groupName ? `<span class="tag-chip-group">${groupName}</span> / ` : ''}${tag.name}
      <button class="remove" onclick="removeFilterTag('${tag.id}')">&times;</button>
    </span>`;
  }
  container.innerHTML = html;
}

window.toggleGroupSelectAll = toggleGroupSelectAll;
```

- [ ] **Step 3: 添加弹出层新 CSS**

```css
/* Popup Group Row */
.popup-group-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}

.popup-group-row:first-child {
  padding-top: 0;
}

.popup-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.popup-group-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.popup-group-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.popup-group-select-all {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.popup-group-select-all:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.popup-group-select-all.selected {
  background: var(--primary-light);
  border-color: var(--primary);
  color: var(--primary);
}

.popup-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 12px;
}

.tag-chip-group {
  font-size: 10px;
  opacity: 0.7;
  font-weight: 400;
}
```

- [ ] **Step 4: Commit**

```bash
git add tools/expense/js/app.js tools/expense/css/style.css
git commit -m "feat: group-structured tag filter popup with select-all per group"
```

---

### Task 4: 图表 — 按分组聚合选项

**Files:**
- Modify: `tools/expense/js/chart.js`

- [ ] **Step 1: 在 updateDashboard 中添加分组聚合选项**

在 `updateDashboard` 函数开头附近添加分组/标签切换逻辑：
```js
// Add group/tag toggle for pie chart
function getGroupAggregation(expenses, tagGroups, allTags) {
  const groupTotals = {};
  for (const g of tagGroups) {
    groupTotals[g.id] = { name: g.name, color: g.color, total: 0 };
  }
  for (const exp of expenses) {
    for (const tid of (exp.tags || [])) {
      const tag = allTags.find(t => t.id === tid);
      if (!tag) continue;
      const parentId = tag.parentId || 'group-uncategorized';
      if (groupTotals[parentId]) {
        groupTotals[parentId].total += exp.amount;
      }
    }
  }
  return Object.values(groupTotals).filter(g => g.total > 0);
}
```

- [ ] **Step 2: 修改饼图渲染支持分组聚合**

在饼图（categoryChart）渲染处，增加一个 switch：
```js
// Near the categoryChart rendering logic:
const showByGroup = (typeof currentGroupMode !== 'undefined') ? currentGroupMode : false;

let categoryData;
if (showByGroup) {
  categoryData = getGroupAggregation(filtered, allTagGroups || [], allTags || []);
} else {
  // existing tag-based aggregation
  const catTotals = {};
  // ... existing code ...
}

// Add a toggle button between group/tag mode
// The toggle can be a small button near the chart title:
// <button onclick="toggleChartGroupMode()">按分组 / 按标签</button>
```

Due to complexity, add a simple global toggle:
```js
let chartGroupMode = false;
window.toggleChartGroupMode = function() {
  chartGroupMode = !chartGroupMode;
  refreshDashboard();
};
```

- [ ] **Step 3: Commit**

```bash
git add tools/expense/js/chart.js
git commit -m "feat: add group-aggregation toggle for pie chart"
```

---

### Task 5: 记账表单 — 智能输入增强 + 分组信息显示

**Files:**
- Modify: `tools/expense/js/app.js` (标签输入、智能建议相关函数)

- [ ] **Step 1: 增强智能建议显示分组信息**

修改 `onTagInput` 中的建议项渲染，添加分组名称：
```js
// In the suggestion rendering, change:
// From: `${tag.name}`
// To: `${tag.name} <span class="suggestion-group">${groupName}</span>`
```

- [ ] **Step 2: 修改 renderSelectedTags 显示分组前缀**

类似 renderSelectedFilterTags，在 chip 上显示 `分组 / 标签名`

- [ ] **Step 3: Commit**

```bash
git add tools/expense/js/app.js
git commit -m "feat: show group info in tag suggestions and selected chips"
```

---

### Task 6: 版本号升级 + 更新 README

- [ ] **Step 1: 版本号升级到 v1.2.0**

升级 index.html 中版本号：`v1.1.0` → `v1.2.0`

- [ ] **Step 2: 更新 README.md 添加 v1.2.0 更新日志**

```markdown
### v1.2.0 (2026-06-11)

**新增功能：**
- 标签分级管理：支持一级分组 + 二级标签的两级树形结构
- 预设分组：支付方式、人员、消费类型、渠道（可自定义）
- 标签管理页树状展示：分组可折叠/展开，支持重命名/删除分组
- 标签可在分组间移动（📦→ 按钮）
- 概览筛选支持按分组全选或按标签多选
- 图表支持按分组聚合统计
- 智能输入中显示标签所属分组信息
```

- [ ] **Step 3: Commit**

```bash
git add tools/expense/index.html tools/expense/README.md
git commit -m "chore: bump version to v1.2.0, update README changelog"
```