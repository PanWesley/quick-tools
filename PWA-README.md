# Quick Tools - PWA 移动端版本

无需小程序审核，无需域名备案，直接在手机浏览器中使用，支持添加到主屏幕像原生 App 一样运行。

## 特性

- 📱 **PWA 支持** - 可添加到手机主屏幕，离线可用
- 🎨 **响应式设计** - 完美适配手机、平板、桌面端
- 🌙 **深色模式** - 支持自动/手动切换深色主题
- 📤 **系统分享** - 调用原生分享面板
- 📋 **剪贴板集成** - 一键粘贴、复制
- ⚡ **离线缓存** - Service Worker 缓存，无网也能用
- 🔔 **安装引导** - 自动提示添加到主屏幕

## 使用方法

### 方式一：直接浏览器访问

1. 手机浏览器打开：`https://quick-tools-nine.vercel.app`
2. 即可使用所有功能

### 方式二：添加到主屏幕（推荐）

#### iPhone (Safari)
1. 用 Safari 打开网站
2. 点击底部分享按钮 ⎋
3. 选择「添加到主屏幕」
4. 点击「添加」

#### Android (Chrome)
1. 用 Chrome 打开网站
2. 等待底部弹出「添加到主屏幕」提示
3. 点击「添加」
4. 或者在菜单中选择「添加到主屏幕」

## 技术实现

### PWA 核心文件

```
├── manifest.json          # PWA 配置清单
├── sw.js                  # Service Worker（离线缓存）
├── shared/js/pwa.js       # PWA 功能脚本
└── shared/css/pwa.css     # PWA 样式
```

### 主要功能

| 功能 | 说明 |
|------|------|
| Service Worker | 缓存静态资源，支持离线访问 |
| Web App Manifest | 定义应用名称、图标、主题色等 |
| beforeinstallprompt | Android 自动安装提示 |
| iOS 引导 | 针对 Safari 的自定义安装引导 |
| 系统分享 | Web Share API |
| 剪贴板 | Clipboard API |

## 浏览器支持

| 浏览器 | PWA 支持 | 安装方式 |
|--------|---------|---------|
| Chrome (Android) | ✅ 完整支持 | 自动提示安装 |
| Safari (iOS) | ✅ 支持 | 手动添加到主屏幕 |
| Firefox | ⚠️ 部分支持 | 书签方式 |
| Edge | ✅ 完整支持 | 自动提示安装 |
| 微信内置浏览器 | ⚠️ 基本可用 | 建议用系统浏览器 |
| QQ 内置浏览器 | ⚠️ 基本可用 | 建议用系统浏览器 |

## 与小程序对比

| 特性 | PWA 网页版 | 小程序 |
|------|-----------|--------|
| 审核 | ❌ 无需审核 | ✅ 需要平台审核 |
| 备案 | ❌ 无需备案 | ✅ 域名需备案 |
| 安装 | 添加到主屏幕 | 应用商店下载 |
| 离线使用 | ✅ 支持 | ✅ 支持 |
| 推送通知 | ⚠️ 有限支持 | ✅ 完整支持 |
| 系统分享 | ✅ 支持 | ✅ 支持 |
| 开发成本 | 低 | 中 |
| 跨平台 | 所有浏览器 | 需适配各平台 |

## 优化建议

### 1. 添加更多移动端功能

在 `shared/js/pwa.js` 中可以扩展：

```javascript
// 添加震动反馈
pwa.vibrate(100);

// 系统分享
pwa.share({
  title: 'JSON 格式化结果',
  text: '查看我格式化的 JSON',
  url: window.location.href
});

// 复制到剪贴板
pwa.copyToClipboard('要复制的文本');

// 从剪贴板读取
const text = await pwa.readFromClipboard();
```

### 2. 添加更多工具快捷方式

在 `manifest.json` 的 `shortcuts` 中添加：

```json
{
  "name": "Base64 编解码",
  "short_name": "Base64",
  "url": "/tools/base64/",
  "icons": [{ "src": "/icons/base64-icon.png", "sizes": "96x96" }]
}
```

### 3. 添加推送通知（可选）

```javascript
// 请求通知权限
Notification.requestPermission();

// 发送通知
new Notification('Quick Tools', {
  body: 'JSON 格式化完成',
  icon: '/icons/icon-192x192.png'
});
```

## 部署

PWA 需要 HTTPS 才能正常工作，你的 Vercel 部署已经满足条件。

### 验证 PWA

1. Chrome DevTools → Lighthouse → PWA
2. 或使用 [PWA Builder](https://www.pwabuilder.com/)

## 常见问题

### Q: iOS 上为什么不能自动提示安装？

A: iOS Safari 不支持 `beforeinstallprompt` API，需要用户手动添加到主屏幕。已提供自定义引导界面。

### Q: 离线后哪些功能可用？

A: 页面可以正常访问，但工具功能（JSON 格式化、Diff 对比）需要网络加载页面资源。

### Q: 如何更新缓存？

A: 修改 `sw.js` 中的 `CACHE_NAME` 版本号，用户下次访问时会自动更新。

### Q: 微信/QQ 内置浏览器能用吗？

A: 可以使用基本功能，但建议用系统浏览器（Chrome/Safari）以获得完整 PWA 体验。

## 下一步优化

1. **完全离线支持** - 将工具逻辑也缓存到本地
2. **后台同步** - 离线操作，联网后自动同步
3. **推送通知** - 格式化完成提醒
4. **更多快捷方式** - 常用工具一键直达
