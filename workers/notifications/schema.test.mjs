import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('initial migration creates isolated notification tables and due indexes', () => {
  const migration = readFileSync(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8');
  const query = `${migration}\nSELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name;`;
  const output = execFileSync('/usr/bin/sqlite3', [':memory:'], { input: query, encoding: 'utf8' });
  for (const name of ['devices', 'push_subscriptions', 'reminders', 'idx_reminders_due', 'idx_reminders_device_source']) {
    assert.match(output, new RegExp(`^${name}$`, 'm'));
  }
});
