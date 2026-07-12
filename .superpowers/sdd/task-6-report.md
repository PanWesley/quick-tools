# Task 6 Report

## RED

Command:

```bash
$NODE --test tools/time/js/notification-model.test.js tools/time/js/notification.test.js
```

Actual result: 0 passed, 5 failed. `notification-model` was missing, and the legacy service did not export `getHabitDateTime`, `buildNotificationCopy`, or `getMissedCount`. The foreground scheduling assertion also failed before the browser Notification test fixture was corrected.

## GREEN

- Focused model and notification tests: 9 passed, 0 failed.
- Model, notification, and app-state tests: 19 passed, 0 failed.
- All `tools/time/js/*.test.js` tests: 76 passed, 0 failed.

## Design

- `notification-model.js` is a pure UMD projection module. Node defaults to `require('crypto').webcrypto`; browsers default to `root.crypto`; tests and callers can inject another Web Crypto implementation as the fifth `buildReminderRecords` argument.
- Reminder IDs are SHA-256 projections of type, source ID, and occurrence date. The backend ID does not expose the source ID. `sourceIdHash` is the full lowercase SHA-256 of type and source ID.
- Projection uses a strict future-only, inclusive 30-day horizon. Tasks require `status === 'active'`; habits accept active or legacy missing status, use recurrence checks, and omit done/skipped occurrences.
- Notification payloads contain only title, concise body, tag, navigation data, scheduled time, and version. Notes and complete source records are not projected.
- `notification.js` delegates copy generation to the model, accepts only strict habit `HH:mm`, retains the 24-hour foreground timer limit, and replaces stale per-item notifications with a side-effect-free missed count.

## Review Hardening

### RED

Command:

```bash
$NODE --test tools/time/js/notification-model.test.js
```

Actual result: 5 passed, 3 failed. The fixed 720-hour horizon excluded 2026-11-01 09:00 in `America/New_York` even though it is the 30th local calendar day after 2026-10-02 09:00. Invalid offsets reached `toISOString()` and rejected the full `Promise.all`, and an invalid `now` value did not throw.

### GREEN

- `notification-model.test.js`: 8 passed, 0 failed.
- Model, notification, and app-state tests: 22 passed, 0 failed.
- All `tools/time/js/*.test.js` tests: 79 passed, 0 failed.
- `node --check tools/time/js/notification-model.js` and `git diff --check`: clean.

### Follow-up Gates

- Task 7 owns loading `notification-model.js` from `tools/time/index.html`; this review fix does not modify `index.html`.
- Task 8 owns Service Worker cache changes in `tools/time/sw.js`; this review fix does not modify `sw.js`.
