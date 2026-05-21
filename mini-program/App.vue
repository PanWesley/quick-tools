<script>
export default {
  onLaunch() {
    console.log('App Launch');
    // 初始化主题
    this.initTheme();
  },
  onShow() {
    console.log('App Show');
  },
  onHide() {
    console.log('App Hide');
  },
  methods: {
    initTheme() {
      try {
        const savedTheme = uni.getStorageSync('app_theme');
        if (!savedTheme) {
          // 默认使用浅色主题
          uni.setStorageSync('app_theme', 'light');
        }
      } catch (e) {
        console.log('初始化主题失败', e);
      }
    }
  }
}
</script>

<style>
/* 全局样式 */
page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 重置按钮样式 */
button::after {
  border: none;
}

/* 隐藏滚动条 */
::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
  -webkit-appearance: none;
  background: transparent;
}
</style>
