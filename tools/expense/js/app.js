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
let filterDebounceTimer = null;
let _originalSwitchView = null;

// Expose dashboard filters globally for chart.js theme refresh
window._dashboardFilters = {};

// Quick expense form state
let quickFormSelectedTags = []; // array of tag ids
let recentTemplates = []; // array of { tagIds: [...], tagNames: [...] }
let nlParseResult = null; // cached natural language parse result
let suggestionHighlightIndex = -1;
let tagSuggestionMatches = [];

// List view state
let listViewPageSize = 20;
let listViewCurrentOffset = 0;
let listViewAllExpenses = [];

// Edit modal state
let editingExpenseId = null;
let editFormSelectedTags = [];
let editSuggestionHighlightIndex = -1;
let editTagSuggestionMatches = [];

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

  // Initial dashboard render
  await refreshDashboard();

  // First visit: use enableDemoMode() for consistent 20-sample data + proper backup
  const expenses = await getExpenses();
  const hasSeenBefore = localStorage.getItem('expense_data_initialized');
  if (expenses.length === 0 && !hasSeenBefore) {
    try {
      await enableDemoMode();
      // Refresh in-memory tag state (allTags/allTagGroups were loaded before enableDemoMode cleared+recreated DB)
      await loadTags();
      localStorage.setItem('expense_data_initialized', '1');
    } catch (e) {
      console.error('Enable demo mode failed:', e);
    }
  } else {
    localStorage.setItem('expense_data_initialized', '1');
  }

  // Re-render after potential demo mode init
  await renderExpenseList();
  await refreshDashboard();

  // Initialize guide on first visit
  try {
    const show = await shouldShowGuide();
    if (show) {
      setTimeout(() => showGuide(), 600);
    }
  } catch (e) {
    console.error('Guide init error:', e);
  }

  // Update demo mode toggle state
  updateDemoToggleUI();

  // Override switchView to trigger view-specific rendering
  // Must be done here (after index.html's inline script defines switchView)
  _originalSwitchView = window.switchView;
  window.switchView = function(viewName, skipHistory) {
    if (_originalSwitchView) _originalSwitchView(viewName, skipHistory);
    if (viewName === 'dashboard') {
      refreshDashboard();
    } else if (viewName === 'list') {
      renderExpenseList();
    } else if (viewName === 'tags') {
      renderTagsList();
    }
  };

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

  // Initialize selected tags display
  renderSelectedFilterTags();

  // Event delegation for stat cards click
  document.querySelectorAll('[data-action="go-to-list"]').forEach(card => {
    card.addEventListener('click', goToListFromDashboard);
    card.style.cursor = 'pointer';
  });
}

function triggerDashboardUpdate() {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer);
  }
  filterDebounceTimer = setTimeout(() => {
    refreshDashboard();
  }, 300);
}

function renderDashboardHero() {
  const totalEl = document.getElementById('dash-total');
  const trendEl = document.getElementById('dash-trend-text');
  const countEl = document.getElementById('dash-count-text');
  const emptyEl = document.getElementById('empty-dashboard');

  if (!totalEl || !emptyEl) return;

  // Get filtered expenses (same logic as updateDashboard in index.html)
  (async () => {
    let expenses = await getExpenses();

    // Apply current filters
    const filters = window._dashboardFilters || {};
    if (filters.timeRange && filters.timeRange !== 'custom') {
      const { start, end } = getTimeRangeByName(filters.timeRange);
      expenses = expenses.filter(e => e.date >= start && e.date <= end);
    } else if (filters.customStart && filters.customEnd) {
      expenses = expenses.filter(e => e.date >= filters.customStart && e.date <= filters.customEnd);
    }
    if (filters.tags && filters.tags.length > 0) {
      expenses = expenses.filter(e => e.tags && e.tags.some(t => filters.tags.includes(t)));
    }
    if (filters.minAmount) {
      expenses = expenses.filter(e => e.amount >= parseFloat(filters.minAmount));
    }
    if (filters.maxAmount) {
      expenses = expenses.filter(e => e.amount <= parseFloat(filters.maxAmount));
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase();
      expenses = expenses.filter(e =>
        (e.note || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q)
      );
    }

    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const count = expenses.length;

    // Show empty state
    if (count === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
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
    // Show chart sections
    const chartRows = document.querySelectorAll('.chart-row');
    chartRows.forEach(r => r.style.display = 'grid');
    const chartCards = document.querySelectorAll('.chart-card');
    chartCards.forEach(c => c.style.display = 'block');

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
        let lastMonthExpenses = await getExpenses();
        lastMonthExpenses = lastMonthExpenses.filter(e => e.date >= lastMonthStart && e.date <= lastMonthEnd);
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

// Helper: get time range start/end by name (copied from index.html)
function getTimeRangeByName(name) {
  const now = new Date();
  let start, end;
  switch (name) {
    case 'this-week':
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      end = new Date(now);
      break;
    case 'this-month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
      break;
    case 'last-month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'last-30':
      start = new Date(now);
      start.setDate(now.getDate() - 30);
      end = new Date(now);
      break;
    case 'last-7':
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      end = new Date(now);
      break;
    case 'this-year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

async function refreshDashboard() {
  const timeRange = document.getElementById('dash-time-range');
  const customRange = document.getElementById('dash-custom-range');
  const dateStart = document.getElementById('dash-date-start');
  const dateEnd = document.getElementById('dash-date-end');
  const amountMin = document.getElementById('dash-amount-min');
  const amountMax = document.getElementById('dash-amount-max');
  const search = document.getElementById('dash-search');

  const filters = {
    timeRange: timeRange ? timeRange.value : 'this-month',
    customStart: dateStart ? dateStart.value : null,
    customEnd: dateEnd ? dateEnd.value : null,
    tags: selectedTagIds.length > 0 ? selectedTagIds : null,
    minAmount: amountMin ? amountMin.value : null,
    maxAmount: amountMax ? amountMax.value : null,
    search: search ? search.value : ''
  };

  window._dashboardFilters = filters;
  await updateDashboard(filters);
  // Render hero dashboard (v1.5.0)
  renderDashboardHero();
}

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

  container.innerHTML = selectedTagIds.map(id => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return '';
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    const groupName = group ? group.name : '';
    const style = `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
    return `<span class="selected-tag-chip" style="${style}">${groupName ? groupName + ' · ' : ''}${tag.name}<button class="remove" onclick="removeFilterTag('${tag.id}')" aria-label="移除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`;
  }).join('');
}

window.removeFilterTag = function(tagId) {
  selectedTagIds = selectedTagIds.filter(id => id !== tagId);
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

function applyListViewFilters() {
  if (!window._listViewFilters) return;

  const filters = window._listViewFilters;

  // Apply search filter
  const listSearch = document.getElementById('list-search');
  if (listSearch && filters.search) {
    listSearch.value = filters.search;
  }

  // Apply category filter if single tag selected
  const listFilterCategory = document.getElementById('list-filter-category');
  if (listFilterCategory && filters.tags && filters.tags.length === 1) {
    const tag = allTags.find(t => t.id === filters.tags[0]);
    if (tag) {
      listFilterCategory.value = tag.name;
    }
  }

  // Re-render list with filters
  listViewCurrentOffset = 0;
  renderExpenseList();
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
  allTags = await getTags();
  allTagGroups = await getTagGroups();
  populateCategorySelects();
  renderTagCloud();
  await renderTagsList();
}

function populateCategorySelects() {
  const catSelect = document.getElementById('exp-category');
  const listFilter = document.getElementById('list-filter-category');

  if (catSelect) {
    const current = catSelect.value;
    catSelect.innerHTML = '<option value="">请选择分类</option>' +
      allTags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    catSelect.value = current;
  }

  if (listFilter) {
    const current = listFilter.value;
    listFilter.innerHTML = '<option value="">全部分类</option>' +
      allTags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    listFilter.value = current;
  }
}

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
    tagInput.addEventListener('input', onTagInput);
    tagInput.addEventListener('keydown', onTagInputKeydown);
    tagInput.addEventListener('blur', () => {
      // Delay hiding so clicks on suggestions register
      setTimeout(() => hideTagSuggestions(), 200);
    });
    tagInput.addEventListener('focus', onTagInput);
  }

  loadRecentTemplates();
  renderRecentTemplates();
}

function onTagInput() {
  const input = document.getElementById('exp-tags-input');
  const raw = input.value;
  const parts = raw.split(/[,，\s]+/);
  const current = parts[parts.length - 1] || '';

  if (!current.trim()) {
    hideTagSuggestions();
    return;
  }

  const q = current.trim().toLowerCase();
  // Sort: recently used tags first, then alphabetical
  const recentlyUsed = getRecentlyUsedTagIds();
  const scored = allTags.map(tag => {
    const nameLower = tag.name.toLowerCase();
    let score = 0;
    if (nameLower === q) score += 100;
    else if (nameLower.startsWith(q)) score += 50;
    else if (nameLower.includes(q)) score += 20;
    const recentIndex = recentlyUsed.indexOf(tag.id);
    if (recentIndex >= 0) score += (recentlyUsed.length - recentIndex) * 10;
    return { tag, score };
  }).filter(item => item.score > 0 && !quickFormSelectedTags.includes(item.tag.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  tagSuggestionMatches = scored.map(s => s.tag);
  suggestionHighlightIndex = -1;

  const container = document.getElementById('tag-suggestions');
  if (tagSuggestionMatches.length === 0) {
    // Show option to create new tag
    const current = raw.split(/[,，\s]+/).pop().trim();
    if (current && !allTags.some(t => t.name === current)) {
      container.innerHTML = `<div class="tag-suggestion-item new-tag" onclick="createNewTagFromSuggestion('${current.replace(/'/g, "\\'")}')">
        <span class="tag-suggestion-dot" style="background:#2DBAA3"></span>
        <span>新建标签 "${current}"</span>
      </div>`;
      container.style.display = 'block';
      return;
    }
    hideTagSuggestions();
    return;
  }

  container.innerHTML = tagSuggestionMatches.map((tag, i) => {
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    return `
    <div class="tag-suggestion-item" data-index="${i}" data-id="${tag.id}" onclick="selectSuggestionTag('${tag.id}')">
      <span class="tag-suggestion-dot" style="background:${tag.color}"></span>
      <span>${tag.name}</span>
      <span class="tag-suggestion-group">${group ? group.name : ''}</span>
    </div>
  `;}).join('');
  container.style.display = 'block';
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
    e.preventDefault();
    suggestionHighlightIndex = (suggestionHighlightIndex + 1) % tagSuggestionMatches.length;
    updateSuggestionHighlight();
  } else if (e.key === 'ArrowUp') {
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
  const items = document.querySelectorAll('.tag-suggestion-item');
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
  if (!name || allTags.some(t => t.name === name)) return;
  const newTag = await addTag({ name, color: '#2DBAA3' });
  allTags.push(newTag);
  quickFormSelectedTags.push(newTag.id);
  renderSelectedTags();
  renderTagCloud();
  populateCategorySelects();
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
        allTags.push(newTag);
        quickFormSelectedTags.push(newTag.id);
        renderSelectedTags();
        renderTagCloud();
        populateCategorySelects();
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

  if (quickFormSelectedTags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = quickFormSelectedTags.map(id => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return '';
    const style = `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
    return `<span class="selected-tag-chip" style="${style}">${tag.name}<button class="remove" onclick="removeQuickTag('${tag.id}')" aria-label="移除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`;
  }).join('');
}

window.removeQuickTag = function(tagId) {
  quickFormSelectedTags = quickFormSelectedTags.filter(id => id !== tagId);
  renderSelectedTags();
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
  document.getElementById('exp-tags-input').value = '';
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

// ============================================
// Expense List
// ============================================

function initListView() {
  const search = document.getElementById('list-search');
  const catFilter = document.getElementById('list-filter-category');
  const sort = document.getElementById('list-sort');

  if (search) search.addEventListener('input', () => {
    listViewCurrentOffset = 0;
    renderExpenseList();
  });
  if (catFilter) catFilter.addEventListener('change', () => {
    listViewCurrentOffset = 0;
    renderExpenseList();
  });
  if (sort) sort.addEventListener('change', () => {
    listViewCurrentOffset = 0;
    renderExpenseList();
  });
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDateWithWeekday(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const weekday = WEEKDAY_NAMES[date.getDay()];
  return `${dateStr} ${weekday}`;
}

window.renderExpenseList = async function() {
  const container = document.getElementById('expense-list');
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (!container) return;

  const search = document.getElementById('list-search');
  const catFilter = document.getElementById('list-filter-category');
  const sort = document.getElementById('list-sort');

  let expenses = await getExpenses();

  if (search && search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    expenses = expenses.filter(e =>
      (e.note || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      (e.tags || []).some(tid => {
        const tag = allTags.find(x => x.id === tid);
        return tag && tag.name.toLowerCase().includes(q);
      })
    );
  }

  if (catFilter && catFilter.value) {
    const catFilterValue = catFilter.value;
    expenses = expenses.filter(e => {
      // Match by category field
      if (e.category === catFilterValue) return true;
      // Also match if any tag on this expense has the name
      if (e.tags && e.tags.length > 0) {
        for (const tid of e.tags) {
          const tag = allTags.find(t => t.id === tid);
          if (tag && tag.name === catFilterValue) return true;
        }
      }
      return false;
    });
  }

  const sortValue = sort ? sort.value : 'date-desc';
  switch (sortValue) {
    case 'date-asc':
      expenses.sort((a, b) => a.date.localeCompare(b.date));
      break;
    case 'amount-desc':
      expenses.sort((a, b) => (b.amount || 0) - (a.amount || 0));
      break;
    case 'amount-asc':
      expenses.sort((a, b) => (a.amount || 0) - (b.amount || 0));
      break;
    default:
      expenses.sort((a, b) => b.date.localeCompare(a.date));
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

  // Group by date
  const grouped = {};
  for (const exp of expenses) {
    if (!grouped[exp.date]) grouped[exp.date] = [];
    grouped[exp.date].push(exp);
  }

  const sortedDates = Object.keys(grouped).sort((a, b) => {
    if (sortValue === 'date-asc') return a.localeCompare(b);
    return b.localeCompare(a);
  });

  // Flatten with pagination
  let flatItems = [];
  for (const date of sortedDates) {
    flatItems.push({ type: 'header', date });
    for (const exp of grouped[date]) {
      flatItems.push({ type: 'expense', data: exp });
    }
  }

  const visibleItems = flatItems.slice(0, listViewCurrentOffset + listViewPageSize);
  const hasMore = visibleItems.length < flatItems.length;

  let html = '';
  for (const item of visibleItems) {
    if (item.type === 'header') {
      const dateTotal = grouped[item.date].reduce((sum, e) => sum + (e.amount || 0), 0);
      html += `
        <div class="expense-date-header">
          <span class="expense-date-label">${formatDateWithWeekday(item.date)}</span>
          <span class="expense-date-total">¥${dateTotal.toFixed(2)}</span>
        </div>
      `;
    } else {
      const exp = item.data;
      const displayName = exp.note ? exp.note : (exp.category || '未命名');
      html += `
        <div class="expense-item" data-id="${exp.id}">
          <div class="expense-info">
            <div class="expense-title">${displayName}</div>
            <div class="expense-meta">
              ${(exp.tags || []).map(tid => {
                const tag = allTags.find(x => x.id === tid);
                return tag ? `<span class="expense-tag-pill" style="background:${tag.color}22;color:${tag.color};border:1px solid ${tag.color}44">${tag.name}</span>` : '';
              }).join('')}
            </div>
          </div>
          <div class="expense-amount">¥${(exp.amount || 0).toFixed(2)}</div>
          <div class="expense-actions">
            <button class="btn-icon" onclick="openEditModal('${exp.id}')" title="编辑">✏️</button>
            <button class="btn-icon delete" onclick="openDeleteModal('${exp.id}')" title="删除">🗑️</button>
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
// Edit Expense Modal
// ============================================

function initEditModal() {
  const tagInput = document.getElementById('edit-tags-input');
  if (tagInput) {
    tagInput.addEventListener('input', onEditTagInput);
    tagInput.addEventListener('keydown', onEditTagInputKeydown);
    tagInput.addEventListener('blur', () => {
      setTimeout(() => hideEditTagSuggestions(), 200);
    });
    tagInput.addEventListener('focus', onEditTagInput);
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

  const modal = document.getElementById('edit-modal');
  modal.style.display = 'flex';
};

window.closeEditModal = function() {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.style.display = 'none';
  editingExpenseId = null;
  editFormSelectedTags = [];
  document.getElementById('edit-tags-input').value = '';
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
  const raw = input.value;
  const parts = raw.split(/[,，\s]+/);
  const current = parts[parts.length - 1] || '';

  if (!current.trim()) {
    hideEditTagSuggestions();
    return;
  }

  const q = current.trim().toLowerCase();
  const recentlyUsed = getRecentlyUsedTagIds();
  const scored = allTags.map(tag => {
    const nameLower = tag.name.toLowerCase();
    let score = 0;
    if (nameLower === q) score += 100;
    else if (nameLower.startsWith(q)) score += 50;
    else if (nameLower.includes(q)) score += 20;
    const recentIndex = recentlyUsed.indexOf(tag.id);
    if (recentIndex >= 0) score += (recentlyUsed.length - recentIndex) * 10;
    return { tag, score };
  }).filter(item => item.score > 0 && !editFormSelectedTags.includes(item.tag.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  editTagSuggestionMatches = scored.map(s => s.tag);
  editSuggestionHighlightIndex = -1;

  const container = document.getElementById('edit-tag-suggestions');
  if (editTagSuggestionMatches.length === 0) {
    hideEditTagSuggestions();
    return;
  }

  container.innerHTML = editTagSuggestionMatches.map((tag, i) => {
    const group = allTagGroups.find(g => g.id === (tag.parentId || 'group-uncategorized'));
    return `
    <div class="tag-suggestion-item" data-index="${i}" data-id="${tag.id}" onclick="selectEditSuggestionTag('${tag.id}')">
      <span class="tag-suggestion-dot" style="background:${tag.color}"></span>
      <span>${tag.name}</span>
      <span class="tag-suggestion-group">${group ? group.name : ''}</span>
    </div>
  `;}).join('');
  container.style.display = 'block';
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
    e.preventDefault();
    editSuggestionHighlightIndex = (editSuggestionHighlightIndex + 1) % editTagSuggestionMatches.length;
    updateEditSuggestionHighlight();
  } else if (e.key === 'ArrowUp') {
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
  const items = document.querySelectorAll('#edit-tag-suggestions .tag-suggestion-item');
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
        allTags.push(newTag);
        editFormSelectedTags.push(newTag.id);
        renderEditSelectedTags();
        renderTagCloud();
        populateCategorySelects();
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

  if (editFormSelectedTags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = editFormSelectedTags.map(id => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return '';
    const style = `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
    return `<span class="selected-tag-chip" style="${style}">${tag.name}<button class="remove" onclick="removeEditTag('${tag.id}')" aria-label="移除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></span>`;
  }).join('');
}

window.removeEditTag = function(tagId) {
  editFormSelectedTags = editFormSelectedTags.filter(id => id !== tagId);
  renderEditSelectedTags();
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

  if (!name) {
    showToast('请输入标签名称');
    return;
  }

  // Check duplicate
  if (allTags.some(t => t.name === name)) {
    showToast('标签名称已存在');
    return;
  }

  const tag = await addTag({ name, color, parentId: groupId || 'group-uncategorized' });
  if (nameInput) nameInput.value = '';
  if (groupSelect) groupSelect.value = '';
  await loadTags();
  renderTagSelector();
};

// Track collapsed state for groups
const collapsedGroups = new Set();

window.renderTagsList = async function() {
  const container = document.getElementById('tags-list');
  if (!container) return;

  // Update the group select dropdown
  const groupSelect = document.getElementById('new-tag-group');
  if (groupSelect) {
    groupSelect.innerHTML = '<option value="">选择分组...</option>' +
      allTagGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
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

  // Group tags by parentId
  const tagsByGroup = {};
  for (const group of allTagGroups) {
    tagsByGroup[group.id] = allTags.filter(tag => (tag.parentId || 'group-uncategorized') === group.id);
  }

  let html = '';
  for (const group of allTagGroups) {
    const tags = tagsByGroup[group.id] || [];
    const isCollapsed = collapsedGroups.has(group.id);
    const totalCount = tags.reduce((sum, tag) => sum + (tagCounts[tag.id] || 0), 0);

    html += `
      <div class="tag-group-card" data-group-id="${group.id}">
        <div class="tag-group-header" onclick="toggleGroupCollapse('${group.id}')">
          <div class="tag-group-left">
            <span class="tag-group-toggle ${isCollapsed ? 'collapsed' : ''}">▼</span>
            <span class="tag-group-dot" style="background:${group.color}"></span>
            <span class="tag-group-name">${group.name}</span>
            <span class="tag-group-total">${tags.length} 标签 / ${totalCount} 笔</span>
          </div>
          <div class="tag-group-actions" onclick="event.stopPropagation();">
            <button class="tag-group-action-btn" onclick="renameGroup('${group.id}')" title="重命名">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="tag-group-action-btn delete" onclick="removeGroup('${group.id}')" title="删除">
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
            <div class="tree-tag-item" data-tag-id="${tag.id}">
              <div class="tag-display">
                <div class="tag-color-dot" style="background:${tag.color}"></div>
                <span class="tag-name">${tag.name}</span>
                <span class="tag-count" onclick="filterByTagFromList('${tag.id}')" style="cursor:pointer;">${tagCounts[tag.id] || 0} 笔</span>
              </div>
              <div class="tag-actions">
                <input type="color" class="tag-color-input" value="${tag.color}" title="更改颜色" onchange="changeTagColor('${tag.id}', this.value)">
                <button class="tag-action-icon" onclick="renameTag('${tag.id}')" title="重命名">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="tag-action-icon" onclick="moveTagPrompt('${tag.id}', '${tag.name}')" title="移动">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
                </button>
                <button class="tag-action-icon" onclick="openMergeModal('${tag.id}')" title="合并">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                </button>
                <button class="tag-action-icon delete" onclick="removeTag('${tag.id}')" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
};

// ============================================
// Tag Group Management Functions
// ============================================

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
      if (allTags.some(t => t.id !== id && t.name === newName)) {
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

  // Set the category filter in list view
  const listFilterCategory = document.getElementById('list-filter-category');
  if (listFilterCategory) {
    listFilterCategory.value = tag.name;
  }

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
    allTags.filter(t => t.id !== sourceId).map(t =>
      `<option value="${t.id}">${t.name}</option>`
    ).join('');
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
    pendingImportRecords = null;
    document.getElementById('import-preview-area').style.display = 'none';
    document.getElementById('import-actions').style.display = 'none';

    let msg = `成功导入 ${result.imported} 条记录`;
    if (result.createdTags > 0) msg += `，新建 ${result.createdTags} 个标签`;
    if (result.errors.length > 0) msg += `，${result.errors.length} 条失败`;
    showToast(msg);

    await loadTags();
    renderTagsList();
    renderExpenseList();
    refreshDashboard();
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

