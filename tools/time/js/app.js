(function() {
  var DateUtils = window.TodayYouxuDateUtils;
  var State = window.TodayYouxuState;
  var Exporter = window.TodayYouxuExport;
  var DB = window.TodayYouxuDB;

  var appState = {
    view: 'today',
    data: { tasks: [], habits: [], habitLogs: [], journals: [], opLogs: [] },
    todayKey: DateUtils.getTodayKey(),
    selectedDateKey: DateUtils.getTodayKey(),
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    search: ''
  };

  var els = {};
  var journalSaveTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function() {
      els.toast.hidden = true;
    }, 2200);
  }

  function priorityLabel(priority) {
    return {
      none: '无',
      low: '低',
      medium: '中',
      high: '高'
    }[priority || 'none'] || '无';
  }

  function formatDateMeta(task) {
    if (!task.date) return '收集箱';
    var prefix = task.date < appState.todayKey ? '逾期' : task.date === appState.todayKey ? '今天' : task.date;
    return [prefix, task.notes].filter(Boolean).join(' · ');
  }

  function renderEmpty(text) {
    return '<p class="empty-state">' + escapeHtml(text) + '</p>';
  }

  function renderTask(task, options) {
    var opts = options || {};
    var completeButton = opts.complete === false
      ? '<span></span>'
      : '<button class="task-check" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '" aria-label="完成任务"></button>';
    var deleteButton = opts.delete === false
      ? ''
      : '<button class="btn ghost" type="button" data-action="delete-task" data-id="' + escapeHtml(task.id) + '">删除</button>';

    return [
      '<article class="task-row">',
      completeButton,
      '<div>',
      '<div class="task-title">' + escapeHtml(task.title) + '</div>',
      '<div class="task-meta">' + escapeHtml(formatDateMeta(task)) + '</div>',
      '</div>',
      '<div class="priority-tag ' + escapeHtml(task.priority || 'none') + '">' + escapeHtml(priorityLabel(task.priority)) + '</div>',
      deleteButton,
      '</article>'
    ].join('');
  }

  function renderHabit(habit) {
    var log = State.getHabitLogForDate(appState.data.habitLogs, habit.id, appState.todayKey);
    var done = log && log.state === 'done';
    var skipped = log && log.state === 'skipped';
    var status = done ? '已打卡' : skipped ? '已跳过' : '待完成';
    return [
      '<article class="habit-card">',
      '<strong>' + escapeHtml(habit.title) + '</strong>',
      '<p>' + escapeHtml(status) + '</p>',
      '<div class="habit-actions">',
      '<button class="btn primary" type="button" data-action="check-habit" data-id="' + escapeHtml(habit.id) + '"' + (done ? ' disabled' : '') + '>打卡</button>',
      '<button class="btn secondary" type="button" data-action="skip-habit" data-id="' + escapeHtml(habit.id) + '"' + (skipped ? ' disabled' : '') + '>跳过</button>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderToday() {
    var todayDate = DateUtils.fromDateKey(appState.todayKey);
    var todayTasks = State.getTodayTasks(appState.data.tasks, appState.todayKey);
    var dueHabits = appState.data.habits.filter(function(habit) {
      return State.habitDueOn(habit, appState.todayKey);
    });
    var journal = appState.data.journals.find(function(entry) {
      return entry.date === appState.todayKey;
    });

    els.todayTitle.textContent = (todayDate.getMonth() + 1) + '月' + todayDate.getDate() + '日';
    els.todayWeekday.textContent = DateUtils.formatWeekday(appState.todayKey);
    els.todaySummary.textContent = '今天还有 ' + todayTasks.length + ' 件事、' + dueHabits.length + ' 个习惯';
    els.todayTaskCount.textContent = todayTasks.length;
    els.todayHabitCount.textContent = dueHabits.length;
    els.todayTaskList.innerHTML = todayTasks.length ? todayTasks.map(renderTask).join('') : renderEmpty('今天没有待办。可以点击 + 记录一件事。');
    els.todayHabitList.innerHTML = dueHabits.length ? dueHabits.map(renderHabit).join('') : renderEmpty('还没有需要今天打卡的习惯。');
    els.journalContent.value = journal ? journal.content : '';
  }

  function renderCalendar() {
    var grid = DateUtils.buildMonthGrid(appState.calendarYear, appState.calendarMonth);
    var marks = State.getCalendarMarks(appState.data, grid.map(function(cell) { return cell.dateKey; }));
    els.calendarLabel.textContent = DateUtils.formatMonthLabel(appState.calendarYear, appState.calendarMonth);
    els.calendarGrid.innerHTML = grid.map(function(cell) {
      var mark = marks[cell.dateKey] || { tasks: 0, habits: 0, journal: false };
      var dots = [
        mark.tasks ? '<span class="day-dot"></span>' : '',
        mark.habits ? '<span class="day-dot habit"></span>' : '',
        mark.journal ? '<span class="day-dot journal"></span>' : ''
      ].join('');
      return [
        '<button class="day-cell',
        cell.isCurrentMonth ? '' : ' outside',
        cell.isToday ? ' today' : '',
        cell.dateKey === appState.selectedDateKey ? ' selected' : '',
        '" type="button" data-action="select-date" data-date="' + escapeHtml(cell.dateKey) + '">',
        '<span class="day-number">' + cell.day + '</span>',
        '<span class="day-dots">' + dots + '</span>',
        '</button>'
      ].join('');
    }).join('');
    renderSelectedDate();
  }

  function renderSelectedDate() {
    var dateKey = appState.selectedDateKey;
    var tasks = appState.data.tasks.filter(function(task) {
      return task.status !== 'deleted' && task.date === dateKey;
    });
    var habits = appState.data.habits.filter(function(habit) {
      return State.habitDueOn(habit, dateKey);
    });
    var journal = appState.data.journals.find(function(entry) {
      return entry.date === dateKey && String(entry.content || '').trim();
    });
    var rows = [];

    tasks.forEach(function(task) {
      rows.push(renderTask(task, { complete: task.status !== 'completed', delete: task.status !== 'completed' }));
    });
    habits.forEach(function(habit) {
      var log = State.getHabitLogForDate(appState.data.habitLogs, habit.id, dateKey);
      rows.push('<article class="date-row"><span></span><div><div class="task-title">' + escapeHtml(habit.title) + '</div><div class="task-meta">习惯 · ' + escapeHtml(log ? log.state : '待打卡') + '</div></div></article>');
    });
    if (journal) {
      rows.push('<article class="date-row"><span></span><div><div class="task-title">每日一句</div><div class="task-meta">' + escapeHtml(journal.content) + '</div></div></article>');
    }

    els.selectedDateTitle.textContent = dateKey;
    els.selectedDateSubtitle.textContent = DateUtils.formatWeekday(dateKey);
    els.selectedDateList.innerHTML = rows.length ? rows.join('') : renderEmpty('这一天还没有安排或记录。');
  }

  function matchesSearch(task) {
    var query = appState.search.trim().toLowerCase();
    if (!query) return true;
    return String(task.title || '').toLowerCase().includes(query) ||
      String(task.notes || '').toLowerCase().includes(query);
  }

  function renderLists() {
    var tasks = appState.data.tasks.filter(matchesSearch);
    var inbox = State.getInboxTasks(tasks);
    var upcoming = State.getUpcomingTasks(tasks, appState.todayKey);
    var completed = State.getCompletedTasks(tasks).slice(0, 20);
    els.inboxList.innerHTML = inbox.length ? inbox.map(renderTask).join('') : renderEmpty('收集箱为空。');
    els.upcomingList.innerHTML = upcoming.length ? upcoming.map(renderTask).join('') : renderEmpty('还没有未来任务。');
    els.completedList.innerHTML = completed.length ? completed.map(function(task) {
      return renderTask(task, { complete: false, delete: false });
    }).join('') : renderEmpty('还没有完成记录。');
  }

  function render() {
    renderToday();
    renderCalendar();
    renderLists();
  }

  function switchView(view) {
    appState.view = view;
    document.querySelectorAll('.view').forEach(function(section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    window.location.hash = view;
  }

  function openSheet() {
    els.quickDate.value = appState.todayKey;
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickTitle.focus();
  }

  function closeSheet() {
    els.sheetBackdrop.hidden = true;
    els.quickSheet.hidden = true;
    els.quickForm.reset();
  }

  function loadData() {
    return DB.getAllData().then(function(data) {
      appState.data = data;
      render();
    }).catch(function(error) {
      showToast('本地数据库读取失败：' + error.message);
    });
  }

  function handleQuickSubmit(event) {
    event.preventDefault();
    var type = els.quickType.value;
    var title = els.quickTitle.value.trim();
    if (!title) {
      showToast('请输入标题');
      return;
    }

    var action = type === 'habit'
      ? DB.createHabit({ title: title, schedule: 'daily' })
      : DB.createTask({
        title: title,
        notes: els.quickNotes.value,
        date: els.quickDate.value,
        priority: els.quickPriority.value
      });

    action.then(function() {
      closeSheet();
      showToast(type === 'habit' ? '习惯已创建' : '任务已创建');
      return loadData();
    }).catch(function(error) {
      showToast('保存失败：' + error.message);
    });
  }

  function saveJournal(options) {
    var opts = options || {};
    DB.upsertJournal(appState.todayKey, els.journalContent.value.trim(), '').then(function() {
      if (!opts.silent) showToast('今日一句已保存');
      return loadData();
    }).catch(function(error) {
      showToast('保存失败：' + error.message);
    });
  }

  function scheduleJournalSave() {
    clearTimeout(journalSaveTimer);
    journalSaveTimer = setTimeout(function() {
      saveJournal({ silent: true });
    }, 450);
  }

  window.TodayYouxuApp = {
    saveJournal: saveJournal
  };

  function handleJournalSubmit(event) {
    event.preventDefault();
    saveJournal();
  }

  function handleAction(event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    var id = target.dataset.id;

    if (action === 'save-journal') {
      event.preventDefault();
      saveJournal();
    } else if (action === 'complete-task') {
      DB.completeTask(id).then(loadData).then(function() { showToast('任务已完成'); });
    } else if (action === 'delete-task') {
      DB.deleteTask(id).then(loadData).then(function() { showToast('任务已删除'); });
    } else if (action === 'check-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'done').then(loadData).then(function() { showToast('打卡完成'); });
    } else if (action === 'skip-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'skipped').then(loadData).then(function() { showToast('已跳过'); });
    } else if (action === 'select-date') {
      appState.selectedDateKey = target.dataset.date;
      renderCalendar();
    }
  }

  function changeMonth(delta) {
    var date = new Date(appState.calendarYear, appState.calendarMonth + delta, 1);
    appState.calendarYear = date.getFullYear();
    appState.calendarMonth = date.getMonth();
    renderCalendar();
  }

  function exportData() {
    var payload = Exporter.buildExportPayload(appState.data);
    Exporter.downloadJson(payload, 'today-youxu-' + appState.todayKey + '.json');
    showToast('导出已开始');
  }

  function clearData() {
    if (!window.confirm('确定清空今日有序的本地数据吗？此操作不可撤销。')) return;
    DB.clearAll().then(loadData).then(function() {
      showToast('本地数据已清空');
    }).catch(function(error) {
      showToast('清空失败：' + error.message);
    });
  }

  function cacheElements() {
    els.todayTitle = $('today-title');
    els.todayWeekday = $('today-weekday');
    els.todaySummary = $('today-summary');
    els.todayTaskCount = $('today-task-count');
    els.todayHabitCount = $('today-habit-count');
    els.todayTaskList = $('today-task-list');
    els.todayHabitList = $('today-habit-list');
    els.journalForm = $('journal-form');
    els.journalSave = $('journal-save');
    els.journalContent = $('journal-content');
    els.calendarLabel = $('calendar-label');
    els.calendarGrid = $('calendar-grid');
    els.selectedDateTitle = $('selected-date-title');
    els.selectedDateSubtitle = $('selected-date-subtitle');
    els.selectedDateList = $('selected-date-list');
    els.taskSearch = $('task-search');
    els.inboxList = $('inbox-list');
    els.upcomingList = $('upcoming-list');
    els.completedList = $('completed-list');
    els.openAdd = $('open-add');
    els.closeAdd = $('close-add');
    els.cancelAdd = $('cancel-add');
    els.quickSheet = $('quick-sheet');
    els.sheetBackdrop = $('sheet-backdrop');
    els.quickForm = $('quick-form');
    els.quickType = $('quick-type');
    els.quickTitle = $('quick-title');
    els.quickDate = $('quick-date');
    els.quickPriority = $('quick-priority');
    els.quickNotes = $('quick-notes');
    els.exportButton = $('export-button');
    els.clearButton = $('clear-button');
    els.toast = $('toast');
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.addEventListener('click', function() {
        switchView(button.dataset.view);
      });
    });
    document.querySelectorAll('[data-view-link]').forEach(function(link) {
      link.addEventListener('click', function(event) {
        event.preventDefault();
        switchView(link.dataset.viewLink);
      });
    });
    $('settings-button').addEventListener('click', function() { switchView('profile'); });
    $('prev-month').addEventListener('click', function() { changeMonth(-1); });
    $('next-month').addEventListener('click', function() { changeMonth(1); });
    els.openAdd.addEventListener('click', openSheet);
    els.closeAdd.addEventListener('click', closeSheet);
    els.cancelAdd.addEventListener('click', closeSheet);
    els.sheetBackdrop.addEventListener('click', closeSheet);
    els.quickForm.addEventListener('submit', handleQuickSubmit);
    els.journalForm.addEventListener('submit', handleJournalSubmit);
    els.journalContent.addEventListener('input', scheduleJournalSave);
    els.taskSearch.addEventListener('input', function() {
      appState.search = els.taskSearch.value;
      renderLists();
    });
    els.exportButton.addEventListener('click', exportData);
    els.clearButton.addEventListener('click', clearData);
    document.addEventListener('click', handleAction);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/tools/time/sw.js').catch(function(error) {
      console.warn('[TodayYouxu] Service worker registration failed:', error);
    });
  }

  function init() {
    cacheElements();
    bindEvents();
    var initialView = (window.location.hash || '#today').replace('#', '');
    if (!['today', 'calendar', 'list', 'profile'].includes(initialView)) {
      initialView = 'today';
    }
    switchView(initialView);
    loadData();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
