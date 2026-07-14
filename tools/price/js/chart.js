(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaChart = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function isValidDate(value) {
    var date;
    if (typeof value === 'string') {
      if (!value.trim()) return false;
      date = new Date(value);
    } else if (value instanceof Date) {
      date = value;
    } else {
      return false;
    }
    return Number.isFinite(date.getTime());
  }

  function isValidSnapshot(snapshot) {
    return snapshot && Number.isFinite(toNumber(snapshot.finalPrice)) &&
      toNumber(snapshot.finalPrice) > 0 &&
      isValidDate(snapshot.capturedAt);
  }

  function formatPrice(price) {
    var number = toNumber(price);
    if (!Number.isFinite(number)) number = 0;
    return '￥' + (Number.isInteger(number) ? String(number) : number.toFixed(2));
  }

  function formatDateLabel(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0');
  }

  function renderEmpty(container) {
    container.innerHTML = '<div class="chart-empty"><span class="chart-empty-icon">📈</span>价格记录还不够多呢～<br>再记几笔就能看到曲线啦</div>';
  }

  function renderPriceChart(container, snapshots) {
    if (!container) return;

    var list = (snapshots || []).filter(isValidSnapshot).sort(function(a, b) {
      return new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
    });
    if (list.length < 2) {
      renderEmpty(container);
      return;
    }

    var width = 720;
    var height = 280;
    var paddingLeft = 48;
    var paddingRight = 24;
    var paddingTop = 24;
    var paddingBottom = 44;
    var chartWidth = width - paddingLeft - paddingRight;
    var chartHeight = height - paddingTop - paddingBottom;
    var prices = list.map(function(snapshot) {
      return toNumber(snapshot.finalPrice);
    });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = Math.max(1, max - min);
    var points = list.map(function(snapshot, index) {
      var price = toNumber(snapshot.finalPrice);
      var x = paddingLeft + (index / Math.max(1, list.length - 1)) * chartWidth;
      var y = paddingTop + (1 - (price - min) / range) * chartHeight;
      return {
        x: x,
        y: y,
        price: price,
        capturedAt: snapshot.capturedAt
      };
    });
    var path = points.map(function(point, index) {
      return (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
    }).join(' ');
    var areaPath = path +
      ' L' + points[points.length - 1].x.toFixed(2) + ' ' + (height - paddingBottom) +
      ' L' + points[0].x.toFixed(2) + ' ' + (height - paddingBottom) + ' Z';
    var circles = points.map(function(point) {
      var title = formatPrice(point.price) + ' ' + formatDateLabel(point.capturedAt);
      return [
        '<circle cx="', point.x.toFixed(2), '" cy="', point.y.toFixed(2), '" r="4">',
        '<title>', escapeHtml(title), '</title>',
        '</circle>'
      ].join('');
    }).join('');
    var firstDate = formatDateLabel(points[0].capturedAt);
    var lastDate = formatDateLabel(points[points.length - 1].capturedAt);

    container.innerHTML = [
      '<svg class="price-chart-svg" viewBox="0 0 ', width, ' ', height, '" role="img" aria-label="历史价格曲线">',
      '<defs>',
        '<linearGradient id="chartGradient" x1="0%" y1="0%" x2="100%" y2="0%">',
          '<stop offset="0%" style="stop-color:#7FB8A6;stop-opacity:1" />',
          '<stop offset="100%" style="stop-color:#E89B9B;stop-opacity:1" />',
        '</linearGradient>',
        '<linearGradient id="chartAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">',
          '<stop offset="0%" style="stop-color:#7FB8A6;stop-opacity:0.3" />',
          '<stop offset="100%" style="stop-color:#7FB8A6;stop-opacity:0.02" />',
        '</linearGradient>',
      '</defs>',
      '<path class="chart-area" d="', areaPath, '"></path>',
      '<line class="chart-axis" x1="', paddingLeft, '" y1="', height - paddingBottom, '" x2="', width - paddingRight, '" y2="', height - paddingBottom, '"></line>',
      '<text class="chart-label" x="', paddingLeft, '" y="16">', escapeHtml(formatPrice(max)), '</text>',
      '<text class="chart-label" x="', paddingLeft, '" y="', height - 6, '">', escapeHtml(formatPrice(min)), '</text>',
      '<text class="chart-label" x="', paddingLeft, '" y="', height - 24, '">', escapeHtml(firstDate), '</text>',
      '<text class="chart-label" x="', width - paddingRight, '" y="', height - 24, '" text-anchor="end">', escapeHtml(lastDate), '</text>',
      '<path class="chart-line" d="', path, '" style="stroke-dasharray: 2000; stroke-dashoffset: 2000; animation: drawLine 1.2s ease forwards;"></path>',
      '<g class="chart-points" style="opacity: 0; animation: fadeIn 0.4s ease 0.9s forwards;">', circles, '</g>',
      '<style>',
        '@keyframes drawLine {',
          'to { stroke-dashoffset: 0; }',
        '}',
        '@keyframes fadeIn {',
          'to { opacity: 1; }',
        '}',
      '</style>',
      '</svg>'
    ].join('');
  }

  return {
    renderPriceChart: renderPriceChart
  };
});
