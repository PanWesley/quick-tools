(function() {
  var APP_VERSION = 'v0.10.0';
  var DateUtils = window.TodayYouxuDateUtils;
  var State = window.TodayYouxuState;
  var Exporter = window.TodayYouxuExport;
  var DB = window.TodayYouxuDB;
  var NotificationService = window.TodayYouxuNotification;
  var NotificationModel = window.TodayYouxuNotificationModel;
  var NotificationSyncFactory = window.TodayYouxuNotificationSync;
  var NotificationSync = null;
  var QuickEditor = window.TodayYouxuQuickEditor;
  var QUICK_DRAFT_KEY = 'today-youxu-quick-draft-v1';

  var NOTIFICATION_STATUS_COPY = {
    'subscribing': '正在连接',
    'syncing': '正在连接',
    'pending': '等待网络恢复',
    'ready': '后台提醒已开启',
    'error': '提醒连接失败',
    'unsupported': '当前设备不支持',
    'permission-required': '未开启通知',
    'permission-denied': '请在系统设置中开启通知',
    'reauthorization-required': '提醒连接已失效',
    'disabled': '未开启'
  };

  var NOTIFICATION_ACTION_COPY = {
    'permission-required': '开启通知',
    'permission-denied': '查看说明',
    'reauthorization-required': '重新连接',
    'pending': '重试',
    'ready': '测试提醒',
    'error': '重试',
    'disabled': '开启提醒'
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
    pickerState: null,
    quickEditor: QuickEditor.createSessionState(),
    quickScrollY: 0
  };

  var els = {};
  var journalSaveTimer = null;
  var swipeState = null;
  var quickDrag = null;
  var notificationBackendStatus = { status: 'disabled' };
  var notificationRegistration = null;
  var notificationSetupState = 'idle';
  var notificationSetupOwner = null;
  var notificationRecoveryTimer = null;
  var notificationLifecycleOperation = null;
  var notificationLifecycleGeneration = 0;
  var notificationLifecycleActive = !document.hidden;
  var pendingNotificationSnapshot = null;
  var notificationSyncOwner = null;
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

  function setNotificationBackendStatus(result, generation) {
    if (generation != null && !isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
    notificationBackendStatus = result && result.status ? result : { status: 'error' };
    updateNotificationUI();
    scheduleNotificationRecovery(generation);
    return notificationBackendStatus;
  }

  function handleNotificationBackendFailure(error, generation) {
    if (generation != null && !isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
    console.warn('[TodayYouxu] Notification backend failed:', error);
    return setNotificationBackendStatus({ status: 'error' }, generation);
  }

  function createNotificationCancellationError() {
    var error = new Error('Notification operation cancelled');
    error.notificationCancelled = true;
    return error;
  }

  function withNotificationDeadline(promise, milliseconds, owner) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = null;
      var cancel = function() {
        finish(reject, createNotificationCancellationError());
      };

      function finish(callback, value) {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (owner.cancelDeadline === cancel) owner.cancelDeadline = null;
        callback(value);
      }

      owner.cancelDeadline = cancel;
      timer = setTimeout(function() {
        var error = new Error('Notification operation timed out');
        error.notificationDeadline = true;
        finish(reject, error);
      }, milliseconds);
      Promise.resolve(promise).then(function(value) {
        finish(resolve, value);
      }, function(error) {
        finish(reject, error);
      });
    });
  }

  function cancelNotificationSetup() {
    var owner = notificationSetupOwner;
    notificationSetupOwner = null;
    if (!owner) return;
    owner.cancelled = true;
    var cancel = owner.cancelDeadline;
    owner.cancelDeadline = null;
    if (cancel) cancel();
  }

  function syncNotificationSnapshot(data, generation, repairing) {
    if (!isNotificationLifecycleCurrent(generation)) return Promise.resolve(notificationBackendStatus);
    return NotificationModel.buildReminderRecords(data, appState.todayKey, State.habitDueOn, new Date())
      .then(function(records) {
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        data.reminders = records.map(function(record) {
          return {
            id: record.id,
            sourceIdHash: record.sourceIdHash,
            notifyAt: record.notifyAt,
            revision: record.revision,
            payload: record.encryptedValue
          };
        });
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        setNotificationBackendStatus({ status: 'syncing', repairing: repairing === true }, generation);
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        return NotificationSync.sync(data, appState.todayKey, State.habitDueOn);
      }).then(function(status) {
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        return setNotificationBackendStatus(status, generation);
      }).catch(function(error) {
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        throw error;
      });
  }

  function queueNotificationSync(data, generation, repairing) {
    var syncGeneration = generation == null ? notificationLifecycleGeneration : generation;
    if (!isNotificationLifecycleCurrent(syncGeneration) || !NotificationSync || !NotificationModel || !data) {
      return Promise.resolve(notificationBackendStatus);
    }
    pendingNotificationSnapshot = { data: data, generation: syncGeneration, repairing: repairing === true };
    if (notificationSyncOwner && notificationSyncOwner.generation === syncGeneration) {
      return notificationSyncOwner.promise;
    }

    var owner = { generation: syncGeneration, promise: null };
    notificationSyncOwner = owner;

    function takeLatestSnapshot() {
      if (!pendingNotificationSnapshot || pendingNotificationSnapshot.generation !== syncGeneration) return null;
      var snapshot = pendingNotificationSnapshot;
      pendingNotificationSnapshot = null;
      return snapshot;
    }

    function drainLatestSnapshot() {
      var snapshot = takeLatestSnapshot();
      if (!snapshot) return Promise.resolve(notificationBackendStatus);
      return syncNotificationSnapshot(snapshot.data, snapshot.generation, snapshot.repairing).then(function(result) {
        return pendingNotificationSnapshot && pendingNotificationSnapshot.generation === syncGeneration
          ? drainLatestSnapshot()
          : result;
      });
    }

    owner.promise = drainLatestSnapshot().then(function(result) {
      if (notificationSyncOwner === owner) notificationSyncOwner = null;
      if (pendingNotificationSnapshot && pendingNotificationSnapshot.generation === syncGeneration) {
        return queueNotificationSync(
          pendingNotificationSnapshot.data,
          syncGeneration,
          pendingNotificationSnapshot.repairing
        );
      }
      return result;
    }, function(error) {
      if (notificationSyncOwner === owner) notificationSyncOwner = null;
      if (pendingNotificationSnapshot && pendingNotificationSnapshot.generation === syncGeneration) {
        var snapshot = pendingNotificationSnapshot;
        queueNotificationSync(snapshot.data, snapshot.generation, snapshot.repairing).catch(function(nextError) {
          handleNotificationBackendFailure(nextError, snapshot.generation);
        });
      }
      throw error;
    });
    return owner.promise;
  }

  function syncNotificationsWithoutBlocking(data, generation) {
    var syncGeneration = generation == null ? notificationLifecycleGeneration : generation;
    if (!isNotificationLifecycleCurrent(syncGeneration) || notificationBackendStatus.status === 'unsupported') return;
    queueNotificationSync(data, syncGeneration).catch(function(error) {
      handleNotificationBackendFailure(error, syncGeneration);
    });
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
    if (PRIORITY_TO_QUAD[priority]) {
      return PRIORITY_TO_QUAD[priority];
    }
    if (['q1', 'q2', 'q3', 'q4'].includes(priority)) {
      return priority;
    }
    return 'q4';
  }

  function priorityLabel(priority) {
    var quad = normalizePriority(priority);
    return PRIORITY_LABELS[quad] || '不重要不紧急';
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
    if (isQuickEditorOpen()) return;
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
    if (isQuickEditorOpen()) return;
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
    if (isQuickEditorOpen()) return;
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
      : task.status === 'completed'
        ? '<button class="task-check task-check-done" type="button" data-action="uncomplete-task" data-id="' + escapeHtml(task.id) + '" aria-label="恢复为待办"><span>✓</span></button>'
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
      '<article class="task-row' + (task.status === 'completed' ? ' is-completed' : '') + (isOverdue ? ' is-overdue-row' : '') + priorityRowClass(task.priority) + (actions.length ? ' has-swipe-actions' : '') + ' task-tone-' + (task.tone || hashIdToColor(task.id)) + '" data-swipe-row data-notification-type="task" data-notification-id="' + escapeHtml(task.id) + '" data-notification-date="' + escapeHtml(task.date || '') + '">',
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
      ? '<button class="task-check small task-check-done" type="button" data-action="uncomplete-task" data-id="' + escapeHtml(task.id) + '" aria-label="恢复为待办"><span>✓</span></button>'
      : '<button class="task-check small" type="button" data-action="complete-task" data-id="' + escapeHtml(task.id) + '" aria-label="完成任务"></button>';
    var isDateOverdue = task.date && task.date < appState.todayKey && task.status !== 'completed' && task.status !== 'deleted';
    return [
      '<article class="task-row date-task-row' + (task.status === 'completed' ? ' is-completed' : '') + (isDateOverdue ? ' is-overdue-row' : '') + priorityRowClass(task.priority) + (actions.length ? ' has-swipe-actions' : '') + ' task-tone-' + (task.tone || hashIdToColor(task.id)) + '"' + (actions.length ? ' data-swipe-row' : '') + ' data-notification-type="task" data-notification-id="' + escapeHtml(task.id) + '" data-notification-date="' + escapeHtml(task.date || '') + '">',
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

  function hashIdToColor(id) {
    var str = String(id || '');
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    var palettes = [
      'peach',
      'coral',
      'apricot',
      'butter',
      'mint',
      'sky',
      'lilac',
      'rose',
      'blush',
      'sand'
    ];
    return palettes[Math.abs(hash) % palettes.length];
  }

  function truncateLabel(text, maxLen) {
    var str = String(text || '').trim();
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
  }

  function calendarEntryTone(entry) {
    if (entry.type === 'task') return entry.tone || hashIdToColor(entry.id);
    if (entry.type === 'habit') return entry.state === 'done' ? 'mint' : 'lilac';
    return 'rose';
  }

  function calendarPriorityBorder(priority) {
    var borders = {
      high: ' border-high',
      medium: ' border-medium',
      low: ' border-low',
      none: ''
    };
    return borders[priority] || borders.none;
  }

  function calendarEntryStateClass(entry) {
    return ['completed', 'done', 'skipped'].includes(entry.state) ? ' is-done' : '';
  }

  function calendarEntryLabel(entry) {
    if (entry.type !== 'task' || entry.timeMode === 'all-day') return entry.label;
    if ((entry.rangePosition === 'single' || entry.rangePosition === 'start') && entry.startTime) return entry.startTime + ' ' + entry.label;
    if (entry.rangePosition === 'end' && entry.endTime) return entry.endTime + ' ' + entry.label;
    return entry.label;
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
    var allTodayTasks = appState.data.tasks.filter(function(task) {
      return task.status !== 'deleted' && task.date && task.date <= appState.todayKey;
    }).sort(function(a, b) {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    var dueHabits = appState.data.habits.filter(function(habit) {
      return State.habitDueOn(habit, appState.todayKey);
    });
    var journal = appState.data.journals.find(function(entry) {
      return entry.date === appState.todayKey && String(entry.content || '').trim();
    });

    updateHeaderTitle();
    els.todayTaskList.innerHTML = allTodayTasks.length ? allTodayTasks.map(renderTask).join('') : renderEmpty('今天没有待办。可以点击 + 记录一件事。');
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
    updateHeaderTitle();
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
      var maxStrips = 4;
      var strips = entries.slice(0, maxStrips).map(function(entry) {
        var label = calendarEntryLabel(entry);
        var timeMatch = /^(\d{2}:\d{2})\s+/.exec(label);
        var classes = 'calendar-strip ' + calendarEntryTone(entry) + calendarEntryStateClass(entry);
        if (!timeMatch) return '<span class="' + classes + '">' + escapeHtml(truncateLabel(label, 4)) + '</span>';
        var title = label.slice(timeMatch[0].length);
        return '<span class="' + classes + ' has-time"><span class="calendar-strip-time">' + escapeHtml(timeMatch[1]) + '</span><span class="calendar-strip-title">' + escapeHtml(truncateLabel(title, 4)) + '</span></span>';
      }).join('');
      var overflow = entries.length > maxStrips ? '<span class="calendar-more">+' + (entries.length - maxStrips) + '</span>' : '';
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

    var html = rows.length ? rows.join('') : renderEmpty('这一天还没有安排或记录。');
    els.selectedDateTitle.textContent = dateKey;
    els.selectedDateSubtitle.textContent = DateUtils.formatWeekday(dateKey);
    els.selectedDateList.innerHTML = html;
    if (els.dateDetailTitle) {
      els.dateDetailTitle.textContent = dateKey;
      els.dateDetailSubtitle.textContent = DateUtils.formatWeekday(dateKey);
      els.dateDetailList.innerHTML = html;
    }
  }

  function openDateDetail() {
    if (!els.dateDetailModal) return;
    renderSelectedDate();
    els.dateDetailBackdrop.hidden = false;
    els.dateDetailModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDateDetail() {
    if (!els.dateDetailModal) return;
    els.dateDetailBackdrop.hidden = true;
    els.dateDetailModal.hidden = true;
    document.body.style.overflow = '';
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
    var toneClass = '';
    var prio = normalizePriority(priority);

    if (isDeleted) {
      actions.push('<button class="swipe-action restore" type="button" data-action="restore-task" data-id="' + escapeHtml(item.data.id) + '">恢复</button>');
      actions.push('<button class="swipe-action delete" type="button" data-action="purge-task" data-id="' + escapeHtml(item.data.id) + '">彻底删除</button>');
      checkButton = '<span></span>';
      typeTag = '<span class="type-tag task-tag">任务</span>';
      rowClass = 'priority-none';
      toneClass = ' task-tone-' + (item.data.tone || hashIdToColor(item.data.id));
    } else if (isCompleted) {
      if (isHabit) {
        checkButton = '<span class="date-icon habit-done-icon habit-check-done-' + prio + '">✓</span>';
        actions.push('<button class="swipe-action edit" type="button" data-action="edit-habit" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
        actions.push('<button class="swipe-action restore" type="button" data-action="reset-habit" data-id="' + escapeHtml(item.data.id) + '" data-date="' + escapeHtml(appState.todayKey) + '">重置</button>');
        typeTag = '<span class="type-tag habit-tag">习惯</span>';
        toneClass = '';
      } else {
        checkButton = '<button class="task-check small task-check-done" type="button" data-action="uncomplete-task" data-id="' + escapeHtml(item.data.id) + '" aria-label="恢复为待办"><span>✓</span></button>';
        actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
        actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(item.data.id) + '">删除</button>');
        typeTag = '<span class="type-tag task-tag">任务</span>';
        toneClass = ' task-tone-' + (item.data.tone || hashIdToColor(item.data.id));
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
      toneClass = '';
    } else {
      checkButton = '<button class="task-check small" type="button" data-action="complete-task" data-id="' + escapeHtml(item.data.id) + '" aria-label="完成任务"></button>';
      actions.push('<button class="swipe-action edit" type="button" data-action="edit-task" data-id="' + escapeHtml(item.data.id) + '">编辑</button>');
      actions.push('<button class="swipe-action delete" type="button" data-action="delete-task" data-id="' + escapeHtml(item.data.id) + '">删除</button>');
      typeTag = '<span class="type-tag task-tag">任务</span>';
      rowClass = priorityRowClass(priority);
      toneClass = ' task-tone-' + (item.data.tone || hashIdToColor(item.data.id));
    }

    if (isOverdueItem) {
      rowClass += ' is-overdue-row';
    }

    return [
      '<article class="task-row list-task-row' + rowClass + toneClass + ' has-swipe-actions" data-swipe-row data-type="' + item.type + '" data-id="' + escapeHtml(item.data.id) + '" data-notification-type="' + escapeHtml(item.type) + '" data-notification-id="' + escapeHtml(item.data.id) + '" data-notification-date="' + escapeHtml(isHabit ? appState.todayKey : item.data.date || '') + '">',
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
    if (els.dateDetailModal && !els.dateDetailModal.hidden) closeDateDetail();
    closeSelectMenus();
    appState.view = view;
    document.body.setAttribute('data-view', view);
    document.querySelectorAll('.view').forEach(function(section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    updateHeaderTitle();
    if (window.location.hash !== '#' + view) {
      window.location.hash = view;
    }
  }

  function updateHeaderTitle() {
    var view = appState.view;
    var titleEl = document.getElementById('app-header-title');
    var descEl = document.getElementById('app-header-desc');
    if (view === 'calendar') {
      var label = els.calendarLabel ? els.calendarLabel.textContent : '日历';
      if (titleEl) titleEl.textContent = label;
      if (descEl) descEl.textContent = viewTitles.calendar.desc;
    } else if (view === 'today') {
      if (titleEl) titleEl.textContent = todayHeaderTitle();
      if (descEl) descEl.textContent = todayHeaderDesc();
    } else {
      var vt = viewTitles[view] || viewTitles.today;
      if (titleEl) titleEl.textContent = vt.title;
      if (descEl) descEl.textContent = vt.desc;
    }
  }

  function todayHeaderTitle() {
    var d = DateUtils.fromDateKey(appState.todayKey);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + DateUtils.formatWeekday(appState.todayKey);
  }

  function todayHeaderDesc() {
    var tasks = appState.data.tasks.filter(function(t) {
      return t.status !== 'deleted' && t.date && t.date <= appState.todayKey;
    });
    var active = tasks.filter(function(t) { return t.status !== 'completed'; }).length;
    var completed = tasks.length - active;
    var habits = appState.data.habits.filter(function(h) {
      return State.habitDueOn(h, appState.todayKey);
    });
    var unchecked = habits.filter(function(h) {
      var log = State.getHabitLogForDate(appState.data.habitLogs, h.id, appState.todayKey);
      return !log || (log.state !== 'done' && log.state !== 'skipped');
    }).length;
    if (active === 0 && unchecked === 0) return '今天都完成啦 ✨';
    var parts = [];
    if (active > 0) parts.push(active + '件事待完成');
    if (unchecked > 0) parts.push(unchecked + '个习惯待打卡');
    var summary = parts.join(' · ');
    if (completed > 0) summary += ' · 已完成' + completed + '件';
    return summary;
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

  function focusQuickTitle() {
    if (!els.quickTitle) return;
    if (document.activeElement === els.quickTitle) return;
    els.quickTitle.focus();
    try {
      var len = els.quickTitle.value.length;
      els.quickTitle.setSelectionRange(len, len);
    } catch(e) {}
  }

  function isQuickEditorOpen() {
    return appState.quickEditor.session === 'open';
  }

  function readQuickDraft() {
    var raw = {
      title: els.quickTitle.value,
      notes: els.quickNotes.value,
      priority: els.quickPriority.value,
      area: els.quickArea.value,
      tone: els.quickTone.value,
      startDate: els.quickDate.value,
      endDate: els.quickEndDate.value,
      timeMode: els.quickTimeMode.value,
      startTime: els.quickStartTime.value,
      endTime: els.quickEndTime.value,
      repeat: els.quickRepeat.value,
      customRepeat: appState.customRepeat,
      reminder: els.quickReminder.value,
      customReminder: appState.customReminder
    };
    var draft = QuickEditor.normalizeDraft(raw, { todayKey: appState.todayKey });
    if (!raw.startDate) { draft.startDate = ''; draft.endDate = ''; }
    return draft;
  }

  function persistCreateDraft() {
    if (appState.editingTaskId) return;
    try {
      localStorage.setItem(QUICK_DRAFT_KEY, JSON.stringify(readQuickDraft()));
    } catch (error) {}
  }

  function clearCreateDraft() {
    try {
      localStorage.removeItem(QUICK_DRAFT_KEY);
    } catch (error) {}
  }

  function applyQuickDraft(draft) {
    els.quickTitle.value = draft.title;
    els.quickNotes.value = draft.notes;
    setChoiceValue('quick-priority', draft.priority);
    setChoiceValue('quick-area', draft.area);
    setChoiceValue('quick-tone', draft.tone);
    els.quickDate.value = draft.startDate;
    els.quickEndDate.value = draft.endDate;
    setQuickDate(draft.startDate);
    setChoiceValue('quick-time-mode', draft.timeMode);
    els.quickStartTime.value = draft.startTime;
    els.quickEndTime.value = draft.endTime;
    setChoiceValue('quick-repeat', draft.repeat);
    setChoiceValue('quick-reminder', draft.reminder);
    appState.customRepeat = draft.customRepeat;
    appState.customReminder = draft.customReminder;
    autoResizeTextarea(els.quickNotes);
    updateTimeDisplay();
    updateToolStates();
    updateQuickSummary();
    renderQuickSurface();
  }

  function setQuickSurface(surface) {
    if (!QuickEditor || !surface) return;
    if (appState.quickEditor.surface === surface && surface !== 'detail') {
      appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SHOW_KEYBOARD' });
      renderQuickSurface();
      focusQuickTitle();
      return;
    }
    if (document.activeElement === els.quickTitle || document.activeElement === els.quickNotes) document.activeElement.blur();
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, {
      type: surface === 'detail' ? 'OPEN_DETAIL' : 'OPEN_TOOL',
      tool: surface
    });
    renderQuickSurface();
  }

  function renderQuickSurface() {
    if (!els.quickExtraPanel) return;
    var state = appState.quickEditor;
    updateQuickSummary();
    document.querySelectorAll('.quick-tool-btn').forEach(function(button) {
      var open = button.dataset.tool === state.surface;
      button.classList.toggle('is-open', open);
      button.setAttribute('aria-pressed', String(open));
    });
    if (state.surface === 'keyboard') {
      els.quickExtraPanel.hidden = true;
      els.quickExtraPanel.innerHTML = '';
      return;
    }
    if (state.surface === 'date') renderDateSurface();
    else if (state.surface === 'priority') renderPrioritySurface();
    else if (state.surface === 'area') renderAreaSurface();
    else if (state.surface === 'tone') renderToneSurface();
  }

  function handleQuickDraftChange() {
    updateTimeDisplay();
    updateToolStates();
    if (typeof updateQuickSummary === 'function') updateQuickSummary();
    renderQuickSurface();
    if (!appState.editingTaskId) persistCreateDraft();
  }

  function updateQuickSummary() {
    var draft = readQuickDraft();
    var dateText = !draft.startDate ? '待定' : draft.startDate === draft.endDate
      ? formatDateLabel(draft.startDate)
      : formatDateLabel(draft.startDate) + '–' + formatDateLabel(draft.endDate);
    var timeText = draft.timeMode === 'all-day' ? '全天' : draft.timeMode === 'range'
      ? draft.startTime + '–' + draft.endTime : draft.startTime;
    if (els.quickSummary) {
      els.quickSummary.textContent = [dateText, timeText, formatRepeatLabel(draft.repeat, draft.customRepeat), formatReminderLabel(draft.reminder, draft.customReminder)]
        .filter(function(value) { return value && value !== '不重复' && value !== '不提醒'; }).join(' · ');
    }
    var saveButton = els.quickForm && els.quickForm.querySelector('.quick-send-btn');
    if (saveButton) saveButton.disabled = !String(draft.title || '').trim();
  }

  function lockQuickEditorScroll() {
    appState.quickScrollY = window.scrollY || 0;
    document.body.style.top = '-' + appState.quickScrollY + 'px';
    document.body.classList.add('quick-editor-open');
  }

  var quickInertElements = [];

  function setQuickEditorBackgroundInert(active) {
    if (!document.body) return;
    if (!active) {
      quickInertElements.forEach(function(entry) {
        entry.node.inert = entry.inert;
        if (entry.ariaHidden === null) entry.node.removeAttribute('aria-hidden');
        else entry.node.setAttribute('aria-hidden', entry.ariaHidden);
      });
      quickInertElements = [];
      return;
    }
    quickInertElements = [];
    Array.prototype.forEach.call(document.body.children, function(node) {
      if (node === els.sheetBackdrop || node === els.quickSheet || node === els.quickFullPanel ||
          node === els.pickerBackdrop || node === els.pickerSheet || node === els.calPickerSheet ||
          node === els.toast || node.tagName === 'SCRIPT') return;
      quickInertElements.push({ node: node, inert: Boolean(node.inert), ariaHidden: node.getAttribute('aria-hidden') });
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });
  }

  function quickFocusRoot() {
    if (!isQuickEditorOpen()) return null;
    if (els.pickerSheet && !els.pickerSheet.hidden) return null;
    if (els.calPickerSheet && !els.calPickerSheet.hidden) return null;
    if (isQuickFullPanelOpen()) return els.quickFullPanel;
    return els.quickSheet && !els.quickSheet.hidden ? els.quickSheet : null;
  }

  function trapQuickEditorFocus(event) {
    var root = quickFocusRoot();
    if (!root) return;
    if (event.key === 'Tab') {
      var focusable = Array.prototype.filter.call(root.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function(node) {
        return !node.hidden && node.offsetParent !== null;
      });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (!root.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (isPendingConfirmationOpen()) {
      renderDateParent(true);
    } else if (isQuickFullPanelOpen() && appState.quickEditor.surface !== 'detail') {
      returnQuickFullToDetailSummary();
    } else if (isQuickFullPanelOpen()) {
      closeQuickFullPanel({ focusTitle: true });
    } else if (appState.quickEditor.surface === 'date' && appState.quickEditor.dateChild !== 'none') {
      finishDateChild(false);
    } else if (appState.quickEditor.surface !== 'keyboard') {
      appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SHOW_KEYBOARD' });
      renderQuickSurface();
      focusQuickTitle();
    } else {
      closeQuickSession({ keepDraft: true, restoreFocus: true });
    }
  }

  function unlockQuickEditorScroll() {
    document.body.classList.remove('quick-editor-open');
    document.body.style.top = '';
    window.scrollTo(0, appState.quickScrollY || 0);
  }

  function updateQuickViewportHeight() {
    var height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--quick-viewport-height', height + 'px');
  }

  function openQuickSession(mode, source) {
    var sessionMode = mode || 'create';
    appState.quickEditor = QuickEditor.transition(QuickEditor.createSessionState(sessionMode), { type: 'OPEN' });
    var stored = sessionMode === 'create' ? QuickEditor.parseStoredDraft((function() {
      try { return localStorage.getItem(QUICK_DRAFT_KEY); } catch (error) { return null; }
    })()) : null;
    var initial = stored || source || {};
    applyQuickDraft(QuickEditor.normalizeDraft(initial, { todayKey: appState.todayKey }));
    closeQuickExtra();
    closeQuickFullPanel();
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    lockQuickEditorScroll();
    setQuickEditorBackgroundInert(true);
    updateQuickViewportHeight();
    void els.quickSheet.offsetHeight;
    focusQuickTitle();
  }

  function closeQuickSession(options) {
    var opts = options || {};
    if (!appState.editingTaskId && opts.keepDraft !== false) persistCreateDraft();
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'CLOSE' });
    var activeQuickDrag = quickDrag;
    quickDrag = null;
    els.quickSheet.classList.remove('is-dragging');
    els.quickSheet.style.removeProperty('--quick-drag-offset');
    if (activeQuickDrag && els.quickDragHandle && els.quickDragHandle.hasPointerCapture && els.quickDragHandle.hasPointerCapture(activeQuickDrag.id)) {
      els.quickDragHandle.releasePointerCapture(activeQuickDrag.id);
    }
    closeQuickExtra();
    closeQuickFullPanel();
    closePicker();
    els.sheetBackdrop.hidden = true;
    els.quickSheet.hidden = true;
    els.quickFullPanel.hidden = true;
    unlockQuickEditorScroll();
    setQuickEditorBackgroundInert(false);
    appState.editingTaskId = '';
    appState.editingType = '';
    if (opts.restoreFocus && els.openAdd) els.openAdd.focus();
  }

  function openSheet() {
    appState.editingTaskId = '';
    appState.editingType = '';
    appState.customRepeat = null;
    appState.customReminder = null;
    var sheetTitle = $('quick-sheet-title');
    if (sheetTitle) sheetTitle.textContent = '新增事项';
    var defaultDate = appState.todayKey;
    if (appState.view === 'calendar' && appState.selectedDateKey) {
      defaultDate = appState.selectedDateKey;
    }
    els.quickEditId.value = '';
    openQuickSession('create', { startDate: defaultDate, endDate: defaultDate });
  }

  function closeSheet() {
    closeQuickSession({ keepDraft: true, restoreFocus: true });
  }

  function finishQuickDrag(event, canClose) {
    if (!quickDrag || quickDrag.id !== event.pointerId) return;
    var threshold = Math.min(120, els.quickSheet.getBoundingClientRect().height * 0.22);
    var shouldClose = canClose && quickDrag.deltaY >= threshold;
    quickDrag = null;
    els.quickSheet.classList.remove('is-dragging');
    els.quickSheet.style.removeProperty('--quick-drag-offset');
    if (els.quickDragHandle.hasPointerCapture && els.quickDragHandle.hasPointerCapture(event.pointerId)) {
      els.quickDragHandle.releasePointerCapture(event.pointerId);
    }
    if (shouldClose) closeQuickSession({ keepDraft: true, restoreFocus: true });
  }

  function bindQuickDragHandle() {
    els.quickDragHandle.addEventListener('pointerdown', function(event) {
      if (!isQuickEditorOpen()) return;
      quickDrag = { id: event.pointerId, startY: event.clientY, deltaY: 0 };
      els.quickDragHandle.setPointerCapture(event.pointerId);
      els.quickSheet.classList.add('is-dragging');
      els.quickSheet.style.setProperty('--quick-drag-offset', '0px');
    });
    els.quickDragHandle.addEventListener('pointermove', function(event) {
      if (!quickDrag || quickDrag.id !== event.pointerId) return;
      quickDrag.deltaY = Math.max(0, event.clientY - quickDrag.startY);
      els.quickSheet.style.setProperty('--quick-drag-offset', quickDrag.deltaY + 'px');
    });
    els.quickDragHandle.addEventListener('pointerup', function(event) {
      finishQuickDrag(event, true);
    });
    els.quickDragHandle.addEventListener('pointercancel', function(event) {
      finishQuickDrag(event, false);
    });
  }

  // 自动调整textarea高度
  function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  // 关闭extra面板
  function closeQuickExtra() {
    if (!els.quickExtraPanel) return;
    els.quickExtraPanel.hidden = true;
    els.quickExtraPanel.innerHTML = '';
    if (els.quickTools) {
      els.quickTools.querySelectorAll('.quick-tool-btn').forEach(function(btn) {
        btn.classList.remove('is-open');
      });
    }
  }

  // 设置工具按钮激活状态
  function setToolActive(tool, active, dotColor) {
    if (!els.quickTools) return;
    var btn = els.quickTools.querySelector('[data-tool="' + tool + '"]');
    if (!btn) return;
    btn.classList.toggle('is-active', active);
    var dot = btn.querySelector('.quick-tool-dot');
    if (dot) {
      dot.hidden = !active;
      if (active && dotColor) {
        dot.style.background = dotColor;
      } else if (dot) {
        dot.style.background = '';
      }
    }
  }

  // 优先级颜色映射
  var PRIORITY_COLORS = {
    high: '#FF6F52',
    medium: '#FFB23F',
    low: '#64B5F6',
    none: '#B0B0B0'
  };
  var AREA_COLORS = {
    life: '#5DCBA8',
    study: '#64B5F6',
    work: '#FF8A2A',
    health: '#FF6F52',
    housework: '#B9A7FF',
    memory: '#FF9FB8',
    other: '#B0B0B0'
  };
  var AREA_ICONS = {
    life: '🌿',
    study: '📚',
    work: '💼',
    health: '🏃',
    housework: '🏠',
    memory: '🎂',
    other: '📌'
  };
  var AREA_LABELS = {
    life: '生活',
    study: '学习',
    work: '工作',
    health: '健康',
    housework: '家务',
    memory: '纪念',
    other: '其他'
  };

  var QUAD_PRIORITIES = [
    { value: 'q1', roman: 'I', label: '重要紧急', desc: '立即执行', color: '#ff5252' },
    { value: 'q2', roman: 'II', label: '重要不紧急', desc: '计划推进', color: '#448aff' },
    { value: 'q3', roman: 'III', label: '紧急不重要', desc: '委托他人', color: '#ff9800' },
    { value: 'q4', roman: 'IV', label: '不重要不紧急', desc: '有空再做', color: '#9e9e9e' }
  ];

  var PRIORITY_TO_QUAD = { high: 'q1', medium: 'q2', low: 'q3', none: 'q4', 'q1': 'q1', 'q2': 'q2', 'q3': 'q3', 'q4': 'q4' };
  var QUAD_TO_PRIORITY = { q1: 'high', q2: 'medium', q3: 'low', q4: 'none' };
  var PRIORITY_COLORS = { high: '#ff5252', medium: '#448aff', low: '#ff9800', none: '#9e9e9e', q1: '#ff5252', q2: '#448aff', q3: '#ff9800', q4: '#9e9e9e' };
  var PRIORITY_LABELS = {
    high: '重要紧急', medium: '重要不紧急', low: '紧急不重要', none: '不重要不紧急',
    q1: '重要紧急', q2: '重要不紧急', q3: '紧急不重要', q4: '不重要不紧急'
  };

  var TONE_CSS_COLORS = {
    '': 'var(--surface)',
    peach: 'rgb(255,212,185)',
    coral: 'rgb(255,182,192)',
    apricot: 'rgb(255,200,145)',
    butter: 'rgb(255,235,165)',
    mint: 'rgb(175,235,210)',
    sky: 'rgb(180,220,245)',
    lilac: 'rgb(215,195,245)',
    rose: 'rgb(255,190,210)',
    blush: 'rgb(255,210,220)',
    sand: 'rgb(245,225,195)',
    cream: 'rgb(255,248,225)',
    sage: 'rgb(200,230,200)',
    ice: 'rgb(210,240,250)',
    lavender: 'rgb(230,220,250)',
    pink: 'rgb(255,205,210)',
    tan: 'rgb(235,215,185)',
    lemon: 'rgb(255,245,180)',
    mint2: 'rgb(195,235,220)',
    babyblue: 'rgb(195,225,245)',
    wisteria: 'rgb(220,205,245)',
    salmon: 'rgb(255,200,180)',
    nude: 'rgb(250,225,215)',
    olive: 'rgb(220,235,195)',
    aqua: 'rgb(190,235,235)',
    mauve: 'rgb(240,215,235)',
    fog: 'rgb(225,230,235)',
    pearl: 'rgb(245,240,235)'
  };

  var TONE_LIST = [
    { value: '', label: '无' },
    { value: 'peach', color: 'rgb(255,212,185)' },
    { value: 'coral', color: 'rgb(255,182,192)' },
    { value: 'apricot', color: 'rgb(255,200,145)' },
    { value: 'butter', color: 'rgb(255,235,165)' },
    { value: 'mint', color: 'rgb(175,235,210)' },
    { value: 'sky', color: 'rgb(180,220,245)' },
    { value: 'lilac', color: 'rgb(215,195,245)' },
    { value: 'rose', color: 'rgb(255,190,210)' },
    { value: 'blush', color: 'rgb(255,210,220)' },
    { value: 'sand', color: 'rgb(245,225,195)' },
    { value: 'cream', color: 'rgb(255,248,225)' },
    { value: 'sage', color: 'rgb(200,230,200)' },
    { value: 'ice', color: 'rgb(210,240,250)' },
    { value: 'lavender', color: 'rgb(230,220,250)' },
    { value: 'pink', color: 'rgb(255,205,210)' },
    { value: 'tan', color: 'rgb(235,215,185)' },
    { value: 'lemon', color: 'rgb(255,245,180)' },
    { value: 'mint2', color: 'rgb(195,235,220)' },
    { value: 'babyblue', color: 'rgb(195,225,245)' },
    { value: 'wisteria', color: 'rgb(220,205,245)' },
    { value: 'salmon', color: 'rgb(255,200,180)' },
    { value: 'nude', color: 'rgb(250,225,215)' },
    { value: 'olive', color: 'rgb(220,235,195)' },
    { value: 'aqua', color: 'rgb(190,235,235)' },
    { value: 'mauve', color: 'rgb(240,215,235)' },
    { value: 'fog', color: 'rgb(225,230,235)' },
    { value: 'pearl', color: 'rgb(245,240,235)' }
  ];

  // 返回日期标签
  function formatDateLabel(dateKey) {
    if (!dateKey) return '待定';
    if (dateKey === appState.todayKey) return '今天';
    if (dateKey === tomorrowKey()) return '明天';
    if (dateKey === weekendKey()) return '周末';
    var parts = dateKey.split('-');
    return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
  }

  // 返回当前设置摘要
  function getQuickSummary() {
    var dateVal = els.quickDate ? els.quickDate.value : '';
    var priorityRaw = els.quickPriority ? els.quickPriority.value : '';
    var priorityVal = PRIORITY_TO_QUAD[priorityRaw] || 'q4';
    var repeatVal = els.quickRepeat ? els.quickRepeat.value : 'none';
    var reminderVal = els.quickReminder ? els.quickReminder.value : 'none';
    var areaVal = els.quickArea ? els.quickArea.value : '';
    var toneVal = els.quickTone ? els.quickTone.value : '';
    var notesVal = els.quickNotes ? els.quickNotes.value : '';
    var timeMode = els.quickTimeMode ? els.quickTimeMode.value : 'all-day';
    var startTime = els.quickStartTime ? els.quickStartTime.value : '';
    var endTime = els.quickEndTime ? els.quickEndTime.value : '';
    return {
      hasDate: Boolean(dateVal),
      dateLabel: formatDateLabel(dateVal),
      timeLabel: timeMode === 'all-day' ? '全天' : (timeMode === 'point' ? (startTime || '时间点') : (startTime ? startTime + '-' + (endTime || '') : '时间段')),
      priority: priorityVal,
      priorityLabel: PRIORITY_LABELS[priorityVal] || '不重要不紧急',
      priorityColor: PRIORITY_COLORS[priorityVal] || '#9e9e9e',
      repeat: repeatVal,
      repeatLabel: { none: '不重复', daily: '每天', weekly: '每周', custom: '自定义' }[repeatVal] || '不重复',
      reminder: reminderVal,
      reminderLabel: { 'none': '不提醒', 'at-time': '准时', '5': '5分钟前', '15': '15分钟前', '30': '30分钟前', '60': '1小时前' }[reminderVal] || '不提醒',
      area: areaVal,
      areaLabel: AREA_LABELS[areaVal] || (areaVal ? areaVal : '未设置'),
      areaColor: AREA_COLORS[areaVal] || '#b0b0b0',
      areaIcon: AREA_ICONS[areaVal] || '📌',
      tone: toneVal,
      hasNotes: Boolean(notesVal && notesVal.trim())
    };
  }

  // 更新工具栏按钮激活状态（小圆点指示）
  function updateToolStates() {
    var s = getQuickSummary();
    setToolActive('date', s.hasDate, '');
    setToolActive('priority', s.priority !== 'q4', s.priorityColor);
    setToolActive('area', Boolean(s.area), s.areaColor);
    setToolActive('tone', Boolean(s.tone), TONE_CSS_COLORS[s.tone] ? '#888' : '#888');
  }

  // 别名（兼容旧调用）
  function updateQuickChips() { updateToolStates(); }

  function openQuickFullPanel() {
    if (!els.quickFullPanel || !els.quickSheet) return;
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_DETAIL' });
    closeQuickExtra();
    renderQuickFullPanel();
    els.quickSheet.hidden = true;
    els.quickSheet.setAttribute('aria-hidden', 'true');
    els.quickSheet.inert = true;
    els.quickFullPanel.hidden = false;
    if (els.quickFullBack) els.quickFullBack.focus();
    if (els.quickTitle && document.activeElement === els.quickTitle) {
      els.quickTitle.blur();
    }
    if (els.quickNotes && document.activeElement === els.quickNotes) {
      els.quickNotes.blur();
    }
  }

  function returnQuickFullToDetailSummary() {
    appState.quickChildDraft = null;
    appState.quickChildWheels = null;
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_DETAIL' });
    renderQuickFullPanel();
    if (els.quickFullBack) els.quickFullBack.focus();
  }

  function closeQuickFullPanel(options) {
    if (!els.quickFullPanel || !els.quickSheet) return;
    if (isQuickEditorOpen()) {
      appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'CLOSE_DETAIL' });
    }
    els.quickFullPanel.hidden = true;
    els.quickSheet.hidden = false;
    els.quickSheet.removeAttribute('aria-hidden');
    els.quickSheet.inert = false;
    renderQuickSurface();
    if (options && options.focusTitle && els.quickTitle) {
      void els.quickSheet.offsetHeight;
      focusQuickTitle();
    }
  }

  function renderQuickFullPanel() {
    if (!els.quickFullBody) return;
    var draft = readQuickDraft();
    var s = getQuickSummary();
    var html = '';

    html += '<div class="quick-full-section"><div class="quick-full-label">标题</div>';
    html += '<input type="text" class="quick-full-input" id="qf-title-input" value="' + escapeHtml(draft.title) + '" placeholder="事项标题"></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">备注</div>';
    html += '<textarea class="quick-full-textarea" id="qf-notes-input" rows="4" placeholder="添加备注...">' + escapeHtml(draft.notes) + '</textarea></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">日期与时间</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="date">';
    html += '<div class="quick-full-value-content">📅 ' + escapeHtml(s.dateLabel + ' · ' + s.timeLabel) + '</div>';
    html += '<span class="qv-arrow">›</span></button></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">优先级</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="priority">';
    html += '<div class="quick-full-value-content"><span style="color:' + s.priorityColor + '">●</span> ' + escapeHtml(s.priorityLabel) + '</div>';
    html += '<span class="qv-arrow">›</span></button></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">归属项目</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="area">';
    html += '<div class="quick-full-value-content">' + (s.area ? s.areaIcon + ' ' + escapeHtml(s.areaLabel) : '未设置') + '</div>';
    html += '<span class="qv-arrow">›</span></button></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">重复</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="repeat">';
    html += '<div class="quick-full-value-content">🔁 ' + escapeHtml(s.repeatLabel) + '</div>';
    html += '<span class="qv-arrow">›</span></button></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">提醒</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="reminder">';
    html += '<div class="quick-full-value-content">🔔 ' + escapeHtml(s.reminderLabel) + '</div>';
    html += '<span class="qv-arrow">›</span></button></div>';

    html += '<div class="quick-full-section"><div class="quick-full-label">背景色</div>';
    html += '<button type="button" class="quick-full-value" data-qf-jump="tone">';
    html += '<div class="quick-full-value-content">';
    html += '<span class="quick-full-color-dot" style="background:' + (TONE_CSS_COLORS[s.tone] || 'var(--surface)') + '"></span>';
    html += (s.tone ? '已选颜色' : '默认');
    html += '</div><span class="qv-arrow">›</span></button></div>';

    els.quickFullBody.innerHTML = html;

    els.quickFullBody.querySelectorAll('[data-qf-jump]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tool = btn.dataset.qfJump;
        appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_TOOL', tool: tool === 'repeat' || tool === 'reminder' ? 'date' : tool });
        if (tool === 'repeat' || tool === 'reminder') {
          appState.quickChildDraft = QuickEditor.createChildDraft(readQuickDraft(), tool);
          appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_DATE_CHILD', child: tool });
        }
        renderQuickSurface();
      });
    });
    var qfTitle = els.quickFullBody.querySelector('#qf-title-input');
    if (qfTitle) {
      qfTitle.addEventListener('input', function() {
        els.quickTitle.value = qfTitle.value;
        handleQuickDraftChange();
      });
    }
    var qfNotes = els.quickFullBody.querySelector('#qf-notes-input');
    if (qfNotes) {
      qfNotes.addEventListener('input', function() {
        els.quickNotes.value = qfNotes.value;
        autoResizeTextarea(els.quickNotes);
        handleQuickDraftChange();
      });
    }
  }

  // 日历渲染状态
  var dtCalendarState = {
    viewYear: 0,
    viewMonth: 0,
    selectedDate: ''
  };

  function renderDatetimeCalendar(container, selectedDate) {
    var now = new Date();
    var baseDate = selectedDate ? DateUtils.fromDateKey(selectedDate) : now;
    if (!dtCalendarState.viewYear) {
      dtCalendarState.viewYear = baseDate.getFullYear();
      dtCalendarState.viewMonth = baseDate.getMonth();
      dtCalendarState.selectedDate = selectedDate || '';
    }

    var year = dtCalendarState.viewYear;
    var month = dtCalendarState.viewMonth;
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var startWeekday = (firstDay.getDay() + 6) % 7;
    var todayKey = appState.todayKey;

    var monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    var html = '<div class="quick-datetime-calendar">';
    html += '<div class="quick-datetime-calendar-header">';
    html += '<span class="quick-datetime-month">' + year + '年 ' + monthNames[month] + '</span>';
    html += '<div class="quick-datetime-nav">';
    html += '<button type="button" data-cal-nav="prev">‹</button>';
    html += '<button type="button" data-cal-nav="today">今</button>';
    html += '<button type="button" data-cal-nav="next">›</button>';
    html += '</div></div>';

    html += '<div class="quick-datetime-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>';
    html += '<div class="quick-datetime-grid">';

    var prevMonthLastDay = new Date(year, month, 0).getDate();
    for (var i = startWeekday - 1; i >= 0; i--) {
      var d = prevMonthLastDay - i;
      var pmDate = new Date(year, month - 1, d);
      var pmKey = DateUtils.toDateKey(pmDate);
      html += '<button type="button" class="quick-datetime-day outside" data-cal-date="' + pmKey + '">' + d + '</button>';
    }

    for (var day = 1; day <= lastDay.getDate(); day++) {
      var date = new Date(year, month, day);
      var dateKey = DateUtils.toDateKey(date);
      var isToday = dateKey === todayKey;
      var isSelected = dateKey === dtCalendarState.selectedDate;
      var classes = 'quick-datetime-day';
      if (isToday) classes += ' today';
      if (isSelected) classes += ' selected';
      html += '<button type="button" class="' + classes + '" data-cal-date="' + dateKey + '">' + day + '</button>';
    }

    var totalCells = startWeekday + lastDay.getDate();
    var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (var j = 1; j <= remaining; j++) {
      var nmDate = new Date(year, month + 1, j);
      var nmKey = DateUtils.toDateKey(nmDate);
      html += '<button type="button" class="quick-datetime-day outside" data-cal-date="' + nmKey + '">' + j + '</button>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-cal-nav]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.dataset.calNav;
        if (action === 'prev') {
          dtCalendarState.viewMonth--;
          if (dtCalendarState.viewMonth < 0) { dtCalendarState.viewMonth = 11; dtCalendarState.viewYear--; }
        } else if (action === 'next') {
          dtCalendarState.viewMonth++;
          if (dtCalendarState.viewMonth > 11) { dtCalendarState.viewMonth = 0; dtCalendarState.viewYear++; }
        } else if (action === 'today') {
          var today = new Date();
          dtCalendarState.viewYear = today.getFullYear();
          dtCalendarState.viewMonth = today.getMonth();
          dtCalendarState.selectedDate = todayKey;
          if (appState.quickEditor.surface === 'date') {
            applyQuickDateSelection(todayKey);
            return;
          }
          setQuickDate(todayKey, 'today'); handleQuickDraftChange();
        }
        renderDatetimeCalendar(container, dtCalendarState.selectedDate);
      });
    });

    container.querySelectorAll('[data-cal-date]').forEach(function(dayBtn) {
      dayBtn.addEventListener('click', function() {
        dtCalendarState.selectedDate = dayBtn.dataset.calDate;
        if (appState.quickEditor.surface === 'date') {
          applyQuickDateSelection(dtCalendarState.selectedDate);
          return;
        }
        setQuickDate(dtCalendarState.selectedDate, 'custom'); renderDatetimeCalendar(container, dtCalendarState.selectedDate); handleQuickDraftChange();
      });
    });
  }

  function openQuickTool(tool) {
    if (tool === 'more') { openQuickFullPanel(); return; }
    setQuickSurface(tool);
  }

  function isQuickFullPanelOpen() {
    return Boolean(els.quickFullPanel && !els.quickFullPanel.hidden);
  }

  function quickPanelHost() {
    return isQuickFullPanelOpen() ? els.quickFullBody : els.quickExtraPanel;
  }

  function replaceQuickPanel(html) {
    var host = quickPanelHost();
    if (!host) return;
    host.innerHTML = html;
    if (host === els.quickExtraPanel) host.hidden = false;
  }

  function renderPrioritySurface() {
    var current = PRIORITY_TO_QUAD[els.quickPriority.value] || 'q4';
    var html = '<div class="quick-priority-panel"><div class="quick-priority-grid">';
    QUAD_PRIORITIES.forEach(function(q) {
      html += '<button type="button" class="quick-priority-quad q' + q.value.charAt(1) + (current === q.value ? ' is-selected' : '') + '" data-quad="' + q.value + '"><span class="quick-priority-roman">' + q.roman + '</span><span class="quick-priority-label">' + q.label + '</span><span class="quick-priority-desc">' + q.desc + '</span></button>';
    });
    replaceQuickPanel(html + '</div></div>');
    quickPanelHost().querySelectorAll('[data-quad]').forEach(function(btn) { btn.addEventListener('click', function() { setChoiceValue('quick-priority', btn.dataset.quad); handleQuickDraftChange(); renderPrioritySurface(); }); });
  }

  function renderAreaSurface() {
    var current = els.quickArea.value;
    var html = '<div class="quick-area-panel">';
    Object.keys(AREA_LABELS).forEach(function(key) {
      html += '<button type="button" class="quick-area-item' + (current === key ? ' is-selected' : '') + '" data-area="' + key + '"><span class="quick-area-icon" style="background:' + AREA_COLORS[key] + '22;color:' + AREA_COLORS[key] + '">' + AREA_ICONS[key] + '</span><span class="quick-area-info"><span class="quick-area-name">' + AREA_LABELS[key] + '</span></span><span class="quick-area-check">' + (current === key ? '✓' : '') + '</span></button>';
    });
    replaceQuickPanel(html + '</div>');
    quickPanelHost().querySelectorAll('[data-area]').forEach(function(btn) { btn.addEventListener('click', function() { setChoiceValue('quick-area', btn.dataset.area); handleQuickDraftChange(); renderAreaSurface(); }); });
  }

  function renderToneSurface() {
    var current = els.quickTone.value;
    var html = '<div class="quick-tone-panel"><div class="quick-tone-grid">';
    TONE_LIST.forEach(function(tone) { var none = tone.value === ''; html += '<button type="button" class="quick-tone-swatch' + (none ? ' quick-tone-none' : '') + (current === tone.value ? ' is-selected' : '') + '" data-tone="' + tone.value + '" style="' + (none ? '' : 'background:' + tone.color) + '">' + (none ? '✕' : '') + '</button>'; });
    replaceQuickPanel(html + '</div></div>');
    quickPanelHost().querySelectorAll('[data-tone]').forEach(function(btn) { btn.addEventListener('click', function() { setChoiceValue('quick-tone', btn.dataset.tone); handleQuickDraftChange(); renderToneSurface(); }); });
  }

  function renderDateSurface() {
    if (appState.quickEditor.dateChild === 'none') renderDateParent();
    else renderDateChild(appState.quickEditor.dateChild);
  }

  function hasScheduleDependentValues(draft) {
    return Boolean(draft.startDate || draft.endDate || draft.timeMode !== 'all-day' || draft.startTime || draft.endTime ||
      draft.repeat !== 'none' || draft.customRepeat || draft.reminder !== 'none' || draft.customReminder);
  }

  function isPendingConfirmationOpen() {
    var panel = quickPanelHost();
    return Boolean(panel && panel.querySelector('[data-pending-cancel]'));
  }

  function applyPendingDate() {
    applyQuickDraft(QuickEditor.setPending(readQuickDraft()));
    handleQuickDraftChange();
    renderDateParent(true);
  }

  function renderPendingConfirmation() {
    replaceQuickPanel('<section class="quick-pending-confirmation" aria-labelledby="quick-pending-title"><strong id="quick-pending-title">设为待定？</strong><p>这会清除日期、时间、提醒和重复设置。</p><div><button type="button" data-pending-cancel="true">取消</button><button type="button" data-pending-confirm="true">设为待定</button></div></section>');
    var panel = quickPanelHost();
    var cancel = panel.querySelector('[data-pending-cancel]');
    cancel.addEventListener('click', function() { renderDateParent(true); });
    panel.querySelector('[data-pending-confirm]').addEventListener('click', applyPendingDate);
    cancel.focus();
  }

  function requestPendingDate() {
    if (hasScheduleDependentValues(readQuickDraft())) {
      appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_TOOL', tool: 'date' });
      renderPendingConfirmation();
    } else {
      applyPendingDate();
    }
  }

  function applyQuickDateSelection(dateKey) {
    var draft = readQuickDraft();
    var wasClamped = appState.quickEditor.datePhase === 'end' && Boolean(draft.startDate) && dateKey < draft.startDate;
    applyQuickDraft(QuickEditor.setDraftDate(draft, appState.quickEditor.datePhase, dateKey));
    handleQuickDraftChange();
    if (wasClamped) showToast('结束日期不能早于开始日期，已调整为开始日期');
    renderDateParent();
  }

  function renderDateParent(focusPending) {
    var draft = readQuickDraft();
    var phase = appState.quickEditor.datePhase;
    var html = '<div class="quick-datetime-panel"><div class="quick-date-tabs" role="tablist" aria-label="日期范围"><button role="tab" aria-selected="' + String(phase === 'start') + '" data-date-phase="start">开始</button><button role="tab" aria-selected="' + String(phase === 'end') + '" data-date-phase="end">结束</button></div><div id="quick-dt-calendar-container"></div><div class="quick-datetime-quick" id="quick-date-presets"></div><div class="quick-date-settings"><button type="button" data-date-child="time"><span>时间</span><strong id="quick-date-time-summary">' + escapeHtml(getQuickSummary().timeLabel) + '</strong></button><button type="button" data-date-child="reminder"><span>提醒</span><strong id="quick-date-reminder-summary">' + escapeHtml(formatReminderLabel(draft.reminder, draft.customReminder)) + '</strong></button><button type="button" data-date-child="repeat"><span>重复</span><strong id="quick-date-repeat-summary">' + escapeHtml(formatRepeatLabel(draft.repeat, draft.customRepeat)) + '</strong></button></div></div>';
    replaceQuickPanel(html);
    dtCalendarState.viewYear = 0;
    renderDatetimeCalendar(document.getElementById('quick-dt-calendar-container'), phase === 'start' ? draft.startDate : draft.endDate);
    var presetHost = document.getElementById('quick-date-presets');
    var phaseValue = phase === 'start' ? draft.startDate : draft.endDate;
    [{ key: 'today', label: '今天', value: appState.todayKey }, { key: 'tomorrow', label: '明天', value: tomorrowKey() }, { key: 'weekend', label: '周末', value: weekendKey() }, { key: 'pending', label: '待定', value: '' }].forEach(function(item) {
      var btn = document.createElement('button');
      var selected = phaseValue === item.value;
      btn.type = 'button'; btn.className = 'quick-datetime-quick-btn' + (selected ? ' is-selected' : ''); btn.dataset.datePreset = item.key; btn.setAttribute('aria-pressed', String(selected)); btn.textContent = item.label;
      btn.addEventListener('click', function() {
        if (!item.value) {
          requestPendingDate();
          return;
        }
        applyQuickDateSelection(item.value);
      });
      presetHost.appendChild(btn);
    });
    quickPanelHost().querySelectorAll('[data-date-phase]').forEach(function(btn) { btn.addEventListener('click', function() { appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SET_DATE_PHASE', phase: btn.dataset.datePhase }); renderDateParent(); }); });
    quickPanelHost().querySelectorAll('[data-date-child]').forEach(function(btn) { btn.addEventListener('click', function() { appState.quickChildDraft = QuickEditor.createChildDraft(readQuickDraft(), btn.dataset.dateChild); appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'OPEN_DATE_CHILD', child: btn.dataset.dateChild }); renderDateSurface(); }); });
    if (focusPending) {
      var pendingButton = quickPanelHost().querySelector('[data-date-preset="pending"]');
      if (pendingButton) pendingButton.focus();
    }
  }

  function commitDateChild() {
    var merged = QuickEditor.applyChildDraft(readQuickDraft(), appState.quickChildDraft);
    var validity = QuickEditor.validateSchedule(merged);
    if (!validity.valid) { var error = quickPanelHost().querySelector('.quick-date-child-error'); if (error) error.textContent = validity.message; return false; }
    applyQuickDraft(merged);
    handleQuickDraftChange();
    return true;
  }

  function finishDateChild(commit) {
    if (commit && !commitDateChild()) return;
    appState.quickChildDraft = null;
    appState.quickChildWheels = null;
    appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'CLOSE_DATE_CHILD' });
    renderDateSurface();
  }

  function renderDateChild(type) {
    var child = appState.quickChildDraft || QuickEditor.createChildDraft(readQuickDraft(), type);
    appState.quickChildDraft = child;
    var labels = { time: '时间', reminder: '提醒', repeat: '重复' };
    replaceQuickPanel('<div class="quick-date-child-panel"><div class="quick-date-child-head"><button type="button" data-child-back="true">返回</button><strong>' + labels[type] + '</strong><button type="button" data-child-confirm="true">确定</button></div><div class="quick-date-child-content"></div><p class="quick-date-child-error" aria-live="polite"></p></div>');
    var panel = quickPanelHost();
    var content = panel.querySelector('.quick-date-child-content');
    if (type === 'time') renderTimeDateChild(content, child);
    else renderChoiceDateChild(content, child, type);
    panel.querySelector('[data-child-back]').addEventListener('click', function() { finishDateChild(false); });
    panel.querySelector('[data-child-confirm]').addEventListener('click', function() { finishDateChild(true); });
  }

  function renderTimeDateChild(content, child) {
    var mode = ['all-day', 'point', 'range'].includes(child.timeMode) ? child.timeMode : 'all-day';
    var phase = mode === 'range' ? (child.timePhase || 'start') : 'start';
    child.timeMode = mode;
    child.timePhase = phase;
    var tabs = mode === 'range' ? '<div class="quick-date-tabs" role="tablist" aria-label="时间范围"><button role="tab" aria-selected="' + String(phase === 'start') + '" data-time-phase="start">开始</button><button role="tab" aria-selected="' + String(phase === 'end') + '" data-time-phase="end">结束</button></div>' : '';
    content.innerHTML = '<div class="quick-time-mode-options" role="group" aria-label="时间类型"><button type="button" data-child-time-mode="all-day" aria-pressed="' + String(mode === 'all-day') + '">全天</button><button type="button" data-child-time-mode="point" aria-pressed="' + String(mode === 'point') + '">时间点</button><button type="button" data-child-time-mode="range" aria-pressed="' + String(mode === 'range') + '">时间段</button></div>' + tabs + '<div class="picker-wheels-row quick-date-child-wheels"' + (mode === 'all-day' ? ' hidden' : '') + '></div>';
    var wheels = content.querySelector('.quick-date-child-wheels');
    if (mode !== 'all-day') {
      var value = phase === 'end' ? child.endTime : child.startTime;
      var parts = value.split(':').map(Number);
      var hours = Array.from({ length: 24 }, function(_, i) { return { label: String(i).padStart(2, '0') + '时', value: i }; });
      var minutes = Array.from({ length: 60 }, function(_, i) { return { label: String(i).padStart(2, '0') + '分', value: i }; });
      appState.quickChildWheels = {
        hours: createPickerWheel(wheels, hours, parts[0] || 0, 'picker-col-hours'),
        minutes: createPickerWheel(wheels, minutes, parts[1] || 0, 'picker-col-minutes')
      };
    }
    function saveWheelValue() { if (!appState.quickChildWheels) return; var time = String(appState.quickChildWheels.hours.getValue()).padStart(2, '0') + ':' + String(appState.quickChildWheels.minutes.getValue()).padStart(2, '0'); child[phase === 'end' ? 'endTime' : 'startTime'] = time; }
    content.querySelectorAll('[data-time-phase]').forEach(function(btn) { btn.addEventListener('click', function() { saveWheelValue(); child.timePhase = btn.dataset.timePhase; renderDateChild('time'); }); });
    content.querySelectorAll('[data-child-time-mode]').forEach(function(btn) { btn.addEventListener('click', function() { saveWheelValue(); child.timeMode = btn.dataset.childTimeMode; child.timePhase = 'start'; if (child.timeMode === 'range' && !child.endTime) child.endTime = QuickEditor.defaultEndTime(child.startTime || '09:00'); renderDateChild('time'); }); });
    var confirm = quickPanelHost().querySelector('[data-child-confirm]');
    confirm.addEventListener('click', saveWheelValue);
  }

  function renderChoiceDateChild(content, child, type) {
    var options = type === 'repeat' ? [{ value: 'none', label: '不重复' }, { value: 'daily', label: '每天' }, { value: 'weekdays', label: '工作日' }, { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' }, { value: 'custom', label: '自定义' }] : [{ value: 'none', label: '不提醒' }, { value: 'at-time', label: '准时' }, { value: '5', label: '5分钟前' }, { value: '15', label: '15分钟前' }, { value: '30', label: '30分钟前' }, { value: '60', label: '1小时前' }, { value: 'custom', label: '自定义' }];
    var selected = type === 'repeat' ? child.repeat : child.reminder;
    content.innerHTML = '<div class="quick-date-choice-list">' + options.map(function(opt) { return '<button type="button" class="quick-area-item' + (selected === opt.value ? ' is-selected' : '') + '" data-child-choice="' + opt.value + '"><span class="quick-area-name">' + opt.label + '</span><span class="quick-area-check">' + (selected === opt.value ? '✓' : '') + '</span></button>'; }).join('') + '</div>';
    content.querySelectorAll('[data-child-choice]').forEach(function(btn) { btn.addEventListener('click', function() { var value = btn.dataset.childChoice; if (type === 'repeat') { child.repeat = value; if (value !== 'custom') child.customRepeat = null; } else { child.reminder = value; if (value !== 'custom') child.customReminder = null; } if (value === 'custom') { if (type === 'repeat') child.customRepeat = child.customRepeat || { interval: 1, unit: 'day', skipHolidays: false, skipWeekends: false }; else child.customReminder = child.customReminder || { days: 0, hours: 0, minutes: 5 }; } renderDateChild(type); }); });
    if (selected !== 'custom') return;
    var row = document.createElement('div');
    row.className = 'picker-wheels-row' + (type === 'reminder' ? ' three-cols' : '');
    content.appendChild(row);
    if (type === 'repeat') {
      var repeat = child.customRepeat;
      var intervals = Array.from({ length: 30 }, function(_, i) { return { label: '每' + (i + 1), value: i + 1 }; });
      var units = [{ label: '天重复', value: 'day' }, { label: '周重复', value: 'week' }, { label: '月重复', value: 'month' }];
      appState.quickChildWheels = { interval: createPickerWheel(row, intervals, repeat.interval - 1, 'picker-col-interval'), unit: createPickerWheel(row, units, Math.max(0, ['day', 'week', 'month'].indexOf(repeat.unit)), 'picker-col-unit') };
      var toggles = document.createElement('div');
      toggles.className = 'picker-toggles';
      toggles.innerHTML = '<label class="picker-toggle"><input type="checkbox" data-child-skip="holidays"' + (repeat.skipHolidays ? ' checked' : '') + '><span>跳过法定节假日</span></label><label class="picker-toggle"><input type="checkbox" data-child-skip="weekends"' + (repeat.skipWeekends ? ' checked' : '') + '><span>跳过双休日</span></label>';
      content.appendChild(toggles);
      quickPanelHost().querySelector('[data-child-confirm]').addEventListener('click', function() { child.customRepeat = { interval: appState.quickChildWheels.interval.getValue(), unit: appState.quickChildWheels.unit.getValue(), skipHolidays: Boolean(content.querySelector('[data-child-skip="holidays"]').checked), skipWeekends: Boolean(content.querySelector('[data-child-skip="weekends"]').checked) }; });
    } else {
      var reminder = child.customReminder;
      var days = Array.from({ length: 8 }, function(_, i) { return { label: i + '天', value: i }; });
      var hours = Array.from({ length: 24 }, function(_, i) { return { label: i + '小时', value: i }; });
      var minutes = Array.from({ length: 60 }, function(_, i) { return { label: i + '分钟', value: i }; });
      appState.quickChildWheels = { days: createPickerWheel(row, days, reminder.days, 'picker-col-days'), hours: createPickerWheel(row, hours, reminder.hours, 'picker-col-hours'), minutes: createPickerWheel(row, minutes, reminder.minutes, 'picker-col-minutes') };
      quickPanelHost().querySelector('[data-child-confirm]').addEventListener('click', function(event) { var next = { days: appState.quickChildWheels.days.getValue(), hours: appState.quickChildWheels.hours.getValue(), minutes: appState.quickChildWheels.minutes.getValue() }; if (!next.days && !next.hours && !next.minutes) { event.stopImmediatePropagation(); var error = quickPanelHost().querySelector('.quick-date-child-error'); if (error) error.textContent = '提醒时间不能为0'; return; } child.customReminder = next; });
    }
  }

  function rescheduleNotifications() {
    if (!NotificationService) return;
    var generation = notificationLifecycleGeneration;
    DB.getAllData().then(function(data) {
      appState.data = data;
      showMissedReminderToast(data);
      if (!isNotificationLifecycleCurrent(generation)) return;
      NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
      syncNotificationsWithoutBlocking(data, generation);
    }).catch(function() {});
  }

  window.TodayYouxuReschedule = rescheduleNotifications;
  window.updateQuickChips = function() { updateToolStates(); };

  function loadData() {
    var generation = notificationLifecycleGeneration;
    return DB.getAllData().then(function(data) {
      appState.data = data;
      render();
      updateNotificationUI();
      if (NotificationService && isNotificationLifecycleCurrent(generation)) {
        showMissedReminderToast(data);
        NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
      }
      syncNotificationsWithoutBlocking(data, generation);
    }).catch(function(error) {
      showToast('本地数据库读取失败：' + error.message);
    });
  }

  function handleQuickSubmit(event) {
    event.preventDefault();
    var draft = readQuickDraft();
    var draftValidity = QuickEditor.validateDraft(draft);
    if (!draftValidity.valid) {
      showToast(draftValidity.message);
      return;
    }
    var title = draft.title.trim();

    var priorityRaw = els.quickPriority.value;
    var priorityForDb = QUAD_TO_PRIORITY[priorityRaw] || 'medium';

    var repeat = els.quickRepeat.value || 'none';
    var reminder = els.quickReminder.value || 'none';
    var payload = {
      title: title,
      notes: draft.notes,
      date: draft.startDate,
      endDate: els.quickEndDate.value || draft.startDate,
      priority: priorityForDb,
      area: draft.area || 'life',
      tone: draft.tone || '',
      timeMode: draft.timeMode,
      startTime: draft.startTime,
      endTime: draft.timeMode === 'range' ? draft.endTime : '',
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
    function createHabitPayload() {
      var habitData = Object.assign({}, payload, {
        schedule: repeat,
        customRepeat: repeat === 'custom' ? appState.customRepeat : null,
        startDate: payload.date,
        weekday: payload.date ? DateUtils.fromDateKey(payload.date).getDay() : DateUtils.fromDateKey(appState.todayKey).getDay()
      });
      delete habitData.endDate;
      return habitData;
    }
    if (wasEditing && appState.editingType === 'habit') {
      var habitPayload = {
        title: title,
        notes: els.quickNotes.value,
        area: els.quickArea.value || 'life',
        priority: priorityForDb,
        tone: draft.tone || '',
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
        var convertingTaskId = appState.editingTaskId;
        action = DB.createHabit(createHabitPayload()).then(function() {
          return DB.purgeTask(convertingTaskId);
        });
      } else {
        action = DB.updateTask(appState.editingTaskId, payload);
      }
    } else {
      action = repeat === 'none'
        ? DB.createTask(payload)
        : DB.createHabit(createHabitPayload());
    }

    action.then(function() {
      if (!wasEditing) clearCreateDraft();
      closeQuickSession({ keepDraft: false, restoreFocus: true });
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
      if (appState.view === 'calendar') {
        openDateDetail();
      }
    } else if (action === 'close-date-detail') {
      closeDateDetail();
    } else if (action === 'date-detail-add') {
      closeDateDetail();
      openSheet();
    } else if (action === 'notification-setup') {
      handleNotificationAction();
    } else if (action === 'notification-disable') {
      handleNotificationDisable();
    }
  }

  function openLockedQuickEditSession() {
    appState.quickEditor = QuickEditor.transition(
      QuickEditor.createSessionState(appState.editingType === 'habit' ? 'edit-habit' : 'edit-task'),
      { type: 'OPEN' }
    );
    els.sheetBackdrop.hidden = false;
    els.quickSheet.hidden = false;
    els.quickSheet.removeAttribute('aria-hidden');
    els.quickSheet.inert = false;
    lockQuickEditorScroll();
    setQuickEditorBackgroundInert(true);
    updateQuickViewportHeight();
    void els.quickSheet.offsetHeight;
    updateQuickSummary();
    focusQuickTitle();
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
    var _editTitle = $('quick-sheet-title');
    if (_editTitle) _editTitle.textContent = '编辑事项';
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
    els.quickDate.value = task.date || '';
    els.quickEndDate.value = task.endDate || task.date || '';
    els.quickNotes.value = task.notes || '';
    updateTimeDisplay();
    if (els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = true;
      els.quickRepeatCustomHint.textContent = '';
    }
    setQuickDate(task.date || '');
    setChoiceValue('quick-tone', task.tone || '');
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
    closeQuickExtra();
    closeQuickFullPanel();
    updateToolStates();
    autoResizeTextarea(els.quickNotes);
    openLockedQuickEditSession();
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
    var _habitTitle = $('quick-sheet-title');
    if (_habitTitle) _habitTitle.textContent = '编辑习惯';
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
    els.quickDate.value = habit.startDate || appState.todayKey;
    els.quickEndDate.value = habit.startDate || appState.todayKey;
    els.quickNotes.value = habit.notes || '';
    updateTimeDisplay();
    if (scheduleVal === 'custom' && habit.customRepeat && els.quickRepeatCustomHint) {
      els.quickRepeatCustomHint.hidden = false;
      els.quickRepeatCustomHint.textContent = formatRepeatLabel('custom', habit.customRepeat);
    }
    setQuickDate(habit.startDate || appState.todayKey);
    setChoiceValue('quick-tone', habit.tone || '');
    if (els.quickMoreSettings) els.quickMoreSettings.open = false;
    closeQuickExtra();
    closeQuickFullPanel();
    updateToolStates();
    autoResizeTextarea(els.quickNotes);
    openLockedQuickEditSession();
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
    else if (permission === 'denied') status = 'permission-denied';
    else if (permission === 'default' && status !== 'subscribing' && status !== 'syncing') status = 'permission-required';
    else if (!NOTIFICATION_STATUS_COPY[status]) status = 'error';
    var label = notificationBackendStatus.repairing && (status === 'subscribing' || status === 'syncing')
      ? '正在重新连接'
      : NOTIFICATION_STATUS_COPY[status];
    return {
      status: status,
      label: label,
      desc: label,
      action: NOTIFICATION_ACTION_COPY[status] || '开启提醒'
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
        els.notificationButton.textContent = info.action;
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
    var generation = notificationLifecycleGeneration;
    if (!NotificationService || !isNotificationLifecycleCurrent(generation)) return;
    try {
      await waitForNotificationLifecycleOperation(generation);
      if (!isNotificationLifecycleCurrent(generation)) return;
      if (!NotificationSync || notificationSetupState === 'idle' || notificationSetupOwner) {
        await registerServiceWorker(generation);
      }
      if (notificationSyncOwner) await notificationSyncOwner.promise;
      if (!isNotificationLifecycleCurrent(generation) || notificationSetupState !== 'complete' || !NotificationSync) return;
      var info = getNotificationStatusInfo();
      if (info.status === 'ready') {
        return await runNotificationLifecycleOperation(generation, function() {
          setNotificationBackendStatus({ status: 'syncing' }, generation);
          if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
          return NotificationSync.sendTest();
        }, true);
      }
      if (info.status === 'permission-denied') {
        showToast('iPhone 设置 > App > 今日有序 > 通知');
        return notificationBackendStatus;
      }
      var repairing = info.status === 'reauthorization-required';
      var permission = window.Notification && window.Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
        if (!isNotificationLifecycleCurrent(generation)) return;
        if (permission !== 'granted') {
          setNotificationBackendStatus({ status: permission === 'denied' ? 'permission-denied' : 'permission-required' }, generation);
          showToast(permission === 'denied' ? 'iPhone 设置 > App > 今日有序 > 通知' : '未开启通知权限');
          return;
        }
      }
      if (!isNotificationLifecycleCurrent(generation)) return;
      return await runNotificationLifecycleOperation(generation, function() {
        NotificationService.setEnabled(true);
        NotificationService.scheduleAll(appState.data, appState.todayKey, State.habitDueOn);
        setNotificationBackendStatus({ status: 'subscribing', repairing: repairing }, generation);
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        return NotificationSync.enable().then(function(enabledStatus) {
          if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
          setNotificationBackendStatus(enabledStatus, generation);
          if (enabledStatus.status !== 'ready') return enabledStatus;
          return queueNotificationSync(appState.data, generation, repairing).then(function(syncedStatus) {
            if (!isNotificationLifecycleCurrent(generation) || syncedStatus.status !== 'ready') return syncedStatus;
            return NotificationSync.sendTest();
          });
        });
      }, true);
    } catch (error) {
      handleNotificationBackendFailure(error, generation);
    }
  }

  async function handleNotificationDisable() {
    var generation = notificationLifecycleGeneration;
    if (!NotificationService || !isNotificationLifecycleCurrent(generation)) return;
    try {
      await waitForNotificationLifecycleOperation(generation);
      if (!isNotificationLifecycleCurrent(generation)) return;
      if (!NotificationSync || notificationSetupState === 'idle' || notificationSetupOwner) {
        await registerServiceWorker(generation);
      }
      if (!isNotificationLifecycleCurrent(generation) || notificationSetupState !== 'complete' || !NotificationSync || getNotificationStatusInfo().status !== 'ready') return;
      return await runNotificationLifecycleOperation(generation, function() {
        NotificationService.setEnabled(false);
        setNotificationBackendStatus({ status: 'pending' }, generation);
        if (!isNotificationLifecycleCurrent(generation)) return notificationBackendStatus;
        return NotificationSync.disable();
      }, true);
    } catch (error) {
      handleNotificationBackendFailure(error, generation);
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

  function createPickerWheel(mount, options, selectedIndex, columnClass) {
    if (Array.isArray(mount)) {
      columnClass = selectedIndex;
      selectedIndex = options;
      options = mount;
      mount = null;
    }
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
    if (mount) mount.appendChild(container);

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
    handleQuickDraftChange();
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
      handleQuickDraftChange();
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
    els.dateDetailBackdrop = $('date-detail-backdrop');
    els.dateDetailModal = $('date-detail-modal');
    els.dateDetailTitle = $('date-detail-title');
    els.dateDetailSubtitle = $('date-detail-subtitle');
    els.dateDetailList = $('date-detail-list');
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
    els.quickEndDate = $('quick-end-date');
    els.quickSummary = $('quick-summary');
    els.quickDragHandle = $('quick-drag-handle');
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
    els.quickTone = $('quick-tone');
    els.quickTools = $('quick-tools');
    els.quickExtraPanel = $('quick-extra-panel');
    els.quickFullPanel = $('quick-full-panel');
    els.quickFullBody = $('quick-full-body');
    els.quickFullTitle = $('quick-full-title');
    els.quickFullBack = $('quick-full-back');
    els.quickFullSave = $('quick-full-save');
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
    document.querySelectorAll('[data-action="prev-month"]').forEach(function(btn) {
      btn.addEventListener('click', function() { changeMonth(-1); });
    });
    document.querySelectorAll('[data-action="today-month"]').forEach(function(btn) {
      btn.addEventListener('click', jumpToTodayMonth);
    });
    document.querySelectorAll('[data-action="next-month"]').forEach(function(btn) {
      btn.addEventListener('click', function() { changeMonth(1); });
    });
    els.calendarToggle.addEventListener('click', function() {
      appState.calendarCollapsed = !appState.calendarCollapsed;
      renderCalendar();
    });
    els.openAdd.addEventListener('click', openSheet);
    if (els.closeAdd) els.closeAdd.addEventListener('click', function() {
      closeQuickSession({ keepDraft: true, restoreFocus: true });
    });
    if (els.cancelAdd) els.cancelAdd.addEventListener('click', function() {
      closeQuickSession({ keepDraft: true, restoreFocus: true });
    });
    els.sheetBackdrop.addEventListener('click', function() {
      closeQuickSession({ keepDraft: true, restoreFocus: true });
    });
    if (els.dateDetailBackdrop) els.dateDetailBackdrop.addEventListener('click', closeDateDetail);
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
        handleQuickDraftChange();
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
        handleQuickDraftChange();
      });
    });
    document.addEventListener('click', function(event) {
      if (!event.target.closest('.custom-select')) closeSelectMenus();
    });
    document.addEventListener('keydown', trapQuickEditorFocus);
    if (els.quickTools) {
      els.quickTools.addEventListener('click', function(event) {
        var btn = event.target.closest('.quick-tool-btn');
        if (!btn) return;
        var tool = btn.dataset.tool;
        openQuickTool(tool);
      });
    }
    if (els.quickNotes) {
      els.quickNotes.addEventListener('input', function() {
        autoResizeTextarea(els.quickNotes);
        handleQuickDraftChange();
      });
    }
    function closePanelsOnInputFocus() {
      var extraOpen = els.quickExtraPanel && !els.quickExtraPanel.hidden;
      var fullOpen = els.quickFullPanel && !els.quickFullPanel.hidden;
      if (extraOpen) {
        appState.quickEditor = QuickEditor.transition(appState.quickEditor, { type: 'SHOW_KEYBOARD' });
        renderQuickSurface();
      }
      if (fullOpen) closeQuickFullPanel();
    }
    if (els.quickTitle) {
      els.quickTitle.addEventListener('focus', closePanelsOnInputFocus);
      els.quickTitle.addEventListener('input', handleQuickDraftChange);
    }
    if (els.quickNotes) {
      els.quickNotes.addEventListener('focus', closePanelsOnInputFocus);
    }
    if (els.quickChipsRow) {
      els.quickChipsRow.addEventListener('click', function(event) {
        var btn = event.target.closest('.chip-remove');
        if (!btn) return;
        var chipType = btn.dataset.chipType;
        if (chipType === 'date') {
          requestPendingDate();
          return;
        } else if (chipType === 'priority') {
          setChoiceValue('quick-priority', 'medium');
        } else if (chipType === 'repeat') {
          setChoiceValue('quick-repeat', 'none');
        } else if (chipType === 'reminder') {
          setChoiceValue('quick-reminder', 'none');
        }
        handleQuickDraftChange();
      });
    }
    [
      els.quickPriority, els.quickArea, els.quickDate, els.quickEndDate,
      els.quickRepeat, els.quickTimeMode, els.quickReminder,
      els.quickStartTime, els.quickEndTime, els.quickTone
    ].forEach(function(input) {
      if (input) input.addEventListener('change', handleQuickDraftChange);
    });
    if (els.quickDragHandle) bindQuickDragHandle();
    if (els.quickExtraPanel) {
      els.quickExtraPanel.addEventListener('click', function(event) {
        if (event.target.classList.contains('quick-extra-close')) {
          closeQuickExtra();
        }
      });
    }
    if (els.quickFullBack) {
      els.quickFullBack.addEventListener('click', function() {
        if (appState.quickEditor.surface !== 'detail') {
          returnQuickFullToDetailSummary();
          return;
        }
        closeQuickFullPanel({ focusTitle: true });
      });
    }
    if (els.quickFullSave) {
      els.quickFullSave.addEventListener('click', function() {
        closeQuickFullPanel({ focusTitle: true });
      });
    }
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
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function() {
        if (isQuickEditorOpen()) updateQuickViewportHeight();
      });
    }
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
      var generation = notificationLifecycleGeneration;
      if (!isNotificationLifecycleCurrent(generation)) return;
      recoverNotificationOnline(generation).catch(function(error) {
        handleNotificationBackendFailure(error, generation);
      });
    });
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        if (isQuickEditorOpen() && !appState.editingTaskId) persistCreateDraft();
        cancelNotificationRecovery();
        return;
      }
      var generation = activateNotificationLifecycle();
      recoverNotificationForeground(generation).catch(function(error) {
        handleNotificationBackendFailure(error, generation);
      });
    });
    window.addEventListener('pagehide', function() {
      if (isQuickEditorOpen() && !appState.editingTaskId) persistCreateDraft();
      cancelNotificationRecovery();
    });
  }

  function activateNotificationLifecycle() {
    if (document.hidden) return null;
    notificationLifecycleActive = true;
    return notificationLifecycleGeneration;
  }

  function isNotificationLifecycleCurrent(generation) {
    return generation != null && notificationLifecycleActive && !document.hidden && generation === notificationLifecycleGeneration;
  }

  function waitForNotificationLifecycleOperation(generation) {
    var owner = notificationLifecycleOperation;
    if (!owner || !isNotificationLifecycleCurrent(generation)) return Promise.resolve(notificationBackendStatus);
    return owner.promise.then(function() {
      return notificationBackendStatus;
    }, function() {
      return notificationBackendStatus;
    });
  }

  function runNotificationLifecycleOperation(generation, operation, waitForCurrent) {
    var operationGeneration = generation == null ? notificationLifecycleGeneration : generation;
    if (!isNotificationLifecycleCurrent(operationGeneration)) return Promise.resolve(notificationBackendStatus);
    if (notificationLifecycleOperation) {
      if (!waitForCurrent) return notificationLifecycleOperation.promise;
      return waitForNotificationLifecycleOperation(operationGeneration).then(function() {
        return runNotificationLifecycleOperation(operationGeneration, operation, true);
      });
    }

    var owner = { generation: operationGeneration, promise: null };
    notificationLifecycleOperation = owner;
    var operationResult;
    try {
      operationResult = operation();
    } catch (error) {
      operationResult = Promise.reject(error);
    }
    owner.promise = Promise.resolve(operationResult).then(function(status) {
      if (notificationLifecycleOperation !== owner) return notificationBackendStatus;
      notificationLifecycleOperation = null;
      if (!isNotificationLifecycleCurrent(operationGeneration)) return notificationBackendStatus;
      return setNotificationBackendStatus(status && status.status ? status : notificationBackendStatus, operationGeneration);
    }, function(error) {
      if (notificationLifecycleOperation !== owner) return notificationBackendStatus;
      notificationLifecycleOperation = null;
      if (!isNotificationLifecycleCurrent(operationGeneration)) return notificationBackendStatus;
      throw error;
    });
    return owner.promise;
  }

  function ensureNotificationSetup(generation) {
    if (notificationSetupState === 'complete' && NotificationSync) return Promise.resolve(notificationBackendStatus);
    return registerServiceWorker(generation);
  }

  function recoverNotificationLifecycle(method, generation) {
    var recoveryGeneration = generation == null ? notificationLifecycleGeneration : generation;
    return runNotificationLifecycleOperation(recoveryGeneration, function() {
      return ensureNotificationSetup(recoveryGeneration).then(function(setupStatus) {
        if (!isNotificationLifecycleCurrent(recoveryGeneration)) return notificationBackendStatus;
        if (notificationSetupState !== 'complete' || !NotificationSync || typeof NotificationSync[method] !== 'function') {
          return setupStatus && setupStatus.status ? setupStatus : notificationBackendStatus;
        }
        var repairing = notificationBackendStatus.status === 'reauthorization-required'
          && NotificationService && NotificationService.getPermissionStatus() === 'granted';
        if (repairing) {
          setNotificationBackendStatus({ status: 'subscribing', repairing: true }, recoveryGeneration);
        }
        var repairedSubscription = false;
        return NotificationSync[method]().then(function(status) {
          if (!isNotificationLifecycleCurrent(recoveryGeneration)) return notificationBackendStatus;
          repairedSubscription = repairing && status.status === 'ready';
          setNotificationBackendStatus(repairedSubscription
            ? { status: 'syncing', repairing: true }
            : status, recoveryGeneration);
          return DB.getAllData().then(function(data) {
            if (!isNotificationLifecycleCurrent(recoveryGeneration) || !data) return notificationBackendStatus;
            appState.data = data;
            if (NotificationService) NotificationService.scheduleAll(data, appState.todayKey, State.habitDueOn);
            if (!isNotificationLifecycleCurrent(recoveryGeneration)) return notificationBackendStatus;
            return queueNotificationSync(data, recoveryGeneration, repairing);
          }, function(error) {
            if (!isNotificationLifecycleCurrent(recoveryGeneration)) return notificationBackendStatus;
            showToast('本地数据库读取失败：' + error.message);
            if (repairedSubscription) {
              return setNotificationBackendStatus({ status: 'error' }, recoveryGeneration);
            }
            return notificationBackendStatus;
          });
        });
      });
    });
  }

  function recoverNotificationOnline(generation) {
    return recoverNotificationLifecycle('handleOnline', generation);
  }

  function recoverNotificationForeground(generation) {
    return recoverNotificationLifecycle('handleForeground', generation);
  }

  function drainNotificationForeground(generation) {
    var recoveryGeneration = generation == null ? notificationLifecycleGeneration : generation;
    return runNotificationLifecycleOperation(recoveryGeneration, function() {
      return ensureNotificationSetup(recoveryGeneration).then(function(setupStatus) {
        if (!isNotificationLifecycleCurrent(recoveryGeneration)) return notificationBackendStatus;
        if (notificationSetupState !== 'complete' || !NotificationSync || typeof NotificationSync.handleForeground !== 'function') {
          return setupStatus && setupStatus.status ? setupStatus : notificationBackendStatus;
        }
        return NotificationSync.handleForeground();
      });
    });
  }

  function clearNotificationRecoveryTimer() {
    if (notificationRecoveryTimer !== null) {
      clearTimeout(notificationRecoveryTimer);
      notificationRecoveryTimer = null;
    }
  }

  function canScheduleNotificationRecovery(generation) {
    if (!isNotificationLifecycleCurrent(generation) || navigator.onLine === false || notificationBackendStatus.status !== 'pending' || notificationLifecycleOperation) return false;
    if (notificationSetupState === 'unsupported') return false;
    if (notificationSetupState === 'complete' && NotificationSync) return typeof NotificationSync.handleForeground === 'function';
    return 'serviceWorker' in navigator && !notificationSetupOwner;
  }

  function scheduleNotificationRecovery(generation) {
    var recoveryGeneration = generation == null ? notificationLifecycleGeneration : generation;
    if (!canScheduleNotificationRecovery(recoveryGeneration)) {
      clearNotificationRecoveryTimer();
      return;
    }
    if (notificationRecoveryTimer !== null) return;
    notificationRecoveryTimer = setTimeout(function() {
      notificationRecoveryTimer = null;
      if (!canScheduleNotificationRecovery(recoveryGeneration)) return;
      drainNotificationForeground(recoveryGeneration).catch(function(error) {
        if (!isNotificationLifecycleCurrent(recoveryGeneration)) return;
        handleNotificationBackendFailure(error, recoveryGeneration);
      });
    }, 250);
  }

  function cancelNotificationRecovery() {
    notificationLifecycleGeneration += 1;
    notificationLifecycleActive = false;
    clearNotificationRecoveryTimer();
    notificationLifecycleOperation = null;
    pendingNotificationSnapshot = null;
    notificationSyncOwner = null;
    cancelNotificationSetup();
    if (NotificationSync && NotificationSync.cancelActiveRequests) {
      NotificationSync.cancelActiveRequests();
    }
  }

  function releaseNotificationSetup(owner) {
    if (notificationSetupOwner === owner) notificationSetupOwner = null;
  }

  function cacheNotificationRegistration(registration) {
    notificationRegistration = registration;
    return registration;
  }

  function getNotificationRegistration(owner) {
    if (notificationRegistration) return Promise.resolve(notificationRegistration);
    var registrationResult;
    try {
      registrationResult = navigator.serviceWorker.register('/tools/time/sw.js');
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(registrationResult).then(function(registration) {
      if (owner.cancelled || notificationSetupOwner !== owner) throw createNotificationCancellationError();
      return cacheNotificationRegistration(registration);
    });
  }

  function registerServiceWorker(generation) {
    var setupGeneration = generation == null ? notificationLifecycleGeneration : generation;
    if (!isNotificationLifecycleCurrent(setupGeneration)) return Promise.resolve(notificationBackendStatus);
    if (notificationSetupState === 'complete' && NotificationSync) return Promise.resolve(notificationBackendStatus);
    if (notificationSetupState === 'unsupported') {
      return Promise.resolve(setNotificationBackendStatus({ status: 'unsupported' }, setupGeneration));
    }
    if (notificationSetupOwner) return notificationSetupOwner.promise;
    if (!('serviceWorker' in navigator)) {
      notificationSetupState = 'unsupported';
      return Promise.resolve(setNotificationBackendStatus({ status: 'unsupported' }, setupGeneration));
    }
    setNotificationBackendStatus({ status: 'subscribing' }, setupGeneration);
    var owner = {
      generation: setupGeneration,
      cancelled: false,
      cancelDeadline: null,
      promise: null
    };
    notificationSetupOwner = owner;
    var registrationReady = getNotificationRegistration(owner).then(function() {
      if (owner.cancelled) throw createNotificationCancellationError();
      return navigator.serviceWorker.ready;
    });
    var setupWork = withNotificationDeadline(registrationReady, 10000, owner).then(function(reg) {
        if (owner.cancelled) throw createNotificationCancellationError();
        cacheNotificationRegistration(reg);
        if (NotificationService) {
          NotificationService.setServiceWorkerRegistration(reg);
        }
        if (notificationSetupState === 'complete' && NotificationSync) return notificationBackendStatus;
        if (notificationSetupState === 'unsupported') return { status: 'unsupported' };
        if (!NotificationSync && NotificationSyncFactory && NotificationSyncFactory.create) {
          NotificationSync = NotificationSyncFactory.create();
        }
        if (!NotificationSync) {
          notificationSetupState = 'unsupported';
          return { status: 'unsupported' };
        }
        return NotificationSync.setup(reg).then(function(status) {
          if (!status || !status.status) throw new Error('Notification setup returned an invalid status');
          notificationSetupState = status.status === 'unsupported' ? 'unsupported' : 'complete';
          return status;
        });
      });
    owner.promise = setupWork.then(function(status) {
        releaseNotificationSetup(owner);
        if (owner.cancelled || !isNotificationLifecycleCurrent(setupGeneration)) return notificationBackendStatus;
        var publishedStatus = setNotificationBackendStatus(status, setupGeneration);
        if (notificationSetupState === 'complete' && (status.status === 'ready' || status.status === 'pending')) {
          syncNotificationsWithoutBlocking(appState.data, setupGeneration);
        }
        return publishedStatus;
      }, function(error) {
        releaseNotificationSetup(owner);
        if (owner.cancelled || (error && error.notificationCancelled) || !isNotificationLifecycleCurrent(setupGeneration)) return notificationBackendStatus;
        if (error && error.notificationDeadline) {
          return setNotificationBackendStatus({ status: 'pending' }, setupGeneration);
        }
        console.warn('[TodayYouxu] Service worker registration failed:', error);
        return setNotificationBackendStatus({ status: 'error' }, setupGeneration);
      });
    return owner.promise;
  }

  function init() {
    cacheElements();
    var versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = APP_VERSION;
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
