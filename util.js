'use strict';

const fs = require('fs');

// Descarga un archivo a disco avisando el progreso (0..1) si el servidor informa el tamaño.
async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total && onProgress) onProgress(received / total);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

// Quita caracteres que Windows no permite en nombres de archivo.
function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'archivo';
}

module.exports = { downloadFile, safeName };
