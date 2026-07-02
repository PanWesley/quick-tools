(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuDateUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function toDateKey(date) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('-');
  }

  function fromDateKey(dateKey) {
    var parts = String(dateKey).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(date, days) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function getTodayKey() {
    return toDateKey(new Date());
  }

  function formatMonthLabel(year, monthIndex) {
    return year + '年' + (monthIndex + 1) + '月';
  }

  function formatWeekday(dateKey) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][fromDateKey(dateKey).getDay()];
  }

  function buildMonthGrid(year, monthIndex) {
    var first = new Date(year, monthIndex, 1);
    var mondayOffset = (first.getDay() + 6) % 7;
    var start = addDays(first, -mondayOffset);
    var cells = [];

    for (var i = 0; i < 42; i += 1) {
      var date = addDays(start, i);
      cells.push({
        date: date,
        dateKey: toDateKey(date),
        day: date.getDate(),
        isCurrentMonth: date.getMonth() === monthIndex,
        isToday: toDateKey(date) === getTodayKey()
      });
    }

    return cells;
  }

  function isSameOrBefore(left, right) {
    return String(left) <= String(right);
  }

  function isSameOrAfter(left, right) {
    return String(left) >= String(right);
  }

  return {
    toDateKey: toDateKey,
    fromDateKey: fromDateKey,
    addDays: addDays,
    getTodayKey: getTodayKey,
    formatMonthLabel: formatMonthLabel,
    formatWeekday: formatWeekday,
    buildMonthGrid: buildMonthGrid,
    isSameOrBefore: isSameOrBefore,
    isSameOrAfter: isSameOrAfter
  };
});
