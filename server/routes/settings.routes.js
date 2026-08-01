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

router.put('/styles', requireAuth, (req, res) => {
  const { styles } = req.body || {};
  if (typeof styles !== 'object') return res.status(400).json({ error: 'object expected' });
  db.setSetting('styles', styles);
  res.json({ ok: true });
});

router.put('/logo_svg', requireAuth, (req, res) => {
  const { svg } = req.body || {};
  if (typeof svg !== 'string') return res.status(400).json({ error: 'svg string expected' });

  const val = svg.trim();

  // Допустимые форматы:
  // 1. SVG разметка: начинается с <svg
  // 2. base64 data URL: data:image/...
  // 3. Пустая строка — сброс логотипа
  const isSvg    = val.toLowerCase().startsWith('<svg');
  const isBase64 = val.startsWith('data:image/');
  const isEmpty  = val === '';

  if (!isSvg && !isBase64 && !isEmpty) {
    return res.status(400).json({ error: 'Unsupported logo format. Expected SVG markup or image data URL.' });
  }

  // Проверяем размер (макс 512 KB)
  if (val.length > 512 * 1024) {
    return res.status(400).json({ error: 'Logo too large (max 512 KB)' });
  }

  db.setSetting('logo_svg', val);
  res.json({ ok: true });
});

router.put('/company_name', requireAuth, (req, res) => {
  const { company_name } = req.body || {};
  if (!company_name || !company_name.trim())
    return res.status(400).json({ error: 'company_name required' });
  db.setSetting('company_name', company_name.trim());
  res.json({ ok: true, company_name: company_name.trim() });
});

router.put('/password', rateLimitLogin, requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || !newPassword.trim())
    return res.status(400).json({ error: 'newPassword required' });

  // Меняем PIN только текущего аутентифицированного пользователя —
  // requireAuth уже проверил x-user-id/x-edit-password выше.
  db.updateUser(req.currentUser.id, { pin: newPassword.trim() });
  res.json({ ok: true });
});

module.exports = router;
