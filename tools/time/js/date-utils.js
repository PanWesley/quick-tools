(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodayYouxuDateUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052d0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
  ];
  var lunarMonthNames = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  var lunarDayPrefixes = ['初', '十', '廿', '三'];
  var lunarDayNumbers = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var solarTermNames = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
  ];
  var solarTermInfo = [
    0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
    263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758
  ];

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

  function leapMonth(year) {
    return lunarInfo[year - 1900] & 0xf;
  }

  function leapDays(year) {
    if (!leapMonth(year)) return 0;
    return (lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
  }

  function monthDays(year, month) {
    return (lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
  }

  function lunarYearDays(year) {
    var sum = 348;
    for (var mask = 0x8000; mask > 0x8; mask >>= 1) {
      if (lunarInfo[year - 1900] & mask) sum += 1;
    }
    return sum + leapDays(year);
  }

  function toLunar(dateKey) {
    var date = fromDateKey(dateKey);
    if (date.getFullYear() < 1900 || date.getFullYear() >= 1900 + lunarInfo.length) return null;
    var offset = Math.floor((date - new Date(1900, 0, 31)) / 86400000);
    var year = 1900;
    var daysOfYear = 0;

    while (year < 2050 && offset > 0) {
      daysOfYear = lunarYearDays(year);
      if (offset < daysOfYear) break;
      offset -= daysOfYear;
      year += 1;
    }

    var leap = leapMonth(year);
    var isLeap = false;
    var month = 1;
    var daysOfMonth = 0;

    while (month <= 12 && offset >= 0) {
      if (leap > 0 && month === leap + 1 && !isLeap) {
        month -= 1;
        isLeap = true;
        daysOfMonth = leapDays(year);
      } else {
        daysOfMonth = monthDays(year, month);
      }

      if (offset < daysOfMonth) break;
      offset -= daysOfMonth;

      if (isLeap && month === leap) {
        isLeap = false;
      }
      month += 1;
    }

    return {
      year: year,
      month: month,
      day: offset + 1,
      isLeap: isLeap
    };
  }

  function formatLunarMonth(month, isLeap) {
    return (isLeap ? '闰' : '') + lunarMonthNames[month - 1];
  }

  function formatLunarDayName(day) {
    if (day === 10) return '初十';
    if (day === 20) return '二十';
    if (day === 30) return '三十';
    return lunarDayPrefixes[Math.floor(day / 10)] + lunarDayNumbers[day % 10];
  }

  function getSolarTerm(dateKey) {
    var date = fromDateKey(dateKey);
    var year = date.getFullYear();
    if (year < 1900 || year > 2099) return '';
    var month = date.getMonth();
    for (var i = month * 2; i <= month * 2 + 1; i += 1) {
      var termDate = new Date(31556925974.7 * (year - 1900) + solarTermInfo[i] * 60000 + Date.UTC(1900, 0, 6, 2, 5));
      if (termDate.getUTCDate() === date.getDate()) return solarTermNames[i];
    }
    return '';
  }

  function formatLunarDay(dateKey) {
    var solarTerm = getSolarTerm(dateKey);
    if (solarTerm) return solarTerm;
    var lunar = toLunar(dateKey);
    if (!lunar) return '';
    if (lunar.day === 1) return formatLunarMonth(lunar.month, lunar.isLeap);
    return formatLunarDayName(lunar.day);
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
    formatLunarDay: formatLunarDay,
    toLunar: toLunar,
    buildMonthGrid: buildMonthGrid,
    isSameOrBefore: isSameOrBefore,
    isSameOrAfter: isSameOrAfter
  };
});
