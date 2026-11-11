'use strict';

// Deja listo el jar de Nova Client para la versión de Minecraft que elige el usuario.
// Ya NO se genera nada en la PC del usuario: los .jar se compilan en tu PC (npm run build:mod) y se publican.
//   1. el que trae el instalador (carpeta mod/), o uno ya bajado y vigente;
//   2. si no hay, se baja del release «mods-rolling» de GitHub (npm run publish:mods los sube);
//   3. si tampoco está, el juego arranca igual, solo con Fabric.

const fs = require('fs');
const path = require('path');

/**
 * deps:
 *   bundledDir, cacheDir   carpetas de jars (instalador / bajados)
 *   appVersion, appRoot, userAgent
 *   updates                módulo updates.js
 *   status(text, pct), log(text)
 */
function createModManager(deps) {
  const { bundledDir, cacheDir, appVersion, updates } = deps;
  const inflight = new Map();   // mc -> Promise (dos perfiles de la misma versión comparten la descarga)

  const index = () => updates.readIndex(cacheDir);

  /** Jar vigente para esa versión, o null. El del instalador manda salvo que haya uno de un release más nuevo. */
  function jarFor(mc) {
    const bundled = path.join(bundledDir, `nova-client-${mc}.jar`);
    const cached = path.join(cacheDir, `nova-client-${mc}.jar`);
    const hasBundled = fs.existsSync(bundled);
    const hasCached = fs.existsSync(cached);
    const entry = index().jars?.[mc];
    if (hasBundled) {
      const newer = hasCached && entry?.tag && updates.versionGt(entry.tag, appVersion);
      return newer ? cached : bundled;
    }
    return hasCached ? cached : null;
  }

  /**
   * Devuelve { jar, source, reason }. jar = null si no hay forma de tenerlo (el juego se inicia solo con Fabric).
   * opts.force: vuelve a bajar el jar aunque ya haya uno.
   */
  async function ensure(mc, opts = {}) {
    if (!opts.force) {
      const have = jarFor(mc);
      if (have) return { jar: have, source: 'have' };
    }
    if (inflight.has(mc)) return inflight.get(mc);

    const run = (async () => {
      try {
        deps.status(`Buscando Nova Client ${mc}…`, null);
        const got = await updates.fetchRolling({ appRoot: deps.appRoot, cacheDir, userAgent: deps.userAgent, mc, log: deps.log });
        if (got) return { jar: got, source: 'download' };
        // Sin jar publicado para esa versión: si había uno viejo, se sigue usando.
        const old = jarFor(mc);
        if (old) return { jar: old, source: 'have' };
        return { jar: null, reason: `todavía no hay un jar publicado para esa versión` };
      } catch (e) {
        deps.log(`[Nova Client] No se pudo descargar el jar de ${mc}: ${e.message}`);
        const old = jarFor(mc);
        if (old) return { jar: old, source: 'have' };
        return { jar: null, reason: `no se pudo descargar (${e.message})` };
      }
    })().finally(() => inflight.delete(mc));
    inflight.set(mc, run);
    return run;
  }

  return { ensure, jarFor };
}

module.exports = { createModManager };
