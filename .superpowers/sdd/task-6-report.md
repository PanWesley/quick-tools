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
