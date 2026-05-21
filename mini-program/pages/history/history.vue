<template>
  <view class="container">
    <!-- 空状态 -->
    <view class="empty-state" v-if="historyList.length === 0">
      <text class="empty-icon">📜</text>
      <text class="empty-title">暂无历史记录</text>
      <text class="empty-desc">使用工具后会自动保存到这里</text>
      <button class="go-use-btn" @click="goToHome">去使用工具</button>
    </view>

    <!-- 历史列表 -->
    <view class="history-list" v-else>
      <view class="history-item" 
            v-for="(item, index) in historyList" 
            :key="index"
            @click="openTool(item.type)">
        <view class="item-icon" :class="item.type">
          <text class="icon-text">{{ item.type === 'json' ? '{ }' : '⇄' }}</text>
        </view>
        <view class="item-info">
          <text class="item-name">{{ item.name }}</text>
          <text class="item-time">{{ formatTime(item.time) }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
      
      <!-- 清空按钮 -->
      <view class="clear-section">
        <text class="clear-btn" @click="clearHistory">清空历史记录</text>
      </view>
    </view>
  </view>
</template>

<script>
const WEB_URL = 'https://quick-tools-nine.vercel.app';

export default {
  data() {
    return {
      historyList: []
    }
  },
  onShow() {
    this.loadHistory();
  },
  methods: {
    // 加载历史记录
    loadHistory() {
      try {
        const history = uni.getStorageSync('tool_history') || [];
        this.historyList = history;
      } catch (e) {
        console.log('加载历史失败', e);
        this.historyList = [];
      }
    },
    
    // 打开工具
    openTool(type) {
      const url = `${WEB_URL}/tools/${type}/`;
      uni.navigateTo({
        url: `/pages/tool/tool?url=${encodeURIComponent(url)}&type=${type}`
      });
    },
    
    // 返回首页
    goToHome() {
      uni.switchTab({
        url: '/pages/index/index'
      });
    },
    
    // 清空历史
    clearHistory() {
      uni.showModal({
        title: '确认清空',
        content: '确定要清空所有历史记录吗？',
        confirmColor: '#dc3545',
        success: (res) => {
          if (res.confirm) {
            try {
              uni.removeStorageSync('tool_history');
              this.historyList = [];
              uni.showToast({
                title: '已清空',
                icon: 'success'
              });
            } catch (e) {
              uni.showToast({
                title: '清空失败',
                icon: 'none'
              });
            }
          }
        }
      });
    },
    
    // 格式化时间
    formatTime(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      
      // 小于 1 分钟
      if (diff < 60000) {
        return '刚刚';
      }
      // 小于 1 小时
      if (diff < 3600000) {
        return Math.floor(diff / 60000) + ' 分钟前';
      }
      // 小于 24 小时
      if (diff < 86400000) {
        return Math.floor(diff / 3600000) + ' 小时前';
      }
      // 小于 7 天
      if (diff < 604800000) {
        return Math.floor(diff / 86400000) + ' 天前';
      }
      
      // 显示具体日期
      const date = new Date(timestamp);
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
  }
}
</script>

<style>
.container {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 16px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 120px;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 18px;
  color: #2c3e50;
  margin-bottom: 8px;
}

.empty-desc {
  font-size: 14px;
  color: #7f8c8d;
  margin-bottom: 24px;
}

.go-use-btn {
  background: #2DBAA3;
  color: #ffffff;
  font-size: 14px;
  padding: 12px 32px;
  border-radius: 24px;
  border: none;
}

.go-use-btn:active {
  opacity: 0.8;
}

/* 历史列表 */
.history-list {
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
}

.history-item {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.history-item:active {
  background: #f8f9fa;
}

.history-item:last-child {
  border-bottom: none;
}

.item-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.item-icon.json {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.item-icon.diff {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.icon-text {
  font-size: 16px;
  color: #ffffff;
  font-weight: 600;
}

.item-info {
  flex: 1;
}

.item-name {
  display: block;
  font-size: 15px;
  color: #2c3e50;
  margin-bottom: 4px;
}

.item-time {
  display: block;
  font-size: 12px;
  color: #7f8c8d;
}

.arrow {
  font-size: 20px;
  color: #bdc3c7;
}

/* 清空按钮 */
.clear-section {
  padding: 16px;
  text-align: center;
  border-top: 1px solid #f0f0f0;
}

.clear-btn {
  font-size: 14px;
  color: #dc3545;
  padding: 8px 16px;
}
</style>
