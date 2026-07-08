(function(root) {
  const DEFAULT_CACHE_PREFIXES = [
    'quick-tools-',
    'expense-tracker-',
    'today-youxu-',
    'zhenjia-assistant-'
  ];
  const STATUS_TEXT = {
    checking: '正在检查更新...',
    updating: '发现更新，正在重启...',
    refreshing: '正在拉取最新版本...',
    latest: '已是最新版本',
    unsupported: '当前浏览器不支持自动更新',
    offline: '当前离线，稍后再试',
    error: '更新失败，请稍后再试'
  };

  function getNavigator() {
    return root.navigator || {};
  }

  function getServiceWorker(options) {
    return options.serviceWorker || getNavigator().serviceWorker;
  }

  function setStatus(element, state, message) {
    if (!element) return;
    element.textContent = message || STATUS_TEXT[state] || '';
    if (element.dataset) {
      element.dataset.updateState = state;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => root.setTimeout(resolve, ms));
  }

  async function getRegistration(serviceWorker, options) {
    if (options.registration) return options.registration;
    if (serviceWorker.getRegistration) {
      return serviceWorker.getRegistration(options.scope);
    }
    if (serviceWorker.ready) {
      return serviceWorker.ready;
    }
    return null;
  }

  async function clearAppCaches(prefixes) {
    if (!root.caches || !root.caches.keys || !root.caches.delete) {
      return [];
    }
    const allowedPrefixes = prefixes || DEFAULT_CACHE_PREFIXES;
    const names = await root.caches.keys();
    const targets = names.filter((name) => (
      allowedPrefixes.some((prefix) => name.indexOf(prefix) === 0)
    ));
    await Promise.all(targets.map((name) => root.caches.delete(name)));
    return targets;
  }

  function reloadPage(options) {
    const reload = options.reload || (() => root.location.reload());
    reload();
  }

  async function waitForControllerChange(serviceWorker, timeoutMs) {
    await Promise.race([
      new Promise((resolve) => {
        if (!serviceWorker.addEventListener) {
          resolve();
          return;
        }
        serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      }),
      delay(timeoutMs || 1200)
    ]);
  }

  async function activateWaitingWorker(worker, serviceWorker, options) {
    setStatus(options.statusElement, 'updating');
    if (worker && worker.postMessage) {
      worker.postMessage({ type: 'SKIP_WAITING' });
      await waitForControllerChange(serviceWorker, options.activationTimeoutMs);
    }
    if (options.clearCaches !== false) {
      await clearAppCaches(options.cachePrefixes);
    }
    if (options.reload !== false) {
      reloadPage(options);
    }
    return { status: 'updating' };
  }

  async function checkForUpdate(options = {}) {
    const serviceWorker = getServiceWorker(options);
    if (!serviceWorker) {
      setStatus(options.statusElement, 'unsupported');
      return { status: 'unsupported' };
    }
    if (getNavigator().onLine === false) {
      setStatus(options.statusElement, 'offline');
      return { status: 'offline' };
    }

    setStatus(options.statusElement, 'checking');
    try {
      const registration = await getRegistration(serviceWorker, options);
      if (!registration || !registration.update) {
        setStatus(options.statusElement, 'unsupported');
        return { status: 'unsupported' };
      }

      const updatedRegistration = await registration.update();
      const activeRegistration = updatedRegistration || registration;
      const waitingWorker = activeRegistration.waiting || registration.waiting;
      if (waitingWorker) {
        return activateWaitingWorker(waitingWorker, serviceWorker, options);
      }

      setStatus(options.statusElement, 'latest');
      return { status: 'latest' };
    } catch (error) {
      console.warn('[AppUpdate] Update check failed:', error);
      setStatus(options.statusElement, 'error');
      return { status: 'error', error };
    }
  }

  async function refreshApp(options = {}) {
    const result = await checkForUpdate({
      ...options,
      reload: false
    });

    if (result.status === 'unsupported' || result.status === 'offline' || result.status === 'error') {
      return result;
    }
    if (result.status !== 'updating') {
      setStatus(options.statusElement, 'refreshing');
      await clearAppCaches(options.cachePrefixes);
    }
    reloadPage(options);
    return result.status === 'latest' ? { status: 'refreshing' } : result;
  }

  function initUpdateButtons(doc) {
    const documentRef = doc || root.document;
    if (!documentRef || !documentRef.querySelectorAll) return;
    const buttons = documentRef.querySelectorAll('[data-app-update-button]');
    buttons.forEach((button) => {
      button.addEventListener('click', async () => {
        const statusElement = documentRef.querySelector('[data-app-update-status]');
        button.disabled = true;
        try {
          await refreshApp({ statusElement });
        } finally {
          root.setTimeout(() => {
            button.disabled = false;
          }, 1500);
        }
      });
    });
  }

  const api = {
    checkForUpdate,
    clearAppCaches,
    refreshApp,
    initUpdateButtons
  };

  root.QuickToolsAppUpdate = api;

  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('DOMContentLoaded', () => initUpdateButtons(root.document));
  }
})(typeof window !== 'undefined' ? window : globalThis);
