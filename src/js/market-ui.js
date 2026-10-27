import { createMarket } from './market.js';
import { esc } from './views.js';
import { ICONS } from './icons.js';
import { countTo, reducedMotion } from './spring.js';
import { fmtPrice, fmtCompact, fmtPct, fmtWhole, letterOf, toneOf, DASH } from './format.js';

const SORTS = {
  volume: (a, b) => b.volume - a.volume,
  momentum: (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity),
  depth: (a, b) => b.liquidity - a.liquidity,
};

const STATUS = {
  idle: 'Idle',
  loading: 'Connecting',
  refreshing: 'Streaming',
  live: 'Streaming',
  retrying: 'Retrying',
  error: 'Offline',
};

const tile = (r) =>
  `<span class="tile" data-tone="${toneOf(r.address)}"><span class="tile-letter">${esc(letterOf(r.symbol || r.name))}</span>` +
  (r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '') +
  `</span>`;

const chgHtml = (n) => {
  if (n == null) return `<span class="chg">${DASH}</span>`;
  const up = n >= 0;
  return `<span class="chg ${up ? 'is-up' : 'is-down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${fmtPct(n)}</span>`;
};

export function mountMarket(root, record) {
  const $ = (s) => root.querySelector(s);
  const list = $('#rows');
  const ticker = $('#ticker-track');
  const pill = $('#status-pill');
  const pillText = $('#status-text');
  const note = $('#market-note');
  const stats = { vol: $('#stat-vol'), liq: $('#stat-liq'), pairs: $('#stat-pairs') };
  const tabs = [...root.querySelectorAll('[data-sort]')];

  let sort = 'volume';
  let data = null;
  let seeded = false;

  // letter-tile fallback: an image that fails is removed, the letter underneath shows
  root.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);

  const setStatus = (kind, extra = {}) => {
    pill.dataset.status = kind;
    pillText.textContent = kind === 'retrying' && extra.hasData ? 'Holding last data' : STATUS[kind];
    if (kind === 'error') {
      note.hidden = false;
      note.textContent = extra.hasData
        ? 'Source unreachable. Showing the last good figures.'
        : 'Source unreachable. Figures stay as a dash until it answers.';
      if (!extra.hasData) showDashes();
    } else if (kind === 'live') {
      note.hidden = true;
    }
  };

  function showDashes() {
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = `<li class="row row-empty"><span>${DASH}</span><span>No figures to show.</span></li>`;
    for (const k of ['vol', 'liq', 'pairs']) { stats[k].textContent = DASH; stats[k]._v = undefined; }
    ticker.innerHTML = '';
  }

  const rowHtml = (r, i) =>
    `<li class="row rise" data-addr="${esc(r.address)}" data-spot style="--i:${i}">` +
    `<span class="c-rank">${i + 1}</span>` +
    `<span class="c-asset">${tile(r)}<span class="nm"><b>${esc(r.symbol || DASH)}</b><i>${esc(r.name || '')}</i></span></span>` +
    `<span class="c-price" data-f="price" data-label="Price">${fmtPrice(r.price)}</span>` +
    `<span class="c-meta"><span class="c-chg" data-f="change" data-label="24h">${chgHtml(r.change)}</span>` +
    `<span class="c-vol" data-f="volume" data-label="Volume">${fmtCompact(r.volume)}</span>` +
    `<span class="c-liq" data-f="liquidity" data-label="Liquidity">${fmtCompact(r.liquidity)}</span></span>` +
    `<span class="c-act"><button class="copy-btn" type="button" data-copy="${esc(r.address)}" aria-label="Copy address of ${esc(r.name || r.symbol)}">${ICONS.copy}</button></span></li>`;

  function flash(el, dir) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  }

  function render() {
    const rows = [...data].sort(SORTS[sort]);
    list.setAttribute('aria-busy', 'false');
    const existing = new Map([...list.querySelectorAll('li[data-addr]')].map((li) => [li.dataset.addr, li]));

    const build = () => {
      const frag = document.createDocumentFragment();
      rows.forEach((r, i) => {
        let li = existing.get(r.address);
        if (!li) {
          const t = document.createElement('template');
          t.innerHTML = rowHtml(r, i);
          li = t.content.firstElementChild;
          li._v = { price: r.price, change: r.change, volume: r.volume, liquidity: r.liquidity };
        } else {
          li.classList.remove('rise');
          li.querySelector('.c-rank').textContent = i + 1;
          const v = li._v || {};
          const upd = (key, sel, fmt) => {
            const el = li.querySelector(sel);
            if (r[key] != null && v[key] != null && r[key] !== v[key]) { flash(el, r[key] - v[key]); countTo(el, v[key], r[key], fmt); }
            else el.textContent = fmt(r[key]);
          };
          upd('price', '[data-f=price]', fmtPrice);
          upd('volume', '[data-f=volume]', fmtCompact);
          upd('liquidity', '[data-f=liquidity]', fmtCompact);
          const ce = li.querySelector('[data-f=change]');
          if (r.change !== v.change) { ce.innerHTML = chgHtml(r.change); if (v.change != null && r.change != null) flash(ce, r.change - v.change); }
          li._v = { price: r.price, change: r.change, volume: r.volume, liquidity: r.liquidity };
        }
        frag.appendChild(li);
      });
      list.replaceChildren(frag);
    };

    if (!seeded) {
      seeded = true;
      // skeleton -> real data: fade skeleton out, then stagger rows in
      list.classList.add('is-leaving');
      setTimeout(() => { list.classList.remove('is-leaving'); build(); }, reducedMotion() ? 0 : 170);
    } else build();
  }

  function renderStats() {
    const sum = (k) => data.reduce((s, r) => s + (r[k] || 0), 0);
    const put = (el, v, fmt) => {
      el.classList.remove('skel-line');
      const prev = el._v;
      if (prev != null && prev !== v) { flash(el.parentElement, v - prev); countTo(el, prev, v, fmt); }
      else if (prev == null) countTo(el, 0, v, fmt, 900);
      el._v = v;
    };
    put(stats.vol, sum('volume'), fmtCompact);
    put(stats.liq, sum('liquidity'), fmtCompact);
    put(stats.pairs, data.length, fmtWhole);
  }

  function renderTicker() {
    const items = [...data].sort(SORTS.volume);
    const one = items.map((r) =>
      `<span class="tick">${tile(r)}<b>${esc(r.symbol || DASH)}</b><span class="tick-p">${fmtPrice(r.price)}</span>${chgHtml(r.change)}</span>`).join('');
    ticker.innerHTML = `<span class="tick-set">${one}</span><span class="tick-set" aria-hidden="true">${one}</span>`;
  }

  const market = createMarket({
    record,
    isHidden: () => document.hidden,
    onStatus: setStatus,
    onData: (rows) => { data = rows; render(); renderStats(); renderTicker(); },
  });

  tabs.forEach((b) =>
    b.addEventListener('click', () => {
      sort = b.dataset.sort;
      tabs.forEach((t) => { const on = t === b; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      if (data) render();
    }));
  $('[role=tablist]').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n == null) return;
    const t = tabs[(n + tabs.length) % tabs.length];
    t.focus(); t.click(); e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => market.visibility(document.hidden));
  setStatus('loading');
  market.start();
  return market;
}
