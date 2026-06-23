const assert = require('assert');
const { planTagGroupRepair } = require('./tag-management-utils');

const defaultGroups = [
  { id: 'group-payment', name: '支付方式' },
  { id: 'group-category', name: '消费类型' },
  { id: 'group-uncategorized', name: '未分类' }
];

const emptyGroupPlan = planTagGroupRepair(
  [
    { id: 'tag-food', name: '餐饮', parentId: 'group-category' },
    { id: 'tag-custom', name: '自定义' }
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
  { id: 'tag-custom', name: '自定义', parentId: 'group-category' }
]);

const invalidParentPlan = planTagGroupRepair(
  [{ id: 'tag-old', name: '旧标签', parentId: 'deleted-group' }],
  [{ id: 'group-category', name: '消费类型' }],
  defaultGroups
);

assert.deepStrictEqual(invalidParentPlan.tagsToUpdate, [
  { id: 'tag-old', name: '旧标签', parentId: 'group-uncategorized' }
]);

console.log('tag-management-utils tests passed');
