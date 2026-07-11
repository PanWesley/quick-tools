import { buildPushPayload } from '@block65/webcrypto-web-push';

const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function normalizeSubscription(subscription) {
  if (subscription?.keys) return subscription;
  return {
    endpoint: subscription?.endpoint,
    expirationTime: subscription?.expirationTime ?? null,
    keys: {
      p256dh: subscription?.p256dh,
      auth: subscription?.auth
    }
  };
}

export async function sendWebPush({
  subscription,
  encryptedPayload,
  topic,
  env,
  fetchImpl = globalThis.fetch,
  buildPayload = buildPushPayload
}) {
  if (!subscription || typeof subscription !== 'object'
    || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://')
    || typeof (subscription.keys?.p256dh ?? subscription.p256dh) !== 'string'
    || typeof (subscription.keys?.auth ?? subscription.auth) !== 'string') {
    throw new TypeError('Web Push subscription is invalid.');
  }
  if (!encryptedPayload || typeof encryptedPayload !== 'object') {
    throw new TypeError('Encrypted Web Push payload is invalid.');
  }
  if (!TOPIC_PATTERN.test(topic)) throw new TypeError('Web Push topic is invalid.');
  if (!env || typeof env.VAPID_SUBJECT !== 'string' || !env.VAPID_SUBJECT
    || typeof env.VAPID_PUBLIC_KEY !== 'string' || !env.VAPID_PUBLIC_KEY
    || typeof env.VAPID_PRIVATE_KEY !== 'string' || !env.VAPID_PRIVATE_KEY) {
    throw new TypeError('Web Push VAPID configuration is invalid.');
  }
  if (typeof fetchImpl !== 'function' || typeof buildPayload !== 'function') {
    throw new TypeError('Web Push transport is unavailable.');
  }
  const normalizedSubscription = normalizeSubscription(subscription);
  const requestInit = await buildPayload(
    {
      data: JSON.stringify(encryptedPayload),
      options: { ttl: 900, urgency: 'normal', topic }
    },
    normalizedSubscription,
    {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY
    }
  );
  const response = await fetchImpl(normalizedSubscription.endpoint, requestInit);
  return { status: response.status, body: await response.text() };
}
