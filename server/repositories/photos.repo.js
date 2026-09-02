/**
 * server/repositories/photos.repo.js
 *
 * Фото активов — важная вставка вне Track 9 (пользователь попросил сделать
 * это отдельно, до продолжения аудита): возможность прикрепить к карточке
 * актива фотографии (шильдик с серийным номером/IMEI, характеристики на
 * этикетке и т.п.), сделанные телефоном.
 *
 * Метаданные — в SQLite (таблица asset_photos, см. db/sqlite.js), сами
 * байты изображения — на диске под DATA_DIR/attachments/<asset_id>/.
 * Приходят с фронтенда как base64 data URL (тот же паттерн, что уже
 * используется для логотипа компании — settings.routes.js/putLogoSvgSchema,
 * public/js/views/settings-general.js/saveLogoSvg) — не понадобилось
 * тащить multer/busboy для multipart-загрузки.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');
const { DATA_DIR } = require('../db/store');

const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

// Ограничения — консервативные, но реалистичные для фото с телефона.
const MAX_PHOTO_BYTES  = 8 * 1024 * 1024; // 8MB на файл (после декодирования из base64)
const MAX_PHOTOS_PER_ASSET = 20;

const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/heic': 'heic', // некоторые iPhone шлют HEIC даже из веб-формы
};

function assetDir(assetId) {
  return path.join(ATTACHMENTS_DIR, assetId);
}

function ensureAssetDir(assetId) {
  const dir = assetDir(assetId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Парсит data URL (`data:image/jpeg;base64,...`) → { mime, buffer }.
 * Бросает Error с понятным сообщением на любую некорректность — вызывающий
 * код (роут) сам решает, как это подать пользователю (400 обычно).
 */
function parseDataUrl(dataUrl) {
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Ожидается data URL вида data:image/...;base64,...');
  const [, mime, b64] = m;
  if (!ALLOWED_MIME[mime]) {
    throw new Error(`Неподдерживаемый формат изображения: ${mime}. Разрешены: ${Object.keys(ALLOWED_MIME).join(', ')}`);
  }
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); }
  catch (e) { throw new Error('Некорректные base64-данные'); }
  if (buffer.length === 0) throw new Error('Пустой файл');
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error(`Файл слишком большой (${(buffer.length/1024/1024).toFixed(1)} MB, максимум ${MAX_PHOTO_BYTES/1024/1024} MB)`);
  }
  return { mime, ext: ALLOWED_MIME[mime], buffer };
}

function listPhotos(assetId) {
  return sqlite.prepare(
    `SELECT id, filename, original_name, size_bytes, uploaded_by, uploaded_at
     FROM asset_photos WHERE asset_id = ? ORDER BY uploaded_at ASC`
  ).all(assetId);
}

function countPhotos(assetId) {
  return sqlite.prepare('SELECT COUNT(*) c FROM asset_photos WHERE asset_id = ?').get(assetId).c;
}

function getPhoto(assetId, photoId) {
  return sqlite.prepare(
    'SELECT * FROM asset_photos WHERE id = ? AND asset_id = ?'
  ).get(photoId, assetId);
}

/** Путь к файлу на диске для отдачи через res.sendFile()/res.download() */
function photoFilePath(assetId, photo) {
  return path.join(assetDir(assetId), photo.filename);
}

/**
 * @param assetId    ID актива (вызывающий код уже проверил, что актив существует)
 * @param dataUrl    data:image/...;base64,... строка с фронтенда
 * @param originalName исходное имя файла (для отображения в UI, опционально)
 * @param uploadedBy имя пользователя (changedBy(req))
 */
function addPhoto(assetId, dataUrl, originalName, uploadedBy) {
  if (countPhotos(assetId) >= MAX_PHOTOS_PER_ASSET) {
    const err = new Error(`Максимум ${MAX_PHOTOS_PER_ASSET} фото на актив`);
    err.badRequest = true;
    throw err;
  }
  const { ext, buffer } = parseDataUrl(dataUrl);
  const id = uuidv7();
  const filename = `${id}.${ext}`;

  ensureAssetDir(assetId);
  fs.writeFileSync(photoFilePath(assetId, { filename }), buffer, { mode: 0o600 });

  const uploaded_at = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO asset_photos (id, asset_id, filename, original_name, size_bytes, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, assetId, filename, String(originalName || '').slice(0, 200), buffer.length, uploadedBy || '', uploaded_at);

  return { id, asset_id: assetId, filename, original_name: originalName || '', size_bytes: buffer.length, uploaded_by: uploadedBy || '', uploaded_at };
}

function deletePhoto(assetId, photoId) {
  const photo = getPhoto(assetId, photoId);
  if (!photo) {
    const err = new Error('Фото не найдено');
    err.notFound = true;
    throw err;
  }
  const filePath = photoFilePath(assetId, photo);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* файл уже мог исчезнуть — не блокируем удаление записи */ }
  sqlite.prepare('DELETE FROM asset_photos WHERE id = ? AND asset_id = ?').run(photoId, assetId);
  return { ok: true };
}

module.exports = {
  ATTACHMENTS_DIR,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ASSET,
  listPhotos,
  countPhotos,
  getPhoto,
  photoFilePath,
  addPhoto,
  deletePhoto,
  parseDataUrl, // экспортирован для валидатора (превентивная проверка формата до вызова репозитория)
};
