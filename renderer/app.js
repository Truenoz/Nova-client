'use strict';

// Núcleo del launcher: navegación, cuenta, inicio, lista de perfiles, asistente de perfiles,
// servidores, registro y arranque. (ui.js trae las utilidades; detail.js el detalle de perfil;
// settings.js la ventana de configuración.)

const els = {
  views: {
    home: $('view-home'),
    profiles: $('view-profiles'),
    detail: $('view-detail'),
    browse: $('view-browse'),
    servers: $('view-servers'),
    console: $('view-console')
  },
  // cuenta
  accountOut: $('account-out'),
  accountIn: $('account-in'),
  accountName: $('account-name'),
  avatar: $('avatar'),
  btnLogout: $('btn-logout'),
  loginBtns: document.querySelectorAll('.js-login'),
  // escena
  hero: document.querySelector('.hero'),
  skin: $('skin'),
  skin3d: $('skin3d'),
  nametag: $('nametag'),
  heroPillText: $('hero-pill-text'),
  heroLogin: $('hero-login'),
  // inicio
  recentTitle: $('recent-title'),
  recentList: $('recent-list'),
  progressText: $('progress-text'),
  progressBar: $('progress-bar'),
  homeProgress: $('home-progress'),
  playError: $('play-error'),
  statusPill: $('status-pill'),
  btnManageProfiles: $('btn-manage-profiles'),
  btnAddMods: $('btn-add-mods'),
  newsList: $('news-list'),
  infoRam: $('info-ram'),
  infoJava: $('info-java'),
  infoCount: $('info-count'),
  // perfiles
  profileTabs: $('profile-tabs'),
  profileSearch: $('profile-search'),
  profileGroups: $('profile-groups'),
  // registro
  log: $('log'),
  btnClearLog: $('btn-clear-log'),
  // barra
  updatePill: $('update-pill'),
  railPlay: $('rail-play')
};

const state = {
  account: null,
  settings: null,
  info: null,
  versions: [],
  versionsLoaded: false,
  profiles: [],
  folders: [],
  busy: false,         // preparando o descargando
  running: false,      // el juego está abierto
  activeId: null,      // perfil que se prepara / juega
  view: 'home',
  profileTab: 'all',
  collapsed: new Set(),
  notifications: [],
  unread: 0
};

// ───────────────────────── Íconos fijos del HTML ─────────────────────────

function mountStaticIcons() {
  $('ico-palette').replaceWith(icon('palette'));
  $('ico-bell').replaceWith(icon('bell'));
  $('rail-settings').append(icon('settings'));
  els.railPlay.append(icon('play'));
  $('ico-search-profiles').replaceWith(icon('search'));

  $('recent-title').append(icon('clock'), 'Últimos perfiles reproducidos');
  els.btnManageProfiles.append(icon('grid'), 'Administrar todos los perfiles');
  els.btnAddMods.append(icon('plus'), 'Agregar modificaciones');
  $('btn-new-folder').append(icon('folder'), 'Nueva carpeta');
  $('btn-import').append(icon('import'), 'IMPORTAR');
  $('btn-new-profile').append(icon('plus'), 'Nuevo perfil');
}

const RAIL = [
  { view: 'home', icon: 'home', title: 'Inicio' },
  { view: 'profiles', icon: 'grid', title: 'Perfiles' },
  { view: 'browse', icon: 'cube', title: 'Modificaciones' },
  { view: 'servers', icon: 'server', title: 'Servidores' },
  { view: 'console', icon: 'console', title: 'Registro' }
];

function mountRail() {
  const nav = $('rail-nav');
  for (const r of RAIL) {
    nav.append(h('button', {
      class: 'rail-btn', type: 'button', title: r.title, 'aria-label': r.title, dataset: { view: r.view },
      onclick: () => goTo(r.view)
    }, icon(r.icon)));
  }
  // Charlas: abre el panel social (con la etiqueta NUEVO, como en Dawn).
  nav.append(h('button', {
    class: 'rail-btn rail-chat', type: 'button', title: 'Charlas', 'aria-label': 'Charlas',
    onclick: () => { if (typeof socialToggleBig === 'function') socialToggleBig(); }
  }, h('span', { class: 'rail-new', text: 'NUEVO' }), icon('chat')));
}

// ───────────────────────── Utilidades ─────────────────────────

function showError(message) {
  els.playError.textContent = message || '';
  els.playError.classList.toggle('hidden', !message);
}

function setProgress(text, percent) {
  els.progressText.textContent = text;
  const bar = els.progressBar;
  if (percent === null || percent === undefined) {
    bar.classList.toggle('indeterminate', state.busy && !state.running);
    bar.style.width = state.busy && !state.running ? '' : '0%';
  } else {
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
  if (typeof detailProgress === 'function') detailProgress(text, percent);
}

function profileById(id) {
  return state.profiles.find((p) => p.id === id) || null;
}

function lastProfile() {
  return profileById(state.settings?.lastProfile) || recentProfiles()[0] || state.profiles[0] || null;
}

function recentProfiles() {
  return [...state.profiles].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.created - a.created);
}

function notify(text) {
  state.notifications.unshift({ text, time: Date.now() });
  state.notifications.length = Math.min(state.notifications.length, 30);
  state.unread++;
  $('bell-dot').classList.remove('hidden');
}

function appendLog(line) {
  const atBottom = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 30;
  els.log.textContent += line.endsWith('\n') ? line : `${line}\n`;
  if (els.log.textContent.length > 200000) els.log.textContent = els.log.textContent.slice(-150000);
  if (atBottom) els.log.scrollTop = els.log.scrollHeight;
}

// ───────────────────────── Navegación ─────────────────────────

function goTo(view, opts) {
  closeMenu();
  state.view = view;
  const railView = view === 'detail' ? 'profiles' : view;
  document.querySelectorAll('.rail-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === railView));
  $('rail-settings').classList.remove('active');
  Object.entries(els.views).forEach(([name, el]) => el.classList.toggle('active', name === view));
  if (view === 'profiles') renderProfiles();
  if (view === 'detail') renderDetail(opts.id, opts.tab);
  if (view === 'browse') renderBrowse();
  if (view === 'servers') renderServers();
  if (view === 'home') renderHome();
}

$('btn-min').addEventListener('click', () => window.launcher.minimize());
$('btn-close').addEventListener('click', () => window.launcher.close());
$('btn-max').addEventListener('click', () => window.launcher.maximize());
window.launcher.onMaximized((max) => {
  $('ico-max').classList.toggle('hidden', max);
  $('ico-restore').classList.toggle('hidden', !max);
  $('btn-max').title = max ? 'Restaurar' : 'Maximizar';
});

$('rail-settings').addEventListener('click', () => openSettings());
$('btn-palette').addEventListener('click', () => openSettings('appearance'));
$('btn-bell').addEventListener('click', (e) => {
  state.unread = 0;
  $('bell-dot').classList.add('hidden');
  const items = state.notifications.length
    ? state.notifications.map((n) => ({ label: `${new Date(n.time).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · ${n.text}`, icon: 'info', onclick() {} }))
    : [{ label: 'Sin notificaciones', icon: 'check', onclick() {} }];
  popMenu(e.currentTarget, items, h('div', { class: 'pop-head' }, h('strong', { text: 'Notificaciones' })));
});

els.btnManageProfiles.addEventListener('click', () => goTo('profiles'));
els.btnAddMods.addEventListener('click', () => {
  const p = lastProfile();
  if (p) goTo('detail', { id: p.id, tab: 'content' });
  else goTo('profiles');
});
$('btn-go-settings').addEventListener('click', () => openSettings());
$('btn-news-all').addEventListener('click', () => {
  call(window.launcher.openExternal('https://www.minecraft.net/es-es/articles')).catch((e) => toast(e.message, 'error'));
});

// ───────────────────────── Cuenta ─────────────────────────

const STEVE = 'https://mc-heads.net/body/MHF_Steve/320';

// Visor 3D de la skin (WebGL). Si el equipo no lo soporta, queda la imagen 2D de siempre.
let viewer3d = null;
try { viewer3d = els.skin3d && window.Skin3D && Skin3D.supported() ? Skin3D.create(els.skin3d, els.hero) : null; } catch { viewer3d = null; }
if (viewer3d) viewer3d.onLost = () => showFlatSkin(state.account);
let skinToken = 0;

// Versión 2D (respaldo).
function showFlatSkin(account) {
  els.skin3d.classList.add('hidden');
  els.skin.classList.remove('hidden');
  els.skin.classList.toggle('dim', !account);
  els.skin.onerror = () => { els.skin.onerror = null; els.skin.src = STEVE; };
  els.skin.src = account ? `https://mc-heads.net/body/${encodeURIComponent(account.uuid)}/320` : STEVE;
}

// Detecta la skin de la cuenta (o la de Steve sin sesión) y la muestra en 3D.
async function showSkin(account) {
  const token = ++skinToken;
  els.skin3d.classList.toggle('dim', !account);
  if (!viewer3d) { showFlatSkin(account); return; }
  try {
    const data = await call(account ? window.launcher.getMySkin() : window.launcher.getSkin('MHF_Steve'));
    if (token !== skinToken) return;
    await viewer3d.setSkin(data.skin, data.model);
    if (token !== skinToken) return;
    els.skin.classList.add('hidden');
    els.skin3d.classList.remove('hidden');
    // La carita de la cuenta sale de la misma skin, así coincide siempre con el personaje.
    if (account) {
      const face = viewer3d.faceDataURL(64);
      if (face) { els.avatar.onerror = null; els.avatar.src = face; }
    }
  } catch (e) {
    console.warn('[Skin3D]', e);
    if (token === skinToken) showFlatSkin(account);
  }
}

function renderAccount(account) {
  state.account = account;
  els.accountOut.classList.toggle('hidden', !!account);
  els.accountIn.classList.toggle('hidden', !account);
  els.heroLogin.classList.toggle('hidden', !!account);

  if (account) {
    const id = encodeURIComponent(account.uuid);
    els.accountName.textContent = account.name;
    els.avatar.onerror = () => { els.avatar.onerror = null; els.avatar.src = 'logo.png'; };
    els.avatar.src = `https://mc-heads.net/avatar/${id}/64`;
    els.nametag.textContent = account.name;
    els.heroPillText.textContent = 'Sesión iniciada';
  } else {
    els.nametag.textContent = 'Sin sesión';
    els.heroPillText.textContent = 'Conectá tu cuenta para jugar';
  }
  showSkin(account);
  renderAll();
}

async function doLogin() {
  showError('');
  els.loginBtns.forEach((b) => { b.disabled = true; b.textContent = 'Esperando…'; });
  try {
    renderAccount(await call(window.launcher.login()));
    return true;
  } catch (e) {
    showError(friendlyAuthError(e.message));
    return false;
  } finally {
    els.loginBtns.forEach((b) => {
      b.disabled = false;
      b.textContent = b.id === 'hero-login' ? 'Iniciar sesión' : 'Iniciar sesión con Microsoft';
    });
  }
}

els.loginBtns.forEach((b) => b.addEventListener('click', doLogin));

async function doLogout() {
  await call(window.launcher.logout());
  renderAccount(null);
}
els.btnLogout.addEventListener('click', doLogout);

function friendlyAuthError(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('closed') || m.includes('cancel')) return 'Se cerró la ventana de inicio de sesión.';
  if (m.includes('game') || m.includes('entitle') || m.includes('profile') || m.includes('owns')) {
    return 'Esta cuenta de Microsoft no parece tener Minecraft: Java Edition.';
  }
  return `No se pudo iniciar sesión: ${message}`;
}

// ───────────────────────── Estado general / render ─────────────────────────

function canPlay() {
  return !!state.account && !state.busy && !state.running;
}

function renderAll() {
  renderRailPlay();
  renderStatusPill();
  if (state.view === 'home') renderHome();
  if (state.view === 'profiles') renderProfiles();
  if (state.view === 'detail' && typeof detailRefresh === 'function') detailRefresh();
  if (state.view === 'servers') renderServers();
}

function renderRailPlay() {
  els.railPlay.disabled = !canPlay() || !lastProfile();
}

function renderStatusPill() {
  els.statusPill.textContent = state.running ? '1 instancia en ejecución' : state.busy ? 'Preparando instancia…' : 'Ninguna instancia en ejecución';
  els.statusPill.classList.toggle('on', state.running);
}

// ───────────────────────── Inicio ─────────────────────────

function renderHome() {
  const list = recentProfiles().slice(0, 3);
  els.recentList.textContent = '';
  if (!list.length) {
    els.recentList.append(h('div', { class: 'empty-card' },
      h('span', { class: 'muted', text: 'Todavía no hay perfiles.' }),
      h('button', { class: 'btn btn-green btn-small', type: 'button', text: 'Crear perfil', onclick: () => openProfileWizard() })));
  }
  list.forEach((p, i) => els.recentList.append(profileRow(p, i === 0)));
  els.infoCount.textContent = String(state.profiles.length);
  els.homeProgress.classList.toggle('idle', !state.busy && !state.running);
  renderStatusPill();
}

function profileRow(p, big) {
  const active = state.activeId === p.id && (state.busy || state.running);
  const row = h('div', { class: `profile-row${big ? ' big' : ''}${active && state.running ? ' running' : ''}` });
  const btn = active && state.running
    ? h('button', { class: 'btn btn-stop btn-small', type: 'button', onclick: (e) => { e.stopPropagation(); window.launcher.stop(); } }, h('span', { class: 'stop-ico' }), 'Detener')
    : h('button', {
      class: 'btn btn-play btn-small', type: 'button', disabled: !canPlay(),
      onclick: (e) => { e.stopPropagation(); playProfile(p.id); }
    }, icon('play'), state.account ? 'Jugar' : 'Inicia sesión');
  const gear = h('button', {
    class: 'gear-btn', type: 'button', title: 'Opciones del perfil', 'aria-label': `Opciones de ${p.name}`,
    onclick: (e) => { e.stopPropagation(); openProfileMenu(gear, p); }
  }, icon('settings', big ? 22 : 18));
  if (big) {
    row.append(h('span', { class: 'profile-bg', style: { filter: `hue-rotate(${hueFor(p.id) - 20}deg)` } }));
  }
  row.append(
    h('img', { class: 'profile-icon', src: 'logo.png', alt: '', width: big ? 64 : 48, height: big ? 64 : 48 }),
    h('div', { class: 'profile-info' },
      h('strong', { text: p.name }),
      h('span', { class: 'muted small sub' }, icon('fabric', 14), `${p.loaderLabel} ${p.mc} - ${timeAgo(p.lastPlayed)}`)),
    btn,
    gear
  );
  row.addEventListener('click', () => goTo('detail', { id: p.id }));
  return row;
}

// ───────────────────────── Jugar ─────────────────────────

async function playProfile(id, opts) {
  if (state.busy || state.running) return;
  const p = profileById(id);
  if (!p) return;
  showError('');
  if (!state.account) {
    toast('Iniciá sesión con tu cuenta de Microsoft para jugar.');
    return;
  }
  state.busy = true;
  state.activeId = id;
  renderAll();
  setProgress('Preparando…', null);
  try {
    await call(window.launcher.launch(id, opts));
  } catch (e) {
    state.busy = false;
    state.running = false;
    state.activeId = null;
    setProgress('Todo listo.', 0);
    showError(e.message);
    notify(`No se pudo iniciar: ${e.message}`);
    renderAll();
  }
}

els.railPlay.addEventListener('click', () => {
  const p = lastProfile();
  if (p) playProfile(p.id);
});

window.launcher.onStatus(async ({ state: s, text, percent, profileId }) => {
  const before = `${state.busy}|${state.running}|${state.activeId}`;
  if (s === 'idle') {
    state.busy = false;
    state.running = false;
    state.activeId = null;
    setProgress(text || 'Todo listo.', 0);
    if (text) notify(text);
    // El tiempo jugado y «última vez» cambiaron: se vuelven a pedir los perfiles.
    await loadProfiles();
  } else if (s === 'running') {
    state.busy = false;
    state.running = true;
    state.activeId = profileId || state.activeId;
    setProgress(text, 100);
  } else {
    state.busy = true;
    state.running = false;
    state.activeId = profileId || state.activeId;
    setProgress(text, percent);
  }
  if (before !== `${state.busy}|${state.running}|${state.activeId}`) renderAll();
});

window.launcher.onLog(appendLog);
els.btnClearLog.addEventListener('click', () => { els.log.textContent = ''; });

window.launcher.onProfileProgress(({ text }) => {
  if (text) toast(text);
});

// ───────────────────────── Perfiles: carga ─────────────────────────

async function loadProfiles() {
  const data = await call(window.launcher.listProfiles());
  state.profiles = data.profiles;
  state.folders = data.folders;
  els.infoCount.textContent = String(state.profiles.length);
  renderAll();
}

// ───────────────────────── Perfiles: lista ─────────────────────────

const PROFILE_TABS = [
  { id: 'all', label: 'Todos', test: () => true },
  { id: 'pinned', label: 'Fijado', test: (p) => p.pinned },
  { id: 'custom', label: 'personalizado', test: (p) => p.origin !== 'pack' },
  { id: 'pack', label: 'paquete de modificaciones', test: (p) => p.origin === 'pack' }
];

function renderProfiles() {
  // pestañas con contador
  els.profileTabs.textContent = '';
  for (const t of PROFILE_TABS) {
    const n = state.profiles.filter(t.test).length;
    els.profileTabs.append(h('button', {
      class: `seg-btn${state.profileTab === t.id ? ' active' : ''}`, type: 'button',
      onclick: () => { state.profileTab = t.id; renderProfiles(); }
    }, t.label, h('span', { class: 'count', text: String(n) })));
  }

  const tab = PROFILE_TABS.find((t) => t.id === state.profileTab) || PROFILE_TABS[0];
  const q = els.profileSearch.value.trim().toLowerCase();
  const visible = state.profiles
    .filter(tab.test)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.mc.includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || ((b.lastPlayed || 0) - (a.lastPlayed || 0)) || b.created - a.created);

  els.profileGroups.textContent = '';
  if (!state.profiles.length) {
    els.profileGroups.append(h('div', { class: 'empty-card big' },
      h('p', { class: 'muted', text: 'Todavía no tenés perfiles. Un perfil es una instalación aparte de Minecraft con sus propios mods y mundos.' }),
      h('button', { class: 'btn btn-green', type: 'button', onclick: () => openProfileWizard() }, icon('plus'), 'Crear mi primer perfil')));
    return;
  }

  const groups = [...state.folders.map((f) => ({ name: f, key: `f:${f}`, real: true })), { name: 'Desagrupados', key: 'f:', real: false }];
  for (const g of groups) {
    const items = visible.filter((p) => (p.folder || '') === (g.real ? g.name : ''));
    if (g.real === false && !items.length && state.folders.length) continue;
    const collapsed = state.collapsed.has(g.key);
    const head = h('div', { class: 'group-head' },
      h('button', {
        class: 'group-toggle', type: 'button',
        onclick: () => { collapsed ? state.collapsed.delete(g.key) : state.collapsed.add(g.key); renderProfiles(); }
      }, icon(collapsed ? 'chevRight' : 'chevDown', 16), icon('folder', 18), h('span', { text: `${g.name} (${items.length})` })),
      g.real ? h('button', {
        class: 'btn-icon small', type: 'button', title: 'Eliminar carpeta', 'aria-label': 'Eliminar carpeta',
        onclick: async () => {
          if (!(await confirmDialog({ title: 'Eliminar carpeta', text: `Se elimina la carpeta «${g.name}». Los perfiles que tiene pasan a «Desagrupados».`, okLabel: 'Eliminar', danger: true }))) return;
          try { state.folders = await call(window.launcher.folders('remove', g.name)); await loadProfiles(); } catch (e) { toast(e.message, 'error'); }
        }
      }, icon('trash', 16)) : null);
    els.profileGroups.append(head);
    if (!collapsed) {
      const grid = h('div', { class: 'profile-grid' });
      if (!items.length) grid.append(h('div', { class: 'muted small group-empty', text: 'Sin perfiles acá.' }));
      items.forEach((p) => grid.append(profileCard(p)));
      els.profileGroups.append(grid);
    }
  }
}

els.profileSearch.addEventListener('input', renderProfiles);

function profileCard(p) {
  const active = state.activeId === p.id && (state.busy || state.running);
  const running = active && state.running;
  const card = h('div', { class: `profile-card2${running ? ' running' : ''}` });
  const b = banner(p, 'banner-card');
  if (p.pinned) b.append(h('span', { class: 'pin-badge', title: 'Fijado' }, icon('pin', 14)));

  const gear = h('button', { class: 'btn-icon', type: 'button', title: 'Opciones', 'aria-label': 'Opciones del perfil' }, icon('settings'));
  gear.addEventListener('click', (e) => { e.stopPropagation(); openProfileMenu(gear, p); });

  const play = running
    ? h('button', { class: 'btn btn-stop btn-block', type: 'button', onclick: (e) => { e.stopPropagation(); window.launcher.stop(); } }, h('span', { class: 'stop-ico' }), 'Detener')
    : h('button', {
      class: 'btn btn-play btn-block', type: 'button', disabled: !canPlay(),
      onclick: (e) => { e.stopPropagation(); playProfile(p.id); }
    }, icon('play'), state.account ? 'Play now' : 'Inicia sesión');

  card.append(
    b,
    h('div', { class: 'card-body' },
      h('strong', { class: 'card-title', text: p.name }),
      h('span', { class: 'muted sub' }, icon('fabric', 15), `${p.loaderLabel} ${p.mc}`),
      h('div', { class: 'card-actions' }, play, gear),
      h('span', { class: 'muted small', text: active ? (running ? 'Jugando ahora' : 'Preparando…') : timeAgo(p.lastPlayed) }))
  );
  card.addEventListener('click', () => goTo('detail', { id: p.id }));
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); openProfileMenu(gear, p); });
  return card;
}

function openProfileMenu(anchor, p) {
  const header = h('div', { class: 'pop-head' },
    h('img', { src: 'logo.png', alt: '', width: 34, height: 34 }),
    h('div', {}, h('strong', { text: p.name }), h('span', { class: 'muted small', text: `${p.loaderLabel} ${p.mc} · ${p.origin === 'pack' ? 'Paquete' : 'Custom Profile'}` })));
  popMenu(anchor, [
    { label: 'Editar', icon: 'edit', onclick: () => openEditProfile(p) },
    { label: 'Ajustes', icon: 'settings', onclick: () => goTo('detail', { id: p.id, tab: 'settings' }) },
    'sep',
    { label: 'Duplicar', icon: 'layers', onclick: () => duplicateProfile(p) },
    { label: 'Copiar del perfil…', icon: 'import', onclick: () => openCopyFrom(p) },
    { label: 'Exportar…', icon: 'export', onclick: () => exportProfile(p) },
    { label: 'Compartir perfil…', icon: 'share', onclick: () => openShareModal(p) },
    { label: 'Mostrar en carpeta', icon: 'folder', onclick: () => call(window.launcher.openProfileFolder(p.id)).catch((e) => toast(e.message, 'error')) },
    { label: p.pinned ? 'Desfijar' : 'Fijar arriba', icon: 'pin', onclick: () => pinProfile(p) },
    'sep',
    { label: 'Eliminar perfil…', icon: 'trash', danger: true, onclick: () => deleteProfile(p) }
  ], header);
}

async function pinProfile(p) {
  try { await call(window.launcher.updateProfile(p.id, { pinned: !p.pinned })); await loadProfiles(); } catch (e) { toast(e.message, 'error'); }
}

async function duplicateProfile(p) {
  try {
    const c = await call(window.launcher.duplicateProfile(p.id));
    await loadProfiles();
    toast(`Perfil duplicado: ${c.name}`);
  } catch (e) { toast(e.message, 'error'); }
}

async function exportProfile(p) {
  try {
    const file = await call(window.launcher.exportProfile(p.id));
    if (file) toast('Perfil exportado.');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteProfile(p) {
  const ok = await confirmDialog({
    title: 'Eliminar perfil',
    text: p.legacy
      ? `Se quita «${p.name}» de la lista. Tu carpeta principal del juego (mundos y mods) no se borra.`
      : `Se elimina «${p.name}» con sus mods, mundos y configuración. No se puede deshacer.`,
    okLabel: 'Eliminar',
    danger: true
  });
  if (!ok) return;
  try {
    await call(window.launcher.deleteProfile(p.id));
    await loadProfiles();
    if (state.view === 'detail') goTo('profiles');
    toast('Perfil eliminado.');
  } catch (e) { toast(e.message, 'error'); }
}

function openEditProfile(p) {
  const name = h('input', { type: 'text', class: 'input', value: p.name, spellcheck: 'false', maxlength: 60 });
  const folder = h('select', { class: 'input' }, h('option', { value: '', text: 'Desagrupados' }), state.folders.map((f) => h('option', { value: f, text: f })));
  folder.value = p.folder || '';
  const m = modal({
    title: 'Editar perfil',
    icon: 'edit',
    className: 'small',
    body: [
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Nombre' }), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Carpeta' }), folder),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Versión' }),
        h('div', { class: 'row-between' },
          h('span', { text: `${p.loaderLabel} ${p.mc}` }),
          h('button', { class: 'btn btn-dark btn-small', type: 'button', text: 'Cambiar versión', onclick: () => { m.close(); changeVersion(p); } })))
    ],
    footer: [
      h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
      h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Guardar',
        onclick: async () => {
          try {
            await call(window.launcher.updateProfile(p.id, { name: name.value, folder: folder.value }));
            m.close();
            await loadProfiles();
          } catch (e) { toast(e.message, 'error'); }
        }
      })
    ]
  });
  setTimeout(() => name.focus(), 30);
}

function openCopyFrom(p) {
  const others = state.profiles.filter((x) => x.id !== p.id);
  if (!others.length) { toast('No hay otros perfiles para copiar.'); return; }
  const list = h('div', { class: 'pick-list' });
  let chosen = null;
  others.forEach((o) => {
    const row = h('button', { class: 'pick-row', type: 'button' },
      h('img', { src: 'logo.png', alt: '', width: 32, height: 32 }),
      h('div', {}, h('strong', { text: o.name }), h('span', { class: 'muted small', text: `${o.loaderLabel} ${o.mc}` })));
    row.addEventListener('click', () => {
      chosen = o;
      list.querySelectorAll('.pick-row').forEach((r) => r.classList.toggle('selected', r === row));
    });
    list.append(row);
  });
  const m = modal({
    title: 'Copiar del perfil',
    icon: 'import',
    className: 'small',
    body: [h('p', { class: 'modal-text', text: `Elegí de qué perfil traer mods, paquetes de recursos y configuración hacia «${p.name}». Lo que ya tenés no se borra.` }), list],
    footer: [
      h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
      h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Copiar',
        onclick: async () => {
          if (!chosen) { toast('Elegí un perfil.'); return; }
          try { await call(window.launcher.copyFromProfile(p.id, chosen.id)); m.close(); toast('Contenido copiado.'); if (state.view === 'detail') detailRefresh(true); } catch (e) { toast(e.message, 'error'); }
        }
      })
    ]
  });
}

function openShareModal(p) {
  const m = modal({
    title: `Compartir «${p.name}»`,
    icon: 'share',
    body: [shareView(p)],
    footer: [h('button', { class: 'btn btn-dark', type: 'button', text: 'Cerrar', onclick: () => m.close() })]
  });
}

// ── Carpetas e importación ──

$('btn-new-folder').addEventListener('click', async () => {
  const name = await promptDialog({ title: 'Nueva carpeta', label: 'Nombre de la carpeta', okLabel: 'Crear' });
  if (!name) return;
  try { state.folders = await call(window.launcher.folders('add', name)); await loadProfiles(); } catch (e) { toast(e.message, 'error'); }
});

async function finishImport(r) {
  if (!r) return;
  await loadProfiles();
  notify(`Perfil importado: ${r.profile.name}`);
  if (r.failed.length) {
    const m = modal({
      title: 'Importado con avisos',
      icon: 'warn',
      body: [h('p', { class: 'modal-text', text: 'El perfil se creó, pero estos elementos no se pudieron instalar:' }), h('ul', { class: 'plain-list' }, r.failed.map((f) => h('li', { text: f })))],
      footer: [h('button', { class: 'btn btn-accent', type: 'button', text: 'Entendido', onclick: () => m.close() })]
    });
  } else {
    toast(`Perfil importado: ${r.profile.name}`);
  }
  goTo('detail', { id: r.profile.id, tab: 'content' });
}

$('btn-import').addEventListener('click', (e) => {
  popMenu(e.currentTarget, [
    {
      label: 'Desde un archivo…', icon: 'file',
      async onclick() {
        try { await finishImport(await call(window.launcher.importProfileFile())); } catch (err) { toast(err.message, 'error'); }
      }
    },
    {
      label: 'Desde un código…', icon: 'link',
      async onclick() {
        const code = await promptDialog({ title: 'Importar desde código', label: 'Pegá el código del perfil (empieza con NOVA1:)', okLabel: 'Importar' });
        if (!code) return;
        try { toast('Importando perfil…'); await finishImport(await call(window.launcher.importProfileCode(code))); } catch (err) { toast(err.message, 'error'); }
      }
    }
  ]);
});

$('btn-new-profile').addEventListener('click', () => openProfileWizard());

// ───────────────────────── Asistente: nuevo perfil / cambiar versión ─────────────────────────

// Botón "Cambiar versión": avisa que está cargando las versiones compatibles y abre el asistente.
async function changeVersion(profile) {
  const busy = progressToast({ title: 'Cargando versiones compatibles', text: `Buscando versiones disponibles para ${profile.name}.` });
  try {
    if (!state.versions.length) await loadVersions();
  } finally {
    busy.close();
  }
  openProfileWizard({ profile });
}

function openProfileWizard({ profile = null } = {}) {
  const editing = !!profile;
  const sel = {
    name: editing ? profile.name : '',
    mc: profile?.mc || state.settings?.lastVersion || state.versions[0]?.id || '',
    type: profile ? (profile.loader === 'fabric' ? 'nova' : 'vanilla') : 'nova',
    autoSync: profile ? profile.autoSync !== false : true,
    folder: profile?.folder || ''
  };
  let m = null;
  let step = 1;

  function renderStep1() {
    const name = h('input', { type: 'text', class: 'input', value: sel.name, placeholder: 'Nombre del perfil (opcional)', spellcheck: 'false', maxlength: 60 });
    name.addEventListener('input', () => { sel.name = name.value; });
    const search = h('input', { type: 'text', class: 'input', placeholder: 'Buscar versión (ej: 1.21.4)', spellcheck: 'false' });
    const grid = h('div', { class: 'version-grid' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const list = state.versions.filter((v) => !q || v.id.toLowerCase().includes(q)).slice(0, 120);
      grid.textContent = '';
      if (!list.length) grid.append(h('div', { class: 'version-empty', text: state.versionsLoaded ? 'No hay versiones que coincidan.' : 'Las versiones todavía no se cargaron.' }));
      for (const v of list) {
        grid.append(h('button', {
          class: `ver-card${v.id === sel.mc ? ' selected' : ''}`, type: 'button',
          onclick: () => { sel.mc = v.id; draw(); }
        }, h('strong', { text: v.id }), h('span', { text: v.type === 'snapshot' ? 'Snapshot' : 'Release' })));
      }
    };
    search.addEventListener('input', draw);
    draw();

    const types = h('div', { class: 'type-cards' },
      typeCard('nova', 'Con Nova Client', 'Fabric + HUD, amigos, zoom y más.'),
      typeCard('vanilla', 'Vanilla', 'Minecraft sin mods.'));
    function typeCard(id, title, text) {
      const el = h('button', { class: `type-card${sel.type === id ? ' selected' : ''}`, type: 'button' }, h('strong', { text: title }), h('span', { class: 'muted small', text }));
      el.addEventListener('click', () => {
        sel.type = id;
        types.querySelectorAll('.type-card').forEach((c) => c.classList.toggle('selected', c === el));
        next.textContent = sel.type === 'nova' ? 'Siguiente' : (editing ? 'Guardar' : 'Crear perfil');
      });
      return el;
    }

    const next = h('button', { class: 'btn btn-accent', type: 'button', text: sel.type === 'nova' ? 'Siguiente' : (editing ? 'Guardar' : 'Crear perfil'), onclick: () => (sel.type === 'nova' ? goStep2() : submit()) });
    setModal({
      title: editing ? 'Cambiar versión' : 'Nuevo perfil',
      icon: 'cube',
      wide: true,
      body: [editing ? null : h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Nombre' }), name), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Versión de Minecraft' }), search, grid), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Tipo' }), types)],
      footer: [h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }), next]
    });
  }

  function renderStep2() {
    const card = (id, label, sub, opts = {}) => {
      const el = h('button', { class: `loader-card ${id}${opts.selected ? ' selected' : ''}${opts.disabled ? ' disabled' : ''}`, type: 'button', disabled: !!opts.disabled },
        h('span', { class: 'loader-art' }, h('img', { src: `loaders/${id}.png`, alt: label, draggable: false, class: id === 'forge' ? '' : 'px' })),
        h('span', { class: 'loader-name' }, label, opts.beta ? h('em', { class: 'beta', text: 'BETA' }) : null),
        h('span', { class: 'loader-sub', text: sub }));
      return el;
    };
    const sync = toggle(sel.autoSync, (v) => { sel.autoSync = v; }, 'Sincronización automática');
    setModal({
      title: 'Elija un cargador',
      icon: 'cube',
      wide: true,
      body: [
        h('p', { class: 'modal-sub', text: `Con Nova · Minecraft ${sel.mc}` }),
        h('div', { class: 'loader-row' },
          card('fabric', 'Fabric', sel.mc, { selected: true }),
          card('neoforge', 'NeoForge', 'Próximamente', { beta: true, disabled: true, icon: 'cube' }),
          card('forge', 'Forge', 'No disponible', { disabled: true, icon: 'layers' }))
      ],
      footer: [
        h('button', { class: 'btn btn-dark', type: 'button', onclick: () => goStep1() }, icon('back'), 'Atrás'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'sync-label' }, 'Sincronización automática', sync),
        h('button', { class: 'btn btn-accent', type: 'button', text: editing ? 'Guardar' : 'Crear perfil', onclick: submit })
      ]
    });
  }

  function setModal(cfg) {
    if (!m) {
      m = modal({ ...cfg, onClose: () => { m = null; } });
    } else {
      // Se reemplaza el contenido de la misma ventana.
      const box = m.el;
      box.className = `modal-box${cfg.wide ? ' wide' : ''}`;
      box.querySelector('h3').textContent = cfg.title;
      m.body.textContent = '';
      m.body.append(...cfg.body.filter(Boolean));
      const old = box.querySelector('.modal-foot');
      if (old) old.remove();
      box.append(h('div', { class: 'modal-foot' }, cfg.footer));
    }
  }

  function goStep1() { step = 1; renderStep1(); }
  function goStep2() {
    if (!sel.mc) { toast('Elegí una versión.'); return; }
    step = 2;
    renderStep2();
  }

  async function submit() {
    if (!sel.mc) { toast('Elegí una versión.'); return; }
    const loader = sel.type === 'nova' ? 'fabric' : 'vanilla';
    try {
      if (editing) {
        const busy = progressToast({ title: 'Cambiando versión', text: `Pasando ${profile.name} a Minecraft ${sel.mc}.` });
        try {
          await call(window.launcher.updateProfile(profile.id, { mc: sel.mc, loader, nova: sel.type === 'nova', autoSync: sel.autoSync }));
        } catch (e) { busy.close(0); throw e; }
        m.close();
        await loadProfiles();
        busy.close();
        toast(`Cambié ${profile.name} a ${loader === 'fabric' ? 'Fabric' : 'Vanilla'} ${sel.mc}. Si hay mods, se actualizan al jugar.`, 'success');
      } else {
        const p = await call(window.launcher.createProfile({ name: sel.name, mc: sel.mc, loader, nova: sel.type === 'nova', autoSync: sel.autoSync, folder: sel.folder }));
        m.close();
        await loadProfiles();
        toast(`Perfil creado: ${p.name}`);
        goTo('detail', { id: p.id, tab: 'content' });
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  goStep1();
  void step;
}

// ───────────────────────── Servidores ─────────────────────────

let serverProfileId = '';

async function renderServers() {
  const root = els.views.servers;
  let servers = [];
  try { servers = await call(window.launcher.listServers()); } catch (e) { toast(e.message, 'error'); }
  if (!serverProfileId || !profileById(serverProfileId)) serverProfileId = lastProfile()?.id || '';

  const name = h('input', { type: 'text', class: 'input', placeholder: 'Nombre (opcional)', spellcheck: 'false', maxlength: 40 });
  const addr = h('input', { type: 'text', class: 'input', placeholder: 'play.ejemplo.com', spellcheck: 'false' });
  const add = async () => {
    try { await call(window.launcher.addServer(name.value, addr.value)); renderServers(); } catch (e) { toast(e.message, 'error'); }
  };
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const profSel = h('select', { class: 'input' }, state.profiles.map((p) => h('option', { value: p.id, text: `${p.name} (${p.loaderLabel} ${p.mc})` })));
  profSel.value = serverProfileId;
  profSel.addEventListener('change', () => { serverProfileId = profSel.value; });

  root.textContent = '';
  root.append(
    h('div', { class: 'page-head' }, h('h2', { text: 'Servidores' })),
    h('div', { class: 'card wide' },
      h('div', { class: 'form-row' },
        h('label', { class: 'field grow' }, h('span', { class: 'field-label', text: 'Nombre' }), name),
        h('label', { class: 'field grow2' }, h('span', { class: 'field-label', text: 'Dirección' }), addr),
        h('button', { class: 'btn btn-green', type: 'button', onclick: add }, icon('plus'), 'Añadir')),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Entrar con el perfil' }), profSel)),
    h('div', { class: 'server-list' }, servers.length ? servers.map((s) => h('div', { class: 'server-row' },
      h('span', { class: 'server-ico' }, icon('server', 22)),
      h('div', { class: 'grow' }, h('strong', { text: s.name }), h('span', { class: 'muted small', text: s.address })),
      h('button', {
        class: 'btn btn-play btn-small', type: 'button', disabled: !canPlay() || !serverProfileId,
        onclick: () => playProfile(serverProfileId, { server: s.address })
      }, icon('play'), 'Entrar'),
      h('button', {
        class: 'btn-icon small', type: 'button', title: 'Quitar', 'aria-label': 'Quitar servidor',
        onclick: async () => { try { await call(window.launcher.removeServer(s.id)); renderServers(); } catch (e) { toast(e.message, 'error'); } }
      }, icon('trash', 16)))) : h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Guardá tus servidores y entrá con un clic: el juego abre directo en el servidor.' })))
  );
}

// ───────────────────────── Modificaciones (buscador global) ─────────────────────────

function renderBrowse() { renderMods(); }

// ───────────────────────── Novedades ─────────────────────────

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'Hoy';
  if (days < 30) return `Hace ${days} d`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

let newsLoadedAt = 0;
const NEWS_REFRESH_MS = 24 * 60 * 60 * 1000; // las novedades se actualizan una vez por día

async function loadNews() {
  const hadCards = els.newsList.querySelector('.news-card');
  try {
    const items = await call(window.launcher.news());
    if (!items.length) throw new Error('vacío');
    els.newsList.textContent = '';
    newsLoadedAt = Date.now();
    for (const n of items) {
      const card = h('div', { class: 'news-card' },
        h('span', { class: 'news-tag', text: n.version ? `Versión ${n.version}` : 'Novedad' }),
        h('div', { class: 'news-title', text: n.title }),
        h('div', { class: 'news-date', text: formatDate(n.date) }));
      if (n.image) card.style.backgroundImage = `url("${n.image}")`;
      els.newsList.append(card);
    }
  } catch {
    if (hadCards) return; // si ya había novedades, se dejan hasta el próximo intento
    els.newsList.textContent = '';
    els.newsList.append(h('div', { class: 'news-empty muted small', text: 'No se pudieron cargar las novedades.' }));
  }
}

// Revisa cada hora: si pasó un día (o la última carga falló) vuelve a pedir las novedades.
setInterval(() => { if (Date.now() - newsLoadedAt >= NEWS_REFRESH_MS || !newsLoadedAt) loadNews(); }, 60 * 60 * 1000);
window.addEventListener('focus', () => { if (Date.now() - newsLoadedAt >= NEWS_REFRESH_MS) loadNews(); });

// ───────────────────────── Versiones ─────────────────────────

async function loadVersions() {
  state.versionsLoaded = false;
  try {
    state.versions = await call(window.launcher.listVersions(state.settings.showSnapshots));
    state.versionsLoaded = state.versions.length > 0;
  } catch (e) {
    showError(`No se pudo cargar la lista de versiones: ${e.message}`);
  }
}

// ───────────────────────── Actualizaciones en vivo ─────────────────────────

const upd = { launcher: null };

function renderUpdate() {
  const u = upd.launcher;
  const pill = els.updatePill;
  pill.classList.remove('clickable', 'pulse');
  pill.onclick = null;
  if (!u || u.state === 'none' || u.state === 'checking' || u.state === 'error') {
    pill.classList.add('hidden');
    return;
  }
  pill.classList.remove('hidden');
  pill.title = u.version ? `Versión ${u.version}` : '';
  if (u.state === 'available' || u.state === 'countdown') {
    pill.textContent = u.state === 'countdown' ? `Actualización disponible · se instala en ${u.seconds}s` : 'Actualización disponible';
    pill.classList.add('clickable', 'pulse');
    pill.onclick = askUpdate;
  } else if (u.state === 'downloading') {
    pill.textContent = `Descargando actualización${u.version ? ' ' + u.version : ''}… ${u.percent ?? 0}%`;
  } else if (u.state === 'ready') {
    pill.textContent = u.waitingGame ? 'Actualización lista: se instala al cerrar Minecraft' : 'Instalando actualización…';
  }
}

// Tocar el cartel: la cuenta regresiva se frena y se pregunta si continuar o cancelar.
let askingUpdate = false;
async function askUpdate() {
  if (askingUpdate) return;
  askingUpdate = true;
  try {
    await call(window.launcher.holdUpdate());
    const running = !!state.running;
    const ok = await confirmDialog({
      title: 'Actualización disponible',
      text: running
        ? 'Minecraft está abierto. Si continuás, la actualización se descarga ahora y se instala cuando cierres Minecraft.'
        : 'El launcher se va a cerrar y a abrir de nuevo para instalar la actualización.',
      okLabel: 'Continuar'
    });
    if (ok) await call(window.launcher.startUpdate());
  } catch (e) { showError(e.message); } finally { askingUpdate = false; }
}

window.launcher.onUpdate(async (u) => {
  if (u.kind === 'launcher') {
    upd.launcher = u;
    renderUpdate();
    const text = {
      checking: 'Buscando actualizaciones…',
      none: 'Estás en la última versión.',
      available: `Hay una actualización disponible (${u.version || ''}).`,
      countdown: '',
      downloading: `Descargando la versión ${u.version || ''}…`,
      ready: u.waitingGame ? `La versión ${u.version || ''} está lista. Se instala al cerrar Minecraft.` : `Instalando la versión ${u.version || ''}…`,
      error: 'No se pudo buscar actualizaciones (¿sin conexión?).'
    }[u.state];
    if (text && typeof setUpdateText === 'function') setUpdateText(text);
    if ((u.state === 'available' || u.state === 'countdown') && upd.notified !== u.version) { upd.notified = u.version; notify(`Actualización ${u.version || ''} disponible.`); }
  } else if (u.kind === 'mods') {
    if (typeof setUpdateText === 'function') setUpdateText(`Nova Client actualizado (${u.tag}).`);
    notify(`Nova Client actualizado (${u.tag}).`);
    state.info = await call(window.launcher.appInfo());
  }
});

// ───────────────────────── Ajustes rápidos usados en inicio ─────────────────────────

function renderInstallInfo() {
  const gb = state.profiles.length && lastProfile()?.ramGB ? lastProfile().ramGB : state.settings.ramGB;
  els.infoRam.textContent = `${gb} GB`;
  els.infoJava.textContent = state.settings.javaPath ? 'Personalizado' : 'Automático';
}

// ───────────────────────── Arranque ─────────────────────────

(async function init() {
  mountStaticIcons();
  mountRail();
  renderAccount(null);
  if (typeof mountSocial === 'function') mountSocial();

  const [info, settings] = await Promise.all([
    call(window.launcher.appInfo()),
    call(window.launcher.getSettings())
  ]);
  state.settings = settings;
  state.info = info;
  applyAppearance(settings);
  $('titlebar-name').textContent = 'Nova Client';
  state.running = !!info.running;
  state.activeId = info.running ? info.running.profileId : null;

  await loadProfiles();
  renderInstallInfo();
  goTo('home');

  loadNews();                 // en paralelo, no bloquea nada
  await loadVersions();

  setProgress('Comprobando sesión…', null);
  try {
    renderAccount(await call(window.launcher.restoreSession()));
  } catch {
    renderAccount(null);
  }
  setProgress('Todo listo.', 0);
  if (typeof window.hideBoot === 'function') window.hideBoot();
})();
