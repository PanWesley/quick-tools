(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./notification-model'), require('./notification-receipt'));
  } else {
    root.TodayYouxuNotification = factory(root.TodayYouxuNotificationModel, root.TodayYouxuNotificationReceipt);
  }
})(typeof self !== 'undefined' ? self : this, function(NotificationModel, NotificationReceipt) {
  var NOTIFICATION_STORAGE_KEY = 'today-youxu-notification-state';
  var NOTIFIED_LOG_KEY = 'today-youxu-notified-log';
  var MAX_SCHEDULE_AHEAD_HOURS = 24;
  var CHECK_INTERVAL_MS = 30 * 1000;
  var NOTIFIED_LOG_EXPIRY_HOURS = 48;
  var UPCOMING_WINDOW_MS = 60 * 60 * 1000;
  var DELIVERY_GRACE_MS = 60 * 1000;

  var scheduledTimers = {};
  var checkIntervalId = null;
  var onPermissionChangeCallback = null;
  var swRegistration = null;
  var deliveryReceipts = NotificationReceipt && typeof NotificationReceipt.create === 'function'
    ? NotificationReceipt.create()
    : null;

  function getStoredState() {
    try {
      var raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { enabled: false, lastPermissionRequest: 0 };
    } catch (e) {
      return { enabled: false, lastPermissionRequest: 0 };
    }
  }

  function saveStoredState(state) {
    try {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function getNotifiedLog() {
    try {
      var raw = localStorage.getItem(NOTIFIED_LOG_KEY);
      if (!raw) return {};
      var log = JSON.parse(raw);
      var now = Date.now();
      var expiry = NOTIFIED_LOG_EXPIRY_HOURS * 60 * 60 * 1000;
      var cleaned = {};
      Object.keys(log).forEach(function(key) {
        if (now - log[key] < expiry) {
          cleaned[key] = log[key];
        }
      });
      return cleaned;
    } catch (e) {
      return {};
    }
  }

  function saveNotifiedLog(log) {
    try {
      localStorage.setItem(NOTIFIED_LOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  function markNotified(key) {
    var log = getNotifiedLog();
    log[key] = Date.now();
    saveNotifiedLog(log);
  }

  function wasNotified(key) {
    var log = getNotifiedLog();
    return !!log[key];
  }

  function isSupported() {
    return 'Notification' in window;
  }

  function getPermissionStatus() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;
  }

  function isEnabled() {
    var state = getStoredState();
    return state.enabled && getPermissionStatus() === 'granted';
  }

  function parseReminderOffset(reminderValue, customReminder) {
    if (reminderValue === 'none' || !reminderValue) return 0;
    if (reminderValue === 'at-time') return 0;
    var minutes = parseInt(reminderValue, 10);
    if (!isNaN(minutes)) return minutes * 60 * 1000;
    if (reminderValue === 'custom' && customReminder) {
      var d = customReminder.days || 0;
      var h = customReminder.hours || 0;
      var m = customReminder.minutes || 0;
      return (d * 24 * 60 + h * 60 + m) * 60 * 1000;
    }
    return 0;
  }

  function getTaskDateTime(task) {
    if (!task.date) return null;
    var parts = String(task.date).split('-').map(Number);
    if (parts.length !== 3) return null;
    var year = parts[0], month = parts[1] - 1, day = parts[2];
    var hours = 9, minutes = 0;
    if (task.startTime) {
      var timeParts = task.startTime.split(':').map(Number);
      hours = timeParts[0] || 9;
      minutes = timeParts[1] || 0;
    }
    return new Date(year, month, day, hours, minutes, 0, 0);
  }

  function getHabitDateTime(habit, dateKey) {
    if (!dateKey) return null;
    var parts = String(dateKey).split('-').map(Number);
    if (parts.length !== 3) return null;
    var hours = 9;
    var minutes = 0;
    var match = /^(\d{2}):(\d{2})$/.exec(String(habit && habit.startTime || ''));
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60) {
      hours = Number(match[1]);
      minutes = Number(match[2]);
    }
    return new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, 0, 0);
  }

  function calculateNotifyTime(baseTime, reminderValue, customReminder) {
    var offset = parseReminderOffset(reminderValue, customReminder);
    return new Date(baseTime.getTime() - offset);
  }

  function buildNotificationId(type, id, notifyTimeMs) {
    return type + ':' + id + ':' + notifyTimeMs;
  }

  function buildNotificationCopy(type, item, dueTime, notifyTime) {
    return NotificationModel.buildNotificationCopy(type, item, dueTime, notifyTime);
  }

  function showNotificationViaSW(title, options) {
    if (swRegistration && swRegistration.showNotification) {
      return swRegistration.showNotification(title, options);
    }
    return Promise.reject(new Error('No SW registration'));
  }

  function showNotificationDirectly(title, options) {
    try {
      var notif = new Notification(title, options);
      return Promise.resolve(notif);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function showNotification(title, options) {
    if (!isEnabled()) return Promise.reject(new Error('Notifications not enabled'));
    options = options || {};
    options.icon = options.icon || '/icons/today-youxu-icon-192x192.png';
    options.badge = options.badge || '/icons/today-youxu-icon-72x72.png';
    options.vibrate = options.vibrate || [200, 100, 200];
    options.tag = options.tag || 'today-youxu-reminder';
    options.renotify = false;
    options.requireInteraction = false;
    options.silent = false;

    if (document.hidden || document.visibilityState !== 'visible') {
      return showNotificationViaSW(title, options).catch(function() {
        return showNotificationDirectly(title, options);
      });
    } else {
      return showNotificationDirectly(title, options).catch(function() {
        return showNotificationViaSW(title, options);
      });
    }
  }

  async function wasDeliveredInBackground(tag) {
    try {
      if (deliveryReceipts && await deliveryReceipts.has(tag)) return true;
    } catch (e) {}
    try {
      if (swRegistration && typeof swRegistration.getNotifications === 'function') {
        var visible = await swRegistration.getNotifications({ tag: tag });
        return visible.length > 0;
      }
    } catch (e) {}
    return false;
  }

  async function fireNotification(type, item, notifyTime, dueTime) {
    var logKey = buildNotificationId(type, item.id, dueTime.getTime());
    if (wasNotified(logKey)) return;
    var copy = buildNotificationCopy(type, item, dueTime, notifyTime);
    var tagKey = NotificationModel.buildNotificationTag(type, item.id, dueTime);
    if (await wasDeliveredInBackground(tagKey)) {
      markNotified(logKey);
      return;
    }
    try {
      await showNotification(copy.title, {
        body: copy.body,
        tag: tagKey,
        data: {
          type: type,
          id: item.id,
          date: item.date || '',
          url: '/tools/time/#'
        }
      });
      markNotified(logKey);
    } catch (err) {
      console.warn('[Notification] Failed to show:', err);
      return;
    }
    try {
      if (deliveryReceipts) await deliveryReceipts.record(tagKey, notifyTime.getTime());
    } catch (e) {}
  }

  function scheduleOne(type, item, baseTime, reminderValue, customReminder) {
    if (!isEnabled()) return;
    if (reminderValue === 'none' || !reminderValue) return;
    if (!baseTime) return;
    var notifyTime = calculateNotifyTime(baseTime, reminderValue, customReminder);
    var now = new Date();
    var delay = notifyTime.getTime() - now.getTime();

    if (delay < 0) return;
    if (delay > MAX_SCHEDULE_AHEAD_HOURS * 60 * 60 * 1000) return;

    var timerKey = buildNotificationId(type, item.id, notifyTime.getTime());
    var logKey = buildNotificationId(type, item.id, baseTime.getTime());
    if (scheduledTimers[timerKey]) {
      clearTimeout(scheduledTimers[timerKey]);
    }
    if (wasNotified(logKey)) return;

    scheduledTimers[timerKey] = setTimeout(function() {
      delete scheduledTimers[timerKey];
      if (Date.now() - notifyTime.getTime() > DELIVERY_GRACE_MS) return;
      return fireNotification(type, item, notifyTime, baseTime);
    }, delay);
  }

  function clearAllScheduled() {
    Object.keys(scheduledTimers).forEach(function(key) {
      clearTimeout(scheduledTimers[key]);
    });
    scheduledTimers = {};
  }

  function scheduleAll(data, todayKey, habitDueChecker) {
    clearAllScheduled();
    if (!isEnabled()) return;
    var now = new Date();
    (data.tasks || []).forEach(function(task) {
      if (task.status !== 'active') return;
      if (!task.date) return;
      if (task.date < todayKey) return;
      if (task.reminder === 'none' || !task.reminder) return;
      var baseTime = getTaskDateTime(task);
      if (!baseTime) return;
      if (baseTime.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_HOURS * 60 * 60 * 1000) return;
      scheduleOne('task', task, baseTime, task.reminder, task.customReminder);
    });
    (data.habits || []).forEach(function(habit) {
      if (habit.status === 'archived') return;
      if (habit.reminder === 'none' || !habit.reminder) return;
      var checkDate = new Date(now);
      for (var i = 0; i < 7; i++) {
        var dKey = dateToKey(checkDate);
        if (habitDueChecker && habitDueChecker(habit, dKey)) {
          var baseTime = getHabitDateTime(habit, dKey);
          if (baseTime && baseTime.getTime() - now.getTime() <= MAX_SCHEDULE_AHEAD_HOURS * 60 * 60 * 1000) {
            scheduleOne('habit', habit, baseTime, habit.reminder, habit.customReminder);
          }
        }
        checkDate.setDate(checkDate.getDate() + 1);
      }
    });
  }

  function dateToKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function getMissedCount(data, todayKey, habitDueChecker, now) {
    now = now instanceof Date ? now : new Date();
    var windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    var count = 0;

    (data.tasks || []).forEach(function(task) {
      if (task.status !== 'active') return;
      if (!task.date) return;
      if (task.reminder === 'none' || !task.reminder) return;
      var baseTime = getTaskDateTime(task);
      if (!baseTime) return;
      if (baseTime < windowStart) return;
      if (baseTime.getTime() - now.getTime() > UPCOMING_WINDOW_MS) return;

      var notifyTime = calculateNotifyTime(baseTime, task.reminder, task.customReminder);
      var key = buildNotificationId('task', task.id, baseTime.getTime());
      if (notifyTime <= now && !wasNotified(key)) {
        count += 1;
      }
    });

    (data.habits || []).forEach(function(habit) {
      if (habit.status === 'archived') return;
      if (habit.reminder === 'none' || !habit.reminder) return;
      var checkDate = new Date(now);
      var dKey = dateToKey(checkDate);
      if (habitDueChecker && habitDueChecker(habit, dKey)) {
        var baseTime = getHabitDateTime(habit, dKey);
        if (baseTime && baseTime >= windowStart && baseTime.getTime() - now.getTime() <= UPCOMING_WINDOW_MS) {
          var notifyTime = calculateNotifyTime(baseTime, habit.reminder, habit.customReminder);
          var key = buildNotificationId('habit', habit.id, baseTime.getTime());
          if (notifyTime <= now && !wasNotified(key)) {
            count += 1;
          }
        }
      }
    });

    return count;
  }

  function checkMissedReminders(data, todayKey, habitDueChecker, now) {
    return getMissedCount(data, todayKey, habitDueChecker, now);
  }

  function requestPermission() {
    if (!isSupported()) {
      return Promise.resolve('unsupported');
    }
    var state = getStoredState();
    state.lastPermissionRequest = Date.now();
    saveStoredState(state);
    return Notification.requestPermission().then(function(permission) {
      if (permission === 'granted') {
        var s = getStoredState();
        s.enabled = true;
        saveStoredState(s);
      }
      if (onPermissionChangeCallback) onPermissionChangeCallback(permission);
      return permission;
    });
  }

  function setEnabled(enabled) {
    var state = getStoredState();
    state.enabled = enabled;
    saveStoredState(state);
    if (!enabled) {
      clearAllScheduled();
    }
    if (onPermissionChangeCallback) onPermissionChangeCallback(getPermissionStatus());
  }

  function setPermissionChangeCallback(callback) {
    onPermissionChangeCallback = callback;
  }

  function setServiceWorkerRegistration(reg) {
    swRegistration = reg;
  }

  function startPeriodicCheck() {
    if (checkIntervalId) return;
    checkIntervalId = setInterval(function() {
      if (isEnabled() && typeof window !== 'undefined' && window.TodayYouxuReschedule) {
        window.TodayYouxuReschedule();
      }
    }, CHECK_INTERVAL_MS);
  }

  function stopPeriodicCheck() {
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
      checkIntervalId = null;
    }
  }

  function handleNotificationClick(event) {
    event.notification.close();
    var data = event.notification.data || {};
    var url = data.url || '/tools/time/#today';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf('/tools/time/') !== -1 && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', data: data });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
    );
  }

  function initSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg) {
      setServiceWorkerRegistration(reg);
    }).catch(function() {});
  }

  return {
    isSupported: isSupported,
    getPermissionStatus: getPermissionStatus,
    isEnabled: isEnabled,
    requestPermission: requestPermission,
    setEnabled: setEnabled,
    setPermissionChangeCallback: setPermissionChangeCallback,
    setServiceWorkerRegistration: setServiceWorkerRegistration,
    scheduleAll: scheduleAll,
    checkMissedReminders: checkMissedReminders,
    getMissedCount: getMissedCount,
    clearAllScheduled: clearAllScheduled,
    startPeriodicCheck: startPeriodicCheck,
    stopPeriodicCheck: stopPeriodicCheck,
    parseReminderOffset: parseReminderOffset,
    getTaskDateTime: getTaskDateTime,
    getHabitDateTime: getHabitDateTime,
    calculateNotifyTime: calculateNotifyTime,
    buildNotificationCopy: buildNotificationCopy,
    fireNotification: fireNotification,
    handleNotificationClick: handleNotificationClick,
    initSW: initSW
  };
});
