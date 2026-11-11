'use strict';

// Visor 3D de skins de Minecraft, en WebGL puro (sin librerías).
//
//   const viewer = Skin3D.create(canvas, hostElement);   // null si el equipo no soporta WebGL
//   await viewer.setSkin(dataUrl, 'classic' | 'slim' | 'auto');
//   viewer.faceDataURL(64);                              // la cara (con capa extra) como imagen
//
// Soporta skins de 64×64 y las viejas de 64×32, con texturas HD (128×128, ...), brazos finos (Alex),
// la capa exterior (sombrero, chaqueta, mangas, pantalones) y semitransparencias.
// El personaje respira, la cabeza sigue al mouse, y se lo puede girar arrastrando (doble clic = volver).

(function () {
  // ───────────── Matrices 4×4 (columna mayor) ─────────────
  const m4 = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },
    move(x, y, z) { const m = m4.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
    rx(a) { const m = m4.id(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    ry(a) { const m = m4.id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rz(a) { const m = m4.id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    persp(fov, aspect, near, far) {
      const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }
  };

  // ───────────── Geometría ─────────────
  // Caja centrada en el origen. (u, v) es la esquina de su región en la textura de 64×64.
  // Cada vértice: x y z  u v  nx ny nz  (las UV ya van normalizadas, así sirven para HD).
  function buildBox(w, h, d, u, v, inflate) {
    const sx = w / 2 + inflate, sy = h / 2 + inflate, sz = d / 2 + inflate;
    // [TL, TR, BR, BL] vistos desde afuera, normal, rectángulo UV (x1, y1, x2, y2)
    const faces = [
      [[-sx, sy, sz], [sx, sy, sz], [sx, -sy, sz], [-sx, -sy, sz], [0, 0, 1], [u + d, v + d, u + d + w, v + d + h]],             // frente
      [[sx, sy, -sz], [-sx, sy, -sz], [-sx, -sy, -sz], [sx, -sy, -sz], [0, 0, -1], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]], // espalda
      [[-sx, sy, -sz], [-sx, sy, sz], [-sx, -sy, sz], [-sx, -sy, -sz], [-1, 0, 0], [u, v + d, u + d, v + d + h]],               // costado derecho del personaje
      [[sx, sy, sz], [sx, sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [1, 0, 0], [u + d + w, v + d, u + 2 * d + w, v + d + h]],      // costado izquierdo
      [[-sx, sy, -sz], [sx, sy, -sz], [sx, sy, sz], [-sx, sy, sz], [0, 1, 0], [u + d, v, u + d + w, v + d]],                    // arriba
      [[-sx, -sy, sz], [sx, -sy, sz], [sx, -sy, -sz], [-sx, -sy, -sz], [0, -1, 0], [u + d + w, v, u + 2 * d + w, v + d]]         // abajo
    ];
    const out = [];
    for (const [tl, tr, br, bl, n, uv] of faces) {
      const [u0, v0, u1, v1] = uv.map((k) => k / 64);
      const q = [[tl, u0, v0], [bl, u0, v1], [br, u1, v1], [tl, u0, v0], [br, u1, v1], [tr, u1, v0]]; // antihorario
      for (const [p, pu, pv] of q) out.push(p[0], p[1], p[2], pu, pv, n[0], n[1], n[2]);
    }
    return new Float32Array(out);
  }

  // Partes del cuerpo. `layer` 0 = capa base (opaca), 1 = capa exterior (con transparencia).
  // pivot = punto sobre el que gira; center = centro de la caja. Unidades: 1 píxel de skin.
  function partDefs(slim) {
    const aw = slim ? 3 : 4;
    const ax = 4 + aw / 2;
    const P = (name, w, h, d, u, v, inflate, center, pivot, layer) => ({ name, w, h, d, u, v, inflate, center, pivot, layer });
    return [
      P('head', 8, 8, 8, 0, 0, 0, [0, 28, 0], [0, 24, 0], 0),
      P('body', 8, 12, 4, 16, 16, 0, [0, 18, 0], [0, 18, 0], 0),
      P('armR', aw, 12, 4, 40, 16, 0, [-ax, 18, 0], [-ax, 22, 0], 0),
      P('armL', aw, 12, 4, 32, 48, 0, [ax, 18, 0], [ax, 22, 0], 0),
      P('legR', 4, 12, 4, 0, 16, 0, [-2, 6, 0], [-2, 12, 0], 0),
      P('legL', 4, 12, 4, 16, 48, 0, [2, 6, 0], [2, 12, 0], 0),
      P('head', 8, 8, 8, 32, 0, 0.5, [0, 28, 0], [0, 24, 0], 1),
      P('body', 8, 12, 4, 16, 32, 0.25, [0, 18, 0], [0, 18, 0], 1),
      P('armR', aw, 12, 4, 40, 32, 0.25, [-ax, 18, 0], [-ax, 22, 0], 1),
      P('armL', aw, 12, 4, 48, 48, 0.25, [ax, 18, 0], [ax, 22, 0], 1),
      P('legR', 4, 12, 4, 0, 32, 0.25, [-2, 6, 0], [-2, 12, 0], 1),
      P('legL', 4, 12, 4, 0, 48, 0.25, [2, 6, 0], [2, 12, 0], 1)
    ];
  }

  // ───────────── Textura ─────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo leer la imagen de la skin.'));
      img.src = src;
    });
  }

  // Devuelve { canvas (siempre cuadrado), slim }.
  function prepareSkin(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || W % 64 !== 0 || (H !== W && H !== W / 2)) throw new Error(`Tamaño de skin no válido (${W}×${H}).`);
    const s = W / 64;
    const legacy = H === W / 2;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = W;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);

    let slim = false;
    if (!legacy) {
      // Una skin fina deja libres estas columnas junto a los brazos.
      const free = [[50, 16, 2, 4], [54, 20, 2, 12], [42, 48, 2, 4], [46, 52, 2, 12]];
      slim = free.every(([x, y, w, h]) => {
        const px = ctx.getImageData(x * s, y * s, w * s, h * s).data;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
        return true;
      });
    } else {
      // Skin vieja (64×32): el brazo y la pierna izquierdos son el espejo de los derechos.
      const flip = (sx, sy, sw, sh, dx, dy) => {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(canvas, sx * s, sy * s, sw * s, sh * s, -(dx + sw) * s, dy * s, sw * s, sh * s);
        ctx.restore();
      };
      const mirrorLimb = (ox, oy, nx, ny) => {
        flip(ox + 4, oy, 4, 4, nx + 4, ny);         // arriba
        flip(ox + 8, oy, 4, 4, nx + 8, ny);         // abajo
        flip(ox + 8, oy + 4, 4, 12, nx, ny + 4);    // costado (se intercambian)
        flip(ox + 4, oy + 4, 4, 12, nx + 4, ny + 4); // frente
        flip(ox, oy + 4, 4, 12, nx + 8, ny + 4);    // costado
        flip(ox + 12, oy + 4, 4, 12, nx + 12, ny + 4); // espalda
      };
      mirrorLimb(0, 16, 16, 48);  // pierna
      mirrorLimb(40, 16, 32, 48); // brazo
      // Minecraft ignora la transparencia de la capa base en las skins viejas.
      for (const [x, y, w, h] of [[0, 0, 32, 16], [0, 16, 64, 16], [16, 48, 32, 16]]) {
        const d = ctx.getImageData(x * s, y * s, w * s, h * s);
        for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
        ctx.putImageData(d, x * s, y * s);
      }
    }
    return { canvas, slim };
  }

  // ───────────── Visor ─────────────
  const VERT = `
    attribute vec3 a_pos; attribute vec2 a_uv; attribute vec3 a_nrm;
    uniform mat4 u_mvp; uniform mat4 u_rot;
    varying vec2 v_uv; varying float v_light;
    void main() {
      gl_Position = u_mvp * vec4(a_pos, 1.0);
      v_uv = a_uv;
      vec3 n = normalize((u_rot * vec4(a_nrm, 0.0)).xyz);
      v_light = 0.58 + 0.42 * max(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0);
    }`;
  const FRAG = `
    precision mediump float;
    uniform sampler2D u_tex; uniform float u_opaque;
    varying vec2 v_uv; varying float v_light;
    void main() {
      vec4 c = texture2D(u_tex, v_uv);
      if (u_opaque > 0.5) c.a = 1.0;
      else if (c.a < 0.01) discard;
      gl_FragColor = vec4(c.rgb * v_light, c.a);
    }`;

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch { return false; }
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  const DEFAULT_YAW = 0;   // de frente
  const DEFAULT_PITCH = 0.08;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function create(canvas, host) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true })
      || canvas.getContext('experimental-webgl');
    if (!gl) return null;

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      console.error('[Skin3D] shaders:', e);
      return null;
    }
    gl.useProgram(prog);
    const loc = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      uv: gl.getAttribLocation(prog, 'a_uv'),
      nrm: gl.getAttribLocation(prog, 'a_nrm'),
      mvp: gl.getUniformLocation(prog, 'u_mvp'),
      rot: gl.getUniformLocation(prog, 'u_rot'),
      tex: gl.getUniformLocation(prog, 'u_tex'),
      opaque: gl.getUniformLocation(prog, 'u_opaque')
    };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.uniform1i(loc.tex, 0);

    const texture = gl.createTexture();
    let parts = [];          // { def, buffer, count }
    let hasSkin = false;
    let faceSource = null;   // canvas con la skin ya preparada
    let lost = false;

    function setParts(slim) {
      for (const p of parts) gl.deleteBuffer(p.buffer);
      parts = partDefs(slim).map((def) => {
        const buffer = gl.createBuffer();
        const data = buildBox(def.w, def.h, def.d, def.u, def.v, def.inflate);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return { def, buffer, count: data.length / 8 };
      });
    }
    setParts(false);

    // Estado de la vista
    const view = { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, userTouched: false, headYaw: 0, headPitch: 0, tHeadYaw: 0, tHeadPitch: 0 };
    let drag = null;

    const onDown = (e) => {
      if (e.button !== 0 || e.target.closest('button, a, input')) return;
      drag = { x: e.clientX, y: e.clientY };
      view.userTouched = true;
      host.classList.add('grabbing');
      try { host.setPointerCapture(e.pointerId); } catch { /* no es crítico */ }
    };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width) {
        view.tHeadYaw = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 1.6), -1, 1) * 0.75;
        view.tHeadPitch = clamp((e.clientY - (r.top + r.height * 0.22)) / (r.height * 1.2), -1, 1) * 0.5;
      }
      if (!drag) return;
      view.yaw += (e.clientX - drag.x) * 0.012;
      view.pitch = clamp(view.pitch + (e.clientY - drag.y) * 0.006, -0.6, 0.6);
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const onUp = (e) => {
      drag = null;
      host.classList.remove('grabbing');
      try { host.releasePointerCapture(e.pointerId); } catch { /* no es crítico */ }
    };
    const onLeave = () => { if (!drag) { view.tHeadYaw = 0; view.tHeadPitch = 0; } };
    const onDouble = (e) => {
      if (e.target.closest('button, a, input')) return;
      view.userTouched = false;
      view.yaw = DEFAULT_YAW; view.pitch = DEFAULT_PITCH;
    };
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('dblclick', onDouble);

    const onLost = (e) => { e.preventDefault(); lost = true; if (api.onLost) api.onLost(); };
    canvas.addEventListener('webglcontextlost', onLost);

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return false;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return true;
    }

    function draw(t) {
      if (!hasSkin || lost || !resize()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      view.headYaw += (view.tHeadYaw - view.headYaw) * 0.12;
      view.headPitch += (view.tHeadPitch - view.headPitch) * 0.12;
      const sway = view.userTouched || drag ? 0 : Math.sin(t * 0.0006) * 0.06;
      const breathe = Math.sin(t * 0.0018);

      const rootRot = m4.mul(m4.rx(view.pitch), m4.ry(view.yaw + sway));
      const root = m4.mul(rootRot, m4.move(0, -16, 0));
      const dist = 18 / Math.tan(0.22); // el personaje (32 + margen) llena el alto del canvas
      const proj = m4.mul(m4.persp(0.44, canvas.width / canvas.height, 10, 300), m4.move(0, 0, -dist));
      const viewProj = m4.mul(proj, root);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const layer of [0, 1]) {
        if (layer) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        gl.uniform1f(loc.opaque, layer ? 0 : 1);
        for (const p of parts) {
          const d = p.def;
          if (d.layer !== layer) continue;
          let rot = m4.id();
          if (d.name === 'head') rot = m4.mul(m4.ry(view.headYaw), m4.rx(view.headPitch));
          else if (d.name === 'armR') rot = m4.mul(m4.rz(-(0.04 + 0.025 * breathe)), m4.rx(0.05 * breathe));
          else if (d.name === 'armL') rot = m4.mul(m4.rz(0.04 + 0.025 * breathe), m4.rx(-0.05 * breathe));
          const local = m4.mul(m4.mul(m4.move(d.pivot[0], d.pivot[1], d.pivot[2]), rot),
            m4.move(d.center[0] - d.pivot[0], d.center[1] - d.pivot[1], d.center[2] - d.pivot[2]));
          gl.uniformMatrix4fv(loc.mvp, false, m4.mul(viewProj, local));
          gl.uniformMatrix4fv(loc.rot, false, m4.mul(rootRot, rot));
          gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
          gl.enableVertexAttribArray(loc.pos);
          gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 32, 0);
          gl.enableVertexAttribArray(loc.uv);
          gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 32, 12);
          gl.enableVertexAttribArray(loc.nrm);
          gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 32, 20);
          gl.drawArrays(gl.TRIANGLES, 0, p.count);
        }
      }
    }

    let raf = 0;
    let running = true;
    function frame(t) {
      if (!running) return;
      draw(t);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const api = {
      onLost: null,

      // model: 'classic' | 'slim' | 'auto' (se deduce de la textura)
      async setSkin(src, model) {
        const img = await loadImage(src);
        const { canvas: skinCanvas, slim: detected } = prepareSkin(img);
        const slim = model === 'slim' || (model !== 'classic' && detected);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, skinCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        setParts(slim);
        faceSource = skinCanvas;
        hasSkin = true;
        return { slim, size: skinCanvas.width };
      },

      // La cara (8×8 + capa exterior) escalada sin suavizar, lista para un <img>.
      faceDataURL(size) {
        if (!faceSource) return null;
        const s = faceSource.width / 64;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(faceSource, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, size, size);
        ctx.drawImage(faceSource, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, size, size);
        return c.toDataURL('image/png');
      },

      setView(yaw, pitch) { view.userTouched = true; view.yaw = yaw; view.pitch = pitch; },
      get ready() { return hasSkin; },

      destroy() {
        running = false;
        cancelAnimationFrame(raf);
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onUp);
        host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('dblclick', onDouble);
        canvas.removeEventListener('webglcontextlost', onLost);
      }
    };
    return api;
  }

  window.Skin3D = { supported, create };
})();
