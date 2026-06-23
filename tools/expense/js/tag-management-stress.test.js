const assert = require('assert');
const { planTagGroupRepair } = require('./tag-management-utils');

const defaultGroups = [
  { id: 'group-payment', name: '支付方式' },
  { id: 'group-person', name: '人员' },
  { id: 'group-category', name: '消费类型' },
  { id: 'group-channel', name: '渠道' },
  { id: 'group-uncategorized', name: '未分类' }
];

const largeTags = [];
for (let i = 0; i < 2500; i += 1) {
  largeTags.push({
    id: `tag-${i}`,
    name: `标签${i}`,
    parentId: i % 7 === 0 ? undefined : (i % 5 === 0 ? 'deleted-group' : 'group-category')
  });
}

const started = Date.now();
const plan = planTagGroupRepair(largeTags, [], defaultGroups);
const elapsed = Date.now() - started;

assert.strictEqual(plan.groupsToAdd.length, defaultGroups.length);
assert.strictEqual(plan.tagsToUpdate.length, largeTags.filter(tag => !tag.parentId || tag.parentId === 'deleted-group').length);
assert.ok(plan.tagsToUpdate.every(tag => defaultGroups.some(group => group.id === tag.parentId)));
assert.ok(elapsed < 200, `repair planning took too long: ${elapsed}ms`);

const secondPlan = planTagGroupRepair(
  largeTags.map(tag => {
    const repaired = plan.tagsToUpdate.find(item => item.id === tag.id);
    return repaired || tag;
  }),
  defaultGroups,
  defaultGroups
);

assert.strictEqual(secondPlan.groupsToAdd.length, 0);
assert.strictEqual(secondPlan.tagsToUpdate.length, 0);

console.log(`tag-management stress test passed in ${elapsed}ms`);
