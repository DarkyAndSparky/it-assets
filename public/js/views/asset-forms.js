/**
 * public/js/views/asset-forms.js
 *
 * Фаза 5, шаг 17: модалки создания/редактирования/перемещения/удаления
 * актива + карточка деталей, вынесенные из public/index.html. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * НЕ включено (осознанно, отдельный будущий шаг): openInvGenerator и его
 * подсистема (refreshInvPreview, applyInvNumber, createInvRuleFromGenerator),
 * buildQrText/renderQrInto/printAsset, initEmployeeAutocomplete — это
 * отдельный самостоятельный кластер (генератор инв. номеров + QR + автокомплит
 * сотрудников), используется этими формами, но заслуживает отдельного разбора.
 * Остаются как внешние глобалы в index.html, резолвятся в момент вызова.
 */

// Фаза 6: были data-onchange-action="_onFilialSelectChange" data-onchange-args='["m-loc"]' и т.п. — value
// стоит ПЕРВЫМ аргументом, а не последним (конвенция el.value-в-конце тут не
// подходит). Обёртка читает this.value напрямую (this===элемент при
// делегировании через data-onchange-action).
function _onFilialSelectChange(locSelectId) {
  _updateLocSelect(this.value, locSelectId);
}

// Аналогично: data-onchange-action="_onCategorySelectChange" data-onchange-args='${JSON.stringify([tab, "a-meta"])}' —
// value ПОСЕРЕДИНЕ аргументов.
function _onCategorySelectChange(tab, containerId) {
  const typeSel = document.getElementById(containerId === 'a-meta' ? 'a-type' : 'e-type');
  updateMetaForm(tab, this.value, containerId, typeSel ? typeSel.value : '');
}

// PROD-2: смена типа устройства тоже должна перерисовать meta-форму (у
// разных типов может быть своя схема полей, см. PROD-1/types-admin.js) —
// раньше форма реагировала только на смену категории.
function _onTypeSelectChange(containerId) {
  const catSel = document.getElementById(containerId === 'a-meta' ? 'a-cat' : 'e-cat');
  updateMetaForm(null, catSel ? catSel.value : '', containerId, this.value);
}

// Было data-action="_closeThenShowMove" data-args='${JSON.stringify([id])}' — два оператора подряд.
function _closeThenShowMove(id) { closeModal(); showMoveModal(id); }
function _closeThenShowEdit(id) { closeModal(); showEditModal(id); }

// PROD-17: "Показать всю историю" из карточки актива — переключает на
// вкладку Истории и подставляет модель актива в её строку поиска (у
// history.js нет отдельного UI-фильтра по конкретному asset_id, но
// поиск там уже умеет искать по модели в поле equipment — используем
// существующий механизм вместо того, чтобы заводить новый).
function _openFullHistoryForAsset(model) {
  closeModal();
  if (typeof histFilters !== 'undefined') histFilters.search = model;
  switchTab('history');
}

// Было (только для password-поля) самомодифицирующий onclick, показывающий
// реальное значение при клике (маскированное поле).
function _revealMaskedValue(realValue) {
  this.textContent = this.dataset.v ? this.dataset.v : this.textContent;
  this.dataset.v = this.dataset.v || realValue;
}

// ─── ФОТО АКТИВОВ ─────────────────────────────────────────────────────────────
// <img src="..."> не может нести кастомные auth-заголовки (x-user-id) — а
// GET /api/assets/:id/photos/:photoId защищён requireLogin (INFRA-7). Поэтому
// грузим каждое фото через fetch(..., {headers: ah()}) и превращаем в blob
// URL, единственный рабочий вариант с нашей header-based моделью авторизации
// (не cookie-based, браузер не может подставить заголовок сам).
const _photoBlobUrls = new Set(); // отслеживаем, чтобы освобождать через URL.revokeObjectURL при закрытии модалки

function _renderPhotoGrid(assetId, photos) {
  if (!photos.length) {
    return `<div class="u-text-muted u-text-12 u-p-8-0">${t('msg_no_photos')}</div>`;
  }
  return `<div class="photo-grid">
    ${photos.map((p,i) => `
      <div class="u-relative">
        <div class="photo-thumb-wrap photo-thumb-frame" data-action="_openPhotoLightboxAt" data-args='${JSON.stringify([assetId, photos, i])}'>
          <img id="photo-thumb-${p.id}" class="photo-thumb-img"/>
          <span id="photo-thumb-spinner-${p.id}" class="u-text-11 u-text-muted">…</span>
        </div>
        ${canEdit()?`
        <button class="btn-icon" title="${t('tooltip_delete_photo')}" data-action="_deleteAssetPhoto" data-args='${JSON.stringify([assetId, p.id])}'
          class="photo-del-btn">🗑</button>`:''}
      </div>`).join('')}
  </div>`;
}

// INSERT-1 (по запросу пользователя, после первой версии фичи): секция
// фото в карточке актива теперь свёрнута по умолчанию — миниатюры (а
// значит и байты изображений) грузятся только по клику на «Показать
// фото», а не при каждом открытии карточки. Список метаданных фото
// (без байтов, дёшево) всё равно приходит вместе с деталью актива — он
// нужен для счётчика "(N)" на самой кнопке-переключателе.
// PROD-10: версии уже пришли целиком вместе с деталью актива (не
// paginated, разумный лимит — обычно единицы-десятки правок на актив за
// его жизнь, не тысячи) — toggle просто прячет/показывает готовый HTML,
// без отдельного запроса. Чисто classList.toggle — никакого inline
// style.display: инлайн-стиль имеет более высокий приоритет, чем класс
// .u-hidden{display:none}, смешивать их в одном переключателе — верный
// способ поймать состояние, где элемент невозможно скрыть повторным
// кликом (инлайн style:block остаётся сильнее класса).
function _toggleVersionsSection(assetId) {
  const box = document.getElementById(`asset-versions-box-${assetId}`);
  if (box) box.classList.toggle('u-hidden');
}

// Поля снапшота, которые показываем в развёрнутом виде версии — то же,
// что и на самой карточке (two-col блок) плюс meta, минус служебные
// (id/org_id/filial_id/location_id/created_at/updated_at/tab/category —
// либо не интересны для просмотра истории значений, либо дублируют то,
// что уже видно в шапке версии).
const _VERSION_FIELD_LABELS = {
  model:'Модель', type:'Тип', serial:'S/N', inv:'Инв. номер',
  status:'Статус', responsible:'Ответственный', filial:'Филиал',
  location:'Расположение', org:'Организация', note:'Примечание',
};
function _renderVersionSnapshot(snap) {
  const rows = Object.entries(_VERSION_FIELD_LABELS)
    .filter(([k]) => snap[k])
    .map(([k,label]) => `<div class="detail-lbl">${esc(label)}</div><div class="detail-val">${esc(snap[k])}</div>`);
  const metaRows = Object.entries(snap.meta || {})
    .filter(([,v]) => v)
    .map(([k,v]) => `<div class="detail-lbl">${esc(metaLabel(k))}</div><div class="detail-val ${k==='password'?'mono':''}">${k==='password'?'••••••':esc(v)}</div>`);
  return `<div class="two-col u-text-12">${rows.join('')}${metaRows.join('')}</div>`;
}

function _renderVersionsList(versions) {
  return `<div class="timeline-rail">
    <div class="timeline-line"></div>
    ${versions.map(v => `
      <div class="u-relative u-mb-12">
        <div class="timeline-dot" data-dot-color="#6366f1"></div>
        <div class="u-text-11 u-text-muted u-mb-4">
          <b>v${v.version_no}</b> · ${fd(v.created_at)}
          ${v.changed_by?` · ${esc(v.changed_by)}`:''}
        </div>
        ${_renderVersionSnapshot(v.snapshot)}
      </div>`).join('')}
  </div>`;
}

function _togglePhotoSection(assetId, photos) {
  const box = document.getElementById(`asset-photos-box-${assetId}`);
  const btn = document.getElementById(`asset-photos-toggle-${assetId}`);
  if (!box || !btn) return;
  const isOpen = box.style.display !== 'none';
  if (isOpen) {
    box.style.display = 'none';
    btn.textContent = t('btn_show_photos', { n: photos.length });
  } else {
    box.style.display = 'block';
    btn.textContent = t('btn_hide_photos');
    if (!box.dataset.loaded) {
      box.dataset.loaded = '1';
      _loadPhotoThumbnails(assetId, photos);
    }
  }
}

async function _loadPhotoThumbnails(assetId, photos) {
  for (const p of photos) {
    try {
      const blob = await fetch(`${API}/api/assets/${assetId}/photos/${p.id}`, { headers: ah() }).then(r => { if (!r.ok) throw new Error(); return r.blob(); });
      const url = URL.createObjectURL(blob);
      _photoBlobUrls.add(url);
      const img = document.getElementById(`photo-thumb-${p.id}`);
      const spinner = document.getElementById(`photo-thumb-spinner-${p.id}`);
      if (img) { img.src = url; img.style.display = 'block'; }
      if (spinner) spinner.style.display = 'none';
    } catch (e) { /* тихо — одно неудавшееся фото не должно ломать остальную сетку */ }
  }
}

// Вызывается через data-onchange-action — event-delegation.js делает
// fn.apply(el, args), то есть `this` внутри — сам <input type="file">
// (см. public/js/event-delegation.js). el.value тоже приходит вторым
// аргументом автоматически (для файлового инпута бесполезен — просто
// fake-путь вида "C:\fakepath\photo.jpg", игнорируем).
async function _onAssetPhotoInputChange(assetId) {
  const input = this;
  const files = input?.files;
  if (!files || !files.length) return;

  const grid = document.getElementById(`asset-photos-grid-${assetId}`);

  for (const file of Array.from(files)) {
    if (file.size > 8 * 1024 * 1024) { toast(`${file.name}: ${t('msg_photo_too_large')}`, 'error'); continue; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const r = await fetch(`${API}/api/assets/${assetId}/photos`, {
        method: 'POST', headers: ah(),
        body: JSON.stringify({ photo: dataUrl, original_name: file.name }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error || t('msg_photo_upload_error'), 'error'); continue; }
    } catch (e) {
      toast(t('msg_photo_upload_error'), 'error');
    }
  }
  input.value = ''; // сбрасываем — иначе повторный выбор того же файла не сгенерирует change

  // Перерисовываем сетку целиком — проще, чем точечно вставлять новые
  // элементы, и гарантированно синхронно с сервером. Секция уже открыта
  // (раз пользователь только что нажал «+ Фото» внутри неё) — сразу
  // грузим миниатюры.
  const photos = await fetch(`${API}/api/assets/${assetId}/photos`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  if (grid) {
    grid.innerHTML = _renderPhotoGrid(assetId, photos);
    _loadPhotoThumbnails(assetId, photos);
  }
  toast(t('msg_photo_uploaded'), 'success');
}

async function _deleteAssetPhoto(assetId, photoId) {
  if (!confirm(t('msg_confirm_delete_photo'))) return;
  const r = await fetch(`${API}/api/assets/${assetId}/photos/${photoId}`, { method: 'DELETE', headers: ah() });
  if (!r.ok) { const d = await r.json().catch(()=>({})); return toast(d.error || t('msg_error'), 'error'); }
  toast(t('msg_photo_deleted'), 'success');
  const grid = document.getElementById(`asset-photos-grid-${assetId}`);
  const photos = await fetch(`${API}/api/assets/${assetId}/photos`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  if (grid) {
    grid.innerHTML = _renderPhotoGrid(assetId, photos);
    _loadPhotoThumbnails(assetId, photos);
  }
}

// INSERT-2: лайтбокс с навигацией «вперёд/назад» — важно для составных
// вещей с несколькими фото (например, комплект из нескольких предметов,
// разные ракурсы шильдика). `photos` — весь массив метаданных (без
// байтов, уже есть на руках у вызывающего кода), `index` — на каком фото
// сейчас остановились, с переносом по кругу (после последнего — снова
// первое).
async function _openPhotoLightboxAt(assetId, photos, index) {
  if (!photos || !photos.length) return;
  index = ((index % photos.length) + photos.length) % photos.length;
  const photo = photos[index];
  try {
    const blob = await fetch(`${API}/api/assets/${assetId}/photos/${photo.id}`, { headers: ah() }).then(r => { if (!r.ok) throw new Error(); return r.blob(); });
    const url = URL.createObjectURL(blob);
    _photoBlobUrls.add(url);
    const hasMultiple = photos.length > 1;
    showModal(`
      <div class="lightbox-frame">
        ${hasMultiple?`<button class="btn-icon" data-action="_openPhotoLightboxAt" data-args='${JSON.stringify([assetId, photos, index-1])}' class="u-text-22 u-shrink-0">‹</button>`:''}
        <img src="${url}" class="lightbox-img"/>
        ${hasMultiple?`<button class="btn-icon" data-action="_openPhotoLightboxAt" data-args='${JSON.stringify([assetId, photos, index+1])}' class="u-text-22 u-shrink-0">›</button>`:''}
      </div>
      ${hasMultiple?`<div class="u-text-center u-text-12 u-text-muted u-mt-8">${index+1} / ${photos.length}${photo.original_name?' · '+esc(photo.original_name):''}</div>`
        :(photo.original_name?`<div class="u-text-center u-text-12 u-text-muted u-mt-8">${esc(photo.original_name)}</div>`:'')}
      <div class="modal-actions u-mt-14">
        <button class="btn btn-secondary" data-action="closeModal">${t('btn_close')}</button>
      </div>`);
  } catch (e) {
    toast(t('msg_error'), 'error');
  }
}

// INSERT-3: быстрый переход к фото прямо из таблицы активов (значок 📷 у
// модели, см. asset-tab.js) — без открытия полной карточки. Список
// метаданных на таблице ещё не подгружен (там только photo_count), так
// что тут единственный дополнительный запрос — сам список для конкретного
// актива, byte-контент фото по-прежнему грузится лениво самим лайтбоксом.
async function _openAssetPhotosQuick(assetId) {
  const photos = await fetch(`${API}/api/assets/${assetId}/photos`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  if (!photos.length) return;
  _openPhotoLightboxAt(assetId, photos, 0);
}

async function showDetail(id) {
  const [a, histResp, photos, versions] = await Promise.all([
    fetch(`${API}/api/assets/${id}`, { headers: ah() }).then(r=>r.json()),
    fetch(`${API}/api/history?asset_id=${id}&limit=30`, { headers: ah() }).then(r=>r.json()),
    fetch(`${API}/api/assets/${id}/photos`, { headers: ah() }).then(r=>r.ok ? r.json() : []).catch(()=>[]),
    fetch(`${API}/api/assets/${id}/versions`, { headers: ah() }).then(r=>r.ok ? r.json() : []).catch(()=>[]),
  ]);
  const hist = Array.isArray(histResp) ? histResp : (histResp.items || []);
  // Org lookup через справочник
  if (!a.org && a.org_id && _orgsCache.length) {
    const org = _orgsCache.find(o => o.id === a.org_id);
    if (org) a.org = org.name;
  }
  const mf=getMetaFieldDefs(a.category, a.type).map(f=>f.key);
  const metaRows=mf.filter(k=>a.meta?.[k]).map(k=>`
    <div><div class="detail-lbl">${metaLabel(k)}</div>
    <div class="detail-val ${k==='password'?'pw-mask mono':'mono'}" ${k==='password'?`data-action="_revealMaskedValue" data-args='${JSON.stringify([esc(a.meta[k] || '')])}'`:''}>
      ${k==='password'?(a.meta[k]?'••••••':'—'):esc(a.meta[k])}</div></div>`).join('');

  showModal(`
    <div class="detail-header">
      <div>
        <div class="u-text-26">${ic(a.type)}</div>
        <div class="u-fw-800 u-text-17">${esc(a.model)}</div>
        <div class="u-text-muted u-text-12">${esc(a.type)} · <span class="badge-cat">${esc(a.category)}</span></div>
      </div>
      <div class="u-flex-gap-6">
        <span class="badge-s ${sc(a.status)}">${a.status}</span>
        <button class="btn btn-ghost btn-sm" data-action="closeModal">✕</button>
      </div>
    </div>
    <div class="two-col">
      ${[[t('field_inv'),a.inv,'mono'],[t('field_serial'),a.serial,'mono'],[t('field_responsible'),a.responsible,''],
         [t('field_filial'),a.filial,''],[t('field_location'),a.location,''],
         [t('field_org'),a.org,''],[t('field_note'),a.note,'']
        ].filter(([,v])=>v&&v!=='—').map(([l,v,cls])=>`
        <div><div class="detail-lbl">${l}</div><div class="detail-val ${cls}">${esc(v)}</div></div>`).join('')}
    </div>
    ${metaRows?`<hr class="sep"/><div class="section-title">${t('section_meta')}</div>
      <div class="meta-grid">${metaRows}</div>`:''}
    <hr class="sep"/>
    <div class="photo-section-header">
      ${photos.length?`
        <button id="asset-photos-toggle-${id}" class="btn btn-secondary btn-sm u-m-0"
          data-action="_togglePhotoSection" data-args='${JSON.stringify([id, photos])}'>${t('btn_show_photos', { n: photos.length })}</button>
      `:`<div class="section-title u-m-0">${t('section_photos')}</div>`}
      ${canEdit()?`
        <label class="btn btn-secondary btn-sm u-cursor-pointer u-m-0">
          ${t('btn_add_photo')}
          <input type="file" accept="image/*" capture="environment" multiple
            class="u-hidden" data-onchange-action="_onAssetPhotoInputChange" data-onchange-args='${JSON.stringify([id])}'/>
        </label>` : ''}
    </div>
    <div id="asset-photos-box-${id}" class="u-hidden">
      <div id="asset-photos-grid-${id}">${_renderPhotoGrid(id, photos)}</div>
    </div>
    ${hist.length?`<hr class="sep"/>
    <div class="u-text-11 u-fw-600 u-text-muted u-mb-10 u-ls-05">
      ${t('section_history_count', { n: hist.length })}
    </div>
    <div class="timeline-rail">
      <div class="timeline-line"></div>
      ${hist.map((h,i)=>{
        // PROD-17: различаем все 6 типов события (тот же набор, что и в
        // dashboard.js/history.js — их иконка+цвет только продублированы
        // здесь как inline-логика, а не переиспользованы напрямую, потому
        // что там это JS-объекты внутри других функций модуля, не
        // экспортируемая утилита; цвета взяты те же самые, чтобы одно и
        // то же событие выглядело одинаково что на карточке актива, что
        // в общем списке истории).
        const ACTION_STYLE = {
          add:           { icon: '✨', color: '#059669' },
          move:          { icon: '→',  color: '#6366f1' },
          retire:        { icon: '🗑', color: '#dc2626' },
          import:        { icon: '📥', color: '#0ea5e9' },
          reassign:      { icon: '👤', color: '#8b5cf6' },
          status_change: { icon: '⚙️', color: '#f59e0b' },
          edit:          { icon: '🛠', color: '#06b6d4' },
        };
        const st = ACTION_STYLE[h.action_type] || (h.from_who||h.to_who
          ? ACTION_STYLE.move
          : { icon: '📝', color: 'var(--warn-text)' });
        return `<div class="u-relative ${i<hist.length-1?'u-mb-12':'u-mb-4'}">
          <div class="timeline-dot" data-dot-color="${st.color}"></div>
          <div class="u-text-11 u-text-muted u-mb-2">${st.icon} ${fd(h.date)}
            ${h.changed_by?`<span class="u-text-muted"> · ${esc(h.changed_by)}</span>`:''}
          </div>
          ${(h.from_who||h.to_who)?`<div class="u-text-12 u-mb-2">
            ${h.from_who?`<span class="u-text-muted">${esc(h.from_who)}</span> `:''}
            ${h.from_who&&h.to_who?'<span class="u-text-muted">→</span> ':''}
            ${h.to_who?`<b>${esc(h.to_who)}</b>`:''}
          </div>`:''}
          ${h.filial||h.location?`<div class="u-text-11 u-text-muted">
            📍 ${esc(h.filial||'')}${h.location?' · '+esc(h.location):''}
          </div>`:''}
          ${h.reason?`<div class="u-text-11 u-mt-2">
            <span class="badge-cat u-text-10">${esc(h.reason)}</span>
          </div>`:''}
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-ghost btn-sm u-mt-8" data-action="_openFullHistoryForAsset" data-args='${JSON.stringify([esc(a.model)])}'>${t('btn_show_full_history')}</button>`:''}
    ${versions.length?`<hr class="sep"/>
    <button class="btn btn-ghost btn-sm u-m-0" data-action="_toggleVersionsSection" data-args='${JSON.stringify([id])}'>${t('btn_show_versions', { n: versions.length })}</button>
    <div id="asset-versions-box-${id}" class="u-hidden u-mt-8">${_renderVersionsList(versions)}</div>`:''}
    <hr class="sep"/>
    <div class="u-flex-col-center-gap-8 u-p-8-0">
      <div id="detail-qr-${id}" class="qr-frame"></div>
      <div class="u-text-11 u-text-muted u-text-center u-max-w-200 u-lh-14">${buildQrText(a).replace(/\n/g, ' · ')}</div>
      <button class="btn btn-secondary btn-sm" data-action="printAsset" data-args='${JSON.stringify([a])}'>${t('btn_print_card')}</button>
    </div>
    <div class="modal-actions">
      ${canEdit()?`
        <button class="btn btn-primary" data-action="_closeThenShowMove" data-args='${JSON.stringify([id])}'>→ ${t('btn_move')}</button>
        <button class="btn btn-secondary" data-action="_closeThenShowEdit" data-args='${JSON.stringify([id])}'>✏️ ${t('btn_edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="confirmDelete" data-args='${JSON.stringify([id])}'>${t('btn_retire')}</button>`:''}
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_close')}</button>
    </div>`);
  currentDetailAsset = a;
  requestAnimationFrame(() => renderQrInto('detail-qr-' + id, buildQrText(a)));
  // CSP-16: цвет точки таймлайна — 4 фиксированных значения (retire/create/
  // move/edit), задаём через data-dot-color + точечный style после вставки,
  // как в alerts.js/dashboard.js. background и box-shadow используют один
  // цвет, поэтому классом на 4 значения выразить нельзя без дублирования.
  document.querySelectorAll('.timeline-dot[data-dot-color]').forEach(el => {
    const c = el.dataset.dotColor;
    el.style.background = c;
    el.style.boxShadow = `0 0 0 1px ${c}`;
  });
  // Фото больше НЕ грузятся сразу при открытии карточки — секция свёрнута,
  // миниатюры (байты изображений) подгружаются лениво по клику на кнопку
  // «Показать фото» (см. _togglePhotoSection выше).

}

// ─── MOVE MODAL ───────────────────────────────────────────────────────────────
async function showMoveModal(id) {
  await ensureRefData();
  const a=assetsCache.find(x=>x.id===id)||{};
  const filialObj = _filialsCache.find(f=>f.name===a.filial);
  const locOpts = _buildLocOpts(filialObj?.id||'', a.location||'');
  const orgOpts = _buildOrgOpts(a.org||'');
  const filialOpts = _filialsCache.filter(f=>f.status==='active')
    .map(f=>`<option value="${esc(f.name)}" ${a.filial===f.name?'selected':''}>${esc(f.name)}</option>`).join('');
  showModal(`<h2>${t('modal_move_title')}</h2>
    <div class="move-summary-box">
      ${ic(a.type||'')} <b>${esc(a.type||'')} · ${esc(a.model||'')}</b><br>
      <span class="u-text-muted">SN: ${esc(a.serial)||'—'}</span>
    </div>
    <div class="form-row"><label>${t('lbl_current_responsible')}</label>
      <div class="u-text-13 u-text-muted u-p-5-0">${esc(a.responsible)||'—'}</div></div>
    <div class="form-row"><label>${t('lbl_new_responsible')}</label>
      <input id="m-resp" value="${esc((!a.responsible||a.responsible==='?')?'':a.responsible)}" placeholder="${t('msg_full_name_placeholder')}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_org')} *</label>
        <select id="m-org">${orgOpts}</select></div>
      <div class="form-row"><label>${t('field_filial')} *</label>
        <select id="m-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["m-loc"]'>${filialOpts}</select></div>
    </div>
    <div class="form-row"><label>${t('field_location')}</label>
      <select id="m-loc">${locOpts}</select></div>
    <div class="form-row"><label>${t('field_reason')}</label>
      <select id="m-reason">${['Перемещение','Увольнение сотрудника','Трудоустройство сотрудника','Замена оборудования','Заявка на оборудование','Ремонт','Другое'].map(r=>`<option>${r}</option>`).join('')}</select></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doMove" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
  setTimeout(() => initEmployeeAutocomplete('m-resp'), 80);
}
async function doMove(id) {
  try {

  const newResponsible = document.getElementById('m-resp').value.trim();
  const newOrg      = document.getElementById('m-org').value.trim();
  const newFilial   = document.getElementById('m-filial').value.trim();
  const newLocation = document.getElementById('m-loc').value.trim();
  const reason      = document.getElementById('m-reason').value.trim();
  if (!newResponsible) return toast(t('msg_specify_responsible'),'error');
  if (!newOrg)    return toast(t('msg_select_org'),'error');
  if (!newFilial) return toast(t('msg_select_filial'),'error');
  const filialObj = _filialsCache.find(f=>f.name===newFilial);
  const r=await fetch(`${API}/api/assets/${id}/move`,{method:'POST',headers:ah(),
    body:JSON.stringify({newResponsible, newOrg, newFilial,
      newAddress: filialObj?.address||'', newLocation, reason})});
  if (r.ok){closeModal();toast(t('msg_moved'),'success');render();}
  else {const e=await r.json();toast(e.error||t('msg_error'),'error');}

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

// ─── ADD/EDIT MODAL ───────────────────────────────────────────────────────────
function metaFormRows(category, existing={}, typeName) {
  const fields = getMetaFieldDefs(category, typeName);
  return fields.map(f => {
    const label = esc(f.label || metaLabel(f.key));
    const val = existing[f.key] != null ? existing[f.key] : '';
    const reqAttr = f.required ? 'required' : '';
    if (f.type === 'boolean') {
      const checked = (val === true || val === 'true' || val === '1') ? 'checked' : '';
      return `<div class="form-row"><label class="checkbox-label"><input type="checkbox" id="meta-${f.key}" ${checked}/> ${label}</label></div>`;
    }
    if (f.type === 'select') {
      const opts = (f.options||[]).map(o => `<option value="${esc(o)}" ${String(val)===o?'selected':''}>${esc(o)}</option>`).join('');
      return `<div class="form-row"><label>${label}</label><select id="meta-${f.key}" ${reqAttr}><option value=""></option>${opts}</select></div>`;
    }
    const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    return `<div class="form-row"><label>${label}</label>
      <input id="meta-${f.key}" value="${esc(val)}" placeholder="${label}" type="${inputType}" ${reqAttr}/></div>`;
  }).join('');
}
function collectMeta(category, typeName) {
  const fields = getMetaFieldDefs(category, typeName);
  const meta = {};
  fields.forEach(f => {
    const el = document.getElementById('meta-' + f.key);
    if (!el) return;
    meta[f.key] = f.type === 'boolean' ? (el.checked ? 'true' : 'false') : el.value;
  });
  return meta;
}

// ── Справочники в формах ─────────────────────────────────────────────────────

function _buildOrgOpts(selected) {
  const opts = _orgsCache.map(o =>
    `<option value="${esc(o.name)}" ${o.name===selected?'selected':''}>${esc(o.name)}</option>`
  );
  if (!_orgsCache.some(o=>o.name===selected) && selected)
    opts.unshift(`<option value="${esc(selected)}" selected>${esc(selected)}</option>`);
  return opts.join('');
}

function _buildLocOpts(filialId, selected='') {
  const locs = filialId
    ? _locsCache.filter(l => l.filial_id === filialId && l.status === 'active')
    : _locsCache.filter(l => l.status === 'active');
  // Always include current value even if not in filtered list
  const hasSelected = locs.some(l=>l.name===selected);
  let opts = locs.map(l =>
    `<option value="${esc(l.name)}" ${l.name===selected?'selected':''}>${esc(l.name)}</option>`
  ).join('');
  if (!hasSelected && selected)
    opts = `<option value="${esc(selected)}" selected>${esc(selected)}</option>` + opts;
  if (!opts) opts = `<option value="">${t('msg_no_locations')}</option>`;
  return opts;
}

function _updateLocSelect(filialName, selectId) {
  const filialObj = _filialsCache.find(f=>f.name===filialName);
  const sel = document.getElementById(selectId);
  if (sel) sel.innerHTML = _buildLocOpts(filialObj?.id||'');
}

async function showAddModal(tab) {
  await ensureRefData();
  const cats=(catsCache[tab]||[]).filter(c=>c!=='Все');
  const types=['Ноутбук','Системный Блок','Монитор','МФУ','Планшет','Телевизор','ИБП',
    'Точка доступа','Мини ПК','Мышь','Клавиатура','Гарнитура','Колонки','Камера',
    'Коммутатор','Маршрутизатор','Радиомод','Радиомост','Сервер','POE HUB','Другое'];
  const firstCat=cats[0]||'';
  const filialOpts = _filialsCache.filter(f=>f.status==='active')
    .map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  const firstFilial = _filialsCache.find(f=>f.status==='active');
  const locOpts = _buildLocOpts(firstFilial?.id||'');
  const orgOpts = _buildOrgOpts('');
  showModal(`<h2>${t('modal_add_asset_title')}</h2>
    <div class="two-col">
      <div class="form-row"><label>${t('field_org')}</label>
        <select id="a-org">${orgOpts}</select></div>
      <div class="form-row"><label>${t('field_collection')}</label>
        <select id="a-cat" data-onchange-action="_onCategorySelectChange" data-onchange-args='${JSON.stringify([tab, "a-meta"])}'>${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_type')}</label>
        <select id="a-type" data-onchange-action="_onTypeSelectChange" data-onchange-args='["a-meta"]'>${types.map(typ=>`<option>${typ}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_model')} *</label><input id="a-model" placeholder="${t('field_model')}"/></div>
      <div class="form-row"><label>${t('field_serial')}</label><input id="a-serial" placeholder="SN"/></div>
      <div class="form-row"><label>${t('field_inv')}</label>
        <div class="u-flex-gap-5">
          <input id="a-inv" placeholder="${t('msg_inv_example')}" class="u-flex-1"/>
          <button type="button" class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='["a-inv","a-org","a-type"]' title="${t('tooltip_generator')}">🏷</button>
        </div>
      </div>
      <div class="form-row"><label>${t('field_responsible')}</label><input id="a-resp" placeholder="${t('msg_full_name_placeholder')}"/></div>
      <div class="form-row"><label>${t('field_filial')}</label>
        <select id="a-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["a-loc"]'>${filialOpts}</select></div>
      <div class="form-row"><label>${t('field_location')}</label>
        <select id="a-loc">${locOpts}</select></div>
      <div class="form-row"><label>${t('field_status')}</label>
        <select id="a-status"><option>используется</option><option>резерв</option></select></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><textarea id="a-note"></textarea></div>
    <hr class="sep"/>
    <div class="section-title u-mb-8">${t('section_meta')}</div>
    <div id="a-meta" class="two-col">${metaFormRows(firstCat, {}, types[0])}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAdd" data-args='${JSON.stringify([tab])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
function updateMetaForm(tab, category, containerId, typeName) {
  document.getElementById(containerId).innerHTML = metaFormRows(category, {}, typeName);
}
async function doAdd(tab) {
  try {

  const filial=document.getElementById('a-filial').value.trim();
  const category=document.getElementById('a-cat').value.trim();
  const type=document.getElementById('a-type').value.trim();
  const filialObj = _filialsCache.find(f=>f.name===filial);
  const data={tab,category,filial,address:filialObj?.address||'',
    location:document.getElementById('a-loc').value.trim(),
    responsible:document.getElementById('a-resp').value.trim(),
    type,
    model:document.getElementById('a-model').value.trim(),
    serial:document.getElementById('a-serial').value.trim(),
    inv:   (document.getElementById('a-inv')||{}).value||'',
    status:document.getElementById('a-status').value.trim(),
    org:document.getElementById('a-org').value.trim(),
    note:document.getElementById('a-note').value.trim(),
    meta:collectMeta(category, type)};
  if (!data.model) return toast(t('msg_fill_model'),'error');
  const r=await fetch(`${API}/api/assets`,{method:'POST',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_added'),'success');render();}
  else{const e=await r.json();toast(e.error||t('msg_error'),'error');}

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

async function showEditModal(id) {
  await ensureRefData();
  const a=await fetch(`${API}/api/assets/${id}`, { headers: ah() }).then(r=>r.json());
  const allCats=[...new Set([...Object.values(catsCache).flat(),a.category])].filter(Boolean);
  const types=['Ноутбук','Системный Блок','Монитор','МФУ','Планшет','Телевизор','ИБП',
    'Точка доступа','Мини ПК','Мышь','Клавиатура','Гарнитура','Колонки','Камера',
    'Коммутатор','Маршрутизатор','Радиомост','Сервер','POE HUB','Другое'];
  showModal(`<h2>${t('modal_edit_title')}</h2>
    <div class="two-col">
      <div class="form-row"><label>${t('field_type')}</label>
        <select id="e-type" data-onchange-action="_onTypeSelectChange" data-onchange-args='["e-meta"]'>${types.map(typ=>`<option ${a.type===typ?'selected':''}>${typ}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_model')}</label><input id="e-model" value="${esc(a.model)}"/></div>
      <div class="form-row"><label>${t('field_serial')}</label><input id="e-serial" value="${esc(a.serial)}"/></div>
      <div class="form-row"><label>${t('field_inv')}</label>
        <div class="u-flex-gap-5">
          <input id="e-inv" value="${esc(a.inv||'')}" placeholder="LDV-NB-00001" class="u-flex-1"/>
          <button type="button" class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='["e-inv","e-org","e-type"]' title="${t('tooltip_generator')}">🏷</button>
        </div>
      </div>
      <div class="form-row"><label>${t('field_responsible')}</label><input id="e-resp" value="${esc(a.responsible)}"/></div>
      <div class="form-row"><label>${t('field_filial')}</label>
        <select id="e-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["e-loc"]'>${_filialsCache.filter(f=>f.status==='active').map(f=>`<option value="${esc(f.name)}" ${a.filial===f.name?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_location')}</label>
        <select id="e-loc">${_buildLocOpts(_filialsCache.find(f=>f.name===a.filial)?.id||'', a.location)}</select></div>
      <div class="form-row"><label>${t('field_collection')}</label>
        <select id="e-cat" data-onchange-action="_onCategorySelectChange" data-onchange-args='[null,"e-meta"]'>${allCats.map(c=>`<option ${a.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_tab')}</label>
        <select id="e-tab">${['os','small','infra'].map(tb=>`<option ${a.tab===tb?'selected':''}>${tb}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_org')}</label>
        <select id="e-org">${_buildOrgOpts(a.org)}</select></div>
      <div class="form-row"><label>${t('field_status')}</label>
        <select id="e-status">${['используется','резерв'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><textarea id="e-note">${esc(a.note)}</textarea></div>
    <hr class="sep"/>
    <div class="section-title u-mb-8">${t('section_meta')}</div>
    <div id="e-meta" class="two-col">${metaFormRows(a.category, a.meta||{}, a.type)}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doEdit" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
  setTimeout(() => initEmployeeAutocomplete('e-resp'), 80);
}
async function doEdit(id) {
  try {

  const filial=document.getElementById('e-filial').value.trim();
  const category=document.getElementById('e-cat').value.trim();
  const type=document.getElementById('e-type').value.trim();
  const filialObj = _filialsCache.find(f=>f.name===filial);
  const data={
    type,
    model:document.getElementById('e-model').value.trim(),
    serial:document.getElementById('e-serial').value.trim(),
    inv:   (document.getElementById('e-inv')||{}).value||'',
    responsible:document.getElementById('e-resp').value.trim(),
    filial,address:filialObj?.address||'',
    location:document.getElementById('e-loc').value.trim(),
    category,
    tab:document.getElementById('e-tab').value.trim(),
    org:document.getElementById('e-org').value.trim(),
    status:document.getElementById('e-status').value.trim(),
    note:document.getElementById('e-note').value.trim(),
    meta:collectMeta(category, type)};
  const r=await fetch(`${API}/api/assets/${id}`,{method:'PUT',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_saved'),'success');render();}
  else toast(t('msg_error'),'error');

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

function confirmDelete(id) {
  const a=assetsCache.find(x=>x.id===id)||{};
  showModal(`<h2>${t('modal_retire_confirm_title')}</h2>
    <p class="u-text-muted u-mb-18 u-text-13">
      ${ic(a.type)} <b>${esc(a.model)}</b> ${t('msg_retire_confirm_suffix')}</p>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doDelete" data-args='${JSON.stringify([id])}'>${t('btn_confirm_retire')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doDelete(id) {
  const r=await fetch(`${API}/api/assets/${id}`,{method:'DELETE',headers:ah()});
  if (r.ok){closeModal();toast(t('msg_retired'));render();}else toast(t('msg_error'),'error');
}
