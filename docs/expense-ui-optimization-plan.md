# 生活账单 - 移动端 UI 优化方案

> 分析日期：2026-06-15  
> 目标分支：`feat-optimize-expense-ui-L15kFS`  
> 分析范围：`tools/expense/index.html` + `tools/expense/css/style.css` + `tools/expense/js/app.js`  
> 设计技能审阅：`frontend-design` + `frontend-skill` + `theme-factory`

---

## 零、设计方向：温润的日式账本

### 视觉主张（Visual Thesis）

**温润的日式账本** — 像一本精心设计的纸质账本，数字清晰、留白充裕、材质温暖。用细腻的排版节奏和克制的色彩来传递"记录生活"的仪式感，而非"分析数据"的紧张感。

关键词：**克制、温暖、数字优先、材质感**

### 内容规划（Content Plan）

| 区域 | 职责 | 视觉焦点 |
|------|------|----------|
| 首屏 Hero | 传递"本月支出概况" | 大号金额数字 + 一句话趋势 |
| 分类占比 | 解释"钱花在哪了" | 环形图 + 无卡片外壳 |
| 趋势图 | 展示"花销节奏" | 折线图 + 时间粒度切换 |
| 明细列表 | 提供"逐笔查阅" | 日期分组 + 左滑操作 |

### 交互主张（Interaction Thesis）

1. **页面入场**：数字从 0 滚动到实际值，staggered 每项延迟 80ms
2. **分类环形图 hover**：选中扇区外扩，其余扇区变淡
3. **列表项滑动**：左滑露出编辑/删除，带弹性回弹

### 主题选择：Forest Canopy 适配版

通过 `theme-factory` 对 10 套预设主题进行对比，选择 **Forest Canopy** 作为基础，针对"生活账单"场景进行适配调整：

| 主题元素 | Forest Canopy 原版 | 适配后 |
|----------|-------------------|--------|
| 主色 | `#2d4a2b` Forest Green | `#3D7B6E` 温润墨绿（降低饱和度，提升高级感） |
| 背景 | `#faf9f6` Ivory | `#F8F6F2` 暖调米白（模拟纸张触感） |
| 卡片 | — | `#FFFFFF` 纯白 |
| 辅色 | `#7d8471` Sage | `#8BA89A` 鼠尾草绿（标签、图标点缀） |
| 强调 | `#a4ac86` Olive | `#C4A882` 暖金色（金额、重点数字） |
| 深色背景 | — | `#1A1D1B` 深墨绿底 |
| 深色卡片 | — | `#242826` 深灰绿卡片 |

---

## 一、Web Interface Guidelines 合规审查结果

基于 [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) 对当前代码进行全面审查：

### index.html

| 行号 | 严重度 | 问题 | 修复建议 |
|------|--------|------|----------|
| 12 | **Critical** | `user-scalable=no` + `maximum-scale=1.0` 禁用缩放 | 移除这两个属性，仅保留 `width=device-width, initial-scale=1.0, viewport-fit=cover` |
| 2 | High | `<html>` 缺少 `color-scheme: dark` 声明 | 在 `[data-theme="dark"]` 规则内添加 `color-scheme: dark` |
| 84-97 | High | Header 区域缺少 `<h1>`，无页面级主标题 | 将 logo 文字包裹在 `<h1>` 中 |
| 86-89 | Medium | 装饰性 SVG 图标缺少 `aria-hidden="true"` | 给 logo SVG 添加 `aria-hidden="true"` |
| 93 | Medium | 主题切换按钮仅用 `title` 属性，无 `aria-label` | 添加 `aria-label="切换深色模式"` |
| 108-141 | Medium | filter-bar 内所有 input/select 仅用 `title` 无 `<label>` | 为每个控件添加关联的 `<label>` 元素或 `aria-label` |
| 228 | Medium | `autofocus` 在金额输入框上，移动端会弹出键盘遮挡 | 移动端移除 `autofocus`，桌面端保留 |
| 323, 365, 380 | Medium | Modal 关闭按钮仅文字 `✕` 无 `aria-label` | 添加 `aria-label="关闭"` |
| 646 | Medium | Toast 通知缺少 `aria-live="polite"` | 给 `#toast` 添加 `aria-live="polite"` |
| 141, 222, 234 等 | Low | 多处 placeholder 使用 `...` 而非 `…` | 将 `...` 替换为 Unicode 省略号 `…` |
| 543-555 | Low | 底部导航按钮无 `touch-action: manipulation` | 添加 `touch-action: manipulation` |

### style.css

| 行号 | 严重度 | 问题 | 修复建议 |
|------|--------|------|----------|
| 107,126,189,385,408,425,466 等 19 处 | High | `transition: all` 应明确列出属性 | 分别指定 `transition: background 0.2s, color 0.2s, transform 0.2s` |
| 全局 | High | 缺少 `@media (prefers-reduced-motion)` 支持 | 为 `fadeIn`、`slideUp`、hover 效果提供降级方案 |
| 223-226 | Medium | `.stat-value` 数值显示缺少 `font-variant-numeric: tabular-nums` | 添加以确保数字对齐 |
| 1176-1190 | Medium | `.bottom-nav` 缺少 `padding-bottom: env(safe-area-inset-bottom)` | 添加以适配刘海屏/底部指示条 |
| 1176-1190 | Medium | `.bottom-nav` 缺少 `touch-action: manipulation` | 添加以消除 300ms 点击延迟 |
| 1630-1640 | Medium | `.modal-overlay` 缺少 `overscroll-behavior: contain` | 添加以防止背景滚动穿透 |
| 全局 | Low | 滚动条样式过多，缺少简洁方案 | 考虑 `scrollbar-width: thin` (Firefox) |
| 全局 | Low | 缺少 `-webkit-tap-highlight-color: transparent` 统一声明 | 添加全局声明 |

---

## 二、前端设计评审：核心问题

> 基于 `frontend-design` 和 `frontend-skill` 技能规范对当前 UI 进行深度评审。

### 2.1 卡片泛滥（Hard Rule Violation）

`frontend-skill` 核心规则：**"No cards by default"**。当前页面每个模块都被包裹在 `.chart-card` / `.form-card` / `.list-card` 中 — 全部是 `border + border-radius + shadow` 的卡片盒子。

**解决方案：去卡片化**

```css
/* 仅 stat-card 保留卡片样式（可点击交互元素） */
/* 图表区域改用分隔线和留白，移除卡片外壳 */

.chart-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  margin-bottom: 32px;
}

.chart-card h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  padding-bottom: 0;
}

/* 图表区域用分隔线代替卡片 */
.chart-row {
  border-top: 1px solid var(--border);
  padding-top: 24px;
  margin-top: 8px;
}
```

### 2.2 缺少排版系统

`frontend-design` 要求：**"Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter."**

当前使用 `system-ui, -apple-system` 等系统字体堆栈。一个账单工具的核心信息是数字，需要优秀的等宽字体来呈现。

**解决方案：三字体系统**

```css
:root {
  /* 标题：衬线体，传递"账本"的温度感 */
  --font-display: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;

  /* 正文：中文字体，清晰可读 */
  --font-body: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;

  /* 金额数字：等宽字体，确保对齐 */
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

body {
  font-family: var(--font-body);
}

/* 金额使用等宽字体 */
.stat-value,
.expense-amount,
#dash-total,
#dash-avg,
#dash-top {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* 标题使用衬线体 */
h1, h2, .dashboard-header h2, .page-header h2 {
  font-family: var(--font-display);
  font-weight: 600;
}
```

### 2.3 色彩过于分散

`frontend-skill` 规则：**"One accent color by default"**。当前有 primary/green + blue + yellow + red 四个 accent 色同时出现在 stat cards 上。

`frontend-design` 要求：**"Dominant colors with sharp accents outperform timid, evenly-distributed palettes."**

**解决方案：统一色彩系统**

```css
:root {
  /* === 主色：温润墨绿 === */
  --primary: #3D7B6E;
  --primary-hover: #2F6358;
  --primary-light: rgba(61, 123, 110, 0.08);

  /* === 背景：模拟纸张 === */
  --bg: #F8F6F2;
  --card-bg: #FFFFFF;
  --surface-hover: rgba(0, 0, 0, 0.03);
  --surface-active: rgba(0, 0, 0, 0.06);

  /* === 文字：柔和的深灰 === */
  --text: #3C3C3C;
  --text-secondary: #8C8C8C;
  --text-tertiary: #B8B8B8;

  /* === 仅保留一个功能性强调色 === */
  --danger: #C97067;
  --danger-hover: #B05A52;

  /* === 边框：极淡 === */
  --border: #EBE8E3;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.08);
  --radius: 12px;
  --radius-sm: 8px;
  --focus-ring: rgba(61, 123, 110, 0.28);
}

[data-theme="dark"] {
  --bg: #1A1D1B;
  --card-bg: #242826;
  --text: #D4D6D3;
  --text-secondary: #8C908C;
  --text-tertiary: #5C605C;
  --border: #333836;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.3);
  --primary-light: rgba(61, 123, 110, 0.16);
  --surface-hover: rgba(255, 255, 255, 0.04);
  --surface-active: rgba(255, 255, 255, 0.08);
  color-scheme: dark;
}
```

### 2.4 仪表盘首屏缺乏海报感

`frontend-skill` 要求：**"Treat the first viewport as a poster, not a document."**

当前首屏：4 个 stat card + 筛选栏 → 标准 dashboard 模式，缺乏视觉冲击力。

**解决方案：Hero 式首屏重构**

```
┌──────────────────────────────────┐
│                                  │
│         本月支出                   │  ← 衬线体小标题
│                                  │
│       ¥ 2,450.00                 │  ← 大号等宽字体，视觉焦点
│                                  │
│    较上月 ↓12%  ·  32 笔支出      │  ← 一句话趋势
│                                  │
├──────────────────────────────────┤
│  [环形图: 分类占比]               │  ← 无卡片外壳，直接展示
│                                  │
├──────────────────────────────────┤
│  [折线图: 近7天趋势]              │
│                                  │
└──────────────────────────────────┘
```

```html
<!-- 替代当前 4 个 stat-card 的 Hero 区域 -->
<div class="dashboard-hero">
  <h2 class="hero-label">本月支出</h2>
  <div class="hero-amount" id="dash-total">¥0.00</div>
  <div class="hero-summary">
    <span class="hero-trend" id="dash-trend">加载中…</span>
    <span class="hero-dot">·</span>
    <span class="hero-count" id="dash-count-text">0 笔支出</span>
  </div>
</div>
```

```css
.dashboard-hero {
  text-align: center;
  padding: 32px 0 40px;
}

.hero-label {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-bottom: 12px;
  letter-spacing: 1px;
}

.hero-amount {
  font-family: var(--font-mono);
  font-size: 48px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.hero-summary {
  margin-top: 12px;
  font-size: 14px;
  color: var(--text-secondary);
}

.hero-trend {
  color: var(--primary);
  font-weight: 500;
}

.hero-dot {
  margin: 0 8px;
  color: var(--text-tertiary);
}
```

### 2.5 动效缺乏编排

`frontend-design` 要求：**"One well-orchestrated page load with staggered reveals."**

当前动效是零散的通用动画，缺乏页面级的编排。

**解决方案：Staggered Reveal**

```css
/* 页面入场：staggered reveal */
.dashboard-hero .hero-label  { animation: fadeUp 0.5s 0.05s cubic-bezier(0.16, 1, 0.3, 1) both; }
.dashboard-hero .hero-amount { animation: fadeUp 0.5s 0.15s cubic-bezier(0.16, 1, 0.3, 1) both; }
.dashboard-hero .hero-summary{ animation: fadeUp 0.5s 0.25s cubic-bezier(0.16, 1, 0.3, 1) both; }
.chart-row                  { animation: fadeUp 0.5s 0.35s cubic-bezier(0.16, 1, 0.3, 1) both; }
.chart-card:last-of-type    { animation: fadeUp 0.5s 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 页面切换 */
.view-section {
  animation: fadeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 数字变化微动效 */
.stat-value {
  transition: color 0.2s;
}
.stat-value.updated {
  animation: numberPop 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes numberPop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.06); }
  100% { transform: scale(1); }
}
```

---

## 三、移动端 UX 专项问题

### 3.1 触控体验

| 问题 | 影响 | 解决方案 |
|------|------|----------|
| 底部导航栏高度 64px，在 iPhone 14 Pro 等机型上被底部指示条遮挡 | 点击困难，误触 | 使用 `padding-bottom: env(safe-area-inset-bottom)` + `height: calc(64px + env(safe-area-inset-bottom))` |
| 按钮和交互区域过小（如 `expense-actions button` 仅 32x32px） | 拇指难以精确点击 | 移动端最小触控目标应为 44x44px |
| 表单输入框行间距不足 | 相邻输入框容易误点 | 增加 `form-group` margin-bottom 到 24px |
| 卡片 hover 效果使用 `transform: translateY(-2px)` | 触控时无可用反馈 | 添加 `:active` 状态的按下效果（scale 0.98） |
| 长按 Tag chip 无反馈 | 移动端缺少视觉确认 | 添加 `-webkit-tap-highlight-color` 和 `:active` 状态 |

### 3.2 可读性

| 问题 | 影响 | 解决方案 |
|------|------|----------|
| 仪表盘 stat-value 在不同数据量下宽度跳跃 | 数字变化时视觉不连贯 | 添加 `font-variant-numeric: tabular-nums` + 等宽字体 |
| 图表在 375px 宽度下过小 | iPhone SE 用户看不清 | 移动端图表高度从 220px 提升到 260px |
| 金额 ¥ 符号与数字之间的视觉连接弱 | 略显普通 | ¥ 使用较小字号，与数字形成排版层次 |
| 列表项文字溢出无省略 | layout 可能被撑开 | 统一添加 `text-overflow: ellipsis` + `overflow: hidden` |

### 3.3 导航与布局

| 问题 | 影响 | 解决方案 |
|------|------|----------|
| 5 个底部导航按钮拥挤 | 小屏设备文字几乎不可读 | 移动端使用 4 个主要导航 + 中心 FAB 记账按钮 |
| Header 在滚动时未做收缩动画 | 浪费宝贵的垂直空间 | 滚动时 header 高度从 56px 缩小到 44px |
| main 区域 `padding: 16px` 在移动端偏大 | 浪费水平空间 | 使用 `padding: 12px` |
| 筛选栏在移动端全宽堆叠显示 | 占用大量垂直空间 | 使用折叠式筛选面板，默认只显示时间范围 |

---

## 四、分级优化方案

### P0 - 关键修复（必须做）

#### 1. 恢复用户缩放能力
```html
<!-- 修改前 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">

<!-- 修改后 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

#### 2. 适配安全区域（刘海屏 / 底部指示条）
```css
.bottom-nav {
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

body {
  padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
}

main {
  padding-left: calc(16px + env(safe-area-inset-left, 0px));
  padding-right: calc(16px + env(safe-area-inset-right, 0px));
}
```

#### 3. 增加无障碍支持（prefers-reduced-motion）
```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### 4. 修复 `transition: all`
将所有 19 处 `transition: all` 替换为明确的属性列表：
```css
/* 修改前 */
transition: all 0.2s;

/* 修改后 */
transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s, background-color 0.2s;
```

#### 5. 深色模式 color-scheme
```css
[data-theme="dark"] {
  color-scheme: dark;
}
```

#### 6. 全局 touch-action 和 tap-highlight
```css
* {
  -webkit-tap-highlight-color: transparent;
}

button, .nav-item, .tag-chip, .stat-card {
  touch-action: manipulation;
}
```

---

### P1 - 移动端体验优化

#### 1. 底部导航栏重构

精简为 4 项核心导航 + 中心 FAB 按钮：
- **概览** (dashboard)
- **明细** (list)  
- **⊕ 记账** (add) — 居中的圆形 FAB 按钮
- **更多** — 点击展开标签/设置

```css
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--card-bg);
  border-top: 1px solid var(--border);
  box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.04);
  touch-action: manipulation;
}

/* 中心 FAB 记账按钮 */
.nav-item.add-fab {
  position: relative;
  top: -16px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  box-shadow: 0 4px 16px rgba(61, 123, 110, 0.35);
  border: 3px solid var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.nav-item.add-fab:active {
  transform: scale(0.92);
  box-shadow: 0 2px 8px rgba(61, 123, 110, 0.25);
}
```

#### 2. 可折叠筛选栏

移动端默认只展示时间选择器，其余筛选项折叠：
```html
<div class="filter-bar-mobile">
  <select id="dash-time-range">…</select>
  <button onclick="toggleFilterPanel()" class="filter-toggle">
    筛选 <span id="filter-badge" class="badge">3</span>
  </button>
</div>
<div class="filter-panel slide-down" id="filter-panel" style="display:none;">
  <!-- 标签、金额、搜索等 -->
</div>
```

```css
.filter-bar-mobile {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  touch-action: manipulation;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.slide-down {
  animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

#### 3. 触控目标优化

```css
@media (max-width: 768px) {
  .expense-actions button {
    width: 44px;
    height: 44px;
  }

  .nav-item {
    min-width: 44px;
    min-height: 44px;
  }

  .tag-chip {
    padding: 8px 16px;
    min-height: 40px;
  }

  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 12px 24px;
  }

  .form-group input,
  .form-group select {
    min-height: 44px;
  }
}
```

#### 4. 滚动收缩 Header
```css
@media (max-width: 768px) {
  header {
    transition: padding 0.3s, height 0.3s;
    height: 56px;
    padding: 10px 16px;
  }
  header.shrink {
    height: 44px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
}
```

```javascript
// 滚动收缩 Header
let lastScrollY = 0;
window.addEventListener('scroll', () => {
  const header = document.querySelector('header');
  const currentScrollY = window.scrollY;
  if (currentScrollY > 40 && currentScrollY > lastScrollY) {
    header.classList.add('shrink');
  } else if (currentScrollY < 10) {
    header.classList.remove('shrink');
  }
  lastScrollY = currentScrollY;
}, { passive: true });
```

#### 5. 列表滑动操作

为每条支出记录添加左滑露出操作按钮（iOS 风格）：
- 使用 `touch-action: pan-y` 允许垂直滚动
- 左滑露出"编辑"和"删除"按钮
- 使用 CSS transform 实现高性能滑动

---

### P2 - 视觉美感提升

#### 1. 空状态优化

当前所有值为 0 时，仪表盘大片空白。优化方案：

```html
<div class="empty-dashboard">
  <div class="empty-illustration">
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      <rect x="20" y="30" width="80" height="60" rx="8" stroke="var(--border)" stroke-width="1.5" fill="none"/>
      <line x1="30" y1="42" x2="90" y2="42" stroke="var(--border)" stroke-width="1"/>
      <line x1="30" y1="52" x2="75" y2="52" stroke="var(--border)" stroke-width="1"/>
      <line x1="30" y1="62" x2="82" y2="62" stroke="var(--border)" stroke-width="1"/>
      <line x1="30" y1="72" x2="60" y2="72" stroke="var(--border)" stroke-width="1"/>
      <circle cx="98" cy="30" r="18" fill="var(--primary-light)" stroke="var(--primary)" stroke-width="1.5"/>
      <path d="M94 30h8M98 26v8" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </div>
  <h3>开始记录</h3>
  <p>点击底部"记账"按钮，3 秒完成一笔记录</p>
  <button class="btn-primary" onclick="switchView('add')">记第一笔</button>
</div>
```

```css
.empty-dashboard {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-illustration {
  margin-bottom: 24px;
  opacity: 0.6;
}

.empty-dashboard h3 {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.empty-dashboard p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  max-width: 240px;
}
```

#### 2. Stat Card 视觉升级

```css
.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 16px;
  position: relative;
  overflow: hidden;
  box-shadow: none;
  cursor: pointer;
  text-align: left;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}

/* 左侧色条替代顶部色条 */
.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  border-radius: 2px 0 0 2px;
  background: var(--primary);
  transition: width 0.2s;
}

.stat-card:hover::before {
  width: 4px;
}

.stat-card:active {
  transform: scale(0.98);
  background: var(--surface-active);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: none;
  letter-spacing: 0;
}

.stat-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
```

#### 3. 图表区域去卡片化

```css
.chart-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  margin-bottom: 28px;
}

.chart-card h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 28px;
  border-top: 1px solid var(--border);
  padding-top: 24px;
}

@media (max-width: 768px) {
  .chart-row {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .chart-wrapper {
    height: 260px;
  }
  .chart-wrapper.doughnut {
    max-width: 260px;
  }
}
```

#### 4. 列表视觉优化

```css
.expense-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.15s;
  cursor: pointer;
}

.expense-item:active {
  background: var(--surface-active);
}

.expense-amount {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.expense-date-header {
  padding: 16px 16px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
  z-index: 5;
}
```

#### 5. Toast 通知优化

```css
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(-100px);
  background: var(--text);
  color: var(--card-bg);
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 200;
  opacity: 0;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  aria-live: polite;
}

.toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}
```

#### 6. 动效编排

```css
/* 页面切换 */
.view-section {
  animation: fadeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Modal 入场 */
.modal-overlay {
  animation: fadeIn 0.2s ease;
}

.modal-card {
  animation: modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalSlideUp {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* 环形图扇区 hover 效果（通过 Chart.js 自定义） */
/* 选中扇区外扩，其余扇区 opacity 降低到 0.4 */
```

---

## 五、移动端布局重构方案

### 当前布局问题
```
┌──────────────────────────┐
│  Header (固定)            │
├──────────────────────────┤
│  筛选栏 (全部展开，占 4 行) │ ← 浪费大量垂直空间
├──────────────────────────┤
│  Stat Cards (2x2 grid)    │ ← 卡片过多
├──────────────────────────┤
│  饼图 + 柱状图 (堆叠)     │
├──────────────────────────┤
│  趋势图                   │
├═══════════════════════════┤
│  底部导航 (5 项)           │ ← 拥挤
└──────────────────────────┘
```

### 优化后布局
```
┌──────────────────────────────┐
│  Header (收缩式)              │
├──────────────────────────────┤
│  [本月 ▼]  [筛选 ▾]          │ ← 紧凑筛选栏
├──────────────────────────────┤
│                              │
│       本月支出                 │
│     ¥ 2,450.00               │ ← Hero 大数字
│   较上月 ↓12%  ·  32 笔支出   │
│                              │
├──────────────────────────────┤
│  分类占比        [环形图]     │ ← 无卡片外壳
├──────────────────────────────┤
│  TOP 5 分类                  │
├──────────────────────────────┤
│  支出趋势                     │
├══════════════════════════════┤
│  [概览]  [明细]  [⊕]  [更多] │ ← 4 项 + 中心 FAB
└──────────────────────────────┘
```

---

## 六、完整 CSS 变量对照表

| 变量 | 当前值 | 新值 | 说明 |
|------|--------|------|------|
| `--primary` | `#2DBAA3` | `#3D7B6E` | 降低饱和度，更温润 |
| `--primary-light` | `rgba(45,186,163,0.12)` | `rgba(61,123,110,0.08)` | 更淡的背景色 |
| `--bg` | `#f5f7fa` | `#F8F6F2` | 暖调米白，模拟纸张 |
| `--text` | `#2c3e50` | `#3C3C3C` | 柔和深灰 |
| `--text-secondary` | `#7f8c8d` | `#8C8C8C` | 统一灰色调 |
| `--border` | `#e1e8ed` | `#EBE8E3` | 暖调边框 |
| `--danger` | `#e74c3c` | `#C97067` | 降低饱和度 |
| `--warning` | 删除 | 删除 | 统一为单 accent |
| `--shadow` | `0 2px 12px rgba(0,0,0,0.08)` | `0 1px 3px rgba(0,0,0,0.04)` | 更轻的阴影 |
| `--font-display` | 无 | `'Noto Serif SC', serif` | 新增标题衬线体 |
| `--font-mono` | 无 | `'JetBrains Mono', monospace` | 新增金额等宽字体 |
| `--radius` | `12px` | `12px` | 保持 |
| `color-scheme` | 无 | `dark` (dark模式) | 新增 |

---

## 七、实施建议

### 阶段一（本次迭代 - 2 天）
1. 应用新色彩系统（CSS 变量替换）
2. 修复 P0 关键问题（viewport、transition: all、安全区域）
3. 增加 `prefers-reduced-motion` 支持
4. 仪表盘 Hero 区域重构（替换 4 个 stat-card）
5. 图表区域去卡片化

### 阶段二（下次迭代 - 3 天）
1. 底部导航 FAB 重构
2. 可折叠筛选栏
3. 移动端触控大小优化
4. 空状态优化
5. 排版系统应用（字体引入）

### 阶段三（后续迭代 - 3 天）
1. Staggered 入场动效编排
2. 滚动收缩 Header
3. 列表滑动操作
4. Chart.js 自定义 hover 交互
5. 深色模式精细调优

---

## 八、Chrome DevTools 验证清单

- [ ] Lighthouse Accessibility 评分 ≥ 90
- [ ] `@media (prefers-reduced-motion: reduce)` 生效
- [ ] iPhone SE (375px) 宽度下正常显示
- [ ] iPad (768px) 横屏下图表并排
- [ ] 深色模式切换无闪烁，`color-scheme: dark` 生效
- [ ] PWA 安装后底部导航不被系统指示条遮挡
- [ ] 等宽字体正确加载，数字对齐
- [ ] 表单自动填充不触发异常
- [ ] 所有交互元素触控目标 ≥ 44px
- [ ] `touch-action: manipulation` 在所有按钮上生效

---

*文档结束*