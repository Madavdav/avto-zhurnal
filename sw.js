/*
 * АвтоЖурнал — service worker.
 *
 * Запоминает файлы приложения в кэш браузера, чтобы после первого открытия
 * приложение запускалось без интернета. Данные заправок хранятся отдельно,
 * в localStorage, и service worker их не касается.
 */
'use strict';

var CACHE_NAME = 'avto-zhurnal-v2.0.0';

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

function addAppShell(cache) {
  // Загружаем файлы по очереди: так установка не зависит от того,
  // сколько параллельных запросов выдержит сервер.
  return APP_SHELL.reduce(function (chain, url) {
    return chain.then(function () {
      return cache.add(url);
    });
  }, Promise.resolve());
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
          if (key !== CACHE_NAME &&
              (key.indexOf('murano-log-') === 0 || key.indexOf('avto-zhurnal-') === 0)) {
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
  return caches.match('./index.html').then(function (cached) {
    return cached || caches.match('./');
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

  // Страницы: сначала пробуем сеть. Если сети нет или сервер ответил ошибкой,
  // открываем сохранённый index.html. Кэш обновляем только для главной страницы,
  // чтобы служебные страницы (например, тесты) не подменяли приложение офлайн.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (!response || !response.ok) {
            return cachedIndex();
          }
          if (url.pathname === '/' || url.pathname === '/index.html') {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put('./index.html', copy);
            });
          }
          return response;
        })
        .catch(cachedIndex)
    );
    return;
  }

  // Файлы приложения: сначала кэш, затем сеть.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});
