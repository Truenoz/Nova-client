'use strict';

const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const AdmZip = require('adm-zip');
const { DiscordPresence } = require('./discord');
const updates = require('./updates');
const liveUpdate = require('./liveupdate');
const profiles = require('./profiles');
const skins = require('./skins');
const { downloadFile } = require('./util');
const { createModManager } = require('./modmanager');

// ───────────────────────── Constantes y rutas ─────────────────────────

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const DEFAULT_SETTINGS = {
  ramGB: 4,
  javaPath: '',
  lastVersion: '1.21.4',
  showSnapshots: false,
  closeOnLaunch: false,
  novaClient: true,
  discord: true,            // mostrar "Jugando Nova Client" en Discord
  discordClientId: '',      // vacío = usa nova.config.json
  lastProfile: '',
  language: 'es',
  openAtLogin: false,       // abrir el launcher al iniciar Windows
  startMode: 'tray',        // 'tray' = arranca oculto en la bandeja · 'window' = arranca con la ventana
  sendErrorReports: false,  // guarda los errores del launcher en un archivo local
  accent: 'orange',
  uiScale: 1,               // escala de la interfaz del launcher (fija en 100%)
  reduceMotion: false,
  hwAccel: true,
  jvmArgs: '',
  winWidth: 0,
  winHeight: 0,
  fullscreen: false
};



let mainWindow = null;
let session = null;        // { mc: Minecraft (msmc) }
let currentGame = null;    // { launcher, child }
let manifestCache = null;
let presence = null;       // Discord Rich Presence
let autoUpdater = null;    // electron-updater (solo en la app instalada)
const live = liveUpdate.create({ send: (p) => send('update:status', p), isGameRunning: () => !!currentGame });
let activeProfileId = null; // perfil que se está preparando / jugando
let tray = null;
const logBuffer = [];       // últimas líneas de registro (para «Exportar depuración»)

const gameDir = () => path.join(app.getPath('appData'), '.novalauncher');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const accountFile = () => path.join(app.getPath('userData'), 'account.bin');
const profilesFile = () => path.join(app.getPath('userData'), 'profiles.json');

// ───────────────────────── Utilidades ─────────────────────────

function send(channel, payload) {
  if (channel === 'game:log') {
    logBuffer.push(String(payload));
    if (logBuffer.length > 3000) logBuffer.splice(0, logBuffer.length - 2000);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function status(state, text, percent) {
  send('game:status', { state, text, percent: percent ?? null, profileId: state === 'idle' ? null : activeProfileId });
}

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  next.ramGB = Math.max(1, Math.min(64, Number(next.ramGB) || 4));
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// El refresh token se guarda cifrado con el almacén seguro del sistema (DPAPI en Windows).
function saveRefreshToken(token) {
  try {
    fs.mkdirSync(path.dirname(accountFile()), { recursive: true });
    const data = safeStorage.isEncryptionAvailable()
      ? Buffer.concat([Buffer.from('E1:'), safeStorage.encryptString(token)])
      : Buffer.concat([Buffer.from('P1:'), Buffer.from(token, 'utf8')]);
    fs.writeFileSync(accountFile(), data);
  } catch (e) {
    console.error('No se pudo guardar la sesión:', e);
  }
}

function loadRefreshToken() {
  try {
    const raw = fs.readFileSync(accountFile());
    const tag = raw.subarray(0, 3).toString();
    const body = raw.subarray(3);
    if (tag === 'E1:') return safeStorage.decryptString(body);
    if (tag === 'P1:') return body.toString('utf8');
  } catch { /* sin sesión guardada */ }
  return null;
}

function clearRefreshToken() {
  try { fs.unlinkSync(accountFile()); } catch { /* ya no existe */ }
}

function accountInfo() {
  if (!session) return null;
  const p = session.mc.profile;
  return { name: p?.name || 'Jugador', uuid: p?.id || '', offline: !!session.offline };
}

// ───────────────────────── Cuenta Microsoft ─────────────────────────

async function establishSession(xbox) {
  const mc = await xbox.getMinecraft(); // lanza error si la cuenta no tiene Minecraft Java
  session = { mc };
  saveRefreshToken(xbox.save());
  return accountInfo();
}

async function tryRestoreSession() {
  const token = loadRefreshToken();
  if (!token) return null;
  try {
    const xbox = await new Auth('select_account').refresh(token);
    return await establishSession(xbox);
  } catch (e) {
    console.error('No se pudo restaurar la sesión:', e);
    clearRefreshToken();
    return null;
  }
}

async function login() {
  const xbox = await new Auth('select_account').launch('electron', { width: 520, height: 700 });
  return establishSession(xbox);
}

// Inicio de sesión sin cuenta: modo offline local de Minecraft.
// No autentica cuentas ni permite entrar a servidores que exigen autenticación premium.
function offlineUuid(name) {
  const digest = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loginOffline(rawName) {
  const name = String(rawName || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('El nombre debe tener entre 3 y 16 caracteres: letras, números o guion bajo.');
  }
  const profile = { name, id: offlineUuid(name), skins: [] };
  const authorization = {
    access_token: '0',
    client_token: '0',
    uuid: profile.id.replace(/-/g, ''),
    name,
    user_properties: '{}',
    meta: { type: 'mojang', demo: false }
  };
  session = { offline: true, mc: { profile, mclc: () => authorization } };
  clearRefreshToken();
  return accountInfo();
}

// ───────────────────────── Versiones ─────────────────────────

async function getManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`No se pudo obtener la lista de versiones (HTTP ${res.status})`);
  manifestCache = await res.json();
  return manifestCache;
}

// Únicas versiones de Minecraft que se pueden elegir y descargar (no hay snapshots ni otras versiones).
const ALLOWED_VERSIONS = [
  '1.19.2', '1.19.3', '1.19.4',
  '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6',
  '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.10', '1.21.11',
  '26.1', '26.1.1', '26.1.2', '26.2', '26.3'
];
const ALLOWED_SET = new Set(ALLOWED_VERSIONS);

// Orden del manifiesto de Mojang (más nuevas primero), solo las versiones permitidas que Mojang ya publicó.
async function listVersions() {
  const manifest = await getManifest();
  return manifest.versions
    .filter((v) => ALLOWED_SET.has(v.id))
    .map((v) => ({ id: v.id, type: v.type }));
}

// Últimas notas de versión oficiales (las mismas que muestra el launcher de Mojang).
let lastNews = null; // última lista buena (por si no hay internet al refrescar)
async function getNews() {
  try {
    lastNews = await fetchNews();
  } catch (e) {
    if (!lastNews) throw e;
  }
  return lastNews;
}

async function fetchNews() {
  const base = 'https://launchercontent.mojang.com';
  const res = await fetch(`${base}/v2/javaPatchNotes.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.entries || [])
    .filter((e) => e.type === 'release')
    .slice(0, 3)
    .map((e) => ({
      title: e.title,
      version: e.version,
      date: e.date,
      image: e.image?.url ? new URL(e.image.url, base).href : null
    }));
}

async function requiredJavaMajor(versionId) {
  const manifest = await getManifest();
  if (!ALLOWED_SET.has(versionId)) throw new Error(`La versión ${versionId} no está disponible en Nova Client`);
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Versión desconocida: ${versionId}`);
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`No se pudo leer los datos de la versión (HTTP ${res.status})`);
  const meta = await res.json();
  return { major: meta.javaVersion?.majorVersion ?? 8, type: entry.type };
}

// ───────────────────────── Java automático (Windows) ─────────────────────────

function findFileRecursive(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    }
  }
  return null;
}

async function ensureJava(major) {
  const settings = readSettings();
  if (settings.javaPath && fs.existsSync(settings.javaPath)) return settings.javaPath;

  // Fuera de Windows se usa el Java del sistema.
  if (process.platform !== 'win32') return 'java';

  const adoptMajor = major <= 8 ? 8 : major <= 17 ? 17 : major <= 21 ? 21 : major;
  const runtimeDir = path.join(gameDir(), 'runtime', `jre-${adoptMajor}`);

  const existing = fs.existsSync(runtimeDir) ? findFileRecursive(runtimeDir, 'javaw.exe') : null;
  if (existing) return existing;

  status('preparing', `Descargando Java ${adoptMajor}…`, 0);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const zipPath = path.join(runtimeDir, 'jre.zip');
  const url = `https://api.adoptium.net/v3/binary/latest/${adoptMajor}/ga/windows/x64/jre/hotspot/normal/eclipse`;

  await downloadFile(url, zipPath, (p) => status('preparing', `Descargando Java ${adoptMajor}…`, p * 100));

  status('preparing', `Instalando Java ${adoptMajor}…`, null);
  new AdmZip(zipPath).extractAllTo(runtimeDir, true);
  fs.unlinkSync(zipPath);

  const javaw = findFileRecursive(runtimeDir, 'javaw.exe');
  if (!javaw) throw new Error('No se encontró javaw.exe tras instalar Java.');
  return javaw;
}

// ───────────────────────── Nova Client (mod de Fabric) ─────────────────────────

const novaModDir = () => app.isPackaged
  ? path.join(process.resourcesPath, 'mod')
  : path.join(__dirname, 'mod');
// Jars bajados por las actualizaciones en vivo (ver updates.js).
const novaCacheDir = () => path.join(app.getPath('userData'), 'mod-cache');
const userAgent = () => `NovaClient/${app.getVersion()}`;

function jarNames(dir) {
  try {
    return fs.readdirSync(dir)
      .map((f) => /^nova-client-(.+)\.jar$/.exec(f)?.[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Versiones de Minecraft para las que hay un nova-client-<versión>.jar (incluido o descargado).
function novaVersions() {
  return [...new Set([...jarNames(novaModDir()), ...jarNames(novaCacheDir())])];
}

// ── Jar de Nova Client según la versión elegida: el del instalador o el que se baja del release «mods-rolling» ──
let modManager = null;
function novaMods() {
  if (!modManager) {
    modManager = createModManager({
      bundledDir: novaModDir(),
      cacheDir: novaCacheDir(),
      appVersion: app.getVersion(),
      appRoot: __dirname,
      userAgent: userAgent(),
      updates,
      status: (text, pct) => status('preparing', text, pct),
      log: (m) => send('game:log', m)
    });
  }
  return modManager;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${new URL(url).host}`);
  return res.json();
}

// Instala (si hace falta) el perfil de Fabric para esa versión y devuelve su id.
async function ensureFabric(mc) {
  const versionsDir = path.join(gameDir(), 'versions');
  try {
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
    const pick = loaders.find((l) => l.loader.stable) || loaders[0];
    if (!pick) throw new Error(`Fabric no soporta Minecraft ${mc}`);
    const loader = pick.loader.version;
    const id = `fabric-loader-${loader}-${mc}`;
    const jsonPath = path.join(versionsDir, id, `${id}.json`);
    if (!fs.existsSync(jsonPath)) {
      status('preparing', 'Instalando Fabric…', null);
      const profile = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`);
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
    }
    return id;
  } catch (e) {
    // Sin internet: usar un Fabric ya instalado, si lo hay.
    if (fs.existsSync(versionsDir)) {
      const old = fs.readdirSync(versionsDir)
        .filter((d) => d.startsWith('fabric-loader-') && d.endsWith(`-${mc}`))
        .sort().pop();
      if (old) return old;
    }
    throw e;
  }
}

async function ensureFabricApi(mc, modsDir) {
  const existing = () => fs.readdirSync(modsDir).filter((f) => /^fabric-api-.*\.jar$/i.test(f));
  try {
    const q = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent('["fabric"]')}`;
    const versions = await fetchJson(`https://api.modrinth.com/v2/project/fabric-api/version?${q}`);
    const v = versions.find((x) => x.version_type === 'release') || versions[0];
    const file = v && (v.files.find((f) => f.primary) || v.files[0]);
    if (!file) throw new Error('Fabric API no disponible para esta versión');
    const dest = path.join(modsDir, file.filename);
    // Un jar a medio bajar o dañado hace que Fabric diga «falta fabric-api» aunque el archivo esté: se verifica.
    const intact = (f) => {
      try {
        const z = new AdmZip(f);
        if (!z.getEntry('fabric.mod.json')) return false;
        const want = file.hashes && file.hashes.sha512;
        return !want || require('crypto').createHash('sha512').update(fs.readFileSync(f)).digest('hex') === want;
      } catch { return false; }
    };
    if (!fs.existsSync(dest) || !intact(dest)) {
      for (const old of existing()) fs.unlinkSync(path.join(modsDir, old));
      status('preparing', 'Descargando Fabric API…', 0);
      await downloadFile(file.url, dest, (p) => status('preparing', 'Descargando Fabric API…', p * 100));
      if (!intact(dest)) throw new Error('Fabric API se descargó dañada; reintentá');
    }
  } catch (e) {
    if (!existing().length) throw e;   // sin internet pero ya descargada: seguir
  }
}

// Copia el jar de Nova Client a la carpeta de mods y corrige dos fallos de los jars ya publicados. Los Fabric API viejos (hasta 1.19.x) se llaman "fabric" y no
// "fabric-api", así que un mod que declara «depends: fabric-api» no los encuentra. Se cambia esa dependencia por
// «fabric-api-base», un módulo que trae TODA versión de Fabric API. Así funcionan también los jars ya publicados.
function installNovaJar(src, dest) {
  fs.copyFileSync(src, dest);
  try {
    const z = new AdmZip(dest);
    const entry = z.getEntry('fabric.mod.json');
    if (!entry) return;
    const meta = JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    let changed = false;
    if (meta.depends && Object.prototype.hasOwnProperty.call(meta.depends, 'fabric-api')) {
      meta.depends['fabric-api-base'] = meta.depends['fabric-api'];
      delete meta.depends['fabric-api'];
      changed = true;
    }
    // Los jars ya publicados para 1.19/1.20 declaran novaclient.mixins.json pero se compilaron sin ese archivo:
    // Mixin tira «was invalid or could not be read». Se quitan de fabric.mod.json los mixins que no están en el jar.
    if (Array.isArray(meta.mixins)) {
      const ok = meta.mixins.filter((m) => z.getEntry(typeof m === 'string' ? m : m && m.config));
      if (ok.length !== meta.mixins.length) { meta.mixins = ok; changed = true; }
    }
    if (changed) {
      z.updateFile('fabric.mod.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
      z.writeZip(dest);
    }
  } catch (e) {
    send('game:log', `[Nova Client] No se pudo ajustar la dependencia de Fabric API: ${e.message}`);
  }
}

// Deja listo el perfil de Fabric: loader, Fabric API, mods de rendimiento, sincronización y Nova Client.
// Devuelve el id de versión de Fabric (o null si el perfil es Vanilla).
async function prepareProfile(profile, inst) {
  const modsDir = path.join(inst, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  if (profile.loader !== 'fabric') {
    // Sin Fabric no hay mods: si quedó un Nova Client de antes, se saca para que no estorbe.
    for (const f of fs.readdirSync(modsDir)) if (/^nova-client.*\.jar$/i.test(f)) fs.unlinkSync(path.join(modsDir, f));
    return null;
  }

  const custom = await ensureFabric(profile.mc);
  if (profile.fabricApi !== false) await ensureFabricApi(profile.mc, modsDir);

  if (profile.autoSync) {
    status('preparing', 'Sincronizando contenido…', null);
    const n = await profiles.syncAll(profile.id);
    if (n) send('game:log', `[Sincronización] ${n} elemento(s) actualizado(s).`);
  }
  status('preparing', 'Preparando mods de rendimiento…', null);
  await profiles.ensurePerf(profile.id);

  for (const f of fs.readdirSync(modsDir)) {
    if (/^nova-client.*\.jar$/i.test(f)) fs.unlinkSync(path.join(modsDir, f));
  }
  if (profile.nova) {
    status('preparing', 'Buscando actualizaciones de Nova Client…', null);
    await syncNovaMods('launch');
    // Si no hay jar para esta versión, se baja del release «mods-rolling».
    let found = null;
    try {
      found = await novaMods().ensure(profile.mc);
    } catch (e) {
      send('game:log', `[Nova Client] Error al preparar el mod: ${e.message}`);
    }
    if (found?.jar && fs.existsSync(found.jar)) {
      installNovaJar(found.jar, path.join(modsDir, 'nova-client.jar'));
    } else {
      send('game:log', `[Nova Client] No hay Nova Client para Minecraft ${profile.mc}${found?.reason ? ` (${found.reason})` : ''}. Se inicia solo con Fabric.`);
    }
  }
  return custom;
}

// ───────────────────────── Actualizaciones en vivo ─────────────────────────

function sendUpdate(payload) {
  send('update:status', payload);
}

// Baja los jars nuevos del mod. Nunca lanza: si falla, se sigue con lo que ya hay.
async function syncNovaMods(reason) {
  try {
    const r = await updates.syncMods({
      appRoot: __dirname,
      cacheDir: novaCacheDir(),
      userAgent: userAgent(),
      log: (m) => send('game:log', m)
    });
    // Jars que ya bajaste del release «mods-rolling» (los que subiste con publish:mods): si los volviste a publicar, se actualizan.
    try {
      const again = await updates.refreshRolling({ appRoot: __dirname, cacheDir: novaCacheDir(), userAgent: userAgent(), log: (m) => send('game:log', m) });
      r.updated = [...r.updated, ...again];
    } catch { /* sin conexión o sin release: se sigue con lo que hay */ }
    if (r.updated.length) sendUpdate({ kind: 'mods', state: 'updated', tag: r.tag, versions: r.updated });
    return r;
  } catch (e) {
    if (reason === 'manual') send('game:log', `[Actualizaciones] No se pudo buscar el mod: ${e.message}`);
    return { tag: null, updated: [] };
  }
}

// Actualizador falso para probar el cartel sin publicar nada: NOVA_FAKE_UPDATE=1 npm start
function fakeUpdater() {
  const { EventEmitter } = require('events');
  const u = new EventEmitter();
  let offered = false;
  u.checkForUpdates = async () => {
    u.emit('checking-for-update');
    if (offered) return u.emit('update-not-available');
    offered = true;
    setTimeout(() => u.emit('update-available', { version: '9.9.9' }), 500);
  };
  u.downloadUpdate = async () => {
    for (let p = 0; p <= 100; p += 20) { await new Promise((r) => setTimeout(r, 400)); u.emit('download-progress', { percent: p }); }
    u.emit('update-downloaded', { version: '9.9.9' });
  };
  u.quitAndInstall = () => send('game:log', '[Actualizaciones] (simulado) quitAndInstall');
  return u;
}

function setupAutoUpdater() {
  if (!app.isPackaged && !process.env.NOVA_FAKE_UPDATE) return;
  try {
    autoUpdater = app.isPackaged ? require('electron-updater').autoUpdater : fakeUpdater();
  } catch (e) {
    console.error('electron-updater no disponible:', e);
    return;
  }
  live.attach(autoUpdater);
}

async function checkForUpdates(reason) {
  const results = { launcher: 'unsupported', mods: [] };
  if (autoUpdater && !live.isBusy()) {
    try { results.launcher = await live.check(); } catch { results.launcher = 'error'; }
  }
  const r = await syncNovaMods(reason);
  results.mods = r.updated;
  if (reason === 'manual' && !autoUpdater) sendUpdate({ kind: 'launcher', state: 'none' });
  return results;
}

function scheduleUpdateChecks() {
  setTimeout(() => checkForUpdates('auto'), 3000);
  setInterval(() => checkForUpdates('auto'), 30 * 60 * 1000).unref();
}

// ───────────────────────── Discord ─────────────────────────

function discordClientId(settings) {
  if (settings.discordClientId) return settings.discordClientId;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'nova.config.json'), 'utf8')).discordClientId || '';
  } catch {
    return '';
  }
}

// Servidor de amistades de Nova Client (carpeta server/). Vacío = sin amigos en línea ni logo para otros jugadores.
function novaNetUrl(settings) {
  const own = String(settings.novaNetUrl || '').trim();
  if (own) return own;
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, 'nova.config.json'), 'utf8')).novaNetUrl || '').trim();
  } catch {
    return '';
  }
}

// Clave (o URL https) de la imagen grande. Vacío = sin imagen (evita el «?» si no se subió el arte).
function discordImage(settings) {
  if (settings.discordLargeImage) return settings.discordLargeImage;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'nova.config.json'), 'utf8')).discordLargeImage || '';
  } catch {
    return '';
  }
}

function showPresence(settings, versionId, withNova) {
  if (!settings.discord) return;
  presence = new DiscordPresence(discordClientId(settings), (m) => send('game:log', m));
  presence.start({
    details: `Minecraft ${versionId}`,
    state: withNova ? 'Jugando con Nova Client' : 'Jugando Minecraft',
    timestamps: { start: Math.floor(Date.now() / 1000) },
    ...(discordImage(settings) ? { assets: { large_image: discordImage(settings), large_text: 'Nova Client' } } : {}),
    instance: false
  });
}

function hidePresence() {
  if (presence) presence.stop();
  presence = null;
}

// ───────────────────────── Lanzamiento del juego ─────────────────────────

// ¿Esta versión entiende --quickPlayMultiplayer? (1.20+ y las versiones nuevas con otro formato de número)
function supportsQuickPlay(mc) {
  const m = /^1\.(\d+)/.exec(mc);
  return !m || Number(m[1]) >= 20;
}

async function launchGame(profileId, opts = {}) {
  if (currentGame) throw new Error('El juego ya está en ejecución.');
  if (!session) throw new Error('Iniciá sesión con Microsoft o elegí Jugar sin cuenta.');

  const profile = profiles.get(profileId);
  const settings = writeSettings({ lastProfile: profileId, lastVersion: profile.mc });
  const inst = profile.dir;
  fs.mkdirSync(inst, { recursive: true });
  activeProfileId = profileId;
  currentGame = { launcher: null, child: null, profileId, startedAt: 0 };

  try {
    status('preparing', 'Preparando…', null);
    const { major, type } = await requiredJavaMajor(profile.mc);
    const javaPath = await ensureJava(major);

    // Refresca el token de Minecraft si está por vencer.
    if (!session.offline) { try { await session.mc.refresh(); } catch { /* si falla, se intenta con el actual */ } }

    const customVersion = await prepareProfile(profile, inst);

    const launcher = new Client();
    const ram = profile.ramGB || settings.ramGB;

    launcher.on('debug', (m) => send('game:log', String(m)));
    launcher.on('data', (m) => send('game:log', String(m)));
    launcher.on('progress', (e) => {
      if (e && e.total) status('downloading', `Descargando ${labelFor(e.type)}…`, (e.task / e.total) * 100);
    });
    launcher.on('close', (code) => {
      const g = currentGame;
      currentGame = null;
      activeProfileId = null;
      if (g && g.startedAt) profiles.touchPlayed(g.profileId, (Date.now() - g.startedAt) / 1000);
      hidePresence();
      live.onGameExit();
      status('idle', code === 0 ? 'Juego cerrado.' : `El juego se cerró (código ${code}).`, null);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
      }
    });

    const jvm = `${settings.jvmArgs || ''} ${profile.jvmArgs || ''}`.trim().split(/\s+/).filter(Boolean);

    // Diagnóstico: se informa qué hay en la carpeta de mods y qué id declara el jar de Fabric API.
    if (customVersion) {
      try {
        const modsDir = path.join(inst, 'mods');
        const files = fs.readdirSync(modsDir);
        send('game:log', `[Diagnóstico] Carpeta del juego: ${inst}`);
        send('game:log', `[Diagnóstico] Mods: ${files.map((f) => `${f} (${Math.round(fs.statSync(path.join(modsDir, f)).size / 1024)} KB)`).join(', ') || '(vacía)'}`);
        const api = files.find((f) => /^fabric-api-.*\.jar$/i.test(f));
        if (api) {
          const apiPath = path.join(modsDir, api);
          const entry = new AdmZip(apiPath).getEntry('fabric.mod.json');
          if (entry) {
            const meta = JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/, ''));
            send('game:log', `[Diagnóstico] ${api}: id="${meta.id}" version="${meta.version}" provides=${JSON.stringify(meta.provides || [])}`);
          } else {
            send('game:log', `[Diagnóstico] ${api}: NO contiene fabric.mod.json (jar inválido)`);
          }
        } else {
          send('game:log', '[Diagnóstico] No hay ningún fabric-api-*.jar en la carpeta de mods.');
        }
      } catch (e) {
        send('game:log', `[Diagnóstico] No se pudo revisar la carpeta de mods: ${e.message}`);
      }
    }
    // Diagnóstico de autenticación: no registra tokens ni credenciales.
    // En modo offline, el servidor debe aceptar explícitamente autenticación offline.
    const launchAuthorization = session.mc.mclc();
    send('game:log', `[Autenticación] Modo: ${session.offline ? 'OFFLINE (sin cuenta Microsoft)' : 'MICROSOFT'}`);
    send('game:log', `[Autenticación] Perfil: ${launchAuthorization.name || '(sin nombre)'}`);
    send('game:log', `[Autenticación] UUID: ${launchAuthorization.uuid || '(sin UUID)'}`);
    send('game:log', `[Autenticación] Tipo: ${launchAuthorization.meta?.type || '(sin tipo)'}`);
    if (session.offline && launchAuthorization.meta?.type !== 'mojang') {
      throw new Error('La sesión offline de Nova está mal configurada: tipo de autenticación inesperado.');
    }

    const launchOpts = {
      authorization: launchAuthorization,
      root: gameDir(),
      javaPath,
      version: customVersion ? { number: profile.mc, type, custom: customVersion } : { number: profile.mc, type },
      memory: { max: `${ram}G`, min: `${Math.max(1, Math.min(2, ram))}G` },
      overrides: { gameDirectory: inst }
    };
    const netUrl = novaNetUrl(settings);
    if (customVersion && profile.nova && /^https?:\/\/[^\s]+$/.test(netUrl)) jvm.push(`-Dnovaclient.net=${netUrl}`);
    if (jvm.length) launchOpts.customArgs = jvm;
    if (settings.fullscreen || (settings.winWidth > 0 && settings.winHeight > 0)) {
      launchOpts.window = { width: settings.winWidth || 1280, height: settings.winHeight || 720, fullscreen: !!settings.fullscreen };
    }
    if (opts.server) {
      launchOpts.quickPlay = { type: supportsQuickPlay(profile.mc) ? 'multiplayer' : 'legacy', identifier: opts.server };
    }

    currentGame.launcher = launcher;
    status('downloading', 'Verificando archivos del juego…', null);

    const child = await launcher.launch(launchOpts);
    if (!child) throw new Error('No se pudo iniciar el juego. Revisá el registro para más detalles.');

    currentGame.child = child;
    currentGame.startedAt = Date.now();
    status('running', 'Minecraft en ejecución', null);
    showPresence(settings, profile.mc, !!(customVersion && profile.nova));
    if (settings.closeOnLaunch && mainWindow) mainWindow.hide();
  } catch (e) {
    currentGame = null;
    activeProfileId = null;
    throw e;
  }
}

function labelFor(type) {
  switch (type) {
    case 'classes': return 'librerías';
    case 'assets': return 'recursos';
    case 'natives': return 'nativos';
    case 'classes-custom':
    case 'classes-maven-custom': return 'componentes';
    default: return 'archivos';
  }
}

function stopGame() {
  if (currentGame?.child) currentGame.child.kill();
}

// ───────────────────────── Ventana ─────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0d0d0d',
    title: 'Nova Client',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Escala de la interfaz (como en Dawn): todo se ve más grande. Se puede cambiar en Ajustes > Apariencia.
  mainWindow.webContents.on('did-finish-load', () => {
    const z = 1; // tamaño de interfaz fijo al 100%
    mainWindow.webContents.setZoomFactor(Math.max(0.8, Math.min(1.6, z)));
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('maximize', () => send('win:maximized', true));
  mainWindow.on('unmaximize', () => send('win:maximized', false));
  mainWindow.once('ready-to-show', () => {
    if (!startHidden()) mainWindow.show();
  });

  // Los enlaces externos se abren en el navegador, nunca dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ───────────────────────── IPC ─────────────────────────

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[${channel}]`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

handle('app:info', () => ({
  version: app.getVersion(),
  gameDir: gameDir(),
  dataDir: app.getPath('userData'),
  totalRamGB: Math.floor(os.totalmem() / 1024 ** 3),
  platform: process.platform,
  electron: process.versions.electron,
  node: process.versions.node,
  novaVersions: novaVersions(),
  novaJar: novaVersions().length > 0,
  discordConfigured: new DiscordPresence(discordClientId(readSettings())).enabled,
  canAutoUpdate: app.isPackaged,
  running: currentGame ? { profileId: currentGame.profileId } : null
}));

handle('settings:get', () => readSettings());
handle('settings:set', (patch) => {
  const next = writeSettings(patch || {});
  if (patch && patch.uiScale !== undefined && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(Math.max(0.8, Math.min(1.6, Number(next.uiScale) || 1.2)));
  }
  applySystemSettings(next);
  return next;
});
handle('versions:list', () => listVersions());
handle('news:list', () => getNews());
handle('shell:external', (url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Enlace no permitido.');
  return shell.openExternal(url);
});

handle('auth:restore', () => tryRestoreSession());
handle('auth:login', () => login());
handle('auth:offline', (name) => loginOffline(name));
handle('auth:logout', () => {
  session = null;
  clearRefreshToken();
  return null;
});

handle('update:check', () => checkForUpdates('manual'));
handle('update:hold', () => live.hold());
handle('update:start', () => live.start());
handle('update:install', () => live.start());

handle('game:launch', (profileId, opts) => launchGame(String(profileId), opts || {}));
handle('game:stop', () => stopGame());
handle('folder:open', () => {
  fs.mkdirSync(gameDir(), { recursive: true });
  return shell.openPath(gameDir());
});
handle('data:open', () => shell.openPath(app.getPath('userData')));

// ── Perfiles ──
function notRunning(id) {
  if (currentGame && currentGame.profileId === id) throw new Error('Cerrá el juego antes de hacer eso con este perfil.');
}

handle('profiles:list', () => profiles.list());
handle('profiles:get', (id) => profiles.get(id));
handle('profiles:create', (input) => profiles.create(input || {}));
handle('profiles:update', (id, patch) => profiles.update(id, patch || {}));
handle('profiles:delete', (id) => { notRunning(id); profiles.remove(id); });
handle('profiles:duplicate', (id) => profiles.duplicate(id));
handle('profiles:copyFrom', (id, sourceId) => { notRunning(id); return profiles.copyFrom(id, sourceId); });
handle('profiles:folders', (action, name) => profiles.setFolders(action, name));
handle('profiles:openFolder', (id) => {
  const dir = profiles.get(id).dir;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
handle('profiles:export', (id) => profiles.exportProfile(id));
handle('profiles:share', (id) => {
  const code = profiles.shareCode(id);
  clipboard.writeText(code);
  return code;
});
handle('profiles:importFile', () => profiles.importFromFile());
handle('profiles:importCode', (code) => profiles.importFromCode(code));

// ── Contenido ──
handle('content:list', (id) => profiles.listContent(id));
handle('content:toggle', (id, file, enabled) => { notRunning(id); profiles.toggleContent(id, file, !!enabled); });
handle('content:remove', (id, file) => { notRunning(id); profiles.removeContent(id, file); });
handle('content:search', (id, q) => profiles.search(id, q || {}));
handle('content:browse', (q) => profiles.browse(q || {}));
handle('content:install', (id, projectId, type) => { notRunning(id); return profiles.installProject(id, String(projectId), type); });
handle('content:update', (id, file) => { notRunning(id); return profiles.updateContent(id, file); });
handle('content:identify', (id) => profiles.identifyLocal(id));
handle('content:checkUpdates', async (id) => (await profiles.checkUpdates(id)).map((u) => u.key));
// El selector y la copia van separados para que la interfaz pueda mostrar "Importando archivos locales".
handle('content:pickLocal', async (id) => {
  notRunning(id);
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Añadir contenido',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods y paquetes de recursos', extensions: ['jar', 'zip'] }]
  });
  return r.canceled ? [] : r.filePaths;
});
handle('content:addLocal', async (id, filePaths) => {
  notRunning(id);
  if (!Array.isArray(filePaths)) throw new Error('No se indicaron archivos.');
  return profiles.addLocal(id, filePaths.map(String));
});
handle('perf:get', (id) => profiles.getPerf(id));
handle('perf:set', (id, patch) => { notRunning(id); return profiles.setPerf(id, patch || {}); });

// ── Mundos, registros, servidores ──
handle('worlds:list', (id) => profiles.listWorlds(id));
handle('worlds:open', (id, name) => {
  const dir = path.join(profiles.get(id).dir, 'saves', path.basename(String(name)));
  return shell.openPath(dir);
});
handle('logs:read', (id) => profiles.readLog(id));

// ── Skins (visor 3D) ──
// Skin de cualquier jugador por nombre o UUID.
handle('skin:get', (query, opts) => {
  skins.init(path.join(app.getPath('userData'), 'skin-cache'));
  return skins.getSkin(query, { force: !!opts?.force });
});
// Skin de la cuenta con sesión iniciada: usa la URL y el modelo (slim/classic) que ya informa la sesión.
handle('skin:mine', (opts) => {
  if (!session) throw new Error('No hay sesión iniciada.');
  skins.init(path.join(app.getPath('userData'), 'skin-cache'));
  const p = session.mc.profile || {};
  if (session.offline) return skins.getSkin(p.name, { force: !!opts?.force });
  const active = (p.skins || []).find((s) => s.state === 'ACTIVE') || (p.skins || [])[0];
  return skins.getSkin(p.id, {
    force: !!opts?.force,
    known: { name: p.name, skinUrl: active?.url, model: String(active?.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'classic' }
  });
});

handle('servers:list', () => profiles.listServers());
handle('servers:add', (name, address) => profiles.addServer(name, address));
handle('servers:remove', (id) => profiles.removeServer(id));

// ── Ajustes avanzados ──
handle('debug:export', async () => {
  const zip = new AdmZip();
  const s = readSettings();
  delete s.discordClientId;
  zip.addFile('info.txt', Buffer.from([
    `Nova Client ${app.getVersion()}`,
    `Electron ${process.versions.electron} · Node ${process.versions.node}`,
    `${process.platform} ${os.release()} · ${Math.floor(os.totalmem() / 1024 ** 3)} GB de RAM`,
    `Carpeta del juego: ${gameDir()}`,
    `Mods de Nova compilados: ${novaVersions().join(', ') || 'ninguno'}`
  ].join('\n')));
  zip.addFile('settings.json', Buffer.from(JSON.stringify(s, null, 2)));
  zip.addFile('launcher-log.txt', Buffer.from(logBuffer.join('\n')));
  try { zip.addLocalFile(profilesFile()); } catch { /* aún no hay perfiles */ }
  for (const p of profiles.list().profiles) {
    const log = profiles.readLog(p.id);
    if (log) zip.addFile(`perfiles/${p.id}-latest.log`, Buffer.from(log));
  }
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar depuración',
    defaultPath: path.join(app.getPath('desktop'), `nova-depuracion-${new Date().toISOString().slice(0, 10)}.zip`),
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePath) return null;
  zip.writeZip(r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

handle('danger:clearCache', () => {
  fs.rmSync(novaCacheDir(), { recursive: true, force: true });
  manifestCache = null;
});
handle('danger:clearJava', () => {
  if (currentGame) throw new Error('Cerrá Minecraft primero.');
  fs.rmSync(path.join(gameDir(), 'runtime'), { recursive: true, force: true });
});

handle('danger:resetSettings', () => {
  fs.rmSync(settingsFile(), { force: true });
  const next = readSettings();
  applySystemSettings(next);
  return next;
});

ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());

// ───────────────────────── Bandeja, inicio con Windows y errores ─────────────────────────

// ¿Arranca oculto? Solo cuando Windows lo abre al iniciar y el modo elegido es «bandeja».
function startHidden() {
  const s = readSettings();
  return process.argv.includes('--hidden') && s.openAtLogin && s.startMode === 'tray';
}

function applySystemSettings(s) {
  if (!app.isPackaged) return; // en desarrollo no se registra nada en el sistema
  try {
    app.setLoginItemSettings({ openAtLogin: !!s.openAtLogin, args: s.startMode === 'tray' ? ['--hidden'] : [] });
  } catch (e) {
    console.error('No se pudo configurar el inicio con el sistema:', e);
  }
}

function showMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png')).resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(icon);
    tray.setToolTip('Nova Client');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir lanzador', click: showMainWindow },
      { label: 'Salir del launcher', click: () => app.quit() }
    ]));
    tray.on('click', showMainWindow);
  } catch (e) {
    console.error('No se pudo crear el ícono de la bandeja:', e);
  }
}

// Con «Enviar informes de errores» activo, los errores inesperados quedan en un archivo local.
function installErrorReporter() {
  const write = (kind, err) => {
    try {
      if (!readSettings().sendErrorReports) return;
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'errores.log'),
        `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : err}\n\n`);
    } catch { /* no se puede registrar el error del registro */ }
  };
  process.on('uncaughtException', (e) => { write('uncaughtException', e); console.error(e); });
  process.on('unhandledRejection', (e) => write('unhandledRejection', e));
}

// ───────────────────────── Ciclo de vida ─────────────────────────

if (!readSettings().hwAccel) app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(() => {
    profiles.init({
      storeFile: profilesFile,
      gameDir,
      userAgent,
      send,
      log: (m) => send('game:log', m),
      dialog: { showSaveDialog: (o) => dialog.showSaveDialog(mainWindow, o), showOpenDialog: (o) => dialog.showOpenDialog(mainWindow, o) }
    });
    profiles.ensureDefault(readSettings());
    installErrorReporter();
    createWindow();
    createTray();
    setupAutoUpdater();
    scheduleUpdateChecks();
  });
  app.on('before-quit', hidePresence);
  app.on('window-all-closed', () => app.quit());
}
