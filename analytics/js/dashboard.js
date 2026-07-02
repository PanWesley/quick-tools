(function() {
  const utils = window.AnalyticsDashboardUtils;
  const TOKEN_KEY = 'billnest-analytics-read-token';
  let selectedDays = 14;
  let currentSummary = null;

  function getElement(id) {
    return document.getElementById(id);
  }

  function setStatus(message, tone) {
    const status = getElement('status');
    status.textContent = message;
    status.dataset.tone = tone || 'neutral';
  }

  function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function getToken() {
    return getElement('token-input').value.trim();
  }

  async function loadSummary() {
    const token = getToken();
    if (!token) {
      setStatus('请输入读取 token', 'warning');
      return;
    }
    saveToken(token);
    setStatus('正在读取数据...', 'neutral');

    const response = await fetch(`/api/analytics/summary?days=${selectedDays}&token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data && data.error ? data.error : '读取失败');
    }
    currentSummary = data;
    renderSummary(data);
    setStatus(`已更新最近 ${data.days || selectedDays} 天`, 'ok');
  }

  function renderSummary(summary) {
    renderCards(summary);
    renderTrend(summary.daily || []);
    renderTools(summary.topTools || []);
    renderRoutes(summary.topRoutes || []);
  }

  function renderCards(summary) {
    const wrap = getElement('summary-cards');
    wrap.innerHTML = utils.buildSummaryCards(summary).map(card => `
      <article class="metric-card">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <small>${card.hint}</small>
      </article>
    `).join('');
  }

  function renderTrend(daily) {
    const rows = utils.getDailyTrend(daily);
    const maxDau = Math.max(1, ...rows.map(row => row.dau));
    const maxPageviews = Math.max(1, ...rows.map(row => row.pageviews));
    const bars = rows.map(row => {
      const dauHeight = Math.max(4, Math.round((row.dau / maxDau) * 88));
      const pageHeight = Math.max(4, Math.round((row.pageviews / maxPageviews) * 88));
      return `
        <div class="trend-day" title="${row.day} DAU ${row.dau} / PV ${row.pageviews}">
          <span class="trend-bars">
            <i class="bar dau" style="height:${dauHeight}%"></i>
            <i class="bar pv" style="height:${pageHeight}%"></i>
          </span>
          <em>${String(row.day || '').slice(5)}</em>
        </div>
      `;
    }).join('');
    getElement('trend-chart').innerHTML = bars || '<p class="empty">暂无趋势数据</p>';
  }

  function renderTools(topTools) {
    const rows = utils.buildToolRows(topTools);
    getElement('tool-list').innerHTML = rows.map(row => `
      <li>
        <div>
          <strong>${row.label}</strong>
          <span>${row.pageviews} PV · ${utils.formatDuration(row.engagedSeconds)}</span>
        </div>
        <meter min="0" max="100" value="${row.share}"></meter>
        <b>${row.share}%</b>
      </li>
    `).join('') || '<li class="empty">暂无工具数据</li>';
  }

  function renderRoutes(topRoutes) {
    const rows = Array.isArray(topRoutes) ? topRoutes : [];
    getElement('route-list').innerHTML = rows.map(row => `
      <li>
        <code>${row.route || '-'}</code>
        <span>${Number(row.pageviews) || 0} PV</span>
      </li>
    `).join('') || '<li class="empty">暂无页面数据</li>';
  }

  function selectDays(days) {
    selectedDays = days;
    document.querySelectorAll('[data-days]').forEach(button => {
      button.classList.toggle('active', Number(button.dataset.days) === selectedDays);
    });
    if (currentSummary || getToken()) {
      loadSummary().catch(error => setStatus(error.message, 'error'));
    }
  }

  function bindEvents() {
    getElement('load-button').addEventListener('click', () => {
      loadSummary().catch(error => setStatus(error.message, 'error'));
    });
    getElement('token-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        loadSummary().catch(error => setStatus(error.message, 'error'));
      }
    });
    document.querySelectorAll('[data-days]').forEach(button => {
      button.addEventListener('click', () => selectDays(Number(button.dataset.days)));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    getElement('token-input').value = localStorage.getItem(TOKEN_KEY) || '';
    bindEvents();
    renderSummary({ daily: [], topTools: [], topRoutes: [] });
    if (getToken()) {
      loadSummary().catch(error => setStatus(error.message, 'error'));
    }
  });
})();
