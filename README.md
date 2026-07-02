# Quick Tools - 在线开发工具集

一个简洁高效的在线工具集合，包含文本对比、JSON 格式化、生活账单、今日时间管理等实用工具。

🔗 **在线访问**: https://quick-tools-nine.vercel.app/

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Web-brightgreen.svg)

## 站点级匿名统计

- 统计入口：`/analytics/`
- 采集范围：网站首页和各工具首页，包括 `/tools/diff/`、`/tools/json/`、`/tools/expense/`、`/tools/time/`
- 采集字段：匿名会话、工具标识、规范化路由、页面视图、设备类型、来源类型和活跃时长
- 不采集内容：账单金额、备注、标签名、JSON 输入内容、文本对比内容、待办内容等用户输入数据
- 后端：Cloudflare Worker + D1，接口为 `/api/analytics` 和 `/api/analytics/summary`
- 可视化：用 `ANALYTICS_READ_TOKEN` 在 `/analytics/` 查看 DAU、sessions、pageviews、平均停留、工具排行和页面排行

## 🛠️ 包含工具

### 1. 📊 Diff 文本对比工具
一个功能强大的在线文本对比工具，支持语法高亮、深色模式、实时对比等功能。

**访问路径**: `/tools/diff/`

#### 功能特性
- 🔍 **智能差异检测** - 基于 LCS 算法，支持字符级、单词级、行级对比
- 📝 **语法高亮** - 支持 JavaScript、Python、Java、CSS、HTML 等语言
- 🎨 **深色/浅色模式** - 一键切换，自动保存偏好
- ⚡ **实时对比** - 开启后输入即自动对比（500ms 防抖）
- 👁 **隐藏未变行** - 聚焦差异内容，提升可读性
- 📁 **文件上传** - 直接加载本地文件进行对比
- 💾 **下载结果** - 导出对比结果为文本文件
- 🔄 **交换文本** - 快速交换左右两侧内容
- 📋 **加载示例** - 一键加载示例代码体验功能
- 📊 **合并视图** - 统一显示差异，类似 Git diff
- 📑 **并排视图** - 左右对照，直观对比

---

### 2. 🧩 JSON 格式化工具
一个功能完善的 JSON 处理工具，支持格式化、验证、压缩、转义等功能。

**访问路径**: `/tools/json/`

#### 功能特性
- 📝 **格式化 JSON** - 将压缩的 JSON 格式化为易读形式
- ✅ **验证 JSON** - 检查 JSON 语法是否正确
- 🗜️ **压缩 JSON** - 移除所有空白字符，减小体积
- 🔒 **转义 JSON** - 将 JSON 字符串转义为可嵌入代码的形式
- 🔓 **反转义 JSON** - 将转义后的 JSON 字符串还原
- 🎨 **语法高亮** - 彩色显示 JSON 键、字符串、数字、布尔值等
- 📁 **文件上传** - 直接加载本地 JSON 文件
- 💾 **下载结果** - 导出处理后的 JSON 文件
- 📋 **粘贴自动格式化** - 从剪贴板粘贴时自动格式化
- 🎨 **深色/浅色模式** - 一键切换，自动保存偏好

---

### 3. 💰 生活账单
一个本地优先的轻量记账 PWA，适合记录日常收入、支出、标签维度和月度概览。

**访问路径**: `/tools/expense/`

#### 功能特性
- 🧾 **快速记账** - 支持收入、支出、日期、备注、分类和多维标签
- 📊 **概览分析** - 支持总额、分类占比、TOP 分类、趋势和花费提醒
- 🗓️ **日历热力图** - 按日期查看支出强度和当天明细
- 🏷️ **标签管理** - 支持分组标签、搜索、移动、合并和批量整理
- 🔐 **数据安全** - 支持本地 JSON 备份、恢复、可选加密和恢复前摘要
- 📱 **PWA 体验** - 支持移动端主屏使用和离线静态资源缓存

---

### 4. 🌿 今日有序
一个移动端优先的轻量时间管理 PWA，把日历、待办和习惯打卡收在“今天”这一个核心视图里。

**访问路径**: `/tools/time/`

#### 功能特性
- ✅ **今日待办** - 聚合今天和逾期未完成任务，支持优先级和备注
- 🔁 **习惯打卡** - 支持每日、工作日和每周习惯的轻量打卡
- 🗓️ **日历标记** - 在月历中标记任务、习惯和每日一句
- 📝 **每日一句** - 给当天留一条简短状态或复盘记录
- ♻️ **最近删除** - 任务软删除后可在清单页恢复
- 📦 **导出导入** - 支持 JSON 导出和合并式导入恢复

---

## 🚀 快速开始

### 在线使用
直接访问 https://quick-tools-nine.vercel.app/ 即可使用

### 本地运行
```bash
# 克隆仓库
git clone https://github.com/PanWesley/quick-tools.git

# 进入目录
cd quick-tools

# 启动本地服务器（任选一种）
# Python 3
python -m http.server 8080

# Node.js
npx serve .

# 然后访问 http://localhost:8080
```

## 📁 项目结构

```
quick-tools/
├── index.html              # 入口首页，工具导航
├── README.md               # 项目说明
├── LICENSE                 # 许可证
├── tools/                  # 工具目录
│   ├── diff/               # Diff 对比工具
│   │   └── index.html
│   ├── json/               # JSON 格式化工具
│   │   └── index.html
│   ├── expense/            # 生活账单 PWA
│   │   ├── README.md
│   │   └── CHANGELOG.md
│   └── time/               # 今日有序时间管理 PWA
│       ├── README.md
│       └── CHANGELOG.md
├── analytics/              # 站点级匿名统计看板
├── workers/                # Cloudflare Worker 示例
└── shared/                 # 共享样式与站点统计脚本
    ├── css/
    └── js/
```

## 🛠 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **本地数据**: IndexedDB、localStorage、JSON 备份文件
- **PWA**: Web App Manifest、Service Worker、离线静态资源缓存
- **语法高亮**: [Prism.js](https://prismjs.com/) (Diff 工具)
- **部署**: [Vercel](https://vercel.com/)
- **统计后端**: Cloudflare Worker + D1
- **算法**: LCS (最长公共子序列) 差异算法

## 📝 更新日志

### 2026-07
- ✨ 新增今日有序时间管理 PWA，支持今日待办、习惯打卡、日历和每日一句。
- ♻️ 今日有序新增任务编辑、最近删除恢复和 JSON 合并导入。
- 📊 新增站点级匿名统计看板，用于观察工具使用趋势，不采集用户输入内容。
- 🧾 生活账单持续完善筛选、备份恢复、移动端体验和 PWA 启动性能。

### 2024-01
- ✨ 新增 JSON 格式化工具
- 🏠 新增统一入口首页
- 🔗 整合 Diff 工具和 JSON 工具到同一仓库

### 2024-01
- ✨ 新增语法高亮功能
- 🌙 新增深色模式
- ⚡ 新增实时对比
- 👁 新增隐藏未变行
- 💾 新增下载结果功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT License](LICENSE)

---

Made with ❤️ by [PanWesley](https://github.com/PanWesley)
