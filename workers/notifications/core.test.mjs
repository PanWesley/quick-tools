import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  allowedOrigin,
  classifyPushStatus,
  createDeviceCredentials,
  hashDeviceToken,
  json,
  parseBearer,
  retryAt,
  validateReminder,
  validateReminderBatch,
  validateSubscription
} from './core.mjs';

test('allowlists explicitly configured origins only', () => {
  const env = { ALLOWED_ORIGINS: 'https://billnest.top, https://www.billnest.top' };
  assert.equal(allowedOrigin(new Request('https://worker.test', {
    headers: { Origin: 'https://billnest.top' }
  }), env), 'https://billnest.top');
  assert.equal(allowedOrigin(new Request('https://worker.test', {
    headers: { Origin: 'https://evil.example' }
  }), env), null);
  assert.equal(allowedOrigin(new Request('https://billnest.top/api/notifications/config'), env), 'https://billnest.top');
  assert.equal(allowedOrigin(new Request('https://worker.test'), env), null);
});

test('bearer tokens never come from query strings', () => {
  const request = new Request('https://billnest.top/api/notifications/devices/id?token=leak', {
    headers: { Authorization: 'Bearer secret-token' }
  });
  assert.equal(parseBearer(request), 'secret-token');
  assert.equal(parseBearer(new Request('https://billnest.top/api?token=leak')), null);
  assert.equal(parseBearer(new Request('https://billnest.top/api', {
    headers: { Authorization: 'Basic secret-token' }
  })), null);
});

test('device credentials use UUIDs and 32 bytes of base64url token entropy', () => {
  const bytes = new Uint8Array(32).map((_, index) => index);
  const crypto = {
    randomUUID: () => '8b4d7156-b463-4e23-96ae-5caeed8ac8e1',
    getRandomValues: (target) => target.set(bytes)
  };
  const credentials = createDeviceCredentials(crypto);
  assert.match(credentials.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(credentials.deviceToken, 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
  assert.match(credentials.deviceToken, /^[A-Za-z0-9_-]{43}$/);
});

test('device token hashes use deterministic SHA-256 hex', async () => {
  const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  assert.equal(
    await hashDeviceToken(token, webcrypto),
    'ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0'
  );
  assert.equal(await hashDeviceToken(token, webcrypto), await hashDeviceToken(token, webcrypto));
});

test('subscriptions require HTTPS endpoints and valid push key lengths', () => {
  const subscription = {
    endpoint: 'https://push.example/subscription',
    expirationTime: null,
    keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }
  };
  assert.deepEqual(validateSubscription(subscription), {
    ok: true,
    value: {
      endpoint: subscription.endpoint,
      expirationTime: null,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }
  });
  assert.equal(validateSubscription({ ...subscription, endpoint: 'http://push.example/subscription' }).ok, false);
  assert.equal(validateSubscription({ ...subscription, endpoint: {
    toString: () => 'https://push.example/subscription'
  } }).ok, false);
  assert.equal(validateSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'not-a-key' } }).ok, false);
  assert.equal(validateSubscription({ ...subscription, plaintext: 'never accepted' }).ok, false);
});

test('validators reject exotic keys and prototypes but accept null-prototype objects', () => {
  const subscription = {
    endpoint: 'https://push.example/subscription',
    expirationTime: null,
    keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }
  };

  const symbolField = { ...subscription };
  symbolField[Symbol('plaintext')] = 'never accepted';
  assert.equal(validateSubscription(symbolField).ok, false);

  const hiddenField = { ...subscription };
  Object.defineProperty(hiddenField, 'plaintext', { value: 'never accepted' });
  assert.equal(validateSubscription(hiddenField).ok, false);

  const customPrototype = Object.assign(Object.create({ inherited: true }), subscription);
  assert.equal(validateSubscription(customPrototype).ok, false);

  const nullPrototype = Object.assign(Object.create(null), subscription, {
    keys: Object.assign(Object.create(null), subscription.keys)
  });
  assert.equal(validateSubscription(nullPrototype).ok, true);
});

test('reminders accept ciphertext but reject plaintext fields', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const valid = validateReminder({
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-07-11T10:30:00.000Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  }, now);
  assert.equal(valid.ok, true);
  assert.equal(validateReminder({ ...valid.value, title: 'plaintext' }, now).ok, false);
  assert.equal(validateReminder({ ...valid.value, encryptedPayload: {
    ...valid.value.encryptedPayload,
    body: 'plaintext'
  } }, now).ok, false);

  const hiddenPayload = { ...valid.value.encryptedPayload };
  Object.defineProperty(hiddenPayload, 'body', { value: 'plaintext' });
  assert.equal(validateReminder({ ...valid.value, encryptedPayload: hiddenPayload }, now).ok, false);
});

test('reminders reject schedules beyond the 31-day server envelope and non-integer revisions', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const reminder = {
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-08-11T10:00:00.001Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  };
  assert.equal(validateReminder(reminder, now).ok, false);
  assert.equal(validateReminder({ ...reminder, notifyAt: '2026-07-11T10:30:00.000Z', revision: 3.5 }, now).ok, false);
});

test('reminder validation envelope accepts the 721-hour New York fallback boundary but remains bounded at 31 days', () => {
  const now = new Date('2026-10-02T13:00:00.000Z');
  const reminder = {
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-11-01T14:00:00.000Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  };
  assert.equal(validateReminder(reminder, now).ok, true);
  assert.equal(validateReminder({
    ...reminder,
    notifyAt: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000 + 1).toISOString()
  }, now).ok, false);
});

test('reminders reject non-string notifyAt values without throwing', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const reminder = {
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-07-11T10:30:00.000Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  };

  for (const notifyAt of [Symbol('notifyAt'), 123]) {
    assert.doesNotThrow(() => {
      assert.deepEqual(validateReminder({ ...reminder, notifyAt }, now), {
        ok: false,
        code: 'invalid_reminder',
        message: 'Reminder time is outside the server validation envelope.'
      });
    });
  }
});

test('batch validation accepts at most 25 strict unique operations', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  const reminder = () => ({
    tool: 'time', sourceIdHash: 'a'.repeat(64), notifyAt: '2026-07-11T10:30:00.000Z',
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' }, encryptionVersion: 1, revision: 3
  });
  const valid = validateReminderBatch({ operations: [
    { kind: 'upsert', id: 'device-1:one', reminder: reminder() },
    { kind: 'cancel', id: 'device-1:two', revision: 4 }
  ] }, now);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.map((item) => item.kind), ['upsert', 'cancel']);

  assert.equal(validateReminderBatch({ operations: [] }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: Array.from({ length: 26 }, (_, index) => ({
    kind: 'cancel', id: `device-1:${index}`, revision: index
  })) }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: [
    { kind: 'cancel', id: 'duplicate', revision: 1 },
    { kind: 'cancel', id: 'duplicate', revision: 2 }
  ] }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: [
    { kind: 'cancel', id: 'one', revision: 1, plaintext: 'never accepted' }
  ] }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: [
    { kind: 'cancel', id: '', revision: 1 }
  ] }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: [
    { kind: 'upsert', id: 'one', reminder: { ...reminder(), title: 'never accepted' } }
  ] }, now).ok, false);
  assert.equal(validateReminderBatch({ operations: [
    { kind: 'cancel', id: 'one', revision: 1.5 }
  ] }, now).ok, false);
});

test('push status classification separates retryable and permanent failures', () => {
  assert.equal(classifyPushStatus(201), 'sent');
  assert.equal(classifyPushStatus(410), 'invalid_subscription');
  assert.equal(classifyPushStatus(503), 'retry');
  assert.equal(classifyPushStatus(429), 'retry');
  assert.equal(classifyPushStatus(400), 'failed');
});

test('retry delays are capped at one, five, and fifteen minutes', () => {
  const now = new Date('2026-07-11T10:00:00.000Z');
  assert.equal(retryAt(1, now).toISOString(), '2026-07-11T10:01:00.000Z');
  assert.equal(retryAt(2, now).toISOString(), '2026-07-11T10:05:00.000Z');
  assert.equal(retryAt(3, now).toISOString(), '2026-07-11T10:15:00.000Z');
  assert.equal(retryAt(4, now), null);
});

test('JSON responses include security and CORS headers without reflecting untrusted origins', async () => {
  const env = { ALLOWED_ORIGINS: 'https://billnest.top,https://www.billnest.top' };
  const response = json({ ok: true }, 201, 'https://billnest.top', env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://billnest.top');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(json({ ok: true }, 200, 'https://evil.example', env)
    .headers.has('access-control-allow-origin'), false);
  assert.equal(json({ ok: true }, 200, 'https://billnest.top')
    .headers.has('access-control-allow-origin'), false);
});
