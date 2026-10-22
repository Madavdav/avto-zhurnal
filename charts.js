/*
 * АвтоЖурнал — графики на чистом SVG.
 * Никаких библиотек: браузер сам рисует линии и столбики.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var COLORS = {
    accent: '#5eead4',
    accentSoft: 'rgba(94, 234, 212, 0.18)',
    grid: 'rgba(255, 255, 255, 0.08)',
    text: '#8d9bb5',
    textBright: '#f2f6ff',
    bar: '#2dd4bf',
    barMuted: 'rgba(94, 234, 212, 0.35)',
    surface: '#0d1422'
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function moneyShort(value) {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (Math.abs(value) >= 10000) {
      return Math.round(value / 1000) + 'k';
    }
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
  }

  function numberLabel(value, digits) {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: typeof digits === 'number' ? digits : 1
    }).format(value);
  }

  function shortDate(iso) {
    if (typeof iso !== 'string' || iso.length < 10) {
      return '';
    }
    return iso.slice(8, 10) + '.' + iso.slice(5, 7);
  }

  function emptyState(title, text) {
    return (
      '<div class="chart-empty">' +
        '<svg viewBox="0 0 48 48" aria-hidden="true" class="chart-empty-icon">' +
          '<path d="M8 34c4-12 10-18 16-18s12 6 16 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
          '<circle cx="24" cy="35" r="3" fill="currentColor"/>' +
          '<path d="M12 38h24" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4"/>' +
        '</svg>' +
        '<strong>' + escapeHtml(title) + '</strong>' +
        '<span>' + escapeHtml(text) + '</span>' +
      '</div>'
    );
  }

  function renderConsumption(container, segments) {
    if (!container) {
      return;
    }
    var points = (Array.isArray(segments) ? segments : []).slice(-12);
    if (!points.length) {
      container.innerHTML = emptyState(
        'Пока нет расхода',
        'Нужны две заправки «до полного»: между ними приложение посчитает расход.'
      );
      return;
    }

    var width = 360;
    var height = 190;
    var pad = { left: 34, right: 14, top: 22, bottom: 30 };
    var innerWidth = width - pad.left - pad.right;
    var innerHeight = height - pad.top - pad.bottom;
    var values = points.map(function (point) { return point.consumption; });
    var maxValue = Math.max.apply(null, values);
    var yMax = Math.max(2, Math.ceil((maxValue * 1.2) / 2) * 2);

    function x(index) {
      if (points.length === 1) {
        return pad.left + innerWidth / 2;
      }
      return pad.left + (innerWidth * index) / (points.length - 1);
    }

    function y(value) {
      return pad.top + innerHeight - (value / yMax) * innerHeight;
    }

    var gridLines = [0, yMax / 2, yMax].map(function (value) {
      var yPos = y(value);
      return (
        '<line x1="' + pad.left + '" y1="' + yPos.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + yPos.toFixed(2) + '" stroke="' + COLORS.grid + '" stroke-width="1"/>' +
        '<text x="' + (pad.left - 7) + '" y="' + (yPos + 3.5).toFixed(2) + '" text-anchor="end" fill="' + COLORS.text + '" font-size="9">' + escapeHtml(numberLabel(value, 1)) + '</text>'
      );
    }).join('');

    var linePath = points.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') + x(index).toFixed(2) + ' ' + y(point.consumption).toFixed(2);
    }).join(' ');

    var areaPath = linePath +
      ' L' + x(points.length - 1).toFixed(2) + ' ' + (pad.top + innerHeight) +
      ' L' + x(0).toFixed(2) + ' ' + (pad.top + innerHeight) + ' Z';

    var circles = points.map(function (point, index) {
      var cx = x(index);
      var cy = y(point.consumption);
      var isLast = index === points.length - 1;
      var title = shortDate(point.date) + ': ' + numberLabel(point.consumption, 2) +
        ' л/100 км · ' + numberLabel(point.distance, 0) + ' км';
      var label = isLast
        ? '<text x="' + cx.toFixed(2) + '" y="' + (cy - 10).toFixed(2) + '" text-anchor="middle" fill="' + COLORS.accent + '" font-size="10" font-weight="600">' +
            escapeHtml(numberLabel(point.consumption, 1)) +
          '</text>'
        : '';
      return (
        '<g>' +
          '<title>' + escapeHtml(title) + '</title>' +
          label +
          '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + (isLast ? 4.5 : 3.2) + '" fill="' + (isLast ? COLORS.accent : COLORS.surface) + '" stroke="' + COLORS.accent + '" stroke-width="2"/>' +
        '</g>'
      );
    }).join('');

    var firstLabel = shortDate(points[0].date);
    var lastLabel = shortDate(points[points.length - 1].date);
    var xLabels = (
      '<text x="' + pad.left + '" y="' + (height - 9) + '" fill="' + COLORS.text + '" font-size="9">' + escapeHtml(firstLabel) + '</text>' +
      (points.length > 1
        ? '<text x="' + (width - pad.right) + '" y="' + (height - 9) + '" text-anchor="end" fill="' + COLORS.text + '" font-size="9">' + escapeHtml(lastLabel) + '</text>'
        : '')
    );

    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="График расхода топлива по заправкам до полного">' +
        '<defs>' +
          '<linearGradient id="cons-gradient" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + COLORS.accent + '" stop-opacity="0.28"/>' +
            '<stop offset="100%" stop-color="' + COLORS.accent + '" stop-opacity="0"/>' +
          '</linearGradient>' +
        '</defs>' +
        gridLines +
        '<path d="' + areaPath + '" fill="url(#cons-gradient)"/>' +
        '<path d="' + linePath + '" fill="none" stroke="' + COLORS.accent + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
        circles +
        xLabels +
      '</svg>';
  }

  function renderExpenses(container, series) {
    if (!container) {
      return;
    }
    var items = Array.isArray(series) ? series : [];
    var maxValue = items.reduce(function (max, item) {
      return Math.max(max, Number.isFinite(item.total) ? item.total : 0);
    }, 0);

    if (!items.length || maxValue <= 0) {
      container.innerHTML = emptyState(
        'Пока нет расходов',
        'Добавьте заправки — и здесь появятся столбики по месяцам.'
      );
      return;
    }

    var width = 360;
    var height = 190;
    var pad = { left: 32, right: 10, top: 22, bottom: 30 };
    var innerWidth = width - pad.left - pad.right;
    var innerHeight = height - pad.top - pad.bottom;
    var yMax = Math.max(1, Math.ceil((maxValue * 1.15) / 10) * 10);
    var slot = innerWidth / items.length;
    var barWidth = Math.min(28, slot * 0.56);

    function y(value) {
      return pad.top + innerHeight - (value / yMax) * innerHeight;
    }

    var gridLines = [0, yMax / 2, yMax].map(function (value) {
      var yPos = y(value);
      return (
        '<line x1="' + pad.left + '" y1="' + yPos.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + yPos.toFixed(2) + '" stroke="' + COLORS.grid + '" stroke-width="1"/>' +
        '<text x="' + (pad.left - 6) + '" y="' + (yPos + 3.5).toFixed(2) + '" text-anchor="end" fill="' + COLORS.text + '" font-size="9">' + escapeHtml(moneyShort(value)) + '</text>'
      );
    }).join('');

    var lastIndex = items.length - 1;
    var bars = items.map(function (item, index) {
      var barHeight = Math.max(2, (item.total / yMax) * innerHeight);
      var xPos = pad.left + slot * index + (slot - barWidth) / 2;
      var yPos = pad.top + innerHeight - barHeight;
      var isLast = index === lastIndex;
      var title = item.label + ' ' + item.year + ': ' +
        new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.total) + ' ₪';
      var valueLabel = item.total > 0
        ? '<text x="' + (xPos + barWidth / 2).toFixed(2) + '" y="' + (yPos - 5).toFixed(2) + '" text-anchor="middle" fill="' + (isLast ? COLORS.textBright : COLORS.text) + '" font-size="8.5">' +
            escapeHtml(moneyShort(item.total)) +
          '</text>'
        : '';
      return (
        '<g>' +
          '<title>' + escapeHtml(title) + '</title>' +
          valueLabel +
          '<rect x="' + xPos.toFixed(2) + '" y="' + yPos.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + barHeight.toFixed(2) + '" rx="5" fill="' + (isLast ? COLORS.bar : COLORS.barMuted) + '"/>' +
        '</g>'
      );
    }).join('');

    var labels = items.map(function (item, index) {
      var center = pad.left + slot * index + slot / 2;
      return '<text x="' + center.toFixed(2) + '" y="' + (height - 9) + '" text-anchor="middle" fill="' + (index === lastIndex ? COLORS.textBright : COLORS.text) + '" font-size="9">' +
        escapeHtml(item.label) + '</text>';
    }).join('');

    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Столбчатый график расходов на бензин по месяцам">' +
        gridLines +
        bars +
        labels +
      '</svg>';
  }

  global.MuranoCharts = {
    renderConsumption: renderConsumption,
    renderExpenses: renderExpenses
  };
})(typeof window !== 'undefined' ? window : globalThis);
