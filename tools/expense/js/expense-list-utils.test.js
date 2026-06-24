const assert = require('assert');
const {
  getExpenseMonthKey,
  formatMonthLabel,
  formatExpenseDay,
  groupExpensesByMonth,
  createExpenseDetailView,
  selectPrimaryExpenseTag
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

console.log('expense-list-utils tests passed');
