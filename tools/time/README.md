# 今日有序

今日有序是 `tools/time/` 下的移动端优先本地 PWA，用于管理今天的待办、习惯打卡、日历标记和每日一句。

## 范围

- 本地优先，无需登录即可使用。
- 数据保存在 IndexedDB `todayYouxuDB`。
- 支持任务、习惯、习惯记录、每日一句、OpLog。
- 支持 JSON 导出。
- 登录同步与 Web Push 目前仅作为后续能力入口展示。

## 本地验证

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js
node --check tools/time/js/*.js
node --check tools/time/sw.js
```

使用新端口启动静态服务后访问 `/tools/time/`，避免旧 Service Worker 缓存影响验证。
