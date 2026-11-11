'use strict';
// Sube los mod/nova-client-<versión>.jar que compilaste en tu PC al release «mods-rolling» de GitHub.
// Desde ahí el launcher baja solo el jar de la versión que elija el usuario.
//
// Uso:
//   npm run build:mod                 (compilás los jars en tu PC)
//   npm run publish:mods              (sube todos los de mod/)
//   npm run publish:mods -- 1.21.4    (sube solo esa versión)
//
// Necesita la variable NOVA_REPO (usuario/repositorio del launcher) y GitHub CLI (https://cli.github.com) con la sesión iniciada: gh auth login
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TAG = 'mods-rolling';
const modDir = path.join(__dirname, '..', 'mod');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const files = fs.existsSync(modDir)
  ? fs.readdirSync(modDir)
    .map((f) => ({ f, mc: /^nova-client-(.+)\.jar$/.exec(f)?.[1] }))
    .filter((x) => x.mc && (!only.length || only.includes(x.mc)))
    .map((x) => path.join(modDir, x.f))
  : [];

if (!files.length) {
  console.error('No hay jars para subir en mod/. Compilalos antes con: npm run build:mod');
  process.exit(1);
}

// Este proyecto va aparte del launcher: indicá su repo con  NOVA_REPO=usuario/repositorio  (el del launcher, donde está el release «mods-rolling»).
const REPO = process.env.NOVA_REPO ? ['--repo', process.env.NOVA_REPO] : [];
// En Windows el comando pasa por el shell: hay que entrecomillar cada argumento, o una ruta con espacios (p. ej. «Nova client de mod») se corta en pedazos.
const q = (a) => (process.platform === 'win32' ? `"${String(a).replace(/"/g, '\\"')}"` : a);
const gh = (args) => spawnSync('gh', [...args, ...REPO].map(q), { stdio: 'inherit', shell: process.platform === 'win32' });

if (spawnSync('gh', ['--version'], { shell: process.platform === 'win32' }).status !== 0) {
  console.error('Falta GitHub CLI (gh). Instalalo desde https://cli.github.com y corré: gh auth login');
  process.exit(1);
}

// Crea el release la primera vez (pre-lanzamiento, para no pisar el «último release» del launcher).
const exists = spawnSync('gh', ['release', 'view', TAG, ...REPO].map(q), { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
if (!exists) {
  const r = gh(['release', 'create', TAG, '--prerelease', '--title', 'Mods de Nova Client',
    '--notes', 'Nova Client para cada versión de Minecraft. Lo baja el launcher solo; no hace falta descargarlo a mano.']);
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(`Subiendo ${files.length} jar(s) a «${TAG}»…`);
const up = gh(['release', 'upload', TAG, ...files, '--clobber']);
process.exit(up.status || 0);
