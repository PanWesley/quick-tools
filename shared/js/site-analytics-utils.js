(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SiteAnalyticsUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const VALID_TYPES = new Set(['session_start', 'page_view', 'engagement', 'feature_event']);
  const VALID_TOOLS = new Set(['home', 'diff', 'json', 'expense', 'time', 'unknown']);
  const VALID_VIEWS = new Set(['home', 'main', 'add', 'dashboard', 'list', 'tags', 'settings', 'import']);
  const SAFE_FEATURE_PATTERN = /[^a-z0-9_]/g;
  const MAX_DURATION_SECONDS = 120;

  function normalizeView(view, fallback) {
    const normalized = String(view || '').trim().toLowerCase();
    if (VALID_VIEWS.has(normalized)) {
      return normalized;
    }
    return fallback || 'main';
  }

  function getSiteToolFromPathname(pathname) {
    const path = normalizePathname(pathname);
    if (path === '/' || path === '/index.html') {
      return 'home';
    }
    const match = path.match(/^\/tools\/([^/]+)(?:\/|$)/);
    if (!match) {
      return 'unknown';
    }
    const tool = match[1].toLowerCase();
    return VALID_TOOLS.has(tool) ? tool : 'unknown';
  }

  function getSiteViewFromLocation(pathname, hash) {
    const tool = getSiteToolFromPathname(pathname);
    if (tool === 'home') {
      return 'home';
    }
    if (tool !== 'expense') {
      return 'main';
    }

    const match = String(hash || '').match(/(?:^#|[?&])view=([^&]+)/);
    if (!match) {
      return 'add';
    }
    return normalizeView(decodeURIComponent(match[1]), 'add');
  }

  function getAnalyticsRoute(pathname, hash) {
    const path = normalizePathname(pathname).replace(/\/index\.html$/, '/');
    const tool = getSiteToolFromPathname(path);
    if (tool === 'home') {
      return '/';
    }
    if (tool === 'expense') {
      const view = getSiteViewFromLocation(path, hash);
      return `/tools/expense/#view=${view}`;
    }
    if (tool === 'unknown') {
      return '/unknown';
    }
    return `/tools/${tool}/`;
  }

  function normalizePathname(pathname) {
    const value = String(pathname || '/').trim();
    return value.startsWith('/') ? value : `/${value}`;
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

  function normalizeTool(tool) {
    const normalized = String(tool || '').trim().toLowerCase();
    return VALID_TOOLS.has(normalized) ? normalized : null;
  }

  function normalizeRoute(route, tool) {
    const value = String(route || '').trim();
    if (!value || !value.startsWith('/')) {
      return null;
    }
    if (tool === 'home') {
      return '/';
    }
    if (tool === 'unknown') {
      return '/unknown';
    }
    if (tool === 'expense') {
      return value.startsWith('/tools/expense/') ? value.slice(0, 120) : null;
    }
    const expectedRoute = `/tools/${tool}/`;
    return value === expectedRoute ? value : null;
  }

  function sanitizeAnalyticsEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    const type = String(rawEvent.type || '').trim();
    const sessionId = String(rawEvent.sessionId || '').trim();
    const tool = normalizeTool(rawEvent.tool);
    if (!VALID_TYPES.has(type) || !sessionId || !tool) {
      return null;
    }

    const viewFallback = tool === 'home' ? 'home' : (tool === 'expense' ? 'add' : 'main');
    const route = normalizeRoute(rawEvent.route, tool);
    if (!route) {
      return null;
    }

    const event = {
      type,
      tool,
      route,
      view: normalizeView(rawEvent.view, viewFallback),
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
    const pathname = input && input.pathname;
    const hash = input && input.hash;
    const width = Number(input && input.width) || 0;
    return sanitizeAnalyticsEvent({
      type: input && input.type,
      tool: getSiteToolFromPathname(pathname),
      route: getAnalyticsRoute(pathname, hash),
      view: getSiteViewFromLocation(pathname, hash),
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
    getAnalyticsRoute,
    getDeviceClass,
    getSiteToolFromPathname,
    getSiteViewFromLocation,
    sanitizeAnalyticsEvent
  };
});
