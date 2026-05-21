# Quick Tools 小程序

基于 uni-app 开发的 Quick Tools 小程序，支持微信、支付宝、百度等多平台。

## 项目结构

```
mini-program/
├── manifest.json          # 应用配置文件
├── pages.json             # 页面路由配置
├── App.vue                # 应用入口
├── main.js                # 主入口文件
├── index.html             # H5 入口
├── pages/
│   ├── index/             # 首页
│   │   └── index.vue
│   ├── tool/              # 工具页面（WebView）
│   │   └── tool.vue
│   └── history/           # 历史记录页
│       └── history.vue
└── static/                # 静态资源
    └── (图标资源)
```

## 功能特性

- 📱 **原生小程序体验** - 首页、历史记录使用原生小程序实现
- 🌐 **WebView 嵌入** - 核心工具功能通过 WebView 加载网站
- 🎨 **主题切换** - 支持深色/浅色模式切换
- 📜 **历史记录** - 自动保存最近使用的工具
- 📋 **快捷粘贴** - 支持从剪贴板粘贴并直接格式化 JSON
- ↗️ **分享功能** - 支持分享给好友和朋友圈

## 开发环境准备

### 1. 安装 HBuilderX

下载并安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（推荐）

### 2. 安装 uni-app 插件

在 HBuilderX 中安装以下插件：
- uni-app (Vue3)
- 对应平台的编译器（微信小程序、支付宝小程序等）

### 3. 配置业务域名

**重要：** 小程序 WebView 只能加载业务域名下的网页

#### 微信小程序
1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 进入「开发」→「开发管理」→「开发设置」
3. 在「服务器域名」→「request 合法域名」中添加：
   ```
   https://quick-tools-nine.vercel.app
   ```
4. 在「服务器域名」→「业务域名」中添加相同域名

#### 支付宝小程序
1. 登录 [支付宝开放平台](https://open.alipay.com/)
2. 进入小程序管理后台
3. 在「设置」→「开发设置」中添加 HTTP 请求白名单

## 运行项目

### 方式一：使用 HBuilderX（推荐）

1. 打开 HBuilderX
2. 选择「文件」→「打开目录」，选择 `mini-program` 文件夹
3. 点击工具栏的运行按钮：
   - 运行到微信开发者工具
   - 运行到支付宝小程序开发者工具
   - 运行到浏览器（H5）

### 方式二：使用 CLI

```bash
# 进入项目目录
cd mini-program

# 安装依赖
npm install

# 运行到微信小程序
npm run dev:mp-weixin

# 运行到支付宝小程序
npm run dev:mp-alipay

# 运行到 H5
npm run dev:h5

# 运行到 App
npm run dev:app
```

## 发布小程序

### 微信小程序

1. 在 HBuilderX 中点击「发行」→「小程序-微信」
2. 填写小程序 AppID
3. 编译完成后，在微信开发者工具中点击「上传」
4. 登录微信公众平台提交审核

### 支付宝小程序

1. 在 HBuilderX 中点击「发行」→「小程序-支付宝」
2. 填写小程序 AppID
3. 编译完成后，在支付宝小程序开发者工具中点击「上传」
4. 登录支付宝开放平台提交审核

## 注意事项

### 1. 业务域名配置

小程序 WebView 只能访问已配置的业务域名，请确保：
- 域名已备案（国内小程序平台要求）
- 域名已添加到小程序后台的业务域名列表
- 域名支持 HTTPS

### 2. 网站适配

为了更好的小程序体验，建议网站添加以下适配：

```javascript
// 检测是否在小程序环境中
const isMiniProgram = () => {
  return /miniProgram/i.test(navigator.userAgent) || 
         window.__wxjs_environment === 'miniprogram';
};

// 如果是小程序环境，可以调整 UI
if (isMiniProgram()) {
  document.body.classList.add('in-miniprogram');
}
```

### 3. 本地存储

小程序使用 `uni.getStorageSync` / `uni.setStorageSync` 进行本地存储，与网页的 `localStorage` 不互通。

### 4. 分享功能

分享功能需要各平台单独配置：
- 微信小程序：需要在后台开启「分享到朋友圈」权限
- 支付宝小程序：需要申请相应的功能权限

## 自定义配置

### 修改网站地址

在 `pages/index/index.vue` 和 `pages/tool/tool.vue` 中修改：

```javascript
const WEB_URL = 'https://your-domain.com';
```

### 添加新工具

1. 在 `pages/index/index.vue` 的 `tools-grid` 中添加新卡片
2. 在 `pages/tool/tool.vue` 中处理新工具类型的名称显示

## 常见问题

### Q: WebView 加载失败？

A: 检查以下几点：
1. 域名是否已添加到小程序业务域名
2. 网站是否支持 HTTPS
3. 网站是否设置了防盗链

### Q: 如何调试 WebView？

A: 
- 微信小程序：使用 `vconsole` 或在开发者工具中打开「调试」
- 支付宝小程序：使用 `my.getRunScene` 获取运行环境

### Q: 分享后打开空白？

A: 确保分享路径正确，且路径中的参数已编码：
```javascript
path: '/pages/tool/tool?url=' + encodeURIComponent(url)
```

## 技术栈

- [uni-app](https://uniapp.dcloud.io/) - 跨平台开发框架
- [Vue 3](https://v3.vuejs.org/) - 前端框架
- 小程序原生组件 - WebView、Storage 等

## License

MIT
