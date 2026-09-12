/**
 * server/repositories/metrics.repo.js
 *
 * IDEA-5: /api/metrics — лёгкий машиночитаемый снимок состояния системы.
 *
 * Сознательно ОТДЕЛЬНЫЙ от двух уже существующих похожих эндпойнтов, а не
 * переиспользует их напрямую:
 * - GET /api/stats (публичный) — даёт разбивку активов, но ничего про
 *   инфраструктуру (размер БД, бэкапы) — этого IDEA-5 и просит.
 * - GET /api/settings/system-info (admin) — уже даёт размер БД и бэкапы,
 *   но вперемешку с тяжёлым "О программе" (техстек, changelog, список
 *   зависимостей) — не то, что нужно для периодического опроса скриптом
 *   мониторинга; здесь только числа, без текстовых блоков.
 *
 * Асеты те же самые (assetsRepo.getAllAssets()), поэтому at cost — просто
 * ещё один проход по уже загруженному массиву, не отдельный тяжёлый запрос.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../database');
const assetsRepo = require('./assets.repo');
const { sqlite } = require('../db/sqlite');
const { DB_PATH, CFG_PATH, DATA_DIR } = require('../db/store');

function _fileSize(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

function _backupInfo() {
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
      .map(f => fs.statSync(path.join(BACKUP_DIR, f)).mtime);
    if (!files.length) return { count: 0, last_at: null };
    return { count: files.length, last_at: new Date(Math.max(...files.map(d => +d))).toISOString() };
  } catch (e) {
    return { count: 0, last_at: null };
  }
}

function getMetrics() {
  const all = assetsRepo.getAllAssets(); // включает списанные — метрики honest про всё, что есть в БД
  const count = arr => arr.reduce((m, v) => { m[v] = (m[v] || 0) + 1; return m; }, {});

  const sqlitePath = path.join(DATA_DIR, 'it-assets.sqlite');

  let historyCount = 0;
  try { historyCount = sqlite.prepare('SELECT COUNT(*) c FROM history').get().c; } catch (e) {}

  return {
    generated_at: new Date().toISOString(),
    assets: {
      total: all.length,
      by_status: count(all.map(a => a.status)),
      by_tab: count(all.map(a => a.tab)),
      by_type: count(all.map(a => a.type || '—')),
    },
    history: {
      total: historyCount,
    },
    storage: {
      sqlite_bytes: _fileSize(sqlitePath),
      db_json_bytes: _fileSize(DB_PATH),
      config_json_bytes: _fileSize(CFG_PATH),
    },
    backups: _backupInfo(),
    uptime_sec: Math.round(process.uptime()),
  };
}

module.exports = { getMetrics };
