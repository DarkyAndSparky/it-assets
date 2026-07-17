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
 */

function _renderGeneralPanel(isAdmin, db_company_name='', db_logo_svg='', db_version='') {
  return `
        <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">🏢 Название и логотип</div>
      <div class="form-row"><label>Название</label>
        <input id="company-name-inp" placeholder="IT ASSETS"
          value="${db_company_name||''}" ${!isAdmin?'disabled':''}/>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="saveCompanyName">Сохранить название</button>
        <button class="btn btn-ghost btn-sm" data-action="resetCompanyName">Сбросить</button>
      </div>` : ''}
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Логотип</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
          Отображается в шапке вместо иконки 🖥️.<br>
          Поддерживаются форматы: SVG, PNG, JPG, WebP. Рекомендуемая высота: 36px.
        </div>
        <div id="logo-preview" style="margin-bottom:10px;min-height:50px;background:var(--surface);border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;padding:6px 12px">
          <span style="font-size:12px;color:var(--muted)">Логотип не установлен</span>
        </div>
        ${isAdmin ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="file" id="logo-svg-file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" style="font-size:12px;flex:1;min-width:0"/>
          <button class="btn btn-primary btn-sm" data-action="saveLogoSvg">Загрузить</button>
          <button class="btn btn-ghost btn-sm" data-action="clearLogoSvg">Убрать</button>
        </div>` : ''}
      </div>
    </div>

    ${isAdmin ? `
    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">🎨 Цвет акцента</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Цвет кнопок, активных пунктов меню и текста логотипа. Раздельно для светлой и тёмной темы.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Светлая тема -->
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;opacity:.7">☀️ Светлая тема</div>
          <div id="preview-light" style="margin-bottom:10px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.15)"></div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="st-accent-light" value="#e94560" style="width:40px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer"
              data-oninput-action="_livePreview"/>
            <label style="font-size:12px;color:var(--muted)">Акцент</label>
          </div>
        </div>
        <!-- Тёмная тема -->
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;opacity:.7">🌙 Тёмная тема</div>
          <div id="preview-dark" style="margin-bottom:10px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="st-accent-dark" value="#e94560" style="width:40px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer"
              data-oninput-action="_livePreview"/>
            <label style="font-size:12px;color:var(--muted)">Акцент</label>
          </div>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="saveStyleSettings">💾 Сохранить стиль</button>
        <button class="btn btn-ghost btn-sm" data-action="_resetStyles">↺ Сброс</button>
        <span style="font-size:11px;color:var(--muted)">Применяется немедленно</span>
      </div>
    </div>` : ''}



    <div class="card" style="max-width:520px;margin-bottom:14px">

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">💾 Резервное копирование</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        Автобэкап каждый час. До 30 копий в <code>data/backups/</code>.
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" data-action="createBackup">💾 Создать бэкап</button>
        <button class="btn btn-ghost btn-sm" data-action="loadBackupList">🔄 Обновить список</button>
      </div>
      <div id="backup-list" style="font-size:12px">
        <div style="color:var(--muted)">Нажмите «Обновить список» для просмотра</div>
      </div>` : '<div style="color:var(--muted);font-size:13px">Только для администратора</div>'}
    </div>

      <div class="section-title">📤 Импорт из CSV</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;line-height:1.6">
        Оборудование или история перемещений — система определит автоматически.
      </div>
      ${isAdmin ? `
      <input type="file" id="csv-file" accept=".csv" style="margin-bottom:8px;font-size:13px;width:100%"
        data-onchange-action="detectImportType"/>
      <div id="import-type-hint" style="font-size:12px;color:var(--muted);margin-bottom:8px;display:none"></div>
      <button class="btn btn-success" id="import-btn" data-action="importAuto" disabled>⬆ Импортировать</button>
      <div id="import-progress" style="display:none;margin-top:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px" id="import-progress-label">Подготовка...</div>
        <div style="background:var(--border);border-radius:6px;height:8px;overflow:hidden">
          <div id="import-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:6px;transition:width 0.2s ease"></div>
        </div>
      </div>
      <div id="import-result" style="margin-top:8px;font-size:13px"></div>`
      : '<div style="color:var(--muted);font-size:13px">Доступно только в режиме редактирования</div>'}
    </div>

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">📥 Экспорт данных</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <a href="${API}/api/export/csv" class="btn btn-secondary btn-sm">⬇ Всё</a>
        <a href="${API}/api/export/csv?tab=os" class="btn btn-secondary btn-sm">⬇ ОС</a>
        <a href="${API}/api/export/csv?tab=small" class="btn btn-secondary btn-sm">⬇ Мелочи</a>
        <a href="${API}/api/export/csv?tab=infra" class="btn btn-secondary btn-sm">⬇ Инфра</a>
      </div>
    </div>

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">🔧 Диагностика БД</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" data-action="runDiag">🔍 Проверить состояние</button>
        ${isAdmin ? `<button class="btn btn-secondary btn-sm" data-action="runMigration">⚙️ Пересчитать категории</button>` : ''}
      </div>
      <div id="diag-result" style="margin-top:10px;font-size:12px;line-height:1.9"></div>
    </div>

    <div class="card" style="max-width:520px">
      <div class="section-title">ℹ️ О системе</div>
      <div style="font-size:12px;color:var(--muted);line-height:2">
        <div>Версия: <b id="app-version-detail" style="color:var(--text)">${db_version || '…'}</b></div>
        <div>БД: <code>data/db.json</code> + <code>data/config.json</code></div>
        <div>Сервер: Node.js + Express + lowdb</div>
        <div>HTTP: <code>:3000</code> (редирект) · HTTPS: <code>:3443</code></div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          Разработано для внутреннего учёта ИТ-оборудования.<br>
          Автор: <a href="https://github.com/DarkyAndSparky" target="_blank" rel="noopener"
            style="color:var(--accent)">DarkyAndSparky</a>
        </div>
        <div style="margin-top:8px">
          <a href="https://github.com/DarkyAndSparky/it-assets" target="_blank" rel="noopener"
            style="color:var(--accent);display:inline-flex;align-items:center;gap:4px">
            GitHub репозиторий
          </a>
        </div>
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
  if (!confirm('Пересчитать категории и проставить filial_id/org_id для всех ассетов?\n\nОперация безопасна и обратима через бэкап.')) return;
  const r = await fetch(`${API}/api/migrate`, {
    method:'POST', headers:ah(),
    body: JSON.stringify({ from_version: 3 }) // перезапустить с v4
  });
  const d = await r.json();
  if (r.ok) toast(`Миграция выполнена → schema v${d.schema_version}`, 'success');
  else toast(d.error || 'Ошибка', 'error');
}

async function runDiag() {
  const el = document.getElementById('diag-result');
  el.innerHTML = 'Проверяю...';
  try {
    const d = await fetch(`${API}/api/diag`).then(r=>r.json());
    const ok = c => `<span style="color:#059669;font-weight:600">${c}</span>`;
    const err = c => `<span style="color:var(--danger-text);font-weight:600">${c}</span>`;
    const mb = (d.fileSize/1024).toFixed(1);
    const last = d.lastWrite ? new Date(d.lastWrite).toLocaleString('ru-RU') : '—';
    el.innerHTML = `
      <div>${d.writable ? ok('✅ Файл БД доступен для записи') : err('❌ НЕТ ПРАВ НА ЗАПИСЬ — данные не сохраняются!')}</div>
      <div>${d.writeOk  ? ok('✅ Тестовая запись прошла успешно') : err('❌ db.write() УПАЛ — проверьте права на папку data/')}</div>
      <div>📁 Путь: <code style="font-size:11px">${d.dbPath}</code></div>
      <div>📦 Размер: ${mb} KB | Последнее изменение: ${last}</div>
      <div>📋 В базе: ${d.assets} устройств, ${d.history} записей истории</div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
        ${d.backup?.last
          ? ok(`✅ Последний бэкап: ${d.backup.last.file.replace(/^backup_\w+_/,'').replace(/\.zip|\.json/,'')} · ${Math.round(d.backup.last.size/1024)} KB · ${d.backup.last.full ? 'полный' : 'только БД'}`)
          : err('⚠️ Бэкапов не найдено — сервер запущен менее 10 секунд или папка data/backups/ недоступна')}
        <span style="color:var(--muted);font-size:12px"> (всего: ${d.backup?.count ?? 0})</span>
      </div>
      ${!d.writable||!d.writeOk ? `<div style="margin-top:8px;padding:8px;background:var(--noInv-bg);border-radius:6px;color:var(--danger-text)">
        ⚠️ Переместите папку <b>it-assets</b> из Downloads на Рабочий стол и перезапустите.
      </div>` : ''}
    `;
  } catch(e) {
    document.getElementById('diag-result').innerHTML = `<span style="color:var(--danger-text)">Ошибка: ${e.message}</span>`;
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
      logoSvg.innerHTML = `<img src="${logoData}" style="height:36px;width:auto;object-fit:contain" alt="logo"/>`;
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
  if (pl) pl.innerHTML = _renderStylePreview(false, al);
  if (pd) pd.innerHTML = _renderStylePreview(true,  ad);
}

function _resetStyles() {
  if (!confirm('Сбросить стиль к стандартному?')) return;
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
  toast('Стиль сброшен', 'success');
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
    preview.innerHTML = '<span style="font-size:12px;color:var(--muted)">Логотип не установлен</span>';
    return;
  }
  if (logoData.trim().toLowerCase().startsWith('<svg')) {
    // SVG разметка
    preview.innerHTML = logoData;
    const el = preview.querySelector('svg');
    if (el) { el.style.height='36px'; el.style.width='auto'; el.removeAttribute('width'); el.removeAttribute('height'); }
  } else if (logoData.startsWith('data:') || logoData.startsWith('http')) {
    // base64 или URL
    preview.innerHTML = `<img src="${logoData}" style="height:36px;width:auto;object-fit:contain" alt="logo"/>`;
  } else {
    preview.innerHTML = '<span style="font-size:12px;color:var(--muted)">Логотип не установлен</span>';
  }
}

async function saveLogoSvg() {
  const file = document.getElementById('logo-svg-file')?.files[0];
  if (!file) return toast('Выберите файл логотипа', 'error');

  let logoData;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    // SVG — читаем как текст
    logoData = await file.text();
    if (!logoData.trim().toLowerCase().includes('<svg'))
      return toast('Файл не является корректным SVG', 'error');
  } else {
    // PNG/JPG/WebP — конвертируем в base64 data URL
    logoData = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = () => rej(new Error('Ошибка чтения файла'));
      reader.readAsDataURL(file);
    });
  }

  // Проверяем размер (макс 512 KB)
  if (logoData.length > 512 * 1024) return toast('Файл слишком большой (макс. 512 KB)', 'error');

  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg: logoData })
  });
  if (r.ok) {
    toast('Логотип сохранён', 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', logoData);
    _loadLogoPreview(logoData);
  } else { const d = await r.json(); toast(d.error||'Ошибка','error'); }
}

async function clearLogoSvg() {
  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg:'' })
  });
  if (r.ok) {
    toast('Логотип удалён', 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', '');
    _loadLogoPreview('');
  } else toast('Ошибка','error');
}

async function saveCompanyName() {
  const name = document.getElementById('company-name-inp')?.value.trim();
  if (!name) return toast('Введите название', 'error');
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: name })
  });
  const d = await r.json();
  if (r.ok) {
    toast('Название сохранено', 'success');
    _companyName = name;
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl(name, s.logo_svg || '');
    } catch(e) {
      _updateLogoEl(name, '');
    }
  } else toast(d.error || 'Ошибка', 'error');
}

async function resetCompanyName() {
  if (!confirm('Сбросить название на "IT ASSETS"?')) return;
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: 'IT ASSETS' })
  });
  if (r.ok) {
    toast('Название сброшено', 'success');
    _companyName = 'IT ASSETS';
    const inp = document.getElementById('company-name-inp');
    if (inp) inp.value = 'IT ASSETS';
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl('IT ASSETS', s.logo_svg || '');
    } catch(e) {
      _updateLogoEl('IT ASSETS', '');
    }
  } else toast('Ошибка', 'error');
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
  if (r.ok) toast('Стили сохранены', 'success');
  else toast('Ошибка сохранения', 'error');
}

function _previewAccent(inputId, previewId) {
  const color = document.getElementById(inputId)?.value;
  const prev  = document.getElementById(previewId);
  if (prev) prev.style.background = color;
}

function _renderStylePreview(isDark, accent) {
  const bg      = isDark ? '#0f1117' : '#f0f2f5';
  const card    = isDark ? '#1a1b23' : '#ffffff';
  const text    = isDark ? '#e8eaf0' : '#1a1a2e';
  const muted   = isDark ? '#6b7280' : '#64748b';
  const border  = isDark ? '#2d2f3e' : '#e2e8f0';
  const navBg   = isDark ? '#1a1b23' : '#ffffff';
  const headerG = isDark
    ? 'linear-gradient(135deg,#0a0b0f,#13141c,#1a1b23)'
    : 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)';
  return `
    <div style="width:100%;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.25);font-size:10px;user-select:none">
      <!-- header -->
      <div style="background:${headerG};color:#fff;padding:7px 10px;display:flex;align-items:center;gap:6px">
        <div style="font-weight:800;font-size:11px">IT<span style="color:${accent}">ASSETS</span></div>
        <div style="margin-left:auto;display:flex;gap:4px">
          <div style="background:${accent};border-radius:10px;padding:1px 6px;font-size:9px;font-weight:600">0</div>
          <div style="background:rgba(255,255,255,.2);border-radius:6px;padding:2px 7px;font-size:9px">admin</div>
        </div>
      </div>
      <!-- nav -->
      <div style="background:${navBg};display:flex;gap:0;border-bottom:1px solid ${border};padding:0 8px">
        ${['Дашборд','ОС','Мелочи','Инфра'].map((t,i) => `
        <div style="padding:5px 7px;font-size:9px;font-weight:${i===0?700:500};color:${i===0?accent:muted};border-bottom:${i===0?`2px solid ${accent}`:'2px solid transparent'}">${t}</div>`).join('')}
      </div>
      <!-- content -->
      <div style="background:${bg};padding:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
        ${['💻 ОС','🖱 Мелочи','🌐 Инфра'].map(t => `
        <div style="background:${card};border-radius:6px;padding:6px 8px;box-shadow:0 1px 4px rgba(0,0,0,.1);border-left:3px solid ${accent}">
          <div style="font-size:10px;font-weight:700;color:${text}">${t}</div>
          <div style="font-size:14px;font-weight:800;color:${accent};margin-top:2px">—</div>
          <div style="font-size:8px;color:${muted}">устройств</div>
        </div>`).join('')}
      </div>
    </div>`;
}
