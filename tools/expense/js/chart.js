/**
 * Expense Tracker - Chart Rendering Module
 * Uses Chart.js for data visualization.
 */

// Using global functions from db.js: getExpenses, getTags, getTagGroups

// Keep chart instances for cleanup
const chartInstances = {};
const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
let chartLibraryPromise = null;

function ensureChartLibraryLoaded() {
  if (typeof Chart !== 'undefined') {
    return Promise.resolve(true);
  }
  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }
  if (!chartLibraryPromise) {
    chartLibraryPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = CHART_JS_URL;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        chartLibraryPromise = null;
        console.warn('[Expense Charts] Chart.js failed to load');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }
  return chartLibraryPromise;
}

const DASHBOARD_ALL_GROUPS = 'all-groups';
const DASHBOARD_DEFAULT_GROUP = 'group-category';
const FALLBACK_UNCATEGORIZED_GROUP = {
  id: 'group-uncategorized',
  name: '未分类',
  color: '#95a5a6',
  order: 99
};
const chartPalette = [
  '#e74c3c', '#3498db', '#f39c12', '#9b59b6', '#2ecc71',
  '#e67e22', '#1abc9c', '#95a5a6', '#34495e', '#d35400'
];

function getTagGroupId(tag) {
  return tag && tag.parentId ? tag.parentId : 'group-uncategorized';
}

function findTag(tags, tagId) {
  return (tags || []).find(tag => tag.id === tagId);
}

function findGroup(groups, groupId) {
  return (groups || []).find(group => group.id === groupId)
    || (groupId === FALLBACK_UNCATEGORIZED_GROUP.id ? FALLBACK_UNCATEGORIZED_GROUP : null);
}

function addBreakdownAmount(bucket, id, label, color, amount) {
  if (!bucket[id]) {
    bucket[id] = {
      id,
      label,
      color,
      amount: 0
    };
  }
  bucket[id].amount += amount || 0;
}

function sortBreakdownEntries(entries) {
  return entries.sort((a, b) => b.amount - a.amount);
}

function toBreakdownResult(entries, topN = null) {
  const sorted = sortBreakdownEntries(entries.slice());
  const sliced = topN ? sorted.slice(0, topN) : sorted;
  return {
    ids: sliced.map(item => item.id),
    labels: sliced.map(item => item.label),
    data: sliced.map(item => Number(item.amount.toFixed(2))),
    colors: sliced.map((item, index) => item.color || chartPalette[index % chartPalette.length])
  };
}

/**
 * Aggregate expenses by tag/category.
 * @param {Array} expenses
 * @param {Array|null} tagFilter - array of selected tag ids, or null for all
 * @returns {Object} { labels: [], data: [], colors: [] }
 */
function aggregateByTag(expenses, tagFilter = null) {
  const tagMap = {};
  const tagColors = {};

  for (const exp of expenses) {
    const cat = exp.category || '未分类';
    if (!tagMap[cat]) {
      tagMap[cat] = 0;
    }
    tagMap[cat] += exp.amount || 0;
  }

  // Sort by amount desc
  const sorted = Object.entries(tagMap).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const data = sorted.map(([, v]) => v);

  // Generate colors
  const palette = [
    '#e74c3c', '#3498db', '#f39c12', '#9b59b6', '#2ecc71',
    '#e67e22', '#1abc9c', '#95a5a6', '#34495e', '#d35400'
  ];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  return { labels, data, colors };
}

/**
 * Aggregate expenses by tag group.
 * @param {Array} expenses
 * @returns {Object} { labels: [], data: [], colors: [] }
 */
async function aggregateByGroup(expenses) {
  const allTags = await getTags();
  const allTagGroups = await getTagGroups();

  // Build tag ID -> group lookup
  const tagGroupMap = {};
  for (const tag of allTags) {
    tagGroupMap[tag.id] = tag.parentId || 'group-uncategorized';
  }

  const groupAmounts = {};
  for (const exp of expenses) {
    const expTags = exp.tags || [];
    if (expTags.length === 0) {
      // No tags: attribute to uncategorized group
      groupAmounts['group-uncategorized'] = (groupAmounts['group-uncategorized'] || 0) + (exp.amount || 0);
      continue;
    }

    // Split amount evenly across tag groups
    const uniqueGroups = new Set();
    for (const tid of expTags) {
      const gid = tagGroupMap[tid] || 'group-uncategorized';
      uniqueGroups.add(gid);
    }
    const splitAmount = (exp.amount || 0) / uniqueGroups.size;
    for (const gid of uniqueGroups) {
      groupAmounts[gid] = (groupAmounts[gid] || 0) + splitAmount;
    }
  }

  // Map group IDs to names and colors
  const sorted = Object.entries(groupAmounts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([gid]) => {
    const group = allTagGroups.find(g => g.id === gid);
    return group ? group.name : '未分类';
  });
  const data = sorted.map(([, v]) => v);
  const colors = sorted.map(([gid]) => {
    const group = allTagGroups.find(g => g.id === gid);
    return group ? group.color : '#95a5a6';
  });

  return { labels, data, colors };
}

function filterDashboardExpenses(expenses, filters = {}, context = {}) {
  const {
    startDate = null,
    endDate = null,
    tags: selectedTags = null,
    minAmount = null,
    maxAmount = null,
    search = ''
  } = filters;
  const knownTags = context.tags || [];

  return (expenses || []).filter(expense => {
    if (startDate && expense.date < startDate) return false;
    if (endDate && expense.date > endDate) return false;

    if (selectedTags && Array.isArray(selectedTags) && selectedTags.length > 0) {
      const expenseTags = expense.tags || [];
      if (!selectedTags.some(tagId => expenseTags.includes(tagId))) return false;
    }

    if (minAmount !== null && minAmount !== '') {
      const min = parseFloat(minAmount);
      if (!Number.isNaN(min) && (expense.amount || 0) < min) return false;
    }

    if (maxAmount !== null && maxAmount !== '') {
      const max = parseFloat(maxAmount);
      if (!Number.isNaN(max) && (expense.amount || 0) > max) return false;
    }

    if (search && search.trim()) {
      const query = search.trim().toLowerCase();
      const note = (expense.note || '').toLowerCase();
      const category = (expense.category || '').toLowerCase();
      const tagText = (expense.tags || [])
        .map(tagId => findTag(knownTags, tagId))
        .filter(Boolean)
        .map(tag => tag.name || '')
        .join(' ')
        .toLowerCase();
      if (!note.includes(query) && !category.includes(query) && !tagText.includes(query)) {
        return false;
      }
    }

    return true;
  });
}

function aggregateDashboardBreakdown(expenses, options = {}) {
  const tags = options.tags || [];
  const groups = options.groups || [];
  const analysisGroupId = options.analysisGroupId || DASHBOARD_DEFAULT_GROUP;
  const topN = options.topN || null;
  const tagLookup = {};
  tags.forEach(tag => {
    tagLookup[tag.id] = tag;
  });

  const amounts = {};

  for (const expense of expenses || []) {
    const amount = expense.amount || 0;
    const expenseTagIds = Array.isArray(expense.tags) ? expense.tags : [];

    if (analysisGroupId === DASHBOARD_ALL_GROUPS) {
      if (expenseTagIds.length === 0) {
        addBreakdownAmount(
          amounts,
          FALLBACK_UNCATEGORIZED_GROUP.id,
          FALLBACK_UNCATEGORIZED_GROUP.name,
          FALLBACK_UNCATEGORIZED_GROUP.color,
          amount
        );
        continue;
      }

      const uniqueGroupIds = [];
      expenseTagIds.forEach(tagId => {
        const tag = tagLookup[tagId];
        const groupId = tag ? getTagGroupId(tag) : FALLBACK_UNCATEGORIZED_GROUP.id;
        if (!uniqueGroupIds.includes(groupId)) uniqueGroupIds.push(groupId);
      });

      const splitAmount = uniqueGroupIds.length > 0 ? amount / uniqueGroupIds.length : amount;
      uniqueGroupIds.forEach(groupId => {
        const group = findGroup(groups, groupId) || FALLBACK_UNCATEGORIZED_GROUP;
        addBreakdownAmount(amounts, group.id, group.name, group.color, splitAmount);
      });
      continue;
    }

    const matchingTags = expenseTagIds
      .map(tagId => tagLookup[tagId])
      .filter(tag => tag && getTagGroupId(tag) === analysisGroupId);

    if (matchingTags.length === 0) {
      if (analysisGroupId === FALLBACK_UNCATEGORIZED_GROUP.id && expenseTagIds.length === 0) {
        addBreakdownAmount(
          amounts,
          FALLBACK_UNCATEGORIZED_GROUP.id,
          FALLBACK_UNCATEGORIZED_GROUP.name,
          FALLBACK_UNCATEGORIZED_GROUP.color,
          amount
        );
      }
      continue;
    }

    const splitAmount = amount / matchingTags.length;
    matchingTags.forEach(tag => {
      addBreakdownAmount(amounts, tag.id, tag.name, tag.color, splitAmount);
    });
  }

  return toBreakdownResult(Object.values(amounts), topN);
}

/**
 * Aggregate expenses by date for trend.
 * @param {Array} expenses
 * @param {number} days - number of days to look back
 * @returns {Object} { labels: [], data: [] }
 */
function aggregateByDate(expenses, rangeOrDays = 7) {
  let start, end;

  if (typeof rangeOrDays === 'number') {
    // Days mode: last N days
    end = new Date();
    start = new Date();
    start.setDate(end.getDate() - rangeOrDays + 1);
  } else if (typeof rangeOrDays === 'object' && rangeOrDays.startDate && rangeOrDays.endDate) {
    // Date range mode: specific start/end dates
    start = new Date(rangeOrDays.startDate + 'T00:00:00');
    end = new Date(rangeOrDays.endDate + 'T00:00:00');
  } else {
    // Default: last 7 days
    end = new Date();
    start = new Date();
    start.setDate(end.getDate() - 6);
  }

  // Initialize all days with 0
  const dateMap = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    dateMap[key] = 0;
  }

  for (const exp of expenses) {
    if (exp.date && dateMap.hasOwnProperty(exp.date)) {
      dateMap[exp.date] += exp.amount || 0;
    }
  }

  const sortedDates = Object.keys(dateMap).sort();
  const labels = sortedDates.map(d => {
    const md = d.slice(5).replace('-', '/');
    return md;
  });
  const data = sortedDates.map(d => dateMap[d]);

  return { labels, data };
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getInclusiveDayCount(startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return Math.floor((end - start) / 86400000) + 1;
}

function aggregateDashboardTrend(expenses, options = {}) {
  const { startDate, endDate } = options;
  if (!startDate || !endDate) {
    return { labels: [], data: [] };
  }

  const byMonth = getInclusiveDayCount(startDate, endDate) > 45;
  const amountMap = {};

  if (byMonth) {
    const cursor = new Date(parseDateOnly(startDate).getFullYear(), parseDateOnly(startDate).getMonth(), 1);
    const end = parseDateOnly(endDate);
    while (cursor <= end) {
      amountMap[formatMonthKey(cursor)] = 0;
      cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const expense of expenses || []) {
      if (!expense.date || expense.date < startDate || expense.date > endDate) continue;
      const key = expense.date.slice(0, 7);
      if (Object.prototype.hasOwnProperty.call(amountMap, key)) {
        amountMap[key] += expense.amount || 0;
      }
    }

    const labels = Object.keys(amountMap).sort();
    return {
      labels: labels.map(label => label.replace('-', '/')),
      data: labels.map(label => Number(amountMap[label].toFixed(2)))
    };
  }

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    amountMap[formatDateKey(cursor)] = 0;
  }

  for (const expense of expenses || []) {
    if (expense.date && Object.prototype.hasOwnProperty.call(amountMap, expense.date)) {
      amountMap[expense.date] += expense.amount || 0;
    }
  }

  const labels = Object.keys(amountMap).sort();
  return {
    labels: labels.map(label => label.slice(5).replace('-', '/')),
    data: labels.map(label => Number(amountMap[label].toFixed(2)))
  };
}

function clampRatio(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sumExpenseAmount(expenses) {
  return (expenses || []).reduce((sum, expense) => sum + (expense.amount || 0), 0);
}

function formatCurrencyValue(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function formatHeatmapAmountLabel(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (amount >= 10000) {
    return `¥${Math.round(amount / 1000)}k`;
  }
  if (amount >= 1000) {
    return `¥${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `¥${Math.round(amount)}`;
}

function formatSignedCurrencyDelta(value) {
  const amount = Number(value || 0);
  const abs = formatCurrencyValue(Math.abs(amount));
  return amount >= 0 ? `多 ${abs}` : `少 ${abs}`;
}

function buildSpendingPace(expenses, options = {}) {
  const { startDate, endDate, now = formatDateKey(new Date()), referenceTotal = null } = options;
  const total = Number(sumExpenseAmount(expenses).toFixed(2));
  const rangeDays = startDate && endDate ? Math.max(1, getInclusiveDayCount(startDate, endDate)) : 1;
  const clampedNow = !startDate || now < startDate ? startDate : (!endDate || now <= endDate ? now : endDate);
  const elapsedDays = startDate && clampedNow ? Math.max(1, getInclusiveDayCount(startDate, clampedNow)) : rangeDays;
  const elapsedRatio = clampRatio(elapsedDays / rangeDays);
  const hasReference = referenceTotal !== null && referenceTotal > 0;
  const baseline = hasReference ? referenceTotal : total;
  const spendingRatio = hasReference && baseline > 0 ? clampRatio(total / baseline) : elapsedRatio;
  const delta = spendingRatio - elapsedRatio;
  const status = hasReference && delta > 0.1 ? 'ahead' : (hasReference && delta < -0.1 ? 'behind' : 'steady');
  const expectedTotal = hasReference ? Number((baseline * elapsedRatio).toFixed(2)) : null;
  const amountDelta = hasReference ? Number((total - expectedTotal).toFixed(2)) : null;

  return {
    total,
    referenceTotal: Number((baseline || 0).toFixed(2)),
    hasReference,
    rangeDays,
    elapsedDays,
    remainingDays: Math.max(0, rangeDays - elapsedDays),
    expectedTotal,
    amountDelta,
    dailyAverage: Number((total / Math.max(1, elapsedDays)).toFixed(2)),
    elapsedRatio,
    spendingRatio,
    elapsedPercent: Math.round(elapsedRatio * 100),
    spendingPercent: Math.round(spendingRatio * 100),
    status,
    label: status === 'ahead' ? '支出偏快' : (status === 'behind' ? '支出偏慢' : '节奏平稳')
  };
}

function buildSpendingPlainSummary(pace = {}) {
  const total = Number(pace.total || 0);
  const titleMap = {
    ahead: '花得有点快',
    behind: '花得比较省',
    steady: '和往常差不多'
  };
  const title = pace.hasReference ? (titleMap[pace.status] || '和往常差不多') : '先记几天再判断';
  const summary = pace.hasReference
    ? `本期已花 ${formatCurrencyValue(total)}，比参考进度${formatSignedCurrencyDelta(pace.amountDelta || 0)}`
    : `本期已花 ${formatCurrencyValue(total)}，暂无上期数据可比较`;

  return {
    title,
    summary,
    dailyAverage: `日均 ${formatCurrencyValue(pace.dailyAverage || 0)}`,
    remaining: `还剩 ${Number(pace.remainingDays || 0)} 天`
  };
}

function buildCalendarHeatmap(expenses, options = {}) {
  const { startDate, endDate, now = formatDateKey(new Date()), monthModeThreshold = 62 } = options;
  if (!startDate || !endDate) {
    return { mode: 'day', days: [], months: [], maxDailyTotal: 0, maxMonthlyTotal: 0 };
  }

  const dailyTotals = {};
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const rangeDays = Math.max(1, getInclusiveDayCount(startDate, endDate));

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dailyTotals[formatDateKey(cursor)] = 0;
  }

  for (const expense of expenses || []) {
    if (expense.date && Object.prototype.hasOwnProperty.call(dailyTotals, expense.date)) {
      dailyTotals[expense.date] += expense.amount || 0;
    }
  }

  if (rangeDays > monthModeThreshold) {
    const monthlyTotals = {};
    for (let cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
      monthlyTotals[formatDateKey(cursor).slice(0, 7)] = 0;
    }
    for (const [date, total] of Object.entries(dailyTotals)) {
      const month = date.slice(0, 7);
      monthlyTotals[month] = (monthlyTotals[month] || 0) + total;
    }
    const maxMonthlyTotal = Math.max(0, ...Object.values(monthlyTotals));
    const nowMonth = now.slice(0, 7);
    const months = Object.keys(monthlyTotals).sort().map(month => {
      const total = Number(monthlyTotals[month].toFixed(2));
      return {
        month,
        label: `${Number(month.slice(5, 7))}月`,
        total,
        intensity: maxMonthlyTotal > 0 ? Number((total / maxMonthlyTotal).toFixed(2)) : 0,
        isCurrentMonth: month === nowMonth
      };
    });

    return {
      mode: 'month',
      days: [],
      months,
      maxDailyTotal: 0,
      maxMonthlyTotal: Number(maxMonthlyTotal.toFixed(2))
    };
  }

  const maxDailyTotal = Math.max(0, ...Object.values(dailyTotals));
  const days = Object.keys(dailyTotals).sort().map(date => {
    const total = Number(dailyTotals[date].toFixed(2));
    return {
      date,
      day: Number(date.slice(8, 10)),
      weekday: parseDateOnly(date).getDay(),
      total,
      intensity: maxDailyTotal > 0 ? Number((total / maxDailyTotal).toFixed(2)) : 0,
      isToday: date === now
    };
  });

  return {
    mode: 'day',
    days,
    months: [],
    maxMonthlyTotal: 0,
    maxDailyTotal: Number(maxDailyTotal.toFixed(2))
  };
}

function groupExpensesByDate(expenses) {
  const grouped = {};
  for (const expense of expenses || []) {
    if (!expense.date) continue;
    grouped[expense.date] = (grouped[expense.date] || 0) + (expense.amount || 0);
  }
  return grouped;
}

function buildDashboardInsightCards(expenses, options = {}) {
  const cards = [];
  const currentExpenses = expenses || [];
  if (currentExpenses.length === 0) {
    return [];
  }

  const dailyTotals = groupExpensesByDate(currentExpenses);
  const activeDailyTotals = Object.entries(dailyTotals)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => b.total - a.total);
  const maxDay = activeDailyTotals[0];
  const activeAverage = activeDailyTotals.length > 0
    ? activeDailyTotals.reduce((sum, day) => sum + day.total, 0) / activeDailyTotals.length
    : 0;

  if (maxDay && maxDay.total > 0 && maxDay.total >= activeAverage * 1.5) {
    cards.push({
      type: 'heavy-day',
      title: '高支出日',
      value: formatCurrencyValue(maxDay.total),
      detail: `${maxDay.date.slice(5).replace('-', '月')}日明显高于日均`
    });
  }

  const largestExpense = currentExpenses
    .slice()
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];
  if (largestExpense && largestExpense.amount > 0) {
    cards.push({
      type: 'large-expense',
      title: '最大单笔',
      value: formatCurrencyValue(largestExpense.amount),
      detail: largestExpense.note || largestExpense.category || largestExpense.date || '一笔较大的支出'
    });
  }

  const previousExpenses = options.previousExpenses || [];
  if (previousExpenses.length > 0) {
    const currentBreakdown = aggregateDashboardBreakdown(currentExpenses, {
      tags: options.tags || [],
      groups: options.groups || [],
      analysisGroupId: options.analysisGroupId || DASHBOARD_DEFAULT_GROUP
    });
    const previousBreakdown = aggregateDashboardBreakdown(previousExpenses, {
      tags: options.tags || [],
      groups: options.groups || [],
      analysisGroupId: options.analysisGroupId || DASHBOARD_DEFAULT_GROUP
    });
    const previousById = {};
    previousBreakdown.ids.forEach((id, index) => {
      previousById[id] = previousBreakdown.data[index] || 0;
    });

    const increases = currentBreakdown.ids.map((id, index) => {
      const current = currentBreakdown.data[index] || 0;
      const previous = previousById[id] || 0;
      return {
        id,
        label: currentBreakdown.labels[index],
        current,
        previous,
        increase: current - previous,
        ratio: previous > 0 ? (current - previous) / previous : (current > 0 ? 1 : 0)
      };
    }).filter(item => item.increase > 0 && item.ratio >= 0.25)
      .sort((a, b) => b.increase - a.increase)[0];

    if (increases) {
      cards.push({
        type: 'rising-category',
        title: '上涨最多',
        value: `+${formatCurrencyValue(increases.increase)}`,
        detail: `${increases.label} 比上期更高`
      });
    }
  }

  return cards.slice(0, 3);
}

/**
 * Get top N spending categories.
 * @param {Array} expenses
 * @param {number} topN
 * @returns {Object} { labels: [], data: [], colors: [] }
 */
function aggregateTopCategories(expenses, topN = 5) {
  const result = aggregateByTag(expenses);
  return {
    labels: result.labels.slice(0, topN),
    data: result.data.slice(0, topN),
    colors: result.colors.slice(0, topN)
  };
}

/**
 * Destroy existing chart on a canvas.
 * @param {string} canvasId
 */
function destroyChart(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }
}

/**
 * Detect dark mode.
 */
function isDarkMode() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function getChartTextColor() {
  return isDarkMode() ? '#c9d1d9' : '#2c3e50';
}

function getChartGridColor() {
  return isDarkMode() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
}

/**
 * Render pie chart for category distribution.
 * @param {string} canvasId
 * @param {Object} data - { labels, data, colors }
 */
function renderPieChart(canvasId, data) {
  if (typeof Chart === 'undefined') return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.labels,
      datasets: [{
        data: data.data,
        backgroundColor: data.colors,
        borderWidth: 3,
        borderColor: isDarkMode() ? '#161b22' : '#ffffff',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: getChartTextColor(),
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return ` ${context.label}: ¥${val.toFixed(2)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '64%',
      layout: {
        padding: 4
      }
    }
  });
}

/**
 * Render line chart for spending trend.
 * @param {string} canvasId
 * @param {Object} data - { labels, data }
 */
function renderLineChart(canvasId, data) {
  if (typeof Chart === 'undefined') return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const primaryColor = '#2DBAA3';

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: '支出金额',
        data: data.data,
        borderColor: primaryColor,
        backgroundColor: 'rgba(45, 186, 163, 0.14)',
        fill: true,
        tension: 0.42,
        pointBackgroundColor: primaryColor,
        pointBorderColor: isDarkMode() ? '#161b22' : '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` 支出: ¥${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: getChartTextColor(),
            maxRotation: 0
          },
          grid: {
            display: false
          }
        },
        y: {
          ticks: {
            color: getChartTextColor(),
            callback: function(value) {
              return '¥' + value;
            }
          },
          grid: {
            color: getChartGridColor()
          },
          beginAtZero: true
        }
      }
    }
  });
}

/**
 * Render bar chart for top categories.
 * @param {string} canvasId
 * @param {Object} data - { labels, data, colors }
 */
function renderBarChart(canvasId, data) {
  if (typeof Chart === 'undefined') return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: '支出金额',
        data: data.data,
        backgroundColor: data.colors,
        borderRadius: 8,
        barThickness: 18,
        maxBarThickness: 22,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.label}: ¥${context.parsed.x.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: getChartTextColor(),
            callback: function(value) {
              return '¥' + value;
            }
          },
          grid: {
            color: getChartGridColor()
          },
          beginAtZero: true
        },
        y: {
          ticks: {
            color: getChartTextColor()
          },
          grid: {
            display: false
          }
        }
      }
    }
  });
}

/**
 * Compute date range from time range filter value.
 * @param {string} range - this-month, last-month, last-7, last-30, this-year, custom
 * @param {string|null} customStart
 * @param {string|null} customEnd
 * @returns {Object} { startDate, endDate }
 */
function getDateRange(range, customStart = null, customEnd = null) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  let start = end;

  switch (range) {
    case 'this-month': {
      start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      break;
    }
    case 'last-month': {
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      start = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: start, endDate: lastDay.toISOString().slice(0, 10) };
    }
    case 'last-7': {
      const d7 = new Date(today);
      d7.setDate(d7.getDate() - 6);
      start = d7.toISOString().slice(0, 10);
      break;
    }
    case 'last-30': {
      const d30 = new Date(today);
      d30.setDate(d30.getDate() - 29);
      start = d30.toISOString().slice(0, 10);
      break;
    }
    case 'this-year': {
      start = `${today.getFullYear()}-01-01`;
      break;
    }
    case 'custom': {
      if (customStart && customEnd) {
        return { startDate: customStart, endDate: customEnd };
      }
      break;
    }
  }

  return { startDate: start, endDate: end };
}

function getDateRangeLabel(range) {
  const labels = {
    'this-month': '本月',
    'last-month': '上月',
    'last-7': '最近7天',
    'last-30': '最近30天',
    'this-year': '今年',
    custom: '自定义'
  };
  return labels[range] || '当前筛选';
}

/**
 * Main function: update all dashboard charts and stats.
 * @param {Object} filters
 */
async function updateDashboard(filters = {}) {
  const {
    timeRange = 'this-month',
    customStart = null,
    customEnd = null,
    tags = null,
    minAmount = null,
    maxAmount = null,
    search = '',
    analysisGroupId = DASHBOARD_DEFAULT_GROUP
  } = filters;

  const { startDate, endDate } = getDateRange(timeRange, customStart, customEnd);
  const [rawExpenses, chartTags, chartGroups] = await Promise.all([
    getExpenses({ startDate, endDate }),
    typeof getTags === 'function' ? getTags() : Promise.resolve([]),
    typeof getTagGroups === 'function' ? getTagGroups() : Promise.resolve([])
  ]);
  const expenses = filterDashboardExpenses(rawExpenses, {
    startDate,
    endDate,
    tags,
    minAmount,
    maxAmount,
    search
  }, { tags: chartTags });

  if (typeof window !== 'undefined') {
    window._dashboardFilteredExpenses = expenses;
    window._dashboardDateRange = { startDate, endDate };
  }

  // Note: Hero dashboard stats are now rendered by renderDashboardHero() in app.js (v1.5.0)

  const canRenderCharts = await ensureChartLibraryLoaded();
  if (!canRenderCharts) {
    return;
  }

  const pieData = aggregateDashboardBreakdown(expenses, {
    tags: chartTags,
    groups: chartGroups,
    analysisGroupId
  });
  renderPieChart('categoryChart', pieData);

  const barData = aggregateDashboardBreakdown(expenses, {
    tags: chartTags,
    groups: chartGroups,
    analysisGroupId,
    topN: 5
  });
  renderBarChart('topCategoryChart', barData);

  const lineData = aggregateDashboardTrend(expenses, { startDate, endDate });

  // Update title
  const titleEl = document.getElementById('trend-chart-title');
  if (titleEl) {
    titleEl.textContent = `${getDateRangeLabel(timeRange)}支出趋势`;
  }

  renderLineChart('trendChart', lineData);
}

/**
 * Re-render existing charts with current theme colors.
 */
function refreshChartTheme() {
  // Trigger dashboard update to re-render with new colors
  // This is called from app.js when theme toggles
  const dashboardView = typeof document !== 'undefined'
    ? document.getElementById('view-dashboard')
    : null;
  if (typeof window !== 'undefined' && window._dashboardFilters && dashboardView && dashboardView.classList.contains('active')) {
    updateDashboard(window._dashboardFilters);
  }
}

if (typeof window !== 'undefined') {
  window.updateDashboard = updateDashboard;
  window.renderPieChart = renderPieChart;
  window.renderLineChart = renderLineChart;
  window.renderBarChart = renderBarChart;
  window.aggregateByTag = aggregateByTag;
  window.aggregateByDate = aggregateByDate;
  window.ensureChartLibraryLoaded = ensureChartLibraryLoaded;
  window.filterDashboardExpenses = filterDashboardExpenses;
  window.aggregateDashboardBreakdown = aggregateDashboardBreakdown;
  window.aggregateDashboardTrend = aggregateDashboardTrend;
  window.buildSpendingPace = buildSpendingPace;
  window.buildSpendingPlainSummary = buildSpendingPlainSummary;
  window.buildCalendarHeatmap = buildCalendarHeatmap;
  window.formatHeatmapAmountLabel = formatHeatmapAmountLabel;
  window.buildDashboardInsightCards = buildDashboardInsightCards;
  window.getDateRange = getDateRange;
  window.getDateRangeLabel = getDateRangeLabel;
  window.DASHBOARD_ALL_GROUPS = DASHBOARD_ALL_GROUPS;
  window.DASHBOARD_DEFAULT_GROUP = DASHBOARD_DEFAULT_GROUP;
  window.changeTrendRange = function() {
    if (window._dashboardFilters) {
      updateDashboard(window._dashboardFilters);
    }
  };
  window.refreshChartTheme = refreshChartTheme;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DASHBOARD_ALL_GROUPS,
    DASHBOARD_DEFAULT_GROUP,
    filterDashboardExpenses,
    aggregateDashboardBreakdown,
    aggregateDashboardTrend,
    buildSpendingPace,
    buildSpendingPlainSummary,
    buildCalendarHeatmap,
    formatHeatmapAmountLabel,
    buildDashboardInsightCards,
    getDateRange,
    getDateRangeLabel
  };
}
