# Time Notification Delivery Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make iOS background reminders show their real encrypted content, prevent foreground duplicate banners, and suppress stale foreground notifications.

**Architecture:** Add a portable AES-GCM key format whose raw bytes are stored as a bounded base64url string and imported independently by Window and Service Worker contexts. Deploy Worker support for encryption version 2 before the client, then share anonymous delivery receipts through Cache Storage so background and foreground delivery can deduplicate without exposing reminder content.

**Tech Stack:** Vanilla JavaScript, IndexedDB, Cache Storage, Web Crypto AES-GCM, Service Worker, Push API, Notifications API, Cloudflare Workers, D1, Node.js `node:test`, Wrangler 4.110.0.

## Global Constraints

- The Notifications Worker and D1 must never receive plaintext reminder title, body, notes, local AES key material, device token, PushSubscription keys, or endpoint logs.
- Encryption versions 1 and 2 use strict envelopes with exactly `v`, `iv`, and `ciphertext`; AES-GCM keeps a fresh 12-byte IV per encryption.
- New reminder payloads use `encryptionVersion: 2`; v1 remains readable during migration.
- Only future reminders may upgrade from v1 to v2 at equal item revision.
- Foreground banners have a 60-second lateness limit; older reminders use only the existing in-app expired toast.
- Delivery receipts contain only hashed tag identity, `shownAt`, and `scheduledAt`, and expire after 48 hours.
- Client HTTP, PushManager, Service Worker readiness, batch-size, lifecycle ownership, and Web Lock bounds from the previous recovery release must remain unchanged.
- Worker-first rollout is mandatory: production Worker v2 compatibility must precede PWA asset deployment.
- No D1 schema migration or new runtime dependency is allowed.

---

## File Map

- `workers/notifications/core.mjs`: validates strict v1/v2 encrypted reminder bodies.
- `workers/notifications/repository.mjs`: owns equal-revision encryption upgrade semantics.
- `workers/notifications/core.test.mjs`: covers accepted/rejected encryption versions.
- `workers/notifications/repository.test.mjs`: covers SQL upgrade and non-resurrection boundaries.
- `workers/notifications/app.test.mjs`: covers HTTP and batch v2 contracts.
- `tools/time/js/notification-crypto.js`: owns portable v2 key records, versioned key lookup, encryption, and decryption.
- `tools/time/js/notification-crypto.test.js`: covers key migration, cross-context import, and strict envelopes.
- `tools/time/js/notification-sync.js`: emits v2 payloads, orders queued crypto upgrades, and creates a valid encrypted test reminder.
- `tools/time/js/notification-sync.test.js`: covers queue tuple ordering, v2 transport, and test payload shape.
- `tools/time/js/notification-receipt.js`: new content-free Cache Storage receipt and failure-category module shared by Window and Service Worker.
- `tools/time/js/notification-receipt.test.js`: new deterministic receipt/cache tests.
- `tools/time/sw.js`: decrypts by envelope version, records delivery receipts, and classifies fallback failures.
- `tools/time/js/service-worker-notification.test.js`: covers v2 clear delivery, receipts, fallback categories, and privacy.
- `tools/time/js/notification.js`: applies receipt deduplication and 60-second freshness to foreground timers.
- `tools/time/js/notification.test.js`: covers delayed timer suppression and receipt-visible deduplication.
- `tools/time/index.html`: loads the new receipt helper and bumped client asset versions.
- `tools/time/js/notification-integration.test.js`: guards script order, privacy, and resume behavior.
- `tools/time/README.md`, `tools/time/CHANGELOG.md`, `workers/README.md`: document v2 migration, delivery receipts, and Worker-first deployment.

---

### Task 1: Notifications Worker Encryption V2 Compatibility

**Files:**
- Modify: `workers/notifications/core.test.mjs`
- Modify: `workers/notifications/core.mjs`
- Modify: `workers/notifications/repository.test.mjs`
- Modify: `workers/notifications/repository.mjs`
- Modify: `workers/notifications/app.test.mjs`

**Interfaces:**
- Consumes: existing `validateReminder(value, now)` and `repository.upsertReminder(deviceId, id, reminder, at)` contracts.
- Produces: validation for versions 1 and 2; equal-revision future-only v1-to-v2 repository upgrade.

- [ ] **Step 1: Add failing validator tests for encryption version 2**

Add explicit cases to `core.test.mjs`:

```js
const v2 = {
  tool: 'time',
  sourceIdHash: 'a'.repeat(64),
  notifyAt: '2026-07-11T10:30:00.000Z',
  encryptedPayload: { v: 2, iv: 'abc', ciphertext: 'def' },
  encryptionVersion: 2,
  revision: 3
};
assert.equal(validateReminder(v2, now).ok, true);
assert.equal(validateReminder({ ...v2, encryptionVersion: 3 }, now).ok, false);
assert.equal(validateReminder({ ...v2, encryptedPayload: { ...v2.encryptedPayload, v: 1 } }, now).ok, false);
```

- [ ] **Step 2: Run the validator test and verify RED**

Run:

```bash
node --test workers/notifications/core.test.mjs
```

Expected: FAIL because `encryptionVersion: 2` is rejected.

- [ ] **Step 3: Implement strict v1/v2 validation**

In `core.mjs`, replace the version-1-only check with:

```js
const ENCRYPTION_VERSIONS = new Set([1, 2]);

if (!Number.isSafeInteger(value.encryptionVersion)
  || !ENCRYPTION_VERSIONS.has(value.encryptionVersion)) {
  return failure('invalid_reminder', 'Reminder encryption version is invalid.');
}
```

Keep the existing exact envelope keys and `encryptedPayload.v === encryptionVersion` requirement.

- [ ] **Step 4: Run the validator test and verify GREEN**

Run the Step 2 command. Expected: all `core.test.mjs` tests pass.

- [ ] **Step 5: Add failing repository tests for equal-revision crypto upgrade**

Extend the repository test reminder helper to accept `encryptionVersion`, then assert:

```js
await repository.upsertReminder('device-1', 'future', reminder(4, '2026-07-11T10:30:00.000Z', 1), AT);
const upgraded = await repository.upsertReminder(
  'device-1', 'future', reminder(4, '2026-07-11T10:30:00.000Z', 2), AT
);
assert.equal(upgraded.outcome, 'updated');
assert.equal(upgraded.reminder.encryptionVersion, 2);
```

Add separate assertions proving equal-revision v2 does not upgrade rows that are past, `sent`, `expired`, or user-cancelled; v2-to-v1 downgrade and equal-version replay remain unchanged.

- [ ] **Step 6: Run the repository test and verify RED**

Run:

```bash
node --test workers/notifications/repository.test.mjs
```

Expected: FAIL because equal revision currently updates only `subscription_disabled` rows.

- [ ] **Step 7: Implement the future-only encryption upgrade SQL**

Extend the `ON CONFLICT ... WHERE` expression in `repository.mjs` with:

```sql
OR (
  excluded.revision = reminders.revision
  AND excluded.encryption_version > reminders.encryption_version
  AND excluded.notify_at > excluded.updated_at
  AND reminders.status IN ('pending', 'retry', 'failed')
)
```

Use `excluded.updated_at` as the authenticated server `at` value already bound by `upsertReminder()`. Do not include `sent`, `expired`, or ordinary `cancelled` states.

- [ ] **Step 8: Add HTTP and batch v2 contract coverage**

In `app.test.mjs`, send one v2 single upsert and a mixed v1/v2 batch. Assert `200`, unchanged result ordering, exact revision acknowledgements, and no plaintext fields accepted.

```js
const v2Reminder = reminder(8);
v2Reminder.encryptionVersion = 2;
v2Reminder.encryptedPayload = { v: 2, iv: 'abc', ciphertext: 'def' };
const single = await context.app.fetch(
  jsonRequest('/api/notifications/reminders/v2', 'PUT', v2Reminder, credentials.deviceToken),
  context.env
);
assert.equal(single.status, 200);

const batch = await context.app.fetch(jsonRequest('/api/notifications/reminders/batch', 'POST', {
  operations: [
    { kind: 'upsert', id: 'v1', reminder: reminder(7) },
    { kind: 'upsert', id: 'v2', reminder: v2Reminder }
  ]
}, credentials.deviceToken), context.env);
assert.equal(batch.status, 200);
assert.deepEqual((await batch.json()).results.map(result => result.id), ['v1', 'v2']);
```

- [ ] **Step 9: Run the complete Worker suite**

Run:

```bash
cd workers/notifications
node --disable-warning=ExperimentalWarning --test *.test.mjs
```

Expected: 0 failures.

- [ ] **Step 10: Commit Worker compatibility**

```bash
git add workers/notifications/core.mjs workers/notifications/core.test.mjs \
  workers/notifications/repository.mjs workers/notifications/repository.test.mjs \
  workers/notifications/app.test.mjs
git commit -m "feat(notifications): accept encrypted payload version two"
```

---

### Task 2: Portable AES Key Format V2

**Files:**
- Modify: `tools/time/js/notification-crypto.test.js`
- Modify: `tools/time/js/notification-crypto.js`

**Interfaces:**
- Consumes: existing IndexedDB `secrets` store and base64url helpers.
- Produces: `CURRENT_ENCRYPTION_VERSION`, `getKey(version)`, `getOrCreateKey()`, `encryptPayload(key, value, version)`, and `decryptPayload(key, envelope)`.

- [ ] **Step 1: Write failing v2 storage and cross-context tests**

Update the fake IndexedDB test harness to inspect stored values. Add tests that require:

```js
const firstStore = cryptoApi.create({ crypto: webcrypto, indexedDB });
const firstKey = await firstStore.getOrCreateKey();
const persisted = indexedDB.dump('todayYouxuNotificationDB', 'secrets').get('payload-key-v2');

assert.deepEqual(Object.keys(persisted).sort(), ['algorithm', 'rawKey', 'version']);
assert.equal(persisted.version, 2);
assert.equal(persisted.algorithm, 'AES-GCM');
assert.equal(cryptoApi.base64UrlDecode(persisted.rawKey).length, 32);
assert.equal(typeof persisted.rawKey, 'string');
assert.equal(firstKey.extractable, false);

const workerStore = cryptoApi.create({ crypto: webcrypto, indexedDB });
const workerKey = await workerStore.getKey(2);
const envelope = await cryptoApi.encryptPayload(firstKey, { title: '吃饭' }, 2);
assert.deepEqual(await cryptoApi.decryptPayload(workerKey, envelope), { title: '吃饭' });
```

Also require concurrent stores to select one persisted v2 winner, retain `payload-key-v1`, reject malformed v2 records, and reject envelope versions outside 1/2.

- [ ] **Step 2: Run crypto tests and verify RED**

Run:

```bash
node --test tools/time/js/notification-crypto.test.js
```

Expected: FAIL because only a v1 `CryptoKey` record exists.

- [ ] **Step 3: Implement v2 record validation and import**

Add constants and helpers:

```js
var CURRENT_ENCRYPTION_VERSION = 2;
var LEGACY_KEY_ID = 'payload-key-v1';
var CURRENT_KEY_ID = 'payload-key-v2';

function validateV2Record(value) {
  if (!value || value.version !== 2 || value.algorithm !== 'AES-GCM'
    || typeof value.rawKey !== 'string') throw new Error('Notification key record is invalid');
  var bytes = base64UrlDecode(value.rawKey);
  if (bytes.length !== 32) throw new Error('Notification key record is invalid');
  return bytes;
}

function importAesKey(cryptoApi, bytes) {
  return cryptoApi.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
```

`getOrCreateKey()` generates 32 random bytes, attempts `addRecord()` for `payload-key-v2`, reads the winner on constraint, validates it, and imports it. It must not overwrite or delete `payload-key-v1`.

- [ ] **Step 4: Implement versioned lookup and envelopes**

`getKey(version)` behaves as follows:

```js
if (version === 2) return import the validated payload-key-v2 record or null;
if (version === 1) return the legacy CryptoKey record or null;
return null;
```

`encryptPayload(key, value, version)` defaults to version 2 and writes that version to the envelope. `decryptPayload()` strictly accepts versions 1 and 2 while keeping exact-key, IV-length, ciphertext-length, and tamper checks.

- [ ] **Step 5: Run crypto tests and verify GREEN**

Run the Step 2 command. Expected: all crypto tests pass with no key material in output.

- [ ] **Step 6: Commit portable crypto storage**

```bash
git add tools/time/js/notification-crypto.js tools/time/js/notification-crypto.test.js
git commit -m "fix(time): make notification keys portable across contexts"
```

---

### Task 3: V2 Client Transport And Queue Ordering

**Files:**
- Modify: `tools/time/js/notification-sync.test.js`
- Modify: `tools/time/js/notification-sync.js`

**Interfaces:**
- Consumes: `notificationCrypto.CURRENT_ENCRYPTION_VERSION === 2`, `getOrCreateKey()`, and `encryptPayload(key, value, 2)`.
- Produces: queued reminder entries with `(version, encryptionVersion)` tuple semantics and strict v2 test payloads.

- [ ] **Step 1: Add failing queue-upgrade tests**

Create a failed or terminal v1 queue entry at item revision 7, then sync the same reminder under v2:

```js
await harness.sync.sync({ reminders: [record({ revision: 7 })] }, '2026-07-15');
const legacy = harness.queueFor('reminder:device-1:record-1');
legacy.encryptionVersion = 1;
legacy.terminal = true;
legacy.attempts = 5;

await harness.sync.sync({ reminders: [record({ revision: 7 })] }, '2026-07-15');
const upgraded = harness.queueFor('reminder:device-1:record-1');
assert.equal(upgraded.version, 7);
assert.equal(upgraded.encryptionVersion, 2);
assert.equal(upgraded.terminal, false);
assert.equal(upgraded.attempts, 0);
```

Add cases proving higher revision wins regardless of encryption version, lower revision cannot replace a newer entry, and legacy entries without `encryptionVersion` are treated as v1.

- [ ] **Step 2: Add a failing encrypted test-reminder shape assertion**

Call `sendTest()` and decrypt the submitted envelope with the v2 key. Require exact payload keys:

```js
assert.deepEqual(Object.keys(plain).sort(), ['body', 'data', 'scheduledAt', 'tag', 'title', 'v']);
assert.equal(plain.v, 1);
assert.equal(plain.title, '测试提醒');
assert.equal(plain.body, '后台提醒已连接');
assert.deepEqual(Object.keys(plain.data).sort(), ['date', 'id', 'type', 'url']);
```

This test captures the current bug where `sendTest()` encrypts only `title` and `body`, which the Service Worker must reject.

- [ ] **Step 3: Run sync tests and verify RED**

Run:

```bash
node --test tools/time/js/notification-sync.test.js
```

Expected: FAIL on v2 queue activation and strict test payload shape.

- [ ] **Step 4: Implement tuple comparison**

Add queue helpers:

```js
function encryptionVersionOf(value) {
  return Number.isSafeInteger(value) ? value : 1;
}

function compareIntentVersion(left, right) {
  if (left.version !== right.version) return left.version - right.version;
  return encryptionVersionOf(left.encryptionVersion) - encryptionVersionOf(right.encryptionVersion);
}
```

Persist `entry.encryptionVersion`. Use tuple comparison for reminder `upsert` entries only; subscription, cancel, disable, and reconcile ordering retain existing behavior. Treat an exact tuple as `sameIntent`; a higher encryption version resets attempts, retry time, and terminal state.

- [ ] **Step 5: Emit encryption version 2**

In reminder sync and `sendTestImpl()`:

```js
var encryptionVersion = notificationCrypto.CURRENT_ENCRYPTION_VERSION;
var key = await notificationCrypto.getOrCreateKey();
var encryptedPayload = await notificationCrypto.encryptPayload(key, payload, encryptionVersion);
```

Send `encryptionVersion` in the API body and queue metadata.

- [ ] **Step 6: Build a strict test payload before encryption**

Use the injected `now()` clock:

```js
var scheduledAt = new Date(now()).toISOString();
var testPayload = {
  title: '测试提醒',
  body: '后台提醒已连接',
  tag: 'today-youxu-test:' + now(),
  data: {
    type: 'task',
    id: 'notification-test',
    date: scheduledAt.slice(0, 10),
    url: '/tools/time/#today'
  },
  scheduledAt: scheduledAt,
  v: 1
};
```

The outer encrypted envelope and API body use encryption version 2. The decrypted notification content keeps its independent schema marker `v: 1`, matching `notification-model.js` and Service Worker payload validation.

Keep the public `sendTest()` API argument-free so app code cannot supply plaintext fields directly.

- [ ] **Step 7: Run sync tests and verify GREEN**

Run the Step 3 command. Expected: all sync tests pass.

- [ ] **Step 8: Commit client v2 transport**

```bash
git add tools/time/js/notification-sync.js tools/time/js/notification-sync.test.js
git commit -m "fix(time): migrate notification sync to encrypted payload v2"
```

---

### Task 4: Anonymous Delivery Receipt Module

**Files:**
- Create: `tools/time/js/notification-receipt.js`
- Create: `tools/time/js/notification-receipt.test.js`

**Interfaces:**
- Consumes: Cache Storage, Web Crypto SHA-256, and an injectable `now()`.
- Produces: `create(options)`, `has(tag)`, `record(tag, scheduledAt)`, `clearExpired()`, `recordFailure(code)`, `getFailure()`, and `clearFailure()`.

- [ ] **Step 1: Write failing receipt tests**

Build a fake Cache Storage implementation and require:

```js
const receipts = Receipt.create({ caches, crypto: webcrypto, now: () => NOW });
assert.equal(await receipts.has('task:private-id:123'), false);
await receipts.record('task:private-id:123', NOW - 1000);
assert.equal(await receipts.has('task:private-id:123'), true);
assert.doesNotMatch(JSON.stringify(caches.dump()), /private-id|task:/);

clock = NOW + (48 * 60 * 60 * 1000) + 1;
await receipts.clearExpired();
assert.equal(await receipts.has('task:private-id:123'), false);
```

Add tests that only the five allowed failure categories are stored, failure records contain only `code` and `at`, successful clear removes the record, malformed cache entries are treated as absent, and unavailable Cache Storage fails open without throwing into notification delivery.

- [ ] **Step 2: Run receipt tests and verify RED**

Run:

```bash
node --test tools/time/js/notification-receipt.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the UMD receipt module**

Follow existing browser/CommonJS module style. Hash tags before building cache keys:

```js
async function tagHash(tag) {
  var bytes = new TextEncoderApi().encode(String(tag));
  var digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(function(byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}
```

Use cache name `today-youxu-notification-receipts-v1` and same-origin synthetic paths under `/tools/time/__notification_receipt__/`. Store JSON responses with exact numeric `shownAt` and `scheduledAt`; validate on every read. Catch Cache API errors and return `false`/`null` rather than blocking notification display.

- [ ] **Step 4: Implement bounded failure diagnostics**

Use one fixed synthetic cache key and this allowlist:

```js
var FAILURE_CODES = new Set([
  'missing_data', 'missing_key', 'invalid_envelope', 'decrypt_failed', 'invalid_payload'
]);
```

Reject unknown codes without storing them. Never accept an error object or arbitrary message.

- [ ] **Step 5: Run receipt tests and verify GREEN**

Run the Step 2 command. Expected: all receipt tests pass.

- [ ] **Step 6: Commit the receipt module**

```bash
git add tools/time/js/notification-receipt.js tools/time/js/notification-receipt.test.js
git commit -m "feat(time): share anonymous notification delivery receipts"
```

---

### Task 5: Service Worker V2 Delivery And Failure Classification

**Files:**
- Modify: `tools/time/js/service-worker-notification.test.js`
- Modify: `tools/time/sw.js`

**Interfaces:**
- Consumes: `TodayYouxuNotificationCrypto.getKey(version)`, strict envelope `v`, and `TodayYouxuNotificationReceipt`.
- Produces: clear v2 notifications, background receipts, and bounded fallback failure categories.

- [ ] **Step 1: Add failing v2 push and receipt tests**

Update the Service Worker harness to load the receipt module. Encrypt `VALID_PAYLOAD` with v2 and assert:

```js
await push(harness, JSON.stringify(envelopeV2));
assert.equal(harness.shown[0].title, VALID_PAYLOAD.title);
assert.equal(harness.shown[0].options.body, VALID_PAYLOAD.body);
assert.equal(await harness.receipts.has(VALID_PAYLOAD.tag), true);
```

Add tests that an existing receipt suppresses display, receipt-write failure does not reject after one display, and a second identical push displays nothing.

- [ ] **Step 2: Add failing fallback classification tests**

Exercise missing data, no key, malformed envelope, decrypt failure, and invalid decrypted shape. Assert generic copy plus the exact allowed category, and assert serialized console/cache diagnostics do not contain title, body, ID, URL, IV, ciphertext, or key data.

- [ ] **Step 3: Run Service Worker tests and verify RED**

Run:

```bash
node --test tools/time/js/service-worker-notification.test.js
```

Expected: FAIL because the Service Worker reads only the unversioned legacy key and has no receipt integration.

- [ ] **Step 4: Import versioned helpers and classify errors explicitly**

At the top of `sw.js`:

```js
importScripts(
  '/tools/time/js/notification-crypto.js?v=2',
  '/tools/time/js/notification-receipt.js?v=1'
);
```

Split the current broad `try/catch` into stages. Parse a strict envelope first, read `envelope.v`, call `getKey(envelope.v)`, decrypt, then validate. Each stage sets only one allowlisted failure code. Do not log caught errors.

- [ ] **Step 5: Add receipt-aware display**

For validated payloads:

```js
if (await receipts.has(payload.tag)) return;
await showNotificationOnce(payload);
await receipts.record(payload.tag, Date.parse(payload.scheduledAt)).catch(function() {});
await receipts.clearFailure().catch(function() {});
```

Keep `registration.getNotifications({ tag })` as an additional guard. Generic fallback keeps its generic tag and calls `recordFailure(code)` best-effort, but does not create a reminder-specific receipt.

- [ ] **Step 6: Run Service Worker tests and verify GREEN**

Run the Step 3 command. Expected: all Service Worker notification tests pass.

- [ ] **Step 7: Commit Service Worker delivery**

```bash
git add tools/time/sw.js tools/time/js/service-worker-notification.test.js
git commit -m "fix(time): show decrypted v2 background reminders"
```

---

### Task 6: Foreground Deduplication And Freshness

**Files:**
- Modify: `tools/time/js/notification.test.js`
- Modify: `tools/time/js/notification.js`
- Modify: `tools/time/js/notification-integration.test.js`

**Interfaces:**
- Consumes: shared `NotificationReceipt.has(tag)`, `registration.getNotifications({ tag })`, and existing local notification log.
- Produces: asynchronous receipt-aware `fireNotification()` and a strict 60-second foreground lateness rule.

- [ ] **Step 1: Add failing stale-timer tests**

Use fake timers and clock control to cover both entry paths:

```js
service.scheduleAll(data, todayKey, dueChecker);
clock.advance(9 * 60 * 1000);
timers.runDue();
assert.equal(shown.length, 0);
```

Add one case where app launch occurs after `notifyTime` and before task `dueTime`; assert no two-second timer is created. Add boundary cases at 60,000 ms late (allowed) and 60,001 ms late (suppressed).

- [ ] **Step 2: Add failing receipt and visible-tag dedup tests**

Inject a receipt module returning `true` for the notification tag and assert no Notification API call. Repeat with `registration.getNotifications({ tag })` returning a visible notification. In both cases assert the page log is marked so repeated periodic checks remain suppressed.

- [ ] **Step 3: Run foreground tests and verify RED**

Run:

```bash
node --test tools/time/js/notification.test.js tools/time/js/notification-integration.test.js
```

Expected: FAIL because negative delays are converted to two seconds and foreground delivery does not consult receipts.

- [ ] **Step 4: Remove late catch-up scheduling**

Add:

```js
var FOREGROUND_LATE_GRACE_MS = 60 * 1000;

function isFreshNotification(notifyTime, now) {
  var lateness = now.getTime() - notifyTime.getTime();
  return lateness <= FOREGROUND_LATE_GRACE_MS;
}
```

In `scheduleOne()`, return immediately for any negative initial delay. In the timer callback, compare the real current clock to the original `notifyTime`; skip display if more than 60 seconds late. Do not replace `notifyTime` with a new time.

- [ ] **Step 5: Make foreground display receipt-aware**

Before `showNotification()`:

```js
var delivered = await notificationReceipt.has(tagKey);
var visible = swRegistration && swRegistration.getNotifications
  ? await swRegistration.getNotifications({ tag: tagKey }).catch(function() { return []; })
  : [];
if (delivered || visible.length) {
  markNotified(logKey);
  return;
}
```

After a successful foreground display, mark the local log and best-effort record the shared receipt. Preserve existing fallback between direct Notification and registration display.

- [ ] **Step 6: Inject the receipt module from app startup**

Extend the existing UMD factory seam directly; no `app.js` change is needed:

```js
if (typeof module === 'object' && module.exports) {
  module.exports = factory(require('./notification-model'), require('./notification-receipt'));
} else {
  root.TodayYouxuNotification = factory(
    root.TodayYouxuNotificationModel,
    root.TodayYouxuNotificationReceipt
  );
}
```

Inside the factory, fall back to a no-op receipt object whose `has()` resolves `false` and whose `record()` resolves without throwing. Missing Cache Storage must not reject refresh, task CRUD, or notification scheduling.

- [ ] **Step 7: Run foreground tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests pass, including the nine-minute resume reproduction.

- [ ] **Step 8: Commit foreground behavior**

```bash
git add tools/time/js/notification.js tools/time/js/notification.test.js \
  tools/time/js/notification-integration.test.js
git commit -m "fix(time): suppress duplicate and stale foreground reminders"
```

---

### Task 7: Asset Rollout, Documentation, And Full Verification

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/sw.js`
- Modify: `tools/time/js/service-worker-notification.test.js`
- Modify: `tools/time/js/notification-integration.test.js`
- Modify: `tools/time/README.md`
- Modify: `tools/time/CHANGELOG.md`
- Modify: `workers/README.md`

**Interfaces:**
- Consumes: all Tasks 1-6 production modules.
- Produces: cache-coherent PWA assets, deployment instructions, and release evidence.

- [ ] **Step 1: Add failing cache-order integration assertions**

Require exact order in `index.html` and `APP_SHELL`:

```text
notification-crypto.js?v=2
notification-receipt.js?v=1
notification-model.js?v=2
notification-sync.js?v=4
notification.js?v=7
app.js?v=138
```

Require `CACHE_NAME = 'today-youxu-v32'` and both notification helpers in `importScripts()`.

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```bash
node --test tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js
```

Expected: FAIL on old query versions/cache name and missing receipt script.

- [ ] **Step 3: Update PWA asset versions and cache**

Apply the exact versions from Step 1 in `index.html` and `sw.js`. Keep `/api/notifications` network-only and preserve cache-first shell behavior.

- [ ] **Step 4: Document migration and operations**

Document these exact behaviors:

- v2 raw key is local-only and imported as non-extractable AES-GCM in each context;
- v1 key remains during migration;
- future reminders re-encrypt automatically without user action;
- receipts contain no reminder content and expire in 48 hours;
- foreground banners expire after 60 seconds;
- generic fallback means a local decrypt/validation problem, not proof that the Worker failed;
- Worker v2 must deploy before PWA assets;
- no D1 schema migration is required.

Do not place real device IDs, endpoints, tokens, keys, payloads, or production reminder rows in docs.

- [ ] **Step 5: Run all Time tests**

Run:

```bash
node --test tools/time/js/*.test.js
```

Expected: 0 failures and a test count greater than the 168-test baseline.

- [ ] **Step 6: Run all Worker tests and dry-run**

Run:

```bash
cd workers/notifications
node --disable-warning=ExperimentalWarning --test *.test.mjs
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  ./node_modules/.bin/wrangler deploy --dry-run
```

Expected: 0 test failures and Wrangler dry-run exit 0 with `NOTIFICATIONS_DB` binding.

- [ ] **Step 7: Run static privacy and syntax checks**

Run:

```bash
node --check tools/time/js/notification-crypto.js
node --check tools/time/js/notification-receipt.js
node --check tools/time/js/notification-sync.js
node --check tools/time/js/notification.js
node --check tools/time/sw.js
git diff --check origin/main...HEAD
rg -n "console\.(log|warn|error).*?(payload|ciphertext|deviceToken|endpoint|rawKey)" \
  tools/time workers/notifications
```

Expected: syntax and diff checks exit 0; privacy scan has no production logging of protected values.

- [ ] **Step 8: Perform browser QA**

Start the existing static site server on a free local port. In desktop Chromium and a 390x844 mobile viewport, verify:

- app shell and update UI load without console errors;
- test reminder decrypts to `测试提醒 / 后台提醒已连接` in the Service Worker harness;
- duplicate receipt suppresses a foreground notification;
- delayed timer produces only `有 1 项提醒已过期` in-app;
- no layout overflow or notification status overlap appears.

Record screenshots outside tracked source directories unless they are intentionally added as test evidence.

- [ ] **Step 9: Commit release metadata**

```bash
git add tools/time/index.html tools/time/sw.js \
  tools/time/js/notification-integration.test.js tools/time/js/service-worker-notification.test.js \
  tools/time/README.md tools/time/CHANGELOG.md workers/README.md
git commit -m "docs(time): document clear encrypted notification delivery"
```

- [ ] **Step 10: Request code review before publication**

Review the complete branch against the accepted design, with findings ordered by severity. Resolve all Critical and Important findings, rerun Steps 5-7, and verify `git status --short` is clean.

---

## Production Release Checklist

These actions happen only after implementation review and PR approval.

- [ ] Deploy the Worker from `workers/notifications/` and record the returned version ID.
- [ ] Verify `GET https://billnest.top/api/notifications/config` and the `www` route return `200` with only protocol version and VAPID public key.
- [ ] Verify `wrangler deployments list`, remote D1 migration list, both routes, and minute Cron.
- [ ] Merge the PWA PR only after Worker deployment succeeds.
- [ ] Wait for Vercel production deployment and verify `today-youxu-v32` assets are served.
- [ ] On iOS 26.5 Home Screen PWA, open once to migrate and sync, then create a new reminder at least three minutes ahead.
- [ ] Close the PWA, confirm the background banner contains the real title/body, wait more than 60 seconds, reopen, and confirm no second system banner appears.
- [ ] Repeat clear background delivery on Android Chromium PWA and desktop Chromium.
