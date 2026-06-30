/**
 * Expense Tracker - Chart Rendering Module
 * Uses Chart.js for data visualization.
 */

// Using global functions from db.js: getExpenses, getTags

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

// Pie chart aggregation mode: 'tag' or 'group'
let pieAggregationMode = 'tag';

window.togglePieMode = function() {
  if (pieAggregationMode === 'tag') {
    pieAggregationMode = 'group';
  } else {
    pieAggregationMode = 'tag';
  }
  const toggleEl = document.getElementById('pie-mode-toggle');
  if (toggleEl) {
    toggleEl.textContent = pieAggregationMode === 'tag' ? '按标签' : '按分组';
  }
  // Re-render
  if (typeof window !== 'undefined' && window._dashboardFilters) {
    updateDashboard(window._dashboardFilters);
  }
};

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
        borderWidth: 2,
        borderColor: isDarkMode() ? '#161b22' : '#ffffff'
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
            pointStyle: 'circle'
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
      cutout: '55%'
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
        backgroundColor: 'rgba(45, 186, 163, 0.12)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: primaryColor,
        pointBorderColor: isDarkMode() ? '#161b22' : '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
            color: getChartTextColor()
          },
          grid: {
            color: getChartGridColor()
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
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.label}: ¥${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: getChartTextColor()
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
    search = ''
  } = filters;

  const { startDate, endDate } = getDateRange(timeRange, customStart, customEnd);

  let expenses = await getExpenses({ startDate, endDate });

  // Apply tag filter (multi-select)
  if (tags && Array.isArray(tags) && tags.length > 0) {
    expenses = expenses.filter(e => {
      const et = e.tags || [];
      return tags.some(t => et.includes(t));
    });
  }

  // Apply amount range filter
  if (minAmount !== null && minAmount !== '') {
    const min = parseFloat(minAmount);
    if (!isNaN(min)) {
      expenses = expenses.filter(e => e.amount >= min);
    }
  }
  if (maxAmount !== null && maxAmount !== '') {
    const max = parseFloat(maxAmount);
    if (!isNaN(max)) {
      expenses = expenses.filter(e => e.amount <= max);
    }
  }

  // Apply search filter
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    expenses = expenses.filter(e => {
      const note = (e.note || '').toLowerCase();
      const cat = (e.category || '').toLowerCase();
      return note.includes(q) || cat.includes(q);
    });
  }

  // Note: Hero dashboard stats are now rendered by renderDashboardHero() in app.js (v1.5.0)

  // Render charts
  const canRenderCharts = await ensureChartLibraryLoaded();
  if (!canRenderCharts) {
    return;
  }

  if (pieAggregationMode === 'group') {
    const pieData = await aggregateByGroup(expenses);
    renderPieChart('categoryChart', pieData);
  } else {
    const pieData = aggregateByTag(expenses);
    renderPieChart('categoryChart', pieData);
  }

  const barData = aggregateTopCategories(expenses, 5);
  renderBarChart('topCategoryChart', barData);

  // Get trend range from user selection
  let lineData;
  const trendRangeEl = document.getElementById('trend-time-range');
  if (trendRangeEl) {
    const trendRange = trendRangeEl.value;
    if (trendRange === 'this-month') {
      const trendDates = getDateRange('this-month');
      lineData = aggregateByDate(expenses, { startDate: trendDates.startDate, endDate: trendDates.endDate });
    } else if (trendRange === 'last-month') {
      const trendDates = getDateRange('last-month');
      lineData = aggregateByDate(expenses, { startDate: trendDates.startDate, endDate: trendDates.endDate });
    } else {
      lineData = aggregateByDate(expenses, 7);
    }
  } else {
    // Default: last 7 days
    lineData = aggregateByDate(expenses, 7);
  }

  // Update title
  const titleEl = document.getElementById('trend-chart-title');
  if (titleEl) {
    if (trendRangeEl && trendRangeEl.value === 'this-month') {
      titleEl.textContent = '本月支出趋势';
    } else if (trendRangeEl && trendRangeEl.value === 'last-month') {
      titleEl.textContent = '上月支出趋势';
    } else {
      titleEl.textContent = '近7天支出趋势';
    }
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

window.updateDashboard = updateDashboard;
window.renderPieChart = renderPieChart;
window.renderLineChart = renderLineChart;
window.renderBarChart = renderBarChart;
window.aggregateByTag = aggregateByTag;
window.aggregateByDate = aggregateByDate;
window.ensureChartLibraryLoaded = ensureChartLibraryLoaded;

/**
 * Handle trend chart time range change.
 */
window.changeTrendRange = function() {
  if (typeof window !== 'undefined' && window._dashboardFilters) {
    updateDashboard(window._dashboardFilters);
  }
};
window.refreshChartTheme = refreshChartTheme;
