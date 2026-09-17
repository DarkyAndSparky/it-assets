/**
 * server/routes/public.routes.js
 *
 * PROD-8: страница /scan — сканер (физический сканер QR/штрихкодов ИЛИ
 * камера телефона через BarcodeDetector) БЕЗ ВХОДА В СИСТЕМУ показывает
 * карточку устройства. Единственный роут в проекте, у которого сознательно
 * НЕТ requireAuth/requireLogin — это весь смысл фичи (человек нашёл
 * оборудование с QR-наклейкой, хочет узнать что это, не заводя учётку).
 *
 * Возвращает заведомо безопасное подмножество полей — подробности и
 * обоснование см. assetsRepo.getPublicAssetInfo().
 *
 * Rate limit: общий /api-лимитер (apiRateLimit.js, 300/мин GET на IP) —
 * этого достаточно, чтобы не дать перебирать инв.номера/серийники массовым
 * скриптом, отдельный лимитер не заводим (тот же уровень защиты, что у
 * прочих публичных GET в проекте — /api/health и т.п.).
 */
'use strict';

const express = require('express');
const assetsRepo = require('../repositories/assets.repo');

const router = express.Router();

router.get('/scan', (req, res) => {
  const code = req.query.code;
  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: 'code required' });
  }
  const asset = assetsRepo.getPublicAssetInfo(code);
  if (!asset) return res.status(404).json({ error: 'not_found' });
  res.json(asset);
});

module.exports = router;
