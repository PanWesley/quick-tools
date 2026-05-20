# Diff 对比工具

一个简洁高效的在线文本对比工具，支持语法高亮、深色模式、实时对比等功能。

🔗 **在线访问**: https://quick-tools-nine.vercel.app/

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Web-brightgreen.svg)

## ✨ 功能特性

### 核心对比功能
- 🔍 **智能差异检测** - 基于 LCS 算法，支持字符级、单词级、行级对比
- 📝 **语法高亮** - 支持 JavaScript、Python、Java、CSS、HTML 等语言
- 🎨 **深色/浅色模式** - 一键切换，自动保存偏好
- ⚡ **实时对比** - 开启后输入即自动对比（500ms 防抖）
- 👁 **隐藏未变行** - 聚焦差异内容，提升可读性

### 实用工具
- 📁 **文件上传** - 直接加载本地文件进行对比
- 💾 **下载结果** - 导出对比结果为文本文件
- 🔄 **交换文本** - 快速交换左右两侧内容
- 📋 **加载示例** - 一键加载示例代码体验功能

### 视图模式
- 📊 **合并视图** - 统一显示差异，类似 Git diff
- 📑 **并排视图** - 左右对照，直观对比

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

## 📖 使用指南

### 基础对比
1. 在左侧输入原始文本，右侧输入修改后的文本
2. 点击「🔍 查找差异」按钮
3. 查看对比结果和统计信息

### 开启实时对比
1. 点击「⚡ 实时对比」按钮
2. 在任意一侧输入内容，对比结果会自动更新

### 切换主题
1. 点击右上角的 🌙/☀️ 图标
2. 主题偏好会自动保存

### 隐藏未变行
1. 对比完成后，点击结果区的「👁 隐藏未变行」
2. 只显示有差异的行，方便快速定位

## 🛠 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **语法高亮**: [Prism.js](https://prismjs.com/)
- **部署**: [Vercel](https://vercel.com/)
- **算法**: LCS (最长公共子序列) 差异算法

## 📝 更新日志

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
