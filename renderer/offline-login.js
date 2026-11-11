'use strict';
// «Jugar sin cuenta»: pide un nombre de jugador y abre una sesión local (modo offline).
// Electron NO soporta window.prompt(), y la política CSP bloquea los <script> dentro del HTML,
// por eso esto es un archivo aparte y el nombre se pide con una ventana propia.
(function () {
  const button = document.getElementById('btn-offline-login');
  if (!button) return;

  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const LAST_KEY = 'nova.offlineName';
  const errBox = () => document.getElementById('play-error');

  function showPlayError(message) {
    const el = errBox();
    if (!el) { if (typeof toast === 'function') toast(message, 'error'); return; }
    el.textContent = message;
    el.classList.toggle('hidden', !message);
  }

  function savedName() {
    try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem(LAST_KEY, name); } catch { /* sin almacenamiento */ }
  }

  // Ventana para escribir el nombre. Devuelve el nombre, o null si se cancela.
  function askName() {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => { if (!finished) { finished = true; resolve(value); } };

      const input = h('input', {
        class: 'input', type: 'text', maxlength: '16', value: savedName(),
        placeholder: 'Ej: Steve_01', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nombre de jugador'
      });
      const hint = h('p', { class: 'modal-sub', text: '3 a 16 caracteres: letras, números o guion bajo.' });
      const error = h('p', { class: 'error hidden', role: 'alert' });

      const submit = () => {
        const name = input.value.trim();
        if (!NAME_RE.test(name)) {
          error.textContent = 'El nombre debe tener entre 3 y 16 caracteres: letras, números o guion bajo.';
          error.classList.remove('hidden');
          input.focus();
          return;
        }
        finish(name);
        m.close();
      };

      const m = modal({
        title: 'Jugar sin cuenta',
        icon: 'user',
        className: 'small',
        body: [
          h('p', { class: 'modal-text', text: 'Elegí el nombre con el que vas a jugar. No hace falta cuenta de Microsoft, pero no vas a poder entrar a servidores que exigen cuenta original.' }),
          input, hint, error
        ],
        footer: [
          h('button', { class: 'btn btn-dark', type: 'button', text: 'Cancelar', onclick: () => m.close() }),
          h('button', { class: 'btn btn-accent', type: 'button', text: 'Entrar', onclick: submit })
        ],
        onClose: () => finish(null)
      });

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  button.addEventListener('click', async () => {
    const name = await askName();
    if (name === null) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Ingresando…';
    try {
      if (!window.launcher || typeof window.launcher.offlineLogin !== 'function') {
        throw new Error('No se pudo conectar con el proceso principal. Cerrá y volvé a abrir Nova Client.');
      }
      const res = await window.launcher.offlineLogin(name);
      if (!res || res.ok !== true) throw new Error(res?.error || 'No se pudo iniciar en modo sin cuenta.');
      saveName(name);
      renderAccount(res.data);
      showPlayError('');
    } catch (e) {
      showPlayError(e?.message || 'No se pudo iniciar en modo sin cuenta.');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
})();
