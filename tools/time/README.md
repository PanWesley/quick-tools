# 今日有序

今日有序是 `tools/time/` 下的移动端优先本地 PWA，副标题为“日历、待办与习惯打卡，一起管理美好的今天。”它把待办、习惯、日历和每日一句收束到“今天”这个核心视图里，避免把轻量时间管理做成复杂项目管理系统。

## 产品定位

- 面向个人日常，而不是团队协作。
- 本地优先，无需登录即可使用。
- 首页优先回答“今天要做什么”，高级能力放在清单、日历和我的页。
- 数据安全优先，导出和导入恢复是同步能力之前的基础能力。

## 核心功能

- **今日待办**：展示今天和逾期未完成任务，支持标题、日期、优先级和备注。
- **任务编辑**：任务创建后可继续修改标题、日期、优先级和备注。
- **习惯打卡**：支持每日、工作日、周末和每周计划的轻量打卡。
- **日历标记**：按月展示任务、习惯和每日一句的日期标记。
- **每日一句**：为当天保存一句状态、收获或想法。
- **清单整理**：区分收集箱、即将到来、已完成和最近删除。
- **最近删除**：任务删除后保留为软删除状态，可从清单页恢复。
- **JSON 导出**：导出 tasks、habits、habitLogs、journals、opLogs。
- **JSON 导入恢复**：校验 `app: "today-youxu"` 和 `version: 1`，按 `id` 合并记录，优先保留 `updatedAt` 更新的数据，并记录导入 OpLog。

## 数据与隐私

- 本地数据库：IndexedDB `todayYouxuDB`。
- 本地偏好：复用站点主题偏好 `quick-tools-theme`。
- 默认不需要账号，不上传待办、习惯、日记或备注内容。
- 页面接入站点级匿名统计脚本，仅用于工具打开、路由和活跃时长等匿名指标；用户输入内容不进入统计事件。
- 登录同步和 Web Push 目前只是后续能力入口，MVP 不依赖远端服务。

## 文件结构

```text
tools/time/
├── index.html              # 页面结构和 PWA 入口
├── manifest.json           # 独立 PWA manifest
├── sw.js                   # 今日有序独立 Service Worker
├── README.md               # 工具说明
├── CHANGELOG.md            # 工具变更记录
├── css/
│   └── style.css           # 今日有序样式
└── js/
    ├── app.js              # 页面交互和视图渲染
    ├── app-state.js        # 本地数据选择器和日历状态
    ├── date-utils.js       # 日期工具
    ├── db.js               # IndexedDB 读写与 OpLog
    ├── export.js           # 导出数据结构
    └── import-utils.js     # 导入校验与合并规则
```

## 本地验证

```powershell
node --test tools/time/js/date-utils.test.js tools/time/js/export.test.js tools/time/js/app-state.test.js tools/time/js/import-utils.test.js
node --check tools/time/js/date-utils.js
node --check tools/time/js/export.js
node --check tools/time/js/import-utils.js
node --check tools/time/js/app-state.js
node --check tools/time/js/db.js
node --check tools/time/js/app.js
node --check tools/time/sw.js
```

使用新端口启动静态服务后访问 `/tools/time/`，避免旧 Service Worker 缓存影响验证。

## 后续方向

- 持续打磨编辑、拖延、重复任务和习惯复盘体验。
- 增加更清晰的数据恢复前摘要和导入冲突提示。
- 在本地可靠性稳定后，再考虑账号同步、Web Push 和跨设备能力。
