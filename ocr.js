/*
 * АвтоЖурнал — локальное распознавание данных заправки по фото.
 *
 * Модуль не отправляет фотографии в сеть: изображение уменьшается и
 * обрабатывается в браузере через Tesseract.js (WebAssembly/Web Worker).
 * Tesseract.js и языковые данные лежат рядом, в папке vendor/tesseract.
 *
 * Наружу отдаются только числа, которые удалось найти в тексте. Пользователь
 * всегда видит экран проверки и сам решает, переносить ли значения в форму.
 */
(function (global) {
  'use strict';

  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_IMAGE_SIDE = 2200;
  var MIN_IMAGE_SIDE = 1200;
  var ENGINE_VERSION = '5.1.1';

  var scriptBase;
  try {
    scriptBase = document.currentScript && document.currentScript.src
      ? new URL('.', document.currentScript.src).href
      : new URL('./', global.location.href).href;
  } catch (error) {
    scriptBase = new URL('./', global.location.href).href;
  }

  var VENDOR_BASE = new URL('vendor/tesseract/', scriptBase).href;
  var TESSERACT_SCRIPT_URL = VENDOR_BASE + 'tesseract.min.js';
  var WORKER_URL = VENDOR_BASE + 'worker.min.js';
  var CORE_SIMD_URL = VENDOR_BASE + 'tesseract-core-simd-lstm.wasm.js';
  var CORE_STANDARD_URL = VENDOR_BASE + 'tesseract-core-lstm.wasm.js';
  var LANG_PATH = VENDOR_BASE;

  var engineScriptPromise = null;
  var workerPromise = null;
  var workerInstance = null;
  var progressListener = null;

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function emitProgress(payload) {
    if (typeof progressListener !== 'function') {
      return;
    }
    try {
      progressListener(payload);
    } catch (error) {
      // Ошибка обработчика прогресса не должна ломать распознавание.
    }
  }

  function normalizeDigits(value) {
    var source = String(value || '');
    var arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    var easternArabic = '۰۱۲۳۴۵۶۷۸۹';
    var result = '';

    for (var index = 0; index < source.length; index += 1) {
      var ch = source.charAt(index);
      var arabicIndex = arabicIndic.indexOf(ch);
      var easternIndex = easternArabic.indexOf(ch);
      if (arabicIndex !== -1) {
        result += String(arabicIndex);
      } else if (easternIndex !== -1) {
        result += String(easternIndex);
      } else {
        result += ch;
      }
    }
    return result;
  }

  function normalizeText(text) {
    return normalizeDigits(String(text || ''))
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function maskDatesAndTimes(line) {
    return line
      .replace(/\b\d{1,4}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
      .replace(/\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g, ' ');
  }

  function parseDecimalToken(raw) {
    var cleaned = String(raw || '').replace(/[ \u00a0'\u2019\u02bc]/g, '');
    var variants = [];

    function add(value, decimals, source) {
      var numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return;
      }
      var rounded = Math.round(numeric * 1000000) / 1000000;
      for (var index = 0; index < variants.length; index += 1) {
        if (Math.abs(variants[index].value - rounded) < 0.0000001) {
          return;
        }
      }
      variants.push({
        value: rounded,
        decimals: decimals,
        source: source
      });
    }

    var commaIndex = cleaned.lastIndexOf(',');
    var dotIndex = cleaned.lastIndexOf('.');
    var separatorIndex = Math.max(commaIndex, dotIndex);
    var commaCount = (cleaned.match(/,/g) || []).length;
    var dotCount = (cleaned.match(/\./g) || []).length;

    if (separatorIndex !== -1) {
      var before = cleaned.slice(0, separatorIndex).replace(/[.,]/g, '');
      var after = cleaned.slice(separatorIndex + 1).replace(/[.,]/g, '');
      var decimalValue = before + '.' + after;
      add(decimalValue, after.length, 'decimal');

      if (commaCount + dotCount > 0) {
        var integerValue = cleaned.replace(/[.,]/g, '');
        add(integerValue, 0, 'integer');
      }
    } else if (commaCount > 1 || dotCount > 1) {
      var allButLast = cleaned.slice(0, separatorIndex).replace(/[.,]/g, '');
      var lastPart = cleaned.slice(separatorIndex + 1);
      add(allButLast + '.' + lastPart, lastPart.length, 'decimal');
      add(cleaned.replace(/[.,]/g, ''), 0, 'integer');
    } else {
      add(cleaned, 0, 'integer');
    }

    // Если Tesseract не увидел десятичную точку (например, 4560 вместо 45,60),
    // пробуем те же цифры с подразумеваемой точкой. Выбор сделает проверка
    // связи «литры × цена ≈ сумма» ниже.
    var onlyDigits = cleaned.replace(/[.,]/g, '');
    if (/^\d{3,6}$/.test(onlyDigits)) {
      var integer = Number(onlyDigits);
      if (Number.isFinite(integer)) {
        [10, 100, 1000].forEach(function (factor) {
          add(integer / factor, String(factor).length - 1, 'implied');
        });
      }
    }

    return variants;
  }

  function isLikelyYear(value, decimals, raw) {
    return decimals === 0 && /^(?:19|20)\d{2}$/.test(String(raw || '').replace(/\D/g, ''));
  }

  function lineHasTotalLabel(line) {
    var text = line.toLowerCase();
    if (/sub\s*total/.test(text) && !/grand\s*total/.test(text)) {
      return false;
    }
    return /(?:^|[^a-z])(?:grand\s+)?total(?:[^a-z]|$)/.test(text) ||
      /amount\s+due|balance\s+due|to\s+pay|total\s+due/.test(text) ||
      /סה\s*["'\u05f4]?\s*כ|לתשלום|סכום\s*(?:לתשלום|כולל)?/.test(line);
  }

  function lineHasPriceLabel(line) {
    var text = line.toLowerCase();
    return /price\s*(?:per|\/)\s*(?:l|lt|ltr|liter|litre)\b/.test(text) ||
      /per\s+(?:liter|litre|ltr)\b/.test(text) ||
      /(?:₪|ils|nis|shekel)\s*\/\s*(?:l|lt|liter|litre)\b/.test(text) ||
      /מחיר\s*(?:ל|ל-|\/)?\s*ליטר/.test(line) ||
      /מחיר\s*ל['\u05f3]/.test(line);
  }

  function lineHasLitersLabel(line) {
    var text = line.toLowerCase();
    return /\b(?:liters?|litres?|ltrs?|lts?|volume|quantity|qty)\b/.test(text) ||
      /(?:^|[\s(])(?:l|lt)\s*(?:$|[\s).,;:-])/.test(text) ||
      /ליטר/.test(line) ||
      /כמות/.test(line);
  }

  function collectNumberCandidates(lines) {
    var candidates = [];
    var numberPattern = /(?:\d{1,3}(?:[ \u00a0'\u2019,.]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)/g;

    lines.forEach(function (line, lineIndex) {
      var masked = maskDatesAndTimes(line);
      var match;
      numberPattern.lastIndex = 0;
      while ((match = numberPattern.exec(masked)) !== null) {
        var raw = match[0];
        var variants = parseDecimalToken(raw);
        var lowerText = masked.toLowerCase();
        var hasCurrency = /[₪$€£]|ils|nis|shekel/.test(lowerText);

        variants.forEach(function (variant) {
          candidates.push({
            value: variant.value,
            decimals: variant.decimals,
            source: variant.source,
            raw: raw.replace(/\s+/g, ''),
            lineIndex: lineIndex,
            lineText: masked,
            hasCurrency: hasCurrency,
            yearish: isLikelyYear(variant.value, variant.decimals, raw)
          });
        });
      }
    });

    return candidates;
  }

  function isLitersValue(value) {
    return value >= 1 && value <= 250;
  }

  function isPriceValue(value) {
    return value >= 2 && value <= 30;
  }

  function isTotalValue(value) {
    return value >= 5 && value <= 5000;
  }

  function candidateHasLabel(candidate, labelLines, field) {
    return candidate && labelLines[field].indexOf(candidate.lineIndex) !== -1;
  }

  function roundValue(value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor + 0.0000001) / factor;
  }

  /**
   * Разбирает распознанный текст и пытается найти литры, цену за литр и сумму.
   * Функция не зависит от OCR-движка и легко тестируется отдельно.
   */
  function parseFuelText(sourceText) {
    var text = normalizeText(sourceText);
    var lines = text.split('\n').map(function (line) {
      return line.trim();
    }).filter(Boolean);

    if (!lines.length) {
      return {
        liters: null,
        pricePerLiter: null,
        total: null,
        confidence: 0,
        warnings: ['Текст не распознан.'],
        numberCount: 0
      };
    }

    var candidates = collectNumberCandidates(lines);
    var labelLines = {
      liters: [],
      price: [],
      total: []
    };

    lines.forEach(function (line, lineIndex) {
      var priceLabel = lineHasPriceLabel(line);
      if (priceLabel) {
        labelLines.price.push(lineIndex);
      }
      if (!priceLabel && lineHasLitersLabel(line)) {
        labelLines.liters.push(lineIndex);
      }
      if (lineHasTotalLabel(line)) {
        labelLines.total.push(lineIndex);
      }
    });

    var litersCandidates = [];
    var priceCandidates = [];
    var totalCandidates = [];

    candidates.forEach(function (candidate) {
      if (isLitersValue(candidate.value)) {
        litersCandidates.push(candidate);
      }
      if (isPriceValue(candidate.value)) {
        priceCandidates.push(candidate);
      }
      if (isTotalValue(candidate.value)) {
        totalCandidates.push(candidate);
      }
    });

    var best = null;

    litersCandidates.forEach(function (litersCandidate) {
      priceCandidates.forEach(function (priceCandidate) {
        if (
          litersCandidate.lineIndex === priceCandidate.lineIndex &&
          litersCandidate.raw === priceCandidate.raw
        ) {
          return;
        }

        totalCandidates.forEach(function (totalCandidate) {
          if (
            totalCandidate.value <= litersCandidate.value ||
            totalCandidate.value <= priceCandidate.value
          ) {
            return;
          }

          var expected = litersCandidate.value * priceCandidate.value;
          var difference = Math.abs(totalCandidate.value - expected) /
            Math.max(totalCandidate.value, expected);
          if (difference > 0.08) {
            return;
          }

          var score = (1 - difference) * 100;

          if (candidateHasLabel(litersCandidate, labelLines, 'liters')) {
            score += 32;
          }
          if (candidateHasLabel(priceCandidate, labelLines, 'price')) {
            score += 28;
          }
          if (candidateHasLabel(totalCandidate, labelLines, 'total')) {
            score += 36;
          }

          if (litersCandidate.value >= 10 && litersCandidate.value <= 120) {
            score += 5;
          }
          if (priceCandidate.value >= 3 && priceCandidate.value <= 15) {
            score += 5;
          }
          if (totalCandidate.value >= 30) {
            score += 2;
          }
          if (litersCandidate.decimals > 0) {
            score += 2;
          }
          if (priceCandidate.decimals > 0) {
            score += 3;
          }
          if (totalCandidate.decimals > 0) {
            score += 2;
          }

          if (litersCandidate.source === 'implied') {
            score -= 2;
          }
          if (priceCandidate.source === 'implied') {
            score -= 2;
          }
          if (totalCandidate.source === 'implied') {
            score -= 2;
          }

          if (!candidateHasLabel(totalCandidate, labelLines, 'total')) {
            if (totalCandidate.yearish) {
              score -= 20;
            }
            score += (totalCandidate.lineIndex / Math.max(1, lines.length - 1)) * 4;
          }

          if (!best || score > best.score) {
            best = {
              liters: litersCandidate,
              pricePerLiter: priceCandidate,
              total: totalCandidate,
              score: score,
              difference: difference
            };
          }
        });
      });
    });

    var result = {
      liters: best ? roundValue(best.liters.value, 2) : null,
      pricePerLiter: best ? roundValue(best.pricePerLiter.value, 2) : null,
      total: best ? roundValue(best.total.value, 2) : null,
      confidence: 0,
      warnings: [],
      numberCount: candidates.length
    };

    if (best) {
      result.confidence = 0.38 +
        (candidateHasLabel(best.liters, labelLines, 'liters') ? 0.18 : 0) +
        (candidateHasLabel(best.pricePerLiter, labelLines, 'price') ? 0.18 : 0) +
        (candidateHasLabel(best.total, labelLines, 'total') ? 0.2 : 0) +
        (best.difference <= 0.015 ? 0.12 : 0);

      if (result.confidence > 0.98) {
        result.confidence = 0.98;
      }
    } else {
      // Если уверенной тройки нет, но два значения читаются, третье можно
      // восстановить по формуле. Это всё равно показывается на проверке.
      var labeledTotal = pickLabeledValue(totalCandidates, labelLines.total, 'total');
      var labeledPrice = pickLabeledValue(priceCandidates, labelLines.price, 'price');
      var labeledLiters = pickLabeledValue(litersCandidates, labelLines.liters, 'liters');

      if (labeledTotal && labeledPrice && labeledPrice.value > 0) {
        result.total = roundValue(labeledTotal.value, 2);
        result.pricePerLiter = roundValue(labeledPrice.value, 2);
        result.liters = roundValue(labeledTotal.value / labeledPrice.value, 2);
        result.confidence = 0.56;
      } else if (labeledTotal && labeledLiters && labeledLiters.value > 0) {
        result.total = roundValue(labeledTotal.value, 2);
        result.liters = roundValue(labeledLiters.value, 2);
        result.pricePerLiter = roundValue(labeledTotal.value / labeledLiters.value, 2);
        result.confidence = 0.56;
      } else if (labeledLiters && labeledPrice) {
        result.liters = roundValue(labeledLiters.value, 2);
        result.pricePerLiter = roundValue(labeledPrice.value, 2);
        result.total = roundValue(labeledLiters.value * labeledPrice.value, 2);
        result.confidence = 0.52;
      } else if (labeledTotal) {
        result.total = roundValue(labeledTotal.value, 2);
        result.confidence = 0.34;
      }
    }

    if (result.liters === null) {
      result.warnings.push('Не удалось уверенно распознать литры.');
    }
    if (result.pricePerLiter === null) {
      result.warnings.push('Не удалось уверенно распознать цену за литр.');
    }
    if (result.total === null) {
      result.warnings.push('Не удалось уверенно распознать общую сумму.');
    }
    if (result.confidence < 0.55 && (result.liters !== null || result.total !== null)) {
      result.warnings.push('Проверьте числа: качество фото могло повлиять на распознавание.');
    }

    return result;
  }

  function pickLabeledValue(candidates, lineIndexes, field) {
    var best = null;
    var bestScore = -Infinity;

    candidates.forEach(function (candidate) {
      if (lineIndexes.indexOf(candidate.lineIndex) === -1) {
        return;
      }

      // Каноническая запись с точкой важнее догадок о потерянной запятой.
      // Иначе «TOTAL 335.16» может превратиться в 3351.6.
      var score = candidate.source === 'implied' ? 0 : 20;
      if (candidate.source === 'decimal') {
        score += 2;
      }
      if (candidate.decimals > 0) {
        score += 1;
      }
      if (field === 'total' && candidate.value >= 30) {
        score += 2;
      }
      if (field === 'price' && candidate.value >= 3 && candidate.value <= 15) {
        score += 3;
      }
      if (field === 'liters' && candidate.value >= 10 && candidate.value <= 120) {
        score += 3;
      }

      if (score > bestScore || (score === bestScore && best && candidate.value < best.value)) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function supportsSimd() {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') {
      return false;
    }
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0,
        10, 9, 1, 7, 0, 65, 0, 253, 15, 26, 11
      ]));
    } catch (error) {
      return false;
    }
  }

  function loadEngineScript() {
    if (global.Tesseract) {
      return Promise.resolve(global.Tesseract);
    }
    if (engineScriptPromise) {
      return engineScriptPromise;
    }

    engineScriptPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = TESSERACT_SCRIPT_URL;
      script.async = true;
      script.onload = function () {
        if (global.Tesseract) {
          resolve(global.Tesseract);
        } else {
          engineScriptPromise = null;
          reject(makeError('ocr_unavailable', 'Не удалось загрузить движок распознавания.'));
        }
      };
      script.onerror = function () {
        engineScriptPromise = null;
        reject(makeError('ocr_unavailable', 'Не удалось загрузить движок распознавания.'));
      };
      document.head.appendChild(script);
    });

    return engineScriptPromise;
  }

  function getWorker() {
    if (workerPromise) {
      return workerPromise;
    }

    workerPromise = loadEngineScript().then(function (Tesseract) {
      var corePath = supportsSimd() ? CORE_SIMD_URL : CORE_STANDARD_URL;
      return Tesseract.createWorker('eng', 1, {
        workerPath: WORKER_URL,
        corePath: corePath,
        langPath: LANG_PATH,
        gzip: true,
        logger: function (message) {
          emitProgress({
            status: message.status || '',
            progress: typeof message.progress === 'number' ? message.progress : 0
          });
        },
        errorHandler: function () {
          // Ошибку обработает Promise от worker.recognize().
        }
      }).then(function (worker) {
        workerInstance = worker;
        return worker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        }).then(function () {
          return worker;
        });
      });
    }).catch(function (error) {
      if (workerInstance && typeof workerInstance.terminate === 'function') {
        workerInstance.terminate().catch(function () {});
      }
      workerInstance = null;
      workerPromise = null;
      throw error;
    });

    return workerPromise;
  }

  function validateImageFile(file) {
    if (!file) {
      throw makeError('no_file', 'Файл не выбран.');
    }
    if (file.size && file.size > MAX_FILE_BYTES) {
      throw makeError('too_large', 'Фото больше 20 МБ. Выберите файл поменьше.');
    }
    if (file.type && !/^image\//i.test(file.type)) {
      throw makeError('not_image', 'Это не похоже на изображение.');
    }
    if (file.type && /heic|heif/i.test(file.type)) {
      throw makeError('unsupported_image', 'Формат HEIC пока не поддерживается. Сделайте фото в JPEG или PNG.');
    }
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        resolve({
          image: image,
          revoke: function () {
            URL.revokeObjectURL(objectUrl);
          }
        });
      };
      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(makeError('image_error', 'Не удалось открыть фото. Попробуйте другой файл.'));
      };
      image.src = objectUrl;
    });
  }

  function prepareImage(file) {
    return loadImage(file).then(function (loaded) {
      var image = loaded.image;
      var width = image.naturalWidth || image.width;
      var height = image.naturalHeight || image.height;
      if (!width || !height) {
        loaded.revoke();
        throw makeError('image_error', 'Не удалось определить размер фото.');
      }

      var longest = Math.max(width, height);
      var scale = 1;
      if (longest > MAX_IMAGE_SIDE) {
        scale = MAX_IMAGE_SIDE / longest;
      } else if (longest < MIN_IMAGE_SIDE) {
        scale = MIN_IMAGE_SIDE / longest;
      }

      var padding = 24;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale) + padding * 2);
      canvas.height = Math.max(1, Math.round(height * scale) + padding * 2);
      var context = canvas.getContext('2d');
      if (!context) {
        loaded.revoke();
        throw makeError('canvas_error', 'Браузер не смог подготовить фото.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      try {
        context.filter = 'grayscale(1) contrast(1.25)';
      } catch (error) {
        // Фильтры canvas не обязательны.
      }
      context.drawImage(
        image,
        padding,
        padding,
        Math.round(width * scale),
        Math.round(height * scale)
      );
      loaded.revoke();

      return new Promise(function (resolve, reject) {
        function finish(blob) {
          if (!blob) {
            reject(makeError('image_error', 'Не удалось подготовить фото.'));
            return;
          }
          resolve({
            blob: blob,
            width: canvas.width,
            height: canvas.height
          });
        }

        canvas.toBlob(finish, 'image/jpeg', 0.92);
      });
    });
  }

  function recognizeImage(file, options) {
    var settings = options || {};

    return Promise.resolve().then(function () {
      validateImageFile(file);
      progressListener = settings.onProgress || null;
      emitProgress({ status: 'preparing', progress: 0 });
      return prepareImage(file);
    }).then(function (prepared) {
      return getWorker().then(function (worker) {
        return worker.recognize(prepared.blob).then(function (result) {
          var text = result && result.data && typeof result.data.text === 'string'
            ? result.data.text
            : '';
          var parsed = parseFuelText(text);
          return {
            text: text,
            parsed: parsed,
            image: prepared.blob,
            width: prepared.width,
            height: prepared.height,
            engine: 'tesseract.js ' + ENGINE_VERSION
          };
        });
      });
    }).catch(function (error) {
      if (workerInstance && (
        error && (
          error.code === 'ocr_unavailable' ||
          /worker|core|language|tesseract/i.test(String(error.message || ''))
        )
      )) {
        workerInstance.terminate().catch(function () {});
        workerInstance = null;
        workerPromise = null;
      }
      throw error;
    }).finally(function () {
      progressListener = null;
    });
  }

  global.MuranoOcr = {
    parseFuelText: parseFuelText,
    recognizeImage: recognizeImage,
    normalizeText: normalizeText,
    supportsSimd: supportsSimd,
    validateImageFile: validateImageFile,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    ENGINE_VERSION: ENGINE_VERSION,
    VENDOR_BASE: VENDOR_BASE
  };
})(window);
