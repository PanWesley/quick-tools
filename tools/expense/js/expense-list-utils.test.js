const assert = require('assert');
const {
  getExpenseMonthKey,
  formatMonthLabel,
  formatExpenseDay,
  groupExpensesByMonth,
  sortExpensesForList,
  createExpenseDetailView,
  selectPrimaryExpenseTag,
  getExpenseGestureResult,
  shouldSuppressExpenseClick
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

const sortedByDateDesc = sortExpensesForList(
  [
    { id: 'exp_1000_old', date: '2026-06-20', createdAt: '2026-06-20T08:00:00.000Z' },
    { id: 'exp_2000_new', date: '2026-06-20', createdAt: '2026-06-20T09:00:00.000Z' },
    { id: 'exp_3000_next_day', date: '2026-06-21', createdAt: '2026-06-21T07:00:00.000Z' }
  ],
  'date-desc'
);

assert.deepStrictEqual(
  sortedByDateDesc.map(expense => expense.id),
  ['exp_3000_next_day', 'exp_2000_new', 'exp_1000_old'],
  'date descending sort should put newer dates first and later-created same-day expenses first'
);

const detailTags = [
  { id: 'wechat', name: '微信', color: '#2ecc71', parentId: 'group-payment' },
  { id: 'food', name: '餐饮', color: '#e74c3c', parentId: 'group-category' },
  { id: 'family', name: '家庭', color: '#3498db', parentId: 'group-person' }
];
const detailGroups = [
  { id: 'group-payment', name: '支付方式', order: 0 },
  { id: 'group-person', name: '人员', order: 1 },
  { id: 'group-category', name: '消费类型', order: 2 }
];

assert.strictEqual(
  selectPrimaryExpenseTag(['wechat', 'food', 'family'], detailTags).id,
  'food'
);

assert.deepStrictEqual(
  createExpenseDetailView(
    { amount: 35, date: '2026-06-20', note: '午餐', category: '餐饮', tags: ['wechat', 'food', 'family'] },
    detailTags,
    detailGroups
  ),
  {
    title: '午餐',
    amount: '¥35.00',
    date: '2026-06-20',
    dateLabel: '6月20日 周六',
    category: '餐饮',
    tagGroups: [
      {
        id: 'group-payment',
        name: '支付方式',
        tags: [{ id: 'wechat', name: '微信', color: '#2ecc71', parentId: 'group-payment' }]
      },
      {
        id: 'group-person',
        name: '人员',
        tags: [{ id: 'family', name: '家庭', color: '#3498db', parentId: 'group-person' }]
      },
      {
        id: 'group-category',
        name: '消费类型',
        tags: [{ id: 'food', name: '餐饮', color: '#e74c3c', parentId: 'group-category' }]
      }
    ]
  }
);

assert.deepStrictEqual(
  getExpenseGestureResult({ pointerType: 'touch', deltaX: -80, deltaY: 4 }),
  { action: 'open', suppressClick: true }
);
assert.deepStrictEqual(
  getExpenseGestureResult({ pointerType: 'touch', deltaX: -30, deltaY: 2 }),
  { action: 'none', suppressClick: true }
);
assert.deepStrictEqual(
  getExpenseGestureResult({ pointerType: 'mouse', deltaX: -100, deltaY: 0 }),
  { action: 'none', suppressClick: false }
);
assert.deepStrictEqual(
  getExpenseGestureResult({ pointerType: 'mouse', deltaX: -100, deltaY: 0, allowMouseSwipe: true }),
  { action: 'open', suppressClick: true }
);
assert.deepStrictEqual(
  getExpenseGestureResult({ pointerType: 'touch', deltaX: -20, deltaY: 40 }),
  { action: 'none', suppressClick: false }
);
assert.strictEqual(shouldSuppressExpenseClick(1200, 1000), true);
assert.strictEqual(shouldSuppressExpenseClick(1200, 1200), false);
assert.strictEqual(shouldSuppressExpenseClick(1200, 1000, true), false);

console.log('expense-list-utils tests passed');
