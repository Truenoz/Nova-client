'use strict';

// Social (estilo Dawn): mini panel flotante «Charla» + ventana grande «Charlas» (lista a la izquierda,
// conversación a la derecha) + ventanas «Agregar amigo» y «Nuevo chat» (con chat grupal).
// Por ahora todo se guarda en este equipo (localStorage). Cuando haya un servidor de chat,
// solo hay que reemplazar socialLoad()/socialSave()/socialSend() y la búsqueda de usuarios.

const SOCIAL_KEY = 'nova.social.v3';
const SOCIAL_OLD_KEY = 'dawn.social.v2';

const social = {
  data: null,
  open: false,     // mini panel abierto
  bigModal: null,  // ventana grande «Charlas» (o null)
  tab: 'chats',    // mini panel: 'chats' | 'friends'
  query: '',       // búsqueda del mini panel
  bigQuery: '',    // búsqueda de la ventana grande
  chat: null,      // id del chat abierto, o null
  el: {}
};

// ───────────────────────── Datos ─────────────────────────

const directId = (name) => `u:${name.toLowerCase()}`;

function socialLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(SOCIAL_KEY));
    if (raw && Array.isArray(raw.chats) && Array.isArray(raw.friends)) return raw;
  } catch { /* datos dañados: se prueba con la versión anterior */ }
  try {
    const old = JSON.parse(localStorage.getItem(SOCIAL_OLD_KEY));
    if (old && Array.isArray(old.chats) && Array.isArray(old.friends)) {
      return {
        friends: old.friends,
        chats: old.chats.map((c) => ({ id: directId(c.name), name: c.name, group: false, members: [c.name], messages: c.messages || [] }))
      };
    }
  } catch { /* sin datos anteriores */ }
  return { chats: [], friends: [] }; // instalación nueva: sin chats ni amigos
}

function socialSave() {
  try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(social.data)); } catch { /* ignorado */ }
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const findChat = (id) => social.data.chats.find((c) => c.id === id);
const lastMsg = (c) => c.messages[c.messages.length - 1] || null;
const chatTs = (c) => (lastMsg(c)?.ts || 0);
const validUser = (name) => /^[A-Za-z0-9_]{3,16}$/.test(name);

function shortAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'Ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `Hace ${m}min`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `Hace ${hr}h`;
  return `Hace ${Math.floor(hr / 24)}d`;
}

const clockTime = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
const dayKey = (ts) => new Date(ts).toDateString();

// ───────────────────────── Avatares ─────────────────────────

// Cabeza del jugador: se pide la skin al proceso principal (la interfaz no tiene red) y se recorta
// la cara (8×8) más la capa externa del sombrero. Se cachea para no repetir descargas.
const headCache = new Map(); // nombre en minúsculas -> promesa del data URL

function skinToHead(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      if (img.height >= 16) g.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('skin ilegible'));
    img.src = dataUrl;
  });
}

async function fetchHead(name) {
  try {
    const r = await window.launcher.getSkin(name);
    if (r?.ok && r.data?.skin) return await skinToHead(r.data.skin);
  } catch { /* se usa la skin por defecto */ }
  throw new Error('sin skin');
}

function loadHead(name) {
  const key = name.toLowerCase();
  if (!headCache.has(key)) {
    // Si el jugador no existe o no hay red, se muestra la cabeza de Steve en vez de un cuadro vacío.
    const p = fetchHead(name).catch(() => (key === 'mhf_steve' ? Promise.reject(new Error('sin skin')) : loadHead('MHF_Steve')));
    headCache.set(key, p);
    p.catch(() => headCache.delete(key));
  }
  return headCache.get(key);
}

function socialAvatar(name, size, noDot) {
  const wrap = h('span', { class: 'sa', style: { width: `${size}px`, height: `${size}px` } });
  const img = h('img', { alt: '', draggable: 'false' });
  loadHead(name).then((url) => { img.src = url; wrap.prepend(img); }).catch(() => {
    wrap.classList.add('fallback');
    wrap.prepend(name.slice(0, 1).toUpperCase());
  });
  if (!noDot) wrap.append(h('i', { class: 'sa-dot', title: 'Desconectado' }));
  return wrap;
}

function chatAvatar(c, size) {
  if (!c.group) return socialAvatar(c.name, size);
  return h('span', { class: 'sa group', style: { width: `${size}px`, height: `${size}px` } }, icon('users', Math.round(size * 0.55)));
}

// ───────────────────────── Acciones ─────────────────────────

function socialRefresh() {
  socialRender();
  if (social.bigModal) socialRenderBig();
}

function socialOpenChat(id) {
  social.chat = id;
  if (!social.bigModal) social.open = true;
  socialRefresh();
}

function socialStartDirect(name) {
  const id = directId(name);
  let c = findChat(id);
  if (!c) {
    const known = social.data.friends.find((f) => sameName(f, name)) || name;
    c = { id, name: known, group: false, members: [known], messages: [] };
    social.data.chats.push(c);
    socialSave();
  }
  socialOpenChat(c.id);
}

function socialCreateGroup(name, members) {
  const c = { id: `g:${Date.now().toString(36)}`, name, group: true, members, messages: [] };
  social.data.chats.push(c);
  socialSave();
  socialOpenChat(c.id);
}

function socialAddFriend(name) {
  if (social.data.friends.some((f) => sameName(f, name))) { toast(`${name} ya está en tu lista.`); return false; }
  social.data.friends.push(name);
  socialSave();
  toast(`${name} agregado a tus amigos.`);
  socialRefresh();
  return true;
}

function socialRemoveFriend(name) {
  confirmDialog({ title: 'Quitar amigo', text: `¿Quitar a ${name} de tu lista de amigos?`, okLabel: 'Quitar', danger: true })
    .then((ok) => {
      if (!ok) return;
      social.data.friends = social.data.friends.filter((f) => !sameName(f, name));
      socialSave();
      socialRefresh();
    });
}

function socialSend(text) {
  const c = findChat(social.chat);
  if (!c || !text.trim()) return;
  const who = state?.account?.name || 'Yo';
  c.messages.push({ from: who, mine: true, text: text.trim(), ts: Date.now() });
  socialSave();
  socialRefresh();
}

// ───────────────────────── Ventana «Agregar amigo» ─────────────────────────

function socialOpenAddFriend() {
  const input = h('input', { type: 'text', placeholder: 'Buscar usuarios', spellcheck: 'false', maxlength: '16' });
  const box = h('label', { class: 'sx-search' }, icon('search', 20), input);
  const out = h('div', { class: 'sm-center' }, h('span', { text: 'Buscar y enviar solicitud de amistad' }));

  const draw = () => {
    const q = input.value.trim();
    out.textContent = '';
    if (!q) { out.className = 'sm-center'; out.append(h('span', { text: 'Buscar y enviar solicitud de amistad' })); return; }
    if (!validUser(q)) { out.className = 'sm-center'; out.append(h('span', { text: 'Escribí un nombre de Minecraft válido: 3 a 16 letras, números o _.' })); return; }
    out.className = 'sm-results';
    const already = social.data.friends.some((f) => sameName(f, q));
    const add = h('button', { class: 'sm-add', type: 'button', disabled: already, text: already ? 'Ya es tu amigo' : 'Agregar' });
    add.addEventListener('click', () => { if (socialAddFriend(q)) m.close(); });
    out.append(h('div', { class: 'sr static' },
      socialAvatar(q, 44),
      h('span', { class: 'sr-main' }, h('span', { class: 'sr-name', text: q }), h('span', { class: 'sr-sub', text: 'Jugador de Minecraft' })),
      add));
  };
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 200); });

  const m = modal({ title: 'Agregar amigo', icon: 'userPlus', className: 'social-modal', body: [box, out] });
  setTimeout(() => input.focus(), 30);
}

// ───────────────────────── Ventana «Nuevo chat» ─────────────────────────

function socialOpenNewChat() {
  const input = h('input', { type: 'text', placeholder: 'buscar amigos', spellcheck: 'false' });
  const box = h('label', { class: 'sx-search' }, icon('search', 20), input);
  const list = h('div', { class: 'sm-list' });
  const hint = h('p', { class: 'sm-hint', text: 'Elige un amigo para empezar a chatear al instante.' });
  const body = h('div', { class: 'sm-stack' }, box, list, hint);

  const m = modal({ title: 'Nuevo chat', icon: 'chat', className: 'social-modal tall', body: [body] });

  const drawFriends = () => {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    list.append(h('button', { class: 'sm-group', type: 'button', onclick: drawGroup },
      h('span', { class: 'sm-tile' }, icon('users', 22)),
      h('span', { class: 'sr-main' }, h('span', { class: 'sr-name', text: 'Crear chat grupal' }), h('span', { class: 'sr-sub', text: 'Chatea con 2 o más amigos' })),
      icon('chevRight', 18)));
    list.append(h('div', { class: 'sm-label', text: 'Amigos' }));
    const items = social.data.friends.filter((f) => !q || f.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b));
    if (!items.length) {
      list.append(h('div', { class: 'sm-none', text: q ? 'Sin resultados.' : 'Todavía no tenés amigos. Agregá uno con el botón de arriba a la derecha del panel.' }));
    }
    for (const f of items) {
      list.append(h('button', { class: 'sr', type: 'button', onclick: () => { m.close(); socialStartDirect(f); } },
        socialAvatar(f, 40),
        h('span', { class: 'sr-main' }, h('span', { class: 'sr-name', text: f }), h('span', { class: 'sr-sub', text: 'Desconectado' }))));
    }
  };

  const drawGroup = () => {
    const picked = new Set();
    const nameIn = h('input', { type: 'text', class: 'input', placeholder: 'Nombre del grupo', spellcheck: 'false', maxlength: '30' });
    const rows = h('div', { class: 'sm-list' });
    const create = h('button', { class: 'ss-green', type: 'button', text: 'Crear grupo', disabled: true });
    const sync = () => { create.disabled = picked.size < 2; create.textContent = picked.size >= 2 ? `Crear grupo (${picked.size})` : 'Elegí 2 o más amigos'; };
    const friends = [...social.data.friends].sort((a, b) => a.localeCompare(b));
    if (!friends.length) rows.append(h('div', { class: 'sm-none', text: 'Necesitás al menos 2 amigos para crear un grupo.' }));
    for (const f of friends) {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { if (cb.checked) picked.add(f); else picked.delete(f); sync(); });
      rows.append(h('label', { class: 'sr pick' }, socialAvatar(f, 40, true),
        h('span', { class: 'sr-main' }, h('span', { class: 'sr-name', text: f })), cb, h('span', { class: 'mf-box' }, icon('check', 12))));
    }
    create.addEventListener('click', () => {
      const members = [...picked];
      const name = nameIn.value.trim() || members.slice(0, 3).join(', ');
      m.close();
      socialCreateGroup(name, members);
    });
    sync();
    body.textContent = '';
    body.append(
      h('button', { class: 'sm-back', type: 'button', onclick: () => { body.textContent = ''; body.append(box, list, hint); drawFriends(); } }, icon('back', 18), 'Volver'),
      nameIn, rows, create);
  };

  input.addEventListener('input', drawFriends);
  drawFriends();
  setTimeout(() => input.focus(), 30);
}

// ───────────────────────── Piezas de conversación ─────────────────────────

// Mensajes agrupados por autor y día: encabezado (avatar, nombre y hora) y burbujas debajo.
function messageList(c) {
  const msgs = h('div', { class: 'sc-msgs' });
  if (!c.messages.length) msgs.append(h('div', { class: 'sc-note', text: `Empezá la charla con ${c.name}.` }));
  let prev = null;
  for (const m of c.messages) {
    if (!prev || dayKey(prev.ts) !== dayKey(m.ts)) msgs.append(h('div', { class: 'sc-day' }, h('span', { text: dayLabel(m.ts) })));
    const newGroup = !prev || prev.from !== m.from || dayKey(prev.ts) !== dayKey(m.ts) || m.ts - prev.ts > 5 * 60 * 1000;
    if (newGroup) {
      msgs.append(h('div', { class: 'sc-who' }, socialAvatar(m.from, 24, true), h('span', { class: 'sc-name', text: m.from }), h('span', { class: 'sc-clock', text: clockTime(m.ts) })));
    }
    msgs.append(h('div', { class: 'sc-row' }, h('span', { class: 'sc-bubble', text: m.text })));
    prev = m;
  }
  setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 0);
  return msgs;
}

function composer(c) {
  const input = h('input', { type: 'text', placeholder: `Mensaje ${c.name}`, spellcheck: 'false', maxlength: '500' });
  const submit = () => { const t = input.value; input.value = ''; socialSend(t); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const send = h('button', { class: 'sc-send', type: 'button', title: 'Enviar', 'aria-label': 'Enviar', onclick: submit }, icon('arrowRight', 22));
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'sc-composer' }, input, send);
}

const subtitle = (c) => (c.group ? `${c.members.length + 1} integrantes` : 'Sin conexión');

function chatRow(c, active) {
  const m = lastMsg(c);
  return h('button', { class: `sr${active ? ' active' : ''}`, type: 'button', onclick: () => socialOpenChat(c.id) },
    chatAvatar(c, 44),
    h('span', { class: 'sr-main' },
      h('span', { class: 'sr-top' },
        h('span', { class: 'sr-name', text: c.name }),
        h('span', { class: 'sr-time', text: shortAgo(m?.ts) })),
      h('span', { class: 'sr-sub', text: m ? `${m.mine ? 'Tú' : m.from}: ${m.text}` : 'Sin mensajes todavía' })));
}

function friendRow(name) {
  return h('div', { class: 'sr static' },
    socialAvatar(name, 40),
    h('span', { class: 'sr-main' },
      h('span', { class: 'sr-name', text: name }),
      h('span', { class: 'sr-sub', text: 'Desconectado' })),
    h('button', { class: 'sr-act', type: 'button', title: 'Enviar mensaje', 'aria-label': `Enviar mensaje a ${name}`, onclick: () => socialStartDirect(name) }, icon('chat', 18)),
    h('button', { class: 'sr-act', type: 'button', title: 'Quitar amigo', 'aria-label': `Quitar a ${name}`, onclick: () => socialRemoveFriend(name) }, icon('trash', 18)));
}

const sortedChats = (q) => social.data.chats
  .filter((c) => !q || c.name.toLowerCase().includes(q.trim().toLowerCase()))
  .sort((a, b) => chatTs(b) - chatTs(a));

// ───────────────────────── Mini panel ─────────────────────────

function listView() {
  const isChats = social.tab === 'chats';
  const d = social.data;

  const head = h('div', { class: 'sp-head' }, h('span', { class: 'sp-title', text: 'Sociales' }),
    h('span', { class: 'sp-ctl' },
      h('button', { class: 'sh-btn', type: 'button', title: 'Ampliar', 'aria-label': 'Ampliar', onclick: socialOpenBig }, icon('expand', 18)),
      h('button', { class: 'sh-btn', type: 'button', title: 'Minimizar', 'aria-label': 'Minimizar panel', onclick: () => { social.open = false; socialRender(); } }, icon('minus', 18))));

  const tabs = h('div', { class: 'st-tabs', role: 'tablist' },
    h('button', { class: `st-tab${isChats ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(isChats),
      onclick: () => { social.tab = 'chats'; social.query = ''; socialRender(); } },
      'Charlas', h('span', { class: 'st-count', text: String(d.chats.length) })),
    h('button', { class: `st-tab${!isChats ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(!isChats),
      onclick: () => { social.tab = 'friends'; social.query = ''; socialRender(); } },
      'Amigos', h('span', { class: 'st-count', text: String(d.friends.length) })));

  const input = h('input', { type: 'text', placeholder: isChats ? 'Buscar chats' : 'buscar amigos', spellcheck: 'false', value: social.query });
  input.addEventListener('input', () => { social.query = input.value; socialRenderList(); });
  const label = isChats ? 'Nuevo chat' : 'Agregar amigo';
  const search = h('div', { class: 'ss-row' },
    h('label', { class: 'ss-box' }, icon('search', 18), input),
    h('button', { class: 'ss-add', type: 'button', title: label, 'aria-label': label, onclick: isChats ? socialOpenNewChat : socialOpenAddFriend }, icon(isChats ? 'plus' : 'userPlus', 18)));

  return [head, tabs, search, h('div', { class: 'ss-list', id: 'social-list' })];
}

function socialRenderList() {
  const list = $('social-list');
  if (!list) return;
  list.textContent = '';
  const q = social.query.trim().toLowerCase();
  if (social.tab === 'chats') {
    const items = sortedChats(q);
    if (!items.length) {
      list.append(h('div', { class: 'ss-empty' },
        h('strong', { text: q ? 'Sin resultados' : 'Aún no hay charlas' }),
        q ? null : h('button', { class: 'ss-green', type: 'button', text: 'Nuevo chat', onclick: socialOpenNewChat })));
      return;
    }
    list.append(...items.map((c) => chatRow(c, false)));
  } else {
    const items = social.data.friends.filter((f) => !q || f.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b));
    if (!items.length) {
      list.append(h('div', { class: 'ss-empty' },
        h('strong', { text: q ? 'Sin resultados' : 'Aún no hay amigos :(' }),
        q ? null : h('button', { class: 'ss-green', type: 'button', text: 'Agregar amigo', onclick: socialOpenAddFriend })));
      return;
    }
    list.append(...items.map(friendRow));
  }
}

function miniChatView(c) {
  const head = h('div', { class: 'sc-head' },
    h('button', { class: 'sc-back', type: 'button', title: 'Volver', 'aria-label': 'Volver a la lista', onclick: () => { social.chat = null; socialRender(); } }, icon('back', 18)),
    chatAvatar(c, 40),
    h('span', { class: 'sc-title' }, h('span', { class: 'sr-name', text: c.name }), h('span', { class: 'sc-status', text: subtitle(c) })),
    h('button', { class: 'sh-btn boxed', type: 'button', title: 'Ampliar', 'aria-label': 'Ampliar', onclick: socialOpenBig }, icon('expand', 18)),
    h('button', { class: 'sh-btn boxed', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar panel', onclick: () => { social.open = false; socialRender(); } }, icon('x', 18)));
  return [head, messageList(c), composer(c)];
}

function socialRender() {
  const { root, panel, body } = social.el;
  const showPanel = social.open && !social.bigModal;
  root.classList.toggle('open', showPanel);
  panel.hidden = !showPanel;
  body.textContent = '';
  if (!showPanel) return;
  const c = social.chat && findChat(social.chat);
  if (!c) social.chat = null;
  body.append(...(c ? miniChatView(c) : listView()));
  if (!c) socialRenderList();
}

// ───────────────────────── Ventana grande «Charlas» ─────────────────────────

function socialOpenBig() {
  if (social.bigModal) return;
  social.open = false;
  const m = modal({
    title: 'Charlas', icon: 'chat', className: 'social-big', body: [],
    onClose: () => { social.bigModal = null; social.bigQuery = ''; socialRender(); }
  });
  m.el.querySelector('.modal-x').before(h('button', {
    class: 'modal-x', type: 'button', title: 'Reducir', 'aria-label': 'Reducir',
    onclick: () => { m.close(); social.open = true; socialRender(); }
  }, icon('shrink', 20)));
  social.bigModal = m;
  socialRender();
  socialRenderBig();
}

function socialToggleBig() {
  if (social.bigModal) social.bigModal.close();
  else socialOpenBig();
}

function socialFillBigList() {
  const list = $('social-big-list');
  if (!list) return;
  list.textContent = '';
  const items = sortedChats(social.bigQuery);
  if (!items.length) {
    list.append(h('div', { class: 'ss-empty' },
      h('strong', { text: social.bigQuery.trim() ? 'Sin resultados' : 'Aún no hay charlas' }),
      social.bigQuery.trim() ? null : h('button', { class: 'ss-green', type: 'button', text: 'Nuevo chat', onclick: socialOpenNewChat })));
    return;
  }
  list.append(...items.map((c) => chatRow(c, c.id === social.chat)));
}

function socialRenderBig() {
  const m = social.bigModal;
  if (!m) return;
  const input = h('input', { type: 'text', placeholder: 'Buscar chats', spellcheck: 'false', value: social.bigQuery });
  input.addEventListener('input', () => { social.bigQuery = input.value; socialFillBigList(); });
  const left = h('div', { class: 'sx-left' },
    h('div', { class: 'sx-bar' },
      h('label', { class: 'sx-search' }, icon('search', 18), input),
      h('button', { class: 'sx-plus', type: 'button', title: 'Nuevo chat', 'aria-label': 'Nuevo chat', onclick: socialOpenNewChat }, icon('plus', 20))),
    h('div', { class: 'sx-list', id: 'social-big-list' }));

  const c = social.chat && findChat(social.chat);
  if (!c) social.chat = null;
  const right = h('div', { class: 'sx-right' });
  if (c) {
    right.append(
      h('div', { class: 'sx-chat-head' }, chatAvatar(c, 44), h('span', { class: 'sc-title' }, h('span', { class: 'sr-name', text: c.name }), h('span', { class: 'sc-status', text: subtitle(c) }))),
      messageList(c), composer(c));
  } else {
    right.append(h('div', { class: 'sx-blank' }, icon('chat', 42), h('strong', { text: 'Elegí una charla' }), h('span', { text: 'o empezá una nueva con el botón +' })));
  }
  m.body.textContent = '';
  m.body.append(h('div', { class: 'sx' }, left, right));
  socialFillBigList();
}

// ───────────────────────── Montaje ─────────────────────────

function mountSocial() {
  const root = $('social');
  if (!root || social.el.root) return;
  social.data = socialLoad();

  const body = h('div', { class: 'sp-body' });
  const panel = h('section', { class: 'sp', 'aria-label': 'Sociales' }, body);
  panel.hidden = true;

  const bar = h('div', { class: 'sbar' },
    h('button', { class: 'sbar-main', type: 'button', 'aria-label': 'Abrir charla', onclick: () => {
      if (social.bigModal) return;
      social.open = !social.open;
      socialRender();
    } }, icon('chat', 22), h('span', { text: 'Charla' })),
    h('button', { class: 'sbar-add', type: 'button', title: 'Agregar amigo', 'aria-label': 'Agregar amigo', onclick: socialOpenAddFriend }, icon('userPlus', 20)));

  root.append(panel, bar);
  Object.assign(social.el, { root, panel, body });
  socialRender();
}
