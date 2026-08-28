# Changelog

Формат по мотивам [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).
Подробный бэклог и статусы задач — во внешнем файле `ROADMAP-CONSOLIDATED.md`
(не в репозитории, обновляется отдельно). Здесь — краткая хронология того,
что реально попало в `dev`.

## [Unreleased]

### Added
- INFRA-1: `scripts/check-deps-fresh.js` — сравнение mtime `package-lock.json`
  и `node_modules` вместо наивной проверки существования папки в
  `START.bat`/`start.sh`.
- INFRA-3: git pre-commit хук (`scripts/hooks/pre-commit` +
  `scripts/install-hooks.js`) — напоминание обновить `CHANGELOG.md` при
  изменении `server/`/`public/js/`.
- INFRA-4: `scripts/sync-version.js` — синхронизация версии из `package.json`
  в README-бейдж и `docs/index.html` (обнаружил и исправил реальный дрейф:
  docs была на `26w27-02`, актуальная — `26w29-01`).
- INFRA-5: `GET /api/settings/system-info` (admin-only) и
  `GET /api/settings/version` — версия, окружение Node, реально
  установленные зависимости, размер БД, счётчики сущностей, инфо по
  бэкапам; кнопка «Подробная диагностика» в настройках.
- LOC-5/LOC-6: полная локализация RU/EN оставшихся экранов (пользователи,
  типы устройств, генератор инв. номеров, печать QR, глобальный поиск,
  справочники орг/филиалов/локаций, конфиг, общие настройки, бэкапы) +
  финальный проход по всему проекту на предмет пропущенного текста.

### Checked
- INFRA-2: HTTPS-сертификаты (`server/cert.js`) — проверено, доработок не
  требуется (каскад SAN на локальные IP + проверка через X509Certificate +
  HTTP-фолбэк уже реализованы).

## [beta-1-26w29-01] — база на момент начала этой хронологии
- Track 1 (безопасность, SEC-1..10), Track 2 (баг-фиксы, BUG-1..3),
  Track 7 LOC-1..4 (фундамент локализации, активы, CSV-импорт, справочники).
