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
 */

// ── Вкладка: Конфиг ───────────────────────────────────────────────────────────
function _renderConfigPanel(isAdmin) {
  return `
    <div class="card" style="max-width:600px;margin-bottom:14px">
      <div class="section-title">📤 Экспорт конфигурации</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        Скачать <b>config.json</b> — справочники организаций, филиалов, локаций и аккаунты.
        Используйте для резервного копирования или переноса на другой сервер.
      </div>
      <button class="btn btn-secondary" data-action="downloadConfigExport">⬇ Скачать config.json</button>
    </div>

    <div class="card" style="max-width:600px">
      <div class="section-title">📥 Импорт конфигурации</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        Загрузите <b>config.json</b> из резервной копии. Если в файле есть конфликты с текущими данными —
        система покажет каждый конфликт и предложит варианты решения.
      </div>
      ${isAdmin ? `
      <input type="file" id="cfg-import-file" accept=".json" style="font-size:13px;width:100%;margin-bottom:8px"/>
      <button class="btn btn-primary" data-action="startConfigImport">🔍 Проверить и импортировать</button>
      <div id="cfg-import-result" style="margin-top:12px"></div>
      ` : '<div style="color:var(--muted);font-size:13px">Доступно только в режиме редактирования</div>'}
    </div>`;
}

async function downloadConfigExport() {
  try {
    const r = await fetch(`${API}/api/config/export`, { headers: ah() });
    if (!r.ok) { toast('Ошибка экспорта: ' + r.status, 'error'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast('Ошибка соединения', 'error'); }
}

// ── Импорт config.json с разрешением конфликтов ───────────────────────────────
let _pendingImport = null; // { incoming, clean, conflicts }

async function startConfigImport() {
  const file = document.getElementById('cfg-import-file')?.files[0];
  if (!file) return toast('Выберите файл','error');
  const result = document.getElementById('cfg-import-result');
  result.innerHTML = '<div style="color:var(--muted);font-size:13px">🔍 Анализирую...</div>';

  let incoming;
  try { incoming = JSON.parse(await file.text()); }
  catch(e) { result.innerHTML = `<div style="color:var(--danger-text)">❌ Невалидный JSON: ${e.message}</div>`; return; }

  const r = await fetch(`${API}/api/config/import/diff`, {
    method:'POST', headers:ah(), body:JSON.stringify({ config: incoming })
  });
  const d = await r.json();
  if (!r.ok) { result.innerHTML = `<div style="color:var(--danger-text)">❌ ${d.error}</div>`; return; }

  _pendingImport = { incoming, clean: d.clean, conflicts: d.conflicts };
  _renderImportPreview(result, d);
}

function _renderImportPreview(container, { clean, conflicts }) {
  const cleanCount = Object.values(clean).flat().length;
  const conflictCount = conflicts.length;

  const conflictsHtml = conflicts.map((c, idx) => {
    const typeLabel = { same_id_diff_data:'⚠️ Одинаковый ID, разные данные', same_code:'🔤 Совпадает код', same_name:'📝 Совпадает название' }[c.type] || c.type;
    const optionsBtns = c.options.map(opt => {
      const labels = { skip:'Пропустить', keep_current:'Оставить текущую', replace:'Заменить текущую', rename:'Переименовать и добавить' };
      const styles = { skip:'btn-secondary', keep_current:'btn-secondary', replace:'btn-danger', rename:'btn-primary' };
      return `<button class="btn btn-sm ${styles[opt]||'btn-secondary'}" data-action="_selectResolution" data-args='${JSON.stringify([idx, opt])}'
        id="res-btn-${idx}-${opt}">${labels[opt]||opt}</button>`;
    }).join('');

    const renameInput = c.options.includes('rename')
      ? `<div id="res-rename-${idx}" style="display:none;margin-top:6px">
          <input id="res-newname-${idx}" placeholder="Новое уникальное название" style="width:100%;font-size:13px"/>
         </div>`
      : '';

    return `<div class="alert-card" id="conflict-${idx}" style="flex-direction:column;align-items:stretch;margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;background:var(--surface2);border-radius:4px;padding:2px 6px;color:var(--muted)">${c.level}</span>
        <span style="font-size:12px;color:var(--warn-text);font-weight:600">${typeLabel}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;font-size:12px">
        <div style="background:var(--warn-bg);border-radius:6px;padding:8px;color:var(--warn-text)">
          <div style="color:var(--muted);margin-bottom:3px">Импортируемая</div>
          <b>${esc(c.incoming.name)}</b>${c.incoming.short_code ? ` <code>${esc(c.incoming.short_code)}</code>` : ''}
        </div>
        <div style="background:var(--success-bg);border-radius:6px;padding:8px;color:var(--success-text)">
          <div style="color:var(--muted);margin-bottom:3px">Текущая</div>
          <b>${esc(c.current?.name||'—')}</b>${c.current?.short_code ? ` <code>${esc(c.current.short_code)}</code>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="res-btns-${idx}">${optionsBtns}</div>
      ${renameInput}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="background:var(--success-bg);border:1px solid var(--success-border);border-radius:8px;padding:11px;margin-bottom:12px;font-size:13px;color:var(--success-text)">
      ✅ Чистых записей: <b>${cleanCount}</b> &nbsp;|&nbsp; ⚠️ Конфликтов: <b>${conflictCount}</b>
    </div>
    ${conflictCount ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px">Разрешите конфликты:</div>${conflictsHtml}` : ''}
    <div id="import-apply-wrap" style="margin-top:12px">
      <button class="btn btn-primary" data-action="applyConfigImport" ${conflictCount ? 'disabled id="apply-config-btn"' : ''}>
        ✅ Применить импорт
      </button>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">
        ${conflictCount ? 'Разрешите все конфликты чтобы применить' : 'Нет конфликтов — можно применить сразу'}
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
    applyBtn.textContent = '✅ Все конфликты разрешены — Применить';
  }
}

async function applyConfigImport() {
  if (!_pendingImport) return toast('Нет данных для импорта','error');
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
    result.innerHTML = `<div style="background:var(--success-bg);border:1px solid var(--success-border);border-radius:8px;padding:14px;font-size:13px;color:var(--success-text)">
      ✅ <b>Импорт применён</b><br>
      Добавлено: ${d.added.length} · Обновлено: ${d.updated.length} · Пропущено: ${d.skipped.length}
    </div>`;
    toast('Конфиг импортирован','success');
    _pendingImport = null;
    try {
      const upd = await fetch(`${API}/api/settings`).then(r=>r.json());
      _companyName = upd.company_name || 'IT ASSETS';
      _updateLogoEl(_companyName, upd.logo_svg || '');
    } catch(e) {}
    await renderSettings();
  } else {
    toast(d.error||'Ошибка при применении','error');
  }
}
