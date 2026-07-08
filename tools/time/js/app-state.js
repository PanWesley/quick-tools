(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuState = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var AREA_OPTIONS = [
    { value: 'life', label: '生活' },
    { value: 'study', label: '学习' },
    { value: 'work', label: '工作' },
    { value: 'health', label: '健康' },
    { value: 'housework', label: '家务' },
    { value: 'memory', label: '纪念' },
    { value: 'other', label: '其他' }
  ];

  function normalizeArea(area) {
    var value = String(area || '').trim();
    return AREA_OPTIONS.some(function(option) { return option.value === value; }) ? value : 'life';
  }

  function areaLabel(area) {
    var normalized = normalizeArea(area);
    var option = AREA_OPTIONS.find(function(item) { return item.value === normalized; });
    return option ? option.label : '生活';
  }

  function filterTasksByArea(tasks, area) {
    if (!area || area === 'all') return tasks || [];
    return (tasks || []).filter(function(task) {
      return normalizeArea(task && task.area) === area;
    });
  }

  function activeOnly(item) {
    return item && item.status !== 'completed' && item.status !== 'deleted' && item.status !== 'archived';
  }

  function getTodayTasks(tasks, todayKey) {
    return (tasks || [])
      .filter(function(task) {
        return activeOnly(task) && task.date && task.date <= todayKey;
      })
      .sort(function(a, b) {
        return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
  }

  function getInboxTasks(tasks) {
    return (tasks || []).filter(function(task) {
      return activeOnly(task) && !task.date;
    });
  }

  function getUpcomingTasks(tasks, todayKey) {
    return (tasks || [])
      .filter(function(task) {
        return activeOnly(task) && task.date && task.date > todayKey;
      })
      .sort(function(a, b) {
        return String(a.date).localeCompare(String(b.date));
      });
  }

  function getCompletedTasks(tasks) {
    return (tasks || [])
      .filter(function(task) {
        return task && task.status === 'completed';
      })
      .sort(function(a, b) {
        return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
      });
  }

  function getDeletedTasks(tasks) {
    return (tasks || [])
      .filter(function(task) {
        return task && task.status === 'deleted';
      })
      .sort(function(a, b) {
        return String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''));
      });
  }

  function getTaskDisplayTitle(task) {
    var title = task && task.title;
    title = title == null ? '' : String(title).trim();
    return title || '未命名任务';
  }

  function weekdayFromDateKey(dateKey) {
    var parts = String(dateKey).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }

  function habitDueOn(habit, dateKey) {
    if (!habit || habit.status === 'archived') return false;
    if (habit.startDate && dateKey < habit.startDate) return false;
    var dateParts = String(dateKey).split('-').map(Number);
    var date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    var weekday = date.getDay();
    var schedule = habit.schedule || 'daily';

    if (schedule === 'daily') return true;
    if (schedule === 'weekdays') return weekday >= 1 && weekday <= 5;
    if (schedule === 'weekends') return weekday === 0 || weekday === 6;
    if (schedule === 'weekly') return Number(habit.weekday) === weekday;
    if (schedule === 'monthly') {
      var startParts = habit.startDate ? String(habit.startDate).split('-').map(Number) : null;
      var startDate = startParts ? new Date(startParts[0], startParts[1] - 1, startParts[2]) : date;
      return date.getDate() === startDate.getDate();
    }
    if (schedule === 'custom' && habit.customRepeat) {
      var cr = habit.customRepeat;
      var interval = cr.interval || 1;
      var unit = cr.unit || 'day';
      var startD = habit.startDate ? (function() {
        var sp = String(habit.startDate).split('-').map(Number);
        return new Date(sp[0], sp[1] - 1, sp[2]);
      })() : date;
      var diffTime = date.getTime() - startD.getTime();
      var diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return false;

      var isDue = false;
      if (unit === 'day') {
        isDue = diffDays % interval === 0;
      } else if (unit === 'week') {
        isDue = diffDays % (interval * 7) === 0;
      } else if (unit === 'month') {
        var monthsDiff = (date.getFullYear() - startD.getFullYear()) * 12 + (date.getMonth() - startD.getMonth());
        isDue = date.getDate() === startD.getDate() && monthsDiff % interval === 0;
      }

      if (isDue) {
        if (cr.skipWeekends && (weekday === 0 || weekday === 6)) return false;
        if (cr.skipHolidays) return false;
      }
      return isDue;
    }
    return true;
  }

  function getHabitLogForDate(logs, habitId, dateKey) {
    return (logs || []).find(function(log) {
      return log.habitId === habitId && log.date === dateKey;
    }) || null;
  }

  function getCalendarMarks(data, dateKeys) {
    var marks = {};
    (dateKeys || []).forEach(function(dateKey) {
      var taskCount = (data.tasks || []).filter(function(task) {
        return task.status !== 'deleted' && task.date === dateKey;
      }).length;
      var habitCount = (data.habits || []).filter(function(habit) {
        return habitDueOn(habit, dateKey);
      }).length;
      var hasJournal = (data.journals || []).some(function(entry) {
        return entry.date === dateKey && String(entry.content || '').trim();
      });
      marks[dateKey] = {
        tasks: taskCount,
        habits: habitCount,
        journal: hasJournal
      };
    });
    return marks;
  }

  function getCalendarEntries(data, dateKey) {
    var entries = [];
    (data.tasks || [])
      .filter(function(task) {
        return task && task.status !== 'deleted' && task.date === dateKey;
      })
      .sort(function(a, b) {
        var statusRank = { active: 0, completed: 1 };
        return (statusRank[a.status] || 0) - (statusRank[b.status] || 0) ||
          String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      })
      .forEach(function(task) {
        entries.push({
          type: 'task',
          id: task.id,
          label: getTaskDisplayTitle(task),
          state: task.status || 'active',
          priority: task.priority || 'none'
        });
      });

    (data.habits || [])
      .filter(function(habit) {
        return habitDueOn(habit, dateKey);
      })
      .forEach(function(habit) {
        var log = getHabitLogForDate(data.habitLogs, habit.id, dateKey);
        entries.push({
          type: 'habit',
          id: habit.id,
          label: String(habit.title || '').trim() || '未命名习惯',
          state: log ? log.state : 'pending'
        });
      });

    if ((data.journals || []).some(function(entry) {
      return entry.date === dateKey && String(entry.content || '').trim();
    })) {
      entries.push({
        type: 'journal',
        id: 'journal-' + dateKey,
        label: '每日一句',
        state: 'noted'
      });
    }

    return entries;
  }

  return {
    AREA_OPTIONS: AREA_OPTIONS,
    normalizeArea: normalizeArea,
    areaLabel: areaLabel,
    filterTasksByArea: filterTasksByArea,
    getTodayTasks: getTodayTasks,
    getInboxTasks: getInboxTasks,
    getUpcomingTasks: getUpcomingTasks,
    getCompletedTasks: getCompletedTasks,
    getDeletedTasks: getDeletedTasks,
    getTaskDisplayTitle: getTaskDisplayTitle,
    getCalendarEntries: getCalendarEntries,
    habitDueOn: habitDueOn,
    getHabitLogForDate: getHabitLogForDate,
    getCalendarMarks: getCalendarMarks
  };
});
