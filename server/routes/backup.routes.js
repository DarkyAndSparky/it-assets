/**
 * server/routes/backup.routes.js
 *
 * REF-1: бэкапы вынесены из server/index.js без изменения поведения —
 * тот же паттерн, что и остальные *.routes.js (orgs, filials, ...).
 * Раньше это был последний крупный блок в index.js помимо QR (см.
 * qr.routes.js), из-за которого файл держался в районе 600-700 строк
 * вместо целевых ~150.
 *
 * makeBackup/listBackups/BACKUP_DIR экспортированы отдельно от роутера —
 * index.js по-прежнему использует их напрямую в `GET /api/diag` (не
 * переносился в этом рефакторинге, использование бэкапов там — побочное,
 * не основной домен роута).
 */
'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');
const logger   = require('../logger');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const DATA_DIR   = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// Фото активов — включаются в ZIP-бэкапы (см. makeBackup ниже) наравне с
// db.json/config.json/it-assets.sqlite, чтобы восстановление из бэкапа не
// молча теряло загруженные фото.
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
const AdmZip = (() => { try { return require('adm-zip'); } catch(e) { return null; } })();

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function makeBackup(label = 'auto') {
  ensureBackupDir();
  // Включаем миллисекунды (slice(0, 23) вместо 19) + короткий случайный
  // суффикс — иначе два бэкапа, сделанных в один и тот же момент времени
  // (двойной клик, параллельные вызовы), получают одинаковое имя файла
  // и молча перезаписывают друг друга.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const rnd   = uuidv7().slice(0, 6);

  // WAL-чекпоинт перед бэкапом: без него часть данных SQLite могла бы
  // оставаться только в -wal файле, который мы в бэкап не кладём —
  // TRUNCATE сбрасывает весь WAL в основной .sqlite файл и обнуляет его.
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) { /* не блокирующе */ }

  if (AdmZip) {
    // ZIP-архив со всеми файлами данных
    const name = `backup_${label}_${stamp}_${rnd}.zip`;
    const dest = path.join(BACKUP_DIR, name);
    const zip  = new AdmZip();
    const dbSrc     = path.join(DATA_DIR, 'db.json');
    const cfgSrc    = path.join(DATA_DIR, 'config.json');
    const sqliteSrc = path.join(DATA_DIR, 'it-assets.sqlite');
    if (fs.existsSync(dbSrc))     zip.addLocalFile(dbSrc,     '', 'db.json');
    if (fs.existsSync(cfgSrc))    zip.addLocalFile(cfgSrc,    '', 'config.json');
    if (fs.existsSync(sqliteSrc)) zip.addLocalFile(sqliteSrc, '', 'it-assets.sqlite');
    // Фото активов — без этого фото молча терялись бы при восстановлении
    // из бэкапа (метаданные в SQLite восстановились бы, сами файлы —
    // нет). addLocalFolder no-op'ает, если папки нет вообще (свежая
    // установка без единого загруженного фото) — не оборачиваем в try/catch.
    const attachmentsSrc = ATTACHMENTS_DIR;
    if (fs.existsSync(attachmentsSrc)) zip.addLocalFolder(attachmentsSrc, 'attachments');
    zip.writeZip(dest);
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'zip' };
  } else {
    // Fallback — только db.json (если adm-zip не установлен)
    const name = `backup_${label}_${stamp}_${rnd}.json`;
    const dest = path.join(BACKUP_DIR, name);
    const dbSrc = path.join(DATA_DIR, 'db.json');
    if (!fs.existsSync(dbSrc)) return { ok: false, error: 'db.json не найден' };
    fs.copyFileSync(dbSrc, dest);
    // Рядом сохраняем config
    const cfgSrc = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, dest.replace('.json', '.config.json'));
    // NB: без ZIP (fallback-режим) it-assets.sqlite не бэкапится — это
    // уже известное ограничение fallback-режима (см. предупреждение при
    // восстановлении ниже), не специфично для SQLite.
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'json' };
  }
}

// Лимиты хранения по типам бэкапов.
// Каждый тип чистится независимо — startup-бэкапы не вытесняют manual.
const BACKUP_LIMITS = {
  auto:          20, // hourly (раз в час)
  startup:       10, // каждый рестарт сервера
  manual:        20, // созданные вручную оператором
  'pre-restore':  5, // автоматические перед восстановлением
};
const BACKUP_LIMIT_DEFAULT = 10; // для неизвестных меток

// SEC-10: помимо лимита по количеству на тип, ограничиваем ещё и суммарный
// размер папки backups/ — иначе большая база (много вложений/учёток) при
// лимите "20 штук на тип" всё равно могла разрастись на несколько
// гигабайт. Настраивается через переменную окружения (читаем её заново на
// каждый вызов, а не один раз при старте — так её можно докрутить без
// перезапуска сервера и это же удобно тестировать).
function _backupMaxTotalBytes() {
  return (parseInt(process.env.IT_ASSETS_BACKUP_MAX_MB) || 2048) * 1024 * 1024; // 2GB по умолчанию
}

function pruneBackups() {
  const allFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'));

  // Группируем по метке (второй сегмент: backup_<label>_...)
  const byLabel = {};
  for (const f of allFiles) {
    const m = f.match(/^backup_([^_]+)_/);
    const label = m ? m[1] : 'unknown';
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs });
  }

  const _removeBackupFile = (name) => {
    fs.unlinkSync(path.join(BACKUP_DIR, name));
    const pair = path.join(BACKUP_DIR, name.replace('.json', '.config.json'));
    if (fs.existsSync(pair)) fs.unlinkSync(pair);
  };

  for (const [label, files] of Object.entries(byLabel)) {
    const keep = BACKUP_LIMITS[label] ?? BACKUP_LIMIT_DEFAULT;
    files.sort((a, b) => b.mtime - a.mtime);
    files.slice(keep).forEach(f => _removeBackupFile(f.name));
  }

  // SEC-10: суммарный размер — считаем то, что осталось после чистки по
  // количеству, и при превышении лимита удаляем самые старые файлы по
  // ВСЕЙ папке (не по типу), пока не впишемся. Самый свежий бэкап никогда
  // не трогаем — иначе можно случайно остаться совсем без бэкапов.
  const maxBytes = _backupMaxTotalBytes();
  let remaining = fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, mtime: st.mtimeMs, size: st.size };
    });

  let total = remaining.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes && remaining.length > 1) {
    remaining.sort((a, b) => a.mtime - b.mtime); // старые первыми
    for (const f of remaining) {
      if (total <= maxBytes || remaining.length <= 1) break;
      _removeBackupFile(f.name);
      total -= f.size;
      remaining = remaining.filter(x => x.name !== f.name);
    }
  }
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      // Определяем что внутри
      const hasConfig = f.endsWith('.zip') ||
        fs.existsSync(path.join(BACKUP_DIR, f.replace('.json', '.config.json')));
      return { name: f, size: st.size, mtime: st.mtime.toISOString(), full: hasConfig };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// INFRA (взято на заметку из atlas-server/backupScheduler.js): там
// автобэкап настраивается через env-переменные (вкл/выкл, интервал,
// сколько хранить). У нас лимит хранения уже настраивается по-другому
// (BACKUP_LIMITS по типам, см. выше) и модель другая — не "раз в сутки в
// заданный час", а "каждые N минут с момента старта", поэтому переносить
// их backupScheduler.js целиком не имеет смысла (у нас и так более развитая
// система: ZIP с БД+конфигом, раздельные лимиты на 4 типа бэкапов,
// глобальный лимит по размеру папки). Взяли только саму идею
// настраиваемости через env — раньше интервал был жёстко зашит на час.
//
// По умолчанию поведение НЕ меняется (включено, раз в час) — это те же
// значения, что были захардкожены раньше, просто теперь переопределяемые.
function isAutoBackupEnabled() {
  const v = process.env.IT_ASSETS_AUTO_BACKUP_ENABLED;
  return v === undefined || v === '' || v === '1' || v.toLowerCase() === 'true';
}
function autoBackupIntervalMs() {
  const min = parseInt(process.env.IT_ASSETS_AUTO_BACKUP_INTERVAL_MIN);
  return (Number.isInteger(min) && min > 0 ? min : 60) * 60 * 1000;
}

// Фоновые таймеры бэкапа отключены в тестах (NODE_ENV=test, Jest выставляет это
// значение автоматически): иначе они реально пишут zip-файлы на диск и стреляют
// уже после teardown окружения Jest, что ломает вывод тестов.
if (process.env.NODE_ENV !== 'test' && isAutoBackupEnabled()) {
  setInterval(() => {
    try {
      const result = makeBackup('auto');
      logger.info('Backup', `auto: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { logger.error('Backup', 'auto failed', e.message); }
  }, autoBackupIntervalMs());

  setTimeout(() => {
    try {
      const result = makeBackup('startup');
      logger.info('Backup', `startup: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { logger.error('Backup', 'startup failed', e.message); }
  }, 10_000);
} else if (process.env.NODE_ENV !== 'test') {
  logger.info('Backup', 'автобэкап выключен (IT_ASSETS_AUTO_BACKUP_ENABLED=0) — только вручную/при старте');
}

router.get('/list', requireAuth, (req, res) => {
  try { res.json(listBackups()); } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/create', requireAuth, (req, res) => {
  try { res.json(makeBackup('manual')); } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/download/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  res.download(file, name);
});

// SEC-6: базовая проверка, что файл действительно похож на бэкап it-assets,
// прежде чем перезаписывать им живые данные. Не полноценная JSON-схема
// (это SEC-9, отдельная задача) — только защита от явно мусорного/битого
// содержимого: невалидный JSON, чужой формат файла, битая сигнатура sqlite.
function _validateDbJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('db.json в бэкапе повреждён или не является валидным JSON'); }
  if (!parsed || !Array.isArray(parsed.assets) || !Array.isArray(parsed.history))
    throw new Error('db.json в бэкапе не похож на бэкап it-assets (нет assets[]/history[])');
  return parsed;
}
function _validateConfigJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('config.json в бэкапе повреждён или не является валидным JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.settings !== 'object')
    throw new Error('config.json в бэкапе не похож на бэкап it-assets (нет объекта settings)');
  return parsed;
}
function _validateSqliteHeader(buf) {
  const header = buf.slice(0, 16).toString('utf8');
  if (header !== 'SQLite format 3\u0000')
    throw new Error('it-assets.sqlite в бэкапе повреждён (неверная сигнатура файла)');
}

router.post('/restore/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  try {
    if (name.endsWith('.zip') && AdmZip) {
      const zip = new AdmZip(file);
      const entries = zip.getEntries();
      const dbEntry     = entries.find(e => e.entryName === 'db.json');
      const configEntry = entries.find(e => e.entryName === 'config.json');
      const sqliteEntry = entries.find(e => e.entryName === 'it-assets.sqlite');

      // Проверяем ДО любой записи на диск — если что-то не так, restore
      // отменяется целиком, живые файлы не трогаются.
      if (dbEntry)     _validateDbJson(dbEntry.getData().toString('utf8'));
      if (configEntry) _validateConfigJson(configEntry.getData().toString('utf8'));
      if (sqliteEntry) _validateSqliteHeader(sqliteEntry.getData());

      makeBackup('pre-restore'); // сохраняем текущее состояние

      if (dbEntry)     zip.extractEntryTo('db.json',     DATA_DIR, false, true);
      if (configEntry) zip.extractEntryTo('config.json', DATA_DIR, false, true);
      // Старые бэкапы (до Фазы 7c) не содержат it-assets.sqlite — это
      // нормально, тогда SQL-таблицы просто останутся как были на диске.
      if (sqliteEntry) {
        zip.extractEntryTo('it-assets.sqlite', DATA_DIR, false, true);
        // WAL/SHM-файлы предыдущей сессии больше не соответствуют
        // восстановленному основному файлу — удаляем, чтобы SQLite не
        // попытался применить их поверх при следующем открытии.
        for (const suffix of ['-wal', '-shm']) {
          const stale = path.join(DATA_DIR, 'it-assets.sqlite' + suffix);
          if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }
      }
      // Фото активов — старые бэкапы (до этой фичи) не содержат
      // attachments/ вообще, это нормально (просто нечего восстанавливать).
      // Полностью заменяем папку (не сливаем с текущей) — так restore из
      // старого бэкапа корректно откатывает и удаления фото, а не только
      // добавления. Извлекаем точечно только записи attachments/ — не
      // extractAllTo, чтобы не задваивать уже точечно извлечённые выше
      // db.json/config.json/it-assets.sqlite.
      const attachmentEntries = entries.filter(e => e.entryName.startsWith('attachments/') && !e.isDirectory);
      if (attachmentEntries.length) {
        if (fs.existsSync(ATTACHMENTS_DIR)) fs.rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
        for (const entry of attachmentEntries) {
          // entryName вида "attachments/<asset_id>/<file>" — убираем
          // ведущий "attachments/", extractEntryTo кладёт остаток пути
          // относительно ATTACHMENTS_DIR, создавая подпапки сам.
          const relPath = entry.entryName.slice('attachments/'.length);
          const destPath = path.join(ATTACHMENTS_DIR, relPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, entry.getData(), { mode: 0o600 });
        }
      }
      res.json({
        ok: true, restored: name, full: true,
        note: 'Изменения вступят в силу после перезапуска сервера (как и для db.json/config.json).',
      });
    } else {
      // Fallback — только db.json
      const raw = fs.readFileSync(file, 'utf8');
      _validateDbJson(raw);

      const cfgBak = file.replace('.json', '.config.json');
      const hasCfg = fs.existsSync(cfgBak);
      if (hasCfg) _validateConfigJson(fs.readFileSync(cfgBak, 'utf8'));

      makeBackup('pre-restore');
      fs.copyFileSync(file, path.join(DATA_DIR, 'db.json'));
      if (hasCfg) {
        fs.copyFileSync(cfgBak, path.join(DATA_DIR, 'config.json'));
        res.json({ ok: true, restored: name, full: true });
      } else {
        res.json({ ok: true, restored: name, full: false,
          warn: 'config.json не восстановлен — бэкап содержит только db.json' });
      }
    }
  } catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
module.exports.makeBackup   = makeBackup;
module.exports.listBackups  = listBackups;
module.exports.BACKUP_DIR   = BACKUP_DIR;
