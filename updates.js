'use strict';

// Actualizaciones en vivo del mod (Nova Client) desde GitHub Releases.
// Cada release trae los nova-client-<versión>.jar; el launcher baja los nuevos solo, sin reinstalar nada.

const fs = require('fs');
const path = require('path');

const CHECK_TIMEOUT_MS = 8000;

// "owner/repo" de GitHub: primero el override de nova.config.json, si no el que electron-builder
// dejó dentro de la app instalada (resources/app-update.yml).
function getRepo(appRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(appRoot, 'nova.config.json'), 'utf8'));
    if (/^[\w.-]+\/[\w.-]+$/.test(cfg.githubRepo || '')) return cfg.githubRepo;
  } catch { /* sin config */ }
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1];
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1];
    if (owner && repo) return `${owner}/${repo}`;
  } catch { /* en desarrollo no existe */ }
  return null;
}

function parseVer(v) {
  return String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}

// true si a > b (comparación de versiones tipo 1.2.10 > 1.2.9)
function versionGt(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function fetchJson(url, userAgent) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Baja un asset del release y lo deja en dest (escritura atómica). Verifica que sea un .jar (zip).
async function downloadAsset(asset, dest, userAgent) {
  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': userAgent },
    redirect: 'follow',
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`No se pudo bajar ${asset.name} (HTTP ${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < 1000 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error(`${asset.name} no es un .jar válido`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

function readIndex(cacheDir) {
  try { return JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8')); } catch { return { tag: '0.0.0', jars: {} }; }
}

/**
 * Mira el último release y descarga los .jar nuevos o cambiados a cacheDir.
 * Devuelve { tag, updated: [versiones de Minecraft] }.
 */
async function syncMods({ appRoot, cacheDir, userAgent, log }) {
  const repo = getRepo(appRoot);
  if (!repo) return { tag: null, updated: [], skipped: 'sin repositorio' };

  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, userAgent);
  const index = readIndex(cacheDir);
  index.jars = index.jars || {};
  fs.mkdirSync(cacheDir, { recursive: true });

  const updated = [];
  const changes = {};
  for (const asset of release.assets || []) {
    const mc = /^nova-client-(.+)\.jar$/.exec(asset.name)?.[1];
    if (!mc) continue;
    const local = index.jars[mc];
    const dest = path.join(cacheDir, asset.name);
    if (local && local.id === asset.id && fs.existsSync(dest)) continue;

    await downloadAsset(asset, dest, userAgent);
    changes[mc] = { id: asset.id, tag: release.tag_name };
    updated.push(mc);
    log?.(`[Actualizaciones] Nova Client ${mc} actualizado a ${release.tag_name}.`);
  }

  // Se vuelve a leer el índice: mientras se bajaba, el launcher pudo haber generado o bajado otro jar.
  const fresh = readIndex(cacheDir);
  fresh.jars = { ...(fresh.jars || {}), ...changes };
  fresh.tag = release.tag_name;
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(fresh, null, 2));
  return { tag: release.tag_name, updated };
}

// ── Jars publicados para TODAS las versiones ──
// Los jars se compilan en tu PC (npm run build:mod) y se suben con npm run publish:mods a un release fijo.
// Así, al elegir una versión que el instalador no trae, el launcher baja el jar de esa versión en segundos.
const ROLLING_TAG = 'mods-rolling';

async function rollingRelease(appRoot, userAgent) {
  const repo = getRepo(appRoot);
  if (!repo) return null;
  try {
    return await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${ROLLING_TAG}`, userAgent);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return null;   // todavía no existe: no pasa nada
    throw e;
  }
}

/** Baja nova-client-<mc>.jar del release fijo. Devuelve la ruta, o null si todavía no lo publicaste. */
async function fetchRolling({ appRoot, cacheDir, userAgent, mc, log }) {
  const release = await rollingRelease(appRoot, userAgent);
  const asset = (release?.assets || []).find((a) => a.name === `nova-client-${mc}.jar`);
  if (!asset) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, asset.name);
  await downloadAsset(asset, dest, userAgent);
  const index = readIndex(cacheDir);
  index.jars = index.jars || {};
  index.jars[mc] = { id: asset.id, tag: release.tag_name, rolling: true };
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index, null, 2));
  log?.(`[Nova Client] ${mc}: jar descargado del release «${ROLLING_TAG}».`);
  return dest;
}

/** Actualiza los jars que ya bajaste del release fijo si volviste a publicarlos. */
async function refreshRolling({ appRoot, cacheDir, userAgent, log }) {
  const index = readIndex(cacheDir);
  const mine = Object.entries(index.jars || {}).filter(([, j]) => j.rolling).map(([mc]) => mc);
  if (!mine.length) return [];
  const release = await rollingRelease(appRoot, userAgent);
  const updated = [];
  for (const mc of mine) {
    const asset = (release?.assets || []).find((a) => a.name === `nova-client-${mc}.jar`);
    if (!asset || index.jars[mc].id === asset.id) continue;
    await downloadAsset(asset, path.join(cacheDir, asset.name), userAgent);
    index.jars[mc] = { id: asset.id, tag: release.tag_name, rolling: true };
    updated.push(mc);
    log?.(`[Actualizaciones] Nova Client ${mc} actualizado (${ROLLING_TAG}).`);
  }
  if (updated.length) fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index, null, 2));
  return updated;
}

module.exports = { getRepo, versionGt, syncMods, readIndex, fetchRolling, refreshRolling, ROLLING_TAG };
