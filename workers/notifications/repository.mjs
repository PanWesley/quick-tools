function rows(result) {
  return result?.results ?? [];
}

function changes(result) {
  return result?.meta?.changes ?? 0;
}

function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    platform: row.platform,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at
  };
}

function mapReminder(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    userId: row.user_id,
    tool: row.tool,
    sourceIdHash: row.source_id_hash,
    notifyAt: row.notify_at,
    encryptedPayload: JSON.parse(row.encrypted_payload),
    encryptionVersion: row.encryption_version,
    revision: row.revision,
    status: row.status,
    attemptCount: row.attempt_count,
    leaseUntil: row.lease_until,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    subscription: row.endpoint ? {
      endpoint: row.endpoint,
      expirationTime: row.expires_at,
      p256dh: row.p256dh,
      auth: row.auth
    } : null
  };
}

export function createD1Repository(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('A D1 database binding is required');

  return {
    async createDevice(device) {
      await db.prepare(`
        INSERT INTO devices (
          id, user_id, token_hash, platform, timezone,
          created_at, updated_at, last_seen_at, revoked_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(
        device.id,
        device.tokenHash,
        device.platform,
        device.timezone,
        device.createdAt,
        device.createdAt,
        '1970-01-01T00:00:00.000Z'
      ).run();
      return device;
    },

    async authenticateDevice(tokenHash) {
      const row = await db.prepare(`
        SELECT id, user_id, token_hash, platform, timezone, created_at,
               updated_at, last_seen_at, revoked_at
        FROM devices
        WHERE token_hash = ? AND revoked_at IS NULL
        LIMIT 1
      `).bind(tokenHash).first();
      return mapDevice(row);
    },

    async upsertSubscription(deviceId, subscription, at) {
      await db.prepare(`
        INSERT INTO push_subscriptions (
          id, device_id, endpoint, p256dh, auth, created_at, updated_at, expires_at, invalidated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(device_id) DO UPDATE SET
          endpoint = excluded.endpoint,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          invalidated_at = NULL
      `).bind(
        deviceId,
        deviceId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        at,
        at,
        subscription.expirationTime === null ? null : new Date(subscription.expirationTime).toISOString()
      ).run();
      return { deviceId, ...subscription, updatedAt: at };
    },

    async removeSubscription(deviceId, at) {
      const result = await db.prepare(`
        UPDATE push_subscriptions
        SET invalidated_at = ?, updated_at = ?
        WHERE device_id = ? AND invalidated_at IS NULL
      `).bind(at, at, deviceId).run();
      return changes(result) > 0;
    },

    async removeSubscriptionAndCancelReminders(deviceId, at) {
      const results = await db.batch([
        db.prepare(`
          UPDATE push_subscriptions
          SET invalidated_at = ?, updated_at = ?
          WHERE device_id = ? AND invalidated_at IS NULL
        `).bind(at, at, deviceId),
        db.prepare(`
          UPDATE reminders
          SET status = 'cancelled', lease_until = NULL, updated_at = ?
          WHERE device_id = ? AND status IN ('pending', 'processing', 'retry')
        `).bind(at, deviceId)
      ]);
      return {
        subscriptionRemoved: changes(results[0]) > 0,
        remindersCancelled: changes(results[1])
      };
    },

    async upsertReminder(deviceId, id, reminder, at) {
      const before = await db.prepare(`
        SELECT device_id, revision, status
        FROM reminders
        WHERE id = ?
        LIMIT 1
      `).bind(id).first();
      const result = await db.prepare(`
        INSERT INTO reminders (
          id, device_id, user_id, tool, source_id_hash, notify_at,
          encrypted_payload, encryption_version, revision, status,
          attempt_count, lease_until, last_error_code, created_at, updated_at, sent_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          tool = excluded.tool,
          source_id_hash = excluded.source_id_hash,
          notify_at = excluded.notify_at,
          encrypted_payload = excluded.encrypted_payload,
          encryption_version = excluded.encryption_version,
          revision = excluded.revision,
          status = 'pending',
          attempt_count = 0,
          lease_until = NULL,
          last_error_code = NULL,
          updated_at = excluded.updated_at,
          sent_at = NULL
        WHERE reminders.device_id = excluded.device_id
          AND excluded.revision > reminders.revision
      `).bind(
        id,
        deviceId,
        reminder.tool,
        reminder.sourceIdHash,
        reminder.notifyAt,
        JSON.stringify(reminder.encryptedPayload),
        reminder.encryptionVersion,
        reminder.revision,
        at,
        at
      ).run();
      const row = await db.prepare(`
        SELECT id, device_id, user_id, tool, source_id_hash, notify_at,
               encrypted_payload, encryption_version, revision, status,
               attempt_count, lease_until, last_error_code, created_at, updated_at, sent_at
        FROM reminders
        WHERE id = ? AND device_id = ?
        LIMIT 1
      `).bind(id, deviceId).first();
      const stored = mapReminder(row);
      if (changes(result) === 0) return { outcome: stored && stored.revision === reminder.revision ? 'unchanged' : 'conflict', reminder: stored };
      return { outcome: before ? 'updated' : 'created', reminder: stored };
    },

    async cancelReminder(deviceId, id, revision, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET revision = ?, status = 'cancelled', lease_until = NULL, updated_at = ?
        WHERE id = ? AND device_id = ? AND ? > revision
      `).bind(revision, at, id, deviceId, revision).run();
      const row = await db.prepare(`
        SELECT id, device_id, user_id, tool, source_id_hash, notify_at,
               encrypted_payload, encryption_version, revision, status,
               attempt_count, lease_until, last_error_code, created_at, updated_at, sent_at
        FROM reminders
        WHERE id = ? AND device_id = ?
        LIMIT 1
      `).bind(id, deviceId).first();
      const reminder = mapReminder(row);
      if (changes(result) > 0) return { outcome: 'cancelled', reminder };
      if (!reminder) return { outcome: 'missing' };
      if (reminder.status === 'cancelled' && reminder.revision === revision) return { outcome: 'unchanged', reminder };
      return { outcome: 'conflict', reminder };
    },

    async cancelDeviceReminders(deviceId, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'cancelled', lease_until = NULL, updated_at = ?
        WHERE device_id = ? AND status IN ('pending', 'processing', 'retry')
      `).bind(at, deviceId).run();
      return changes(result);
    },

    async reconcile(deviceId, summaries, from, through) {
      const result = await db.prepare(`
        SELECT id, revision, status
        FROM reminders
        WHERE device_id = ? AND notify_at >= ? AND notify_at <= ? AND status != 'expired'
      `).bind(deviceId, from, through).all();
      const stored = rows(result);
      const server = new Map(stored.map((item) => [item.id, item]));
      const client = new Map(summaries.map((item) => [item.id, item.revision]));
      return {
        missing: summaries.filter((item) => !server.has(item.id)).map((item) => item.id),
        stale: summaries.filter((item) => server.has(item.id) && item.revision < server.get(item.id).revision).map((item) => item.id),
        cancelled: stored.filter((item) => item.status === 'cancelled' && client.has(item.id)).map((item) => item.id),
        unknown: stored.filter((item) => item.status !== 'cancelled' && !client.has(item.id)).map((item) => item.id)
      };
    },

    async claimTestPush(deviceId, at, intervalMs) {
      const subscription = await db.prepare(`
        SELECT endpoint, p256dh, auth, expires_at
        FROM push_subscriptions
        WHERE device_id = ? AND invalidated_at IS NULL
        LIMIT 1
      `).bind(deviceId).first();
      if (!subscription) return false;
      const cutoff = new Date(new Date(at).getTime() - intervalMs).toISOString();
      const result = await db.prepare(`
        UPDATE devices
        SET last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL AND last_seen_at <= ?
      `).bind(at, deviceId, cutoff).run();
      if (changes(result) === 0) return null;
      return {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expires_at,
        p256dh: subscription.p256dh,
        auth: subscription.auth
      };
    },

    async claimDue(at, leaseUntil, limit) {
      const candidates = await db.prepare(`
        SELECT r.id
        FROM reminders r
        INNER JOIN push_subscriptions s ON s.device_id = r.device_id
        WHERE r.status IN ('pending', 'retry')
          AND r.notify_at <= ?
          AND (r.status = 'pending' OR r.lease_until IS NULL OR r.lease_until <= ?)
          AND s.invalidated_at IS NULL
        ORDER BY r.notify_at, r.id
        LIMIT ?
      `).bind(at, at, limit).all();
      const claimed = [];
      for (const candidate of rows(candidates)) {
        const result = await db.prepare(`
          UPDATE reminders
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_until = ?, updated_at = ?
          WHERE id = ? AND status IN ('pending', 'retry') AND notify_at <= ?
            AND (status = 'pending' OR lease_until IS NULL OR lease_until <= ?)
        `).bind(leaseUntil, at, candidate.id, at, at).run();
        if (changes(result) === 0) continue;
        const row = await db.prepare(`
          SELECT r.*, s.endpoint, s.p256dh, s.auth, s.expires_at
          FROM reminders r
          INNER JOIN push_subscriptions s ON s.device_id = r.device_id
          WHERE r.id = ? AND r.status = 'processing' AND r.lease_until = ?
            AND s.invalidated_at IS NULL
          LIMIT 1
        `).bind(candidate.id, leaseUntil).first();
        if (row) claimed.push(mapReminder(row));
      }
      return claimed;
    },

    async markSent(id, leaseUntil, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'sent', sent_at = ?, lease_until = NULL,
            last_error_code = NULL, updated_at = ?
        WHERE id = ? AND status = 'processing' AND lease_until = ?
      `).bind(at, at, id, leaseUntil).run();
      return changes(result) > 0;
    },

    async markRetry(id, leaseUntil, retryAtValue, errorCode, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'retry', lease_until = ?,
            last_error_code = ?, updated_at = ?
        WHERE id = ? AND status = 'processing' AND lease_until = ?
      `).bind(retryAtValue, errorCode, at, id, leaseUntil).run();
      return changes(result) > 0;
    },

    async markFailed(id, leaseUntil, errorCode, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'failed', lease_until = NULL, last_error_code = ?, updated_at = ?
        WHERE id = ? AND status = 'processing' AND lease_until = ?
      `).bind(errorCode, at, id, leaseUntil).run();
      return changes(result) > 0;
    },

    async invalidateSubscription(deviceId, at) {
      const result = await db.prepare(`
        UPDATE push_subscriptions
        SET invalidated_at = ?, updated_at = ?
        WHERE device_id = ? AND invalidated_at IS NULL
      `).bind(at, at, deviceId).run();
      return changes(result) > 0;
    },

    async expireStale(cutoff, at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'expired', lease_until = NULL, updated_at = ?
        WHERE status IN ('pending', 'retry') AND notify_at < ?
      `).bind(at, cutoff).run();
      return changes(result);
    },

    async releaseExpiredLeases(at) {
      const result = await db.prepare(`
        UPDATE reminders
        SET status = 'retry', lease_until = NULL, updated_at = ?
        WHERE status = 'processing' AND lease_until <= ?
      `).bind(at, at).run();
      return changes(result);
    }
  };
}
