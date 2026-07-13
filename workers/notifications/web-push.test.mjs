import assert from 'node:assert/strict';
import test from 'node:test';

import { sendWebPush } from './web-push.mjs';

test('sender builds an opaque 15-minute Web Push request', async () => {
  const encryptedPayload = { v: 1, iv: 'opaque-iv', ciphertext: 'opaque-ciphertext' };
  const subscription = {
    endpoint: 'https://push.example/subscription',
    expirationTime: null,
    p256dh: 'a'.repeat(87),
    auth: 'b'.repeat(22)
  };
  const buildCalls = [];
  const fetchCalls = [];
  const buildPayload = async (message, normalizedSubscription, vapid) => {
    buildCalls.push({ message, subscription: normalizedSubscription, vapid });
    return { method: 'POST', headers: { Authorization: 'vapid' }, body: 'wire-payload' };
  };
  const fetchImpl = async (endpoint, init) => {
    fetchCalls.push({ endpoint, init });
    return new Response('accepted', { status: 201 });
  };

  const result = await sendWebPush({
    subscription,
    encryptedPayload,
    topic: 'reminder-id',
    env: {
      VAPID_SUBJECT: 'mailto:ops@billnest.top',
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key'
    },
    fetchImpl,
    buildPayload
  });

  assert.deepEqual(buildCalls[0].message, {
    data: JSON.stringify(encryptedPayload),
    options: { ttl: 900, urgency: 'normal', topic: 'reminder-id' }
  });
  assert.deepEqual(buildCalls[0].subscription, {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth }
  });
  assert.deepEqual(buildCalls[0].vapid, {
    subject: 'mailto:ops@billnest.top', publicKey: 'public-key', privateKey: 'private-key'
  });
  assert.deepEqual(fetchCalls[0], {
    endpoint: subscription.endpoint,
    init: { method: 'POST', headers: { Authorization: 'vapid' }, body: 'wire-payload' }
  });
  assert.deepEqual(result, { status: 201, body: 'accepted' });
  assert.equal(buildCalls[0].message.data.includes('opaque-ciphertext'), true);
});

test('sender validates runtime dependencies without exposing secrets', async () => {
  await assert.rejects(
    sendWebPush({ subscription: null, encryptedPayload: {}, topic: 'test', env: {} }),
    /subscription/i
  );
});

test('sender accepts a validated remaining TTL and rejects values outside 0 through 900 seconds', async () => {
  const subscription = {
    endpoint: 'https://push.example/subscription',
    p256dh: 'a'.repeat(87),
    auth: 'b'.repeat(22)
  };
  const messages = [];
  const options = {
    subscription,
    encryptedPayload: { v: 1, iv: 'iv', ciphertext: 'ciphertext' },
    topic: 'ttl-test',
    ttlSeconds: 1,
    env: {
      VAPID_SUBJECT: 'mailto:ops@billnest.top',
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key'
    },
    buildPayload: async (message) => {
      messages.push(message);
      return { method: 'POST' };
    },
    fetchImpl: async () => new Response('', { status: 201 })
  };

  await sendWebPush(options);
  assert.equal(messages[0].options.ttl, 1);
  for (const ttlSeconds of [-1, 901, 1.5, NaN]) {
    await assert.rejects(sendWebPush({ ...options, ttlSeconds }), /TTL/i);
  }
});
