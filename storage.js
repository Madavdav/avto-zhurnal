/*
 * АвтоЖурнал — хранение данных.
 *
 * Данные лежат в localStorage браузера. Это значит: они остаются на устройстве,
 * не уходят в интернет и не требуют сервера. Минус — при очистке данных браузера
 * они пропадут, поэтому есть экспорт и импорт резервной копии.
 *
 * Начиная с версии 2.0.0 записи хранятся в профилях автомобилей. Старые данные
 * (schemaVersion 1) автоматически переносятся в первый профиль.
 */
(function (global) {
  'use strict';

  // Ключ намеренно не меняем: так уже сохранённые данные не потеряются.
  var STORAGE_KEY = 'muranoLog.state.v1';
  var BROKEN_KEY = 'muranoLog.broken.v1';
  var SNAPSHOT_KEY = 'muranoLog.snapshot.v1';
  var APP_ID = 'auto-log';
  var LEGACY_APP_IDS = ['murano-log'];
  var SCHEMA_VERSION = 2;
  var LEGACY_SCHEMA_VERSION = 1;
  var DEFAULT_INITIAL_ODOMETER = 130000;
  var DEFAULT_PROFILE_NAME = 'Моя машина';

  var lastError = null;

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function pad2(number) {
    return String(number).padStart(2, '0');
  }

  function todayIso() {
    var date = new Date();
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function resolveStorage(store) {
    return store || global.localStorage;
  }

  function isFiniteNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function normalizeProfileName(value, index) {
    var name = typeof value === 'string' ? value.trim().slice(0, 40) : '';
    return name || 'Автомобиль ' + (index + 1);
  }

  function normalizeInitialOdometer(value, useLegacyFallback) {
    if (value === null || value === '') {
      return null;
    }
    if (isFiniteNonNegative(value)) {
      return value;
    }
    return useLegacyFallback ? DEFAULT_INITIAL_ODOMETER : null;
  }

  function createProfile(name, initialOdometer) {
    var now = nowIso();
    return {
      id: makeId(),
      name: normalizeProfileName(name, 0),
      initialOdometer: normalizeInitialOdometer(initialOdometer, false),
      fuelings: [],
      createdAt: now,
      updatedAt: now
    };
  }

  function defaultState() {
    var profile = createProfile(DEFAULT_PROFILE_NAME, null);
    return {
      schemaVersion: SCHEMA_VERSION,
      activeProfileId: profile.id,
      profiles: [profile]
    };
  }

  function fileStamp() {
    var date = new Date();
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      '-' + pad2(date.getHours()) + '-' + pad2(date.getMinutes()) + '-' + pad2(date.getSeconds());
  }

  function normalizeStation(raw) {
    var text = typeof raw.station === 'string' ? raw.station.trim().slice(0, 80) : '';
    var C = global.MuranoCalc;
    var id = typeof raw.stationId === 'string' ? raw.stationId : '';

    if (!C || typeof C.stationName !== 'function') {
      return { stationId: '', station: text };
    }
    if (!C.stationName(id)) {
      id = C.inferStationId(text);
    }
    if (id === 'other') {
      return {
        stationId: 'other',
        station: text && text !== 'Другое' ? text : 'Другое'
      };
    }
    if (id) {
      return { stationId: id, station: C.stationName(id) };
    }
    return { stationId: '', station: text };
  }

  function normalizeFueling(raw, index, options, seenFuelingIds) {
    var prefix = 'Запись №' + (index + 1) + ': ';
    var strict = Boolean(options && options.strict);
    if (!raw || typeof raw !== 'object') {
      throw new Error(prefix + 'ожидался объект.');
    }
    if (!global.MuranoCalc || !global.MuranoCalc.isValidDateString(raw.date)) {
      throw new Error(prefix + 'неверная или пустая дата.');
    }
    if (strict && raw.date > (options.today || todayIso())) {
      throw new Error(prefix + 'дата не может быть в будущем.');
    }
    if (!isFiniteNonNegative(raw.odometer)) {
      throw new Error(prefix + 'пробег должен быть неотрицательным числом.');
    }
    if (strict && raw.odometer <= 0) {
      throw new Error(prefix + 'пробег должен быть больше нуля.');
    }
    if (!isFiniteNonNegative(raw.liters) || raw.liters <= 0) {
      throw new Error(prefix + 'количество литров должно быть больше нуля.');
    }
    if (strict && raw.pricePerLiter !== undefined && raw.pricePerLiter !== null &&
        !isFiniteNonNegative(raw.pricePerLiter)) {
      throw new Error(prefix + 'цена за литр должна быть неотрицательным числом.');
    }
    if (strict && raw.total !== undefined && raw.total !== null &&
        !isFiniteNonNegative(raw.total)) {
      throw new Error(prefix + 'общая сумма должна быть неотрицательным числом.');
    }

    var price = isFiniteNonNegative(raw.pricePerLiter) ? raw.pricePerLiter : null;
    var total = isFiniteNonNegative(raw.total) ? raw.total : null;

    if (price === null && total === null) {
      throw new Error(prefix + 'нужна цена за литр или общая сумма.');
    }
    if (strict && price !== null && price <= 0) {
      throw new Error(prefix + 'цена за литр должна быть больше нуля.');
    }
    if (strict && total !== null && total <= 0) {
      throw new Error(prefix + 'общая сумма должна быть больше нуля.');
    }
    if (total === null) {
      total = raw.liters * price;
    }
    if (price === null) {
      price = total / raw.liters;
    }
    if (strict && (!Number.isFinite(price) || !Number.isFinite(total))) {
      throw new Error(prefix + 'не удалось рассчитать стоимость.');
    }

    var station = normalizeStation(raw);
    var note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 500) : '';
    var lastPriceField = raw.lastPriceField === 'total' || raw.lastPriceField === 'price'
      ? raw.lastPriceField
      : 'price';
    var id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();

    if (seenFuelingIds) {
      if (seenFuelingIds[id]) {
        if (strict) {
          throw new Error(prefix + 'повторяющийся ID записи.');
        }
        do {
          id = makeId();
        } while (seenFuelingIds[id]);
      }
      seenFuelingIds[id] = true;
    }

    return {
      id: id,
      date: raw.date,
      odometer: raw.odometer,
      liters: raw.liters,
      pricePerLiter: price,
      total: total,
      station: station.station,
      stationId: station.stationId,
      note: note,
      fullTank: Boolean(raw.fullTank),
      lastPriceField: lastPriceField,
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso(),
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso()
    };
  }

  function normalizeProfile(raw, index, seenIds, options, seenFuelingIds) {
    var strict = Boolean(options && options.strict);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Профиль №' + (index + 1) + ': ожидался объект.');
    }

    var name = normalizeProfileName(raw.name, index);
    if (!Array.isArray(raw.fuelings)) {
      throw new Error('В профиле «' + name + '» нет списка заправок.');
    }
    if (strict && raw.initialOdometer !== undefined && raw.initialOdometer !== null &&
        raw.initialOdometer !== '' && !isFiniteNonNegative(raw.initialOdometer)) {
      throw new Error('В профиле «' + name + '» начальный пробег должен быть неотрицательным числом.');
    }

    var id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();
    if (seenIds && seenIds[id]) {
      if (strict) {
        throw new Error('Профиль «' + name + '»: повторяющийся ID.');
      }
      do {
        id = makeId();
      } while (seenIds[id]);
    }
    if (seenIds) {
      seenIds[id] = true;
    }

    var createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso();
    var updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso();

    return {
      id: id,
      name: name,
      initialOdometer: normalizeInitialOdometer(raw.initialOdometer, false),
      fuelings: raw.fuelings.map(function (item, itemIndex) {
        return normalizeFueling(item, itemIndex, options, seenFuelingIds);
      }),
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  }

  function normalizeState(raw, options) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Файл не похож на резервную копию АвтоЖурнала.');
    }

    var source = raw.data && typeof raw.data === 'object' ? raw.data : raw;
    var profiles = [];
    var seenFuelingIds = Object.create(null);

    if (Array.isArray(source.profiles)) {
      var seenIds = Object.create(null);
      profiles = source.profiles.map(function (profile, index) {
        return normalizeProfile(profile, index, seenIds, options, seenFuelingIds);
      });
    } else if (Array.isArray(source.fuelings)) {
      // Старый формат (schemaVersion 1): один автомобиль без профилей.
      var settings = source.settings && typeof source.settings === 'object'
        ? source.settings
        : {};
      profiles = [
        normalizeProfile({
          name: DEFAULT_PROFILE_NAME,
          initialOdometer: normalizeInitialOdometer(settings.initialOdometer, true),
          fuelings: source.fuelings
        }, 0, Object.create(null), options, seenFuelingIds)
      ];
    } else {
      throw new Error('В файле нет списка автомобилей или заправок.');
    }

    if (profiles.length === 0) {
      profiles = [createProfile(DEFAULT_PROFILE_NAME, null)];
    }

    var activeProfileId = typeof source.activeProfileId === 'string'
      ? source.activeProfileId
      : '';
    var activeExists = profiles.some(function (profile) {
      return profile.id === activeProfileId;
    });
    if (!activeExists) {
      activeProfileId = profiles[0].id;
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      activeProfileId: activeProfileId,
      profiles: profiles
    };
  }

  function load(store) {
    lastError = null;
    var storage;
    var rawText = null;
    try {
      storage = resolveStorage(store);
      rawText = storage.getItem(STORAGE_KEY);
    } catch (error) {
      lastError = 'Браузер не разрешает доступ к локальному хранилищу.';
      return defaultState();
    }

    if (!rawText) {
      return defaultState();
    }

    try {
      var parsed = JSON.parse(rawText);
      var normalized = normalizeState(parsed);

      // Сразу сохраняем новый формат, чтобы миграция не зависела от того,
      // изменит ли пользователь что-то в текущей сессии.
      if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.profiles)) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        } catch (ignored) {
          // Если записать не удалось, нормализованные данные всё равно уже в памяти.
        }
      }

      return normalized;
    } catch (error) {
      // Не выбрасываем повреждённые данные: сохраняем их отдельно,
      // чтобы при необходимости можно было посмотреть вручную.
      try {
        storage.setItem(BROKEN_KEY, rawText);
      } catch (ignored) {
        // Если хранилище переполнено или закрыто — просто идём дальше.
      }
      lastError = 'Сохранённые данные не удалось прочитать. Начните с пустого списка или импортируйте резервную копию.';
      return defaultState();
    }
  }

  function save(state, store) {
    lastError = null;
    try {
      resolveStorage(store).setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      lastError = 'Не удалось сохранить данные на устройстве. Возможно, закончилось место или браузер запретил хранение.';
      return false;
    }
  }

  function createSnapshot(state, reason, store) {
    lastError = null;
    var snapshot;
    try {
      snapshot = {
        app: APP_ID,
        kind: 'snapshot',
        schemaVersion: SCHEMA_VERSION,
        createdAt: nowIso(),
        reason: typeof reason === 'string' ? reason.slice(0, 40) : 'manual',
        state: normalizeState(state)
      };
    } catch (error) {
      lastError = 'Не удалось подготовить страховочную копию: ' + error.message;
      return null;
    }

    var json;
    try {
      json = JSON.stringify(snapshot);
      var storage = resolveStorage(store);
      storage.setItem(SNAPSHOT_KEY, json);
      if (storage.getItem(SNAPSHOT_KEY) !== json) {
        throw new Error('копия не прошла проверку чтением.');
      }
    } catch (error) {
      lastError = 'Не удалось создать страховочную копию. Данные не изменены. ' +
        'Возможно, на устройстве закончилось место.';
      return null;
    }

    return {
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      records: snapshot.state.profiles.reduce(function (total, profile) {
        return total + profile.fuelings.length;
      }, 0)
    };
  }

  function readSnapshot(store) {
    var rawText;
    try {
      rawText = resolveStorage(store).getItem(SNAPSHOT_KEY);
    } catch (error) {
      lastError = 'Браузер не разрешает прочитать страховочную копию.';
      throw new Error(lastError);
    }
    if (!rawText) {
      return null;
    }

    try {
      var parsed = JSON.parse(rawText);
      if (!parsed || parsed.app !== APP_ID || parsed.kind !== 'snapshot' || !parsed.state) {
        throw new Error('неверный формат копии.');
      }
      return {
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'manual',
        state: normalizeState(parsed.state)
      };
    } catch (error) {
      lastError = 'Страховочная копия повреждена и не может быть восстановлена.';
      throw new Error(lastError);
    }
  }

  function restoreSnapshot(store) {
    lastError = null;
    var snapshot;
    try {
      snapshot = readSnapshot(store);
    } catch (error) {
      return null;
    }
    if (!snapshot) {
      lastError = 'Страховочная копия не найдена.';
      return null;
    }
    if (!save(snapshot.state, store)) {
      return null;
    }
    return snapshot;
  }

  function backupObject(state) {
    var normalized = normalizeState(state);
    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso(),
      activeProfileId: normalized.activeProfileId,
      profiles: normalized.profiles
    };
  }

  function backupJson(state) {
    return JSON.stringify(backupObject(state), null, 2);
  }

  function parseBackup(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error('Это не JSON-файл. Выберите файл, который сохранило приложение АвтоЖурнал.');
    }

    var knownApp = parsed && (parsed.app === APP_ID || LEGACY_APP_IDS.indexOf(parsed.app) !== -1);
    if (!parsed || typeof parsed !== 'object' || !knownApp) {
      throw new Error('Это не резервная копия АвтоЖурнала.');
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION && parsed.schemaVersion !== LEGACY_SCHEMA_VERSION) {
      throw new Error('Файл создан другой версией приложения и пока не поддерживается.');
    }
    return normalizeState(parsed, { strict: true, today: todayIso() });
  }

  function downloadBackup(state) {
    var json = backupJson(state);
    var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var filename = 'avto-zhurnal-' + fileStamp() + '.json';

    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);

    return filename;
  }

  function storageInfo(store) {
    var text = '';
    try {
      text = resolveStorage(store).getItem(STORAGE_KEY) || '';
    } catch (error) {
      return { available: false, bytes: 0 };
    }
    return { available: true, bytes: new Blob([text]).size };
  }

  global.MuranoStorage = {
    STORAGE_KEY: STORAGE_KEY,
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    APP_ID: APP_ID,
    LEGACY_APP_IDS: LEGACY_APP_IDS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    LEGACY_SCHEMA_VERSION: LEGACY_SCHEMA_VERSION,
    DEFAULT_INITIAL_ODOMETER: DEFAULT_INITIAL_ODOMETER,
    defaultState: defaultState,
    createProfile: createProfile,
    load: load,
    save: save,
    createSnapshot: createSnapshot,
    readSnapshot: readSnapshot,
    restoreSnapshot: restoreSnapshot,
    parseBackup: parseBackup,
    backupJson: backupJson,
    downloadBackup: downloadBackup,
    normalizeState: normalizeState,
    makeId: makeId,
    storageInfo: storageInfo,
    get lastError() {
      return lastError;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
