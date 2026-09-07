/**
 * public/js/views/inv-generator.js
 *
 * Фаза 5, шаг 18: генератор инвентарных номеров (модалка + подмодалка
 * создания правила на лету), вынесенный из public/index.html. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js).
 */

function openInvGenerator(targetId, orgSelectId, typeSelectId) {
  const orgs  = invCodes.orgs  || {};
  const types = invCodes.types || {};

  // ── Автоподбор из контекстной формы ──────────────────────────────────────
  // Орг: из select по имени орг → ищем short_code
  let preselectedOrg  = '';
  let preselectedType = '';

  if (orgSelectId) {
    const orgEl = document.getElementById(orgSelectId);
    const orgName = orgEl?.value?.trim() || '';
    if (orgName) {
      // orgs = { YRK: 'ЯРКО', LDV: 'Лето ДВЛ', ... }
      const match = Object.entries(orgs).find(([code, name]) =>
        name === orgName || code === orgName.toUpperCase()
      );
      if (match) preselectedOrg = match[0];
    }
  }

  if (typeSelectId) {
    const typeEl = document.getElementById(typeSelectId);
    const typeName = typeEl?.value?.trim() || '';
    if (typeName) {
      // types = { NB: 'Ноутбук', MON: 'Монитор', ... }
      const match = Object.entries(types).find(([code, name]) =>
        name === typeName || code === typeName.toUpperCase()
      );
      if (match) preselectedType = match[0];
      // Если не нашли — покажем подсказку: нет правила для этого типа у орг
    }
  }

  const orgOpts = Object.entries(orgs)
    .map(([k,v])=>`<option value="${k}" ${k===preselectedOrg?'selected':''}>${k} — ${v}</option>`)
    .join('');
  const typeOpts = Object.entries(types)
    .map(([k,v])=>`<option value="${k}" ${k===preselectedType?'selected':''}>${k} — ${v}</option>`)
    .join('');

  const hasPreset = preselectedOrg && preselectedType;

  showModal(`
    <h2>${t('inv_gen_title')}</h2>
    <div class="u-text-12 u-text-muted u-mb-14">
      ${t('inv_gen_format_hint')}
    </div>
    ${hasPreset ? `<div class="inline-msg success-box u-text-success">
      ${t('msg_picked_from_form')}: <b>${preselectedOrg}</b> · <b>${preselectedType}</b>
    </div>` : (preselectedOrg && !preselectedType) ? `<div class="inline-msg warn-box u-text-warn">
      ${t('msg_no_rule_for_type', { type: document.getElementById(typeSelectId)?.value||'?' })}
      <button class="btn btn-primary btn-sm u-mt-8"
        data-action="createInvRuleFromGenerator" data-args='${JSON.stringify([preselectedOrg, document.getElementById(typeSelectId)?.value||''])}'>
        ${t('btn_create_rule_for_type')}
      </button>
    </div>` : ''}
    <div class="two-col">
      <div class="form-row"><label>${t('field_organization')}</label>
        <select id="ig-org" data-onchange-action="refreshInvPreview">${orgOpts}</select>
      </div>
      <div class="form-row"><label>${t('field_device_type')}</label>
        <select id="ig-type" data-onchange-action="refreshInvPreview">${typeOpts}</select>
      </div>
    </div>
    <div class="form-row">
      <label>${t('field_preview')}</label>
      <div class="u-flex-gap-7">
        <input id="ig-preview" class="inv-preview inv-preview-ok" readonly/>
        <button class="btn btn-secondary btn-sm" data-action="refreshInvPreview">${t('btn_refresh')}</button>
      </div>
    </div>
    <div id="ig-note" class="u-text-12 u-text-muted u-mt-4"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="applyInvNumber" data-args='${JSON.stringify([targetId])}'>${t('btn_apply')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>
  `);
  refreshInvPreview();
}

async function refreshInvPreview() {
  const org  = document.getElementById('ig-org')?.value;
  const type = document.getElementById('ig-type')?.value;
  if (!org || !type) return;
  const el   = document.getElementById('ig-preview');
  const note = document.getElementById('ig-note');
  try {
    const r = await fetch(`${API}/api/inv/next?org=${org}&type=${type}`, { headers: ah() });
    const d = await r.json();
    if (r.ok && d.inv) {
      if (el) { el.value = d.inv; el.style.background='#eff6ff'; el.style.color='#1d4ed8'; }
      if (note) note.innerHTML = t('msg_next_free_number', { org, type });
      // Скрываем кнопку создания если была
      const cb = document.getElementById('ig-create-rule-btn');
      if (cb) cb.style.display = 'none';
    } else {
      // Нет правила для этой пары орг+тип
      if (el) { el.value = ''; el.style.background='var(--warn-bg)'; el.style.color='var(--warn-text)'; }
      if (note) note.innerHTML = `
        <span class="u-text-warn">${t('msg_no_rule_for_pair', { org, type })}</span>
        <button id="ig-create-rule-btn" class="btn btn-primary btn-sm u-ml-8"
          data-action="createInvRuleFromGenerator" data-args='${JSON.stringify([org,""])}'>
          ${t('btn_create_rule')}
        </button>`;
    }
  } catch(e) {
    if (note) note.textContent = t('msg_error_prefix') + ': ' + e.message;
  }
}

async function applyInvNumber(targetId) {
  const inv  = document.getElementById('ig-preview')?.value;
  const org  = document.getElementById('ig-org')?.value;
  const type = document.getElementById('ig-type')?.value;
  if (!inv) return;
  // Reserve the number
  await fetch(`${API}/api/inv/reserve`,{method:'POST',headers:ah(),body:JSON.stringify({org,type})}).catch(()=>{});
  closeModal();
  // We need to re-open the parent modal... instead just set value on existing field
  setTimeout(()=>{
    const el = document.getElementById(targetId);
    if (el) { el.value = inv; el.style.background='#eff6ff'; el.style.color='#1d4ed8'; }
  }, 100);
}


async function createInvRuleFromGenerator(orgCode, typeName) {
  // Находим org_id по short_code
  const orgs = await fetch(`${API}/api/orgs`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  const org = orgs.find(o => o.short_code === orgCode);
  if (!org) return toast(t('msg_org_not_found', { org: orgCode }), 'error');

  // Автозаполняем type_code из имени если возможно
  const typeCodes = await fetch(`${API}/api/type-codes`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  const matchedCode = typeCodes.find(tc => tc.name === typeName);
  const autoCode = matchedCode ? matchedCode.code : '';
  const autoName = typeName || '';

  // Показываем inline-форму поверх текущего модала
  const note = document.getElementById('ig-note');
  if (!note) return;
  note.innerHTML = `
    <div class="info-callout">
      <div class="info-callout-title">
        ${t('msg_new_rule_for', { org: orgCode })}
      </div>
      <div class="two-col u-gap-8">
        <div>
          <div class="u-text-11 u-text-muted u-mb-3">${t('field_type_code_required')}</div>
          <input id="igcr-code" value="${autoCode}" placeholder="NB" maxlength="6"
            class="u-w-100 u-text-13" data-oninput-action="forceUppercase"/>
        </div>
        <div>
          <div class="u-text-11 u-text-muted u-mb-3">${t('field_type_name_required_short')}</div>
          <input id="igcr-name" value="${autoName}" placeholder="${t('msg_type_name_placeholder')}" class="u-w-100 u-text-13"/>
        </div>
      </div>
      <div class="u-text-11 u-text-muted u-mt-6 u-mb-8">
        ${t('msg_inv_number_will_be')} <code>${orgCode}-[${t('lbl_code_placeholder')}]-00001</code>
      </div>
      <div class="u-flex-gap-6">
        <button class="btn btn-primary btn-sm" data-action="submitInvRuleFromGenerator" data-args='${JSON.stringify([org.id,orgCode])}'>${t('btn_create_and_apply')}</button>
        <button class="btn btn-secondary btn-sm" data-action="refreshInvPreview">${t('btn_cancel')}</button>
      </div>
    </div>`;
}

async function submitInvRuleFromGenerator(orgId, orgCode) {
  const type_code = document.getElementById('igcr-code')?.value.trim().toUpperCase();
  const type_name = document.getElementById('igcr-name')?.value.trim();
  if (!type_code || !type_name) return toast(t('msg_fill_code_and_name'), 'error');

  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules`, {
    method: 'POST', headers: ah(),
    body: JSON.stringify({ type_code, type_name })
  });
  const d = await r.json();
  if (!r.ok) return toast(d.error || t('msg_creating_rule_error'), 'error');

  toast(t('msg_rule_created', { org: orgCode, code: type_code }), 'success');

  // Обновляем список типов в селекте генератора
  const typeEl = document.getElementById('ig-type');
  if (typeEl) {
    // Добавляем новый option и выбираем его
    const opt = document.createElement('option');
    opt.value = type_code;
    opt.textContent = `${type_code} — ${type_name}`;
    opt.selected = true;
    typeEl.appendChild(opt);
  }

  // Обновляем глобальный кэш орг
  _orgsCache = await fetch(`${API}/api/orgs`, { headers: ah() }).then(r=>r.json()).catch(()=>_orgsCache);

  // Перезапрашиваем номер
  await refreshInvPreview();
}
