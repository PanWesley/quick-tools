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
    calendarCollapsed: false,
    listFilter: 'inbox',
    search: '',
    editingTaskId: ''
  };

  var els = {};
  var journalSaveTimer = null;
  var swipeState = null;

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

  function normalizePriority(priority) {
    return ['high', 'medium', 'low', 'none'].includes(priority) ? priority : 'none';
  }

  function priorityLabel(priority) {
    return {
      none: '不重要不紧急',
      low: '不重要但紧急',
      medium: '重要不紧急',
      high: '重要且紧急'
    }[normalizePriority(priority)];
  }

  function closeSwipeRows(exceptRow) {
    document.querySelectorAll('.task-row.actions-open').forEach(function(row) {
      if (row !== exceptRow) closeSwipeRow(row);
    });
  }

  function openSwipeRow(row) {
    var content = row.querySelector('.task-content');
    var actions = row.querySelector('.task-swipe-actions');
    var width = actions ? Math.round(actions.getBoundingClientRect().width) : 104;
    closeSwipeRows(row);
    row.classList.add('actions-open');
    if (content) {
      content.style.marginLeft = '-' + width + 'px';
      content.style.marginRight = width + 'px';
    }
  }

  function closeSwipeRow(row) {
    var content = row.querySelector('.task-content');
    row.classList.remove('actions-open');
    if (content) {
      content.style.marginLeft = '';
      content.style.marginRight = '';
    }
  }

  function handleSwipeStart(event) {
    var row = event.target.closest('.task-row.has-swipe-actions');
    if (!row || !event.touches || event.touches.length !== 1) return;
    var touch = event.touches[0];
    swipeState = {
      row: row,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY
    };
  }

  function handleSwipeMove(event) {
    if (!swipeState || !event.touches || event.touches.length !== 1) return;
    var touch = event.touches[0];
    swipeState.currentX = touch.clientX;
    swipeState.currentY = touch.clientY;
    var dx = swipeState.currentX - swipeState.startX;
    var dy = swipeState.currentY - swipeState.startY;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) && dx < 0) {
      event.preventDefault();
    }
  }

  function handleSwipeEnd(event) {
    if (!swipeState) return;
    var touch = event.changedTouches && event.changedTouches[0];
    var endX = touch ? touch.clientX : swipeState.currentX;
    var dx = endX - swipeState.startX;
    if (dx < -42) {
      openSwipeRow(swipeState.row);
    } else if (dx > 32) {
      closeSwipeRow(swipeState.row);
    }
    swipeState = null;
  }

  function priorityTone(priority) {
    return {
      high: 'coral',
      medium: 'sun',
      low: 'mint',
      none: 'sky'
    }[normalizePriority(priority)];
  }

  function priorityRowClass(priority) {
    return ' priority-' + normalizePriority(priority);
  }

  function formatDateMeta(task) {
    if (!task.date) return '收集箱';
    var prefix = task.date < appState.todayKey ? '逾期' : task.date === appState.todayKey ? '今天' : task.date;
    return [prefix, task.notes].filter(Boolean).join(' · ');
  }

  function renderEmpty(text) {
    return '<p class="empty-state">' + escapeHtml(text) + '</p>';
  }

  function tomorrowKey() {
    return DateUtils.toDateKey(DateUtils.addDays(DateUtils.fromDateKey(appState.todayKey), 1));
  }

  function themeColorForPreset(preset) {
    return {
      orange: '#FF8A2A',
      sky: '#4AA3FF',
      mint: '#42B883',
      dark: '#21161B'
    }[preset] || '#FF8A2A';
  }

  function closeSelectMenus(exceptMenu) {
    document.querySelectorAll('.select-menu').forEach(function(menu) {
      if (menu !== exceptMenu) menu.hidden = true;
    });
    document.querySelectorAll('[data-select-target]').forEach(function(trigger) {
      var menu = $(trigger.dataset.selectTarget + '-menu');
      trigger.setAttribute('aria-expanded', String(menu && !menu.hidden));
    });
  }

  function listConfig(filter) {
    return {
      inbox: { title: '未安排', subtitle: '还没定日期的任务，适合先收集想法。', empty: '没有未安排任务。新增任务时选择“未安排”即可放到这里。' },
      upcoming: { title: '之后要做', subtitle: '今天之后的任务，按日期从近到远排列。', empty: '还没有未来任务。' },
      completed: { title: '已完成', subtitle: '最近完成的任务记录，最多显示 20 条。', empty: '还没有完成记录。' },
      deleted: { title: '已删除', subtitle: '最近删除的任务，可以从这里恢复。', empty: '最近没有删除的任务。' }
    }[filter] || { title: '未安排', subtitle: '还没定日期的任务，适合先收集想法。', empty: '没有未安排任务。' };
  }

  function renderTask(task, options) {
    var opts = options || {};
    var title = State.getTaskDisplayTitle(task);
    var completeButton = opts.complete === false
      ? '<span></span>'
      : '<button class="task-check" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '" aria-label="完成任务"></button>';
    var actions = [];
    if (opts.edit !== false && task.status !== 'completed' && task.status !== 'deleted') {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(task.id) + '">编辑</button>');
    }
    if (opts.restore === true) {
      actions.push('<button class="swipe-action restore" type="button" data-action="restore-task" data-id="' + escapeHtml(task.id) + '">恢复</button>');
    } else if (opts.delete !== false && task.status !== 'deleted') {
      actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(task.id) + '">删除</button>');
    }

    return [
      '<article class="task-row' + (task.status === 'completed' ? ' is-completed' : '') + priorityRowClass(task.priority) + (actions.length ? ' has-swipe-actions' : '') + '" data-swipe-row>',
      actions.length ? '<div class="task-swipe-actions">' + actions.join('') + '</div>' : '',
      '<div class="task-content">',
      completeButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(title) + '</div>',
      '<div class="task-meta">' + escapeHtml(formatDateMeta(task)) + '</div>',
      '</div>',
      '<div class="priority-tag ' + normalizePriority(task.priority) + '">' + escapeHtml(priorityLabel(task.priority)) + '</div>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderDateTask(task) {
    var actions = task.status === 'completed'
      ? ''
      : '<div class="date-actions"><button class="text-action" type="button" data-action="edit-task" data-id="' + escapeHtml(task.id) + '">编辑</button><button class="text-action danger-text" type="button" data-action="delete-task" data-id="' + escapeHtml(task.id) + '">删除</button></div>';
    var completeButton = task.status === 'completed'
      ? '<span class="date-icon done-icon">✓</span>'
      : '<button class="task-check small" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '" aria-label="完成任务"></button>';
    return [
      '<article class="date-row date-task-row' + (task.status === 'completed' ? ' is-completed' : '') + '">',
      completeButton,
      '<div class="date-row-main">',
      '<div class="task-title">' + escapeHtml(State.getTaskDisplayTitle(task)) + '</div>',
      '<div class="task-meta">' + escapeHtml(formatDateMeta(task)) + '</div>',
      '</div>',
      '<span class="priority-tag ' + normalizePriority(task.priority) + '">' + escapeHtml(priorityLabel(task.priority)) + '</span>',
      actions,
      '</article>'
    ].join('');
  }

  function calendarEntryTone(entry) {
    if (entry.type === 'task') return priorityTone(entry.priority);
    if (entry.type === 'habit') return entry.state === 'done' ? 'mint' : 'lilac';
    return 'rose';
  }

  function calendarEntryStateClass(entry) {
    return ['completed', 'done', 'skipped'].includes(entry.state) ? ' is-done' : '';
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
    var grid = DateUtils.buildMonthGrid(appState.calendarYear, appState.calendarMonth)
      .reduce(function(weeks, cell, index) {
        if (index % 7 === 0) weeks.push([]);
        weeks[weeks.length - 1].push(cell);
        return weeks;
      }, [])
      .filter(function(week) {
        return week.some(function(cell) { return cell.isCurrentMonth; });
      })
      .flat();
    els.calendarLabel.textContent = DateUtils.formatMonthLabel(appState.calendarYear, appState.calendarMonth);
    els.calendarCard.classList.toggle('is-collapsed', appState.calendarCollapsed);
    els.calendarToggle.textContent = appState.calendarCollapsed ? '展开' : '收起';
    els.calendarToggle.setAttribute('aria-expanded', String(!appState.calendarCollapsed));
    els.calendarGrid.innerHTML = grid.map(function(cell) {
      if (!cell.isCurrentMonth) {
        return [
          '<span class="day-cell outside empty-month-cell" aria-hidden="true">',
          '<span class="day-head"></span>',
          '<span class="calendar-strips"></span>',
          '</span>'
        ].join('');
      }
      var entries = State.getCalendarEntries(appState.data, cell.dateKey);
      var strips = entries.slice(0, 2).map(function(entry) {
        return '<span class="calendar-strip ' + calendarEntryTone(entry) + calendarEntryStateClass(entry) + '">' + escapeHtml(entry.label) + '</span>';
      }).join('');
      var overflow = entries.length > 2 ? '<span class="calendar-more">+' + (entries.length - 2) + '</span>' : '';
      return [
        '<button class="day-cell',
        cell.isCurrentMonth ? '' : ' outside',
        cell.isToday ? ' today' : '',
        cell.dateKey === appState.selectedDateKey ? ' selected' : '',
        '" type="button" data-action="select-date" data-date="' + escapeHtml(cell.dateKey) + '">',
        '<span class="day-head"><span class="day-date"><span class="day-number">' + cell.day + '</span><span class="day-lunar">' + DateUtils.formatLunarDay(cell.dateKey) + '</span></span></span>',
        '<span class="calendar-strips">' + strips + overflow + '</span>',
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
      rows.push(renderDateTask(task));
    });
    habits.forEach(function(habit) {
      var log = State.getHabitLogForDate(appState.data.habitLogs, habit.id, dateKey);
      rows.push('<article class="date-row date-note-row"><span class="date-icon habit-icon">习</span><div><div class="task-title">' + escapeHtml(habit.title || '未命名习惯') + '</div><div class="task-meta">习惯 · ' + escapeHtml(log ? log.state : '待打卡') + '</div></div></article>');
    });
    if (journal) {
      rows.push('<article class="date-row date-note-row"><span class="date-icon journal-icon">记</span><div><div class="task-title">每日一句</div><div class="task-meta">' + escapeHtml(journal.content) + '</div></div></article>');
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
    var deleted = State.getDeletedTasks(appState.data.tasks).slice(0, 20);
    var groups = {
      inbox: inbox,
      upcoming: upcoming,
      completed: completed,
      deleted: deleted
    };
    var config = listConfig(appState.listFilter);
    var current = groups[appState.listFilter] || inbox;
    els.inboxCount.textContent = inbox.length;
    els.upcomingCount.textContent = upcoming.length;
    els.completedCount.textContent = completed.length;
    els.deletedCount.textContent = deleted.length;
    els.listCurrentTitle.textContent = config.title;
    els.listCurrentSubtitle.textContent = config.subtitle;
    els.listCurrentCount.textContent = current.length;
    document.querySelectorAll('[data-list-filter]').forEach(function(button) {
      button.classList.toggle('active', button.dataset.listFilter === appState.listFilter);
    });
    if (appState.listFilter === 'completed') {
      els.taskList.innerHTML = current.length ? current.map(function(task) {
        return renderTask(task, { complete: false, delete: false });
      }).join('') : renderEmpty(config.empty);
    } else if (appState.listFilter === 'deleted') {
      els.taskList.innerHTML = current.length ? current.map(function(task) {
        return renderTask(task, { complete: false, edit: false, restore: true });
      }).join('') : renderEmpty(config.empty);
    } else {
      els.taskList.innerHTML = current.length ? current.map(renderTask).join('') : renderEmpty(config.empty);
    }
  }

  function render() {
    renderToday();
    renderCalendar();
    renderLists();
  }

  function viewFromHash() {
    var view = (window.location.hash || '#today').replace('#', '');
    return ['today', 'calendar', 'list', 'profile'].includes(view) ? view : 'today';
  }

  function switchView(view) {
    if (els.quickSheet && !els.quickSheet.hidden) closeSheet();
    closeSelectMenus();
    appState.view = view;
    document.querySelectorAll('.view').forEach(function(section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    if (window.location.hash !== '#' + view) {
      window.location.hash = view;
    }
  }

  function setChoiceValue(targetId, value) {
    var input = $(targetId);
    if (!input) return;
    input.value = value;
    document.querySelectorAll('[data-choice-target="' + targetId + '"]').forEach(function(button) {
      button.classList.toggle('active', button.dataset.choiceValue === value);
    });
    var selected = document.querySelector('[data-choice-target="' + targetId + '"][data-choice-value="' + value + '"]');
    var label = $(targetId + '-label');
    var desc = $(targetId + '-desc');
    if (selected && label) label.textContent = selected.dataset.choiceLabel || selected.textContent.trim();
    if (selected && desc) desc.textContent = selected.dataset.choiceDesc || '';
    if (targetId === 'quick-type') {
      document.body.classList.toggle('quick-is-habit', value === 'habit');
    }
    closeSelectMenus();
  }

  function setQuickDate(dateKey, mode) {
    var normalizedDate = dateKey || '';
    var activeMode = mode;
    if (!activeMode) {
      activeMode = !normalizedDate ? 'pending' : normalizedDate === appState.todayKey ? 'today' : normalizedDate === tomorrowKey() ? 'tomorrow' : 'custom';
    }
    els.quickDate.value = dateKey || '';
    if (els.quickDatePicker) els.quickDatePicker.value = activeMode === 'custom' ? normalizedDate : '';
    if (els.quickDateField) els.quickDateField.classList.toggle('is-custom-date', activeMode === 'custom');
    document.querySelectorAll('[data-date-preset]').forEach(function(button) {
      button.classList.toggle('active', button.dataset.datePreset === activeMode);
    });
  }

  function applyThemePreset(preset) {
    var nextPreset = ['orange', 'sky', 'mint', 'dark'].includes(preset) ? preset : 'orange';
    var html = document.documentElement;
    html.setAttribute('data-palette', nextPreset === 'dark' ? 'orange' : nextPreset);
    html.setAttribute('data-theme', nextPreset === 'dark' ? 'dark' : 'light');
    localStorage.setItem('today-youxu-palette', nextPreset);
    localStorage.setItem('quick-tools-theme', nextPreset === 'dark' ? 'dark' : 'light');
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', themeColorForPreset(nextPreset));
    document.querySelectorAll('[data-theme-preset]').forEach(function(button) {
      var active = button.dataset.themePreset === nextPreset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function initThemePreset() {
    var saved = localStorage.getItem('today-youxu-palette') ||
      (localStorage.getItem('quick-tools-theme') === 'dark' ? 'dark' : 'orange');
    applyThemePreset(saved);
  }

  function openSheet() {
    appState.editingTaskId = '';
    $('quick-sheet-title').textContent = '快速新增';
    els.quickEditId.value = '';
    els.quickType.disabled = false;
    setChoiceValue('quick-type', 'task');
    setChoiceValue('quick-priority', 'medium');
    setQuickDate('', 'pending');
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickTitle.focus();
  }

  function closeSheet() {
    els.sheetBackdrop.hidden = true;
    els.quickSheet.hidden = true;
    els.quickForm.reset();
    els.quickType.disabled = false;
    setChoiceValue('quick-type', 'task');
    setChoiceValue('quick-priority', 'medium');
    setQuickDate('', 'pending');
    appState.editingTaskId = '';
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

    var action;
    if (appState.editingTaskId) {
      action = DB.updateTask(appState.editingTaskId, {
        title: title,
        notes: els.quickNotes.value,
        date: els.quickDate.value,
        priority: els.quickPriority.value
      });
    } else {
      action = type === 'habit'
        ? DB.createHabit({ title: title, schedule: 'daily' })
        : DB.createTask({
        title: title,
        notes: els.quickNotes.value,
        date: els.quickDate.value,
        priority: els.quickPriority.value
      });
    }

    action.then(function() {
      var wasEditing = Boolean(appState.editingTaskId);
      closeSheet();
      showToast(wasEditing ? '任务已更新' : type === 'habit' ? '习惯已创建' : '任务已创建');
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
    closeSwipeRows();

    if (action === 'save-journal') {
      event.preventDefault();
      saveJournal();
    } else if (action === 'edit-task') {
      openEditTask(id);
    } else if (action === 'complete-task') {
      DB.completeTask(id).then(loadData).then(function() { showToast('任务已完成'); });
    } else if (action === 'delete-task') {
      DB.deleteTask(id).then(loadData).then(function() { showToast('任务已删除'); });
    } else if (action === 'restore-task') {
      DB.restoreTask(id).then(loadData).then(function() { showToast('任务已恢复'); });
    } else if (action === 'check-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'done').then(loadData).then(function() { showToast('打卡完成'); });
    } else if (action === 'skip-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'skipped').then(loadData).then(function() { showToast('已跳过'); });
    } else if (action === 'select-date') {
      appState.selectedDateKey = target.dataset.date;
      renderCalendar();
    }
  }

  function openEditTask(id) {
    var task = appState.data.tasks.find(function(item) { return item.id === id; });
    if (!task) {
      showToast('没有找到这条任务');
      return;
    }
    appState.editingTaskId = id;
    $('quick-sheet-title').textContent = '编辑任务';
    els.quickEditId.value = id;
    setChoiceValue('quick-type', 'task');
    els.quickType.disabled = true;
    els.quickTitle.value = task.title || '';
    setQuickDate(task.date || '');
    setChoiceValue('quick-priority', normalizePriority(task.priority));
    els.quickNotes.value = task.notes || '';
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickTitle.focus();
  }

  function changeMonth(delta) {
    var date = new Date(appState.calendarYear, appState.calendarMonth + delta, 1);
    appState.calendarYear = date.getFullYear();
    appState.calendarMonth = date.getMonth();
    renderCalendar();
  }

  function jumpToTodayMonth() {
    var today = DateUtils.fromDateKey(appState.todayKey);
    appState.calendarYear = today.getFullYear();
    appState.calendarMonth = today.getMonth();
    appState.selectedDateKey = appState.todayKey;
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

  function copyFeedbackEmail() {
    var email = 'billnest_feedback@outlook.com';
    var fallback = function() {
      var textarea = document.createElement('textarea');
      textarea.value = email;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast('邮箱地址已复制');
      } catch (error) {
        showToast('复制失败，请手动复制');
      }
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email).then(function() {
        showToast('邮箱地址已复制');
      }).catch(fallback);
    } else {
      fallback();
    }
  }

  function openFeedbackMail() {
    window.open('mailto:billnest_feedback@outlook.com?subject=' + encodeURIComponent('今日有序问题反馈'), '_blank', 'noopener,noreferrer');
  }

  function handleImportClick() {
    els.importFile.value = '';
    els.importFile.click();
  }

  function readImportFile(file) {
    return file.text().then(function(text) {
      return JSON.parse(text);
    });
  }

  function handleImportFile() {
    var file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    readImportFile(file).then(function(payload) {
      var validation = window.TodayYouxuImport.validateImportPayload(payload);
      if (!validation.valid) {
        showToast(validation.reason);
        return null;
      }
      var summary = window.TodayYouxuImport.summarizeImportPayload(payload);
      var message = '将导入：任务 ' + summary.tasks + '，习惯 ' + summary.habits + '，打卡 ' + summary.habitLogs + '，日记 ' + summary.journals + '。导入会合并数据，不会清空本地。';
      if (!window.confirm(message)) return null;
      return DB.importData(payload).then(function(result) {
        var totals = result.stats.totals;
        showToast('导入完成：新增 ' + totals.inserted + '，更新 ' + totals.updated + '，跳过 ' + totals.skipped);
        return loadData();
      });
    }).catch(function(error) {
      showToast('导入失败：' + error.message);
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
    els.calendarCard = $('calendar-card');
    els.calendarToggle = $('toggle-calendar');
    els.calendarGrid = $('calendar-grid');
    els.selectedDateTitle = $('selected-date-title');
    els.selectedDateSubtitle = $('selected-date-subtitle');
    els.selectedDateList = $('selected-date-list');
    els.taskSearch = $('task-search');
    els.taskList = $('task-list');
    els.inboxCount = $('inbox-count');
    els.upcomingCount = $('upcoming-count');
    els.completedCount = $('completed-count');
    els.deletedCount = $('deleted-count');
    els.listCurrentTitle = $('list-current-title');
    els.listCurrentSubtitle = $('list-current-subtitle');
    els.listCurrentCount = $('list-current-count');
    els.openAdd = $('open-add');
    els.closeAdd = $('close-add');
    els.cancelAdd = $('cancel-add');
    els.quickSheet = $('quick-sheet');
    els.sheetBackdrop = $('sheet-backdrop');
    els.quickForm = $('quick-form');
    els.quickEditId = $('quick-edit-id');
    els.quickType = $('quick-type');
    els.quickTitle = $('quick-title');
    els.quickDate = $('quick-date');
    els.quickDateField = $('quick-date-field');
    els.quickDatePicker = $('quick-date-picker');
    els.quickPriority = $('quick-priority');
    els.quickNotes = $('quick-notes');
    els.exportButton = $('export-button');
    els.importButton = $('import-button');
    els.importFile = $('import-file');
    els.clearButton = $('clear-button');
    els.feedbackEmail = $('feedback-email-text');
    els.feedbackMailButton = $('feedback-mail-button');
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
    $('prev-month').addEventListener('click', function() { changeMonth(-1); });
    $('today-month').addEventListener('click', jumpToTodayMonth);
    $('next-month').addEventListener('click', function() { changeMonth(1); });
    els.calendarToggle.addEventListener('click', function() {
      appState.calendarCollapsed = !appState.calendarCollapsed;
      renderCalendar();
    });
    els.openAdd.addEventListener('click', openSheet);
    els.closeAdd.addEventListener('click', closeSheet);
    els.cancelAdd.addEventListener('click', closeSheet);
    els.sheetBackdrop.addEventListener('click', closeSheet);
    els.quickForm.addEventListener('submit', handleQuickSubmit);
    document.querySelectorAll('[data-select-target]').forEach(function(trigger) {
      trigger.addEventListener('click', function(event) {
        event.stopPropagation();
        if (trigger.dataset.selectTarget === 'quick-type' && appState.editingTaskId) return;
        var menu = $(trigger.dataset.selectTarget + '-menu');
        if (!menu) return;
        var willOpen = menu.hidden;
        closeSelectMenus(menu);
        menu.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
      });
    });
    document.querySelectorAll('[data-choice-target]').forEach(function(button) {
      button.addEventListener('click', function(event) {
        event.stopPropagation();
        if (button.dataset.choiceTarget === 'quick-type' && appState.editingTaskId) return;
        setChoiceValue(button.dataset.choiceTarget, button.dataset.choiceValue);
      });
    });
    document.querySelectorAll('[data-date-preset]').forEach(function(button) {
      button.addEventListener('click', function() {
        var preset = button.dataset.datePreset;
        setQuickDate(preset === 'today' ? appState.todayKey : preset === 'tomorrow' ? tomorrowKey() : '', preset);
      });
    });
    els.quickDatePicker.addEventListener('change', function() {
      setQuickDate(els.quickDatePicker.value, 'custom');
    });
    document.addEventListener('click', function(event) {
      if (!event.target.closest('.custom-select')) closeSelectMenus();
    });
    els.journalForm.addEventListener('submit', handleJournalSubmit);
    els.journalContent.addEventListener('input', scheduleJournalSave);
    els.taskSearch.addEventListener('input', function() {
      appState.search = els.taskSearch.value;
      renderLists();
    });
    document.querySelectorAll('[data-list-filter]').forEach(function(button) {
      button.addEventListener('click', function() {
        appState.listFilter = button.dataset.listFilter;
        renderLists();
      });
    });
    els.exportButton.addEventListener('click', exportData);
    els.importButton.addEventListener('click', handleImportClick);
    els.importFile.addEventListener('change', handleImportFile);
    els.clearButton.addEventListener('click', clearData);
    document.querySelectorAll('[data-theme-preset]').forEach(function(button) {
      button.addEventListener('click', function() {
        applyThemePreset(button.dataset.themePreset);
      });
    });
    if (els.feedbackEmail) els.feedbackEmail.addEventListener('click', copyFeedbackEmail);
    if (els.feedbackMailButton) els.feedbackMailButton.addEventListener('click', openFeedbackMail);
    document.addEventListener('click', handleAction);
    document.addEventListener('click', function(event) {
      var row = event.target.closest('.task-row');
      closeSwipeRows(row);
    });
    document.addEventListener('touchstart', handleSwipeStart, { passive: true });
    document.addEventListener('touchmove', handleSwipeMove, { passive: false });
    document.addEventListener('touchend', handleSwipeEnd);
    window.addEventListener('hashchange', function() {
      var nextView = viewFromHash();
      if (nextView !== appState.view) {
        switchView(nextView);
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/tools/time/sw.js').catch(function(error) {
      console.warn('[TodayYouxu] Service worker registration failed:', error);
    });
  }

  function init() {
    cacheElements();
    initThemePreset();
    bindEvents();
    switchView(viewFromHash());
    loadData();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
