const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toDateKey,
  addDays,
  buildMonthGrid,
  isSameOrBefore,
  isSameOrAfter
} = require('./date-utils.js');

test('toDateKey formats local dates as YYYY-MM-DD', () => {
  assert.equal(toDateKey(new Date(2026, 6, 2)), '2026-07-02');
});

test('addDays does not mutate the input date', () => {
  const base = new Date(2026, 6, 2);
  assert.equal(toDateKey(addDays(base, 3)), '2026-07-05');
  assert.equal(toDateKey(base), '2026-07-02');
});

test('buildMonthGrid returns 42 cells with leading and trailing days', () => {
  const grid = buildMonthGrid(2026, 6);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].dateKey, '2026-06-29');
  assert.equal(grid[3].dateKey, '2026-07-02');
  assert.equal(grid[3].isCurrentMonth, true);
});

test('date comparison helpers compare YYYY-MM-DD keys', () => {
  assert.equal(isSameOrBefore('2026-07-01', '2026-07-02'), true);
  assert.equal(isSameOrAfter('2026-07-03', '2026-07-02'), true);
});
