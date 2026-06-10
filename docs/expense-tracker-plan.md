# 生活账单模块 开发实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Quick Tools 网站中新增生活账单模块，支持快速记账、多维度统计、数据本地存储和导入导出。

**Architecture:** 纯前端实现，使用 IndexedDB 存储数据，Chart.js 绘制图表，保持与现有项目一致的单文件 HTML 架构。账单模块作为独立工具页面存在于 `tools/expense/` 目录。

**Tech Stack:** HTML5, CSS3, Vanilla JavaScript, IndexedDB (idb-keyval 或原生 API), Chart.js

---

## 文件结构

```
tools/expense/
├── index.html          # 主页面：仪表盘 + 快速录入 + 账单列表
├── css/
│   └── style.css       # 账单模块样式（与主站主题一致）
├── js/
│   ├── db.js           # IndexedDB 数据层：增删改查
│   ├── chart.js        # 图表渲染：饼图、折线图、条形图
│   ├── form.js         # 快速录入：表单模式 + 自然语言模式
│   ├── filter.js       # 筛选逻辑：时间、标签、金额、搜索
│   ├── list.js         # 账单列表：展示、编辑、删除、分页
│   ├── tag.js          # 标签管理：增删改查、合并、重命名
│   ├── import.js       # 数据导入：Excel/CSV 解析、标签映射
│   ├── export.js       # 数据导出：CSV/JSON
│   ├── guide.js        # 使用指引：首次引导、演示模式
│   └── app.js          # 应用入口：初始化、路由、事件绑定
```

---

## Task 1: 项目基础结构搭建

**Files:**
- Create: `tools/expense/index.html`
- Create: `tools/expense/css/style.css`
- Create: `tools/expense/js/db.js`

- [ ] **Step 1: 创建账单模块主页面框架**

创建 `tools/expense/index.html`，包含：
- 与现有网站一致的 HTML 结构（header、theme 同步脚本）
- 引入 Chart.js CDN
- 页面布局：导航栏 + 主内容区（仪表盘/录入/列表/标签/设置 五个视图）
- 底部导航切换按钮

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<script>
  (function() {
    var theme = localStorage.getItem('quick-tools-theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>生活账单 - Quick Tools</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>...</header>
  <main id="app">
    <section id="view-dashboard">...</section>
    <section id="view-add">...</section>
    <section id="view-list">...</section>
    <section id="view-tags">...</section>
    <section id="view-settings">...</section>
  </main>
  <nav class="bottom-nav">...</nav>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建样式文件**

创建 `tools/expense/css/style.css`，包含：
- CSS 变量（与主站一致的 color scheme）
- 仪表盘布局（grid/flex）
- 卡片样式
- 标签 chip 样式
- 底部导航样式
- 响应式适配（mobile/desktop）
- 深色模式适配

- [ ] **Step 3: 创建 IndexedDB 数据层**

创建 `tools/expense/js/db.js`，实现：

```javascript
const DB_NAME = 'quick-tools-expense';
const DB_VERSION = 1;

// 打开数据库
function openDB() { ... }

// Expense CRUD
async function addExpense(expense) { ... }
async function getExpenses(filters = {}) { ... }
async function updateExpense(id, updates) { ... }
async function deleteExpense(id) { ... }

// Tag CRUD
async function addTag(name) { ... }
async function getTags() { ... }
async function updateTag(id, updates) { ... }
async function deleteTag(id) { ... }
async function mergeTag(fromId, toId) { ... }

// Settings
async function getSettings() { ... }
async function setSettings(settings) { ... }

// 导出
async function exportAllData() { ... }
async function importData(data) { ... }

export { addExpense, getExpenses, updateExpense, deleteExpense, addTag, getTags, updateTag, deleteTag, mergeTag, getSettings, setSettings, exportAllData, importData };
```

- [ ] **Step 4: 验证数据库创建**

在浏览器中打开 `tools/expense/index.html`，检查：
- IndexedDB 数据库成功创建
- 无控制台报错
- 页面布局正常

---

## Task 2: 仪表盘与统计图表

**Files:**
- Modify: `tools/expense/index.html` (添加仪表盘 DOM)
- Create: `tools/expense/js/chart.js`
- Modify: `tools/expense/js/app.js`

- [ ] **Step 1: 实现仪表盘 DOM 结构**

在 `index.html` 的 `#view-dashboard` 中添加：
- 筛选栏（时间范围、标签筛选、金额范围、搜索）
- 总支出卡片
- 一级分类饼图 canvas
- 近7天趋势折线图 canvas
- 消费对象排行条形图 canvas
- 购买渠道排行条形图 canvas

- [ ] **Step 2: 实现图表渲染模块**

创建 `tools/expense/js/chart.js`，实现：

```javascript
import { getExpenses } from './db.js';

// 按标签聚合金额
function aggregateByTag(expenses, tagPrefix) { ... }

// 按日期聚合金额
function aggregateByDate(expenses, days = 7) { ... }

// 渲染饼图
function renderPieChart(canvasId, data, label) { ... }

// 渲染折线图
function renderLineChart(canvasId, data, label) { ... }

// 渲染条形图
function renderBarChart(canvasId, data, label) { ... }

// 更新所有图表
async function updateDashboard(filters = {}) {
  const expenses = await getExpenses(filters);
  // 计算统计数据
  // 调用各图表渲染函数
}

export { updateDashboard, renderPieChart, renderLineChart, renderBarChart };
```

- [ ] **Step 3: 实现筛选栏交互**

在 `app.js` 中实现：
- 时间范围切换（本月/上月/近7天/近30天/本年/自定义）
- 标签多选（弹出标签云，支持多选）
- 金额范围输入
- 搜索框输入
- 筛选条件变更时调用 `updateDashboard()`

- [ ] **Step 4: 验证仪表盘**

添加 5-10 条测试数据，验证：
- 总支出计算正确
- 饼图展示各分类占比
- 折线图展示近7天趋势
- 筛选条件变更后图表实时更新

---

## Task 3: 快速录入功能

**Files:**
- Modify: `tools/expense/index.html` (添加录入表单 DOM)
- Create: `tools/expense/js/form.js`

- [ ] **Step 1: 实现表单录入模式 DOM**

在 `#view-add` 中添加：
- 模式切换开关（表单/自然语言）
- 金额输入框（自动聚焦）
- 日期选择器（默认今天）
- 标签输入框（支持智能提示）
- 商品名称输入框（可选）
- 保存按钮
- 最近使用模板区域

- [ ] **Step 2: 实现标签智能提示**

```javascript
// 标签输入框输入时，显示匹配的标签下拉列表
function showTagSuggestions(input, suggestions) { ... }

// 获取最近使用的标签
async function getRecentTags(limit = 10) { ... }

// 获取最近使用的标签组合
async function getRecentTagCombinations(limit = 3) { ... }
```

- [ ] **Step 3: 实现表单录入逻辑**

```javascript
async function handleFormSubmit() {
  // 1. 获取表单数据
  // 2. 验证金额必填
  // 3. 保存到 IndexedDB
  // 4. 清空表单（保留日期）
  // 5. 金额框重新聚焦
  // 6. 显示成功提示
}
```

- [ ] **Step 4: 实现自然语言解析模式**

```javascript
function parseNaturalLanguage(input, knownTags) {
  // 1. 提取金额（第一个数字）
  // 2. 识别已知标签
  // 3. 剩余文字作为商品名称
  // 4. 返回解析结果对象
  return { amount, tags, itemName, raw: input };
}

function showParseResult(result) {
  // 展示解析结果预览，用户确认后保存
}
```

- [ ] **Step 5: 验证快速录入**

测试场景：
- 表单模式：输入金额 35，选择标签 #家庭 #餐饮，保存成功
- 自然语言模式：输入"午餐 35 家庭 餐饮"，解析正确，保存成功
- 连续录入：保存后表单清空，金额框聚焦，可继续录入

---

## Task 4: 账单列表功能

**Files:**
- Modify: `tools/expense/index.html` (添加列表 DOM)
- Create: `tools/expense/js/list.js`

- [ ] **Step 1: 实现账单列表 DOM**

在 `#view-list` 中添加：
- 筛选栏（与仪表盘共享筛选逻辑）
- 按日期分组的账单列表
- 单条记录展示（商品名、金额、标签、编辑/删除按钮）
- 加载更多按钮
- 空状态提示

- [ ] **Step 2: 实现列表渲染**

```javascript
async function renderList(filters = {}, page = 1, pageSize = 30) {
  // 1. 获取账单数据（分页）
  // 2. 按日期分组
  // 3. 渲染 HTML
  // 4. 绑定编辑/删除事件
}

function renderExpenseItem(expense) {
  // 返回单条记录的 HTML 字符串
}
```

- [ ] **Step 3: 实现编辑功能**

```javascript
function openEditModal(expense) {
  // 弹出编辑弹窗，预填充数据
  // 用户修改后保存
}
```

- [ ] **Step 4: 实现删除功能**

```javascript
function confirmDelete(expenseId) {
  // 弹出确认对话框
  // 确认后删除记录
  // 刷新列表
}
```

- [ ] **Step 5: 验证账单列表**

测试场景：
- 列表按日期倒序展示
- 编辑记录后数据更新
- 删除记录后列表刷新
- 筛选条件生效

---

## Task 5: 标签管理功能

**Files:**
- Modify: `tools/expense/index.html` (添加标签管理 DOM)
- Create: `tools/expense/js/tag.js`

- [ ] **Step 1: 实现标签管理 DOM**

在 `#view-tags` 中添加：
- 新建标签按钮
- 标签卡片网格
- 标签卡片（名称、使用次数、操作按钮）

- [ ] **Step 2: 实现标签 CRUD**

```javascript
async function renderTags(sortBy = 'usage') {
  // 获取所有标签
  // 按指定方式排序
  // 渲染标签卡片
}

async function handleCreateTag(name) {
  // 验证名称非空
  // 检查是否已存在
  // 创建标签
}

async function handleRenameTag(id, newName) {
  // 更新标签名称
  // 更新所有关联记录
}

async function handleMergeTag(fromId, toId) {
  // 将 from 标签的所有记录转移到 to 标签
  // 删除 from 标签
}

async function handleDeleteTag(id) {
  // 确认后删除标签
  // 关联记录移除该标签
}
```

- [ ] **Step 3: 验证标签管理**

测试场景：
- 创建新标签
- 重命名标签，关联记录更新
- 合并标签，记录转移
- 删除标签，记录保留

---

## Task 6: 数据导入导出

**Files:**
- Create: `tools/expense/js/import.js`
- Create: `tools/expense/js/export.js`
- Modify: `tools/expense/index.html` (添加导入导出 DOM)

- [ ] **Step 1: 实现数据导出**

```javascript
function exportToCSV(expenses) {
  // 将账单数据转为 CSV 格式
  // 触发下载
}

function exportToJSON(expenses) {
  // 将完整数据（含标签）转为 JSON
  // 触发下载
}
```

- [ ] **Step 2: 实现 CSV 导入**

```javascript
function parseCSV(file) {
  // 使用 FileReader 读取文件
  // 解析 CSV 内容
  // 返回列名和数据行
}

function mapColumns(columns, dataPreview) {
  // 展示列映射界面
  // 用户选择每列对应的字段
  // 返回映射关系
}

async function importFromCSV(mappedData) {
  // 根据映射关系创建账单记录
  // 自动将列值转为标签
  // 保存到数据库
}
```

- [ ] **Step 3: 实现 Excel 导入**

```javascript
function parseExcel(file) {
  // 使用 SheetJS (xlsx.js) 读取 Excel
  // 解析为 JSON 数据
  // 返回列名和数据行
}
```

- [ ] **Step 4: 实现导入预览和确认**

```javascript
function showImportPreview(data) {
  // 展示前 5 行数据预览
  // 展示列映射选择
  // 用户确认后执行导入
}

async function executeImport(records) {
  // 批量导入记录
  // 统计成功/失败数量
  // 展示导入结果
}
```

- [ ] **Step 5: 验证导入导出**

测试场景：
- 导出 CSV，文件内容正确
- 导出 JSON，可完整恢复数据
- 导入用户提供的 Excel 文件，标签映射正确

---

## Task 7: 使用指引与演示模式

**Files:**
- Create: `tools/expense/js/guide.js`
- Modify: `tools/expense/index.html` (添加引导 DOM)

- [ ] **Step 1: 实现首次引导**

```javascript
function shouldShowGuide() {
  // 检查 settings.hasSeenGuide
  return !settings.hasSeenGuide;
}

function showGuide() {
  // 展示分步骤引导遮罩
  // 步骤1: 欢迎
  // 步骤2: 快速录入
  // 步骤3: 仪表盘
  // 步骤4: 数据安全
}

function completeGuide() {
  // 标记引导已完成
  // 关闭引导遮罩
}
```

- [ ] **Step 2: 实现演示模式**

```javascript
const DEMO_DATA = [
  { amount: 171, date: '2026-02-01', itemName: '弥鹿软插积木', tags: ['宝贝', '购物消费', '玩具', '京东'] },
  // ... 20 条示例数据
];

async function enableDemoMode() {
  // 备份真实数据
  // 清空当前数据
  // 加载示例数据
}

async function disableDemoMode() {
  // 恢复真实数据
  // 删除示例数据
}
```

- [ ] **Step 3: 验证指引和演示模式**

测试场景：
- 首次访问自动展示引导
- 引导可跳过、可重新查看
- 演示模式加载示例数据
- 关闭演示模式恢复真实数据

---

## Task 8: 首页入口与项目集成

**Files:**
- Modify: `index.html` (添加账单模块入口)
- Modify: `manifest.json` (添加账单模块 shortcut)

- [ ] **Step 1: 在首页添加账单模块卡片**

在 `index.html` 的 `.tools-grid` 中添加：

```html
<a class="tool-card" href="./tools/expense/">
  <div class="tool-icon expense">💰</div>
  <h2>生活账单</h2>
  <p>快速记录日常消费，多维度统计分析，数据本地存储保护隐私。</p>
  <span class="tool-btn">开始使用 →</span>
</a>
```

添加 `.tool-icon.expense` 样式：
```css
.tool-icon.expense {
  background: linear-gradient(135deg, #2DBAA3 0%, #1a7f6b 100%);
}
```

- [ ] **Step 2: 更新 PWA manifest**

在 `manifest.json` 的 `shortcuts` 中添加：

```json
{
  "name": "生活账单",
  "short_name": "账单",
  "description": "快速记录和统计日常消费",
  "url": "/tools/expense/",
  "icons": [{ "src": "/icons/expense-icon.png", "sizes": "96x96" }]
}
```

- [ ] **Step 3: 验证集成**

测试场景：
- 首页显示账单模块卡片
- 点击进入账单模块
- PWA manifest 更新正确

---

## Task 9: 端到端测试与优化

**Files:**
- All files

- [ ] **Step 1: 功能完整性测试**

按照验收标准逐项测试：
1. 快速录入：3 步内完成，耗时 < 5 秒
2. 标签筛选：图表 300ms 内更新
3. 数据持久化：刷新不丢失
4. 数据导入：Excel 标签映射正确
5. 数据导出：JSON 可完整恢复
6. 响应式：375px - 1920px 正常显示
7. 首次引导：自动展示，可跳过
8. 演示模式：示例数据加载/恢复

- [ ] **Step 2: 性能优化**

- 账单列表虚拟滚动（超过 1000 条）
- 图表数据聚合（大数据量时）
- 筛选防抖（避免频繁渲染）

- [ ] **Step 3: 代码清理**

- 删除 console.log
- 统一代码风格
- 添加必要注释

---

## 验收标准检查清单

| # | 验收项 | 对应 Task |
|---|--------|----------|
| 1 | 快速录入 < 3 步，< 5 秒 | Task 3 |
| 2 | 标签筛选 300ms 内更新 | Task 2 |
| 3 | 刷新页面数据不丢失 | Task 1 |
| 4 | Excel 导入标签映射正确 | Task 6 |
| 5 | JSON 导出可完整恢复 | Task 6 |
| 6 | 响应式 375px-1920px | Task 1, 9 |
| 7 | 首次引导自动展示 | Task 7 |
| 8 | 演示模式示例数据 | Task 7 |

---

*计划结束*
