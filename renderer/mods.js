'use strict';

// Página «Modificaciones» (estilo Dawn): pestañas por tipo, buscador, filtros laterales,
// carrusel de tendencias, lista de resultados con botón INSTALAR y paginación.
// Todo sale de Modrinth a través del proceso principal (content:browse). Se instala en el perfil elegido arriba.

const MODS_TABS = [
  ['mod', 'Modificaciones'],
  ['modpack', 'Paquetes de modificaciones'],
  ['resourcepack', 'Paquetes de recursos'],
  ['shader', 'Paquetes de sombreadores']
];

const MODS_LOADERS = [['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt']];

const MODS_CATS = {
  mod: ['adventure', 'cursed', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'management', 'minigame', 'mobs', 'optimization', 'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen'],
  modpack: ['adventure', 'challenging', 'combat', 'kitchen-sink', 'lightweight', 'magic', 'multiplayer', 'optimization', 'quests', 'technology'],
  resourcepack: ['8x-', '16x', '32x', '48x', '64x', '128x', '256x', '512x+', 'audio', 'blocks', 'combat', 'decoration', 'entities', 'environment', 'equipment', 'fonts', 'gui', 'items', 'locale', 'models', 'realistic', 'simplistic', 'themed', 'tweaks', 'utility', 'vanilla-like'],
  shader: ['atmosphere', 'bloom', 'cartoon', 'colored-lighting', 'cursed', 'fantasy', 'foliage', 'path-tracing', 'pbr', 'realistic', 'reflections', 'semi-realistic', 'shadows', 'vanilla-like']
};

const MODS_SORTS = [['relevance', 'Relevancia'], ['downloads', 'Descargas'], ['follows', 'Me gusta'], ['newest', 'Más nuevos'], ['updated', 'Actualizados']];

const mods = {
  type: 'mod',
  query: '',
  sort: 'relevance',
  limit: 20,
  page: 1,
  total: 0,
  versions: new Set(),
  loaders: new Set(),
  cats: new Set(),
  profileId: '',
  req: 0,
  trend: {},
  installing: new Set(),
  installed: new Set(),
  timer: null,
  el: {}
};

// ───────────────────────── Formatos ─────────────────────────

function modsCount(n) {
  n = Number(n) || 0;
  const f = (v, s) => `${v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, '').replace('.', ',')}${s}`;
  if (n >= 1e9) return f(n / 1e9, ' mil M');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'K');
  return String(n);
}

function modsDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' ');
}

const modsCatLabel = (c) => c.replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase());

// ───────────────────────── Instalar ─────────────────────────

async function modsInstall(hit, btn, label) {
  if (hit.type === 'modpack') {
    call(window.launcher.openExternal(`https://modrinth.com/modpack/${encodeURIComponent(hit.slug || hit.projectId)}`)).catch((e) => toast(e.message, 'error'));
    return;
  }
  const p = profileById(mods.profileId);
  if (!p) { toast('Primero creá un perfil para poder instalar.', 'error'); return; }
  mods.installing.add(hit.projectId);
  label();
  try {
    const names = await call(window.launcher.installContent(p.id, hit.projectId, hit.type));
    mods.installed.add(`${p.id}:${hit.projectId}`);
    toast(names.length > 1 ? `${hit.title} instalado (+${names.length - 1} dependencia/s).` : `${hit.title} instalado.`);
    notify(`${hit.title} instalado en ${p.name}.`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    mods.installing.delete(hit.projectId);
    label();
  }
}

// Botón INSTALAR (verde). `small` = botón cuadrado de las tarjetas de tendencias.
function modsInstallButton(hit, small) {
  const btn = h('button', { class: small ? 'mi-btn small' : 'mi-btn', type: 'button' });
  const label = () => {
    const key = `${mods.profileId}:${hit.projectId}`;
    const busy = mods.installing.has(hit.projectId);
    const done = hit.type !== 'modpack' && (hit.installed || mods.installed.has(key));
    btn.disabled = busy || done;
    btn.title = hit.type === 'modpack' ? 'Abrir en Modrinth' : done ? 'Ya instalado' : 'Instalar';
    btn.replaceChildren(icon(hit.type === 'modpack' ? 'link' : done ? 'check' : 'download', small ? 18 : 20));
    if (!small) btn.append(busy ? 'INSTALANDO…' : hit.type === 'modpack' ? 'VER' : done ? 'INSTALADO' : 'INSTALAR');
  };
  label();
  btn.addEventListener('click', (e) => { e.stopPropagation(); modsInstall(hit, btn, label); });
  return btn;
}

// ───────────────────────── Piezas ─────────────────────────

function modsIcon(hit, size) {
  return hit.icon
    ? h('img', { class: 'mr-icon', src: hit.icon, alt: '', width: size, height: size, draggable: 'false' })
    : h('span', { class: 'mr-icon ph', style: { width: `${size}px`, height: `${size}px` } }, icon('cube', Math.round(size / 2)));
}

function modsRow(hit) {
  return h('div', { class: 'mr-row' },
    modsIcon(hit, 64),
    h('div', { class: 'mr-main' },
      h('div', { class: 'mr-title' }, h('strong', { text: hit.title }), h('span', { class: 'mr-by', text: `by ${hit.author}` })),
      h('p', { class: 'mr-desc', text: hit.description })),
    h('div', { class: 'mr-stat' }, icon('download', 16), `${modsCount(hit.downloads)} descargas`),
    h('div', { class: 'mr-stat' }, icon('heart', 16), `${modsCount(hit.follows)} me gusta`),
    h('div', { class: 'mr-stat date' }, icon('clock', 16), `Actualizado ${modsDate(hit.updated)}`),
    modsInstallButton(hit, false));
}

function modsTrendCard(hit, i) {
  const first = i === 0;
  return h('div', { class: `tc${first ? ' first' : ''}` },
    h('span', { class: 'tc-rank', text: `#${i + 1}` }),
    modsIcon(hit, first ? 72 : 64),
    h('strong', { class: 'tc-title', text: hit.title }),
    h('span', { class: 'tc-sub' }, icon('user', 14), `${modsCount(hit.downloads)} descargas`),
    modsInstallButton(hit, !first));
}

// ───────────────────────── Filtros ─────────────────────────

function modsFilterSection(title, items, selected, onChange) {
  const list = h('div', { class: 'mf-list' });
  for (const [value, label] of items) {
    const input = h('input', { type: 'checkbox' });
    input.checked = selected.has(value);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(value); else selected.delete(value);
      onChange();
    });
    list.append(h('label', { class: 'mf-row' }, input, h('span', { class: 'mf-box' }, icon('check', 12)), h('span', { text: label })));
  }
  return h('div', { class: 'mf-section' }, h('div', { class: 'mf-title', text: title }), list);
}

function modsDrawFilters() {
  const box = mods.el.filters;
  box.textContent = '';
  const again = () => { mods.page = 1; modsRun(); };

  const versions = (state.versions || []).filter((v) => v.type === 'release').map((v) => [v.id, v.id]);
  // Si el perfil usa una versión que no está en la lista, igual se ofrece.
  const p = profileById(mods.profileId);
  if (p && !versions.some(([id]) => id === p.mc)) versions.unshift([p.mc, p.mc]);

  box.append(
    h('div', { class: 'mf-head' }, h('h3', { text: 'Filtros' }),
      h('button', { class: 'mf-clear', type: 'button', text: 'Limpiar', onclick: () => { mods.versions.clear(); mods.loaders.clear(); mods.cats.clear(); modsDrawFilters(); again(); } })),
    modsFilterSection('Versión del juego', versions, mods.versions, again));
  if (mods.type === 'mod' || mods.type === 'modpack') box.append(modsFilterSection('Cargador de mods', MODS_LOADERS, mods.loaders, again));
  box.append(modsFilterSection('Categoría', MODS_CATS[mods.type].map((c) => [c, modsCatLabel(c)]), mods.cats, again));
}

// ───────────────────────── Datos ─────────────────────────

function modsFilterPayload() {
  return { versions: [...mods.versions], loaders: [...mods.loaders], categories: [...mods.cats] };
}

async function modsRun() {
  const my = ++mods.req;
  const { results } = mods.el;
  results.textContent = '';
  results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'Buscando…' })));
  try {
    const r = await call(window.launcher.browseContent({
      query: mods.query, type: mods.type, sort: mods.sort, limit: mods.limit,
      offset: (mods.page - 1) * mods.limit, profileId: mods.profileId, ...modsFilterPayload()
    }));
    if (my !== mods.req) return;
    mods.total = r.total;
    results.textContent = '';
    if (!r.hits.length) results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: 'No se encontró nada con esos filtros.' })));
    r.hits.forEach((hit) => results.append(modsRow(hit)));
    results.scrollTop = 0;
  } catch (e) {
    if (my !== mods.req) return;
    mods.total = 0;
    results.textContent = '';
    results.append(h('div', { class: 'empty-card' }, h('span', { class: 'muted', text: `No se pudo buscar: ${e.message}` })));
  }
  modsDrawPager();
}

function modsPages() {
  // Modrinth no entrega resultados más allá de los primeros 10 000.
  return Math.max(1, Math.min(Math.ceil(mods.total / mods.limit), Math.floor(10000 / mods.limit)));
}

function modsDrawPager() {
  const pages = modsPages();
  const go = (n) => { mods.page = Math.max(1, Math.min(pages, n)); modsRun(); };
  const btn = (text, to, disabled, title) => h('button', { class: 'mp-btn', type: 'button', text, title, disabled, onclick: () => go(to) });
  mods.el.total.textContent = `${mods.total.toLocaleString('es-AR')} resultados`;
  mods.el.pager.replaceChildren(
    btn('«', 1, mods.page <= 1, 'Primera'),
    btn('‹', mods.page - 1, mods.page <= 1, 'Anterior'),
    h('span', { class: 'mp-page', text: `${mods.page} / ${pages.toLocaleString('es-AR')}` }),
    btn('›', mods.page + 1, mods.page >= pages, 'Siguiente'),
    btn('»', pages, mods.page >= pages, 'Última'));
}

async function modsLoadTrending() {
  const type = mods.type;
  const strip = mods.el.trendStrip;
  const draw = (hits) => {
    if (type !== mods.type) return;
    strip.textContent = '';
    hits.forEach((hit, i) => strip.append(modsTrendCard(hit, i)));
    mods.el.trend.classList.toggle('hidden', !hits.length);
  };
  if (mods.trend[type]) { draw(mods.trend[type]); return; }
  try {
    const r = await call(window.launcher.browseContent({ type, sort: 'follows', limit: 7, offset: 0, profileId: mods.profileId }));
    mods.trend[type] = r.hits;
    draw(r.hits);
  } catch {
    if (type === mods.type) mods.el.trend.classList.add('hidden'); // sin red: se oculta, la lista muestra el error
  }
}

// ───────────────────────── Perfil de destino ─────────────────────────

function modsPickProfile(id, applyDefaults) {
  mods.profileId = id;
  const p = profileById(id);
  if (applyDefaults) {
    mods.versions.clear();
    mods.loaders.clear();
    if (p) {
      mods.versions.add(p.mc);
      if (MODS_LOADERS.some(([l]) => l === p.loader)) mods.loaders.add(p.loader);
    }
  }
}

function modsSyncProfiles() {
  const sel = mods.el.profile;
  sel.textContent = '';
  if (!state.profiles.length) {
    sel.append(h('option', { value: '', text: 'Sin perfiles' }));
    sel.disabled = true;
    mods.profileId = '';
    return;
  }
  sel.disabled = false;
  state.profiles.forEach((p) => sel.append(h('option', { value: p.id, text: `${p.name} (${p.loaderLabel} ${p.mc})` })));
  if (!profileById(mods.profileId)) modsPickProfile(lastProfile()?.id || state.profiles[0].id, true);
  sel.value = mods.profileId;
}

// ───────────────────────── Montaje ─────────────────────────

function buildMods(root) {
  const profile = h('select', { class: 'mods-select', 'aria-label': 'Instalar en el perfil' });
  profile.addEventListener('change', () => {
    modsPickProfile(profile.value, true);
    modsDrawFilters();
    mods.page = 1;
    modsRun();
  });

  const head = h('div', { class: 'mods-head' },
    h('h2', { text: 'Modificaciones' }),
    h('div', { class: 'mods-head-right' },
      h('label', { class: 'mods-target' }, h('span', { text: 'Instalar en' }), profile),
      h('div', { class: 'mods-platform' },
        h('span', { class: 'mp-chip on' }, 'Java', h('i', { class: 'mp-tick' }, icon('check', 14))),
        h('span', { class: 'mp-chip off', title: 'Próximamente' }, 'Bedrock'))));

  const tabs = h('div', { class: 'mods-tabs', role: 'tablist' });
  const drawTabs = () => {
    tabs.textContent = '';
    for (const [id, label] of MODS_TABS) {
      tabs.append(h('button', {
        class: `mods-tab${mods.type === id ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(mods.type === id), text: label,
        onclick: () => {
          if (mods.type === id) return;
          mods.type = id; mods.cats.clear(); mods.page = 1;
          if (id === 'mod' || id === 'modpack') {
            const p = profileById(mods.profileId);
            if (!mods.loaders.size && p && MODS_LOADERS.some(([l]) => l === p.loader)) mods.loaders.add(p.loader);
          } else {
            mods.loaders.clear();
          }
          drawTabs(); modsDrawFilters(); modsRun(); modsLoadTrending();
        }
      }));
    }
  };

  const search = h('input', { type: 'text', placeholder: 'Buscar modificaciones', spellcheck: 'false' });
  search.addEventListener('input', () => {
    clearTimeout(mods.timer);
    mods.timer = setTimeout(() => { mods.query = search.value.trim(); mods.page = 1; modsRun(); }, 350);
  });
  const top = h('div', { class: 'mods-top' }, tabs, h('label', { class: 'mods-search' }, icon('search', 20), search));

  const filters = h('aside', { class: 'mods-filters' });

  const sort = h('select', { class: 'mods-select', 'aria-label': 'Ordenar por' }, MODS_SORTS.map(([v, l]) => h('option', { value: v, text: l })));
  sort.addEventListener('change', () => { mods.sort = sort.value; mods.page = 1; modsRun(); });
  const limit = h('select', { class: 'mods-select', 'aria-label': 'Resultados por página' }, [10, 20, 30, 50].map((n) => h('option', { value: String(n), text: String(n) })));
  limit.value = String(mods.limit);
  limit.addEventListener('change', () => { mods.limit = Number(limit.value); mods.page = 1; modsRun(); });
  const total = h('span', { class: 'mods-total' });
  const pager = h('div', { class: 'mods-pager' });
  const bar = h('div', { class: 'mods-bar' }, sort, limit, total, h('span', { class: 'spacer' }), pager);

  const strip = h('div', { class: 'mods-strip' });
  const trend = h('section', { class: 'mods-trend hidden' },
    h('div', { class: 'mods-trend-head' }, h('strong', { text: 'Tendencias' }),
      h('span', { class: 'mods-trend-nav' },
        h('button', { class: 'mp-btn', type: 'button', 'aria-label': 'Anterior', text: '‹', onclick: () => strip.scrollBy({ left: -420, behavior: 'smooth' }) }),
        h('button', { class: 'mp-btn', type: 'button', 'aria-label': 'Siguiente', text: '›', onclick: () => strip.scrollBy({ left: 420, behavior: 'smooth' }) }))),
    strip);

  const results = h('div', { class: 'mods-results' });
  const main = h('div', { class: 'mods-main' }, bar, trend, results);

  root.textContent = '';
  root.append(head, top, h('div', { class: 'mods-grid' }, filters, main));
  Object.assign(mods.el, { root, profile, filters, results, total, pager, trend, trendStrip: strip });
  drawTabs();
}

function renderMods() {
  const root = els.views.browse;
  if (!mods.el.root) buildMods(root);
  modsSyncProfiles();
  modsDrawFilters();
  modsRun();
  modsLoadTrending();
}
