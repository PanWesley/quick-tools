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

  function getExpenseCreatedOrder(expense) {
    if (!expense) return 0;
    const createdAt = Date.parse(expense.createdAt || '');
    if (!Number.isNaN(createdAt)) return createdAt;
    const idMatch = String(expense.id || '').match(/^exp_(\d+)/);
    return idMatch ? Number(idMatch[1]) : 0;
  }

  function compareExpenseCreatedDesc(a, b) {
    return getExpenseCreatedOrder(b) - getExpenseCreatedOrder(a);
  }

  function sortExpensesForList(expenses, sortValue = 'date-desc') {
    const list = [...(expenses || [])];
    switch (sortValue) {
      case 'date-asc':
        return list.sort((a, b) => {
          const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
          return dateCompare || compareExpenseCreatedDesc(a, b);
        });
      case 'amount-desc':
        return list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
      case 'amount-asc':
        return list.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
      default:
        return list.sort((a, b) => {
          const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
          return dateCompare || compareExpenseCreatedDesc(a, b);
        });
    }
  }

  function selectPrimaryExpenseTag(tagIds, tags, preferredGroupId = 'group-category') {
    const tagMap = new Map((tags || []).map(tag => [tag.id, tag]));
    const resolvedTags = (tagIds || []).map(id => tagMap.get(id)).filter(Boolean);
    return resolvedTags.find(tag => tag.parentId === preferredGroupId) || resolvedTags[0] || null;
  }

  function expenseMatchesCategoryFilter(expense, filterValue, tags) {
    if (!filterValue) return true;
    const record = expense || {};
    const value = String(filterValue);
    if (value.startsWith('tag:')) {
      const tagId = value.slice(4);
      if ((record.tags || []).includes(tagId)) return true;
      const tag = (tags || []).find(item => item.id === tagId);
      return Boolean(tag && record.category === tag.name);
    }
    return record.category === value || (record.tags || []).some(tid => {
      const tag = (tags || []).find(item => item.id === tid);
      return tag && tag.name === value;
    });
  }

  function expenseMatchesCategoryFilters(expense, filterValues, tags) {
    const values = Array.isArray(filterValues)
      ? filterValues.filter(Boolean)
      : (filterValues ? [filterValues] : []);
    if (values.length === 0) return true;
    return values.some(value => expenseMatchesCategoryFilter(expense, value, tags));
  }

  function formatCategoryFilterLabel(selectedTagIds, tags) {
    const ids = Array.isArray(selectedTagIds) ? selectedTagIds.filter(Boolean) : [];
    if (ids.length === 0) return '全部分类';
    if (ids.length === 1) {
      const tag = (tags || []).find(item => item.id === ids[0]);
      return tag ? tag.name : '已选 1 个分类';
    }
    return `已选 ${ids.length} 个分类`;
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

  function getExpenseGestureResult({
    pointerType,
    deltaX = 0,
    deltaY = 0,
    allowMouseSwipe = false
  } = {}) {
    if (pointerType === 'mouse' && !allowMouseSwipe) {
      return { action: 'none', suppressClick: false };
    }

    const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8;
    if (!isHorizontalSwipe) {
      return { action: 'none', suppressClick: false };
    }

    if (deltaX < -56) {
      return { action: 'open', suppressClick: true };
    }
    if (deltaX > 24) {
      return { action: 'close', suppressClick: true };
    }
    return { action: 'none', suppressClick: true };
  }

  function shouldSuppressExpenseClick(suppressUntil, now = Date.now(), isActionButton = false) {
    return !isActionButton && Number(suppressUntil) > Number(now);
  }

  const api = {
    getExpenseMonthKey,
    formatMonthLabel,
    formatExpenseDay,
    groupExpensesByMonth,
    sortExpensesForList,
    selectPrimaryExpenseTag,
    expenseMatchesCategoryFilter,
    expenseMatchesCategoryFilters,
    formatCategoryFilterLabel,
    groupExpenseTags,
    createExpenseDetailView,
    getExpenseGestureResult,
    shouldSuppressExpenseClick
  };

  root.ExpenseListUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
