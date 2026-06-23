(function(root) {
  function planTagGroupRepair(tags, groups, defaultGroups, options = {}) {
    const defaultTagParentId = options.defaultTagParentId || 'group-category';
    const fallbackGroupId = options.fallbackGroupId || 'group-uncategorized';
    const existingGroupIds = new Set((groups || []).map(group => group.id));
    const defaultGroupIds = new Set((defaultGroups || []).map(group => group.id));
    const repairedGroupIds = new Set([...existingGroupIds, ...defaultGroupIds]);

    const groupsToAdd = (defaultGroups || []).filter(group => !existingGroupIds.has(group.id));
    const tagsToUpdate = [];

    for (const tag of tags || []) {
      const originalParentId = tag.parentId;
      let parentId = originalParentId;

      if (!parentId) {
        parentId = repairedGroupIds.has(defaultTagParentId) ? defaultTagParentId : fallbackGroupId;
      } else if (!repairedGroupIds.has(parentId)) {
        parentId = repairedGroupIds.has(fallbackGroupId) ? fallbackGroupId : defaultTagParentId;
      }

      if (parentId !== originalParentId) {
        tagsToUpdate.push({ ...tag, parentId });
      }
    }

    return { groupsToAdd, tagsToUpdate };
  }

  const api = { planTagGroupRepair };
  root.TagManagementUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
