/*
 * АвтоЖурнал — логика приложения.
 *
 * Здесь мы соединяем расчёты (calc.js), хранение (storage.js) и экраны.
 */
(function () {
  'use strict';

  var C = window.MuranoCalc;
  var S = window.MuranoStorage;
  var Charts = window.MuranoCharts;

  var state = S.load();
  var currentScreen = 'home';
  var editingId = null;
  var toastTimer = null;
  var confirmResolver = null;
  var statsPeriod = 'all';

  var calcState = {
    liters: null,
    pricePerLiter: null,
    total: null,
    lastPriceField: null
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    el.screens = Array.prototype.slice.call(document.querySelectorAll('[data-screen]'));
    el.navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item[data-nav]'));
    el.statOdometer = $('stat-odometer');
    el.heroDate = $('hero-date');
    el.heroHint = $('hero-hint');
    el.statConsumption = $('stat-consumption');
    el.statConsumptionNote = $('stat-consumption-note');
    el.statMonth = $('stat-month');
    el.statMonthNote = $('stat-month-note');
    el.statTotal = $('stat-total');
    el.statTotalNote = $('stat-total-note');
    el.statCostKm = $('stat-costkm');
    el.statCostKmNote = $('stat-costkm-note');
    el.recentList = $('recent-list');
    el.historyList = $('history-list');
    el.historySummary = $('history-summary');
    el.historyAdd = $('history-add');
    el.statsPeriod = $('stats-period');
    el.statsTotal = $('stats-total');
    el.statsMeta = $('stats-meta');
    el.stationHighlights = $('station-highlights');
    el.stationList = $('station-list');
    el.stationPeriodLabel = $('station-period-label');
    el.consumptionChart = $('consumption-chart');
    el.expensesChart = $('expenses-chart');
    el.consumptionBadge = $('consumption-badge');
    el.expensesBadge = $('expenses-badge');
    el.settingsForm = $('settings-form');
    el.settingsProfileName = $('settings-profile-name');
    el.settingsOdometer = $('settings-odometer');
    el.settingsError = $('settings-error');
    el.settingsProfilesBtn = $('settings-profiles-btn');
    el.activeProfileName = $('active-profile-name');
    el.carSwitch = $('car-switch');
    el.profilesModal = $('profiles-modal');
    el.profilesClose = $('profiles-close');
    el.profilesList = $('profiles-list');
    el.profileAddBtn = $('profile-add-btn');
    el.profileForm = $('profile-form');
    el.profileName = $('profile-name');
    el.profileOdometer = $('profile-odometer');
    el.profileError = $('profile-error');
    el.profileCancel = $('profile-cancel');
    el.profileSubmit = $('profile-submit');
    el.exportBtn = $('export-btn');
    el.importFile = $('import-file');
    el.restoreSnapshotBtn = $('restore-snapshot-btn');
    el.snapshotInfo = $('snapshot-info');
    el.clearBtn = $('clear-btn');
    el.storageInfo = $('storage-info');
    el.sheet = $('fuel-sheet');
    el.sheetTitle = $('sheet-title');
    el.sheetClose = $('sheet-close');
    el.form = $('fuel-form');
    el.fuelDate = $('fuel-date');
    el.fuelOdometer = $('fuel-odometer');
    el.fuelLiters = $('fuel-liters');
    el.fuelPrice = $('fuel-price');
    el.fuelTotal = $('fuel-total');
    el.fuelStation = $('fuel-station');
    el.fuelStationOther = $('fuel-station-other');
    el.fuelStationOtherField = $('fuel-station-other-field');
    el.fuelNote = $('fuel-note');
    el.fuelFull = $('fuel-full');
    el.calcHint = $('calc-hint');
    el.formError = $('form-error');
    el.fuelSubmit = $('fuel-submit');
    el.fuelDelete = $('fuel-delete');
    el.confirmModal = $('confirm-modal');
    el.confirmTitle = $('confirm-title');
    el.confirmText = $('confirm-text');
    el.confirmCancel = $('confirm-cancel');
    el.confirmOk = $('confirm-ok');
    el.toast = $('toast');

    el.fuelDate.max = todayIso();

    bindNavigation();
    bindAddButtons();
    bindForm();
    bindSettings();
    bindStatsPeriod();
    bindProfiles();
    bindConfirm();
    bindDelegatedActions();
    bindKeyboard();

    el.statsPeriod.value = statsPeriod;
    el.sheet.inert = true;

    renderAll();
    registerServiceWorker();

    if (S.lastError) {
      showToast(S.lastError, 'error');
    }
  }

  /* ── Вспомогательные функции ───────────────────────────── */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function pad2(number) {
    return String(number).padStart(2, '0');
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function parseLocalDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return null;
    }
    var parts = iso.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(iso, short) {
    var date = parseLocalDate(iso);
    if (!date) {
      return '—';
    }
    try {
      return new Intl.DateTimeFormat('ru-RU', short
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'long', year: 'numeric' }
      ).format(date);
    } catch (error) {
      return iso;
    }
  }

  function currentMonthLabel() {
    try {
      return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
        .format(new Date())
        .replace(/\s*г\.$/, '');
    } catch (error) {
      return 'в этом месяце';
    }
  }

  function plural(count, one, few, many) {
    var mod10 = count % 10;
    var mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return one;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return few;
    }
    return many;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 Б';
    }
    if (bytes < 1024) {
      return bytes + ' Б';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1).replace('.', ',') + ' КБ';
    }
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
  }

  function getStats() {
    var profile = activeProfile();
    return C.calculateStats({
      fuelings: profile.fuelings,
      initialOdometer: profile.initialOdometer,
      now: new Date()
    });
  }

  function findFueling(id) {
    var fuelings = getFuelings();
    for (var index = 0; index < fuelings.length; index += 1) {
      if (fuelings[index].id === id) {
        return fuelings[index];
      }
    }
    return null;
  }

  function showToast(message, type) {
    if (!el.toast) {
      return;
    }
    el.toast.textContent = message;
    el.toast.classList.toggle('is-error', type === 'error');
    el.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.toast.classList.remove('is-visible');
    }, 3200);
  }

  function cloneState(source) {
    return JSON.parse(JSON.stringify(source));
  }

  function commitState(nextState, failurePrefix) {
    if (!S.save(nextState)) {
      var message = S.lastError || 'Не удалось сохранить данные.';
      if (failurePrefix) {
        message = failurePrefix + ': ' + message;
      }
      showToast(message, 'error');
      return false;
    }
    state = nextState;
    return true;
  }

  function activeProfileIn(sourceState) {
    for (var index = 0; index < sourceState.profiles.length; index += 1) {
      if (sourceState.profiles[index].id === sourceState.activeProfileId) {
        return sourceState.profiles[index];
      }
    }
    // Страховка на случай, если профиль удалили не через интерфейс.
    return sourceState.profiles[0];
  }

  function activeProfile() {
    return activeProfileIn(state);
  }

  function getFuelings() {
    return activeProfile().fuelings;
  }

  function countFuelings(sourceState) {
    if (!sourceState || !Array.isArray(sourceState.profiles)) {
      return 0;
    }
    return sourceState.profiles.reduce(function (total, profile) {
      return total + (Array.isArray(profile.fuelings) ? profile.fuelings.length : 0);
    }, 0);
  }

  /* ── Навигация ─────────────────────────────────────────── */

  function bindNavigation() {
    document.querySelectorAll('[data-nav]').forEach(function (button) {
      button.addEventListener('click', function () {
        showScreen(button.getAttribute('data-nav'));
      });
    });
  }

  function showScreen(name) {
    if (!name) {
      return;
    }
    currentScreen = name;
    el.screens.forEach(function (screen) {
      screen.classList.toggle('is-active', screen.getAttribute('data-screen') === name);
    });
    el.navItems.forEach(function (item) {
      item.classList.toggle('is-active', item.getAttribute('data-nav') === name);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'charts') {
      renderCharts();
      renderStatsScreen();
    }
  }

  function bindStatsPeriod() {
    el.statsPeriod.addEventListener('change', function () {
      statsPeriod = el.statsPeriod.value || 'all';
      renderStatsScreen();
    });
  }

  function bindAddButtons() {
    document.querySelectorAll('[data-action="add"]').forEach(function (button) {
      button.addEventListener('click', function () {
        openForm();
      });
    });
  }

  function bindDelegatedActions() {
    document.addEventListener('click', function (event) {
      var editButton = event.target.closest('button[data-edit]');
      if (editButton) {
        openForm(editButton.getAttribute('data-edit'));
        return;
      }
      var deleteButton = event.target.closest('button[data-delete]');
      if (deleteButton) {
        requestDelete(deleteButton.getAttribute('data-delete'));
      }
    });
  }

  /* ── Главный экран ─────────────────────────────────────── */

  function renderHome() {
    var stats = getStats();
    var profile = activeProfile();

    el.statOdometer.textContent = stats.currentOdometer !== null
      ? C.formatNumber(stats.currentOdometer, 0)
      : '—';

    if (stats.recordsCount === 0) {
      el.heroDate.textContent = profile.initialOdometer !== null
        ? 'старт учёта'
        : 'нет данных';
      el.heroHint.textContent = profile.initialOdometer !== null
        ? 'Добавьте первую заправку — здесь появится пробег, расход и расходы.'
        : 'Укажите начальный пробег в настройках или добавьте первую заправку.';
    } else {
      el.heroDate.textContent = 'обновлено ' + formatDate(stats.lastDate, true);
      el.heroHint.textContent =
        C.formatNumber(stats.totalLiters, 1) + ' л за всё время · ' +
        stats.recordsCount + ' ' + plural(stats.recordsCount, 'заправка', 'заправки', 'заправок');
    }

    if (stats.averageConsumption !== null) {
      el.statConsumption.textContent = C.formatNumber(stats.averageConsumption, 1);
      el.statConsumptionNote.textContent = stats.lastConsumption !== null
        ? 'последний: ' + C.formatNumber(stats.lastConsumption, 1) + ' л/100 км'
        : 'по заправкам до полного';
    } else {
      el.statConsumption.textContent = '—';
      el.statConsumptionNote.textContent = 'нужны две заправки до полного';
    }

    el.statMonth.textContent = C.formatMoney(stats.monthExpenses);
    el.statMonthNote.textContent = currentMonthLabel();

    el.statTotal.textContent = C.formatMoney(stats.totalSpent);
    el.statTotalNote.textContent = stats.recordsCount > 0
      ? 'за ' + stats.recordsCount + ' ' + plural(stats.recordsCount, 'заправку', 'заправки', 'заправок')
      : 'пока нет заправок';

    if (stats.costPerKm !== null) {
      el.statCostKm.textContent = C.formatMoney(stats.costPerKm);
      el.statCostKmNote.textContent = 'на ' + C.formatNumber(stats.trackedDistance, 0) + ' км пути';
    } else {
      el.statCostKm.textContent = '—';
      el.statCostKmNote.textContent = 'нужны данные о пробеге';
    }

    var recent = C.sortedByDateDesc(getFuelings()).slice(0, 3);
    el.recentList.innerHTML = recent.length
      ? recent.map(fuelCardHtml).join('')
      : emptyStateHtml(
          'Заправок пока нет',
          'Добавьте первую запись — приложение посчитает расход и стоимость километра.',
          true
        );
  }

  /* ── Журнал ────────────────────────────────────────────── */

  function fuelCardHtml(item) {
    var station = item.station
      ? '<span class="fuel-station">' + escapeHtml(item.station) + '</span>'
      : '<span class="fuel-station is-empty">Без названия АЗС</span>';

    var note = item.note
      ? '<p class="fuel-note">' + escapeHtml(item.note) + '</p>'
      : '';

    return (
      '<article class="fuel-card" data-card-id="' + escapeHtml(item.id) + '">' +
        '<div class="fuel-top">' +
          '<span class="fuel-date">' + escapeHtml(formatDate(item.date)) + '</span>' +
          (item.fullTank ? '<span class="badge-full">до полного</span>' : '') +
          '<div class="fuel-actions">' +
            '<button class="mini-btn" type="button" data-edit="' + escapeHtml(item.id) + '" aria-label="Изменить заправку">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>' +
            '</button>' +
            '<button class="mini-btn mini-danger" type="button" data-delete="' + escapeHtml(item.id) + '" aria-label="Удалить заправку">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="fuel-line">' +
          station +
          '<strong class="fuel-total">' + escapeHtml(C.formatMoney(item.total)) + '</strong>' +
        '</div>' +
        '<div class="fuel-meta">' +
          '<span>' + escapeHtml(C.formatNumber(item.liters, 2)) + ' л</span>' +
          '<span>' + escapeHtml(C.formatMoney(item.pricePerLiter)) + '/л</span>' +
          '<span>' + escapeHtml(C.formatNumber(item.odometer, 0)) + ' км</span>' +
        '</div>' +
        note +
      '</article>'
    );
  }

  function emptyStateHtml(title, text, withButton) {
    return (
      '<div class="empty-state">' +
        '<div class="empty-state-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16"/><path d="M4 21h11M7.5 9h4"/>' +
            '<path d="M14 8h2.5L19 10.5V17a2 2 0 0 0 4 0v-5.5L20.5 9"/>' +
          '</svg>' +
        '</div>' +
        '<strong>' + escapeHtml(title) + '</strong>' +
        '<span>' + escapeHtml(text) + '</span>' +
        (withButton ? '<button class="secondary-btn" type="button" data-action="add">Добавить заправку</button>' : '') +
      '</div>'
    );
  }

  function renderHistory() {
    var records = C.sortedByDateDesc(getFuelings());
    var stats = getStats();

    el.historySummary.innerHTML =
      '<div class="summary-item"><span class="summary-label">Записей</span><span class="summary-value">' + records.length + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">Литров</span><span class="summary-value">' + escapeHtml(C.formatNumber(stats.totalLiters, 1)) + ' л</span></div>' +
      '<div class="summary-item"><span class="summary-label">Потрачено</span><span class="summary-value">' + escapeHtml(C.formatMoney(stats.totalSpent)) + '</span></div>';

    el.historyList.innerHTML = records.length
      ? records.map(fuelCardHtml).join('')
      : emptyStateHtml(
          'Журнал пуст',
          'Здесь будут все заправки. Начните с первой — это займёт меньше минуты.',
          true
        );
  }

  /* ── Графики ───────────────────────────────────────────── */

  function renderCharts() {
    var stats = getStats();

    Charts.renderConsumption(el.consumptionChart, stats.segments);
    el.consumptionBadge.textContent = stats.averageConsumption !== null
      ? C.formatNumber(stats.averageConsumption, 1) + ' л/100'
      : 'нет данных';

    var series = C.monthlyExpenseSeries(getFuelings(), 6, new Date());
    Charts.renderExpenses(el.expensesChart, series);
    var total = series.reduce(function (sum, item) { return sum + item.total; }, 0);
    el.expensesBadge.textContent = total > 0 ? C.formatMoney(total) : 'нет данных';
  }

  /* ── Статистика за период и по АЗС ─────────────────────── */

  function periodText(period) {
    if (period === 'month') {
      return 'за этот месяц';
    }
    if (period === 'prev-month') {
      return 'за прошлый месяц';
    }
    if (period === 'year') {
      return 'за этот год';
    }
    if (period === 'last30') {
      return 'за последние 30 дней';
    }
    return 'за всё время';
  }

  function stationHighlightHtml(label, station, value, tone) {
    return (
      '<div class="station-highlight ' + tone + '">' +
        '<span class="station-highlight-label">' + escapeHtml(label) + '</span>' +
        '<strong class="station-highlight-name">' + escapeHtml(station.name) + '</strong>' +
        '<span class="station-highlight-value">' + escapeHtml(value) + '</span>' +
      '</div>'
    );
  }

  function renderStatsScreen() {
    var now = new Date();
    var fuelings = getFuelings();
    var summary = C.calculatePeriodSummary(fuelings, {
      period: statsPeriod,
      now: now
    });
    var stationStats = C.calculateStationStats(fuelings, {
      period: statsPeriod,
      now: now
    });

    el.statsTotal.textContent = C.formatMoney(summary.totalSpent);
    el.stationPeriodLabel.textContent = periodText(statsPeriod);

    if (summary.recordsCount > 0) {
      var meta = [
        summary.recordsCount + ' ' + plural(summary.recordsCount, 'заправка', 'заправки', 'заправок'),
        C.formatNumber(summary.totalLiters, 1) + ' л'
      ];
      if (summary.averagePrice !== null) {
        meta.push('средняя ' + C.formatMoney(summary.averagePrice) + '/л');
      }
      el.statsMeta.textContent = meta.join(' · ');
    } else {
      el.statsMeta.textContent = 'За выбранный период заправок пока нет.';
    }

    if (!stationStats.recordsCount) {
      el.stationHighlights.innerHTML = '';
      el.stationList.innerHTML = '<p class="stats-empty">Добавьте заправку и укажите АЗС — здесь появится сравнение.</p>';
      return;
    }

    var topVisits = stationStats.topByVisits;
    var topSpent = stationStats.topBySpent;

    el.stationHighlights.innerHTML =
      stationHighlightHtml(
        'Чаще всего',
        topVisits,
        topVisits.count + ' ' + plural(topVisits.count, 'заправка', 'заправки', 'заправок'),
        'is-visits'
      ) +
      stationHighlightHtml(
        'Больше расходов',
        topSpent,
        C.formatMoney(topSpent.total),
        'is-spent'
      );

    var maxSpent = stationStats.stations.reduce(function (max, station) {
      return Math.max(max, station.total);
    }, 0);

    el.stationList.innerHTML =
      '<div class="station-list-head"><span>Все АЗС</span><span>Потрачено</span></div>' +
      stationStats.stations.map(function (station) {
        var width = maxSpent > 0
          ? Math.max(4, Math.round((station.total / maxSpent) * 100))
          : 0;
        return (
          '<div class="station-row">' +
            '<div class="station-row-top">' +
              '<span class="station-name">' + escapeHtml(station.name) + '</span>' +
              '<span class="station-total">' + escapeHtml(C.formatMoney(station.total)) + '</span>' +
            '</div>' +
            '<div class="station-meter" aria-hidden="true"><span style="width:' + width + '%"></span></div>' +
            '<div class="station-meta">' +
              '<span>' + station.count + ' ' + plural(station.count, 'заправка', 'заправки', 'заправок') + '</span>' +
              '<span>' + escapeHtml(C.formatNumber(station.liters, 1)) + ' л</span>' +
              (station.averagePrice !== null
                ? '<span>' + escapeHtml(C.formatMoney(station.averagePrice)) + '/л</span>'
                : '') +
            '</div>' +
          '</div>'
        );
      }).join('');
  }

  /* ── Настройки ─────────────────────────────────────────── */

  function snapshotReasonText(reason) {
    if (reason === 'before-import') {
      return 'перед импортом';
    }
    if (reason === 'before-clear') {
      return 'перед удалением данных';
    }
    return 'страховочная копия';
  }

  function formatSnapshotDate(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return 'неизвестное время';
    }
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      return date.toLocaleString('ru-RU');
    }
  }

  function renderSettings() {
    var profile = activeProfile();
    el.settingsProfileName.value = profile.name;
    el.settingsOdometer.value = profile.initialOdometer !== null
      ? String(Math.round(profile.initialOdometer))
      : '';

    var info = S.storageInfo();
    var count = profile.fuelings.length;
    var total = countFuelings(state);
    el.storageInfo.textContent = info.available
      ? 'В этом автомобиле: ' + count + ' ' + plural(count, 'запись', 'записи', 'записей') +
        ' · всего: ' + total + ' · ' + state.profiles.length + ' ' +
        plural(state.profiles.length, 'автомобиль', 'автомобиля', 'автомобилей') +
        ' · ' + formatBytes(info.bytes)
      : 'Локальное хранилище недоступно в этом браузере.';

    if (el.snapshotInfo && el.restoreSnapshotBtn) {
      var snapshot = null;
      var snapshotError = false;
      try {
        snapshot = S.readSnapshot();
      } catch (error) {
        snapshotError = true;
      }

      if (snapshot) {
        var snapshotCount = countFuelings(snapshot.state);
        el.restoreSnapshotBtn.hidden = false;
        el.snapshotInfo.textContent = 'Последняя копия: ' +
          formatSnapshotDate(snapshot.createdAt) + ', ' +
          snapshotReasonText(snapshot.reason) + ' · ' +
          snapshotCount + ' ' + plural(snapshotCount, 'запись', 'записи', 'записей') + '.';
      } else {
        el.restoreSnapshotBtn.hidden = true;
        el.snapshotInfo.textContent = snapshotError
          ? 'Страховочную копию не удалось прочитать.'
          : 'Страховочная копия создаётся автоматически перед импортом или удалением всех данных.';
      }
    }
  }

  function bindSettings() {
    el.settingsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      el.settingsError.textContent = '';

      var name = el.settingsProfileName.value.trim();
      if (!name) {
        el.settingsError.textContent = 'Введите название автомобиля.';
        el.settingsProfileName.focus();
        return;
      }

      var raw = el.settingsOdometer.value.trim();
      var value = raw === '' ? null : C.parseNumber(raw);

      if (raw !== '' && (value === null || value < 0)) {
        el.settingsError.textContent = 'Введите пробег числом, например 130000.';
        el.settingsOdometer.focus();
        return;
      }

      var next = cloneState(state);
      var nextProfile = activeProfileIn(next);
      nextProfile.name = name.slice(0, 40);
      nextProfile.initialOdometer = value === null ? null : Math.round(value);
      nextProfile.updatedAt = new Date().toISOString();

      if (!commitState(next, 'Настройки не сохранены')) {
        return;
      }
      renderAll();
      showToast('Автомобиль сохранён');
    });

    el.settingsProfileName.addEventListener('input', function () {
      el.settingsError.textContent = '';
    });

    el.settingsOdometer.addEventListener('input', function () {
      var cleaned = el.settingsOdometer.value.replace(/\D/g, '');
      if (cleaned !== el.settingsOdometer.value) {
        el.settingsOdometer.value = cleaned;
      }
      el.settingsError.textContent = '';
    });

    el.settingsProfilesBtn.addEventListener('click', openProfiles);

    el.exportBtn.addEventListener('click', function () {
      try {
        var filename = S.downloadBackup(state);
        showToast('Файл ' + filename + ' сохранён');
      } catch (error) {
        showToast('Не удалось создать файл резервной копии.', 'error');
      }
    });

    el.importFile.addEventListener('change', handleImport);
    el.restoreSnapshotBtn.addEventListener('click', requestRestoreSnapshot);
    el.clearBtn.addEventListener('click', requestClearAll);
  }

  function handleImport(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    el.importFile.value = '';

    if (file.size > 5 * 1024 * 1024) {
      showToast('Файл слишком большой для резервной копии.', 'error');
      return;
    }

    readTextFile(file).then(function (text) {
      var imported;
      try {
        imported = S.parseBackup(text);
      } catch (error) {
        showToast(error.message, 'error');
        return null;
      }

      var importedCount = countFuelings(imported);
      return askConfirm({
        title: 'Импортировать данные?',
        message: 'Будет загружено ' + imported.profiles.length + ' ' +
          plural(imported.profiles.length, 'автомобиль', 'автомобиля', 'автомобилей') +
          ' и ' + importedCount + ' ' +
          plural(importedCount, 'запись', 'записи', 'записей') +
          '. Текущие данные (' + countFuelings(state) + ') будут заменены. ' +
          'Перед импортом автоматически создаётся страховочная копия.',
        confirmLabel: 'Импортировать'
      }).then(function (confirmed) {
        if (!confirmed) {
          return;
        }

        if (!S.createSnapshot(state, 'before-import')) {
          showToast('Импорт отменён. ' +
            (S.lastError || 'Не удалось создать страховочную копию.'), 'error');
          return;
        }
        renderSettings();

        if (!commitState(imported, 'Импорт отменён. Текущие данные не изменены')) {
          return;
        }
        renderAll();
        showToast('Импортировано ' + importedCount + ' ' +
          plural(importedCount, 'запись', 'записи', 'записей') +
          '. Страховочная копия сохранена.');
      });
    }).catch(function () {
      showToast('Не удалось прочитать файл.', 'error');
    });
  }

  function readTextFile(file) {
    if (typeof file.text === 'function') {
      return file.text();
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function requestClearAll() {
    askConfirm({
      title: 'Удалить все данные?',
      message: 'Все автомобили, заправки и настройки будут удалены с этого устройства. ' +
        'Перед удалением автоматически создаётся страховочная копия — её можно будет восстановить.',
      confirmLabel: 'Удалить всё'
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }

      if (!S.createSnapshot(state, 'before-clear')) {
        showToast('Удаление отменено. ' +
          (S.lastError || 'Не удалось создать страховочную копию.'), 'error');
        return;
      }
      renderSettings();

      if (!commitState(S.defaultState(), 'Удаление отменено. Данные не изменены')) {
        return;
      }
      renderAll();
      showToast('Все данные удалены. Страховочная копия сохранена.');
    });
  }

  function requestRestoreSnapshot() {
    var snapshot;
    try {
      snapshot = S.readSnapshot();
    } catch (error) {
      showToast(S.lastError || 'Не удалось прочитать страховочную копию.', 'error');
      return;
    }
    if (!snapshot) {
      showToast('Страховочная копия не найдена.', 'error');
      return;
    }

    var count = countFuelings(snapshot.state);
    askConfirm({
      title: 'Восстановить страховочную копию?',
      message: 'Будут восстановлены данные на ' + formatSnapshotDate(snapshot.createdAt) +
        ' (' + count + ' ' + plural(count, 'запись', 'записи', 'записей') + '). ' +
        'Текущие данные будут заменены.',
      confirmLabel: 'Восстановить'
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }

      var restored = S.restoreSnapshot();
      if (!restored) {
        showToast('Не удалось восстановить копию. ' +
          (S.lastError || 'Данные не изменены.'), 'error');
        return;
      }
      state = restored.state;
      renderAll();
      showToast('Данные восстановлены из страховочной копии');
    });
  }

  /* ── Форма заправки ────────────────────────────────────── */

  function openForm(id) {
    var record = null;
    editingId = id || null;

    if (editingId) {
      record = findFueling(editingId);
      if (!record) {
        showToast('Заправка не найдена.', 'error');
        editingId = null;
        return;
      }
    }

    clearFormErrors();
    el.formError.textContent = '';

    if (record) {
      el.sheetTitle.textContent = 'Изменить заправку';
      el.fuelSubmit.textContent = 'Сохранить изменения';
      el.fuelDelete.hidden = false;
      el.fuelDate.value = record.date;
      el.fuelOdometer.value = C.formatNumber(record.odometer, 0);
      el.fuelLiters.value = C.formatAmount(record.liters, 2);
      el.fuelPrice.value = C.formatAmount(record.pricePerLiter, 2);
      el.fuelTotal.value = C.formatAmount(record.total, 2);
      var recordStationId = record.stationId || C.inferStationId(record.station);
      el.fuelStation.value = recordStationId || '';
      el.fuelStationOther.value = recordStationId === 'other' && record.station !== 'Другое'
        ? record.station
        : '';
      toggleStationOther();
      el.fuelNote.value = record.note || '';
      el.fuelFull.checked = Boolean(record.fullTank);
      calcState = {
        liters: record.liters,
        pricePerLiter: record.pricePerLiter,
        total: record.total,
        lastPriceField: record.lastPriceField === 'total' ? 'total' : 'price'
      };
    } else {
      var stats = getStats();
      el.sheetTitle.textContent = 'Новая заправка';
      el.fuelSubmit.textContent = 'Сохранить заправку';
      el.fuelDelete.hidden = true;
      el.fuelDate.value = todayIso();
      el.fuelOdometer.value = stats.currentOdometer !== null
        ? String(Math.round(stats.currentOdometer))
        : '';
      el.fuelLiters.value = '';
      el.fuelPrice.value = '';
      el.fuelTotal.value = '';
      el.fuelStation.value = '';
      el.fuelStationOther.value = '';
      toggleStationOther();
      el.fuelNote.value = '';
      el.fuelFull.checked = true;
      calcState = {
        liters: null,
        pricePerLiter: null,
        total: null,
        lastPriceField: null
      };
    }

    updateCalcHint(C.recalculate(calcState));
    el.form.scrollTop = 0;
    document.querySelector('.fuel-form').scrollTop = 0;
    el.sheet.inert = false;
    el.sheet.classList.add('is-open');
    el.sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
  }

  function closeForm() {
    if (document.activeElement && el.sheet.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    el.sheet.classList.remove('is-open');
    el.sheet.inert = true;
    el.sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    editingId = null;
    el.formError.textContent = '';
    clearFormErrors();
  }

  function sanitizeNumericInput(input) {
    var cleaned = input.value.replace(/[^\d.,]/g, '');
    var separatorIndex = cleaned.search(/[.,]/);
    if (separatorIndex !== -1) {
      cleaned = cleaned.slice(0, separatorIndex + 1) +
        cleaned.slice(separatorIndex + 1).replace(/[.,]/g, '');
    }
    cleaned = cleaned.slice(0, 14);
    if (cleaned !== input.value) {
      input.value = cleaned;
    }
  }

  function runCalculation(activeInput) {
    var result = C.recalculate(calcState);

    calcState.liters = result.liters;
    calcState.pricePerLiter = result.pricePerLiter;
    calcState.total = result.total;

    if (result.derivedField === 'total' && activeInput !== el.fuelTotal) {
      el.fuelTotal.value = result.total === null ? '' : C.formatAmount(result.total, 2);
    } else if (result.derivedField === 'price' && activeInput !== el.fuelPrice) {
      el.fuelPrice.value = result.pricePerLiter === null ? '' : C.formatAmount(result.pricePerLiter, 2);
    }

    updateCalcHint(result);
  }

  function updateCalcHint(result) {
    var hint = el.calcHint;
    hint.classList.remove('is-calculated');

    if (result.derivedField === 'total' && result.total !== null && result.pricePerLiter !== null) {
      hint.textContent = 'Сумма рассчитана: ' +
        C.formatNumber(result.liters, 2) + ' л × ' +
        C.formatAmount(result.pricePerLiter, 2) + ' ₪ = ' +
        C.formatMoney(result.total);
      hint.classList.add('is-calculated');
      return;
    }

    if (result.derivedField === 'price' && result.total !== null && result.liters) {
      hint.textContent = 'Цена за литр рассчитана: ' +
        C.formatMoney(result.total) + ' ÷ ' +
        C.formatNumber(result.liters, 2) + ' л';
      hint.classList.add('is-calculated');
      return;
    }

    if (result.liters === null || result.liters <= 0) {
      hint.textContent = 'Сначала укажите количество литров — без него пересчёт невозможен.';
      return;
    }

    hint.textContent = 'Введите литры и одно из полей цены — второе заполнится автоматически.';
  }

  function bindCalcInput(input, field) {
    input.addEventListener('input', function () {
      sanitizeNumericInput(input);
      var value = C.parseNumber(input.value);

      if (field === 'liters') {
        calcState.liters = value;
      } else if (field === 'price') {
        calcState.pricePerLiter = value;
        calcState.lastPriceField = 'price';
      } else {
        calcState.total = value;
        calcState.lastPriceField = 'total';
      }

      runCalculation(input);
      clearFieldError(input);
      el.formError.textContent = '';
    });

    input.addEventListener('blur', function () {
      if (field === 'liters') {
        input.value = calcState.liters === null ? '' : C.formatAmount(calcState.liters, 2);
      } else if (field === 'price') {
        input.value = calcState.pricePerLiter === null ? '' : C.formatAmount(calcState.pricePerLiter, 2);
      } else {
        input.value = calcState.total === null ? '' : C.formatAmount(calcState.total, 2);
      }
    });
  }

  function toggleStationOther() {
    var isOther = el.fuelStation.value === 'other';
    el.fuelStationOtherField.hidden = !isOther;
  }

  function bindForm() {
    bindCalcInput(el.fuelLiters, 'liters');
    bindCalcInput(el.fuelPrice, 'price');
    bindCalcInput(el.fuelTotal, 'total');

    el.fuelStation.addEventListener('change', function () {
      toggleStationOther();
      clearFieldError(el.fuelStation);
      el.formError.textContent = '';
    });

    el.fuelStationOther.addEventListener('input', function () {
      clearFieldError(el.fuelStationOther);
      el.formError.textContent = '';
    });

    el.fuelOdometer.addEventListener('input', function () {
      var cleaned = el.fuelOdometer.value.replace(/[^\d]/g, '');
      if (cleaned !== el.fuelOdometer.value) {
        el.fuelOdometer.value = cleaned;
      }
      clearFieldError(el.fuelOdometer);
      el.formError.textContent = '';
    });

    el.fuelDate.addEventListener('input', function () {
      clearFieldError(el.fuelDate);
      el.formError.textContent = '';
    });

    el.sheetClose.addEventListener('click', closeForm);
    el.form.addEventListener('submit', handleFormSubmit);
    el.fuelDelete.addEventListener('click', function () {
      if (editingId) {
        requestDelete(editingId, true);
      }
    });
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    el.formError.textContent = '';
    clearFormErrors();

    var date = el.fuelDate.value;
    var odometer = C.parseNumber(el.fuelOdometer.value);
    var liters = calcState.liters;
    var price = calcState.pricePerLiter;
    var total = calcState.total;

    if (!date || !C.isValidDateString(date)) {
      return formError('Укажите дату заправки.', el.fuelDate);
    }
    if (date > todayIso()) {
      return formError('Дата не может быть в будущем.', el.fuelDate);
    }
    if (odometer === null || odometer <= 0) {
      return formError('Введите пробег одометра больше нуля.', el.fuelOdometer);
    }
    if (liters === null || liters <= 0) {
      return formError('Введите количество литров больше нуля.', el.fuelLiters);
    }

    var result = C.recalculate({
      liters: liters,
      pricePerLiter: price,
      total: total,
      lastPriceField: calcState.lastPriceField
    });

    if (result.pricePerLiter === null && result.total === null) {
      return formError('Укажите цену за литр или общую сумму.', el.fuelPrice);
    }

    // На всякий случай ещё раз проверяем, что после пересчёта нет NaN/Infinity.
    if (!Number.isFinite(result.pricePerLiter) || !Number.isFinite(result.total)) {
      return formError('Не удалось рассчитать стоимость. Проверьте литры и цену.', el.fuelTotal);
    }

    var existing = editingId ? findFueling(editingId) : null;
    var stationId = el.fuelStation.value;
    if (!C.stationName(stationId)) {
      stationId = '';
    }
    var station = stationId === 'other'
      ? (el.fuelStationOther.value.trim().slice(0, 80) || 'Другое')
      : (stationId ? C.stationName(stationId) : '');

    var record = {
      id: existing ? existing.id : S.makeId(),
      date: date,
      odometer: Math.round(odometer),
      liters: result.liters,
      pricePerLiter: result.pricePerLiter,
      total: result.total,
      station: station,
      stationId: stationId,
      note: el.fuelNote.value.trim(),
      fullTank: el.fuelFull.checked,
      lastPriceField: calcState.lastPriceField || 'price',
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    var next = cloneState(state);
    var nextProfile = activeProfileIn(next);
    var nextFuelings = nextProfile.fuelings;
    var index = -1;

    if (existing) {
      for (var itemIndex = 0; itemIndex < nextFuelings.length; itemIndex += 1) {
        if (nextFuelings[itemIndex].id === existing.id) {
          index = itemIndex;
          break;
        }
      }
      if (index === -1) {
        showToast('Заправка не найдена. Обновите список.', 'error');
        return;
      }
      nextFuelings[index] = record;
    } else {
      nextFuelings.push(record);
    }
    nextProfile.updatedAt = new Date().toISOString();

    if (!commitState(next, existing ? 'Изменения не сохранены' : 'Заправка не сохранена')) {
      return;
    }
    renderAll();
    closeForm();
    showScreen('history');
    showToast(existing ? 'Заправка изменена' : 'Заправка сохранена');
  }

  function formError(message, input) {
    el.formError.textContent = message;
    if (input) {
      var wrap = input.closest('.input-wrap');
      if (wrap) {
        wrap.classList.add('is-invalid');
      }
      input.focus();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return null;
  }

  function clearFieldError(input) {
    var wrap = input.closest('.input-wrap');
    if (wrap) {
      wrap.classList.remove('is-invalid');
    }
  }

  function clearFormErrors() {
    Array.prototype.forEach.call(el.form.querySelectorAll('.input-wrap.is-invalid'), function (wrap) {
      wrap.classList.remove('is-invalid');
    });
  }

  /* ── Удаление ──────────────────────────────────────────── */

  function requestDelete(id, fromSheet) {
    var record = findFueling(id);
    if (!record) {
      return;
    }
    var description = formatDate(record.date) + ' · ' + C.formatMoney(record.total) +
      (record.station ? ' · ' + record.station : '');

    askConfirm({
      title: 'Удалить заправку?',
      message: description + '. Это действие нельзя отменить.',
      confirmLabel: 'Удалить'
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var next = cloneState(state);
      var nextProfile = activeProfileIn(next);
      nextProfile.fuelings = nextProfile.fuelings.filter(function (item) { return item.id !== id; });
      nextProfile.updatedAt = new Date().toISOString();

      if (!commitState(next, 'Заправка не удалена')) {
        return;
      }
      renderAll();
      if (fromSheet) {
        closeForm();
      }
      showToast('Заправка удалена');
    });
  }

  /* ── Автомобили ────────────────────────────────────────── */

  function profileInitials(name) {
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function renderProfiles() {
    var profile = activeProfile();
    if (el.activeProfileName) {
      el.activeProfileName.textContent = profile.name;
    }
    if (!el.profilesList) {
      return;
    }

    var canDelete = state.profiles.length > 1;
    el.profilesList.innerHTML = state.profiles.map(function (item) {
      var active = item.id === profile.id;
      var count = item.fuelings.length;
      var check = active
        ? '<span class="profile-check" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>' +
          '</span>'
        : '<span class="profile-check is-empty" aria-hidden="true"></span>';

      return (
        '<div class="profile-row' + (active ? ' is-active' : '') + '">' +
          '<button class="profile-select" type="button" data-profile-switch="' + escapeHtml(item.id) + '"' +
            (active ? ' aria-current="true"' : '') + '>' +
            '<span class="profile-avatar" aria-hidden="true">' + escapeHtml(profileInitials(item.name)) + '</span>' +
            '<span class="profile-row-text">' +
              '<strong>' + escapeHtml(item.name) + '</strong>' +
              '<small>' + count + ' ' + plural(count, 'запись', 'записи', 'записей') + '</small>' +
            '</span>' +
            check +
          '</button>' +
          (canDelete
            ? '<button class="profile-delete" type="button" data-profile-delete="' + escapeHtml(item.id) + '" aria-label="Удалить автомобиль ' + escapeHtml(item.name) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
              '</button>'
            : '') +
        '</div>'
      );
    }).join('');
  }

  function resetProfileForm() {
    el.profileForm.hidden = true;
    el.profileAddBtn.hidden = false;
    el.profileName.value = '';
    el.profileOdometer.value = '';
    el.profileError.textContent = '';
  }

  function openProfiles() {
    resetProfileForm();
    renderProfiles();
    el.profilesModal.hidden = false;
    document.body.classList.add('modal-open');
    el.profilesClose.focus();
  }

  function closeProfiles() {
    el.profilesModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function showProfileForm() {
    el.profileForm.hidden = false;
    el.profileAddBtn.hidden = true;
    el.profileError.textContent = '';
    el.profileName.value = '';
    el.profileOdometer.value = '';
    el.profileName.focus();
  }

  function switchProfile(id) {
    var profile = null;
    for (var index = 0; index < state.profiles.length; index += 1) {
      if (state.profiles[index].id === id) {
        profile = state.profiles[index];
        break;
      }
    }
    if (!profile) {
      return;
    }

    if (state.activeProfileId !== id) {
      var next = cloneState(state);
      next.activeProfileId = id;
      if (!commitState(next, 'Не удалось переключить автомобиль')) {
        return;
      }
      renderAll();
      showToast('Автомобиль: ' + profile.name);
    }
    closeProfiles();
  }

  function requestDeleteProfile(id) {
    if (state.profiles.length <= 1) {
      return;
    }

    var profile = null;
    for (var index = 0; index < state.profiles.length; index += 1) {
      if (state.profiles[index].id === id) {
        profile = state.profiles[index];
        break;
      }
    }
    if (!profile) {
      return;
    }

    askConfirm({
      title: 'Удалить автомобиль?',
      message: 'Профиль «' + profile.name + '» и его заправки (' + profile.fuelings.length +
        ') будут удалены. Это действие нельзя отменить.',
      confirmLabel: 'Удалить'
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }

      var next = cloneState(state);
      next.profiles = next.profiles.filter(function (item) {
        return item.id !== id;
      });
      if (next.activeProfileId === id) {
        next.activeProfileId = next.profiles[0].id;
      }

      if (!commitState(next, 'Автомобиль не удалён')) {
        return;
      }
      renderAll();
      showToast('Автомобиль удалён');
    });
  }

  function bindProfiles() {
    el.carSwitch.addEventListener('click', openProfiles);
    el.profilesClose.addEventListener('click', closeProfiles);
    el.profilesModal.addEventListener('click', function (event) {
      if (event.target === el.profilesModal) {
        closeProfiles();
      }
    });

    el.profilesList.addEventListener('click', function (event) {
      var switchButton = event.target.closest('[data-profile-switch]');
      if (switchButton) {
        switchProfile(switchButton.getAttribute('data-profile-switch'));
        return;
      }
      var deleteButton = event.target.closest('[data-profile-delete]');
      if (deleteButton) {
        requestDeleteProfile(deleteButton.getAttribute('data-profile-delete'));
      }
    });

    el.profileAddBtn.addEventListener('click', showProfileForm);
    el.profileCancel.addEventListener('click', resetProfileForm);

    el.profileName.addEventListener('input', function () {
      el.profileError.textContent = '';
    });

    el.profileOdometer.addEventListener('input', function () {
      var cleaned = el.profileOdometer.value.replace(/\D/g, '');
      if (cleaned !== el.profileOdometer.value) {
        el.profileOdometer.value = cleaned;
      }
      el.profileError.textContent = '';
    });

    el.profileForm.addEventListener('submit', function (event) {
      event.preventDefault();
      el.profileError.textContent = '';

      var name = el.profileName.value.trim();
      if (!name) {
        el.profileError.textContent = 'Введите название автомобиля.';
        el.profileName.focus();
        return;
      }

      var raw = el.profileOdometer.value.trim();
      var odometer = raw === '' ? null : C.parseNumber(raw);
      if (raw !== '' && (odometer === null || odometer < 0)) {
        el.profileError.textContent = 'Введите пробег числом, например 85000.';
        el.profileOdometer.focus();
        return;
      }

      var profile = S.createProfile(name, odometer === null ? null : Math.round(odometer));
      var next = cloneState(state);
      next.profiles.push(profile);
      next.activeProfileId = profile.id;

      if (!commitState(next, 'Автомобиль не добавлен')) {
        return;
      }
      renderAll();
      closeProfiles();
      showToast('Автомобиль добавлен');
    });
  }

  /* ── Подтверждение ─────────────────────────────────────── */

  function bindConfirm() {
    el.confirmCancel.addEventListener('click', function () { settleConfirm(false); });
    el.confirmOk.addEventListener('click', function () { settleConfirm(true); });
    el.confirmModal.addEventListener('click', function (event) {
      if (event.target === el.confirmModal) {
        settleConfirm(false);
      }
    });
  }

  function askConfirm(options) {
    var settings = options || {};
    el.confirmTitle.textContent = settings.title || 'Подтвердите действие';
    el.confirmText.textContent = settings.message || '';
    el.confirmOk.textContent = settings.confirmLabel || 'Удалить';
    el.confirmModal.hidden = false;

    return new Promise(function (resolve) {
      confirmResolver = resolve;
    });
  }

  function settleConfirm(value) {
    el.confirmModal.hidden = true;
    var resolver = confirmResolver;
    confirmResolver = null;
    if (resolver) {
      resolver(value);
    }
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') {
        return;
      }
      if (!el.confirmModal.hidden) {
        settleConfirm(false);
        return;
      }
      if (!el.profilesModal.hidden) {
        closeProfiles();
        return;
      }
      if (el.sheet.classList.contains('is-open')) {
        closeForm();
      }
    });
  }

  /* ── Общий рендер и PWA ────────────────────────────────── */

  function renderAll() {
    renderHome();
    renderHistory();
    renderCharts();
    renderStatsScreen();
    renderSettings();
    renderProfiles();
  }

  var lastUpdateCheck = 0;
  var serviceWorkerRegistration = null;
  var updatePromptShown = false;

  function checkForServiceWorkerUpdate(force) {
    if (!serviceWorkerRegistration) {
      return;
    }
    var now = Date.now();
    if (!force && now - lastUpdateCheck < 5 * 60 * 1000) {
      return;
    }
    lastUpdateCheck = now;
    serviceWorkerRegistration.update().catch(function () {
      // Нет сети — попробуем при следующем открытии или возврате в приложение.
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      return;
    }

    var hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (updatePromptShown) {
        return;
      }
      updatePromptShown = true;
      if (document.hidden) {
        window.location.reload();
        return;
      }
      showToast('Доступна новая версия. Перезапустите приложение.');
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then(function (registration) {
          serviceWorkerRegistration = registration;
          checkForServiceWorkerUpdate(true);
          document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
              checkForServiceWorkerUpdate(false);
            }
          });
        })
        .catch(function () {
          // Офлайн-режим не критичен для работы с данными: приложение продолжит работать онлайн.
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
