(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./tag-management-utils'));
  } else if (root) {
    root.ExpenseDBBackupUtils = factory(root.TagManagementUtils);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(tagUtils) {
  const DEFAULT_TAG_GROUPS = tagUtils && tagUtils.DEFAULT_TAG_GROUPS;
  const DEFAULT_REPAIR_OPTIONS = tagUtils && tagUtils.DEFAULT_REPAIR_OPTIONS;
  const defaultPlanner = tagUtils && tagUtils.planTagGroupRepair;

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

  function normalizeSnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('Snapshot must be an object');
    }
    const normalize = (value, key) => {
      if (value === undefined) return [];
      if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
      return value.filter(record => key === 'settings'
        ? record && record.key !== undefined
        : record && record.id);
    };
    return {
      expenses: normalize(snapshot.expenses, 'expenses'),
      tags: normalize(snapshot.tags, 'tags'),
      settings: normalize(snapshot.settings, 'settings'),
      tagGroups: normalize(snapshot.tagGroups, 'tagGroups')
    };
  }

  function prepareReplacementTagIntegrity(
    snapshot = {},
    planner = defaultPlanner,
    defaultGroups = DEFAULT_TAG_GROUPS,
    repairOptions = DEFAULT_REPAIR_OPTIONS
  ) {
    if (typeof planner !== 'function'
      || !Array.isArray(defaultGroups)
      || !repairOptions) {
      throw new Error('Tag group repair dependency is required');
    }
    const normalized = normalizeSnapshot(snapshot);
    const repairPlan = planner(
      normalized.tags,
      normalized.tagGroups,
      defaultGroups,
      repairOptions
    );
    return {
      ...normalized,
      tags: applyRecordsById(normalized.tags, repairPlan.tagsToUpdate),
      tagGroups: applyRecordsById(
        normalized.tagGroups,
        repairPlan.groupsToAdd
      )
    };
  }

  function prepareMergedTagIntegrity(
    input = {},
    planner = defaultPlanner,
    defaultGroups = DEFAULT_TAG_GROUPS,
    repairOptions = DEFAULT_REPAIR_OPTIONS
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

  function prepareMergeExpected(current = {}, plan = {}, planner = defaultPlanner) {
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
    prepareReplacementTagIntegrity,
    prepareMergedTagIntegrity,
    prepareMergeExpected
  };
});
