/**
 * server/routes/metrics.routes.js
 *
 * IDEA-5: лёгкий машиночитаемый снимок состояния системы — для скриптов
 * мониторинга/периодического опроса. requireAdmin: размер файлов БД и
 * данные о бэкапах — та же чувствительность, что и у /api/settings/
 * system-info (внутренние детали инфраструктуры, не для рядового viewer).
 */
'use strict';

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const metricsRepo = require('../repositories/metrics.repo');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  res.json(metricsRepo.getMetrics());
});

module.exports = router;
