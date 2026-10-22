/*
 * АвтоЖурнал — расчёты.
 *
 * Этот файл ничего не знает про экран и кнопки. Здесь только математика:
 * пересчёт «литры / цена за литр / сумма», расход по методу «от полного до полного»
 * и статистика. Благодаря этому расчёты можно проверять тестами отдельно.
 */
(function (global) {
  'use strict';

  var PRICE_FIELD = Object.freeze({
    PRICE: 'price',
    TOTAL: 'total'
  });

  var STATIONS = Object.freeze([
    { id: 'paz', name: 'Paz' },
    { id: 'sonol', name: 'Sonol' },
    { id: 'dor-alon', name: 'Dor Alon' },
    { id: 'delek', name: 'Delek' },
    { id: 'other', name: 'Другое' }
  ]);

  var EPSILON = 1e-8;

  /**
   * Превращает то, что ввёл пользователь, в число.
   * Пустая строка, мусор, минус и бесконечность дают null — так мы не пускаем
   * в расчёты NaN и Infinity.
   */
  function parseNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== 'string') {
      return null;
    }
    var normalized = value
      .trim()
      .replace(/[\s\u00A0]/g, '')
      .replace(',', '.');

    if (!normalized) {
      return null;
    }
    // Только обычное положительное число: 12, 12.5, .5
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
      return null;
    }
    var number = Number(normalized);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }
    return number;
  }

  function nonNegative(value) {
    var number = parseNumber(value);
    return number !== null && number >= 0 ? number : null;
  }

  /** Округление только для показа. Внутри значения остаются точными. */
  function roundForDisplay(value, digits) {
    if (!Number.isFinite(value)) {
      return null;
    }
    var factor = Math.pow(10, digits);
    return Math.round(value * factor + EPSILON) / factor;
  }

  /**
   * Число для поля ввода: 2 знака после запятой и запятая (как принято в русском).
   * Пустое/некорректное значение превращается в пустую строку, а не в NaN.
   */
  function formatAmount(value, digits) {
    var places = typeof digits === 'number' ? digits : 2;
    if (!Number.isFinite(value)) {
      return '';
    }
    var rounded = roundForDisplay(value, places);
    if (rounded === null) {
      return '';
    }
    return rounded.toFixed(places).replace('.', ',');
  }

  /** Число с пробелами между тысячами: 130 500. */
  function formatNumber(value, maxFractionDigits) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    var digits = typeof maxFractionDigits === 'number' ? maxFractionDigits : 0;
    try {
      return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
      }).format(value);
    } catch (error) {
      return String(roundForDisplay(value, digits));
    }
  }

  /** Деньги в шекелях: 135,58 ₪. */
  function formatMoney(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    var rounded = roundForDisplay(value, 2);
    try {
      return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(rounded) + '\u00A0₪';
    } catch (error) {
      return formatAmount(rounded) + '\u00A0₪';
    }
  }

  function formatPrice(value) {
    return formatMoney(value);
  }

  /* ── АЗС ───────────────────────────────────────────────── */

  function stationName(id) {
    for (var index = 0; index < STATIONS.length; index += 1) {
      if (STATIONS[index].id === id) {
        return STATIONS[index].name;
      }
    }
    return '';
  }

  function stationTextKey(value) {
    return String(value === null || value === undefined ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[\s_-]+/g, ' ');
  }

  /**
   * Понимает старые записи, где АЗС была просто текстом.
   * Незнакомое название становится «Другое», чтобы ничего не потерялось.
   */
  function inferStationId(label) {
    var key = stationTextKey(label).replace(/ /g, '-');
    if (!key) {
      return '';
    }
    if (key === 'paz') {
      return 'paz';
    }
    if (key === 'sonol') {
      return 'sonol';
    }
    if (key === 'dor-alon') {
      return 'dor-alon';
    }
    if (key === 'delek') {
      return 'delek';
    }
    if (key === 'другое' || key === 'other') {
      return 'other';
    }
    return 'other';
  }

  function stationIdentity(item) {
    var record = item || {};
    var id = typeof record.stationId === 'string' ? record.stationId : '';
    if (!stationName(id)) {
      id = inferStationId(record.station);
    }
    var text = typeof record.station === 'string' ? record.station.trim() : '';

    if (id && id !== 'other') {
      return { id: id, key: id, name: stationName(id) };
    }
    if (id === 'other' || text) {
      if (!text || text === 'Другое') {
        return { id: 'other', key: 'other', name: 'Другое' };
      }
      return {
        id: 'other',
        key: 'other:' + stationTextKey(text),
        name: text
      };
    }
    return { id: '', key: 'none', name: 'Без АЗС' };
  }

  /**
   * Главный автопересчёт.
   *
   * lastPriceField говорит, какое поле цены человек редактировал последним:
   * 'price' — цену за литр, 'total' — общую сумму. Меняя литры, мы обновляем
   * именно противоположное поле.
   *
   * Возвращает точные числа (без округления) и derivedField — какое поле
   * было вычислено. Если данных недостаточно, derivedField = null.
   */
  function recalculate(input) {
    var source = input || {};
    var liters = nonNegative(source.liters);
    var pricePerLiter = nonNegative(source.pricePerLiter);
    var total = nonNegative(source.total);
    var lastPriceField = source.lastPriceField === PRICE_FIELD.PRICE ||
      source.lastPriceField === PRICE_FIELD.TOTAL
      ? source.lastPriceField
      : null;
    var derivedField = null;

    // Без положительного количества литров пересчёт не имеет смысла.
    // Ноль здесь важен: он защищает от деления на ноль.
    if (liters !== null && liters > 0) {
      if (lastPriceField === PRICE_FIELD.PRICE && pricePerLiter !== null) {
        total = liters * pricePerLiter;
        derivedField = PRICE_FIELD.TOTAL;
      } else if (lastPriceField === PRICE_FIELD.TOTAL && total !== null) {
        pricePerLiter = total / liters;
        derivedField = PRICE_FIELD.PRICE;
      } else if (pricePerLiter !== null) {
        // Если последнее поле пустое, используем то, что заполнено.
        total = liters * pricePerLiter;
        derivedField = PRICE_FIELD.TOTAL;
      } else if (total !== null) {
        pricePerLiter = total / liters;
        derivedField = PRICE_FIELD.PRICE;
      }
    }

    return {
      liters: liters,
      pricePerLiter: pricePerLiter,
      total: total,
      lastPriceField: lastPriceField,
      derivedField: derivedField
    };
  }

  function isValidDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    var parts = value.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    return (
      date.getFullYear() === parts[0] &&
      date.getMonth() === parts[1] - 1 &&
      date.getDate() === parts[2]
    );
  }

  function isValidFueling(item) {
    return Boolean(
      item &&
      typeof item === 'object' &&
      Number.isFinite(item.odometer) &&
      item.odometer >= 0 &&
      Number.isFinite(item.liters) &&
      item.liters > 0 &&
      isValidDateString(item.date)
    );
  }

  function sortedByOdometer(fuelings) {
    return (Array.isArray(fuelings) ? fuelings : [])
      .filter(isValidFueling)
      .slice()
      .sort(function (a, b) {
        if (a.odometer !== b.odometer) {
          return a.odometer - b.odometer;
        }
        if (a.date !== b.date) {
          return a.date < b.date ? -1 : 1;
        }
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
  }

  function sortedByDateDesc(fuelings) {
    return (Array.isArray(fuelings) ? fuelings : [])
      .filter(isValidFueling)
      .slice()
      .sort(function (a, b) {
        if (a.date !== b.date) {
          return a.date < b.date ? 1 : -1;
        }
        if (a.odometer !== b.odometer) {
          return b.odometer - a.odometer;
        }
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
  }

  /**
   * Расход «от полного до полного».
   *
   * Считаем литры всех заправок после предыдущей полной (включая частичные)
   * и делим на пробег между полными баками. Частичная заправка сама по себе
   * расход не создаёт — она добавляет литры к следующему полному баку.
   */
  function calculateConsumption(fuelings) {
    var records = sortedByOdometer(fuelings);
    var lastFull = null;
    var litersSinceFull = 0;
    var segments = [];
    var totalLiters = 0;
    var totalDistance = 0;

    records.forEach(function (record) {
      if (!lastFull) {
        if (record.fullTank) {
          lastFull = record;
          litersSinceFull = 0;
        }
        return;
      }

      litersSinceFull += record.liters;
      if (record.fullTank) {
        var distance = record.odometer - lastFull.odometer;
        if (distance > 0 && litersSinceFull > 0) {
          var consumption = (litersSinceFull / distance) * 100;
          segments.push({
            id: record.id,
            date: record.date,
            odometer: record.odometer,
            distance: distance,
            liters: litersSinceFull,
            consumption: consumption
          });
          totalLiters += litersSinceFull;
          totalDistance += distance;
        }
        lastFull = record;
        litersSinceFull = 0;
      }
    });

    var average = totalDistance > 0 ? (totalLiters / totalDistance) * 100 : null;

    return {
      average: average,
      last: segments.length ? segments[segments.length - 1].consumption : null,
      segments: segments,
      totalLiters: totalLiters,
      totalDistance: totalDistance
    };
  }

  function monthKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    return year + '-' + month;
  }

  function expensesForMonth(fuelings, date) {
    var key = monthKey(date);
    return (Array.isArray(fuelings) ? fuelings : []).reduce(function (sum, item) {
      if (!isValidFueling(item) || item.date.slice(0, 7) !== key) {
        return sum;
      }
      return sum + (Number.isFinite(item.total) ? item.total : 0);
    }, 0);
  }

  /* ── Периоды и статистика АЗС ──────────────────────────── */

  function localIsoDate(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  /**
   * Границы периода в виде строк ГГГГ-ММ-ДД.
   * start включается, end не включается. Для «всё время» границ нет.
   */
  function periodRange(period, now) {
    var reference = now instanceof Date ? now : new Date();
    var year = reference.getFullYear();
    var month = reference.getMonth();
    var day = reference.getDate();

    if (period === 'month') {
      return {
        start: localIsoDate(new Date(year, month, 1)),
        end: localIsoDate(new Date(year, month + 1, 1))
      };
    }
    if (period === 'prev-month') {
      return {
        start: localIsoDate(new Date(year, month - 1, 1)),
        end: localIsoDate(new Date(year, month, 1))
      };
    }
    if (period === 'year') {
      return {
        start: localIsoDate(new Date(year, 0, 1)),
        end: localIsoDate(new Date(year + 1, 0, 1))
      };
    }
    if (period === 'last30') {
      return {
        start: localIsoDate(new Date(year, month, day - 29)),
        end: localIsoDate(new Date(year, month, day + 1))
      };
    }
    return null;
  }

  function filterByPeriod(fuelings, period, now) {
    var records = (Array.isArray(fuelings) ? fuelings : []).filter(isValidFueling);
    var range = periodRange(period, now);
    if (!range) {
      return records;
    }
    return records.filter(function (item) {
      return item.date >= range.start && item.date < range.end;
    });
  }

  function calculatePeriodSummary(fuelings, options) {
    var source = options || {};
    var period = typeof source.period === 'string' ? source.period : 'all';
    var now = source.now instanceof Date ? source.now : new Date();
    var records = filterByPeriod(fuelings, period, now);

    var totalSpent = 0;
    var totalLiters = 0;
    records.forEach(function (item) {
      totalSpent += Number.isFinite(item.total) ? item.total : 0;
      totalLiters += item.liters;
    });

    return {
      period: period,
      recordsCount: records.length,
      totalSpent: totalSpent,
      totalLiters: totalLiters,
      averagePrice: totalLiters > 0 ? totalSpent / totalLiters : null,
      firstDate: records.length
        ? records.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0].date
        : null,
      lastDate: records.length
        ? records.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0].date
        : null
    };
  }

  function calculateStationStats(fuelings, options) {
    var source = options || {};
    var period = typeof source.period === 'string' ? source.period : 'all';
    var now = source.now instanceof Date ? source.now : new Date();
    var records = filterByPeriod(fuelings, period, now);
    var groups = {};

    records.forEach(function (item) {
      var identity = stationIdentity(item);
      if (!groups[identity.key]) {
        groups[identity.key] = {
          id: identity.id,
          name: identity.name,
          count: 0,
          liters: 0,
          total: 0
        };
      }
      var group = groups[identity.key];
      group.count += 1;
      group.liters += item.liters;
      group.total += Number.isFinite(item.total) ? item.total : 0;
    });

    var stations = Object.keys(groups).map(function (key) {
      var group = groups[key];
      return {
        id: group.id,
        name: group.name,
        count: group.count,
        liters: group.liters,
        total: group.total,
        averagePrice: group.liters > 0 ? group.total / group.liters : null
      };
    });

    var bySpent = stations.slice().sort(function (a, b) {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name, 'ru');
    });

    var byVisits = stations.slice().sort(function (a, b) {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.name.localeCompare(b.name, 'ru');
    });

    return {
      period: period,
      recordsCount: records.length,
      totalSpent: bySpent.reduce(function (sum, item) { return sum + item.total; }, 0),
      totalLiters: bySpent.reduce(function (sum, item) { return sum + item.liters; }, 0),
      stations: bySpent,
      topByVisits: byVisits.length ? byVisits[0] : null,
      topBySpent: bySpent.length ? bySpent[0] : null
    };
  }

  function calculateStats(options) {
    var source = options || {};
    var fuelings = Array.isArray(source.fuelings) ? source.fuelings : [];
    var initialOdometer = nonNegative(source.initialOdometer);
    var now = source.now instanceof Date ? source.now : new Date();

    var records = sortedByOdometer(fuelings);
    var minOdometer = records.length ? records[0].odometer : null;
    var maxOdometer = records.length ? records[records.length - 1].odometer : null;

    var currentOdometer = null;
    if (maxOdometer !== null && initialOdometer !== null) {
      currentOdometer = Math.max(initialOdometer, maxOdometer);
    } else if (maxOdometer !== null) {
      currentOdometer = maxOdometer;
    } else {
      currentOdometer = initialOdometer;
    }

    var baseline = null;
    if (minOdometer !== null && initialOdometer !== null) {
      baseline = Math.min(initialOdometer, minOdometer);
    } else if (minOdometer !== null) {
      baseline = minOdometer;
    } else {
      baseline = initialOdometer;
    }

    var trackedDistance = null;
    if (maxOdometer !== null && baseline !== null && maxOdometer > baseline) {
      trackedDistance = maxOdometer - baseline;
    }

    var totalSpent = 0;
    var totalLiters = 0;
    records.forEach(function (record) {
      totalSpent += Number.isFinite(record.total) ? record.total : 0;
      totalLiters += record.liters;
    });

    var consumption = calculateConsumption(records);
    var costPerKm = trackedDistance && trackedDistance > 0
      ? totalSpent / trackedDistance
      : null;

    return {
      currentOdometer: currentOdometer,
      averageConsumption: consumption.average,
      lastConsumption: consumption.last,
      segments: consumption.segments,
      monthExpenses: expensesForMonth(records, now),
      costPerKm: costPerKm,
      totalSpent: totalSpent,
      totalLiters: totalLiters,
      trackedDistance: trackedDistance,
      recordsCount: records.length,
      lastDate: records.length
        ? records.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0].date
        : null
    };
  }

  /**
   * Расходы по месяцам для столбчатого графика: последние N месяцев,
   * включая текущий, в хронологическом порядке.
   */
  function monthlyExpenseSeries(fuelings, months, now) {
    var count = Math.max(1, Number(months) || 6);
    var reference = now instanceof Date ? now : new Date();
    var series = [];

    for (var index = count - 1; index >= 0; index -= 1) {
      var date = new Date(reference.getFullYear(), reference.getMonth() - index, 1);
      var key = monthKey(date);
      var spent = (Array.isArray(fuelings) ? fuelings : []).reduce(function (sum, item) {
        if (!isValidFueling(item) || item.date.slice(0, 7) !== key) {
          return sum;
        }
        return sum + (Number.isFinite(item.total) ? item.total : 0);
      }, 0);
      series.push({
        key: key,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        label: date.toLocaleDateString('ru-RU', { month: 'short' }),
        total: spent
      });
    }
    return series;
  }

  global.MuranoCalc = {
    PRICE_FIELD: PRICE_FIELD,
    STATIONS: STATIONS,
    parseNumber: parseNumber,
    formatAmount: formatAmount,
    formatNumber: formatNumber,
    formatMoney: formatMoney,
    formatPrice: formatPrice,
    roundForDisplay: roundForDisplay,
    recalculate: recalculate,
    stationName: stationName,
    inferStationId: inferStationId,
    stationIdentity: stationIdentity,
    isValidDateString: isValidDateString,
    isValidFueling: isValidFueling,
    sortedByOdometer: sortedByOdometer,
    sortedByDateDesc: sortedByDateDesc,
    calculateConsumption: calculateConsumption,
    calculateStats: calculateStats,
    periodRange: periodRange,
    filterByPeriod: filterByPeriod,
    calculatePeriodSummary: calculatePeriodSummary,
    calculateStationStats: calculateStationStats,
    expensesForMonth: expensesForMonth,
    monthlyExpenseSeries: monthlyExpenseSeries
  };
})(typeof window !== 'undefined' ? window : globalThis);
