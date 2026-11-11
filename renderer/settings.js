'use strict';

// Ventana de configuración (generales, apariencia, rendimiento, Java y memoria, ventana del juego,
// acerca de, legal y zona de peligro) y registro de cambios.

const ACCENTS = {
  orange: { label: 'Naranja', a: '#ff8a2b', b: '#e8590c', c: '#ffb02e', rgb: '255,122,26' },
  blue: { label: 'Azul', a: '#4aa3ff', b: '#1f6fe0', c: '#8cc8ff', rgb: '59,139,240' },
  purple: { label: 'Violeta', a: '#a78bfa', b: '#7c3aed', c: '#c9b8ff', rgb: '139,92,246' },
  pink: { label: 'Rosa', a: '#ff6fae', b: '#e0357f', c: '#ffa3cc', rgb: '240,80,150' },
  teal: { label: 'Turquesa', a: '#2dd4bf', b: '#0e9488', c: '#7ae8d9', rgb: '20,184,166' }
};

function applyAppearance(s) {
  const a = ACCENTS[s.accent] || ACCENTS.orange;
  const root = document.documentElement;
  root.style.setProperty('--orange', a.a);
  root.style.setProperty('--accent-a', a.a);
  root.style.setProperty('--accent-b', a.b);
  root.style.setProperty('--orange-2', a.c);
  root.style.setProperty('--accent-rgb', a.rgb);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
}

let updateTextEl = null;
function setUpdateText(t) { if (updateTextEl) updateTextEl.textContent = t; }

const CHANGELOG = [
  ['1.1.0', [
    'Perfiles: cada perfil tiene su propia carpeta, versión, mods y mundos.',
    'Detalle de perfil con contenido, mundos, registros, ajustes y compartir.',
    'Buscador de mods y paquetes de recursos de Modrinth con dependencias.',
    'Mods de rendimiento (Sodium, Lithium, FerriteCore…) con un interruptor.',
    'Selector de cargador, exportar / importar perfiles y códigos para compartir.',
    'Servidores guardados con entrada directa.',
    'Nueva ventana de configuración y colores de acento.',
    'Nova Client: menú de mods con búsqueda y favoritos, perfiles de mods, editor de HUD y módulos nuevos.'
  ]],
  ['1.0.0', ['Primera versión: launcher, Nova Client dentro del juego, Discord y actualizaciones.']]
];

function openChangelog() {
  const m = modal({
    title: 'Registro de cambios',
    icon: 'list',
    body: CHANGELOG.map(([v, items]) => h('div', { class: 'cl-block' }, h('strong', { text: `v${v}` }), h('ul', { class: 'plain-list' }, items.map((i) => h('li', { text: i }))))),
    footer: [h('button', { class: 'btn btn-accent', type: 'button', text: 'Cerrar', onclick: () => m.close() })]
  });
}

const SETTINGS_NAV = [
  ['LAUNCHER', [['general', 'generales', 'settings'], ['appearance', 'Apariencia', 'palette'], ['performance', 'Rendimiento', 'cpu']]],
  ['JUEGO', [['java', 'Java y Memoria', 'memory'], ['window', 'Ventana del juego', 'monitor']]],
  ['INFORMACIÓN', [['about', 'Acerca de Nova', 'info'], ['legal', 'Legal y Datos', 'file']]],
  ['AVANZADO', [['danger', 'Zona de peligro', 'alarm']]]
];

let settingsModal = null;

async function saveSetting(patch) {
  try {
    state.settings = await call(window.launcher.setSettings(patch));
    applyAppearance(state.settings);
    renderInstallInfo();
  } catch (e) { toast(e.message, 'error'); }
  return state.settings;
}

function openSettings(section) {
  if (settingsModal) settingsModal.close();
  let current = section || 'general';
  const content = h('div', { class: 'settings-content' });
  const nav = h('div', { class: 'settings-nav' });
  const searchInput = h('input', { type: 'text', placeholder: 'Buscar ajustes', spellcheck: 'false' });
  const foot = h('div', { class: 'settings-foot' },
    h('span', { class: 'muted tiny', text: `Nova Launcher ${state.info.version}` }),
    h('button', { class: 'btn btn-dark btn-block', type: 'button', text: 'REGISTRO DE CAMBIOS', onclick: openChangelog }),
    h('button', {
      class: 'btn btn-green btn-block', type: 'button', text: 'EXPORTAR DEPURACIÓN',
      onclick: async () => {
        try { const f = await call(window.launcher.exportDebug()); if (f) toast('Archivo de depuración guardado.'); } catch (e) { toast(e.message, 'error'); }
      }
    }));

  function drawNav() {
    const q = searchInput.value.trim().toLowerCase();
    nav.textContent = '';
    for (const [group, items] of SETTINGS_NAV) {
      const shown = items.filter(([, label]) => !q || label.toLowerCase().includes(q));
      if (!shown.length) continue;
      nav.append(h('div', { class: 'nav-group', text: group }));
      for (const [id, label, ico] of shown) {
        nav.append(h('button', {
          class: `nav-item${current === id ? ' active' : ''}${id === 'danger' ? ' danger' : ''}`, type: 'button',
          onclick: () => { current = id; drawNav(); drawContent(); }
        }, icon(ico, 18), label));
      }
    }
  }
  searchInput.addEventListener('input', drawNav);

  function drawContent() {
    content.textContent = '';
    const s = state.settings;
    const sec = SECTIONS[current];
    content.append(h('h2', { text: SETTINGS_NAV.flatMap(([, i]) => i).find(([id]) => id === current)[1] }), h('p', { class: 'muted small', text: sec.desc }));
    content.append(sec.build(s));
  }

  settingsModal = modal({
    title: 'Configuración de Nova',
    icon: 'settings',
    wide: true,
    className: 'settings-box',
    body: [h('div', { class: 'settings-grid' },
      h('div', { class: 'settings-side' }, h('label', { class: 'search-box wide' }, icon('search', 18), searchInput), nav, foot),
      content)],
    onClose: () => { settingsModal = null; updateTextEl = null; }
  });
  drawNav();
  drawContent();
}

// ── Piezas de formulario ──
function setting(title, desc, control) {
  return h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('strong', { text: title }), desc ? h('span', { class: 'muted small block', text: desc }) : null), control);
}

function selectBox(options, value, onchange) {
  const sel = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, text: l })));
  sel.value = value;
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}

function numberBox(value, onchange, placeholder) {
  const i = h('input', { type: 'text', class: 'input num', value: value || '', placeholder: placeholder || '', inputmode: 'numeric', spellcheck: 'false' });
  i.addEventListener('change', () => onchange(Math.max(0, parseInt(i.value, 10) || 0)));
  return i;
}

const SECTIONS = {
  general: {
    desc: 'Configuración principal y comportamiento básico del launcher.',
    build: (s) => h('div', { class: 'settings-list' },
      setting('Idioma', 'Por ahora el launcher está en español.', selectBox([['es', 'Español (Argentina)']], 'es', () => {})),
      setting('Abrir al iniciar', 'Abre Nova cuando arrancás Windows (solo en la app instalada).', toggle(s.openAtLogin, (v) => saveSetting({ openAtLogin: v }), 'Abrir al iniciar')),
      setting('Al abrir con Windows', 'Dónde aparece Nova cuando arranca solo.', selectBox([['tray', 'Bandeja del sistema'], ['window', 'Ventana']], s.startMode, (v) => saveSetting({ startMode: v }))),
      setting('Guardar informes de errores', 'Los errores inesperados quedan en un archivo local (no se envía nada).', toggle(s.sendErrorReports, (v) => saveSetting({ sendErrorReports: v }), 'Informes de errores')))
  },
  appearance: {
    desc: 'Colores y animaciones de la interfaz.',
    build: (s) => {
      const row = h('div', { class: 'swatches' });
      const draw = () => {
        row.textContent = '';
        for (const [id, a] of Object.entries(ACCENTS)) {
          const b = h('button', { class: `swatch${(state.settings.accent || 'orange') === id ? ' active' : ''}`, type: 'button', title: a.label, 'aria-label': a.label });
          b.style.background = `linear-gradient(135deg, ${a.a}, ${a.b})`;
          b.addEventListener('click', async () => { await saveSetting({ accent: id }); draw(); });
          row.append(b);
        }
      };
      draw();
      return h('div', { class: 'settings-list' },
        setting('Color de acento', 'Cambia los botones y resaltados.', row),
        setting('Reducir animaciones', 'Desactiva transiciones y movimientos.', toggle(s.reduceMotion, (v) => saveSetting({ reduceMotion: v }), 'Reducir animaciones')));
    }
  },
  performance: {
    desc: 'Cómo se dibuja el launcher y cuánto trabaja mientras jugás.',
    build: (s) => h('div', {},
      h('div', { class: 'set-label', text: 'Renderizado del launcher' }),
      h('div', { class: 'settings-list two' },
        setting('Aceleración por hardware', 'Usa la GPU para dibujar el launcher. Se aplica al reiniciar Nova.', toggle(s.hwAccel !== false, (v) => saveSetting({ hwAccel: v }), 'Aceleración por hardware')),
        setting('Ocultar el launcher mientras juego', 'Se vuelve a mostrar al cerrar Minecraft.', toggle(s.closeOnLaunch, (v) => saveSetting({ closeOnLaunch: v }), 'Ocultar launcher'))))
  },
  java: {
    desc: 'Memoria y Java para todos los perfiles (cada perfil puede tener la suya).',
    build: (s) => {
      const max = Math.max(2, Math.min(32, state.info.totalRamGB - 2));
      const val = h('strong', { text: `${Math.min(s.ramGB, max)} GB` });
      const range = h('input', { type: 'range', min: 1, max, step: 1, value: Math.min(s.ramGB, max) });
      range.addEventListener('input', () => { val.textContent = `${range.value} GB`; });
      range.addEventListener('change', () => saveSetting({ ramGB: Number(range.value) }));
      const java = h('input', { type: 'text', class: 'input', value: s.javaPath || '', placeholder: 'Vacío = Nova descarga el Java correcto', spellcheck: 'false' });
      java.addEventListener('change', () => saveSetting({ javaPath: java.value.trim() }));
      const args = h('input', { type: 'text', class: 'input', value: s.jvmArgs || '', placeholder: 'Ej: -XX:+UseG1GC', spellcheck: 'false' });
      args.addEventListener('change', () => saveSetting({ jvmArgs: args.value.trim() }));
      return h('div', { class: 'settings-list' },
        h('div', { class: 'setting col' }, h('div', { class: 'row-between' }, h('strong', { text: 'Memoria RAM' }), val), range, h('span', { class: 'muted small', text: `Tu PC tiene ${state.info.totalRamGB} GB. Para la mayoría de versiones, 3–4 GB alcanzan.` })),
        h('div', { class: 'setting col' }, h('strong', { text: 'Ruta de Java (opcional)' }), java),
        h('div', { class: 'setting col' }, h('strong', { text: 'Argumentos extra de Java' }), args));
    }
  },
  window: {
    desc: 'Tamaño de la ventana de Minecraft al abrirse.',
    build: (s) => h('div', { class: 'settings-list' },
      setting('Pantalla completa', null, toggle(s.fullscreen, (v) => saveSetting({ fullscreen: v }), 'Pantalla completa')),
      setting('Ancho (píxeles)', '0 = tamaño por defecto', numberBox(s.winWidth, (v) => saveSetting({ winWidth: v }), '0')),
      setting('Alto (píxeles)', '0 = tamaño por defecto', numberBox(s.winHeight, (v) => saveSetting({ winHeight: v }), '0')))
  },
  about: {
    desc: 'Versión e información de esta instalación.',
    build: () => {
      const upd = h('p', { class: 'muted small', text: 'El launcher y Nova Client se actualizan solos.' });
      updateTextEl = upd;
      const btn = h('button', { class: 'btn btn-dark', type: 'button', text: 'Buscar ahora' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        upd.textContent = 'Buscando actualizaciones…';
        try {
          const r = await call(window.launcher.checkUpdates());
          if (!r.mods.length && r.launcher === 'unsupported') {
            upd.textContent = state.info.canAutoUpdate ? 'Estás en la última versión.' : 'Las actualizaciones automáticas funcionan en la app instalada (no en modo desarrollo).';
          }
        } catch (e) { upd.textContent = `No se pudo buscar: ${e.message}`; } finally { btn.disabled = false; }
      });
      const i = state.info;
      return h('div', { class: 'settings-list' },
        setting('Nova Client', `Versión ${i.version} · Electron ${i.electron} · Node ${i.node}`, null),
        setting('Mods de Nova disponibles', i.novaVersions.length ? i.novaVersions.join(', ') : 'Ninguno todavía: se bajan solos la primera vez que jugás cada versión.', null),
        setting('Actualizaciones', null, btn), upd,
        setting('Carpeta del juego', i.gameDir, h('button', { class: 'btn btn-dark', type: 'button', text: 'Abrir', onclick: () => window.launcher.openFolder() })));
    }
  },
  legal: {
    desc: 'Avisos legales y dónde se guardan tus datos.',
    build: () => h('div', { class: 'settings-list' },
      h('p', { class: 'modal-text', text: 'Nova descarga el juego desde los servidores oficiales de Mojang y no redistribuye archivos de Minecraft. Minecraft es una marca de Mojang / Microsoft; este proyecto no está afiliado a ellos.' }),
      h('p', { class: 'modal-text', text: 'Los mods y paquetes de recursos del buscador vienen de Modrinth y pertenecen a sus autores. Nova no posee sus derechos.' }),
      h('p', { class: 'modal-text', text: 'Tu sesión de Microsoft se guarda cifrada en tu PC. Nova no envía datos a ningún servidor propio.' }),
      setting('Datos del launcher', state.info.dataDir, h('button', { class: 'btn btn-dark', type: 'button', text: 'Abrir', onclick: () => window.launcher.openDataFolder() })))
  },
  danger: {
    desc: 'Acciones que no se pueden deshacer. Usalas con cuidado.',
    build: () => {
      const act = (title, desc, label, fn, text) => setting(title, desc, h('button', {
        class: 'btn btn-danger', type: 'button', text: label,
        onclick: async () => {
          if (!(await confirmDialog({ title, text, okLabel: label, danger: true }))) return;
          try { await fn(); toast('Hecho.'); } catch (e) { toast(e.message, 'error'); }
        }
      }));
      return h('div', { class: 'settings-list' },
        act('Cerrar sesión', 'Quita tu cuenta de Microsoft de este launcher.', 'Cerrar sesión', async () => { await doLogout(); }, 'Vas a tener que volver a iniciar sesión para jugar.'),
        act('Borrar caché de mods de Nova', 'Se vuelven a bajar en la próxima actualización.', 'Borrar caché', () => call(window.launcher.clearCache()), 'Se borran los mods de Nova descargados.'),
        act('Borrar Java descargado', 'Nova baja Java de nuevo al jugar.', 'Borrar Java', () => call(window.launcher.clearJava()), 'Se borra el Java que Nova descargó.'),
        act('Restablecer ajustes', 'Tus perfiles y mundos no se tocan.', 'Restablecer', async () => { state.settings = await call(window.launcher.resetSettings()); applyAppearance(state.settings); settingsModal && openSettings('general'); }, 'Los ajustes vuelven a sus valores originales.'));
    }
  }
};
