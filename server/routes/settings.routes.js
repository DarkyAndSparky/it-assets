/**
 * server/routes/settings.routes.js
 *
 * Фаза 3 рефакторинга: настройки, смена пароля и категории, вынесенные
 * из index.js без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { verifyPin } = require('../pin');
const { requireAuth } = require('../middleware/auth');
const { rateLimitLogin } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { putStylesSchema, putLogoSvgSchema, putCompanyNameSchema, putPasswordSchema } = require('../validation/schemas');

// Версия из package.json — та же логика, что была в index.js
const pkg = (() => { try { return require('../../package.json'); } catch(e) { return {}; } })();
const APP_VERSION = pkg.version || 'unknown';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    company_name: db.getSetting('company_name') || 'IT ASSETS',
    logo_svg:     db.getSetting('logo_svg')     || '',
    styles:       db.getSetting('styles')       || {},
    version:      APP_VERSION,
  });
});

router.put('/styles', requireAuth, validate(putStylesSchema), (req, res) => {
  db.setSetting('styles', req.body.styles);
  res.json({ ok: true });
});

router.put('/logo_svg', requireAuth, validate(putLogoSvgSchema), (req, res) => {
  db.setSetting('logo_svg', req.body.svg.trim());
  res.json({ ok: true });
});

router.put('/company_name', requireAuth, validate(putCompanyNameSchema), (req, res) => {
  db.setSetting('company_name', req.body.company_name);
  res.json({ ok: true, company_name: req.body.company_name });
});

router.put('/password', rateLimitLogin, requireAuth, validate(putPasswordSchema), (req, res) => {
  // Меняем PIN только текущего аутентифицированного пользователя —
  // requireAuth уже проверил x-user-id/x-edit-password выше.
  db.updateUser(req.currentUser.id, { pin: req.body.newPassword });
  res.json({ ok: true });
});

module.exports = router;
