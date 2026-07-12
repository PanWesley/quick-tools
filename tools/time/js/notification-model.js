(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('crypto').webcrypto);
  } else {
    root.TodayYouxuNotificationModel = factory(root.crypto);
  }
})(typeof self !== 'undefined' ? self : this, function(defaultCrypto) {
  var HORIZON_DAYS = 30;
  var MAX_CUSTOM_REMINDER_DAYS = 7;
  var MAX_CUSTOM_REMINDER_HOURS = 23;
  var MAX_CUSTOM_REMINDER_MINUTES = 59;
  var MAX_REMINDER_OFFSET_MINUTES = MAX_CUSTOM_REMINDER_DAYS * 24 * 60
    + MAX_CUSTOM_REMINDER_HOURS * 60 + MAX_CUSTOM_REMINDER_MINUTES;
  var AREA_LABELS = {
    life: '生活',
    study: '学习',
    work: '工作',
    health: '健康',
    housework: '家务',
    memory: '纪念',
    other: '其他'
  };

  function validTime(value) {
    var match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var hours = Number(match[1]);
    var minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? [hours, minutes] : null;
  }

  function dateFromKey(dateKey, timeValue) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!match) return null;
    var time = validTime(timeValue) || [9, 0];
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), time[0], time[1], 0, 0);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
      return null;
    }
    return date;
  }

  function dateToKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function isValidDate(date) {
    return date instanceof Date && Number.isFinite(date.getTime());
  }

  function isValidInteger(value, minimum, maximum) {
    return typeof value === 'number' && Number.isSafeInteger(value)
      && value >= minimum && value <= maximum;
  }

  function reminderOffset(reminder, customReminder) {
    if (reminder === 'none' || reminder === 'at-time' || reminder === 0 || reminder === '0') return 0;
    if (/^\d+$/.test(String(reminder))) {
      var offsetMinutes = Number(reminder);
      return isValidInteger(offsetMinutes, 0, MAX_REMINDER_OFFSET_MINUTES)
        ? offsetMinutes * 60 * 1000
        : null;
    }
    if (reminder !== 'custom' || !customReminder) return null;
    var days = customReminder.days;
    var hours = customReminder.hours;
    var minutes = customReminder.minutes;
    if (!isValidInteger(days, 0, MAX_CUSTOM_REMINDER_DAYS)
      || !isValidInteger(hours, 0, MAX_CUSTOM_REMINDER_HOURS)
      || !isValidInteger(minutes, 0, MAX_CUSTOM_REMINDER_MINUTES)) {
      return null;
    }
    return (days * 24 * 60 + hours * 60 + minutes) * 60 * 1000;
  }

  function notifyTimeFor(dueTime, reminder, customReminder) {
    if (!isValidDate(dueTime)) return null;
    var offset = reminderOffset(reminder, customReminder);
    if (offset === null) return null;
    var notifyTime = new Date(dueTime.getTime() - offset);
    return isValidDate(notifyTime) ? notifyTime : null;
  }

  function hasReminder(item) {
    return item && item.reminder !== undefined && item.reminder !== null
      && item.reminder !== '' && item.reminder !== 'none';
  }

  function normalizeNow(now) {
    var value = now === undefined ? new Date() : new Date(now);
    if (!isValidDate(value)) throw new TypeError('now must be a valid Date');
    return value;
  }

  function addLocalDays(date, days) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + days,
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds()
    );
  }

  function cleanTitle(value, fallback) {
    var title = value == null ? '' : String(value).trim();
    return title || fallback;
  }

  function areaLabel(area) {
    return AREA_LABELS[area] || AREA_LABELS.life;
  }

  function formatTime(date) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function buildNotificationCopy(type, item, dueTime, notifyTime) {
    item = item || {};
    if (type === 'habit') {
      return {
        title: cleanTitle(item.title, '未命名习惯'),
        body: '今日打卡 · ' + areaLabel(item.area)
      };
    }

    var title = cleanTitle(item.title, '未命名任务');
    var advanceMs = dueTime.getTime() - notifyTime.getTime();
    if (advanceMs > 0) {
      var minutes = Math.max(1, Math.round(advanceMs / 60000));
      return { title: title, body: formatTime(dueTime) + ' 开始 · 还有 ' + minutes + ' 分钟' };
    }
    return {
      title: title,
      body: validTime(item.startTime) ? formatTime(dueTime) + ' · ' + areaLabel(item.area) : '全天 · ' + areaLabel(item.area)
    };
  }

  function encode(value) {
    return new TextEncoder().encode(value);
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function(value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256(value, cryptoApi) {
    var api = cryptoApi || defaultCrypto;
    if (!api || !api.subtle || typeof api.subtle.digest !== 'function') {
      return Promise.reject(new Error('Web Crypto SHA-256 is unavailable'));
    }
    return api.subtle.digest('SHA-256', encode(value)).then(toHex);
  }

  function revisionFrom(item) {
    var revision = Date.parse(item && item.updatedAt);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }

  function isHabitActive(habit) {
    return habit && (habit.status === undefined || habit.status === 'active');
  }

  function isHabitLogged(logs, habitId, dateKey) {
    return (logs || []).some(function(log) {
      return log && log.habitId === habitId && log.date === dateKey && (log.state === 'done' || log.state === 'skipped');
    });
  }

  async function makeRecord(type, item, dateKey, dueTime, notifyTime, cryptoApi) {
    var sourceKey = type + ':' + String(item.id);
    var hashes = await Promise.all([
      sha256(sourceKey + ':' + dateKey, cryptoApi),
      sha256(sourceKey, cryptoApi)
    ]);
    var copy = buildNotificationCopy(type, item, dueTime, notifyTime);
    var notifyAt = notifyTime.toISOString();
    var id = 'reminder-' + hashes[0];
    return {
      id: id,
      sourceIdHash: hashes[1],
      notifyAt: notifyAt,
      revision: revisionFrom(item),
      encryptedValue: {
        title: copy.title,
        body: copy.body,
        tag: id,
        data: { type: type, id: item.id, date: dateKey, url: '/tools/time/#today' },
        scheduledAt: notifyAt,
        v: 1
      }
    };
  }

  function buildReminderRecords(data, todayKey, habitDueChecker, now, cryptoApi) {
    data = data || {};
    now = normalizeNow(now);
    var maxNotifyAt = addLocalDays(now, HORIZON_DAYS).getTime();
    var pending = [];

    (data.tasks || []).forEach(function(item) {
      if (!item || item.status !== 'active' || !item.id || !item.date || !hasReminder(item)) return;
      var dueTime = dateFromKey(item.date, item.startTime);
      if (!dueTime) return;
      var notifyTime = notifyTimeFor(dueTime, item.reminder, item.customReminder);
      if (!notifyTime) return;
      if (notifyTime.getTime() <= now.getTime() || notifyTime.getTime() > maxNotifyAt) return;
      pending.push(makeRecord('task', item, item.date, dueTime, notifyTime, cryptoApi));
    });

    var firstDate = dateFromKey(todayKey, '00:00');
    if (firstDate) {
      (data.habits || []).forEach(function(item) {
        if (!isHabitActive(item) || !item.id || !hasReminder(item)) return;
        for (var day = 0; day <= 30; day += 1) {
          var occurrence = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + day);
          var dateKey = dateToKey(occurrence);
          if (!habitDueChecker || !habitDueChecker(item, dateKey) || isHabitLogged(data.habitLogs, item.id, dateKey)) continue;
          var dueTime = dateFromKey(dateKey, item.startTime);
          var notifyTime = notifyTimeFor(dueTime, item.reminder, item.customReminder);
          if (!notifyTime) continue;
          if (notifyTime.getTime() <= now.getTime() || notifyTime.getTime() > maxNotifyAt) continue;
          pending.push(makeRecord('habit', item, dateKey, dueTime, notifyTime, cryptoApi));
        }
      });
    }

    return Promise.all(pending);
  }

  return {
    buildNotificationCopy: buildNotificationCopy,
    buildReminderRecords: buildReminderRecords
  };
});
