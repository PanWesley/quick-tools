# 真价助手设计文档

日期：2026-07-02

## 目标

在仓库 `tools/` 下新增一个静态、本地优先的小工具：**真价助手**。

一句话定位：用户在买前粘贴商品链接，即可识别平台、查看本地价格记录、得到真低价判断，并把商品加入本地关注清单。

本设计基于 `C:/Users/Admin/Downloads/真价助手 PRD.pdf`，但首版不实现完整 PRD 的后端采集、联盟优惠券、CPS 转链、邮箱通知和调度任务。首版目标是先在 Quick Tools 中交付一个可打开、可体验、可继续演进的本地验证版，并明确标注真实联网能力尚未接入。

## 产品边界

### 首版做什么

- 新增 `tools/price/` 独立静态工具。
- 支持粘贴京东、淘宝、天猫、拼多多商品链接或分享文本。
- 前端解析平台、商品 ID、SKU 或标准链接。
- 展示商品分析页，包括商品卡、低价评分、判断理由、价格曲线和关注入口。
- 内置 3 到 5 个示例商品，用于无真实 API 时体验完整流程。
- 支持手动新增价格记录，形成本地历史价格曲线。
- 支持本地关注商品和目标价。
- 支持 JSON 导入导出。
- 数据保存在 IndexedDB，本地优先，无需登录。
- 根首页、根 manifest、根 service worker、`vercel.json` 增加入口和静态路由。

### 首版不做什么

- 不做真实商品详情采集。
- 不做短链接后端展开。
- 不接联盟 API、优惠券 API 或 CPS 转链。
- 不发送邮件、微信、小程序或 Web Push 通知。
- 不做用户登录、返利、订单追踪、提现、社区和商家后台。
- 不承诺历史价格来自真实平台，只展示 `sample`、`manual`、`import` 来源。

## 目标用户和单一任务

目标用户是经常网购、想在下单前快速判断价格是否靠谱的人，尤其是数码、家电、日用品和程序员装备用户。

首屏的单一任务是：**粘贴一个商品链接，然后得到“现在值不值得买”的第一判断。**

这意味着页面不做营销落地页，也不把功能介绍放在核心路径前面。用户打开工具后，应马上看到输入框、支持平台和一个可直接体验的示例入口。

## UI 方向

采用已确认的 **A. 可信查价工具** 方向：克制、清楚、可信，避免大促营销感，也避免过度数据控制台感。

### 视觉主题

主题关键词：买前查验、价格凭据、理性消费、本地记录。

视觉记忆点是 **价格验真台**：结果页顶部像一张价格检测报告，左侧是商品和当前价，右侧是低价评分圆表，中间是判断短句和证据列表。这个结构来自查价场景本身，而不是通用 dashboard 模板。

### 色彩 token

- `--color-ink: #0F172A`：正文和关键数值。
- `--color-muted: #64748B`：说明文字、辅助字段。
- `--color-surface: #FFFFFF`：卡片和输入面。
- `--color-page: #F7FAF8`：页面底色，轻微偏绿灰。
- `--color-primary: #0F766E`：主操作、可信状态、历史数据。
- `--color-primary-soft: #CCFBF1`：低价结果背景。
- `--color-accent: #D97706`：优惠、提醒、需要注意的条件。
- `--color-danger: #DC2626`：偏贵、错误、删除。
- `--color-border: #DCE7E2`：边框和分隔线。

主色不使用高饱和电商红。红色只用于真实危险状态，避免把工具做成促销页。

### 字体和排版

不加载远程字体，沿用系统字体栈，避免首屏阻塞：

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

字体角色：

- Display：用于首屏标题和判断短句，粗体 720-800。
- Body：用于表单、正文和说明，常规 400-500。
- Data：用于价格、分位值、日期和评分，使用 `font-variant-numeric: tabular-nums`。

字号不随 viewport 线性缩放。移动端和桌面分别设定稳定阶梯，避免文本在卡片和按钮中溢出。

### 结构和组件原则

- 打开就是工具，不做大段 hero 营销。
- 首屏只保留一个主输入框和一个主按钮。
- 结果页先回答“值不值得买”，再展示曲线和明细。
- 卡片半径控制在 8px 到 12px，工具表面保持紧凑。
- 不做卡片套卡片；页面区块用全宽背景和约束容器分层。
- 用状态徽章、价格刻度、证据列表表达结构，不用装饰性编号。
- 图表区域固定纵横比，避免加载和 hover 时布局跳动。
- 所有按钮文本使用明确动作：`立即分析`、`记录价格`、`加入关注`、`导出数据`。

### 设计自检

本方向避开了 AI 常见的暖米色 serif 落地页、黑底荧光风和报纸式密集排版。它的风险点在于可能过于克制，所以用“价格验真台”作为唯一鲜明元素：一个报告式顶部区域，把评分、建议和证据集中呈现。其余界面保持安静，让用户相信判断依据，而不是被促销氛围推动。

## 页面设计

### 首页

路径：`/tools/price/`

模块：

1. 顶部栏：品牌、返回 Quick Tools、主题状态。
2. 查价输入区：商品链接或分享文本输入框、`立即分析` 按钮。
3. 支持平台：京东、淘宝、天猫、拼多多。
4. 示例商品：3 到 5 个内置示例，点击进入完整分析页。
5. 最近关注：读取本地 `watches`，展示商品、目标价、最近记录价。
6. 数据边界说明：首版为本地验证版，真实采集和提醒后续接入。

交互：

- 用户粘贴文本后点击 `立即分析`。
- 如果解析成功，创建或打开对应本地商品，进入分析页。
- 如果解析失败，保留输入并显示明确错误。
- 示例入口使用内置数据，不写入真实关注，除非用户主动关注。

### 分析页

路径：`/tools/price/#product=<localProductId>` 或内存视图状态。

模块：

1. 商品基础信息：平台、标题、店铺、标准链接、数据来源。
2. 价格验真台：当前参考价、评分、等级、建议短句。
3. 证据列表：历史最低、近 30 天最低、近 90 天分位、快照数量、限制条件。
4. 历史价格曲线：7 天、30 天、90 天、全部切换。
5. 手动记录：价格、日期、来源说明。
6. 优惠区域：首版展示“后续接入”，允许用户手动备注优惠。
7. 关注设置：目标价、本地关注开关。

结果等级：

- `history_low`：历史低价，值得买。
- `recent_low`：近期低价，可以买。
- `normal`：价格一般，刚需可买。
- `expensive`：偏贵，建议等等。
- `insufficient`：数据不足，先记录或关注。

### 关注页

模块：

- 关注商品列表。
- 当前手动价、目标价、差额。
- 状态：低于目标、接近目标、仍偏高、数据不足。
- 快捷操作：记录价格、打开分析、取消关注。

首版不发送通知。文案应写为“本地关注”，而不是“提醒已开启”。

### 数据页

模块：

- 本地模式说明。
- JSON 导出。
- JSON 导入。
- 清空本地数据。
- 数据来源说明。
- 后续联网能力入口：真实采集、优惠券、邮箱提醒、CPS 转链。

清空数据需要二次确认。

## 数据模型

IndexedDB 数据库名：`zhenjiaAssistantDB`，版本 `1`。

### Product

- `id`: string
- `platform`: `jd | taobao | tmall | pdd | unknown`
- `itemId`: string
- `skuId`: string
- `shopId`: string
- `title`: string
- `shopName`: string
- `imageUrl`: string
- `rawUrl`: string
- `canonicalUrl`: string
- `source`: `parsed | sample | import`
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

### PriceSnapshot

- `id`: string
- `productId`: string
- `capturedAt`: ISO datetime
- `listPrice`: number
- `promoPrice`: number
- `couponPrice`: number
- `finalPrice`: number
- `promotionInfo`: string
- `couponInfo`: string
- `stockStatus`: `in_stock | out_of_stock | unknown`
- `source`: `sample | manual | import`
- `createdAt`: ISO datetime

### Watch

- `id`: string
- `productId`: string
- `targetPrice`: number
- `watchType`: `target_price | history_low | recent_low`
- `enabled`: boolean
- `createdAt`: ISO datetime
- `updatedAt`: ISO datetime

### OpLog

- `id`: string
- `entityType`: `product | priceSnapshot | watch`
- `entityId`: string
- `action`: `create | update | delete | import | export`
- `payload`: object
- `clientTs`: ISO datetime
- `syncState`: `local`

## 核心模块

### `link-parser.js`

职责：

- 从 URL 或分享文本中抽取第一个 URL。
- 识别平台域名。
- 移除常见追踪参数。
- 提取商品 ID 和 SKU。
- 返回标准化结果或错误码。

首版规则：

- 京东：`item.jd.com/{sku}.html`、`jd.com` 商品路径。
- 淘宝：`item.taobao.com/item.htm?id=...`。
- 天猫：`detail.tmall.com/item.htm?id=...`。
- 拼多多：`yangkeduo.com/goods.html?goods_id=...`、`mobile.yangkeduo.com/goods.html?goods_id=...`。

短链：

- 识别短链域名时提示“首版无法展开短链接，请复制完整商品详情页链接”。
- 不尝试绕过平台限制。

### `price-judge.js`

职责：

- 接收当前参考价和历史快照。
- 计算历史最低、近 30 天最低、近 90 天 P20/P70。
- 输出等级、评分、标题、建议、理由。

规则：

- 快照少于 5 条：`insufficient`。
- 当前价 <= 历史最低价：`history_low`。
- 当前价 <= 近 90 天 P20：`recent_low`。
- 当前价位于 P20 到 P70：`normal`。
- 当前价 > P70：`expensive`。

评分先做可解释模型：

- 价格位置：最多 60 分。
- 数据量可信度：最多 15 分。
- 优惠/限制备注：最多 15 分。
- 库存状态：最多 10 分。

### `chart.js`

职责：

- 用 Canvas 或 SVG 绘制轻量折线图。
- 支持范围切换和当前价/历史低价标记。
- 无第三方图表依赖。

设计要求：

- 图表容器固定高度和纵横比。
- 空数据时显示明确行动：`先记录一次价格`。
- 颜色使用主色和中性色，不用复杂渐变。

### `db.js`

职责：

- 管理 IndexedDB schema。
- 提供 CRUD。
- 所有写操作记录 `opLogs`。
- 导入时做基本字段校验。

### `export.js`

职责：

- 生成 JSON 导出 payload。
- 包含 app 名、版本、导出时间、products、priceSnapshots、watches、opLogs。
- 导入时保留来源标记，避免样例数据和用户数据混淆。

## 数据流

```text
用户粘贴链接
  -> link-parser 解析平台和 itemId
  -> db 查找或创建 Product
  -> 加载 Product 的 PriceSnapshot
  -> price-judge 生成判断
  -> app 渲染价格验真台、曲线、关注状态
```

示例商品：

```text
用户点击示例
  -> sample-data 提供 Product + PriceSnapshot
  -> price-judge 生成判断
  -> app 渲染完整分析页
  -> 用户主动关注或记录价格时才写入 IndexedDB
```

手动记录：

```text
用户输入价格
  -> 校验金额和日期
  -> db 写入 PriceSnapshot(source=manual)
  -> price-judge 重新计算
  -> 图表和关注状态刷新
```

## 错误处理

- 不支持平台：`暂不支持该平台链接。首版支持京东、淘宝、天猫和拼多多。`
- 解析失败：`没有识别到商品 ID，请粘贴商品详情页完整链接。`
- 短链：`首版无法展开短链接，请复制完整商品链接后再试。`
- 无价格记录：`还没有价格记录，先手动记录一次当前价。`
- 数据不足：`价格记录少于 5 条，只能给出观察建议。`
- 导入失败：`文件格式不符合真价助手导出结构。`
- IndexedDB 不可用：`浏览器不支持本地数据库，无法保存关注和价格记录。`

错误文案只说明发生了什么和如何修复，不使用道歉或泛化提示。

## PWA 和集成

新增：

- `tools/price/manifest.json`
- `tools/price/sw.js`
- 根 `index.html` 工具卡。
- 根 `manifest.json` shortcut。
- 根 `sw.js` 静态缓存路径。
- `vercel.json` headers 和 rewrites。

缓存策略：

- `tools/price/sw.js` 缓存 app shell。
- HTML 保持可更新。
- CSS/JS 使用版本查询参数或部署缓存头。
- 离线时可以打开工具和读取本地数据。

## 测试计划

### 单元测试

- `tools/price/js/link-parser.test.js`
  - 解析京东、淘宝、天猫、拼多多常见链接。
  - 清理追踪参数。
  - 分享文本提取 URL。
  - 短链返回明确错误。

- `tools/price/js/price-judge.test.js`
  - 快照不足。
  - 历史低价。
  - 近期低价。
  - 价格一般。
  - 偏贵。
  - 分位计算边界。

- `tools/price/js/export.test.js`
  - 导出结构完整。
  - 导入字段校验。
  - 样例数据和用户数据来源不混淆。

### 语法和静态检查

```powershell
node --test tools/price/js/link-parser.test.js tools/price/js/price-judge.test.js tools/price/js/export.test.js
node --check tools/price/js/*.js
node --check tools/price/sw.js
git diff --check
```

### 浏览器验证

- 启动新的本地静态服务端口，访问 `/tools/price/`。
- 桌面宽度验证首页、分析页、关注页、数据页。
- 移动宽度验证输入区、价格验真台、底部操作不重叠。
- 验证示例商品完整流程。
- 验证手动记录价格后评分、图表、关注状态刷新。
- 验证 JSON 导出和导入。
- 验证离线刷新仍能打开 app shell。

## 后续演进

### 阶段 2：轻后端/API

- 新增 `/api/link/parse`。
- 支持短链展开。
- 支持真实商品基础信息查询。
- 前端保留本地模式，在联网失败时可继续使用。

### 阶段 3：价格采集和优惠券

- 价格快照来源增加 `api`。
- 接入官方或合规数据源。
- 优惠区域从占位升级为真实列表。
- 所有价格继续标注为参考价。

### 阶段 4：提醒和转链

- 邮箱提醒。
- 关注管理 token。
- CPS 转链。
- 点击埋点。

## 验收标准

- 用户打开 `/tools/price/` 后 2 秒内看到可输入的主界面。
- 用户可以粘贴常见平台商品链接并得到解析结果。
- 用户可以点击示例商品看到完整分析页。
- 用户可以手动记录价格并看到曲线和判断更新。
- 用户可以把商品加入本地关注并设置目标价。
- 用户可以导出和导入本地数据。
- 页面明确说明真实采集、优惠券和通知尚未接入。
- 桌面和移动端无文本溢出、无控件重叠、无布局跳动。
- 单元测试、语法检查和浏览器验证通过。
