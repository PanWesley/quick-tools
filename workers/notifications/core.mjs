const DEVICE_TOKEN_BYTES = 32;
const MAX_BATCH_OPERATIONS = 25;
// The client horizon remains 30 local-calendar days. This 31-day validation
// envelope only absorbs timezone and DST differences at the HTTP boundary.
const MAX_REMINDER_DELAY_MS = 31 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

function failure(code, message) {
  return { ok: false, code, message };
}

function isObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, keys) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function isBase64url(value, length) {
  return typeof value === 'string'
    && value.length === length
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function allowedOrigin(request, env) {
  if (typeof env?.ALLOWED_ORIGINS !== 'string') return null;
  const headerOrigin = request.headers.get('Origin');
  let origin = headerOrigin;
  if (!origin) {
    try {
      origin = new URL(request.url).origin;
    } catch {
      return null;
    }
  }

  const origins = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  return origins.includes(origin) ? origin : null;
}

export function parseBearer(request) {
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

export function createDeviceCredentials(crypto) {
  const bytes = new Uint8Array(DEVICE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return {
    deviceId: crypto.randomUUID(),
    deviceToken: base64url(bytes)
  };
}

export async function hashDeviceToken(token, crypto) {
  const input = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateSubscription(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['endpoint', 'expirationTime', 'keys'])) {
    return failure('invalid_subscription', 'Subscription contains unsupported fields.');
  }

  if (typeof value.endpoint !== 'string') {
    return failure('invalid_subscription', 'Subscription endpoint must be a valid HTTPS URL.');
  }

  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    return failure('invalid_subscription', 'Subscription endpoint must be a valid HTTPS URL.');
  }

  if (endpoint.protocol !== 'https:' || value.endpoint.length > 2048) {
    return failure('invalid_subscription', 'Subscription endpoint must be a valid HTTPS URL.');
  }

  if (value.expirationTime !== undefined
    && value.expirationTime !== null
    && (!Number.isFinite(value.expirationTime) || value.expirationTime < 0)) {
    return failure('invalid_subscription', 'Subscription expiration time is invalid.');
  }

  if (!isObject(value.keys)
    || !hasOnlyKeys(value.keys, ['p256dh', 'auth'])
    || !isBase64url(value.keys.p256dh, 87)
    || !isBase64url(value.keys.auth, 22)) {
    return failure('invalid_subscription', 'Subscription keys are invalid.');
  }

  return {
    ok: true,
    value: {
      endpoint: value.endpoint,
      expirationTime: value.expirationTime ?? null,
      p256dh: value.keys.p256dh,
      auth: value.keys.auth
    }
  };
}

export function validateReminder(value, now) {
  const allowedKeys = ['tool', 'sourceIdHash', 'notifyAt', 'encryptedPayload', 'encryptionVersion', 'revision'];
  if (!isObject(value) || !hasOnlyKeys(value, allowedKeys)) {
    return failure('invalid_reminder', 'Reminder contains unsupported fields.');
  }

  if (typeof value.tool !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.tool)) {
    return failure('invalid_reminder', 'Reminder tool is invalid.');
  }

  if (typeof value.sourceIdHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceIdHash)) {
    return failure('invalid_reminder', 'Reminder source ID hash is invalid.');
  }

  if (typeof value.notifyAt !== 'string') {
    return failure('invalid_reminder', 'Reminder time is outside the server validation envelope.');
  }

  const notifyAt = new Date(value.notifyAt);
  if (Number.isNaN(notifyAt.getTime())
    || notifyAt.toISOString() !== value.notifyAt
    || !(now instanceof Date)
    || Number.isNaN(now.getTime())
    || notifyAt.getTime() < now.getTime()
    || notifyAt.getTime() - now.getTime() > MAX_REMINDER_DELAY_MS) {
    return failure('invalid_reminder', 'Reminder time is outside the server validation envelope.');
  }

  if (!Number.isSafeInteger(value.encryptionVersion) || value.encryptionVersion !== 1) {
    return failure('invalid_reminder', 'Reminder encryption version is invalid.');
  }

  if (!isObject(value.encryptedPayload)
    || !hasOnlyKeys(value.encryptedPayload, ['v', 'iv', 'ciphertext'])
    || value.encryptedPayload.v !== value.encryptionVersion
    || typeof value.encryptedPayload.iv !== 'string'
    || !/^[A-Za-z0-9_-]{1,256}$/.test(value.encryptedPayload.iv)
    || typeof value.encryptedPayload.ciphertext !== 'string'
    || !/^[A-Za-z0-9_-]{1,16384}$/.test(value.encryptedPayload.ciphertext)) {
    return failure('invalid_reminder', 'Reminder encrypted payload is invalid.');
  }

  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    return failure('invalid_reminder', 'Reminder revision must be a non-negative integer.');
  }

  return {
    ok: true,
    value: {
      tool: value.tool,
      sourceIdHash: value.sourceIdHash,
      notifyAt: value.notifyAt,
      encryptedPayload: {
        v: value.encryptedPayload.v,
        iv: value.encryptedPayload.iv,
        ciphertext: value.encryptedPayload.ciphertext
      },
      encryptionVersion: value.encryptionVersion,
      revision: value.revision
    }
  };
}

function validateRevision(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['revision'])) return null;
  return Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : null;
}

export function validateReminderBatch(value, now) {
  if (!isObject(value) || !hasOnlyKeys(value, ['operations'])
    || !Array.isArray(value.operations)
    || value.operations.length < 1
    || value.operations.length > MAX_BATCH_OPERATIONS) {
    return failure('invalid_reminder_batch', 'Reminder batch is invalid.');
  }
  const ids = new Set();
  const operations = [];
  for (const operation of value.operations) {
    if (!isObject(operation) || typeof operation.id !== 'string'
      || operation.id.length < 1 || operation.id.length > 128 || ids.has(operation.id)) {
      return failure('invalid_reminder_batch', 'Reminder batch is invalid.');
    }
    ids.add(operation.id);
    if (operation.kind === 'upsert' && hasOnlyKeys(operation, ['kind', 'id', 'reminder'])) {
      const validated = validateReminder(operation.reminder, now);
      if (!validated.ok) return failure('invalid_reminder_batch', validated.message);
      operations.push({ kind: 'upsert', id: operation.id, reminder: validated.value });
      continue;
    }
    if (operation.kind === 'cancel' && hasOnlyKeys(operation, ['kind', 'id', 'revision'])) {
      const revision = validateRevision({ revision: operation.revision });
      if (revision !== null) {
        operations.push({ kind: 'cancel', id: operation.id, revision });
        continue;
      }
    }
    return failure('invalid_reminder_batch', 'Reminder batch is invalid.');
  }
  return { ok: true, value: operations };
}

export function classifyPushStatus(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'invalid_subscription';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}

export function retryAt(attempt, now) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > RETRY_DELAYS_MS.length
    || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return null;
  }
  return new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]);
}

export function json(data, status, origin, env) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  });
  const request = {
    headers: { get: (name) => name.toLowerCase() === 'origin' ? origin : null }
  };
  const responseOrigin = allowedOrigin(request, env);
  if (responseOrigin === origin && responseOrigin !== null) {
    headers.set('Access-Control-Allow-Origin', responseOrigin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  return new Response(JSON.stringify(data), { status, headers });
}
