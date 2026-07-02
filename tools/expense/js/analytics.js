(function() {
  const utils = window.BillNestAnalyticsUtils;
  if (!utils) {
    return;
  }

  const ENDPOINT = '/api/analytics';
  const OPT_OUT_KEY = 'billnest-analytics-opt-out';
  const HEARTBEAT_SECONDS = 30;
  const SESSION_KEY = 'billnest-analytics-session';
  let currentView = utils.getAnalyticsViewFromHash(window.location.hash);
  let heartbeatTimer = null;
  let originalSwitchView = null;

  function getSessionId() {
    try {
      let sessionId = sessionStorage.getItem(SESSION_KEY);
      if (!sessionId) {
        const bytes = new Uint8Array(12);
        window.crypto.getRandomValues(bytes);
        sessionId = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }
      return sessionId;
    } catch (error) {
      return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    }
  }

  function isOptedOut() {
    try {
      return localStorage.getItem(OPT_OUT_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function setOptOut(optedOut) {
    try {
      if (optedOut) {
        localStorage.setItem(OPT_OUT_KEY, '1');
      } else {
        localStorage.removeItem(OPT_OUT_KEY);
      }
    } catch (error) {
      // Ignore storage failures; analytics must never block the app.
    }
    if (optedOut) {
      stopHeartbeat();
    } else {
      startHeartbeat();
      track('session_start', currentView);
      track('page_view', currentView);
    }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function buildEvent(type, view, extra) {
    return utils.createAnalyticsEvent({
      type,
      view,
      sessionId: getSessionId(),
      standalone: isStandalone(),
      width: window.innerWidth,
      referrer: document.referrer,
      origin: window.location.origin,
      durationSeconds: extra && extra.durationSeconds,
      feature: extra && extra.feature
    });
  }

  function sendEvent(event) {
    if (!event || isOptedOut()) {
      return;
    }
    const body = JSON.stringify(event);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) {
          return;
        }
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit'
      }).catch(() => {});
    } catch (error) {
      // Silent by design.
    }
  }

  function track(type, view, extra) {
    sendEvent(buildEvent(type, view || currentView, extra));
  }

  function trackPageView(view) {
    const normalizedView = utils.sanitizeAnalyticsEvent({
      type: 'page_view',
      view,
      sessionId: getSessionId()
    }).view;
    if (normalizedView === currentView && document.visibilityState !== 'hidden') {
      return;
    }
    currentView = normalizedView;
    track('page_view', currentView);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isOptedOut()) {
        track('engagement', currentView, { durationSeconds: HEARTBEAT_SECONDS });
      }
    }, HEARTBEAT_SECONDS * 1000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function wrapSwitchView() {
    if (typeof window.switchView !== 'function' || window.switchView === originalSwitchView) {
      return;
    }
    originalSwitchView = window.switchView;
    window.switchView = function(view) {
      const result = originalSwitchView.apply(this, arguments);
      trackPageView(view);
      return result;
    };
  }

  function setupSettingsToggle() {
    const toggle = document.getElementById('analytics-enabled-toggle');
    if (!toggle) {
      return;
    }
    toggle.checked = !isOptedOut();
    toggle.addEventListener('change', () => {
      setOptOut(!toggle.checked);
    });
  }

  window.BillNestAnalytics = {
    trackFeature(feature) {
      track('feature_event', currentView, { feature });
    },
    setOptOut,
    isOptedOut
  };

  document.addEventListener('DOMContentLoaded', () => {
    currentView = utils.getAnalyticsViewFromHash(window.location.hash);
    setupSettingsToggle();
    wrapSwitchView();
    if (!isOptedOut()) {
      track('session_start', currentView);
      track('page_view', currentView);
      startHeartbeat();
    }
  });

  window.addEventListener('hashchange', () => {
    trackPageView(utils.getAnalyticsViewFromHash(window.location.hash));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      track('engagement', currentView, { durationSeconds: 5 });
    }
  });
})();
