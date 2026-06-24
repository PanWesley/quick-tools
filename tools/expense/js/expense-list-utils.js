(function(root) {
  const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function getExpenseMonthKey(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return 'unknown';
    const match = dateStr.match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : 'unknown';
  }

  function formatMonthLabel(monthKey) {
    if (!monthKey || monthKey === 'unknown') return '未设置日期';
    const [year, month] = monthKey.split('-');
    return `${year}年${Number(month)}月`;
  }

  function formatExpenseDay(dateStr) {
    if (!dateStr) return '';
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_NAMES[date.getDay()]}`;
  }

  function groupExpensesByMonth(expenses) {
    return (expenses || []).reduce((groups, expense) => {
      const key = getExpenseMonthKey(expense.date);
      if (!groups[key]) {
        groups[key] = { key, items: [], total: 0 };
      }
      groups[key].items.push(expense);
      groups[key].total += Number(expense.amount) || 0;
      return groups;
    }, {});
  }

  function selectPrimaryExpenseTag(tagIds, tags, preferredGroupId = 'group-category') {
    const tagMap = new Map((tags || []).map(tag => [tag.id, tag]));
    const resolvedTags = (tagIds || []).map(id => tagMap.get(id)).filter(Boolean);
    return resolvedTags.find(tag => tag.parentId === preferredGroupId) || resolvedTags[0] || null;
  }

  function groupExpenseTags(tagIds, tags, groups) {
    const tagMap = new Map((tags || []).map(tag => [tag.id, tag]));
    const groupMap = new Map((groups || []).map(group => [group.id, group]));
    const buckets = new Map();

    for (const id of tagIds || []) {
      const tag = tagMap.get(id);
      if (!tag) continue;
      const group = groupMap.get(tag.parentId);
      const groupId = group ? group.id : 'group-uncategorized';
      const groupName = group ? group.name : '未分类';
      const order = group ? (group.order || 0) : 999;
      if (!buckets.has(groupId)) {
        buckets.set(groupId, { id: groupId, name: groupName, order, tags: [] });
      }
      buckets.get(groupId).tags.push(tag);
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.order - b.order)
      .map(({ order, ...group }) => group);
  }

  function createExpenseDetailView(expense, tags, groups) {
    const record = expense || {};
    return {
      title: record.note || record.category || '未命名',
      amount: `¥${(Number(record.amount) || 0).toFixed(2)}`,
      date: record.date || '',
      dateLabel: formatExpenseDay(record.date),
      category: record.category || '',
      tagGroups: groupExpenseTags(record.tags, tags, groups)
    };
  }

  const api = {
    getExpenseMonthKey,
    formatMonthLabel,
    formatExpenseDay,
    groupExpensesByMonth,
    selectPrimaryExpenseTag,
    groupExpenseTags,
    createExpenseDetailView
  };

  root.ExpenseListUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
