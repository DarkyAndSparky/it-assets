/**
 * server/routes/audit.routes.js
 *
 * В отличие от /api/history (намеренно публичного, см. INFRA-7),
 * общесистемный аудит-лог отдаётся только администраторам — здесь
 * действия пользователей друг о друге, это не витринные данные.
 */
'use strict';

const express = require('express');
const auditRepo = require('../repositories/audit.repo');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  res.json(auditRepo.listAudit(req.query));
});

module.exports = router;
