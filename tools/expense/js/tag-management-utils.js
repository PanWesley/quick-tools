(function(root) {
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

  function hasDuplicateTagNameInGroup(tags, name, groupId, excludeTagId) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName || !groupId) return false;

    return (tags || []).some(tag => {
      if (!tag || tag.id === excludeTagId) return false;
      const tagGroupId = tag.parentId || 'group-uncategorized';
      return tagGroupId === groupId && String(tag.name || '').trim() === normalizedName;
    });
  }

  const api = {
    DEFAULT_TAG_GROUPS,
    DEFAULT_REPAIR_OPTIONS,
    hasDuplicateTagNameInGroup,
    planTagGroupRepair
  };
  root.TagManagementUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
