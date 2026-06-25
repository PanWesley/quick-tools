(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (root) {
    root.ExpenseDBBackupUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_TAG_GROUPS = Object.freeze([
    { id: 'group-payment', name: '支付方式', color: '#3498db', order: 0 },
    { id: 'group-person', name: '人员', color: '#e91e63', order: 1 },
    { id: 'group-category', name: '消费类型', color: '#f39c12', order: 2 },
    { id: 'group-channel', name: '渠道', color: '#9b59b6', order: 3 },
    { id: 'group-uncategorized', name: '未分类', color: '#95a5a6', order: 99 }
  ]);
  const DEFAULT_REPAIR_OPTIONS = Object.freeze({
    defaultTagParentId: 'group-category',
    fallbackGroupId: 'group-uncategorized'
  });

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function applyRecordsById(current, writes) {
    const records = new Map(
      asArray(current)
        .filter(record => record && record.id)
        .map(record => [record.id, record])
    );
    asArray(writes).forEach(record => {
      if (record && record.id) records.set(record.id, record);
    });
    return [...records.values()];
  }

  function prepareMergedTagIntegrity(
    input = {},
    planner,
    defaultGroups,
    repairOptions
  ) {
    if (typeof planner !== 'function') {
      throw new Error('Tag group repair planner is required');
    }
    const currentTags = asArray(input.currentTags);
    const currentTagGroups = asArray(input.currentTagGroups);
    const tagsToAdd = asArray(input.tagsToAdd);
    const tagGroupsToAdd = asArray(input.tagGroupsToAdd);
    const combinedTags = applyRecordsById(currentTags, tagsToAdd);
    const combinedGroups = applyRecordsById(
      currentTagGroups,
      tagGroupsToAdd
    );
    const repairPlan = planner(
      combinedTags,
      combinedGroups,
      asArray(defaultGroups),
      repairOptions || {}
    );
    return {
      tags: applyRecordsById(combinedTags, repairPlan.tagsToUpdate),
      tagGroups: applyRecordsById(combinedGroups, repairPlan.groupsToAdd)
    };
  }

  function prepareMergeExpected(current = {}, plan = {}, planner) {
    return prepareMergedTagIntegrity({
      currentTags: current.tags,
      currentTagGroups: current.tagGroups,
      tagsToAdd: plan.tagsToAdd,
      tagGroupsToAdd: plan.tagGroupsToAdd
    }, planner, DEFAULT_TAG_GROUPS, DEFAULT_REPAIR_OPTIONS);
  }

  return {
    DEFAULT_TAG_GROUPS,
    DEFAULT_REPAIR_OPTIONS,
    prepareMergedTagIntegrity,
    prepareMergeExpected
  };
});
