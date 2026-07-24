# Time 快捷编辑器紧凑布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将快捷事项主输入面板压缩到 390×844 下不超过 180px，并让日期编辑成为可取消、可确认、退出后恢复标题键盘的独占临时会话。

**Architecture:** `quick-editor-state.js` 负责日程字段快照、临时草稿和最终合并等纯数据逻辑；`app.js` 只协调页面表单、日期会话、分层返回、焦点和持久化。`index.html` 用一个可整体隐藏的主输入容器分隔键盘态与日期态，`style.css` 根据 `data-surface` 提供紧凑键盘布局和全高日期布局。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js `node:test`、Service Worker app-shell 缓存。

## Global Constraints

- 不新增第三方依赖，不改变数据库结构。
- 390×844 浏览器视口中，键盘主输入面板高度必须不高于 180px。
- 所有工具、设置行、取消和确认按钮的点击目标至少 44×44px。
- 日期取消必须丢弃临时日程修改；日期确认必须一次性写回全部日程字段。
- 日期页取消、确认和 Escape 均返回标题输入末尾并重新聚焦。
- 时间、提醒、重复二级面板确认或取消后均返回日期主页。
- 键盘主输入态继续锁定文档触摸滚动；日期及其二级面板允许自身内部滚动。
- 不尝试隐藏 iOS/Safari 系统键盘导航栏，不使用 `contenteditable` 或焦点顺序规避。
- 保留背景 `inert`、创建草稿、任务/习惯编辑、全屏详细信息和减少动画行为。

---

## File Map

- `tools/time/js/quick-editor-state.js`：新增纯函数日期会话 API，复制和合并固定日程字段。
- `tools/time/js/quick-editor-state.test.js`：覆盖快照隔离、临时更新、取消不变和确认合并。
- `tools/time/js/app.js`：管理 `appState.quickDateSession`、日期独占态、父子面板返回、验证、持久化和焦点。
- `tools/time/js/quick-editor-runtime.test.js`：覆盖日期会话取消/确认、Escape、关闭清理及标题回焦。
- `tools/time/index.html`：删除拖动指示，增加可整体隐藏的 `quick-primary-panel`。
- `tools/time/css/style.css`：紧凑键盘态、日期独占态、固定操作栏和 44px 热区。
- `tools/time/js/quick-editor-contract.test.js`：更新 DOM/CSS/源码/缓存契约。
- `tools/time/sw.js`：升级 app-shell 版本和变更资源查询版本。
- `tools/time/CHANGELOG.md`：记录面板紧凑化、日期事务和 iOS 边界。

### Task 1: 日期临时会话纯数据模型

**Files:**
- Modify: `tools/time/js/quick-editor-state.test.js`
- Modify: `tools/time/js/quick-editor-state.js`

**Interfaces:**
- Consumes: 现有标准事项草稿对象。
- Produces:
  - `createDateSession(draft) -> { original, draft }`
  - `updateDateSession(session, scheduleDraft) -> { original, draft }`
  - `applyDateSession(formDraft, session) -> formDraft`
  - 每个日程副本仅包含 `startDate`, `endDate`, `timeMode`, `startTime`, `endTime`, `repeat`, `customRepeat`, `reminder`, `customReminder`。

- [ ] **Step 1: 写日期会话失败测试**

在 `quick-editor-state.test.js` 追加：

```js
test('date session snapshots schedule fields without sharing nested custom values', () => {
  const form = {
    title: '开会',
    startDate: '2026-07-24',
    endDate: '2026-07-24',
    timeMode: 'range',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'custom',
    customRepeat: { interval: 2, unit: 'week' },
    reminder: 'custom',
    customReminder: { days: 0, hours: 1, minutes: 0 }
  };
  const session = Editor.createDateSession(form);
  session.draft.customReminder.hours = 3;

  assert.equal(session.original.customReminder.hours, 1);
  assert.equal(form.customReminder.hours, 1);
  assert.equal(session.draft.title, undefined);
});

test('date session updates only its draft and confirmation merges only schedule fields', () => {
  const form = {
    title: '原标题',
    notes: '原备注',
    startDate: '2026-07-24',
    endDate: '2026-07-24',
    timeMode: 'all-day',
    startTime: '',
    endTime: '',
    repeat: 'none',
    customRepeat: null,
    reminder: 'none',
    customReminder: null
  };
  const originalSession = Editor.createDateSession(form);
  const updatedSession = Editor.updateDateSession(originalSession, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'point',
    startTime: '09:30',
    endTime: '',
    repeat: 'daily',
    customRepeat: null,
    reminder: '15',
    customReminder: null
  });
  const committed = Editor.applyDateSession(
    Object.assign({}, form, { title: '输入期间改过的标题' }),
    updatedSession
  );

  assert.equal(originalSession.draft.startDate, '2026-07-24');
  assert.equal(updatedSession.original.startDate, '2026-07-24');
  assert.equal(committed.title, '输入期间改过的标题');
  assert.equal(committed.startDate, '2026-07-25');
  assert.equal(committed.endDate, '2026-07-26');
  assert.equal(form.startDate, '2026-07-24');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test tools/time/js/quick-editor-state.test.js
```

Expected: FAIL，提示 `Editor.createDateSession is not a function`。

- [ ] **Step 3: 实现最小日期会话 API**

在 `quick-editor-state.js` 的日期草稿函数附近加入：

```js
  var SCHEDULE_FIELDS = [
    'startDate', 'endDate', 'timeMode', 'startTime', 'endTime',
    'repeat', 'customRepeat', 'reminder', 'customReminder'
  ];

  function cloneValue(value) {
    if (value === null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function pickSchedule(draft) {
    draft = draft || {};
    return SCHEDULE_FIELDS.reduce(function(result, field) {
      result[field] = cloneValue(draft[field]);
      return result;
    }, {});
  }

  function createDateSession(draft) {
    var schedule = pickSchedule(draft);
    return { original: pickSchedule(schedule), draft: pickSchedule(schedule) };
  }

  function updateDateSession(session, scheduleDraft) {
    return {
      original: pickSchedule(session && session.original),
      draft: pickSchedule(scheduleDraft)
    };
  }

  function applyDateSession(formDraft, session) {
    return Object.assign({}, formDraft || {}, pickSchedule(session && session.draft));
  }
```

把导出对象改为：

```js
  return {
    createSessionState, transition, normalizeDraft, validateDraft, validateSchedule,
    setDraftDate, setPending, defaultEndTime, createChildDraft, applyChildDraft,
    createDateSession, updateDateSession, applyDateSession, parseStoredDraft
  };
```

- [ ] **Step 4: 运行状态测试并确认通过**

Run:

```bash
node --test tools/time/js/quick-editor-state.test.js
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交纯状态模型**

```bash
git add tools/time/js/quick-editor-state.js tools/time/js/quick-editor-state.test.js
git commit -m "feat(time): add transactional date sessions"
```

### Task 2: 日期会话控制器、分层返回与焦点恢复

**Files:**
- Modify: `tools/time/js/quick-editor-runtime.test.js`
- Modify: `tools/time/js/app.js`

**Interfaces:**
- Consumes: Task 1 的 `createDateSession`, `updateDateSession`, `applyDateSession`。
- Produces:
  - `beginQuickDateSession()`
  - `readQuickDateDraft()`
  - `writeQuickDateDraft(draft)`
  - `cancelQuickDateSession()`
  - `confirmQuickDateSession() -> boolean`
  - `returnQuickToKeyboard()`。

- [ ] **Step 1: 扩展运行时测试桩和测试钩子**

在 `createElement()` 中让 `focus()`/`blur()`维护 `document.activeElement`；元素创建后由闭包注入 `ownerDocument`：

```js
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
      this.focusCount = (this.focusCount || 0) + 1;
    },
    blur() {
      if (this.ownerDocument && this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = null;
      }
    },
```

把 `document` 声明放到 `get()` 之前，并在创建元素后设置：

```js
  let document;
  const get = id => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    const element = elements.get(id);
    element.ownerDocument = document;
    return element;
  };
```

把后面创建文档测试桩的 `const document =` 改为赋值语句 `document =`，避免 `get()` 首次调用时访问暂时性死区；对象体保持原样。

为 instrumented hooks 暴露：

```js
      beginQuickDateSession: beginQuickDateSession,
      cancelQuickDateSession: cancelQuickDateSession,
      confirmQuickDateSession: confirmQuickDateSession,
      writeQuickDateDraft: writeQuickDateDraft,
      trapQuickEditorFocus: trapQuickEditorFocus,
      readQuickDraft: readQuickDraft,
```

- [ ] **Step 2: 写日期取消、确认和 Escape 失败测试**

在 `quick-editor-runtime.test.js` 追加：

```js
test('date cancel discards temporary schedule changes and refocuses the title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    repeat: 'daily',
    reminder: '15'
  }));
  runtime.hooks.cancelQuickDateSession();

  const after = runtime.hooks.readQuickDraft();
  assert.equal(after.startDate, before.startDate);
  assert.equal(after.repeat, before.repeat);
  assert.equal(runtime.hooks.getState().quickDateSession, null);
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.elements.get('quick-title').focusCount > 0, true);
});

test('date confirmation applies the full temporary schedule and refocuses the title', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  const before = runtime.hooks.readQuickDraft();

  runtime.hooks.beginQuickDateSession();
  runtime.hooks.writeQuickDateDraft(Object.assign({}, before, {
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    timeMode: 'point',
    startTime: '09:30',
    repeat: 'daily',
    reminder: '15'
  }));

  assert.equal(runtime.hooks.confirmQuickDateSession(), true);
  const after = runtime.hooks.readQuickDraft();
  assert.deepEqual(
    [after.startDate, after.endDate, after.timeMode, after.startTime, after.repeat, after.reminder],
    ['2026-07-25', '2026-07-26', 'point', '09:30', 'daily', '15']
  );
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
});

test('escape from the date parent cancels only the date session', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();
  runtime.hooks.beginQuickDateSession();
  let prevented = 0;

  runtime.hooks.trapQuickEditorFocus({
    key: 'Escape',
    preventDefault() { prevented += 1; }
  });

  assert.equal(prevented, 1);
  assert.equal(runtime.hooks.getState().quickEditor.session, 'open');
  assert.equal(runtime.hooks.getState().quickEditor.surface, 'keyboard');
  assert.equal(runtime.hooks.getState().quickDateSession, null);
});
```

- [ ] **Step 3: 运行运行时测试并确认失败**

Run:

```bash
node --test tools/time/js/quick-editor-runtime.test.js
```

Expected: FAIL，提示新的日期会话 hooks/状态不存在。

- [ ] **Step 4: 增加日期会话状态和基本控制函数**

在 `appState` 增加：

```js
    quickEditor: QuickEditor.createSessionState(),
    quickDateSession: null,
    quickScrollY: 0
```

在 `readQuickDraft()` 后增加：

```js
  function beginQuickDateSession() {
    if (!appState.quickDateSession) {
      appState.quickDateSession = QuickEditor.createDateSession(readQuickDraft());
    }
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
      type: 'OPEN_TOOL',
      tool: 'date'
    });
  }

  function readQuickDateDraft() {
    if (!appState.quickDateSession) beginQuickDateSession();
    return Object.assign({}, readQuickDraft(), appState.quickDateSession.draft);
  }

  function writeQuickDateDraft(draft) {
    if (!appState.quickDateSession) beginQuickDateSession();
    appState.quickDateSession = QuickEditor.updateDateSession(appState.quickDateSession, draft);
  }

  function returnQuickToKeyboard() {
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SHOW_KEYBOARD' });
    renderQuickSurface();
    focusQuickTitle();
  }

  function cancelQuickDateSession() {
    appState.quickDateSession = null;
    appState.quickChildDraft = null;
    appState.quickChildWheels = null;
    returnQuickToKeyboard();
  }

  function confirmQuickDateSession() {
    if (!appState.quickDateSession) {
      returnQuickToKeyboard();
      return false;
    }
    var merged = QuickEditor.applyDateSession(readQuickDraft(), appState.quickDateSession);
    var validity = QuickEditor.validateSchedule(merged);
    if (!validity.valid) {
      var error = quickPanelHost().querySelector('.quick-date-session-error');
      if (error) error.textContent = validity.message;
      return false;
    }
    applyQuickDraft(merged);
    appState.quickDateSession = null;
    if (!appState.editingTaskId) persistCreateDraft();
    returnQuickToKeyboard();
    return true;
  }
```

确保 `closeQuickSession()` 在任何 DOM 关闭前清理：

```js
    appState.quickDateSession = null;
    appState.quickChildDraft = null;
    appState.quickChildWheels = null;
```

- [ ] **Step 5: 把全部日期编辑切到临时草稿**

将 `setQuickSurface()` 完整替换为：

```js
  function setQuickSurface(surface) {
    if (!QuickEditor || !surface) return;
    if (appState.quickEditor.surface === surface && surface !== 'detail') {
      if (surface === 'date') {
        cancelQuickDateSession();
      } else {
        returnQuickToKeyboard();
      }
      return;
    }
    if (surface === 'date') {
      if (document.activeElement === els.quickTitle || document.activeElement === els.quickNotes) {
        document.activeElement.blur();
      }
      beginQuickDateSession();
      renderQuickSurface();
      return;
    }
    if (appState.quickEditor.surface === 'date') appState.quickDateSession = null;
    if (document.activeElement === els.quickTitle || document.activeElement === els.quickNotes) {
      document.activeElement.blur();
    }
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
      type: surface === 'detail' ? 'OPEN_DETAIL' : 'OPEN_TOOL',
      tool: surface
    });
    renderQuickSurface();
  }
```

日期父页、待定和二级面板分别使用：

```js
  function applyPendingDate() {
    writeQuickDateDraft(QuickEditor.setPending(readQuickDateDraft()));
    renderDateParent(true);
  }

  function applyQuickDateSelection(dateKey) {
    var draft = readQuickDateDraft();
    var wasClamped = appState.quickEditor.datePhase === 'end' &&
      Boolean(draft.startDate) && dateKey < draft.startDate;
    writeQuickDateDraft(
      QuickEditor.setDraftDate(draft, appState.quickEditor.datePhase, dateKey)
    );
    if (wasClamped) showToast('结束日期不能早于开始日期，已调整为开始日期');
    renderDateParent();
  }

  function commitDateChild() {
    var merged = QuickEditor.applyChildDraft(readQuickDateDraft(), appState.quickChildDraft);
    var validity = QuickEditor.validateSchedule(merged);
    if (!validity.valid) {
      var error = quickPanelHost().querySelector('.quick-date-child-error');
      if (error) error.textContent = validity.message;
      return false;
    }
    writeQuickDateDraft(merged);
    return true;
  }
```

把日期渲染、`hasScheduleDependentValues` 和 `createChildDraft` 的数据源从 `readQuickDraft()` 改为 `readQuickDateDraft()`。日期父页的时间摘要直接从临时草稿计算：

```js
    var timeLabel = draft.timeMode === 'all-day'
      ? '全天'
      : draft.timeMode === 'range'
        ? (draft.startTime || '开始') + '–' + (draft.endTime || '结束')
        : (draft.startTime || '时间点');
```

将 `quick-date-time-summary` 的内容从 `getQuickSummary().timeLabel` 改为 `timeLabel`。二级取消仍只清空 `quickChildDraft` 后返回父页。

- [ ] **Step 6: 修改 Escape 分层语义**

将非全屏日期分支改为：

```js
    } else if (appState.quickEditor.surface === 'date' &&
               appState.quickEditor.dateChild !== 'none') {
      finishDateChild(false);
    } else if (appState.quickEditor.surface === 'date') {
      cancelQuickDateSession();
    } else if (appState.quickEditor.surface !== 'keyboard') {
      returnQuickToKeyboard();
```

待定二次确认的 Escape 仍只回日期主页，不取消整个日期会话。

- [ ] **Step 7: 运行状态与运行时测试**

Run:

```bash
node --test tools/time/js/quick-editor-state.test.js tools/time/js/quick-editor-runtime.test.js
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交日期控制器**

```bash
git add tools/time/js/app.js tools/time/js/quick-editor-runtime.test.js
git commit -m "feat(time): make date editing transactional"
```

### Task 3: 紧凑主输入态与日期独占布局

**Files:**
- Modify: `tools/time/js/quick-editor-contract.test.js`
- Modify: `tools/time/index.html`
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/css/style.css`

**Interfaces:**
- Consumes: Task 2 的日期会话控制函数。
- Produces:
  - `#quick-primary-panel`：包含标题、备注、工具栏和摘要，可通过 `hidden` 从布局与无障碍树移除。
  - `#quick-sheet[data-surface="keyboard|date|priority|area|tone|detail"]`。
  - `.quick-date-footer`、`[data-date-cancel]`、`[data-date-confirm]` 和 `.quick-date-session-error`。

- [ ] **Step 1: 先修改契约测试为新 DOM 和布局要求**

把拖动指示断言替换为：

```js
test('quick editor separates the compact primary panel from one replacement region', () => {
  assert.doesNotMatch(html, /quick-drag-handle/);
  assert.match(html, /id="quick-primary-panel"/);
  assert.match(html, /id="quick-summary"[^>]*aria-live="polite"/);
  assert.equal((html.match(/id="quick-extra-panel"/g) || []).length, 1);
});
```

替换旧日期高度契约并补充：

```js
test('keyboard surface is compact and date surface owns the full sheet', () => {
  assert.match(css, /\.quick-sheet-v2\[data-surface="keyboard"\]\s*\{[^}]*max-height:\s*180px;/s);
  assert.match(css, /\.quick-sheet-v2\[data-surface="keyboard"\] \.quick-form-v2\s*\{[^}]*padding-bottom:\s*0;/s);
  assert.match(css, /\.quick-sheet-v2\[data-surface="date"\]\s*\{[^}]*height:\s*calc\(var\(--quick-viewport-height,\s*100vh\)\s*-\s*4px\);/s);
  assert.match(css, /\.quick-date-footer button\s*\{[^}]*min-height:\s*52px;/s);
  assert.match(app, /els\.quickPrimaryPanel\.hidden\s*=\s*state\.surface\s*===\s*'date'/);
  assert.match(app, /data-date-cancel/);
  assert.match(app, /data-date-confirm/);
});
```

删除所有要求 `.quick-drag-handle` 存在或有 44px 高度的断言，并保留其它 44px 控件契约。

- [ ] **Step 2: 运行契约测试并确认失败**

Run:

```bash
node --test tools/time/js/quick-editor-contract.test.js
```

Expected: FAIL，指出旧拖动指示仍存在、主面板容器和日期 footer 尚不存在。

- [ ] **Step 3: 更新 HTML 结构**

删除：

```html
<div class="quick-drag-handle" id="quick-drag-handle" aria-hidden="true"><span></span></div>
```

在 `<div class="quick-inputs">` 前插入：

```html
<div class="quick-primary-panel" id="quick-primary-panel">
```

在 `<div class="quick-summary" id="quick-summary" aria-live="polite"></div>` 后、`quick-extra-panel` 前插入：

```html
</div>
```

结果是 `quick-primary-panel` 精确包含现有 `quick-inputs`、`quick-toolbar` 和 `quick-summary`，而所有隐藏字段与 `quick-extra-panel` 仍是它的同级节点。

隐藏字段仍放在 `quick-form` 根部，确保日期确认可写回同一表单。

- [ ] **Step 4: 同步页面缓存与 surface 语义**

在 `cacheElements()` 中删除：

```js
els.quickDragHandle = $('quick-drag-handle');
```

并增加：

```js
els.quickPrimaryPanel = $('quick-primary-panel');
```

在 `renderQuickSurface()` 的工具状态更新之后加入：

```js
    els.quickSheet.dataset.surface = state.surface;
    els.quickPrimaryPanel.hidden = state.surface === 'date';
```

键盘态继续隐藏并清空 `quick-extra-panel`。日期态渲染完成后，把焦点移到当前日期阶段标签：

```js
    var activeTab = quickPanelHost().querySelector(
      '[data-date-phase="' + appState.quickEditor.datePhase + '"]'
    );
    if (activeTab && document.activeElement !== activeTab) activeTab.focus();
```

只在首次进入日期父页时执行此聚焦，日历重绘不抢走用户当前焦点。

- [ ] **Step 5: 给日期父页增加底部取消/确认**

把 `renderDateParent()` 的 HTML 结尾扩展为：

```js
    html += '<p class="quick-date-session-error" aria-live="polite"></p>' +
      '<div class="quick-date-footer">' +
        '<button type="button" data-date-cancel="true">取消</button>' +
        '<button type="button" data-date-confirm="true">确认</button>' +
      '</div></div>';
```

并绑定：

```js
    quickPanelHost().querySelector('[data-date-cancel]')
      .addEventListener('click', cancelQuickDateSession);
    quickPanelHost().querySelector('[data-date-confirm]')
      .addEventListener('click', confirmQuickDateSession);
```

- [ ] **Step 6: 实现紧凑键盘 CSS**

删除 `.quick-drag-handle` 和 `.quick-drag-handle span` 两组规则，加入：

```css
.quick-sheet-v2[data-surface="keyboard"] {
  max-height: 180px;
}

.quick-sheet-v2[data-surface="keyboard"] .quick-form-v2 {
  padding-bottom: 0;
}

.quick-primary-panel {
  display: flex;
  flex-direction: column;
}

.quick-primary-panel[hidden] {
  display: none;
}

.quick-inputs {
  padding: 8px 16px 2px;
}

.quick-title-input {
  line-height: 1.3;
  padding: 4px 0;
}

.quick-notes-input {
  min-height: 20px;
  max-height: 24px;
  line-height: 1.25;
  padding: 2px 0;
  overflow: hidden;
}

.quick-toolbar {
  padding: 2px 12px 2px;
}

.quick-summary {
  min-height: 18px;
  padding: 0 16px 4px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

保留 `.quick-tool-btn` 与 `.quick-send-btn` 的 44×44px，不缩小触控目标。

- [ ] **Step 7: 实现日期独占和 sticky footer CSS**

用 `data-surface` 替代旧 `:has()` 高度布局：

```css
.quick-sheet-v2[data-surface="date"] {
  height: calc(var(--quick-viewport-height, 100vh) - 4px);
  max-height: calc(var(--quick-viewport-height, 100vh) - 4px);
}

.quick-sheet-v2[data-surface="date"] .quick-form-v2 {
  height: 100%;
  padding-bottom: env(safe-area-inset-bottom);
}

.quick-sheet-v2[data-surface="date"] .quick-extra-panel {
  display: block;
  flex: 1;
  max-height: none;
  overflow-y: auto;
}

.quick-datetime-panel {
  min-height: 100%;
}

.quick-date-session-error {
  min-height: 20px;
  margin: 0;
  padding: 0 16px 4px;
  color: var(--danger);
  font-size: 13px;
}

.quick-date-footer {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.quick-date-footer button {
  min-height: 52px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}

.quick-date-footer [data-date-confirm] {
  color: var(--primary);
  font-weight: var(--weight-semibold);
  border-left: 1px solid var(--border);
}
```

保留 `.quick-extra-panel` 的 `overflow-y: auto` 与 `overscroll-behavior: contain`，使日期自身可滚动但不传递到底层页面。

- [ ] **Step 8: 运行快捷编辑器三组测试**

Run:

```bash
node --test \
  tools/time/js/quick-editor-state.test.js \
  tools/time/js/quick-editor-runtime.test.js \
  tools/time/js/quick-editor-contract.test.js
```

Expected: 全部 PASS。

- [ ] **Step 9: 提交布局与交互**

```bash
git add \
  tools/time/index.html \
  tools/time/css/style.css \
  tools/time/js/app.js \
  tools/time/js/quick-editor-contract.test.js
git commit -m "feat(time): compact the quick editor layout"
```

### Task 4: 缓存、变更记录与完整回归

**Files:**
- Modify: `tools/time/js/quick-editor-contract.test.js`
- Modify: `tools/time/sw.js`
- Modify: `tools/time/CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1–3 的最终静态资源。
- Produces: 新 app-shell cache 名称及 `style.css`, `quick-editor-state.js`, `app.js` 查询版本。

- [ ] **Step 1: 写缓存版本失败契约**

在 `quick-editor-contract.test.js` 的缓存测试中要求：

```js
  assert.match(sw, /const CACHE_NAME = 'today-youxu-v58'/);
  assert.match(sw, /\/tools\/time\/css\/style\.css\?v=162/);
  assert.match(sw, /\/tools\/time\/js\/quick-editor-state\.js\?v=3/);
  assert.match(sw, /\/tools\/time\/js\/app\.js\?v=165/);
```

- [ ] **Step 2: 运行缓存契约并确认失败**

Run:

```bash
node --test tools/time/js/quick-editor-contract.test.js
```

Expected: FAIL，显示仍为 `v57`、CSS `v161`、state `v2`、app `v164`。

- [ ] **Step 3: 升级 Service Worker 资源版本**

在 `tools/time/sw.js` 精确更新：

```js
const CACHE_NAME = 'today-youxu-v58';
```

以及：

```js
  '/tools/time/css/style.css?v=162',
  '/tools/time/js/quick-editor-state.js?v=3',
  '/tools/time/js/app.js?v=165',
```

- [ ] **Step 4: 更新 Changelog**

在 `tools/time/CHANGELOG.md` 顶部追加：

```md
## v0.10.1 (2026-07-24)

### 优化
- 移除快捷事项面板的装饰性滑动指示，压缩输入、工具栏和键盘之间的网页留白；44px 触控目标保持不变。
- 日期编辑改为独占底部弹层，新增整页“取消 / 确认”；时间、提醒、重复仍在二级面板完成后返回日期主页。

### 修复
- 日期设置现在使用临时会话：取消或 Escape 完整回滚，确认后一次性写回，并在返回时重新聚焦标题输入。
- 关闭整个事项编辑器时会丢弃未确认的日期临时状态，避免半提交。

### 兼容
- iOS 键盘上一项、下一项和完成栏属于系统界面，网页端不做不受支持的隐藏处理。

### 技术
- Service Worker 缓存升级至 v58；CSS v162、快捷编辑器状态 v3、主程序 v165。
```

- [ ] **Step 5: 运行完整 Time 测试与语法检查**

Run:

```bash
node --check tools/time/js/quick-editor-state.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
node --test tools/time/js/*.test.js
```

Expected: 三个语法检查退出码均为 0；完整测试全部 PASS（当前基线 233 项，新增测试后总数应大于 233）。

- [ ] **Step 6: 提交缓存和记录**

```bash
git add \
  tools/time/sw.js \
  tools/time/CHANGELOG.md \
  tools/time/js/quick-editor-contract.test.js
git commit -m "chore(time): refresh quick editor assets"
```

### Task 5: 390×844 视觉验收和 PR 更新

**Files:**
- Verify only: `tools/time/index.html`
- Verify only: `tools/time/css/style.css`
- Verify only: `tools/time/js/app.js`

**Interfaces:**
- Consumes: 本地 `tools/time/` 页面及现有草稿 PR #19。
- Produces: 390×844 截图、交互验收记录和已推送的分支。

- [ ] **Step 1: 启动本地静态服务**

Run:

```bash
python3 -m http.server 65030
```

Expected: 服务监听 `http://localhost:65030/`；保持该进程运行用于浏览器验收。

- [ ] **Step 2: 在用户已选浏览器中以 390×844 验收键盘态**

打开 `/tools/time/`，点击新增事项并检查：

```text
quick-sheet data-surface = keyboard
quick-primary-panel 可见
quick-extra-panel 隐藏
quick-sheet.getBoundingClientRect().height <= 180
标题、单行备注、五个快捷按钮、44px 保存按钮和单行摘要均可见
触摸拖动面板或背景不会改变页面滚动位置
```

Expected: 五项全部满足；面板顶端无滑动指示，面板底部无额外网页安全区空白。

- [ ] **Step 3: 验收日期独占态和事务语义**

执行：

```text
设置一组原日期/时间/提醒/重复
打开日期工具并更改全部四类值
确认标题区、工具栏和摘要均从视觉及焦点顺序隐藏
依次进入时间、提醒、重复，分别验证取消和确认都回到日期主页
点击日期取消，确认原四类值全部恢复且标题重新聚焦
再次修改并点击日期确认，确认新四类值保留且标题重新聚焦
打开日期后按 Escape，确认事项编辑器仍打开且日期改动回滚
```

Expected: 所有分层返回、回滚、提交和聚焦行为与设计规格一致。

- [ ] **Step 4: 对照截图做视觉检查**

在相同 390×844 视口分别截取键盘态和日期态，检查：

```text
边距均衡，无裁切、重叠或断裂圆角
日期首屏显示开始/结束、月份、日历、快捷日期、时间/提醒/重复、取消/确认
所有文本字号、颜色和间隔沿用现有设计变量
prefers-reduced-motion 下没有新增位移动画
```

Expected: 无可见布局缺陷；若日期内容因系统字体放大需要滚动，footer 仍固定可见且背景不滚动。

- [ ] **Step 5: 真机验收清单交给用户**

明确记录网页端不能移除 iOS 键盘系统导航栏，并请用户在 iPhone 检查：

```text
键盘上方只剩系统导航栏，没有额外网页留白
键盘态面板和底层页面均不可滑动
日期页收起键盘并独占弹层
日期取消/确认都回到标题与键盘
```

- [ ] **Step 6: 最终验证、推送并更新草稿 PR**

Run:

```bash
git status -sb
git log --oneline origin/fix/time-quick-editor-scroll-lock..HEAD
git push origin fix/time-quick-editor-scroll-lock
```

Expected: 推送成功，工作树干净；草稿 PR #19 自动包含设计规格、实现计划和所有实现提交。
