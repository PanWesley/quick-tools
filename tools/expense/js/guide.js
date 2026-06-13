/**
 * Expense Tracker - User Guide & Demo Mode (Task 7)
 * Provides first-visit guide overlay and demo data toggle.
 */

// Using local storage for guide state (survives data clearing)
const GUIDE_SEEN_KEY = 'expense_guide_seen_v2';
const DEMO_MODE_KEY = 'expense_demo_mode';
const REAL_DATA_BACKUP_KEY = 'expense_real_data_backup';

// ============================================
// Guide State
// ============================================

const guideSteps = [
  {
    id: 'welcome',
    title: '欢迎使用 Expense Tracker',
    content: '这是一款纯前端的记账工具，数据安全存储在您的浏览器中。让我们快速了解它的主要功能吧！',
    highlight: null
  },
  {
    id: 'quick-entry',
    title: '快速记账',
    content: '点击底部的「记账」按钮，可以通过表单或自然语言快速记录支出。支持标签智能提示和最近模板，让记账更高效。',
    highlight: 'view-add'
  },
  {
    id: 'dashboard',
    title: '数据概览',
    content: '「概览」页面展示您的支出统计、分类占比和趋势图。可以通过时间范围、标签、金额筛选来查看不同维度的数据。',
    highlight: 'view-dashboard'
  },
  {
    id: 'data-safety',
    title: '数据安全',
    content: '您的数据存储在本地 IndexedDB 中，永不上传到服务器。记得定期在「设置」中导出备份，以免浏览器清理数据时丢失。',
    highlight: 'view-settings'
  }
];

let currentStepIndex = 0;
let guideOverlay = null;

// ============================================
// Guide Visibility
// ============================================

/**
 * Check if the guide should be shown (first visit).
 * @returns {Promise<boolean>}
 */
async function shouldShowGuide() {
  return !localStorage.getItem(GUIDE_SEEN_KEY);
}

/**
 * Mark guide as seen.
 */
async function completeGuide() {
  localStorage.setItem(GUIDE_SEEN_KEY, '1');
}

/**
 * Reset guide state so it shows again.
 */
async function resetGuide() {
  localStorage.removeItem(GUIDE_SEEN_KEY);
}

// ============================================
// Guide UI
// ============================================

/**
 * Show the step-by-step guide overlay.
 */
function showGuide() {
  if (guideOverlay) {
    guideOverlay.remove();
  }

  currentStepIndex = 0;
  guideOverlay = document.createElement('div');
  guideOverlay.className = 'guide-overlay';
  guideOverlay.id = 'guide-overlay';
  document.body.appendChild(guideOverlay);

  renderGuideStep();
}

function renderGuideStep() {
  if (!guideOverlay) return;

  const step = guideSteps[currentStepIndex];
  const isLast = currentStepIndex === guideSteps.length - 1;

  // Highlight target view if specified
  if (step.highlight) {
    const targetView = document.getElementById(step.highlight);
    if (targetView) {
      // Switch to that view temporarily for highlight effect
      if (typeof window.switchView === 'function') {
        window.switchView(step.highlight.replace('view-', ''));
      }
    }
  }

  guideOverlay.innerHTML = `
    <div class="guide-backdrop"></div>
    <div class="guide-card">
      <div class="guide-step-indicator">
        ${guideSteps.map((_, i) => `
          <span class="guide-dot ${i === currentStepIndex ? 'active' : ''}"></span>
        `).join('')}
      </div>
      <h3 class="guide-title">${step.title}</h3>
      <p class="guide-content">${step.content}</p>
      <div class="guide-actions">
        ${currentStepIndex > 0 ? `<button class="btn-secondary" onclick="window.prevGuideStep()">上一步</button>` : '<span></span>'}
        <button class="btn-primary" onclick="window.nextGuideStep()">${isLast ? '完成' : '下一步'}</button>
      </div>
      <button class="guide-skip" onclick="window.skipGuide()">跳过引导</button>
    </div>
  `;
}

window.nextGuideStep = async function() {
  if (currentStepIndex < guideSteps.length - 1) {
    currentStepIndex++;
    renderGuideStep();
  } else {
    await closeGuide();
  }
};

window.prevGuideStep = function() {
  if (currentStepIndex > 0) {
    currentStepIndex--;
    renderGuideStep();
  }
};

window.skipGuide = async function() {
  await closeGuide();
};

async function closeGuide() {
  if (guideOverlay) {
    guideOverlay.classList.add('guide-fade-out');
    setTimeout(() => {
      if (guideOverlay) {
        guideOverlay.remove();
        guideOverlay = null;
      }
    }, 300);
  }
  await completeGuide();
}

// ============================================
// Demo Mode
// ============================================

const DEMO_SAMPLE_DATA = [
  { amount: 35.00, date: '2026-05-20', category: '餐饮', note: '午餐', tags: ['餐饮'] },
  { amount: 18.50, date: '2026-05-20', category: '交通', note: '打车回家', tags: ['交通'] },
  { amount: 128.00, date: '2026-05-19', category: '购物', note: '超市采购', tags: ['购物'] },
  { amount: 45.00, date: '2026-05-19', category: '餐饮', note: '晚餐聚会', tags: ['餐饮'] },
  { amount: 12.00, date: '2026-05-18', category: '餐饮', note: '早餐', tags: ['餐饮'] },
  { amount: 89.00, date: '2026-05-18', category: '娱乐', note: '电影票', tags: ['娱乐'] },
  { amount: 22.00, date: '2026-05-17', category: '交通', note: '地铁充值', tags: ['交通'] },
  { amount: 56.00, date: '2026-05-17', category: '购物', note: '水果', tags: ['购物'] },
  { amount: 199.00, date: '2026-05-16', category: '购物', note: '电话费', tags: ['购物'] },
  { amount: 68.00, date: '2026-05-16', category: '餐饮', note: '火锅', tags: ['餐饮'] },
  { amount: 15.00, date: '2026-05-15', category: '餐饮', note: '奶茶', tags: ['餐饮'] },
  { amount: 320.00, date: '2026-05-15', category: '居住', note: '水电费', tags: ['居住'] },
  { amount: 42.00, date: '2026-05-14', category: '餐饮', note: '外卖', tags: ['餐饮'] },
  { amount: 75.00, date: '2026-05-14', category: '医疗', note: '药店买药', tags: ['医疗'] },
  { amount: 28.00, date: '2026-05-13', category: '交通', note: '出租车', tags: ['交通'] },
  { amount: 150.00, date: '2026-05-13', category: '教育', note: '买书', tags: ['教育'] },
  { amount: 9.90, date: '2026-05-12', category: '餐饮', note: '咖啡', tags: ['餐饮'] },
  { amount: 88.00, date: '2026-05-12', category: '娱乐', note: '游戏充值', tags: ['娱乐'] },
  { amount: 210.00, date: '2026-05-11', category: '购物', note: '日用品', tags: ['购物'] },
  { amount: 55.00, date: '2026-05-11', category: '餐饮', note: '自助餐', tags: ['餐饮'] }
];

/**
 * Check if demo mode is currently active.
 * @returns {Promise<boolean>}
 */
async function isDemoMode() {
  return await getSettings(DEMO_MODE_KEY, false);
}

/**
 * Enable demo mode: backup real data and load 20 sample expenses.
 */
async function enableDemoMode() {
  // Backup current data to localStorage so it survives clearAllData()
  const currentExpenses = await getExpenses();
  const currentTags = await getTags();
  const currentTagGroups = await getTagGroups();

  if (currentExpenses.length > 0 || currentTags.length > 0 || currentTagGroups.length > 0) {
    localStorage.setItem(REAL_DATA_BACKUP_KEY, JSON.stringify({
      expenses: currentExpenses,
      tags: currentTags,
      tagGroups: currentTagGroups,
      backedUpAt: new Date().toISOString()
    }));
  } else {
    localStorage.removeItem(REAL_DATA_BACKUP_KEY);
  }

  // Clear current data
  await clearAllData();

  // Ensure default tags exist (db init will do this), then add sample data
  // We need to map tag names to actual tag IDs after init
  await initDB();

  const tags = await getTags();
  const tagMap = {};
  for (const t of tags) {
    tagMap[t.name] = t.id;
  }

  for (const sample of DEMO_SAMPLE_DATA) {
    const tagIds = [];
    for (const tagName of (sample.tags || [])) {
      if (tagMap[tagName] && !tagIds.includes(tagMap[tagName])) {
        tagIds.push(tagMap[tagName]);
      }
    }
    await addExpense({
      amount: sample.amount,
      date: sample.date,
      category: sample.category,
      note: sample.note,
      tags: tagIds
    });
  }

  await setSettings(DEMO_MODE_KEY, true);
}

/**
 * Disable demo mode: restore real data from backup.
 */
async function disableDemoMode() {
  const raw = localStorage.getItem(REAL_DATA_BACKUP_KEY);
  const backup = raw ? JSON.parse(raw) : null;

  // Clear demo data
  await clearAllData();

  if (backup && (backup.expenses || backup.tags || backup.tagGroups)) {
    await importData({
      version: 2,
      exportedAt: new Date().toISOString(),
      expenses: backup.expenses || [],
      tags: backup.tags || [],
      tagGroups: backup.tagGroups || [],
      settings: []
    });
  } else {
    // No backup, just re-init defaults
    await initDB();
  }

  await setSettings(DEMO_MODE_KEY, false);
  localStorage.removeItem(REAL_DATA_BACKUP_KEY);
}

window.shouldShowGuide = shouldShowGuide;
window.completeGuide = completeGuide;
window.resetGuide = resetGuide;
window.showGuide = showGuide;
window.isDemoMode = isDemoMode;
window.enableDemoMode = enableDemoMode;
window.disableDemoMode = disableDemoMode;
window.toggleDemoMode = toggleDemoMode;

/**
 * Toggle demo mode on/off.
 * @returns {Promise<boolean>} New demo mode state
 */
async function toggleDemoMode() {
  const currentlyDemo = await isDemoMode();
  if (currentlyDemo) {
    await disableDemoMode();
    return false;
  } else {
    await enableDemoMode();
    return true;
  }
}
