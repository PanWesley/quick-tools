import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createD1Repository } from './repository.mjs';

const AT = '2026-07-11T10:00:00.000Z';
const DUE = '2026-07-11T09:59:00.000Z';

class BoundStatement {
  constructor(database, sql, values = [], owner = null) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.owner = owner;
  }

  bind(...values) {
    return new BoundStatement(this.database, this.sql, values, this.owner);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    if (this.owner?.beforeRun) this.owner.beforeRun(this.sql, this.values, this.database);
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const db = {
    failBatchAt: null,
    beforeRun: null,
    prepare(sql) {
      return new BoundStatement(database, sql, [], this);
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement, index) => {
          if (this.failBatchAt === index + 1) throw new Error('injected batch failure');
          return statement.runSync();
        });
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    database
  };
  return db;
}

async function createFixture() {
  const db = createDatabase();
  const repository = createD1Repository(db);
  await repository.createDevice({
    id: 'device-1',
    tokenHash: 'a'.repeat(64),
    platform: 'mobile',
    timezone: 'Asia/Shanghai',
    createdAt: AT
  });
  return { db, repository };
}

function reminder(revision, notifyAt = DUE) {
  return {
    tool: 'time',
    sourceIdHash: 'b'.repeat(64),
    notifyAt,
    encryptedPayload: { v: 1, iv: 'abc', ciphertext: 'def' },
    encryptionVersion: 1,
    revision
  };
}

async function subscribe(repository) {
  await repository.upsertSubscription('device-1', {
    endpoint: 'https://push.example/subscription',
    expirationTime: null,
    p256dh: 'p256dh',
    auth: 'auth'
  }, AT);
}

test('real SQL authenticates token hashes and enforces reminder revision semantics', async () => {
  const { repository } = await createFixture();
  assert.equal((await repository.authenticateDevice('a'.repeat(64))).id, 'device-1');
  assert.equal(await repository.authenticateDevice('c'.repeat(64)), null);

  assert.equal((await repository.upsertReminder('device-1', 'reminder-1', reminder(4), AT)).outcome, 'created');
  assert.equal((await repository.upsertReminder('device-1', 'reminder-1', reminder(3), AT)).outcome, 'conflict');
  assert.equal((await repository.upsertReminder('device-1', 'reminder-1', reminder(4), AT)).outcome, 'unchanged');
  assert.equal((await repository.cancelReminder('device-1', 'reminder-1', 5, AT)).outcome, 'cancelled');
  const restored = await repository.upsertReminder('device-1', 'reminder-1', reminder(6), AT);
  assert.equal(restored.reminder.status, 'pending');
});

test('real SQL atomically claims the device test-push interval', async () => {
  const { repository } = await createFixture();
  await subscribe(repository);
  const claims = await Promise.all([
    repository.claimTestPush('device-1', AT, 60_000),
    repository.claimTestPush('device-1', AT, 60_000)
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.filter((claim) => claim === null).length, 1);
});

test('subscription invalidation and reminder cancellation roll back as one D1 batch', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  await repository.upsertReminder('device-1', 'reminder-1', reminder(1, '2026-07-11T10:30:00.000Z'), AT);

  db.failBatchAt = 2;
  await assert.rejects(
    repository.removeSubscriptionAndCancelReminders('device-1', AT),
    /injected batch failure/
  );
  assert.equal(db.database.prepare('SELECT invalidated_at FROM push_subscriptions').get().invalidated_at, null);
  assert.equal(db.database.prepare('SELECT status FROM reminders').get().status, 'pending');

  db.failBatchAt = null;
  const result = await repository.removeSubscriptionAndCancelReminders('device-1', AT);
  assert.deepEqual(result, { subscriptionRemoved: true, remindersCancelled: 1 });
  assert.equal(db.database.prepare('SELECT invalidated_at FROM push_subscriptions').get().invalidated_at, AT);
  assert.equal(db.database.prepare('SELECT status FROM reminders').get().status, 'cancelled');
});

test('stale workers cannot complete reminders after a new lease owns them', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  for (const id of ['sent', 'retry', 'failed']) {
    await repository.upsertReminder('device-1', id, reminder(1), AT);
  }

  const firstLease = '2026-07-11T10:01:00.000Z';
  const firstClaims = await repository.claimDue(AT, firstLease, 3);
  assert.equal(firstClaims.length, 3);
  assert.ok(firstClaims.every((claim) => claim.leaseUntil === firstLease));

  await repository.releaseExpiredLeases('2026-07-11T10:02:00.000Z');
  const secondLease = '2026-07-11T10:03:00.000Z';
  const secondClaims = await repository.claimDue('2026-07-11T10:02:00.000Z', secondLease, 3);
  assert.equal(secondClaims.length, 3);
  assert.ok(secondClaims.every((claim) => claim.leaseUntil === secondLease));

  assert.equal(await repository.markSent('sent', firstLease, '2026-07-11T10:02:10.000Z'), false);
  assert.equal(await repository.markRetry(
    'retry', firstLease, '2026-07-11T10:05:00.000Z', 'push_503', '2026-07-11T10:02:10.000Z'
  ), false);
  assert.equal(await repository.markFailed('failed', firstLease, 'push_400', '2026-07-11T10:02:10.000Z'), false);

  const processing = db.database.prepare('SELECT id, status, lease_until FROM reminders ORDER BY id').all();
  assert.ok(processing.every((row) => row.status === 'processing' && row.lease_until === secondLease));

  assert.equal(await repository.markSent('sent', secondLease, '2026-07-11T10:02:20.000Z'), true);
  assert.equal(await repository.markRetry(
    'retry', secondLease, '2026-07-11T10:05:00.000Z', 'push_503', '2026-07-11T10:02:20.000Z'
  ), true);
  assert.equal(await repository.markFailed('failed', secondLease, 'push_400', '2026-07-11T10:02:20.000Z'), true);
  assert.deepEqual(
    db.database.prepare('SELECT id, status FROM reminders ORDER BY id').all().map((row) => ({ ...row })),
    [{ id: 'failed', status: 'failed' }, { id: 'retry', status: 'retry' }, { id: 'sent', status: 'sent' }]
  );

  const retryRow = db.database.prepare(
    "SELECT notify_at, lease_until FROM reminders WHERE id = 'retry'"
  ).get();
  assert.equal(retryRow.notify_at, DUE);
  assert.equal(retryRow.lease_until, '2026-07-11T10:05:00.000Z');
  assert.equal((await repository.claimDue(
    '2026-07-11T10:04:59.000Z', '2026-07-11T10:06:00.000Z', 1
  )).length, 0);
  assert.equal((await repository.claimDue(
    '2026-07-11T10:05:00.000Z', '2026-07-11T10:06:00.000Z', 1
  )).length, 1);
});

test('claimDue never returns cancelled reminders', async () => {
  const { repository } = await createFixture();
  await subscribe(repository);
  await repository.upsertReminder('device-1', 'cancelled', reminder(1), AT);
  await repository.cancelReminder('device-1', 'cancelled', 2, AT);
  assert.deepEqual(await repository.claimDue(AT, '2026-07-11T10:05:00.000Z', 100), []);
});

test('reconcile authoritatively cancels completed deleted and rescheduled server-only reminders before claimDue', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  const notifyAt = '2026-07-11T10:05:00.000Z';
  for (const id of ['completed-old', 'deleted-old', 'rescheduled-old']) {
    await repository.upsertReminder('device-1', id, reminder(7, notifyAt), AT);
  }

  const result = await repository.reconcile('device-1', [
    { id: 'rescheduled-new', revision: 8 }
  ], AT, '2026-08-11T10:00:00.000Z');

  assert.deepEqual(result, {
    missing: ['rescheduled-new'],
    stale: [],
    cancelled: [],
    unknown: ['completed-old', 'deleted-old', 'rescheduled-old']
  });
  assert.deepEqual(
    db.database.prepare('SELECT id, status FROM reminders ORDER BY id').all().map((row) => ({ ...row })),
    [
      { id: 'completed-old', status: 'cancelled' },
      { id: 'deleted-old', status: 'cancelled' },
      { id: 'rescheduled-old', status: 'cancelled' }
    ]
  );
  assert.deepEqual(await repository.claimDue(
    '2026-07-11T10:06:00.000Z',
    '2026-07-11T10:11:00.000Z',
    10
  ), []);
});

test('reconcile cancellation cannot cancel a newer revision written after its read', async () => {
  const { db, repository } = await createFixture();
  await repository.upsertReminder('device-1', 'raced', reminder(3, '2026-07-11T10:05:00.000Z'), AT);
  db.beforeRun = (sql, _values, database) => {
    if (!/UPDATE reminders\s+SET status = 'cancelled'/m.test(sql)) return;
    db.beforeRun = null;
    database.prepare(`
      UPDATE reminders
      SET revision = 4, encrypted_payload = ?, updated_at = ?
      WHERE id = 'raced'
    `).run(JSON.stringify({ v: 1, iv: 'new', ciphertext: 'newer' }), '2026-07-11T10:00:01.000Z');
  };

  const result = await repository.reconcile(
    'device-1',
    [],
    AT,
    '2026-08-11T10:00:00.000Z'
  );

  assert.deepEqual(result.unknown, []);
  assert.deepEqual(
    { ...db.database.prepare('SELECT revision, status FROM reminders WHERE id = ?').get('raced') },
    { revision: 4, status: 'pending' }
  );
});

test('same revision restores only reminders cancelled by bulk subscription disable', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  await repository.upsertReminder('device-1', 'bulk-disabled', reminder(9), AT);

  await repository.removeSubscriptionAndCancelReminders('device-1', '2026-07-11T10:01:00.000Z');
  assert.deepEqual(
    { ...db.database.prepare(`
      SELECT revision, status, last_error_code
      FROM reminders WHERE id = 'bulk-disabled'
    `).get() },
    { revision: 9, status: 'cancelled', last_error_code: 'subscription_disabled' }
  );

  const restored = await repository.upsertReminder(
    'device-1',
    'bulk-disabled',
    reminder(9),
    '2026-07-11T10:02:00.000Z'
  );
  assert.equal(restored.outcome, 'updated');
  assert.equal(restored.reminder.status, 'pending');

  await repository.cancelReminder('device-1', 'bulk-disabled', 10, '2026-07-11T10:03:00.000Z');
  const explicit = await repository.upsertReminder(
    'device-1',
    'bulk-disabled',
    reminder(10),
    '2026-07-11T10:04:00.000Z'
  );
  assert.equal(explicit.outcome, 'unchanged');
  assert.equal(explicit.reminder.status, 'cancelled');
  assert.notEqual(explicit.reminder.lastErrorCode, 'subscription_disabled');
});

test('empty reconcile clears bulk-disable restoration without reviving an equal revision', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  await repository.upsertReminder(
    'device-1', 'bulk-disabled', reminder(9, '2026-07-11T10:05:00.000Z'), AT
  );
  await repository.removeSubscriptionAndCancelReminders('device-1', '2026-07-11T10:01:00.000Z');

  await repository.reconcile('device-1', [], AT, '2026-08-11T10:00:00.000Z');
  const afterReconcile = db.database.prepare(`
    SELECT revision, status, last_error_code
    FROM reminders WHERE id = 'bulk-disabled'
  `).get();
  assert.deepEqual({ ...afterReconcile }, {
    revision: 9,
    status: 'cancelled',
    last_error_code: null
  });

  const equalRevision = await repository.upsertReminder(
    'device-1',
    'bulk-disabled',
    reminder(9, '2026-07-11T10:05:00.000Z'),
    '2026-07-11T10:02:00.000Z'
  );
  assert.equal(equalRevision.outcome, 'unchanged');
  assert.equal(equalRevision.reminder.status, 'cancelled');
});

test('reconcile bulk-marker clearing cannot overwrite a concurrently higher revision', async () => {
  const { db, repository } = await createFixture();
  await subscribe(repository);
  await repository.upsertReminder(
    'device-1', 'raced-bulk', reminder(9, '2026-07-11T10:05:00.000Z'), AT
  );
  await repository.removeSubscriptionAndCancelReminders('device-1', '2026-07-11T10:01:00.000Z');
  db.beforeRun = (sql, _values, database) => {
    if (!/SET last_error_code = NULL, updated_at = \?/m.test(sql)) return;
    db.beforeRun = null;
    database.prepare(`
      UPDATE reminders
      SET revision = 10, status = 'pending', last_error_code = NULL, updated_at = ?
      WHERE id = 'raced-bulk'
    `).run('2026-07-11T10:01:30.000Z');
  };

  await repository.reconcile('device-1', [], AT, '2026-08-11T10:00:00.000Z');

  assert.deepEqual({ ...db.database.prepare(`
    SELECT revision, status, last_error_code
    FROM reminders WHERE id = 'raced-bulk'
  `).get() }, {
    revision: 10,
    status: 'pending',
    last_error_code: null
  });
});

test('claiming an endpoint transfers ownership and cancels the old device reminders atomically', async () => {
  const { db, repository } = await createFixture();
  await repository.createDevice({
    id: 'device-2',
    tokenHash: 'c'.repeat(64),
    platform: 'mobile',
    timezone: 'Asia/Shanghai',
    createdAt: AT
  });
  await subscribe(repository);
  await repository.upsertReminder('device-1', 'old-owner', reminder(1), AT);
  await repository.upsertReminder('device-2', 'new-owner', reminder(1), AT);

  await repository.upsertSubscription('device-2', {
    endpoint: 'https://push.example/subscription',
    expirationTime: null,
    p256dh: 'new-p256dh',
    auth: 'new-auth'
  }, '2026-07-11T10:01:00.000Z');

  assert.deepEqual(db.database.prepare(`
    SELECT device_id, invalidated_at
    FROM push_subscriptions ORDER BY device_id
  `).all().map((row) => ({ ...row })), [
    { device_id: 'device-1', invalidated_at: '2026-07-11T10:01:00.000Z' },
    { device_id: 'device-2', invalidated_at: null }
  ]);
  assert.deepEqual(db.database.prepare(`
    SELECT id, status, last_error_code
    FROM reminders ORDER BY id
  `).all().map((row) => ({ ...row })), [
    { id: 'new-owner', status: 'pending', last_error_code: null },
    { id: 'old-owner', status: 'cancelled', last_error_code: 'subscription_reassigned' }
  ]);
  const claimed = await repository.claimDue(AT, '2026-07-11T10:05:00.000Z', 10);
  assert.deepEqual(claimed.map((item) => item.deviceId), ['device-2']);
});
