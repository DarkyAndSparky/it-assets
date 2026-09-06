/**
 * public/js/views/settings-backup.js
 *
 * Хвост Фазы 5/6: бэкапы (createBackup/loadBackupList/restoreBackup) +
 * состояние справочников настроек (_settingsTab/_orgsCache/.../ensureRefData),
 * вынесенные из inline-скрипта в index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * LOC-6: найден и локализован во время финального прохода — не попал
 * в исходный список LOC-5 (0 вызовов t()), t()/I18N см. public/js/i18n.js.
 */

// ─── Состояние справочников (используется settings-refdata.js и asset-tab.js) ──
let _settingsTab = 'general'; // 'general' | 'orgs' | 'filials' | 'locations' | 'config'
let _orgsCache = [], _filialsCache = [], _locsCache = [];
// PROD-1/PROD-2: карта type_code (для резолва type-имени → код) и схема
// типизированных полей по коду — грузятся вместе с остальным ref-data,
// используются в meta-fields.js::getMetaFieldDefs().
let _typeCodesCache = [], _fieldSchemasCache = {};
let _refDataLoaded = false;

async function ensureRefData() {
  if (_refDataLoaded) return;
  try {
    // r.ok проверяем ДО r.json() — иначе тело ошибки (например 429 от
    // apiRateLimit.js: {error:"..."}) успешно парсится как JSON и тихо
    // становится "результатом" вместо ожидаемого массива/объекта: .catch()
    // ниже его не ловит, потому что промис не отклонился, он просто
    // resolve'ился не тем типом. Итог без этой проверки — оно молча
    // подставлялось в _orgsCache и т.п., а дальше падало в других местах
    // с непонятным "X.map is not a function", не показывая связи со
    // сбоем самого запроса.
    const asJson = r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    [_orgsCache, _filialsCache, _locsCache, _typeCodesCache, _fieldSchemasCache] = await Promise.all([
      fetch(`${API}/api/orgs`).then(asJson).catch(()=>[]),
      fetch(`${API}/api/filials`).then(asJson).catch(()=>[]),
      fetch(`${API}/api/locations`).then(asJson).catch(()=>[]),
      fetch(`${API}/api/type-codes`).then(asJson).catch(()=>[]),
      fetch(`${API}/api/field-schemas`).then(asJson).catch(()=>({})),
    ]);
    _refDataLoaded = true;
  } catch(e) { console.warn('ensureRefData failed', e); }
}

// ─── Бэкапы ──────────────────────────────────────────────────────────────────

async function createBackup() {
  const r = await fetch(`${API}/api/backup/create`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) { toast(t('msg_backup_created', { file: d.file, size: (d.size/1024).toFixed(1) }), 'success'); loadBackupList(); }
  else toast(d.error || t('msg_error'), 'error');
}

async function loadBackupList() {
  const el = document.getElementById('backup-list');
  if (!el) return;
  el.innerHTML = `<div class="u-text-muted">${t('msg_loading')}</div>`;
  const r = await fetch(`${API}/api/backup/list`, { headers:ah() });
  const list = await r.json();
  if (!list.length) { el.innerHTML = `<div class="u-text-muted">${t('msg_no_backups')}</div>`; return; }
  el.innerHTML = `
    <table class="backup-table">
      <thead><tr class="u-text-muted">
        <th class="u-text-left u-p-3-6">${t('th_file')}</th>
        <th class="u-p-3-6">${t('th_type')}</th>
        <th class="u-text-right u-p-3-6">${t('th_size')}</th>
        <th class="u-text-right u-p-3-6">${t('th_date_col')}</th>
        <th class="u-p-3-6"></th>
      </tr></thead>
      <tbody>${list.map(b => `
        <tr class="u-border-top">
          <td class="u-p-4-6 u-font-mono u-text-11">${esc(b.name)}</td>
          <td class="u-p-4-6 u-text-center">
            <span title="${b.full ? t('tooltip_full_backup') : t('tooltip_db_only')}"
              class="u-text-13">${b.full ? '🔒' : '⚠️'}</span>
          </td>
          <td class="u-p-4-6 u-text-right u-text-muted">${(b.size/1024).toFixed(1)} ${t('lbl_kb')}</td>
          <td class="u-p-4-6 u-text-right u-text-muted">${fd(b.mtime)}</td>
          <td class="u-p-4-6 u-nowrap">
            <a href="${API}/api/backup/download/${esc(b.name)}" class="btn-icon u-no-underline" title="${t('tooltip_download')}">⬇</a>
            <button class="btn-icon" title="${t('tooltip_restore')}" data-action="restoreBackup" data-args='${JSON.stringify([b.name, b.full])}'>↩</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="u-mt-8 u-text-11 u-text-muted">
      ${t('lbl_full_legend')} &nbsp;·&nbsp; ${t('lbl_db_only_legend')}
    </div>`;
}

async function restoreBackup(name, isFull) {
  const warn = isFull
    ? t('msg_restore_full_warn', { name })
    : t('msg_restore_partial_warn', { name });
  if (!confirm(warn)) return;
  const r = await fetch(`${API}/api/backup/restore/${encodeURIComponent(name)}`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) {
    if (d.warn) toast(t('msg_restored_with_warning', { warn: d.warn }), 'error');
    else toast(t('msg_restored_reloading'), 'success');
    setTimeout(() => location.reload(), 1500);
  } else toast(d.error || t('msg_error'), 'error');
}
