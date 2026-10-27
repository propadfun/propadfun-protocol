// Pure view functions: record in, HTML string out. Shared by the build-time prerender,
// the browser, and the gate harness. No DOM access here.
import { ICONS } from './icons.js';

export const STATES = ['stated', 'absent', 'unconfirmed'];

export const isStated = (r) => !!r && r.state === 'stated';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The register stores the URL; the handle is always derived from it.
export function deriveHandle(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : u.hostname;
  } catch {
    return null;
  }
}

export function renderCa(r) {
  const label = esc(r?.label || 'Contract address');
  if (!isStated(r) || !r.value) {
    return (
      `<div class="ca is-inert" data-record="ca" data-state="${esc(r?.state || 'absent')}" aria-disabled="true">` +
      `<span class="ca-label">${label}</span>` +
      `<span class="ca-value ca-pending">pending</span></div>`
    );
  }
  const v = esc(r.value);
  return (
    `<button class="ca" type="button" data-record="ca" data-state="stated" data-copy="${v}" ` +
    `aria-label="Copy ${label}">` +
    `<span class="ca-label">${label}</span>` +
    `<span class="ca-value">${v}</span>` +
    `<span class="ca-action" data-copy-label>${ICONS.copy}<span>Copy</span></span></button>`
  );
}

export function renderSocial(r, key) {
  const label = esc(r?.label || key);
  const icon = ICONS[key];
  if (!isStated(r) || !r.url) {
    return (
      `<span class="social is-inert" data-record="${key}" data-state="${esc(r?.state || 'absent')}" ` +
      `role="img" aria-label="${label}, pending" title="${label}, pending">${icon}</span>`
    );
  }
  const handle = deriveHandle(r.url);
  const name = handle ? `${label}, ${esc(handle)}` : label;
  return (
    `<a class="social" data-record="${key}" data-state="stated" href="${esc(r.url)}" ` +
    `target="_blank" rel="noopener noreferrer" aria-label="${name}" title="${name}">${icon}</a>`
  );
}

export function renderBoardItem(r) {
  const label = esc(r?.label || '');
  if (!isStated(r)) {
    return (
      `<li class="chip is-inert" data-record-chip data-state="${esc(r?.state || 'absent')}">` +
      `<span class="chip-label">${label}</span><span class="chip-value">pending</span></li>`
    );
  }
  return (
    `<li class="chip" data-record-chip data-state="stated">` +
    `<span class="chip-label">${label}</span><span class="chip-value">${esc(r.value)}</span></li>`
  );
}

export function renderBoard(reg) {
  return ['ca', 'x', 'github', 'chain', 'market'].map((k) => renderBoardItem(reg[k])).join('');
}
