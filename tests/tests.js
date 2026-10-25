/*
 * Тесты АвтоЖурнала.
 * Запускаются в браузере вместе с tests.html. Никаких библиотек и установки.
 */
(function () {
  'use strict';

  var C = window.MuranoCalc;
  var S = window.MuranoStorage;
  var O = window.MuranoOcr;
  var F = window.MuranoFocus;
  var results = [];
  var NBSP = '\u00A0';

  function test(group, name, fn) {
    try {
      fn();
      results.push({ group: group, name: name, ok: true });
    } catch (error) {
      results.push({
        group: group,
        name: name,
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  function fail(message) {
    throw new Error(message);
  }

  function same(actual, expected, label) {
    if (typeof actual === 'number' && typeof expected === 'number') {
      var tolerance = 1e-9 * Math.max(1, Math.abs(expected));
      if (Math.abs(actual - expected) > tolerance) {
        fail((label ? label + ': ' : '') + 'ожидалось ' + expected + ', получено ' + actual);
      }
      return;
    }
    if (actual !== expected) {
      fail((label ? label + ': ' : '') + 'ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
    }
  }

  function ok(value, label) {
    if (!value) {
      fail(label || 'ожидалось истинное значение');
    }
  }

  function throws(fn, label) {
    try {
      fn();
    } catch (error) {
      return;
    }
    fail(label || 'ожидалось исключение');
  }

  function fueling(date, odometer, liters, total, fullTank, station, stationId) {
    return {
      id: 'r-' + date + '-' + odometer,
      date: date,
      odometer: odometer,
      liters: liters,
      pricePerLiter: total / liters,
      total: total,
      station: station || '',
      stationId: stationId || '',
      note: '',
      fullTank: Boolean(fullTank),
      createdAt: date + 'T10:00:00.000Z'
    };
  }

  function maintenance(date, odometer, title, partsCost, laborCost, note) {
    return {
      id: 'm-' + date + '-' + odometer,
      date: date,
      odometer: odometer,
      title: title,
      partsCost: partsCost,
      laborCost: laborCost,
      note: note || '',
      createdAt: date + 'T09:00:00.000Z'
    };
  }

  function memoryStore(initialData) {
    var data = Object.create(null);
    if (initialData) {
      Object.keys(initialData).forEach(function (key) {
        data[key] = initialData[key];
      });
    }
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      }
    };
  }

  function failingStore(base) {
    return {
      getItem: function (key) {
        return base.getItem(key);
      },
      setItem: function () {
        throw new Error('quota');
      },
      removeItem: function () {
        throw new Error('quota');
      }
    };
  }

  /* ── Автопересчёт ─────────────────────────────────────── */

  test('Пересчёт', 'Литры + цена за литр → сумма', function () {
    var result = C.recalculate({
      liters: 42.5,
      pricePerLiter: 3.19,
      total: null,
      lastPriceField: 'price'
    });
    same(result.total, 135.575, 'сумма');
    same(result.pricePerLiter, 3.19, 'цена не изменилась');
    same(result.derivedField, 'total', 'вычислено поле');
  });

  test('Пересчёт', 'Литры + сумма → цена за литр', function () {
    var result = C.recalculate({
      liters: 42.5,
      pricePerLiter: null,
      total: 135.575,
      lastPriceField: 'total'
    });
    same(result.pricePerLiter, 3.19, 'цена за литр');
    same(result.total, 135.575, 'сумма не изменилась');
    same(result.derivedField, 'price', 'вычислено поле');
  });

  test('Пересчёт', 'Изменение литров после ввода цены за литр пересчитывает сумму', function () {
    var first = C.recalculate({
      liters: 40,
      pricePerLiter: 3.19,
      total: null,
      lastPriceField: 'price'
    });
    same(first.total, 127.6);

    var second = C.recalculate({
      liters: 50,
      pricePerLiter: 3.19,
      total: first.total,
      lastPriceField: 'price'
    });
    same(second.total, 159.5, 'новая сумма');
    same(second.pricePerLiter, 3.19, 'цена осталась');
    same(second.derivedField, 'total');
  });

  test('Пересчёт', 'Изменение литров после ввода суммы пересчитывает цену за литр', function () {
    var first = C.recalculate({
      liters: 40,
      pricePerLiter: null,
      total: 150,
      lastPriceField: 'total'
    });
    same(first.pricePerLiter, 3.75);

    var second = C.recalculate({
      liters: 50,
      pricePerLiter: first.pricePerLiter,
      total: 150,
      lastPriceField: 'total'
    });
    same(second.pricePerLiter, 3, 'новая цена');
    same(second.total, 150, 'сумма осталась');
    same(second.derivedField, 'price');
  });

  test('Пересчёт', 'Промежуточные значения не округляются', function () {
    var result = C.recalculate({
      liters: 7.3,
      pricePerLiter: 1.2345,
      total: null,
      lastPriceField: 'price'
    });
    same(result.total, 9.01185, 'точная сумма');
    same(C.formatAmount(result.total), '9,01', 'на экране два знака');
  });

  test('Пересчёт', 'Сумма показывается ровно с двумя знаками', function () {
    same(C.formatAmount(135.575), '135,58');
    same(C.formatAmount(1.005), '1,01');
    same(C.formatAmount(3), '3,00');
    same(C.formatMoney(135.575), '135,58' + NBSP + '₪');
  });

  test('Пересчёт', 'Пустые поля не дают NaN', function () {
    var result = C.recalculate({
      liters: null,
      pricePerLiter: null,
      total: null,
      lastPriceField: null
    });
    same(result.liters, null);
    same(result.pricePerLiter, null);
    same(result.total, null);
    same(result.derivedField, null);
    ok(Number.isFinite(result.total) === false, 'total не должен быть числом');
  });

  test('Пересчёт', 'Только литры — ничего не вычисляется', function () {
    var result = C.recalculate({ liters: 40, pricePerLiter: null, total: null });
    same(result.total, null);
    same(result.pricePerLiter, null);
  });

  test('Пересчёт', 'Только цена — суммы нет, деления нет', function () {
    var result = C.recalculate({ liters: null, pricePerLiter: 3.19, total: null, lastPriceField: 'price' });
    same(result.total, null);
    same(result.pricePerLiter, 3.19);
  });

  test('Пересчёт', 'Только сумма — цены нет, деления нет', function () {
    var result = C.recalculate({ liters: null, pricePerLiter: null, total: 100, lastPriceField: 'total' });
    same(result.pricePerLiter, null);
    same(result.total, 100);
  });

  test('Пересчёт', 'Заполнена сумма, поле цены пустое — цена считается', function () {
    var result = C.recalculate({
      liters: 40,
      pricePerLiter: null,
      total: 100,
      lastPriceField: 'price'
    });
    same(result.pricePerLiter, 2.5);
    same(result.derivedField, 'price');
  });

  test('Пересчёт', 'Ноль литров не приводит к делению на ноль', function () {
    var result = C.recalculate({
      liters: 0,
      pricePerLiter: null,
      total: 100,
      lastPriceField: 'total'
    });
    same(result.pricePerLiter, null, 'цена не вычислена');
    same(result.total, 100, 'сумма сохранена');
    same(result.derivedField, null);
    ok(!Number.isFinite(result.pricePerLiter), 'Infinity не должен появиться');
  });

  test('Пересчёт', 'Ноль литров + цена не создают сумму', function () {
    var result = C.recalculate({
      liters: 0,
      pricePerLiter: 3,
      total: null,
      lastPriceField: 'price'
    });
    same(result.total, null);
    same(result.derivedField, null);
  });

  test('Пересчёт', 'Отрицательные значения отбрасываются', function () {
    var result = C.recalculate({
      liters: -5,
      pricePerLiter: -3,
      total: -100,
      lastPriceField: 'total'
    });
    same(result.liters, null);
    same(result.pricePerLiter, null);
    same(result.total, null);
    same(result.derivedField, null);
  });

  test('Пересчёт', 'Пустые строки и пробелы', function () {
    same(C.parseNumber(''), null);
    same(C.parseNumber('   '), null);
    same(C.parseNumber(' 3,19 '), 3.19);
    same(C.parseNumber('130 500'), 130500);
    same(C.formatAmount(null), '');
    same(C.formatMoney(Infinity), '—');
    same(C.formatMoney(NaN), '—');
  });

  test('Пересчёт', 'Мусор не превращается в число', function () {
    same(C.parseNumber('12abc'), null);
    same(C.parseNumber('1e3'), null);
    same(C.parseNumber('-1'), null);
    same(C.parseNumber('Infinity'), null);
    same(C.parseNumber('NaN'), null);
    same(C.parseNumber('1.2.3'), null);
  });

  test('Пересчёт', 'Обратный пересчёт: сумма / литры', function () {
    var result = C.recalculate({
      liters: 3,
      pricePerLiter: null,
      total: 100,
      lastPriceField: 'total'
    });
    ok(Math.abs(result.pricePerLiter - 33.3333333333) < 1e-6);
    same(C.formatAmount(result.pricePerLiter), '33,33');
  });

  /* ── Расход от полного до полного ─────────────────────── */

  test('Расход', 'Два полных бака: литры второго делим на пробег', function () {
    var data = [
      fueling('2026-01-01', 1000, 40, 200, true),
      fueling('2026-01-20', 1500, 35, 180, true)
    ];
    var result = C.calculateConsumption(data);
    same(result.average, 7, 'средний расход');
    same(result.segments.length, 1);
    same(result.segments[0].distance, 500);
    same(result.segments[0].liters, 35);
  });

  test('Расход', 'Частичная заправка добавляет литры к следующему полному баку', function () {
    var data = [
      fueling('2026-01-01', 1000, 40, 200, true),
      fueling('2026-01-10', 1200, 10, 50, false),
      fueling('2026-01-20', 1500, 30, 150, true)
    ];
    var result = C.calculateConsumption(data);
    same(result.average, 8, '40 л на 500 км');
    same(result.segments.length, 1);
  });

  test('Расход', 'Частичные заправки до первого полного бака игнорируются', function () {
    var data = [
      fueling('2026-01-01', 800, 10, 50, false),
      fueling('2026-01-05', 1000, 40, 200, true),
      fueling('2026-01-25', 1500, 35, 180, true)
    ];
    var result = C.calculateConsumption(data);
    same(result.average, 7);
    same(result.segments.length, 1);
  });

  test('Расход', 'Незавершённый участок после последнего полного бака не считается', function () {
    var data = [
      fueling('2026-01-01', 1000, 40, 200, true),
      fueling('2026-01-20', 1500, 35, 180, true),
      fueling('2026-02-01', 1800, 10, 50, false)
    ];
    var result = C.calculateConsumption(data);
    same(result.segments.length, 1);
    same(result.average, 7);
    same(result.totalLiters, 35);
    same(result.totalDistance, 500);
  });

  test('Расход', 'Средний расход взвешенный, а не среднее из средних', function () {
    var data = [
      fueling('2026-01-01', 1000, 40, 200, true),
      fueling('2026-01-20', 1500, 20, 100, true),
      fueling('2026-02-20', 2500, 50, 250, true)
    ];
    var result = C.calculateConsumption(data);
    same(result.segments[0].consumption, 4);
    same(result.segments[1].consumption, 5);
    same(result.average, 4.6666666667, 'взвешенный результат');
  });

  test('Расход', 'Нулевой пробег между баками не делит на ноль', function () {
    var data = [
      fueling('2026-01-01', 1000, 40, 200, true),
      fueling('2026-01-02', 1000, 20, 100, true),
      fueling('2026-01-20', 1500, 30, 150, true)
    ];
    var result = C.calculateConsumption(data);
    same(result.segments.length, 1);
    same(result.average, 6);
    ok(Number.isFinite(result.average), 'расход должен быть числом');
  });

  test('Расход', 'Без полных баков расхода нет', function () {
    var data = [
      fueling('2026-01-01', 1000, 20, 100, false),
      fueling('2026-01-10', 1200, 20, 100, false)
    ];
    var result = C.calculateConsumption(data);
    same(result.average, null);
    same(result.segments.length, 0);
  });

  /* ── Статистика ───────────────────────────────────────── */

  var statsFixture = [
    fueling('2026-09-15', 130500, 40, 200, true),
    fueling('2026-10-01', 131000, 30, 150, true),
    fueling('2026-10-20', 131500, 20, 100, false)
  ];

  test('Статистика', 'Пробег, расход, расходы за месяц и стоимость километра', function () {
    var result = C.calculateStats({
      fuelings: statsFixture,
      initialOdometer: 130000,
      now: new Date(2026, 9, 23)
    });
    same(result.currentOdometer, 131500);
    same(result.averageConsumption, 6);
    same(result.monthExpenses, 250, 'октябрь: 150 + 100');
    same(result.totalSpent, 450);
    same(result.totalLiters, 90);
    same(result.trackedDistance, 1500);
    same(result.costPerKm, 0.3);
    same(result.recordsCount, 3);
  });

  test('Статистика', 'Только начальный пробег, без записей', function () {
    var result = C.calculateStats({
      fuelings: [],
      initialOdometer: 130000,
      now: new Date(2026, 9, 23)
    });
    same(result.currentOdometer, 130000);
    same(result.averageConsumption, null);
    same(result.costPerKm, null);
    same(result.monthExpenses, 0);
  });

  test('Статистика', 'Пробег на главном экране берётся из последней записи, а не из максимума', function () {
    var data = [
      fueling('2026-09-01', 132000, 40, 200, true),
      fueling('2026-10-01', 131500, 30, 150, true),
      fueling('2026-10-20', 131200, 20, 100, true)
    ];
    var result = C.calculateStats({
      fuelings: data,
      initialOdometer: 130000,
      now: new Date(2026, 9, 23)
    });
    same(result.currentOdometer, 131200, 'последняя запись по дате');
    same(result.lastDate, '2026-10-20');
  });

  test('Пробег', 'Последние три цифры превращаются в предполагаемый полный пробег', function () {
    same(C.proposeOdometer('450', 130500), 131450, 'следующая тысяча');
    same(C.proposeOdometer('450', 130300), 130450, 'та же тысяча');
    same(C.proposeOdometer('450', 130450), 130450, 'равен предыдущему');
    same(C.proposeOdometer('000', 130500), 131000, 'переход через тысячу');
    same(C.proposeOdometer('045', 130500), 131045, 'ведущий ноль');
    same(C.proposeOdometer('450', 0), 450);
    same(C.proposeOdometer('45', 130500), null, 'две цифры не дополняем');
    same(C.proposeOdometer('130450', 130500), null, 'полный пробег не меняем');
    same(C.proposeOdometer('450', null), null, 'нет опорного пробега');
  });

  test('Пробег', 'Предыдущая запись ищется по дате без редактируемой записи', function () {
    var data = [
      fueling('2026-10-01', 1100, 40, 200, true),
      fueling('2026-10-05', 1200, 30, 150, true),
      fueling('2026-10-20', 1300, 20, 100, true)
    ];
    same(C.findPreviousRecord(data, '2026-10-04').id, 'r-2026-10-01-1100');
    same(
      C.findPreviousRecord(data, '2026-10-05', 'r-2026-10-05-1200').id,
      'r-2026-10-01-1100',
      'редактируемая запись не считается предыдущей'
    );
    same(C.findPreviousRecord(data, '2026-09-30'), null);
    same(C.findPreviousRecord(data, 'не дата'), null);
  });

  test('Топливо за период', 'Месяц и всё время считают расходы и километры отдельно', function () {
    var now = new Date(2026, 9, 23);
    var data = [
      fueling('2026-09-15', 130500, 40, 200, true),
      fueling('2026-10-01', 131000, 30, 150, true),
      fueling('2026-10-20', 131500, 20, 100, false)
    ];

    var month = C.calculateFuelPeriodStats(data, {
      period: 'month',
      initialOdometer: 130000,
      now: now
    });
    same(month.totalSpent, 250, 'только октябрь');
    same(month.totalLiters, 50);
    same(month.startOdometer, 130500, 'опора перед месяцем');
    same(month.distance, 1000, 'путь за октябрь');
    same(month.costPerKm, 0.25);

    var all = C.calculateFuelPeriodStats(data, {
      period: 'all',
      initialOdometer: 130000,
      now: now
    });
    same(all.totalSpent, 450);
    same(all.startOdometer, 130000, 'начальный пробег');
    same(all.distance, 1500);
    same(all.costPerKm, 0.3);
  });

  test('Топливо за период', 'Без опорной записи или начального пробега стоимость не выдумывается', function () {
    var now = new Date(2026, 9, 23);
    var data = [
      fueling('2026-10-01', 131000, 30, 150, true),
      fueling('2026-10-20', 131500, 20, 100, false)
    ];

    var month = C.calculateFuelPeriodStats(data, {
      period: 'month',
      initialOdometer: 130000,
      now: now
    });
    same(month.totalSpent, 250);
    same(month.distance, null, 'нет записи до начала месяца');
    same(month.costPerKm, null);

    var all = C.calculateFuelPeriodStats(data, {
      period: 'all',
      initialOdometer: null,
      now: now
    });
    same(all.totalSpent, 250);
    same(all.distance, null, 'нет начального пробега');
    same(all.costPerKm, null);
    same(all.hasInitialOdometer, false);
  });

  test('Топливо за период', 'Последняя запись важнее ошибочного максимума', function () {
    var data = [
      fueling('2026-09-01', 132000, 40, 200, true),
      fueling('2026-10-20', 131500, 30, 150, true)
    ];
    var result = C.calculateFuelPeriodStats(data, {
      period: 'all',
      initialOdometer: 130000,
      now: new Date(2026, 9, 23)
    });
    same(result.endOdometer, 131500);
    same(result.distance, 1500);
    same(result.costPerKm, 350 / 1500);
  });

  test('Топливо за период', 'Если пробег не вырос, стоимость километра не считается', function () {
    var data = [
      fueling('2026-09-15', 131600, 40, 200, true),
      fueling('2026-10-20', 131500, 20, 100, true)
    ];
    var result = C.calculateFuelPeriodStats(data, {
      period: 'month',
      initialOdometer: 130000,
      now: new Date(2026, 9, 23)
    });
    same(result.totalSpent, 100);
    same(result.distance, null);
    same(result.costPerKm, null);
  });

  test('Статистика', 'Расходы по месяцам: последние 6 месяцев по порядку', function () {
    var data = [
      fueling('2026-05-02', 1000, 10, 100, true),
      fueling('2026-07-02', 1500, 10, 200, true),
      fueling('2026-10-03', 2000, 10, 50, true),
      fueling('2025-09-03', 2500, 10, 999, true)
    ];
    var series = C.monthlyExpenseSeries(data, 6, new Date(2026, 9, 23));
    same(series.length, 6);
    same(series.map(function (item) { return item.key; }).join(','), '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10');
    same(series.map(function (item) { return item.total; }).join(','), '100,0,200,0,0,50');
  });

  test('Статистика', 'Проверка даты', function () {
    same(C.isValidDateString('2024-02-29'), true);
    same(C.isValidDateString('2023-02-29'), false);
    same(C.isValidDateString('2026-13-01'), false);
    same(C.isValidDateString('abc'), false);
  });

  /* ── Периоды и АЗС ────────────────────────────────────── */

  var periodFixture = [
    fueling('2026-09-10', 1000, 10, 60, true, 'Sonol'),
    fueling('2026-10-01', 1100, 30, 150, true, 'Paz'),
    fueling('2026-10-05', 1200, 20, 100, false, 'Paz'),
    fueling('2026-10-20', 1300, 5, 25, true, 'Delek'),
    fueling('2026-01-05', 1400, 10, 50, true, 'Sonol')
  ];

  test('Периоды', 'Этот месяц, прошлый месяц, год, 30 дней и всё время', function () {
    var now = new Date(2026, 9, 23);
    same(C.filterByPeriod(periodFixture, 'month', now).length, 3, 'этот месяц');
    same(C.filterByPeriod(periodFixture, 'prev-month', now).length, 1, 'прошлый месяц');
    same(C.filterByPeriod(periodFixture, 'year', now).length, 5, 'этот год');
    same(C.filterByPeriod(periodFixture, 'last30', now).length, 3, '30 дней');
    same(C.filterByPeriod(periodFixture, 'all', now).length, 5, 'всё время');
  });

  test('Периоды', 'Итог за период: сумма, литры и средняя цена', function () {
    var now = new Date(2026, 9, 23);
    var month = C.calculatePeriodSummary(periodFixture, { period: 'month', now: now });
    same(month.recordsCount, 3);
    same(month.totalSpent, 275, 'сумма за октябрь');
    same(month.totalLiters, 55, 'литры за октябрь');
    same(month.averagePrice, 5, 'средняя цена');

    var all = C.calculatePeriodSummary(periodFixture, { period: 'all', now: now });
    same(all.totalSpent, 385, 'сумма за всё время');
    same(all.totalLiters, 75, 'литры за всё время');

    var empty = C.calculatePeriodSummary(periodFixture, { period: 'prev-month', now: new Date(2026, 11, 1) });
    same(empty.recordsCount, 0);
    same(empty.totalSpent, 0);
    same(empty.averagePrice, null);
  });

  var stationFixture = [
    fueling('2026-09-10', 1000, 10, 60, true, 'Sonol'),
    fueling('2026-10-01', 1100, 30, 150, true, 'Paz'),
    fueling('2026-10-05', 1200, 20, 100, false, 'paz'),
    fueling('2026-10-10', 1300, 40, 300, true, 'Sonol'),
    fueling('2026-10-15', 1400, 10, 50, true, 'Delek'),
    fueling('2026-10-20', 1500, 5, 25, true, 'Yango'),
    fueling('2026-10-21', 1600, 5, 25, true, '')
  ];

  test('АЗС', 'Чаще всего и больше расходов за период', function () {
    var result = C.calculateStationStats(stationFixture, {
      period: 'month',
      now: new Date(2026, 9, 23)
    });
    same(result.recordsCount, 6);
    same(result.stations.length, 5, 'Paz, Sonol, Delek, Yango и без АЗС');
    same(result.totalSpent, 650);
    same(result.totalLiters, 110);
    same(result.topByVisits.name, 'Paz', 'чаще всего');
    same(result.topByVisits.count, 2);
    same(result.topBySpent.name, 'Sonol', 'больше денег');
    same(result.topBySpent.total, 300);
    same(result.stations[0].name, 'Sonol', 'список отсортирован по сумме');
  });

  test('АЗС', 'Названия объединяются, незнакомое становится «Другое»', function () {
    same(C.inferStationId('Dor Alon'), 'dor-alon');
    same(C.inferStationId('dor-alon'), 'dor-alon');
    same(C.inferStationId('PAZ'), 'paz');
    same(C.inferStationId('Yango'), 'other');
    same(C.inferStationId(''), '');
    same(C.stationName('delek'), 'Delek');
    same(C.stationIdentity({ station: 'Dor Alon' }).key, 'dor-alon');
    same(C.stationIdentity({ station: 'Yango' }).key, 'other:yango');
    same(C.stationIdentity({ station: 'yango' }).key, 'other:yango', 'регистр не важен');
    same(C.stationIdentity({ station: '' }).name, 'Без АЗС');
  });

  test('АЗС', 'АЗС сохраняются в резервной копии и старых записях', function () {
    var json = JSON.stringify({
      app: 'murano-log',
      schemaVersion: 1,
      settings: { initialOdometer: 130000 },
      fuelings: [
        { date: '2026-10-01', odometer: 131000, liters: 40, total: 120, station: 'Dor Alon' },
        { date: '2026-10-02', odometer: 131100, liters: 30, total: 90, station: 'Yango' },
        { date: '2026-10-03', odometer: 131200, liters: 20, total: 60, stationId: 'paz' }
      ]
    });
    var restored = S.parseBackup(json);
    var restoredFuelings = restored.profiles[0].fuelings;
    same(restoredFuelings[0].stationId, 'dor-alon');
    same(restoredFuelings[0].station, 'Dor Alon');
    same(restoredFuelings[1].stationId, 'other');
    same(restoredFuelings[1].station, 'Yango');
    same(restoredFuelings[2].stationId, 'paz');
    same(restoredFuelings[2].station, 'Paz');

    var exported = S.parseBackup(S.backupJson({
      settings: { initialOdometer: 130000 },
      fuelings: [fueling('2026-10-01', 131000, 40, 120, true, 'Sonol', 'sonol')]
    }));
    same(exported.profiles[0].fuelings[0].stationId, 'sonol');
    same(exported.profiles[0].fuelings[0].station, 'Sonol');
  });

  /* ── Резервные копии ──────────────────────────────────── */

  var sampleState = {
    settings: { initialOdometer: 130000 },
    fuelings: [fueling('2026-10-01', 131000, 40, 120, true)]
  };

  test('Резервные копии', 'Экспорт и импорт сохраняют данные', function () {
    var json = S.backupJson(sampleState);
    var restored = S.parseBackup(json);
    var profile = restored.profiles[0];
    same(restored.schemaVersion, 2);
    same(restored.activeProfileId, profile.id);
    same(profile.initialOdometer, 130000);
    same(profile.fuelings.length, 1);
    same(profile.fuelings[0].odometer, 131000);
    same(profile.fuelings[0].liters, 40);
    same(profile.fuelings[0].total, 120);
    same(profile.fuelings[0].fullTank, true);
  });

  test('Профили', 'Старые данные переносятся в один профиль', function () {
    var restored = S.parseBackup(JSON.stringify({
      app: 'murano-log',
      schemaVersion: 1,
      settings: { initialOdometer: 130000 },
      fuelings: [fueling('2026-10-01', 131000, 40, 120, true)]
    }));
    same(restored.schemaVersion, 2);
    same(restored.profiles.length, 1);
    same(restored.profiles[0].name, 'Моя машина');
    same(restored.profiles[0].initialOdometer, 130000);
    same(restored.profiles[0].fuelings.length, 1);
    same(restored.activeProfileId, restored.profiles[0].id);
  });

  test('Профили', 'Два автомобиля хранятся и экспортируются отдельно', function () {
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'work',
      profiles: [
        {
          id: 'own',
          name: 'Своя',
          initialOdometer: 100000,
          fuelings: [fueling('2026-10-01', 100500, 40, 120, true)]
        },
        {
          id: 'work',
          name: 'Рабочая',
          initialOdometer: 200000,
          fuelings: [fueling('2026-10-02', 200600, 50, 150, true)]
        }
      ]
    });

    same(state.activeProfileId, 'work');
    same(state.profiles.length, 2);
    same(state.profiles[0].fuelings.length, 1);
    same(state.profiles[0].fuelings[0].odometer, 100500);
    same(state.profiles[1].fuelings[0].odometer, 200600);

    var restored = S.parseBackup(S.backupJson(state));
    same(restored.activeProfileId, 'work');
    same(restored.profiles.length, 2);
    same(restored.profiles[1].name, 'Рабочая');
    same(restored.profiles[1].initialOdometer, 200000);
    same(restored.profiles[1].fuelings[0].odometer, 200600);
  });

  test('Профили', 'Новый профиль начинается с пустого журнала', function () {
    var profile = S.createProfile('Рабочая', 85000);
    same(profile.name, 'Рабочая');
    same(profile.initialOdometer, 85000);
    same(profile.fuelings.length, 0);
    ok(profile.id, 'у профиля есть id');

    var withoutOdometer = S.createProfile('Без пробега', null);
    same(withoutOdometer.initialOdometer, null);
  });

  test('Профили', 'По умолчанию создаётся один активный автомобиль', function () {
    var state = S.defaultState();
    same(state.schemaVersion, 2);
    same(state.profiles.length, 1);
    same(state.activeProfileId, state.profiles[0].id);
    same(state.profiles[0].fuelings.length, 0);
  });

  test('Резервные копии', 'Чужой файл отклоняется', function () {
    throws(function () {
      S.parseBackup('{"app":"other","schemaVersion":1,"fuelings":[]}');
    }, 'должна быть ошибка');
    throws(function () {
      S.parseBackup('не json');
    }, 'должна быть ошибка JSON');
  });

  test('Резервные копии', 'При импорте недостающая цена вычисляется из суммы', function () {
    var json = JSON.stringify({
      app: 'murano-log',
      schemaVersion: 1,
      settings: { initialOdometer: 130000 },
      fuelings: [{
        date: '2026-10-01',
        odometer: 131000,
        liters: 40,
        total: 100,
        fullTank: true
      }]
    });
    var restored = S.parseBackup(json);
    same(restored.profiles[0].fuelings[0].pricePerLiter, 2.5);
    same(restored.profiles[0].fuelings[0].total, 100);
  });

  /* ── Защита данных ────────────────────────────────────── */

  function storedState(odometer, date) {
    return S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling(date || '2026-10-01', odometer || 1100, 40, 120, true)]
      }]
    });
  }

  test('Хранение', 'Ошибка записи не меняет сохранённые данные', function () {
    var store = memoryStore();
    var first = storedState(1100);
    var second = storedState(2200, '2026-10-02');

    same(S.save(first, store), true, 'первая запись');
    var saved = store.getItem(S.STORAGE_KEY);

    same(S.save(second, failingStore(store)), false, 'ошибка записи');
    same(store.getItem(S.STORAGE_KEY), saved, 'старые данные остались');
    ok(S.lastError, 'есть понятное сообщение об ошибке');
  });

  test('Хранение', 'Страховочная копия создаётся и восстанавливается', function () {
    var store = memoryStore();
    var original = storedState(1100);
    var imported = storedState(2200, '2026-10-02');

    same(S.save(original, store), true);
    var snapshot = S.createSnapshot(original, 'before-import', store);
    ok(snapshot, 'копия создана');
    same(snapshot.reason, 'before-import');
    same(snapshot.records, 1);

    same(S.save(imported, store), true, 'импорт сохранён');
    var read = S.readSnapshot(store);
    ok(read, 'копия читается');
    same(read.state.profiles[0].fuelings[0].odometer, 1100, 'в копии старые данные');

    var restored = S.restoreSnapshot(store);
    ok(restored, 'копия восстановлена');
    same(restored.state.profiles[0].fuelings[0].odometer, 1100);
    same(JSON.parse(store.getItem(S.STORAGE_KEY)).profiles[0].fuelings[0].odometer, 1100);
  });

  test('Хранение', 'Если копия не создалась, данные не меняются', function () {
    var store = memoryStore();
    var original = storedState(1100);
    same(S.save(original, store), true);
    var saved = store.getItem(S.STORAGE_KEY);

    var result = S.createSnapshot(original, 'before-clear', failingStore(store));
    same(result, null, 'копия не создана');
    same(store.getItem(S.STORAGE_KEY), saved, 'текущие данные не тронуты');
    ok(S.lastError, 'есть сообщение об ошибке');
  });

  test('Хранение', 'Ошибка восстановления не перезаписывает текущие данные', function () {
    var store = memoryStore();
    var original = storedState(1100);
    var current = storedState(2200, '2026-10-02');
    same(S.save(original, store), true);
    S.createSnapshot(original, 'before-import', store);
    same(S.save(current, store), true);
    var saved = store.getItem(S.STORAGE_KEY);

    same(S.restoreSnapshot(failingStore(store)), null, 'восстановление не удалось');
    same(store.getItem(S.STORAGE_KEY), saved, 'текущие данные остались');
    ok(S.lastError, 'есть сообщение об ошибке');
  });

  test('Импорт', 'Будущая дата отклоняется', function () {
    throws(function () {
      S.parseBackup(JSON.stringify({
        app: 'auto-log',
        schemaVersion: 2,
        profiles: [{
          id: 'p1',
          name: 'Моя машина',
          initialOdometer: 1000,
          fuelings: [fueling('2999-01-01', 1100, 40, 120, true)]
        }]
      }));
    }, 'будущая дата должна быть отклонена');
  });

  test('Импорт', 'Повторяющиеся ID заправок отклоняются', function () {
    var first = fueling('2026-10-01', 1100, 40, 120, true);
    var second = fueling('2026-10-02', 1200, 40, 120, true);
    second.id = first.id;

    throws(function () {
      S.parseBackup(JSON.stringify({
        app: 'auto-log',
        schemaVersion: 2,
        profiles: [{
          id: 'p1',
          name: 'Моя машина',
          initialOdometer: 1000,
          fuelings: [first, second]
        }]
      }));
    }, 'повторяющийся ID должен быть отклонён');
  });

  test('Импорт', 'Нулевой пробег, цена и сумма отклоняются', function () {
    function importFueling(change) {
      var record = fueling('2026-10-01', 1100, 40, 120, true);
      change(record);
      return JSON.stringify({
        app: 'auto-log',
        schemaVersion: 2,
        profiles: [{
          id: 'p1',
          name: 'Моя машина',
          initialOdometer: 1000,
          fuelings: [record]
        }]
      });
    }

    throws(function () {
      S.parseBackup(importFueling(function (record) { record.odometer = 0; }));
    }, 'нулевой пробег должен быть отклонён');

    throws(function () {
      S.parseBackup(importFueling(function (record) {
        record.pricePerLiter = 0;
        record.total = 0;
      }));
    }, 'нулевая цена должна быть отклонена');
  });

  /* ── Обслуживание ─────────────────────────────────────── */

  test('Обслуживание', 'Итог складывает запчасти и работы', function () {
    same(C.maintenanceTotal(maintenance('2026-10-01', 1000, 'Масло', 120.5, 300)), 420.5);
    same(C.maintenanceTotal(maintenance('2026-10-01', 1000, 'Проверка', 0, 0)), 0);
    same(C.maintenanceTotal({}), 0, 'без затрат');
  });

  test('Обслуживание', 'Невалидные записи не попадают в статистику', function () {
    var records = [
      maintenance('2026-10-01', 1000, 'Масло', 100, 200),
      maintenance('', 1100, 'Без даты', 100, 0),
      maintenance('2026-10-02', -5, 'Минус', 100, 0),
      maintenance('2026-10-03', 1200, '   ', 100, 0)
    ];
    var stats = C.calculateMaintenanceStats(records);
    same(stats.recordsCount, 1);
    same(stats.totalCost, 300);
    same(C.isValidMaintenance(records[0]), true);
    same(C.isValidMaintenance(records[1]), false);
    same(C.isValidMaintenance(records[2]), false);
    same(C.isValidMaintenance(records[3]), false);
  });

  test('Обслуживание', 'История сортируется по дате и пробегу', function () {
    var records = [
      maintenance('2026-09-01', 1000, 'Старое', 10, 0),
      maintenance('2026-10-01', 2000, 'Новое', 20, 0),
      maintenance('2026-10-01', 2100, 'Новое с большим пробегом', 30, 0)
    ];
    var sorted = C.sortedMaintenanceByDateDesc(records);
    same(sorted.length, 3);
    same(sorted[0].title, 'Новое с большим пробегом');
    same(sorted[1].title, 'Новое');
    same(sorted[2].title, 'Старое');
  });

  test('Обслуживание', 'Общая статистика отдельно от топлива', function () {
    var records = [
      maintenance('2026-09-01', 1000, 'Масло', 120.5, 300),
      maintenance('2026-10-01', 1500, 'Шины', 800, 250),
      maintenance('2026-10-02', 1600, 'Проверка', 0, 0)
    ];
    var stats = C.calculateMaintenanceStats(records);
    same(stats.recordsCount, 3);
    same(stats.totalParts, 920.5);
    same(stats.totalLabor, 550);
    same(stats.totalCost, 1470.5);
    same(stats.firstDate, '2026-09-01');
    same(stats.lastDate, '2026-10-02');
    same(stats.lastOdometer, 1600);
  });

  test('Профили', 'У нового автомобиля пустой журнал обслуживания', function () {
    var profile = S.createProfile('Рабочая', 85000);
    ok(Array.isArray(profile.maintenances), 'список обслуживания есть');
    same(profile.maintenances.length, 0);
  });

  test('Профили', 'Обслуживание хранится отдельно для каждого автомобиля', function () {
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p2',
      profiles: [{
        id: 'p1',
        name: 'Своя',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 120, true)],
        maintenances: [maintenance('2026-10-01', 1100, 'Масло своей', 100, 200)]
      }, {
        id: 'p2',
        name: 'Рабочая',
        initialOdometer: 2000,
        fuelings: [fueling('2026-10-02', 2100, 50, 150, true)],
        maintenances: [maintenance('2026-10-02', 2100, 'Ремонт рабочей', 400, 500)]
      }]
    });

    same(state.profiles[0].maintenances.length, 1);
    same(state.profiles[1].maintenances.length, 1);
    same(state.profiles[0].maintenances[0].title, 'Масло своей');
    same(state.profiles[1].maintenances[0].title, 'Ремонт рабочей');

    var restored = S.parseBackup(S.backupJson(state));
    same(restored.profiles[0].maintenances[0].partsCost, 100);
    same(restored.profiles[1].maintenances[0].laborCost, 500);
  });

  test('Резервные копии', 'Старая копия без обслуживания открывается', function () {
    var oldCopy = {
      app: 'auto-log',
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 120, true)]
      }]
    };
    var restored = S.parseBackup(JSON.stringify(oldCopy));
    same(restored.profiles[0].fuelings.length, 1);
    ok(Array.isArray(restored.profiles[0].maintenances), 'добавлен пустой список обслуживания');
    same(restored.profiles[0].maintenances.length, 0);

    var backup = JSON.parse(S.backupJson(restored));
    ok(Array.isArray(backup.profiles[0].maintenances), 'в новой копии есть список обслуживания');
  });

  test('Резервные копии', 'Обслуживание сохраняется и восстанавливается', function () {
    var record = maintenance('2026-10-05', 1400, 'Тормозные колодки', 350.25, 500.75, 'Передние');
    record.createdAt = '2026-10-05T09:00:00.000Z';
    record.updatedAt = '2026-10-05T10:00:00.000Z';
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [],
        maintenances: [record]
      }]
    });

    var restored = S.parseBackup(S.backupJson(state));
    same(restored.profiles[0].maintenances.length, 1);
    same(restored.profiles[0].maintenances[0].title, 'Тормозные колодки');
    same(restored.profiles[0].maintenances[0].partsCost, 350.25);
    same(restored.profiles[0].maintenances[0].laborCost, 500.75);
    same(restored.profiles[0].maintenances[0].note, 'Передние');
  });

  test('Хранение', 'Страховочная копия считает обслуживание', function () {
    var store = memoryStore();
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 120, true)],
        maintenances: [maintenance('2026-10-02', 1200, 'Масло', 100, 200)]
      }]
    });

    same(S.save(state, store), true);
    var snapshot = S.createSnapshot(state, 'before-import', store);
    ok(snapshot, 'копия создана');
    same(snapshot.records, 2, 'заправка и обслуживание');

    var restored = S.restoreSnapshot(store);
    ok(restored, 'копия восстановлена');
    same(restored.state.profiles[0].maintenances.length, 1);
    same(restored.state.profiles[0].maintenances[0].title, 'Масло');
  });

  test('Хранение', 'Старые данные при загрузке получают журнал обслуживания', function () {
    var oldState = {
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 120, true)]
      }]
    };
    var initial = {};
    initial[S.STORAGE_KEY] = JSON.stringify(oldState);
    var store = memoryStore(initial);

    var loaded = S.load(store);
    ok(Array.isArray(loaded.profiles[0].maintenances), 'в памяти есть список');
    same(loaded.profiles[0].maintenances.length, 0);

    var saved = JSON.parse(store.getItem(S.STORAGE_KEY));
    ok(Array.isArray(saved.profiles[0].maintenances), 'миграция записана на диск');
    same(saved.profiles[0].fuelings.length, 1, 'заправки сохранены');
  });

  test('Импорт', 'Обслуживание с будущей датой, пустым названием и минусом отклоняется', function () {
    function importMaintenance(change) {
      var record = maintenance('2026-10-01', 1100, 'Масло', 100, 200);
      change(record);
      return JSON.stringify({
        app: 'auto-log',
        schemaVersion: 2,
        profiles: [{
          id: 'p1',
          name: 'Моя машина',
          initialOdometer: 1000,
          fuelings: [],
          maintenances: [record]
        }]
      });
    }

    throws(function () {
      S.parseBackup(importMaintenance(function (record) { record.date = '2999-01-01'; }));
    }, 'будущая дата должна быть отклонена');

    throws(function () {
      S.parseBackup(importMaintenance(function (record) { record.title = '   '; }));
    }, 'пустое название должно быть отклонено');

    throws(function () {
      S.parseBackup(importMaintenance(function (record) { record.partsCost = -1; }));
    }, 'минус в запчастях должен быть отклонён');

    throws(function () {
      S.parseBackup(importMaintenance(function (record) { record.laborCost = -1; }));
    }, 'минус в работах должен быть отклонён');
  });

  test('Импорт', 'Повторяющиеся ID обслуживания отклоняются', function () {
    var first = maintenance('2026-10-01', 1100, 'Масло', 100, 200);
    var second = maintenance('2026-10-02', 1200, 'Шины', 300, 0);
    second.id = first.id;

    throws(function () {
      S.parseBackup(JSON.stringify({
        app: 'auto-log',
        schemaVersion: 2,
        profiles: [{
          id: 'p1',
          name: 'Моя машина',
          initialOdometer: 1000,
          fuelings: [],
          maintenances: [first, second]
        }]
      }));
    }, 'повторяющийся ID должен быть отклонён');
  });

  /* ── Топливо и последняя цена ─────────────────────────── */

  test('Топливо', 'Ровно два типа: солярка и бензин АИ-95', function () {
    same(C.FUEL_TYPES.length, 2);
    same(C.FUEL_TYPES[0].name, 'Солярка (дизель)');
    same(C.FUEL_TYPES[1].name, 'Бензин АИ-95');
    same(C.normalizeFuelType('diesel'), 'diesel');
    same(C.normalizeFuelType('petrol95'), 'petrol95');
    same(C.normalizeFuelType('petrol'), '', 'неизвестный тип не угадывается');
    same(C.normalizeFuelType(''), '');
    same(C.fuelTypeName('diesel'), 'Солярка (дизель)');
    same(C.fuelTypeName('unknown'), '');
  });

  test('Топливо', 'Последняя цена хранится отдельно для каждого типа', function () {
    var prices = C.normalizeLastFuelPrices({ diesel: 7.77, petrol95: null, extra: 9.99 });
    same(prices.diesel, 7.77);
    same(prices.petrol95, null);
    same(Object.keys(prices).length, 2, 'лишние ключи не сохраняются');
    same(C.lastPriceForFuelType(prices, 'diesel'), 7.77);
    same(C.lastPriceForFuelType(prices, 'petrol95'), null);
    same(C.lastPriceForFuelType(prices, ''), null);
  });

  test('Топливо', 'Запоминание цены не смешивает дизель и АИ-95', function () {
    var initial = C.normalizeLastFuelPrices({ diesel: 7.77 });
    var withPetrol = C.rememberLastFuelPrice(initial, 'petrol95', 7.95);
    same(initial.petrol95, null, 'исходный объект не изменён');
    same(withPetrol.diesel, 7.77);
    same(withPetrol.petrol95, 7.95);
    same(C.rememberLastFuelPrice(withPetrol, 'unknown', 8.5).petrol95, 7.95);
    same(C.rememberLastFuelPrice(withPetrol, 'diesel', 0).diesel, 7.77);
    same(C.normalizeLastFuelPrices({ diesel: '7,77', petrol95: -1 }).diesel, 7.77);
  });

  test('Топливо', 'Корпоративная заправка через דלקן не путается с АЗС Delek', function () {
    ok(C.isCorporateFueling({ corporate: true }), 'явный флаг');
    ok(C.isCorporateFueling({ note: 'Оплата через דלקן' }), 'текст в заметке');
    ok(!C.isCorporateFueling({ station: 'Delek' }), 'Delek — обычная АЗС');
    ok(!C.isCorporateFueling({ station: 'Dor Alon' }), 'другая АЗС');
    ok(!C.isCorporateFueling({}), 'пустая запись');
  });

  test('Топливо', 'Старые записи не получают тип топлива наугад', function () {
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 300, true, 'Delek', 'delek')]
      }]
    });
    var record = state.profiles[0].fuelings[0];
    same(record.fuelType, '');
    same(record.corporate, false);
    same(state.profiles[0].lastFuelPrices.diesel, null);
    same(state.profiles[0].lastFuelPrices.petrol95, null);
  });

  test('Топливо', 'Тип, флаг и последние цены сохраняются в копии', function () {
    var record = fueling('2026-10-01', 1100, 40, 310.8, true, 'Paz', 'paz');
    record.fuelType = 'petrol95';
    record.corporate = false;
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        lastFuelPrices: { diesel: 7.77, petrol95: 7.95 },
        fuelings: [record]
      }]
    });

    var restored = S.parseBackup(S.backupJson(state));
    var restoredRecord = restored.profiles[0].fuelings[0];
    same(restoredRecord.fuelType, 'petrol95');
    same(restoredRecord.corporate, false);
    same(restored.profiles[0].lastFuelPrices.diesel, 7.77);
    same(restored.profiles[0].lastFuelPrices.petrol95, 7.95);
  });

  test('Топливо', 'Неизвестный тип в импорте остаётся пустым', function () {
    var record = fueling('2026-10-01', 1100, 40, 300, true, 'Sonol', 'sonol');
    record.fuelType = 'gasoline';
    record.corporate = 'yes';
    var state = S.normalizeState({
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [record]
      }]
    });
    same(state.profiles[0].fuelings[0].fuelType, '');
    same(state.profiles[0].fuelings[0].corporate, true);
  });

  test('Топливо', 'Старое хранилище мигрирует без потери записей', function () {
    var oldState = {
      schemaVersion: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Моя машина',
        initialOdometer: 1000,
        fuelings: [fueling('2026-10-01', 1100, 40, 300, true, 'Paz', 'paz')]
      }]
    };
    var initial = {};
    initial[S.STORAGE_KEY] = JSON.stringify(oldState);
    var store = memoryStore(initial);

    var loaded = S.load(store);
    same(loaded.profiles[0].fuelings.length, 1, 'заправка на месте');
    same(loaded.profiles[0].fuelings[0].fuelType, '');
    same(loaded.profiles[0].lastFuelPrices.petrol95, null);

    var saved = JSON.parse(store.getItem(S.STORAGE_KEY));
    same(saved.profiles[0].fuelings[0].fuelType, '', 'пустой тип записан');
    same(saved.profiles[0].lastFuelPrices.diesel, null, 'цены записаны');
  });

  /* ── Новый пробег ─────────────────────────────────────── */

  test('Пробег', 'Пустой пробег новой заправки запрещён', function () {
    var result = C.validateNewOdometer('', { previousOdometer: 130000 });
    same(result.ok, false);
    same(result.code, 'empty');
    ok(result.message.indexOf('Введите новый пробег') !== -1);
  });

  test('Пробег', 'Автоматически подставленный пробег не подтверждён', function () {
    var result = C.validateNewOdometer(130500, {
      previousOdometer: 130000,
      prefilled: true
    });
    same(result.ok, false);
    same(result.code, 'prefilled');
  });

  test('Пробег', 'Совпадение с предыдущей записью запрещено', function () {
    var result = C.validateNewOdometer(130000, { previousOdometer: 130000 });
    same(result.ok, false);
    same(result.code, 'same');
    ok(result.message.indexOf('забыли') !== -1, 'понятное предупреждение');
  });

  test('Пробег', 'Новый пробег больше предыдущего принимается', function () {
    var result = C.validateNewOdometer(130001, { previousOdometer: 130000 });
    same(result.ok, true);
    same(result.code, '');
    same(result.odometer, 130001);

    var first = C.validateNewOdometer(130000, { previousOdometer: null });
    same(first.ok, true, 'для первой заправки сравнение с прошлой не нужно');
  });

  /* ── Распознавание данных заправки ─────────────────────── */

  test('Распознавание', 'Английские подписи: литры, цена и сумма', function () {
    var parsed = O.parseFuelText('TOTAL 335.16\nPRICE PER LITER 7.35\nLITERS 45.60');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
    ok(parsed.confidence >= 0.8, 'уверенность должна быть высокой');
  });

  test('Распознавание', 'Подписи на иврите и западные цифры', function () {
    var parsed = O.parseFuelText('סה"כ 335.16\nמחיר לליטר 7.35\nליטר 45.60');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
  });

  test('Распознавание', 'Числа без подписей связываются по формуле', function () {
    var parsed = O.parseFuelText('45.60\n7.35\n335.16');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
    ok(parsed.confidence < 0.8, 'без подписей уверенность ниже');
  });

  test('Распознавание', 'Запятая как десятичный разделитель', function () {
    var parsed = O.parseFuelText('LITERS 45,60\nPRICE/L 7,35\nTOTAL 335,16');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
  });

  test('Распознавание', 'Потерянные десятичные точки восстанавливаются', function () {
    var parsed = O.parseFuelText('LITERS 4560\nPRICE/L 735\nTOTAL 33516');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
  });

  test('Распознавание', 'Дата, время и пробег не путаются с суммой', function () {
    var parsed = O.parseFuelText(
      '2026-10-23 14:35\nODOMETER 131000\nTOTAL 250.00\nPRICE/L 7.25\nLITERS 34.48'
    );
    same(parsed.liters, 34.48, 'литры');
    same(parsed.pricePerLiter, 7.25, 'цена');
    same(parsed.total, 250, 'сумма');
  });

  test('Распознавание', 'Цена восстанавливается по сумме и литрам', function () {
    var parsed = O.parseFuelText('TOTAL 250.00\nLITERS 34.48');
    same(parsed.liters, 34.48, 'литры');
    same(parsed.pricePerLiter, 7.25, 'цена');
    same(parsed.total, 250, 'сумма');
  });

  test('Распознавание', 'Литры восстанавливаются по сумме и цене', function () {
    var parsed = O.parseFuelText('TOTAL 250.00\nPRICE/L 7.25');
    same(parsed.liters, 34.48, 'литры');
    same(parsed.pricePerLiter, 7.25, 'цена');
    same(parsed.total, 250, 'сумма');
  });

  test('Распознавание', 'Сумма восстанавливается по литрам и цене', function () {
    var parsed = O.parseFuelText('LITERS 45.60\nPRICE/L 7.35');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
  });

  test('Распознавание', 'Одна сумма не превращается в выдуманные числа', function () {
    var parsed = O.parseFuelText('TOTAL 335.16');
    same(parsed.liters, null, 'литры');
    same(parsed.pricePerLiter, null, 'цена');
    same(parsed.total, 335.16, 'сумма');
    ok(parsed.warnings.length >= 2, 'должны быть предупреждения');
  });

  test('Распознавание', 'Мусорный текст даёт пустой результат', function () {
    var parsed = O.parseFuelText('Thank you for visiting\nHave a nice day');
    same(parsed.liters, null, 'литры');
    same(parsed.pricePerLiter, null, 'цена');
    same(parsed.total, null, 'сумма');
    same(parsed.confidence, 0, 'уверенность');
    ok(parsed.warnings.length >= 3, 'должны быть предупреждения');
  });

  test('Распознавание', 'Арабские цифры нормализуются', function () {
    var parsed = O.parseFuelText('TOTAL ٣٣٥.١٦\nPRICE/L ٧.٣٥\nLITERS ٤٥.٦٠');
    same(parsed.liters, 45.6, 'литры');
    same(parsed.pricePerLiter, 7.35, 'цена');
    same(parsed.total, 335.16, 'сумма');
  });

  test('Распознавание', 'Неподдерживаемый файл отклоняется до обработки', function () {
    throws(function () {
      O.validateImageFile(new File(['hello'], 'note.txt', { type: 'text/plain' }));
    }, 'текстовый файл должен быть отклонён');

    throws(function () {
      O.validateImageFile(new File(['heic'], 'photo.heic', { type: 'image/heic' }));
    }, 'HEIC должен быть отклонён');
  });

  /* ── Доступность фокуса ───────────────────────────────── */

  function focusFixture() {
    var host = document.createElement('div');
    host.innerHTML =
      '<button id="focus-first" type="button">Первый</button>' +
      '<input id="focus-middle" aria-label="Средний">' +
      '<button id="focus-hidden" type="button" hidden>Скрытый</button>' +
      '<button id="focus-disabled" type="button" disabled>Отключён</button>' +
      '<button id="focus-last" type="button">Последний</button>';
    document.body.appendChild(host);
    return host;
  }

  function tabEvent(shift) {
    return {
      key: 'Tab',
      shiftKey: Boolean(shift),
      prevented: false,
      preventDefault: function () {
        this.prevented = true;
      }
    };
  }

  test('Фокус', 'Tab на последнем элементе возвращается к первому', function () {
    var host = focusFixture();
    try {
      var first = host.querySelector('#focus-first');
      var last = host.querySelector('#focus-last');
      last.focus();
      same(document.activeElement, last, 'фокус на последнем элементе');

      var event = tabEvent(false);
      same(F.trapTab(host, event), true, 'Tab перехвачен');
      ok(event.prevented, 'действие по умолчанию отменено');
      same(document.activeElement, first, 'фокус вернулся к первому');
    } finally {
      host.remove();
    }
  });

  test('Фокус', 'Shift+Tab на первом элементе уходит к последнему', function () {
    var host = focusFixture();
    try {
      var first = host.querySelector('#focus-first');
      var last = host.querySelector('#focus-last');
      first.focus();
      same(document.activeElement, first, 'фокус на первом элементе');

      var event = tabEvent(true);
      same(F.trapTab(host, event), true, 'Shift+Tab перехвачен');
      ok(event.prevented, 'действие по умолчанию отменено');
      same(document.activeElement, last, 'фокус ушёл к последнему');
    } finally {
      host.remove();
    }
  });

  test('Фокус', 'Скрытые и отключённые элементы пропускаются', function () {
    var host = focusFixture();
    try {
      var items = F.focusableElements(host);
      same(items.length, 3);
      same(items[0].id, 'focus-first');
      same(items[1].id, 'focus-middle');
      same(items[2].id, 'focus-last');
    } finally {
      host.remove();
    }
  });

  test('Фокус', 'Фокус переходит в диалог и не остаётся на кнопке', function () {
    var host = focusFixture();
    var opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Открыть';
    document.body.appendChild(opener);
    try {
      opener.focus();
      same(document.activeElement, opener, 'до открытия фокус на кнопке');

      var middle = host.querySelector('#focus-middle');
      same(F.focusFirst(host, middle), true, 'фокус перенесён');
      same(document.activeElement, middle, 'фокус внутри диалога');
    } finally {
      host.remove();
      opener.remove();
    }
  });

  test('Фокус', 'После закрытия фокус возвращается на открывшую кнопку', function () {
    var host = focusFixture();
    var opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Открыть';
    document.body.appendChild(opener);
    try {
      opener.focus();
      host.querySelector('#focus-middle').focus();
      same(document.activeElement, host.querySelector('#focus-middle'), 'фокус в диалоге');

      same(F.restoreFocus(opener), true, 'фокус восстановлен');
      same(document.activeElement, opener, 'фокус снова на кнопке');

      host.querySelector('#focus-middle').focus();
      var replacement = host.querySelector('#focus-last');
      same(F.restoreFocus(null, function () { return replacement; }), true, 'запасной вариант найден');
      same(document.activeElement, replacement, 'фокус на запасной кнопке');
    } finally {
      host.remove();
      opener.remove();
    }
  });

  test('Фокус', 'Слои диалогов изолируют фон и возвращают фокус по очереди', function () {
    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = '<button id="layer-app-opener" type="button">Открыть форму</button>';

    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<button id="layer-sheet-first" type="button">В форме</button>';

    var modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = '<button id="layer-modal-first" type="button">В подтверждении</button>';

    document.body.appendChild(app);
    document.body.appendChild(sheet);
    document.body.appendChild(modal);

    var appOpener = app.querySelector('#layer-app-opener');
    var sheetButton = sheet.querySelector('#layer-sheet-first');
    var modalButton = modal.querySelector('#layer-modal-first');

    try {
      appOpener.focus();
      same(F.openDialog(sheet, { initialFocus: sheetButton }), true, 'форма открыта');
      same(F.topDialog(), sheet, 'форма стала верхним слоем');
      same(document.activeElement, sheetButton, 'фокус в форме');
      ok(app.inert, 'фон приложения недоступен');
      ok(!sheet.inert, 'форма доступна');
      same(document.body.classList.contains('sheet-open'), true, 'страница заблокирована для формы');
      same(document.body.classList.contains('modal-open'), false, 'модальное окно ещё не открыто');

      same(F.openDialog(modal, {
        opener: sheetButton,
        initialFocus: modalButton
      }), true, 'подтверждение открыто');
      same(F.topDialog(), modal, 'подтверждение стало верхним слоем');
      same(document.activeElement, modalButton, 'фокус в подтверждении');
      ok(sheet.inert, 'нижняя форма недоступна');
      ok(!modal.inert, 'подтверждение доступно');
      ok(app.inert, 'фон остаётся недоступным');
      same(F.focusableElements(sheet).length, 0, 'Tab не попадёт в нижнюю форму');
      same(document.body.classList.contains('sheet-open'), true, 'блокировка формы сохраняется');
      same(document.body.classList.contains('modal-open'), true, 'блокировка модального окна добавлена');

      same(F.closeDialog(modal), true, 'подтверждение закрыто');
      same(F.topDialog(), sheet, 'форма снова верхний слой');
      same(document.activeElement, sheetButton, 'фокус вернулся в нижнюю форму');
      ok(!sheet.inert, 'нижняя форма снова доступна');
      ok(app.inert, 'фон всё ещё недоступен');
      same(document.body.classList.contains('sheet-open'), true, 'блокировка формы сохраняется');
      same(document.body.classList.contains('modal-open'), false, 'блокировка модального окна снята');

      same(F.closeDialog(sheet), true, 'форма закрыта');
      same(F.topDialog(), null, 'открытых слоёв нет');
      same(document.activeElement, appOpener, 'фокус вернулся на кнопку фона');
      ok(!app.inert, 'фон снова доступен');
      same(document.body.classList.contains('sheet-open'), false, 'блокировка формы снята');
      same(document.body.classList.contains('modal-open'), false, 'блокировка модального окна снята');
    } finally {
      if (F.isDialogOpen(modal)) {
        F.closeDialog(modal, { restore: false });
      }
      if (F.isDialogOpen(sheet)) {
        F.closeDialog(sheet, { restore: false });
      }
      app.remove();
      sheet.remove();
      modal.remove();
    }
  });

  test('Фокус', 'Исчезнувшая кнопка заменяется запасной после перерисовки', function () {
    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = '<button id="fallback-target" type="button">Добавить</button>';

    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML =
      '<button id="fallback-opener" type="button">Удалить</button>' +
      '<button id="fallback-inside" type="button">Внутри</button>';

    document.body.appendChild(app);
    document.body.appendChild(sheet);

    var target = app.querySelector('#fallback-target');
    var opener = sheet.querySelector('#fallback-opener');
    var inside = sheet.querySelector('#fallback-inside');

    try {
      opener.focus();
      same(F.openDialog(sheet, {
        opener: opener,
        initialFocus: inside,
        fallback: function () {
          return target;
        }
      }), true, 'диалог открыт');
      same(document.activeElement, inside, 'фокус в диалоге');

      opener.remove();
      same(F.closeDialog(sheet), true, 'диалог закрыт');
      same(document.activeElement, target, 'фокус перешёл на запасную кнопку');
      ok(!app.inert, 'фон снова доступен');
    } finally {
      if (F.isDialogOpen(sheet)) {
        F.closeDialog(sheet, { restore: false });
      }
      app.remove();
      sheet.remove();
    }
  });

  /* ── Вывод результатов ────────────────────────────────── */

  var passed = results.filter(function (item) { return item.ok; }).length;
  var failed = results.length - passed;
  var summary = document.getElementById('summary');
  var resultsBox = document.getElementById('results');

  summary.innerHTML =
    '<span class="badge' + (failed ? ' fail' : '') + '">' +
      (failed ? '✕ ' + failed + ' провалено' : '✓ Все тесты пройдены') +
    '</span>' +
    '<span>' + passed + ' из ' + results.length + '</span>' +
    '<span class="note">Расчёты, профили, резервные копии, защита данных и фокус</span>';

  var lastGroup = null;
  var html = '';
  results.forEach(function (item) {
    if (item.group !== lastGroup) {
      html += '<h2>' + item.group + '</h2>';
      lastGroup = item.group;
    }
    html +=
      '<div class="test ' + (item.ok ? 'pass' : 'fail') + '">' +
        '<span class="mark">' + (item.ok ? '✓' : '✕') + '</span>' +
        '<div class="test-name">' + item.name +
          (item.ok ? '' : '<p class="test-error">' + item.error + '</p>') +
        '</div>' +
      '</div>';
  });
  resultsBox.innerHTML = html;

  document.title = (failed ? 'ПРОВАЛ ' + failed + ' — ' : 'ОК ' + passed + ' — ') + 'тесты АвтоЖурнала';
  document.body.dataset.testStatus = failed ? 'fail' : 'pass';

  window.__TEST_RESULTS__ = {
    total: results.length,
    passed: passed,
    failed: failed,
    results: results
  };
})();
