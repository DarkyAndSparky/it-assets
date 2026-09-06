/**
 * public/js/views/settings-general.js
 *
 * Фаза 5, шаг 25: вкладка настроек "Общие" — название/логотип компании,
 * цветовая тема (light/dark accent), диагностика БД, миграция, бэкап-
 * кнопки (сами обработчики бэкапа в index.html), вынесенная из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * _updateLogoEl() вызывается из router.js (render()) как внешний глобал —
 * резолвится в момент вызова, порядок подключения не критичен (все
 * синхронные скрипты успевают отработать до первого реального render()).
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js). Карточка
 * «О системе» и loadSystemInfo() (INFRA-5) сюда же попали — при их
 * добавлении файл ещё не был локализован, поэтому переведены заодно.
 */

function _renderGeneralPanel(isAdmin, db_company_name='', db_logo_svg='', db_version='') {
  return `
        <div class="card settings-card">
      <div class="section-title">${t('company_name_logo_title')}</div>
      <div class="form-row"><label>${t('field_company_name')}</label>
        <input id="company-name-inp" placeholder="IT ASSETS"
          value="${db_company_name||''}" ${!isAdmin?'disabled':''}/>
      </div>
      ${isAdmin ? `<div class="u-flex-gap-8 u-wrap">
        <button class="btn btn-primary btn-sm" data-action="saveCompanyName">${t('btn_save_name')}</button>
        <button class="btn btn-ghost btn-sm" data-action="resetCompanyName">${t('btn_reset')}</button>
      </div>` : ''}
      <div class="settings-divider-top">
        <div class="u-text-13 u-fw-600 u-mb-6">${t('lbl_logo')}</div>
        <div class="u-text-12 u-text-muted u-mb-10 u-lh-16">
          ${t('msg_logo_hint')}
        </div>
        <div id="logo-preview" class="logo-preview-box">
          <span class="u-text-12 u-text-muted">${t('msg_logo_not_set')}</span>
        </div>
        ${isAdmin ? `<div class="u-flex-gap-8 u-wrap">
          <input type="file" id="logo-svg-file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" class="u-text-12 u-flex-1-minw-0"/>
          <button class="btn btn-primary btn-sm" data-action="saveLogoSvg">${t('btn_upload')}</button>
          <button class="btn btn-ghost btn-sm" data-action="clearLogoSvg">${t('btn_remove')}</button>
        </div>` : ''}
      </div>
    </div>

    ${isAdmin ? `
    <div class="card settings-card">
      <div class="section-title">${t('accent_color_title')}</div>
      <div class="u-text-12 u-text-muted u-mb-14 u-lh-16">
        ${t('msg_accent_color_hint')}
      </div>
      <div class="accent-grid">
        <!-- Светлая тема -->
        <div>
          <div class="u-text-12 u-fw-600 u-mb-8 u-opacity-7">${t('lbl_light_theme')}</div>
          <div id="preview-light" class="theme-preview-box theme-preview-shadow-light"></div>
          <div class="u-flex-gap-8">
            <input type="color" id="st-accent-light" value="#e94560" class="accent-color-input"
              data-oninput-action="_livePreview"/>
            <label class="u-text-12 u-text-muted">${t('lbl_accent')}</label>
          </div>
        </div>
        <!-- Тёмная тема -->
        <div>
          <div class="u-text-12 u-fw-600 u-mb-8 u-opacity-7">${t('lbl_dark_theme')}</div>
          <div id="preview-dark" class="theme-preview-box theme-preview-shadow-dark"></div>
          <div class="u-flex-gap-8">
            <input type="color" id="st-accent-dark" value="#e94560" class="accent-color-input"
              data-oninput-action="_livePreview"/>
            <label class="u-text-12 u-text-muted">${t('lbl_accent')}</label>
          </div>
        </div>
      </div>
      <div class="u-mt-14 u-flex-gap-8 u-wrap">
        <button class="btn btn-primary btn-sm" data-action="saveStyleSettings">${t('btn_save_style')}</button>
        <button class="btn btn-ghost btn-sm" data-action="_resetStyles">${t('btn_reset_icon')}</button>
        <span class="u-text-11 u-text-muted">${t('msg_applies_immediately')}</span>
      </div>
    </div>` : ''}



    <div class="card settings-card">
      <div class="section-title">${t('backup_title')}</div>
      <div class="u-text-12 u-text-muted u-mb-10 u-lh-16">
        ${t('msg_autobackup_hint')}
      </div>
      ${isAdmin ? `
      <div class="u-flex-gap-8 u-mb-12">
        <button class="btn btn-primary btn-sm" data-action="createBackup">${t('btn_create_backup')}</button>
        <button class="btn btn-ghost btn-sm" data-action="loadBackupList">${t('btn_refresh_list')}</button>
      </div>
      <div id="backup-list" class="u-text-12">
        <div class="u-text-muted">${t('msg_click_refresh_list')}</div>
      </div>` : `<div class="u-text-muted u-text-13">${t('msg_admin_only')}</div>`}
    </div>

      <div class="section-title">${t('csv_import_title')}</div>
      <div class="u-text-12 u-text-muted u-mb-8 u-lh-16">
        ${t('msg_csv_import_hint')}
      </div>
      ${isAdmin ? `
      <input type="file" id="csv-file" accept=".csv" class="csv-file-input"
        data-onchange-action="detectImportType"/>
      <div id="import-type-hint" class="u-text-12 u-text-muted u-mb-8 u-hidden"></div>
      <div id="import-csv-options" class="u-hidden u-mb-10 u-text-12">
        <label class="checkbox-label u-mb-4">
          <input type="checkbox" id="import-create-orgs" checked/> ${t('lbl_create_new_orgs')}
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="import-create-employees" checked/> ${t('lbl_create_new_employees')}
        </label>
      </div>
      <button class="btn btn-success" id="import-btn" data-action="importAuto" disabled>${t('btn_import')}</button>
      <div id="import-progress" class="u-hidden u-mt-10">
        <div class="u-text-12 u-text-muted u-mb-4" id="import-progress-label">${t('msg_preparing')}</div>
        <div class="progress-track-sm">
          <div id="import-progress-bar" class="progress-fill-anim"></div>
        </div>
      </div>
      <div id="import-result" class="u-mt-8 u-text-13"></div>`
      : `<div class="u-text-muted u-text-13">${t('msg_edit_mode_only')}</div>`}
    </div>

    <div class="card settings-card">
      <div class="section-title">${t('export_data_title')}</div>
      <div class="u-flex-gap-6 u-wrap">
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv`, "IT_assets.csv"])}'>${t('btn_export_all')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=os`, "IT_assets_os.csv"])}'>⬇ ${t('tab_os')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=small`, "IT_assets_small.csv"])}'>⬇ ${t('tab_small')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=infra`, "IT_assets_infra.csv"])}'>⬇ ${t('tab_infra')}</button>
      </div>
    </div>

    <div class="card settings-card">
      <div class="section-title">${t('diag_title')}</div>
      <div class="u-flex-gap-8 u-wrap">
        <button class="btn btn-ghost btn-sm" data-action="runDiag">${t('btn_check_state')}</button>
        ${isAdmin ? `<button class="btn btn-secondary btn-sm" data-action="runMigration">${t('btn_recalc_categories')}</button>` : ''}
      </div>
      <div id="diag-result" class="u-mt-10 u-text-12 u-lh-19"></div>
    </div>

    <div class="card settings-card-last">
      <div class="section-title">${t('about_system_title')}</div>
      <div class="u-text-12 u-text-muted u-lh-2">
        <div>${t('lbl_version')}: <b id="app-version-detail" class="u-text-base">${db_version || '…'}</b></div>
        <div>${t('lbl_db')}: <code>data/db.json</code> + <code>data/config.json</code> + <code>data/it-assets.sqlite</code></div>
        <div>${t('lbl_server')}: Node.js + Express + lowdb + SQLite</div>
        <div>HTTP: <code>:3000</code> (${t('lbl_redirect')}) · HTTPS: <code>:3443</code></div>
        <div class="divider-top-sm">
          ${t('msg_developed_for')}<br>
          ${t('lbl_author')}: <a href="https://github.com/DarkyAndSparky" target="_blank" rel="noopener"
            class="u-text-accent">DarkyAndSparky</a>
        </div>
        <div class="u-mt-8">
          <a href="https://github.com/DarkyAndSparky/it-assets" target="_blank" rel="noopener"
            class="u-text-accent u-inline-flex-gap-4">
            ${t('lbl_github_repo')}
          </a>
        </div>
      </div>
      ${isAdmin ? `
      <div class="divider-top-lg">
        <button class="btn btn-ghost btn-sm" data-action="loadSystemInfo">${t('btn_admin_diag')}</button>
        <div id="system-info-result" class="u-mt-10 u-text-12 u-lh-19"></div>
      </div>` : ''}
    </div>`;
}

// INFRA-5/INFRA-8: подробная админ-диагностика — подгружается по клику, а
// не при каждом открытии настроек. Оформление по образцу procure-it:
// раздельные карточки "О программе" / "Окружение" (авто-обновление раз в
// 10 сек, пока панель открыта) / "Технологии" / "Последние изменения"
// (из CHANGELOG.md) / "Данные".
let _sysInfoEnvTimer = null;

async function loadSystemInfo() {
  const box = document.getElementById('system-info-result');
  if (!box) return;
  box.innerHTML = `<span class="u-text-muted">${t('msg_loading')}</span>`;
  clearInterval(_sysInfoEnvTimer);

  try {
    const s = await _fetchSystemInfo();
    box.innerHTML = _renderSystemInfoCards(s);
    // Окружение (uptime/память/размер БД/последний бэкап) меняется
    // постоянно — перерисовываем каждые 10 сек, пока карточка на экране,
    // не перегружая остальные (статичные) блоки повторными запросами.
    _sysInfoEnvTimer = setInterval(async () => {
      const envBox = document.getElementById('about-env-card-body');
      if (!envBox || !document.body.contains(envBox)) { clearInterval(_sysInfoEnvTimer); return; }
      try {
        const fresh = await _fetchSystemInfo();
        envBox.innerHTML = _renderEnvRows(fresh);
      } catch (e) { /* тихо — авто-обновление необязательно */ }
    }, 10000);
  } catch (e) {
    box.innerHTML = `<span class="u-text-danger-fallback">${t('msg_load_error', { msg: e.message })}</span>`;
  }
}

async function _fetchSystemInfo() {
  return fetch(`${API}/api/settings/system-info`, { headers: ah() }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function _fmtBytes(n) {
  if (n == null) return '?';
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
}
function _fmtDate(d) {
  return d ? new Date(d).toLocaleString(_lang === 'en' ? 'en-US' : 'ru-RU') : '—';
}
function _fmtUptime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h} ${t('lbl_hours_short')} ${m} ${t('lbl_minutes_short')}`;
}

function _renderEnvRows(s) {
  return `
    <div class="env-grid">
      <span class="u-text-muted">Node.js</span><span class="u-font-mono">${esc(s.node.version)}</span>
      <span class="u-text-muted">${t('lbl_platform')}</span><span class="u-font-mono">${esc(s.node.platform)} / ${esc(s.node.arch)}</span>
      <span class="u-text-muted">${t('lbl_uptime2')}</span><span>${_fmtUptime(s.node.uptime_sec)}</span>
      <span class="u-text-muted">${t('lbl_process_memory')}</span><span>${s.node.memory_rss_mb} MB</span>
      <span class="u-text-muted">PID</span><span class="u-font-mono">${s.node.pid}</span>
      <span class="u-text-muted">${t('lbl_db_size')}</span><span>${_fmtBytes(s.storage.sqlite_bytes + s.storage.db_json_bytes + s.storage.config_json_bytes)}</span>
      <span class="u-text-muted">${t('lbl_last_backup2')}</span><span>${s.storage.backups.last ? _fmtDate(s.storage.backups.last.mtime) : t('lbl_no_backups2')}</span>
    </div>`;
}

function _renderSystemInfoCards(s) {
  const about = s.about || { name: 'it-assets', version: s.version, description: '', license: t('lbl_none'), author: t('lbl_none'), repository: '' };
  const deps = Object.entries(s.dependencies || {})
    .map(([name, v]) => `<div>${esc(name)}: <code>${esc(v.installed)}</code> <span class="u-opacity-6">(${esc(v.required)})</span></div>`)
    .join('');
  const techRows = (s.techStack || []).map(t2 => `
      <div>
        <div class="u-fw-600 u-text-13">${esc(t2.name)}</div>
        <div class="u-text-11 u-text-muted">${esc(t2.role)}</div>
      </div>`).join('');
  const changes = (s.recentChanges || []);

  return `
    <div class="card info-card">
      <div class="u-fw-700 u-mb-8">${t('about_program_title')} ${esc(about.name)}</div>
      <div class="env-grid">
        <span class="u-text-muted">${t('lbl_version')}</span><span class="u-font-mono u-fw-600">${esc(about.version)}</span>
        <span class="u-text-muted">${t('lbl_description')}</span><span>${esc(about.description) || t('lbl_none')}</span>
        <span class="u-text-muted">${t('lbl_license')}</span><span>${esc(about.license) || t('lbl_none')}</span>
        <span class="u-text-muted">${t('lbl_author2')}</span><span>${esc(about.author) || t('lbl_none')}</span>
        <span class="u-text-muted">${t('lbl_repository')}</span><span>${about.repository ? `<a href="${esc(about.repository)}" target="_blank" rel="noopener" class="u-text-accent">${esc(about.repository)}</a>` : t('lbl_none')}</span>
      </div>
    </div>

    <div class="card info-card" id="about-env-card">
      <div class="u-flex-baseline-gap-8-mb-8">
        <div class="u-fw-700">${t('about_env_title')}</div>
        <div class="u-text-10 u-text-muted">${t('about_env_refresh_note')}</div>
      </div>
      <div id="about-env-card-body">${_renderEnvRows(s)}</div>
    </div>

    <div class="card info-card">
      <div class="u-fw-700 u-mb-8">${t('about_tech_title')}</div>
      <div class="tech-grid">${techRows}</div>
    </div>

    ${changes.length ? `
    <details class="card info-card-flush">
      <summary class="changes-summary">
        ${t('about_changes_title')}
        <span class="u-text-10 u-text-muted u-fw-400 u-ml-auto">${t('about_changes_note')}</span>
      </summary>
      <div class="changes-body">
        <ul class="changes-list">
          ${changes.map(c => `<li>${esc(c)}</li>`).join('')}
        </ul>
      </div>
    </details>` : ''}

    <div class="card info-card-noMb">
      <div class="u-fw-700 u-mb-8">${t('about_data_title')}</div>
      <div class="env-grid">
        <span class="u-text-muted">${t('lbl_records')}</span><span>${t('lbl_assets_short')} ${s.counts.assets ?? '?'} · ${t('lbl_history_short')} ${s.counts.history ?? '?'} · ${t('lbl_employees_short')} ${s.counts.employees ?? '?'} · ${t('lbl_users_short')} ${s.counts.users ?? '?'}</span>
        <span class="u-text-muted">${t('lbl_backups')}</span><span>${s.storage.backups.count} ${t('lbl_pcs_last')}: ${s.storage.backups.last ? esc(s.storage.backups.last.file) : t('lbl_no_backups2')}</span>
      </div>
      <div class="divider-top-sm">
        <div class="u-fw-600 u-text-12 u-mb-6">${t('lbl_dependencies')}</div>
        <div class="deps-box">${deps}</div>
      </div>
    </div>`;
}

// ── Вкладка: Организации ──────────────────────────────────────────────────────
let _showLiquidatedOrgs = false;

// Организации/Филиалы/Локации (панели + CRUD + инв-правила) вынесены
// в public/js/views/settings-refdata.js (Фаза 5, шаг 23)

// downloadConfigExport, startConfigImport, _renderImportPreview, _selectResolution,
// _checkAllResolved, applyConfigImport (+ _renderConfigPanel из settings-refdata.js)
// вынесены в public/js/views/settings-config.js (Фаза 5, шаг 24)

async function runMigration() {
  if (!confirm(t('msg_confirm_migration'))) return;
  const r = await fetch(`${API}/api/migrate`, {
    method:'POST', headers:ah(),
    body: JSON.stringify({ from_version: 3 }) // перезапустить с v4
  });
  const d = await r.json();
  if (r.ok) toast(t('msg_migration_done', { v: d.schema_version }), 'success');
  else toast(d.error || t('msg_error'), 'error');
}

async function runDiag() {
  const el = document.getElementById('diag-result');
  el.innerHTML = t('msg_checking');
  try {
    const d = await fetch(`${API}/api/diag`).then(r=>r.json());
    const ok = c => `<span class="u-text-059669 u-fw-600">${c}</span>`;
    const err = c => `<span class="u-text-danger u-fw-600">${c}</span>`;
    const mb = (d.fileSize/1024).toFixed(1);
    const last = d.lastWrite ? new Date(d.lastWrite).toLocaleString(_lang === 'en' ? 'en-US' : 'ru-RU') : '—';
    el.innerHTML = `
      <div>${d.writable ? ok(t('msg_db_writable')) : err(t('msg_db_not_writable'))}</div>
      <div>${d.writeOk  ? ok(t('msg_test_write_ok')) : err(t('msg_test_write_fail'))}</div>
      <div>📁 ${t('lbl_path')}: <code class="u-text-11">${d.dbPath}</code></div>
      <div>📦 ${t('lbl_size')}: ${mb} KB | ${t('lbl_last_change')}: ${last}</div>
      <div>📋 ${t('lbl_in_db')}: ${t('lbl_devices_count', { n: d.assets })}, ${t('lbl_history_records', { n: d.history })}</div>
      <div class="divider-top-xs">
        ${d.backup?.last
          ? ok(t('msg_last_backup', {
              name: d.backup.last.file.replace(/^backup_\w+_/,'').replace(/\.zip|\.json/,''),
              size: Math.round(d.backup.last.size/1024),
              full: d.backup.last.full ? t('lbl_backup_full') : t('lbl_backup_db_only')
            }))
          : err(t('msg_no_backups_found'))}
        <span class="u-text-muted u-text-12"> ${t('lbl_total_count', { n: d.backup?.count ?? 0 })}</span>
      </div>
      ${!d.writable||!d.writeOk ? `<div class="diag-warn-box">
        ${t('msg_move_folder_warning')}
      </div>` : ''}
    `;
  } catch(e) {
    document.getElementById('diag-result').innerHTML = `<span class="u-text-danger">${t('msg_diag_error', { msg: e.message })}</span>`;
  }
}


function _updateLogoEl(name, logoData) {
  const parts     = (name || 'IT ASSETS').trim().split(/\s+/);
  const logo      = document.getElementById('company-logo');
  const logoSvg   = document.getElementById('company-logo-svg');
  const logoEmoji = document.getElementById('company-logo-emoji');
  if (logo) {
    if (parts.length === 1) {
      const a = esc(parts[0].slice(0, 2));
      const b = esc(parts[0].slice(2));
      logo.innerHTML = a + (b ? `<span>${b}</span>` : '');
    } else {
      logo.innerHTML = esc(parts[0]) + `<span>${esc(parts.slice(1).join(' '))}</span>`;
    }
  }
  document.title = name;
  if (logoSvg && logoEmoji) {
    const isSvg    = logoData && logoData.trim().toLowerCase().startsWith('<svg');
    const isImgUrl = logoData && (logoData.startsWith('data:image') || logoData.startsWith('http'));
    if (isSvg) {
      logoSvg.innerHTML = logoData;
      const el = logoSvg.querySelector('svg');
      if (el) { el.style.height='36px'; el.style.width='auto'; el.removeAttribute('width'); el.removeAttribute('height'); }
      logoSvg.style.display = 'block';
      logoEmoji.style.display = 'none';
    } else if (isImgUrl) {
      logoSvg.innerHTML = `<img src="${logoData}" class="logo-svg-img" alt="logo"/>`;
      logoSvg.style.display = 'block';
      logoEmoji.style.display = 'none';
    } else {
      logoSvg.innerHTML = '';
      logoSvg.style.display = 'none';
      logoEmoji.style.display = 'block';
    }
  }
}

function _livePreview() {
  const al = document.getElementById('st-accent-light')?.value || '#e94560';
  const ad = document.getElementById('st-accent-dark')?.value  || '#e94560';
  const pl = document.getElementById('preview-light');
  const pd = document.getElementById('preview-dark');
  if (pl) { pl.innerHTML = _renderStylePreview(false, al); _applyPreviewAccent(pl); }
  if (pd) { pd.innerHTML = _renderStylePreview(true,  ad); _applyPreviewAccent(pd); }
}

function _resetStyles() {
  if (!confirm(t('msg_confirm_reset_style'))) return;
  localStorage.removeItem('itassets_styles');
  // Сбрасываем все кастомные CSS переменные
  const vars = ['--accent','--header-bg','--accent-dark','--header-bg-dark'];
  vars.forEach(v => document.documentElement.style.removeProperty(v));
  // Сбрасываем значения color-picker инпутов
  const defaults = { 'st-accent-light':'#e94560', 'st-accent-dark':'#e94560',
                     'st-header-light':'', 'st-header-dark':'' };
  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  fetch(`${API}/api/settings/styles`, { method:'PUT', headers:ah(), body:JSON.stringify({styles:{}}) });
  toast(t('msg_style_reset'), 'success');
  setTimeout(() => { _initStyleEditor(); _livePreview(); }, 50);
}

async function _initStyleEditor() {
  let styles = {};
  try {
    const s = await fetch(`${API}/api/settings`).then(r=>r.json());
    styles = s.styles || {};
  } catch(e) {
    styles = JSON.parse(localStorage.getItem('itassets_styles') || '{}');
  }
  const al = styles.accent_light || '#e94560';
  const ad = styles.accent_dark  || '#e94560';
  const inpL = document.getElementById('st-accent-light');
  const inpD = document.getElementById('st-accent-dark');
  if (inpL) inpL.value = al;
  if (inpD) inpD.value = ad;
  _livePreview();
}

function _loadLogoPreview(logoData) {
  const preview = document.getElementById('logo-preview');
  if (!preview) return;
  if (!logoData || !logoData.trim()) {
    preview.innerHTML = `<span class="u-text-12 u-text-muted">${t('msg_logo_not_set')}</span>`;
    return;
  }
  if (logoData.trim().toLowerCase().startsWith('<svg')) {
    // SVG разметка
    preview.innerHTML = logoData;
    const el = preview.querySelector('svg');
    if (el) { el.style.height='36px'; el.style.width='auto'; el.removeAttribute('width'); el.removeAttribute('height'); }
  } else if (logoData.startsWith('data:') || logoData.startsWith('http')) {
    // base64 или URL
    preview.innerHTML = `<img src="${logoData}" class="logo-svg-img" alt="logo"/>`;
  } else {
    preview.innerHTML = `<span class="u-text-12 u-text-muted">${t('msg_logo_not_set')}</span>`;
  }
}

async function saveLogoSvg() {
  const file = document.getElementById('logo-svg-file')?.files[0];
  if (!file) return toast(t('msg_select_logo_file'), 'error');

  let logoData;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    // SVG — читаем как текст
    logoData = await file.text();
    if (!logoData.trim().toLowerCase().includes('<svg'))
      return toast(t('msg_not_valid_svg'), 'error');
  } else {
    // PNG/JPG/WebP — конвертируем в base64 data URL
    logoData = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = () => rej(new Error(t('msg_file_read_error')));
      reader.readAsDataURL(file);
    });
  }

  // Проверяем размер (макс 512 KB)
  if (logoData.length > 512 * 1024) return toast(t('msg_file_too_large'), 'error');

  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg: logoData })
  });
  if (r.ok) {
    toast(t('msg_logo_saved'), 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', logoData);
    _loadLogoPreview(logoData);
  } else { const d = await r.json(); toast(d.error||t('msg_error'),'error'); }
}

async function clearLogoSvg() {
  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg:'' })
  });
  if (r.ok) {
    toast(t('msg_logo_removed'), 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', '');
    _loadLogoPreview('');
  } else toast(t('msg_error'),'error');
}

async function saveCompanyName() {
  const name = document.getElementById('company-name-inp')?.value.trim();
  if (!name) return toast(t('msg_enter_name'), 'error');
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: name })
  });
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_company_name_saved'), 'success');
    _companyName = name;
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl(name, s.logo_svg || '');
    } catch(e) {
      _updateLogoEl(name, '');
    }
  } else toast(d.error || t('msg_error'), 'error');
}

async function resetCompanyName() {
  if (!confirm(t('msg_confirm_reset_name'))) return;
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: 'IT ASSETS' })
  });
  if (r.ok) {
    toast(t('msg_company_name_reset'), 'success');
    _companyName = 'IT ASSETS';
    const inp = document.getElementById('company-name-inp');
    if (inp) inp.value = 'IT ASSETS';
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl('IT ASSETS', s.logo_svg || '');
    } catch(e) {
      _updateLogoEl('IT ASSETS', '');
    }
  } else toast(t('msg_error'), 'error');
}

async function saveStyleSettings() {
  const accentLight  = document.getElementById('st-accent-light')?.value  || '#e94560';
  const accentDark   = document.getElementById('st-accent-dark')?.value   || '#e94560';
  const styles = { accent_light: accentLight, accent_dark: accentDark };
  // Сохраняем локально и на сервере
  localStorage.setItem('itassets_styles', JSON.stringify(styles));
  applyStoredStyles(styles);
  const r = await fetch(`${API}/api/settings/styles`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ styles })
  });
  if (r.ok) toast(t('msg_styles_saved'), 'success');
  else toast(t('msg_save_error'), 'error');
}

function _previewAccent(inputId, previewId) {
  const color = document.getElementById(inputId)?.value;
  const prev  = document.getElementById(previewId);
  if (prev) prev.style.background = color;
}

function _renderStylePreview(isDark, accent) {
  const th = isDark ? 'dark' : 'light';
  const navTabs = [t('nav_dashboard').replace(/^\S+\s/, ''), t('tab_os'), t('tab_small'), t('tab_infra')];
  const contentTabs = [t('nav_os'), t('nav_small'), t('nav_infra')];
  return `
    <div class="preview-shell">
      <!-- header -->
      <div class="preview-header preview-header-${th}">
        <div class="preview-logo">IT<span data-accent-text="${accent}">ASSETS</span></div>
        <div class="preview-badges-wrap">
          <div class="preview-badge-count" data-accent-bg="${accent}">0</div>
          <div class="preview-badge-user">admin</div>
        </div>
      </div>
      <!-- nav -->
      <div class="preview-nav preview-nav-${th}">
        ${navTabs.map((tb,i) => `
        <div class="preview-nav-tab ${i===0?'preview-nav-tab-active':`preview-nav-tab-inactive preview-nav-tab-inactive-${th}`}"
          ${i===0?`data-accent-text="${accent}" data-accent-border-bottom="${accent}"`:''}>${tb}</div>`).join('')}
      </div>
      <!-- content -->
      <div class="preview-content preview-content-${th}">
        ${contentTabs.map(tb => `
        <div class="preview-card preview-card-${th}" data-accent-border-left="${accent}">
          <div class="preview-card-title preview-card-title-${th}">${tb}</div>
          <div class="preview-card-num" data-accent-text="${accent}">—</div>
          <div class="preview-card-sub preview-card-sub-${th}">${t('lbl_devices_word')}</div>
        </div>`).join('')}
      </div>
    </div>`;
}

// CSP-21: accent — произвольный цвет из color-picker (не конечный
// перечень) — назначается точечно после вставки превью в DOM, как и
// остальные "истинно динамические" случаи в треке (dashboard.js и т.д.).
function _applyPreviewAccent(container) {
  if (!container) return;
  container.querySelectorAll('[data-accent-bg]').forEach(el => { el.style.background = el.dataset.accentBg; });
  container.querySelectorAll('[data-accent-text]').forEach(el => { el.style.color = el.dataset.accentText; });
  container.querySelectorAll('[data-accent-border-bottom]').forEach(el => { el.style.borderBottom = `2px solid ${el.dataset.accentBorderBottom}`; });
  container.querySelectorAll('[data-accent-border-left]').forEach(el => { el.style.borderLeft = `3px solid ${el.dataset.accentBorderLeft}`; });
}
