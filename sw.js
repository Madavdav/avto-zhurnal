/*
 * АвтоЖурнал — service worker.
 *
 * Запоминает файлы приложения в кэш браузера, чтобы после первого открытия
 * приложение запускалось без интернета. Данные заправок хранятся отдельно,
 * в localStorage, и service worker их не касается.
 *
 * Важно: при выпуске новой версии меняйте CACHE_NAME. Страницы и код
 * загружаются сначала из сети, поэтому обновление не застревает в старом кэше.
 */
'use strict';

var CACHE_NAME = 'avto-zhurnal-v2.1.0';
var CACHE_PREFIXES = ['murano-log-', 'avto-zhurnal-'];

var APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calc.js',
  './storage.js',
  './charts.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

function scopePath() {
  try {
    return new URL(self.registration.scope).pathname;
  } catch (error) {
    return '/';
  }
}

function isAppNavigation(url) {
  var root = scopePath();
  var indexPath = root + 'index.html';
  return url.pathname === root || url.pathname === indexPath;
}

function addAppShell(cache) {
  // Загружаем файлы по очереди: так установка не зависит от того,
  // сколько параллельных запросов выдержит сервер.
  return APP_SHELL.reduce(function (chain, url) {
    return chain.then(function () {
      return cache.add(url);
    });
  }, Promise.resolve());
}

function putInCache(cacheKey, response) {
  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (cache) {
    return cache.put(cacheKey, copy);
  }).catch(function () {
    // Кэш не критичен: данные пользователя хранятся отдельно.
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(addAppShell)
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          var known = CACHE_PREFIXES.some(function (prefix) {
            return key.indexOf(prefix) === 0;
          });
          if (key !== CACHE_NAME && known) {
            return caches.delete(key);
          }
          return Promise.resolve();
        }));
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function cachedIndex() {
  return caches.match('./index.html')
    .then(function (cached) {
      return cached || caches.match('./');
    })
    .then(function (cached) {
      return cached || Response.error();
    });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.indexOf(scopePath() + 'tests/') === 0) {
    // Страница тестов не входит в приложение и не должна попадать в его кэш.
    return;
  }

  // Страницы: сначала сеть, чтобы после публикации открывалась свежая версия.
  // Офлайн показываем сохранённый index.html только для самого приложения.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(function (response) {
          if (!response || !response.ok) {
            return isAppNavigation(url) ? cachedIndex() : response;
          }
          if (isAppNavigation(url)) {
            putInCache('./index.html', response);
          }
          return response;
        })
        .catch(function () {
          return isAppNavigation(url) ? cachedIndex() : Response.error();
        })
    );
    return;
  }

  // Код и стили: сначала сеть, чтобы обновления не застревали в кэше.
  // Если сети нет — отдаём сохранённую копию.
  var networkFirst = request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'manifest' ||
    /\.(?:js|css|webmanifest)$/i.test(url.pathname);

  if (networkFirst) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(function (response) {
          if (response && response.ok) {
            putInCache(request, response);
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || Response.error();
          });
        })
    );
    return;
  }

  // Иконки и остальные файлы: сначала кэш, затем сеть.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          putInCache(request, response);
        }
        return response;
      });
    })
  );
});
