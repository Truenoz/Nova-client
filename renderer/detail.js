'use strict';

// Detalle de un perfil (contenido, mundos, registros, ajustes, compartir), buscador de contenido
// de Modrinth y tarjeta de mods de rendimiento.

const detail = {
  id: null,
  tab: 'content',
  content: null,       // lista de contenido del perfil (null = cargando)
  updates: new Set(),  // claves con versión nueva
  filter: 'all',
  query: '',
  selected: new Set(),
  perf: null,
  perfBusy: false,
  left: null,
  right: null,
  progressText: null,
  progressBar: null
};

const DETAIL_TABS = [
  { id: 'content', label: 'CONTENIDO', icon: 'cube' },
  { id: 'worlds', label: 'MUNDOS', icon: 'globe' },
  { id: 'logs', label: 'REGISTROS', icon: 'console' },
  { id: 'settings', label: 'AJUSTES', icon: 'settings' },
  { id: 'share', label: 'Compartir', icon: 'share' }
];

function detailProfile() {
  return profileById(detail.id);
}

function renderDetail(id, tab) {
  if (detail.id !== id) {
    detail.content = null;
    detail.updates = new Set();
    detail.perf = null;
    detail.filter = 'all';
    detail.query = '';
  }
  detail.id = id;
  detail.tab = tab || 'content';
  detail.selected = new Set();
  const p = detailProfile();
  const root = els.views.detail;
  root.textContent = '';
  if (!p) { goTo('profiles'); return; }

  detail.left = h('aside', { class: 'detail-left' });
  detail.right = h('section', { class: 'detail-right' });
  root.append(
    h('div', { class: 'detail-head' },
      h('button', { class: 'btn btn-back', type: 'button', onclick: () => goTo('profiles') }, icon('back'), 'Atrás'),
      h('h2', { id: 'detail-title', text: p.name })),
    h('div', { class: 'detail-grid' }, detail.left, detail.right));
  renderDetailLeft();
  renderDetailRight();
  loadPerf();
  if (detail.content === null) loadContent();
}

// Lo llama app.js cuando cambia el estado del juego o la lista de perfiles.
function detailRefresh(reloadContent) {
  const p = detailProfile();
  if (!p || !detail.left) return;
  const title = $('detail-title');
  if (title) title.textContent = p.name;
  renderDetailLeft();
  if (reloadContent) loadContent();
}

function detailProgress(text, pct) {
  if (!detail.progressText) return;
  detail.progressText.textContent = text;
  const bar = detail.progressBar;
  if (pct === null || pct === undefined) {
    bar.classList.toggle('indeterminate', state.busy && !state.running);
    bar.style.width = state.busy && !state.running ? '' : '0%';
  } else {
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
}

// ───────────────────────── Panel izquierdo ─────────────────────────

function renderDetailLeft() {
  const p = detailProfile();
  const box = detail.left;
  box.textContent = '';
  const active = state.activeId === p.id && (state.busy || state.running);
  const running = active && state.running;

  const art = banner(p, 'banner-detail');
  const gear = h('button', { class: 'art-gear', type: 'button', title: 'Opciones', 'aria-label': 'Opciones del perfil' }, icon('settings'));
  gear.addEventListener('click', () => openProfileMenu(gear, p));
  const artWrap = h('div', { class: 'detail-art' }, art, gear);

  const play = running
    ? h('button', { class: 'btn btn-stop btn-big btn-block', type: 'button', onclick: () => window.launcher.stop() }, h('span', { class: 'stop-ico' }), 'Detener')
    : h('button', {
      class: 'btn btn-play btn-big btn-block', type: 'button', disabled: !canPlay(),
      onclick: () => playProfile(p.id)
    }, icon('play'), active ? 'Preparando…' : state.account ? 'Play now' : 'Inicia sesión para jugar');

  detail.progressText = h('div', { class: 'progress-text', text: active ? els.progressText.textContent : '' });
  detail.progressBar = h('div', { class: 'progress-bar' });
  const progress = h('div', { class: `detail-progress${active ? '' : ' hidden'}` }, detail.progressText, h('div', { class: 'progress-track' }, detail.progressBar));

  const mods = (detail.content || []).filter((c) => c.type === 'mod').length;
  const remote = (detail.content || []).filter((c) => c.source === 'Modrinth').length;
  const contentText = detail.content === null ? '—' : !detail.content.length ? 'Vacío' : remote ? `${mods} mods · ${remote} de Modrinth` : 'Local jars';

  box.append(
    artWrap,
    h('div', { class: 'detail-tags' },
      h('span', { class: 'tag tag-ok', text: p.origin === 'pack' ? 'Paquete' : 'Custom' }),
      p.nova ? h('span', { class: 'tag tag-nova', text: 'Nova Client' }) : null),
    h('div', { class: 'muted small', text: `${p.loaderLabel} ${p.mc}` }),
    play,
    progress,
    h('button', { class: 'btn btn-dark btn-block', type: 'button', text: 'ABRIR CARPETA', onclick: () => call(window.launcher.openProfileFolder(p.id)).catch((e) => toast(e.message, 'error')) }),
    h('button', { class: 'btn btn-dark btn-block', type: 'button', text: 'PERFIL DE EXPORTACIÓN', onclick: () => exportProfile(p) }),
    h('div', { class: 'info-list' },
      infoRow('folder', 'Contenido', contentText),
      infoRow('clock', 'TIEMPO DE JUEGO', formatPlaytime(p.playtimeSec)),
      infoRow('clock', 'Jugado por última vez', timeAgo(p.lastPlayed))),
    perfCard(p)
  );
  if (active) detailProgress(els.progressText.textContent, null);
}

function infoRow(ico, label, value) {
  return h('div', { class: 'info-line' }, icon(ico, 22), h('div', {}, h('strong', { text: label }), h('span', { class: 'muted small', text: value })));
}

// ── Rendimiento ──

async function loadPerf() {
  const id = detail.id;
  try {
    const perf = await call(window.launcher.getPerf(id));
    if (detail.id !== id) return;
    detail.perf = perf;
    renderDetailLeft();
  } catch { /* sin datos de rendimiento */ }
}

function perfCard(p) {
  const card = h('div', { class: 'perf-card' });
  const perf = detail.perf;
  const head = h('div', { class: 'perf-head' }, h('img', { src: 'logo.png', alt: '', width: 28, height: 28 }), h('strong', { text: 'Rendimiento' }));
  if (p.loader !== 'fabric') {
    card.append(head, h('p', { class: 'muted small', text: 'Los mods de rendimiento (Sodium, Lithium…) necesitan Fabric. Cambiá el perfil a «Con Nova Client» para usarlos.' }));
    return card;
  }
  if (!perf) {
    card.append(head, h('p', { class: 'muted small', text: 'Cargando…' }));
    return card;
  }
  head.append(toggle(perf.master, (v, input) => setPerf(input, { master: v }), 'Mods de rendimiento'));
  card.append(head);
  if (perf.master) {
    const list = h('div', { class: 'perf-list' });
    for (const m of perf.mods) {
      list.append(h('div', { class: 'perf-item' },
        h('div', { class: 'grow' },
          h('div', { class: 'perf-name' }, m.name, icon('chevRight', 12)),
          h('span', { class: 'muted tiny', text: m.installed ? `Versión del mod: ${m.version}` : m.enabled ? 'Se instala al jugar' : 'Desactivado' })),
        toggle(m.enabled, (v, input) => setPerf(input, { key: m.key, enabled: v }), m.name)));
    }
    card.append(list);
  }
  card.append(h('p', { class: 'muted tiny legal', text: 'Nova (sin afiliación) no posee los derechos de estos mods. Son mods públicos de Modrinth.' }));
  return card;
}

async function setPerf(input, patch) {
  if (detail.perfBusy) { input.checked = !input.checked; return; }
  detail.perfBusy = true;
  const id = detail.id;
  toast('Aplicando cambios de rendimiento…');
  try {
    detail.perf = await call(window.launcher.setPerf(id, patch));
    toast('Listo.');
  } catch (e) {
    toast(e.message, 'error');
    try { detail.perf = await call(window.launcher.getPerf(id)); } catch { /* se deja como estaba */ }
  } finally {
    detail.perfBusy = false;
    if (detail.id === id) renderDetailLeft();
    loadContent();
  }
}

// ───────────────────────── Panel derecho ─────────────────────────

function renderDetailRight() {
  const box = detail.right;
  box.textContent = '';
  const tabs = h('div', { class: 'tab-bar' }, DETAIL_TABS.map((t) => h('button', {
    class: `tab-btn${detail.tab === t.id ? ' active' : ''}`, type: 'button',
    onclick: () => { detail.tab = t.id; detail.selected = new Set(); renderDetailRight(); }
  }, icon(t.icon, 18), t.label)));
  const panel = h('div', { class: 'tab-panel' });
  box.append(tabs, panel);
  const p = detailProfile();
  if (detail.tab === 'content') renderContentTab(panel, p);
  else if (detail.tab === 'worlds') renderWorldsTab(panel, p);
  else if (detail.tab === 'logs') renderLogsTab(panel, p);
  else if (detail.tab === 'settings') renderSettingsTab(panel, p);
  else renderShareTab(panel, p);
}

// ───────────────────────── Contenido ─────────────────────────

async function loadContent() {
  const id = detail.id;
  if (!id) return;
  try {
    const list = await call(window.launcher.listContent(id));
    if (detail.id !== id) return;
    detail.content = list;
  } catch (e) {
    detail.content = [];
    toast(e.message, 'error');
  }
  if (detail.tab === 'content') renderDetailRight();
  renderDetailLeft();
  // Archivos puestos a mano: se comparan con Modrinth en segundo plano; si alguno viene de ahí, pasa a figurar como Modrinth.
  call(window.launcher.identifyContent(id)).then((n) => {
    if (!n || detail.id !== id) return;
    toast(n === 1 ? 'Detecté 1 archivo descargado de Modrinth.' : `Detecté ${n} archivos descargados de Modrinth.`, 'success');
    loadContent();
  }).catch(() => {});
  // Versiones nuevas: se miran en segundo plano y solo marcan los botones.
  call(window.launcher.checkContentUpdates(id)).then((keys) => {
    if (detail.id !== id) return;
    detail.updates = new Set(keys);
    if (detail.tab === 'content' && keys.length) renderDetailRight();
  }).catch(() => {});
}

function renderContentTab(panel, p) {
  const syncBtn = h('button', {
    class: `btn btn-sync${p.autoSync ? ' on' : ''}`, type: 'button', title: 'Actualiza los mods compatibles cada vez que jugás',
    onclick: async () => {
      try { await call(window.launcher.updateProfile(p.id, { autoSync: !p.autoSync })); await loadProfiles(); renderDetailRight(); } catch (e) { toast(e.message, 'error'); }
    }
  }, icon('sync', 18), 'Sincronización automática');
  const toolbar = h('div', { class: 'content-toolbar' },
    syncBtn,
    h('button', { class: 'btn btn-dark', type: 'button', onclick: () => changeVersion(p) }, icon('layers', 18), 'Change version'),
    h('button', { class: 'btn btn-accent', type: 'button', onclick: () => openAddContent(p.id) }, icon('plus', 18), 'AÑADIR CONTENIDO'));

  const search = h('input', { type: 'text', class: 'input', placeholder: 'Buscar', value: detail.query, spellcheck: 'false' });
  search.addEventListener('input', () => { detail.query = search.value; drawTable(); });
  const searchBox = h('label', { class: 'search-box wide' }, icon('search', 18), search);

  const seg = h('div', { class: 'seg full' }, [['all', 'TODOS'], ['mod', 'Modificaciones'], ['resourcepack', 'Paquetes de recursos']].map(([id, label]) =>
    h('button', {
      class: `seg-btn${detail.filter === id ? ' active' : ''}`, type: 'button',
      onclick: () => { detail.filter = id; detail.selected = new Set(); renderDetailRight(); }
    }, label)));

  const bulk = h('div', { class: 'bulk-bar hidden' });
  const table = h('div', { class: 'content-table' });
  panel.append(toolbar, searchBox, seg, bulk, table);
  drawTable();

  function visibleRows() {
    const q = detail.query.trim().toLowerCase();
    return (detail.content || []).filter((c) => (detail.filter === 'all' || c.type === detail.filter) && (!q || c.name.toLowerCase().includes(q) || c.author.toLowerCase().includes(q)));
  }

  function drawBulk(rows) {
    bulk.textContent = '';
    const n = detail.selected.size;
    bulk.classList.toggle('hidden', !n);
    if (!n) return;
    const chosen = rows.filter((r) => detail.selected.has(r.file));
    bulk.append(
      h('strong', { text: `${n} seleccionado${n === 1 ? '' : 's'}` }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-dark btn-small', type: 'button', text: 'Activar', onclick: () => bulkApply(chosen, 'on') }),
      h('button', { class: 'btn btn-dark btn-small', type: 'button', text: 'Desactivar', onclick: () => bulkApply(chosen, 'off') }),
      h('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Eliminar', onclick: () => bulkApply(chosen, 'del') }));
  }

  async function bulkApply(chosen, action) {
    if (action === 'del' && !(await confirmDialog({ title: 'Eliminar contenido', text: `Se eliminan ${chosen.length} elemento(s) del perfil.`, okLabel: 'Eliminar', danger: true }))) return;
    try {
      for (const c of chosen) {
        if (action === 'del') await call(window.launcher.removeContent(p.id, c.file));
        else await call(window.launcher.toggleContent(p.id, c.file, action === 'on'));
      }
      detail.selected = new Set();
      await loadContent();
    } catch (e) { toast(e.message, 'error'); }
  }

  function drawTable() {
    table.textContent = '';
    if (detail.content === null) { table.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Cargando contenido…' }))); return; }
    const rows = visibleRows();
    const allOn = rows.length && rows.every((r) => detail.selected.has(r.file));
    const headCheck = h('input', { type: 'checkbox', class: 'chk', 'aria-label': 'Seleccionar todo' });
    headCheck.checked = !!allOn;
    headCheck.addEventListener('change', () => {
      detail.selected = headCheck.checked ? new Set(rows.map((r) => r.file)) : new Set();
      drawTable();
    });
    table.append(h('div', { class: 'trow thead' }, h('span', {}, headCheck), h('span', {}), h('span', { text: 'Name' }), h('span', { text: 'Type' }), h('span', { text: 'Source' }), h('span', { text: 'Version' }), h('span', {})));
    if (!rows.length) {
      table.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: detail.content.length ? 'Nada coincide con la búsqueda.' : 'Este perfil no tiene contenido todavía. Usá «AÑADIR CONTENIDO».' })));
    }
    for (const c of rows) table.append(contentRow(c));
    drawBulk(rows);
  }

  function contentRow(c) {
    const key = `${c.type === 'mod' ? 'mods' : 'resourcepacks'}/${c.base}`;
    const chk = h('input', { type: 'checkbox', class: 'chk', 'aria-label': `Seleccionar ${c.name}` });
    chk.checked = detail.selected.has(c.file);
    chk.addEventListener('change', () => { chk.checked ? detail.selected.add(c.file) : detail.selected.delete(c.file); drawBulk(visibleRows()); });

    const ico = c.icon ? h('img', { class: 'c-icon', src: c.icon, alt: '', width: 40, height: 40 }) : h('span', { class: 'c-icon ph' }, icon(c.type === 'mod' ? 'cube' : 'file', 22));
    const hasUpdate = detail.updates.has(key);
    const upd = h('button', {
      class: `btn-icon small${hasUpdate ? ' has-update' : ''}`, type: 'button', title: hasUpdate ? 'Hay una versión nueva: actualizar' : 'Buscar actualización', 'aria-label': 'Actualizar',
      disabled: c.source !== 'Modrinth',
      onclick: async () => {
        upd.disabled = true;
        try {
          const r = await call(window.launcher.updateContent(p.id, c.file));
          toast(r.updated ? `${c.name} actualizado a ${r.version}.` : `${c.name} ya está al día.`);
          detail.updates.delete(key);
          await loadContent();
        } catch (e) { toast(e.message, 'error'); upd.disabled = false; }
      }
    }, icon('update', 18));
    const more = h('button', { class: 'btn-icon small', type: 'button', title: 'Más opciones', 'aria-label': 'Más opciones' }, icon('settings', 18));
    more.addEventListener('click', () => popMenu(more, [
      c.projectId ? { label: 'Ver en Modrinth', icon: 'link', onclick: () => window.launcher.openExternal(`https://modrinth.com/project/${encodeURIComponent(c.projectId)}`) } : null,
      { label: 'Mostrar carpeta del perfil', icon: 'folder', onclick: () => call(window.launcher.openProfileFolder(p.id)) }
    ].filter(Boolean)));
    const sw = toggle(c.enabled, async (v, input) => {
      try { await call(window.launcher.toggleContent(p.id, c.file, v)); c.enabled = v; c.file = v ? c.base : `${c.base}.disabled`; } catch (e) { input.checked = !v; toast(e.message, 'error'); }
    }, `Activar ${c.name}`);
    const del = h('button', {
      class: 'btn-del', type: 'button', title: 'Eliminar', 'aria-label': `Eliminar ${c.name}`,
      onclick: async () => {
        if (!(await confirmDialog({ title: 'Eliminar contenido', text: `¿Eliminar «${c.name}» de este perfil?`, okLabel: 'Eliminar', danger: true }))) return;
        try { await call(window.launcher.removeContent(p.id, c.file)); await loadContent(); } catch (e) { toast(e.message, 'error'); }
      }
    }, icon('x', 18));

    return h('div', { class: `trow${c.enabled ? '' : ' off'}${c.compat?.status === 'bad' ? ' incompat' : ''}` },
      h('span', {}, chk),
      ico,
      h('span', { class: 'c-name' }, h('strong', { text: c.name }), h('span', { class: 'muted small', text: c.author ? `by ${c.author}` : c.base })),
      h('span', {}, h('span', { class: 'tag-pill', text: c.type === 'mod' ? 'Mod' : 'Pack' })),
      h('span', { class: 'c-source' }, c.source === 'Modrinth' ? h('img', { src: 'loaders/modrinth.png', alt: 'Modrinth', class: 'src-logo', width: 16, height: 16, draggable: false }) : icon('file', 16), c.source),
      h('span', { class: 'c-version', title: c.version, text: c.version || '—' }, compatBadge(c)),
      h('span', { class: 'c-actions' }, upd, more, sw, del));
  }
}

// Insignia junto a la versión: ✔ compatible, ⚠ no compatible con la versión / cargador del perfil.
function compatBadge(c) {
  const st = c.compat?.status;
  if (st !== 'ok' && st !== 'bad') return null;
  const el = h('span', { class: `compat-badge ${st}`, title: c.compat.reason, 'aria-label': c.compat.reason }, icon(st === 'ok' ? 'check' : 'warn', 14));
  return el;
}

// ───────────────────────── Añadir contenido ─────────────────────────

function openAddContent(profileId) {
  const m = modal({
    title: 'Añadir contenido',
    icon: 'plus',
    wide: true,
    className: 'tall',
    body: [contentBrowser(() => profileId)],
    footer: [
      h('button', {
        class: 'btn btn-dark', type: 'button',
        onclick: async () => {
          let busy = null;
          try {
            const paths = await call(window.launcher.pickLocalContent(profileId));
            if (!paths.length) return;
            busy = progressToast({ title: 'Importando archivos locales', text: 'Comprobando los archivos seleccionados antes de la instalación.' });
            const { n, incompatible } = await call(window.launcher.addLocalContent(profileId, paths));
            let fromModrinth = 0;
            if (n) {
              busy.update({ text: 'Buscando los archivos en Modrinth…' });
              try { fromModrinth = await call(window.launcher.identifyContent(profileId)); } catch { /* sin conexión: se reintenta al abrir el perfil */ }
            }
            busy.close();
            if (n) {
              const p = profileById(profileId);
              const where = p ? ` en ${p.loaderLabel} ${p.mc}` : '';
              toast(n === 1 ? `Instalé el archivo 1${where}.` : `Instalé ${n} archivos${where}.`, 'success');
              if (fromModrinth) toast(fromModrinth === 1 ? 'Detecté que 1 archivo viene de Modrinth.' : `Detecté que ${fromModrinth} archivos vienen de Modrinth.`, 'success');
              for (const bad of incompatible) toast(`${bad.name}: ${bad.reason}`, 'error');
              await loadContent();
            } else {
              toast('Ningún archivo era válido: solo se aceptan .jar y .zip.', 'error');
            }
          } catch (e) { if (busy) busy.close(0); toast(e.message, 'error'); }
        }
      }, icon('file', 18), 'Subir archivos locales…'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-accent', type: 'button', text: 'Listo', onclick: () => m.close() })
    ]
  });
}

// Buscador de Modrinth para el perfil que devuelva getId().
function contentBrowser(getId) {
  let type = 'mod';
  let offset = 0;
  let total = 0;
  let timer = null;
  const installing = new Set();
  const installed = new Set();

  const root = h('div', { class: 'browser' });
  const search = h('input', { type: 'text', class: 'input', placeholder: 'Buscar en Modrinth…', spellcheck: 'false' });
  const seg = h('div', { class: 'seg' });
  const note = h('div', { class: 'muted small browser-note' });
  const results = h('div', { class: 'result-list' });
  const more = h('button', { class: 'btn btn-dark btn-block hidden', type: 'button', text: 'Cargar más', onclick: () => run(true) });

  function drawSeg() {
    seg.textContent = '';
    [['mod', 'Mods'], ['resourcepack', 'Paquetes de recursos']].forEach(([id, label]) => seg.append(h('button', {
      class: `seg-btn${type === id ? ' active' : ''}`, type: 'button',
      onclick: () => { type = id; drawSeg(); run(false); }
    }, label)));
  }

  async function run(append) {
    const id = getId();
    const p = profileById(id);
    if (!p) return;
    note.textContent = `Mostrando contenido para Minecraft ${p.mc}${p.loader === 'fabric' && type === 'mod' ? ' · Fabric' : ''}.`;
    if (!append) { offset = 0; results.textContent = ''; results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Buscando…' }))); }
    try {
      const r = await call(window.launcher.searchContent(id, { query: search.value.trim(), type, offset }));
      if (id !== getId()) return;
      total = r.total;
      if (!append) results.textContent = '';
      if (!r.hits.length && !append) results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'No se encontró nada para esa versión.' })));
      r.hits.forEach((hit) => results.append(resultRow(hit, p)));
      offset += r.hits.length;
      more.classList.toggle('hidden', offset >= total || !r.hits.length);
    } catch (e) {
      results.textContent = '';
      results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: `No se pudo buscar: ${e.message}` })));
    }
  }

  function resultRow(hit, p) {
    const btn = h('button', { class: 'btn btn-green btn-small', type: 'button' });
    const label = () => {
      const done = hit.installed || installed.has(hit.projectId);
      btn.textContent = installing.has(hit.projectId) ? 'Instalando…' : done ? 'Instalado' : 'Instalar';
      btn.disabled = installing.has(hit.projectId) || done;
    };
    label();
    btn.addEventListener('click', async () => {
      installing.add(hit.projectId);
      label();
      try {
        const names = await call(window.launcher.installContent(p.id, hit.projectId, hit.type));
        installed.add(hit.projectId);
        toast(names.length > 1 ? `${hit.title} instalado (+${names.length - 1} dependencia/s).` : `${hit.title} instalado.`);
        notify(`${hit.title} instalado en ${p.name}.`);
        if (state.view === 'detail' && detail.id === p.id) loadContent();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        installing.delete(hit.projectId);
        label();
      }
    });
    return h('div', { class: 'result-row' },
      hit.icon ? h('img', { class: 'c-icon', src: hit.icon, alt: '', width: 48, height: 48 }) : h('span', { class: 'c-icon ph' }, icon('cube', 24)),
      h('div', { class: 'grow' },
        h('strong', { text: hit.title }),
        h('span', { class: 'muted small', text: ` by ${hit.author}` }),
        h('p', { class: 'muted small clamp', text: hit.description })),
      h('span', { class: 'muted small downloads' }, icon('download', 14), formatCount(hit.downloads)),
      btn);
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(false), 350); });
  drawSeg();
  root.append(h('div', { class: 'browser-bar' }, seg, h('label', { class: 'search-box grow' }, icon('search', 18), search)), note, results, more);
  run(false);
  return root;
}

// ───────────────────────── Mundos ─────────────────────────

async function renderWorldsTab(panel, p) {
  panel.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Cargando mundos…' })));
  try {
    const worlds = await call(window.launcher.listWorlds(p.id));
    if (detail.tab !== 'worlds' || detail.id !== p.id) return;
    panel.textContent = '';
    if (!worlds.length) {
      panel.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Este perfil todavía no tiene mundos de un jugador.' })));
      return;
    }
    for (const w of worlds) {
      panel.append(h('div', { class: 'world-row' },
        w.icon ? h('img', { class: 'c-icon', src: w.icon, alt: '', width: 48, height: 48 }) : h('span', { class: 'c-icon ph' }, icon('globe', 24)),
        h('div', { class: 'grow' }, h('strong', { text: w.name }), h('span', { class: 'muted small', text: timeAgo(w.lastPlayed) })),
        h('button', { class: 'btn btn-dark btn-small', type: 'button', text: 'Abrir carpeta', onclick: () => call(window.launcher.openWorld(p.id, w.name)).catch((e) => toast(e.message, 'error')) })));
    }
  } catch (e) {
    panel.textContent = '';
    panel.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: e.message })));
  }
}

// ───────────────────────── Registros ─────────────────────────

async function renderLogsTab(panel, p) {
  const pre = h('pre', { class: 'log small-log', tabindex: '0', text: 'Cargando…' });
  const reload = async () => {
    try {
      const text = await call(window.launcher.readLog(p.id));
      pre.textContent = text || 'Este perfil todavía no generó registros. Se crean la primera vez que jugás.';
      pre.scrollTop = pre.scrollHeight;
    } catch (e) { pre.textContent = e.message; }
  };
  panel.append(
    h('div', { class: 'content-toolbar' },
      h('button', { class: 'btn btn-dark', type: 'button', onclick: reload }, icon('sync', 18), 'Actualizar'),
      h('button', {
        class: 'btn btn-dark', type: 'button',
        onclick: async () => { try { await navigator.clipboard.writeText(pre.textContent); toast('Registro copiado.'); } catch { toast('No se pudo copiar.', 'error'); } }
      }, icon('copy', 18), 'Copiar')),
    pre);
  reload();
}

// ───────────────────────── Ajustes del perfil ─────────────────────────

function renderSettingsTab(panel, p) {
  const save = async (patch) => {
    try { await call(window.launcher.updateProfile(p.id, patch)); await loadProfiles(); } catch (e) { toast(e.message, 'error'); }
  };

  const name = h('input', { type: 'text', class: 'input', value: p.name, spellcheck: 'false', maxlength: 60 });
  name.addEventListener('change', () => save({ name: name.value }));

  const maxRam = Math.max(2, Math.min(32, (state.info?.totalRamGB || 8) - 2));
  const global = !p.ramGB;
  const ramVal = h('strong', { text: `${p.ramGB || state.settings.ramGB} GB` });
  const range = h('input', { type: 'range', min: 1, max: maxRam, step: 1, value: Math.min(p.ramGB || state.settings.ramGB, maxRam) });
  range.disabled = global;
  range.addEventListener('input', () => { ramVal.textContent = `${range.value} GB`; });
  range.addEventListener('change', () => save({ ramGB: Number(range.value) }));
  const useGlobal = toggle(global, (v) => {
    range.disabled = v;
    ramVal.textContent = `${v ? state.settings.ramGB : range.value} GB`;
    save({ ramGB: v ? null : Number(range.value) });
  }, 'Usar la memoria global');

  const jvm = h('input', { type: 'text', class: 'input', value: p.jvmArgs || '', placeholder: 'Ej: -XX:+UseG1GC (opcional)', spellcheck: 'false' });
  jvm.addEventListener('change', () => save({ jvmArgs: jvm.value.trim() }));

  const fabricOnly = p.loader === 'fabric';
  panel.append(
    h('div', { class: 'card wide' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Nombre del perfil' }), name),
      h('div', { class: 'row-between' },
        h('div', {}, h('span', { class: 'field-label', text: 'Versión' }), h('div', { text: `${p.loaderLabel} ${p.mc}` })),
        h('button', { class: 'btn btn-dark', type: 'button', text: 'Cambiar versión', onclick: () => changeVersion(p) }))),
    h('div', { class: 'card wide' },
      h('div', { class: 'row-between' }, h('span', { class: 'field-label', text: 'Memoria RAM de este perfil' }), ramVal),
      range,
      h('label', { class: 'switch-line' }, useGlobal, h('span', { text: `Usar la memoria global (${state.settings.ramGB} GB)` })),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Argumentos extra de Java' }), jvm)),
    h('div', { class: 'card wide' },
      h('label', { class: 'switch-line' },
        toggle(p.nova, (v) => save({ nova: v }), 'Nova Client'),
        h('span', {}, h('strong', { text: 'Jugar con Nova Client' }), h('span', { class: 'muted small block', text: fabricOnly ? 'HUD, amigos, zoom y más dentro del juego.' : 'Necesita un perfil de Fabric.' }))),
      h('label', { class: 'switch-line' },
        toggle(p.fabricApi !== false, (v) => save({ fabricApi: v }), 'Fabric API'),
        h('span', {}, h('strong', { text: 'Instalar Fabric API' }), h('span', { class: 'muted small block', text: 'La mayoría de los mods de Fabric la necesitan.' })))),
    h('div', { class: 'card wide danger-card' },
      h('div', { class: 'row-between' },
        h('div', {}, h('strong', { text: 'Eliminar perfil' }), h('p', { class: 'muted small', text: 'Borra el perfil con sus mods y mundos.' })),
        h('button', { class: 'btn btn-danger', type: 'button', text: 'Eliminar…', onclick: () => deleteProfile(p) })))
  );
  if (!fabricOnly) panel.querySelectorAll('.switch-line .sw-input').forEach((i) => { i.disabled = true; });
}

// ───────────────────────── Compartir ─────────────────────────

function shareView(p) {
  const code = h('textarea', { class: 'code-box', readonly: true, rows: 5, placeholder: 'Generá un código para compartir este perfil.' });
  return h('div', { class: 'share-view' },
    h('p', { class: 'muted small', text: 'El código incluye la versión, el cargador y el contenido que viene de Modrinth. No incluye mundos ni mods locales.' }),
    code,
    h('div', { class: 'content-toolbar' },
      h('button', {
        class: 'btn btn-accent', type: 'button',
        onclick: async () => {
          try { code.value = await call(window.launcher.shareProfile(p.id)); toast('Código copiado al portapapeles.'); } catch (e) { toast(e.message, 'error'); }
        }
      }, icon('copy', 18), 'Generar y copiar código'),
      h('button', { class: 'btn btn-dark', type: 'button', onclick: () => exportProfile(p) }, icon('export', 18), 'Exportar a archivo…')));
}

function renderShareTab(panel, p) {
  panel.append(h('div', { class: 'card wide' }, h('h3', { class: 'card-title', text: 'Compartir perfil' }), shareView(p)));
}
