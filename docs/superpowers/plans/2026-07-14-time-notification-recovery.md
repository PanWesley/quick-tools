# Time Notification Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the Time PWA from remaining indefinitely in “正在连接” and reduce first-sync reminder traffic with a bounded encrypted batch API.

**Architecture:** Keep the existing IndexedDB queue, revision idempotency, Web Push delivery, and Web Lock serialization. Make lock acquisition non-blocking, add abortable deadlines at browser boundaries, drain only one bounded batch per lock acquisition, and let visible/online recovery request subsequent batches. Add a backwards-compatible Worker batch route while retaining single-reminder endpoints as a 404/405 fallback.

**Tech Stack:** Vanilla JavaScript, IndexedDB, Web Locks, AbortController, Service Worker, Push API, Node.js `node:test`, Cloudflare Workers, D1, Wrangler 4.110.0.

## Global Constraints

- The PWA, page, and browser process must not be required to remain alive in the background.
- HTTP timeout is 15 seconds, Service Worker ready timeout is 10 seconds, and PushSubscription timeout is 20 seconds.
- A busy lifecycle Web Lock returns `pending` immediately through `ifAvailable`; it never queues an unbounded UI wait.
- Batch requests contain at most 25 operations and remain below the existing 128 KiB request limit.
- Only 404 and 405 disable batch transport for the current JavaScript session; other failures preserve normal retry/error semantics.
- AES-GCM keys remain client-only; no plaintext reminder title/body, device token, endpoint, PushSubscription keys, VAPID secret, or encrypted payload may be logged.
- Existing 30-local-calendar-day projection, 31-day server envelope, 15-minute stale deadline, revision semantics, and Analytics separation remain unchanged.

## File Map

- `workers/notifications/core.mjs`: strict batch body validation using existing reminder and revision validators.
- `workers/notifications/core.test.mjs`: batch validation boundaries and exact-key tests.
- `workers/notifications/app.mjs`: authenticated `/reminders/batch` routing and per-operation result mapping.
- `workers/notifications/app.test.mjs`: HTTP contract, all-before-write validation, mixed batch results, CORS and method handling.
- `tools/time/js/notification-sync.js`: deadlines, active-request cancellation, non-blocking locks, one-batch queue draining, batch fallback.
- `tools/time/js/notification-sync.test.js`: deterministic lock, timeout, cancellation, batching, fallback, and recovery tests.
- `tools/time/js/app.js`: Service Worker ready deadline and visible foreground drain scheduling.
- `tools/time/js/notification-integration.test.js`: app lifecycle and status regression tests.
- `tools/time/index.html`, `tools/time/sw.js`: cache-version bumps for changed notification assets.
- `workers/README.md`: batch endpoint and production verification notes.

---

### Task 1: Worker Batch Contract

**Files:**
- Modify: `workers/notifications/core.mjs`
- Modify: `workers/notifications/core.test.mjs`
- Modify: `workers/notifications/app.mjs`
- Modify: `workers/notifications/app.test.mjs`

**Interfaces:**
- Produces: `validateReminderBatch(value, now) -> { ok: true, value: Operation[] } | { ok: false, code, message }`.
- Produces: `POST /api/notifications/reminders/batch` with `{ operations: Operation[] }` and `{ results: Result[] }`.
- `Operation` is `{ kind: 'upsert', id, reminder }` or `{ kind: 'cancel', id, revision }`.
- `Result` is `{ id, outcome: 'applied' | 'stale' | 'unknown', revision }`.

- [ ] **Step 1: Write failing core validation tests**

Add focused tests proving one valid mixed batch is normalized and that empty, 26-item, duplicate-ID, extra-key, invalid-ID, invalid reminder, and invalid revision bodies fail:

```js
test('batch validation accepts at most 25 strict unique operations', () => {
  const valid = validateReminderBatch({ operations: [
    { kind: 'upsert', id: 'device-1:one', reminder: reminder() },
    { kind: 'cancel', id: 'device-1:two', revision: 4 }
  ] }, new Date(AT));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.map(item => item.kind), ['upsert', 'cancel']);

  assert.equal(validateReminderBatch({ operations: [] }, new Date(AT)).ok, false);
  assert.equal(validateReminderBatch({ operations: Array.from({ length: 26 }, (_, i) => ({
    kind: 'cancel', id: `device-1:${i}`, revision: i
  })) }, new Date(AT)).ok, false);
});
```

- [ ] **Step 2: Run the core test and verify RED**

Run: `node --test workers/notifications/core.test.mjs`

Expected: FAIL because `validateReminderBatch` is not exported.

- [ ] **Step 3: Implement strict batch validation**

Add `MAX_BATCH_OPERATIONS = 25`, reuse `isObject`, `hasOnlyKeys`, `validateReminder`, and the existing revision rules, reject duplicate IDs, and return normalized operations only after every item passes:

```js
export function validateReminderBatch(value, now) {
  if (!isObject(value) || !hasOnlyKeys(value, ['operations'])
    || !Array.isArray(value.operations)
    || value.operations.length < 1
    || value.operations.length > 25) {
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
```

- [ ] **Step 4: Run the core test and verify GREEN**

Run: `node --test workers/notifications/core.test.mjs`

Expected: all core tests PASS.

- [ ] **Step 5: Write failing HTTP tests**

Add tests that authenticate a mixed batch, assert all inputs are validated before repository calls, and assert route/preflight/media-type behavior:

```js
test('batch applies mixed reminders only after complete validation', async () => {
  const context = createContext();
  const credentials = await register(context);
  const response = await context.app.fetch(jsonRequest('/api/notifications/reminders/batch', 'POST', {
    operations: [
      { kind: 'upsert', id: 'one', reminder: reminder(2) },
      { kind: 'cancel', id: 'missing', revision: 3 }
    ]
  }, credentials.deviceToken), context.env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results.map(item => item.outcome), ['applied', 'unknown']);
});
```

- [ ] **Step 6: Run the HTTP test and verify RED**

Run: `node --test workers/notifications/app.test.mjs`

Expected: FAIL with batch route 404.

- [ ] **Step 7: Implement the authenticated batch route**

Add the route before the parameterized reminder route, parse and validate the complete body, then execute normalized operations in order:

```js
if (pathname === '/api/notifications/reminders/batch') {
  return { name: 'reminder-batch', methods: ['POST'] };
}

if (route.name === 'reminder-batch') {
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);
  const validated = validateReminderBatch(body.value, at);
  if (!validated.ok) return errorResponse(validated.code, validated.message, 400, origin, env);
  const results = [];
  for (const operation of validated.value) {
    const result = operation.kind === 'upsert'
      ? await repository.upsertReminder(device.id, operation.id, operation.reminder, at.toISOString())
      : await repository.cancelReminder(device.id, operation.id, operation.revision, at.toISOString());
    results.push({
      id: operation.id,
      outcome: result.outcome === 'conflict' ? 'stale'
        : result.outcome === 'missing' ? 'unknown' : 'applied',
      revision: result.reminder?.revision ?? operation.revision ?? operation.reminder.revision
    });
  }
  return json({ results }, 200, origin, env);
}
```

- [ ] **Step 8: Run Worker tests and commit**

Run: `cd workers/notifications && pnpm test`

Expected: all Worker tests PASS.

Commit:

```bash
git add workers/notifications/core.mjs workers/notifications/core.test.mjs \
  workers/notifications/app.mjs workers/notifications/app.test.mjs
git commit -m "feat(notifications): add encrypted reminder batches"
```

---

### Task 2: Client Deadlines and Non-blocking Lock

**Files:**
- Modify: `tools/time/js/notification-sync.js`
- Modify: `tools/time/js/notification-sync.test.js`

**Interfaces:**
- New create options: `requestTimeoutMs`, `subscriptionTimeoutMs`, `AbortController`, `setTimer`, `clearTimer`.
- Produces: `cancelActiveRequests()` lifecycle method.
- Changes every lifecycle lock request to `{ ifAvailable: true }` and returns `{ status: 'pending' }` when no lock is granted.

- [ ] **Step 1: Upgrade the fake LockManager and write a busy-lock RED test**

Teach the fake to accept `(name, options, callback)` and return `callback(null)` for `ifAvailable` while held. Add:

```js
test('a busy lifecycle lock returns pending without waiting', async () => {
  const indexedDB = createFakeIndexedDB();
  const locks = locksFor(indexedDB);
  const held = deferred();
  const owner = locks.request('today-youxu-notification-lifecycle', async () => held.promise);
  await waitFor(() => locks.isHeld('today-youxu-notification-lifecycle'));
  const contender = createHarness({ indexedDB, locks });
  assert.deepEqual(await contender.sync.setup(contender.registration), { status: 'pending' });
  held.resolve();
  await owner;
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="busy lifecycle lock" tools/time/js/notification-sync.test.js`

Expected: FAIL because production `runLocked` queues behind the held lock.

- [ ] **Step 3: Implement non-blocking lock acquisition**

```js
function runLocked(operation, args) {
  if (!hasLocks()) return Promise.resolve(toPublicStatus('unsupported'));
  return Promise.resolve(locks.request(LIFECYCLE_LOCK, { ifAvailable: true }, function(lock) {
    if (!lock) {
      state = 'pending';
      return toPublicStatus('pending');
    }
    return operation.apply(null, args);
  })).catch(function() {
    state = 'error';
    return toPublicStatus('error');
  });
}
```

- [ ] **Step 4: Write HTTP and subscription timeout RED tests**

Use deferred fetch/subscribe promises and 1 ms injected deadlines. Assert `enable()` resolves `pending` for HTTP timeout, resolves `error` for subscription timeout, preserves `enablePending`, and the fetch signal is aborted.

- [ ] **Step 5: Run timeout tests and verify RED**

Run: `node --test --test-name-pattern="timeout|active requests" tools/time/js/notification-sync.test.js`

Expected: FAIL because requests and subscription promises have no deadline or cancellation API.

- [ ] **Step 6: Implement abortable deadlines and cancellation**

Track controllers in a `Set`, remove them in `finally`, and use one helper for fetch and subscription promises:

```js
function withDeadline(promise, timeoutMs, onTimeout) {
  return new Promise(function(resolve, reject) {
    var timer = setTimer(function() {
      if (onTimeout) onTimeout();
      var error = new Error('Notification operation timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise).then(function(value) {
      clearTimer(timer);
      resolve(value);
    }, function(error) {
      clearTimer(timer);
      reject(error);
    });
  });
}
```

`request()` creates an AbortController, passes `signal`, uses the 15-second deadline, and removes the controller. `pushManager.subscribe()` uses the 20-second deadline. `cancelActiveRequests()` aborts and clears all active controllers without clearing IndexedDB intent.

- [ ] **Step 7: Run client sync tests and commit**

Run: `node --test tools/time/js/notification-sync.test.js`

Expected: all notification sync tests PASS.

Commit:

```bash
git add tools/time/js/notification-sync.js tools/time/js/notification-sync.test.js
git commit -m "fix(time): bound notification connection waits"
```

---

### Task 3: Persistent Queue Batch Transport

**Files:**
- Modify: `tools/time/js/notification-sync.js`
- Modify: `tools/time/js/notification-sync.test.js`

**Interfaces:**
- `flushQueue(forceRetry)` processes at most one batch or one non-batch entry per call.
- Reminder batch endpoint: `/api/notifications/reminders/batch`.
- Session-local `batchSupported` starts `true` and becomes `false` only after 404/405.

- [ ] **Step 1: Write batching and bounded-drain RED tests**

Queue 84 valid reminders and assert the first drain sends no more than 25 operations, returns `pending`, releases the lock so a second instance can run, and repeated foreground drains finish with four batch requests plus reconcile.

```js
assert.equal(batchCalls.length, 4);
assert.deepEqual(batchCalls.map(call => JSON.parse(call.init.body).operations.length), [25, 25, 25, 9]);
assert.equal(reconcileCalls.length, 1);
assert.equal(finalStatus.status, 'ready');
```

- [ ] **Step 2: Run the batching test and verify RED**

Run: `node --test --test-name-pattern="bounded batch|batch transport" tools/time/js/notification-sync.test.js`

Expected: FAIL because every queued reminder is sent as an individual request in one drain.

- [ ] **Step 3: Add batch selection and wire format helpers**

Implement helpers that select eligible `upsert`/`cancel` entries in sequence order, cap at 25 and 120 KiB encoded JSON, and derive server IDs only from the existing encoded reminder path:

```js
function batchOperation(entry) {
  var prefix = '/api/notifications/reminders/';
  if (!entry.path.startsWith(prefix)) return null;
  var id = decodeURIComponent(entry.path.slice(prefix.length));
  return entry.kind === 'upsert'
    ? { kind: 'upsert', id: id, reminder: entry.body }
    : entry.kind === 'cancel'
      ? { kind: 'cancel', id: id, revision: entry.body.revision }
      : null;
}
```

- [ ] **Step 4: Implement one-batch drain and atomic queue response commits**

For a successful validated response, delete only entries whose stored generation still matches. Treat `applied`, `stale`, and `unknown` as completed. For 401/403 reuse authentication reset. For other failures increment attempts for every submitted entry without deleting newer generations. Return `pending` whenever eligible queue entries remain so the caller can schedule another lock acquisition.

- [ ] **Step 5: Write and verify fallback RED tests**

Assert a 404 and 405 batch response switches the current sync instance to one-entry single transport; assert 400, 409, 429, and 500 do not disable batching.

Run: `node --test --test-name-pattern="batch fallback" tools/time/js/notification-sync.test.js`

Expected: FAIL until fallback behavior exists.

- [ ] **Step 6: Implement exact fallback semantics**

On 404/405 set `batchSupported = false` and immediately process only the first selected entry through existing single-request logic. Preserve batching for all other statuses.

- [ ] **Step 7: Run all sync tests and commit**

Run: `node --test tools/time/js/notification-sync.test.js`

Expected: all notification sync tests PASS.

Commit:

```bash
git add tools/time/js/notification-sync.js tools/time/js/notification-sync.test.js
git commit -m "feat(time): batch durable reminder sync"
```

---

### Task 4: Service Worker Ready and Visible Recovery

**Files:**
- Modify: `tools/time/js/app.js`
- Modify: `tools/time/js/notification-integration.test.js`

**Interfaces:**
- `withNotificationDeadline(promise, 10000)` bounds `navigator.serviceWorker.ready`.
- `scheduleNotificationRecovery()` repeatedly requests one drain only while visible and online.
- `pagehide` and hidden visibility call `NotificationSync.cancelActiveRequests()`.

- [ ] **Step 1: Write Service Worker ready timeout RED test**

Extend the integration harness with a never-resolving `serviceWorker.ready`. Assert setup becomes `pending`, the setup promise can be retried, and notification clicks are not permanently disabled.

- [ ] **Step 2: Write page lifecycle and visible-drain RED tests**

Assert hidden/pagehide invokes `cancelActiveRequests`; assert a `pending` foreground drain schedules another bounded recovery while visible and stops scheduling after `ready`, `error`, `unsupported`, or hidden.

- [ ] **Step 3: Run integration tests and verify RED**

Run: `node --test tools/time/js/notification-integration.test.js`

Expected: FAIL because ready has no deadline and pending drains are not scheduled.

- [ ] **Step 4: Implement retryable Service Worker setup**

Wrap `navigator.serviceWorker.ready` in a 10-second deadline. A timeout sets `pending` and clears `notificationSetupPromise` after resolution so `online` or foreground recovery can call `registerServiceWorker()` again. Registration rejection remains `error`.

- [ ] **Step 5: Implement visible recovery and cancellation**

Add one owned timer. While `document.hidden === false`, `navigator.onLine !== false`, and status is `pending`, schedule `NotificationSync.handleForeground()` after 250 ms. Each result updates UI and either schedules the next bounded drain or stops. On `visibilitychange` to hidden and `pagehide`, clear the timer and call `cancelActiveRequests()`.

- [ ] **Step 6: Keep test notification independent**

After subscription registration succeeds, persist its `ready` state. Reminder projection may transition to `pending`; a failed or timed-out test notification must not revert the stored subscription to disabled or leave `syncing` indefinitely.

- [ ] **Step 7: Run integration and sync tests and commit**

Run:

```bash
node --test tools/time/js/notification-integration.test.js tools/time/js/notification-sync.test.js
```

Expected: all selected tests PASS.

Commit:

```bash
git add tools/time/js/app.js tools/time/js/notification-integration.test.js
git commit -m "fix(time): recover notification sync after suspension"
```

---

### Task 5: Cache, Documentation, and Full Verification

**Files:**
- Modify: `tools/time/index.html`
- Modify: `tools/time/sw.js`
- Modify: `tools/time/js/service-worker-notification.test.js`
- Modify: `workers/README.md`

**Interfaces:**
- Cache-busted asset URLs ensure merged clients receive the fixed runtime.
- Deployment order remains Worker first, client second.

- [ ] **Step 1: Write cache consistency RED test**

Update the service-worker integration assertion to require the next `notification-sync.js` and `app.js` query versions before changing production files.

- [ ] **Step 2: Run cache test and verify RED**

Run: `node --test tools/time/js/service-worker-notification.test.js`

Expected: FAIL because index and app-shell versions still reference the old notification runtime.

- [ ] **Step 3: Bump cache versions consistently**

Increment `notification-sync.js` and `app.js` query versions in `index.html`, mirror them in `sw.js`, and increment `CACHE_NAME`. Do not change unrelated asset versions.

- [ ] **Step 4: Document batch and recovery operations**

Update `workers/README.md` with the authenticated batch route, 25-operation/128-KiB limits, Worker-first release order, and production checks for `pending` recovery. Do not include real device IDs, tokens, endpoints, keys, or payloads.

- [ ] **Step 5: Run full automated verification**

Run:

```bash
node --test tools/time/js/*.test.js
cd workers/notifications && pnpm test
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy pnpm check
git diff --check
```

Expected: all client and Worker tests PASS, Wrangler dry-run succeeds, and diff check is clean.

- [ ] **Step 6: Run browser verification**

Verify desktop and mobile viewports with a clean origin and mocked PushManager:

- a held lock immediately displays “等待同步” rather than disabling the UI indefinitely;
- 84 reminders drain through four bounded batches and one reconcile;
- hiding the page aborts the active request and reopening resumes;
- test notification still decrypts, deduplicates, and targets the correct date;
- no reminder title/body appears in request plaintext.

- [ ] **Step 7: Commit final integration changes**

```bash
git add tools/time/index.html tools/time/sw.js \
  tools/time/js/service-worker-notification.test.js workers/README.md
git commit -m "docs(time): document bounded background sync"
```

- [ ] **Step 8: Request final code review**

Use `superpowers:requesting-code-review` against the merge base, address all critical/important findings with new failing tests, rerun full verification, and only then offer merge/PR options through `superpowers:finishing-a-development-branch`.

