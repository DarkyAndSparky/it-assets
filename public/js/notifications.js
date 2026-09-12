/**
 * public/js/notifications.js
 *
 * IDEA-4: колокольчик уведомлений в шапке — тот же паттерн, что у
 * health-индикатора (INFRA-6): точка/бейдж + всплывающая панель по клику,
 * опрос по таймеру, видим только залогиненным.
 *
 * Намеренно НЕ заводит отдельную систему хранения событий/уведомлений
 * (это была бы куда более крупная задача — лог событий, read/unread на
 * пользователя, схема БД под это) — колокольчик просто агрегирует те же
 * категории "требует внимания", что уже вычисляются в /api/stats
 * (noResp/noInv/noSerial/warrantyExpired/warrantyExpiring, см. PROD-5) и
 * уже показываются на дашборде и в alerts.js. Отличие от дашборд-карточек
 * — колокольчик виден с ЛЮБОЙ вкладки, не только с дашборда.
 */

const NOTIF_POLL_MS = 60000; // тот же интервал, что у health — не мгновенные данные
let _notifTimer = null;
let _notifLast  = null;

async function refreshNotifications() {
  const bell = document.getElementById('notif-bell');
  if (!bell) return;

  if (!currentUser) {
    bell.classList.add('u-hidden');
    stopNotifPolling();
    return;
  }

  try {
    const r = await fetch(`${API}/api/stats`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const s = await r.json();
    _notifLast = s;

    const items = [
      { key: 'noResp',            n: s.noResp||0,            label: t('lbl_no_responsible') },
      { key: 'noInv',             n: s.noInv||0,              label: t('lbl_no_inv') },
      { key: 'noSerial',          n: s.noSerial||0,           label: t('lbl_no_serial') },
      { key: 'warrantyExpired',   n: s.warrantyExpired||0,    label: t('lbl_warranty_expired') },
      { key: 'warrantyExpiring',  n: s.warrantyExpiring||0,   label: t('lbl_warranty_expiring') },
    ].filter(it => it.n > 0);
    const total = items.reduce((sum, it) => sum + it.n, 0);

    bell.classList.remove('u-hidden');
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.toggle('u-hidden', total === 0);
    }
    bell.title = total > 0 ? t('msg_notif_count', { n: total }) : t('msg_notif_none');

    const panel = document.getElementById('notif-panel');
    if (panel && panel.classList.contains('open')) renderNotifPanel(items);
  } catch (e) {
    // Тихо не показываем колокольчик при ошибке — в отличие от health,
    // где ошибка САМА по себе диагностически важна (это индикатор
    // здоровья сервера), здесь отсутствие данных не несёт такого смысла,
    // нет смысла тревожить пользователя нерабочим колокольчиком.
    bell.classList.add('u-hidden');
  }
}

function renderNotifPanel(items) {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="u-fw-700 u-mb-6">${t('notif_panel_title')}</div>
    ${items.length ? items.map(it => `
      <div class="np-row" data-action="_notifRowClick">
        <span>${esc(it.label)}</span>
        <span class="np-count">${it.n}</span>
      </div>`).join('') : `<div class="np-empty">${t('msg_notif_none')}</div>`}
  `;
}

function _notifRowClick() {
  document.getElementById('notif-panel')?.classList.remove('open');
  switchTab('alerts');
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) { panel.classList.remove('open'); return; }
  const items = _notifLast ? [
    { key: 'noResp',           n: _notifLast.noResp||0,           label: t('lbl_no_responsible') },
    { key: 'noInv',            n: _notifLast.noInv||0,            label: t('lbl_no_inv') },
    { key: 'noSerial',         n: _notifLast.noSerial||0,         label: t('lbl_no_serial') },
    { key: 'warrantyExpired',  n: _notifLast.warrantyExpired||0,  label: t('lbl_warranty_expired') },
    { key: 'warrantyExpiring', n: _notifLast.warrantyExpiring||0, label: t('lbl_warranty_expiring') },
  ].filter(it => it.n > 0) : [];
  renderNotifPanel(items);
  panel.classList.add('open');
  setTimeout(() => {
    document.addEventListener('click', _onOutsideNotifClick, { once: true });
  }, 0);
}

function _onOutsideNotifClick(e) {
  const panel = document.getElementById('notif-panel');
  const bell  = document.getElementById('notif-bell');
  if (!panel) return;
  if (panel.contains(e.target) || bell?.contains(e.target)) {
    setTimeout(() => document.addEventListener('click', _onOutsideNotifClick, { once: true }), 0);
    return;
  }
  panel.classList.remove('open');
}

function startNotifPolling() {
  stopNotifPolling();
  refreshNotifications();
  _notifTimer = setInterval(refreshNotifications, NOTIF_POLL_MS);
}

function stopNotifPolling() {
  if (_notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
}
