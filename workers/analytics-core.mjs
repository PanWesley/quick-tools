const VALID_TYPES = new Set(['session_start', 'page_view', 'engagement', 'feature_event']);
const VALID_TOOLS = new Set(['home', 'diff', 'json', 'expense', 'time', 'unknown']);
const VALID_VIEWS = new Set(['home', 'main', 'add', 'dashboard', 'list', 'tags', 'settings', 'import']);
const VALID_DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const VALID_REFERRERS = new Set(['direct', 'internal', 'external']);

function normalizeView(view, fallback = 'main') {
  const normalized = String(view || '').trim().toLowerCase();
  return VALID_VIEWS.has(normalized) ? normalized : fallback;
}

function normalizeTool(tool) {
  const normalized = String(tool || '').trim().toLowerCase();
  return VALID_TOOLS.has(normalized) ? normalized : null;
}

function inferToolFromRoute(route) {
  const value = String(route || '').trim().toLowerCase();
  if (value === '/' || value === '/index.html') {
    return 'home';
  }
  const match = value.match(/^\/tools\/([^/]+)(?:\/|$)/);
  return match && VALID_TOOLS.has(match[1]) ? match[1] : null;
}

function fallbackRouteForTool(tool, view) {
  if (tool === 'home') {
    return '/';
  }
  if (tool === 'expense') {
    return `/tools/expense/#view=${normalizeView(view, 'add')}`;
  }
  if (tool === 'unknown') {
    return '/unknown';
  }
  return `/tools/${tool}/`;
}

function normalizeRoute(route, tool, view) {
  const value = String(route || '').trim();
  if (!value || !value.startsWith('/')) {
    return fallbackRouteForTool(tool, view);
  }
  return value.slice(0, 120);
}

function normalizeFeature(feature) {
  const normalized = String(feature || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return normalized ? normalized.slice(0, 64) : null;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeDuration(durationSeconds) {
  const numericValue = Math.round(Number(durationSeconds) || 0);
  if (numericValue <= 0) {
    return 0;
  }
  return Math.min(numericValue, 120);
}

export function normalizeIncomingEvent(rawEvent, now = new Date()) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const type = String(rawEvent.type || '').trim();
  const sessionId = String(rawEvent.sessionId || '').trim().slice(0, 80);
  if (!VALID_TYPES.has(type) || !sessionId) {
    return null;
  }

  const tool = normalizeTool(rawEvent.tool) || inferToolFromRoute(rawEvent.route) || 'expense';
  const viewFallback = tool === 'home' ? 'home' : (tool === 'expense' ? 'add' : 'main');
  const device = String(rawEvent.device || '').trim().toLowerCase();
  const referrer = String(rawEvent.referrer || '').trim().toLowerCase();
  const feature = type === 'feature_event' ? normalizeFeature(rawEvent.feature) : null;
  if (type === 'feature_event' && !feature) {
    return null;
  }

  return {
    day: now.toISOString().slice(0, 10),
    type,
    tool,
    route: normalizeRoute(rawEvent.route, tool, rawEvent.view),
    view: normalizeView(rawEvent.view, viewFallback),
    sessionId,
    standalone: normalizeBoolean(rawEvent.standalone),
    device: VALID_DEVICES.has(device) ? device : 'desktop',
    referrer: VALID_REFERRERS.has(referrer) ? referrer : 'direct',
    feature,
    durationSeconds: type === 'engagement' ? normalizeDuration(rawEvent.durationSeconds) : 0
  };
}

export function createAggregationPlan(event, visitorKey, timestamp) {
  const name = event.type === 'feature_event' ? event.feature : event.view;
  const engagedSeconds = event.type === 'engagement' ? event.durationSeconds : 0;
  return {
    visitor: {
      day: event.day,
      visitorKey,
      firstSeen: timestamp
    },
    session: {
      day: event.day,
      sessionId: event.sessionId,
      visitorKey,
      firstSeen: timestamp,
      lastSeen: timestamp,
      engagedSeconds
    },
    eventBucket: {
      day: event.day,
      type: event.type,
      name,
      route: event.route,
      incrementBy: event.type === 'engagement' ? 0 : 1,
      engagedSeconds
    },
    toolBucket: {
      day: event.day,
      tool: event.tool,
      incrementBy: event.type === 'engagement' ? 0 : 1,
      engagedSeconds
    },
    dimensions: {
      day: event.day,
      device: event.device,
      referrer: event.referrer,
      standalone: event.standalone ? 1 : 0
    }
  };
}

export function summarizeDailyRows(rows) {
  return rows.map(row => {
    const sessions = Number(row.sessions) || 0;
    const engagedSeconds = Number(row.engagedSeconds) || 0;
    return {
      day: row.day,
      dau: Number(row.visitors) || 0,
      sessions,
      pageviews: Number(row.pageviews) || 0,
      engagedSeconds,
      averageEngagedSeconds: sessions ? Math.round(engagedSeconds / sessions) : 0
    };
  });
}
