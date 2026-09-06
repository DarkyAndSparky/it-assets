/**
 * public/js/global-search.js
 *
 * Фаза 5, шаг 8: глобальный поиск по всем вкладкам, вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * Своё приватное состояние (_gsTimer, _gsLastQuery) — не пересекается
 * с остальным приложением. Внешние зависимости — switchTab(), showDetail(),
 * esc(), ic() — остаются глобальными функциями в других файлах/index.html,
 * резолвятся в момент вызова (не в момент объявления), поэтому порядок
 * подключения скриптов не критичен.
 *
 * Фаза 6: onclick/onmouseenter/onmouseleave переведены на data-action
 * (event-delegation.js) + CSS-класс .hover-surface — нужно для CSP.
 * Заодно починен баг, найденный и задокументированный в Фазе 5: битый
 * onclick="event.stopPrshowDetail('${a.id}')tle=..." у кнопки "→" —
 * похоже, "event.stopPropagation()" был случайно разорван вставкой
 * "showDetail(...)". Восстановлено очевидно задуманное поведение
 * (stopPropagation + showDetail + title), т.к. эту же строку всё равно
 * приходилось трогать для конвертации onclick → data-action.
 */

// ─── ГЛОБАЛЬНЫЙ ПОИСК ────────────────────────────────────────────────────────
let _gsTimer = null;
let _gsLastQuery = '';

function globalSearchDebounce(q) {
  clearTimeout(_gsTimer);
  _gsTimer = setTimeout(() => runGlobalSearch(q.trim()), 280);
}

async function runGlobalSearch(q) {
  const resultsEl = document.getElementById('global-search-results');
  const clearBtn  = document.getElementById('global-search-clear');
  if (!resultsEl) return;

  if (!q || q.length < 2) {
    resultsEl.style.maxHeight = '0';
    resultsEl.style.marginTop = '0';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (clearBtn) clearBtn.style.display = '';
  _gsLastQuery = q;

  resultsEl.style.marginTop = '12px';
  resultsEl.innerHTML = `<div class="u-text-muted u-text-13 u-p-4-0">${t('msg_searching')}</div>`;
  resultsEl.style.maxHeight = '60px';

  try {
    const resp = await fetch(`${API}/api/assets/search?q=${encodeURIComponent(q)}`, { headers: ah() });
    if (!resp.ok) throw new Error(resp.status);
    const items = await resp.json();

    if (q !== _gsLastQuery) return; // устаревший результат

    if (!items.length) {
      resultsEl.innerHTML = `<div class="u-text-muted u-text-13 u-p-6-0">${t('msg_nothing_found_for', { q: esc(q) })}</div>`;
      resultsEl.style.maxHeight = '60px';
      return;
    }

    const TAB_LABEL = { os:t('nav_os'), small:t('nav_small'), infra:t('nav_infra') };

    // Группируем по вкладке
    const byTab = {};
    items.forEach(a => { (byTab[a.tab] = byTab[a.tab]||[]).push(a); });

    const rows = items.slice(0, 30).map(a => {
      const hl = (s) => {
        if (!s) return '—';
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        return esc(s).replace(re, '<mark class="search-hit-mark">$1</mark>');
      };
      return `<tr class="hover-surface u-cursor-pointer" data-action="openAssetFromSearch" data-args='${JSON.stringify([a.tab, a.id])}'>
        <td class="u-nowrap">
          <span class="search-tab-badge">${TAB_LABEL[a.tab]||a.tab}</span>
        </td>
        <td><code class="u-text-11 u-text-indigo">${hl(a.inv||'—')}</code></td>
        <td class="u-text-12">${ic(a.type)} ${hl(a.type)}</td>
        <td class="u-fw-600 u-text-13">${hl(a.model)}</td>
        <td class="u-text-12 u-text-muted">${hl(a.serial||'—')}</td>
        <td class="u-text-12">${hl(a.responsible||'—')}</td>
        <td class="u-text-12 u-text-muted">${esc(a.org||'—')} · ${esc(a.filial||'—')}</td>
        <td><span class="badge-s ${a.status==='используется'?'s-used':a.status==='резерв'?'s-reserve':'s-off'}">${esc(a.status)}</span></td>
        <td><button class="btn-icon" data-action="showDetail" data-args='${JSON.stringify([a.id])}' data-stop="1" title="${t('tooltip_open_card')}">→</button></td>
      </tr>`;
    }).join('');

    const moreNote = items.length > 30
      ? `<tr><td colspan="9" class="u-text-center u-text-muted u-text-12 u-p-8">
           ${t('msg_showing_first_30', { n: items.length })}
         </td></tr>`
      : '';

    resultsEl.innerHTML = `
      <div class="u-text-12 u-text-muted u-mb-8">
        ${t('msg_found_records', { n: items.length, q: esc(q) })}
      </div>
      <div class="tbl-wrap search-results-wrap">
        <table class="u-text-13">
          <thead><tr><th>${t('th_tab')}</th><th>${t('th_inv_no')}</th><th>${t('th_type')}</th><th>${t('th_model')}</th><th>${t('th_serial_no')}</th><th>${t('th_responsible')}</th><th>${t('th_org_filial')}</th><th>${t('th_status')}</th><th></th></tr></thead>
          <tbody>${rows}${moreNote}</tbody>
        </table>
      </div>`;
    resultsEl.style.maxHeight = '600px';

  } catch(e) {
    resultsEl.innerHTML = `<div class="u-text-noinv u-text-13">${t('msg_search_error', { msg: e.message })}</div>`;
    resultsEl.style.maxHeight = '60px';
  }
}

function clearGlobalSearch() {
  const inp = document.getElementById('global-search-inp');
  const resultsEl = document.getElementById('global-search-results');
  const clearBtn = document.getElementById('global-search-clear');
  if (inp) inp.value = '';
  if (resultsEl) { resultsEl.style.maxHeight='0'; resultsEl.style.marginTop='0'; }
  if (clearBtn) clearBtn.style.display = 'none';
  _gsLastQuery = '';
}

function openAssetFromSearch(tab, id) {
  // Переходим на нужную вкладку и открываем карточку
  clearGlobalSearch();
  switchTab(tab);
  setTimeout(() => showDetail(id), 450);
}
