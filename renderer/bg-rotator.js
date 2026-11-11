'use strict';
// Fondo rotativo del inicio: cambia entre las fotos de renderer/backgrounds con un fundido suave.
(function () {
  const TOTAL = 15;            // bg-01.jpg … bg-15.jpg
  const INTERVAL = 8000;       // tiempo que se ve cada fondo (ms)
  const a = document.getElementById('hero-bg-a');
  const b = document.getElementById('hero-bg-b');
  if (!a || !b) return;

  const files = [];
  for (let i = 1; i <= TOTAL; i++) files.push('backgrounds/bg-' + String(i).padStart(2, '0') + '.jpg');
  // Orden aleatorio, sin repetir hasta haber mostrado todas.
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }

  const layers = [a, b];
  let idx = 0;       // foto actual
  let front = 0;     // capa visible
  let timer = null;

  function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  function paint(layer, src) { layer.style.backgroundImage = 'url("' + src + '")'; }

  async function next() {
    const nextIdx = (idx + 1) % files.length;
    const ok = await preload(files[nextIdx]);
    idx = nextIdx;
    if (!ok) return;                       // si una foto falla, se salta
    const incoming = layers[1 - front];
    paint(incoming, files[idx]);
    incoming.classList.add('show');
    layers[front].classList.remove('show');
    front = 1 - front;
  }

  function reduced() { return document.body.classList.contains('reduce-motion'); }

  function schedule() {
    clearInterval(timer);
    timer = null;
    if (document.hidden) return;   // sin rotar solo si la ventana está oculta (con «Reducir animaciones» rota igual, sin fundido)
    timer = setInterval(next, INTERVAL);
  }

  // Primera foto
  preload(files[0]).then(() => {
    paint(a, files[0]);
    a.classList.add('show');
    schedule();
  });

  document.addEventListener('visibilitychange', schedule);
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
