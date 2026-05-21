<template>
  <view class="container">
    <!-- 自定义导航栏 -->
    <view class="custom-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-content">
        <text class="back-btn" @click="goBack">←</text>
        <text class="nav-title">{{ toolName }}</text>
        <view class="nav-right">
          <text class="share-btn" @click="shareTool">分享</text>
        </view>
      </view>
    </view>

    <!-- WebView 加载网页工具 -->
    <view class="webview-container" :style="{ marginTop: (statusBarHeight + 44) + 'px' }">
      <web-view 
        :src="webUrl" 
        @message="onMessage"
        @load="onLoad"
        @error="onError"
      ></web-view>
    </view>

    <!-- 加载状态 -->
    <view class="loading-mask" v-if="loading">
      <view class="loading-content">
        <text class="loading-text">加载中...</text>
      </view>
    </view>

    <!-- 错误提示 -->
    <view class="error-mask" v-if="error" @click="retryLoad">
      <view class="error-content">
        <text class="error-icon">⚠️</text>
        <text class="error-text">加载失败</text>
        <text class="error-subtext">点击重试</text>
      </view>
    </view>
  </view>
</template>

<script>
const WEB_URL = 'https://quick-tools-nine.vercel.app';

export default {
  data() {
    return {
      statusBarHeight: 0,
      webUrl: '',
      toolType: '',
      toolName: '',
      loading: true,
      error: false
    }
  },
  onLoad(options) {
    // 获取状态栏高度
    const systemInfo = uni.getSystemInfoSync();
    this.statusBarHeight = systemInfo.statusBarHeight;
    
    // 解析参数
    if (options.url) {
      this.webUrl = decodeURIComponent(options.url);
    } else {
      // 默认打开首页
      this.webUrl = WEB_URL;
    }
    
    this.toolType = options.type || '';
    this.toolName = this.toolType === 'json' ? 'JSON 格式化' : 
                    this.toolType === 'diff' ? '文本对比' : 'Quick Tools';
    
    console.log('加载 URL:', this.webUrl);
  },
  methods: {
    // 返回上一页
    goBack() {
      uni.navigateBack();
    },
    
    // 分享工具
    shareTool() {
      // #ifdef MP-WEIXIN
      // 微信小程序分享
      // #endif
      
      uni.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      });
    },
    
    // WebView 加载完成
    onLoad() {
      console.log('WebView 加载完成');
      this.loading = false;
      this.error = false;
    },
    
    // WebView 加载错误
    onError(e) {
      console.error('WebView 加载错误:', e);
      this.loading = false;
      this.error = true;
    },
    
    // 重试加载
    retryLoad() {
      this.loading = true;
      this.error = false;
      // 重新设置 URL 触发刷新
      const tempUrl = this.webUrl;
      this.webUrl = '';
      setTimeout(() => {
        this.webUrl = tempUrl;
      }, 100);
    },
    
    // 接收 WebView 消息
    onMessage(e) {
      console.log('收到 WebView 消息:', e.detail);
      // 可以处理网页发送的数据
    }
  },
  
  // 分享配置
  onShareAppMessage() {
    return {
      title: this.toolName + ' - Quick Tools',
      path: '/pages/tool/tool?url=' + encodeURIComponent(this.webUrl) + '&type=' + this.toolType,
      imageUrl: '/static/share-image.png'
    };
  },
  
  onShareTimeline() {
    return {
      title: this.toolName + ' - Quick Tools',
      query: 'url=' + encodeURIComponent(this.webUrl) + '&type=' + this.toolType,
      imageUrl: '/static/share-image.png'
    };
  }
}
</script>

<style>
.container {
  min-height: 100vh;
  background: #f5f7fa;
}

/* 自定义导航栏 */
.custom-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: #ffffff;
  border-bottom: 1px solid #e1e8ed;
}

.nav-content {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.back-btn {
  font-size: 20px;
  color: #2c3e50;
  padding: 8px;
  min-width: 40px;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: #2c3e50;
}

.nav-right {
  min-width: 60px;
  display: flex;
  justify-content: flex-end;
}

.share-btn {
  font-size: 14px;
  color: #2DBAA3;
  padding: 4px 12px;
  border: 1px solid #2DBAA3;
  border-radius: 16px;
}

/* WebView 容器 */
.webview-container {
  flex: 1;
  height: calc(100vh - 44px);
}

web-view {
  width: 100%;
  height: 100%;
}

/* 加载遮罩 */
.loading-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}

.loading-content {
  text-align: center;
}

.loading-text {
  font-size: 16px;
  color: #7f8c8d;
}

/* 错误遮罩 */
.error-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}

.error-content {
  text-align: center;
}

.error-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 16px;
}

.error-text {
  display: block;
  font-size: 18px;
  color: #2c3e50;
  margin-bottom: 8px;
}

.error-subtext {
  display: block;
  font-size: 14px;
  color: #7f8c8d;
}
</style>
