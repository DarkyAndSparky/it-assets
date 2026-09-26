#!/usr/bin/env node
/**
 * scripts/bump-version.js
 *
 * Вычисляет и записывает СЛЕДУЮЩУЮ версию в файл VERSION (формат
 * <alpha|beta>-N-YYwWW-NN, см. sync-version.js) на основе ТЕКУЩЕЙ даты и
 * уже записанной версии — так на каждый реальный релиз/сборку не нужно
 * вручную считать ISO-неделю в уме.
 *
 * ПОЧЕМУ ЭТО НЕ ЧАСТЬ sync-version.js: тот скрипт — чистая пропагация уже
 * готовой строки версии по файлам (package.json/README/docs/docker-compose/
 * sw.js), БЕЗ обращения к дате — идемпотентен, два прогона подряд без
 * изменения VERSION дают одинаковый результат везде. Если бы sync-version.js
 * сам вычислял неделю по текущей дате при каждом запуске, два прогона в
 * разные дни без реального релиза давали бы РАЗНЫЙ результат — версия
 * перестала бы быть детерминированной (испортило бы, например, повторный
 * прогон CI без нового коммита). Разделено: bump-version.js — считает и
 * решает (вызывается один раз за релиз/сборку), sync-version.js — как был,
 * просто разносит уже решённое значение (можно гонять сколько угодно раз).
 *
 * ПОЧЕМУ НЕ ДУБЛИРУЕТ tools/release/release.sh: тот берёт версию ЯВНЫМ
 * аргументом (`release.sh 26w36-r01`) и делает полный релизный флоу (merge
 * в main, git tag, push) — сознательно без автоматики в выборе номера,
 * чтобы релиз был осознанным явным действием. Этот скрипт — для
 * повседневных сборок в dev без полного релизного флоу: не считать неделю
 * в уме перед тем, как решить, какую строку передать дальше (хоть в
 * release.sh, хоть просто записать в VERSION и прогнать sync-version.js).
 *
 * ЛОГИКА: та же ISO-неделя, что уже в VERSION — счётчик NN просто +1.
 * Неделя сменилась (обычно в понедельник) — счётчик сбрасывается на 01,
 * подставляется новая неделя. ISO-неделя (не наивный getMonth()/getDate())
 * — недели считаются с понедельника, первая неделя года — та, что содержит
 * первый четверг года; это единственный способ, который не ломается на
 * границе года (29 декабря 2025 — уже неделя 1 2026-го). Реализация
 * проверена против Python `datetime.date.isocalendar()` на граничных датах
 * (переход года в обе стороны, 53-недельный год) — совпадает один в один.
 *
 * Запуск: node scripts/bump-version.js [--stage=alpha|beta] [--n=1]
 *   (флаги — на случай будущего перехода alpha→beta или смены N, по
 *   умолчанию оба берутся из уже записанной версии, не трогаются).
 * После — как обычно, node scripts/sync-version.js разносит результат.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const VERSION_RE   = /^(alpha|beta)-(\d+)-(\d{2}w\d{2})-(\d+)$/;

// ISO-8601: недели с понедельника, неделя 1 года — та, что содержит первый
// четверг этого года. Сдвигаем дату на четверг ТЕКУЩЕЙ недели — тогда год
// этого четверга и есть ISO-год (решает год-граничные случаи разом).
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Пн=0 ... Вс=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // четверг этой недели
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return { year: date.getUTCFullYear(), week };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function computeNextVersion(currentVersion, now, overrides) {
  const m = currentVersion.match(VERSION_RE);
  const { year, week } = isoWeek(now);
  const yy = pad2(year % 100);
  const ww = pad2(week);
  const thisWeekKey = `${yy}w${ww}`;

  if (!m) {
    // Нет текущей версии в распознаваемом формате (первый запуск в
    // новом репозитории/сломанный файл) — начинаем с 01 на текущей
    // неделе, по умолчанию beta-1. Не пытаемся угадать N/stage из
    // мусора — явные флаги для этого случая и существуют.
    const stage = overrides.stage || 'beta';
    const n = overrides.n || 1;
    return `${stage}-${n}-${thisWeekKey}-01`;
  }

  const [, stage, n, prevWeekKey, prevSeq] = m;
  const finalStage = overrides.stage || stage;
  const finalN = overrides.n || n;
  const sameWeek = prevWeekKey === thisWeekKey;
  const nextSeq = sameWeek ? pad2(Number(prevSeq) + 1) : '01';
  return `${finalStage}-${finalN}-${thisWeekKey}-${nextSeq}`;
}

function main() {
  const args = process.argv.slice(2);
  const overrides = {};
  for (const a of args) {
    const stageMatch = a.match(/^--stage=(alpha|beta)$/);
    const nMatch = a.match(/^--n=(\d+)$/);
    if (stageMatch) overrides.stage = stageMatch[1];
    else if (nMatch) overrides.n = nMatch[1];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/bump-version.js [--stage=alpha|beta] [--n=N]');
      process.exit(0);
    } else {
      console.error(`[bump-version] Неизвестный флаг: ${a}`);
      process.exit(1);
    }
  }

  const current = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').trim() : '';
  const next = computeNextVersion(current, new Date(), overrides);

  if (next === current) {
    // Не должно случиться в нормальном флоу (счётчик всегда растёт или
    // неделя меняется), но если вдруг — не пишем файл зря/не путаем
    // git diff отсутствием изменений там, где их и не должно быть.
    console.log(`[bump-version] Версия не изменилась: ${next}`);
    return;
  }

  fs.writeFileSync(VERSION_FILE, next);
  console.log(`[bump-version] ${current || '(нет)'} → ${next}`);
  console.log('[bump-version] Не забудьте прогнать: node scripts/sync-version.js');
}

// Экспортируем computeNextVersion/isoWeek отдельно от main() — так их
// можно протестировать напрямую (чистые функции, без обращения к
// файловой системе/process.argv), не гоняя реальный процесс на каждый
// тестовый случай.
if (require.main === module) main();
module.exports = { computeNextVersion, isoWeek };
