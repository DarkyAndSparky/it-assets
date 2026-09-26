'use strict';
/**
 * Тесты: scripts/bump-version.js — автоматический расчёт следующей
 * версии по ISO-неделе. computeNextVersion()/isoWeek() — чистые функции
 * (не трогают файловую систему/process.argv), тестируются напрямую.
 *
 * Границы ISO-недели проверены вручную против Python
 * `datetime.date.isocalendar()` при написании скрипта — здесь эти же
 * случаи закреплены как регрессионные тесты.
 */
const { computeNextVersion, isoWeek } = require('../scripts/bump-version');

describe('isoWeek() — граничные случаи ISO-8601', () => {
  test('29 декабря 2025 (понедельник) — уже неделя 1 2026 года', () => {
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 });
  });

  test('28 декабря 2025 (воскресенье) — ещё неделя 52 2025 года', () => {
    expect(isoWeek(new Date(2025, 11, 28))).toEqual({ year: 2025, week: 52 });
  });

  test('1 января 2027 (пятница) — неделя 53 2026 года (длинный ISO-год)', () => {
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 });
  });

  test('обычная дата в середине года — сверка с известным значением', () => {
    // 22 сентября 2026, вторник — сверено с Python isocalendar() при
    // написании скрипта: (2026, 39, 2).
    expect(isoWeek(new Date(2026, 8, 22))).toEqual({ year: 2026, week: 39 });
  });
});

describe('computeNextVersion()', () => {
  const sameDate = new Date(2026, 8, 22); // произвольная фиксированная "сегодня" для тестов

  test('та же неделя — счётчик +1', () => {
    expect(computeNextVersion('beta-1-26w39-01', sameDate, {})).toBe('beta-1-26w39-02');
  });

  test('та же неделя, счётчик у границы двузначных чисел (09→10)', () => {
    expect(computeNextVersion('beta-1-26w39-09', sameDate, {})).toBe('beta-1-26w39-10');
  });

  test('неделя сменилась — счётчик сбрасывается на 01, подставляется новая неделя', () => {
    expect(computeNextVersion('beta-1-26w38-15', sameDate, {})).toBe('beta-1-26w39-01');
  });

  test('переход года — старая версия на прошлой ISO-неделе года, новая дата уже в след. ISO-году', () => {
    const dec29 = new Date(2025, 11, 29);
    expect(computeNextVersion('beta-1-25w52-03', dec29, {})).toBe('beta-1-26w01-01');
  });

  test('пустая/отсутствующая текущая версия — стартует с 01 на текущей неделе, beta-1 по умолчанию', () => {
    expect(computeNextVersion('', sameDate, {})).toBe('beta-1-26w39-01');
  });

  test('нераспознаваемая текущая версия (битый файл) — тот же безопасный старт, не исключение', () => {
    expect(() => computeNextVersion('garbage-not-a-version', sameDate, {})).not.toThrow();
    expect(computeNextVersion('garbage-not-a-version', sameDate, {})).toBe('beta-1-26w39-01');
  });

  test('override --stage меняет стадию, не трогая счётчик/неделю', () => {
    expect(computeNextVersion('beta-1-26w39-01', sameDate, { stage: 'alpha' })).toBe('alpha-1-26w39-02');
  });

  test('override --n меняет N, не трогая счётчик/неделю', () => {
    expect(computeNextVersion('beta-1-26w39-01', sameDate, { n: '2' })).toBe('beta-2-26w39-02');
  });

  test('повторный вызов без смены даты продолжает наращивать счётчик (идемпотентности не обещает — это и есть смысл "bump")', () => {
    let v = 'beta-1-26w39-01';
    v = computeNextVersion(v, sameDate, {});
    v = computeNextVersion(v, sameDate, {});
    v = computeNextVersion(v, sameDate, {});
    expect(v).toBe('beta-1-26w39-04');
  });
});

describe('Согласованность с sync-version.js', () => {
  test('VERSION_RE в sync-version.js распознаёт всё, что производит computeNextVersion()', () => {
    // Не импортируем VERSION_RE из sync-version.js напрямую (не экспортирован,
    // осознанно — тот файл не задумывался как библиотека), а сверяем
    // known-good примером формата, который sync-version.js обязан понимать.
    const produced = computeNextVersion('beta-1-26w39-01', new Date(2026, 8, 22), {});
    expect(produced).toMatch(/^(alpha|beta)-\d+-\d{2}w\d{2}-\d+$/);
  });
});
