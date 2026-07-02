(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AnalyticsDashboardUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const TOOL_LABELS = {
    home: '首页',
    diff: '文本对比',
    json: 'JSON 工具',
    expense: '生活账单',
    time: '今日有序',
    unknown: '未知页面'
  };

  function formatInteger(value) {
    return String(Number(value) || 0);
  }

  function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    if (totalSeconds < 60) {
      return `${totalSeconds}秒`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (!hours) {
      return `${minutes}分钟`;
    }
    return remainingMinutes ? `${hours}小时${remainingMinutes}分钟` : `${hours}小时`;
  }

  function getLatestDailySummary(daily) {
    const rows = Array.isArray(daily) ? daily.slice() : [];
    rows.sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')));
    return rows[0] || {
      day: '-',
      dau: 0,
      sessions: 0,
      pageviews: 0,
      averageEngagedSeconds: 0
    };
  }

  function buildSummaryCards(summary) {
    const latest = getLatestDailySummary(summary && summary.daily);
    return [
      { label: 'DAU', value: formatInteger(latest.dau), hint: latest.day || '-' },
      { label: 'Sessions', value: formatInteger(latest.sessions), hint: '会话数' },
      { label: 'Pageviews', value: formatInteger(latest.pageviews), hint: '页面浏览' },
      { label: 'Avg Time', value: formatDuration(latest.averageEngagedSeconds), hint: '平均停留' }
    ];
  }

  function buildToolRows(topTools) {
    const rows = Array.isArray(topTools) ? topTools : [];
    const totalVisitors = rows.reduce((sum, row) => sum + (Number(row.visitors) || 0), 0);
    const totalPageviews = rows.reduce((sum, row) => sum + (Number(row.pageviews) || 0), 0);
    const total = totalVisitors || totalPageviews;
    return rows.map(row => {
      const visitors = Number(row.visitors) || 0;
      const pageviews = Number(row.pageviews) || 0;
      const key = String(row.tool || 'unknown');
      return {
        key,
        label: TOOL_LABELS[key] || key,
        visitors,
        pageviews,
        engagedSeconds: Number(row.engagedSeconds) || 0,
        share: total ? Math.round(((totalVisitors ? visitors : pageviews) / total) * 100) : 0
      };
    });
  }

  function getBreakdownKey(row, type) {
    if (type === 'location') {
      return `${row.country || 'unknown'}-${row.colo || 'unknown'}`;
    }
    return String(row[type] || 'unknown');
  }

  function getBreakdownLabel(row, type) {
    if (type === 'location') {
      return `${row.country || 'unknown'} / ${row.colo || 'unknown'}`;
    }
    const value = String(row[type] || 'unknown');
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function buildBreakdownRows(sourceRows, type) {
    const rows = Array.isArray(sourceRows) ? sourceRows : [];
    const total = rows.reduce((sum, row) => sum + (Number(row.visitors) || 0), 0);
    return rows.map(row => {
      const visitors = Number(row.visitors) || 0;
      return {
        key: getBreakdownKey(row, type),
        label: getBreakdownLabel(row, type),
        visitors,
        share: total ? Math.round((visitors / total) * 100) : 0
      };
    });
  }

  function getDailyTrend(daily) {
    return (Array.isArray(daily) ? daily.slice() : [])
      .sort((a, b) => String(a.day || '').localeCompare(String(b.day || '')))
      .map(row => ({
        day: row.day,
        dau: Number(row.dau) || 0,
        pageviews: Number(row.pageviews) || 0
      }));
  }

  return {
    buildBreakdownRows,
    buildSummaryCards,
    buildToolRows,
    formatDuration,
    getDailyTrend,
    getLatestDailySummary
  };
});
