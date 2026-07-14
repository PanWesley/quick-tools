# 今日有序通知连接恢复与批量同步设计

## 背景

生产 Notifications Worker、D1、VAPID 和 `www.billnest.top/api/notifications*` 路由均已生效。生产 D1 已存在有效设备、PushSubscription 和提醒记录，说明手机能够完成权限授权和服务端注册。客户端仍可能长期显示“正在连接”，原因是 Service Worker ready、Web Lock 等待、PushSubscription 和 HTTP 请求均无截止时间，而且首次同步会在同一个生命周期锁内逐条发送大量提醒。

本次优化不要求 PWA 页面常驻后台。后台投递继续由 Cloudflare Cron、Web Push 和 Service Worker 完成。

## 目标

- 任何连接阶段都不能无限停留在 `subscribing` 或 `syncing`。
- 后台或冻结页面不能长期阻塞新的前台实例。
- 临时锁冲突、离线和超时统一进入可自动恢复的 `pending` 状态。
- 权限拒绝、设备认证失效和不可恢复错误才进入 `error`。
- 首次大量提醒同步使用小批量请求，减少网络往返和持锁时间。
- 保持安装级设备 ID、AES-GCM 端侧加密、revision 幂等和本地 CRUD 不被通知后端阻塞的现有约束。

## 非目标

- 不要求页面、PWA 或浏览器进程在后台保持运行。
- 不把同步调度整体迁移到 Service Worker。
- 不改变提醒 30 个本地日历日的投影范围、15 分钟 stale 规则或通知文案模型。
- 不合并 Analytics D1 与 Notifications D1。

## 方案

### 1. 有界客户端阶段

通知同步模块为以下边界增加可注入截止时间：

- HTTP 请求：默认 15 秒，使用 `AbortController` 中止。
- Service Worker ready：默认 10 秒。
- PushSubscription 创建：默认 20 秒。
- Web Lock：使用非阻塞 `ifAvailable` 请求；锁被其他上下文持有时立即返回 `pending`，不显示无限“正在连接”。

超时、锁忙或网络中断不得清除已保存的启用意图。应用在 `online` 和重新进入前台时继续恢复。页面触发 `pagehide` 或进入 hidden 时，中止当前页面发起的未完成 HTTP 请求，使生命周期锁尽快释放；服务端 revision 和队列 generation 继续防止过期响应覆盖新状态。

### 2. 状态语义

公开状态保持现有集合，避免扩大 UI 状态机：

- `subscribing`：只用于当前前台实例正在进行短期设备或 PushSubscription 建立。
- `syncing`：只用于当前前台实例正在发送一个有界批次。
- `pending`：离线、锁忙、超时、剩余队列待处理或页面被挂起。
- `ready`：PushSubscription 已在服务端登记，且当前投影队列已同步。
- `error`：权限拒绝、认证重置、终止队列或不可恢复的客户端能力错误。

UI 在 `pending` 时显示“等待同步”并允许用户重新触发；按钮不因另一个上下文持锁而永久禁用。

### 3. 批量提醒 API

新增设备认证接口：

```text
POST /api/notifications/reminders/batch
```

请求体包含最多 25 个操作。每个操作只能是：

- `upsert`：包含提醒 ID、tool、sourceIdHash、notifyAt、AES-GCM 密文、encryptionVersion 和 revision。
- `cancel`：包含提醒 ID 和 revision。

Worker 复用现有单条校验和 repository 语义，逐项返回 `applied`、`stale` 或 `unknown` 结果。请求仍受 128 KiB 总体限制；客户端同时按 25 条和序列化字节数切块。任一条结构非法时整批返回 400，不执行部分写入。有效批次可按 D1 能力分组执行，但每条提醒必须保持现有 revision 幂等结果。

旧的单条 PUT/DELETE 接口继续保留。客户端遇到批量接口 404 或 405 时，在当前安装会话内降级为现有单条队列，保证分阶段部署兼容；其他 4xx 不静默降级。

### 4. 同步与恢复流程

1. 客户端完成通知权限和 PushSubscription 登记。
2. 本地模型生成 30 个日历日内的密文提醒。
3. 队列按逻辑键和 revision 去重。
4. 客户端从队列取最多 25 条组成批次，成功后按 generation 删除对应队列项。
5. 所有提醒操作完成后发送 reconcile 摘要。
6. 若仍有未到重试时间、锁忙或超时的项目，返回 `pending`；前台或网络恢复时继续。
7. 队列清空且 reconcile 成功后返回 `ready`，测试通知独立执行，不阻塞启用状态落盘。

每个批次完成后释放生命周期锁，再由恢复调度申请下一批，避免一个页面在大量提醒同步期间长期持锁。页面进入后台时不继续依赖定时器，剩余工作保存在 IndexedDB。

## 数据与安全

- 批量接口只接收现有 AES-GCM envelope，不接收明文标题或正文。
- VAPID 私钥仍只存在 Worker Secret。
- 设备 token 继续使用 Bearer header，日志不得记录 token、PushSubscription keys、endpoint 或密文。
- 批量响应不返回已保存的密文、设备凭证或订阅信息。
- D1 不需要新表或 schema migration。

## 测试

客户端自动测试覆盖：

- Web Lock 被占用时快速返回 `pending`，随后前台恢复成功。
- HTTP、Service Worker ready 和 PushSubscription 超时不会永久保持 `subscribing`。
- `pagehide`/hidden 中止当前请求，启用意图和队列仍保留。
- 84 条提醒被拆分为有界批次，成功后按 generation 清队列。
- 批量接口不可用时只对 404/405 回退单条接口。
- 超时、离线、认证错误和终止错误映射到正确公开状态。

Worker 自动测试覆盖：

- 批量路由鉴权、请求上限、结构校验和 128 KiB 限制。
- upsert、cancel、stale revision 和 unknown ID 的混合批次。
- 非法批次不产生部分写入。
- 单条接口、Cron 和 Web Push 行为无回归。

浏览器验证覆盖桌面和移动视口，并人工验证同源两个页面竞争、页面退后台后重新进入、首次大量提醒同步以及测试通知。生产发布后再进行 iOS/iPadOS 主屏 PWA、Android Chromium PWA 和桌面 Chromium 的后台投递验收。

## 发布与回滚

先部署兼容旧客户端的 Worker 批量接口，再发布客户端。客户端保留单条接口回退，因此 Worker 或前端可独立回滚。发布后检查 config、设备注册、批量请求、reconcile、Cron 和 D1 状态分布；不得通过删除 D1、订阅或 secrets 进行常规回滚。

