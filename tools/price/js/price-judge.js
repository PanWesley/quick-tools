(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaPriceJudge = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  function toNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function calculatePercentile(values, percentile) {
    var sorted = (values || []).map(Number).filter(Number.isFinite).sort(function(a, b) {
      return a - b;
    });
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];

    var rank = (toNumber(percentile) / 100) * (sorted.length - 1);
    var lower = Math.floor(rank);
    var upper = Math.ceil(rank);
    var weight = rank - lower;
    return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * weight) * 100) / 100;
  }

  function pricesFromSnapshots(snapshots) {
    return (snapshots || []).map(function(snapshot) {
      return toNumber(snapshot.finalPrice);
    }).filter(function(price) {
      return price > 0;
    }).sort(function(a, b) {
      return a - b;
    });
  }

  function minPrice(snapshots) {
    var prices = pricesFromSnapshots(snapshots);
    return prices.length ? prices[0] : 0;
  }

  function isWithinDays(snapshot, now, days) {
    var capturedAt = new Date(snapshot.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) return false;
    var ageMs = now.getTime() - capturedAt.getTime();
    return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
  }

  function summarizeSnapshots(snapshots, nowIso) {
    var list = snapshots || [];
    var now = nowIso ? new Date(nowIso) : new Date();
    var snapshots30d = list.filter(function(snapshot) {
      return isWithinDays(snapshot, now, 30);
    });
    var snapshots90d = list.filter(function(snapshot) {
      return isWithinDays(snapshot, now, 90);
    });
    var prices90d = pricesFromSnapshots(snapshots90d);

    return {
      snapshotCount: list.length,
      historyMinPrice: minPrice(list),
      minPrice30d: minPrice(snapshots30d),
      minPrice90d: minPrice(snapshots90d),
      p20Price90d: calculatePercentile(prices90d, 20),
      p70Price90d: calculatePercentile(prices90d, 70)
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function buildResult(level, title, score, suggestion, reasons, summary) {
    return {
      level: level,
      title: title,
      score: clamp(Math.round(score), 0, 100),
      suggestion: suggestion,
      reasons: reasons,
      summary: summary
    };
  }

  function judgePrice(input) {
    var options = input || {};
    var current = toNumber(options.currentFinalPrice);
    var snapshots = options.snapshots || [];
    var summary = summarizeSnapshots(snapshots, options.nowIso);

    if (summary.snapshotCount < 5 || current <= 0) {
      return buildResult('insufficient', '数据不足', 45, '先记录几次价格，再判断是否值得买。', ['价格记录少于 5 条'], summary);
    }

    if (current <= summary.historyMinPrice) {
      return buildResult('history_low', '历史低价', 94, '当前价不高于已记录的历史最低价，刚需可以购买。', ['当前价不高于历史最低价', '已有足够本地价格记录'], summary);
    }

    if (summary.p20Price90d && current <= summary.p20Price90d) {
      return buildResult('recent_low', '近期低价', 82, '当前价低于近 90 天大多数记录，刚需可以购买。', ['当前价低于近 90 天 P20 分位', '可设置更低目标价继续观察'], summary);
    }

    if (summary.p70Price90d && current <= summary.p70Price90d) {
      return buildResult('normal', '价格一般', 66, '当前价处于常见区间，刚需可买，不急可以等等。', ['当前价位于近 90 天 P20 到 P70 区间'], summary);
    }

    return buildResult('expensive', '偏贵', 38, '当前价高于近 90 天多数记录，建议先关注目标价。', ['当前价高于近 90 天 P70 分位'], summary);
  }

  return {
    calculatePercentile: calculatePercentile,
    summarizeSnapshots: summarizeSnapshots,
    judgePrice: judgePrice
  };
});
