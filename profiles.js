'use strict';

// Perfiles de juego: cada perfil es una instancia con su propia carpeta (mods, mundos, config),
// su versión de Minecraft y su cargador. También maneja el contenido (mods / paquetes de recursos),
// los mods de rendimiento, los mundos, los servidores guardados y exportar / importar perfiles.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { downloadFile, safeName } = require('./util');
const { readModJar, checkCompat } = require('./modcompat');

const MODRINTH = 'https://api.modrinth.com/v2';
const PROFILE_KEYS = ['name', 'mc', 'loader', 'nova', 'autoSync', 'folder', 'ramGB', 'jvmArgs', 'pinned', 'fabricApi'];

// Mods de rendimiento que se administran desde la tarjeta «Rendimiento» del perfil.
const PERF_MODS = [
  { key: 'sodium', slug: 'sodium', name: 'Sodium' },
  { key: 'immediatelyfast', slug: 'immediatelyfast', name: 'ImmediatelyFast' },
  { key: 'entityculling', slug: 'entityculling', name: 'Entity Culling' },
  { key: 'lithium', slug: 'lithium', name: 'Lithium' },
  { key: 'ferritecore', slug: 'ferrite-core', name: 'FerriteCore' },
  { key: 'modernfix', slug: 'modernfix', name: 'ModernFix' }
];

let ctx = null; // { storeFile, gameDir, userAgent, send, log, dialog, shell, clipboard }
let store = null;

function init(c) {
  ctx = c;
  store = null;
}

// ───────────────────────── Almacén ─────────────────────────

function load() {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(ctx.storeFile(), 'utf8'));
    store = { folders: raw.folders || [], profiles: raw.profiles || [], servers: raw.servers || [] };
  } catch {
    store = { folders: [], profiles: [], servers: [] };
  }
  return store;
}

function save() {
  fs.mkdirSync(path.dirname(ctx.storeFile()), { recursive: true });
  fs.writeFileSync(ctx.storeFile(), JSON.stringify(store, null, 2));
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function find(id) {
  const p = load().profiles.find((x) => x.id === id);
  if (!p) throw new Error('El perfil ya no existe.');
  return p;
}

function instanceDir(p) {
  return p.legacy ? ctx.gameDir() : path.join(ctx.gameDir(), 'instances', p.id);
}

function loaderLabel(p) {
  return p.loader === 'fabric' ? 'Fabric' : 'Vanilla';
}

function view(p) {
  return {
    ...p,
    loaderLabel: loaderLabel(p),
    dir: instanceDir(p)
  };
}

// ───────────────────────── Perfiles ─────────────────────────

// Si todavía no hay perfiles, crea uno con la configuración anterior (misma carpeta, así no se pierden mundos ni mods).
function ensureDefault(settings) {
  const s = load();
  if (s.profiles.length) return;
  const wantNova = settings.novaClient !== false;
  s.profiles.push({
    id: newId(),
    name: `Nova ${settings.lastVersion}`,
    mc: settings.lastVersion,
    loader: wantNova ? 'fabric' : 'vanilla',
    nova: wantNova,
    autoSync: true,
    fabricApi: true,
    folder: '',
    pinned: false,
    origin: 'custom',
    legacy: true,
    created: Date.now(),
    lastPlayed: 0,
    playtimeSec: 0,
    perf: { master: false, off: [] }
  });
  save();
}

function list() {
  const s = load();
  return {
    folders: s.folders,
    profiles: s.profiles.map(view)
  };
}

function get(id) {
  return view(find(id));
}

function create(input) {
  const s = load();
  const mc = String(input.mc || '').trim();
  if (!mc) throw new Error('Elegí una versión de Minecraft.');
  const loader = input.loader === 'fabric' ? 'fabric' : 'vanilla';
  const name = String(input.name || '').trim() || `${loader === 'fabric' ? 'Fabric' : 'Minecraft'} ${mc}`;
  const p = {
    id: newId(),
    name: name.slice(0, 60),
    mc,
    loader,
    nova: loader === 'fabric' && input.nova !== false,
    autoSync: input.autoSync !== false,
    fabricApi: true,
    folder: input.folder && s.folders.includes(input.folder) ? input.folder : '',
    pinned: false,
    legacy: false,
    origin: input.origin === 'pack' ? 'pack' : 'custom',
    created: Date.now(),
    lastPlayed: 0,
    playtimeSec: 0,
    perf: { master: false, off: [] }
  };
  s.profiles.push(p);
  save();
  fs.mkdirSync(path.join(instanceDir(p), 'mods'), { recursive: true });
  return view(p);
}

function update(id, patch) {
  const p = find(id);
  const s = load();
  for (const k of PROFILE_KEYS) {
    if (!(k in (patch || {}))) continue;
    let v = patch[k];
    if (k === 'name') v = String(v).trim().slice(0, 60) || p.name;
    if (k === 'ramGB') v = v ? Math.max(1, Math.min(64, Number(v) || 0)) || null : null;
    if (k === 'folder') v = s.folders.includes(v) ? v : '';
    if (k === 'loader') v = v === 'fabric' ? 'fabric' : 'vanilla';
    if (['nova', 'autoSync', 'pinned', 'fabricApi'].includes(k)) v = !!v;
    p[k] = v;
  }
  if (p.loader !== 'fabric') p.nova = false;
  save();
  return view(p);
}

function remove(id) {
  const s = load();
  const p = find(id);
  s.profiles = s.profiles.filter((x) => x.id !== id);
  save();
  // La carpeta del perfil heredado es la raíz del juego (hay otros datos adentro): no se borra.
  if (!p.legacy) {
    try { fs.rmSync(instanceDir(p), { recursive: true, force: true }); } catch { /* en uso */ }
  }
}

function copyDirSafe(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function duplicate(id) {
  const p = find(id);
  const copy = create({ name: `${p.name} (copia)`, mc: p.mc, loader: p.loader, nova: p.nova, autoSync: p.autoSync, folder: p.folder });
  const c = load().profiles.find((x) => x.id === copy.id);
  c.perf = JSON.parse(JSON.stringify(p.perf || { master: false, off: [] }));
  c.ramGB = p.ramGB;
  c.jvmArgs = p.jvmArgs;
  save();
  const from = instanceDir(p);
  const to = instanceDir(c);
  for (const sub of ['mods', 'resourcepacks', 'config', 'shaderpacks']) copyDirSafe(path.join(from, sub), path.join(to, sub));
  for (const f of ['options.txt', 'nova-content.json']) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  return view(c);
}

// «Copiar del perfil…»: trae mods, paquetes de recursos y config de otro perfil.
function copyFrom(id, sourceId) {
  if (id === sourceId) throw new Error('Elegí otro perfil.');
  const dst = find(id);
  const src = find(sourceId);
  const from = instanceDir(src);
  const to = instanceDir(dst);
  for (const sub of ['mods', 'resourcepacks', 'config', 'shaderpacks']) copyDirSafe(path.join(from, sub), path.join(to, sub));
  const a = readIndex(from);
  const b = readIndex(to);
  b.files = { ...b.files, ...a.files };
  writeIndex(to, b);
  return view(dst);
}

function touchPlayed(id, seconds) {
  const p = load().profiles.find((x) => x.id === id);
  if (!p) return;
  p.lastPlayed = Date.now();
  p.playtimeSec = (p.playtimeSec || 0) + Math.max(0, Math.round(seconds || 0));
  save();
}

function setFolders(action, name) {
  const s = load();
  const n = String(name || '').trim().slice(0, 40);
  if (action === 'add') {
    if (!n) throw new Error('Escribí un nombre para la carpeta.');
    if (!s.folders.includes(n)) s.folders.push(n);
  } else if (action === 'remove') {
    s.folders = s.folders.filter((f) => f !== n);
    for (const p of s.profiles) if (p.folder === n) p.folder = '';
  }
  save();
  return s.folders;
}

// ───────────────────────── Contenido ─────────────────────────

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks' };

function readIndex(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'nova-content.json'), 'utf8'));
    return { files: j.files || {}, unmatched: j.unmatched || {} };
  } catch {
    return { files: {}, unmatched: {} };
  }
}

function writeIndex(dir, idx) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nova-content.json'), JSON.stringify(idx, null, 2));
}

const jarInfoCache = new Map();

// Lee nombre / versión / autor / cargador / versión de Minecraft pedida de un .jar (con caché por fecha).
function readJarInfo(file) {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const hit = jarInfoCache.get(file);
  if (hit && hit.mtime === mtime) return hit.info;
  const info = readModJar(file);
  jarInfoCache.set(file, { mtime, info });
  return info;
}

function isManaged(entry) {
  return !!(entry && entry.managed);
}

function listContent(id) {
  const p = find(id);
  const dir = instanceDir(p);
  const idx = readIndex(dir);
  const out = [];
  for (const [type, sub] of Object.entries(CONTENT_DIRS)) {
    const folder = path.join(dir, sub);
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const file of names) {
      const full = path.join(folder, file);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      const enabled = !file.endsWith('.disabled');
      const base = enabled ? file : file.slice(0, -'.disabled'.length);
      if (type === 'mod' && !/\.jar$/i.test(base)) continue;
      if (type === 'resourcepack' && !(st.isDirectory() || /\.zip$/i.test(base))) continue;
      const meta = idx.files[`${sub}/${base}`];
      if (isManaged(meta)) continue;
      if (type === 'mod' && /^(nova-client|fabric-api)/i.test(base)) continue;
      let name = meta?.title;
      let version = meta?.versionNumber;
      let author = meta?.author;
      let compat = null;
      if (type === 'mod') {
        const info = readJarInfo(full) || {};
        name = name || info.name;
        version = version || info.version;
        author = author || info.author;
        compat = checkCompat(info, p);
      }
      out.push({
        file,
        base,
        type,
        enabled,
        name: name || base.replace(/\.(jar|zip)$/i, ''),
        author: author || '',
        version: version || '',
        source: meta?.source === 'modrinth' ? 'Modrinth' : 'Local',
        projectId: meta?.projectId || null,
        icon: meta?.icon || null,
        compat,
        size: st.size
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

function contentPath(p, file) {
  const base = path.basename(file);
  const clean = base.endsWith('.disabled') ? base.slice(0, -9) : base;
  const sub = /\.zip$/i.test(clean) ? 'resourcepacks' : 'mods';
  return { sub, path: path.join(instanceDir(p), sub, base), clean };
}

function toggleContent(id, file, enabled) {
  const p = find(id);
  const c = contentPath(p, file);
  const dir = path.dirname(c.path);
  const from = path.join(dir, path.basename(file));
  const to = path.join(dir, enabled ? c.clean : `${c.clean}.disabled`);
  if (from !== to && fs.existsSync(from)) fs.renameSync(from, to);
}

function removeContent(id, file) {
  const p = find(id);
  const c = contentPath(p, file);
  fs.rmSync(c.path, { recursive: true, force: true });
  const dir = instanceDir(p);
  const idx = readIndex(dir);
  delete idx.files[`${c.sub}/${c.clean}`];
  writeIndex(dir, idx);
}

// Copia los archivos al perfil y avisa cuáles mods no sirven para su versión / cargador.
function addLocal(id, filePaths) {
  const p = find(id);
  const dir = instanceDir(p);
  let n = 0;
  const incompatible = [];
  for (const src of filePaths) {
    const name = safeName(path.basename(src));
    const sub = /\.zip$/i.test(name) ? 'resourcepacks' : /\.jar$/i.test(name) ? 'mods' : null;
    if (!sub) continue;
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const dest = path.join(dir, sub, name);
    fs.copyFileSync(src, dest);
    n++;
    if (sub === 'mods') {
      const info = readJarInfo(dest) || {};
      const c = checkCompat(info, p);
      if (c.status === 'bad') incompatible.push({ name: info.name || name.replace(/\.jar$/i, ''), reason: c.reason });
    }
  }
  return { n, incompatible };
}

// ───────────────────────── Modrinth ─────────────────────────

async function mr(pathname, init) {
  const res = await fetch(`${MODRINTH}${pathname}`, {
    ...init,
    headers: { 'User-Agent': ctx.userAgent(), Accept: 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Modrinth respondió HTTP ${res.status}`);
  return res.json();
}

function loadersFor(p, type) {
  return type === 'resourcepack' || type === 'shader' ? null : p.loader === 'fabric' ? ['fabric'] : null;
}

async function search(id, { query, type, offset }) {
  const p = find(id);
  const t = type === 'resourcepack' ? 'resourcepack' : 'mod';
  const facets = [[`project_type:${t}`], [`versions:${p.mc}`]];
  if (t === 'mod' && p.loader === 'fabric') facets.push(['categories:fabric']);
  const q = new URLSearchParams({
    query: String(query || ''),
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(offset || 0),
    index: query ? 'relevance' : 'downloads'
  });
  const r = await mr(`/search?${q}`);
  const idx = readIndex(instanceDir(p));
  const installed = new Set(Object.values(idx.files).map((f) => f.projectId).filter(Boolean));
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      author: h.author,
      description: h.description,
      icon: h.icon_url || null,
      downloads: h.downloads,
      type: t,
      installed: installed.has(h.project_id)
    }))
  };
}

// Buscador global de Modrinth para la página «Modificaciones». Los filtros llegan desde la interfaz.
const BROWSE_TYPES = ['mod', 'modpack', 'resourcepack', 'shader'];
const BROWSE_SORT = { relevance: 'relevance', downloads: 'downloads', follows: 'follows', newest: 'newest', updated: 'updated' };

async function browse({ query, type, offset, limit, sort, versions, loaders, categories, profileId } = {}) {
  const t = BROWSE_TYPES.includes(type) ? type : 'mod';
  const clean = (arr) => (Array.isArray(arr) ? arr.map(String).filter((s) => /^[A-Za-z0-9._+-]{1,40}$/.test(s)) : []);
  const facets = [[`project_type:${t}`]];
  const vs = clean(versions);
  const ls = t === 'mod' || t === 'modpack' ? clean(loaders) : [];
  const cs = clean(categories);
  if (vs.length) facets.push(vs.map((v) => `versions:${v}`));
  if (ls.length) facets.push(ls.map((l) => `categories:${l}`));
  if (cs.length) facets.push(cs.map((c) => `categories:${c}`));
  const q = new URLSearchParams({
    query: String(query || ''),
    facets: JSON.stringify(facets),
    limit: String(Math.max(1, Math.min(50, Number(limit) || 20))),
    offset: String(Math.max(0, Number(offset) || 0)),
    index: BROWSE_SORT[sort] || (query ? 'relevance' : 'downloads')
  });
  const r = await mr(`/search?${q}`);
  let installed = new Set();
  if (profileId) {
    try {
      const idx = readIndex(instanceDir(find(profileId)));
      installed = new Set(Object.values(idx.files).map((f) => f.projectId).filter(Boolean));
    } catch { /* sin perfil: nada instalado */ }
  }
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      author: h.author,
      description: h.description,
      icon: h.icon_url || null,
      downloads: h.downloads,
      follows: h.follows,
      updated: h.date_modified,
      type: t,
      installed: installed.has(h.project_id)
    }))
  };
}

// Algunos mods (p. ej. ModernFix) marcan en Modrinth como «compatible» un build hecho para otra versión
// de Minecraft (5.20.3+mc1.21.4 para la 1.21.8) y después fallan al arrancar. Si el nombre de la versión
// o del archivo trae una versión de Minecraft explícita ("+mc1.21.4", "+1.21.4", "-mc1.21.4") y no es la
// del perfil, ese build no sirve.
function targetsOtherMc(label, mc) {
  const m = /(?:\+|-|_)(?:mc)?(1\.\d{1,2}(?:\.\d{1,2})?)(?![\d.]*\d)/i.exec(String(label || ''));
  return !!m && m[1] !== mc;
}

function versionFitsMc(v, mc) {
  const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
  return !targetsOtherMc(v.version_number, mc) && !targetsOtherMc(file && file.filename, mc);
}

async function bestVersion(p, projectId, type, strict) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([p.mc]) });
  const loaders = loadersFor(p, type);
  if (loaders) q.set('loaders', JSON.stringify(loaders));
  let versions = await mr(`/project/${encodeURIComponent(projectId)}/version?${q}`);
  if (strict) versions = versions.filter((v) => versionFitsMc(v, p.mc));
  return versions.find((v) => v.version_type === 'release') || versions[0] || null;
}

// Descarga una versión de Modrinth a la carpeta del perfil y la anota en el índice.
async function installVersion(p, version, type, extra) {
  const dir = instanceDir(p);
  const sub = { ...CONTENT_DIRS, shader: 'shaderpacks' }[type] || 'mods';
  const file = version.files.find((f) => f.primary) || version.files[0];
  if (!file) throw new Error('Esa versión no tiene archivos.');
  const name = safeName(file.filename);
  fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const dest = path.join(dir, sub, name);
  const tmp = `${dest}.part`;
  await downloadFile(file.url, tmp);
  fs.renameSync(tmp, dest);
  const idx = readIndex(dir);
  idx.files[`${sub}/${name}`] = {
    source: 'modrinth',
    projectId: version.project_id,
    versionId: version.id,
    versionNumber: version.version_number,
    ...extra
  };
  writeIndex(dir, idx);
  return name;
}

async function projectInfo(projectId) {
  const pr = await mr(`/project/${encodeURIComponent(projectId)}`);
  return { title: pr.title, icon: pr.icon_url || null, slug: pr.slug };
}

// Instala un proyecto y sus dependencias obligatorias. Devuelve los títulos instalados.
async function installProject(id, projectId, type, extra, depth) {
  const p = find(id);
  const dir = instanceDir(p);
  const t = type === 'resourcepack' || type === 'shader' ? type : 'mod';
  const idx = readIndex(dir);
  if (Object.values(idx.files).some((f) => f.projectId === projectId)) return [];
  const version = await bestVersion(p, projectId, t);
  if (!version) throw new Error(`No hay una versión compatible con Minecraft ${p.mc}${p.loader === 'fabric' && t === 'mod' ? ' + Fabric' : ''}.`);
  const info = await projectInfo(projectId);
  let author = '';
  try {
    const members = await mr(`/project/${encodeURIComponent(projectId)}/members`);
    author = (members.find((m) => m.role === 'Owner') || members[0])?.user?.username || '';
  } catch { /* el autor es opcional */ }
  await installVersion(p, version, t, { title: info.title, icon: info.icon, author, ...(extra || {}) });
  const done = [info.title];
  if (t === 'mod' && (depth || 0) < 3) {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (/^fabric-api$/i.test(dep.project_id)) continue; // ya se instala aparte
      try {
        done.push(...await installProject(id, dep.project_id, 'mod', { dependency: true }, (depth || 0) + 1));
      } catch (e) {
        ctx.log(`[Contenido] No se pudo instalar una dependencia: ${e.message}`);
      }
    }
  }
  return done;
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

// Reconoce los archivos puestos a mano que en realidad vienen de Modrinth: se compara el hash (SHA-1) de
// cada archivo con el de Modrinth. Los que coinciden pasan a figurar como Modrinth (con título, ícono y
// versión) y ya pueden actualizarse. Lo que no coincide se recuerda para no volver a consultarlo.
const identifying = new Set();

async function identifyLocal(id) {
  if (identifying.has(id)) return 0;
  identifying.add(id);
  try {
    const p = find(id);
    const dir = instanceDir(p);
    const idx = readIndex(dir);
    idx.unmatched = idx.unmatched || {};
    const byHash = {};
    for (const [type, sub] of Object.entries(CONTENT_DIRS)) {
      let names = [];
      try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
      for (const file of names) {
        const base = file.endsWith('.disabled') ? file.slice(0, -9) : file;
        if (!(type === 'mod' ? /\.jar$/i.test(base) : /\.zip$/i.test(base))) continue;
        if (type === 'mod' && /^(nova-client|fabric-api)/i.test(base)) continue;
        const key = `${sub}/${base}`;
        if (idx.files[key]) continue; // ya se sabe de dónde viene
        const full = path.join(dir, sub, file);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile()) continue;
        const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
        if (idx.unmatched[key] === stamp) continue;
        byHash[sha1(full)] = { key, stamp };
      }
    }
    const hashes = Object.keys(byHash);
    if (!hashes.length) return 0;
    const found = await mr('/version_files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1' })
    });
    const ids = [...new Set(Object.values(found).map((v) => v.project_id))];
    const projects = {};
    if (ids.length) {
      const list = await mr(`/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);
      for (const pr of list) projects[pr.id] = pr;
    }
    let n = 0;
    for (const [hash, { key, stamp }] of Object.entries(byHash)) {
      const v = found[hash];
      if (!v) { idx.unmatched[key] = stamp; continue; }
      const pr = projects[v.project_id] || {};
      idx.files[key] = {
        source: 'modrinth',
        projectId: v.project_id,
        versionId: v.id,
        versionNumber: v.version_number,
        title: pr.title || undefined,
        icon: pr.icon_url || null,
        detected: true
      };
      delete idx.unmatched[key];
      n++;
    }
    writeIndex(dir, idx);
    return n;
  } finally {
    identifying.delete(id);
  }
}

// Busca versiones nuevas (compatibles con el perfil) de lo que vino de Modrinth.
async function checkUpdates(id) {
  const p = find(id);
  const dir = instanceDir(p);
  const idx = readIndex(dir);
  const hashes = {};
  for (const key of Object.keys(idx.files)) {
    if (idx.files[key].source !== 'modrinth') continue;
    const full = path.join(dir, key);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) hashes[sha1(full)] = key;
    else if (fs.existsSync(`${full}.disabled`)) hashes[sha1(`${full}.disabled`)] = key;
  }
  const list = Object.keys(hashes);
  if (!list.length) return [];
  const body = { hashes: list, algorithm: 'sha1', game_versions: [p.mc] };
  if (p.loader === 'fabric') body.loaders = ['fabric'];
  const res = await mr('/version_files/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = [];
  for (const [hash, v] of Object.entries(res)) {
    const key = hashes[hash];
    if (key && idx.files[key].versionId !== v.id) out.push({ key, version: v });
  }
  return out;
}

async function applyUpdate(p, key, version) {
  const dir = instanceDir(p);
  const idx = readIndex(dir);
  const old = idx.files[key];
  const type = key.startsWith('resourcepacks/') ? 'resourcepack' : 'mod';
  const wasDisabled = !fs.existsSync(path.join(dir, key)) && fs.existsSync(path.join(dir, `${key}.disabled`));
  const name = await installVersion(p, version, type, {
    title: old.title, icon: old.icon, author: old.author, managed: old.managed, dependency: old.dependency
  });
  const sub = key.split('/')[0];
  const newKey = `${sub}/${name}`;
  if (newKey !== key) {
    for (const f of [key, `${key}.disabled`]) fs.rmSync(path.join(dir, f), { force: true });
    const idx2 = readIndex(dir);
    delete idx2.files[key];
    writeIndex(dir, idx2);
  }
  if (wasDisabled) toggleContent(p.id, name, false);
}

async function updateContent(id, file) {
  const p = find(id);
  const c = contentPath(p, file);
  const found = (await checkUpdates(id)).find((u) => u.key === `${c.sub}/${c.clean}`);
  if (!found) return { updated: false };
  await applyUpdate(p, found.key, found.version);
  return { updated: true, version: found.version.version_number };
}

// Actualiza todo lo que se pueda. No lanza: es para la sincronización automática antes de jugar.
async function syncAll(id) {
  try {
    const p = find(id);
    const ups = await checkUpdates(id);
    for (const u of ups) {
      try { await applyUpdate(p, u.key, u.version); } catch (e) { ctx.log(`[Sincronización] ${u.key}: ${e.message}`); }
    }
    return ups.length;
  } catch (e) {
    ctx.log(`[Sincronización] No se pudo buscar actualizaciones: ${e.message}`);
    return 0;
  }
}

// ───────────────────────── Rendimiento ─────────────────────────

function perfState(p) {
  const perf = p.perf || (p.perf = { master: false, off: [] });
  if (!Array.isArray(perf.off)) perf.off = [];
  return perf;
}

function getPerf(id) {
  const p = find(id);
  const perf = perfState(p);
  const idx = readIndex(instanceDir(p));
  const byKey = {};
  for (const meta of Object.values(idx.files)) if (meta.managed?.startsWith('perf:')) byKey[meta.managed.slice(5)] = meta;
  return {
    available: p.loader === 'fabric',
    master: !!perf.master,
    mods: PERF_MODS.map((m) => ({
      key: m.key,
      name: m.name,
      enabled: !perf.off.includes(m.key),
      installed: !!byKey[m.key],
      version: byKey[m.key]?.versionNumber || ''
    }))
  };
}

function removePerfFiles(p, onlyKey) {
  const dir = instanceDir(p);
  const idx = readIndex(dir);
  for (const [key, meta] of Object.entries(idx.files)) {
    if (!meta.managed?.startsWith('perf:')) continue;
    if (onlyKey && meta.managed !== `perf:${onlyKey}`) continue;
    for (const f of [key, `${key}.disabled`]) fs.rmSync(path.join(dir, f), { force: true });
    delete idx.files[key];
  }
  writeIndex(dir, idx);
}

// Instala los mods de rendimiento que falten (y quita los apagados). Cada uno falla por separado.
async function ensurePerf(id) {
  const p = find(id);
  if (p.loader !== 'fabric') return;
  const perf = perfState(p);
  if (!perf.master) {
    removePerfFiles(p);
    return;
  }
  for (const m of PERF_MODS) {
    if (perf.off.includes(m.key)) {
      removePerfFiles(p, m.key);
      continue;
    }
    const idx = readIndex(instanceDir(p));
    const have = Object.entries(idx.files).filter(([, f]) => f.managed === `perf:${m.key}`);
    // Un build instalado para otra versión de Minecraft se quita (hacía crashear el juego al arrancar).
    if (have.some(([k, f]) => targetsOtherMc(f.versionNumber, p.mc) || targetsOtherMc(k.split('/').pop(), p.mc))) {
      ctx.log(`[Rendimiento] ${m.name}: la versión instalada no es para Minecraft ${p.mc}, se quita.`);
      removePerfFiles(p, m.key);
    } else if (have.length) {
      continue;
    }
    try {
      const version = await bestVersion(p, m.slug, 'mod', true);
      if (!version) { ctx.log(`[Rendimiento] ${m.name} no tiene una versión para Minecraft ${p.mc}, se omite.`); continue; }
      const info = await projectInfo(m.slug);
      await installVersion(p, version, 'mod', { title: info.title, icon: info.icon, managed: `perf:${m.key}` });
      ctx.log(`[Rendimiento] ${m.name} ${version.version_number} instalado.`);
    } catch (e) {
      ctx.log(`[Rendimiento] ${m.name}: ${e.message}`);
    }
  }
}

async function setPerf(id, patch) {
  const p = find(id);
  const perf = perfState(p);
  if (typeof patch.master === 'boolean') perf.master = patch.master;
  if (patch.key && typeof patch.enabled === 'boolean') {
    if (!PERF_MODS.some((m) => m.key === patch.key)) throw new Error('Mod desconocido.');
    perf.off = perf.off.filter((k) => k !== patch.key);
    if (!patch.enabled) perf.off.push(patch.key);
  }
  save();
  await ensurePerf(id);
  return getPerf(id);
}

// ───────────────────────── Mundos y registros ─────────────────────────

function listWorlds(id) {
  const saves = path.join(instanceDir(find(id)), 'saves');
  let names = [];
  try { names = fs.readdirSync(saves); } catch { return []; }
  const out = [];
  for (const name of names) {
    const dir = path.join(saves, name);
    try {
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'level.dat'))) continue;
      const st = fs.statSync(path.join(dir, 'level.dat'));
      let icon = null;
      const iconFile = path.join(dir, 'icon.png');
      if (fs.existsSync(iconFile) && fs.statSync(iconFile).size < 200000) {
        icon = `data:image/png;base64,${fs.readFileSync(iconFile).toString('base64')}`;
      }
      out.push({ name, lastPlayed: st.mtimeMs, icon });
    } catch { /* carpeta ilegible */ }
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

function readLog(id) {
  const file = path.join(instanceDir(find(id)), 'logs', 'latest.log');
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, 200 * 1024);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

// ───────────────────────── Exportar / importar / compartir ─────────────────────────

function snapshot(id) {
  const p = find(id);
  const idx = readIndex(instanceDir(p));
  const content = [];
  for (const [key, meta] of Object.entries(idx.files)) {
    if (meta.source !== 'modrinth' || meta.dependency || meta.managed) continue;
    content.push({
      type: key.startsWith('resourcepacks/') ? 'resourcepack' : 'mod',
      projectId: meta.projectId,
      versionId: meta.versionId,
      title: meta.title
    });
  }
  const perf = perfState(p);
  return {
    format: 'nova-profile',
    v: 1,
    name: p.name,
    mc: p.mc,
    loader: p.loader,
    nova: !!p.nova,
    perf: { master: !!perf.master, off: perf.off },
    content
  };
}

async function exportProfile(id) {
  const p = find(id);
  const r = await ctx.dialog.showSaveDialog({
    title: 'Exportar perfil',
    defaultPath: `${safeName(p.name)}.novaprofile`,
    filters: [{ name: 'Perfil de Nova', extensions: ['novaprofile'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(snapshot(id), null, 2));
  return r.filePath;
}

function shareCode(id) {
  return `NOVA1:${zlib.deflateSync(Buffer.from(JSON.stringify(snapshot(id)))).toString('base64url')}`;
}

function parseShare(text) {
  const t = String(text || '').trim();
  let data;
  if (t.startsWith('NOVA1:')) {
    try {
      data = JSON.parse(zlib.inflateSync(Buffer.from(t.slice(6), 'base64url')).toString('utf8'));
    } catch {
      throw new Error('El código está incompleto o dañado.');
    }
  } else {
    try { data = JSON.parse(t); } catch { throw new Error('Eso no parece un perfil de Nova.'); }
  }
  if (!data || data.format !== 'nova-profile' || !data.mc) throw new Error('Eso no parece un perfil de Nova.');
  return data;
}

async function importData(data) {
  const p = create({ name: data.name, mc: data.mc, loader: data.loader, nova: data.nova, origin: 'pack' });
  const real = load().profiles.find((x) => x.id === p.id);
  real.perf = { master: !!data.perf?.master, off: Array.isArray(data.perf?.off) ? data.perf.off : [] };
  save();
  const total = (data.content || []).length;
  let n = 0;
  const failed = [];
  for (const c of data.content || []) {
    ctx.send('profile:progress', { id: p.id, text: `Instalando ${c.title || 'contenido'} (${++n}/${total})…` });
    try {
      let version = null;
      try { version = await mr(`/version/${encodeURIComponent(c.versionId)}`); } catch { /* se busca una compatible */ }
      if (!version || !version.game_versions?.includes(data.mc)) version = await bestVersion(real, c.projectId, c.type);
      if (!version) throw new Error('sin versión compatible');
      const info = await projectInfo(c.projectId);
      await installVersion(real, version, c.type, { title: info.title, icon: info.icon });
    } catch (e) {
      failed.push(`${c.title || c.projectId} (${e.message})`);
    }
  }
  ctx.send('profile:progress', { id: p.id, text: '' });
  return { profile: view(real), failed };
}

async function importFromFile() {
  const r = await ctx.dialog.showOpenDialog({
    title: 'Importar perfil',
    properties: ['openFile'],
    filters: [{ name: 'Perfil de Nova', extensions: ['novaprofile', 'json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return importData(parseShare(fs.readFileSync(r.filePaths[0], 'utf8')));
}

async function importFromCode(code) {
  return importData(parseShare(code));
}

// ───────────────────────── Servidores guardados ─────────────────────────

function listServers() {
  return load().servers;
}

function addServer(name, address) {
  const a = String(address || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(a)) throw new Error('La dirección no es válida (ej: play.ejemplo.com o play.ejemplo.com:25566).');
  const s = load();
  const server = { id: newId(), name: String(name || '').trim().slice(0, 40) || a, address: a };
  s.servers.push(server);
  save();
  return server;
}

function removeServer(id) {
  const s = load();
  s.servers = s.servers.filter((x) => x.id !== id);
  save();
}

module.exports = {
  init, PERF_MODS, instanceDir,
  ensureDefault, list, get, create, update, remove, duplicate, copyFrom, touchPlayed, setFolders,
  listContent, toggleContent, removeContent, addLocal,
  search, browse, installProject, identifyLocal, checkUpdates, updateContent, syncAll,
  getPerf, setPerf, ensurePerf,
  listWorlds, readLog,
  exportProfile, shareCode, importFromFile, importFromCode,
  listServers, addServer, removeServer,
  readIndex, writeIndex
};
