/**
 * public/js/views/dashboard.js
 *
 * Фаза 5, шаг 10: первый экран view-слоя, вынесенный из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 * Самодостаточна: без параметров, только глобалы (document, currentUser,
 * esc, switchTab, API), резолвятся в момент вызова.
 */

async function renderDashboard() {
  const app=document.getElementById('app');
  app.innerHTML='<div class="spinner"></div>';
  let stats, hist;
  try {
    [stats,hist]=await Promise.all([
      fetch(`${API}/api/stats`).then(r=>r.json()),
      fetch(`${API}/api/history?limit=10`).then(r=>r.json())
    ]);
  } catch(e) {
    app.innerHTML=`<div class="card dashboard-error">
      ${t('msg_dashboard_connection_error', { msg: e.message })}<br>
      <small class="u-text-muted">${t('msg_ensure_server_running')}</small></div>`;
    return;
  }
  if (!stats || !hist) { app.innerHTML=`<div class="card">${t('msg_no_server_data')}</div>`; return; }
  const histItems = Array.isArray(hist) ? hist : (hist.items||[]);
  document.getElementById('total-badge').textContent=stats.total+' '+t('unit_items');
  const COLORS=['#e94560','#6366f1','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f97316','#64748b','#0ea5e9','#84cc16'];
  const maxType=Math.max(...(stats.byType||[]).map(ty=>ty.n),1);
  const maxFil =Math.max(...(stats.byFilial||[]).map(f=>f.n),1);
  app.innerHTML=`
  <!-- Глобальный поиск — только для залогиненных -->
  ${currentUser ? `<div class="card search-card">
    <div class="u-flex-gap-10">
      <span class="u-text-20">🔍</span>
      <input id="global-search-inp" type="text" placeholder="${t('msg_global_search_placeholder')}"
        class="focus-border-accent"
        class="focus-border-accent search-input"
        data-oninput-action="globalSearchDebounce"/>
      <button class="btn btn-ghost btn-sm u-hidden" id="global-search-clear" data-action="clearGlobalSearch">✕</button>
    </div>
    <div id="global-search-results" class="search-results-collapse"></div>
  </div>` : `<div class="card login-prompt-card">
    <div class="u-text-32 u-mb-10">🔐</div>
    <div class="u-text-15 u-fw-600 u-mb-6">${t('msg_login_for_full_access')}</div>
    <div class="u-text-13 u-text-muted u-mb-14">${t('msg_login_required_note')}</div>
    <button class="btn btn-primary" data-action="toggleAuth">${t('btn_login_to_system')}</button>
  </div>`}

  <div class="stat-grid">
    ${[{n:stats.total,l:t('lbl_total_units'),c:'#6366f1'},{n:stats.active,l:t('lbl_in_use'),c:'#10b981'},
       {n:stats.reserve,l:t('lbl_in_reserve'),c:'#f59e0b'},{n:stats.noResp,l:t('lbl_no_responsible'),c:'#e94560'},
       ...(stats.byTab||[]).map(tb=>({n:tb.n,l:tabLabel(tb.tab),c:'#8b5cf6'}))
    ].map(s=>`<div class="stat-card" data-accent="${s.c}">
      <div class="stat-num" data-accent="${s.c}">${s.n}</div><div class="stat-lbl">${s.l}</div></div>`).join('')}
  </div>
  <div class="two-col">
    <div class="card"><div class="section-title">${t('section_by_branch')}</div>
      ${(stats.byFilial||[]).map(f=>`<div class="bar-row"><div class="bar-lbl">${f.filial}</div>
        <div class="bar" data-w="${Math.max(f.n/maxFil*150,6)}" data-bg="#6366f1"></div>
        <div class="bar-num">${f.n}</div></div>`).join('')}
    </div>
    <div class="card"><div class="section-title">${t('section_by_type')}</div>
      ${(stats.byType||[]).map((ty,i)=>`<div class="bar-row"><div class="bar-lbl">${ty.type}</div>
        <div class="bar" data-w="${Math.max(ty.n/maxType*150,6)}" data-bg="${COLORS[i%COLORS.length]}"></div>
        <div class="bar-num">${ty.n}</div></div>`).join('')}
    </div>
  </div>
  ${currentUser ? `
  <div class="card"><div class="section-title">${t('section_recent_moves')}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>${t('th_date')}</th><th>${t('th_event')}</th><th>${t('th_from_who')}</th><th>${t('th_to')}</th><th>${t('th_equipment')}</th><th>${t('th_reason')}</th></tr></thead>
      <tbody>${(histItems||[]).map(h=>{
        const atype=h.action_type||'move';
        const abadge={'add':'hist-badge-add','move':'hist-badge-move','retire':'hist-badge-retire','import':'hist-badge-import','reassign':'hist-badge-reassign'}[atype]||'hist-badge-move';
        const aicon={'add':'+','move':'->','retire':'x','import':'v','reassign':'>'}[atype]||'->';
        const alabel={'add':t('action_add'),'move':t('action_move'),'retire':t('action_retire'),'import':t('action_import'),'reassign':t('action_move')}[atype]||esc(h.reason);
        const dt=h.date?new Date(h.date):null;
        const dateStr=dt?dt.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';
        const timeStr=dt&&h.date.length>10?dt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
        return `<tr>
        <td class="u-nowrap"><div class="u-fw-600">${dateStr}</div>${timeStr?`<div class="u-text-10 u-text-muted">${timeStr}</div>`:''}</td>
        <td><span class="hist-badge ${abadge}">${alabel}</span></td>
        <td class="u-text-muted u-text-12 u-max-w-120 u-ellipsis">${esc(h.from_who)||'—'}</td>
        <td class="u-fw-500 u-text-12 u-max-w-120 u-ellipsis">${esc(h.to_who)||'—'}</td>
        <td class="u-max-w-200 u-ellipsis u-text-12">${esc(h.equipment||'')}</td>
        <td><span class="badge-cat u-text-10">${esc(h.reason||'')}</span></td></tr>`;
      }).join('')}
      </tbody></table></div>
  </div>

  <div class="card u-mt-18">
    <div class="section-title">${t('section_by_org')}</div>
    ${stats.byOrg && stats.byOrg.length ? `
    <div class="u-flex-col-gap-6">
      ${stats.byOrg.slice(0,10).map(o => {
        const pct = stats.total > 0 ? Math.round(o.n / stats.total * 100) : 0;
        return `<div>
          <div class="u-flex-between u-text-12 u-mb-3">
            <span>${esc(o.org)}</span>
            <span class="u-text-muted">${o.n} ${t('msg_units_short')} · ${pct}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" data-w="${pct}"></div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `<div class="u-text-muted u-text-13">${t('msg_no_data_short')}</div>`}
  </div>
  ` : ''}

  ${currentUser && (stats.noInv > 0 || stats.noSerial > 0 || stats.noResp > 0 || stats.warrantyExpired > 0 || stats.warrantyExpiring > 0) ? `
  <div class="card amber-card">
    <div class="section-title">${t('section_needs_attention')}</div>
    <div class="stats-grid-fit">
      ${stats.noResp > 0 ? `<div class="stat-box-warn"
          data-action="switchTab" data-args='["alerts"]'>
        <div class="u-text-22 u-fw-700 u-text-warn">${stats.noResp}</div>
        <div class="u-text-12 u-text-warn u-opacity-8">${t('lbl_no_responsible')}</div>
      </div>` : ''}
      ${stats.noInv > 0 ? `<div class="stat-box-noinv"
          data-action="switchTab" data-args='["alerts"]'>
        <div class="u-text-22 u-fw-700 u-text-noinv">${stats.noInv}</div>
        <div class="u-text-12 u-text-noinv u-opacity-8">${t('lbl_no_inv')}</div>
      </div>` : ''}
      ${stats.noSerial > 0 ? `<div class="stat-box-noserial"
          data-action="switchTab" data-args='["alerts"]'>
        <div class="u-text-22 u-fw-700 u-text-noserial">${stats.noSerial}</div>
        <div class="u-text-12 u-text-5b21b6">${t('lbl_no_serial')}</div>
      </div>` : ''}
      ${stats.warrantyExpired > 0 ? `<div class="stat-box-danger"
          data-action="switchTab" data-args='["alerts"]'>
        <div class="u-text-22 u-fw-700 u-text-danger-strong">${stats.warrantyExpired}</div>
        <div class="u-text-12 u-text-danger-strong u-opacity-8">${t('lbl_warranty_expired')}</div>
      </div>` : ''}
      ${stats.warrantyExpiring > 0 ? `<div class="stat-box-warn"
          data-action="switchTab" data-args='["alerts"]'>
        <div class="u-text-22 u-fw-700 u-text-warn">${stats.warrantyExpiring}</div>
        <div class="u-text-12 u-text-warn u-opacity-8">${t('lbl_warranty_expiring')}</div>
      </div>` : ''}
    </div>
  </div>` : ''}
`;

  // CSP-17: акцентные цвета/ширины считаются из данных (не конечный
  // перечень) — задаём через data-* и точечный style после вставки, как
  // уже делали в alerts.js/asset-forms.js.
  app.querySelectorAll('.stat-card[data-accent]').forEach(el => { el.style.borderLeftColor = el.dataset.accent; });
  app.querySelectorAll('.stat-num[data-accent]').forEach(el => { el.style.color = el.dataset.accent; });
  app.querySelectorAll('.bar[data-w]').forEach(el => {
    el.style.width = el.dataset.w + 'px';
    if (el.dataset.bg) el.style.background = el.dataset.bg;
  });
  app.querySelectorAll('.progress-fill[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
}
