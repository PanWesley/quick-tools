# Time 快捷编辑器 iOS 滚动锁修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 禁止 iOS 键盘主输入态中的快捷面板拖动和底层页面滚动，同时保留二级面板与全屏详情的内部滚动。

**Architecture:** 移除快捷面板自身的拖拽状态机，让顶部短横线退化为纯装饰元素；复用现有非被动 `touchmove` 入口，在快捷编辑器键盘主输入态调用 `preventDefault()`。现有 `body.quick-editor-open`、滚动位置恢复和背景 `inert` 继续负责布局锁与交互锁。

**Tech Stack:** 原生 JavaScript、CSS、Node.js `node:test`、VM 运行时测试、Service Worker 资源缓存。

## Global Constraints

- 顶部短横线保留，但不能拖动或下滑关闭快捷面板。
- 键盘主输入态的单指滑动不能移动面板或底层页面。
- 日期、提醒、重复、滚轮选择器和全屏详情的内部滚动必须保留。
- 点击遮罩、保存以及既有键盘返回链路不得回归。
- 不新增依赖，不重构与滚动锁无关的业务逻辑。
- 桌面浏览器验证不能替代最终 iPhone 真机验收。

---

### Task 1: 移除面板拖拽并锁住键盘主输入态

**Files:**
- Modify: `tools/time/js/app.js:62,329-360,1715-1789,3689`
- Modify: `tools/time/css/style.css:3635-3675`
- Modify: `tools/time/js/quick-editor-contract.test.js`
- Modify: `tools/time/js/quick-editor-runtime.test.js`

**Interfaces:**
- Consumes: `isQuickEditorOpen(): boolean`、`appState.quickEditor.surface`、现有 `handleSwipeMove(event)` 文档级非被动触摸入口。
- Produces: 键盘主输入态中的 `touchmove` 默认行为抑制；不再存在 `quickDrag`、`bindQuickDragHandle()`、`finishQuickDrag()`、`.is-dragging` 或 `--quick-drag-offset`。

- [ ] **Step 1: 写入失败的契约测试**

在 `tools/time/js/quick-editor-contract.test.js` 中做三处契约更新：

1. 在“scroll lock”测试中，把旧的快捷编辑器直接返回断言：

```js
assert.match(app, /if \(isQuickEditorOpen\(\)\) return;/);
```

替换为键盘态触摸锁断言：

```js
assert.match(app, /if \(isQuickEditorOpen\(\)\)[\s\S]*surface === 'keyboard'[\s\S]*event\.preventDefault\(\);[\s\S]*return;/);
```

2. 把原“仅拖拽条可关闭”测试替换为：

```js
test('quick editor handle is decorative and cannot translate or dismiss the sheet', () => {
  assert.doesNotMatch(app, /var quickDrag/);
  assert.doesNotMatch(app, /function bindQuickDragHandle/);
  assert.doesNotMatch(app, /function finishQuickDrag/);
  assert.doesNotMatch(app, /--quick-drag-offset/);
  assert.doesNotMatch(css, /\.quick-sheet-v2\.is-dragging/);
  assert.match(html, /id="quick-drag-handle"[^>]*aria-hidden="true"/);
});
```

3. 把“编辑结束日期并重置拖拽状态”测试改名为“编辑会隔离结束日期”，删除其中对 `quickDrag`、`.is-dragging` 和 `--quick-drag-offset` 清理的旧断言，只保留：

```js
test('app isolates edit end dates between task and habit sessions', () => {
  assert.match(app, /function openEditTask[\s\S]*els\.quickEndDate\.value = task\.endDate \|\| task\.date \|\| '';/);
  assert.match(app, /function openEditHabit[\s\S]*els\.quickEndDate\.value = habit\.startDate \|\| appState\.todayKey;/);
});
```

- [ ] **Step 2: 写入失败的运行时触摸测试**

在 `tools/time/js/quick-editor-runtime.test.js` 的 instrumented hooks 中暴露：

```js
handleSwipeMove: handleSwipeMove,
setQuickSurface: function(surface) {
  appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
    type: surface === 'keyboard' ? 'SHOW_KEYBOARD' : 'OPEN_TOOL',
    tool: surface
  });
}
```

新增三个断言：

```js
test('keyboard quick editor prevents viewport touch scrolling without blocking replacement panels', () => {
  const runtime = createRuntime();
  runtime.hooks.setData({ tasks: [], habits: [] });
  runtime.hooks.openCreate();

  let prevented = 0;
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 40 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);

  runtime.hooks.setQuickSurface('date');
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 20 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);

  runtime.hooks.closeQuickSession({ keepDraft: false });
  runtime.hooks.handleSwipeMove({
    touches: [{ clientX: 10, clientY: 10 }],
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 1);
});
```

若现有 runtime hooks 没有创建入口，增加：

```js
openCreate: function() {
  openQuickSession('create', {
    startDate: appState.todayKey,
    endDate: appState.todayKey
  });
}
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
node --test tools/time/js/quick-editor-contract.test.js tools/time/js/quick-editor-runtime.test.js
```

Expected: FAIL；契约测试命中仍存在的 `quickDrag`/`.is-dragging`，运行时测试显示键盘主输入态没有调用 `preventDefault()`。

- [ ] **Step 4: 实现最小触摸锁**

将 `handleSwipeMove(event)` 完整替换为：

```js
function handleSwipeMove(event) {
  if (isQuickEditorOpen()) {
    if (!isQuickFullPanelOpen() && appState.quickEditor.surface === 'keyboard') {
      event.preventDefault();
    }
    return;
  }
  if (!swipeState || !event.touches || event.touches.length !== 1) return;
  var touch = event.touches[0];
  swipeState.currentX = touch.clientX;
  swipeState.currentY = touch.clientY;
  var dx = swipeState.currentX - swipeState.startX;
  var dy = swipeState.currentY - swipeState.startY;
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) && dx < 0) {
    event.preventDefault();
  }
}
```

该入口已经通过以下非被动监听注册，不新增重复监听器：

```js
document.addEventListener('touchmove', handleSwipeMove, { passive: false });
```

- [ ] **Step 5: 删除面板拖拽状态机**

从 `tools/time/js/app.js` 删除：

```js
var quickDrag = null;
```

从 `closeQuickSession()` 删除 `activeQuickDrag`、pointer capture 释放、`.is-dragging` 和 `--quick-drag-offset` 清理。

完整删除 `finishQuickDrag` 和 `bindQuickDragHandle` 两个函数定义，包括其中所有 pointer capture、CSS class 和 CSS variable 操作。

从 `bindEvents()` 删除：

```js
if (els.quickDragHandle) bindQuickDragHandle();
```

从 `tools/time/css/style.css` 删除：

```css
.quick-sheet-v2.is-dragging {
  transform: translateY(var(--quick-drag-offset, 0px));
}
```

保留 `.quick-drag-handle` 和内部短横线样式。

- [ ] **Step 6: 运行定向测试并确认 GREEN**

Run:

```bash
node --test tools/time/js/quick-editor-contract.test.js tools/time/js/quick-editor-runtime.test.js
```

Expected: PASS；运行时测试确认键盘态阻止触摸默认行为，日期替换面板和关闭态不阻止。

- [ ] **Step 7: 提交行为修复**

```bash
git add tools/time/js/app.js tools/time/css/style.css tools/time/js/quick-editor-contract.test.js tools/time/js/quick-editor-runtime.test.js
git commit -m "fix(time): lock quick editor touch scrolling"
```

---

### Task 2: 更新缓存契约并完成回归验证

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/sw.js`
- Modify: `tools/time/js/notification-integration.test.js`
- Modify: `tools/time/js/service-worker-notification.test.js`
- Modify: `tools/time/CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1 修改后的 `app.js` 和 `style.css`。
- Produces: 新资源版本、Service Worker 新缓存名、与页面严格一致的发布资源测试。

- [ ] **Step 1: 写入失败的缓存契约**

先在两份发布契约测试中把预期版本提升为：

```js
'/tools/time/css/style.css?v=161'
'/tools/time/js/app.js?v=164'
```

并在 `tools/time/js/service-worker-notification.test.js` 中把缓存名预期改为：

```js
assert.match(swSource, /const CACHE_NAME = ['"]today-youxu-v57['"]/);
```

- [ ] **Step 2: 运行缓存测试并确认 RED**

Run:

```bash
node --test tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js
```

Expected: FAIL；`index.html` 与 `sw.js` 仍指向 CSS v160、App v163、缓存 v56。

- [ ] **Step 3: 更新页面与 Service Worker 资源版本**

在 `tools/time/index.html` 和 `tools/time/sw.js` 中统一：

```text
/tools/time/css/style.css?v=161
/tools/time/js/app.js?v=164
```

在 `tools/time/sw.js` 中设置：

```js
const CACHE_NAME = 'today-youxu-v57';
```

- [ ] **Step 4: 补充变更日志**

在 `tools/time/CHANGELOG.md` 的 v0.10.0“修复”中增加：

```markdown
- 修复 iOS 键盘弹出后仍可拖动快捷面板并带动底层页面的问题；主输入态现在完全锁定触摸滚动。
```

- [ ] **Step 5: 运行缓存契约并确认 GREEN**

Run:

```bash
node --test tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js
```

Expected: PASS；页面和 Service Worker 的 CSS/App 资源版本完全一致。

- [ ] **Step 6: 运行完整自动化验证**

Run:

```bash
node --test tools/time/js/*.test.js
node --check tools/time/js/app.js
node --check tools/time/js/quick-editor-state.js
node --check tools/time/js/db.js
node --check tools/time/sw.js
git diff --check
```

Expected: 所有测试通过、四个语法检查退出码为 0、`git diff --check` 无输出。

- [ ] **Step 7: 完成 390×844 浏览器验证**

验证状态：

```text
1. 新建事项后 quick-title 自动聚焦。
2. body.quick-editor-open 保持生效，背景元素保持 inert。
3. 顶部短横线没有 pointer 监听和位移状态，面板 rect 在模拟拖动前后不变。
4. 日期面板仍能打开，clientHeight/scrollHeight 与设置行位置没有回归。
5. 点击遮罩关闭后恢复原滚动位置。
```

记录限制：桌面浏览器不能声称通过 iOS 软件键盘与橡皮筋滚动真机验收。

- [ ] **Step 8: 提交发布集成**

```bash
git add tools/time/index.html tools/time/sw.js tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js tools/time/CHANGELOG.md
git commit -m "chore(time): release quick editor scroll lock"
```
