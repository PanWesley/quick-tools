# Task 8 Report: Encrypted Background Push

## Result

Implemented encrypted background push receipt in the classic Service Worker, generic fallback notifications, visible-tag deduplication, safe notification click targeting, page entity highlighting, current notification asset precaching, and network-only notification API handling.

## TDD Evidence

### RED

Command:

```bash
$NODE --test tools/time/js/service-worker-notification.test.js
```

Result: 11 tests failed. The failures demonstrated the missing push listener, missing fallback and dedupe behavior, unsafe click URL handling, absent page targeting attributes/highlight, stale `today-youxu-v28` cache assets, cached notification API GETs, and the missing read-only crypto key interface.

### GREEN

Focused command:

```bash
$NODE --test tools/time/js/service-worker-notification.test.js tools/time/js/notification-integration.test.js tools/time/js/notification-crypto.test.js
```

Result: 30 passed, 0 failed.

Full time-tool JavaScript suite:

```bash
$NODE --test tools/time/js/*.test.js
```

Result: 106 passed, 0 failed.

Additional checks:

```bash
$NODE --check tools/time/sw.js
$NODE --check tools/time/js/app.js
git diff --check
```

Result: all exited 0.

## Implementation Notes

- `sw.js` imports the cache-busted classic crypto helper, reads `payload-key-v1` without creating a replacement, accepts only strict encrypted envelopes, and validates the exact decrypted payload/data shapes with bounded fields.
- Missing keys, malformed JSON, invalid envelopes, decryption errors, and invalid plaintext shapes all display the same deduplicated generic reminder. Push processing does not log envelopes or plaintext.
- Notification display uses only body, tag, data, icon, and badge. Existing visible tags suppress duplicate display.
- Notification clicks close the notification, constrain destinations to same-origin `/tools/time/`, focus and message an existing time client, or open the sanitized target.
- Task and habit rows expose stable notification type/id/date attributes. The page switches to today, selects a valid date, renders, scrolls the matching row to center, and applies a temporary box-shadow highlight without layout changes.
- Cache `today-youxu-v29` precaches the exact current index URLs for crypto, model, sync, notification, app, and CSS. Every same-origin `/api/notifications` method goes directly to `fetch` without cache reads or writes; the existing static GET strategy remains unchanged.

## Concern

The VM harness deliberately does not claim coverage of real Service Worker termination or cross-context Web Locks behavior. Task 9 must verify that lifecycle in a real browser.

## Review Fixes

### RED

Command:

```bash
$NODE --test tools/time/js/service-worker-notification.test.js tools/time/js/notification-crypto.test.js tools/time/js/notification.test.js
```

Result: 17 passed and 8 failed. The failures reproduced hidden-view notification targeting, stale calendar month selection, plaintext close logging, permissive crypto envelope prototypes and keys, reserved fallback-tag reuse, aborted display after `getNotifications` rejection, and duplicate page message ownership.

### GREEN

Focused command result: 25 passed, 0 failed.

Full time-tool JavaScript suite result: 112 passed, 0 failed.

### Changes

- Valid non-today notification dates switch to Calendar, synchronize year/month/date, render, and query only the active view. Today notifications remain in Today.
- Push, click, and close handling emit no encrypted or plaintext notification payload logs; the unnecessary close handler was removed.
- Crypto envelopes must be ordinary own-objects with exactly `v`, `iv`, and `ciphertext`; arrays, inherited fields, custom/null prototypes, missing fields, and extra fields are rejected.
- The generic fallback tag is reserved. A failed visible-notification lookup no longer suppresses display, while a failed display still rejects the push event after one attempt.
- `app.js` is the sole `serviceWorker.message` owner. `notification.js` retains ready-registration setup only.
- Existing notification API network-only behavior, app-shell caching, and sanitized click URL behavior remain covered by the passing full suite.
