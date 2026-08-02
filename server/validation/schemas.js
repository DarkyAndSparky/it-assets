/**
 * server/validation/schemas.js
 *
 * SEC-9: схемы валидации входных данных (zod), по одному блоку на роут-группу.
 * Заполняется постепенно по подэтапам VAL-1…VAL-6 — не весь проект сразу.
 *
 * Правила, общие для всех схем в этом файле:
 *  - .trim() на строковых полях, где важен человеческий ввод (имя, логин,
 *    название) — чтобы " Иванов " и "Иванов" не считались разными записями.
 *  - Явные .max() на свободных текстовых полях — защита от абсурдно длинных
 *    значений (вставленный по ошибке огромный текст), не только от пустых.
 *  - Где старое поведение допускало пустую строку как валидное значение
 *    (например, PIN пуст — это фича viewer-логина без пароля, см. SEC-2),
 *    схема ЭТО СОХРАНЯЕТ, а не запрещает — задача SEC-9 добавить проверки,
 *    а не тихо изменить бизнес-правила, которые чинили в SEC-1..10.
 */
'use strict';

const { z } = require('zod');

// ─── Пользователи системы ──────────────────────────────────────────────────

const ROLES = ['admin', 'operator', 'viewer'];

// PIN может быть пустым (осознанно — viewer без пароля, SEC-2), но если
// не пустой — не короче 4 символов (это и раньше требовал фронт, теперь
// то же самое требование есть и на бэкенде, а не только в браузере).
const pinField = z.string()
  .max(100, 'Слишком длинный пароль')
  .refine(v => v === '' || v.length >= 4, { message: 'Пароль — минимум 4 символа (или пусто)' });

const createUserSchema = z.object({
  name:  z.string().trim().min(1, 'Имя обязательно').max(200, 'Слишком длинное имя'),
  login: z.string().trim().max(100, 'Слишком длинный логин').default(''),
  role:  z.enum(ROLES, { message: 'Роль должна быть admin, operator или viewer' }).default('operator'),
  pin:   pinField.default(''),
  email: z.string().trim().max(200, 'Слишком длинный email').default(''),
  can_view_accounts: z.coerce.boolean().default(false),
});

const updateUserSchema = z.object({
  name:  z.string().trim().min(1, 'Имя не может быть пустым').max(200, 'Слишком длинное имя').optional(),
  login: z.string().trim().max(100, 'Слишком длинный логин').optional(),
  role:  z.enum(ROLES, { message: 'Роль должна быть admin, operator или viewer' }).optional(),
  pin:   pinField.optional(),
  email: z.string().trim().max(200, 'Слишком длинный email').optional(),
  active: z.coerce.boolean().optional(),
  can_view_accounts: z.coerce.boolean().optional(),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
};
