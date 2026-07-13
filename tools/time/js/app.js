(function() {
  var DateUtils = window.TodayYouxuDateUtils;
  var State = window.TodayYouxuState;
  var Exporter = window.TodayYouxuExport;
  var DB = window.TodayYouxuDB;
  var NotificationService = window.TodayYouxuNotification;
  var NotificationModel = window.TodayYouxuNotificationModel;
  var NotificationSyncFactory = window.TodayYouxuNotificationSync;
  var NotificationSync = null;

  var NOTIFICATION_STATUS_COPY = {
    'subscribing': '正在连接',
    'syncing': '正在连接',
    'pending': '等待同步',
    'ready': '后台提醒已开启',
    'error': '需要重新授权',
    'unsupported': '当前设备不支持',
    'permission-required': '未开启',
    'disabled': '未开启'
  };

  var appState = {
    view: 'today',
    data: { tasks: [], habits: [], habitLogs: [], journals: [], opLogs: [] },
    todayKey: DateUtils.getTodayKey(),
    selectedDateKey: DateUtils.getTodayKey(),
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    calendarCollapsed: false,
    listFilter: 'all',
    areaFilter: 'all',
    search: '',
    listPageSize: 20,
    listDisplayCount: 20,
    editingTaskId: '',
    editingType: '',
    customRepeat: null,
    customReminder: null,
    pickerState: null
  };

  var els = {};
  var journalSaveTimer = null;
  var swipeState = null;
  var notificationBackendStatus = { status: 'disabled' };
  var notificationSetupPromise = null;
  var pendingNotificationSnapshot = null;
  var notificationSyncPromise = null;
  var missedReminderToastShown = false;

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

  function setNotificationBackendStatus(result) {
    notificationBackendStatus = result && result.status ? result : { status: 'error' };
    updateNotificationUI();
    return notificationBackendStatus;
  }

  function handleNotificationBackendFailure(error) {
    console.warn('[TodayYouxu] Notification backend failed:', error);
    setNotificationBackendStatus({ status: 'error' });
  }

  function syncNotificationSnapshot(data) {
    return NotificationModel.buildReminderRecords(data, appState.todayKey, State.habitDueOn, new Date())
      .then(function(records) {
        data.reminders = records.map(function(record) {
          return {
            id: record.id,
            sourceIdHash: record.sourceIdHash,
            notifyAt: record.notifyAt,
            revision: record.revision,
            payload: record.encryptedValue
          };
        });
        setNotificationBackendStatus({ status: 'syncing' });
        return NotificationSync.sync(data, appState.todayKey, State.habitDueOn);
      }).then(setNotificationBackendStatus);
  }

  function queueNotificationSync(data) {
    if (!NotificationSync || !NotificationModel || !data) {
      return Promise.resolve(notificationBackendStatus);
    }
    pendingNotificationSnapshot = data;
    if (notificationSyncPromise) return notificationSyncPromise;

    function drainLatestSnapshot() {
      var snapshot = pendingNotificationSnapshot;
      pendingNotificationSnapshot = null;
      if (!snapshot) return Promise.resolve(notificationBackendStatus);
      return syncNotificationSnapshot(snapshot).then(function(result) {
        return pendingNotificationSnapshot ? drainLatestSnapshot() : result;
      });
    }

    notificationSyncPromise = drainLatestSnapshot().then(function(result) {
      notificationSyncPromise = null;
      if (pendingNotificationSnapshot) return queueNotificationSync(pendingNotificationSnapshot);
      return result;
    }, function(error) {
      notificationSyncPromise = null;
      if (pendingNotificationSnapshot) {
        queueNotificationSync(pendingNotificationSnapshot).catch(handleNotificationBackendFailure);
      }
      throw error;
    });
    return notificationSyncPromise;
  }

  function syncNotificationsWithoutBlocking(data) {
    if (notificationBackendStatus.status === 'unsupported') return;
    queueNotificationSync(data).catch(handleNotificationBackendFailure);
  }

  function showMissedReminderToast(data) {
    if (missedReminderToastShown || !NotificationService || !NotificationService.getMissedCount) return;
    var count = NotificationService.getMissedCount(data, appState.todayKey, State.habitDueOn, new Date());
    if (count > 0) {
      missedReminderToastShown = true;
      showToast('有 ' + count + ' 项提醒已过期');
    }
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

  function areaLabel(area) {
    return State.areaLabel ? State.areaLabel(area) : '生活';
  }

  function closeSwipeRows(exceptRow) {
    document.querySelectorAll('.task-row.actions-open').forEach(function(row) {
      if (row !== exceptRow) closeSwipeRow(row);
    });
    document.querySelectorAll('.list-swipe-row.list-open').forEach(function(row) {
      if (row !== exceptRow) closeListSwipeRow(row);
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
      content.style.marginLeft = '0';
      content.style.marginRight = '0';
    }
    if (document.activeElement && row.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setTimeout(function() {
      if (content && !row.classList.contains('actions-open')) {
        content.style.marginLeft = '';
        content.style.marginRight = '';
      }
    }, 220);
  }

  function openListSwipeRow(row) {
    closeSwipeRows(row);
    row.classList.add('list-open');
  }

  function closeListSwipeRow(row) {
    row.classList.remove('list-open');
  }

  function closeListFilterMenu() {
    if (els.listAreaFilter) els.listAreaFilter.classList.remove('open');
    if (els.listAreaMenu) els.listAreaMenu.hidden = true;
  }

  function handleSwipeStart(event) {
    var row = event.target.closest('.task-row.has-swipe-actions') || event.target.closest('.list-swipe-row');
    if (!row || !event.touches || event.touches.length !== 1) return;
    var touch = event.touches[0];
    swipeState = {
      row: row,
      isListSwipe: row.classList.contains('list-swipe-row'),
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
    if (swipeState.isListSwipe) {
      if (dx < -42) {
        openListSwipeRow(swipeState.row);
      } else if (dx > 32) {
        closeListSwipeRow(swipeState.row);
      }
    } else {
      if (dx < -42) {
        openSwipeRow(swipeState.row);
      } else if (dx > 32) {
        closeSwipeRow(swipeState.row);
      }
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
    var parts = [areaLabel(task.area)];
    if (!task.date) {
      parts.push('收集箱');
      if (task.notes) parts.push(task.notes);
      return parts.join(' · ');
    }
    var prefix = task.date < appState.todayKey ? '逾期' : task.date === appState.todayKey ? '今天' : task.date;
    if (task.timeMode === 'point' && task.startTime) prefix += ' ' + task.startTime;
    if (task.timeMode === 'range' && task.startTime) prefix += ' ' + task.startTime + (task.endTime ? '-' + task.endTime : '');
    parts.push(prefix);
    if (task.notes) parts.push(task.notes);
    return parts.join(' · ');
  }

  function renderEmpty(text) {
    return '<p class="empty-state">' + escapeHtml(text) + '</p>';
  }

  function tomorrowKey() {
    return DateUtils.toDateKey(DateUtils.addDays(DateUtils.fromDateKey(appState.todayKey), 1));
  }

  function weekendKey() {
    var date = DateUtils.fromDateKey(appState.todayKey);
    var day = date.getDay();
    if (day === 6 || day === 0) {
      return appState.todayKey;
    }
    var offset = 6 - day;
    return DateUtils.toDateKey(DateUtils.addDays(date, offset));
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

    var isOverdue = task.date && task.date < appState.todayKey && task.status !== 'completed' && task.status !== 'deleted';
    return [
      '<article class="task-row' + (task.status === 'completed' ? ' is-completed' : '') + (isOverdue ? ' is-overdue-row' : '') + priorityRowClass(task.priority) + (actions.length ? ' has-swipe-actions' : '') + '" data-swipe-row data-notification-type="task" data-notification-id="' + escapeHtml(task.id) + '" data-notification-date="' + escapeHtml(task.date || '') + '">',
      actions.length ? '<div class="task-swipe-actions">' + actions.join('') + '</div>' : '',
      '<div class="task-content">',
      completeButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(title) + '</div>',
      '<div class="task-meta">' + escapeHtml(formatDateMeta(task)) + '</div>',
      '</div>',
      '<span class="type-tag task-tag">任务</span>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderDateTask(task) {
    var actions = [];
    if (task.status !== 'completed' && task.status !== 'deleted') {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(task.id) + '">编辑</button>');
      actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(task.id) + '">删除</button>');
    }
    var completeButton = task.status === 'completed'
      ? '<span class="date-icon done-icon">✓</span>'
      : '<button class="task-check small" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '" aria-label="完成任务"></button>';
    var isDateOverdue = task.date && task.date < appState.todayKey && task.status !== 'completed' && task.status !== 'deleted';
    return [
      '<article class="task-row date-task-row' + (task.status === 'completed' ? ' is-completed' : '') + (isDateOverdue ? ' is-overdue-row' : '') + priorityRowClass(task.priority) + (actions.length ? ' has-swipe-actions' : '') + '"' + (actions.length ? ' data-swipe-row' : '') + ' data-notification-type="task" data-notification-id="' + escapeHtml(task.id) + '" data-notification-date="' + escapeHtml(task.date || '') + '">',
      actions.length ? '<div class="task-swipe-actions">' + actions.join('') + '</div>' : '',
      '<div class="task-content">',
      completeButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(State.getTaskDisplayTitle(task)) + '</div>',
      '<div class="task-meta">' + escapeHtml(formatDateMeta(task)) + '</div>',
      '</div>',
      '<span class="type-tag task-tag">任务</span>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderDateHabit(habit, dateKey) {
    var log = State.getHabitLogForDate(appState.data.habitLogs, habit.id, dateKey);
    var done = log && log.state === 'done';
    var skipped = log && log.state === 'skipped';
    var statusText = done ? '已打卡' : skipped ? '已跳过' : '待打卡';
    var actions = [];
    var checkButton;
    var prio = normalizePriority(habit.priority);
    if (done || skipped) {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(habit.id) + '">编辑</button>');
      actions.push('<button class="swipe-action restore" type="button" data-action="reset-habit" data-id="' + escapeHtml(habit.id) + '" data-date="' + escapeHtml(dateKey) + '">重置</button>');
    } else {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(habit.id) + '">编辑</button>');
      actions.push('<button class="swipe-action skip" type="button" data-action="skip-habit-date" data-id="' + escapeHtml(habit.id) + '" data-date="' + escapeHtml(dateKey) + '">跳过</button>');
    }
    checkButton = done
      ? '<span class="date-icon habit-done-icon habit-check-done-' + prio + '">✓</span>'
      : skipped
        ? '<span class="date-icon habit-skip-icon">⊘</span>'
        : '<button class="habit-check small habit-check-' + prio + '" type="button" data-action="check-habit-date" data-id="' + escapeHtml(habit.id) + '" data-date="' + escapeHtml(dateKey) + '" aria-label="打卡习惯"></button>';
    return [
      '<article class="task-row date-habit-row habit-row' + (done ? ' is-done' : skipped ? ' is-skipped' : '') + priorityRowClass(habit.priority) + ' has-swipe-actions" data-swipe-row data-notification-type="habit" data-notification-id="' + escapeHtml(habit.id) + '" data-notification-date="' + escapeHtml(dateKey) + '">',
      '<div class="task-swipe-actions">' + actions.join('') + '</div>',
      '<div class="task-content">',
      checkButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(habit.title || '未命名习惯') + '</div>',
      '<div class="task-meta">' + escapeHtml(areaLabel(habit.area) + ' · 习惯 · ' + statusText) + '</div>',
      '</div>',
      '<span class="type-tag habit-tag">习惯</span>',
      '</div>',
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
    var statusText = done ? '已打卡' : skipped ? '已跳过' : '待打卡';
    var actions = [];
    var checkButton;
    var prio = normalizePriority(habit.priority);
    if (done || skipped) {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(habit.id) + '">编辑</button>');
      actions.push('<button class="swipe-action restore" type="button" data-action="reset-habit" data-id="' + escapeHtml(habit.id) + '" data-date="' + escapeHtml(appState.todayKey) + '">重置</button>');
    } else {
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(habit.id) + '">编辑</button>');
      actions.push('<button class="swipe-action skip" type="button" data-action="skip-habit" data-id="' + escapeHtml(habit.id) + '">跳过</button>');
    }
    checkButton = done
      ? '<span class="date-icon habit-done-icon habit-check-done-' + prio + '">✓</span>'
      : skipped
        ? '<span class="date-icon habit-skip-icon">⊘</span>'
        : '<button class="habit-check small habit-check-' + prio + '" type="button" data-action="check-habit" data-id="' + escapeHtml(habit.id) + '" aria-label="打卡习惯"></button>';
    return [
      '<article class="task-row today-habit-row habit-row' + (done ? ' is-done' : skipped ? ' is-skipped' : '') + priorityRowClass(habit.priority) + ' has-swipe-actions" data-swipe-row data-notification-type="habit" data-notification-id="' + escapeHtml(habit.id) + '" data-notification-date="' + escapeHtml(appState.todayKey) + '">',
      '<div class="task-swipe-actions">' + actions.join('') + '</div>',
      '<div class="task-content">',
      checkButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(habit.title || '未命名习惯') + '</div>',
      '<div class="task-meta">' + escapeHtml(areaLabel(habit.area) + ' · 习惯 · ' + statusText) + '</div>',
      '</div>',
      '<span class="type-tag habit-tag">习惯</span>',
      '</div>',
      '</article>'
    ].join('');
  }

  var journalQuotes = [
    '今天的你，已经很棒了 ✨',
    '专注当下，一步一步来 🌿',
    '小小的坚持，成就大大的改变 💪',
    '完成比完美更重要 🎯',
    '今天也是元气满满的一天 ☀️',
    '行动是最好的开始 🚀',
    '给今天的自己一点肯定 🌟',
    '每一个今天都值得认真对待 📅',
    '做一件让自己开心的小事吧 🎈',
    '保持热爱，奔赴山海 🌊',
    '慢慢来，好戏都在烟火里 🎆',
    '愿你今天比昨天更好一点 🌱'
  ];

  function randomJournalQuote() {
    var idx = Math.floor(Math.random() * journalQuotes.length);
    return journalQuotes[idx];
  }

  function renderToday() {
    var todayDate = DateUtils.fromDateKey(appState.todayKey);
    var todayTasks = State.getTodayTasks(appState.data.tasks, appState.todayKey);
    var dueHabits = appState.data.habits.filter(function(habit) {
      return State.habitDueOn(habit, appState.todayKey);
    });
    var uncheckedHabits = dueHabits.filter(function(habit) {
      var log = State.getHabitLogForDate(appState.data.habitLogs, habit.id, appState.todayKey);
      return !log || (log.state !== 'done' && log.state !== 'skipped');
    });
    var journal = appState.data.journals.find(function(entry) {
      return entry.date === appState.todayKey && String(entry.content || '').trim();
    });

    els.todayTitle.textContent = (todayDate.getMonth() + 1) + '月' + todayDate.getDate() + '日';
    els.todayWeekday.textContent = DateUtils.formatWeekday(appState.todayKey);
    els.todaySummary.textContent = '今天还有 ' + todayTasks.length + ' 件事、' + uncheckedHabits.length + ' 个习惯待打卡';
    els.todayTaskCount.textContent = todayTasks.length;
    els.todayHabitCount.textContent = uncheckedHabits.length;
    els.todayTaskList.innerHTML = todayTasks.length ? todayTasks.map(renderTask).join('') : renderEmpty('今天没有待办。可以点击 + 记录一件事。');
    els.todayHabitList.innerHTML = dueHabits.length ? dueHabits.map(renderHabit).join('') : renderEmpty('还没有需要今天打卡的习惯。');
    if (isJournalEnabled()) {
      els.journalContent.value = journal ? journal.content : randomJournalQuote();
    } else {
      els.journalContent.value = '';
    }
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
      rows.push(renderDateHabit(habit, dateKey));
    });
    if (journal) {
      rows.push('<article class="task-row date-note-row"><div class="task-content"><span class="date-icon journal-icon">记</span><div class="task-main"><div class="task-title">每日一句</div><div class="task-meta">' + escapeHtml(journal.content) + '</div></div></div></article>');
    }

    els.selectedDateTitle.textContent = dateKey;
    els.selectedDateSubtitle.textContent = DateUtils.formatWeekday(dateKey);
    els.selectedDateList.innerHTML = rows.length ? rows.join('') : renderEmpty('这一天还没有安排或记录。');
  }

  function matchesSearch(task) {
    var query = appState.search.trim().toLowerCase();
    if (!query) return true;
    return String(task.title || '').toLowerCase().includes(query) ||
      areaLabel(task.area).toLowerCase().includes(query) ||
      String(task.notes || '').toLowerCase().includes(query);
  }

  function matchesSearchHabit(habit) {
    var query = appState.search.trim().toLowerCase();
    if (!query) return true;
    return String(habit.title || '').toLowerCase().includes(query) ||
      areaLabel(habit.area).toLowerCase().includes(query);
  }

  function listConfig(filter) {
    return {
      all: {
        title: '全部',
        subtitle: '所有未完成的任务和习惯',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        tip: '清单空空如也',
        encouragement: '点击右下角 + 开始记录今天的第一件事吧 ✨'
      },
      inbox: {
        title: '未安排',
        subtitle: '还没定日期的事项',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><rect x="14" y="14" width="20" height="20" rx="3" stroke="currentColor" stroke-width="2"/><path d="M14 22h20" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="28" r="1.5" fill="currentColor"/><circle cx="24" cy="28" r="1.5" fill="currentColor"/><circle cx="29" cy="28" r="1.5" fill="currentColor"/></svg>',
        tip: '想法收集箱',
        encouragement: '想到什么先记下来，不用急着安排时间 💭'
      },
      upcoming: {
        title: '即将到来',
        subtitle: '今天之后的任务，按日期排列',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><circle cx="24" cy="26" r="12" stroke="currentColor" stroke-width="2"/><path d="M24 20v6l4 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        tip: '未来可期',
        encouragement: '暂时没有安排的任务，享受当下的轻松吧 🌿'
      },
      overdue: {
        title: '已过期',
        subtitle: '超过截止日期未完成的任务',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><path d="M24 14v12l7 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        tip: '干得漂亮',
        encouragement: '没有过期任务，你的时间管理做得很棒！🎉'
      },
      completed: {
        title: '已完成',
        subtitle: '最近完成的记录',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><path d="M16 25l6 6 12-14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34" cy="16" r="3" fill="currentColor"/></svg>',
        tip: '成就记录',
        encouragement: '完成的每一件事都值得庆祝，去完成更多吧 🏆'
      },
      deleted: {
        title: '已删除',
        subtitle: '最近删除的任务，可以恢复',
        icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><path d="M18 18l12 12M30 18l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        tip: '回收站',
        encouragement: '这里很干净，不需要的东西都清理掉了 🧹'
      }
    }[filter] || {
      title: '全部',
      subtitle: '所有未完成的任务和习惯',
      icon: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" fill="currentColor" fill-opacity="0.08"/><path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      tip: '清单空空如也',
      encouragement: '点击右下角 + 开始记录吧'
    };
  }

  function getTodayJournal() {
    var journal = appState.data.journals.find(function(entry) {
      return entry.date === appState.todayKey && String(entry.content || '').trim();
    });
    return journal ? String(journal.content).trim() : '';
  }

  function renderListEmpty(filter) {
    var config = listConfig(filter);
    var journalContent = getTodayJournal();
    var html = [];
    html.push('<div class="list-empty-state">');
    html.push('  <div class="empty-icon">' + config.icon + '</div>');
    html.push('  <p class="empty-tip">' + escapeHtml(config.tip) + '</p>');
    html.push('  <p class="empty-encouragement">' + escapeHtml(config.encouragement) + '</p>');
    if (journalContent && isJournalEnabled()) {
      html.push('  <div class="empty-journal">');
      html.push('    <span class="empty-journal-quote">"</span>');
      html.push('    <p class="empty-journal-text">' + escapeHtml(journalContent) + '</p>');
      html.push('    <span class="empty-journal-caption">— 今日一句</span>');
      html.push('  </div>');
    }
    html.push('</div>');
    return html.join('');
  }

  function formatDateLabel(dateKey) {
    if (!dateKey) return '';
    if (dateKey === appState.todayKey) return '今天';
    var tomorrow = DateUtils.toDateKey(DateUtils.addDays(DateUtils.fromDateKey(appState.todayKey), 1));
    if (dateKey === tomorrow) return '明天';
    var parts = String(dateKey).split('-').map(Number);
    return (parts[1]) + '月' + parts[2] + '日';
  }

  function formatListMeta(item) {
    var parts = [];
    if (item.type === 'task') {
      var task = item.data;
      if (!task.date) {
        parts.push('想法收集');
      } else {
        var dateLabel = formatDateLabel(task.date);
        if (task.date < appState.todayKey) {
          parts.push(dateLabel);
        } else if (task.date === appState.todayKey) {
          if (task.startTime) {
            parts.push(task.startTime);
          } else {
            parts.push('今天');
          }
        } else {
          if (task.startTime) {
            parts.push(dateLabel + ' ' + task.startTime);
          } else {
            parts.push(dateLabel);
          }
        }
      }
    } else {
      var habit = item.data;
      parts.push(State.getRepeatLabel(habit));
      var streak = State.calculateHabitStreak(appState.data.habitLogs, habit.id, appState.todayKey);
      if (streak > 0) {
        parts.push('连续' + streak + '天');
      }
    }
    return parts.join('  ');
  }

  function getListItemDateGroup(item) {
    if (item.type === 'task') {
      var task = item.data;
      if (!task.date) return 'inbox';
      if (task.date < appState.todayKey) return 'overdue';
      if (task.date === appState.todayKey) return 'today';
      var tomorrow = DateUtils.toDateKey(DateUtils.addDays(DateUtils.fromDateKey(appState.todayKey), 1));
      if (task.date === tomorrow) return 'tomorrow';
      return 'later';
    } else {
      var habit = item.data;
      var todayDue = State.habitDueOn(habit, appState.todayKey);
      if (todayDue) return 'today';
      return 'habits';
    }
  }

  function isItemCompleted(item) {
    if (item.type === 'task') return item.data.status === 'completed';
    return false;
  }

  function isItemDeleted(item) {
    if (item.type === 'task') return item.data.status === 'deleted';
    return false;
  }

  function isItemOverdue(item) {
    if (item.type === 'task') {
      return item.data.status !== 'completed' && item.data.status !== 'deleted' && item.data.date && item.data.date < appState.todayKey;
    }
    return false;
  }

  function renderListItem(item) {
    var priority = item.data.priority || 'none';
    var isHabit = item.type === 'habit';
    var isCompleted = isItemCompleted(item);
    var isDeleted = isItemDeleted(item);
    var isOverdueItem = isItemOverdue(item);
    var title = State.getTaskDisplayTitle(item.data);
    var meta = formatListMeta(item);
    var actions = [];
    var checkButton = '';
    var typeTag = '';
    var rowClass = '';
    var prio = normalizePriority(priority);

    if (isDeleted) {
      actions.push('<button class="swipe-action restore" type="button" data-action="restore-task" data-id="' + escapeHtml(item.data.id) + '">恢复</button>');
      actions.push('<button class="swipe-action delete" type="button" data-action="purge-task" data-id="' + escapeHtml(item.data.id) + '">彻底删除</button>');
      checkButton = '<span></span>';
      typeTag = '<span class="type-tag task-tag">任务</span>';
      rowClass = 'priority-none';
    } else if (isCompleted) {
      if (isHabit) {
        checkButton = '<span class="date-icon habit-done-icon habit-check-done-' + prio + '">✓</span>';
        actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
        actions.push('<button class="swipe-action restore" type="button" data-action="reset-habit" data-id="' + escapeHtml(item.data.id) + '" data-date="' + escapeHtml(appState.todayKey) + '">重置</button>');
        typeTag = '<span class="type-tag habit-tag">习惯</span>';
      } else {
        checkButton = '<span class="date-icon done-icon">✓</span>';
        actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
        actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(item.data.id) + '">删除</button>');
        typeTag = '<span class="type-tag task-tag">任务</span>';
      }
      rowClass = (isHabit ? '' : '') + priorityRowClass(priority) + (isHabit && isCompleted ? '' : ' is-completed');
    } else if (isHabit) {
      var log = State.getHabitLogForDate(appState.data.habitLogs, item.data.id, appState.todayKey);
      var hDone = log && log.state === 'done';
      var hSkipped = log && log.state === 'skipped';
      if (hDone) {
        checkButton = '<span class="date-icon habit-done-icon habit-check-done-' + prio + '">✓</span>';
      } else if (hSkipped) {
        checkButton = '<span class="date-icon habit-skip-icon">⊘</span>';
      } else {
        checkButton = '<button class="habit-check small habit-check-' + prio + '" type="button" data-action="check-habit" data-id="' + escapeHtml(item.data.id) + '" aria-label="打卡习惯"></button>';
      }
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
      if (hDone || hSkipped) {
        actions.push('<button class="swipe-action restore" type="button" data-action="reset-habit" data-id="' + escapeHtml(item.data.id) + '" data-date="' + escapeHtml(appState.todayKey) + '">重置</button>');
      } else {
        actions.push('<button class="swipe-action skip" type="button" data-action="skip-habit" data-id="' + escapeHtml(item.data.id) + '">跳过</button>');
      }
      typeTag = '<span class="type-tag habit-tag">习惯</span>';
      rowClass = priorityRowClass(priority) + (hDone ? ' is-done' : hSkipped ? ' is-skipped' : '');
    } else {
      checkButton = '<button class="task-check small" type="button" data-action="complete-task" data-id="' + escapeHtml(item.data.id) + '" aria-label="完成任务"></button>';
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
      actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(item.data.id) + '">删除</button>');
      typeTag = '<span class="type-tag task-tag">任务</span>';
      rowClass = priorityRowClass(priority);
    }

    if (isOverdueItem) {
      rowClass += ' is-overdue-row';
    }

    return [
      '<article class="task-row list-task-row' + rowClass + ' has-swipe-actions" data-swipe-row data-type="' + item.type + '" data-id="' + escapeHtml(item.data.id) + '" data-notification-type="' + escapeHtml(item.type) + '" data-notification-id="' + escapeHtml(item.data.id) + '" data-notification-date="' + escapeHtml(isHabit ? appState.todayKey : item.data.date || '') + '">',
      '<div class="task-swipe-actions">' + actions.join('') + '</div>',
      '<div class="task-content">',
      checkButton,
      '<div class="task-main">',
      '<div class="task-title">' + escapeHtml(title) + '</div>',
      '<div class="task-meta">' + escapeHtml(meta) + '</div>',
      '</div>',
      typeTag,
      '</div>',
      '</article>'
    ].join('');
  }

  function renderDateGroupHeader(groupKey, count) {
    var labels = {
      overdue: '已过期',
      inbox: '未安排',
      today: '今天',
      tomorrow: '明天',
      later: '以后',
      habits: '循环习惯'
    };
    var classes = {
      overdue: 'overdue',
      today: 'today'
    };
    return '<div class="list-date-group-header ' + (classes[groupKey] || '') + '">' + (labels[groupKey] || groupKey) + ' · ' + count + '</div>';
  }

  function renderLists() {
    var filter = appState.listFilter;
    var allTasks = State.filterTasksByArea(appState.data.tasks, appState.areaFilter);
    var filteredTasks = allTasks.filter(matchesSearch);
    var filteredHabits = appState.areaFilter === 'all'
      ? appState.data.habits.filter(function(h) { return h.status !== 'archived'; }).filter(matchesSearchHabit)
      : appState.data.habits.filter(function(h) { return h.area === appState.areaFilter && h.status !== 'archived'; }).filter(matchesSearchHabit);

    var allItems = [];
    var overdue = [];
    var inbox = [];
    var upcoming = [];
    var completed = State.getCompletedTasks(filteredTasks);
    var deleted = State.getDeletedTasks(filteredTasks);

    filteredTasks.forEach(function(task) {
      if (task.status === 'completed' || task.status === 'deleted') return;
      var item = { type: 'task', data: task };
      allItems.push(item);
      if (!task.date) {
        inbox.push(item);
      } else if (task.date < appState.todayKey) {
        overdue.push(item);
      } else if (task.date > appState.todayKey) {
        upcoming.push(item);
      }
    });

    filteredHabits.forEach(function(habit) {
      var item = { type: 'habit', data: habit };
      allItems.push(item);
    });

    var upcomingSorted = upcoming.slice().sort(function(a, b) {
      return String(a.data.date).localeCompare(String(b.data.date)) || String(a.data.createdAt || '').localeCompare(String(b.data.createdAt || ''));
    });

    var overdueSorted = overdue.slice().sort(function(a, b) {
      return String(a.data.date).localeCompare(String(b.data.date));
    });

    var groups = {
      all: allItems,
      inbox: inbox,
      upcoming: upcomingSorted,
      overdue: overdueSorted,
      completed: completed.map(function(t) { return { type: 'task', data: t }; }),
      deleted: deleted.map(function(t) { return { type: 'task', data: t }; })
    };

    var config = listConfig(filter);
    var currentGroup = groups[filter] || [];

    els.allCount.textContent = allItems.length;
    els.inboxCount.textContent = inbox.length;
    els.upcomingCount.textContent = upcomingSorted.length;
    els.overdueCount.textContent = overdueSorted.length;
    els.completedCount.textContent = completed.length;
    els.deletedCount.textContent = deleted.length;

    document.querySelectorAll('[data-list-filter]').forEach(function(button) {
      button.classList.toggle('active', button.dataset.listFilter === filter);
    });

    var areaLabelText = appState.areaFilter === 'all' ? '全部' : State.areaLabel(appState.areaFilter);
    els.listAreaLabel.textContent = areaLabelText;
    document.querySelectorAll('[data-area-filter]').forEach(function(button) {
      button.classList.toggle('selected', button.dataset.areaFilter === appState.areaFilter);
    });

    if (filter === 'all') {
      var grouped = {
        overdue: [],
        inbox: [],
        today: [],
        tomorrow: [],
        later: [],
        habits: []
      };
      currentGroup.forEach(function(item) {
        var g = getListItemDateGroup(item);
        grouped[g].push(item);
      });

      var html = [];
      var order = ['overdue', 'inbox', 'today', 'tomorrow', 'later', 'habits'];
      var totalCount = 0;
      var displayed = 0;
      var displayLimit = appState.listDisplayCount;

      order.forEach(function(gKey) {
        var items = grouped[gKey];
        if (!items.length) return;
        totalCount += items.length;
        if (displayed >= displayLimit) return;
        var toShow = Math.min(items.length, displayLimit - displayed);
        var showItems = items.slice(0, toShow);
        displayed += toShow;
        html.push(renderDateGroupHeader(gKey, items.length));
        html.push('<div class="list-task-list">');
        showItems.forEach(function(item) {
          html.push(renderListItem(item));
        });
        html.push('</div>');
      });

      if (html.length === 0) {
        els.listContainer.innerHTML = renderListEmpty(filter);
      } else {
        els.listContainer.innerHTML = html.join('');
      }
      els.listLoadMore.hidden = totalCount <= displayed;
    } else {
      var displayItems = currentGroup.slice(0, appState.listDisplayCount);
      if (displayItems.length === 0) {
        els.listContainer.innerHTML = renderListEmpty(filter);
      } else {
        if (filter === 'overdue') {
          var groupedOverdue = {};
          displayItems.forEach(function(item) {
            var dk = item.data.date;
            if (!groupedOverdue[dk]) groupedOverdue[dk] = [];
            groupedOverdue[dk].push(item);
          });
          var oHtml = [];
          Object.keys(groupedOverdue).sort().forEach(function(dk) {
            oHtml.push(renderDateGroupHeader('overdue', groupedOverdue[dk].length));
            oHtml.push('<div class="list-task-list">');
            groupedOverdue[dk].forEach(function(item) { oHtml.push(renderListItem(item)); });
            oHtml.push('</div>');
          });
          els.listContainer.innerHTML = oHtml.join('');
        } else if (filter === 'upcoming') {
          var groupedUpcoming = {};
          displayItems.forEach(function(item) {
            var dk = item.data.date;
            if (!groupedUpcoming[dk]) groupedUpcoming[dk] = [];
            groupedUpcoming[dk].push(item);
          });
          var uHtml = [];
          Object.keys(groupedUpcoming).sort().forEach(function(dk) {
            var key = dk === appState.todayKey ? 'today' : DateUtils.toDateKey(DateUtils.addDays(DateUtils.fromDateKey(appState.todayKey), 1)) === dk ? 'tomorrow' : 'later';
            uHtml.push(renderDateGroupHeader(key, groupedUpcoming[dk].length));
            uHtml.push('<div class="list-task-list">');
            groupedUpcoming[dk].forEach(function(item) { uHtml.push(renderListItem(item)); });
            uHtml.push('</div>');
          });
          els.listContainer.innerHTML = uHtml.join('');
        } else if (filter === 'inbox') {
          var iHtml = [];
          iHtml.push(renderDateGroupHeader('inbox', displayItems.length));
          iHtml.push('<div class="list-task-list">');
          displayItems.forEach(function(item) { iHtml.push(renderListItem(item)); });
          iHtml.push('</div>');
          els.listContainer.innerHTML = iHtml.join('');
        } else {
          els.listContainer.innerHTML = '<div class="list-task-list">' + displayItems.map(renderListItem).join('') + '</div>';
        }
      }
      els.listLoadMore.hidden = currentGroup.length <= displayItems.length;
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

  var viewTitles = {
    today: { title: '今日', desc: '今天要做什么，一眼看清' },
    calendar: { title: '日历', desc: '按月查看任务和习惯打卡' },
    list: { title: '清单', desc: '统一管理全部任务、未安排、即将到来、已过期和历史记录' },
    profile: { title: '我的', desc: '外观、隐私、本地数据和帮助都放在这里' }
  };

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
    var vt = viewTitles[view] || viewTitles.today;
    var titleEl = document.getElementById('app-header-title');
    var descEl = document.getElementById('app-header-desc');
    if (titleEl) titleEl.textContent = vt.title;
    if (descEl) descEl.textContent = vt.desc;
    if (window.location.hash !== '#' + view) {
      window.location.hash = view;
    }
  }

  function isValidNotificationDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var date = DateUtils.fromDateKey(value);
    return date instanceof Date && Number.isFinite(date.getTime()) && DateUtils.toDateKey(date) === value;
  }

  function handleNotificationClick(data) {
    data = data && typeof data === 'object' ? data : {};
    var hasValidDate = isValidNotificationDate(data.date);
    var targetView = hasValidDate && data.date !== appState.todayKey ? 'calendar' : 'today';
    if (hasValidDate) {
      var targetDate = DateUtils.fromDateKey(data.date);
      appState.selectedDateKey = data.date;
      appState.calendarYear = targetDate.getFullYear();
      appState.calendarMonth = targetDate.getMonth();
    }
    switchView(targetView);
    render();
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        var activeView = document.getElementById('view-' + appState.view);
        if (!activeView) return;
        var entity = Array.prototype.find.call(
          activeView.querySelectorAll('[data-notification-type][data-notification-id][data-notification-date]'),
          function(row) {
            return row.dataset.notificationType === data.type
              && row.dataset.notificationId === data.id
              && (!hasValidDate || row.dataset.notificationDate === data.date);
          }
        );
        if (!entity) {
          if (targetView === 'calendar') {
            switchView('today');
            render();
          }
          return;
        }
        entity.scrollIntoView({ block: 'center', behavior: 'smooth' });
        entity.classList.add('notification-highlight');
        setTimeout(function() {
          entity.classList.remove('notification-highlight');
        }, 1800);
      });
    });
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
    if (targetId === 'quick-time-mode') updateQuickTimeFields();
    if (targetId === 'quick-repeat' && value !== 'custom') {
      appState.customRepeat = null;
      if (els.quickRepeatCustomHint) {
        els.quickRepeatCustomHint.hidden = true;
        els.quickRepeatCustomHint.textContent = '';
      }
    }
    if (targetId === 'quick-reminder' && value !== 'custom') {
      appState.customReminder = null;
    }
    closeSelectMenus();
  }

  function formatTimeDisplay(value) {
    if (!value) return '--:--';
    return value;
  }

  function updateTimeDisplay() {
    var startVal = els.quickStartTime ? els.quickStartTime.value : '';
    var endVal = els.quickEndTime ? els.quickEndTime.value : '';
    if (els.quickStartTimeText) els.quickStartTimeText.textContent = formatTimeDisplay(startVal);
    if (els.quickEndTimeText) els.quickEndTimeText.textContent = formatTimeDisplay(endVal);
    if (els.quickStartTimeBtn) els.quickStartTimeBtn.classList.toggle('has-value', Boolean(startVal));
    if (els.quickEndTimeBtn) els.quickEndTimeBtn.classList.toggle('has-value', Boolean(endVal));
  }

  function updateQuickTimeFields() {
    var mode = els.quickTimeMode ? els.quickTimeMode.value : 'all-day';
    var showTime = mode === 'point' || mode === 'range';
    if (els.quickTimeInputs) els.quickTimeInputs.hidden = !showTime;
    if (els.quickEndTimeBtn) els.quickEndTimeBtn.hidden = mode !== 'range';
    if (els.quickEndTime) els.quickEndTime.hidden = mode !== 'range';
    if (els.quickTimeHint) {
      els.quickTimeHint.textContent = mode === 'all-day'
        ? '全天事项只显示在当天，不设置具体时刻。'
        : mode === 'point'
          ? '会在日历里显示为具体时间点。'
          : '适合课程、会议、运动等有起止时间的安排。';
    }
    updateTimeDisplay();
  }

  function updateScheduledOptionFields() {
    var isScheduled = Boolean(els.quickDate && els.quickDate.value);
    if (els.quickTimeField) els.quickTimeField.hidden = !isScheduled;
    if (els.quickRepeatField) els.quickRepeatField.hidden = !isScheduled;
    if (els.quickReminderField) els.quickReminderField.hidden = !isScheduled;
    if (!isScheduled) {
      if (els.quickTimeMode) setChoiceValue('quick-time-mode', 'all-day');
      if (els.quickRepeat) {
        setChoiceValue('quick-repeat', 'none');
        appState.customRepeat = null;
        if (els.quickRepeatCustomHint) {
          els.quickRepeatCustomHint.hidden = true;
          els.quickRepeatCustomHint.textContent = '';
        }
      }
      if (els.quickReminder) {
        setChoiceValue('quick-reminder', 'none');
        appState.customReminder = null;
      }
      if (els.quickStartTime) els.quickStartTime.value = '';
      if (els.quickEndTime) els.quickEndTime.value = '';
      updateTimeDisplay();
    }
  }

  function setQuickDate(dateKey, mode) {
    var normalizedDate = dateKey || '';
    var activeMode = mode;
    if (!activeMode) {
      activeMode = !normalizedDate ? 'pending' : normalizedDate === appState.todayKey ? 'today' : normalizedDate === tomorrowKey() ? 'tomorrow' : normalizedDate === weekendKey() ? 'weekend' : 'custom';
    }
    els.quickDate.value = dateKey || '';
    if (els.quickDatePicker) els.quickDatePicker.value = activeMode === 'custom' ? normalizedDate : '';
    if (els.quickDateField) els.quickDateField.classList.toggle('is-custom-date', activeMode === 'custom');
    document.querySelectorAll('[data-date-preset]').forEach(function(button) {
      button.classList.toggle('active', button.dataset.datePreset === activeMode);
      button.classList.remove('has-date');
      if (button.dataset.datePreset === 'custom' && activeMode === 'custom' && normalizedDate) {
        var parts = normalizedDate.split('-').map(Number);
        button.textContent = (parts[1]) + '月' + parts[2] + '日';
        button.classList.add('has-date');
      } else if (button.dataset.datePreset === 'custom') {
        button.textContent = '自定义';
      }
    });
    updateScheduledOptionFields();
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

  function isJournalEnabled() {
    return localStorage.getItem('today-youxu-journal-enabled') !== '0';
  }

  function applyJournalEnabled(enabled) {
    if (els.journalSection) els.journalSection.hidden = !enabled;
    if (els.journalEnabledToggle) {
      els.journalEnabledToggle.checked = enabled;
      els.journalEnabledToggle.setAttribute('aria-checked', String(enabled));
    }
    localStorage.setItem('today-youxu-journal-enabled', enabled ? '1' : '0');
  }

  function openSheet() {
    appState.editingTaskId = '';
    appState.editingType = '';
    appState.customRepeat = null;
    appState.customReminder = null;
    $('quick-sheet-title').textContent = '新增事项';
    els.quickEditId.value = '';
    setChoiceValue('quick-priority', 'medium');
    setChoiceValue('quick-area', 'life');
    setChoiceValue('quick-repeat', 'none');
    setChoiceValue('quick-time-mode', 'all-day');
    setChoiceValue('quick-reminder', 'none');
    els.quickStartTime.value = '';
    els.quickEndTime.value = '';
    updateTimeDisplay();
    if (els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = true;
      els.quickRepeatCustomHint.textContent = '';
    }
    setQuickDate(appState.todayKey, 'today');
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickTitle.focus();
  }

  function closeSheet() {
    els.sheetBackdrop.hidden = true;
    els.quickSheet.hidden = true;
    els.quickForm.reset();
    appState.customRepeat = null;
    appState.customReminder = null;
    closePicker();
    setChoiceValue('quick-priority', 'medium');
    setChoiceValue('quick-area', 'life');
    setChoiceValue('quick-repeat', 'none');
    setChoiceValue('quick-time-mode', 'all-day');
    setChoiceValue('quick-reminder', 'none');
    els.quickStartTime.value = '';
    els.quickEndTime.value = '';
    updateTimeDisplay();
    if (els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = true;
      els.quickRepeatCustomHint.textContent = '';
    }
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
    appState.editingTaskId = '';
    appState.editingType = '';
  }

  function rescheduleNotifications() {
    if (!NotificationService) return;
    DB.getAllData().then(function(data) {
      appState.data = data;
      showMissedReminderToast(data);
      NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
      syncNotificationsWithoutBlocking(data);
    }).catch(function() {});
  }

  window.TodayYouxuReschedule = rescheduleNotifications;

  function loadData() {
    return DB.getAllData().then(function(data) {
      appState.data = data;
      render();
      updateNotificationUI();
      if (NotificationService) {
        showMissedReminderToast(data);
        NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
      }
      syncNotificationsWithoutBlocking(data);
    }).catch(function(error) {
      showToast('本地数据库读取失败：' + error.message);
    });
  }

  function handleQuickSubmit(event) {
    event.preventDefault();
    var title = els.quickTitle.value.trim();
    if (!title) {
      showToast('请输入标题');
      return;
    }

    var repeat = els.quickRepeat.value || 'none';
    var reminder = els.quickReminder.value || 'none';
    var payload = {
      title: title,
      notes: els.quickNotes.value,
      date: els.quickDate.value,
      priority: els.quickPriority.value,
      area: els.quickArea.value || 'life',
      timeMode: els.quickTimeMode.value || 'all-day',
      startTime: els.quickStartTime.value,
      endTime: els.quickTimeMode.value === 'range' ? els.quickEndTime.value : '',
      reminder: reminder
    };
    if (repeat === 'custom' && appState.customRepeat) {
      payload.customRepeat = appState.customRepeat;
    }
    if (reminder === 'custom' && appState.customReminder) {
      payload.customReminder = appState.customReminder;
    }
    var action;
    var wasEditing = Boolean(appState.editingTaskId);
    if (wasEditing && appState.editingType === 'habit') {
      var habitPayload = {
        title: title,
        notes: els.quickNotes.value,
        area: els.quickArea.value || 'life',
        priority: els.quickPriority.value,
        reminder: reminder,
        timeMode: els.quickTimeMode.value || 'all-day',
        startTime: els.quickStartTime.value || '',
        endTime: els.quickTimeMode.value === 'range' ? (els.quickEndTime.value || '') : ''
      };
      if (reminder === 'custom' && appState.customReminder) {
        habitPayload.customReminder = appState.customReminder;
      }
      if (repeat !== 'none') {
        habitPayload.schedule = repeat;
        habitPayload.customRepeat = repeat === 'custom' ? appState.customRepeat : null;
      }
      action = DB.updateHabit(appState.editingTaskId, habitPayload);
    } else if (wasEditing) {
      if (repeat !== 'none') {
        var habitCreateData = Object.assign({}, payload, {
          schedule: repeat,
          customRepeat: repeat === 'custom' ? appState.customRepeat : null,
          startDate: payload.date,
          weekday: payload.date ? DateUtils.fromDateKey(payload.date).getDay() : DateUtils.fromDateKey(appState.todayKey).getDay()
        });
        var convertingTaskId = appState.editingTaskId;
        action = DB.createHabit(habitCreateData).then(function() {
          return DB.purgeTask(convertingTaskId);
        });
      } else {
        action = DB.updateTask(appState.editingTaskId, payload);
      }
    } else {
      action = repeat === 'none'
        ? DB.createTask(payload)
        : DB.createHabit(Object.assign({}, payload, {
          schedule: repeat,
          customRepeat: repeat === 'custom' ? appState.customRepeat : null,
          startDate: payload.date,
          weekday: payload.date ? DateUtils.fromDateKey(payload.date).getDay() : DateUtils.fromDateKey(appState.todayKey).getDay()
        }));
    }

    action.then(function() {
      closeSheet();
      showToast(wasEditing ? '事项已更新' : '事项已创建');
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
    if (!isJournalEnabled()) return;
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
    closeListFilterMenu();

    if (action === 'save-journal') {
      event.preventDefault();
      saveJournal();
    } else if (action === 'edit-task') {
      openEditTask(id);
    } else if (action === 'edit-habit') {
      openEditHabit(id);
    } else if (action === 'complete-task') {
      DB.completeTask(id).then(loadData).then(function() { showToast('任务已完成'); });
    } else if (action === 'uncomplete-task') {
      DB.uncompleteTask(id).then(loadData).then(function() { showToast('已恢复为待办'); });
    } else if (action === 'delete-task') {
      if (window.confirm('确定删除此任务吗？')) {
        DB.deleteTask(id).then(loadData).then(function() { showToast('任务已删除'); });
      }
    } else if (action === 'restore-task') {
      DB.restoreTask(id).then(loadData).then(function() { showToast('任务已恢复'); });
    } else if (action === 'purge-task') {
      if (window.confirm('彻底删除后无法恢复，确定吗？')) {
        DB.purgeTask(id).then(loadData).then(function() { showToast('已彻底删除'); });
      }
    } else if (action === 'check-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'done').then(loadData).then(function() { showToast('打卡完成'); });
    } else if (action === 'skip-habit') {
      DB.upsertHabitLog(id, appState.todayKey, 'skipped').then(loadData).then(function() { showToast('已跳过'); });
    } else if (action === 'check-habit-date') {
      var date = target.dataset.date || appState.todayKey;
      DB.upsertHabitLog(id, date, 'done').then(loadData).then(function() { showToast('打卡完成'); });
    } else if (action === 'skip-habit-date') {
      var date = target.dataset.date || appState.todayKey;
      DB.upsertHabitLog(id, date, 'skipped').then(loadData).then(function() { showToast('已跳过'); });
    } else if (action === 'reset-habit') {
      var date = target.dataset.date || appState.todayKey;
      DB.resetHabitLog(id, date).then(loadData).then(function() { showToast('已重置'); });
    } else if (action === 'select-date') {
      appState.selectedDateKey = target.dataset.date;
      renderCalendar();
    } else if (action === 'notification-setup') {
      handleNotificationAction();
    } else if (action === 'notification-disable') {
      handleNotificationDisable();
    }
  }

  function openEditTask(id) {
    var task = appState.data.tasks.find(function(item) { return item.id === id; });
    if (!task) {
      showToast('没有找到这条任务');
      return;
    }
    appState.editingTaskId = id;
    appState.editingType = 'task';
    appState.customRepeat = task.customRepeat || null;
    appState.customReminder = task.customReminder || null;
    $('quick-sheet-title').textContent = '编辑事项';
    els.quickEditId.value = id;
    els.quickTitle.value = task.title || '';
    setChoiceValue('quick-priority', normalizePriority(task.priority));
    setChoiceValue('quick-area', State.normalizeArea ? State.normalizeArea(task.area) : 'life');
    setChoiceValue('quick-repeat', 'none');
    setChoiceValue('quick-time-mode', task.timeMode || 'all-day');
    var reminderVal = task.reminder || 'none';
    setChoiceValue('quick-reminder', reminderVal);
    if (reminderVal === 'custom' && task.customReminder) {
      document.querySelectorAll('[data-choice-target="quick-reminder"]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.choiceValue === 'custom');
      });
    }
    els.quickStartTime.value = task.startTime || '';
    els.quickEndTime.value = task.endTime || '';
    els.quickNotes.value = task.notes || '';
    updateTimeDisplay();
    if (els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = true;
      els.quickRepeatCustomHint.textContent = '';
    }
    setQuickDate(task.date || '');
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickTitle.focus();
  }

  function openEditHabit(id) {
    var habit = appState.data.habits.find(function(item) { return item.id === id; });
    if (!habit) {
      showToast('没有找到这个习惯');
      return;
    }
    appState.editingTaskId = id;
    appState.editingType = 'habit';
    appState.customRepeat = habit.customRepeat || null;
    appState.customReminder = habit.customReminder || null;
    $('quick-sheet-title').textContent = '编辑习惯';
    els.quickEditId.value = id;
    els.quickTitle.value = habit.title || '';
    setChoiceValue('quick-priority', normalizePriority(habit.priority));
    setChoiceValue('quick-area', State.normalizeArea ? State.normalizeArea(habit.area) : 'life');
    var scheduleVal = habit.schedule || 'daily';
    var chipSchedules = ['none', 'daily', 'weekly', 'custom'];
    if (chipSchedules.indexOf(scheduleVal) >= 0) {
      setChoiceValue('quick-repeat', scheduleVal);
    } else {
      document.querySelectorAll('[data-choice-target="quick-repeat"]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.choiceValue === 'custom');
      });
      els.quickRepeat.value = scheduleVal;
      if (!appState.customRepeat) {
        if (scheduleVal === 'weekdays') {
          appState.customRepeat = { interval: 1, unit: 'day', skipWeekends: true, skipHolidays: false };
        } else if (scheduleVal === 'monthly') {
          appState.customRepeat = { interval: 1, unit: 'month', skipWeekends: false, skipHolidays: false };
        }
      }
      if (els.quickRepeatCustomHint) {
        els.quickRepeatCustomHint.hidden = false;
        els.quickRepeatCustomHint.textContent = formatRepeatLabel(scheduleVal, appState.customRepeat);
      }
    }
    var habitTimeMode = habit.timeMode || 'all-day';
    setChoiceValue('quick-time-mode', habitTimeMode);
    var reminderVal = habit.reminder || 'none';
    setChoiceValue('quick-reminder', reminderVal);
    if (reminderVal === 'custom' && habit.customReminder) {
      document.querySelectorAll('[data-choice-target="quick-reminder"]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.choiceValue === 'custom');
      });
    }
    els.quickStartTime.value = habit.startTime || '';
    els.quickEndTime.value = habit.endTime || '';
    els.quickNotes.value = habit.notes || '';
    updateTimeDisplay();
    if (scheduleVal === 'custom' && habit.customRepeat && els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = false;
      els.quickRepeatCustomHint.textContent = formatRepeatLabel('custom', habit.customRepeat);
    }
    setQuickDate(habit.startDate || appState.todayKey);
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
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

  function getNotificationStatusInfo() {
    var status = notificationBackendStatus.status;
    var permission = NotificationService ? NotificationService.getPermissionStatus() : 'unsupported';
    if (!NotificationService || !NotificationSyncFactory || permission === 'unsupported') status = 'unsupported';
    else if (permission === 'denied') status = 'error';
    else if (permission === 'default' && status !== 'subscribing' && status !== 'error') status = 'permission-required';
    else if (!NOTIFICATION_STATUS_COPY[status]) status = 'error';
    return {
      status: status,
      label: NOTIFICATION_STATUS_COPY[status],
      desc: NOTIFICATION_STATUS_COPY[status]
    };
  }

  function updateNotificationUI() {
    if (!els.notificationStatus) return;
    var info = getNotificationStatusInfo();
    els.notificationStatus.textContent = info.label;
    els.notificationStatus.className = 'mode-pill notification-status-' + info.status;
    if (els.notificationDesc) els.notificationDesc.textContent = info.desc;
    if (els.notificationButton) {
      if (info.status === 'unsupported') {
        els.notificationButton.hidden = true;
        els.notificationButton.disabled = false;
      } else {
        els.notificationButton.hidden = false;
        els.notificationButton.disabled = info.status === 'subscribing' || info.status === 'syncing';
        if (info.status === 'ready') els.notificationButton.textContent = '测试提醒';
        else if (info.status === 'permission-required' || info.status === 'error') els.notificationButton.textContent = '授权通知';
        else els.notificationButton.textContent = '开启提醒';
      }
    }
    if (els.notificationDisableButton) {
      els.notificationDisableButton.hidden = info.status !== 'ready';
      els.notificationDisableButton.disabled = info.status !== 'ready';
    }
    if (els.quickReminderHint) {
      if (info.status === 'ready') {
        els.quickReminderHint.textContent = '授权后，到达提醒时间会弹出系统通知。';
      } else {
        els.quickReminderHint.textContent = '请在「我的」页面授权通知权限后生效。';
      }
    }
  }

  async function handleNotificationAction() {
    if (!NotificationService) return;
    try {
      if (notificationSetupPromise) await notificationSetupPromise;
      if (!NotificationSync) return;
      var info = getNotificationStatusInfo();
      if (info.status === 'ready') {
        setNotificationBackendStatus({ status: 'syncing' });
        setNotificationBackendStatus(await NotificationSync.sendTest());
        return;
      }
      var permission = window.Notification && window.Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setNotificationBackendStatus({ status: permission === 'denied' ? 'error' : 'permission-required' });
          showToast(permission === 'denied' ? '通知权限被拒绝' : '未开启通知权限');
          return;
        }
      }
      NotificationService.setEnabled(true);
      NotificationService.scheduleAll(appState.data, appState.todayKey, State.habitDueOn);
      setNotificationBackendStatus({ status: 'subscribing' });
      var enabledStatus = await NotificationSync.enable();
      setNotificationBackendStatus(enabledStatus);
      if (enabledStatus.status !== 'ready') return;
      var syncedStatus = await queueNotificationSync(appState.data);
      if (syncedStatus.status === 'ready') {
        setNotificationBackendStatus(await NotificationSync.sendTest());
      }
    } catch (error) {
      handleNotificationBackendFailure(error);
    }
  }

  async function handleNotificationDisable() {
    if (!NotificationService) return;
    try {
      if (notificationSetupPromise) await notificationSetupPromise;
      if (!NotificationSync || getNotificationStatusInfo().status !== 'ready') return;
      NotificationService.setEnabled(false);
      setNotificationBackendStatus({ status: 'pending' });
      setNotificationBackendStatus(await NotificationSync.disable());
    } catch (error) {
      handleNotificationBackendFailure(error);
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

  function formatRepeatLabel(repeatValue, customRepeat) {
    if (repeatValue === 'none') return '不重复';
    if (repeatValue === 'daily') return '每天';
    if (repeatValue === 'weekdays') return '工作日';
    if (repeatValue === 'weekends') return '周末';
    if (repeatValue === 'weekly') return '每周';
    if (repeatValue === 'monthly') return '每月';
    if (repeatValue === 'custom' && customRepeat) {
      var interval = customRepeat.interval || 1;
      var unit = customRepeat.unit || 'day';
      var unitLabel = { day: '天', week: '周', month: '月' }[unit] || '天';
      var skipHolidays = customRepeat.skipHolidays ? '，跳过节假日' : '';
      var skipWeekends = customRepeat.skipWeekends ? '，跳过双休日' : '';
      return '每' + interval + unitLabel + '重复' + skipHolidays + skipWeekends;
    }
    return '不重复';
  }

  function formatReminderLabel(reminderValue, customReminder) {
    if (reminderValue === 'none') return '不提醒';
    if (reminderValue === 'at-time') return '准时';
    if (reminderValue === '5') return '5分钟前';
    if (reminderValue === '15') return '15分钟前';
    if (reminderValue === '30') return '30分钟前';
    if (reminderValue === '60') return '1小时前';
    if (reminderValue === 'custom' && customReminder) {
      var d = customReminder.days || 0;
      var h = customReminder.hours || 0;
      var m = customReminder.minutes || 0;
      var parts = [];
      if (d > 0) parts.push(d + '天');
      if (h > 0) parts.push(h + '小时');
      if (m > 0) parts.push(m + '分钟');
      return '提前' + parts.join('');
    }
    return '不提醒';
  }

  function createPickerWheel(options, selectedIndex, columnClass) {
    var itemHeight = 40;
    var visibleCount = 5;
    var container = document.createElement('div');
    container.className = 'picker-wheel ' + (columnClass || '');
    container.style.height = (itemHeight * visibleCount) + 'px';

    var highlight = document.createElement('div');
    highlight.className = 'picker-wheel-highlight';
    container.appendChild(highlight);

    var list = document.createElement('div');
    list.className = 'picker-wheel-list';
    list.style.transform = 'translateY(0)';

    var paddingTop = document.createElement('div');
    paddingTop.style.height = (itemHeight * 2) + 'px';
    list.appendChild(paddingTop);

    options.forEach(function(opt, idx) {
      var item = document.createElement('div');
      item.className = 'picker-wheel-item' + (idx === selectedIndex ? ' selected' : '');
      item.style.height = itemHeight + 'px';
      item.style.lineHeight = itemHeight + 'px';
      item.textContent = opt.label;
      item.dataset.index = idx;
      list.appendChild(item);
    });

    var paddingBottom = document.createElement('div');
    paddingBottom.style.height = (itemHeight * 2) + 'px';
    list.appendChild(paddingBottom);

    container.appendChild(list);

    var currentIndex = selectedIndex;
    var startY = 0;
    var startOffset = 0;
    var currentOffset = -selectedIndex * itemHeight;
    var isDragging = false;
    list.style.transform = 'translateY(' + currentOffset + 'px)';

    function updatePosition(offset, animate) {
      list.style.transition = animate ? 'transform 200ms ease-out' : 'none';
      list.style.transform = 'translateY(' + offset + 'px)';
      currentOffset = offset;
      var idx = Math.round(-offset / itemHeight);
      idx = Math.max(0, Math.min(options.length - 1, idx));
      if (idx !== currentIndex) {
        var items = list.querySelectorAll('.picker-wheel-item');
        items.forEach(function(el) { el.classList.remove('selected'); });
        if (items[idx]) items[idx].classList.add('selected');
        currentIndex = idx;
      }
    }

    function snapToIndex(idx) {
      var clampedIdx = Math.max(0, Math.min(options.length - 1, idx));
      var offset = -clampedIdx * itemHeight;
      updatePosition(offset, true);
    }

    container.addEventListener('touchstart', function(e) {
      isDragging = true;
      startY = e.touches[0].clientY;
      startOffset = currentOffset;
      list.style.transition = 'none';
    }, { passive: true });

    container.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      e.stopPropagation();
      var deltaY = e.touches[0].clientY - startY;
      var newOffset = startOffset + deltaY;
      var minOffset = -(options.length - 1) * itemHeight;
      var maxOffset = 0;
      if (newOffset > maxOffset + 40) newOffset = maxOffset + (newOffset - maxOffset) * 0.3;
      if (newOffset < minOffset - 40) newOffset = minOffset + (newOffset - minOffset) * 0.3;
      updatePosition(newOffset, false);
    }, { passive: true });

    container.addEventListener('touchend', function() {
      if (!isDragging) return;
      isDragging = false;
      var idx = Math.round(-currentOffset / itemHeight);
      snapToIndex(idx);
    });

    container.addEventListener('mousedown', function(e) {
      isDragging = true;
      startY = e.clientY;
      startOffset = currentOffset;
      list.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      var deltaY = e.clientY - startY;
      var newOffset = startOffset + deltaY;
      var minOffset = -(options.length - 1) * itemHeight;
      var maxOffset = 0;
      if (newOffset > maxOffset + 40) newOffset = maxOffset + (newOffset - maxOffset) * 0.3;
      if (newOffset < minOffset - 40) newOffset = minOffset + (newOffset - minOffset) * 0.3;
      updatePosition(newOffset, false);
    });

    document.addEventListener('mouseup', function() {
      if (!isDragging) return;
      isDragging = false;
      var idx = Math.round(-currentOffset / itemHeight);
      snapToIndex(idx);
    });

    container.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 1 : -1;
      snapToIndex(currentIndex + delta);
    }, { passive: false });

    list.addEventListener('click', function(e) {
      var item = e.target.closest('.picker-wheel-item');
      if (!item) return;
      var idx = parseInt(item.dataset.index, 10);
      if (!isNaN(idx)) snapToIndex(idx);
    });

    return {
      el: container,
      getValue: function() { return options[currentIndex].value; },
      getIndex: function() { return currentIndex; },
      setIndex: function(idx) { snapToIndex(idx); }
    };
  }

  function openRepeatPicker() {
    var existing = appState.customRepeat || { interval: 1, unit: 'day', skipHolidays: false, skipWeekends: false };
    var intervalOptions = [];
    for (var i = 1; i <= 30; i++) {
      intervalOptions.push({ label: '每' + i, value: i });
    }
    var unitOptions = [
      { label: '天重复', value: 'day' },
      { label: '周重复', value: 'week' },
      { label: '月重复', value: 'month' }
    ];

    var body = els.pickerBody;
    body.innerHTML = '';
    body.className = 'picker-body repeat-picker';

    var intervalWheel = createPickerWheel(intervalOptions, existing.interval - 1, 'picker-col-interval');
    var unitWheel = createPickerWheel(unitOptions, ['day', 'week', 'month'].indexOf(existing.unit), 'picker-col-unit');

    var wheelsRow = document.createElement('div');
    wheelsRow.className = 'picker-wheels-row';
    wheelsRow.appendChild(intervalWheel.el);
    wheelsRow.appendChild(unitWheel.el);
    body.appendChild(wheelsRow);

    var toggleRow = document.createElement('div');
    toggleRow.className = 'picker-toggles';
    toggleRow.innerHTML =
      '<label class="picker-toggle"><input type="checkbox" id="picker-skip-holidays"' + (existing.skipHolidays ? ' checked' : '') + '><span>跳过法定节假日</span></label>' +
      '<label class="picker-toggle"><input type="checkbox" id="picker-skip-weekends"' + (existing.skipWeekends ? ' checked' : '') + '><span>跳过双休日</span></label>';
    body.appendChild(toggleRow);

    els.pickerTitle.textContent = '自定义重复';
    if (els.pickerFooterHint) els.pickerFooterHint.hidden = true;
    els.pickerBackdrop.hidden = false;
    els.pickerSheet.hidden = false;

    appState.pickerState = {
      type: 'repeat',
      wheels: { interval: intervalWheel, unit: unitWheel }
    };
  }

  function openReminderPicker() {
    var existing = appState.customReminder || { days: 0, hours: 0, minutes: 5 };
    var dayOptions = [{ label: '0天', value: 0 }];
    for (var d = 1; d <= 7; d++) {
      dayOptions.push({ label: d + '天', value: d });
    }
    var hourOptions = [];
    for (var h = 0; h <= 23; h++) {
      hourOptions.push({ label: h + '小时', value: h });
    }
    var minuteOptions = [];
    for (var m = 0; m <= 59; m++) {
      minuteOptions.push({ label: m + '分钟', value: m });
    }

    var body = els.pickerBody;
    body.innerHTML = '';
    body.className = 'picker-body reminder-picker';

    var dayWheel = createPickerWheel(dayOptions, existing.days, 'picker-col-days');
    var hourWheel = createPickerWheel(hourOptions, existing.hours, 'picker-col-hours');
    var minuteWheel = createPickerWheel(minuteOptions, existing.minutes, 'picker-col-minutes');

    var wheelsRow = document.createElement('div');
    wheelsRow.className = 'picker-wheels-row three-cols';
    wheelsRow.appendChild(dayWheel.el);
    wheelsRow.appendChild(hourWheel.el);
    wheelsRow.appendChild(minuteWheel.el);
    body.appendChild(wheelsRow);

    els.pickerTitle.textContent = '自定义提醒';
    if (els.pickerFooterHint) {
      els.pickerFooterHint.hidden = false;
      els.pickerFooterHint.textContent = '';
    }
    els.pickerBackdrop.hidden = false;
    els.pickerSheet.hidden = false;

    appState.pickerState = {
      type: 'reminder',
      wheels: { days: dayWheel, hours: hourWheel, minutes: minuteWheel }
    };

    function checkReminderValidity() {
      if (!appState.pickerState || appState.pickerState.type !== 'reminder') return;
      var d = dayWheel.getValue();
      var h = hourWheel.getValue();
      var m = minuteWheel.getValue();
      if (els.pickerFooterHint) {
        if (d === 0 && h === 0 && m === 0) {
          els.pickerFooterHint.textContent = '提醒时间已过期，无法提醒';
          els.pickerFooterHint.classList.add('is-warning');
        } else {
          els.pickerFooterHint.textContent = '提前 ' + (d > 0 ? d + '天 ' : '') + (h > 0 ? h + '小时 ' : '') + m + '分钟 提醒';
          els.pickerFooterHint.classList.remove('is-warning');
        }
      }
    }
    function wrapWheel(wheel) {
      var oldSetIndex = wheel.setIndex;
      wheel.setIndex = function(idx) {
        oldSetIndex.call(wheel, idx);
        checkReminderValidity();
      };
    }
    wrapWheel(dayWheel);
    wrapWheel(hourWheel);
    wrapWheel(minuteWheel);
    checkReminderValidity();
  }

  function closePicker() {
    if (els.pickerBackdrop) els.pickerBackdrop.hidden = true;
    if (els.pickerSheet) els.pickerSheet.hidden = true;
    if (els.calPickerSheet) els.calPickerSheet.hidden = true;
    appState.pickerState = null;
    appState.calPicker = null;
  }

  function confirmPicker() {
    if (!appState.pickerState) return;
    var state = appState.pickerState;
    if (state.type === 'repeat') {
      var interval = state.wheels.interval.getValue();
      var unit = state.wheels.unit.getValue();
      var skipHolidays = document.getElementById('picker-skip-holidays');
      var skipWeekends = document.getElementById('picker-skip-weekends');
      appState.customRepeat = {
        interval: interval,
        unit: unit,
        skipHolidays: skipHolidays ? skipHolidays.checked : false,
        skipWeekends: skipWeekends ? skipWeekends.checked : false
      };
      setChoiceValue('quick-repeat', 'custom');
      if (els.quickRepeatCustomHint) {
        els.quickRepeatCustomHint.hidden = false;
        els.quickRepeatCustomHint.textContent = formatRepeatLabel('custom', appState.customRepeat);
      }
      document.querySelectorAll('[data-choice-target="quick-repeat"]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.choiceValue === 'custom');
      });
    } else if (state.type === 'reminder') {
      var d = state.wheels.days.getValue();
      var h = state.wheels.hours.getValue();
      var minutes = state.wheels.minutes.getValue();
      if (d === 0 && h === 0 && minutes === 0) {
        showToast('提醒时间不能为0');
        return;
      }
      appState.customReminder = { days: d, hours: h, minutes: minutes };
      setChoiceValue('quick-reminder', 'custom');
      document.querySelectorAll('[data-choice-target="quick-reminder"]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.choiceValue === 'custom');
      });
    } else if (state.type === 'time') {
      var selHour = state.wheels.hours.getValue();
      var selMinute = state.wheels.minutes.getValue();
      var timeStr = String(selHour).padStart(2, '0') + ':' + String(selMinute).padStart(2, '0');
      if (state.target === 'end') {
        els.quickEndTime.value = timeStr;
        var startVal = els.quickStartTime.value;
        if (startVal && timeStr <= startVal) {
          showToast('结束时间需晚于开始时间');
          return;
        }
      } else {
        els.quickStartTime.value = timeStr;
        if (els.quickTimeMode.value === 'all-day') {
          setChoiceValue('quick-time-mode', 'point');
        }
        if (els.quickTimeMode.value === 'range' && !els.quickEndTime.value) {
          var endH = selHour + 1;
          var endM = selMinute;
          if (endH > 23) { endH = 23; endM = 59; }
          els.quickEndTime.value = String(endH).padStart(2, '0') + ':' + String(endM).padStart(2, '0');
        }
      }
      updateTimeDisplay();
    }
    closePicker();
  }

  function closeCalPicker() {
    if (els.calPickerSheet) els.calPickerSheet.hidden = true;
    appState.calPicker = null;
    if (!appState.pickerState) {
      if (els.pickerBackdrop) els.pickerBackdrop.hidden = true;
    }
  }

  function openCalendarPicker() {
    var currentDate = els.quickDate.value || appState.todayKey;
    var parts = currentDate.split('-').map(Number);
    var initYear = parts[0] && parts[0] > 2000 ? parts[0] : new Date().getFullYear();
    var initMonth = parts[1] ? parts[1] - 1 : new Date().getMonth();

    appState.calPicker = {
      year: initYear,
      month: initMonth,
      selectedKey: els.quickDate.value || appState.todayKey,
      tempKey: els.quickDate.value || appState.todayKey
    };

    renderCalPicker();

    if (els.pickerBackdrop) els.pickerBackdrop.hidden = false;
    if (els.calPickerSheet) els.calPickerSheet.hidden = false;
    if (els.pickerSheet) els.pickerSheet.hidden = true;
  }

  function renderCalPicker() {
    if (!appState.calPicker) return;
    var cp = appState.calPicker;
    var grid = DateUtils.buildMonthGrid(cp.year, cp.month);

    if (els.calPickerMonthLabel) {
      els.calPickerMonthLabel.textContent = DateUtils.formatMonthLabel(cp.year, cp.month);
    }

    if (els.calPickerGrid) {
      els.calPickerGrid.innerHTML = grid.map(function(cell) {
        var classes = ['cal-day-cell'];
        if (!cell.isCurrentMonth) classes.push('outside');
        if (cell.isToday) classes.push('today');
        if (cell.dateKey === cp.tempKey) classes.push('selected');
        return '<button class="' + classes.join(' ') + '" type="button" data-action="cal-select-day" data-date="' + cell.dateKey + '">' + cell.day + '</button>';
      }).join('');
    }
  }

  function confirmCalPicker() {
    if (!appState.calPicker) return;
    var selectedKey = appState.calPicker.tempKey;
    if (selectedKey) {
      setQuickDate(selectedKey, 'custom');
    }
    closeCalPicker();
  }

  function openTimePicker(target) {
    var timeTarget = target || 'start';
    var currentVal = timeTarget === 'end' ? (els.quickEndTime ? els.quickEndTime.value : '') : (els.quickStartTime ? els.quickStartTime.value : '');
    var initialHour = 9;
    var initialMinute = 0;
    if (currentVal) {
      var parts = currentVal.split(':').map(Number);
      initialHour = parts[0] || 0;
      initialMinute = parts[1] || 0;
    } else if (timeTarget === 'end' && els.quickStartTime && els.quickStartTime.value) {
      var startParts = els.quickStartTime.value.split(':').map(Number);
      initialHour = (startParts[0] || 9) + 1;
      initialMinute = startParts[1] || 0;
      if (initialHour > 23) { initialHour = 23; initialMinute = 59; }
    }

    var hourOptions = [];
    for (var h = 0; h <= 23; h++) {
      hourOptions.push({ label: String(h).padStart(2, '0') + '时', value: h });
    }
    var minuteOptions = [];
    for (var m = 0; m <= 59; m++) {
      minuteOptions.push({ label: String(m).padStart(2, '0') + '分', value: m });
    }

    var body = els.pickerBody;
    body.innerHTML = '';
    body.className = 'picker-body time-picker';

    var hourWheel = createPickerWheel(hourOptions, initialHour, 'picker-col-hours');
    var minuteWheel = createPickerWheel(minuteOptions, initialMinute, 'picker-col-minutes');

    var colonSpan = document.createElement('span');
    colonSpan.className = 'picker-colon';
    colonSpan.textContent = ':';

    var wheelsRow = document.createElement('div');
    wheelsRow.className = 'picker-wheels-row';
    wheelsRow.appendChild(hourWheel.el);
    wheelsRow.appendChild(colonSpan);
    wheelsRow.appendChild(minuteWheel.el);
    body.appendChild(wheelsRow);

    els.pickerTitle.textContent = timeTarget === 'end' ? '选择结束时间' : '选择时间';
    if (els.pickerFooterHint) els.pickerFooterHint.hidden = true;

    if (els.calPickerSheet) els.calPickerSheet.hidden = true;
    els.pickerBackdrop.hidden = false;
    els.pickerSheet.hidden = false;

    appState.pickerState = {
      type: 'time',
      target: timeTarget,
      wheels: { hours: hourWheel, minutes: minuteWheel }
    };
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
    els.journalSection = $('journal-section');
    els.journalEnabledToggle = $('journal-enabled-toggle');
    els.calendarLabel = $('calendar-label');
    els.calendarCard = $('calendar-card');
    els.calendarToggle = $('toggle-calendar');
    els.calendarGrid = $('calendar-grid');
    els.selectedDateTitle = $('selected-date-title');
    els.selectedDateSubtitle = $('selected-date-subtitle');
    els.selectedDateList = $('selected-date-list');
    els.taskSearch = $('task-search');
    els.listContainer = $('list-container');
    els.listLoadMore = $('list-load-more');
    els.listLoadMoreBtn = $('list-load-more-btn');
    els.allCount = $('all-count');
    els.inboxCount = $('inbox-count');
    els.upcomingCount = $('upcoming-count');
    els.overdueCount = $('overdue-count');
    els.completedCount = $('completed-count');
    els.deletedCount = $('deleted-count');
    els.listAreaFilter = $('list-area-filter');
    els.listAreaLabel = $('list-area-label');
    els.listAreaMenu = $('list-area-menu');
    els.openAdd = $('open-add');
    els.closeAdd = $('close-add');
    els.cancelAdd = $('cancel-add');
    els.quickSheet = $('quick-sheet');
    els.sheetBackdrop = $('sheet-backdrop');
    els.quickForm = $('quick-form');
    els.quickEditId = $('quick-edit-id');
    els.quickTitle = $('quick-title');
    els.quickDate = $('quick-date');
    els.quickDateField = $('quick-date-field');
    els.quickDatePicker = $('quick-date-picker');
    els.quickPriority = $('quick-priority');
    els.quickArea = $('quick-area');
    els.quickRepeat = $('quick-repeat');
    els.quickRepeatField = $('quick-repeat-field');
    els.quickTimeField = $('quick-time-field');
    els.quickTimeMode = $('quick-time-mode');
    els.quickTimeInputs = $('quick-time-inputs');
    els.quickStartTime = $('quick-start-time');
    els.quickEndTime = $('quick-end-time');
    els.quickStartTimeBtn = $('quick-start-time-btn');
    els.quickEndTimeBtn = $('quick-end-time-btn');
    els.quickStartTimeText = $('quick-start-time-text');
    els.quickEndTimeText = $('quick-end-time-text');
    els.quickReminder = $('quick-reminder');
    els.quickReminderField = $('quick-reminder-field');
    els.quickTimeHint = $('quick-time-hint');
    els.quickReminderHint = $('quick-reminder-hint');
    els.quickRepeatCustomHint = $('quick-repeat-custom-hint');
    els.quickMoreSettings = $('quick-more-settings');
    els.quickNotes = $('quick-notes');
    els.pickerBackdrop = $('picker-backdrop');
    els.pickerSheet = $('picker-sheet');
    els.pickerTitle = $('picker-title');
    els.pickerBody = $('picker-body');
    els.pickerFooterHint = $('picker-footer-hint');
    els.calPickerSheet = $('calendar-picker-sheet');
    els.calPickerMonthLabel = $('cal-picker-month-label');
    els.calPickerGrid = $('cal-picker-grid');
    els.quickCustomDateBtn = $('quick-custom-date-btn');
    els.exportButton = $('export-button');
    els.importButton = $('import-button');
    els.importFile = $('import-file');
    els.clearButton = $('clear-button');
    els.feedbackEmail = $('feedback-email-text');
    els.feedbackMailButton = $('feedback-mail-button');
    els.notificationStatus = $('notification-status');
    els.notificationDesc = $('notification-desc');
    els.notificationButton = $('notification-setup-button');
    els.notificationDisableButton = $('notification-disable-button');
    els.toast = $('toast');
  }

  function bindEvents() {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
          handleNotificationClick(event.data.data);
        }
      });
    }
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
        if (!button.dataset.action) event.stopPropagation();
        setChoiceValue(button.dataset.choiceTarget, button.dataset.choiceValue);
      });
    });
    document.querySelectorAll('[data-date-preset]').forEach(function(button) {
      button.addEventListener('click', function() {
        var preset = button.dataset.datePreset;
        if (preset === 'pending') {
          setQuickDate('', 'pending');
        } else if (preset === 'custom') {
          openCalendarPicker();
        } else {
          setQuickDate(preset === 'today' ? appState.todayKey : preset === 'tomorrow' ? tomorrowKey() : preset === 'weekend' ? weekendKey() : '', preset);
        }
      });
    });
    document.addEventListener('click', function(event) {
      if (!event.target.closest('.custom-select')) closeSelectMenus();
    });
    els.journalForm.addEventListener('submit', handleJournalSubmit);
    els.journalContent.addEventListener('input', scheduleJournalSave);
    if (els.journalEnabledToggle) {
      els.journalEnabledToggle.addEventListener('change', function() {
        var enabled = els.journalEnabledToggle.checked;
        applyJournalEnabled(enabled);
        if (enabled) {
          renderToday();
        } else {
          els.journalContent.value = '';
        }
      });
    }
    els.taskSearch.addEventListener('input', function() {
      appState.search = els.taskSearch.value;
      appState.listDisplayCount = appState.listPageSize;
      renderLists();
    });
    document.querySelectorAll('[data-list-filter]').forEach(function(button) {
      button.addEventListener('click', function() {
        appState.listFilter = button.dataset.listFilter;
        appState.listDisplayCount = appState.listPageSize;
        closeListFilterMenu();
        renderLists();
      });
    });
    document.querySelectorAll('[data-area-filter]').forEach(function(button) {
      button.addEventListener('click', function() {
        appState.areaFilter = button.dataset.areaFilter;
        appState.listDisplayCount = appState.listPageSize;
        closeListFilterMenu();
        renderLists();
      });
    });
    if (els.listAreaFilter) {
      els.listAreaFilter.addEventListener('click', function(event) {
        event.stopPropagation();
        var isOpen = els.listAreaFilter.classList.contains('open');
        closeListFilterMenu();
        if (!isOpen) {
          els.listAreaFilter.classList.add('open');
          els.listAreaMenu.hidden = false;
        }
      });
    }
    if (els.listLoadMoreBtn) {
      els.listLoadMoreBtn.addEventListener('click', function() {
        appState.listDisplayCount += appState.listPageSize;
        renderLists();
      });
    }
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
      var taskRow = event.target.closest('.task-row');
      var listRow = event.target.closest('.list-swipe-row');
      if (!event.target.closest('.list-filter-dropdown')) closeListFilterMenu();
      closeSwipeRows(taskRow || listRow);
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
    if (els.pickerBackdrop) els.pickerBackdrop.addEventListener('click', closePicker);
    document.addEventListener('click', function(event) {
      var target = event.target.closest('[data-action]');
      if (!target) return;
      var action = target.dataset.action;
      if (action === 'picker-cancel') {
        closePicker();
      } else if (action === 'picker-confirm') {
        confirmPicker();
      } else if (action === 'open-custom-repeat') {
        openRepeatPicker();
      } else if (action === 'open-custom-reminder') {
        openReminderPicker();
      } else if (action === 'open-time-picker') {
        var timeTarget = target.dataset.timeTarget || 'start';
        openTimePicker(timeTarget);
      } else if (action === 'cal-picker-cancel') {
        closeCalPicker();
      } else if (action === 'cal-picker-confirm') {
        confirmCalPicker();
      } else if (action === 'cal-prev-month') {
        if (appState.calPicker) {
          appState.calPicker.month -= 1;
          if (appState.calPicker.month < 0) { appState.calPicker.month = 11; appState.calPicker.year -= 1; }
          renderCalPicker();
        }
      } else if (action === 'cal-next-month') {
        if (appState.calPicker) {
          appState.calPicker.month += 1;
          if (appState.calPicker.month > 11) { appState.calPicker.month = 0; appState.calPicker.year += 1; }
          renderCalPicker();
        }
      } else if (action === 'cal-goto-today') {
        if (appState.calPicker) {
          var todayParts = appState.todayKey.split('-').map(Number);
          appState.calPicker.year = todayParts[0];
          appState.calPicker.month = todayParts[1] - 1;
          appState.calPicker.tempKey = appState.todayKey;
          renderCalPicker();
        }
      } else if (action === 'cal-select-day') {
        if (appState.calPicker && target.dataset.date) {
          var clickedKey = target.dataset.date;
          var clickedParts = clickedKey.split('-').map(Number);
          appState.calPicker.year = clickedParts[0];
          appState.calPicker.month = clickedParts[1] - 1;
          appState.calPicker.tempKey = clickedKey;
          renderCalPicker();
        }
      }
    });
    window.addEventListener('online', function() {
      recoverNotificationOnline().catch(handleNotificationBackendFailure);
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) recoverNotificationForeground().catch(handleNotificationBackendFailure);
    });
  }

  function recoverNotificationLifecycle(method) {
    if (!NotificationSync) return Promise.resolve(notificationBackendStatus);
    return NotificationSync[method]().then(setNotificationBackendStatus).then(function() {
      return DB.getAllData().then(function(data) {
        appState.data = data;
        if (NotificationService) NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
        return queueNotificationSync(data);
      }, function(error) {
        showToast('本地数据库读取失败：' + error.message);
        return notificationBackendStatus;
      });
    });
  }

  function recoverNotificationOnline() {
    return recoverNotificationLifecycle('handleOnline');
  }

  function recoverNotificationForeground() {
    return recoverNotificationLifecycle('handleForeground');
  }

  function registerServiceWorker() {
    if (notificationSetupPromise) return notificationSetupPromise;
    if (!('serviceWorker' in navigator)) {
      setNotificationBackendStatus({ status: 'unsupported' });
      notificationSetupPromise = Promise.resolve(notificationBackendStatus);
      return notificationSetupPromise;
    }
    setNotificationBackendStatus({ status: 'subscribing' });
    try {
      notificationSetupPromise = navigator.serviceWorker.register('/tools/time/sw.js').then(function() {
        return navigator.serviceWorker.ready;
      }).then(function(reg) {
        if (NotificationService) {
          NotificationService.setServiceWorkerRegistration(reg);
        }
        if (!NotificationSync && NotificationSyncFactory && NotificationSyncFactory.create) {
          NotificationSync = NotificationSyncFactory.create();
        }
        if (!NotificationSync) return setNotificationBackendStatus({ status: 'unsupported' });
        return NotificationSync.setup(reg).then(setNotificationBackendStatus).then(function(status) {
          if (status.status === 'ready' || status.status === 'pending') {
            syncNotificationsWithoutBlocking(appState.data);
          }
          return status;
        });
      }).catch(function(error) {
        console.warn('[TodayYouxu] Service worker registration failed:', error);
        setNotificationBackendStatus({ status: 'error' });
        return notificationBackendStatus;
      });
    } catch (error) {
      console.warn('[TodayYouxu] Service worker registration failed:', error);
      setNotificationBackendStatus({ status: 'error' });
      notificationSetupPromise = Promise.resolve(notificationBackendStatus);
    }
    return notificationSetupPromise;
  }

  function init() {
    cacheElements();
    initThemePreset();
    applyJournalEnabled(isJournalEnabled());
    bindEvents();
    switchView(viewFromHash());
    loadData();
    registerServiceWorker();
    if (NotificationService) {
      NotificationService.initSW();
      NotificationService.startPeriodicCheck();
      if (NotificationService.setPermissionChangeCallback) {
        NotificationService.setPermissionChangeCallback(function() {
          updateNotificationUI();
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
