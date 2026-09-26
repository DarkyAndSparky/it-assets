/**
 * server/lib/health.js
 *
 * Проверка живости ключевых компонент (БД/бэкап/сертификат/диск) —
 * вынесена из server/routes/settings.routes.js (INFRA-6) в отдельный
 * модуль, чтобы одну и ту же логику могли использовать и HTTP-эндпоинт
 * (GET /api/settings/health, по требованию — health-бар в шапке опрашивает
 * раз в минуту), и фоновый периодический таймер (см. index.js) для
 * проактивных уведомлений при деградации (новое — см. HEALTH-1 в
 * roadmap).
 *
 * Дизайн специально лёгкий (без тяжёлых операций типа npm outdated) —
 * оба потребителя дёргают эту функцию довольно часто.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function checkHealth() {
  const { sqlite } = require('../db/sqlite');
  const { DATA_DIR } = require('../db/store');
  const cert = require('../cert');
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');

  // 1. БД — пробный запрос. Если sqlite недоступна/файл повреждён, упадёт
  //    исключение — это и есть сигнал "error".
  let dbCheck = { status: 'ok', detail: 'OK' };
  try {
    sqlite.prepare('SELECT 1').get();
  } catch (e) {
    dbCheck = { status: 'error', detail: e.message };
  }

  // 2. Бэкапы — автобэкап каждый час (см. index.js), так что свежим
  //    считаем бэкап младше 2 часов (буфер на случай, если сервер только
  //    что запустился и первый автобэкап ещё не прошёл — не менее 90 минут
  //    даёт "warn", а не "error", в первый час работы).
  let backupCheck = { status: 'error', detail: 'Бэкапов нет' };
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
      .map(f => fs.statSync(path.join(BACKUP_DIR, f)).mtime);
    if (files.length) {
      const lastMs = Math.max(...files.map(d => d.getTime()));
      const ageHours = (Date.now() - lastMs) / 3600000;
      if (ageHours < 2) backupCheck = { status: 'ok', detail: `Последний ${ageHours.toFixed(1)} ч назад` };
      else if (ageHours < 6) backupCheck = { status: 'warn', detail: `Последний ${ageHours.toFixed(1)} ч назад` };
      else backupCheck = { status: 'error', detail: `Последний ${Math.round(ageHours)} ч назад` };
    }
  } catch (e) {
    backupCheck = { status: 'error', detail: 'Папка бэкапов недоступна' };
  }
  // Сервер запущен недавно — первый автобэкап ещё не успел пройти,
  // не пугаем "error" в первые полтора часа работы.
  if (backupCheck.status === 'error' && process.uptime() < 5400) {
    backupCheck = { status: 'warn', detail: 'Сервер недавно запущен, бэкап ещё не создан' };
  }

  // 3. Сертификат — переиспользуем certDaysLeft() из cert.js (INFRA-2/6).
  let certCheck = { status: 'ok', detail: 'HTTP-режим (без TLS)' };
  const daysLeft = cert.certDaysLeft();
  if (daysLeft != null) {
    if (daysLeft < 0)       certCheck = { status: 'error', detail: 'Сертификат просрочен' };
    else if (daysLeft < 30) certCheck = { status: 'warn',  detail: `Истекает через ${daysLeft} дн.` };
    else                    certCheck = { status: 'ok',    detail: `Действителен ещё ${daysLeft} дн.` };
  }

  // 4. Диск — свободное место под data/. Пороги: <5% или <500MB = error,
  //    <15% или <2GB = warn.
  let diskCheck = { status: 'ok', detail: 'OK' };
  try {
    const st = fs.statfsSync(DATA_DIR);
    const freeBytes  = st.bavail * st.bsize;
    const totalBytes = st.blocks * st.bsize;
    const freePct    = totalBytes ? (freeBytes / totalBytes) * 100 : 100;
    const freeGB     = freeBytes / (1024 ** 3);
    if (freeGB < 0.5 || freePct < 5)       diskCheck = { status: 'error', detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
    else if (freeGB < 2 || freePct < 15)   diskCheck = { status: 'warn',  detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
    else                                    diskCheck = { status: 'ok',    detail: `${freeGB.toFixed(1)} GB свободно (${freePct.toFixed(1)}%)` };
  } catch (e) {
    diskCheck = { status: 'warn', detail: 'Не удалось определить (' + e.message + ')' };
  }

  const checks = { db: dbCheck, backup: backupCheck, cert: certCheck, disk: diskCheck };
  const overall = Object.values(checks).some(c => c.status === 'error') ? 'error'
                : Object.values(checks).some(c => c.status === 'warn')  ? 'warn'
                : 'ok';

  return { overall, checks };
}

module.exports = { checkHealth };
