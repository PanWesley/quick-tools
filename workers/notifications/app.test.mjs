import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import { createNotificationApp } from './app.mjs';

const NOW = new Date('2026-07-11T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function createMemoryRepository() {
  return {
    devices: [],
    subscriptions: [],
    reminders: [],
    testPushes: new Map(),
    subscriptionDeletionCalls: 0,

    async createDevice(device) {
      this.devices.push({ ...device });
      return { ...device };
    },

    async authenticateDevice(tokenHash) {
      return this.devices.find((device) => device.tokenHash === tokenHash && !device.revokedAt) ?? null;
    },

    async upsertSubscription(deviceId, subscription, at) {
      const next = { deviceId, ...subscription, updatedAt: at };
      const index = this.subscriptions.findIndex((item) => item.deviceId === deviceId);
      if (index === -1) this.subscriptions.push(next);
      else this.subscriptions[index] = next;
      return next;
    },

    async removeSubscriptionAndCancelReminders(deviceId, at) {
      this.subscriptionDeletionCalls += 1;
      const subscriptions = structuredClone(this.subscriptions);
      const reminders = structuredClone(this.reminders);
      try {
        const subscription = this.subscriptions.find((item) => item.deviceId === deviceId);
        if (subscription) subscription.invalidatedAt = at;
        if (this.failSubscriptionDeletion) throw new Error('injected deletion failure');
        let remindersCancelled = 0;
        for (const reminder of this.reminders) {
          if (reminder.deviceId === deviceId && ['pending', 'processing', 'retry'].includes(reminder.status)) {
            Object.assign(reminder, {
              status: 'cancelled', updatedAt: at, leaseUntil: null, lastErrorCode: 'subscription_disabled'
            });
            remindersCancelled += 1;
          }
        }
        return { subscriptionRemoved: Boolean(subscription), remindersCancelled };
      } catch (error) {
        this.subscriptions = subscriptions;
        this.reminders = reminders;
        throw error;
      }
    },

    async upsertReminder(deviceId, id, reminder, at) {
      const existing = this.reminders.find((item) => item.id === id && item.deviceId === deviceId);
      if (existing && reminder.revision < existing.revision) return { outcome: 'conflict', reminder: existing };
      if (existing && reminder.revision === existing.revision
        && !(existing.status === 'cancelled' && existing.lastErrorCode === 'subscription_disabled')) {
        return { outcome: 'unchanged', reminder: existing };
      }
      const next = {
        id, deviceId, ...structuredClone(reminder), status: 'pending', lastErrorCode: null, updatedAt: at
      };
      if (existing) Object.assign(existing, next);
      else this.reminders.push(next);
      return { outcome: existing ? 'updated' : 'created', reminder: next };
    },

    async cancelReminder(deviceId, id, revision, at) {
      const reminder = this.reminders.find((item) => item.id === id && item.deviceId === deviceId);
      if (!reminder) return { outcome: 'missing' };
      if (revision < reminder.revision) return { outcome: 'conflict', reminder };
      if (revision === reminder.revision && reminder.status === 'cancelled') return { outcome: 'unchanged', reminder };
      if (revision === reminder.revision && reminder.status !== 'cancelled') return { outcome: 'conflict', reminder };
      Object.assign(reminder, { revision, status: 'cancelled', updatedAt: at, lastErrorCode: null });
      return { outcome: 'cancelled', reminder };
    },

    async reconcile(deviceId, summaries, from, through) {
      this.lastReconcileFrom = from;
      this.lastReconcileThrough = through;
      const server = this.reminders.filter((item) => item.deviceId === deviceId
        && item.notifyAt >= from && item.notifyAt <= through && item.status !== 'expired');
      const client = new Map(summaries.map((item) => [item.id, item.revision]));
      const unknown = [];
      for (const item of server) {
        if (client.has(item.id) || !['pending', 'processing', 'retry'].includes(item.status)) continue;
        Object.assign(item, { status: 'cancelled', leaseUntil: null, lastErrorCode: null, updatedAt: from });
        unknown.push(item.id);
      }
      return {
        missing: summaries.filter((item) => !server.some((stored) => stored.id === item.id)).map((item) => item.id),
        stale: summaries.filter((item) => {
          const stored = server.find((candidate) => candidate.id === item.id);
          return stored && item.revision < stored.revision;
        }).map((item) => item.id),
        cancelled: server.filter((item) => item.status === 'cancelled' && client.has(item.id)).map((item) => item.id),
        unknown
      };
    },

    async claimTestPush(deviceId, at, intervalMs) {
      const previous = this.testPushes.get(deviceId);
      if (previous && new Date(at).getTime() - new Date(previous).getTime() < intervalMs) return null;
      const subscription = this.subscriptions.find((item) => item.deviceId === deviceId && !item.invalidatedAt);
      if (!subscription) return false;
      this.testPushes.set(deviceId, at);
      return subscription;
    }
  };
}

function jsonRequest(path, method, body, token, headers = {}) {
  const requestHeaders = { 'Content-Type': 'application/json', Origin: 'https://billnest.top', ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  return new Request(`https://billnest.top${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function chunkedJsonRequest(path, chunks, headers = {}) {
  const encoder = new TextEncoder();
  const source = {
    pulls: 0,
    cancellations: [],
    index: 0
  };
  const stream = new ReadableStream({
    pull(controller) {
      source.pulls += 1;
      const chunk = chunks[source.index++];
      if (chunk === undefined) controller.close();
      else if (chunk instanceof Error) controller.error(chunk);
      else controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
    cancel(reason) {
      source.cancellations.push(reason);
    }
  });
  return {
    request: new Request(`https://billnest.top${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://billnest.top', ...headers },
      body: stream,
      duplex: 'half'
    }),
    source
  };
}

function fixture({ sendPush, now } = {}) {
  const repository = createMemoryRepository();
  const pushes = [];
  const app = createNotificationApp({
    repository,
    sendPush: sendPush ?? (async (message) => {
      pushes.push(message);
      return { status: 201 };
    }),
    now: now ?? (() => new Date(NOW)),
    crypto: webcrypto
  });
  const env = {
    ALLOWED_ORIGINS: 'https://billnest.top,https://www.billnest.top',
    VAPID_PUBLIC_KEY: 'runtime-public-key'
  };
  return { app, env, pushes, repository };
}

async function register(context) {
  const response = await context.app.fetch(jsonRequest('/api/notifications/devices', 'POST', {
    platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: '0.7.0'
  }), context.env);
  assert.equal(response.status, 201);
  return response.json();
}

function subscription(endpoint = 'https://push.example/first') {
  return {
    endpoint,
    expirationTime: null,
    keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }
  };
}

function reminder(revision = 1, notifyAt = '2026-07-11T10:30:00.000Z') {
  return {
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt,
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision
  };
}

test('config reads the public key from runtime env', async () => {
  const { app, env } = fixture();
  const response = await app.fetch(new Request('https://billnest.top/api/notifications/config', {
    headers: { Origin: 'https://billnest.top' }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { protocolVersion: 1, vapidPublicKey: 'runtime-public-key' });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://billnest.top');

  const sameOriginResponse = await app.fetch(
    new Request('https://billnest.top/api/notifications/config'),
    env
  );
  assert.equal(sameOriginResponse.status, 200);
  assert.deepEqual(await sameOriginResponse.json(), {
    protocolVersion: 1,
    vapidPublicKey: 'runtime-public-key'
  });
});

test('anonymous registration returns one device token and stores only its hash', async () => {
  const context = fixture();
  const body = await register(context);
  assert.match(body.deviceId, /^[0-9a-f-]{36}$/);
  assert.ok(body.deviceToken.length >= 40);
  assert.notEqual(context.repository.devices[0].tokenHash, body.deviceToken);
  assert.equal(context.repository.devices[0].tokenHash.length, 64);
});

test('authenticated routes reject missing, invalid, and wrong-device credentials', async () => {
  const context = fixture();
  const first = await register(context);
  const second = await register(context);
  const path = `/api/notifications/devices/${first.deviceId}/subscription`;
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', subscription()), context.env)).status, 401);
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', subscription(), 'invalid'), context.env)).status, 401);
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', subscription(), second.deviceToken), context.env)).status, 403);
});

test('subscription replacement is idempotent and deletion cancels future reminders', async () => {
  const context = fixture();
  const credentials = await register(context);
  const path = `/api/notifications/devices/${credentials.deviceId}/subscription`;
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', subscription(), credentials.deviceToken), context.env)).status, 200);
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', subscription('https://push.example/replacement'), credentials.deviceToken), context.env)).status, 200);
  assert.equal(context.repository.subscriptions.length, 1);
  assert.equal(context.repository.subscriptions[0].endpoint, 'https://push.example/replacement');

  await context.app.fetch(jsonRequest('/api/notifications/reminders/future', 'PUT', reminder(), credentials.deviceToken), context.env);
  const deleted = await context.app.fetch(jsonRequest(path, 'DELETE', undefined, credentials.deviceToken), context.env);
  assert.equal(deleted.status, 204);
  assert.ok(context.repository.subscriptions[0].invalidatedAt);
  assert.equal(context.repository.reminders[0].status, 'cancelled');
  assert.equal((await context.app.fetch(jsonRequest(path, 'DELETE', undefined, credentials.deviceToken), context.env)).status, 204);
  assert.equal(context.repository.subscriptionDeletionCalls, 2);
});

test('composed in-memory subscription deletion rolls back both state changes on failure', async () => {
  const context = fixture();
  const credentials = await register(context);
  const path = `/api/notifications/devices/${credentials.deviceId}/subscription`;
  await context.app.fetch(jsonRequest(path, 'PUT', subscription(), credentials.deviceToken), context.env);
  await context.app.fetch(jsonRequest('/api/notifications/reminders/future', 'PUT', reminder(), credentials.deviceToken), context.env);
  context.repository.failSubscriptionDeletion = true;

  await assert.rejects(
    context.repository.removeSubscriptionAndCancelReminders(credentials.deviceId, NOW.toISOString()),
    /injected deletion failure/
  );
  assert.equal(context.repository.subscriptions[0].invalidatedAt, undefined);
  assert.equal(context.repository.reminders[0].status, 'pending');
});

test('older reminder revisions cannot overwrite a newer reminder and equal revisions are idempotent', async () => {
  const context = fixture();
  const credentials = await register(context);
  const put = (revision, notifyAt) => context.app.fetch(jsonRequest('/api/notifications/reminders/reminder-1', 'PUT', {
    ...reminder(revision, notifyAt)
  }, credentials.deviceToken), context.env);
  assert.equal((await put(4, '2026-07-11T10:30:00.000Z')).status, 201);
  assert.equal((await put(4, '2026-07-11T11:30:00.000Z')).status, 200);
  assert.equal(context.repository.reminders[0].notifyAt, '2026-07-11T10:30:00.000Z');
  assert.equal((await put(3, '2026-07-11T11:30:00.000Z')).status, 409);
  assert.equal(context.repository.reminders[0].revision, 4);
});

test('cancellation requires a newer revision and a newer upsert restores pending state', async () => {
  const context = fixture();
  const credentials = await register(context);
  const path = '/api/notifications/reminders/reminder-1';
  await context.app.fetch(jsonRequest(path, 'PUT', reminder(4), credentials.deviceToken), context.env);
  assert.equal((await context.app.fetch(jsonRequest(path, 'DELETE', { revision: 4 }, credentials.deviceToken), context.env)).status, 409);
  assert.equal((await context.app.fetch(jsonRequest(path, 'DELETE', { revision: 5 }, credentials.deviceToken), context.env)).status, 204);
  assert.equal(context.repository.reminders[0].status, 'cancelled');
  assert.equal((await context.app.fetch(jsonRequest(path, 'PUT', reminder(6), credentials.deviceToken), context.env)).status, 200);
  assert.equal(context.repository.reminders[0].status, 'pending');
});

test('batch applies mixed reminders only after complete validation', async () => {
  const context = fixture();
  const credentials = await register(context);
  const invalid = await context.app.fetch(jsonRequest('/api/notifications/reminders/batch', 'POST', {
    operations: [
      { kind: 'upsert', id: 'one', reminder: reminder(2) },
      { kind: 'cancel', id: 'invalid', revision: 3.5 }
    ]
  }, credentials.deviceToken), context.env);
  assert.equal(invalid.status, 400);
  assert.equal(context.repository.reminders.length, 0);

  const existing = await context.app.fetch(jsonRequest('/api/notifications/reminders/stale', 'PUT',
    reminder(4), credentials.deviceToken), context.env);
  assert.equal(existing.status, 201);

  const response = await context.app.fetch(jsonRequest('/api/notifications/reminders/batch', 'POST', {
    operations: [
      { kind: 'upsert', id: 'stale', reminder: reminder(3) },
      { kind: 'upsert', id: 'one', reminder: reminder(2) },
      { kind: 'cancel', id: 'missing', revision: 3 }
    ]
  }, credentials.deviceToken), context.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [
      { id: 'stale', outcome: 'stale', revision: 4 },
      { id: 'one', outcome: 'applied', revision: 2 },
      { id: 'missing', outcome: 'unknown', revision: 3 }
    ]
  });
});

test('single and batch reminder routes accept strict v2 ciphertext without plaintext fields', async () => {
  const context = fixture();
  const credentials = await register(context);
  const v2Reminder = reminder(8);
  v2Reminder.encryptionVersion = 2;
  v2Reminder.encryptedPayload = { v: 2, iv: 'abc', ciphertext: 'def' };

  const single = await context.app.fetch(jsonRequest(
    '/api/notifications/reminders/v2-single', 'PUT', v2Reminder, credentials.deviceToken
  ), context.env);
  assert.equal(single.status, 201);

  const batch = await context.app.fetch(jsonRequest('/api/notifications/reminders/batch', 'POST', {
    operations: [
      { kind: 'upsert', id: 'v1-batch', reminder: reminder(7) },
      { kind: 'upsert', id: 'v2-batch', reminder: v2Reminder }
    ]
  }, credentials.deviceToken), context.env);
  assert.equal(batch.status, 200);
  assert.deepEqual((await batch.json()).results.map((result) => result.id), ['v1-batch', 'v2-batch']);

  const plaintext = await context.app.fetch(jsonRequest(
    '/api/notifications/reminders/v2-plaintext', 'PUT', { ...v2Reminder, title: '吃饭' }, credentials.deviceToken
  ), context.env);
  assert.equal(plaintext.status, 400);
});

test('batch route supports POST preflight and requires JSON', async () => {
  const context = fixture();
  const credentials = await register(context);
  const preflight = await context.app.fetch(new Request(
    'https://billnest.top/api/notifications/reminders/batch',
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://billnest.top',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type'
      }
    }
  ), context.env);
  assert.equal(preflight.status, 204);

  const response = await context.app.fetch(new Request(
    'https://billnest.top/api/notifications/reminders/batch',
    {
      method: 'POST',
      headers: {
        Origin: 'https://billnest.top',
        Authorization: `Bearer ${credentials.deviceToken}`,
        'Content-Type': 'text/plain'
      },
      body: '{}'
    }
  ), context.env);
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, 'unsupported_media_type');
});

test('HTTP disable and re-enable restores only bulk-disabled reminders at the same revision', async () => {
  const context = fixture();
  const credentials = await register(context);
  const subscriptionPath = `/api/notifications/devices/${credentials.deviceId}/subscription`;
  const reminderPath = '/api/notifications/reminders/device-scoped-reminder';
  await context.app.fetch(jsonRequest(subscriptionPath, 'PUT', subscription(), credentials.deviceToken), context.env);
  await context.app.fetch(jsonRequest(reminderPath, 'PUT', reminder(4), credentials.deviceToken), context.env);

  await context.app.fetch(jsonRequest(subscriptionPath, 'DELETE', undefined, credentials.deviceToken), context.env);
  await context.app.fetch(jsonRequest(subscriptionPath, 'PUT', subscription(), credentials.deviceToken), context.env);
  const restored = await context.app.fetch(jsonRequest(reminderPath, 'PUT', reminder(4), credentials.deviceToken), context.env);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).status, 'pending');
  assert.equal(context.repository.reminders[0].lastErrorCode, null);

  await context.app.fetch(jsonRequest(reminderPath, 'DELETE', { revision: 5 }, credentials.deviceToken), context.env);
  const explicit = await context.app.fetch(jsonRequest(reminderPath, 'PUT', reminder(5), credentials.deviceToken), context.env);
  assert.equal(explicit.status, 200);
  assert.equal((await explicit.json()).status, 'cancelled');
});

test('reconcile compares bounded reminder summaries within the 31-day server envelope', async () => {
  const context = fixture();
  const credentials = await register(context);
  await context.app.fetch(jsonRequest('/api/notifications/reminders/server-only', 'PUT', reminder(2), credentials.deviceToken), context.env);
  const response = await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', {
    reminders: [{ id: 'server-only', revision: 1 }, { id: 'client-only', revision: 3 }]
  }, credentials.deviceToken), context.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    missing: ['client-only'], stale: ['server-only'], cancelled: [], unknown: []
  });
  const tooMany = Array.from({ length: 501 }, (_, index) => ({ id: `r-${index}`, revision: 1 }));
  assert.equal((await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', { reminders: tooMany }, credentials.deviceToken), context.env)).status, 400);
  const through = new Date(NOW.getTime() + 31 * DAY_MS).toISOString();
  assert.equal(context.repository.lastReconcileFrom, NOW.toISOString());
  assert.equal(context.repository.lastReconcileThrough, through);
});

test('HTTP reconcile cancels completed deleted and rescheduled server-only reminders authoritatively', async () => {
  const context = fixture();
  const credentials = await register(context);
  for (const id of ['completed-old', 'deleted-old', 'rescheduled-old']) {
    await context.app.fetch(jsonRequest(
      `/api/notifications/reminders/${id}`,
      'PUT',
      reminder(7),
      credentials.deviceToken
    ), context.env);
  }

  const response = await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', {
    reminders: [{ id: 'rescheduled-new', revision: 8 }]
  }, credentials.deviceToken), context.env);

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).unknown, [
    'completed-old', 'deleted-old', 'rescheduled-old'
  ]);
  assert.deepEqual(
    context.repository.reminders.map((item) => [item.id, item.status]),
    [
      ['completed-old', 'cancelled'],
      ['deleted-old', 'cancelled'],
      ['rescheduled-old', 'cancelled']
    ]
  );
});

test('HTTP accepts the New York fallback 30-local-day reminder inside the 31-day validation envelope', async () => {
  const fallbackNow = new Date('2026-10-02T13:00:00.000Z');
  const context = fixture({ now: () => new Date(fallbackNow) });
  const credentials = await register(context);
  const path = '/api/notifications/reminders/fallback-boundary';

  const put = await context.app.fetch(jsonRequest(
    path,
    'PUT',
    reminder(1, '2026-11-01T14:00:00.000Z'),
    credentials.deviceToken
  ), context.env);
  assert.equal(put.status, 201);

  const reconcile = await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', {
    reminders: [{ id: 'fallback-boundary', revision: 1 }]
  }, credentials.deviceToken), context.env);
  assert.equal(reconcile.status, 200);
  assert.deepEqual(await reconcile.json(), { missing: [], stale: [], cancelled: [], unknown: [] });
  assert.equal(
    context.repository.lastReconcileThrough,
    new Date(fallbackNow.getTime() + 31 * DAY_MS).toISOString()
  );
});

test('HTTP reconcile accepts 500 maximum-length summaries and rejects 501', async () => {
  const context = fixture();
  const credentials = await register(context);
  const summaries = Array.from({ length: 500 }, (_, index) => ({
    id: `${String(index).padStart(3, '0')}-${'x'.repeat(124)}`,
    revision: index
  }));

  const accepted = await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', {
    reminders: summaries
  }, credentials.deviceToken), context.env);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).missing.length, 500);

  const rejected = await context.app.fetch(jsonRequest('/api/notifications/reconcile', 'POST', {
    reminders: summaries.concat({ id: `500-${'y'.repeat(124)}`, revision: 500 })
  }, credentials.deviceToken), context.env);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, 'invalid_reconcile');
});

test('test endpoint accepts encrypted payload only and rate limits through repository state', async () => {
  const context = fixture();
  const credentials = await register(context);
  const subscriptionPath = `/api/notifications/devices/${credentials.deviceId}/subscription`;
  await context.app.fetch(jsonRequest(subscriptionPath, 'PUT', subscription(), credentials.deviceToken), context.env);
  const payload = { encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1 };
  const sent = await context.app.fetch(jsonRequest('/api/notifications/test', 'POST', payload, credentials.deviceToken), context.env);
  assert.equal(sent.status, 202);
  assert.equal(context.pushes.length, 1);
  assert.deepEqual(context.pushes[0].encryptedPayload, payload.encryptedPayload);
  assert.equal((await context.app.fetch(jsonRequest('/api/notifications/test', 'POST', payload, credentials.deviceToken), context.env)).status, 429);
  assert.equal(context.pushes.length, 1);
  assert.equal((await context.app.fetch(jsonRequest('/api/notifications/test', 'POST', {
    ...payload, title: 'plaintext'
  }, credentials.deviceToken), context.env)).status, 400);
});

test('test endpoint converts rejected push sends into a unified 502 response', async () => {
  const context = fixture({ sendPush: async () => { throw new Error('network unavailable'); } });
  const credentials = await register(context);
  const subscriptionPath = `/api/notifications/devices/${credentials.deviceId}/subscription`;
  await context.app.fetch(jsonRequest(subscriptionPath, 'PUT', subscription(), credentials.deviceToken), context.env);
  const response = await context.app.fetch(jsonRequest('/api/notifications/test', 'POST', {
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1
  }, credentials.deviceToken), context.env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: { code: 'push_failed', message: 'Test notification could not be sent.', retryable: true }
  });
});

test('routing distinguishes 404s and 405s and handles preflight', async () => {
  const { app, env } = fixture();
  assert.equal((await app.fetch(jsonRequest('/api/notifications/unknown', 'POST', {}), env)).status, 404);
  assert.equal((await app.fetch(jsonRequest('/api/notifications/config', 'POST', {}), env)).status, 405);
  assert.equal((await app.fetch(jsonRequest('/api/notifications/reminders/%E0%A4%A', 'PUT', {}), env)).status, 400);
  const preflight = await app.fetch(new Request('https://billnest.top/api/notifications/config', {
    method: 'OPTIONS', headers: {
      Origin: 'https://billnest.top',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://billnest.top');
});

test('preflight rejects unknown, malformed, unsupported, and incomplete requests', async () => {
  const { app, env } = fixture();
  const preflight = (path, method, headers = {}) => app.fetch(new Request(`https://billnest.top${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://billnest.top',
      ...(method ? { 'Access-Control-Request-Method': method } : {}),
      ...headers
    }
  }), env);
  assert.equal((await preflight('/api/notifications/unknown', 'POST')).status, 404);
  assert.equal((await preflight('/api/notifications/reminders/%E0%A4%A', 'PUT')).status, 400);
  assert.equal((await preflight('/api/notifications/config', 'POST')).status, 405);
  assert.equal((await preflight('/api/notifications/config', 'GET', {
    'Access-Control-Request-Headers': 'Content-Type, X-Device-Secret'
  })).status, 400);
  assert.equal((await preflight('/api/notifications/config')).status, 400);
});

test('every JSON-consuming endpoint requires an application/json media type', async () => {
  const context = fixture();
  const credentials = await register(context);
  const requests = [
    new Request('https://billnest.top/api/notifications/devices', {
      method: 'POST', headers: { Origin: 'https://billnest.top' }, body: '{}'
    }),
    new Request(`https://billnest.top/api/notifications/devices/${credentials.deviceId}/subscription`, {
      method: 'PUT', headers: {
        Origin: 'https://billnest.top', Authorization: `Bearer ${credentials.deviceToken}`, 'Content-Type': 'text/plain'
      }, body: '{}'
    }),
    new Request('https://billnest.top/api/notifications/reminders/reminder-1', {
      method: 'PUT', headers: { Origin: 'https://billnest.top', Authorization: `Bearer ${credentials.deviceToken}` }, body: '{}'
    }),
    new Request('https://billnest.top/api/notifications/reminders/reminder-1', {
      method: 'DELETE', headers: {
        Origin: 'https://billnest.top', Authorization: `Bearer ${credentials.deviceToken}`, 'Content-Type': 'text/plain'
      }, body: '{}'
    }),
    new Request('https://billnest.top/api/notifications/reconcile', {
      method: 'POST', headers: { Origin: 'https://billnest.top', Authorization: `Bearer ${credentials.deviceToken}` }, body: '{}'
    }),
    new Request('https://billnest.top/api/notifications/test', {
      method: 'POST', headers: {
        Origin: 'https://billnest.top', Authorization: `Bearer ${credentials.deviceToken}`, 'Content-Type': 'text/plain'
      }, body: '{}'
    })
  ];
  for (const request of requests) {
    const response = await context.app.fetch(request, context.env);
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'unsupported_media_type');
  }
});

test('requests reject oversized bodies and origins outside the allowlist', async () => {
  const { app, env, repository } = fixture();
  const oversized = { platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: 'x'.repeat(140_000) };
  assert.equal((await app.fetch(jsonRequest('/api/notifications/devices', 'POST', oversized), env)).status, 413);
  const evil = jsonRequest('/api/notifications/devices', 'POST', {
    platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: '0.7.0'
  }, undefined, { Origin: 'https://evil.example' });
  const rejected = await app.fetch(evil, env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.has('access-control-allow-origin'), false);
  assert.equal(repository.devices.length, 0);
});

test('chunked JSON cancels the reader as soon as its cumulative bytes exceed the limit', async () => {
  const { app, env } = fixture();
  const { request, source } = chunkedJsonRequest('/api/notifications/devices', [
    new Uint8Array(64 * 1024),
    new Uint8Array((64 * 1024) + 1),
    new Uint8Array(1)
  ]);

  const response = await app.fetch(request, env);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'payload_too_large');
  assert.equal(source.pulls, 2);
  assert.deepEqual(source.cancellations, ['payload_too_large']);
});

test('chunked JSON at the byte limit parses a multi-byte payload across chunks', async () => {
  const { app, env, repository } = fixture();
  const encoder = new TextEncoder();
  const prefix = '{"platform":"mobile","timezone":"Asia/Shanghai","clientVersion":"v-汉"}';
  const payload = `${prefix}${' '.repeat((128 * 1024) - encoder.encode(prefix).byteLength)}`;
  const bytes = encoder.encode(payload);
  const multiByteStart = encoder.encode('{"platform":"mobile","timezone":"Asia/Shanghai","clientVersion":"v-').byteLength;
  const { request, source } = chunkedJsonRequest('/api/notifications/devices', [
    bytes.subarray(0, multiByteStart + 1),
    bytes.subarray(multiByteStart + 1, multiByteStart + 2),
    bytes.subarray(multiByteStart + 2)
  ]);

  const response = await app.fetch(request, env);

  assert.equal(response.status, 201);
  assert.equal(repository.devices.length, 1);
  assert.deepEqual(source.cancellations, []);
});

test('Content-Length rejects oversized JSON without reading past Request prefetch', async () => {
  const { app, env } = fixture();
  const { request, source } = chunkedJsonRequest('/api/notifications/devices', [
    new Uint8Array(1),
    new Uint8Array(1)
  ], { 'Content-Length': String((128 * 1024) + 1) });

  const response = await app.fetch(request, env);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'payload_too_large');
  assert.equal(source.pulls, 1);
  assert.deepEqual(source.cancellations, []);
});

test('JSON reads report empty bodies, stream errors, and invalid UTF-8 as invalid JSON', async () => {
  const { app, env } = fixture();
  const empty = new Request('https://billnest.top/api/notifications/devices', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://billnest.top' }
  });
  assert.equal((await app.fetch(empty, env)).status, 400);

  const errored = chunkedJsonRequest('/api/notifications/devices', [new Error('stream failed')]);
  const erroredResponse = await app.fetch(errored.request, env);
  assert.equal(erroredResponse.status, 400);
  assert.equal((await erroredResponse.json()).error.code, 'invalid_json');

  const invalidUtf8 = chunkedJsonRequest('/api/notifications/devices', [new Uint8Array([0x22, 0xff, 0x22])]);
  const invalidUtf8Response = await app.fetch(invalidUtf8.request, env);
  assert.equal(invalidUtf8Response.status, 400);
  assert.equal((await invalidUtf8Response.json()).error.code, 'invalid_json');
});

function scheduledRepository(claimed) {
  const calls = [];
  return {
    calls,
    async releaseExpiredLeases(at) { calls.push(['releaseExpiredLeases', at]); return 1; },
    async expireStale(cutoff, at) { calls.push(['expireStale', cutoff, at]); return 2; },
    async claimDue(at, leaseUntil, limit) {
      calls.push(['claimDue', at, leaseUntil, limit]);
      return claimed.map((item) => ({ ...item, leaseUntil }));
    },
    async markSent(id, lease, at) { calls.push(['markSent', id, lease, at]); return true; },
    async markRetry(id, lease, retryAt, code, at) {
      calls.push(['markRetry', id, lease, retryAt, code, at]); return true;
    },
    async markFailed(id, lease, code, at) { calls.push(['markFailed', id, lease, code, at]); return true; },
    async invalidateSubscription(deviceId, at) { calls.push(['invalidateSubscription', deviceId, at]); return true; }
  };
}

function claimedReminder(id, attemptCount = 1, notifyAt = NOW.toISOString()) {
  return {
    id,
    deviceId: `device-${id}`,
    attemptCount,
    notifyAt,
    encryptedPayload: { v: 1, iv: `iv-${id}`, ciphertext: `cipher-${id}` },
    subscription: {
      endpoint: `https://push.example/${id}`,
      expirationTime: null,
      p256dh: 'a'.repeat(87),
      auth: 'b'.repeat(22)
    }
  };
}

test('scheduled delivery releases leases, expires stale rows, caps claims, and classifies outcomes', async () => {
  const claimed = [
    claimedReminder('sent'),
    claimedReminder('missing'),
    claimedReminder('gone'),
    claimedReminder('rate'),
    claimedReminder('internal'),
    claimedReminder('server'),
    claimedReminder('bad'),
    claimedReminder('exhausted', 4)
  ];
  const statuses = {
    sent: 201, missing: 404, gone: 410, rate: 429,
    internal: 500, server: 503, bad: 400, exhausted: 503
  };
  const repository = scheduledRepository(claimed);
  const pushes = [];
  const app = createNotificationApp({
    repository,
    sendPush: async (message) => {
      pushes.push(message);
      return { status: statuses[message.topic] };
    },
    now: () => new Date(NOW),
    crypto: webcrypto
  });

  const result = await app.runScheduled({});
  assert.equal(result.processed, claimed.length);
  assert.equal(pushes.length, claimed.length);
  assert.equal(repository.calls[0][0], 'releaseExpiredLeases');
  assert.deepEqual(repository.calls[1], [
    'expireStale',
    new Date(NOW.getTime() - 15 * 60 * 1000).toISOString(),
    NOW.toISOString()
  ]);
  const claimCall = repository.calls.find((call) => call[0] === 'claimDue');
  assert.equal(claimCall[3], 100);
  assert.equal(new Date(claimCall[2]).getTime() - NOW.getTime(), 5 * 60 * 1000);
  assert.ok(repository.calls.some((call) => call[0] === 'markSent' && call[1] === 'sent'));
  assert.ok(repository.calls.some((call) => call[0] === 'invalidateSubscription' && call[1] === 'device-gone'));
  assert.ok(repository.calls.some((call) => call[0] === 'invalidateSubscription' && call[1] === 'device-missing'));
  assert.ok(repository.calls.some((call) => call[0] === 'markFailed' && call[1] === 'gone'));
  assert.ok(repository.calls.some((call) => call[0] === 'markRetry' && call[1] === 'rate'));
  assert.ok(repository.calls.some((call) => call[0] === 'markRetry' && call[1] === 'internal'));
  assert.ok(repository.calls.some((call) => call[0] === 'markRetry' && call[1] === 'server'));
  assert.ok(repository.calls.some((call) => call[0] === 'markFailed' && call[1] === 'bad'));
  assert.ok(repository.calls.some((call) => call[0] === 'markFailed' && call[1] === 'exhausted'));
});

test('scheduled delivery handles transport errors and sends only rows returned by claimDue', async () => {
  const repository = scheduledRepository([claimedReminder('claimed')]);
  const app = createNotificationApp({
    repository,
    sendPush: async () => { throw new Error('network unavailable'); },
    now: () => new Date(NOW),
    crypto: webcrypto
  });
  const result = await app.runScheduled({});
  assert.equal(result.processed, 1);
  assert.ok(repository.calls.some((call) => call[0] === 'markRetry' && call[1] === 'claimed'));
  assert.equal(repository.calls.some((call) => call.includes('cancelled')), false);
});

test('scheduled retries derive Web Push TTL from the original notifyAt stale deadline', async () => {
  let current = new Date('2026-07-11T10:00:00.000Z');
  const originalNotifyAt = '2026-07-11T09:45:01.000Z';
  const repository = scheduledRepository([
    claimedReminder('near-stale', 1, originalNotifyAt)
  ]);
  const pushes = [];
  const app = createNotificationApp({
    repository,
    sendPush: async (message) => {
      pushes.push(message);
      return { status: 503 };
    },
    now: () => new Date(current),
    crypto: webcrypto
  });

  await app.runScheduled({});
  current = new Date('2026-07-11T10:00:00.500Z');
  await app.runScheduled({});

  assert.deepEqual(pushes.map((message) => message.ttlSeconds), [1, 1]);
  assert.equal(pushes.every((message) => message.encryptedPayload.ciphertext === 'cipher-near-stale'), true);
});
