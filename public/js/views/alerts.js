/**
 * public/js/views/alerts.js
 *
 * Фаза 5, шаг 11: экран "Требует внимания", вынесенный из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 * Самодостаточна: только глобалы (document, fetch, API, ic, esc, canEdit,
 * showDetail, showMoveModal, openInvGenerator, showEditModal), резолвятся
 * в момент вызова. Само-рекурсивна (кнопки "показать все" зовут renderAlerts()
 * заново) — это нормально, та же функция уже будет определена к тому моменту.
 */

// Фаза 6: было onclick="localStorage.removeItem/setItem(...);renderAlerts()" —
// составной вызов из двух операторов, выношу в именованную функцию.
function _toggleAlertsShowAll(title, show) {
  if (show) localStorage.setItem('alerts-showAll-' + title, '1');
  else localStorage.removeItem('alerts-showAll-' + title);
  renderAlerts();
}

async function renderAlerts() {
  const app=document.getElementById('app');
  app.innerHTML='<div class="spinner"></div>';

  const toArr = r => Array.isArray(r) ? r : (r?.items || []);
  const [noResp, reserved, noInv, noSerial, stale] = await Promise.all([
    fetch(`${API}/api/assets?no_responsible=1&limit=500`).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?status=резерв&limit=500`).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_inv=1&limit=500`).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_serial=1&limit=500`).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?stale_days=180&limit=500`).then(r=>r.json()).then(toArr),
  ]);

  const alertRow = (a, btn='') => `<div class="alert-card" style="cursor:pointer" data-action="showDetail" data-args='${JSON.stringify([a.id])}'>
    <span style="font-size:20px">${ic(a.type)}</span>
    <div style="flex:1">
      <div style="font-weight:600;font-size:13px">${esc(a.type)} · ${esc(a.model)}</div>
      <div style="font-size:12px;color:var(--muted)">${esc(a.filial||'—')} · ${esc(a.location||'—')} · ${esc(a.responsible||'не назначен')}</div>
      ${a.inv?`<div style="font-size:11px;color:var(--muted)">Инв: ${esc(a.inv)}</div>`:''}
    </div>
    ${btn}
  </div>`;

  const section = (icon, title, color, items, btn='', emptyMsg='Всё в порядке 👍') => {
    const showAll = localStorage.getItem(`alerts-showAll-${title}`) === '1';
    const itemsToShow = showAll ? items : items.slice(0, 50);
    return `
    <div class="card" style="margin-bottom:14px">
      <div class="section-title" style="color:${color};display:flex;justify-content:space-between;align-items:center">
        <span>${icon} ${title} (${items.length})</span>
        ${items.length>50?`<span style="font-size:11px;font-weight:400;color:var(--muted)">${items.length} записей</span>`:''}
      </div>
      ${itemsToShow.map(a=>alertRow(a,btn?btn(a):'')).join('')
        || `<div style="color:var(--muted);font-size:13px;padding:6px 0">${emptyMsg}</div>`}
      ${items.length>50?`<div style="padding:10px 0;text-align:center;border-top:1px solid var(--border);margin-top:10px">
        ${showAll ? 
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, false])}'>▲ Скрыть</button>` :
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, true])}'>▼ Показать все (${items.length})</button>`
        }
      </div>`:''}
    </div>`;
  };

  app.innerHTML=`<div style="max-width:900px">
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">⚠️ Требует внимания</div>

    ${section('❓','Без ответственного','var(--red)', noResp,
      a => canEdit()?`<button class="btn btn-primary btn-sm" data-action="showMoveModal" data-args='${JSON.stringify([a.id])}' data-stop="1">Назначить →</button>`:'',
      'Все ассеты имеют ответственных 👍')}

    ${section('🏷','Без инвентарного номера','#d97706', noInv,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='${JSON.stringify([a.id])}' data-stop="1">Присвоить №</button>`:'',
      'Все ассеты имеют инвентарные номера 👍')}

    ${section('🔢','Без серийного номера','#7c3aed', noSerial,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="showEditModal" data-args='${JSON.stringify([a.id])}' data-stop="1">Заполнить</button>`:'',
      'Все ассеты имеют серийные номера 👍')}

    ${section('🕐','Не обновлялось >6 мес.','#64748b', stale, null,
      'Все ассеты актуальны 👍')}

    ${section('📦','В резерве','var(--amber)', reserved, null,
      'Резерва нет')}
  </div>`;
}
