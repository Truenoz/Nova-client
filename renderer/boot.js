'use strict';

// Pantalla de carga: se ve apenas se abre la ventana y se oculta cuando la app terminó de arrancar.
// Se queda un mínimo de tiempo para que no parpadee, y tiene un tope por si algo falla al iniciar.

(function () {
  const MIN_MS = 1500;   // tiempo mínimo en pantalla
  const MAX_MS = 15000;  // tope de seguridad
  const started = performance.now();
  let hidden = false;

  function hide() {
    if (hidden) return;
    hidden = true;
    const el = document.getElementById('boot');
    if (!el) return;
    el.classList.add('boot-out');
    setTimeout(() => el.remove(), 450);
  }

  window.hideBoot = function hideBoot() {
    const wait = Math.max(0, MIN_MS - (performance.now() - started));
    setTimeout(hide, wait);
  };

  setTimeout(hide, MAX_MS);
})();
