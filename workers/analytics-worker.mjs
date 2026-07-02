import {
  createAggregationPlan,
  normalizeIncomingEvent,
  summarizeDailyRows
} from './analytics-core.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_visitors (
        day TEXT NOT NULL,
        visitor_key TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        PRIMARY KEY (day, visitor_key)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_sessions (
        day TEXT NOT NULL,
        session_id TEXT NOT NULL,
        visitor_key TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        engaged_seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, session_id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        day TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        route TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        engaged_seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, type, name, route)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_dimensions (
        day TEXT NOT NULL,
        device TEXT NOT NULL,
        referrer TEXT NOT NULL,
        standalone INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, device, referrer, standalone)
      )
    `)
  ]);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function getVisitorKey(request, env, day) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const ua = request.headers.get('User-Agent') || '';
  const salt = env.ANALYTICS_SALT || 'billnest-local-dev-salt';
  return sha256Hex([day, ip, ua, salt].join('|'));
}

async function recordEvent(request, env) {
  if (!env.ANALYTICS_DB) {
    return jsonResponse({ error: 'ANALYTICS_DB binding is missing' }, 500);
  }

  const rawText = await request.text();
  if (rawText.length > 4096) {
    return jsonResponse({ error: 'Payload too large' }, 413);
  }

  let rawEvent;
  try {
    rawEvent = JSON.parse(rawText || '{}');
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const now = new Date();
  const event = normalizeIncomingEvent(rawEvent, now);
  if (!event) {
    return jsonResponse({ error: 'Invalid analytics event' }, 400);
  }

  await ensureSchema(env.ANALYTICS_DB);
  const timestamp = now.toISOString();
  const visitorKey = await getVisitorKey(request, env, event.day);
  const plan = createAggregationPlan(event, visitorKey, timestamp);

  await env.ANALYTICS_DB.batch([
    env.ANALYTICS_DB.prepare(`
      INSERT OR IGNORE INTO analytics_visitors (day, visitor_key, first_seen)
      VALUES (?, ?, ?)
    `).bind(plan.visitor.day, plan.visitor.visitorKey, plan.visitor.firstSeen),
    env.ANALYTICS_DB.prepare(`
      INSERT INTO analytics_sessions (day, session_id, visitor_key, first_seen, last_seen, engaged_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, session_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        engaged_seconds = analytics_sessions.engaged_seconds + excluded.engaged_seconds
    `).bind(
      plan.session.day,
      plan.session.sessionId,
      plan.session.visitorKey,
      plan.session.firstSeen,
      plan.session.lastSeen,
      plan.session.engagedSeconds
    ),
    env.ANALYTICS_DB.prepare(`
      INSERT INTO analytics_events (day, type, name, route, count, engaged_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, type, name, route) DO UPDATE SET
        count = analytics_events.count + excluded.count,
        engaged_seconds = analytics_events.engaged_seconds + excluded.engaged_seconds
    `).bind(
      plan.eventBucket.day,
      plan.eventBucket.type,
      plan.eventBucket.name,
      plan.eventBucket.route,
      plan.eventBucket.incrementBy,
      plan.eventBucket.engagedSeconds
    ),
    env.ANALYTICS_DB.prepare(`
      INSERT INTO analytics_dimensions (day, device, referrer, standalone, count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(day, device, referrer, standalone) DO UPDATE SET
        count = analytics_dimensions.count + 1
    `).bind(
      plan.dimensions.day,
      plan.dimensions.device,
      plan.dimensions.referrer,
      plan.dimensions.standalone
    )
  ]);

  return jsonResponse({ ok: true }, 202);
}

async function getSummary(request, env) {
  if (!env.ANALYTICS_DB) {
    return jsonResponse({ error: 'ANALYTICS_DB binding is missing' }, 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('X-Analytics-Token') || '';
  if (!env.ANALYTICS_READ_TOKEN || token !== env.ANALYTICS_READ_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  await ensureSchema(env.ANALYTICS_DB);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 14));
  const sinceModifier = `-${days - 1} days`;
  const daily = await env.ANALYTICS_DB.prepare(`
    WITH days AS (
      SELECT DISTINCT day
      FROM analytics_visitors
      WHERE day >= date('now', ?)
    ),
    visitor_totals AS (
      SELECT day, COUNT(DISTINCT visitor_key) AS visitors
      FROM analytics_visitors
      GROUP BY day
    ),
    session_totals AS (
      SELECT day, COUNT(DISTINCT session_id) AS sessions, SUM(engaged_seconds) AS engagedSeconds
      FROM analytics_sessions
      GROUP BY day
    ),
    pageview_totals AS (
      SELECT day, SUM(count) AS pageviews
      FROM analytics_events
      WHERE type = 'page_view'
      GROUP BY day
    )
    SELECT
      days.day AS day,
      COALESCE(visitor_totals.visitors, 0) AS visitors,
      COALESCE(session_totals.sessions, 0) AS sessions,
      COALESCE(pageview_totals.pageviews, 0) AS pageviews,
      COALESCE(session_totals.engagedSeconds, 0) AS engagedSeconds
    FROM days
    LEFT JOIN visitor_totals ON visitor_totals.day = days.day
    LEFT JOIN session_totals ON session_totals.day = days.day
    LEFT JOIN pageview_totals ON pageview_totals.day = days.day
    ORDER BY days.day DESC
  `).bind(sinceModifier).all();

  const topRoutes = await env.ANALYTICS_DB.prepare(`
    SELECT route, SUM(count) AS pageviews
    FROM analytics_events
    WHERE type = 'page_view'
      AND day >= date('now', ?)
    GROUP BY route
    ORDER BY pageviews DESC
    LIMIT 10
  `).bind(sinceModifier).all();

  return jsonResponse({
    days,
    daily: summarizeDailyRows(daily.results || []),
    topRoutes: topRoutes.results || []
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/analytics' && request.method === 'POST') {
      return recordEvent(request, env);
    }
    if (url.pathname === '/api/analytics/summary' && request.method === 'GET') {
      return getSummary(request, env);
    }
    return jsonResponse({ error: 'Not found' }, 404);
  }
};
