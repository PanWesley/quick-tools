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
            Object.assign(reminder, { status: 'cancelled', updatedAt: at, leaseUntil: null });
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
      if (existing && reminder.revision === existing.revision) return { outcome: 'unchanged', reminder: existing };
      const next = { id, deviceId, ...structuredClone(reminder), status: 'pending', updatedAt: at };
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
      Object.assign(reminder, { revision, status: 'cancelled', updatedAt: at });
      return { outcome: 'cancelled', reminder };
    },

    async reconcile(deviceId, summaries, from, through) {
      this.lastReconcileFrom = from;
      this.lastReconcileThrough = through;
      const server = this.reminders.filter((item) => item.deviceId === deviceId
        && item.notifyAt <= through && item.status !== 'expired');
      const client = new Map(summaries.map((item) => [item.id, item.revision]));
      return {
        missing: summaries.filter((item) => !server.some((stored) => stored.id === item.id)).map((item) => item.id),
        stale: summaries.filter((item) => {
          const stored = server.find((candidate) => candidate.id === item.id);
          return stored && item.revision < stored.revision;
        }).map((item) => item.id),
        cancelled: server.filter((item) => item.status === 'cancelled' && client.has(item.id)).map((item) => item.id),
        unknown: server.filter((item) => !client.has(item.id) && item.status !== 'cancelled').map((item) => item.id)
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

function fixture({ sendPush } = {}) {
  const repository = createMemoryRepository();
  const pushes = [];
  const app = createNotificationApp({
    repository,
    sendPush: sendPush ?? (async (message) => {
      pushes.push(message);
      return { status: 201 };
    }),
    now: () => new Date(NOW),
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

test('reconcile compares bounded 30-day reminder summaries without payloads', async () => {
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
  const through = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
  assert.equal(context.repository.lastReconcileFrom, NOW.toISOString());
  assert.equal(context.repository.lastReconcileThrough, through);
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
  const oversized = { platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: 'x'.repeat(20_000) };
  assert.equal((await app.fetch(jsonRequest('/api/notifications/devices', 'POST', oversized), env)).status, 413);
  const evil = jsonRequest('/api/notifications/devices', 'POST', {
    platform: 'mobile', timezone: 'Asia/Shanghai', clientVersion: '0.7.0'
  }, undefined, { Origin: 'https://evil.example' });
  const rejected = await app.fetch(evil, env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.has('access-control-allow-origin'), false);
  assert.equal(repository.devices.length, 0);
});
