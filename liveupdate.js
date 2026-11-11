'use strict';

// Flujo de actualización del launcher (cuando subís una versión nueva a GitHub Releases):
//  - Al abrir el launcher (y cada 30 min) se busca. Si hay una versión nueva, aparece el cartel "Actualización disponible".
//  - Minecraft cerrado: el cartel hace una cuenta regresiva de 10 s y el launcher se actualiza solo (baja, cierra y reinstala).
//  - Minecraft abierto: es manual. El usuario toca el cartel y elige «Continuar» (baja ya; se instala al cerrar Minecraft) o «Cancelar».
// Estados que recibe la interfaz (kind: 'launcher'):
//   available | countdown (seconds) | downloading (percent) | ready (waitingGame) | none | error

const COUNTDOWN_SEC = 10;
const INSTALL_DELAY_MS = 1500;

function create({ send, isGameRunning, countdownSec = COUNTDOWN_SEC, installDelayMs = INSTALL_DELAY_MS }) {
  let updater = null;
  let version = null;        // versión nueva detectada
  let timer = null;
  let seconds = 0;
  let cancelledFor = null;   // versión que el usuario canceló: no se vuelve a empezar sola
  let downloading = false;
  let ready = false;
  let installOnExit = false;

  const emit = (p) => send({ kind: 'launcher', ...p });
  const pending = () => !!version && !ready;

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function install() {
    stopTimer();
    emit({ state: 'ready', version, installing: true });
    setTimeout(() => updater.quitAndInstall(false, true), installDelayMs);
  }

  function beginDownload() {
    if (downloading || ready) return;
    stopTimer();
    downloading = true;
    emit({ state: 'downloading', version, percent: 0 });
    Promise.resolve(updater.downloadUpdate()).catch((e) => {
      downloading = false;
      emit({ state: 'error', message: e?.message || String(e) });
      if (version) emit({ state: 'available', version });
    });
  }

  function startCountdown() {
    stopTimer();
    seconds = countdownSec;
    emit({ state: 'countdown', version, seconds });
    timer = setInterval(() => {
      // Si mientras tanto se abrió Minecraft, se pasa a manual.
      if (isGameRunning()) { stopTimer(); emit({ state: 'available', version }); return; }
      seconds -= 1;
      if (seconds <= 0) { beginDownload(); return; }
      emit({ state: 'countdown', version, seconds });
    }, 1000);
    if (timer.unref) timer.unref();
  }

  function attach(u) {
    updater = u;
    u.autoDownload = false;
    u.autoInstallOnAppQuit = true;
    u.logger = null;
    // Mientras hay una actualización pendiente no se muestran los "buscando…" para que el cartel no parpadee.
    u.on('checking-for-update', () => { if (!pending() && !downloading) emit({ state: 'checking' }); });
    u.on('update-not-available', () => { if (!pending() && !downloading) emit({ state: 'none' }); });
    u.on('update-available', (i) => {
      if (ready || downloading || timer) return;
      version = i.version;
      if (cancelledFor === version || isGameRunning()) emit({ state: 'available', version });
      else startCountdown();
    });
    u.on('download-progress', (p) => emit({ state: 'downloading', version, percent: Math.round(p.percent) }));
    u.on('update-downloaded', (i) => {
      downloading = false;
      ready = true;
      version = i.version || version;
      if (isGameRunning()) {
        installOnExit = true;
        emit({ state: 'ready', version, waitingGame: true });
      } else {
        install();
      }
    });
    u.on('error', (e) => {
      if (downloading) { downloading = false; emit({ state: 'error', message: e?.message || String(e) }); if (version) emit({ state: 'available', version }); return; }
      if (!pending()) emit({ state: 'error', message: e?.message || String(e) });
    });
  }

  return {
    attach,
    hasUpdater: () => !!updater,
    isReady: () => ready,
    isBusy: () => ready || downloading,
    // Búsqueda (al abrir y cada 30 min).
    async check() {
      if (!updater || ready || downloading) return 'skipped';
      await updater.checkForUpdates();
      return 'checked';
    },
    // El usuario tocó el cartel: se frena la cuenta regresiva mientras decide.
    hold() {
      if (!pending() || downloading) return;
      stopTimer();
      cancelledFor = version;
      emit({ state: 'available', version });
    },
    // «Continuar»
    start() {
      if (!updater || !version) throw new Error('No hay ninguna actualización disponible.');
      if (ready) { if (isGameRunning()) installOnExit = true; else install(); return; }
      beginDownload();
    },
    // Llamar cuando Minecraft se cierra.
    onGameExit() {
      if (ready && installOnExit) { installOnExit = false; install(); }
    }
  };
}

module.exports = { create, COUNTDOWN_SEC };
