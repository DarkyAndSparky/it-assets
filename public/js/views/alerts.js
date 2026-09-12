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
  const [noResp, reserved, noInv, noSerial, stale, warrExpired, warrExpiring] = await Promise.all([
    fetch(`${API}/api/assets?no_responsible=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?status=резерв&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_inv=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_serial=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?stale_days=180&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    // PROD-5: warranty_expiring_days=0 — включает всё с датой <= сейчас
    // (просроченное); отдельно фильтруем < now на клиенте ниже, чтобы
    // разделить на "уже истекла" и "истекает в ближайшие 30 дней" — сервер
    // отдаёт одним списком "<= cutoff", разбивка на два визуально более
    // срочных блока делается уже тут.
    fetch(`${API}/api/assets?warranty_expiring_days=0&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?warranty_expiring_days=30&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
  ]);
  const expiredIds = new Set(warrExpired.map(a=>a.id));
  const warrExpiringOnly = warrExpiring.filter(a => !expiredIds.has(a.id));

  const alertRow = (a, btn='') => `<div class="alert-card u-cursor-pointer" data-action="showDetail" data-args='${JSON.stringify([a.id])}'>
    <span class="u-text-20">${ic(a.type)}</span>
    <div class="u-flex-1">
      <div class="u-fw-600 u-text-13">${esc(a.type)} · ${esc(a.model)}</div>
      <div class="u-text-12 u-text-muted">${esc(a.filial||'—')} · ${esc(a.location||'—')} · ${esc(a.responsible||t('lbl_not_assigned'))}</div>
      ${a.inv?`<div class="u-text-11 u-text-muted">${t('field_inv')}: ${esc(a.inv)}</div>`:''}
      ${a.meta?.warranty?`<div class="u-text-11 u-text-muted">${t('meta_warranty')}: ${esc(a.meta.warranty)}</div>`:''}
    </div>
    ${btn}
  </div>`;

  const section = (icon, title, color, items, btn='', emptyMsg='') => {
    const showAll = localStorage.getItem(`alerts-showAll-${title}`) === '1';
    const itemsToShow = showAll ? items : items.slice(0, 50);
    return `
    <div class="card u-mb-14">
      <div class="section-title u-flex-between" data-color="${color}">
        <span>${icon} ${title} (${items.length})</span>
        ${items.length>50?`<span class="u-text-11 u-fw-400 u-text-muted">${items.length} ${t('lbl_records_short')}</span>`:''}
      </div>
      ${itemsToShow.map(a=>alertRow(a,btn?btn(a):'')).join('')
        || `<div class="u-text-muted u-text-13 u-p-6-0">${emptyMsg}</div>`}
      ${items.length>50?`<div class="list-footer">
        ${showAll ? 
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, false])}'>${t('btn_collapse')}</button>` :
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, true])}'>▼ ${t('lbl_show_all')} (${items.length})</button>`
        }
      </div>`:''}
    </div>`;
  };

  app.innerHTML=`<div class="u-max-w-900">
    <div class="u-text-16 u-fw-700 u-mb-14">${t('page_title_alerts')}</div>

    ${section('❓',t('lbl_no_responsible'),'var(--red)', noResp,
      a => canEdit()?`<button class="btn btn-primary btn-sm" data-action="showMoveModal" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_assign_arrow')}</button>`:'',
      t('msg_all_have_responsible'))}

    ${section('🏷',t('lbl_no_inv'),'#d97706', noInv,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_assign_inv_short')}</button>`:'',
      t('msg_all_have_inv'))}

    ${section('🔢',t('lbl_no_serial'),'#7c3aed', noSerial,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="showEditModal" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_fill')}</button>`:'',
      t('msg_all_have_serial'))}

    ${section('🕐',t('lbl_stale'),'#64748b', stale, null,
      t('msg_all_up_to_date'))}

    ${section('📦',t('lbl_in_reserve_title'),'var(--amber)', reserved, null,
      t('msg_no_reserve'))}

    ${section('⛔',t('lbl_warranty_expired'),'var(--danger-text)', warrExpired, null,
      t('msg_no_warranty_expired'))}

    ${section('⏳',t('lbl_warranty_expiring'),'var(--warn-text)', warrExpiringOnly, null,
      t('msg_no_warranty_expiring'))}
  </div>`;

  // CSP-7: динамический цвет заголовка секции — как в dashboard.js
  // (data-w/data-bg): рендерим без style=, точечно назначаем после вставки.
  app.querySelectorAll('.section-title[data-color]').forEach(el => {
    el.style.color = el.dataset.color;
  });
}
