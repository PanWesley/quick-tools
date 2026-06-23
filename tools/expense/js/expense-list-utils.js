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

  const api = {
    getExpenseMonthKey,
    formatMonthLabel,
    formatExpenseDay,
    groupExpensesByMonth
  };

  root.ExpenseListUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
