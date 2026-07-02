# 今日有序本地可靠性与编辑体验设计

日期：2026-07-02

## 目标

在已经上线的「今日有序」MVP 基础上，做第二个小版本：**本地可靠性 + 编辑体验 + 导入恢复**。

本版本目标是让用户更敢长期使用本地数据：任务可以改、误删可以恢复、导出的 JSON 可以重新导入。暂不进入账号同步、Web Push、复杂重复规则和统计图表。

## 范围

### 本次做

- 任务编辑：支持修改标题、备注、日期、优先级。
- 任务删除改进：删除仍为软删除，清单里提供最近删除入口。
- 任务恢复：最近删除任务可恢复为 active。
- JSON 导入：支持导入今日有序导出的 JSON。
- 导入安全：导入前展示数据数量摘要，用户确认后合并。
- 导入策略：按 `id` 合并，传入数据的 `updatedAt` 更新时覆盖本地较旧版本；本地较新版本保留。
- 导入结果提示：显示导入/更新/跳过数量。
- 数据版本检查：只接受 `app: "today-youxu"` 且 `version: 1` 的导出文件。
- 测试覆盖：纯函数覆盖导入校验、导入合并和任务分组。

### 本次不做

- 账号登录。
- 云同步。
- Web Push。
- 完整回收站页。
- 富文本日记。
- 图片或附件导入。
- 跨应用格式导入。
- CSV / ICS 导入。

## 用户体验

### 任务编辑

任务行增加「编辑」操作。点击后打开与快速新增一致的底部表单，但标题改为「编辑任务」。

编辑表单包含：

- 标题，必填。
- 日期，可空。
- 优先级。
- 备注。

保存后立即回到当前视图并刷新今日、日历、清单。

### 最近删除与恢复

清单页增加一个「最近删除」区块，显示 `status: deleted` 的任务，按 `deletedAt` 倒序排列。

每条删除任务提供：

- 恢复：恢复为 `active`，清空 `deletedAt`。
- 保留删除状态：不提供永久删除，避免误操作。

### JSON 导入

我的页在「本地数据」中增加「导入 JSON」按钮和隐藏文件选择器。

流程：

1. 用户选择 `.json` 文件。
2. 客户端读取并解析。
3. 校验 `app` 和 `version`。
4. 统计文件中的 tasks、habits、habitLogs、journals、opLogs 数量。
5. 弹出确认文案。
6. 用户确认后合并写入 IndexedDB。
7. 显示导入结果，并刷新所有视图。

导入不会清空本地数据。

## 数据合并规则

通用规则：

- 缺少 `id` 的记录跳过。
- 本地不存在同 ID，直接新增。
- 本地存在同 ID，比较 `updatedAt`。
- 传入 `updatedAt` 更新则覆盖。
- 本地更新则跳过。
- 缺少 `updatedAt` 的传入记录只在本地不存在时新增。

任务恢复：

- 恢复任务时写入 OpLog，action 为 `restore`。
- 恢复后的任务状态为 `active`。
- `deletedAt` 清空。
- `updatedAt` 更新为当前时间。

导入 OpLog：

- 外部 opLogs 可以导入保存，作为迁移历史。
- 本次导入本身也写入一条新的 OpLog，entityType 为 `import`，payload 记录导入统计。

## 技术设计

### 新增纯函数模块

新增 `tools/time/js/import-utils.js`：

- `validateImportPayload(payload)`
- `summarizeImportPayload(payload)`
- `mergeRecords(localRecords, incomingRecords)`
- `buildImportResult(localData, incomingPayload)`

该模块使用 CommonJS + browser global 双模式，便于 Node 测试和浏览器复用。

### DB 扩展

修改 `tools/time/js/db.js`：

- `restoreTask(id)`
- `importData(payload)`
- 内部新增批量合并写入逻辑。

`importData()` 负责读取本地所有 store，调用 `TodayYouxuImport.buildImportResult()`，然后在一个 readwrite transaction 中写入新增/更新数据和导入 OpLog。

### App 扩展

修改 `tools/time/index.html`：

- 快速表单增加 `quick-mode` 状态仍由 JS 控制。
- 本地数据区增加导入按钮和 file input。
- 清单页增加最近删除区块。

修改 `tools/time/js/app.js`：

- 新增 `editingTaskId` 状态。
- 支持打开编辑表单并回填任务。
- 快速表单 submit 时区分 create / edit。
- 新增恢复任务 action。
- 新增导入文件处理。
- 最近删除列表渲染。

### 样式

修改 `tools/time/css/style.css`：

- 任务行操作区适配「编辑 / 删除 / 恢复」。
- 最近删除区块使用低强调样式。
- 导入确认仍使用浏览器 `confirm()`，避免首版引入复杂 modal。

## 验收标准

- 任务可以编辑标题、日期、优先级、备注。
- 编辑后的任务在今日、日历、清单中同步更新。
- 删除任务后不再出现在今日待办，但出现在最近删除。
- 恢复任务后重新出现在对应列表。
- 我的页可以选择今日有序 JSON 文件导入。
- 非今日有序 JSON 会被拒绝并提示。
- 导入不会清空本地已有数据。
- 同 ID 记录按 `updatedAt` 合并。
- 导入后页面刷新并显示结果摘要。
- 所有新增纯函数测试通过。

## 测试策略

- Node tests：
  - import payload validation.
  - import payload summary.
  - merge newer incoming records.
  - keep newer local records.
  - reject invalid app/version.
- Existing tests：
  - date utils.
  - app-state selectors.
  - export payload.
- Browser verification：
  - 新增任务后编辑。
  - 删除任务后出现在最近删除。
  - 恢复任务后回到 active。
  - 导出 JSON 后再导入到新 origin。
  - 无效 JSON 导入被拒绝。

## 后续

完成本版本后，再考虑：

1. 更完整的习惯编辑与补记。
2. 前台提醒和到期列表。
3. 重复规则增强。
4. 统计回顾。
