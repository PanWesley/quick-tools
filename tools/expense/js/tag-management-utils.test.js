const assert = require('assert');
const {
  hasDuplicateTagNameInGroup,
  planTagGroupRepair
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

console.log('tag-management-utils tests passed');
