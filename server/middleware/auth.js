/**
 * server/middleware/auth.js
 *
 * Фаза 2 рефакторинга (начата раньше срока — понадобилась роутам из Фазы 1,
 * чтобы избежать циклического require на index.js). Поведение не меняется.
 *
 * ВАЖНО: db берём через require('../database'), а не напрямую через
 * server/db/store.js. Тесты делают jest.mock('../server/database', ...) —
 * прямой импорт store.js обошёл бы мок и полез бы в реальные файлы на диске.
 */
'use strict';

const db = require('../database');

function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  const pwd    = req.headers['x-edit-password'] || '';

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = db.getUser(userId);
  if (!user || !user.active)
    return res.status(401).json({ error: 'Пользователь не найден или неактивен' });
  if (user.role === 'viewer')
    return res.status(403).json({ error: 'Недостаточно прав (viewer)' });
  if (!db.authUser(userId, pwd))
    return res.status(401).json({ error: 'Неверный пароль' });

  req.currentUser = user;
  return next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.currentUser?.role !== 'admin')
      return res.status(403).json({ error: 'Требуются права администратора' });
    next();
  });
}

function changedBy(req) {
  return req.currentUser?.name || 'редактор';
}

module.exports = { requireAuth, requireAdmin, changedBy };
