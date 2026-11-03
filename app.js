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
  var Ocr = window.MuranoOcr;
  var Focus = window.MuranoFocus;
  var I18n = window.MuranoI18n;

  if (I18n && typeof I18n.init === 'function') {
    I18n.init();
  }

  function T(text, params) {
    return I18n ? I18n.t(text, params) : text;
  }

  function P(key, count) {
    if (I18n) {
      return I18n.p(key, count);
    }
    if (key === 'fillup' || key === 'fillupAcc') {
      return count === 1 ? 'заправка' : (count >= 2 && count <= 4 ? 'заправки' : 'заправок');
    }
    if (key === 'record') {
      return count === 1 ? 'запись' : (count >= 2 && count <= 4 ? 'записи' : 'записей');
    }
    if (key === 'car') {
      return count === 1 ? 'автомобиль' : (count >= 2 && count <= 4 ? 'автомобиля' : 'автомобилей');
    }
    return count === 1 ? 'файл' : (count >= 2 && count <= 4 ? 'файла' : 'файлов');
  }

  function countLabel(count, key) {
    return count + ' ' + P(key, count);
  }

  function appLocale() {
    return I18n ? I18n.locale() : 'ru-RU';
  }

  function appDir() {
    return I18n ? I18n.dir() : 'ltr';
  }

  function applyTranslations() {
    if (I18n && typeof I18n.apply === 'function') {
      I18n.apply(document);
    }
  }

  var state = S.load();
  var currentScreen = 'home';
  var editingId = null;
  var editingMaintenanceId = null;
  var toastTimer = null;
  var confirmResolver = null;
  var statsPeriod = 'all';
  var homePeriod = 'month';
  var odometerSuggestion = null;
  var odometerPrefilled = false;
  var lastSelectedFuelType = '';
  var fuelPriceTouched = false;
  var fuelPriceAutoFilled = false;
  var ocrObjectUrl = null;
  var ocrReviewResult = null;
  var ocrRequestToken = 0;
  var fuelFormOpener = null;
  var maintenanceFormOpener = null;
  var ocrReviewOpener = null;
  var attachmentViewerOpener = null;
  var maintenanceDraftAttachments = [];
  var attachmentInputBusy = false;

  var MAX_ATTACHMENTS = 5;
  var MAX_ATTACHMENT_INPUT_BYTES = 12 * 1024 * 1024;
  var MAX_ATTACHMENT_SIDE = 1600;
  var ATTACHMENT_PURPOSES = ['receipt', 'invoice', 'warranty', 'photo', 'other'];

  var THEME_KEY = 'muranoLog.theme.v1';
  var THEME_COLORS = { light: '#f4f6f9', dark: '#0b111b' };
  var themeMode = readThemeMode();
  var themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  var OCR_DEFAULT_STATUS = 'Фото не отправляется в интернет. Сначала покажем распознанные числа для проверки.';

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

  /* ── Тема оформления ───────────────────────────────────── */

  function readThemeMode() {
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch (error) {
      return 'system';
    }
    return 'system';
  }

  function resolvedTheme() {
    if (themeMode === 'light' || themeMode === 'dark') {
      return themeMode;
    }
    return themeMedia && themeMedia.matches ? 'light' : 'dark';
  }

  function applyTheme() {
    var resolved = resolvedTheme();
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-mode', themeMode);
    root.style.colorScheme = resolved;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', THEME_COLORS[resolved]);
    }

    if (el.themeButtons) {
      el.themeButtons.forEach(function (button) {
        var active = button.getAttribute('data-theme-choice') === themeMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    if (el.themeCurrent) {
      el.themeCurrent.textContent = themeMode === 'system'
        ? T('Системная тема')
        : (resolved === 'light' ? T('Светлая тема') : T('Тёмная тема'));
    }

    if (el.themeHint) {
      el.themeHint.textContent = themeMode === 'system'
        ? T('Сейчас используется {theme} тема телефона. Приложение переключится вместе с системой.', {
          theme: T(resolved === 'light' ? 'светлая' : 'тёмная')
        })
        : T('Выбор сохранён на этом устройстве и не попадёт в резервную копию журнала.');
    }

    if (currentScreen === 'charts') {
      renderCharts();
    }
  }

  function bindTheme() {
    el.themeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-theme-choice]'));
    el.themeHint = $('theme-hint');
    el.themeCurrent = $('theme-current');

    el.themeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-theme-choice');
        if (next !== 'light' && next !== 'dark' && next !== 'system') {
          return;
        }
        themeMode = next;
        try {
          window.localStorage.setItem(THEME_KEY, themeMode);
        } catch (error) {
          // Настройка темы не должна блокировать работу приложения.
        }
        applyTheme();
      });
    });

    if (themeMedia) {
      var onSystemThemeChange = function () {
        if (themeMode === 'system') {
          applyTheme();
        }
      };
      if (typeof themeMedia.addEventListener === 'function') {
        themeMedia.addEventListener('change', onSystemThemeChange);
      } else if (typeof themeMedia.addListener === 'function') {
        themeMedia.addListener(onSystemThemeChange);
      }
    }
  }

  function init() {
    el.app = document.querySelector('.app');
    el.screens = Array.prototype.slice.call(document.querySelectorAll('[data-screen]'));
    el.navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item[data-nav]'));
    el.iconNavItems = Array.prototype.slice.call(document.querySelectorAll('.icon-btn[data-nav]'));
    el.statOdometer = $('stat-odometer');
    el.heroDate = $('hero-date');
    el.heroHint = $('hero-hint');
    el.statConsumption = $('stat-consumption');
    el.statConsumptionNote = $('stat-consumption-note');
    el.statFuelSpent = $('stat-fuel-spent');
    el.statFuelSpentNote = $('stat-fuel-spent-note');
    el.statTotal = $('stat-total');
    el.statTotalNote = $('stat-total-note');
    el.statCostKm = $('stat-costkm');
    el.statCostKmNote = $('stat-costkm-note');
    el.homePeriodButtons = Array.prototype.slice.call(document.querySelectorAll('[data-home-period]'));
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
    el.statMaintenanceTotal = $('stat-maintenance-total');
    el.statMaintenanceNote = $('stat-maintenance-note');
    el.maintenanceList = $('maintenance-list');
    el.maintenanceTotalAll = $('maintenance-total-all');
    el.maintenanceSummaryMeta = $('maintenance-summary-meta');
    el.sheet = $('fuel-sheet');
    el.sheetTitle = $('sheet-title');
    el.sheetClose = $('sheet-close');
    el.form = $('fuel-form');
    el.fuelDate = $('fuel-date');
    el.fuelOdometer = $('fuel-odometer');
    el.odometerAssist = $('odometer-assist');
    el.odometerAssistText = $('odometer-assist-text');
    el.odometerAssistAction = $('odometer-assist-action');
    el.fuelType = $('fuel-type');
    el.fuelLiters = $('fuel-liters');
    el.fuelPrice = $('fuel-price');
    el.fuelTotal = $('fuel-total');
    el.fuelCorporate = $('fuel-corporate');
    el.fuelStation = $('fuel-station');
    el.fuelStationOther = $('fuel-station-other');
    el.fuelStationOtherField = $('fuel-station-other-field');
    el.fuelNote = $('fuel-note');
    el.fuelFull = $('fuel-full');
    el.calcHint = $('calc-hint');
    el.formError = $('form-error');
    el.fuelSubmit = $('fuel-submit');
    el.fuelDelete = $('fuel-delete');
    el.ocrCard = $('ocr-card');
    el.ocrCameraInput = $('ocr-camera-input');
    el.ocrGalleryInput = $('ocr-gallery-input');
    el.ocrCameraBtn = $('ocr-camera-btn');
    el.ocrGalleryBtn = $('ocr-gallery-btn');
    el.ocrPreview = $('ocr-preview');
    el.ocrPreviewImage = $('ocr-preview-image');
    el.ocrFileName = $('ocr-file-name');
    el.ocrPreviewRemove = $('ocr-preview-remove');
    el.ocrProgress = $('ocr-progress');
    el.ocrProgressBar = $('ocr-progress-bar');
    el.ocrStatus = $('ocr-status');
    el.ocrReviewModal = $('ocr-review-modal');
    el.ocrReviewImage = $('ocr-review-image');
    el.ocrReviewConfidence = $('ocr-review-confidence');
    el.ocrReviewLiters = $('ocr-review-liters');
    el.ocrReviewPrice = $('ocr-review-price');
    el.ocrReviewTotal = $('ocr-review-total');
    el.ocrReviewError = $('ocr-review-error');
    el.ocrReviewManual = $('ocr-review-manual');
    el.ocrReviewApply = $('ocr-review-apply');
    el.ocrReviewClose = $('ocr-review-close');
    el.ocrRawText = $('ocr-raw-text');
    el.maintenanceSheet = $('maintenance-sheet');
    el.maintenanceSheetTitle = $('maintenance-sheet-title');
    el.maintenanceSheetClose = $('maintenance-sheet-close');
    el.maintenanceForm = $('maintenance-form');
    el.maintenanceDate = $('maintenance-date');
    el.maintenanceOdometer = $('maintenance-odometer');
    el.maintenanceTitle = $('maintenance-title');
    el.maintenanceParts = $('maintenance-parts');
    el.maintenanceLabor = $('maintenance-labor');
    el.maintenanceNote = $('maintenance-note');
    el.maintenanceFormError = $('maintenance-form-error');
    el.maintenanceFormCancel = $('maintenance-form-cancel');
    el.maintenanceFormTotal = $('maintenance-form-total');
    el.maintenanceDeleteBtn = $('maintenance-delete');
    el.maintenanceAttachments = $('maintenance-attachments');
    el.maintenanceAttachmentsCount = $('maintenance-attachments-count');
    el.maintenanceAttachmentsHint = $('maintenance-attachments-hint');
    el.maintenanceCameraInput = $('maintenance-camera-input');
    el.maintenanceGalleryInput = $('maintenance-gallery-input');
    el.maintenanceCameraBtn = $('maintenance-camera-btn');
    el.maintenanceGalleryBtn = $('maintenance-gallery-btn');
    el.attachmentViewer = $('attachment-viewer');
    el.attachmentViewerTitle = $('attachment-viewer-title');
    el.attachmentViewerClose = $('attachment-viewer-close');
    el.attachmentViewerImage = $('attachment-viewer-image');
    el.attachmentViewerMeta = $('attachment-viewer-meta');
    el.languageSelect = $('language-select');
    el.confirmModal = $('confirm-modal');
    el.confirmTitle = $('confirm-title');
    el.confirmText = $('confirm-text');
    el.confirmCancel = $('confirm-cancel');
    el.confirmOk = $('confirm-ok');
    el.toast = $('toast');

    el.fuelDate.max = todayIso();
    if (el.maintenanceDate) {
      el.maintenanceDate.max = todayIso();
    }
    if (el.maintenanceSheet) {
      el.maintenanceSheet.inert = true;
    }

    bindNavigation();
    bindForm();
    bindOcr();
    bindMaintenanceForm();
    bindMaintenanceAttachments();
    bindAttachmentViewer();
    bindSettings();
    bindLanguage();
    bindStatsPeriod();
    bindHomePeriod();
    bindProfiles();
    bindConfirm();
    bindDelegatedActions();
    bindKeyboard();
    bindTheme();

    if (el.statsPeriod) {
      el.statsPeriod.value = statsPeriod;
    }
    if (el.sheet) {
      el.sheet.inert = true;
    }

    applyTheme();
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
      return new Intl.DateTimeFormat(appLocale(), short
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'long', year: 'numeric' }
      ).format(date);
    } catch (error) {
      return iso;
    }
  }

  function currentMonthLabel() {
    try {
      return new Intl.DateTimeFormat(appLocale(), { month: 'long', year: 'numeric' })
        .format(new Date())
        .replace(/\s*г\.$/, '');
    } catch (error) {
      return T('в этом месяце');
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
      return '0 ' + T('Б');
    }
    if (bytes < 1024) {
      return C.formatNumber(bytes, 0) + ' ' + T('Б');
    }
    if (bytes < 1024 * 1024) {
      return C.formatNumber(bytes / 1024, 1) + ' ' + T('КБ');
    }
    return C.formatNumber(bytes / (1024 * 1024), 1) + ' ' + T('МБ');
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

  function findMaintenance(id) {
    var records = getMaintenances();
    for (var index = 0; index < records.length; index += 1) {
      if (records[index].id === id) {
        return records[index];
      }
    }
    return null;
  }

  function latestKnownOdometer() {
    var fuelings = C.sortedByDateDesc(getFuelings());
    var maintenances = C.sortedMaintenanceByDateDesc(getMaintenances());
    var candidates = [];

    if (fuelings.length) {
      candidates.push(fuelings[0]);
    }
    if (maintenances.length) {
      candidates.push(maintenances[0]);
    }

    if (!candidates.length) {
      return activeProfile().initialOdometer;
    }

    var latest = candidates[0];
    for (var index = 1; index < candidates.length; index += 1) {
      var item = candidates[index];
      if (item.date > latest.date ||
          (item.date === latest.date && item.odometer > latest.odometer)) {
        latest = item;
      }
    }
    return latest.odometer;
  }

  function showToast(message, type) {
    if (!el.toast) {
      return;
    }
    el.toast.textContent = T(message);
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
      var message = S.lastError || T('Не удалось сохранить данные.');
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

  function isDefaultProfileName(name) {
    return name === 'Моя машина' || name === 'My car' || name === 'המכונית שלי' ||
      /^Автомобиль \d+$/.test(name) || /^Vehicle \d+$/.test(name) || /^רכב \d+$/.test(name);
  }

  function displayProfileName(name) {
    if (name === 'Моя машина' || name === 'My car' || name === 'המכונית שלי') {
      return T('Моя машина');
    }
    var numbered = /^(?:Автомобиль|Vehicle|רכב) (\d+)$/.exec(name);
    if (numbered) {
      return T('Автомобиль {n}', { n: numbered[1] });
    }
    return name;
  }

  function stationDisplayName(record) {
    if (!record) {
      return T('Без названия АЗС');
    }
    if (!record.station) {
      return T('Без названия АЗС');
    }
    if (record.stationId === 'other' || record.station === 'Другое' ||
        record.station === 'Other' || record.station === 'אחר') {
      return T('Другое');
    }
    return T(record.station);
  }

  function getFuelings() {
    var profile = activeProfile();
    return Array.isArray(profile.fuelings) ? profile.fuelings : [];
  }

  function getMaintenances() {
    var profile = activeProfile();
    return Array.isArray(profile.maintenances) ? profile.maintenances : [];
  }

  function countRecordsForProfile(profile) {
    if (!profile) {
      return 0;
    }
    var fuelings = Array.isArray(profile.fuelings) ? profile.fuelings : [];
    var maintenances = Array.isArray(profile.maintenances) ? profile.maintenances : [];
    return fuelings.length + maintenances.length;
  }

  function countAllRecords(sourceState) {
    var target = sourceState || state;
    if (!target || !Array.isArray(target.profiles)) {
      return 0;
    }
    var total = 0;
    for (var i = 0; i < target.profiles.length; i += 1) {
      total += countRecordsForProfile(target.profiles[i]);
    }
    return total;
  }

  function countFuelings(sourceState) {
    return countAllRecords(sourceState);
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
    el.navItems.concat(el.iconNavItems || []).forEach(function (item) {
      var isActive = item.getAttribute('data-nav') === name;
      item.classList.toggle('is-active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'charts') {
      renderCharts();
      renderStatsScreen();
    }
    if (name === 'maintenance') {
      renderMaintenance();
    }
    applyTranslations();
  }

  function bindStatsPeriod() {
    el.statsPeriod.addEventListener('change', function () {
      statsPeriod = el.statsPeriod.value || 'all';
      renderStatsScreen();
    });
  }

  function bindHomePeriod() {
    el.homePeriodButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var nextPeriod = button.getAttribute('data-home-period');
        homePeriod = nextPeriod === 'all' ? 'all' : 'month';
        renderHome();
      });
    });
  }

  function bindDelegatedActions() {
    document.addEventListener('click', function (event) {
      // Кнопки в пустых состояниях перерисовываются, поэтому обрабатываем
      // добавление заправки через делегирование, а не прямыми обработчиками.
      var addFuelButton = event.target.closest('[data-action="add"]');
      if (addFuelButton) {
        openForm(null, addFuelButton);
        return;
      }
      var addMaintenanceButton = event.target.closest('[data-action="add-maintenance"]');
      if (addMaintenanceButton) {
        openMaintenanceForm(null, addMaintenanceButton);
        return;
      }
      var attachmentButton = event.target.closest('[data-attachment-record]');
      if (attachmentButton) {
        var attachment = findRecordAttachment(
          attachmentButton.getAttribute('data-attachment-record'),
          attachmentButton.getAttribute('data-attachment-id')
        );
        if (attachment) {
          openAttachmentViewer(attachment, attachmentButton);
        } else {
          showToast(T('Вложение не найдено.'), 'error');
        }
        return;
      }
      var maintenanceEditButton = event.target.closest('button[data-maintenance-edit]');
      if (maintenanceEditButton) {
        openMaintenanceForm(maintenanceEditButton.getAttribute('data-maintenance-edit'), maintenanceEditButton);
        return;
      }
      var maintenanceDeleteButton = event.target.closest('button[data-maintenance-delete]');
      if (maintenanceDeleteButton) {
        requestMaintenanceDelete(maintenanceDeleteButton.getAttribute('data-maintenance-delete'));
        return;
      }
      var editButton = event.target.closest('button[data-edit]');
      if (editButton) {
        openForm(editButton.getAttribute('data-edit'), editButton);
        return;
      }
      var deleteButton = event.target.closest('button[data-delete]');
      if (deleteButton) {
        requestDelete(deleteButton.getAttribute('data-delete'));
      }
    });
  }

  /* ── Главный экран ─────────────────────────────────────── */

  function updateHomePeriodButtons() {
    el.homePeriodButtons.forEach(function (button) {
      var active = button.getAttribute('data-home-period') === homePeriod;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function homePeriodText() {
    return homePeriod === 'month' ? currentMonthLabel() : T('за всё время');
  }

  function fuelCostNote(fuelStats) {
    if (homePeriod === 'month') {
      if (!fuelStats.recordsCount) {
        return T('в этом месяце нет заправок');
      }
      if (fuelStats.startOdometer === null) {
        return T('нужна заправка до начала месяца');
      }
      if (fuelStats.distance === null) {
        return T('проверьте пробег: он не вырос');
      }
    } else {
      if (!fuelStats.recordsCount) {
        return T('пока нет заправок');
      }
      if (!fuelStats.hasInitialOdometer) {
        return T('укажите начальный пробег');
      }
      if (fuelStats.distance === null) {
        return T('проверьте пробег от начального');
      }
    }
    return T('нужны данные о пробеге');
  }

  function renderHome() {
    var stats = getStats();
    var profile = activeProfile();
    var fuelStats = C.calculateFuelPeriodStats(getFuelings(), {
      period: homePeriod,
      initialOdometer: profile.initialOdometer,
      now: new Date()
    });

    updateHomePeriodButtons();

    el.statOdometer.textContent = stats.currentOdometer !== null
      ? C.formatNumber(stats.currentOdometer, 0)
      : '—';

    if (stats.recordsCount === 0) {
      el.heroDate.textContent = profile.initialOdometer !== null
        ? T('старт учёта')
        : T('нет данных');
      el.heroHint.textContent = profile.initialOdometer !== null
        ? T('Добавьте первую заправку — здесь появится пробег, расход и расходы.')
        : T('Укажите начальный пробег в настройках или добавьте первую заправку.');
    } else {
      el.heroDate.textContent = T('обновлено ') + formatDate(stats.lastDate, true);
      el.heroHint.textContent =
        C.formatNumber(stats.totalLiters, 1) + T(' л за всё время · ') +
        countLabel(stats.recordsCount, 'fillup');
    }

    if (stats.averageConsumption !== null) {
      el.statConsumption.textContent = C.formatNumber(stats.averageConsumption, 1);
      el.statConsumptionNote.textContent = stats.lastConsumption !== null
        ? T('последний: ') + C.formatNumber(stats.lastConsumption, 1) + T(' л/100 км')
        : T('по заправкам до полного');
    } else {
      el.statConsumption.textContent = '—';
      el.statConsumptionNote.textContent = T('нужны две заправки до полного');
    }

    el.statFuelSpent.textContent = C.formatMoney(fuelStats.totalSpent);
    el.statFuelSpentNote.textContent = homePeriodText();

    el.statTotal.textContent = C.formatMoney(stats.totalSpent);
    el.statTotalNote.textContent = stats.recordsCount > 0
      ? T('за ') + countLabel(stats.recordsCount, 'fillupAcc')
      : T('пока нет заправок');

    var maintenanceStatsHome = C.calculateMaintenanceStats ? C.calculateMaintenanceStats(getMaintenances()) : { recordsCount: 0, totalCost: 0 };
    if (el.statMaintenanceTotal) {
      el.statMaintenanceTotal.textContent = C.formatMoney(maintenanceStatsHome.totalCost);
    }
    if (el.statMaintenanceNote) {
      el.statMaintenanceNote.textContent = maintenanceStatsHome.recordsCount > 0
        ? T('за ') + countLabel(maintenanceStatsHome.recordsCount, 'record') + T(' · за всё время')
        : T('пока нет записей');
    }

    if (fuelStats.costPerKm !== null) {
      el.statCostKm.textContent = C.formatMoney(fuelStats.costPerKm);
      el.statCostKmNote.textContent = T('на ') + C.formatNumber(fuelStats.distance, 0) +
        T(' км ') + (homePeriod === 'month' ? T('за этот месяц') : T('за всё время'));
    } else {
      el.statCostKm.textContent = '—';
      el.statCostKmNote.textContent = fuelCostNote(fuelStats);
    }

    var recent = C.sortedByDateDesc(getFuelings()).slice(0, 3);
    el.recentList.innerHTML = recent.length
      ? recent.map(fuelCardHtml).join('')
      : emptyStateHtml(
          T('Заправок пока нет'),
          T('Добавьте первую запись — приложение посчитает расход топлива и его стоимость на километр.'),
          true
        );
    applyTranslations();
  }

  /* ── Журнал ────────────────────────────────────────────── */

  function fuelCardHtml(item) {
    var stationName = stationDisplayName(item);
    var station = item.station || item.stationId === 'other'
      ? '<span class="fuel-station" dir="auto" data-i18n-ignore>' + escapeHtml(stationName) + '</span>'
      : '<span class="fuel-station is-empty">Без названия АЗС</span>';

    var note = item.note
      ? '<p class="fuel-note log-note" dir="auto" data-i18n-ignore>' + escapeHtml(item.note) + '</p>'
      : '';

    var fuelType = C.normalizeFuelType(item.fuelType);
    var fuelBadge = fuelType
      ? '<span class="badge-fuel' + (fuelType === 'diesel' ? ' is-diesel' : '') +
          '" title="' + escapeHtml(T(C.fuelTypeName(fuelType))) + '">' +
          (fuelType === 'diesel' ? T('Дизель') : T('АИ-95')) + '</span>'
      : '';
    var corporateBadge = item.corporate === true
      ? '<span class="badge-corporate" title="' + escapeHtml(T('Корпоративная заправка через דלקן')) + '">דלקן</span>'
      : '';

    return (
      '<article class="fuel-card log-card" data-card-id="' + escapeHtml(item.id) + '">' +
        '<div class="log-top">' +
          '<time class="log-date" datetime="' + escapeHtml(item.date) + '" title="' + escapeHtml(formatDate(item.date)) + '">' +
            escapeHtml(formatDate(item.date, true)) +
          '</time>' +
          '<div class="log-badges">' +
            fuelBadge +
            (item.fullTank ? '<span class="badge-full">' + T('до полного') + '</span>' : '') +
            corporateBadge +
          '</div>' +
          '<div class="fuel-actions">' +
            '<button class="mini-btn" type="button" data-edit="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Изменить заправку')) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>' +
            '</button>' +
            '<button class="mini-btn mini-danger" type="button" data-delete="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Удалить заправку')) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-body">' +
          '<div class="log-station-block">' +
            station +
            '<div class="fuel-meta">' +
              '<span>' + escapeHtml(C.formatMoney(item.pricePerLiter)) + T('/л') + '</span>' +
              '<span>' + escapeHtml(C.formatNumber(item.odometer, 0)) + ' ' + T('км') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="log-amounts">' +
            '<span class="log-litres" aria-label="' + escapeHtml(C.formatNumber(item.liters, 2) + ' ' + T('литров')) + '">' +
              '<strong>' + escapeHtml(C.formatNumber(item.liters, 2)) + '</strong><span>' + T('л') + '</span>' +
            '</span>' +
            '<strong class="fuel-total">' + escapeHtml(C.formatMoney(item.total)) + '</strong>' +
          '</div>' +
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
      '<div class="summary-item"><span class="summary-label">Записей</span><span class="summary-value" data-i18n-ignore>' + records.length + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">Литров</span><span class="summary-value" data-i18n-ignore>' + escapeHtml(C.formatNumber(stats.totalLiters, 1)) + ' ' + T('л') + '</span></div>' +
      '<div class="summary-item"><span class="summary-label">Потрачено</span><span class="summary-value" data-i18n-ignore>' + escapeHtml(C.formatMoney(stats.totalSpent)) + '</span></div>';

    el.historyList.innerHTML = records.length
      ? records.map(fuelCardHtml).join('')
      : emptyStateHtml(
          T('Журнал пуст'),
          T('Здесь будут все заправки. Начните с первой — это займёт меньше минуты.'),
          true
        );
    applyTranslations();
  }

  function maintenanceEmptyStateHtml() {
    return (
      '<div class="empty-state">' +
        '<div class="empty-state-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' +
          '</svg>' +
        '</div>' +
        '<strong>Обслуживания пока нет</strong>' +
        '<span>Записывайте ремонт, замену масла, шиномонтаж и другие события — расходы будут считаться отдельно от топлива.</span>' +
        '<button class="secondary-btn" type="button" data-action="add-maintenance">Добавить запись</button>' +
      '</div>'
    );
  }

  function renderMaintenance() {
    if (!el.maintenanceList) {
      return;
    }
    var allRecords = getMaintenances();
    var records = C.sortedMaintenanceByDateDesc(allRecords);
    var stats = C.calculateMaintenanceStats(allRecords);

    el.maintenanceTotalAll.textContent = C.formatMoney(stats.totalCost);
    if (stats.recordsCount > 0) {
      el.maintenanceSummaryMeta.textContent =
        countLabel(stats.recordsCount, 'record') +
        T(' · запчасти ') + C.formatMoney(stats.totalParts) +
        T(' · работы ') + C.formatMoney(stats.totalLabor);
    } else {
      el.maintenanceSummaryMeta.textContent = T('пока нет записей');
    }

    if (!records.length) {
      el.maintenanceList.innerHTML = maintenanceEmptyStateHtml();
      applyTranslations();
      return;
    }

    el.maintenanceList.innerHTML = records.map(function (item) {
      var total = C.maintenanceTotal(item);
      var parts = Number.isFinite(item.partsCost) ? item.partsCost : 0;
      var labor = Number.isFinite(item.laborCost) ? item.laborCost : 0;
      var meta = [];

      if (parts > 0) {
        meta.push(T('запчасти ') + C.formatMoney(parts));
      }
      if (labor > 0) {
        meta.push(T('работы ') + C.formatMoney(labor));
      }
      if (!meta.length) {
        meta.push(T('без затрат'));
      }
      meta.push(C.formatNumber(item.odometer, 0) + ' ' + T('км'));

      return '<article class="fuel-card log-card service-card" data-card-id="' + escapeHtml(item.id) + '">' +
        '<div class="log-top">' +
          '<time class="log-date" datetime="' + escapeHtml(item.date) + '" title="' + escapeHtml(formatDate(item.date)) + '">' +
            escapeHtml(formatDate(item.date, true)) +
          '</time>' +
          '<div class="log-badges"><span class="badge-service">Сервис</span></div>' +
          '<div class="fuel-actions">' +
            '<button class="mini-btn" type="button" data-maintenance-edit="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Изменить запись обслуживания')) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
            '</button>' +
            '<button class="mini-btn mini-danger" type="button" data-maintenance-delete="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Удалить запись обслуживания')) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-body">' +
          '<div class="log-station-block">' +
            '<span class="fuel-station" dir="auto" data-i18n-ignore>' + escapeHtml(item.title) + '</span>' +
            '<div class="fuel-meta">' +
              meta.map(function (part) { return '<span>' + escapeHtml(part) + '</span>'; }).join('') +
            '</div>' +
          '</div>' +
          '<div class="log-amounts">' +
            '<strong class="fuel-total">' + C.formatMoney(total) + '</strong>' +
          '</div>' +
        '</div>' +
        attachmentPreviewHtml(item) +
        (item.note ? '<p class="fuel-note log-note" dir="auto" data-i18n-ignore>' + escapeHtml(item.note).replace(/\n/g, '<br>') + '</p>' : '') +
      '</article>';
    }).join('');
    applyTranslations();
  }

  /* ── Графики ───────────────────────────────────────────── */

  function renderCharts() {
    var stats = getStats();

    Charts.renderConsumption(el.consumptionChart, stats.segments);
    el.consumptionBadge.textContent = stats.averageConsumption !== null
      ? C.formatNumber(stats.averageConsumption, 1) + ' ' + T('л/100')
      : T('нет данных');

    var series = C.monthlyExpenseSeries(getFuelings(), 6, new Date());
    Charts.renderExpenses(el.expensesChart, series);
    var total = series.reduce(function (sum, item) { return sum + item.total; }, 0);
    el.expensesBadge.textContent = total > 0 ? C.formatMoney(total) : T('нет данных');
    applyTranslations();
  }

  /* ── Статистика за период и по АЗС ─────────────────────── */

  function periodText(period) {
    if (period === 'month') {
      return T('за этот месяц');
    }
    if (period === 'prev-month') {
      return T('за прошлый месяц');
    }
    if (period === 'year') {
      return T('за этот год');
    }
    if (period === 'last30') {
      return T('за последние 30 дней');
    }
    return T('за всё время');
  }

  function stationHighlightHtml(label, station, value, tone) {
    return (
      '<div class="station-highlight ' + tone + '">' +
        '<span class="station-highlight-label">' + escapeHtml(label) + '</span>' +
        '<strong class="station-highlight-name" data-i18n-ignore>' + escapeHtml(T(station.name)) + '</strong>' +
        '<span class="station-highlight-value" data-i18n-ignore>' + escapeHtml(value) + '</span>' +
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
        countLabel(summary.recordsCount, 'fillup'),
        C.formatNumber(summary.totalLiters, 1) + ' ' + T('л')
      ];
      if (summary.averagePrice !== null) {
        meta.push(T('средняя ') + C.formatMoney(summary.averagePrice) + T('/л'));
      }
      el.statsMeta.textContent = meta.join(' · ');
    } else {
      el.statsMeta.textContent = T('За выбранный период заправок пока нет.');
    }

    if (!stationStats.recordsCount) {
      el.stationHighlights.innerHTML = '';
      el.stationList.innerHTML = '<p class="stats-empty">Добавьте заправку и укажите АЗС — здесь появится сравнение.</p>';
      applyTranslations();
      return;
    }

    var topVisits = stationStats.topByVisits;
    var topSpent = stationStats.topBySpent;

    el.stationHighlights.innerHTML =
      stationHighlightHtml(
        T('Чаще всего'),
        topVisits,
        countLabel(topVisits.count, 'fillup'),
        'is-visits'
      ) +
      stationHighlightHtml(
        T('Больше расходов'),
        topSpent,
        C.formatMoney(topSpent.total),
        'is-spent'
      );

    var maxSpent = stationStats.stations.reduce(function (max, station) {
      return Math.max(max, station.total);
    }, 0);

    el.stationList.innerHTML =
      '<div class="station-list-head"><span>' + T('Все АЗС') + '</span><span>' + T('Потрачено') + '</span></div>' +
      stationStats.stations.map(function (station) {
        var width = maxSpent > 0
          ? Math.max(4, Math.round((station.total / maxSpent) * 100))
          : 0;
        return (
          '<div class="station-row">' +
            '<div class="station-row-top">' +
              '<span class="station-name" data-i18n-ignore>' + escapeHtml(T(station.name)) + '</span>' +
              '<span class="station-total" data-i18n-ignore>' + escapeHtml(C.formatMoney(station.total)) + '</span>' +
            '</div>' +
            '<div class="station-meter" aria-hidden="true"><span style="width:' + width + '%"></span></div>' +
            '<div class="station-meta">' +
              '<span>' + countLabel(station.count, 'fillup') + '</span>' +
              '<span>' + escapeHtml(C.formatNumber(station.liters, 1)) + ' ' + T('л') + '</span>' +
              (station.averagePrice !== null
                ? '<span>' + escapeHtml(C.formatMoney(station.averagePrice)) + T('/л') + '</span>'
                : '') +
            '</div>' +
          '</div>'
        );
      }).join('');
    applyTranslations();
  }

  /* ── Настройки ─────────────────────────────────────────── */

  function snapshotReasonText(reason) {
    if (reason === 'before-import') {
      return T('перед импортом');
    }
    if (reason === 'before-clear') {
      return T('перед удалением данных');
    }
    return T('страховочная копия');
  }

  function formatSnapshotDate(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return T('неизвестное время');
    }
    try {
      return new Intl.DateTimeFormat(appLocale(), {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      return date.toLocaleString(appLocale());
    }
  }

  function renderSettings() {
    var profile = activeProfile();
    el.settingsProfileName.value = displayProfileName(profile.name);
    el.settingsOdometer.value = profile.initialOdometer !== null
      ? String(Math.round(profile.initialOdometer))
      : '';

    var info = S.storageInfo();
    var count = countRecordsForProfile(profile);
    var total = countAllRecords(state);
    el.storageInfo.textContent = info.available
      ? T('В этом автомобиле: ') + countLabel(count, 'record') +
        T(' · всего: ') + total + ' · ' + countLabel(state.profiles.length, 'car') +
        ' · ' + formatBytes(info.bytes)
      : T('Локальное хранилище недоступно в этом браузере.');

    if (el.snapshotInfo && el.restoreSnapshotBtn) {
      var snapshot = null;
      var snapshotError = false;
      try {
        snapshot = S.readSnapshot();
      } catch (error) {
        snapshotError = true;
      }

      if (snapshot) {
        var snapshotCount = countAllRecords(snapshot.state);
        el.restoreSnapshotBtn.hidden = false;
        el.snapshotInfo.textContent = T('Последняя копия: ') +
          formatSnapshotDate(snapshot.createdAt) + ', ' +
          snapshotReasonText(snapshot.reason) + ' · ' +
          countLabel(snapshotCount, 'record') + '.';
      } else {
        el.restoreSnapshotBtn.hidden = true;
        el.snapshotInfo.textContent = snapshotError
          ? T('Страховочную копию не удалось прочитать.')
          : T('Страховочная копия создаётся автоматически перед импортом или удалением всех данных.');
      }
    }
  }

  function bindSettings() {
    el.settingsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      el.settingsError.textContent = '';

      var name = el.settingsProfileName.value.trim();
      var currentName = activeProfile().name;
      if (isDefaultProfileName(currentName) && name === T('Моя машина')) {
        name = currentName;
      }
      if (!name) {
        el.settingsError.textContent = T('Введите название автомобиля.');
        el.settingsProfileName.focus();
        return;
      }

      var raw = el.settingsOdometer.value.trim();
      var value = raw === '' ? null : C.parseNumber(raw);

      if (raw !== '' && (value === null || value < 0)) {
        el.settingsError.textContent = T('Введите пробег числом, например 130000.');
        el.settingsOdometer.focus();
        return;
      }

      var next = cloneState(state);
      var nextProfile = activeProfileIn(next);
      nextProfile.name = name.slice(0, 40);
      nextProfile.initialOdometer = value === null ? null : Math.round(value);
      nextProfile.updatedAt = new Date().toISOString();

      if (!commitState(next, T('Настройки не сохранены'))) {
        return;
      }
      renderAll();
      showToast(T('Автомобиль сохранён'));
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
        showToast(T('Файл ') + filename + T(' сохранён'));
      } catch (error) {
        showToast(T('Не удалось создать файл резервной копии.'), 'error');
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

    if (file.size > 50 * 1024 * 1024) {
      showToast(T('Файл слишком большой для резервной копии.'), 'error');
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

      var importedCount = countAllRecords(imported);
      return askConfirm({
        title: T('Импортировать данные?'),
        message: T('Будет загружено ') + countLabel(imported.profiles.length, 'car') +
          T(' и ') + countLabel(importedCount, 'record') +
          T('. Текущие данные (') + countAllRecords(state) + T(') будут заменены. ') +
          T('Перед импортом автоматически создаётся страховочная копия.'),
        confirmLabel: T('Импортировать'),
        focusFallback: function () {
          return el.exportBtn;
        }
      }).then(function (confirmed) {
        if (!confirmed) {
          return;
        }

        if (!S.createSnapshot(state, 'before-import')) {
          showToast(T('Импорт отменён. ') +
            (S.lastError || T('Не удалось создать страховочную копию.')), 'error');
          return;
        }
        renderSettings();

        if (!commitState(imported, T('Импорт отменён. Текущие данные не изменены'))) {
          return;
        }
        renderAll();
        showToast(T('Импортировано ') + countLabel(importedCount, 'record') +
          T('. Страховочная копия сохранена.'));
      });
    }).catch(function () {
      showToast(T('Не удалось прочитать файл.'), 'error');
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
      title: T('Удалить все данные?'),
      message: T('Все автомобили, заправки, обслуживание и настройки будут удалены с этого устройства. Перед удалением автоматически создаётся страховочная копия — её можно будет восстановить.'),
      confirmLabel: T('Удалить всё')
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }

      if (!S.createSnapshot(state, 'before-clear')) {
        showToast(T('Удаление отменено. ') +
          (S.lastError || T('Не удалось создать страховочную копию.')), 'error');
        return;
      }
      renderSettings();

      if (!commitState(S.defaultState(), T('Удаление отменено. Данные не изменены'))) {
        return;
      }
      renderAll();
      showToast(T('Все данные удалены. Страховочная копия сохранена.'));
    });
  }

  function requestRestoreSnapshot() {
    var snapshot;
    try {
      snapshot = S.readSnapshot();
    } catch (error) {
      showToast(S.lastError || T('Не удалось прочитать страховочную копию.'), 'error');
      return;
    }
    if (!snapshot) {
      showToast(T('Страховочная копия не найдена.'), 'error');
      return;
    }

    var count = countFuelings(snapshot.state);
    askConfirm({
      title: T('Восстановить страховочную копию?'),
      message: T('Будут восстановлены данные на ') + formatSnapshotDate(snapshot.createdAt) +
        ' (' + countLabel(count, 'record') + '). ' +
        T('Текущие данные будут заменены.'),
      confirmLabel: T('Восстановить')
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }

      var restored = S.restoreSnapshot();
      if (!restored) {
        showToast(T('Не удалось восстановить копию. ') +
          (S.lastError || T('Данные не изменены.')), 'error');
        return;
      }
      state = restored.state;
      renderAll();
      showToast(T('Данные восстановлены из страховочной копии'));
    });
  }

  /* ── Форма заправки ────────────────────────────────────── */

  function previousOdometerForForm() {
    var record = C.findPreviousRecord(getFuelings(), el.fuelDate.value, editingId);
    if (record) {
      return record.odometer;
    }
    return activeProfile().initialOdometer;
  }

  function updateOdometerAssist() {
    if (!el.odometerAssist) {
      return;
    }
    var raw = el.fuelOdometer.value.replace(/\D/g, '');
    var entered = C.parseNumber(raw);
    var previous = previousOdometerForForm();
    var previousRecord = C.findPreviousRecord(getFuelings(), el.fuelDate.value, editingId);
    var suggestion = C.proposeOdometer(raw, previous);
    odometerSuggestion = suggestion;

    if (!editingId && odometerPrefilled && raw) {
      el.odometerAssist.hidden = false;
      el.odometerAssist.classList.add('is-warning');
      el.odometerAssistText.textContent = previousRecord
        ? T('Подставлен пробег прошлой заправки (') + C.formatNumber(previousRecord.odometer, 0) +
          T(' км). Замените его новым значением.')
        : T('Пробег подставлен автоматически. Проверьте и укажите новое значение.');
      el.odometerAssistAction.hidden = true;
      return;
    }

    if (suggestion !== null && suggestion !== entered) {
      el.odometerAssist.hidden = false;
      el.odometerAssist.classList.remove('is-warning');
      el.odometerAssistText.textContent =
        T('Похоже, полный пробег: ') + C.formatNumber(suggestion, 0) + T(' км.');
      el.odometerAssistAction.hidden = false;
      return;
    }

    if (!editingId && previousRecord && entered !== null &&
        Math.round(entered) === Math.round(previousRecord.odometer)) {
      el.odometerAssist.hidden = false;
      el.odometerAssist.classList.add('is-warning');
      el.odometerAssistText.textContent =
        T('Пробег совпадает с предыдущей записью. Возможно, вы забыли его обновить.');
      el.odometerAssistAction.hidden = true;
      return;
    }

    if (raw.length >= 4 && previous !== null && entered !== null && entered < previous) {
      el.odometerAssist.hidden = false;
      el.odometerAssist.classList.add('is-warning');
      el.odometerAssistText.textContent =
        T('Меньше предыдущей записи (') + C.formatNumber(previous, 0) +
        T(' км). Можно сохранить, если исправляете ошибку.');
      el.odometerAssistAction.hidden = true;
      return;
    }

    el.odometerAssist.hidden = true;
    el.odometerAssist.classList.remove('is-warning');
    el.odometerAssistText.textContent = '';
    el.odometerAssistAction.hidden = true;
  }

  function applyOdometerSuggestion() {
    if (odometerSuggestion === null) {
      return;
    }
    el.fuelOdometer.value = String(odometerSuggestion);
    odometerPrefilled = false;
    clearFieldError(el.fuelOdometer);
    el.formError.textContent = '';
    updateOdometerAssist();
  }

  function applyRememberedFuelPrice() {
    if (!el.fuelType) {
      return;
    }
    var fuelType = C.normalizeFuelType(el.fuelType.value);
    var price = C.lastPriceForFuelType(activeProfile().lastFuelPrices, fuelType);

    el.fuelPrice.value = price === null ? '' : C.formatAmount(price, 2);
    calcState.pricePerLiter = price;
    calcState.lastPriceField = 'price';
    fuelPriceTouched = false;
    fuelPriceAutoFilled = price !== null;
    clearFieldError(el.fuelPrice);

    if (price === null) {
      updateCalcHint({
        liters: calcState.liters,
        pricePerLiter: null,
        total: calcState.total,
        derivedField: null
      });
      return;
    }

    var result = C.recalculate(calcState);
    calcState.liters = result.liters;
    calcState.pricePerLiter = result.pricePerLiter;
    calcState.total = result.total;
    if (result.derivedField === 'total') {
      el.fuelTotal.value = result.total === null ? '' : C.formatAmount(result.total, 2);
    }
    el.formError.textContent = '';
    updateCalcHint(result);
  }

  function openForm(id, opener) {
    var record = null;
    editingId = id || null;

    if (editingId) {
      record = findFueling(editingId);
      if (!record) {
        showToast(T('Заправка не найдена.'), 'error');
        editingId = null;
        return;
      }
    }

    resetOcrSession();
    el.ocrCard.hidden = Boolean(record);
    clearFormErrors();
    el.formError.textContent = '';

    if (record) {
      el.sheetTitle.textContent = T('Изменить заправку');
      el.fuelSubmit.textContent = T('Сохранить изменения');
      el.fuelDelete.hidden = false;
      el.fuelDate.value = record.date;
      el.fuelOdometer.value = C.formatNumber(record.odometer, 0);
      odometerPrefilled = false;
      el.fuelType.value = C.normalizeFuelType(record.fuelType);
      lastSelectedFuelType = C.normalizeFuelType(record.fuelType);
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
      el.fuelCorporate.checked = record.corporate === true;
      fuelPriceTouched = false;
      fuelPriceAutoFilled = false;
      calcState = {
        liters: record.liters,
        pricePerLiter: record.pricePerLiter,
        total: record.total,
        lastPriceField: record.lastPriceField === 'total' ? 'total' : 'price'
      };
    } else {
      var stats = getStats();
      el.sheetTitle.textContent = T('Новая заправка');
      el.fuelSubmit.textContent = T('Сохранить заправку');
      el.fuelDelete.hidden = true;
      el.fuelDate.value = todayIso();
      el.fuelOdometer.value = stats.currentOdometer !== null
        ? String(Math.round(stats.currentOdometer))
        : '';
      odometerPrefilled = Boolean(el.fuelOdometer.value);
      el.fuelType.value = '';
      lastSelectedFuelType = '';
      el.fuelLiters.value = '';
      el.fuelPrice.value = '';
      el.fuelTotal.value = '';
      el.fuelStation.value = '';
      el.fuelStationOther.value = '';
      toggleStationOther();
      el.fuelNote.value = '';
      el.fuelFull.checked = true;
      el.fuelCorporate.checked = false;
      fuelPriceTouched = false;
      fuelPriceAutoFilled = false;
      calcState = {
        liters: null,
        pricePerLiter: null,
        total: null,
        lastPriceField: null
      };
    }

    updateCalcHint(C.recalculate(calcState));
    updateOdometerAssist();
    el.form.scrollTop = 0;
    document.querySelector('.fuel-form').scrollTop = 0;
    fuelFormOpener = opener || (
      document.activeElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null
    );
    el.sheet.classList.add('is-open');
    el.sheet.setAttribute('aria-hidden', 'false');

    if (Focus && Focus.openDialog) {
      var formOpener = fuelFormOpener;
      Focus.openDialog(el.sheet, {
        opener: formOpener,
        initialFocus: el.sheetClose,
        fallback: function () {
          return fuelFormFallbackTarget(formOpener);
        }
      });
    } else {
      el.sheet.inert = false;
      document.body.classList.add('sheet-open');
      if (el.app) {
        el.app.inert = true;
      }
      el.sheetClose.focus();
    }
  }

  function findVisibleControl(attribute, value) {
    var nodes = document.querySelectorAll('[' + attribute + ']');
    for (var index = 0; index < nodes.length; index += 1) {
      if (
        nodes[index].getAttribute(attribute) === value &&
        Focus && Focus.isFocusable(nodes[index])
      ) {
        return nodes[index];
      }
    }
    return null;
  }

  function findFirstVisible(selector, root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll(selector);
    for (var index = 0; index < nodes.length; index += 1) {
      if (Focus && Focus.isFocusable(nodes[index])) {
        return nodes[index];
      }
    }
    return null;
  }

  function fuelFormFallbackTarget(opener) {
    var editId = opener && opener.getAttribute
      ? opener.getAttribute('data-edit')
      : null;
    var replacement = editId ? findVisibleControl('data-edit', editId) : null;
    return replacement || findVisibleControl('data-action', 'add');
  }

  function closeForm() {
    var opener = fuelFormOpener;
    fuelFormOpener = null;
    editingId = null;
    odometerSuggestion = null;
    odometerPrefilled = false;
    lastSelectedFuelType = '';
    fuelPriceTouched = false;
    fuelPriceAutoFilled = false;
    if (el.odometerAssist) {
      el.odometerAssist.hidden = true;
      el.odometerAssist.classList.remove('is-warning');
      el.odometerAssistText.textContent = '';
      el.odometerAssistAction.hidden = true;
    }
    el.formError.textContent = '';
    clearFormErrors();
    resetOcrSession();

    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.sheet);
    } else {
      if (el.app) {
        el.app.inert = false;
      }
      document.body.classList.remove('sheet-open');
      if (opener && typeof opener.focus === 'function') {
        opener.focus();
      }
    }
    el.sheet.classList.remove('is-open');
    el.sheet.setAttribute('aria-hidden', 'true');
    el.sheet.inert = true;
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
      hint.textContent = T('Сумма рассчитана: ') +
        C.formatNumber(result.liters, 2) + T(' л × ') +
        C.formatAmount(result.pricePerLiter, 2) + ' ₪ = ' +
        C.formatMoney(result.total);
      hint.classList.add('is-calculated');
      return;
    }

    if (result.derivedField === 'price' && result.total !== null && result.liters) {
      hint.textContent = T('Цена за литр рассчитана: ') +
        C.formatMoney(result.total) + T(' ÷ ') +
        C.formatNumber(result.liters, 2) + T(' л');
      hint.classList.add('is-calculated');
      return;
    }

    if (result.liters === null || result.liters <= 0) {
      hint.textContent = T('Сначала укажите количество литров — без него пересчёт невозможен.');
      return;
    }

    hint.textContent = T('Введите литры и одно из полей цены — второе заполнится автоматически.');
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
        fuelPriceTouched = true;
        fuelPriceAutoFilled = false;
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

    el.fuelType.addEventListener('change', function () {
      clearFieldError(el.fuelType);
      el.formError.textContent = '';
      var previousType = lastSelectedFuelType;
      var nextType = C.normalizeFuelType(el.fuelType.value);
      lastSelectedFuelType = nextType;
      // В старых записях цену не меняем автоматически
      if (editingId) {
        return;
      }
      if (!nextType) {
        el.fuelPrice.value = '';
        calcState.pricePerLiter = null;
        calcState.lastPriceField = 'price';
        fuelPriceTouched = false;
        fuelPriceAutoFilled = false;
        clearFieldError(el.fuelPrice);
        updateCalcHint({
          liters: calcState.liters,
          pricePerLiter: null,
          total: calcState.total,
          derivedField: null
        });
        return;
      }
      // Всегда подставляем последнюю цену ТОЛЬКО для выбранного вида топлива
      applyRememberedFuelPrice();
    });

    el.fuelCorporate.addEventListener('change', function () {
      el.formError.textContent = '';
    });

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
      odometerPrefilled = false;
      clearFieldError(el.fuelOdometer);
      el.formError.textContent = '';
      updateOdometerAssist();
    });

    el.fuelDate.addEventListener('input', function () {
      clearFieldError(el.fuelDate);
      el.formError.textContent = '';
      updateOdometerAssist();
    });

    el.odometerAssistAction.addEventListener('click', applyOdometerSuggestion);

    el.sheetClose.addEventListener('click', closeForm);
    el.form.addEventListener('submit', handleFormSubmit);
    el.fuelDelete.addEventListener('click', function () {
      if (editingId) {
        requestDelete(editingId, true);
      }
    });
  }

  /* ── Распознавание данных заправки по фото ─────────────── */

  var OCR_STAGES = {
    preparing: [0, 4],
    'loading tesseract core': [4, 18],
    'initializing tesseract': [18, 24],
    'loading language traineddata': [24, 38],
    'initializing api': [38, 48],
    'recognizing text': [48, 100]
  };

  var OCR_STAGE_LABELS = {
    preparing: 'Готовим фото…',
    'loading tesseract core': 'Загружаем локальный движок…',
    'initializing tesseract': 'Запускаем распознавание…',
    'loading language traineddata': 'Загружаем языковые данные…',
    'initializing api': 'Настраиваем распознавание…',
    'recognizing text': 'Читаем текст на фото…'
  };

  function bindOcr() {
    if (!el.ocrCard) {
      return;
    }

    if (!Ocr) {
      setOcrBusy(true);
      setOcrStatus(T('Распознавание недоступно. Введите данные вручную.'), 'error');
      return;
    }

    el.ocrCameraBtn.addEventListener('click', function () {
      ocrReviewOpener = el.ocrCameraBtn;
      el.ocrCameraInput.click();
    });
    el.ocrGalleryBtn.addEventListener('click', function () {
      ocrReviewOpener = el.ocrGalleryBtn;
      el.ocrGalleryInput.click();
    });

    [el.ocrCameraInput, el.ocrGalleryInput].forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) {
          handleOcrFile(file);
        }
      });
    });

    el.ocrPreviewRemove.addEventListener('click', function () {
      resetOcrPreview();
      showToast(T('Фото убрано. Можно выбрать другое или заполнить форму вручную.'));
    });

    el.ocrReviewClose.addEventListener('click', function () {
      closeOcrReview('scan');
    });
    el.ocrReviewManual.addEventListener('click', function () {
      closeOcrReview('manual');
    });
    el.ocrReviewApply.addEventListener('click', applyOcrValues);
    el.ocrReviewModal.addEventListener('click', function (event) {
      if (event.target === el.ocrReviewModal) {
        closeOcrReview('scan');
      }
    });

    [el.ocrReviewLiters, el.ocrReviewPrice, el.ocrReviewTotal].forEach(function (input) {
      input.addEventListener('input', function () {
        sanitizeNumericInput(input);
        el.ocrReviewError.textContent = '';
      });
    });
  }

  function setOcrBusy(isBusy) {
    if (!el.ocrCard) {
      return;
    }
    el.ocrCard.classList.toggle('is-busy', isBusy);
    el.ocrCard.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    el.ocrCameraBtn.disabled = isBusy;
    el.ocrGalleryBtn.disabled = isBusy;
    el.ocrPreviewRemove.disabled = isBusy;
  }

  function setOcrStatus(message, tone) {
    if (!el.ocrStatus) {
      return;
    }
    el.ocrStatus.textContent = T(message);
    el.ocrStatus.classList.toggle('is-working', tone === 'working');
    el.ocrStatus.classList.toggle('is-error', tone === 'error');
  }

  function setOcrProgress(percent) {
    if (!el.ocrProgress) {
      return;
    }
    if (percent === null || typeof percent === 'undefined') {
      el.ocrProgress.hidden = true;
      el.ocrProgressBar.style.width = '0%';
      return;
    }
    var clamped = Math.max(0, Math.min(100, percent));
    el.ocrProgress.hidden = false;
    el.ocrProgressBar.style.width = clamped.toFixed(1) + '%';
  }

  function updateOcrProgress(payload) {
    var status = payload && payload.status ? payload.status : '';
    var progress = payload && typeof payload.progress === 'number' ? payload.progress : 0;
    var stageProgress = Math.max(0, Math.min(1, progress));
    var range = OCR_STAGES[status];
    var percent = range
      ? range[0] + (range[1] - range[0]) * stageProgress
      : stageProgress * 100;

    setOcrProgress(percent);

    var label = T(OCR_STAGE_LABELS[status] || 'Распознаём фото…');
    if (status === 'recognizing text') {
      label += ' ' + Math.round(stageProgress * 100) + '%';
    }
    setOcrStatus(label, 'working');
  }

  function showOcrPhoto(file) {
    if (ocrObjectUrl) {
      URL.revokeObjectURL(ocrObjectUrl);
    }
    ocrObjectUrl = URL.createObjectURL(file);
    el.ocrPreviewImage.src = ocrObjectUrl;
    el.ocrFileName.textContent = file.name || T('Фото');
    el.ocrPreview.hidden = false;
  }

  function resetOcrPreview() {
    ocrRequestToken += 1;
    if (ocrObjectUrl) {
      URL.revokeObjectURL(ocrObjectUrl);
      ocrObjectUrl = null;
    }
    el.ocrPreviewImage.removeAttribute('src');
    el.ocrReviewImage.removeAttribute('src');
    el.ocrPreview.hidden = true;
    setOcrBusy(false);
    setOcrProgress(null);
    setOcrStatus(OCR_DEFAULT_STATUS, '');
  }

  function resetOcrSession() {
    ocrRequestToken += 1;
    resetOcrPreview();
    ocrReviewResult = null;
    ocrReviewOpener = null;
    if (el.ocrReviewModal) {
      if (Focus && Focus.closeDialog) {
        Focus.closeDialog(el.ocrReviewModal, { restore: false });
      }
      el.ocrReviewModal.hidden = true;
    }
    if (el.ocrReviewError) {
      el.ocrReviewError.textContent = '';
    }
    if (el.ocrCameraInput) {
      el.ocrCameraInput.value = '';
    }
    if (el.ocrGalleryInput) {
      el.ocrGalleryInput.value = '';
    }
  }

  function handleOcrFile(file) {
    var token = ocrRequestToken + 1;
    ocrRequestToken = token;

    showOcrPhoto(file);
    setOcrBusy(true);
    setOcrProgress(2);
    setOcrStatus('Готовим фото…', 'working');
    el.ocrReviewError.textContent = '';

    try {
      Ocr.validateImageFile(file);
    } catch (error) {
      handleOcrError(error, token);
      return;
    }

    Ocr.recognizeImage(file, {
      onProgress: function (payload) {
        if (token === ocrRequestToken) {
          updateOcrProgress(payload);
        }
      }
    }).then(function (result) {
      if (token !== ocrRequestToken) {
        return;
      }

      setOcrBusy(false);
      setOcrProgress(null);

      var parsed = result.parsed || {};
      var hasAnyValue = parsed.liters !== null ||
        parsed.pricePerLiter !== null ||
        parsed.total !== null;

      if (!hasAnyValue) {
        setOcrStatus(T('Не удалось найти числа на фото. Сфотографируйте ближе, ровнее или введите данные вручную.'), 'error');
        showToast(T('Распознать числа не удалось. Ручной ввод ниже.'), 'error');
        return;
      }

      setOcrStatus('Числа распознаны. Проверьте их перед переносом в форму.', 'working');
      openOcrReview(result);
    }).catch(function (error) {
      handleOcrError(error, token);
    });
  }

  function ocrErrorMessage(error) {
    var code = error && error.code;
    if (code === 'too_large') {
      return T('Фото больше 20 МБ. Выберите файл поменьше.');
    }
    if (code === 'not_image') {
      return T('Это не изображение. Выберите фото чека или табло.');
    }
    if (code === 'unsupported_image') {
      return T('Формат HEIC пока не поддерживается. Сделайте обычное фото в JPEG.');
    }
    if (code === 'ocr_unavailable') {
      return T('Локальный движок распознавания не загрузился. Введите данные вручную.');
    }
    if (code === 'image_error' || code === 'canvas_error') {
      return T('Не удалось открыть фото. Попробуйте другой файл или введите данные вручную.');
    }
    return T('Не удалось распознать фото. Введите данные вручную — форма доступна.');
  }

  function handleOcrError(error, token) {
    if (token !== ocrRequestToken) {
      return;
    }
    setOcrBusy(false);
    setOcrProgress(null);
    setOcrStatus(ocrErrorMessage(error), 'error');
    showToast(T('Распознавание не удалось. Можно ввести данные вручную.'), 'error');
  }

  function openOcrReview(result) {
    var parsed = result.parsed || {};
    var confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    var label = 'Низкая уверенность';
    var tone = 'is-low';

    if (confidence >= 0.75) {
      label = 'Высокая уверенность';
      tone = '';
    } else if (confidence >= 0.5) {
      label = 'Средняя уверенность';
      tone = 'is-medium';
    }

    el.ocrReviewLiters.value = parsed.liters === null ? '' : C.formatAmount(parsed.liters, 2);
    el.ocrReviewPrice.value = parsed.pricePerLiter === null ? '' : C.formatAmount(parsed.pricePerLiter, 2);
    el.ocrReviewTotal.value = parsed.total === null ? '' : C.formatAmount(parsed.total, 2);
    el.ocrReviewConfidence.textContent = T(label) + T(' · проверьте числа');
    el.ocrReviewConfidence.className = 'ocr-review-badge' + (tone ? ' ' + tone : '');
    el.ocrRawText.textContent = result.text && result.text.trim()
      ? result.text.trim()
      : T('Текст не распознан.');
    el.ocrReviewImage.src = ocrObjectUrl || '';
    el.ocrReviewImage.hidden = !ocrObjectUrl;
    el.ocrReviewError.textContent = '';
    ocrReviewResult = result;

    el.ocrReviewModal.hidden = false;

    if (Focus && Focus.openDialog) {
      var opener = ocrReviewOpener;
      Focus.openDialog(el.ocrReviewModal, {
        opener: opener,
        initialFocus: el.ocrReviewLiters,
        fallback: function () {
          return opener || el.ocrCameraBtn;
        }
      });
      el.ocrReviewLiters.select();
    } else {
      el.sheet.inert = true;
      document.body.classList.add('modal-open');
      el.ocrReviewLiters.focus();
      el.ocrReviewLiters.select();
    }
  }

  function closeOcrReview(focusTarget) {
    if (!el.ocrReviewModal || el.ocrReviewModal.hidden) {
      return;
    }

    if (document.activeElement && el.ocrReviewModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    el.ocrReviewError.textContent = '';
    ocrReviewResult = null;

    var opener = ocrReviewOpener;
    ocrReviewOpener = null;
    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.ocrReviewModal, { restore: false });
    } else {
      if (el.sheet && el.sheet.classList.contains('is-open')) {
        el.sheet.inert = false;
      }
      document.body.classList.remove('modal-open');
    }
    el.ocrReviewModal.hidden = true;

    if (focusTarget === 'manual') {
      el.fuelLiters.focus();
      showToast(T('Заполните форму вручную и нажмите «Сохранить заправку».'));
    } else if (focusTarget === 'scan') {
      if (Focus && Focus.restoreFocus) {
        Focus.restoreFocus(opener, function () {
          return el.ocrCameraBtn;
        });
      } else {
        el.ocrCameraBtn.focus();
      }
    }
  }

  function valuesAreClose(left, right) {
    if (left === null || right === null) {
      return false;
    }
    return Math.abs(left - right) < 0.005;
  }

  function applyOcrValues() {
    var liters = C.parseNumber(el.ocrReviewLiters.value);
    var price = C.parseNumber(el.ocrReviewPrice.value);
    var total = C.parseNumber(el.ocrReviewTotal.value);

    if (price !== null && price <= 0) {
      price = null;
    }
    if (total !== null && total <= 0) {
      total = null;
    }

    if (liters === null || liters <= 0) {
      el.ocrReviewError.textContent = T('Укажите количество литров больше нуля.');
      el.ocrReviewLiters.focus();
      return;
    }
    if (price === null && total === null) {
      el.ocrReviewError.textContent = T('Нужна цена за литр или общая сумма.');
      el.ocrReviewPrice.focus();
      return;
    }

    var original = ocrReviewResult && ocrReviewResult.parsed ? ocrReviewResult.parsed : null;
    var anchor = 'total';

    if (total === null) {
      anchor = 'price';
    } else if (original && price !== null && total !== null) {
      var totalChanged = !valuesAreClose(total, original.total);
      var priceChanged = !valuesAreClose(price, original.pricePerLiter);
      if (priceChanged && !totalChanged) {
        anchor = 'price';
      }
    }

    var result = C.recalculate({
      liters: liters,
      pricePerLiter: price,
      total: total,
      lastPriceField: anchor
    });

    if (
      result.liters === null ||
      result.pricePerLiter === null ||
      result.total === null ||
      !Number.isFinite(result.pricePerLiter) ||
      !Number.isFinite(result.total)
    ) {
      el.ocrReviewError.textContent = T('Не удалось рассчитать стоимость. Проверьте литры и цену.');
      return;
    }

    calcState = {
      liters: result.liters,
      pricePerLiter: result.pricePerLiter,
      total: result.total,
      lastPriceField: anchor
    };
    // Числа прошли экран проверки. Если цена была в распознанных данных,
    // считаем её подтверждённой пользователем, а не подставленной из памяти.
    fuelPriceTouched = price !== null;
    fuelPriceAutoFilled = false;

    el.fuelLiters.value = C.formatAmount(result.liters, 2);
    el.fuelPrice.value = C.formatAmount(result.pricePerLiter, 2);
    el.fuelTotal.value = C.formatAmount(result.total, 2);
    clearFormErrors();
    el.formError.textContent = '';
    updateCalcHint(result);
    closeOcrReview(null);
    setOcrStatus(T('Данные перенесены в форму. Проверьте их и нажмите «Сохранить заправку».'), '');
    showToast(T('Числа перенесены. Проверьте и нажмите «Сохранить заправку».'));

    window.setTimeout(function () {
      el.fuelLiters.focus();
    }, 50);
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    el.formError.textContent = '';
    clearFormErrors();

    var date = el.fuelDate.value;
    var odometerRaw = el.fuelOdometer.value.replace(/\D/g, '');
    var odometer = C.parseNumber(odometerRaw);
    var suggestedOdometer = C.proposeOdometer(odometerRaw, previousOdometerForForm());
    if (suggestedOdometer !== null) {
      odometer = suggestedOdometer;
      el.fuelOdometer.value = String(suggestedOdometer);
      odometerPrefilled = false;
    }
    var liters = calcState.liters;
    var price = calcState.pricePerLiter;
    var total = calcState.total;
    var fuelType = C.normalizeFuelType(el.fuelType.value);

    if (!date || !C.isValidDateString(date)) {
      return formError(T('Укажите дату заправки.'), el.fuelDate);
    }
    if (date > todayIso()) {
      return formError(T('Дата не может быть в будущем.'), el.fuelDate);
    }

    var existing = editingId ? findFueling(editingId) : null;
    if (!editingId) {
      var previousRecord = C.findPreviousRecord(getFuelings(), date, null);
      var odometerCheck = C.validateNewOdometer(odometer, {
        previousOdometer: previousRecord ? previousRecord.odometer : null,
        prefilled: odometerPrefilled
      });
      if (!odometerCheck.ok) {
        return formError(odometerCheck.message, el.fuelOdometer);
      }
    } else if (odometer === null || odometer <= 0) {
      return formError(T('Введите пробег одометра больше нуля.'), el.fuelOdometer);
    }

    if (!fuelType && (!existing || C.normalizeFuelType(existing.fuelType))) {
      return formError(T('Выберите тип топлива: солярку или бензин АИ-95.'), el.fuelType);
    }
    if (liters === null || liters <= 0) {
      return formError(T('Введите количество литров больше нуля.'), el.fuelLiters);
    }

    var result = C.recalculate({
      liters: liters,
      pricePerLiter: price,
      total: total,
      lastPriceField: calcState.lastPriceField
    });

    if (result.pricePerLiter === null && result.total === null) {
      return formError(T('Укажите цену за литр или общую сумму.'), el.fuelPrice);
    }

    // На всякий случай ещё раз проверяем, что после пересчёта нет NaN/Infinity.
    if (!Number.isFinite(result.pricePerLiter) || !Number.isFinite(result.total)) {
      return formError(T('Не удалось рассчитать стоимость. Проверьте литры и цену.'), el.fuelTotal);
    }

    var stationId = el.fuelStation.value;
    if (!C.stationName(stationId)) {
      stationId = '';
    }
    var station = stationId === 'other'
      ? (el.fuelStationOther.value.trim().slice(0, 80) || 'Другое')
      : (stationId ? C.stationName(stationId) : '');
    var note = el.fuelNote.value.trim();
    // Флажок нужен для цены через דלקן. Если её явно написали в заметке
    // или названии АЗС, тоже не запоминаем такую цену как личную.
    var corporate = el.fuelCorporate.checked || C.isCorporateFueling({
      station: station,
      note: note
    });

    var record = {
      id: existing ? existing.id : S.makeId(),
      date: date,
      odometer: Math.round(odometer),
      liters: result.liters,
      pricePerLiter: result.pricePerLiter,
      total: result.total,
      station: station,
      stationId: stationId,
      note: note,
      fullTank: el.fuelFull.checked,
      fuelType: fuelType,
      corporate: corporate,
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
        showToast(T('Заправка не найдена. Обновите список.'), 'error');
        return;
      }
      nextFuelings[index] = record;
    } else {
      nextFuelings.push(record);
    }
    nextProfile.updatedAt = new Date().toISOString();

    // Последнюю цену запоминаем только для своего топлива и только если
    // человек действительно ввёл/подтвердил её. Цена через דלקן не считается.
    if (fuelType && !corporate && fuelPriceTouched && result.pricePerLiter > 0) {
      nextProfile.lastFuelPrices = C.rememberLastFuelPrice(
        nextProfile.lastFuelPrices,
        fuelType,
        result.pricePerLiter
      );
    }

    if (!commitState(next, existing ? T('Изменения не сохранены') : T('Заправка не сохранена'))) {
      return;
    }
    renderAll();
    showScreen('history');
    closeForm();
    showToast(existing ? T('Заправка изменена') : T('Заправка сохранена'));
  }

  /* ── Обслуживание: форма ───────────────────────────────── */

  function parseCostInput(input) {
    var raw = input.value.trim();
    if (!raw) {
      return 0;
    }
    return C.parseNumber(raw);
  }

  function updateMaintenanceTotalPreview() {
    if (!el.maintenanceFormTotal) {
      return;
    }
    var parts = parseCostInput(el.maintenanceParts);
    var labor = parseCostInput(el.maintenanceLabor);
    var total = (parts === null ? 0 : parts) + (labor === null ? 0 : labor);
    el.maintenanceFormTotal.textContent = C.formatMoney(total);
  }

  function clearMaintenanceFormErrors() {
    Array.prototype.forEach.call(el.maintenanceForm.querySelectorAll('.input-wrap.is-invalid'), function (wrap) {
      wrap.classList.remove('is-invalid');
    });
    el.maintenanceFormError.textContent = '';
  }

  function maintenanceFormError(message, input) {
    el.maintenanceFormError.textContent = message;
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

  function maintenanceFormFallbackTarget(opener) {
    var editId = opener && opener.getAttribute
      ? opener.getAttribute('data-maintenance-edit')
      : null;
    var replacement = editId
      ? findVisibleControl('data-maintenance-edit', editId)
      : null;
    return replacement || findVisibleControl('data-action', 'add-maintenance');
  }

  function openMaintenanceForm(id, opener) {
    var record = null;
    editingMaintenanceId = id || null;
    maintenanceFormOpener = opener || (
      document.activeElement &&
      document.activeElement !== document.body &&
      !el.maintenanceSheet.contains(document.activeElement)
        ? document.activeElement
        : null
    );

    if (editingMaintenanceId) {
      record = findMaintenance(editingMaintenanceId);
      if (!record) {
        showToast(T('Запись обслуживания не найдена.'), 'error');
        editingMaintenanceId = null;
        return;
      }
    }

    clearMaintenanceFormErrors();
    maintenanceDraftAttachments = cloneAttachments(record ? record.attachments : []);

    if (record) {
      el.maintenanceSheetTitle.textContent = T('Изменить запись');
      el.maintenanceDeleteBtn.hidden = false;
      el.maintenanceDate.value = record.date;
      el.maintenanceOdometer.value = C.formatNumber(record.odometer, 0);
      el.maintenanceTitle.value = record.title;
      el.maintenanceParts.value = record.partsCost > 0 ? C.formatAmount(record.partsCost, 2) : '';
      el.maintenanceLabor.value = record.laborCost > 0 ? C.formatAmount(record.laborCost, 2) : '';
      el.maintenanceNote.value = record.note || '';
    } else {
      var odometer = latestKnownOdometer();
      el.maintenanceSheetTitle.textContent = T('Новая запись');
      el.maintenanceDeleteBtn.hidden = true;
      el.maintenanceDate.value = todayIso();
      el.maintenanceOdometer.value = odometer !== null ? String(Math.round(odometer)) : '';
      el.maintenanceTitle.value = '';
      el.maintenanceParts.value = '';
      el.maintenanceLabor.value = '';
      el.maintenanceNote.value = '';
    }

    updateMaintenanceTotalPreview();
    renderMaintenanceAttachments();
    el.maintenanceForm.scrollTop = 0;
    if (el.maintenanceSheet.querySelector('.fuel-form')) {
      el.maintenanceSheet.querySelector('.fuel-form').scrollTop = 0;
    }
    el.maintenanceSheet.classList.add('is-open');
    el.maintenanceSheet.setAttribute('aria-hidden', 'false');

    if (Focus && Focus.openDialog) {
      var sheetOpener = maintenanceFormOpener;
      Focus.openDialog(el.maintenanceSheet, {
        opener: sheetOpener,
        initialFocus: el.maintenanceSheetClose,
        fallback: function () {
          return maintenanceFormFallbackTarget(sheetOpener);
        }
      });
    } else {
      el.maintenanceSheet.inert = false;
      document.body.classList.add('sheet-open');
      if (el.app) {
        el.app.inert = true;
      }
      el.maintenanceSheetClose.focus();
    }
  }

  function closeMaintenanceForm() {
    var opener = maintenanceFormOpener;
    maintenanceFormOpener = null;
    editingMaintenanceId = null;
    maintenanceDraftAttachments = [];
    clearMaintenanceFormErrors();

    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.maintenanceSheet);
    } else {
      if (el.app) {
        el.app.inert = false;
      }
      document.body.classList.remove('sheet-open');
      if (opener && typeof opener.focus === 'function') {
        opener.focus();
      }
    }
    el.maintenanceSheet.classList.remove('is-open');
    el.maintenanceSheet.setAttribute('aria-hidden', 'true');
    el.maintenanceSheet.inert = true;
  }

  function handleMaintenanceSubmit(event) {
    event.preventDefault();
    clearMaintenanceFormErrors();

    var date = el.maintenanceDate.value;
    var odometerRaw = el.maintenanceOdometer.value.replace(/\D/g, '');
    var odometer = C.parseNumber(odometerRaw);
    var title = el.maintenanceTitle.value.trim();
    var parts = parseCostInput(el.maintenanceParts);
    var labor = parseCostInput(el.maintenanceLabor);

    if (!date || !C.isValidDateString(date)) {
      return maintenanceFormError(T('Укажите дату обслуживания.'), el.maintenanceDate);
    }
    if (date > todayIso()) {
      return maintenanceFormError(T('Дата не может быть в будущем.'), el.maintenanceDate);
    }
    if (odometer === null || odometer <= 0) {
      return maintenanceFormError(T('Введите пробег больше нуля.'), el.maintenanceOdometer);
    }
    if (!title) {
      return maintenanceFormError(T('Укажите работу или событие.'), el.maintenanceTitle);
    }
    if (parts === null) {
      return maintenanceFormError(T('Стоимость запчастей должна быть числом.'), el.maintenanceParts);
    }
    if (labor === null) {
      return maintenanceFormError(T('Стоимость работ должна быть числом.'), el.maintenanceLabor);
    }

    var existing = editingMaintenanceId ? findMaintenance(editingMaintenanceId) : null;
    var record = {
      id: existing ? existing.id : S.makeId(),
      date: date,
      odometer: Math.round(odometer),
      title: title.slice(0, 120),
      partsCost: parts,
      laborCost: labor,
      note: el.maintenanceNote.value.trim().slice(0, 500),
      attachments: cloneAttachments(maintenanceDraftAttachments),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    var next = cloneState(state);
    var nextProfile = activeProfileIn(next);
    if (!Array.isArray(nextProfile.maintenances)) {
      nextProfile.maintenances = [];
    }
    var nextRecords = nextProfile.maintenances;
    var index = -1;

    if (existing) {
      for (var itemIndex = 0; itemIndex < nextRecords.length; itemIndex += 1) {
        if (nextRecords[itemIndex].id === existing.id) {
          index = itemIndex;
          break;
        }
      }
      if (index === -1) {
        showToast(T('Запись обслуживания не найдена. Обновите список.'), 'error');
        return;
      }
      nextRecords[index] = record;
    } else {
      nextRecords.push(record);
    }
    nextProfile.updatedAt = new Date().toISOString();

    if (!commitState(next, existing ? T('Изменения не сохранены') : T('Запись не сохранена'))) {
      return;
    }
    renderAll();
    showScreen('maintenance');
    closeMaintenanceForm();
    showToast(existing ? T('Запись изменена') : T('Запись добавлена'));
  }

  function bindMaintenanceForm() {
    if (!el.maintenanceForm) {
      return;
    }

    [el.maintenanceParts, el.maintenanceLabor].forEach(function (input) {
      input.addEventListener('input', function () {
        sanitizeNumericInput(input);
        clearFieldError(input);
        el.maintenanceFormError.textContent = '';
        updateMaintenanceTotalPreview();
      });
    });

    el.maintenanceOdometer.addEventListener('input', function () {
      var cleaned = el.maintenanceOdometer.value.replace(/[^\d]/g, '');
      if (cleaned !== el.maintenanceOdometer.value) {
        el.maintenanceOdometer.value = cleaned;
      }
      clearFieldError(el.maintenanceOdometer);
      el.maintenanceFormError.textContent = '';
    });

    [el.maintenanceDate, el.maintenanceTitle, el.maintenanceNote].forEach(function (input) {
      input.addEventListener('input', function () {
        clearFieldError(input);
        el.maintenanceFormError.textContent = '';
      });
    });

    el.maintenanceSheetClose.addEventListener('click', closeMaintenanceForm);
    el.maintenanceFormCancel.addEventListener('click', closeMaintenanceForm);
    el.maintenanceForm.addEventListener('submit', handleMaintenanceSubmit);
    el.maintenanceDeleteBtn.addEventListener('click', function () {
      if (editingMaintenanceId) {
        requestMaintenanceDelete(editingMaintenanceId, true);
      }
    });
  }

  function cloneAttachments(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(function (item) {
      return item && typeof item === 'object' && typeof item.dataUrl === 'string' && item.dataUrl;
    }).slice(0, MAX_ATTACHMENTS).map(function (item) {
      return {
        id: item.id || S.makeId(),
        name: item.name || 'photo',
        mime: item.mime || 'image/jpeg',
        size: Number.isFinite(item.size) ? item.size : 0,
        purpose: ATTACHMENT_PURPOSES.indexOf(item.purpose) !== -1 ? item.purpose : 'other',
        dataUrl: item.dataUrl,
        createdAt: item.createdAt || new Date().toISOString()
      };
    });
  }

  function attachmentPurposeLabel(purpose) {
    if (purpose === 'receipt') {
      return T('Чек');
    }
    if (purpose === 'invoice') {
      return T('Счёт');
    }
    if (purpose === 'warranty') {
      return T('Гарантия');
    }
    if (purpose === 'photo') {
      return T('Фото');
    }
    return T('Другое');
  }

  function formatAttachmentDate(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    try {
      return new Intl.DateTimeFormat(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).format(date);
    } catch (error) {
      return '';
    }
  }

  function attachmentMetaText(attachment) {
    var parts = [attachmentPurposeLabel(attachment.purpose), formatBytes(attachment.size)];
    var date = formatAttachmentDate(attachment.createdAt);
    if (date) {
      parts.push(date);
    }
    return parts.join(' · ');
  }

  function attachmentPreviewHtml(record) {
    var list = Array.isArray(record && record.attachments) ? record.attachments : [];
    if (!list.length) {
      return '';
    }
    var visible = list.slice(0, 3);
    var more = list.length - visible.length;
    return '<div class="record-attachments">' +
      visible.map(function (item) {
        return '<button class="record-attachment" type="button"' +
          ' data-attachment-record="' + escapeHtml(record.id) + '"' +
          ' data-attachment-id="' + escapeHtml(item.id) + '"' +
          ' aria-label="' + escapeHtml(T('Открыть вложение') + ': ' + attachmentPurposeLabel(item.purpose)) + '">' +
          '<img src="' + escapeHtml(item.dataUrl) + '" alt="">' +
          '<span>' + escapeHtml(attachmentPurposeLabel(item.purpose)) + '</span>' +
        '</button>';
      }).join('') +
      (more > 0 ? '<span class="record-attachments-more">+' + more + '</span>' : '') +
    '</div>';
  }

  function renderMaintenanceAttachments() {
    if (!el.maintenanceAttachments) {
      return;
    }
    var count = maintenanceDraftAttachments.length;
    if (el.maintenanceAttachmentsCount) {
      el.maintenanceAttachmentsCount.textContent = count + ' / ' + MAX_ATTACHMENTS;
    }
    if (el.maintenanceAttachmentsHint) {
      el.maintenanceAttachmentsHint.textContent = attachmentInputBusy
        ? T('Обрабатываем фото…')
        : T('До 5 файлов, каждый до 12 МБ. После сжатия файл хранится только на этом устройстве.');
    }
    if (el.maintenanceCameraBtn) {
      el.maintenanceCameraBtn.disabled = attachmentInputBusy || count >= MAX_ATTACHMENTS;
    }
    if (el.maintenanceGalleryBtn) {
      el.maintenanceGalleryBtn.disabled = attachmentInputBusy || count >= MAX_ATTACHMENTS;
    }

    el.maintenanceAttachments.innerHTML = maintenanceDraftAttachments.map(function (item) {
      var options = ATTACHMENT_PURPOSES.map(function (purpose) {
        return '<option value="' + purpose + '"' +
          (purpose === item.purpose ? ' selected' : '') + '>' +
          escapeHtml(attachmentPurposeLabel(purpose)) + '</option>';
      }).join('');
      return '<div class="attachment-item" data-attachment-item="' + escapeHtml(item.id) + '">' +
        '<button class="attachment-thumb" type="button" data-draft-attachment-view="' + escapeHtml(item.id) + '"' +
          ' aria-label="' + escapeHtml(T('Просмотр фото') + ': ' + attachmentPurposeLabel(item.purpose)) + '">' +
          '<img src="' + escapeHtml(item.dataUrl) + '" alt="">' +
        '</button>' +
        '<div class="attachment-details">' +
          '<strong>' + escapeHtml(attachmentPurposeLabel(item.purpose)) + '</strong>' +
          '<span dir="auto" data-i18n-ignore>' + escapeHtml(item.name || T('Фото')) + '</span>' +
          '<small>' + escapeHtml(formatBytes(item.size)) + '</small>' +
        '</div>' +
        '<label class="attachment-purpose">' +
          '<span class="visually-hidden">' + escapeHtml(T('Назначение')) + '</span>' +
          '<select data-attachment-purpose="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Назначение')) + '">' +
            options +
          '</select>' +
        '</label>' +
        '<button class="mini-btn mini-danger" type="button" data-attachment-remove="' + escapeHtml(item.id) + '"' +
          ' aria-label="' + escapeHtml(T('Удалить вложение')) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('read'));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('image')); };
      image.src = dataUrl;
    });
  }

  function compressAttachment(file) {
    return readImageFile(file).then(function (dataUrl) {
      return loadImage(dataUrl).then(function (image) {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) {
          throw new Error('image');
        }
        var scale = Math.min(1, MAX_ATTACHMENT_SIDE / Math.max(width, height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var context = canvas.getContext('2d');
        if (!context) {
          throw new Error('canvas');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var compressed = canvas.toDataURL('image/jpeg', 0.86);
        if (!compressed || compressed.indexOf('data:image/jpeg;base64,') !== 0) {
          throw new Error('canvas');
        }
        var base64 = compressed.split(',')[1] || '';
        return {
          id: S.makeId(),
          name: (file.name || 'photo').slice(0, 120),
          mime: 'image/jpeg',
          size: Math.round((base64.length * 3) / 4),
          purpose: 'photo',
          dataUrl: compressed,
          createdAt: new Date().toISOString()
        };
      });
    });
  }

  function handleAttachmentFiles(fileList) {
    if (attachmentInputBusy) {
      return;
    }
    var files = Array.prototype.slice.call(fileList || []).filter(Boolean);
    if (!files.length) {
      return;
    }
    var remaining = MAX_ATTACHMENTS - maintenanceDraftAttachments.length;
    if (remaining <= 0) {
      showToast(T('Можно добавить не больше 5 файлов.'), 'error');
      return;
    }
    if (files.length > remaining) {
      showToast(T('Можно добавить не больше 5 файлов.'), 'error');
      files = files.slice(0, remaining);
    }

    var valid = [];
    files.forEach(function (file) {
      if (file.size > MAX_ATTACHMENT_INPUT_BYTES) {
        showToast(T('Файл больше 12 МБ. Выберите файл поменьше.'), 'error');
        return;
      }
      var type = (file.type || '').toLowerCase();
      if (type === 'image/heic' || type === 'image/heif') {
        showToast(T('Формат HEIC пока не поддерживается. Сделайте обычное фото в JPEG.'), 'error');
        return;
      }
      if (type && type.indexOf('image/') !== 0) {
        showToast(T('Это не изображение. Выберите фото чека или табло.'), 'error');
        return;
      }
      valid.push(file);
    });

    if (!valid.length) {
      return;
    }

    attachmentInputBusy = true;
    renderMaintenanceAttachments();
    var added = 0;
    var chain = Promise.resolve();
    valid.forEach(function (file) {
      chain = chain.then(function () {
        return compressAttachment(file).then(function (attachment) {
          maintenanceDraftAttachments.push(attachment);
          added += 1;
          renderMaintenanceAttachments();
        }).catch(function () {
          showToast(T('Не удалось добавить фото. Попробуйте другой файл.'), 'error');
        });
      });
    });
    chain.then(function () {
      attachmentInputBusy = false;
      renderMaintenanceAttachments();
      if (added > 0) {
        showToast(T('Добавлено: ') + countLabel(added, 'file'));
      }
    }, function () {
      attachmentInputBusy = false;
      renderMaintenanceAttachments();
    });
  }

  function findDraftAttachment(id) {
    for (var index = 0; index < maintenanceDraftAttachments.length; index += 1) {
      if (maintenanceDraftAttachments[index].id === id) {
        return maintenanceDraftAttachments[index];
      }
    }
    return null;
  }

  function removeDraftAttachment(id) {
    maintenanceDraftAttachments = maintenanceDraftAttachments.filter(function (item) {
      return item.id !== id;
    });
    renderMaintenanceAttachments();
  }

  function bindMaintenanceAttachments() {
    if (!el.maintenanceAttachments) {
      return;
    }

    el.maintenanceCameraBtn.addEventListener('click', function () {
      el.maintenanceCameraInput.click();
    });
    el.maintenanceGalleryBtn.addEventListener('click', function () {
      el.maintenanceGalleryInput.click();
    });

    [el.maintenanceCameraInput, el.maintenanceGalleryInput].forEach(function (input) {
      input.addEventListener('change', function () {
        handleAttachmentFiles(input.files);
        input.value = '';
      });
    });

    el.maintenanceAttachments.addEventListener('click', function (event) {
      var removeButton = event.target.closest('[data-attachment-remove]');
      if (removeButton) {
        removeDraftAttachment(removeButton.getAttribute('data-attachment-remove'));
        return;
      }
      var viewButton = event.target.closest('[data-draft-attachment-view]');
      if (viewButton) {
        var attachment = findDraftAttachment(viewButton.getAttribute('data-draft-attachment-view'));
        if (attachment) {
          openAttachmentViewer(attachment, viewButton);
        }
      }
    });

    el.maintenanceAttachments.addEventListener('change', function (event) {
      var select = event.target.closest('[data-attachment-purpose]');
      if (!select) {
        return;
      }
      var attachment = findDraftAttachment(select.getAttribute('data-attachment-purpose'));
      if (attachment && ATTACHMENT_PURPOSES.indexOf(select.value) !== -1) {
        attachment.purpose = select.value;
        renderMaintenanceAttachments();
      }
    });
  }

  function findRecordAttachment(recordId, attachmentId) {
    var record = findMaintenance(recordId);
    if (!record || !Array.isArray(record.attachments)) {
      return null;
    }
    for (var index = 0; index < record.attachments.length; index += 1) {
      if (record.attachments[index].id === attachmentId) {
        return record.attachments[index];
      }
    }
    return null;
  }

  function openAttachmentViewer(attachment, opener) {
    if (!attachment || !el.attachmentViewer) {
      return;
    }
    attachmentViewerOpener = opener || document.activeElement;
    el.attachmentViewerTitle.textContent = T('Просмотр фото');
    el.attachmentViewerImage.src = attachment.dataUrl;
    el.attachmentViewerImage.alt = T('Вложение') + ': ' + attachmentPurposeLabel(attachment.purpose);
    el.attachmentViewerMeta.textContent = attachmentMetaText(attachment);
    el.attachmentViewer.hidden = false;

    if (Focus && Focus.openDialog) {
      Focus.openDialog(el.attachmentViewer, {
        opener: attachmentViewerOpener,
        initialFocus: el.attachmentViewerClose,
        fallback: function () {
          return attachmentViewerOpener || el.maintenanceGalleryBtn || el.historyList;
        }
      });
    } else {
      document.body.classList.add('modal-open');
      el.attachmentViewerClose.focus();
    }
  }

  function closeAttachmentViewer() {
    if (!el.attachmentViewer || el.attachmentViewer.hidden) {
      return;
    }
    if (document.activeElement && el.attachmentViewer.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.attachmentViewer);
    } else {
      document.body.classList.remove('modal-open');
    }
    el.attachmentViewer.hidden = true;
    el.attachmentViewerImage.removeAttribute('src');
    el.attachmentViewerMeta.textContent = '';
    attachmentViewerOpener = null;
  }

  function bindAttachmentViewer() {
    if (!el.attachmentViewer) {
      return;
    }
    el.attachmentViewerClose.addEventListener('click', closeAttachmentViewer);
    el.attachmentViewer.addEventListener('click', function (event) {
      if (event.target === el.attachmentViewer) {
        closeAttachmentViewer();
      }
    });
  }

  function bindLanguage() {
    if (!el.languageSelect || !I18n) {
      return;
    }
    el.languageSelect.value = I18n.getLang();
    el.languageSelect.addEventListener('change', function () {
      I18n.setLang(el.languageSelect.value);
    });
    document.addEventListener('murano:languagechange', function () {
      if (el.languageSelect) {
        el.languageSelect.value = I18n.getLang();
      }
      applyTheme();
      renderAll();
      showScreen(currentScreen);
    });
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
      (record.station ? ' · ' + stationDisplayName(record) : '');

    askConfirm({
      title: T('Удалить заправку?'),
      message: description + '. ' + T('Это действие нельзя отменить.'),
      confirmLabel: T('Удалить'),
      focusFallback: function () {
        return findVisibleControl('data-edit', id) ||
          findVisibleControl('data-action', 'add') ||
          findFirstVisible('.nav-item.is-active');
      }
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var next = cloneState(state);
      var nextProfile = activeProfileIn(next);
      nextProfile.fuelings = nextProfile.fuelings.filter(function (item) { return item.id !== id; });
      nextProfile.updatedAt = new Date().toISOString();

      if (!commitState(next, T('Заправка не удалена'))) {
        return;
      }
      renderAll();
      if (fromSheet) {
        closeForm();
      }
      showToast(T('Заправка удалена'));
    });
  }

  function requestMaintenanceDelete(id, fromSheet) {
    var record = findMaintenance(id);
    if (!record) {
      return;
    }
    var description = formatDate(record.date) + ' · ' + record.title +
      ' · ' + C.formatMoney(C.maintenanceTotal(record));

    askConfirm({
      title: T('Удалить запись обслуживания?'),
      message: description + '. ' + T('Это действие нельзя отменить.'),
      confirmLabel: T('Удалить'),
      focusFallback: function () {
        return findVisibleControl('data-maintenance-edit', id) ||
          findVisibleControl('data-action', 'add-maintenance') ||
          findFirstVisible('.nav-item.is-active');
      }
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var next = cloneState(state);
      var nextProfile = activeProfileIn(next);
      nextProfile.maintenances = (Array.isArray(nextProfile.maintenances) ? nextProfile.maintenances : []).filter(function (item) {
        return item.id !== id;
      });
      nextProfile.updatedAt = new Date().toISOString();

      if (!commitState(next, T('Запись не удалена'))) {
        return;
      }
      renderAll();
      if (fromSheet) {
        closeMaintenanceForm();
      }
      showToast(T('Запись обслуживания удалена'));
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
      el.activeProfileName.textContent = displayProfileName(profile.name);
    }
    if (!el.profilesList) {
      return;
    }

    var canDelete = state.profiles.length > 1;
    el.profilesList.innerHTML = state.profiles.map(function (item) {
      var active = item.id === profile.id;
      var count = countRecordsForProfile(item);
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
              '<strong data-i18n-ignore>' + escapeHtml(displayProfileName(item.name)) + '</strong>' +
              '<small>' + countLabel(count, 'record') + '</small>' +
            '</span>' +
            check +
          '</button>' +
          (canDelete
            ? '<button class="profile-delete" type="button" data-profile-delete="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(T('Удалить автомобиль') + ' ' + displayProfileName(item.name)) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>' +
              '</button>'
            : '') +
        '</div>'
      );
    }).join('');
    applyTranslations();
  }

  function resetProfileForm(focusAddButton) {
    el.profileForm.hidden = true;
    el.profileAddBtn.hidden = false;
    el.profileName.value = '';
    el.profileOdometer.value = '';
    el.profileError.textContent = '';
    if (focusAddButton) {
      el.profileAddBtn.focus();
    }
  }

  function openProfiles() {
    resetProfileForm();
    renderProfiles();
    el.profilesModal.hidden = false;
    if (Focus && Focus.openDialog) {
      Focus.openDialog(el.profilesModal, {
        initialFocus: el.profilesClose,
        fallback: function () {
          return findFirstVisible('[data-profile-switch]', el.profilesList) ||
            findFirstVisible('#profile-add-btn', el.profilesModal) ||
            el.profilesClose;
        }
      });
    } else {
      document.body.classList.add('modal-open');
      el.profilesClose.focus();
    }
  }

  function closeProfiles() {
    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.profilesModal, {
        fallback: function () {
          if (el.carSwitch && el.carSwitch.isConnected) {
            return el.carSwitch;
          }
          return null;
        },
        deferRestore: true
      });
    } else {
      document.body.classList.remove('modal-open');
    }
    el.profilesModal.hidden = true;
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
      if (!commitState(next, T('Не удалось переключить автомобиль'))) {
        return;
      }
      renderAll();
      showToast(T('Автомобиль: ') + displayProfileName(profile.name));
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

    var fuelingsCount = Array.isArray(profile.fuelings) ? profile.fuelings.length : 0;
    var maintenancesCount = Array.isArray(profile.maintenances) ? profile.maintenances.length : 0;
    askConfirm({
      title: T('Удалить автомобиль?'),
      message: T('Профиль «') + displayProfileName(profile.name) + T('», его заправки (') +
        fuelingsCount + T(') и обслуживание (') + maintenancesCount +
        T(') будут удалены. Это действие нельзя отменить.'),
      confirmLabel: T('Удалить'),
      focusFallback: function () {
        return findFirstVisible('[data-profile-switch]', el.profilesList) ||
          el.profileAddBtn ||
          el.profilesClose;
      }
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

      if (!commitState(next, T('Автомобиль не удалён'))) {
        return;
      }
      renderAll();
      showToast(T('Автомобиль удалён'));
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
    el.profileCancel.addEventListener('click', function () {
      resetProfileForm(true);
    });

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
        el.profileError.textContent = T('Введите название автомобиля.');
        el.profileName.focus();
        return;
      }

      var raw = el.profileOdometer.value.trim();
      var odometer = raw === '' ? null : C.parseNumber(raw);
      if (raw !== '' && (odometer === null || odometer < 0)) {
        el.profileError.textContent = T('Введите пробег числом, например 85000.');
        el.profileOdometer.focus();
        return;
      }

      var profile = S.createProfile(name, odometer === null ? null : Math.round(odometer));
      var next = cloneState(state);
      next.profiles.push(profile);
      next.activeProfileId = profile.id;

      if (!commitState(next, T('Автомобиль не добавлен'))) {
        return;
      }
      renderAll();
      closeProfiles();
      showToast(T('Автомобиль добавлен'));
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
    el.confirmTitle.textContent = settings.title || T('Подтвердите действие');
    el.confirmText.textContent = settings.message || '';
    el.confirmOk.textContent = settings.confirmLabel || T('Удалить');
    el.confirmModal.hidden = false;

    if (Focus && Focus.openDialog) {
      Focus.openDialog(el.confirmModal, {
        initialFocus: el.confirmCancel,
        fallback: settings.focusFallback || null
      });
    } else {
      document.body.classList.add('modal-open');
      el.confirmCancel.focus();
    }

    return new Promise(function (resolve) {
      confirmResolver = resolve;
    });
  }

  function settleConfirm(value) {
    if (Focus && Focus.closeDialog) {
      Focus.closeDialog(el.confirmModal, { deferRestore: true });
    } else {
      document.body.classList.remove('modal-open');
    }
    el.confirmModal.hidden = true;
    var resolver = confirmResolver;
    confirmResolver = null;
    if (resolver) {
      resolver(value);
    }
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var top = Focus && Focus.topDialog ? Focus.topDialog() : null;
      if (!top) {
        return;
      }

      if (event.key === 'Tab') {
        if (Focus) {
          Focus.trapTab(top, event);
        }
        return;
      }
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      if (top === el.confirmModal) {
        settleConfirm(false);
      } else if (top === el.ocrReviewModal) {
        closeOcrReview('scan');
      } else if (top === el.profilesModal) {
        closeProfiles();
      } else if (top === el.sheet) {
        closeForm();
      } else if (top === el.maintenanceSheet) {
        closeMaintenanceForm();
      } else if (top === el.attachmentViewer) {
        closeAttachmentViewer();
      }
    });
  }

  /* ── Общий рендер и PWA ────────────────────────────────── */

  function renderAll() {
    renderHome();
    renderHistory();
    renderMaintenance();
    renderCharts();
    renderStatsScreen();
    renderSettings();
    renderProfiles();
    applyTranslations();
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
      showToast(T('Доступна новая версия. Перезапустите приложение.'));
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
