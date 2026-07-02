# 今日有序设计文档

日期：2026-07-02

## 目标

在仓库 `tools/` 下新增一个移动端优先的本地优先 PWA 小工具：**今日有序**。

副标题：**日历、待办与习惯打卡，一起管理美好的今天。**

首版目标不是完整复刻 PRD 的上线标准版，而是交付一个可独立使用、可离线打开、可本地保存数据的轻量 MVP，同时为后续登录同步、Web Push 提醒、统计增强保留清晰入口和数据结构。

## 产品定位

今日有序是一个“今日执行面板”，而不是普通待办清单或完整日程系统。用户每天打开时首先看到今天要做什么，并能快速完成任务、打卡习惯、补写今日一句。

首版采用「今日优先」方向：

- 默认首页是今日视图。
- 底部导航为「今日 / 日历 / 清单 / 我的」。
- 快速新增始终可达。
- 日历用于查看日期分布和回顾。
- 清单用于整理收集箱、今天、即将到来、已完成。
- 我的用于本地数据、导出、提醒权限、未来同步入口。

## 首版范围

### 必做

- `tools/time/` 独立静态工具目录。
- 独立 `index.html`、`manifest.json`、`sw.js`、CSS、JS。
- 首页入口增加「今日有序」工具卡。
- 根 `manifest.json` 增加快捷入口。
- `vercel.json` 增加 `tools/time` 静态缓存和路由规则。
- IndexedDB 本地存储。
- 本地模式可无需登录使用。
- 任务新增、编辑、完成、删除。
- 任务字段支持标题、备注、日期、优先级、状态、标签。
- 习惯新增、打卡、跳过、补记基础能力。
- 每日一句新增和编辑。
- 今日视图聚合今天任务、待打卡习惯、今日一句。
- 月历视图显示任务、习惯、日记标记。
- 清单视图支持收集箱、今天、即将到来、已完成。
- 我的视图支持 JSON 导出、本地清空、隐私说明。
- 登录同步与 Web Push 提醒只显示“后续支持 / 未开启”入口，不做虚假可用状态。
- 独立 Service Worker 缓存 App Shell，使工具能离线打开。

### 暂不做

- 账号登录。
- 云同步。
- 服务端提醒调度。
- Web Push 实际订阅和发送。
- 自然语言录入。
- 图片日记。
- 高级统计图表。
- 复杂 RRULE 编辑器。
- 拖拽排序。
- 团队协作。

## 页面设计

### 今日

今日是默认首屏，结构从上到下为：

1. 品牌头：今日有序、副标题、设置入口。
2. 日期概览：日期、星期、今日剩余事项数量、本地模式状态。
3. 现在要做：今天未完成任务和逾期任务。
4. 待打卡：今天应完成的习惯。
5. 今日一句：当天日记入口。
6. 全局新增按钮：打开底部输入面板。

行为：

- 点击任务圆圈立即完成。
- 点击习惯按钮立即打卡。
- 点击今日一句进入轻编辑状态。
- 新增只填标题即可保存到收集箱。
- 选择日期后任务会出现在对应今日、日历、清单视图中。

### 日历

首版以月视图为主：

- 显示当前月份。
- 日期格显示任务、习惯、日记的轻量标记。
- 点击日期后打开日期详情。
- 日期详情列出当天任务、习惯记录、每日一句。
- 支持切换上月和下月。

周视图、日视图可作为后续增强，不进入首版。

### 清单

清单用于整理而不是替代今日页：

- 收集箱：没有日期的 active 任务。
- 今天：当天任务。
- 即将到来：未来日期任务。
- 已完成：最近完成任务。
- 支持搜索标题和备注。

### 我的

我的页承接数据安全和后续能力：

- 本地模式状态。
- 未来登录同步入口，标注“后续支持”。
- 提醒权限入口，标注“首版仅前台提示 / 后续 Web Push”。
- JSON 导出。
- 清空本地数据。
- 隐私说明：数据默认保存在本机 IndexedDB，不接广告 SDK。
- 主题：跟随仓库现有 `quick-tools-theme` 约定。

## 数据模型

首版使用 IndexedDB，数据库名建议为 `todayYouxuDB`，版本 `1`。

### Task

- `id`: string
- `title`: string
- `notes`: string
- `date`: `YYYY-MM-DD` 或空
- `priority`: `none | low | medium | high`
- `status`: `active | completed | deleted`
- `tags`: string[]
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime
- `completedAt`: ISO datetime 或空
- `deletedAt`: ISO datetime 或空

### Habit

- `id`: string
- `title`: string
- `schedule`: `daily | weekdays | weekly`
- `targetCount`: number
- `status`: `active | archived`
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

### HabitLog

- `id`: string
- `habitId`: string
- `date`: `YYYY-MM-DD`
- `state`: `done | skipped`
- `count`: number
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

### JournalEntry

- `id`: string
- `date`: `YYYY-MM-DD`
- `content`: string
- `mood`: string 或空
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

### OpLog

保留本地操作日志表，为后续同步做准备：

- `id`: string
- `entityType`: `task | habit | habitLog | journal`
- `entityId`: string
- `action`: `create | update | complete | skip | delete | restore`
- `payload`: object
- `clientTs`: ISO datetime
- `syncState`: `local | pending | synced | failed`

首版不上传 OpLog，但所有写操作应记录，避免后续同步改造时重构核心写入路径。

## 技术设计

### 目录

```text
tools/time/
  index.html
  manifest.json
  sw.js
  css/style.css
  js/app.js
  js/db.js
  js/date-utils.js
  js/export.js
  README.md
```

### 架构

- 原生 HTML/CSS/JavaScript，沿用仓库现有静态工具风格。
- 不引入 React/Vite 后端工程，降低首版复杂度。
- JS 按职责拆分：
  - `db.js`：IndexedDB schema、CRUD、OpLog。
  - `date-utils.js`：日期格式化、月份网格、今天判断。
  - `export.js`：JSON 导出。
  - `app.js`：状态管理、路由、渲染、事件绑定。
- 使用 hash 或内存视图状态切换，不依赖服务端路由。
- Service Worker 使用 cache-first app shell，并对 HTML 保持可更新。

### PWA 边界

- 支持添加到主屏幕。
- 支持离线打开和读取本地数据。
- 不承诺离线精确提醒。
- 提醒入口明确说明：首版为本地/前台提示预留，后续接 Web Push。

## UI 风格

整体应克制、清晰、移动端优先：

- 不做营销型落地页，打开就是工具主界面。
- 首页不是大卡片堆叠，而是可执行的今日面板。
- 卡片半径控制在 8px 左右，除移动容器和浮动新增按钮外不做过度圆角。
- 使用低饱和绿色作为主色，搭配中性色背景和清晰状态色。
- 按钮、输入框、底部导航触控目标不小于 44px。
- 文案避免制造焦虑，习惯打卡允许跳过和补记。

## 错误处理

- IndexedDB 初始化失败时显示明确错误，并保留只读/不可用提示。
- 保存失败时不清空用户输入。
- 删除使用软删除，首版可在已完成/删除状态里保留恢复空间。
- 导出失败显示错误原因。
- Service Worker 注册失败不阻塞主应用使用。

## 验收标准

- 访问 `/tools/time/` 后默认进入今日视图。
- 首次使用无需登录即可新增一条任务。
- 刷新页面后任务仍存在。
- 离线后仍可打开 App Shell，并读取已有本地数据。
- 可完成任务、打卡习惯、写今日一句。
- 月历能显示有数据日期的标记。
- JSON 导出包含 tasks、habits、habitLogs、journals、opLogs。
- 根首页出现「今日有序」入口。
- PWA manifest 的名称、短名称、scope、start_url 正确指向 `tools/time`。
- 不出现“已同步”“已推送提醒”等未实现能力的成功状态。

## 测试策略

- 语法检查所有新增 JS。
- 添加轻量 Node 单元测试覆盖日期工具、导出结构、基础数据转换。
- 浏览器手动验证：
  - 默认今日视图。
  - 新增任务后刷新保留。
  - 完成任务后今日数量更新。
  - 新增习惯后可以打卡。
  - 写入今日一句后月历出现标记。
  - JSON 导出可下载且结构正确。
  - 离线模式可打开。
- 使用新端口或新 origin 验证，避免 Service Worker 旧缓存遮蔽结果。

## 后续演进

1. 完整提醒：Notification 权限、Web Push 订阅、服务端调度。
2. 账号与同步：登录、OpLog push/pull、冲突处理。
3. 重复规则增强：每周多日、每月、每隔 N 天。
4. 统计回顾：7/30 天完成率、习惯连续天数、月热力图。
5. 数据恢复：导入 JSON、回收站恢复。
