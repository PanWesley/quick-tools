# 今日有序后台通知与 BillNest 设备基础设计

日期：2026-07-11

## 背景

`tools/time` 当前通过页面内的 `setTimeout` 和 `setInterval` 调度提醒，再调用 Notifications API 或 Service Worker 显示系统通知。PWA 进入后台、被冻结或被关闭后，页面定时器无法可靠执行；重新回到前台时，应用才检查过去的提醒并补发，因此会出现通知延迟和过期通知集中弹出的现象。

Service Worker 可以在收到 Push API 事件后被浏览器唤醒，但不会仅因为本地时间到达而自行运行。要让已安装 PWA 在未打开时仍可靠提醒，需要由服务端到点发送 Web Push。

仓库已有 Cloudflare Worker + D1 的匿名统计后端。本设计复用同一 Cloudflare 基础设施和域名，但将通知、统计和未来账号能力按服务及数据边界隔离。

## 目标

- `tools/time` 在后台或关闭后仍可收到系统通知。
- 通知调度误差目标为一分钟以内，不承诺秒级准时。
- 通知横幅简洁，能直接识别事项和时间。
- 无需登录即可使用后台通知。
- 每个 PWA 安装实例具有稳定的安装级设备 ID。
- 通知标题和正文端侧加密，后端无法读取任务内容。
- 本地任务保存不依赖通知后端可用性。
- 为其他 tools、未来登录和数据同步提供可复用的设备身份基础。
- 保持现有匿名分析数据与通知数据隔离。

## 非目标

- 本阶段不实现用户注册、登录、账号恢复或跨设备同步。
- 不将任务、习惯、备注、每日一句或账单完整数据上传到后端。
- 不提供秒级通知调度承诺。
- 不合并现有 Analytics D1 与 Notifications D1。
- 不使用设备硬件标识，也不尝试绕过浏览器隐私边界。
- 不在第一阶段引入 Durable Objects、Queues 或 Workflows；规模和精度需要出现后再评估。

## 服务边界

```text
billnest.top/api
├── /analytics/*       billnest-analytics Worker + Analytics D1
├── /notifications/*   billnest-notifications Worker + Notifications D1
├── /auth/*            未来账号服务
└── /sync/*            未来跨设备同步服务
```

通知服务作为独立 Worker 部署，拥有独立的 D1 数据库、VAPID 密钥、路由和日志。统计 Worker 保持现有匿名采集职责，不读取通知订阅、提醒时间或设备凭证。

未来服务可以共享无状态基础模块，例如 JSON 响应、请求校验、同源检查、限流键、ID 生成和鉴权解析，但不能共享业务表或业务密钥。

## 调度方案

第一阶段使用 Notifications D1 + Cloudflare Cron Trigger：

1. 客户端创建或修改需要提醒的事项。
2. 客户端计算绝对提醒时间 `notify_at`，加密横幅内容后写入通知 API。
3. Cron 每分钟执行一次，领取 `notify_at <= now` 的待发送提醒。
4. Worker 使用 Web Push 向目标订阅发送加密载荷。
5. Service Worker 收到 `push` 事件后解密载荷并显示系统通知。
6. Worker 根据发送结果将提醒标记为已发送、待重试或失败。

前台页面定时器继续作为应用打开时的精确补充，但不再是后台可靠性的基础。服务端提醒和前台提醒使用相同幂等键，避免重复通知。

若后续提醒量显著增长，可在 Cron 与推送发送之间增加 Queue。只有出现明确的秒级精度需求时，才评估 Durable Object Alarm。

## 安装级设备身份

设备身份代表一个浏览器/PWA 安装实例，不代表物理硬件。

首次启用后台通知时：

1. 客户端在 IndexedDB 中创建本地安装记录。
2. 客户端请求服务端注册设备。
3. 服务端生成不可猜测的 `device_id` 和一次性返回的 `device_token`。
4. 客户端保存 `device_id`、`device_token` 和通知加密密钥。
5. 服务端只保存 `device_token` 的安全哈希。

`device_id` 是公开标识，不能单独授权修改设备或提醒；所有设备级写操作必须携带 `device_token`。后续登录时，服务端可以为设备记录补充 `user_id`，无需改变设备 ID、推送订阅或现有提醒。

稳定性边界：

- 正常关闭、升级或重启 PWA 后设备 ID 保持不变。
- 清除站点数据或重新安装 PWA 后可能生成新的设备 ID。
- 不同浏览器、不同安装实例和不同物理设备使用不同设备 ID。
- 未登录阶段无法在清除站点数据后恢复原设备身份；登录能力将负责正式恢复和绑定。

## 端侧加密

通知标题和正文使用设备本地生成的 AES-GCM 密钥加密。密钥保存在 `tools/time` 可由页面和 Service Worker 访问的 IndexedDB 中，不上传到 BillNest 后端。

上传的提醒包含：

- `device_id`
- `tool`
- `source_id_hash`
- `notify_at`
- `encrypted_payload`
- `encryption_version`
- 幂等版本号

加密载荷包含：

- 通知标题
- 通知正文
- 通知 tag
- 点击目标
- 提醒计划时间
- 载荷版本

每次加密使用新的随机 IV，并将版本、IV 和密文封装为可验证的 JSON 结构。服务端只转发密文，不记录明文任务标题、备注或完整任务数据。

Service Worker 解密失败时显示通用兜底通知“你有一项提醒”，正文为“打开今日有序查看详情”。解密失败不得导致推送事件无可见通知。

## 数据模型

### devices

- `id`: 安装级设备 ID
- `user_id`: nullable，未来账号绑定
- `token_hash`: 设备凭证哈希
- `platform`: 粗粒度平台类别
- `timezone`: IANA 时区
- `created_at`
- `updated_at`
- `last_seen_at`
- `revoked_at`: nullable

### push_subscriptions

- `id`
- `device_id`
- `endpoint`
- `p256dh`
- `auth`
- `created_at`
- `updated_at`
- `expires_at`: nullable
- `invalidated_at`: nullable

每台设备只保留当前有效订阅。Push 服务返回永久失效状态时，将订阅标记为无效并停止重试。

### reminders

- `id`: 客户端稳定提醒 ID
- `device_id`
- `user_id`: nullable
- `tool`
- `source_id_hash`
- `notify_at`: UTC
- `encrypted_payload`
- `encryption_version`
- `revision`: 单调递增版本
- `status`: `pending | processing | sent | retry | failed | cancelled | expired`
- `attempt_count`
- `lease_until`: nullable
- `last_error_code`: nullable
- `created_at`
- `updated_at`
- `sent_at`: nullable

核心索引覆盖 `(status, notify_at)`、`device_id` 和 `(device_id, source_id_hash)`。

### notification_deliveries

第一阶段不保存完整逐次请求和密文副本，只保存必要的投递诊断聚合。若实现需要逐次记录，则仅保存提醒 ID、结果码、耗时和时间，不重复保存订阅密钥或通知内容。

## API

### `GET /api/notifications/config`

返回客户端创建 PushSubscription 所需的 VAPID 公钥和通知协议版本。该接口不返回私钥、设备信息或任何提醒数据。

### `POST /api/notifications/devices`

注册匿名安装实例，返回 `device_id` 和只显示一次的 `device_token`。请求可以包含平台类别、时区和客户端版本，不接受硬件标识。

### `PUT /api/notifications/devices/:id/subscription`

创建或替换当前 PushSubscription。需要设备凭证。重复提交相同订阅应幂等成功。

### `DELETE /api/notifications/devices/:id/subscription`

关闭当前设备的后台通知，取消未来提醒并使当前 PushSubscription 失效。需要设备凭证，重复调用应幂等成功。

### `PUT /api/notifications/reminders/:id`

创建或更新提醒。需要设备凭证。客户端提供 `revision`；相同版本作为幂等重放处理，只有更高版本可以改变已有提醒，避免离线旧写覆盖新提醒。

### `DELETE /api/notifications/reminders/:id`

取消提醒。删除采用状态变更而不是立即物理删除，确保并发 Cron 不会继续发送已取消提醒。

### `POST /api/notifications/reconcile`

客户端提交有限范围的未来提醒 ID 和版本摘要。服务端返回缺失、过期或需要重传的提醒，不上传完整任务集合。

### `POST /api/notifications/test`

客户端提交一条端侧加密测试载荷，服务端立即向当前设备发送。接口受设备级频率限制，测试通知不进入正式提醒统计。

所有写接口：

- 生产环境只接受 HTTPS，并校验 `billnest.top` 与 `www.billnest.top` 来源；本地和预览来源通过部署配置显式加入允许列表。
- 使用 `Authorization: Bearer <device_token>`。
- 校验请求体大小、时间范围、字段长度和版本。
- 返回统一错误结构和可重试标识。
- 不在 URL 查询参数中传递设备 token。

## 客户端同步

本地任务或习惯写入成功后，再异步同步服务端提醒。通知后端失败不得回滚本地数据，也不得阻止关闭编辑弹窗。

通知同步的跨页面/Service Worker 生命周期互斥依赖原生 Web Locks API，锁名为 `today-youxu-notification-lifecycle`。缺少 `navigator.locks` 时后台同步返回 `unsupported`，不使用无法保证竞态安全的本地锁降级；这不会禁用本地 CRUD。

客户端维护通知同步队列，记录：

- 操作类型：upsert、cancel、reconcile
- 提醒 ID 和 revision
- 重试次数
- 下次重试时间
- 最近错误类别

以下时机触发重试：

- 网络恢复
- PWA 启动
- PWA 回到前台
- 创建、修改、完成或删除相关事项
- 用户重新开启通知

重试使用带上限的退避。认证失败停止自动重试并重新注册设备；订阅失效则重新调用 `PushManager.subscribe()`。设置页将同步状态映射为 `pending`（等待同步）、`unsupported`（当前设备不支持）和 `error`（需要重新授权），不以本地保存成功掩盖通知后端失败。

应用启动时执行轻量对账，只比较未来 30 天有效提醒的摘要。对账不能上传备注、日记或无提醒任务。

## 服务端领取与重试

Cron 每分钟：

1. 回收 `lease_until` 已过期的 `processing` 提醒。
2. 按 `notify_at` 查询一批 `pending` 或到期 `retry` 提醒。
3. 使用条件更新设置 `processing` 和短期 `lease_until`，只处理成功领取的记录。
4. 发送 Web Push。
5. 成功后标记 `sent`；临时错误进入 `retry`；永久订阅错误标记订阅失效并将提醒置为 `failed`。

提醒发送必须幂等。客户端提醒 ID、revision、服务端状态和通知 tag 共同阻止重复显示。一次 Cron 超过批次上限时，由下一分钟继续处理，不无限扩大单次任务。

推送设置 15 分钟有效期。超过有效窗口的提醒不再作为系统横幅投递，以避免设备恢复联网后集中显示陈旧提醒。

## 通知内容设计

通知标题始终使用事项名称，正文最多包含两个信息段。

任务准时提醒：

```text
项目周会
10:30 · 工作
```

提前提醒：

```text
项目周会
10:30 开始 · 还有 15 分钟
```

习惯提醒：

```text
喝水
今日打卡 · 健康
```

全天任务：

```text
提交报销
今天 · 工作
```

不显示“任务提醒”“时间到了”“已到期”等重复标签，不在横幅显示备注、优先级说明或内部错误。习惯优先使用自身设置的开始时间；没有时间的全天习惯默认上午 9:00。

点击通知打开 `/tools/time/`，切换到相关日期并定位对应任务或习惯。若事项已删除或定位失败，则回到今日视图并保持应用可用。

系统字体、横幅尺寸和最终布局由操作系统控制，本项目只控制标题、正文、图标、tag、载荷和点击行为。

## 过期与前台补充行为

- Web Push 的有效窗口为计划时间后 15 分钟。
- 超过窗口的服务端提醒标记为失败或过期，不再发送。
- 回到 PWA 时不逐条补发过期系统通知。
- 应用内可以显示一次简短状态提示，例如“有 2 条提醒已错过”。
- 前台精确定时器触发的通知与服务端通知共享幂等状态；任何一方成功后，另一方不应重复展示。
- 当前基于 `visibilitychange` 的逐条漏提醒逻辑将被替换为对账和应用内摘要。

## 隐私与安全

- 不采集物理设备 ID、通讯录或广告标识。
- 不上传任务备注、每日一句、完整任务或账单数据。
- `device_token` 仅保存在客户端，服务端保存哈希。
- 推送订阅端点及密钥仅存在 Notifications D1，不进入 Analytics D1 或分析事件。
- VAPID 私钥只作为 Worker Secret 配置，不进入仓库或 D1。
- 加密密钥只存在设备 IndexedDB，不写入日志或分析事件。
- 日志不得输出完整 Authorization、PushSubscription、密文载荷或解密内容。
- 接口实施同源检查、速率限制、固定字段白名单和最大时间范围。
- 设备撤销后拒绝所有写入并取消未发送提醒。

## 数据保留

- 已发送、取消、失败和过期提醒保留有限诊断周期后清理。
- 无效 PushSubscription 定期清理。
- 长期不活跃的匿名设备可在无待处理提醒时清理。
- 具体保留天数通过配置确定，默认建议提醒记录 30 天、失效订阅 7 天、匿名空设备 90 天。

## 可观测性

通知服务记录不含内容的指标：

- 已注册设备数和有效订阅数
- 待发送、成功、重试、失败和过期数量
- 投递延迟分布
- 永久失效订阅数量
- Cron 每批处理量和持续时间
- API 错误率及限流数量

`/analytics/` 后续可以增加通知运行状态视图，但读取通知指标需要独立管理权限，不复用公开采集接口，也不展示设备级明细。

## 代码组织

建议结构：

```text
workers/
├── analytics-worker.mjs
├── analytics-core.mjs
├── notifications/
│   ├── worker.mjs
│   ├── core.mjs
│   ├── web-push.mjs
│   ├── schema.sql
│   └── migrations/
└── shared/
    ├── http.mjs
    └── validation.mjs

tools/time/js/
├── notification.js
├── notification-crypto.js
└── notification-sync.js
```

现有 `notification.js` 继续负责通知偏好、时间计算和前台生命周期，但服务器同步、加密及队列拆到独立模块，避免继续扩大单文件职责。

## 测试策略

### 单元测试

- 提醒偏移和绝对时间计算，包括时区及夏令时边界。
- 任务、提前提醒、习惯和全天任务横幅格式。
- AES-GCM 加密、解密、随机 IV 和错误兜底。
- 稳定提醒 ID、source hash 和 revision 比较。
- 同一提醒的前台/服务端去重。
- 服务端请求校验、设备鉴权和错误分类。
- Cron 领取锁、租约回收、批次上限和状态转换。
- 临时推送错误重试与永久订阅失效处理。

### 集成测试

- 匿名设备注册、订阅创建、提醒 upsert、修改和取消。
- 重复 API 请求保持幂等。
- 离线旧 revision 不能覆盖新提醒。
- Cron 只发送已领取且未取消的到期提醒。
- 加密载荷由 Service Worker 解密并形成预期通知选项。
- 通知点击打开并定位事项。

### 浏览器与 PWA 验证

- 安装后设备 ID 在重启与刷新后保持稳定。
- 应用前台、后台和关闭情况下的真实 Web Push。
- 网络中断后恢复同步，不影响本地任务操作。
- 过期超过 15 分钟的提醒不集中弹出。
- iOS/iPadOS 主屏 PWA、Android Chromium PWA 和桌面 Chromium 至少各完成一轮能力验证；不支持的平台显示真实状态。
- Service Worker 更新后旧缓存不会继续运行已废弃的本地补发逻辑。

支持边界：后台通知需要安全上下文以及 Push API、Notifications API、Service Worker、IndexedDB、Web Crypto 和原生 Web Locks。iOS/iPadOS 仅在支持 Web Push 的系统与主屏安装 PWA 上纳入支持矩阵；Android Chromium PWA 和桌面 Chromium 需逐版本真机验证。普通标签页、隐私模式、权限拒绝、企业策略、系统省电策略或缺少任一 API 时，均不得承诺后台投递。

## 发布与迁移

1. 新增通知 Worker、Notifications D1、迁移和本地测试。
2. 配置 VAPID 密钥、Cron 和 `/api/notifications/*` 路由。
3. 前端以能力检测接入设备注册和 Web Push，不自动弹权限请求。
4. 已授权当前本地通知的用户需要通过明确操作升级为后台通知；不能静默创建 PushSubscription。
5. 灰度期间保留前台提醒，但关闭逐条过期补发。
6. 验证后台推送稳定后，更新 README 和 CHANGELOG 中关于后台能力的准确描述。

部署需要 Cloudflare 账号中的 D1 创建、Worker Secret、Cron 和路由配置。代码可以在本地完成和验证，但生产部署必须确认这些外部配置均已生效。

controller 的部署顺序与命令如下；执行前必须先完成 `wrangler whoami`，并审阅 `--update-config` 写入的真实 D1 UUID，任何 ID 都不得预填或编造：

```bash
cd workers/notifications
pnpm exec wrangler d1 create billnest_notifications --binding NOTIFICATIONS_DB --update-config
pnpm exec wrangler d1 migrations apply NOTIFICATIONS_DB --remote
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
pnpm exec wrangler secret put VAPID_SUBJECT
pnpm exec wrangler deploy
```

`wrangler.jsonc` 必须保留 `crons: ["* * * * *"]`，并配置 `billnest.top/api/notifications*` 与 `www.billnest.top/api/notifications*` 两条 route；routes 与 Cron 由 deploy 一并发布。部署后验证 `/api/notifications/config`、Cron、stale 过期、密文网络载荷、本地 CRUD 降级以及真机矩阵。

回滚时先使用 `pnpm exec wrangler deployments list` 找到上一版本，再执行 `pnpm exec wrangler rollback <previous-version-id>`。route/Cron 错误通过恢复上一版配置并重新 deploy 回滚。Worker 版本回滚不回滚 D1；迁移问题必须停止写流量并由 controller 使用 D1 自动备份/Time Travel 恢复，不能删除数据库或 secrets 代替回滚。

## 当前验证边界

- 已实现并由本地自动测试覆盖：AES-GCM 密文模型、安装身份持久化、同步队列和状态、Web Locks 生命周期串行化、Worker API/D1 repository/Cron 状态机、Service Worker 解密/兜底/点击定位及本地 CRUD 与通知后端失败解耦。
- 已验证：生产 Cloudflare 账号、Notifications D1 binding 和迁移、VAPID secrets、两条生产 routes、每分钟 Cron、Worker deploy，以及生产 `/api/notifications/config` 返回协议版本和 VAPID 公钥。
- 尚未验证：远端投递日志与指标，以及 iOS/iPadOS、Android、桌面真机的后台和关闭状态投递。因此在真机矩阵完成前，不能声明所有支持平台的生产后台通知已经验收完成。

## 验收标准

- 未登录用户可注册稳定的安装级设备 ID 并启用后台通知。
- 设备 ID 在正常重启和刷新后保持不变，清理站点数据后的新 ID 行为有明确说明。
- 通知后端无法读取任务或习惯标题明文。
- 创建、修改、完成和删除事项会正确创建、更新或取消服务端提醒。
- PWA 未处于前台时，提醒可由 Web Push 唤醒 Service Worker 并显示。
- 通知横幅符合已确认的两行模板。
- 通知点击能定位对应事项，定位失败时安全回到今日视图。
- 同一提醒不会因前台定时器、Cron 重试或重复 API 请求而重复显示。
- 超过计划时间 15 分钟的提醒不会作为过期系统横幅集中出现。
- 后端不可用时，本地任务及习惯操作仍正常，恢复网络后自动重试通知同步。
- Analytics Worker 和数据库不接触设备订阅、提醒时间或通知密文。
- 现有 `tools/time` 单元测试继续通过，并新增通知客户端、Worker 和集成测试。
