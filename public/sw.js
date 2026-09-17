/**
 * public/sw.js — PROD-12: минимальный service worker, нужен для
 * установки приложения как PWA (Chrome/Edge требуют активный SW с
 * обработчиком fetch как одно из условий "installable").
 *
 * ОБЛАСТЬ ДЕЙСТВИЯ (осознанно ограничена):
 * - Кешируется (stale-while-revalidate) ТОЛЬКО статическая оболочка
 *   приложения — HTML/CSS/JS/иконки/манифест. Это даёт офлайн-доступ к
 *   самому интерфейсу (открывается, не белый экран) и чуть более быструю
 *   повторную загрузку статики.
 * - `/api/*` НИКОГДА не кешируется и не перехватывается — эти запросы
 *   идут напрямую в сеть, без исключений. Причина: это приложение
 *   учитывает активы/историю/пользователей, которые меняются постоянно;
 *   отдать устаревший `/api/assets` из кеша, когда сети реально нет —
 *   значит молча показать неверные данные (склад/статусы/ответственных)
 *   вместо честной ошибки сети. Учёт активов — не тот случай, где
 *   "показать хоть что-то" лучше, чем явный сигнал "нет соединения,
 *   данные могут быть неактуальны, попробуйте позже".
 * - `/scan.html` (PROD-8, публичная страница без входа) — НЕ включена в
 *   precache и не подпадает под нашу оболочку намеренно: у неё своя
 *   логика, отдельная страница, не часть "приложения" в смысле PWA.
 */
'use strict';

// Синхронизируется вместе с версией приложения (scripts/sync-version.js) —
// смена версии автоматически инвалидирует старый кеш при активации нового
// SW (см. 'activate' ниже), без риска годами кешировать устаревший JS.
const CACHE_NAME = 'it-assets-shell-beta-1-26w38-08';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // /api/* — всегда в сеть, без исключений (см. обоснование в шапке файла).
  if (url.pathname.startsWith('/api/')) return;
  // Кешируем только GET — POST/PUT/DELETE service worker вообще не трогает.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached); // офлайн — отдаём закешированное, если есть
      return cached || networkFetch;
    })
  );
});
