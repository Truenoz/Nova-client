'use strict';
// Nova Net: el servidor de amistades de Nova Client.
//
// Qué hace:
//   · Verifica la cuenta de Minecraft de cada jugador con Mojang (hasJoined), sin pedirle contraseñas.
//   · Guarda solicitudes de amistad, amigos y mensajes directos entre amigos.
//   · Sabe quién está jugando con Nova Client ahora mismo, para mostrar el logo en el TAB y sobre el nombre.
//
// Sin dependencias: solo Node 18 o más nuevo.   Uso:  node server/server.js
// Variables: PORT (8787) · NOVANET_DATA (server/data/novanet.json) · TRUST_PROXY=1 si va detrás de nginx / Render / etc.
//            NOVANET_DEV_AUTH=1  SOLO PARA PROBAR EN LOCAL: acepta cualquier nombre sin verificarlo con Mojang.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const DATA_FILE = process.env.NOVANET_DATA || path.join(__dirname, 'data', 'novanet.json');
const DEV_AUTH = process.env.NOVANET_DEV_AUTH === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const SESSION_TTL = 12 * 3600 * 1000;
const NONCE_TTL = 60 * 1000;
const PRESENCE_TTL = 45 * 1000;      // sin latido en 45 s = desconectado
const MSG_TTL = 7 * 24 * 3600 * 1000;
const MAX_FRIENDS = 200;
const MAX_PENDING = 100;
const MAX_INBOX = 100;
const MAX_BODY = 32 * 1024;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

// ── Datos ──
// users[uuid] = { uuid, name, friends: [uuid], incoming: [uuid], outgoing: [uuid], lastSeen, lastServer }
// inbox[uuid] = [{ id, from: uuid, text, ts }]
let db = { users: {}, inbox: {}, nextMsg: 1 };
const byName = new Map();            // nombre en minúsculas -> uuid
const sessions = new Map();          // token -> { uuid, exp }
const nonces = new Map();            // nonce -> exp
const presence = new Map();          // uuid -> { at, server, mc }

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (d && typeof d.users === 'object') db = { users: d.users, inbox: d.inbox || {}, nextMsg: d.nextMsg || 1 };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[novanet] No se pudo leer los datos:', e.message);
  }
  reindex();
}

function reindex() {
  byName.clear();
  for (const u of Object.values(db.users)) byName.set(u.name.toLowerCase(), u.uuid);
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 400);
}
function saveNow() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('[novanet] No se pudo guardar:', e.message);
  }
}

// ── Límites de uso ──
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now > h.reset) h = { n: 0, reset: now + windowMs };
  h.n++;
  hits.set(key, h);
  return h.n > max;
}

// ── Utilidades ──
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
const fail = (res, code, error) => send(res, code, { error });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(Object.assign(new Error('bad_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || '?';
}

function cleanName(v) {
  const n = typeof v === 'string' ? v.trim() : '';
  return NAME_RE.test(n) ? n : null;
}

function userByName(name) {
  const id = byName.get(String(name).toLowerCase());
  return id ? db.users[id] : null;
}

function isOnline(uuid) {
  const p = presence.get(uuid);
  return !!p && Date.now() - p.at < PRESENCE_TTL;
}

const pull = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };
const push = (arr, v) => { if (!arr.includes(v)) arr.push(v); };

// ── Mojang ──
async function verifyWithMojang(name, nonce) {
  if (DEV_AUTH) {
    return { id: crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 32), name };
  }
  const url = 'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=' + encodeURIComponent(name) + '&serverId=' + encodeURIComponent(nonce);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'NovaNet' } });
  if (r.status !== 200) return null;
  const j = await r.json();
  if (!j || typeof j.id !== 'string' || typeof j.name !== 'string') return null;
  return { id: j.id.toLowerCase(), name: j.name };
}

// ── Rutas ──
const routes = {};

routes['GET /v1/health'] = async (req, res) => send(res, 200, { ok: true, name: 'Nova Net', v: 1 });

routes['POST /v1/auth/challenge'] = async (req, res, body, ip) => {
  if (limited('ch:' + ip, 30, 60000)) return fail(res, 429, 'rate_limited');
  const nonce = crypto.randomBytes(10).toString('hex');
  nonces.set(nonce, Date.now() + NONCE_TTL);
  send(res, 200, { nonce });
};

routes['POST /v1/auth/login'] = async (req, res, body, ip) => {
  if (limited('lg:' + ip, 30, 60000)) return fail(res, 429, 'rate_limited');
  const name = cleanName(body.name);
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const exp = nonces.get(nonce);
  if (!name || !exp || exp < Date.now()) return fail(res, 400, 'bad_request');
  nonces.delete(nonce);
  let prof = null;
  try { prof = await verifyWithMojang(name, nonce); } catch (e) { return fail(res, 502, 'mojang_unreachable'); }
  if (!prof) return fail(res, 401, 'not_verified');

  let u = db.users[prof.id];
  if (!u) u = db.users[prof.id] = { uuid: prof.id, name: prof.name, friends: [], incoming: [], outgoing: [], lastSeen: 0, lastServer: '' };
  u.name = prof.name;
  // Si otra cuenta tenía este nombre (cambió de nombre en Mojang), deja de tenerlo.
  const holder = byName.get(prof.name.toLowerCase());
  if (holder && holder !== u.uuid && db.users[holder]) {
    db.users[holder].name = '?' + holder.slice(0, 6);
    reindex();
  }
  byName.set(prof.name.toLowerCase(), u.uuid);
  save();
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { uuid: u.uuid, exp: Date.now() + SESSION_TTL });
  send(res, 200, { token, name: u.name, expiresIn: SESSION_TTL / 1000 });
};

// Todo lo de abajo exige sesión
function authed(handler) {
  return async (req, res, body, ip) => {
    const m = /^Bearer ([a-f0-9]{48})$/.exec(String(req.headers.authorization || ''));
    const s = m && sessions.get(m[1]);
    if (!s || s.exp < Date.now() || !db.users[s.uuid]) return fail(res, 401, 'unauthorized');
    if (limited('rq:' + s.uuid, 240, 60000)) return fail(res, 429, 'rate_limited');
    return handler(req, res, body, db.users[s.uuid], ip);
  };
}

routes['POST /v1/sync'] = authed(async (req, res, body, me) => {
  const server = typeof body.server === 'string' ? body.server.slice(0, 64) : null;
  presence.set(me.uuid, { at: Date.now(), server, mc: typeof body.mc === 'string' ? body.mc.slice(0, 16) : '' });
  me.lastSeen = Date.now();
  if (server !== null) me.lastServer = server;

  const friends = me.friends.map((id) => db.users[id]).filter(Boolean).map((f) => {
    const on = isOnline(f.uuid);
    const p = presence.get(f.uuid);
    return {
      name: f.name,
      status: !on ? 'offline' : (p.server !== null ? 'ingame' : 'online'),
      server: on && p.server !== null ? p.server : '',
      lastSeen: f.lastSeen || 0
    };
  });
  const incoming = me.incoming.map((id) => db.users[id]).filter(Boolean).map((u) => u.name);
  const outgoing = me.outgoing.map((id) => db.users[id]).filter(Boolean).map((u) => u.name);

  // Mensajes: confirma (borra) lo que el cliente dice haber recibido y devuelve lo nuevo.
  const after = Number.isFinite(body.after) ? body.after : 0;
  const now = Date.now();
  const box = (db.inbox[me.uuid] || []).filter((m) => m.id > after && now - m.ts < MSG_TTL);
  if (box.length) db.inbox[me.uuid] = box; else delete db.inbox[me.uuid];
  const messages = box.map((m) => ({ id: m.id, from: (db.users[m.from] || {}).name || '?', text: m.text, ts: m.ts }));

  // Quién de la lista del TAB usa Nova Client ahora
  const nova = [];
  if (Array.isArray(body.names)) {
    for (const n of body.names.slice(0, 200)) {
      const u = typeof n === 'string' && NAME_RE.test(n) ? userByName(n) : null;
      if (u && isOnline(u.uuid)) nova.push(u.name);
    }
  }

  send(res, 200, { me: { name: me.name }, friends, incoming, outgoing, messages, nova, serverTime: now });
});

function friendAction(fn) {
  return authed(async (req, res, body, me) => {
    const name = cleanName(body.name);
    if (!name) return fail(res, 400, 'invalid_name');
    const other = userByName(name);
    if (!other) return fail(res, 404, 'not_found');
    const err = fn(me, other);
    if (err) return fail(res, err === 'not_found' ? 404 : 400, err);
    save();
    send(res, 200, { ok: true, name: other.name });
  });
}

routes['POST /v1/friends/request'] = authed(async (req, res, body, me) => {
  if (limited('fr:' + me.uuid, 40, 3600000)) return fail(res, 429, 'rate_limited');
  const name = cleanName(body.name);
  if (!name) return fail(res, 400, 'invalid_name');
  const other = userByName(name);
  if (!other) return fail(res, 404, 'not_found');           // nunca usó Nova Client
  if (other.uuid === me.uuid) return fail(res, 400, 'self');
  if (me.friends.includes(other.uuid)) return fail(res, 400, 'already_friends');
  if (me.outgoing.includes(other.uuid)) return fail(res, 400, 'already_requested');
  if (me.friends.length >= MAX_FRIENDS) return fail(res, 400, 'too_many_friends');
  if (other.incoming.length >= MAX_PENDING || me.outgoing.length >= MAX_PENDING) return fail(res, 400, 'too_many_pending');
  if (me.incoming.includes(other.uuid)) {
    // Los dos se pidieron amistad: quedan amigos
    pull(me.incoming, other.uuid); pull(other.outgoing, me.uuid);
    push(me.friends, other.uuid); push(other.friends, me.uuid);
    save();
    return send(res, 200, { ok: true, name: other.name, accepted: true });
  }
  push(me.outgoing, other.uuid);
  push(other.incoming, me.uuid);
  save();
  send(res, 200, { ok: true, name: other.name });
});

routes['POST /v1/friends/accept'] = friendAction((me, other) => {
  if (!me.incoming.includes(other.uuid)) return 'no_request';
  if (me.friends.length >= MAX_FRIENDS || other.friends.length >= MAX_FRIENDS) return 'too_many_friends';
  pull(me.incoming, other.uuid); pull(other.outgoing, me.uuid);
  push(me.friends, other.uuid); push(other.friends, me.uuid);
  return null;
});

routes['POST /v1/friends/decline'] = friendAction((me, other) => {
  pull(me.incoming, other.uuid); pull(other.outgoing, me.uuid);
  return null;
});

routes['POST /v1/friends/cancel'] = friendAction((me, other) => {
  pull(me.outgoing, other.uuid); pull(other.incoming, me.uuid);
  return null;
});

routes['POST /v1/friends/remove'] = friendAction((me, other) => {
  pull(me.friends, other.uuid); pull(other.friends, me.uuid);
  return null;
});

routes['POST /v1/msg'] = authed(async (req, res, body, me) => {
  if (limited('ms:' + me.uuid, 30, 60000)) return fail(res, 429, 'rate_limited');
  const name = cleanName(body.to);
  const text = typeof body.text === 'string' ? body.text.replace(/[\u0000-\u001f\u007f§]/g, ' ').trim().slice(0, 200) : '';
  if (!name || !text) return fail(res, 400, 'bad_request');
  const other = userByName(name);
  if (!other) return fail(res, 404, 'not_found');
  if (!me.friends.includes(other.uuid)) return fail(res, 403, 'not_friends');
  const box = db.inbox[other.uuid] || (db.inbox[other.uuid] = []);
  const msg = { id: db.nextMsg++, from: me.uuid, text, ts: Date.now() };
  box.push(msg);
  while (box.length > MAX_INBOX) box.shift();
  save();
  send(res, 200, { ok: true, id: msg.id, ts: msg.ts });
});

// ── Servidor ──
const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const handler = routes[req.method + ' ' + url];
  if (!handler) return fail(res, 404, 'not_found');
  const ip = clientIp(req);
  if (limited('ip:' + ip, 600, 60000)) return fail(res, 429, 'rate_limited');
  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    await handler(req, res, body, ip);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'server_error');
    if (!e.status) console.error('[novanet]', e);
  }
});
server.requestTimeout = 15000;

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
  for (const [n, e] of nonces) if (e < now) nonces.delete(n);
  for (const [k, h] of hits) if (h.reset < now) hits.delete(k);
  for (const [u, p] of presence) if (now - p.at > 10 * 60000) presence.delete(u);
}, 60000).unref();

function start(port = PORT) {
  load();
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[novanet] Nova Net escuchando en el puerto ${server.address().port}` + (DEV_AUTH ? '  (MODO DESARROLLO: no verifica cuentas)' : ''));
      resolve(server);
    });
  });
}

function stop() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
  return new Promise((r) => server.close(() => r()));
}

if (require.main === module) {
  start();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop().then(() => process.exit(0)));
}

module.exports = { start, stop };
