const assert = require('assert');
const {
  filterDashboardExpenses,
  aggregateDashboardBreakdown,
  aggregateDashboardTrend,
  buildSpendingPace,
  buildCalendarHeatmap,
  formatHeatmapAmountLabel,
  buildDashboardInsightCards
} = require('./chart');

const tags = [
  { id: 'food', name: '餐饮', color: '#f39c12', parentId: 'group-category' },
  { id: 'snack', name: '零食', color: '#e67e22', parentId: 'group-category' },
  { id: 'wechat', name: '微信', color: '#2ecc71', parentId: 'group-payment' }
];

const groups = [
  { id: 'group-category', name: '消费类型', color: '#f39c12' },
  { id: 'group-payment', name: '支付方式', color: '#2ecc71' },
  { id: 'group-uncategorized', name: '未分类', color: '#95a5a6' }
];

const expenses = [
  { amount: 60, date: '2026-06-01', note: '午餐', category: '旧分类', tags: ['food', 'wechat'] },
  { amount: 30, date: '2026-06-02', note: '零食', category: '旧分类', tags: ['snack', 'wechat'] },
  { amount: 20, date: '2026-07-01', note: '晚餐', category: '旧分类', tags: ['food'] }
];

const filtered = filterDashboardExpenses(expenses, {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  tags: ['wechat'],
  search: '餐'
}, { tags });

assert.deepStrictEqual(
  filtered.map(expense => expense.amount),
  [60],
  'global filters should combine date, selected tags, and search before charts aggregate'
);

const categoryBreakdown = aggregateDashboardBreakdown(expenses.slice(0, 2), {
  tags,
  groups,
  analysisGroupId: 'group-category',
  topN: 5
});

assert.deepStrictEqual(categoryBreakdown.labels, ['餐饮', '零食']);
assert.deepStrictEqual(categoryBreakdown.data, [60, 30]);
assert.deepStrictEqual(categoryBreakdown.colors, ['#f39c12', '#e67e22']);

const groupBreakdown = aggregateDashboardBreakdown(expenses.slice(0, 2), {
  tags,
  groups,
  analysisGroupId: 'all-groups',
  topN: 5
});

assert.deepStrictEqual(groupBreakdown.labels, ['消费类型', '支付方式']);
assert.deepStrictEqual(groupBreakdown.data, [45, 45]);
assert.deepStrictEqual(groupBreakdown.colors, ['#f39c12', '#2ecc71']);

const trend = aggregateDashboardTrend(expenses, {
  startDate: '2026-06-01',
  endDate: '2026-07-31'
});

assert.deepStrictEqual(trend.labels, ['2026/06', '2026/07']);
assert.deepStrictEqual(trend.data, [90, 20]);

const pace = buildSpendingPace(expenses.slice(0, 2), {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  now: '2026-06-15',
  referenceTotal: 120
});

assert.strictEqual(pace.total, 90);
assert.strictEqual(pace.elapsedPercent, 50);
assert.strictEqual(pace.spendingPercent, 75);
assert.strictEqual(pace.status, 'ahead');

const heatmap = buildCalendarHeatmap(expenses.slice(0, 2), {
  startDate: '2026-06-01',
  endDate: '2026-06-03',
  now: '2026-06-02'
});

assert.strictEqual(heatmap.maxDailyTotal, 60);
assert.deepStrictEqual(
  heatmap.days.map(day => ({ date: day.date, total: day.total, intensity: day.intensity, isToday: day.isToday })),
  [
    { date: '2026-06-01', total: 60, intensity: 1, isToday: false },
    { date: '2026-06-02', total: 30, intensity: 0.5, isToday: true },
    { date: '2026-06-03', total: 0, intensity: 0, isToday: false }
  ]
);

assert.strictEqual(formatHeatmapAmountLabel(0), '');
assert.strictEqual(formatHeatmapAmountLabel(80), '¥80');
assert.strictEqual(formatHeatmapAmountLabel(1260), '¥1.3k');
assert.strictEqual(formatHeatmapAmountLabel(12000), '¥12k');

const insights = buildDashboardInsightCards(
  [
    { amount: 60, date: '2026-06-01', note: '午餐', category: '旧分类', tags: ['food'] },
    { amount: 260, date: '2026-06-02', note: '聚餐', category: '旧分类', tags: ['food'] },
    { amount: 30, date: '2026-06-03', note: '零食', category: '旧分类', tags: ['snack'] }
  ],
  {
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    tags,
    analysisGroupId: 'group-category',
    previousExpenses: [
      { amount: 80, date: '2026-05-02', note: '午餐', category: '旧分类', tags: ['food'] },
      { amount: 40, date: '2026-05-03', note: '零食', category: '旧分类', tags: ['snack'] }
    ]
  }
);

assert.deepStrictEqual(
  insights.map(card => card.type),
  ['heavy-day', 'large-expense', 'rising-category']
);
assert.strictEqual(insights[0].value, '¥260.00');
assert.strictEqual(insights[1].title, '最大单笔');
assert.match(insights[2].detail, /餐饮/);

console.log('chart dashboard helper tests passed');
