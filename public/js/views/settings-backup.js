/**
 * public/js/views/settings-backup.js
 *
 * Хвост Фазы 5/6: бэкапы (createBackup/loadBackupList/restoreBackup) +
 * состояние справочников настроек (_settingsTab/_orgsCache/.../ensureRefData),
 * вынесенные из inline-скрипта в index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 */

// ─── Состояние справочников (используется settings-refdata.js и asset-tab.js) ──
let _settingsTab = 'general'; // 'general' | 'orgs' | 'filials' | 'locations' | 'config'
let _orgsCache = [], _filialsCache = [], _locsCache = [];
let _refDataLoaded = false;

async function ensureRefData() {
  if (_refDataLoaded) return;
  try {
    [_orgsCache, _filialsCache, _locsCache] = await Promise.all([
      fetch(`${API}/api/orgs`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/api/filials`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/api/locations`).then(r=>r.json()).catch(()=>[]),
    ]);
    _refDataLoaded = true;
  } catch(e) { console.warn('ensureRefData failed', e); }
}

// ─── Бэкапы ──────────────────────────────────────────────────────────────────

async function createBackup() {
  const r = await fetch(`${API}/api/backup/create`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) { toast(`Бэкап создан: ${d.file} (${(d.size/1024).toFixed(1)} КБ)`, 'success'); loadBackupList(); }
  else toast(d.error || 'Ошибка', 'error');
}

async function loadBackupList() {
  const el = document.getElementById('backup-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted)">Загрузка...</div>';
  const r = await fetch(`${API}/api/backup/list`, { headers:ah() });
  const list = await r.json();
  if (!list.length) { el.innerHTML = '<div style="color:var(--muted)">Бэкапов нет</div>'; return; }
  el.innerHTML = `
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="color:var(--muted)">
        <th style="text-align:left;padding:3px 6px">Файл</th>
        <th style="padding:3px 6px">Тип</th>
        <th style="text-align:right;padding:3px 6px">Размер</th>
        <th style="text-align:right;padding:3px 6px">Дата</th>
        <th style="padding:3px 6px"></th>
      </tr></thead>
      <tbody>${list.map(b => `
        <tr style="border-top:1px solid var(--border)">
          <td style="padding:4px 6px;font-family:monospace;font-size:11px">${esc(b.name)}</td>
          <td style="padding:4px 6px;text-align:center">
            <span title="${b.full ? 'Полный бэкап (db + config)' : 'Только db.json'}"
              style="font-size:13px">${b.full ? '🔒' : '⚠️'}</span>
          </td>
          <td style="padding:4px 6px;text-align:right;color:var(--muted)">${(b.size/1024).toFixed(1)} КБ</td>
          <td style="padding:4px 6px;text-align:right;color:var(--muted)">${fd(b.mtime)}</td>
          <td style="padding:4px 6px;white-space:nowrap">
            <a href="${API}/api/backup/download/${esc(b.name)}" class="btn-icon" title="Скачать" style="text-decoration:none">⬇</a>
            <button class="btn-icon" title="Восстановить" data-action="restoreBackup" data-args='${JSON.stringify([b.name, b.full])}'>↩</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:8px;font-size:11px;color:var(--muted)">
      🔒 полный (db + config) &nbsp;·&nbsp; ⚠️ только db.json
    </div>`;
}

async function restoreBackup(name, isFull) {
  const warn = isFull
    ? `Восстановить базу из «${name}»?\n\nБудут восстановлены db.json и config.json.\nТекущее состояние будет сохранено как pre-restore бэкап.`
    : `Восстановить базу из «${name}»?\n\n⚠ Этот бэкап содержит только db.json — организации и настройки НЕ будут восстановлены.\nТекущее состояние будет сохранено как pre-restore бэкап.`;
  if (!confirm(warn)) return;
  const r = await fetch(`${API}/api/backup/restore/${encodeURIComponent(name)}`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) {
    if (d.warn) toast(`Восстановлено с предупреждением: ${d.warn}`, 'error');
    else toast('База восстановлена. Перезагружаю страницу...', 'success');
    setTimeout(() => location.reload(), 1500);
  } else toast(d.error || 'Ошибка', 'error');
}
