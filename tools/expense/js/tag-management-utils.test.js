const assert = require('assert');
const {
  buildTagUsageStats,
  hasDuplicateTagNameInGroup,
  planTagGroupRepair,
  sortTagsForPicker
} = require('./tag-management-utils');

const defaultGroups = [
  { id: 'group-payment', name: 'Payment' },
  { id: 'group-category', name: 'Category' },
  { id: 'group-uncategorized', name: 'Uncategorized' }
];

const emptyGroupPlan = planTagGroupRepair(
  [
    { id: 'tag-food', name: 'Food', parentId: 'group-category' },
    { id: 'tag-custom', name: 'Custom' }
  ],
  [],
  defaultGroups
);

assert.deepStrictEqual(emptyGroupPlan.groupsToAdd.map(group => group.id), [
  'group-payment',
  'group-category',
  'group-uncategorized'
]);
assert.deepStrictEqual(emptyGroupPlan.tagsToUpdate, [
  { id: 'tag-custom', name: 'Custom', parentId: 'group-category' }
]);

const invalidParentPlan = planTagGroupRepair(
  [{ id: 'tag-old', name: 'Old tag', parentId: 'deleted-group' }],
  [{ id: 'group-category', name: 'Category' }],
  defaultGroups
);

assert.deepStrictEqual(invalidParentPlan.tagsToUpdate, [
  { id: 'tag-old', name: 'Old tag', parentId: 'group-uncategorized' }
]);

const duplicateTags = [
  { id: 'tag-wechat-payment', name: '微信', parentId: 'group-payment' },
  { id: 'tag-wechat-channel', name: '微信', parentId: 'group-channel' },
  { id: 'tag-food', name: '餐饮', parentId: 'group-category' }
];

assert.strictEqual(
  hasDuplicateTagNameInGroup(duplicateTags, '微信', 'group-payment'),
  true,
  'same name in the same group should be duplicate'
);
assert.strictEqual(
  hasDuplicateTagNameInGroup(duplicateTags, '微信', 'group-person'),
  false,
  'same name in another group should be allowed'
);
assert.strictEqual(
  hasDuplicateTagNameInGroup(duplicateTags, '微信', 'group-payment', 'tag-wechat-payment'),
  false,
  'renaming a tag to its current name should be allowed'
);
assert.strictEqual(
  hasDuplicateTagNameInGroup(duplicateTags, '  微信  ', 'group-payment', 'tag-wechat-payment'),
  false,
  'duplicate checks should trim input before comparing'
);

const usageStats = buildTagUsageStats(
  [
    { id: 'expense-1', date: '2026-06-28', tags: ['tag-food', 'tag-pay'] },
    { id: 'expense-2', date: '2026-06-20', tags: ['tag-pay'] },
    { id: 'expense-3', date: '2026-01-01', tags: ['tag-food'] },
    { id: 'expense-4', date: '2025-01-01', tags: ['tag-old'] }
  ],
  new Date('2026-06-29T12:00:00'),
  90
);

assert.deepStrictEqual(usageStats['tag-food'], {
  recent: 1,
  total: 2,
  lastUsed: '2026-06-28'
});
assert.deepStrictEqual(usageStats['tag-pay'], {
  recent: 2,
  total: 2,
  lastUsed: '2026-06-28'
});
assert.deepStrictEqual(usageStats['tag-old'], {
  recent: 0,
  total: 1,
  lastUsed: '2025-01-01'
});

const sortedTags = sortTagsForPicker(
  [
    { id: 'tag-unused', name: 'D unused' },
    { id: 'tag-food', name: 'B food' },
    { id: 'tag-selected', name: 'A selected' },
    { id: 'tag-pay', name: 'C pay' },
    { id: 'tag-old', name: 'E old' }
  ],
  usageStats,
  ['tag-selected']
);

assert.deepStrictEqual(
  sortedTags.map(tag => tag.id),
  ['tag-selected', 'tag-pay', 'tag-food', 'tag-old', 'tag-unused'],
  'selected tags should stay first, then tags should sort by recent usage, total usage, and name'
);

console.log('tag-management-utils tests passed');
