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

  function normalizeDateOnly(value) {
    if (!value) return '';
    const dateText = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : '';
  }

  function toLocalDate(value) {
    const dateText = normalizeDateOnly(value);
    if (!dateText) return null;
    const date = new Date(`${dateText}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function buildTagUsageStats(expenses, now = new Date(), recentDays = 90) {
    const stats = {};
    const today = new Date(now);
    today.setHours(23, 59, 59, 999);
    const recentStart = new Date(today);
    recentStart.setHours(0, 0, 0, 0);
    recentStart.setDate(recentStart.getDate() - Math.max(0, recentDays - 1));

    for (const expense of expenses || []) {
      if (!expense || !Array.isArray(expense.tags)) continue;
      const dateText = normalizeDateOnly(expense.date);
      const expenseDate = toLocalDate(dateText);
      const isRecent = expenseDate && expenseDate >= recentStart && expenseDate <= today;

      for (const tagId of expense.tags) {
        if (!tagId) continue;
        if (!stats[tagId]) {
          stats[tagId] = { recent: 0, total: 0, lastUsed: '' };
        }
        stats[tagId].total += 1;
        if (isRecent) stats[tagId].recent += 1;
        if (dateText && dateText > stats[tagId].lastUsed) {
          stats[tagId].lastUsed = dateText;
        }
      }
    }

    return stats;
  }

  function getTagUsage(stats, tagId) {
    return (stats && stats[tagId]) || { recent: 0, total: 0, lastUsed: '' };
  }

  function sortTagsForPicker(tags, usageStats, selectedIds, locale = 'zh-CN') {
    const selectedOrder = new Map((selectedIds || []).map((id, index) => [id, index]));
    return [...(tags || [])].sort((a, b) => {
      const aSelected = selectedOrder.has(a.id);
      const bSelected = selectedOrder.has(b.id);
      if (aSelected || bSelected) {
        if (aSelected && bSelected) {
          return selectedOrder.get(a.id) - selectedOrder.get(b.id);
        }
        return aSelected ? -1 : 1;
      }

      const aUsage = getTagUsage(usageStats, a.id);
      const bUsage = getTagUsage(usageStats, b.id);
      if (aUsage.recent !== bUsage.recent) return bUsage.recent - aUsage.recent;
      if (aUsage.total !== bUsage.total) return bUsage.total - aUsage.total;
      if (aUsage.lastUsed !== bUsage.lastUsed) {
        return bUsage.lastUsed.localeCompare(aUsage.lastUsed);
      }
      return String(a.name || '').localeCompare(String(b.name || ''), locale);
    });
  }

  const api = {
    DEFAULT_TAG_GROUPS,
    DEFAULT_REPAIR_OPTIONS,
    buildTagUsageStats,
    hasDuplicateTagNameInGroup,
    planTagGroupRepair,
    sortTagsForPicker
  };
  root.TagManagementUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
