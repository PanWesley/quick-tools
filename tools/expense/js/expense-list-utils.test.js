const assert = require('assert');
const {
  getExpenseMonthKey,
  formatMonthLabel,
  formatExpenseDay,
  groupExpensesByMonth
} = require('./expense-list-utils');

assert.strictEqual(getExpenseMonthKey('2026-06-20'), '2026-06');
assert.strictEqual(formatMonthLabel('2026-06'), '2026年6月');
assert.strictEqual(formatExpenseDay('2026-06-20'), '6月20日 周六');

const grouped = groupExpensesByMonth([
  { id: 'a', date: '2026-06-20', amount: 10 },
  { id: 'b', date: '2026-06-11', amount: 3.5 },
  { id: 'c', date: '2026-05-01', amount: 7 }
]);

assert.strictEqual(grouped['2026-06'].items.length, 2);
assert.strictEqual(grouped['2026-06'].total, 13.5);
assert.strictEqual(grouped['2026-05'].items[0].id, 'c');

console.log('expense-list-utils tests passed');
