/**
 * server/routes/assets.routes.js
 *
 * Фаза 4 рефакторинга: роуты активов, вынесенные из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const db = require('../database');
const assetsRepo = require('../repositories/assets.repo');
const photosRepo = require('../repositories/photos.repo');
const { requireAuth, requireLogin, requireOrgAccess, changedBy } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createAssetSchema, updateAssetSchema, moveAssetSchema,
        bulkMoveAssetsSchema, bulkAssignInvSchema, bulkUpdateMetaSchema, addAssetPhotoSchema } = require('../validation/schemas');

const router = express.Router();

// PROD-9: извлечение org_id затрагиваемой записи для requireOrgAccess.
// Создание: тело содержит `org` (СВОБОДНЫЙ ТЕКСТ, имя) — резолвим по
// справочнику org_id ТАК ЖЕ, как это позже сделает сам репозиторий
// (_resolveWriteIds). Если имя не резолвится ни в один org_id — не
// блокируем (light-версия, не строгая изоляция — см. комментарий у
// requireOrgAccess).
function _orgIdFromCreateBody(req) {
  const name = (req.body?.org || '').trim();
  if (!name) return null;
  const found = db.config.getOrgs(true).find(o => o.name.trim().toLowerCase() === name.toLowerCase());
  return found ? found.id : null;
}
// Обновление/удаление/перемещение одного актива: смотрим на org_id уже
// СУЩЕСТВУЮЩЕЙ записи (не на тело запроса — тело может вообще не менять
// org, а ограниченный пользователь должен быть ограничен тем, что у
// актива УЖЕ есть, а не тем, что он сам укажет).
function _orgIdOfExistingAsset(req) {
  const asset = assetsRepo.getAssetById(req.params.id);
  return asset ? asset.org_id : null;
}

// INFRA-7: раньше эти три роута были без requireAuth — активы (включая
// серийные номера, ответственных, локации) отдавались без авторизации
// любому, кто достучится до API, хотя фронтенд прячет вкладки os/small/infra
// за логином (см. router.js, _protected). Тот же класс проблемы, что нашли
// в procure-it на /system-info: защита была только в UI, не в API.
router.get('/', requireLogin, (req, res) => {
  res.json(assetsRepo.listAssets(req.query));
});

router.get('/search', requireLogin, (req, res) => {
  if (req.query.q === undefined) return res.status(400).json({ error: 'q required' });
  res.json(assetsRepo.searchAssets(req.query.q));
});

router.get('/:id', requireLogin, (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(asset);
});

// PROD-10: история снапшотов записи. requireLogin (не requireAuth) — это
// чтение, тот же уровень доступа, что у самой карточки актива/её фото.
router.get('/:id/versions', requireLogin, (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(assetsRepo.getAssetVersions(req.params.id));
});

router.post('/', requireAuth, requireOrgAccess(_orgIdFromCreateBody), validate(createAssetSchema), (req, res) => {
  try { res.json(assetsRepo.createAsset(req.body, changedBy(req))); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAuth, requireOrgAccess(_orgIdOfExistingAsset), validate(updateAssetSchema), (req, res) => {
  try { res.json(assetsRepo.updateAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, requireOrgAccess(_orgIdOfExistingAsset), (req, res) => {
  try { res.json(assetsRepo.retireAsset(req.params.id, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.post('/:id/move', requireAuth, requireOrgAccess(_orgIdOfExistingAsset), validate(moveAssetSchema), (req, res) => {
  try { res.json(assetsRepo.moveAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

// PROD-9: bulk-роуты ниже (bulk-move/bulk-assign-inv/bulk-update-meta)
// НЕ прикрыты requireOrgAccess в этой light-версии — потребовал бы
// резолвить org_id КАЖДОГО ассета в пачке ещё на уровне роута (до валидации
// схемы), задваивая часть работы, которую сам репозиторий и так делает
// внутри транзакции. Известное ограничение, не молчаливый пропуск —
// см. роадмап/SCHEMA.md.
router.post('/bulk-move', requireAuth, validate(bulkMoveAssetsSchema), (req, res) => {
  try { res.json(assetsRepo.bulkMoveAssets(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/bulk-assign-inv', requireAuth, validate(bulkAssignInvSchema), (req, res) => {
  try { res.json(assetsRepo.bulkAssignInv(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 400).json({ error: e.message }); }
});

// PROD-19
router.post('/bulk-update-meta', requireAuth, validate(bulkUpdateMetaSchema), (req, res) => {
  try { res.json(assetsRepo.bulkUpdateMeta(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 400).json({ error: e.message }); }
});

// ─── Фото активов ────────────────────────────────────────────────────────
// requireLogin на чтение (список/сама картинка) — та же логика, что и на
// остальные read-роуты выше (INFRA-7): viewer должен видеть фото, не
// только оператор/админ. requireAuth (edit-режим) — на загрузку/удаление.

router.get('/:id/photos', requireLogin, (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Актив не найден' });
  res.json(photosRepo.listPhotos(req.params.id));
});

router.post('/:id/photos', requireAuth, validate(addAssetPhotoSchema), (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Актив не найден' });
  try {
    const photo = photosRepo.addPhoto(req.params.id, req.body.photo, req.body.original_name, changedBy(req));
    res.json(photo);
  } catch (e) {
    res.status(e.badRequest ? 400 : 400).json({ error: e.message });
  }
});

router.get('/:id/photos/:photoId', requireLogin, (req, res) => {
  const photo = photosRepo.getPhoto(req.params.id, req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Фото не найдено' });
  const filePath = photosRepo.photoFilePath(req.params.id, photo);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден на диске' });
  // Кэшируем на клиенте — фото после загрузки не меняются (только
  // удаляются/заменяются новой записью с новым id), безопасно кэшировать
  // надолго по неизменяемому URL (id фото в пути).
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});

router.delete('/:id/photos/:photoId', requireAuth, (req, res) => {
  try {
    res.json(photosRepo.deletePhoto(req.params.id, req.params.photoId));
  } catch (e) {
    res.status(e.notFound ? 404 : 400).json({ error: e.message });
  }
});

module.exports = router;
