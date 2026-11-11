'use strict';

// Discord Rich Presence sin dependencias: habla directo con el IPC local de Discord
// (named pipe en Windows, socket Unix en Mac/Linux). Si Discord no está abierto, reintenta solo.

const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15000;

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

function pipePaths() {
  const list = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') {
      list.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    } else {
      const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
      list.push(path.join(base, `discord-ipc-${i}`));
      list.push(path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
      list.push(path.join(base, 'snap.discord', `discord-ipc-${i}`));
    }
  }
  return list;
}

function tryConnect(paths) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= paths.length) return reject(new Error('Discord no está abierto'));
      const sock = net.createConnection(paths[i++]);
      sock.once('connect', () => { sock.removeAllListeners('error'); resolve(sock); });
      sock.once('error', () => { sock.destroy(); next(); });
    };
    next();
  });
}

class DiscordPresence {
  /**
   * @param {string} clientId  ID de la aplicación de Discord (su NOMBRE es lo que se ve en "Jugando a …").
   * @param {(msg: string) => void} [log]
   */
  constructor(clientId, log) {
    this.clientId = String(clientId || '').trim();
    this.log = log || (() => {});
    this.activity = null;
    this.sock = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    this.timer = null;
    this.stopped = true;
    this.connecting = false;
  }

  get enabled() {
    return /^\d{15,25}$/.test(this.clientId);
  }

  /** Muestra (o actualiza) la actividad. */
  start(activity) {
    if (!this.enabled) {
      this.log('[Discord] Falta el ID de aplicación de Discord (ver README → Discord). No se muestra la actividad.');
      return;
    }
    this.activity = activity;
    this.stopped = false;
    if (this.ready) this._send();
    else this._connect();
  }

  /** Quita la actividad y cierra la conexión. */
  stop() {
    this.stopped = true;
    this.activity = null;
    clearTimeout(this.timer);
    if (this.sock && this.ready) {
      try { this._request('SET_ACTIVITY', { pid: process.pid }); } catch { /* ya cerrado */ }
    }
    const sock = this.sock;
    this.sock = null;
    this.ready = false;
    if (sock) setTimeout(() => sock.destroy(), 150);
  }

  async _connect() {
    if (this.connecting || this.sock || this.stopped) return;
    this.connecting = true;
    try {
      const sock = await tryConnect(pipePaths());
      this.sock = sock;
      this.buffer = Buffer.alloc(0);
      sock.on('data', (chunk) => this._onData(chunk));
      sock.on('close', () => this._onClose());
      sock.on('error', () => { /* se maneja en close */ });
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    } catch {
      this._retry();
    } finally {
      this.connecting = false;
    }
  }

  _retry() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._connect(), RETRY_MS);
    if (this.timer.unref) this.timer.unref();
  }

  _onClose() {
    this.sock = null;
    this.ready = false;
    this._retry();
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.subarray(8 + len);
      let msg = null;
      try { msg = JSON.parse(body); } catch { /* ignorar */ }

      if (op === OP.PING) {
        this.sock?.write(encode(OP.PONG, msg || {}));
      } else if (op === OP.CLOSE) {
        this.log(`[Discord] Conexión cerrada por Discord${msg?.message ? `: ${msg.message}` : ''}`);
        this.sock?.destroy();
      } else if (op === OP.FRAME && msg) {
        if (msg.evt === 'READY') {
          this.ready = true;
          this.log(`[Discord] Conectado como ${msg.data?.user?.username || 'usuario'}.`);
          this._send();
        } else if (msg.evt === 'ERROR') {
          this.log(`[Discord] Error: ${msg.data?.message || 'desconocido'}`);
        }
      }
    }
  }

  _request(cmd, args) {
    this.sock?.write(encode(OP.FRAME, { cmd, args, nonce: crypto.randomUUID() }));
  }

  _send() {
    if (!this.ready || !this.activity) return;
    this._request('SET_ACTIVITY', { pid: process.pid, activity: this.activity });
  }
}

module.exports = { DiscordPresence, encode, pipePaths };
