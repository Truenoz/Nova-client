'use strict';

// Detección de skins de Minecraft Java.
//
// El proceso principal baja la skin (PNG) y se la pasa a la interfaz como data URL, porque la interfaz
// no tiene permiso de red (CSP `connect-src 'none'`). Acepta un UUID o un nombre de jugador, así que sirve
// para la cuenta con sesión iniciada y para cualquier otro jugador.
//
// Orden de búsqueda: (1) datos de la propia sesión, (2) servidor de sesiones de Mojang,
// (3) mc-heads.net como respaldo, (4) la última skin guardada en disco (funciona sin internet).

const fs = require('fs');
const path = require('path');

const TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let cacheDir = null;
const memory = new Map(); // uuid -> { at, value }

function init(dir) {
  cacheDir = dir;
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* sin caché en disco */ }
}

const undash = (s) => String(s || '').replace(/-/g, '').toLowerCase();
const isUuid = (s) => /^[0-9a-f]{32}$/.test(undash(s));
const isName = (s) => /^[A-Za-z0-9_]{1,16}$/.test(String(s || ''));

async function request(url, accept) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'NovaClient', Accept: accept },
    signal: AbortSignal.timeout(10000)
  });
  return res;
}

async function getJson(url) {
  const res = await request(url, 'application/json');
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Descarga un PNG de un host permitido y lo devuelve como data URL.
async function getPng(url, hostRule) {
  const u = new URL(url);
  if (u.protocol === 'http:') u.protocol = 'https:'; // textures.minecraft.net publica http:// en los perfiles
  if (u.protocol !== 'https:' || !hostRule.test(u.hostname)) throw new Error('Origen de skin no permitido');
  const res = await request(u.toString(), 'image/png');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('La skin es demasiado grande');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('La skin no es un PNG válido');
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const MOJANG_TEXTURES = /(^|\.)textures\.minecraft\.net$/i;
const MCHEADS = /^mc-heads\.net$/i;

// Nombre → { id, name } (null si no existe).
async function lookupName(name) {
  const enc = encodeURIComponent(name);
  try {
    const r = await getJson(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${enc}`);
    if (r?.id) return { id: undash(r.id), name: r.name };
    if (r === null) return null;
  } catch { /* se prueba el endpoint anterior */ }
  const r = await getJson(`https://api.mojang.com/users/profiles/minecraft/${enc}`);
  return r?.id ? { id: undash(r.id), name: r.name } : null;
}

// UUID → { name, skinUrl, model, capeUrl } desde el servidor de sesiones.
async function sessionTextures(uuid) {
  const p = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
  if (!p) return null;
  const prop = (p.properties || []).find((x) => x.name === 'textures');
  let skinUrl = null;
  let model = 'classic';
  let capeUrl = null;
  if (prop?.value) {
    const t = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures || {};
    skinUrl = t.SKIN?.url || null;
    model = t.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic';
    capeUrl = t.CAPE?.url || null;
  }
  return { name: p.name, skinUrl, model, capeUrl };
}

function cachePath(uuid) { return cacheDir ? path.join(cacheDir, `${uuid}.json`) : null; }

function readDisk(uuid) {
  try { return JSON.parse(fs.readFileSync(cachePath(uuid), 'utf8')); } catch { return null; }
}

function writeDisk(uuid, value) {
  try { if (cacheDir) fs.writeFileSync(cachePath(uuid), JSON.stringify(value)); } catch { /* no es crítico */ }
}

/**
 * @param {string} query   UUID (con o sin guiones) o nombre de jugador.
 * @param {object} [opts]
 * @param {boolean} [opts.force]  ignora la caché de 5 minutos.
 * @param {object} [opts.known]   datos ya conocidos de la sesión: { name, skinUrl, model }.
 * @returns {Promise<{ name, uuid, model: 'slim'|'classic'|'auto', skin: string, source: string }>}
 */
async function getSkin(query, opts = {}) {
  query = String(query || '').trim();
  let uuid = isUuid(query) ? undash(query) : null;
  let name = uuid ? opts.known?.name || '' : query;

  if (!uuid) {
    if (!isName(query)) throw new Error('Nombre de jugador no válido.');
    const key = `n:${query.toLowerCase()}`;
    const hit = memory.get(key);
    if (hit && !opts.force && Date.now() - hit.at < TTL_MS) return hit.value;
    let found = null;
    try { found = await lookupName(query); } catch { /* sin red: se intenta con la caché */ }
    if (found) { uuid = found.id; name = found.name; } else {
      const stale = [...memory.values()].find((e) => e.value.name?.toLowerCase() === query.toLowerCase());
      if (stale) return stale.value;
      throw new Error(`No se encontró al jugador «${query}».`);
    }
  }

  const hit = memory.get(uuid);
  if (hit && !opts.force && Date.now() - hit.at < TTL_MS) return hit.value;

  const result = { name, uuid, model: 'auto', skin: null, source: '' };
  const errors = [];

  // 1) Datos de la sesión (ya incluyen la URL de la skin activa y su modelo).
  if (opts.known?.skinUrl) {
    try {
      result.skin = await getPng(opts.known.skinUrl, MOJANG_TEXTURES);
      result.model = opts.known.model === 'slim' ? 'slim' : 'classic';
      result.source = 'sesión';
    } catch (e) { errors.push(e.message); }
  }

  // 2) Servidor de sesiones de Mojang.
  if (!result.skin) {
    try {
      const t = await sessionTextures(uuid);
      if (t) {
        result.name = t.name || result.name;
        if (t.skinUrl) {
          result.skin = await getPng(t.skinUrl, MOJANG_TEXTURES);
          result.model = t.model;
          result.source = 'mojang';
        }
      }
    } catch (e) { errors.push(e.message); }
  }

  // 3) Respaldo: mc-heads.net (sirve la skin real o la de Steve/Alex por defecto).
  if (!result.skin) {
    try {
      result.skin = await getPng(`https://mc-heads.net/skin/${uuid}`, MCHEADS);
      result.model = 'auto'; // el modelo se deduce de los píxeles
      result.source = 'mc-heads';
    } catch (e) { errors.push(e.message); }
  }

  // 4) Última skin guardada.
  if (!result.skin) {
    const disk = readDisk(uuid);
    if (disk?.skin) return { ...disk, source: 'caché' };
    throw new Error(`No se pudo obtener la skin (${errors.join('; ') || 'sin conexión'}).`);
  }

  if (!result.name) result.name = opts.known?.name || '';
  memory.set(uuid, { at: Date.now(), value: result });
  if (name) memory.set(`n:${name.toLowerCase()}`, { at: Date.now(), value: result });
  writeDisk(uuid, result);
  return result;
}

module.exports = { init, getSkin };
