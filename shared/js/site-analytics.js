(function() {
  const utils = window.SiteAnalyticsUtils;
  if (!utils) {
    return;
  }

  const ENDPOINT = '/api/analytics';
  const OPT_OUT_KEY = 'billnest-analytics-opt-out';
  const HEARTBEAT_SECONDS = 30;
  const SESSION_KEY = 'billnest-site-analytics-session';
  let heartbeatTimer = null;
  let lastPageViewKey = '';
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

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function getCurrentEvent(type, extra) {
    return utils.createAnalyticsEvent({
      type,
      pathname: window.location.pathname,
      hash: window.location.hash,
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
      // Analytics must never interrupt the tool.
    }
  }

  function track(type, extra) {
    sendEvent(getCurrentEvent(type, extra));
  }

  function trackPageView(force) {
    const event = getCurrentEvent('page_view');
    if (!event) {
      return;
    }
    const key = `${event.route}|${event.view}`;
    if (!force && key === lastPageViewKey) {
      return;
    }
    lastPageViewKey = key;
    sendEvent(event);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isOptedOut()) {
        track('engagement', { durationSeconds: HEARTBEAT_SECONDS });
      }
    }, HEARTBEAT_SECONDS * 1000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
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
      // Ignore storage failures.
    }

    if (optedOut) {
      stopHeartbeat();
      return;
    }

    track('session_start');
    trackPageView(true);
    startHeartbeat();
  }

  function wrapExpenseNavigation() {
    if (typeof window.switchView !== 'function' || window.switchView === originalSwitchView) {
      return;
    }
    originalSwitchView = window.switchView;
    window.switchView = function() {
      const result = originalSwitchView.apply(this, arguments);
      window.setTimeout(() => trackPageView(false), 0);
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

  window.QuickToolsAnalytics = {
    trackFeature(feature) {
      track('feature_event', { feature });
    },
    setOptOut,
    isOptedOut
  };
  window.BillNestAnalytics = window.QuickToolsAnalytics;

  document.addEventListener('DOMContentLoaded', () => {
    setupSettingsToggle();
    wrapExpenseNavigation();
    if (!isOptedOut()) {
      track('session_start');
      trackPageView(true);
      startHeartbeat();
    }
  });

  window.addEventListener('hashchange', () => {
    trackPageView(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      track('engagement', { durationSeconds: 5 });
    }
  });
})();
