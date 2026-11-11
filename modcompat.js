'use strict';

// Detecta si un .jar de mod sirve para la versión de Minecraft y el cargador de un perfil.
// Lee fabric.mod.json / quilt.mod.json / META-INF/(neoforge.)mods.toml.

const AdmZip = require('adm-zip');

function parseVer(s) {
  const m = String(s).trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/);
  if (!m) return null;
  const n = (x) => (x === undefined ? null : /^[xX*]$/.test(x) ? null : Number(x));
  return [Number(m[1]), n(m[2]), n(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Una condición simple de semver de Fabric ("~1.21.9", ">=1.21", "1.21.x", "^1.20"...).
function matchAtom(atom, v) {
  atom = atom.trim();
  if (!atom || atom === '*' || atom === 'x') return true;
  const m = atom.match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
  if (!m) return null;
  const op = m[1] || '=';
  const t = parseVer(m[2]);
  if (!t) return null;
  const wild = t[1] === null || t[2] === null;
  if (op === '=') {
    if (cmp([t[0], t[1] ?? v[1], t[2] ?? v[2]], v) !== 0) return false;
    return true;
  }
  if (op === '>=') return cmp(v, t) >= 0;
  if (op === '>') return wild ? cmp(v, [t[0], (t[1] ?? 0) + 1, 0]) >= 0 : cmp(v, t) > 0;
  if (op === '<=') return cmp(v, t) <= 0 || (wild && cmp(v, [t[0], t[1] ?? 99999, 99999]) <= 0);
  if (op === '<') return cmp(v, t) < 0;
  if (op === '~') return v[0] === t[0] && (t[1] === null || v[1] === t[1]) && cmp(v, t) >= 0;
  if (op === '^') return v[0] === t[0] && cmp(v, t) >= 0;
  return null;
}

// Devuelve true / false, o null si no se puede decidir (versión rara, snapshot...).
function matchRange(range, mc) {
  const v = parseVer(mc);
  if (!v || /[a-z]/i.test(String(mc).replace(/^\d+(\.\d+)*/, ''))) return null;
  const alts = (Array.isArray(range) ? range : [range]).flatMap((r) => String(r).split('||'));
  let unknown = false;
  for (const alt of alts) {
    const atoms = alt.trim().split(/\s+/).filter(Boolean);
    let all = true;
    for (const a of atoms) {
      const r = matchAtom(a.replace(/^([<>=~^]+)\s*$/, '$1'), v);
      if (r === null) { unknown = true; all = false; break; }
      if (!r) { all = false; break; }
    }
    if (all) return true;
  }
  return unknown ? null : false;
}

// Maven range de Forge/NeoForge: "[1.21,1.22)", "[1.21.1]", "1.21.1".
function matchMaven(range, mc) {
  const v = parseVer(mc);
  if (!v) return null;
  const parts = String(range).match(/[\[(][^\])]*[\])]/g);
  if (!parts) { const t = parseVer(range); return t ? cmp(t, v) === 0 : null; }
  for (const p of parts) {
    const lo = p[0] === '[';
    const hi = p[p.length - 1] === ']';
    const [a, b] = p.slice(1, -1).split(',').map((x) => x.trim());
    if (b === undefined) { const t = parseVer(a); if (t && cmp(t, v) === 0) return true; continue; }
    const A = a ? parseVer(a) : null;
    const B = b ? parseVer(b) : null;
    const okLo = !A || (lo ? cmp(v, A) >= 0 : cmp(v, A) > 0);
    const okHi = !B || (hi ? cmp(v, B) <= 0 : cmp(v, B) < 0);
    if (okLo && okHi) return true;
  }
  return false;
}

function readTomlDep(text, modId) {
  // Busca [[dependencies.<id>]] con modId="minecraft" y versionRange="..."
  const blocks = text.split(/\[\[dependencies[^\]]*\]\]/).slice(1);
  for (const b of blocks) {
    if (/modId\s*=\s*["']minecraft["']/.test(b)) {
      const r = b.match(/versionRange\s*=\s*["']([^"']+)["']/);
      if (r) return r[1];
    }
  }
  void modId;
  return null;
}

// Lee un jar: { loader, mcRange, name, version, author }
function readModJar(file) {
  const info = { loader: null, mcRange: null };
  try {
    const zip = new AdmZip(file);
    const text = (n) => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8').replace(/^﻿/, '') : null; };
    const fab = text('fabric.mod.json');
    const quilt = text('quilt.mod.json');
    const neo = text('META-INF/neoforge.mods.toml');
    const forge = text('META-INF/mods.toml');
    if (fab) {
      const j = JSON.parse(fab);
      const a = j.authors && j.authors[0];
      info.loader = 'fabric';
      info.name = j.name || j.id;
      info.version = j.version;
      info.author = typeof a === 'string' ? a : a && a.name;
      info.mcRange = j.depends?.minecraft ?? null;
    } else if (quilt) {
      const j = JSON.parse(quilt);
      info.loader = 'quilt';
      const dep = (j.quilt_loader?.depends || []).find((d) => d === 'minecraft' || d?.id === 'minecraft');
      info.mcRange = dep && typeof dep === 'object' ? dep.versions ?? null : null;
    } else if (neo) {
      info.loader = 'neoforge';
      info.mcRange = readTomlDep(neo);
      info.mavenRange = true;
    } else if (forge) {
      info.loader = 'forge';
      info.mcRange = readTomlDep(forge);
      info.mavenRange = true;
    }
  } catch { /* jar ilegible */ }
  return info;
}

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };
const lname = (l) => LOADER_NAMES[l] || l;

// profile: { mc, loader }. Devuelve { status: 'ok' | 'bad' | 'unknown', reason, requires }
function checkCompat(info, profile) {
  const loader = profile.loader;
  if (!info || !info.loader) return { status: 'unknown', reason: 'No se pudo leer la información del mod.' };
  if (loader === 'fabric' && info.loader !== 'fabric' && info.loader !== 'quilt') {
    return { status: 'bad', reason: `Es un mod de ${lname(info.loader)}; este perfil usa Fabric.` };
  }
  if (loader === 'vanilla') return { status: 'bad', reason: 'Este perfil es Vanilla y no carga mods.' };
  if (!info.mcRange) return { status: 'unknown', reason: 'El mod no indica con qué versión de Minecraft funciona.' };
  const res = info.mavenRange ? matchMaven(info.mcRange, profile.mc) : matchRange(info.mcRange, profile.mc);
  const req = Array.isArray(info.mcRange) ? info.mcRange.join(' o ') : String(info.mcRange);
  if (res === true) return { status: 'ok', reason: `Compatible con Minecraft ${profile.mc}.`, requires: req };
  if (res === false) return { status: 'bad', reason: `Pide Minecraft ${req}; este perfil usa ${profile.mc}.`, requires: req };
  return { status: 'unknown', reason: `Pide Minecraft ${req}; no se pudo comprobar contra ${profile.mc}.`, requires: req };
}

module.exports = { readModJar, checkCompat, matchRange, matchMaven };
