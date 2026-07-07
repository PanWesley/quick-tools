/**
 * Expense Tracker - Main Application Entry
 * Handles view switching, filtering, form interactions, and test data.
 */

// Using global functions loaded via regular script tags:
// db.js, chart.js, import-export.js, guide.js

// ============================================
// Global State
// ============================================

let allTags = [];
let allTagGroups = [];
let selectedTagIds = [];
let selectedListCategoryTagIds = [];
let draftListCategoryTagIds = [];
const listCategoryCollapsedGroups = new Set();
let dashboardAnalysisGroupId = 'group-category';
let filterDebounceTimer = null;
let _originalSwitchView = null;
let persistentStorageRequested = false;

async function afterExpenseCreated(count = 1) {
  const backupService = window.ExpenseBackupService;
  if (!backupService) return;

  try {
    if (typeof backupService.recordExpensesCreated === 'function') {
      await backupService.recordExpensesCreated(count);
    } else if (typeof backupService.recordExpenseCreated === 'function') {
      await backupService.recordExpenseCreated(count);
    }
  } catch (error) {
    // Backup metadata must never turn a successful expense save into a failure.
  }

  if (!persistentStorageRequested) {
    persistentStorageRequested = true;
    try {
      Promise.resolve(backupService.requestPersistentStorage()).catch(() => {});
    } catch (error) {
      // Persistent storage is best-effort and must remain non-blocking.
    }
  }
}

window.afterExpenseCreated = afterExpenseCreated;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.ExpenseBackupUI) {
    window.ExpenseBackupUI.refresh().catch(() => {});
  }
});

// Expose dashboard filters globally for chart.js theme refresh
window._dashboardFilters = {};

// Quick expense form state
let quickFormSelectedTags = []; // array of tag ids
let recentTemplates = []; // array of { tagIds: [...], tagNames: [...] }
let nlParseResult = null; // cached natural language parse result
let suggestionHighlightIndex = -1;
let tagSuggestionMatches = [];
let activeTagPickerMode = null;
let tagPickerCollapsedGroups = new Set();
let tagPickerNewInputGroups = new Set();
let tagPickerUsageStats = {};
let tagPickerUsageRequestId = 0;

// List view state
let listViewPageSize = 20;
let listViewCurrentOffset = 0;
let listViewAllExpenses = [];
let activeSwipeExpenseId = null;
let listTouchState = null;
let suppressExpenseClickUntil = 0;

// Edit modal state
let editingExpenseId = null;
let editFormSelectedTags = [];
let editSuggestionHighlightIndex = -1;
let editTagSuggestionMatches = [];

// Tags management state
let tagSearchQuery = '';
let selectedManagedTagIds = [];

// Delete modal state
let pendingDeleteExpenseId = null;

// Merge modal state
let pendingMergeTagId = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await loadTags();
  initDashboardFilters();
  initExpenseForm();
  initListView();
  initSettingsView();
  initQuickExpenseForm();
  initNLInput();
  initEditModal();

  const initialHash = window.location.hash;
  const hashMatch = initialHash.match(/#view=(\w+)/);
  const initialView = hashMatch ? hashMatch[1] : 'add';
  if (hashMatch && typeof window.switchView === 'function') {
    window.switchView(initialView, true);
  }

  const expenses = await getExpenses();
  const hasInitializedBefore = localStorage.getItem('expense_data_initialized');
  if (!hasInitializedBefore) {
    localStorage.setItem('expense_data_initialized', '1');
  }

  let shouldShowProductOnboarding = false;
  try {
    const onboarding = window.BillNestOnboarding;
    if (onboarding && typeof onboarding.shouldShowOnboarding === 'function') {
      const [seen, showOnStart] = await Promise.all([
        getSettings(onboarding.SETTING_SEEN, false),
        getSettings(onboarding.SETTING_SHOW_ON_START, false)
      ]);
      shouldShowProductOnboarding = onboarding.shouldShowOnboarding({
        initialView,
        expenseCount: expenses.length,
        seen,
        showOnStart
      });
      if (shouldShowProductOnboarding && typeof window.switchView === 'function') {
        window.switchView('onboarding', true);
      }
    }
  } catch (e) {
    console.error('Onboarding init error:', e);
  }

  if (expenses.length === 0 && !hasInitializedBefore && !shouldShowProductOnboarding) {
    try {
      localStorage.setItem('expense_data_initialized', '1');
    } catch (e) {
      console.error('First-visit init failed:', e);
    }
  }

  if (window.ExpenseBackupUI) {
    window.ExpenseBackupUI.refresh().catch(error => {
      console.warn('Backup status unavailable', error);
    });
  }

  // Initialize guide on first visit
  try {
    const show = await shouldShowGuide();
    if (show && initialView === 'add' && !shouldShowProductOnboarding) {
      setTimeout(() => showGuide(), 600);
    }
  } catch (e) {
    console.error('Guide init error:', e);
  }

  // Update demo mode toggle state
  updateDemoToggleUI();
  updateOnboardingSettingsUI();

  // Override switchView to trigger view-specific rendering
  // Must be done here (after index.html's inline script defines switchView)
  _originalSwitchView = window.switchView;
  let _appReady = false;
  window.switchView = function(viewName, skipHistory) {
    if (_originalSwitchView) _originalSwitchView(viewName, skipHistory);
    if (viewName === 'dashboard') {
      refreshDashboard();
      if (window.ExpenseBackupUI) window.ExpenseBackupUI.refresh().catch(() => {});
    } else if (viewName === 'list') {
      renderExpenseList();
    } else if (viewName === 'tags') {
      loadTags();
    } else if (viewName === 'onboarding') {
      if (window.ExpenseBackupUI) window.ExpenseBackupUI.refresh().catch(() => {});
    } else if (viewName === 'add' && _appReady) {
      setTimeout(() => {
        const amountInput = document.getElementById('exp-amount');
        if (amountInput) amountInput.focus();
      }, 100);
    } else if (viewName === 'settings' && window.ExpenseBackupUI) {
      window.ExpenseBackupUI.refresh().catch(() => {});
    }
  };

  if (hashMatch) {
    window.switchView(initialView, true);
  }

  _appReady = true;

  // Scroll shrink header (v1.5.0 mobile optimization)
  let lastScrollY = 0;
  window.addEventListener('scroll', () => {
    const header = document.querySelector('header');
    const currentScrollY = window.scrollY;
    if (window.innerWidth <= 768) {
      if (currentScrollY > 40 && currentScrollY > lastScrollY) {
        header.classList.add('shrink');
      } else if (currentScrollY < 10) {
        header.classList.remove('shrink');
      }
    }
    lastScrollY = currentScrollY;
  }, { passive: true });
});

// ============================================
// Dashboard Filters
// ============================================

function initDashboardFilters() {
  const timeRange = document.getElementById('dash-time-range');
  const customRange = document.getElementById('dash-custom-range');
  const dateStart = document.getElementById('dash-date-start');
  const dateEnd = document.getElementById('dash-date-end');
  const amountMin = document.getElementById('dash-amount-min');
  const amountMax = document.getElementById('dash-amount-max');
  const search = document.getElementById('dash-search');
  const analysisGroup = document.getElementById('dashboard-analysis-group');

  if (timeRange) {
    timeRange.addEventListener('change', () => {
      if (customRange) {
        customRange.style.display = timeRange.value === 'custom' ? 'flex' : 'none';
      }
      triggerDashboardUpdate();
    });
  }

  if (dateStart) dateStart.addEventListener('change', triggerDashboardUpdate);
  if (dateEnd) dateEnd.addEventListener('change', triggerDashboardUpdate);
  if (amountMin) amountMin.addEventListener('input', triggerDashboardUpdate);
  if (amountMax) amountMax.addEventListener('input', triggerDashboardUpdate);
  if (search) search.addEventListener('input', triggerDashboardUpdate);
  if (analysisGroup) {
    analysisGroup.addEventListener('change', () => {
      dashboardAnalysisGroupId = analysisGroup.value || 'group-category';
      refreshDashboard();
    });
  }

  renderDashboardAnalysisOptions();

  // Initialize selected tags display
  renderSelectedFilterTags();

  // Event delegation for stat cards click
  document.querySelectorAll('[data-action="go-to-list"]').forEach(card => {
    card.addEventListener('click', goToListFromDashboard);
    card.style.cursor = 'pointer';
  });
}

function getDefaultDashboardAnalysisGroupId() {
  if (allTagGroups.some(group => group.id === 'group-category')) {
    return 'group-category';
  }
  return allTagGroups[0]?.id || 'all-groups';
}

function renderDashboardAnalysisOptions() {
  const select = document.getElementById('dashboard-analysis-group');
  if (!select) return;

  const isKnownAnalysisGroup = dashboardAnalysisGroupId === 'all-groups'
    || allTagGroups.some(group => group.id === dashboardAnalysisGroupId);
  if (!dashboardAnalysisGroupId || !isKnownAnalysisGroup) {
    dashboardAnalysisGroupId = getDefaultDashboardAnalysisGroupId();
  }

  const groupOptions = allTagGroups
    .map(group => `<option value="${escapeAttr(group.id)}">${escapeHTML(group.name)}</option>`)
    .join('');
  select.innerHTML = `<option value="all-groups">全部分组</option>${groupOptions}`;
  select.value = dashboardAnalysisGroupId;
}

function triggerDashboardUpdate() {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer);
  }
  filterDebounceTimer = setTimeout(() => {
    refreshDashboard();
  }, 300);
}

function formatLocalDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDateKey(date);
}

function getPreviousDashboardRange(dateRange) {
  if (!dateRange || !dateRange.startDate || !dateRange.endDate) return null;
  const start = new Date(`${dateRange.startDate}T00:00:00`);
  const end = new Date(`${dateRange.endDate}T00:00:00`);
  const days = Math.max(1, Math.floor((end - start) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return {
    startDate: formatLocalDateKey(previousStart),
    endDate: formatLocalDateKey(previousEnd)
  };
}

async function getFilteredDashboardExpensesForRange(dateRange, filters) {
  if (!dateRange) return [];
  const rawExpenses = await getExpenses({ startDate: dateRange.startDate, endDate: dateRange.endDate });
  return filterDashboardExpenses(rawExpenses, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    tags: filters.tags,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    search: filters.search
  }, { tags: allTags });
}

function renderDashboardInsights(expenses, dateRange, filters, previousExpenses) {
  renderSpendingPaceInsight(expenses, dateRange, previousExpenses);
  renderCalendarHeatmapInsight(expenses, dateRange);
  renderDashboardInsightCards(expenses, dateRange, filters, previousExpenses);
}

function renderSpendingPaceInsight(expenses, dateRange, previousExpenses) {
  const pace = buildSpendingPace(expenses, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    now: formatLocalDateKey(new Date()),
    referenceTotal: previousExpenses && previousExpenses.length > 0
      ? previousExpenses.reduce((sum, expense) => sum + (expense.amount || 0), 0)
      : null
  });
  const plain = buildSpendingPlainSummary(pace);
  const statusEl = document.getElementById('pace-status');
  const titleEl = document.getElementById('pace-title');
  const copyEl = document.getElementById('pace-copy');
  const dailyAverageEl = document.getElementById('pace-daily-average');
  const remainingEl = document.getElementById('pace-remaining');

  if (statusEl) {
    statusEl.textContent = pace.hasReference ? pace.label : '参考不足';
    statusEl.className = `pace-status ${pace.status}`;
  }
  if (titleEl) titleEl.textContent = plain.title;
  if (copyEl) copyEl.textContent = plain.summary;
  if (dailyAverageEl) dailyAverageEl.textContent = plain.dailyAverage;
  if (remainingEl) remainingEl.textContent = plain.remaining;
}

function renderCalendarHeatmapInsight(expenses, dateRange) {
  const heatmap = buildCalendarHeatmap(expenses, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    now: formatLocalDateKey(new Date())
  });
  const container = document.getElementById('calendar-heatmap');
  const maxEl = document.getElementById('heatmap-max');
  const titleEl = document.getElementById('heatmap-title');
  const weekdaysEl = document.querySelector('.heatmap-weekdays');
  if (!container) return;

  container.classList.toggle('month-mode', heatmap.mode === 'month');
  if (weekdaysEl) weekdaysEl.style.display = heatmap.mode === 'month' ? 'none' : '';
  if (titleEl) titleEl.textContent = heatmap.mode === 'month' ? '按月支出热力图' : '日历热力图';

  if (heatmap.mode === 'month') {
    if (maxEl) {
      maxEl.textContent = heatmap.maxMonthlyTotal > 0 ? `最高月 ¥${heatmap.maxMonthlyTotal.toFixed(0)}` : '暂无支出';
    }
    container.innerHTML = heatmap.months.map(month => {
      const level = month.intensity === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(month.intensity * 4)));
      const title = `${month.month} 支出 ¥${month.total.toFixed(2)}`;
      const amountLabel = typeof formatHeatmapAmountLabel === 'function'
        ? formatHeatmapAmountLabel(month.total)
        : (month.total > 0 ? `¥${Math.round(month.total)}` : '');
      return `<button class="heatmap-month level-${level} ${month.isCurrentMonth ? 'today' : ''}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" onclick="goToListForMonth('${escapeJSAttr(month.month)}')"><span>${escapeHTML(month.label)}</span><strong>${amountLabel ? escapeHTML(amountLabel) : '&nbsp;'}</strong></button>`;
    }).join('');
    return;
  }

  if (maxEl) {
    maxEl.textContent = heatmap.maxDailyTotal > 0 ? `峰值 ¥${heatmap.maxDailyTotal.toFixed(0)}` : '暂无支出';
  }

  const leadingOffset = heatmap.days.length > 0
    ? (heatmap.days[0].weekday + 6) % 7
    : 0;
  const blanks = Array.from({ length: leadingOffset }, () => '<span class="heatmap-cell empty" aria-hidden="true"></span>');
  const cells = heatmap.days.map(day => {
    const level = day.intensity === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(day.intensity * 4)));
    const title = `${day.date} 支出 ¥${day.total.toFixed(2)}`;
    const amountLabel = typeof formatHeatmapAmountLabel === 'function'
      ? formatHeatmapAmountLabel(day.total)
      : (day.total > 0 ? `¥${Math.round(day.total)}` : '');
    return `<button class="heatmap-cell level-${level} ${day.isToday ? 'today' : ''}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" onclick="goToListForDate('${escapeJSAttr(day.date)}')"><span class="heatmap-day">${day.day}</span><span class="heatmap-amount ${amountLabel ? '' : 'empty'}">${amountLabel ? escapeHTML(amountLabel) : '&nbsp;'}</span></button>`;
  });
  container.innerHTML = blanks.concat(cells).join('');
}

function renderDashboardInsightCards(expenses, dateRange, filters, previousExpenses) {
  const container = document.getElementById('insight-alert-list');
  const countEl = document.getElementById('insight-count');
  if (!container) return;

  const cards = buildDashboardInsightCards(expenses, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    tags: allTags,
    groups: allTagGroups,
    analysisGroupId: filters.analysisGroupId,
    previousExpenses
  });

  if (countEl) countEl.textContent = `${cards.length} 条`;
  if (cards.length === 0) {
    container.innerHTML = '<div class="insight-alert empty">暂时没有明显异常，节奏挺稳。</div>';
    return;
  }

  container.innerHTML = cards.map(card => `
    <div class="insight-alert ${escapeAttr(card.type)}">
      <div>
        <strong>${escapeHTML(card.title)}</strong>
        <span>${escapeHTML(card.detail)}</span>
      </div>
      <em>${escapeHTML(card.value)}</em>
    </div>
  `).join('');
}

function renderDashboardHero() {
  const totalEl = document.getElementById('dash-total');
  const labelEl = document.getElementById('dash-total-label');
  const trendEl = document.getElementById('dash-trend-text');
  const countEl = document.getElementById('dash-count-text');
  const emptyEl = document.getElementById('empty-dashboard');

  if (!totalEl || !emptyEl) return;

  // Use the same filtered dataset as the charts so the overview has one context.
  (async () => {
    const filters = window._dashboardFilters || {};
    const dateRange = window._dashboardDateRange || getDateRange(
      filters.timeRange || 'this-month',
      filters.customStart,
      filters.customEnd
    );
    let expenses = Array.isArray(window._dashboardFilteredExpenses)
      ? window._dashboardFilteredExpenses.slice()
      : null;

    if (!expenses) {
      const rawExpenses = await getExpenses({ startDate: dateRange.startDate, endDate: dateRange.endDate });
      expenses = filterDashboardExpenses(rawExpenses, {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        tags: filters.tags,
        minAmount: filters.minAmount,
        maxAmount: filters.maxAmount,
        search: filters.search
      }, { tags: allTags });
    }

    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const count = expenses.length;
    if (labelEl) {
      labelEl.textContent = `${getDateRangeLabel(filters.timeRange || 'this-month')}支出`;
    }

    // Show empty state
    if (count === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      const insightsEl = document.getElementById('dashboard-insights');
      if (insightsEl) insightsEl.style.display = 'none';
      if (document.getElementById('dashboard-hero')) {
        document.getElementById('dashboard-hero').style.display = 'none';
      }
      // Hide chart sections
      const chartRows = document.querySelectorAll('.chart-row');
      chartRows.forEach(r => r.style.display = 'none');
      const chartCards = document.querySelectorAll('.chart-card');
      chartCards.forEach(c => {
        if (c.querySelector('.chart-row')) return;
        c.style.display = 'none';
      });
      return;
    }

    // Hide empty, show hero
    if (emptyEl) emptyEl.style.display = 'none';
    if (document.getElementById('dashboard-hero')) {
      document.getElementById('dashboard-hero').style.display = 'block';
    }
    const insightsEl = document.getElementById('dashboard-insights');
    if (insightsEl) insightsEl.style.display = 'grid';
    // Show chart sections
    const chartRows = document.querySelectorAll('.chart-row');
    chartRows.forEach(r => r.style.display = 'grid');
    const chartCards = document.querySelectorAll('.chart-card');
    chartCards.forEach(c => c.style.display = 'block');

    const previousRange = getPreviousDashboardRange(dateRange);
    const previousExpenses = previousRange
      ? await getFilteredDashboardExpensesForRange(previousRange, filters)
      : [];
    renderDashboardInsights(expenses, dateRange, filters, previousExpenses);

    // Format total
    if (totalEl) {
      totalEl.textContent = `¥${total.toFixed(2)}`;
      // Add pop animation
      totalEl.classList.remove('updated');
      void totalEl.offsetWidth;
      totalEl.classList.add('updated');
    }

    // Count
    if (countEl) {
      countEl.textContent = `${count} 笔支出`;
    }

    // Trend vs previous period
    if (trendEl) {
      if (!filters.timeRange || filters.timeRange === 'this-month') {
        // Compare to last month
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        const lastMonthStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
        const lastMonthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
        const rawLastMonthExpenses = await getExpenses({ startDate: lastMonthStart, endDate: lastMonthEnd });
        const lastMonthExpenses = filterDashboardExpenses(rawLastMonthExpenses, {
          startDate: lastMonthStart,
          endDate: lastMonthEnd,
          tags: filters.tags,
          minAmount: filters.minAmount,
          maxAmount: filters.maxAmount,
          search: filters.search
        }, { tags: allTags });
        const lastTotal = lastMonthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        if (lastTotal === 0) {
          trendEl.textContent = '首月记录';
        } else if (total > lastTotal) {
          const pct = ((total - lastTotal) / lastTotal * 100).toFixed(0);
          trendEl.innerHTML = `较上月 <span style="color:${total > lastTotal ? 'var(--danger)' : 'var(--success)'}">↑ ${pct}%</span>`;
        } else {
          const pct = ((lastTotal - total) / lastTotal * 100).toFixed(0);
          trendEl.innerHTML = `较上月 <span style="color:${total > lastTotal ? 'var(--danger)' : 'var(--success)'}">↓ ${pct}%</span>`;
        }
      } else {
        trendEl.textContent = '—';
      }
    }
  })();
}

async function refreshDashboard() {
  const timeRange = document.getElementById('dash-time-range');
  const dateStart = document.getElementById('dash-date-start');
  const dateEnd = document.getElementById('dash-date-end');
  const amountMin = document.getElementById('dash-amount-min');
  const amountMax = document.getElementById('dash-amount-max');
  const search = document.getElementById('dash-search');
  const analysisGroup = document.getElementById('dashboard-analysis-group');
  if (analysisGroup && analysisGroup.value) {
    dashboardAnalysisGroupId = analysisGroup.value;
  }

  const filters = {
    timeRange: timeRange ? timeRange.value : 'this-month',
    customStart: dateStart ? dateStart.value : null,
    customEnd: dateEnd ? dateEnd.value : null,
    tags: selectedTagIds.length > 0 ? selectedTagIds : null,
    minAmount: amountMin ? amountMin.value : null,
    maxAmount: amountMax ? amountMax.value : null,
    search: search ? search.value : '',
    analysisGroupId: dashboardAnalysisGroupId
  };

  window._dashboardFilters = filters;
  await updateDashboard(filters);
  // Render hero dashboard (v1.5.0)
  renderDashboardHero();
}

window.refreshDashboard = refreshDashboard;

// ============================================
// Tag Popup / Cloud
// ============================================

window.toggleTagPopup = function() {
  const popup = document.getElementById('dash-tag-popup');
  if (!popup) return;
  const isVisible = popup.style.display === 'block';
  popup.style.display = isVisible ? 'none' : 'block';
  
  // Show/hide mobile backdrop
  let backdrop = document.getElementById('tag-popup-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'tag-popup-backdrop';
    backdrop.className = 'tag-popup-backdrop';
    backdrop.onclick = function() { toggleTagPopup(); };
    document.getElementById('view-dashboard').appendChild(backdrop);
  }
  backdrop.style.display = isVisible ? 'none' : 'block';
  
  if (!isVisible) {
    renderTagCloud();
  }
};

window.applyTagFilter = function() {
  const popup = document.getElementById('dash-tag-popup');
  if (popup) popup.style.display = 'none';
  const backdrop = document.getElementById('tag-popup-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  renderSelectedFilterTags();
  refreshDashboard();
};

window.clearTagFilter = function() {
  selectedTagIds = [];
  renderTagCloud();
  renderSelectedFilterTags();
  refreshDashboard();
  const popup = document.getElementById('dash-tag-popup');
  if (popup) popup.style.display = 'none';
  const backdrop = document.getElementById('tag-popup-backdrop');
  if (backdrop) backdrop.style.display = 'none';
};

function renderSelectedFilterTags() {
  const container = document.getElementById('dash-selected-tags');
  if (!container) return;

  if (selectedTagIds.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = renderSelectedTagGroupChips(selectedTagIds, 'dashboard');
}

window.removeFilterTag = function(tagId) {
  selectedTagIds = selectedTagIds.filter(id => id !== tagId);
  renderTagCloud();
  renderSelectedFilterTags();
  refreshDashboard();
};

window.removeFilterGroup = function(groupId) {
  const tagsInGroup = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === groupId);
  selectedTagIds = selectedTagIds.filter(id => !tagsInGroup.some(tag => tag.id === id));
  renderTagCloud();
  renderSelectedFilterTags();
  refreshDashboard();
};

window.goToListFromDashboard = function() {
  // Apply dashboard filters to list view
  const timeRange = document.getElementById('dash-time-range');
  const dateStart = document.getElementById('dash-date-start');
  const dateEnd = document.getElementById('dash-date-end');
  const amountMin = document.getElementById('dash-amount-min');
  const amountMax = document.getElementById('dash-amount-max');
  const search = document.getElementById('dash-search');

  // Store filters for list view to use
  window._listViewFilters = {
    timeRange: timeRange ? timeRange.value : 'this-month',
    customStart: dateStart ? dateStart.value : null,
    customEnd: dateEnd ? dateEnd.value : null,
    tags: selectedTagIds.length > 0 ? selectedTagIds : null,
    minAmount: amountMin ? amountMin.value : null,
    maxAmount: amountMax ? amountMax.value : null,
    search: search ? search.value : ''
  };

  _originalSwitchView('list');
  applyListViewFilters();
};

function applyTransferredListFilters(filters) {
  const transfer = ExpenseListUtils.createListTransferFilters(filters, allTags);
  const listSearch = document.getElementById('list-search');
  if (listSearch) {
    listSearch.value = transfer.search;
  }

  selectedListCategoryTagIds = transfer.tagIds;
  draftListCategoryTagIds = transfer.tagIds.slice();
  renderListCategoryTrigger();
  renderListCategoryPicker();

  listViewCurrentOffset = 0;
  renderExpenseList();
}

window.goToListForDate = function(date) {
  _originalSwitchView('list');
  applyTransferredListFilters({
    search: date,
    tags: (window._dashboardFilters && window._dashboardFilters.tags) || selectedTagIds
  });
};

window.goToListForMonth = function(month) {
  _originalSwitchView('list');
  applyTransferredListFilters({
    search: month,
    tags: (window._dashboardFilters && window._dashboardFilters.tags) || selectedTagIds
  });
};

function applyListViewFilters() {
  if (!window._listViewFilters) return;

  const filters = window._listViewFilters;

  applyTransferredListFilters({
    search: filters.search || '',
    tags: filters.tags || []
  });
}

function renderTagCloud() {
  const container = document.getElementById('dash-tag-groups');
  if (!container) return;

  if (allTags.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无标签</p>';
    return;
  }

  // Group tags by parentId
  const tagsByGroup = {};
  for (const group of allTagGroups) {
    tagsByGroup[group.id] = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === group.id);
  }

  let html = '';
  for (const group of allTagGroups) {
    const tags = tagsByGroup[group.id] || [];
    if (tags.length === 0) continue; // Skip empty groups in filter

    const allSelected = tags.every(tag => selectedTagIds.includes(tag.id));
    const someSelected = tags.some(tag => selectedTagIds.includes(tag.id));

    html += `<div class="tag-group-section">
      <div class="tag-group-section-header" onclick="toggleGroupSelectAll('${group.id}')">
        <span class="tag-group-dot" style="background:${group.color}"></span>
        <span class="tag-group-section-name">${group.name}</span>
        <span class="tag-group-select-all">${allSelected ? '取消全选' : '全选'}</span>
      </div>
      <div class="tag-group-section-chips">`;

    for (const tag of tags) {
      const isSelected = selectedTagIds.includes(tag.id);
      const style = `background:${tag.color}22;color:${tag.color};border-color:${isSelected ? tag.color : 'transparent'}`;
      html += `<span class="tag-chip ${isSelected ? 'selected' : ''}" data-id="${tag.id}" style="${style}" onclick="toggleTagSelection('${tag.id}')">${tag.name}</span>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;
}

window.toggleGroupSelectAll = function(groupId) {
  const tagsInGroup = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === groupId);
  const allSelected = tagsInGroup.every(tag => selectedTagIds.includes(tag.id));

  if (allSelected) {
    // Deselect all in group
    selectedTagIds = selectedTagIds.filter(id => !tagsInGroup.some(tag => tag.id === id));
  } else {
    // Select all in group
    for (const tag of tagsInGroup) {
      if (!selectedTagIds.includes(tag.id)) {
        selectedTagIds.push(tag.id);
      }
    }
  }
  renderTagCloud();
};

window.toggleTagSelection = function(tagId) {
  if (selectedTagIds.includes(tagId)) {
    selectedTagIds = selectedTagIds.filter(id => id !== tagId);
  } else {
    selectedTagIds.push(tagId);
  }
  renderTagCloud();
};

async function loadTags() {
  if (typeof repairTagGroupIntegrity === 'function') {
    await repairTagGroupIntegrity();
  }
  allTags = await getTags();
  allTagGroups = await getTagGroups();
  populateCategorySelects();
  renderDashboardAnalysisOptions();
  renderTagCloud();
  await renderTagsList();
}

window.loadTags = loadTags;

function populateCategorySelects() {
  const catSelect = document.getElementById('exp-category');

  if (catSelect) {
    const current = catSelect.value;
    catSelect.innerHTML = '<option value="">请选择分类</option>' +
      allTags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    catSelect.value = current;
  }

  syncListCategorySelectionWithTags();
  renderListCategoryTrigger();
  renderListCategoryPicker();
}

function syncListCategorySelectionWithTags() {
  const validIds = new Set(allTags.map(tag => tag.id));
  selectedListCategoryTagIds = selectedListCategoryTagIds.filter(id => validIds.has(id));
  draftListCategoryTagIds = draftListCategoryTagIds.filter(id => validIds.has(id));
}

function renderListCategoryTrigger() {
  const labelEl = document.getElementById('list-category-trigger-label');
  const countEl = document.getElementById('list-category-trigger-count');
  const trigger = document.getElementById('list-category-trigger');
  if (!labelEl) return;

  if (selectedListCategoryTagIds.length === 0) {
    labelEl.textContent = ExpenseListUtils.formatCategoryFilterLabel(selectedListCategoryTagIds, allTags);
  } else {
    labelEl.innerHTML = renderSelectedTagGroupChips(selectedListCategoryTagIds, 'list');
  }
  if (trigger) {
    trigger.classList.toggle('has-selection', selectedListCategoryTagIds.length > 0);
  }
  if (countEl) {
    countEl.textContent = '';
    countEl.hidden = true;
  }
}

function renderSelectedTagGroupChips(tagIds, scope) {
  const groups = ExpenseListUtils.formatSelectedTagGroups(tagIds, allTags, allTagGroups);
  if (groups.length === 0) return '';

  return groups.map(group => {
    const color = group.color || '#2DBAA3';
    const style = `--group-color:${escapeAttr(color)}`;
    const tags = group.tags.map(tag => (
      `<span class="selected-filter-tag">${escapeHTML(tag.name)}</span>`
    )).join('');
    return `
      <span class="selected-filter-group ${escapeAttr(scope || '')}" style="${style}">
        <span class="selected-filter-group-name">${escapeHTML(group.name)}</span>
        <span class="selected-filter-group-tags">${tags}</span>
      </span>
    `;
  }).join('');
}

function renderListCategoryPicker() {
  const selectedStrip = document.getElementById('list-category-selected-strip');
  const groupsContainer = document.getElementById('list-category-groups');
  if (!selectedStrip || !groupsContainer) return;

  if (draftListCategoryTagIds.length === 0) {
    selectedStrip.innerHTML = '<span class="tag-picker-selected-empty">尚未选择分类</span>';
  } else {
    selectedStrip.innerHTML = draftListCategoryTagIds.map(id => {
      const tag = allTags.find(item => item.id === id);
      if (!tag) return '';
      const group = allTagGroups.find(item => item.id === (tag.parentId || 'group-uncategorized'));
      return `
        <button type="button" class="tag-picker-selected-chip" onclick="toggleListCategoryTag('${escapeJSAttr(id)}')" style="--chip-color:${escapeAttr(tag.color)}">
          ${escapeHTML(tag.name)}
          <small>${escapeHTML(group ? group.name : '未分类')}</small>
        </button>
      `;
    }).join('');
  }

  const html = allTagGroups.map(group => {
    const tags = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === group.id);
    if (tags.length === 0) return '';
    const selectedCount = tags.filter(tag => draftListCategoryTagIds.includes(tag.id)).length;
    const isCollapsed = listCategoryCollapsedGroups.has(group.id);

    return `
      <section class="tag-picker-group-card ${isCollapsed ? 'collapsed' : ''}">
        <button type="button" class="tag-picker-group-header" onclick="toggleListCategoryGroup('${escapeJSAttr(group.id)}')" aria-expanded="${!isCollapsed}">
          <span class="tag-group-dot" style="background:${escapeAttr(group.color)}"></span>
          <span class="tag-picker-group-name">${escapeHTML(group.name)}</span>
          <span class="tag-picker-group-count">${selectedCount}/${tags.length}</span>
          <span class="tag-picker-chevron" aria-hidden="true">⌄</span>
        </button>
        <div class="tag-picker-group-body">
          <div class="list-category-option-list">
            ${tags.map(tag => {
              const isSelected = draftListCategoryTagIds.includes(tag.id);
              return `
                <button type="button" class="list-category-option ${isSelected ? 'selected' : ''}" onclick="toggleListCategoryTag('${escapeJSAttr(tag.id)}')" style="--chip-color:${escapeAttr(tag.color)}">
                  <span class="list-category-check" aria-hidden="true">${isSelected ? '✓' : ''}</span>
                  <span class="tag-suggestion-dot" style="background:${escapeAttr(tag.color)}"></span>
                  <span>${escapeHTML(tag.name)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;
  }).join('');

  groupsContainer.innerHTML = html || '<div class="tag-picker-empty">暂无可选分类</div>';
}

function updateListCategoryModalState(isOpen) {
  const modal = document.getElementById('list-category-modal');
  const trigger = document.getElementById('list-category-trigger');
  if (modal) {
    modal.classList.toggle('open', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }
  if (trigger) {
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
  document.body.classList.toggle('list-category-open', isOpen);
}

window.openListCategoryPicker = function() {
  draftListCategoryTagIds = [...selectedListCategoryTagIds];
  renderListCategoryPicker();
  updateListCategoryModalState(true);
};

window.closeListCategoryPicker = function() {
  updateListCategoryModalState(false);
};

window.toggleListCategoryGroup = function(groupId) {
  if (listCategoryCollapsedGroups.has(groupId)) {
    listCategoryCollapsedGroups.delete(groupId);
  } else {
    listCategoryCollapsedGroups.add(groupId);
  }
  renderListCategoryPicker();
};

window.toggleListCategoryTag = function(tagId) {
  if (draftListCategoryTagIds.includes(tagId)) {
    draftListCategoryTagIds = draftListCategoryTagIds.filter(id => id !== tagId);
  } else {
    draftListCategoryTagIds.push(tagId);
  }
  renderListCategoryPicker();
};

window.clearListCategoryFilter = function() {
  draftListCategoryTagIds = [];
  renderListCategoryPicker();
};

window.applyListCategoryFilter = function() {
  selectedListCategoryTagIds = [...draftListCategoryTagIds];
  renderListCategoryTrigger();
  updateListCategoryModalState(false);
  listViewCurrentOffset = 0;
  renderExpenseList();
};

// ============================================
// Add Expense Form (legacy, kept for compatibility)
// ============================================

function initExpenseForm() {
  const dateInput = document.getElementById('exp-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

window.saveExpense = async function() {
  const amount = document.getElementById('exp-amount').value;
  const date = document.getElementById('exp-date').value;
  const category = document.getElementById('exp-category').value;
  const note = document.getElementById('exp-note').value;

  if (!amount || !date || !category) {
    showToast('请填写金额、日期和分类');
    return;
  }

  const selectedChips = document.querySelectorAll('#tag-selector .tag-chip.selected');
  const tags = Array.from(selectedChips).map(chip => chip.dataset.id);

  await addExpense({ amount, date, category, note, tags });
  await afterExpenseCreated();
  resetExpenseForm();
  showToast('保存成功！');
  switchView('dashboard');
};

window.resetExpenseForm = function() {
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('exp-category').value = '';
  document.getElementById('exp-note').value = '';
  document.querySelectorAll('#tag-selector .tag-chip.selected').forEach(c => c.classList.remove('selected'));
};

// ============================================
// Quick Expense Entry (Task 3)
// ============================================

function initQuickExpenseForm() {
  const dateInput = document.getElementById('exp-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // Tag input smart suggestions
  const tagInput = document.getElementById('exp-tags-input');
  if (tagInput) {
    prepareTagPickerTrigger(tagInput, 'quick');
  }

  loadRecentTemplates();
  renderRecentTemplates();
}

function getVisibleTagOptions(query, selectedIds) {
  const q = (query || '').trim().toLowerCase();
  const recentlyUsed = getRecentlyUsedTagIds();
  return allTags
    .filter(tag => !selectedIds.includes(tag.id))
    .filter(tag => {
      if (!q) return true;
      const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
      return tag.name.toLowerCase().includes(q) || (group && group.name.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const recentA = recentlyUsed.indexOf(a.id);
      const recentB = recentlyUsed.indexOf(b.id);
      if (recentA !== recentB) {
        if (recentA === -1) return 1;
        if (recentB === -1) return -1;
        return recentA - recentB;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

function prepareTagPickerTrigger(input, mode) {
  if (!input || input.dataset.tagPickerReady === '1') return;
  input.dataset.tagPickerReady = '1';
  input.readOnly = true;
  input.classList.add('tag-picker-trigger');
  input.setAttribute('role', 'button');
  input.setAttribute('aria-haspopup', 'dialog');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('placeholder', '点击选择标签...');

  input.addEventListener('click', function(e) {
    e.preventDefault();
    input.blur();
    openTagPicker(mode);
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openTagPicker(mode);
    }
  });

  updateTagPickerTrigger(mode);
}

function getTagPickerState(mode = activeTagPickerMode) {
  if (mode === 'edit') {
    return {
      inputId: 'edit-tags-input',
      selectedIds: editFormSelectedTags,
      setSelectedIds(ids) { editFormSelectedTags = ids; },
      renderSelected: renderEditSelectedTags
    };
  }

  return {
    inputId: 'exp-tags-input',
    selectedIds: quickFormSelectedTags,
    setSelectedIds(ids) { quickFormSelectedTags = ids; },
    renderSelected: renderSelectedTags
  };
}

function updateTagPickerTrigger(mode) {
  const state = getTagPickerState(mode);
  const input = document.getElementById(state.inputId);
  if (!input) return;
  const count = state.selectedIds.length;
  input.value = count ? `已选择 ${count} 个标签` : '';
  input.setAttribute('aria-label', count ? `已选择 ${count} 个标签，点击修改` : '点击选择标签');
}

function hasDuplicateTagNameInGroupLocal(tags, name, groupId, excludeTagId) {
  const helper = window.TagManagementUtils && window.TagManagementUtils.hasDuplicateTagNameInGroup;
  if (typeof helper === 'function') {
    return helper(tags, name, groupId, excludeTagId);
  }
  const normalizedName = String(name || '').trim();
  if (!normalizedName || !groupId) return false;
  return (tags || []).some(tag => {
    if (!tag || tag.id === excludeTagId) return false;
    return (tag.parentId || 'group-uncategorized') === groupId && String(tag.name || '').trim() === normalizedName;
  });
}

async function getTagPickerUsageStats() {
  const helper = window.TagManagementUtils && window.TagManagementUtils.buildTagUsageStats;
  if (typeof helper !== 'function') {
    return {};
  }

  const expenses = await getExpenses();
  return helper(expenses, new Date(), 90);
}

function sortTagsForPickerLocal(tags, selectedIds) {
  const helper = window.TagManagementUtils && window.TagManagementUtils.sortTagsForPicker;
  if (typeof helper === 'function') {
    return helper(tags, tagPickerUsageStats, selectedIds, 'zh-CN');
  }
  return [...(tags || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
}

function ensureTagPickerModal() {
  let modal = document.getElementById('tag-picker-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'tag-picker-modal';
  modal.className = 'tag-picker-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="tag-picker-backdrop" data-tag-picker-close></div>
    <section class="tag-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="tag-picker-title">
      <div class="tag-picker-handle" aria-hidden="true"></div>
      <div class="tag-picker-sheet-header">
        <div>
          <h3 id="tag-picker-title">选择标签</h3>
          <p id="tag-picker-subtitle">可连续选择多个标签</p>
        </div>
        <button type="button" class="tag-picker-close" onclick="closeTagPicker()" aria-label="关闭">×</button>
      </div>
      <div class="tag-picker-selected-strip" id="tag-picker-selected-strip"></div>
      <div class="tag-picker-groups" id="tag-picker-groups"></div>
      <div class="tag-picker-actions">
        <button type="button" class="btn-secondary" onclick="clearActiveTagPickerSelection()">清空</button>
        <button type="button" class="btn-primary" onclick="closeTagPicker()">完成</button>
      </div>
    </section>
  `;
  modal.addEventListener('click', function(e) {
    if (e.target && e.target.matches('[data-tag-picker-close]')) {
      closeTagPicker();
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function openTagPicker(mode) {
  activeTagPickerMode = mode || 'quick';
  const modal = ensureTagPickerModal();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('tag-picker-open');
  const state = getTagPickerState(activeTagPickerMode);
  const input = document.getElementById(state.inputId);
  if (input) input.setAttribute('aria-expanded', 'true');
  renderTagPicker();
  const requestId = ++tagPickerUsageRequestId;
  getTagPickerUsageStats().then(stats => {
    if (requestId === tagPickerUsageRequestId && activeTagPickerMode) {
      tagPickerUsageStats = stats;
      renderTagPicker();
    }
  }).catch(error => {
    console.warn('[Tags] Unable to refresh tag usage stats', error);
    if (requestId === tagPickerUsageRequestId && activeTagPickerMode) {
      tagPickerUsageStats = {};
      renderTagPicker();
    }
  });
}

window.closeTagPicker = function() {
  const modal = document.getElementById('tag-picker-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (activeTagPickerMode) {
    const state = getTagPickerState(activeTagPickerMode);
    const input = document.getElementById(state.inputId);
    if (input) input.setAttribute('aria-expanded', 'false');
  }
  tagPickerNewInputGroups.clear();
  activeTagPickerMode = null;
  document.body.classList.remove('tag-picker-open');
};

function renderTagPicker() {
  if (!activeTagPickerMode) return;
  const state = getTagPickerState(activeTagPickerMode);
  const selectedIds = state.selectedIds;
  const selectedStrip = document.getElementById('tag-picker-selected-strip');
  const groupsContainer = document.getElementById('tag-picker-groups');
  if (!selectedStrip || !groupsContainer) return;

  if (selectedIds.length === 0) {
    selectedStrip.innerHTML = '<span class="tag-picker-selected-empty">尚未选择标签</span>';
  } else {
    selectedStrip.innerHTML = selectedIds.map(id => {
      const tag = allTags.find(item => item.id === id);
      if (!tag) return '';
      const group = allTagGroups.find(item => item.id === (tag.parentId || 'group-uncategorized'));
      return `
        <button type="button" class="tag-picker-selected-chip" onclick="toggleTagPickerTag('${escapeJSAttr(tag.id)}')" style="--chip-color:${escapeAttr(tag.color)}">
          <span>${escapeHTML(tag.name)}</span>
          <small>${escapeHTML(group ? group.name : '未分类')}</small>
          <span aria-hidden="true">×</span>
        </button>
      `;
    }).join('');
  }

  groupsContainer.innerHTML = allTagGroups.map(group => {
    const tags = sortTagsForPickerLocal(
      allTags.filter(tag => (tag.parentId || 'group-uncategorized') === group.id),
      selectedIds
    );
    const isCollapsed = tagPickerCollapsedGroups.has(group.id);
    const selectedCount = tags.filter(tag => selectedIds.includes(tag.id)).length;
    return `
      <section class="tag-picker-group-card ${isCollapsed ? 'collapsed' : ''}">
        <button type="button" class="tag-picker-group-header" onclick="toggleTagPickerGroup('${escapeJSAttr(group.id)}')" aria-expanded="${!isCollapsed}">
          <span class="tag-group-dot" style="background:${escapeAttr(group.color)}"></span>
          <span class="tag-picker-group-name">${escapeHTML(group.name)}</span>
          <span class="tag-picker-group-count">${selectedCount}/${tags.length}</span>
          <span class="tag-picker-chevron" aria-hidden="true">⌄</span>
        </button>
        ${isCollapsed ? '' : `
          <div class="tag-picker-group-body">
            <div class="tag-picker-chip-grid">
              ${tags.length ? tags.map(tag => {
                const isSelected = selectedIds.includes(tag.id);
                return `
                  <button type="button" class="tag-picker-chip ${isSelected ? 'selected' : ''}" onclick="toggleTagPickerTag('${escapeJSAttr(tag.id)}')" style="--chip-color:${escapeAttr(tag.color)}">
                    <span class="tag-suggestion-dot" style="background:${escapeAttr(tag.color)}"></span>
                    <span>${escapeHTML(tag.name)}</span>
                    ${isSelected ? '<span class="tag-picker-chip-check">✓</span>' : ''}
                  </button>
                `;
              }).join('') : '<span class="tag-picker-empty-inline">此分组暂无标签</span>'}
            </div>
            ${renderTagPickerAddRow(group)}
          </div>
        `}
      </section>
    `;
  }).join('');
}

function renderTagPickerAddRow(group) {
  const groupId = group.id;
  if (!tagPickerNewInputGroups.has(groupId)) {
    return `
      <button type="button" class="tag-picker-add-row" onclick="showTagPickerNewInput('${escapeJSAttr(groupId)}')">
        <span aria-hidden="true">+</span>
        <span>新增到此分组</span>
      </button>
    `;
  }

  return `
    <form class="tag-picker-add-form" onsubmit="event.preventDefault(); createTagFromPicker('${escapeJSAttr(groupId)}')">
      <input type="text" id="tag-picker-new-${escapeAttr(groupId)}" placeholder="输入新标签名称" autocomplete="off">
      <button type="submit" class="btn-primary">添加</button>
    </form>
  `;
}

window.toggleTagPickerGroup = function(groupId) {
  if (tagPickerCollapsedGroups.has(groupId)) {
    tagPickerCollapsedGroups.delete(groupId);
  } else {
    tagPickerCollapsedGroups.add(groupId);
  }
  renderTagPicker();
};

window.showTagPickerNewInput = function(groupId) {
  tagPickerNewInputGroups.add(groupId);
  renderTagPicker();
  setTimeout(() => {
    const input = document.getElementById(`tag-picker-new-${groupId}`);
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 30);
};

window.toggleTagPickerTag = function(tagId) {
  if (!activeTagPickerMode) return;
  const state = getTagPickerState(activeTagPickerMode);
  const nextIds = state.selectedIds.includes(tagId)
    ? state.selectedIds.filter(id => id !== tagId)
    : state.selectedIds.concat(tagId);
  state.setSelectedIds(nextIds);
  state.renderSelected();
  updateTagPickerTrigger(activeTagPickerMode);
  renderTagPicker();
};

window.clearActiveTagPickerSelection = function() {
  if (!activeTagPickerMode) return;
  const state = getTagPickerState(activeTagPickerMode);
  state.setSelectedIds([]);
  state.renderSelected();
  updateTagPickerTrigger(activeTagPickerMode);
  renderTagPicker();
};

window.createTagFromPicker = async function(groupId) {
  if (!activeTagPickerMode) return;
  const input = document.getElementById(`tag-picker-new-${groupId}`);
  const name = input ? input.value.trim() : '';
  if (!name) {
    showToast('请输入标签名称');
    if (input) input.focus();
    return;
  }

  if (hasDuplicateTagNameInGroupLocal(allTags, name, groupId)) {
    showToast('同一分组中已存在这个标签');
    if (input) input.focus();
    return;
  }

  const group = allTagGroups.find(item => item.id === groupId);
  const newTag = await addTag({
    name,
    color: group ? group.color : '#2DBAA3',
    parentId: groupId
  });
  await loadTags();

  const state = getTagPickerState(activeTagPickerMode);
  if (!state.selectedIds.includes(newTag.id)) {
    state.setSelectedIds(state.selectedIds.concat(newTag.id));
  }
  tagPickerNewInputGroups.delete(groupId);
  state.renderSelected();
  updateTagPickerTrigger(activeTagPickerMode);
  renderTagPicker();
  renderExpenseList();
  refreshDashboard();
};

function renderGroupedTagDropdown(containerId, query, selectedIds, selectFnName, createFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const q = (query || '').trim();
  const visibleTags = getVisibleTagOptions(q, selectedIds);
  const exactExists = allTags.some(tag => tag.name === q);
  const tagsByGroup = {};
  visibleTags.forEach(tag => {
    const groupId = tag.parentId || 'group-uncategorized';
    if (!tagsByGroup[groupId]) tagsByGroup[groupId] = [];
    tagsByGroup[groupId].push(tag);
  });

  let html = '';
  for (const group of allTagGroups) {
    const tags = tagsByGroup[group.id] || [];
    if (tags.length === 0) continue;
    html += `
      <div class="tag-picker-group">
        <div class="tag-picker-group-title">
          <span class="tag-group-dot" style="background:${escapeAttr(group.color)}"></span>
          ${escapeHTML(group.name)}
        </div>
        <div class="tag-picker-options">
          ${tags.map(tag => `
            <button type="button" class="tag-suggestion-item tag-picker-option" data-id="${escapeAttr(tag.id)}" onclick="${selectFnName}('${escapeJSAttr(tag.id)}')">
              <span class="tag-suggestion-dot" style="background:${escapeAttr(tag.color)}"></span>
              <span>${escapeHTML(tag.name)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (q && !exactExists) {
    html += `
      <button type="button" class="tag-suggestion-item new-tag" onclick="${createFnName}('${escapeJSAttr(q)}')">
        <span class="tag-suggestion-dot" style="background:#2DBAA3"></span>
        <span>新建标签 "${escapeHTML(q)}"</span>
        <span class="tag-suggestion-group">未分类</span>
      </button>
    `;
  }

  if (!html) {
    html = '<div class="tag-picker-empty">暂无可选标签</div>';
  }
  container.innerHTML = html;
  container.style.display = 'block';
}

function onTagInput() {
  const input = document.getElementById('exp-tags-input');
  const raw = input.value.trim();
  tagSuggestionMatches = getVisibleTagOptions(raw, quickFormSelectedTags);
  suggestionHighlightIndex = -1;
  renderGroupedTagDropdown('tag-suggestions', raw, quickFormSelectedTags, 'selectSuggestionTag', 'createNewTagFromSuggestion');
}

function onTagInputKeydown(e) {
  const container = document.getElementById('tag-suggestions');
  if (container.style.display === 'none') {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      tryAddTagFromInput();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    if (tagSuggestionMatches.length === 0) return;
    e.preventDefault();
    suggestionHighlightIndex = (suggestionHighlightIndex + 1) % tagSuggestionMatches.length;
    updateSuggestionHighlight();
  } else if (e.key === 'ArrowUp') {
    if (tagSuggestionMatches.length === 0) return;
    e.preventDefault();
    suggestionHighlightIndex = (suggestionHighlightIndex - 1 + tagSuggestionMatches.length) % tagSuggestionMatches.length;
    updateSuggestionHighlight();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (suggestionHighlightIndex >= 0 && tagSuggestionMatches[suggestionHighlightIndex]) {
      selectSuggestionTag(tagSuggestionMatches[suggestionHighlightIndex].id);
    } else {
      tryAddTagFromInput();
    }
  } else if (e.key === 'Escape') {
    hideTagSuggestions();
  } else if (e.key === ',' || e.key === ' ') {
    e.preventDefault();
    tryAddTagFromInput();
  }
}

function updateSuggestionHighlight() {
  const items = document.querySelectorAll('#tag-suggestions .tag-picker-option');
  items.forEach((el, i) => {
    if (i === suggestionHighlightIndex) el.classList.add('highlighted');
    else el.classList.remove('highlighted');
  });
}

function hideTagSuggestions() {
  const container = document.getElementById('tag-suggestions');
  if (container) container.style.display = 'none';
  suggestionHighlightIndex = -1;
  tagSuggestionMatches = [];
}

window.selectSuggestionTag = function(tagId) {
  if (quickFormSelectedTags.includes(tagId)) return;
  quickFormSelectedTags.push(tagId);
  renderSelectedTags();
  document.getElementById('exp-tags-input').value = '';
  hideTagSuggestions();
};

window.createNewTagFromSuggestion = async function(name) {
  const parentId = 'group-uncategorized';
  if (!name || hasDuplicateTagNameInGroupLocal(allTags, name, parentId)) return;
  const newTag = await addTag({ name, color: '#2DBAA3', parentId });
  await loadTags();
  quickFormSelectedTags.push(newTag.id);
  renderSelectedTags();
  document.getElementById('exp-tags-input').value = '';
  hideTagSuggestions();
};

function tryAddTagFromInput() {
  const input = document.getElementById('exp-tags-input');
  const raw = input.value.trim();
  if (!raw) return;

  const names = raw.split(/[,，\s]+/).filter(n => n.trim());
  for (const name of names) {
    const nameTrimmed = name.trim();
    let tag = allTags.find(t => t.name === nameTrimmed);
    if (tag && !quickFormSelectedTags.includes(tag.id)) {
      quickFormSelectedTags.push(tag.id);
    } else if (!tag) {
      // Create new tag
      (async () => {
        const newTag = await addTag({ name: nameTrimmed, color: '#2DBAA3' });
        await loadTags();
        quickFormSelectedTags.push(newTag.id);
        renderSelectedTags();
      })();
    }
  }
  renderSelectedTags();
  input.value = '';
  hideTagSuggestions();
}

function renderSelectedTags() {
  const container = document.getElementById('selected-tags');
  if (!container) return;
  updateTagPickerTrigger('quick');

  if (quickFormSelectedTags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = quickFormSelectedTags.map(id => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return '';
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    const label = group ? `${escapeHTML(group.name)} · ${escapeHTML(tag.name)}` : escapeHTML(tag.name);
    const style = `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
    return `<span class="selected-tag-chip" style="${style}">${label}<button class="remove" onclick="removeQuickTag('${tag.id}')" aria-label="移除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`;
  }).join('');
}

window.removeQuickTag = function(tagId) {
  quickFormSelectedTags = quickFormSelectedTags.filter(id => id !== tagId);
  renderSelectedTags();
  if (activeTagPickerMode === 'quick') renderTagPicker();
};

// Recent Templates
async function loadRecentTemplates() {
  try {
    const stored = await getSettings('recent_templates', []);
    if (Array.isArray(stored)) recentTemplates = stored;
  } catch (e) {
    recentTemplates = [];
  }
}

async function saveRecentTemplate(tagIds) {
  if (!tagIds || tagIds.length === 0) return;
  const key = tagIds.slice().sort().join(',');
  // Remove existing same combination
  recentTemplates = recentTemplates.filter(t => t.tagIds.slice().sort().join(',') !== key);
  const tagNames = tagIds.map(id => {
    const tag = allTags.find(t => t.id === id);
    return tag ? tag.name : id;
  });
  recentTemplates.unshift({ tagIds: tagIds.slice(), tagNames });
  recentTemplates = recentTemplates.slice(0, 3);
  await setSettings('recent_templates', recentTemplates);
  renderRecentTemplates();
}

function renderRecentTemplates() {
  const container = document.getElementById('templates-chips');
  const wrapper = document.getElementById('recent-templates');
  if (!container || !wrapper) return;

  if (recentTemplates.length === 0) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = 'block';

  container.innerHTML = recentTemplates.map((tmpl, idx) => {
    const label = tmpl.tagNames.join(' + ') || '无标签';
    return `<span class="template-chip" onclick="applyTemplate(${idx})">${label}</span>`;
  }).join('');
}

window.applyTemplate = function(index) {
  const tmpl = recentTemplates[index];
  if (!tmpl) return;
  quickFormSelectedTags = tmpl.tagIds.filter(id => allTags.some(t => t.id === id));
  renderSelectedTags();
  document.getElementById('exp-amount').focus();
};

// Mode toggle
window.switchEntryMode = function(mode) {
  const formMode = document.getElementById('entry-form-mode');
  const nlMode = document.getElementById('entry-nl-mode');
  const formBtn = document.getElementById('mode-form-btn');
  const nlBtn = document.getElementById('mode-nl-btn');

  if (mode === 'form') {
    formMode.style.display = 'block';
    nlMode.style.display = 'none';
    formBtn.classList.add('active');
    nlBtn.classList.remove('active');
    setTimeout(() => document.getElementById('exp-amount').focus(), 50);
  } else {
    formMode.style.display = 'none';
    nlMode.style.display = 'block';
    formBtn.classList.remove('active');
    nlBtn.classList.add('active');
    setTimeout(() => document.getElementById('nl-input').focus(), 50);
  }
};

// Form submit
window.saveQuickExpense = async function() {
  const amount = document.getElementById('exp-amount').value;
  const date = document.getElementById('exp-date').value;
  const itemName = document.getElementById('exp-item-name').value.trim();

  if (!amount || parseFloat(amount) <= 0) {
    showToast('请输入金额');
    document.getElementById('exp-amount').focus();
    return;
  }
  if (!date) {
    showToast('请选择日期');
    return;
  }

  // Build category from first selected tag, or default
  let category = '';
  if (quickFormSelectedTags.length > 0) {
    const firstTag = allTags.find(t => t.id === quickFormSelectedTags[0]);
    if (firstTag) category = firstTag.name;
  }
  if (!category && allTags.length > 0) {
    category = allTags[0].name;
  }

  await addExpense({
    amount: parseFloat(amount),
    date,
    category,
    note: itemName,
    tags: quickFormSelectedTags.slice()
  });
  await afterExpenseCreated();

  await saveRecentTemplate(quickFormSelectedTags);
  showToast('保存成功！');
  resetQuickForm(true);
};

window.resetQuickForm = function(keepDate = false) {
  document.getElementById('exp-amount').value = '';
  if (!keepDate) {
    document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  }
  document.getElementById('exp-item-name').value = '';
  quickFormSelectedTags = [];
  renderSelectedTags();
  hideTagSuggestions();
  document.getElementById('exp-amount').focus();
};

// ============================================
// Natural Language Entry
// ============================================

function initNLInput() {
  const nlInput = document.getElementById('nl-input');
  if (!nlInput) return;

  let debounceTimer = null;
  nlInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      parseAndPreviewNL();
    }, 300);
  });

  nlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (nlParseResult && nlParseResult.amount) {
        saveNLExpense();
      }
    }
  });
}

function parseAndPreviewNL() {
  const input = document.getElementById('nl-input').value.trim();
  const previewBox = document.getElementById('nl-preview');
  const previewContent = document.getElementById('nl-preview-content');
  const saveBtn = document.getElementById('nl-save-btn');

  if (!input) {
    previewBox.style.display = 'none';
    saveBtn.disabled = true;
    nlParseResult = null;
    return;
  }

  const knownTags = allTags.map(t => t.name);
  nlParseResult = parseNaturalLanguage(input, knownTags);

  if (!nlParseResult.amount) {
    previewBox.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  // Resolve tag names to ids
  const tagIds = [];
  const tagObjs = [];
  for (const tname of nlParseResult.tags) {
    const tag = allTags.find(t => t.name === tname);
    if (tag && !tagIds.includes(tag.id)) {
      tagIds.push(tag.id);
      tagObjs.push(tag);
    }
  }
  nlParseResult.tagIds = tagIds;
  nlParseResult.tagObjs = tagObjs;

  // Build editable preview HTML
  const tagsHtml = tagObjs.map(t =>
    `<span class="nl-tag-pill" style="background:${t.color}22;color:${t.color};border:1px solid ${t.color}44" data-tag-id="${t.id}" onclick="nlRemoveTag('${t.id}')">${t.name} ✕</span>`
  ).join('');

  previewContent.innerHTML = `
    <div class="nl-preview-row">
      <span class="nl-preview-label">日期</span>
      <input type="date" id="nl-edit-date" class="nl-edit-field" value="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="nl-preview-row">
      <span class="nl-preview-label">项目</span>
      <input type="text" id="nl-edit-item" class="nl-edit-field" value="${nlParseResult.itemName || ''}" placeholder="输入项目名称">
    </div>
    <div class="nl-preview-row">
      <span class="nl-preview-label">金额</span>
      <input type="number" id="nl-edit-amount" class="nl-edit-field amount" value="${nlParseResult.amount}" step="0.01" min="0">
    </div>
    <div class="nl-preview-row">
      <span class="nl-preview-label">标签</span>
      <input type="text" id="nl-edit-tags" class="nl-edit-field" placeholder="添加标签（逗号分隔）" value="${nlParseResult.tags.join(', ')}">
    </div>
    <div class="nl-tags-preview">${tagsHtml}</div>
  `;
  previewBox.style.display = 'block';
  saveBtn.disabled = false;
}

window.nlRemoveTag = function(tagId) {
  if (!nlParseResult || !nlParseResult.tagIds) return;
  nlParseResult.tagIds = nlParseResult.tagIds.filter(id => id !== tagId);
  nlParseResult.tagObjs = (nlParseResult.tagObjs || []).filter(t => t.id !== tagId);
  // Re-parse from the tags input
  const tagsInput = document.getElementById('nl-edit-tags');
  if (tagsInput) {
    const remainingNames = nlParseResult.tagObjs.map(t => t.name);
    tagsInput.value = remainingNames.join(', ');
  }
  parseAndPreviewNL();
};

function parseNaturalLanguage(input, knownTags) {
  // 1. Extract amount (first number found, including decimals)
  const amountMatch = input.match(/\d+(?:\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  // 2. Identify known tags from the text (longest match first to prevent partial)
  const sortedTags = [...knownTags].sort((a, b) => b.length - a.length);
  const tags = [];

  for (const tagName of sortedTags) {
    const idx = input.indexOf(tagName);
    if (idx !== -1) {
      // Check if it's a whole-word match (surrounded by spaces, numbers, or string boundaries)
      const before = idx > 0 ? input[idx - 1] : ' ';
      const after = idx + tagName.length < input.length ? input[idx + tagName.length] : ' ';
      const isWordBoundary = /[\s\d,，.。!！?？;；:：/]/.test(before) && /[\s\d,，.。!！?？;；:：/]/.test(after);

      if (isWordBoundary || tagName.length > 1) {
        if (!tags.includes(tagName)) {
          tags.push(tagName);
        }
      }
    }
  }

  // 3. Remaining text becomes item name
  // Build a mask of characters to remove
  const remove = new Set();

  // Mark amount for removal
  if (amountMatch) {
    for (let i = amountMatch.index; i < amountMatch.index + amountMatch[0].length; i++) {
      remove.add(i);
    }
  }

  // Mark tags for removal (by finding their positions in the original input)
  for (const tagName of tags) {
    let idx = input.indexOf(tagName);
    while (idx !== -1) {
      for (let i = idx; i < idx + tagName.length; i++) {
        remove.add(i);
      }
      idx = input.indexOf(tagName, idx + 1);
    }
  }

  // Build remaining string from characters not marked for removal
  let remaining = '';
  for (let i = 0; i < input.length; i++) {
    if (!remove.has(i)) {
      remaining += input[i];
    }
  }

  // Clean up separators
  const itemName = remaining.replace(/[,，\s]+/g, ' ').trim() || '';

  return { amount, tags: [...new Set(tags)], itemName, raw: input };
}

window.saveNLExpense = async function() {
  // Read from editable fields
  const editAmount = document.getElementById('nl-edit-amount');
  const editDate = document.getElementById('nl-edit-date');
  const editItem = document.getElementById('nl-edit-item');
  const editTags = document.getElementById('nl-edit-tags');

  const amount = editAmount ? parseFloat(editAmount.value) : 0;
  const date = editDate ? editDate.value : new Date().toISOString().slice(0, 10);
  const itemName = editItem ? editItem.value.trim() : '';

  if (!amount || amount <= 0) {
    showToast('请输入有效金额');
    return;
  }

  // Resolve tags from the editable tags input
  let tagIds = nlParseResult ? (nlParseResult.tagIds || []) : [];
  let tagObjs = nlParseResult ? (nlParseResult.tagObjs || []) : [];

  if (editTags && editTags.value.trim()) {
    const tagNames = editTags.value.split(/[,，]+/).map(t => t.trim()).filter(Boolean);
    tagIds = [];
    tagObjs = [];
    for (const tname of tagNames) {
      let tag = allTags.find(t => t.name === tname);
      if (!tag) {
        // Auto-create tag
        tag = await addTag({ name: tname, color: '#2DBAA3', parentId: 'group-category' });
        await loadTags();
      }
      if (tag && !tagIds.includes(tag.id)) {
        tagIds.push(tag.id);
        tagObjs.push(tag);
      }
    }
  }

  let category = '';
  if (tagObjs.length > 0) {
    category = tagObjs[0].name;
  } else if (itemName) {
    category = itemName;
  } else {
    category = '其他';
  }

  await addExpense({
    amount,
    date,
    category,
    note: itemName || '',
    tags: tagIds
  });
  await afterExpenseCreated();

  await saveRecentTemplate(tagIds);
  showToast('保存成功！');
  resetNLForm();
};

window.resetNLForm = function() {
  document.getElementById('nl-input').value = '';
  document.getElementById('nl-preview').style.display = 'none';
  document.getElementById('nl-save-btn').disabled = true;
  nlParseResult = null;
  document.getElementById('nl-input').focus();
};

// ============================================
// Toast Notification
// ============================================

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// ============================================
// Feedback Email Copy
// ============================================

function copyFeedbackEmail(el) {
  const email = el.textContent.trim();

  const fallback = function () {
    const ta = document.createElement('textarea');
    ta.value = email;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('邮箱地址已复制');
    } catch (e) {
      showToast('复制失败，请手动复制');
    }
    document.body.removeChild(ta);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).then(function () {
      showToast('邮箱地址已复制');
    }).catch(function () {
      fallback();
    });
  } else {
    fallback();
  }
}

// ============================================
// Custom Confirm Modal
// ============================================

let confirmModalCallback = null;

/**
 * Show a custom confirm modal with title and message.
 * @param {string} message - Body text
 * @param {Function} onConfirm - Called when user clicks confirm
 * @param {string} title - Optional title (default: '确认操作')
 * @param {string} confirmLabel - Optional button label (default: '确认')
 */
window.showCustomConfirm = function(message, onConfirm, title, confirmLabel) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;
  
  document.getElementById('confirm-modal-message').textContent = message;
  document.getElementById('confirm-modal-title').textContent = title || '确认操作';
  const okBtn = document.getElementById('confirm-modal-ok');
  okBtn.textContent = confirmLabel || '确认';
  
  confirmModalCallback = onConfirm;
  modal.style.display = 'flex';
};

window.closeConfirmModal = function() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
  confirmModalCallback = null;
};

// ============================================
// Custom Modal (generic content)
// ============================================

window.showCustomModal = function(htmlContent, title) {
  const modal = document.getElementById('custom-modal');
  if (!modal) return;
  document.getElementById('custom-modal-title').textContent = title || '提示';
  document.getElementById('custom-modal-body').innerHTML = htmlContent;
  modal.style.display = 'flex';
};

window.closeCustomModal = function() {
  const modal = document.getElementById('custom-modal');
  if (modal) modal.style.display = 'none';
};

// ============================================
// Custom Rename Modal
// ============================================

let renameModalCallback = null;
let renameCurrentId = null;
let renameIsGroup = false;

window.openRenameModal = function(currentName, title, labelText, callback) {
  const modal = document.getElementById('rename-modal');
  if (!modal) return;

  document.getElementById('rename-modal-title').textContent = title;
  document.getElementById('rename-modal-label').textContent = labelText;
  document.getElementById('rename-modal-input').value = currentName;
  document.getElementById('rename-modal-error').style.display = 'none';

  renameModalCallback = callback;
  modal.style.display = 'flex';

  // Focus input after animation
  setTimeout(() => {
    const input = document.getElementById('rename-modal-input');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
};

window.closeRenameModal = function() {
  const modal = document.getElementById('rename-modal');
  if (modal) modal.style.display = 'none';
  renameModalCallback = null;
  renameCurrentId = null;
  renameIsGroup = false;
};

// Handle Enter key press
document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('rename-modal-input');
  const okBtn = document.getElementById('rename-modal-ok');
  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (okBtn) okBtn.click();
      }
    });
  }
  if (okBtn) {
    okBtn.addEventListener('click', async function() {
      const input = document.getElementById('rename-modal-input');
      const newName = input ? input.value.trim() : '';
      const errorEl = document.getElementById('rename-modal-error');
      if (!newName) {
        if (errorEl) {
          errorEl.textContent = '名称不能为空';
          errorEl.style.display = 'block';
        }
        return;
      }
      if (renameModalCallback) {
        await renameModalCallback(newName);
      }
      closeRenameModal();
    });
  }

  // Close when clicking backdrop
  const overlay = document.getElementById('rename-modal');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closeRenameModal();
      }
    });
  }
});

// ============================================
// Confirm Modal
// ============================================

// Bind confirm button
document.addEventListener('DOMContentLoaded', function() {
  const okBtn = document.getElementById('confirm-modal-ok');
  if (okBtn) {
    okBtn.addEventListener('click', function() {
      const cb = confirmModalCallback;
      closeConfirmModal();
      if (cb) cb();
    });
  }

  // Close modals when clicking backdrop
  const confirmOverlay = document.getElementById('confirm-modal');
  if (confirmOverlay) {
    confirmOverlay.addEventListener('click', function(e) {
      if (e.target === confirmOverlay) closeConfirmModal();
    });
  }
  const customOverlay = document.getElementById('custom-modal');
  if (customOverlay) {
    customOverlay.addEventListener('click', function(e) {
      if (e.target === customOverlay) closeCustomModal();
    });
  }
  const mergeOverlay = document.getElementById('merge-modal');
  if (mergeOverlay) {
    mergeOverlay.addEventListener('click', function(e) {
      if (e.target === mergeOverlay) closeMergeModal();
    });
  }
  const editOverlay = document.getElementById('edit-modal');
  if (editOverlay) {
    editOverlay.addEventListener('click', function(e) {
      if (e.target === editOverlay) closeEditModal();
    });
  }
  const detailOverlay = document.getElementById('detail-modal');
  if (detailOverlay) {
    detailOverlay.addEventListener('click', function(e) {
      if (e.target === detailOverlay) closeExpenseDetail();
    });
  }
  const deleteOverlay = document.getElementById('delete-modal');
  if (deleteOverlay) {
    deleteOverlay.addEventListener('click', function(e) {
      if (e.target === deleteOverlay) closeDeleteModal();
    });
  }
});

// ============================================
// Helpers: Recently used tags
// ============================================

function getRecentlyUsedTagIds() {
  // Collect tag usage frequency from recent expenses (last 30)
  // This is synchronous; we keep a simple cache or compute on demand
  // For simplicity, return tags from recentTemplates first, then all tags
  const ids = [];
  for (const tmpl of recentTemplates) {
    for (const id of tmpl.tagIds) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function escapeJSString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

function escapeJSAttr(value) {
  return escapeAttr(escapeJSString(value));
}

// ============================================
// Expense List
// ============================================

function initListView() {
  const search = document.getElementById('list-search');
  const sort = document.getElementById('list-sort');
  const categoryModal = document.getElementById('list-category-modal');

  if (search) search.addEventListener('input', () => {
    listViewCurrentOffset = 0;
    renderExpenseList();
  });
  if (sort) sort.addEventListener('change', () => {
    listViewCurrentOffset = 0;
    renderExpenseList();
  });
  if (categoryModal) {
    categoryModal.addEventListener('click', event => {
      if (event.target && event.target.matches('[data-list-category-close]')) {
        closeListCategoryPicker();
      }
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeListCategoryPicker();
    }
  });

  const container = document.getElementById('expense-list');
  if (!container) return;
  container.addEventListener('click', onExpenseListClick);
  container.addEventListener('pointerdown', onExpensePointerStart);
  container.addEventListener('pointermove', onExpensePointerMove);
  container.addEventListener('pointerup', onExpensePointerEnd);
  container.addEventListener('pointercancel', clearListGestureState);
}

function onExpenseListClick(e) {
  const actionButton = e.target.closest('[data-expense-action]');
  if (ExpenseListUtils.shouldSuppressExpenseClick(
    suppressExpenseClickUntil,
    Date.now(),
    Boolean(actionButton)
  )) {
    suppressExpenseClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (actionButton) {
    e.stopPropagation();
    const id = actionButton.closest('.expense-swipe-row')?.dataset.id;
    if (!id) return;
    closeActiveSwipeRow();
    if (actionButton.dataset.expenseAction === 'edit') openEditModal(id);
    if (actionButton.dataset.expenseAction === 'delete') openDeleteModal(id);
    return;
  }

  const row = e.target.closest('.expense-swipe-row');
  if (!row) return;
  if (row.classList.contains('actions-open')) {
    closeActiveSwipeRow();
    return;
  }
  openExpenseDetail(row.dataset.id);
}

function onExpensePointerStart(e) {
  const allowMouseSwipe = e.pointerType === 'mouse'
    && window.matchMedia('(max-width: 768px)').matches;
  if ((e.pointerType === 'mouse' && !allowMouseSwipe)
    || (typeof e.button === 'number' && e.button !== 0)) return;
  const row = e.target.closest('.expense-swipe-row');
  if (!row || e.target.closest('[data-expense-action]')) return;
  listTouchState = {
    row,
    id: row.dataset.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    deltaX: 0,
    deltaY: 0,
    pointerType: e.pointerType,
    allowMouseSwipe
  };
  if (row.setPointerCapture) {
    try {
      row.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers do not allow capture after certain synthetic events.
    }
  }
}

function onExpensePointerMove(e) {
  if (!listTouchState) return;
  if (e.pointerId !== listTouchState.pointerId) return;
  const dx = e.clientX - listTouchState.startX;
  const dy = e.clientY - listTouchState.startY;
  listTouchState.deltaX = dx;
  listTouchState.deltaY = dy;

  if (Math.abs(dx) > Math.abs(dy) && dx < -8) {
    e.preventDefault();
    const content = listTouchState.row.querySelector('.expense-item');
    if (content) {
      content.style.transform = `translateX(${Math.max(dx, -132)}px)`;
    }
  }
}

function onExpensePointerEnd(e) {
  if (!listTouchState) return;
  if (e.pointerId !== listTouchState.pointerId) return;
  const { id, row, deltaX, deltaY, pointerType, allowMouseSwipe } = listTouchState;
  const content = row.querySelector('.expense-item');
  if (content) content.style.transform = '';

  const gesture = ExpenseListUtils.getExpenseGestureResult({
    pointerType,
    deltaX,
    deltaY,
    allowMouseSwipe
  });
  if (gesture.suppressClick) {
    suppressExpenseClickUntil = Date.now() + 400;
  }
  if (gesture.action === 'open') {
    openSwipeRow(id);
  } else if (gesture.action === 'close') {
    closeActiveSwipeRow();
  }
  clearListGestureState();
}

function clearListGestureState() {
  const content = listTouchState?.row?.querySelector('.expense-item');
  if (content) content.style.transform = '';
  listTouchState = null;
}

function openSwipeRow(id) {
  if (!id) return;
  document.querySelectorAll('.expense-swipe-row.actions-open').forEach(row => {
    if (row.dataset.id !== id) row.classList.remove('actions-open');
  });
  const row = Array.from(document.querySelectorAll('.expense-swipe-row')).find(item => item.dataset.id === id);
  if (row) row.classList.add('actions-open');
  activeSwipeExpenseId = id;
}

function closeActiveSwipeRow() {
  if (!activeSwipeExpenseId) return;
  document.querySelectorAll('.expense-swipe-row.actions-open').forEach(row => row.classList.remove('actions-open'));
  activeSwipeExpenseId = null;
}

window.renderExpenseList = async function() {
  const container = document.getElementById('expense-list');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (!container) return;

  const search = document.getElementById('list-search');
  const sort = document.getElementById('list-sort');

  let expenses = await getExpenses();

  if (search && search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    expenses = expenses.filter(e =>
      (e.date || '').toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      (e.tags || []).some(tid => {
        const tag = allTags.find(x => x.id === tid);
        return tag && tag.name.toLowerCase().includes(q);
      })
    );
  }

  if (selectedListCategoryTagIds.length > 0) {
    const filterValues = selectedListCategoryTagIds.map(id => `tag:${id}`);
    expenses = expenses.filter(e => ExpenseListUtils.expenseMatchesCategoryFilters(e, filterValues, allTags));
  }

  const sortValue = sort ? sort.value : 'date-desc';
  if (ExpenseListUtils && typeof ExpenseListUtils.sortExpensesForList === 'function') {
    expenses = ExpenseListUtils.sortExpensesForList(expenses, sortValue);
  } else {
    expenses.sort((a, b) => {
      const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
      return dateCompare || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  listViewAllExpenses = expenses;

  if (expenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>暂无支出记录</p>
        <button class="btn-primary" onclick="switchView('add')">记一笔</button>
      </div>
    `;
    if (loadMoreWrap) loadMoreWrap.style.display = 'none';
    return;
  }

  // Group by month, WeChat-style.
  const grouped = ExpenseListUtils.groupExpensesByMonth(expenses);
  const sortedMonths = Object.keys(grouped).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    if (sortValue === 'date-asc') return a.localeCompare(b);
    return b.localeCompare(a);
  });

  // Flatten with pagination
  let flatItems = [];
  for (const month of sortedMonths) {
    flatItems.push({ type: 'header', month });
    for (const exp of grouped[month].items) {
      flatItems.push({ type: 'expense', data: exp });
    }
  }

  const visibleItems = flatItems.slice(0, listViewCurrentOffset + listViewPageSize);
  const hasMore = visibleItems.length < flatItems.length;

  let html = '';
  for (const item of visibleItems) {
    if (item.type === 'header') {
      const monthTotal = grouped[item.month].total;
      html += `
        <div class="expense-month-header">
          <span class="expense-month-label">${ExpenseListUtils.formatMonthLabel(item.month)}</span>
          <span class="expense-month-total">支出 ¥${monthTotal.toFixed(2)}</span>
        </div>
      `;
    } else {
      const exp = item.data;
      const displayName = exp.note ? exp.note : (exp.category || '未命名');
      const rowOpenClass = activeSwipeExpenseId === exp.id ? ' actions-open' : '';
      const primaryTag = ExpenseListUtils.selectPrimaryExpenseTag(exp.tags, allTags);
      html += `
        <div class="expense-swipe-row${rowOpenClass}" data-id="${escapeAttr(exp.id)}">
          <div class="expense-swipe-actions">
            <button class="swipe-action edit" data-expense-action="edit" title="编辑" aria-label="编辑">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
            </button>
            <button class="swipe-action delete" data-expense-action="delete" title="删除" aria-label="删除">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
          <div class="expense-item">
            <div class="expense-icon" aria-hidden="true">${escapeHTML(displayName.trim().charAt(0) || '账')}</div>
            <div class="expense-info">
              <div class="expense-title">${escapeHTML(displayName)}</div>
              <div class="expense-meta">
                <span class="expense-date-text">${ExpenseListUtils.formatExpenseDay(exp.date)}</span>
                ${primaryTag ? `<span class="expense-tag-pill" style="background:${escapeAttr(primaryTag.color)}22;color:${escapeAttr(primaryTag.color)};border:1px solid ${escapeAttr(primaryTag.color)}44">${escapeHTML(primaryTag.name)}</span>` : ''}
              </div>
            </div>
            <div class="expense-amount">-¥${(exp.amount || 0).toFixed(2)}</div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;

  if (loadMoreWrap) {
    loadMoreWrap.style.display = hasMore ? 'flex' : 'none';
  }
};

window.loadMoreExpenses = function() {
  listViewCurrentOffset += listViewPageSize;
  renderExpenseList();
};

// ============================================
// Expense Detail Modal
// ============================================

window.openExpenseDetail = async function(id) {
  const expenses = await getExpenses();
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  const detail = ExpenseListUtils.createExpenseDetailView(expense, allTags, allTagGroups);
  document.getElementById('detail-amount').textContent = detail.amount;
  document.getElementById('detail-title').textContent = detail.title;
  document.getElementById('detail-date').textContent = detail.dateLabel || detail.date || '未设置';
  document.getElementById('detail-category').textContent = detail.category || '未分类';

  const tagsContainer = document.getElementById('detail-tags');
  tagsContainer.innerHTML = detail.tagGroups.length > 0
    ? detail.tagGroups.map(group => `
        <div class="expense-detail-tag-group">
          <div class="expense-detail-tag-group-name">${escapeHTML(group.name)}</div>
          <div class="expense-detail-tag-group-items">
            ${group.tags.map(tag => `
              <span class="expense-tag-pill" style="background:${escapeAttr(tag.color)}22;color:${escapeAttr(tag.color)};border:1px solid ${escapeAttr(tag.color)}44">
                ${escapeHTML(tag.name)}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('')
    : '<span class="expense-detail-empty">无标签</span>';

  document.getElementById('detail-modal').style.display = 'flex';
};

window.closeExpenseDetail = function() {
  const modal = document.getElementById('detail-modal');
  if (modal) modal.style.display = 'none';
};

// ============================================
// Edit Expense Modal
// ============================================

function initEditModal() {
  const tagInput = document.getElementById('edit-tags-input');
  if (tagInput) {
    prepareTagPickerTrigger(tagInput, 'edit');
  }
}

window.openEditModal = async function(id) {
  const expenses = await getExpenses();
  const exp = expenses.find(e => e.id === id);
  if (!exp) return;

  editingExpenseId = id;
  editFormSelectedTags = (exp.tags || []).slice();

  document.getElementById('edit-amount').value = exp.amount;
  document.getElementById('edit-date').value = exp.date;
  document.getElementById('edit-item-name').value = exp.note || '';
  renderEditSelectedTags();
  updateTagPickerTrigger('edit');

  const modal = document.getElementById('edit-modal');
  modal.style.display = 'flex';
};

window.closeEditModal = function() {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.style.display = 'none';
  editingExpenseId = null;
  editFormSelectedTags = [];
  updateTagPickerTrigger('edit');
  hideEditTagSuggestions();
};

window.saveEditExpense = async function() {
  if (!editingExpenseId) return;

  const amount = document.getElementById('edit-amount').value;
  const date = document.getElementById('edit-date').value;
  const itemName = document.getElementById('edit-item-name').value.trim();

  if (!amount || parseFloat(amount) <= 0) {
    showToast('请输入金额');
    return;
  }
  if (!date) {
    showToast('请选择日期');
    return;
  }

  let category = '';
  if (editFormSelectedTags.length > 0) {
    const firstTag = allTags.find(t => t.id === editFormSelectedTags[0]);
    if (firstTag) category = firstTag.name;
  }
  if (!category && allTags.length > 0) {
    category = allTags[0].name;
  }

  await updateExpense({
    id: editingExpenseId,
    amount: parseFloat(amount),
    date,
    category,
    note: itemName,
    tags: editFormSelectedTags.slice()
  });

  showToast('更新成功！');
  closeEditModal();
  renderExpenseList();
  refreshDashboard();
};

function onEditTagInput() {
  const input = document.getElementById('edit-tags-input');
  const raw = input.value.trim();
  editTagSuggestionMatches = getVisibleTagOptions(raw, editFormSelectedTags);
  editSuggestionHighlightIndex = -1;
  renderGroupedTagDropdown('edit-tag-suggestions', raw, editFormSelectedTags, 'selectEditSuggestionTag', 'createNewEditTagFromSuggestion');
}

function onEditTagInputKeydown(e) {
  const container = document.getElementById('edit-tag-suggestions');
  if (container.style.display === 'none') {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      tryAddEditTagFromInput();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    if (editTagSuggestionMatches.length === 0) return;
    e.preventDefault();
    editSuggestionHighlightIndex = (editSuggestionHighlightIndex + 1) % editTagSuggestionMatches.length;
    updateEditSuggestionHighlight();
  } else if (e.key === 'ArrowUp') {
    if (editTagSuggestionMatches.length === 0) return;
    e.preventDefault();
    editSuggestionHighlightIndex = (editSuggestionHighlightIndex - 1 + editTagSuggestionMatches.length) % editTagSuggestionMatches.length;
    updateEditSuggestionHighlight();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (editSuggestionHighlightIndex >= 0 && editTagSuggestionMatches[editSuggestionHighlightIndex]) {
      selectEditSuggestionTag(editTagSuggestionMatches[editSuggestionHighlightIndex].id);
    } else {
      tryAddEditTagFromInput();
    }
  } else if (e.key === 'Escape') {
    hideEditTagSuggestions();
  } else if (e.key === ',' || e.key === ' ') {
    e.preventDefault();
    tryAddEditTagFromInput();
  }
}

function updateEditSuggestionHighlight() {
  const items = document.querySelectorAll('#edit-tag-suggestions .tag-picker-option');
  items.forEach((el, i) => {
    if (i === editSuggestionHighlightIndex) el.classList.add('highlighted');
    else el.classList.remove('highlighted');
  });
}

function hideEditTagSuggestions() {
  const container = document.getElementById('edit-tag-suggestions');
  if (container) container.style.display = 'none';
  editSuggestionHighlightIndex = -1;
  editTagSuggestionMatches = [];
}

window.selectEditSuggestionTag = function(tagId) {
  if (editFormSelectedTags.includes(tagId)) return;
  editFormSelectedTags.push(tagId);
  renderEditSelectedTags();
  document.getElementById('edit-tags-input').value = '';
  hideEditTagSuggestions();
};

window.createNewEditTagFromSuggestion = async function(name) {
  const parentId = 'group-uncategorized';
  if (!name || hasDuplicateTagNameInGroupLocal(allTags, name, parentId)) return;
  const newTag = await addTag({ name, color: '#2DBAA3', parentId });
  await loadTags();
  editFormSelectedTags.push(newTag.id);
  renderEditSelectedTags();
  document.getElementById('edit-tags-input').value = '';
  hideEditTagSuggestions();
};

function tryAddEditTagFromInput() {
  const input = document.getElementById('edit-tags-input');
  const raw = input.value.trim();
  if (!raw) return;

  const names = raw.split(/[,，\s]+/).filter(n => n.trim());
  for (const name of names) {
    const nameTrimmed = name.trim();
    let tag = allTags.find(t => t.name === nameTrimmed);
    if (tag && !editFormSelectedTags.includes(tag.id)) {
      editFormSelectedTags.push(tag.id);
    } else if (!tag) {
      // Create new tag
      (async () => {
        const newTag = await addTag({ name: nameTrimmed, color: '#2DBAA3' });
        await loadTags();
        editFormSelectedTags.push(newTag.id);
        renderEditSelectedTags();
      })();
    }
  }
  renderEditSelectedTags();
  input.value = '';
  hideEditTagSuggestions();
}

function renderEditSelectedTags() {
  const container = document.getElementById('edit-selected-tags');
  if (!container) return;
  updateTagPickerTrigger('edit');

  if (editFormSelectedTags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = editFormSelectedTags.map(id => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return '';
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    const label = group ? `${escapeHTML(group.name)} · ${escapeHTML(tag.name)}` : escapeHTML(tag.name);
    const style = `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
    return `<span class="selected-tag-chip" style="${style}">${label}<button class="remove" onclick="removeEditTag('${tag.id}')" aria-label="移除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`;
  }).join('');
}

window.removeEditTag = function(tagId) {
  editFormSelectedTags = editFormSelectedTags.filter(id => id !== tagId);
  renderEditSelectedTags();
  if (activeTagPickerMode === 'edit') renderTagPicker();
};

// ============================================
// Delete Expense Modal
// ============================================

window.openDeleteModal = function(id) {
  pendingDeleteExpenseId = id;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeDeleteModal = function() {
  pendingDeleteExpenseId = null;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmDeleteExpense = async function() {
  if (!pendingDeleteExpenseId) return;
  await deleteExpense(pendingDeleteExpenseId);
  pendingDeleteExpenseId = null;
  closeDeleteModal();
  showToast('已删除');
  renderExpenseList();
  refreshDashboard();
};

function renderTagSelector(selectedIds = []) {
  const container = document.getElementById('tag-selector');
  if (!container) return;

  if (allTags.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无标签，可在标签管理中创建</p>';
    return;
  }

  container.innerHTML = allTags.map(tag => {
    const isSelected = selectedIds.includes(tag.id);
    const style = `background:${tag.color}22;color:${tag.color};border-color:${isSelected ? tag.color : 'transparent'}`;
    return `<span class="tag-chip ${isSelected ? 'selected' : ''}" data-id="${tag.id}" style="${style}" onclick="this.classList.toggle('selected')">${tag.name}</span>`;
  }).join('');
}

// ============================================
// Tags Management
// ============================================

window.addNewTag = async function() {
  const nameInput = document.getElementById('new-tag-name');
  const colorInput = document.getElementById('new-tag-color');
  const groupSelect = document.getElementById('new-tag-group');
  const name = nameInput ? nameInput.value.trim() : '';
  const color = colorInput ? colorInput.value : '#2DBAA3';
  const groupId = groupSelect ? groupSelect.value : '';

  if (!groupId) {
    showToast('请先选择分组');
    if (groupSelect) groupSelect.focus();
    return;
  }
  if (!name) {
    showToast('请输入标签名称');
    if (nameInput) nameInput.focus();
    return;
  }

  // Check duplicate
  if (hasDuplicateTagNameInGroupLocal(allTags, name, groupId)) {
    showToast('标签名称已存在');
    return;
  }

  const tag = await addTag({ name, color, parentId: groupId });
  if (nameInput) nameInput.value = '';
  await loadTags();
  renderTagSelector();
  if (nameInput) nameInput.focus();
};

// Track collapsed state for groups
const collapsedGroups = new Set();

window.renderTagsList = async function() {
  const container = document.getElementById('tags-list');
  if (!container) return;

  // Update the group select dropdown
  const groupSelect = document.getElementById('new-tag-group');
  const bulkMoveSelect = document.getElementById('bulk-move-group');
  const groupOptions = allTagGroups.map(g => `<option value="${escapeAttr(g.id)}">${escapeHTML(g.name)}</option>`).join('');
  if (groupSelect) {
    const current = groupSelect.value;
    groupSelect.innerHTML = '<option value="">选择分组...</option>' + groupOptions;
    if (allTagGroups.some(g => g.id === current)) {
      groupSelect.value = current;
    } else if (allTagGroups.some(g => g.id === 'group-category')) {
      groupSelect.value = 'group-category';
    }
  }
  if (bulkMoveSelect) {
    const current = bulkMoveSelect.value;
    bulkMoveSelect.innerHTML = '<option value="">移动到分组...</option>' + groupOptions;
    if (allTagGroups.some(g => g.id === current)) {
      bulkMoveSelect.value = current;
    }
  }

  const expenses = await getExpenses();
  const tagCounts = {};
  for (const exp of expenses) {
    for (const tid of (exp.tags || [])) {
      tagCounts[tid] = (tagCounts[tid] || 0) + 1;
    }
  }

  if (allTagGroups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏷️</div>
        <p>暂无分组</p>
      </div>
    `;
    return;
  }

  selectedManagedTagIds = selectedManagedTagIds.filter(id => allTags.some(tag => tag.id === id));
  renderTagBulkActions();

  // Group tags by parentId
  const tagsByGroup = {};
  for (const group of allTagGroups) {
    tagsByGroup[group.id] = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === group.id);
  }

  let html = '';
  const query = tagSearchQuery.trim().toLowerCase();
  for (const group of allTagGroups) {
    const originalTags = tagsByGroup[group.id] || [];
    const groupMatches = query && group.name.toLowerCase().includes(query);
    const tags = query && !groupMatches
      ? originalTags.filter(tag => tag.name.toLowerCase().includes(query))
      : originalTags;
    if (query && !groupMatches && tags.length === 0) continue;

    const isCollapsed = collapsedGroups.has(group.id);
    const totalCount = originalTags.reduce((sum, tag) => sum + (tagCounts[tag.id] || 0), 0);

    html += `
      <div class="tag-group-card" data-group-id="${escapeAttr(group.id)}">
        <div class="tag-group-header" onclick="toggleGroupCollapse('${escapeJSAttr(group.id)}')">
          <div class="tag-group-left">
            <span class="tag-group-toggle ${isCollapsed ? 'collapsed' : ''}">▼</span>
            <span class="tag-group-dot" style="background:${escapeAttr(group.color)}"></span>
            <span class="tag-group-name">${escapeHTML(group.name)}</span>
            <span class="tag-group-total">${originalTags.length} 标签 / ${totalCount} 笔</span>
          </div>
          <div class="tag-group-actions" onclick="event.stopPropagation();">
            <button class="tag-group-action-btn primary" onclick="quickAddTagToGroup('${escapeJSAttr(group.id)}')" title="添加标签到此分组">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button class="tag-group-action-btn" onclick="renameGroup('${escapeJSAttr(group.id)}')" title="重命名">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="tag-group-action-btn delete" onclick="removeGroup('${escapeJSAttr(group.id)}')" title="删除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
        <div class="tag-group-body ${isCollapsed ? 'collapsed' : ''}">
          ${tags.length === 0 ? `
            <div class="tree-tag-item empty-group">
              <span class="empty-text">此分组暂无标签</span>
            </div>
          ` : tags.map(tag => `
            <div class="tree-tag-item ${selectedManagedTagIds.includes(tag.id) ? 'selected' : ''}" data-tag-id="${escapeAttr(tag.id)}">
              <button class="tag-select-toggle" onclick="toggleManagedTagSelection('${escapeJSAttr(tag.id)}')" title="选择标签" aria-label="选择标签">
                ${selectedManagedTagIds.includes(tag.id) ? '✓' : ''}
              </button>
              <div class="tag-display">
                <div class="tag-color-dot" style="background:${escapeAttr(tag.color)}"></div>
                <span class="tag-name">${escapeHTML(tag.name)}</span>
                <span class="tag-count" onclick="filterByTagFromList('${escapeJSAttr(tag.id)}')" style="cursor:pointer;">${tagCounts[tag.id] || 0} 笔</span>
              </div>
              <div class="tag-actions">
                <input type="color" class="tag-color-input" value="${escapeAttr(tag.color)}" title="更改颜色" onchange="changeTagColor('${escapeJSAttr(tag.id)}', this.value)">
                <button class="tag-action-icon" onclick="renameTag('${escapeJSAttr(tag.id)}')" title="重命名">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="tag-action-icon" onclick="moveTagPrompt('${escapeJSAttr(tag.id)}', '${escapeJSAttr(tag.name)}')" title="移动">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
                </button>
                <button class="tag-action-icon" onclick="openMergeModal('${escapeJSAttr(tag.id)}')" title="合并">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                </button>
                <button class="tag-action-icon delete" onclick="removeTag('${escapeJSAttr(tag.id)}')" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html || `
    <div class="empty-state">
      <div class="empty-icon">🏷️</div>
      <p>没有匹配的标签</p>
    </div>
  `;
};

// ============================================
// Tag Group Management Functions
// ============================================

function renderTagBulkActions() {
  const bar = document.getElementById('tag-bulk-actions');
  const count = document.getElementById('tag-bulk-count');
  if (!bar || !count) return;

  count.textContent = `已选 ${selectedManagedTagIds.length} 个标签`;
  bar.style.display = selectedManagedTagIds.length > 0 ? 'flex' : 'none';
}

window.handleTagSearch = function(value) {
  tagSearchQuery = value || '';
  renderTagsList();
};

window.toggleManagedTagSelection = function(tagId) {
  if (selectedManagedTagIds.includes(tagId)) {
    selectedManagedTagIds = selectedManagedTagIds.filter(id => id !== tagId);
  } else {
    selectedManagedTagIds.push(tagId);
  }
  renderTagBulkActions();
  renderTagsList();
};

window.clearTagSelection = function() {
  selectedManagedTagIds = [];
  renderTagBulkActions();
  renderTagsList();
};

window.moveSelectedTags = async function() {
  const select = document.getElementById('bulk-move-group');
  const targetGroupId = select ? select.value : '';
  if (selectedManagedTagIds.length === 0) {
    showToast('请选择标签');
    return;
  }
  if (!targetGroupId) {
    showToast('请选择目标分组');
    return;
  }

  const movingTags = selectedManagedTagIds
    .map(tagId => allTags.find(tag => tag.id === tagId))
    .filter(Boolean);
  const movingNames = new Set();
  for (const tag of movingTags) {
    const name = String(tag.name || '').trim();
    if (movingNames.has(name) || hasDuplicateTagNameInGroupLocal(allTags, name, targetGroupId, tag.id)) {
      showToast('目标分组中已存在同名标签');
      return;
    }
    movingNames.add(name);
  }

  for (const tagId of selectedManagedTagIds) {
    await moveTagToGroup(tagId, targetGroupId);
  }
  const movedCount = selectedManagedTagIds.length;
  selectedManagedTagIds = [];
  await loadTags();
  renderExpenseList();
  refreshDashboard();
  showToast(`已移动 ${movedCount} 个标签`);
};

window.quickAddTagToGroup = function(groupId) {
  const groupSelect = document.getElementById('new-tag-group');
  const nameInput = document.getElementById('new-tag-name');
  if (groupSelect) groupSelect.value = groupId;
  if (nameInput) {
    nameInput.focus();
    nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.toggleGroupCollapse = function(groupId) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
  renderTagsList();
};

window.addNewGroup = async function() {
  const nameInput = document.getElementById('new-group-name');
  const colorInput = document.getElementById('new-group-color');
  const name = nameInput ? nameInput.value.trim() : '';
  const color = colorInput ? colorInput.value : '#95a5a6';

  if (!name) {
    showToast('请输入分组名称');
    return;
  }

  // Check duplicate
  if (allTagGroups.some(g => g.name === name)) {
    showToast('分组名称已存在');
    return;
  }

  try {
    await addTagGroup({ name, color });
    if (nameInput) nameInput.value = '';
    if (colorInput) colorInput.value = '#95a5a6';
    await loadTags();
    showToast('分组创建成功');
    renderExpenseList();
    refreshDashboard();
  } catch (e) {
    console.error('addNewGroup failed:', e);
    showToast('创建分组失败: ' + (e.message || '未知错误'));
  }
};

window.renameGroup = async function(groupId) {
  const group = allTagGroups.find(g => g.id === groupId);
  if (!group) return;

  openRenameModal(group.name, '重命名分组', '新分组名称', async function(newName) {
    if (newName !== group.name) {
      if (allTagGroups.some(g => g.id !== groupId && g.name === newName)) {
        const errorEl = document.getElementById('rename-modal-error');
        if (errorEl) {
          errorEl.textContent = '分组名称已存在';
          errorEl.style.display = 'block';
        }
        return;
      }
      await updateTagGroup({ id: groupId, name: newName });
      await loadTags();
      renderExpenseList();
      refreshDashboard();
      showToast('重命名成功');
    }
  });
};

window.removeGroup = async function(groupId) {
  const group = allTagGroups.find(g => g.id === groupId);
  if (!group) return;

  const tagsInGroup = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === groupId);
  const msg = tagsInGroup.length > 0
    ? `确定要删除分组"${group.name}"吗？其中的 ${tagsInGroup.length} 个标签将被移到"未分类"。`
    : `确定要删除分组"${group.name}"吗？`;

  showCustomConfirm(msg, async () => {
    await deleteTagGroup(groupId);
    await loadTags();
    renderExpenseList();
    refreshDashboard();
    showToast('分组已删除');
  }, '删除分组', '删除');
};

window.moveTagPrompt = function(tagId, tagName) {
  const groups = allTagGroups.filter(g => {
    const currentParentId = allTags.find(t => t.id === tagId)?.parentId || 'group-uncategorized';
    return g.id !== currentParentId;
  });

  if (groups.length === 0) {
    showToast('没有其他可移动的分组');
    return;
  }

  const groupOptions = groups.map(g =>
    `<div class="move-group-option" onclick="moveTagToGroupAction('${tagId}', '${g.id}')">
      <span class="tag-group-dot" style="background:${g.color}"></span>
      ${g.name}
    </div>`
  ).join('');

  showCustomModal(`
    <p>将标签 <strong>${tagName}</strong> 移动到：</p>
    <div class="move-group-list">${groupOptions}</div>
  `, '移动标签');
};

window.moveTagToGroupAction = async function(tagId, groupId) {
  const tag = allTags.find(t => t.id === tagId);
  if (tag && hasDuplicateTagNameInGroupLocal(allTags, tag.name, groupId, tagId)) {
    showToast('目标分组中已存在同名标签');
    return;
  }
  await moveTagToGroup(tagId, groupId);
  await loadTags();
  renderExpenseList();
  refreshDashboard();
  showToast('移动成功');
  closeCustomModal();
};

window.changeTagColor = async function(id, color) {
  await updateTag({ id, color });
  await loadTags();
  renderExpenseList();
  refreshDashboard();
};

window.renameTag = async function(id) {
  const tag = allTags.find(t => t.id === id);
  if (!tag) return;

  openRenameModal(tag.name, '重命名标签', '新标签名称', async function(newName) {
    if (newName !== tag.name) {
      const currentGroupId = tag.parentId || 'group-uncategorized';
      if (hasDuplicateTagNameInGroupLocal(allTags, newName, currentGroupId, id)) {
        const errorEl = document.getElementById('rename-modal-error');
        if (errorEl) {
          errorEl.textContent = '标签名称已存在';
          errorEl.style.display = 'block';
        }
        return;
      }
      await updateTag({ id, name: newName });
      await loadTags();
      renderExpenseList();
      refreshDashboard();
      showToast('重命名成功');
    }
  });
};

window.removeTag = async function(id) {
  showCustomConfirm('确定要删除这个标签吗？相关支出中的标签引用也会被移除。', async () => {
    await deleteTag(id);
    await loadTags();
    renderExpenseList();
    refreshDashboard();
  }, '删除标签', '删除');
};

window.filterByTagFromList = function(tagId) {
  const tag = allTags.find(t => t.id === tagId);
  if (!tag) return;

  // Switch to list view and filter by this tag
  selectedTagIds = [tagId];
  renderSelectedFilterTags();

  selectedListCategoryTagIds = [tag.id];
  draftListCategoryTagIds = [tag.id];
  renderListCategoryTrigger();
  renderListCategoryPicker();

  switchView('list');
  renderExpenseList();
};

// ============================================
// Tag Merge Modal
// ============================================

window.openMergeModal = function(sourceId) {
  pendingMergeTagId = sourceId;
  const sourceTag = allTags.find(t => t.id === sourceId);
  if (!sourceTag) return;

  document.getElementById('merge-source-name').textContent = sourceTag.name;

  const select = document.getElementById('merge-target-select');
  select.innerHTML = '<option value="">选择目标标签</option>' +
    allTags.filter(t => t.id !== sourceId).map(t => {
      const group = allTagGroups.find(g => g.id === (t.parentId || 'group-uncategorized'));
      return `<option value="${t.id}">${group ? group.name + ' · ' : ''}${t.name}</option>`;
    }).join('');
  select.value = '';

  const modal = document.getElementById('merge-modal');
  modal.style.display = 'flex';
};

window.closeMergeModal = function() {
  pendingMergeTagId = null;
  const modal = document.getElementById('merge-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmMergeTag = async function() {
  if (!pendingMergeTagId) return;
  const select = document.getElementById('merge-target-select');
  const targetId = select ? select.value : '';
  if (!targetId) {
    showToast('请选择目标标签');
    return;
  }
  if (targetId === pendingMergeTagId) {
    showToast('不能合并到自身');
    return;
  }

  await mergeTag(pendingMergeTagId, targetId);
  pendingMergeTagId = null;
  closeMergeModal();
  showToast('合并成功');
  await loadTags();
  renderExpenseList();
  refreshDashboard();
};

// ============================================
// Settings
// ============================================

function initSettingsView() {
  // Settings are handled inline in HTML via onclick handlers
}

// Legacy JSON export (keep for compatibility)
window.exportData = async function() {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// Task 6: CSV Export
window.exportCSV = async function() {
  try {
    await exportCSVAndDownload();
    showToast('CSV 导出成功');
  } catch (err) {
    showToast('导出失败: ' + err.message);
  }
};

// Task 6: JSON Export
window.exportJSON = async function() {
  try {
    await exportJSONAndDownload();
    showToast('JSON 备份导出成功');
  } catch (err) {
    showToast('导出失败: ' + err.message);
  }
};

// Task 6: Import file handler
let pendingImportRecords = null;
// Sync with window for cross-file access (import-export.js functions use bare pendingImportRecords)
Object.defineProperty(window, 'pendingImportRecords', {
  get: () => pendingImportRecords,
  set: (v) => { pendingImportRecords = v; },
  configurable: true
});
let isImportProcessing = false;

window.handleImportFile = async function(input) {
  if (isImportProcessing) return;
  const file = input.files[0];
  if (!file) return;

  isImportProcessing = true;
  const previewArea = document.getElementById('import-preview-area');
  const actionArea = document.getElementById('import-actions');

  try {
    showToast('正在解析文件...');
    const records = await parseImportFile(file);
    if (!records || records.length === 0) {
      showToast('文件为空或无法识别');
      input.value = '';
      isImportProcessing = false;
      return;
    }

    const preview = showImportPreview(records);
    pendingImportRecords = preview.mapped;

    previewArea.innerHTML = preview.previewHTML;
    previewArea.style.display = 'block';
    actionArea.style.display = 'flex';
    showToast(`解析完成，共 ${records.length} 行`);
  } catch (err) {
    showToast('导入失败: ' + err.message);
    previewArea.style.display = 'none';
    actionArea.style.display = 'none';
    pendingImportRecords = null;
  }
  input.value = '';
  isImportProcessing = false;
};

window.cancelImport = function() {
  pendingImportRecords = null;
  document.getElementById('import-preview-area').style.display = 'none';
  document.getElementById('import-actions').style.display = 'none';
};

window.confirmImport = async function() {
  if (!pendingImportRecords || pendingImportRecords.length === 0) {
    showToast('没有待导入的数据');
    return;
  }

  // Collect any inline edits from the preview table before importing
  if (typeof collectImportEdits === 'function') {
    collectImportEdits();
  }

  try {
    showToast('正在导入...');
    const result = await executeImport(pendingImportRecords);
    await afterExpenseCreated(result.imported);
    pendingImportRecords = null;
    document.getElementById('import-preview-area').style.display = 'none';
    document.getElementById('import-actions').style.display = 'none';

    let msg = `成功导入 ${result.imported} 条记录`;
    if (result.createdTags > 0) msg += `，新建 ${result.createdTags} 个标签`;
    if (result.errors.length > 0) msg += `，${result.errors.length} 条失败`;
    showToast(msg);

    await loadTags();
    await renderExpenseList();
    await refreshDashboard();
  } catch (err) {
    showToast('导入失败: ' + err.message);
  }
};

// Keep a reference to db.js's importData before app.js overrides window.importData
const _dbImportData = window.importData;

window.importData = async function(input) {
  // If called with a data object (from guide.js or importDataFromObj), route to db.js version
  if (input && typeof input === 'object' && !input.files) {
    return _dbImportData(input);
  }

  // Otherwise, treat as file input (from UI)
  const file = input.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await importDataFromObj(data);
    showToast('导入成功！');
    await loadTags();
    renderExpenseList();
    refreshDashboard();
  } catch (err) {
    showToast('导入失败: ' + err.message);
  }
  input.value = '';
};

async function importDataFromObj(data) {
  // Use the db.js importData function (saved before app.js override)
  await _dbImportData(data);
}

window.confirmClearAllData = async function() {
  showCustomConfirm('确定要清除所有数据吗？此操作不可恢复！', async () => {
    await clearAllData();
    showToast('所有数据均已删除');
    await loadTags();
    renderExpenseList();
    refreshDashboard();
  }, '清除数据', '清除');
};

// Task 7: Demo mode toggle
window.handleDemoModeToggle = async function(checkbox) {
  try {
    const isDemo = await toggleDemoMode();
    checkbox.checked = isDemo;
    showToast(isDemo ? '演示模式已开启' : '已恢复真实数据');
    await loadTags();
    renderExpenseList();
    refreshDashboard();
  } catch (err) {
    showToast('操作失败: ' + err.message);
    checkbox.checked = !checkbox.checked;
  }
};

async function updateDemoToggleUI() {
  try {
    const demo = await isDemoMode();
    const toggle = document.getElementById('demo-mode-toggle');
    if (toggle) toggle.checked = demo;
  } catch (e) {
    // ignore
  }
}

// Task 7: Show guide again
window.showGuideAgain = async function() {
  await resetGuide();
  showGuide();
};

// ============================================
// Test Data Generation
// ============================================

async function generateTestData() {
  if (allTags.length === 0) return;

  const today = new Date();
  const records = [];

  // Generate 60 days of data
  for (let i = 0; i < 60; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);

    // 1-3 expenses per day
    const count = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < count; j++) {
      const tag = allTags[Math.floor(Math.random() * allTags.length)];
      const amount = parseFloat((Math.random() * 200 + 10).toFixed(2));
      const notes = ['午餐', '晚餐', '早餐', '打车', '地铁', '超市', '咖啡', '奶茶', '水果', '零食', '话费', '网费'];
      const note = notes[Math.floor(Math.random() * notes.length)];

      records.push({
        amount,
        date: dateStr,
        category: tag.name,
        note,
        tags: [tag.id]
      });
    }
  }

  for (const r of records) {
    await addExpense(r);
  }

  console.log(`Generated ${records.length} test expense records.`);
}

// Expose for manual trigger
window.generateTestData = generateTestData;

// ============================================
// Product Onboarding
// ============================================

async function markOnboardingSeen() {
  const onboarding = window.BillNestOnboarding;
  if (!onboarding || typeof setSettings !== 'function') return;
  await setSettings(onboarding.SETTING_SEEN, true);
  await updateOnboardingSettingsUI();
}

async function updateOnboardingSettingsUI() {
  const onboarding = window.BillNestOnboarding;
  if (!onboarding || typeof getSettings !== 'function') return;
  const toggle = document.getElementById('onboarding-startup-toggle');
  if (!toggle) return;
  const [seen, showOnStart] = await Promise.all([
    getSettings(onboarding.SETTING_SEEN, false),
    getSettings(onboarding.SETTING_SHOW_ON_START, false)
  ]);
  const state = onboarding.buildOnboardingSettingsState({
    seen,
    showOnStart
  });
  toggle.checked = state.checked;
}

window.startFromOnboarding = async function() {
  await markOnboardingSeen();
  switchView('add');
};

window.importFromOnboarding = function() {
  markOnboardingSeen().catch(() => {});
  switchView('settings');
  const input = document.getElementById('import-file-input');
  if (input) input.click();
};

window.tryDemoFromOnboarding = async function() {
  try {
    await markOnboardingSeen();
    await enableDemoMode();
    await loadTags();
    await renderExpenseList();
    await refreshDashboard();
    updateDemoToggleUI();
    showToast('演示模式已开启');
    switchView('dashboard');
  } catch (error) {
    showToast('演示模式开启失败: ' + error.message);
  }
};

window.dismissOnboarding = async function() {
  await markOnboardingSeen();
  switchView('add');
};

window.handleOnboardingStartupToggle = async function(checkbox) {
  const onboarding = window.BillNestOnboarding;
  if (!onboarding) return;
  await setSettings(onboarding.SETTING_SHOW_ON_START, Boolean(checkbox.checked));
  if (checkbox.checked) {
    await setSettings(onboarding.SETTING_SEEN, true);
  }
  await updateOnboardingSettingsUI();
  showToast(checkbox.checked ? '启动时会显示欢迎页' : '启动时不再显示欢迎页');
};

window.showOnboardingFromSettings = async function() {
  await markOnboardingSeen();
  switchView('onboarding');
};
