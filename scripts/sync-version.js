/**
 * scripts/sync-version.js
 *
 * INFRA-4: package.json — единственный источник правды для версии (как и
 * задокументировано в docs/index.html, строка ~407). Этот скрипт раскидывает
 * её по местам, где версия дублируется как отображаемый текст:
 *   - README.md — бейдж версии (shields.io)
 *   - docs/index.html — версия в сайдбаре
 *
 * server/index.js и server/routes/settings.routes.js версию НЕ дублируют —
 * они читают её из package.json в рантайме (`require('../../package.json')`),
 * так что синхронизировать там нечего.
 *
 * Формат версии: <alpha|beta>-N-YYwWW-NN (например beta-1-26w29-01).
 * Человекочитаемое отображение — тот же transform, что и в server/index.js:
 *   alpha-N- → αN ·   |   beta-N- → βN ·   |   остальные "-" → "·"
 *
 * Запуск: node scripts/sync-version.js (вручную, не хук — версия меняется
 * не при каждом коммите, а осознанным решением при релизе/милстоуне).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const PKG_PATH    = path.join(ROOT, 'package.json');
const README_PATH = path.join(ROOT, 'README.md');
const DOCS_PATH    = path.join(ROOT, 'docs', 'index.html');

const VERSION_RE = /^(alpha|beta)-(\d+)-(\d{2}w\d{2})-(\d+)$/;

function toDisplay(version) {
  const m = version.match(VERSION_RE);
  if (!m) return version; // неизвестный формат — отдаём как есть, не пытаемся угадать
  const [, stage, n, week, seq] = m;
  const stageChar = stage === 'alpha' ? 'α' : 'β';
  return `${stageChar}${n} · ${week}·${seq}`;
}

function updateReadmeBadge(version, content) {
  // ![Version](.../версия-<текст>-blue?...)
  const re = /(!\[Version\]\(https:\/\/img\.shields\.io\/badge\/версия-)([^-]+(?:%C2%B7[^-]+)*)(-blue[^)]*\))/;
  if (!re.test(content)) {
    console.warn('[sync-version] README.md: бейдж версии не найден по ожидаемому паттерну — пропускаю.');
    return { content, changed: false };
  }
  const display = toDisplay(version).replace(/ /g, '');
  const next = content.replace(re, `$1${display}$3`);
  return { content: next, changed: next !== content };
}

function updateDocsVersion(version, content) {
  // <div class="version">...</div> в сайдбаре
  const re = /(<div class="version">)([^<]*)(<\/div>)/;
  if (!re.test(content)) {
    console.warn('[sync-version] docs/index.html: блок .version не найден — пропускаю.');
    return { content, changed: false };
  }
  const display = toDisplay(version);
  const next = content.replace(re, `$1${display}$3`);
  return { content: next, changed: next !== content };
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const version = pkg.version;
  if (!version) {
    console.error('[sync-version] package.json: поле version отсутствует.');
    process.exit(1);
  }

  if (!VERSION_RE.test(version)) {
    console.warn(`[sync-version] Версия "${version}" не соответствует формату <alpha|beta>-N-YYwWW-NN — отображение может быть некорректным.`);
  }

  let anyChanged = false;

  if (fs.existsSync(README_PATH)) {
    const readme = fs.readFileSync(README_PATH, 'utf8');
    const { content, changed } = updateReadmeBadge(version, readme);
    if (changed) { fs.writeFileSync(README_PATH, content); console.log('[sync-version] README.md обновлён.'); anyChanged = true; }
  } else {
    console.warn('[sync-version] README.md не найден.');
  }

  if (fs.existsSync(DOCS_PATH)) {
    const docs = fs.readFileSync(DOCS_PATH, 'utf8');
    const { content, changed } = updateDocsVersion(version, docs);
    if (changed) { fs.writeFileSync(DOCS_PATH, content); console.log('[sync-version] docs/index.html обновлён.'); anyChanged = true; }
  } else {
    console.warn('[sync-version] docs/index.html не найден.');
  }

  console.log(`[sync-version] Текущая версия: ${version} (${toDisplay(version)})`);
  if (!anyChanged) console.log('[sync-version] Всё уже синхронизировано, изменений не потребовалось.');
}

main();
