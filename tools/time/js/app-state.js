(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuState = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
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
    var weekday = weekdayFromDateKey(dateKey);
    if (habit.schedule === 'weekdays') return weekday >= 1 && weekday <= 5;
    if (habit.schedule === 'weekly') return Number(habit.weekday) === weekday;
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
