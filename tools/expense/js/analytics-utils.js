(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.BillNestAnalyticsUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const VALID_TYPES = new Set(['session_start', 'page_view', 'engagement', 'feature_event']);
  const VALID_VIEWS = new Set(['add', 'dashboard', 'list', 'tags', 'settings', 'import']);
  const SAFE_FEATURE_PATTERN = /[^a-z0-9_]/g;
  const MAX_DURATION_SECONDS = 120;

  function getAnalyticsViewFromHash(hash) {
    const value = String(hash || '');
    const match = value.match(/(?:^#|[?&])view=([^&]+)/);
    if (!match) {
      return 'add';
    }
    return normalizeView(decodeURIComponent(match[1]));
  }

  function normalizeView(view) {
    const normalized = String(view || '').trim().toLowerCase();
    return VALID_VIEWS.has(normalized) ? normalized : 'add';
  }

  function getDeviceClass(width) {
    const numericWidth = Number(width) || 0;
    if (numericWidth <= 767) {
      return 'mobile';
    }
    if (numericWidth <= 1023) {
      return 'tablet';
    }
    return 'desktop';
  }

  function getReferrerClass(referrer, origin) {
    const value = String(referrer || '').trim();
    if (!value) {
      return 'direct';
    }
    try {
      const referrerUrl = new URL(value);
      if (origin && referrerUrl.origin === origin) {
        return 'internal';
      }
      return 'external';
    } catch (error) {
      return 'external';
    }
  }

  function normalizeFeature(feature) {
    const normalized = String(feature || '')
      .trim()
      .toLowerCase()
      .replace(SAFE_FEATURE_PATTERN, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return normalized ? normalized.slice(0, 64) : null;
  }

  function normalizeDuration(durationSeconds) {
    const numericValue = Math.round(Number(durationSeconds) || 0);
    if (numericValue <= 0) {
      return 0;
    }
    return Math.min(numericValue, MAX_DURATION_SECONDS);
  }

  function sanitizeAnalyticsEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    const type = String(rawEvent.type || '').trim();
    const sessionId = String(rawEvent.sessionId || '').trim();
    if (!VALID_TYPES.has(type) || !sessionId) {
      return null;
    }

    const event = {
      type,
      view: normalizeView(rawEvent.view),
      sessionId: sessionId.slice(0, 80)
    };

    if (Object.prototype.hasOwnProperty.call(rawEvent, 'standalone')) {
      event.standalone = Boolean(rawEvent.standalone);
    }
    if (rawEvent.device) {
      event.device = String(rawEvent.device).slice(0, 16);
    }
    if (rawEvent.referrer) {
      event.referrer = String(rawEvent.referrer).slice(0, 16);
    }
    if (type === 'engagement') {
      event.durationSeconds = normalizeDuration(rawEvent.durationSeconds);
    }
    if (type === 'feature_event') {
      const feature = normalizeFeature(rawEvent.feature);
      if (!feature) {
        return null;
      }
      event.feature = feature;
    }

    return event;
  }

  function createAnalyticsEvent(input) {
    const width = Number(input && input.width) || 0;
    return sanitizeAnalyticsEvent({
      type: input && input.type,
      view: input && input.view,
      sessionId: input && input.sessionId,
      standalone: Boolean(input && input.standalone),
      device: getDeviceClass(width),
      referrer: getReferrerClass(input && input.referrer, input && input.origin),
      durationSeconds: input && input.durationSeconds,
      feature: input && input.feature
    });
  }

  return {
    createAnalyticsEvent,
    getAnalyticsViewFromHash,
    getDeviceClass,
    sanitizeAnalyticsEvent
  };
});
