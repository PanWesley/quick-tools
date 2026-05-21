<template>
  <view class="container">
    <!-- 自定义导航栏 -->
    <view class="custom-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-content">
        <text class="nav-title">Quick Tools</text>
        <view class="nav-right">
          <text class="theme-icon" @click="toggleTheme">{{ theme === 'dark' ? '☀️' : '🌙' }}</text>
        </view>
      </view>
    </view>

    <!-- 主要内容区 -->
    <view class="content" :style="{ marginTop: (statusBarHeight + 44) + 'px' }">
      <!-- 欢迎语 -->
      <view class="welcome-section">
        <text class="welcome-title">开发者工具箱</text>
        <text class="welcome-desc">简洁高效的在线工具集合</text>
      </view>

      <!-- 工具卡片列表 -->
      <view class="tools-grid">
        <!-- JSON 工具 -->
        <view class="tool-card" @click="openTool('json')" :class="{ 'dark': theme === 'dark' }">
          <view class="tool-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <text class="icon-text">{ }</text>
          </view>
          <view class="tool-info">
            <text class="tool-name">JSON 格式化</text>
            <text class="tool-desc">格式化、验证、压缩、转义</text>
          </view>
          <text class="arrow">›</text>
        </view>

        <!-- Diff 工具 -->
        <view class="tool-card" @click="openTool('diff')" :class="{ 'dark': theme === 'dark' }">
          <view class="tool-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <text class="icon-text">⇄</text>
          </view>
          <view class="tool-info">
            <text class="tool-name">文本对比</text>
            <text class="tool-desc">Diff 对比、语法高亮</text>
          </view>
          <text class="arrow">›</text>
        </view>
      </view>

      <!-- 快捷操作区 -->
      <view class="quick-actions" :class="{ 'dark': theme === 'dark' }">
        <text class="section-title">快捷操作</text>
        <view class="action-list">
          <view class="action-item" @click="pasteAndFormat">
            <text class="action-icon">📋</text>
            <text class="action-text">粘贴并格式化</text>
          </view>
          <view class="action-item" @click="goToHistory">
            <text class="action-icon">📜</text>
            <text class="action-text">查看历史记录</text>
          </view>
        </view>
      </view>

      <!-- 使用提示 -->
      <view class="tips-section" :class="{ 'dark': theme === 'dark' }">
        <text class="tips-title">💡 使用提示</text>
        <text class="tips-text">1. 点击工具卡片进入对应功能</text>
        <text class="tips-text">2. 支持深色/浅色主题切换</text>
        <text class="tips-text">3. 历史记录自动保存最近 20 条</text>
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
      theme: 'light'
    }
  },
  onLoad() {
    // 获取状态栏高度
    const systemInfo = uni.getSystemInfoSync();
    this.statusBarHeight = systemInfo.statusBarHeight;
    
    // 加载保存的主题
    this.loadTheme();
  },
  methods: {
    // 加载主题设置
    loadTheme() {
      try {
        const savedTheme = uni.getStorageSync('app_theme');
        if (savedTheme) {
          this.theme = savedTheme;
        }
      } catch (e) {
        console.log('加载主题失败', e);
      }
    },
    
    // 切换主题
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      try {
        uni.setStorageSync('app_theme', this.theme);
      } catch (e) {
        console.log('保存主题失败', e);
      }
      uni.showToast({
        title: this.theme === 'dark' ? '已切换深色模式' : '已切换浅色模式',
        icon: 'none'
      });
    },
    
    // 打开工具页面
    openTool(type) {
      const url = `${WEB_URL}/tools/${type}/`;
      uni.navigateTo({
        url: `/pages/tool/tool?url=${encodeURIComponent(url)}&type=${type}`
      });
      
      // 记录使用历史
      this.addToHistory(type);
    },
    
    // 粘贴并格式化
    async pasteAndFormat() {
      try {
        // #ifdef MP-WEIXIN
        const res = await uni.getClipboardData();
        const text = res.data;
        // #endif
        
        // #ifndef MP-WEIXIN
        uni.showToast({
          title: '请手动粘贴到 JSON 工具',
          icon: 'none'
        });
        return;
        // #endif
        
        if (text) {
          // 跳转到 JSON 工具并携带数据
          const url = `${WEB_URL}/tools/json/?data=${encodeURIComponent(text)}`;
          uni.navigateTo({
            url: `/pages/tool/tool?url=${encodeURIComponent(url)}&type=json`
          });
          this.addToHistory('json');
        }
      } catch (e) {
        uni.showToast({
          title: '无法读取剪贴板',
          icon: 'none'
        });
      }
    },
    
    // 跳转到历史记录
    goToHistory() {
      uni.switchTab({
        url: '/pages/history/history'
      });
    },
    
    // 添加到历史记录
    addToHistory(type) {
      try {
        let history = uni.getStorageSync('tool_history') || [];
        const item = {
          type: type,
          name: type === 'json' ? 'JSON 格式化' : '文本对比',
          time: Date.now()
        };
        // 去重并添加到开头
        history = history.filter(h => h.type !== type);
        history.unshift(item);
        // 只保留最近 20 条
        history = history.slice(0, 20);
        uni.setStorageSync('tool_history', history);
      } catch (e) {
        console.log('保存历史失败', e);
      }
    }
  }
}
</script>

<style>
.container {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fa 0%, #ffffff 100%);
}

.container.dark {
  background: linear-gradient(180deg, #0d1117 0%, #161b22 100%);
}

/* 自定义导航栏 */
.custom-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
}

.nav-content {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.nav-title {
  font-size: 18px;
  font-weight: 600;
  color: #2c3e50;
}

.theme-icon {
  font-size: 20px;
  padding: 8px;
}

/* 内容区 */
.content {
  padding: 20px 16px;
}

/* 欢迎语 */
.welcome-section {
  margin-bottom: 24px;
}

.welcome-title {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 8px;
}

.welcome-desc {
  display: block;
  font-size: 14px;
  color: #7f8c8d;
}

/* 工具卡片 */
.tools-grid {
  margin-bottom: 24px;
}

.tool-card {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.tool-card.dark {
  background: #161b22;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.tool-card:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.tool-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
}

.icon-text {
  font-size: 20px;
  color: #ffffff;
  font-weight: 600;
}

.tool-info {
  flex: 1;
}

.tool-name {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 4px;
}

.tool-card.dark .tool-name {
  color: #c9d1d9;
}

.tool-desc {
  display: block;
  font-size: 12px;
  color: #7f8c8d;
}

.tool-card.dark .tool-desc {
  color: #8b949e;
}

.arrow {
  font-size: 24px;
  color: #bdc3c7;
}

/* 快捷操作 */
.quick-actions {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.quick-actions.dark {
  background: #161b22;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.section-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 12px;
}

.quick-actions.dark .section-title {
  color: #c9d1d9;
}

.action-list {
  display: flex;
  gap: 12px;
}

.action-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.action-item:active {
  background: #e9ecef;
}

.action-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.action-text {
  font-size: 12px;
  color: #2c3e50;
}

/* 使用提示 */
.tips-section {
  background: #fff9e6;
  border-radius: 12px;
  padding: 16px;
}

.tips-section.dark {
  background: #1a1500;
}

.tips-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #856404;
  margin-bottom: 8px;
}

.tips-section.dark .tips-title {
  color: #ffd700;
}

.tips-text {
  display: block;
  font-size: 12px;
  color: #856404;
  line-height: 1.8;
}

.tips-section.dark .tips-text {
  color: #b8a046;
}
</style>