import {
  allowedOrigin,
  createDeviceCredentials,
  hashDeviceToken,
  json,
  parseBearer,
  validateReminder,
  validateSubscription
} from './core.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_RECONCILE_REMINDERS = 500;
const RECONCILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TEST_PUSH_INTERVAL_MS = 60 * 1000;

function isObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowed) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key));
}

function errorResponse(code, message, status, origin, env, retryable = false) {
  return json({ error: { code, message, retryable } }, status, origin, env);
}

function emptyResponse(status, origin, env) {
  const response = json(null, 200, origin, env);
  return new Response(null, { status, headers: response.headers });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'Request body must be valid JSON.' };
  }
}

function validateDevice(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['platform', 'timezone', 'clientVersion'])) return null;
  if (typeof value.platform !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.platform)) return null;
  if (typeof value.timezone !== 'string' || value.timezone.length > 100) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format();
  } catch {
    return null;
  }
  if (value.clientVersion !== undefined
    && (typeof value.clientVersion !== 'string' || value.clientVersion.length > 64)) return null;
  return { platform: value.platform, timezone: value.timezone };
}

function validateRevision(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['revision'])) return null;
  return Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : null;
}

function validateSummaries(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['reminders'])
    || !Array.isArray(value.reminders) || value.reminders.length > MAX_RECONCILE_REMINDERS) return null;
  const ids = new Set();
  for (const summary of value.reminders) {
    if (!isObject(summary) || !hasOnlyKeys(summary, ['id', 'revision'])
      || typeof summary.id !== 'string' || summary.id.length < 1 || summary.id.length > 128
      || !Number.isSafeInteger(summary.revision) || summary.revision < 0 || ids.has(summary.id)) return null;
    ids.add(summary.id);
  }
  return value.reminders.map(({ id, revision }) => ({ id, revision }));
}

function validateTestPayload(value, at) {
  if (!isObject(value) || !hasOnlyKeys(value, ['encryptedPayload', 'encryptionVersion'])) return null;
  const validated = validateReminder({
    tool: 'test',
    sourceIdHash: '0'.repeat(64),
    notifyAt: at.toISOString(),
    encryptedPayload: value.encryptedPayload,
    encryptionVersion: value.encryptionVersion,
    revision: 0
  }, at);
  return validated.ok ? {
    encryptedPayload: validated.value.encryptedPayload,
    encryptionVersion: validated.value.encryptionVersion
  } : null;
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function routeFor(pathname) {
  if (pathname === '/api/notifications/config') return { name: 'config', methods: ['GET'] };
  if (pathname === '/api/notifications/devices') return { name: 'devices', methods: ['POST'] };
  if (pathname === '/api/notifications/reconcile') return { name: 'reconcile', methods: ['POST'] };
  if (pathname === '/api/notifications/test') return { name: 'test', methods: ['POST'] };

  let match = pathname.match(/^\/api\/notifications\/devices\/([^/]+)\/subscription$/);
  if (match) return { name: 'subscription', methods: ['PUT', 'DELETE'], id: decodeSegment(match[1]) };
  match = pathname.match(/^\/api\/notifications\/reminders\/([^/]+)$/);
  if (match) return { name: 'reminder', methods: ['PUT', 'DELETE'], id: decodeSegment(match[1]) };
  return null;
}

function responseStatus(result) {
  if (typeof result === 'number') return result;
  return result?.status;
}

export function createNotificationApp({ repository, sendPush, now = () => new Date(), crypto = globalThis.crypto }) {
  if (!repository || typeof sendPush !== 'function' || typeof now !== 'function' || !crypto) {
    throw new TypeError('repository, sendPush, now, and crypto are required');
  }

  async function authenticate(request) {
    const token = parseBearer(request);
    if (!token) return null;
    return repository.authenticateDevice(await hashDeviceToken(token, crypto));
  }

  async function fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return errorResponse('origin_forbidden', 'Request origin is not allowed.', 403, request.headers.get('Origin'), env);

    const route = routeFor(new URL(request.url).pathname);
    if (request.method === 'OPTIONS') return emptyResponse(204, origin, env);
    if (!route) return errorResponse('not_found', 'Route not found.', 404, origin, env);
    if (!route.methods.includes(request.method)) {
      return errorResponse('method_not_allowed', 'Method not allowed.', 405, origin, env);
    }
    if ('id' in route && route.id === null) {
      return errorResponse('invalid_path', 'Route path is invalid.', 400, origin, env);
    }

    if (route.name === 'config') {
      return json({ protocolVersion: 1, vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, origin, env);
    }

    const at = now();
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      return errorResponse('server_error', 'Server time is invalid.', 500, origin, env, true);
    }

    if (route.name === 'devices') {
      const body = await readJson(request);
      if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
      const device = validateDevice(body.value);
      if (!device) return errorResponse('invalid_device', 'Device registration is invalid.', 400, origin, env);
      const credentials = createDeviceCredentials(crypto);
      await repository.createDevice({
        id: credentials.deviceId,
        tokenHash: await hashDeviceToken(credentials.deviceToken, crypto),
        ...device,
        createdAt: at.toISOString()
      });
      return json(credentials, 201, origin, env);
    }

    const device = await authenticate(request);
    if (!device) return errorResponse('unauthorized', 'Valid device credentials are required.', 401, origin, env);
    if (route.name === 'subscription' && route.id !== device.id) {
      return errorResponse('device_forbidden', 'Credentials do not belong to this device.', 403, origin, env);
    }

    if (route.name === 'subscription' && request.method === 'PUT') {
      const body = await readJson(request);
      if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
      const validated = validateSubscription(body.value);
      if (!validated.ok) return errorResponse(validated.code, validated.message, 400, origin, env);
      await repository.upsertSubscription(device.id, validated.value, at.toISOString());
      return json({ ok: true }, 200, origin, env);
    }

    if (route.name === 'subscription') {
      await repository.removeSubscription(device.id, at.toISOString());
      await repository.cancelDeviceReminders(device.id, at.toISOString());
      return emptyResponse(204, origin, env);
    }

    if (route.name === 'reminder' && (typeof route.id !== 'string' || route.id.length < 1 || route.id.length > 128)) {
      return errorResponse('invalid_reminder_id', 'Reminder ID is invalid.', 400, origin, env);
    }

    if (route.name === 'reminder' && request.method === 'PUT') {
      const body = await readJson(request);
      if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
      const validated = validateReminder(body.value, at);
      if (!validated.ok) return errorResponse(validated.code, validated.message, 400, origin, env);
      const result = await repository.upsertReminder(device.id, route.id, validated.value, at.toISOString());
      if (result.outcome === 'conflict') {
        return errorResponse('revision_conflict', 'A newer reminder revision already exists.', 409, origin, env);
      }
      const status = result.outcome === 'created' ? 201 : 200;
      return json({ id: route.id, revision: result.reminder.revision, status: result.reminder.status }, status, origin, env);
    }

    if (route.name === 'reminder') {
      const body = await readJson(request);
      if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
      const revision = validateRevision(body.value);
      if (revision === null) return errorResponse('invalid_revision', 'Cancellation revision is invalid.', 400, origin, env);
      const result = await repository.cancelReminder(device.id, route.id, revision, at.toISOString());
      if (result.outcome === 'conflict') {
        return errorResponse('revision_conflict', 'A newer or equal active revision already exists.', 409, origin, env);
      }
      return emptyResponse(204, origin, env);
    }

    if (route.name === 'reconcile') {
      const body = await readJson(request);
      if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
      const summaries = validateSummaries(body.value);
      if (!summaries) return errorResponse('invalid_reconcile', 'Reminder summaries are invalid.', 400, origin, env);
      const through = new Date(at.getTime() + RECONCILE_WINDOW_MS).toISOString();
      return json(await repository.reconcile(device.id, summaries, at.toISOString(), through), 200, origin, env);
    }

    const body = await readJson(request);
    if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
    const payload = validateTestPayload(body.value, at);
    if (!payload) return errorResponse('invalid_test_payload', 'Test payload must contain encrypted content only.', 400, origin, env);
    const subscription = await repository.claimTestPush(device.id, at.toISOString(), TEST_PUSH_INTERVAL_MS);
    if (subscription === null) return errorResponse('rate_limited', 'Test notification rate limit exceeded.', 429, origin, env, true);
    if (subscription === false) return errorResponse('subscription_missing', 'No active push subscription exists.', 409, origin, env);
    const result = await sendPush({ subscription, ...payload, env });
    const status = responseStatus(result);
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      if (status === 404 || status === 410) await repository.invalidateSubscription(device.id, at.toISOString());
      return errorResponse('push_failed', 'Test notification could not be sent.', 502, origin, env, status === 429 || status >= 500);
    }
    return json({ accepted: true }, 202, origin, env);
  }

  async function runScheduled() {
    return { processed: 0 };
  }

  return { fetch, runScheduled };
}
