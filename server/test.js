'use strict';
// Prueba de punta a punta del servidor (modo desarrollo, sin Mojang):  node server/test.js
process.env.NOVANET_DEV_AUTH = '1';
process.env.NOVANET_DATA = require('path').join(require('os').tmpdir(), 'novanet-test-' + process.pid + '.json');
const assert = require('assert');
const { start, stop } = require('./server');

let base;
async function call(path, body, token) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}
async function login(name) {
  const c = await call('/v1/auth/challenge', {});
  const l = await call('/v1/auth/login', { name, nonce: c.body.nonce });
  assert.equal(l.status, 200, 'login ' + name);
  return l.body.token;
}

(async () => {
  const srv = await start(0);
  base = 'http://127.0.0.1:' + srv.address().port;

  assert.equal((await call('/v1/health')).body.ok, true);
  assert.equal((await call('/v1/sync', {})).status, 401, 'sync sin sesión');

  // nonce de un solo uso y nombre inválido
  const c = await call('/v1/auth/challenge', {});
  assert.equal((await call('/v1/auth/login', { name: 'x', nonce: c.body.nonce })).status, 400);
  assert.equal((await call('/v1/auth/login', { name: 'Alice', nonce: 'nope' })).status, 400);

  const A = await login('Alice');
  const B = await login('Bob_99');

  // solicitud
  assert.equal((await call('/v1/friends/request', { name: 'Alice' }, A)).body.error, 'self');
  assert.equal((await call('/v1/friends/request', { name: 'Nadie' }, A)).status, 404);
  assert.equal((await call('/v1/friends/request', { name: 'bob_99' }, A)).body.ok, true, 'pedir amistad (sin importar mayúsculas)');
  assert.equal((await call('/v1/friends/request', { name: 'Bob_99' }, A)).body.error, 'already_requested');

  let sa = (await call('/v1/sync', { server: null, mc: '1.21.4' }, A)).body;
  let sb = (await call('/v1/sync', { server: 'mc.ejemplo.net', mc: '1.21.4', names: ['Alice', 'Zed', 'Bob_99'] }, B)).body;
  assert.deepEqual(sa.outgoing, ['Bob_99']);
  assert.deepEqual(sb.incoming, ['Alice']);
  assert.deepEqual(sb.nova.sort(), ['Alice', 'Bob_99'], 'lookup de usuarios Nova');
  assert.equal(sb.friends.length, 0);

  // aceptar
  assert.equal((await call('/v1/friends/accept', { name: 'Carol' }, B)).status, 404);
  assert.equal((await call('/v1/friends/accept', { name: 'Alice' }, A)).body.error, 'no_request');
  assert.equal((await call('/v1/friends/accept', { name: 'Alice' }, B)).body.ok, true);
  sa = (await call('/v1/sync', { server: null }, A)).body;
  assert.deepEqual(sa.friends.map((f) => [f.name, f.status, f.server]), [['Bob_99', 'ingame', 'mc.ejemplo.net']]);
  assert.deepEqual(sa.outgoing, []);

  // mensajes
  assert.equal((await call('/v1/msg', { to: 'Bob_99', text: 'hola §cmundo' }, A)).body.ok, true);
  sb = (await call('/v1/sync', { server: null, after: 0 }, B)).body;
  assert.equal(sb.messages.length, 1);
  assert.equal(sb.messages[0].from, 'Alice');
  assert.equal(sb.messages[0].text, 'hola  cmundo', 'se limpian los códigos de color');
  const last = sb.messages[0].id;
  sb = (await call('/v1/sync', { server: null, after: last }, B)).body;
  assert.equal(sb.messages.length, 0, 'confirmado: no vuelve a llegar');

  // pedidos cruzados = amigos al instante
  const C = await login('Carol');
  assert.equal((await call('/v1/friends/request', { name: 'Carol' }, A)).body.ok, true);
  const x = await call('/v1/friends/request', { name: 'Alice' }, C);
  assert.equal(x.body.accepted, true);
  assert.equal((await call('/v1/msg', { to: 'Bob_99', text: 'x' }, C)).status, 403, 'solo entre amigos');

  // rechazar / cancelar / borrar
  const D = await login('Dave');
  await call('/v1/friends/request', { name: 'Dave' }, A);
  assert.equal((await call('/v1/friends/decline', { name: 'Alice' }, D)).body.ok, true);
  assert.deepEqual((await call('/v1/sync', {}, A)).body.outgoing, []);
  await call('/v1/friends/request', { name: 'Dave' }, A);
  assert.equal((await call('/v1/friends/cancel', { name: 'Dave' }, A)).body.ok, true);
  assert.deepEqual((await call('/v1/sync', {}, D)).body.incoming, []);
  assert.equal((await call('/v1/friends/remove', { name: 'Bob_99' }, A)).body.ok, true);
  assert.deepEqual((await call('/v1/sync', {}, B)).body.friends, []);

  await stop();
  require('fs').rmSync(process.env.NOVANET_DATA, { force: true });
  console.log('OK: todas las pruebas del servidor pasaron');
})().catch((e) => { console.error(e); process.exit(1); });
