/**
 * public/js/pwa.js — PROD-12: регистрация service worker + подключение
 * manifest (сам <link rel="manifest"> — в index.html, тут только SW).
 *
 * Не регистрируем на /scan.html — та страница вообще не подключает этот
 * скрипт (отдельный self-contained HTML, см. её собственный комментарий
 * в начале файла) — не нужно и не должно быть частью PWA-оболочки.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return; // старые браузеры — тихо пропускаем, не PWA, не ошибка
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      // Не критично для работы приложения — просто не будет офлайн-кеша/
      // установки как PWA. Не показываем это пользователю тостом.
      console.warn('[pwa] service worker registration failed', err);
    });
  });
})();
