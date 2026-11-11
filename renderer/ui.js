'use strict';

// Utilidades de interfaz compartidas: DOM, íconos, ventanas, menús, avisos.

const $ = (id) => document.getElementById(id);

// h('div', { class: 'x', onclick: fn, text: 'hola' }, hijo1, 'texto', ...)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ── Íconos (trazos de 24×24) ──
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5"/><path d="M12 12v9"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6-1.2-1.7-1.2-3 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.2 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.2" r="1"/><circle cx="15" cy="7.8" r="1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  import: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>',
  export: '<path d="M12 15V4"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M5 19h14"/>',
  share: '<circle cx="6" cy="12" r="2.3"/><circle cx="17.5" cy="6" r="2.3"/><circle cx="17.5" cy="18" r="2.3"/><path d="m8 11 7.5-4M8 13l7.5 4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7 7.5 20h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
  update: '<path d="M7 10V4M4.5 6.5 7 4l2.5 2.5"/><path d="M17 14v6M14.5 17.5 17 20l2.5-2.5"/><path d="M7 14a5 5 0 0 0 9 3M17 10a5 5 0 0 0-9-3"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/>',
  fabric: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3"/><path d="M9 11h6M9 15h6"/>',
  warn: '<path d="M12 4 3 20h18z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  star: '<path d="m12 4 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  language: '<path d="M4 6h9M8.5 4v2M6 6c.5 3.5 3 6.5 6 8M12 6c-.5 3-2.5 6-7 8.5"/><path d="m13 20 4-9 4 9M14.5 17h5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  memory: '<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8v8M11 8v8M15 8v8M19 8v8M6 18.5V20M18 18.5V20"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.8 7 9.5 4.1-1.7 7-5.2 7-9.5V6z"/>',
  alarm: '<path d="M12 5v2M5.6 7.4l1.4 1.4M18.4 7.4 17 8.8"/><path d="M7 20v-5a5 5 0 0 1 10 0v5"/><path d="M4 20h16"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  chat: '<path d="M12 4a8 8 0 0 0-6.9 12L4 20.5l4.7-1.2A8 8 0 1 0 12 4z"/>',
  userPlus: '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="m20 4-6.5 6.5M4 20l6.5-6.5"/>',
  shrink: '<path d="M20 10h-6V4"/><path d="M4 14h6v6"/><path d="m14 10 6-6M10 14l-6 6"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9" cy="8.500" r="3.200"/><path d="M3 19.500a6 6 0 0 1 12 0"/><path d="M16 5.600a3.200 3.200 0 0 1 0 6"/><path d="M18 14.200a6 6 0 0 1 3 5.300"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  send: '<path d="M4 12 20 4l-4 16-4.5-6.5z"/><path d="m11.5 13.5 4-5"/>'
};

function icon(name, size) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  if (size) { span.style.width = `${size}px`; span.style.height = `${size}px`; }
  return span;
}

// Llamadas IPC: devuelven { ok, data } o { ok:false, error }.
async function call(promise) {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ── Formatos ──
function timeAgo(ms) {
  if (!ms) return 'Nunca jugado';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'Hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `Hace ${m} min`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `Hace ${hr} ${hr === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `Hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatPlaytime(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec ? `${sec}s` : '0m';
  const m = Math.floor(sec / 60);
  const hr = Math.floor(m / 60);
  return hr ? `${hr}h ${m % 60}m` : `${m}m`;
}

function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} k`;
  return String(n || 0);
}

// ── Avisos ──
// Pila de avisos arriba a la derecha. toast(texto, tipo) con tipo: 'success' | 'error' | undefined (neutro).
// progressToast({ title, text }) devuelve { update({title,text}), done(), close() }: aviso con barra de progreso
// indeterminada que se queda hasta que se cierra.
function toastStack() {
  let box = $('toast-stack');
  if (!box) {
    box = h('div', { id: 'toast-stack', class: 'toast-stack', 'aria-live': 'polite' });
    document.body.append(box);
  }
  return box;
}

function dismissToast(el) {
  if (!el || !el.isConnected || el.classList.contains('leaving')) return;
  clearTimeout(el._timer);
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
}

function buildToast(kind, body) {
  const ico = kind === 'error' ? 'warn' : kind === 'success' ? 'check' : 'info';
  const el = h('div', { class: `toast-card toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-ico' }, icon(ico, 18)),
    body,
    h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Cerrar', onclick: () => dismissToast(el) }, icon('x', 16)));
  const box = toastStack();
  box.append(el);
  while (box.children.length > 5) box.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}

function toast(text, kind) {
  const k = kind === 'error' || kind === 'success' ? kind : 'info';
  const el = buildToast(k, h('div', { class: 'toast-body' }, h('span', { class: 'toast-text', text })));
  el._timer = setTimeout(() => dismissToast(el), k === 'error' ? 6000 : 3500);
  return el;
}

function progressToast({ title, text }) {
  const t = h('strong', { class: 'toast-title', text: title || '' });
  const d = h('span', { class: 'toast-desc', text: text || '' });
  const bar = h('div', { class: 'toast-bar' }, h('i'));
  const el = buildToast('progress', h('div', { class: 'toast-body' }, t, d, bar));
  el.querySelector('.toast-ico').classList.add('spin');
  const shownAt = Date.now();
  return {
    update(next) {
      if (next.title !== undefined) t.textContent = next.title;
      if (next.text !== undefined) d.textContent = next.text;
    },
    // Se deja visible un mínimo para que no parpadee cuando la tarea es instantánea.
    close(minMs = 700) {
      const wait = Math.max(0, minMs - (Date.now() - shownAt));
      setTimeout(() => dismissToast(el), wait);
    }
  };
}

// ── Ventanas modales ──
// modal({ title, icon, wide, body, footer, onClose }) -> { close, el, body }
const modalStack = [];

function modal(opts) {
  const closeBtn = h('button', { class: 'modal-x', type: 'button', 'aria-label': 'Cerrar', title: 'Cerrar' }, icon('x'));
  const head = h('div', { class: 'modal-head' },
    opts.icon ? h('span', { class: 'modal-icon' }, icon(opts.icon)) : null,
    h('h3', { text: opts.title || '' }),
    closeBtn);
  const body = h('div', { class: 'modal-body' }, opts.body || []);
  const foot = opts.footer ? h('div', { class: 'modal-foot' }, opts.footer) : null;
  const box = h('div', { class: `modal-box${opts.wide ? ' wide' : ''}${opts.className ? ` ${opts.className}` : ''}`, role: 'dialog', 'aria-modal': 'true' }, head, body, foot);
  const overlay = h('div', { class: 'modal-overlay' }, box);

  const api = {
    el: box,
    body,
    close() {
      if (!overlay.isConnected) return;
      overlay.remove();
      const i = modalStack.indexOf(api);
      if (i > -1) modalStack.splice(i, 1);
      if (opts.onClose) opts.onClose();
    }
  };
  closeBtn.addEventListener('click', api.close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) api.close(); });
  document.body.append(overlay);
  modalStack.push(api);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});

function confirmDialog({ title, text, okLabel, danger }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title,
      icon: danger ? 'warn' : 'info',
      className: 'small',
      body: [h('p', { class: 'modal-text', text })],
      footer: [
        h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-accent'}`, type: 'button', text: okLabel || 'Aceptar', onclick: () => { finish(true); m.close(); } })
      ],
      onClose: () => finish(false)
    });
  });
}

function promptDialog({ title, label, value, okLabel, placeholder }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const input = h('input', { type: 'text', class: 'input', value: value || '', placeholder: placeholder || '', spellcheck: 'false' });
    const submit = () => { finish(input.value.trim()); m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const m = modal({
      title,
      className: 'small',
      body: [h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input)],
      footer: [
        h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
        h('button', { class: 'btn btn-accent', type: 'button', text: okLabel || 'Aceptar', onclick: submit })
      ],
      onClose: () => finish(null)
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// ── Menú contextual / desplegable anclado a un elemento ──
let openMenu = null;

function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !(e.target.closest && e.target.closest('[data-menu-anchor]'))) closeMenu();
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// items: [{ label, icon, danger, onclick } | 'sep']
function popMenu(anchor, items, header) {
  closeMenu();
  const menu = h('div', { class: 'pop-menu', role: 'menu' });
  if (header) menu.append(header);
  for (const it of items) {
    if (it === 'sep') { menu.append(h('div', { class: 'pop-sep' })); continue; }
    menu.append(h('button', {
      class: `pop-item${it.danger ? ' danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      onclick: () => { closeMenu(); it.onclick(); }
    }, it.icon ? icon(it.icon) : h('span', { class: 'ico' }), h('span', { text: it.label })));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 10, r.right - mw + 4);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 10) top = Math.max(10, r.top - mh - 6);
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${top}px`;
  anchor.dataset.menuAnchor = '1';
  openMenu = menu;
  return menu;
}

// ── Interruptor ──
function toggle(checked, onchange, label) {
  const input = h('input', { type: 'checkbox', class: 'sw-input', 'aria-label': label || 'Interruptor' });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked, input));
  return h('label', { class: 'sw' }, input, h('span', { class: 'sw-track' }));
}

// Tinte estable por perfil para la imagen de la tarjeta.
function hueFor(id) {
  let n = 0;
  for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) % 360;
  return n;
}

function banner(profile, cls) {
  const el = h('div', { class: `banner ${cls || ''}` });
  el.style.filter = `hue-rotate(${hueFor(profile.id) - 20}deg) saturate(1.05)`;
  return el;
}
