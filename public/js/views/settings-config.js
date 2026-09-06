/**
 * public/js/views/settings-config.js
 *
 * Фаза 5, шаг 24: вкладка настроек "Конфиг" — экспорт/импорт config.json
 * с разрешением конфликтов, вынесенная из public/index.html. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * _renderConfigPanel() физически лежала внутри settings-refdata.js
 * (Фаза 5, шаг 23) — оказалась там случайно (была между Locations-панелью
 * и CRUD-модалками организаций в оригинале). Забрал оттуда и объединил
 * с downloadConfigExport/startConfigImport/applyConfigImport — теперь
 * весь домен "Конфиг" в одном месте, как и задумывалось.
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js).
 */

// ── Вкладка: Конфиг ───────────────────────────────────────────────────────────
function _renderConfigPanel(isAdmin) {
  return `
    <div class="card u-max-w-600 u-mb-14">
      <div class="section-title">${t('cfg_export_title')}</div>
      <div class="u-text-12 u-text-muted u-mb-12 u-lh-16">
        ${t('cfg_export_hint')}
      </div>
      <button class="btn btn-secondary" data-action="downloadConfigExport">${t('btn_download_config')}</button>
    </div>

    <div class="card u-max-w-600">
      <div class="section-title">${t('cfg_import_title')}</div>
      <div class="u-text-12 u-text-muted u-mb-12 u-lh-16">
        ${t('cfg_import_hint')}
      </div>
      ${isAdmin ? `
      <input type="file" id="cfg-import-file" accept=".json" class="u-text-13 u-w-100 u-mb-8"/>
      <button class="btn btn-primary" data-action="startConfigImport">${t('btn_check_and_import')}</button>
      <div id="cfg-import-result" class="u-mt-12"></div>
      ` : `<div class="u-text-muted u-text-13">${t('msg_edit_mode_only')}</div>`}
    </div>`;
}

async function downloadConfigExport() {
  try {
    const r = await fetch(`${API}/api/config/export`, { headers: ah() });
    if (!r.ok) { toast(t('msg_export_error', { status: r.status }), 'error'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast(t('msg_connection_error'), 'error'); }
}

// ── Импорт config.json с разрешением конфликтов ───────────────────────────────
let _pendingImport = null; // { incoming, clean, conflicts }

async function startConfigImport() {
  const file = document.getElementById('cfg-import-file')?.files[0];
  if (!file) return toast(t('msg_select_file'),'error');
  const result = document.getElementById('cfg-import-result');
  result.innerHTML = `<div class="u-text-muted u-text-13">${t('msg_analyzing')}</div>`;

  let incoming;
  try { incoming = JSON.parse(await file.text()); }
  catch(e) { result.innerHTML = `<div class="u-text-danger">${t('msg_invalid_json', { msg: e.message })}</div>`; return; }

  const r = await fetch(`${API}/api/config/import/diff`, {
    method:'POST', headers:ah(), body:JSON.stringify({ config: incoming })
  });
  const d = await r.json();
  if (!r.ok) { result.innerHTML = `<div class="u-text-danger">❌ ${d.error}</div>`; return; }

  _pendingImport = { incoming, clean: d.clean, conflicts: d.conflicts };
  _renderImportPreview(result, d);
}

function _renderImportPreview(container, { clean, conflicts }) {
  const cleanCount = Object.values(clean).flat().length;
  const conflictCount = conflicts.length;

  const conflictsHtml = conflicts.map((c, idx) => {
    const typeLabel = { same_id_diff_data:t('conflict_same_id_diff_data'), same_code:t('conflict_same_code'), same_name:t('conflict_same_name') }[c.type] || c.type;
    const optionsBtns = c.options.map(opt => {
      const labels = { skip:t('resolution_skip'), keep_current:t('resolution_keep_current'), replace:t('resolution_replace'), rename:t('resolution_rename') };
      const styles = { skip:'btn-secondary', keep_current:'btn-secondary', replace:'btn-danger', rename:'btn-primary' };
      return `<button class="btn btn-sm ${styles[opt]||'btn-secondary'}" data-action="_selectResolution" data-args='${JSON.stringify([idx, opt])}'
        id="res-btn-${idx}-${opt}">${labels[opt]||opt}</button>`;
    }).join('');

    const renameInput = c.options.includes('rename')
      ? `<div id="res-rename-${idx}" class="rename-input-box">
          <input id="res-newname-${idx}" placeholder="${t('msg_new_unique_name')}" class="u-w-100 u-text-13"/>
         </div>`
      : '';

    return `<div class="alert-card conflict-card u-mb-8" id="conflict-${idx}">
      <div class="u-flex-gap-8 u-mb-6">
        <span class="level-badge u-text-muted">${c.level}</span>
        <span class="u-text-12 u-text-warn u-fw-600">${typeLabel}</span>
      </div>
      <div class="diff-grid u-mb-8 u-text-12">
        <div class="diff-box-warn">
          <div class="u-text-muted u-mb-3">${t('lbl_importing_entry')}</div>
          <b>${esc(c.incoming.name)}</b>${c.incoming.short_code ? ` <code>${esc(c.incoming.short_code)}</code>` : ''}
        </div>
        <div class="diff-box-success">
          <div class="u-text-muted u-mb-3">${t('lbl_current_entry')}</div>
          <b>${esc(c.current?.name||'—')}</b>${c.current?.short_code ? ` <code>${esc(c.current.short_code)}</code>` : ''}
        </div>
      </div>
      <div class="u-flex-wrap-gap-6" id="res-btns-${idx}">${optionsBtns}</div>
      ${renameInput}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="success-callout u-p-11 u-mb-12">
      ${t('msg_clean_and_conflicts', { clean: cleanCount, conflicts: conflictCount })}
    </div>
    ${conflictCount ? `<div class="u-text-13 u-fw-600 u-mb-8">${t('msg_resolve_conflicts')}</div>${conflictsHtml}` : ''}
    <div id="import-apply-wrap" class="u-mt-12">
      <button class="btn btn-primary" data-action="applyConfigImport" ${conflictCount ? 'disabled id="apply-config-btn"' : ''}>
        ${t('btn_apply_import')}
      </button>
      <div class="u-text-12 u-text-muted u-mt-6">
        ${conflictCount ? t('msg_resolve_all_to_apply') : t('msg_no_conflicts_apply_now')}
      </div>
    </div>`;

  if (!conflictCount) return; // нет конфликтов — кнопка уже активна
  // Инициализируем счётчик неразрешённых
  window._unresolvedConflicts = new Set(conflicts.map((_, i) => i));
  window._resolutions = {};
}

function _selectResolution(idx, action) {
  // Подсветить выбранную кнопку
  document.querySelectorAll(`#res-btns-${idx} .btn`).forEach(b => b.style.outline = '');
  const btn = document.getElementById(`res-btn-${idx}-${action}`);
  if (btn) btn.style.outline = '2px solid var(--indigo)';

  // Показать поле ввода для rename
  const renameDiv = document.getElementById(`res-rename-${idx}`);
  if (renameDiv) renameDiv.style.display = action === 'rename' ? 'block' : 'none';

  if (action !== 'rename') {
    window._resolutions[idx] = { action };
    window._unresolvedConflicts.delete(idx);
    _checkAllResolved();
  } else {
    // rename — ждём ввода
    const inp = document.getElementById(`res-newname-${idx}`);
    if (inp) {
      inp.oninput = () => {
        if (inp.value.trim()) {
          window._resolutions[idx] = { action: 'rename', new_name: inp.value.trim() };
          window._unresolvedConflicts.delete(idx);
        } else {
          delete window._resolutions[idx];
          window._unresolvedConflicts.add(idx);
        }
        _checkAllResolved();
      };
    }
  }
}

function _checkAllResolved() {
  const applyBtn = document.getElementById('apply-config-btn');
  if (!applyBtn) return;
  applyBtn.disabled = window._unresolvedConflicts.size > 0;
  if (window._unresolvedConflicts.size === 0) {
    applyBtn.textContent = t('btn_all_resolved_apply');
  }
}

async function applyConfigImport() {
  if (!_pendingImport) return toast(t('msg_no_import_data'),'error');
  const { incoming, clean } = _pendingImport;
  const conflicts = _pendingImport.conflicts || [];

  const resolutions = conflicts.map((c, idx) => {
    const res = (window._resolutions||{})[idx];
    if (!res) return null;
    return { level: c.level, incoming_id: c.incoming.id, action: res.action, new_name: res.new_name };
  }).filter(Boolean);

  const r = await fetch(`${API}/api/config/import/apply`, {
    method:'POST', headers:ah(),
    body:JSON.stringify({ clean, resolutions, incoming, changedBy: currentUser?.name || 'admin' })
  });
  const d = await r.json();
  if (r.ok) {
    const result = document.getElementById('cfg-import-result');
    result.innerHTML = `<div class="success-callout u-p-14">
      ${t('msg_import_applied')}<br>
      ${t('msg_import_stats', { added: d.added.length, updated: d.updated.length, skipped: d.skipped.length })}
    </div>`;
    toast(t('msg_config_imported'),'success');
    _pendingImport = null;
    try {
      const upd = await fetch(`${API}/api/settings`).then(r=>r.json());
      _companyName = upd.company_name || 'IT ASSETS';
      _updateLogoEl(_companyName, upd.logo_svg || '');
    } catch(e) {}
    await renderSettings();
  } else {
    toast(d.error||t('msg_apply_error'),'error');
  }
}
