/**
 * Quick Tools - PWA & Mobile Features
 * 提供 PWA 支持、添加到主屏幕、系统分享等功能
 */

const PWA_SEEN_KEY = 'pwa_install_guide_seen';

class QuickToolsPWA {
  constructor() {
    this.deferredPrompt = null;
    this.isStandalone = this.checkStandalone();
    this.isMobile = this.checkMobile();
    
    this.init();
  }

  init() {
    // 注册 Service Worker
    this.registerSW();
    
    // 监听添加到主屏幕事件
    this.listenBeforeInstallPrompt();
    
    // 监听应用安装完成
    this.listenAppInstalled();
    
    // 仅在首次访问移动设备时显示安装提示
    if (this.isMobile && !this.isStandalone && !localStorage.getItem(PWA_SEEN_KEY)) {
      setTimeout(() => this.showInstallPrompt(), 3000);
    }
  }

  /**
   * 注册 Service Worker
   */
  registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('[PWA] SW registered:', registration.scope);
          })
          .catch((error) => {
            console.log('[PWA] SW registration failed:', error);
          });
      });
    }
  }

  /**
   * 检查是否在独立模式运行（已添加到主屏幕）
   */
  checkStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  /**
   * 检查是否为移动设备
   */
  checkMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  /**
   * 监听 beforeinstallprompt 事件
   */
  listenBeforeInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('[PWA] beforeinstallprompt fired');
      // 阻止默认行为
      e.preventDefault();
      // 保存事件以便稍后触发
      this.deferredPrompt = e;
    });
  }

  /**
   * 监听 appinstalled 事件
   */
  listenAppInstalled() {
    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App was installed');
      this.deferredPrompt = null;
      this.hideInstallPrompt();
      
      // 显示安装成功提示
      this.showToast('已成功添加到主屏幕！');
    });
  }

  /**
   * 显示安装提示
   */
  showInstallPrompt() {
    // 如果已经安装或者是 iOS Safari，显示自定义引导
    if (this.isStandalone) return;
    
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    if (isIOS && !this.deferredPrompt) {
      // iOS 需要手动添加到主屏幕
      this.showIOSInstallGuide();
    } else if (this.deferredPrompt) {
      // Android/Chrome 可以自动提示
      this.showAndroidInstallPrompt();
    }
  }

  /**
   * 显示 Android 安装提示
   */
  showAndroidInstallPrompt() {
    localStorage.setItem(PWA_SEEN_KEY, '1');
    const prompt = document.createElement('div');
    prompt.className = 'pwa-install-prompt';
    prompt.innerHTML = `
      <div class="pwa-prompt-content">
        <div class="pwa-prompt-icon">📱</div>
        <div class="pwa-prompt-text">
          <div class="pwa-prompt-title">添加到主屏幕</div>
          <div class="pwa-prompt-desc">像原生 App 一样快速访问</div>
        </div>
        <button class="pwa-prompt-btn" onclick="pwa.installApp()">添加</button>
        <button class="pwa-prompt-close" onclick="pwa.hideInstallPrompt()">✕</button>
      </div>
    `;
    document.body.appendChild(prompt);
    
    // 动画显示
    setTimeout(() => prompt.classList.add('show'), 100);
  }

  /**
   * 显示 iOS 安装引导
   */
  showIOSInstallGuide() {
    localStorage.setItem(PWA_SEEN_KEY, '1');
    const guide = document.createElement('div');
    guide.className = 'pwa-install-guide';
    guide.innerHTML = `
      <div class="pwa-guide-overlay" onclick="pwa.hideInstallPrompt()"></div>
      <div class="pwa-guide-content">
        <div class="pwa-guide-box">
          <button class="pwa-guide-close" onclick="pwa.hideInstallPrompt()">✕</button>
          <div class="pwa-guide-title">添加到主屏幕</div>
          <div class="pwa-guide-steps">
            <div class="pwa-guide-step">
              <span class="step-num">1</span>
              <span>点击底部工具栏的分享按钮 <span class="share-icon">⎋</span></span>
            </div>
            <div class="pwa-guide-step">
              <span class="step-num">2</span>
              <span>向下滑动并选择"添加到主屏幕"</span>
            </div>
          </div>
          <button class="pwa-guide-btn" onclick="pwa.hideInstallPrompt()">知道了</button>
          <div class="pwa-guide-arrow-wrapper">
            <div class="pwa-guide-arrow-down"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(guide);
  }

  /**
   * 隐藏安装提示
   */
  hideInstallPrompt() {
    const prompts = document.querySelectorAll('.pwa-install-prompt, .pwa-install-guide');
    prompts.forEach(p => {
      p.classList.remove('show');
      setTimeout(() => p.remove(), 300);
    });
  }

  /**
   * 触发安装
   */
  async installApp() {
    if (!this.deferredPrompt) return;
    
    // 显示安装提示
    this.deferredPrompt.prompt();
    
    // 等待用户响应
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log(`[PWA] User response: ${outcome}`);
    
    // 清空 deferredPrompt
    this.deferredPrompt = null;
    this.hideInstallPrompt();
  }

  /**
   * 系统分享
   */
  async share(data = {}) {
    const shareData = {
      title: data.title || 'Quick Tools - 开发者工具箱',
      text: data.text || '简洁高效的 JSON 格式化与文本对比工具',
      url: data.url || window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        console.log('[PWA] Shared successfully');
      } catch (err) {
        console.log('[PWA] Share failed:', err);
      }
    } else {
      // 降级：复制链接到剪贴板
      this.copyToClipboard(shareData.url);
      this.showToast('链接已复制到剪贴板');
    }
  }

  /**
   * 复制到剪贴板
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  }

  /**
   * 从剪贴板读取
   */
  async readFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (err) {
      console.log('[PWA] Read clipboard failed:', err);
      return null;
    }
  }

  /**
   * 显示 Toast 提示
   */
  showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'pwa-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * 震动反馈
   */
  vibrate(pattern = 50) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  /**
   * 检查网络状态
   */
  checkOnline() {
    return navigator.onLine;
  }

  /**
   * 监听网络变化
   */
  listenNetworkChange(callback) {
    window.addEventListener('online', () => {
      callback(true);
      this.showToast('已连接到网络');
    });
    window.addEventListener('offline', () => {
      callback(false);
      this.showToast('已离线，部分功能可能不可用');
    });
  }
}

// 初始化
const pwa = new QuickToolsPWA();
