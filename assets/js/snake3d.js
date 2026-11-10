/*!
 * ae studio — snake3d.js
 * Player for the pre-rendered Cycles plush snake (spec: docs/snake3d-spec.md, WEB BRIEF + MANIFEST).
 * Plain IIFE, ES2017, no dependencies. Exposes window.AeSnake3D.
 *
 *  - hero: the intro clip writes «ae»; the rest state is a WebGL composite (still + look cell + tongue
 *    overlay + breath warp), never video; the departure is scroll-chased (forward / reversed encode).
 *  - gauge: the arrival clip coils her around the income ring (chased forward only), then the same rest.
 *  - clips are stacked-alpha MP4s (colour on top, gutter with a calibration strip, alpha below).
 *  - still mode (reduced motion, pause, Save-Data, no WebGL): <img> stills only, zero video requests.
 * Page-layout constants live here (HERO_FIT, HERO_SCROLL); render facts come from assets/snake3d/manifest.json.
 */
(function (w, d) {
  'use strict';
  if (w.AeSnake3D) return;

  /* ------------------------------------------------------------------ constants */
  var HERO_FIT = { dx: -0.011, dy: -0.044, h: 1.085, edge: 8 };      // W5, measured on the approved 1440 layout
  var HERO_SCROLL = { desk: [0.03, 0.38], phone: [0.02, 0.22] };     // W9
  var TPX = { S: 78, M: 104, L: 156 }, ORD = 'SML', FPS = 30;
  var B = w.__aeSnake3dBoot || {};
  var root = d.documentElement;
  var now = function () { return performance.now(); };
  function qv(k) { var m = new RegExp('[?&]' + k + '=([^&#]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }
  var FORCE = B.force != null && B.force !== '' ? B.force : qv('snake3d');
  var DEBUG = FORCE === 'debug', FTIER = qv('tier').toUpperCase(), FCODEC = qv('codec').toLowerCase();
  function mm(q) { return !!(w.matchMedia && w.matchMedia(q).matches); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function log() { if (DEBUG && w.console) console.log.apply(console, ['[snake3d]'].concat([].slice.call(arguments))); }
  function emit(el, name, scene) {
    if (!el) return;
    var ev; try { ev = new CustomEvent(name, { bubbles: true, detail: { scene: scene } }); }
    catch (e) { ev = d.createEvent('CustomEvent'); ev.initCustomEvent(name, true, false, { scene: scene }); }
    el.dispatchEvent(ev);
  }
  function el(tag, cls, parent) { var e = d.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function frameOf(mt, t0, N) { return clamp(Math.round((mt - t0) * FPS), 0, N - 1); }          // W7 frame clock (rVFC)

  /* ------------------------------------------------------------------ env */
  var ua = navigator.userAgent;
  var env = {
    touch: B.touch != null ? B.touch : mm('(pointer: coarse)') && !mm('(any-pointer: fine)'),
    fine: mm('(hover: hover) and (pointer: fine)'),
    rvfc: !!(w.HTMLVideoElement && 'requestVideoFrameCallback' in HTMLVideoElement.prototype),
    webkitOld: false, wkBlocked: !!B.wkBlocked, slow: !!B.slow
  };
  env.webkitOld = !env.rvfc && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(ua);
  if (B.slow == null) { var cn = navigator.connection || {}; env.slow = cn.effectiveType === '3g'; }
  function envStillBoot() {
    if (B.envStill != null) return B.envStill || FORCE === 'still';
    var c = navigator.connection || {};
    return !!c.saveData || /^(slow-2g|2g)$/.test(c.effectiveType || '') || FORCE === 'still';
  }
  var svhProbe = null;
  function vh() {
    if (!svhProbe) { svhProbe = el('div', '', d.body); svhProbe.setAttribute('aria-hidden', 'true'); svhProbe.style.cssText = 'position:absolute;left:-9px;top:0;width:1px;height:100vh;height:100svh;visibility:hidden;pointer-events:none'; }
    return svhProbe.offsetHeight || w.innerHeight;
  }
  function snapTier(t, avail) {
    var i = ORD.indexOf(t), j;
    for (j = i; j < 3; j++) if (avail.indexOf(ORD[j]) >= 0) return ORD[j];
    for (j = i - 1; j >= 0; j--) if (avail.indexOf(ORD[j]) >= 0) return ORD[j];
    return avail[0];
  }
  function tierFor(need, m) {                                        // W3: smallest tier with px/D >= need/1.2
    var t = need / 1.2 <= 78 ? 'S' : need / 1.2 <= 104 ? 'M' : 'L';
    if (env.slow) t = 'S'; else if (env.touch && t === 'L') t = 'M';
    if (TPX[FTIER]) t = FTIER;
    return snapTier(t, Object.keys(m.tiers));
  }
  function clipTierOf(t, m) {
    var top = m.clipTiers[m.clipTiers.length - 1];
    return snapTier(ORD.indexOf(t) > ORD.indexOf(top) ? top : t, m.clipTiers);
  }
  var badCodecs = '';
  try { badCodecs = sessionStorage.getItem('ae-s3d:bad') || ''; } catch (e) { /* ignore */ }
  function markBad(k) { if (badCodecs.indexOf(k) < 0) badCodecs += k + ','; try { sessionStorage.setItem('ae-s3d:bad', badCodecs); } catch (e) { /* ignore */ } }
  function pick(m, key, skip) {                                      // AV1 -> HEVC -> H.264 (copy of the boot's B.pick)
    var ks = ['av1', 'hevc', 'h264'].filter(function (k) { return (skip || '').indexOf(k) < 0 && badCodecs.indexOf(k) < 0; });
    if (FCODEC) return Promise.resolve(m.files[key + '.' + FCODEC + '.mp4'] ? FCODEC : null);
    if (B.pick && !skip && !badCodecs) return B.pick(m, key);
    var v = d.createElement('video'), mc = navigator.mediaCapabilities;
    return Promise.all(ks.map(function (k) {
      var fi = m.files[key + '.' + k + '.mp4'], type = fi && 'video/mp4; codecs="' + fi.codec + '"';
      var cp = fi ? v.canPlayType(type) : '';
      if (!cp) return false;
      if (k === 'h264') return true;
      var guess = cp === 'probably' && (k !== 'av1' || !env.touch);
      if (!mc) return guess;
      return Promise.race([
        mc.decodingInfo({ type: 'file', video: { contentType: type, width: fi.size[0], height: fi.size[1], bitrate: Math.round(fi.bytes * 8 * 30 / fi.frames), framerate: 30 } })
          .then(function (x) { return x.supported && x.smooth && (x.powerEfficient || (k === 'av1' && !env.touch)); }, function () { return false; }),
        new Promise(function (r) { setTimeout(r, 300, guess); })
      ]);
    })).then(function (ok) { return ks[ok.indexOf(true)] || null; });
  }

  /* ------------------------------------------------------------------ net */
  var BASE = 'assets/snake3d/';
  function url(rel) { return new URL(BASE + rel, d.baseURI).href; }
  var netQ = [], netActive = 0;
  function netPump() { while (netActive < 2 && netQ.length) netQ.shift()(); }
  function getBlob(u, prio, signal) {
    return new Promise(function (res, rej) {
      netQ.push(function () {
        netActive++;
        var o = { cache: 'force-cache', signal: signal }; if (prio) o.priority = prio;
        fetch(u, o).then(function (r) { if (!r.ok) throw r.status; return r.blob(); })
          .then(res, rej).then(done, done);
      });
      netPump();
    });
    function done() { netActive--; netPump(); }
  }
  var imgCache = {};
  function loadImg(m, key, prio) {
    var fi = m.files[key];
    if (!fi) return Promise.reject('nofile ' + key);
    var u = url(fi.file);
    if (imgCache[u]) return imgCache[u];
    var p = imgCache[u] = getBlob(u, prio).then(function (b) {
      var im = new Image(); im._url = URL.createObjectURL(b); im.src = im._url;
      return (im.decode ? im.decode() : new Promise(function (r, j) { im.onload = r; im.onerror = j; })).then(function () {
        if (fi.size && (im.naturalWidth !== fi.size[0] || im.naturalHeight !== fi.size[1])) throw 'size';
        return im;
      });
    });
    p.catch(function (e) { delete imgCache[u]; if (e === 404 || e === 'size') director && director.stale(); });
    return p;
  }

  /* ------------------------------------------------------------------ gl */
  var VS = 'attribute vec2 aPos; uniform vec4 uDst, uView; varying vec2 vQ;\n' +
    'void main(){ vQ = uDst.xy + aPos * uDst.zw; vec2 n = (vQ - uView.xy) / uView.zw * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0); }';
  var FS_CLIP = 'precision highp float;\n' +
    'uniform sampler2D uVid, uLut; uniform vec2 uVidSize; uniform vec4 uRect; uniform float uK, uH, uGut, uOpacity; uniform mat3 uFix; varying vec2 vQ;\n' +
    'float lut(float v){ return texture2D(uLut, vec2((v * 255.0 + 0.5) / 256.0, 0.5)).r; }\n' +
    'vec3 lut3(vec3 c){ return vec3(lut(c.r), lut(c.g), lut(c.b)); }\n' +
    'void main(){\n' +
    '  vec2 p = (vQ - uRect.xy) * uK;\n' +
    '  if (p.x < 0.0 || p.y < 0.0 || p.x > uRect.z * uK || p.y > uH) { gl_FragColor = vec4(0.0); return; }\n' +
    '  p = clamp(p, vec2(0.5), vec2(uRect.z * uK - 0.5, uH - 0.5));\n' +
    '  vec3 c = clamp(uFix * lut3(texture2D(uVid, p / uVidSize).rgb), 0.0, 1.0);\n' +
    '  float a0 = dot(lut3(texture2D(uVid, vec2(p.x, p.y + uH + uGut) / uVidSize).rgb), vec3(0.2126, 0.7152, 0.0722));\n' +
    '  float a = a0 * smoothstep(2.0 / 255.0, 6.0 / 255.0, a0);\n' +
    '  c *= a / max(a0, 1.0 / 255.0);\n' +
    '  gl_FragColor = vec4(min(c, vec3(a)), a) * uOpacity;\n' +
    '}';
  var FS_REST = 'precision highp float;\n' +
    'uniform sampler2D uBase, uFlow, uMask, uLook, uTong; uniform vec4 uBaseR, uFlowR, uMaskR, uLookR, uTongR;\n' +
    'uniform vec2 uBaseS, uFlowS, uMaskS, uLookS, uTongS; uniform float uK, uHalf; uniform vec2 uCellA, uCellB; uniform float uCellMix;\n' +
    'uniform vec2 uTongO; uniform float uTongOn; uniform vec2 uPivot, uAxis; uniform float uStart, uLen, uWarp;\n' +
    'uniform float uBreath, uFlowZero, uFlowPx, uOpacity; varying vec2 vQ;\n' +
    'bool inR(vec2 q, vec4 r){ return q.x >= r.x && q.y >= r.y && q.x < r.x + r.z && q.y < r.y + r.w; }\n' +
    'vec4 tex(sampler2D t, vec2 size, vec2 o, vec4 r, float k, vec2 q){ vec2 p = clamp((q - r.xy) * k, vec2(0.5), r.zw * k - 0.5); return texture2D(t, (o + p) / size); }\n' +
    'void main(){\n' +
    '  vec2 q = vQ, f = vec2(0.0);\n' +
    '  if (inR(q, uFlowR)) f = (tex(uFlow, uFlowS, vec2(0.0), uFlowR, uHalf, q).rg * 255.0 - uFlowZero) / uFlowPx;\n' +
    '  vec2 qb = q - uBreath * f;\n' +
    '  vec4 o = inR(qb, uBaseR) ? tex(uBase, uBaseS, vec2(0.0), uBaseR, uK, qb) : vec4(0.0);\n' +
    '  float m = inR(q, uMaskR) ? tex(uMask, uMaskS, vec2(0.0), uMaskR, uHalf, q).r : 0.0;\n' +
    '  if (m > 0.0) {\n' +
    '    float w = smoothstep(uStart, uStart + uLen, dot(q - uPivot, uAxis));\n' +
    '    float a = -uWarp * w; vec2 dd = q - uPivot;\n' +
    '    vec2 qh = uPivot + vec2(cos(a) * dd.x - sin(a) * dd.y, sin(a) * dd.x + cos(a) * dd.y);\n' +
    '    vec4 h = o;\n' +
    '    if (inR(qh, uLookR)) h = mix(tex(uLook, uLookS, uCellA, uLookR, uK, qh), tex(uLook, uLookS, uCellB, uLookR, uK, qh), uCellMix);\n' +
    '    if (uTongOn > 0.5 && inR(qh, uTongR)) { vec4 t = tex(uTong, uTongS, uTongO, uTongR, uK, qh); h = t + h * (1.0 - t.a); }\n' +
    '    o = mix(o, h, m);\n' +
    '  }\n' +
    '  gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a) * uOpacity;\n' +
    '}';
  var FS_CAL = 'precision highp float; uniform sampler2D uVid; uniform vec2 uVidSize, uC, uO;\n' +
    'void main(){ vec2 p = uC + (gl_FragCoord.xy - uO) - vec2(4.0, 2.0); gl_FragColor = texture2D(uVid, p / uVidSize); }';
  var ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function makeGL(canvas) {
    if (FORCE === 'nogl') return null;
    var g = null;
    try {
      g = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
    } catch (e) { g = null; }
    if (!g) return null;
    var hp = g.getShaderPrecisionFormat && g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
    if (!hp || !hp.precision) return null;
    var G = { g: g, canvas: canvas, cal: {} };
    G.init = function () {
      function sh(type, src) { var s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS) && !g.isContextLost()) throw new Error(g.getShaderInfoLog(s)); return s; }
      function prog(fs) {
        var p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, VS)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs));
        g.bindAttribLocation(p, 0, 'aPos'); g.linkProgram(p); p.u = {}; return p;
      }
      G.clip = prog(FS_CLIP); G.rest = prog(FS_REST); G.calP = prog(FS_CAL);
      var buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), g.STATIC_DRAW);
      g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      G.blank = G.tex(); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
      G.idLut = G.lutTex(null);
      g.disable(g.DEPTH_TEST); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      G.cal = {};
    };
    G.u = function (p, n) { return n in p.u ? p.u[n] : (p.u[n] = g.getUniformLocation(p, n)); };
    G.tex = function () {
      var t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      return t;
    };
    G.up = function (t, src, premult) {                              // images (premult) / flow + mask / video (raw)
      g.bindTexture(g.TEXTURE_2D, t);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premult);
      g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);   // never texSubImage2D (W6)
    };
    G.lutTex = function (arr) {
      var t = G.tex(), a = new Uint8Array(256);
      for (var i = 0; i < 256; i++) a[i] = arr ? arr[i] : i;
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, 256, 1, 0, g.LUMINANCE, g.UNSIGNED_BYTE, a);
      return t;
    };
    G.bind = function (unit, t) { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t || G.blank); };
    G.begin = function (view) {
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.viewport(0, 0, canvas.width, canvas.height); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      G.view = view;
    };
    G.drawClip = function (c, op, add) {
      var p = G.clip; g.useProgram(p);
      g.blendFunc(g.ONE, add ? g.ONE : g.ONE_MINUS_SRC_ALPHA);
      G.bind(0, c.tex); G.bind(1, c.lut || G.idLut);
      g.uniform1i(G.u(p, 'uVid'), 0); g.uniform1i(G.u(p, 'uLut'), 1);
      g.uniform4fv(G.u(p, 'uView'), G.view); g.uniform4fv(G.u(p, 'uDst'), c.rect); g.uniform4fv(G.u(p, 'uRect'), c.rect);
      g.uniform2f(G.u(p, 'uVidSize'), c.vw, c.vh); g.uniform1f(G.u(p, 'uK'), c.k); g.uniform1f(G.u(p, 'uH'), c.H);
      g.uniform1f(G.u(p, 'uGut'), c.gut); g.uniform1f(G.u(p, 'uOpacity'), op);
      g.uniformMatrix3fv(G.u(p, 'uFix'), false, c.fix || ID3);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    };
    G.drawRest = function (R, op, add) {
      var p = G.rest; g.useProgram(p);
      g.blendFunc(g.ONE, add ? g.ONE : g.ONE_MINUS_SRC_ALPHA);
      var names = ['uBase', 'uFlow', 'uMask', 'uLook', 'uTong'], ts = [R.t.base, R.t.flow, R.t.mask, R.t.look, R.t.tong];
      for (var i = 0; i < 5; i++) { G.bind(i, ts[i]); g.uniform1i(G.u(p, names[i]), i); }
      var U = R.uni(), k;
      g.uniform4fv(G.u(p, 'uView'), G.view); g.uniform4fv(G.u(p, 'uDst'), G.view);
      for (k in U) { var v = U[k], loc = G.u(p, k); if (v.length === 4) g.uniform4fv(loc, v); else if (v.length === 2) g.uniform2fv(loc, v); else g.uniform1f(loc, v); }
      g.uniform1f(G.u(p, 'uOpacity'), op);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    };
    G.sample = function (c, pts) {                                   // CALIB: 8x4 blocks around each point -> per-channel medians
      if (!G.fb) {
        G.fbt = G.tex(); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 160, 4, 0, g.RGBA, g.UNSIGNED_BYTE, null);
        G.fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, G.fb);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, G.fbt, 0);
      }
      var p = G.calP; g.useProgram(p); g.bindFramebuffer(g.FRAMEBUFFER, G.fb); g.disable(g.BLEND);
      G.bind(0, c.tex); g.uniform1i(G.u(p, 'uVid'), 0); g.uniform2f(G.u(p, 'uVidSize'), c.vw, c.vh);
      g.uniform4f(G.u(p, 'uView'), 0, 0, 1, 1); g.uniform4f(G.u(p, 'uDst'), 0, 0, 1, 1);
      pts.forEach(function (pt, i) {
        g.viewport(i * 8, 0, 8, 4); g.uniform2f(G.u(p, 'uC'), pt[0], pt[1]); g.uniform2f(G.u(p, 'uO'), i * 8, 0);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      });
      var px = new Uint8Array(160 * 4 * 4); g.readPixels(0, 0, 160, 4, g.RGBA, g.UNSIGNED_BYTE, px);
      g.enable(g.BLEND); g.bindFramebuffer(g.FRAMEBUFFER, null);
      return pts.map(function (pt, i) {
        var out = [];
        for (var ch = 0; ch < 3; ch++) {
          var vals = [];
          for (var y = 0; y < 4; y++) for (var x = 0; x < 8; x++) vals.push(px[(y * 160 + i * 8 + x) * 4 + ch]);
          vals.sort(function (a, b) { return a - b; }); out.push((vals[15] + vals[16]) / 2);
        }
        return out;
      });
    };
    G.init();
    return G;
  }

  /* calibration maths (W6) */
  function fitLut(m) {                                               // m[i] = decoded grey of 17*i
    var best = null;
    for (var g = 0.4; g <= 2.5001; g += 0.01) {
      var X = [], sx = 0, sy = 0, sxx = 0, sxy = 0, n = m.length, i;
      for (i = 0; i < n; i++) { X[i] = Math.pow(17 * i / 255, g) * 255; sx += X[i]; sy += m[i]; sxx += X[i] * X[i]; sxy += X[i] * m[i]; }
      var b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n, r = 0;
      for (i = 0; i < n; i++) r = Math.max(r, Math.abs(a + b * X[i] - m[i]));
      if (!best || r < best.r) best = { g: g, a: a, b: b, r: r };
    }
    var f = function (v) { return best.a + best.b * Math.pow(v / 255, best.g) * 255; }, dev = 0, v;
    for (v = 0; v < 256; v++) dev = Math.max(dev, Math.abs(f(v) - v));
    best.dev = dev;
    if (dev <= 3) { best.kind = 'identity'; return best; }
    var lut = new Array(256);
    if (best.r <= 3) {
      best.kind = 'fit';
      for (v = 0; v < 256; v++) lut[v] = Math.round(clamp(Math.pow(clamp((v - best.a) / best.b / 255, 0, 1), 1 / best.g) * 255, 0, 255));
    } else {
      best.kind = 'piecewise';
      var cm = [], mx = -1;
      for (i = 0; i < m.length; i++) { mx = Math.max(mx, m[i]); cm.push(mx); }
      for (v = 0; v < 256; v++) {
        var j = 0; while (j < cm.length - 2 && cm[j + 1] < v) j++;
        var t = cm[j + 1] > cm[j] ? clamp((v - cm[j]) / (cm[j + 1] - cm[j]), 0, 1) : 0;
        lut[v] = Math.round(clamp(17 * (j + t), 0, 255));
      }
    }
    best.lut = lut;
    return best;
  }
  function lab(c) {
    var l = c.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var X = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047, Y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2], Z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }
  function dE(a, b) { var A = lab(a), Bb = lab(b); return Math.hypot(A[0] - Bb[0], A[1] - Bb[1], A[2] - Bb[2]); }
  function as601(c) {                                                // encode BT.709, decode BT.601
    var R = c[0] / 255, G = c[1] / 255, Bc = c[2] / 255, Y = 0.2126 * R + 0.7152 * G + 0.0722 * Bc, Cb = (Bc - Y) / 1.8556, Cr = (R - Y) / 1.5748;
    return [Y + 1.402 * Cr, Y - 0.344136 * Cb - 0.714136 * Cr, Y + 1.772 * Cb].map(function (v) { return clamp(v, 0, 1) * 255; });
  }
  function fix601() {                                                // uFix = D709 * E601, column-major for GLSL
    var E = [[0.299, 0.587, 0.114], [-0.299 / 1.772, -0.587 / 1.772, 0.886 / 1.772], [0.701 / 1.402, -0.587 / 1.402, -0.114 / 1.402]];
    var D = [[1, 0, 1.5748], [1, -0.187324, -0.468124], [1, 1.8556, 0]], M = [], r, c, k;
    for (r = 0; r < 3; r++) { M[r] = []; for (c = 0; c < 3; c++) { M[r][c] = 0; for (k = 0; k < 3; k++) M[r][c] += D[r][k] * E[k][c]; } }
    return [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];
  }

  /* ------------------------------------------------------------------ pool (exactly 3 decoders, W7) */
  var pool = null, probeSrc = '';
  function makePool() {
    var host = el('div', 'snake3d-decoders', d.body); host.setAttribute('aria-hidden', 'true');
    pool = ['heroA', 'heroB', 'gauge'].map(function (n) {
      var v = el('video', '', host);
      v.muted = true; v.playsInline = true; v.loop = false; v.preload = 'auto'; v.tabIndex = -1;
      ['muted', 'playsinline', 'webkit-playsinline', 'disablepictureinpicture', 'disableremoteplayback'].forEach(function (a) { v.setAttribute(a, ''); });
      v.addEventListener('webkitbeginfullscreen', function () { try { v.webkitExitFullscreen(); } catch (e) { /* ignore */ } v.pause(); setVideo('broken'); });
      if (probeSrc) v.src = probeSrc;
      v._name = n; return v;
    });
    pool.host = host;
  }
  function playV(v) {
    if (!v.paused || v._pending) return;
    v._pending = true;
    var p; try { p = v.play(); } catch (e) { v._pending = false; return; }
    if (p && p.then) p.then(function () { v._pending = false; }, function (e) { v._pending = false; if (e && e.name === 'NotAllowedError') setVideo('blocked'); });
    else v._pending = false;
  }
  function release(v) { if (!v) return; v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) { /* ignore */ } if (probeSrc) v.src = probeSrc; v._clip = null; }

  /* ------------------------------------------------------------------ Clip */
  function Clip(scene, name, v) { this.s = scene; this.name = name; this.v = v; this.F = -1; this.primed = false; this.fails = 0; }
  Clip.prototype.setup = function (m, tier, codec, blob) {
    var sc = this.s.sm, cm = sc.clips[this.name], fi = m.files[this.s.name + '/' + tier + '/' + this.name + '.' + codec + '.mp4'], k = m.tiers[tier];
    var L = m.videoLayout;
    this.m = m; this.cm = cm; this.fi = fi; this.tier = tier; this.codec = codec; this.blob = blob;
    this.N = cm.frames; this.rect = cm.rect; this.k = k; this.H = Math.round(cm.rect[3] * k); this.gut = Math.round(L.gutter * k);
    this.vw = fi.size[0]; this.vh = fi.size[1]; this.L = L; this.netUrl = url(fi.file);
    this.src = URL.createObjectURL(blob);
    return this;
  };
  Clip.prototype.load = function (useNet) {
    var c = this, v = c.v;
    if (v._clip && v._clip !== c) { v._clip.primed = false; if (v._clip.s.clipP) v._clip.s.clipP[v._clip.name] = null; }
    v._clip = c; c.primed = false; c.F = -1;
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { done('timeout'); }, 12000);
      function ok() { done(); }
      function bad() { done(v.error ? v.error.code : 'error'); }
      function done(e) { clearTimeout(to); v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', bad); if (e) rej(e); else res(); }
      v.addEventListener('loadedmetadata', ok); v.addEventListener('error', bad);
      v.loop = !!c.cm.loopRest;                                      // placeholder: the idle clip loops at rest
      v.src = useNet ? c.netUrl : c.src;
    }).then(function () {
      if (v.videoWidth !== c.vw || v.videoHeight !== c.vh) { director.stale(); throw 'size'; }
      return c.prime();
    }, function (e) {
      if ((e === 4 || e === 2) && !useNet) return c.load(true);   // SRC_NOT_SUPPORTED (iOS blob quirk) / NETWORK: once from the URL
      if (e === 3 || e === 4) markBad(c.codec);
      throw e;
    });
  };
  Clip.prototype.prime = function () {
    var c = this, v = c.v, G = c.s.G;
    if (!G) return Promise.reject('nogl');
    if (!c.tex) c.tex = G.tex();
    return new Promise(function (res, rej) {
      var notReady = 0, failing = 0, t = setTimeout(function () { c.priming = null; v.pause(); rej('prime-timeout'); }, env.touch ? 8000 : 6000);
      c.priming = function () {
        G.up(c.tex, v, false);
        var r = c.s.calibrate(c);
        if (r === 'retry' && ++notReady < 10) return;
        if (r === 'fail' || r === 'retry') { if (++failing < 3) return; clearTimeout(t); c.priming = null; v.pause(); setVideo('broken'); rej('broken'); return; }
        clearTimeout(t); c.priming = null; v.pause();
        try { v.currentTime = 0.5 / FPS; } catch (e) { /* ignore */ }
        c.primed = true; c.F = -1; res(c);
      };
      try { v.currentTime = 0.5 / FPS; } catch (e) { /* ignore */ }
      c.watch(); playV(v);
      if (!env.rvfc) v.addEventListener('playing', function once() { v.removeEventListener('playing', once); requestAnimationFrame(function () { if (c.priming) c.priming(); }); });
    });
  };
  Clip.prototype.watch = function () {                               // rVFC frame clock (W7)
    var c = this, v = c.v;
    if (!env.rvfc || c.rv) return;
    c.rv = v.requestVideoFrameCallback(function (t, md) {
      c.rv = 0;
      if (v._clip !== c) return;
      if (c.priming) { c.priming(); if (c.priming) c.watch(); return; }
      if (c.unlocking) return;
      if (c.t0 == null) c.t0 = 0;
      c.frame(frameOf(md.mediaTime, c.t0, c.N));
      if (!v.paused || c.seekTo != null) c.watch();
    });
  };
  Clip.prototype.frame = function (F) {
    var c = this;
    if (c.seekTo != null && F !== c.seekTo && now() - c.seekT < 250) return;   // hold the old frame until the seek lands (<= 250 ms)
    c.seekTo = null;
    c.s.G.up(c.tex, c.v, false);
    c.F = F; c.lastFrameT = now(); c.s.onClipFrame(c, F);
    kick();
  };
  Clip.prototype.poll = function () {                                // no rVFC: poll currentTime every rAF while playing
    var c = this, v = c.v;
    if (env.rvfc || !c.primed || v._clip !== c) return;
    if (!v.paused || c.pollN > 0) {
      if (c.pollN > 0) c.pollN--;
      c.seekTo = null;
      c.frame(clamp(Math.floor(v.currentTime * FPS + 0.001), 0, c.N - 1));
    }
  };
  Clip.prototype.play = function (rate) {
    var v = this.v;
    if (rate != null && Math.abs(v.playbackRate - rate) > 0.1) v.playbackRate = rate;
    if (v.paused) { this.playT = now(); this.armed = false; }
    this.watch(); playV(v);
  };
  Clip.prototype.pause = function () { if (!this.v.paused) this.v.pause(); };
  Clip.prototype.seek = function (F) {
    var c = this; F = clamp(Math.round(F), 0, c.N - 1);
    c.seekTo = F; c.seekT = now(); c.pollN = 3;
    try { c.v.currentTime = (F + 0.5) / FPS; } catch (e) { /* ignore */ }
    c.watch();
  };
  Clip.prototype.last = function () { var v = this.v; return this.F >= this.N - 1 || v.ended || (v.paused && v.currentTime >= (this.N - 1) / FPS); };
  Clip.prototype.stall = function (t) {                              // watchdog (W7)
    var c = this, v = c.v;
    if (v.paused || !c.primed || c.priming) { c.ct = null; return false; }
    if (!c.armed) { if (c.lastFrameT > c.playT) c.armed = true; else if (t - c.playT > (env.touch ? 2500 : 1500)) c.armed = true; else return false; }
    var q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0;
    if (c.ct !== v.currentTime || c.tq !== q) { c.ct = v.currentTime; c.tq = q; c.ctT = t; return false; }
    return t - Math.max(c.lastFrameT || 0, c.ctT || 0) > 600 && t - lastRaf < 100;
  };

  /* ------------------------------------------------------------------ Rest compositor (W6 REST + W10) */
  function Rest(scene) {
    this.s = scene; this.t = {}; this.ok = false;
    this.th = 0; this.vth = 0; this.ka = 0; this.vka = 0; this.tth = 0; this.tka = 0; this.tT = 0;
    this.breathE = 0; this.breathOn = 0; this.lastIn = now(); this.flick = null; this.cell = 0;
  }
  Rest.prototype.set = function (m, tier) {
    var sm = this.s.sm, R = this;
    if (!sm || !sm.rest) return;
    R.m = m; R.sm = sm; R.k = m.tiers[tier]; R.look = sm.look || null; R.tg = R.look && R.look.tongue || null;
    R.flowM = sm.rest.flow || null; R.br = sm.rest.breath || { periodS: 3.6, amp: 0 };
    if (R.look) { R.ka = R.tka = R.look.angles[R.look.neutral]; R.cell = R.look.neutral; }
  };
  Rest.prototype.cellOrigin = function (i) {
    var L = this.look, a = L.atlas, cw = Math.round(L.rect[2] * this.k), ch = Math.round(L.rect[3] * this.k);
    return [a.pad + (i % a.cols) * (cw + 2 * a.pad), a.pad + Math.floor(i / a.cols) * (ch + 2 * a.pad)];
  };
  Rest.prototype.tongOrigin = function (cell, f) {
    var T = this.tg, a = T.atlas, sw = Math.round(T.slot[0] * this.k), sh = Math.round(T.slot[1] * this.k);
    return [a.pad + f * (sw + 2 * a.pad), a.pad + cell * (sh + 2 * a.pad)];
  };
  Rest.prototype.lookOn = function () { return !!(this.look && this.t.look && this.t.mask); };
  Rest.prototype.uni = function () {
    var R = this, sm = R.sm, st = sm.stage, Z = [0, 0, 0, 0], U = {};
    U.uBaseR = sm.rest.still.rect || st; U.uBaseS = R.sz.base; U.uK = R.k; U.uHalf = 0.5;
    U.uFlowR = R.t.flow ? R.flowM.rect : Z; U.uFlowS = R.sz.flow || [1, 1];
    U.uFlowZero = R.flowM ? R.flowM.zero : 128; U.uFlowPx = R.flowM ? R.flowM.pxPerUnit : 32;
    if (R.flowM && R.flowM.fileScale) U.uHalf = R.flowM.fileScale;
    U.uBreath = R.t.flow ? R.br.amp * Math.sin(2 * Math.PI * (now() / 1000) / R.br.periodS) * R.breathE : 0;
    if (R.lookOn()) {
      var L = R.look, n = L.angles.length, x = (R.ka - L.angles[0]) / (L.angles[1] - L.angles[0]);
      x = clamp(x, 0, n - 1); var i = Math.min(Math.floor(x), n - 2), f = x - i;
      if (f > 0.999) { i++; f = 0; }
      if (R.flick) { i = R.flick.cell; f = 0; }
      R.cell = f > 0.5 ? i + 1 : i;
      U.uMaskR = L.mask.rect; U.uMaskS = R.sz.mask; U.uLookR = L.rect; U.uLookS = R.sz.look;
      U.uCellA = R.cellOrigin(i); U.uCellB = R.cellOrigin(Math.min(i + 1, n - 1)); U.uCellMix = f;
      U.uPivot = L.warp.pivot; U.uAxis = L.warp.axis; U.uStart = L.warp.start; U.uLen = L.warp.length;
      U.uWarp = R.th * Math.PI / 180 * (L.warp.positive === 'ccw' ? -1 : 1);
      var fl = R.flick, tf = fl && R.t.tong ? fl.seq[Math.min(fl.seq.length - 1, Math.floor((now() - fl.t0) / 1000 * FPS))] : -1;
      U.uTongOn = tf >= 0 ? 1 : 0; U.uTongS = R.sz.tong || [1, 1];
      U.uTongR = tf >= 0 ? R.tg.origins[fl.cell].concat(R.tg.slot) : Z; U.uTongO = tf >= 0 ? R.tongOrigin(fl.cell, tf) : [0, 0];
    } else {
      U.uMaskR = Z; U.uMaskS = [1, 1]; U.uLookR = Z; U.uLookS = [1, 1]; U.uCellA = [0, 0]; U.uCellB = [0, 0]; U.uCellMix = 0;
      U.uPivot = [0, 0]; U.uAxis = [1, 0]; U.uStart = 0; U.uLen = 1; U.uWarp = 0; U.uTongOn = 0; U.uTongS = [1, 1]; U.uTongR = Z; U.uTongO = [0, 0];
    }
    return U;
  };
  Rest.prototype.target = function (th, ka, force) {                 // a new target needs > 3 deg or 300 ms
    var R = this, L = R.look; if (!L) return;
    var t = now();
    th = clamp(th, L.warp.rangeDeg[0], L.warp.rangeDeg[1]); ka = clamp(ka, L.angles[0], L.angles[L.angles.length - 1]);
    if (!force && Math.abs(th - R.tth) <= 3 && Math.abs(ka - R.tka) <= 3 && t - R.tT < 300) return;
    R.tth = th; if (!R.flick) R.tka = ka; R.tT = t; kick();
  };
  Rest.prototype.doFlick = function (kind) {
    var R = this; if (!R.t.tong || !R.tg || R.flick || !R.lookOn()) return;
    var L = R.look, i = Math.round(clamp((R.ka - L.angles[0]) / (L.angles[1] - L.angles[0]), 0, L.angles.length - 1));
    R.ka = R.tka = L.angles[i]; R.vka = 0;                           // snap kappa onto a cell and freeze it
    R.flick = { seq: R.tg[kind] || R.tg.single, t0: now(), cell: i }; R.lastFlick = now(); kick();
  };
  Rest.prototype.step = function (dt, t) {                           // springs, flick timeline, breath ease; returns "needs a frame"
    var R = this, busy = false;
    function spring(x, v, tgt, om) { var a = om * om * (tgt - x) - 2 * om * v; v = clamp(v + a * dt, -240, 240); return [x + v * dt, v]; }
    if (R.lookOn()) {
      var s = spring(R.th, R.vth, R.tth, 10); R.th = s[0]; R.vth = s[1];
      if (R.flick) { R.vth = clamp(R.vth, -60, 60); }
      else {
        s = spring(R.ka, R.vka, R.tka, 8); R.ka = s[0]; R.vka = s[1];
        var L = R.look, st = L.angles[1] - L.angles[0], c = L.angles[0] + Math.round((R.ka - L.angles[0]) / st) * st;
        if (Math.abs(R.vka) < 3 && Math.abs(R.ka - c) <= 2.5 && Math.abs(R.tka - R.ka) < 3) { R.ka = lerp(R.ka, c, clamp(dt / 0.12, 0, 1)); if (Math.abs(R.ka - c) < 0.01) { R.ka = c; R.vka = 0; } }
      }
      busy = Math.abs(R.vth) > 0.05 || Math.abs(R.vka) > 0.05 || Math.abs(R.tth - R.th) > 0.05 || Math.abs(R.tka - R.ka) > 0.01;
      if (R.flick) { busy = true; if (t - R.flick.t0 > R.flick.seq.length / FPS * 1000) { R.flick = null; R.lastFlick = t; } }
    }
    var on = R.breathOn && R.t.flow && R.br.amp > 0 && t - R.lastIn < 45000 ? 1 : 0;
    var ease = !on && R.s.st === 'align' ? 0.15 : 1.5;                // align: breath out fast, the departure must follow the scroll
    if (R.breathE !== on) { R.breathE = on ? Math.min(1, R.breathE + dt / ease) : Math.max(0, R.breathE - dt / ease); busy = true; }
    if (R.breathE > 0) { var f = Math.floor(t / 1000 * FPS); if (f !== R.bf) { R.bf = f; busy = true; } R.breathTick = true; } else R.breathTick = false;
    return busy;
  };

  /* ------------------------------------------------------------------ Scene base */
  var video = 'ok', userStill = false, envStill = false, mode = 'motion';
  var scenes = [], director = null, rafId = 0, lastRaf = 0, lastInput = 0, scrollY = 0, lastScrollT = -1e9;
  var jumping = false, jumpT = 0, jumpScrolls = 0, sawScrollEnd = false;
  function setVideo(v) {
    if (video === v || (video === 'broken' && v === 'blocked')) return;
    log('video', v); video = v;
    if (v === 'blocked' && B.abort) try { B.abort(); } catch (e) { /* ignore */ }
    kick();
  }
  function Scene(name, sec, layer) {
    this.name = name; this.sec = sec; this.layer = layer; this.vis = 0; this.near = false;
    this.cv = el('canvas', '', layer); this.img = el('img', '', layer); this.img.alt = ''; this.img.decoding = 'async';
    this.cv.setAttribute('aria-hidden', 'true');
    this.G = null; this.R = new Rest(this); this.clips = {}; this.view = null; this.dirty = true; this.upQ = [];
  }
  Scene.prototype.gl = function () {
    var S = this;
    if (S.G || S.noGL) return S.G;
    S.G = makeGL(S.cv);
    if (!S.G) { S.noGL = true; return null; }
    S.cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); S.lost = true; S.showImg(true); });
    S.cv.addEventListener('webglcontextrestored', function () { S.lost = false; S.restore(); });
    return S.G;
  };
  Scene.prototype.restore = function () {                            // re-upload from cached Images / blobs, no replay
    var S = this, G = S.G; if (!G) return;
    G.init(); var R = S.R, k;
    var src = R.src || {};
    for (k in R.t) R.t[k] = null;
    for (k in src) { R.t[k] = G.tex(); G.up(R.t[k], src[k], k !== 'flow' && k !== 'mask'); }
    for (k in S.clips) { var c = S.clips[k]; if (c) { c.tex = G.tex(); c.lut = null; c.fix = null; if (c.primed) S.calibrate(c, true); } }
    if (R.t.base && mode === 'motion') S.showImg(false);
    S.dirty = true; kick();
  };
  Scene.prototype.size = function (tier) {
    var st = this.sm.stage, k = this.m.tiers[tier], W = Math.round(st[2] * k), H = Math.round(st[3] * k);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; this.dirty = true; }
  };
  Scene.prototype.showImg = function (on) {
    this.layer.classList.toggle('is-img', !!on); this.imgMode = !!on;
    if (this.name === 'hero') this.sec.classList.toggle('is-snake-static', !!on || !!(this.sm && !this.sm.look));   // no look set: no «she follows» hint
  };
  Scene.prototype.stillUrl = function () {
    var fi = this.m.files[this.name + '/' + this.tier + '/rest.webp'];
    return fi ? url(fi.file) : '';
  };
  Scene.prototype.imgStill = function () {                           // <img> rest still; resolves after decode (or failure)
    var S = this, u = S.stillUrl(), im = S.img;
    S.showImg(true);
    if (!u) return Promise.resolve(false);
    if (im._u !== u) { im._u = u; im.src = (imgCache[u] && imgCache[u]._done) || u; }
    return (im.decode ? im.decode() : Promise.resolve()).then(function () { return true; }, function () { return false; });
  };
  Scene.prototype.loadBase = function (prio) {                        // P2: rest.webp at the scene tier -> GL texture
    var S = this, key = S.name + '/' + S.tier + '/rest.webp';
    if (S.baseP && S.baseP.key === key) return S.baseP;
    S.baseP = loadImg(S.m, key, prio).then(function (im) {
      imgCache[url(S.m.files[key].file)]._done = im._url;
      var G = S.gl(); if (!G) return im;
      S.R.src = S.R.src || {}; S.R.src.base = im; S.R.sz = S.R.sz || {};
      S.R.t.base = S.R.t.base || G.tex(); G.up(S.R.t.base, im, true); S.R.sz.base = [im.naturalWidth, im.naturalHeight];
      S.R.ok = true; S.dirty = true; kick();
      return im;
    });
    S.baseP.key = key;
    return S.baseP;
  };
  Scene.prototype.loadExtras = function () {                         // P3: mask, flow, look, tongue (fetch now, upload one per rAF later)
    var S = this, sm = S.sm, R = S.R, list = [];
    if (S.extrasFor === S.tier || !S.gl()) return;
    S.extrasFor = S.tier;
    if (sm.rest.flow && sm.rest.breath && sm.rest.breath.amp > 0) list.push(['flow', S.name + '/' + sm.rest.flow.file, false]);
    if (sm.look) {
      list.push(['mask', S.name + '/' + sm.look.mask.file, false], ['look', S.name + '/' + S.tier + '/' + sm.look.atlas.file, true]);
      if (sm.look.tongue) list.push(['tong', S.name + '/' + S.tier + '/' + sm.look.tongue.atlas.file, true]);
    }
    list.forEach(function (it) {
      loadImg(S.m, it[1], 'low').then(function (im) {
        S.upQ.push(function () {
          var G = S.G; if (!G) return;
          R.src = R.src || {}; R.src[it[0]] = im; R.sz = R.sz || {};
          R.t[it[0]] = R.t[it[0]] || G.tex(); G.up(R.t[it[0]], im, it[2]); R.sz[it[0]] = [im.naturalWidth, im.naturalHeight];
          S.dirty = true;
        });
        kick();
      }, function (e) { log('extra failed', it[1], e); });
    });
  };
  Scene.prototype.calibrate = function (c, quiet) {                  // W6 calibration; 'ok' | 'retry' | 'fail'
    var S = this, G = S.G, L = c.L, info = { codec: c.codec };
    if (!L.strip && !L.patches) { c.lut = null; c.fix = null; c.cal = { kind: 'identity (no strip)' }; return 'ok'; }
    var pts = [], i, H = c.H, w = c.vw, k = c.k;
    if (L.strip) { var pw = Math.floor(w / 16); for (i = 0; i < 16; i++) pts.push([i < 15 ? (i + 0.5) * pw : (15 * pw + w) / 2, H + (L.strip.y + L.strip.h / 2) * k]); }
    if (L.patches) { var qw = Math.floor(w / 4); for (i = 0; i < 4; i++) pts.push([i < 3 ? (i + 0.5) * qw : (3 * qw + w) / 2, H + (L.patches.y + L.patches.h / 2) * k]); }
    var med = G.sample(c, pts), m = [];
    if (L.strip) {
      for (i = 0; i < 16; i++) m.push((med[i][0] + med[i][1] + med[i][2]) / 3);
      if (m.every(function (x) { return x < 8; })) return 'retry';
      if (m[15] < 204 || m[0] > 38) { log('cal gate fail', m); return 'fail'; }
      var f = fitLut(m); info.fit = f; c.lut = f.kind === 'identity' ? null : G.lutTex(f.lut);
    } else c.lut = null;
    c.fix = null;
    if (L.patches) {
      var dec = med.slice(L.strip ? 16 : 0).map(function (p) { return p.map(function (v) { return info.fit && info.fit.lut ? info.fit.lut[Math.round(v)] : v; }); });
      var e709 = 0, e601 = 0;
      for (i = 0; i < 4; i++) { e709 += dE(dec[i], L.patches.rgb[i]) / 4; e601 += dE(dec[i], as601(L.patches.rgb[i])) / 4; }
      info.e709 = e709; info.e601 = e601;
      if (e601 + 3 < e709) { c.fix = fix601(); info.matrix = '601 repaired'; }
      else info.matrix = e709 <= 6 ? 'bt709 ok' : 'mismatch (identity kept)';
    }
    info.med = m; c.cal = info; if (!quiet) log('calibrated', S.name, c.name, info);
    return 'ok';
  };
  Scene.prototype.draw = function () {
    var S = this, G = S.G, V = S.view;
    if (!G || S.lost || !S.dirty) return;
    S.dirty = false;
    G.begin(S.sm.stage);
    if (!V) return;
    var t = V.b !== undefined ? clamp((now() - V.t0) / V.dur, 0, 1) : 1;
    function one(src, op, add) {
      if (!src || op <= 0) return;
      if (src === 'rest') { if (S.R.t.base) G.drawRest(S.R, op, add); }
      else if (src.tex && src.F >= 0) G.drawClip(src, op, add);
    }
    if (V.b !== undefined) { one(V.a, 1 - t, true); one(V.b, t, true); if (t >= 1) S.view = { a: V.b }; else S.dirty = true; }
    else one(V.a, 1, false);
  };
  Scene.prototype.fadeTo = function (src, frames) {                 // GL crossfade (W6): 5 frames into rest, 3 out of rest
    var V = this.view;
    if (!V || !V.a || !frames) this.view = { a: src };
    else this.view = { a: V.b !== undefined ? V.b : V.a, b: src, t0: now(), dur: frames * 1000 / FPS };
    this.dirty = true; kick();
  };
  Scene.prototype.opacity = function (o, ms) {
    var s = this.layer.style; s.transition = ms ? 'opacity ' + ms + 'ms linear' : 'none'; s.opacity = o >= 1 ? '' : String(o); this.op = o;
  };
  Scene.prototype.toRest = function (fadeMs) {                       // GL rest (the <img> until GL is ready); resolves after decode
    var S = this;
    S.R.breathOn = 1; S.R.lastIn = now();
    S.opacity(fadeMs ? 0 : 1, 0);
    function shown(ok) { if (fadeMs) { S.layer.offsetWidth; S.opacity(1, fadeMs); } else S.opacity(1, 0); return ok; }
    if (S.R.ok && S.G && !S.lost) { S.showImg(false); S.fadeTo('rest', 0); S.loadExtras(); return Promise.resolve(shown(true)); }
    if (mode === 'motion' && S.gl()) return S.loadBase('high').then(function () {
      if (mode === 'motion') { S.view = { a: 'rest' }; S.dirty = true; S.draw(); S.showImg(false); S.loadExtras(); }
      return shown(true);
    }, function () { return S.imgStill().then(shown); });
    return S.imgStill().then(shown);
  };
  Scene.prototype.clear = function () { this.view = null; this.dirty = true; kick(); };
  Scene.prototype.pauseAll = function () { for (var k in this.clips) if (this.clips[k]) this.clips[k].pause(); };
  Scene.prototype.loadClip = function (name, v, prio, blobP) {        // fetch whole file -> Blob -> pool element -> primed
    var S = this, m = S.m, sm = S.sm;
    if (!sm.clips || !sm.clips[name]) return Promise.reject('noclip');
    if (S.clipP && S.clipP[name]) return S.clipP[name];
    var old = S.clips[name];
    if (old && old.primed && old.v._clip === old) return Promise.resolve(old);
    if (old && old.blob && !blobP) blobP = Promise.resolve({ blob: old.blob, codec: old.codec, tier: old.tier });
    var ct = clipTierOf(S.tier, m), key = S.name + '/' + ct + '/' + name;
    S.clipP = S.clipP || {};
    var p = S.clipP[name] = (blobP || pick(m, key, S.skipCodec).then(function (k) {
      if (!k) throw 'nocodec';
      var fi = m.files[key + '.' + k + '.mp4'];
      return getBlob(url(fi.file), prio).then(function (b) { return { blob: b, codec: k, tier: ct }; }, function (e) { if (e === 404) director.stale(); throw e; });
    })).then(function (o) {
      if (!o) throw 'noblob';
      var c = old && old.blob === o.blob ? old : new Clip(S, name, v).setup(m, o.tier, o.codec, o.blob);
      if (!S.gl()) throw 'nogl';
      if (video === 'blocked') { S.clips[name] = c; S.pendingLoad = S.pendingLoad || []; S.pendingLoad.push(name); throw 'blocked'; }
      return c.load().then(function () { S.clips[name] = c; log('primed', S.name, name, o.tier, o.codec); return c; });
    });
    p.catch(function (e) { if (e !== 'blocked') { delete S.clipP[name]; S.clipFail = S.clipFail || {}; S.clipFail[name] = e; } log('clip', name, 'failed', e); });
    return p;
  };
  Scene.prototype.ready = function (name) { var c = this.clips[name]; return !!(c && c.primed && video === 'ok' && this.G && !this.lost); };

  /* ------------------------------------------------------------------ Hero */
  function Hero(sec, layer) { Scene.call(this, 'hero', sec, layer); this.st = 'boot'; this.p = 0; this.pHold = 0; this.lastClipEnd = -1e9; }
  Hero.prototype = Object.create(Scene.prototype);
  Hero.prototype.layout = function () {                             // W5 hero fit
    var S = this, sec = S.sec, W = sec.clientWidth, H = vh(), desk = mm('(min-width: 960px)');
    var navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 72;
    var bw, bh, bx, by;
    if (desk) { bw = Math.min(0.5 * W, 1.85 * 0.5 * H); bh = bw / 1.85; bx = W - Math.max(48, 0.05 * W) - bw; by = 0.4 * H - bh / 2; }
    else { bw = W - 32; bh = bw / 1.85; bx = 16; by = navH + 20; }
    var ss = sec.style;
    ss.setProperty('--logo-x', bx + 'px'); ss.setProperty('--logo-y', by + 'px'); ss.setProperty('--logo-w', bw + 'px'); ss.setProperty('--logo-h', bh + 'px');
    S.desk = desk; S.vh = H;
    var r = sec.getBoundingClientRect(); S.docTop = r.top + scrollY; S.docLeft = r.left + (w.pageXOffset || 0);
    if (!S.sm) return;
    var ae = S.sm.anchors.aeBox, fr = S.sm.frame, st = S.sm.stage;
    var s = HERO_FIT.h * bh / ae[3], Fx = bx + HERO_FIT.dx * bw - s * ae[0], Fy = by + HERO_FIT.dy * bh - s * ae[1];
    if (Fx + s * fr[0] < W + HERO_FIT.edge) Fx = W + HERO_FIT.edge - s * fr[0];
    S.s = s; S.Fx = Fx; S.Fy = Fy; S.D = s * S.m.pxPerD;
    S.lx = Fx + s * st[0]; S.ly = Fy + s * st[1];
    var ls = S.layer.style;
    ls.setProperty('--s3d-x', S.lx + 'px'); ls.setProperty('--s3d-y', S.ly + 'px'); ls.setProperty('--s3d-w', s * st[2] + 'px'); ls.setProperty('--s3d-h', s * st[3] + 'px');
    var hint = sec.querySelector('[data-hero-hint]');
    if (hint && desk) {
      var top = S.sm.look ? S.sm.look.envelopeTop : ae[1];
      ss.setProperty('--hint-y', Math.max(navH + 8, Math.min(by - 44, Fy + s * top - 8 - hint.offsetHeight)) + 'px');
    }
    var need = S.D * Math.min(w.devicePixelRatio || 1, 2);
    S.need = need;
    if (!S.tier) S.tier = tierFor(need, S.m);
    S.size(S.tier);
    var sc = desk ? HERO_SCROLL.desk : HERO_SCROLL.phone; S.sa = sc[0]; S.sb = sc[1];
    S.dirty = true;
  };
  Hero.prototype.prog = function () { return clamp((scrollY - this.sa * this.vh) / ((this.sb - this.sa) * this.vh), 0, 1); };
  Hero.prototype.go = function (st) { if (this.st !== st) { log(this.name, this.st, '->', st); this.st = st; if (st === 'rest') this.restT = now(); } };
  Hero.prototype.written = function () { if (!this.isW) { this.isW = true; emit(this.sec, 'snake:written', 'hero'); } };
  Hero.prototype.unwritten = function () { if (this.isW !== false) { this.isW = false; emit(this.sec, 'snake:unwritten', 'hero'); } };
  Scene.prototype.applyRepick = function () {                         // W3: re-pick the tier on entry into gone / empty
    var S = this; if (!S.repick) return; S.repick = false;
    var t = tierFor(S.need, S.m); if (t === S.tier) return;
    log('repick', S.name, S.tier, '->', t);
    S.tier = t; S.size(t); S.baseP = null; S.extrasFor = null; S.R.ok = false; S.R.t = {}; S.R.src = {}; S.R.set(S.m, t); S.clipP = {}; S.clips = {};
  };
  Hero.prototype.toGone = function (fade) {
    var S = this; S.applyRepick(); S.pauseAll(); S.unwritten(); S.go('gone');
    if (fade) { S.opacity(0, 200); setTimeout(function () { if (S.st === 'gone') { S.clear(); } }, 220); }
    else { S.opacity(0, 0); S.clear(); }
    S.lastClipEnd = Math.max(S.lastClipEnd, now() - 1000 + (fade ? 200 : 0));
  };
  Hero.prototype.restNow = function (fadeMs) {
    var S = this; S.pauseAll(); S.pHold = S.p; S.go('rest');
    S.toRest(fadeMs).then(function () { if (S.st === 'rest' || S.st === 'still') S.written(); });
    S.schedP4();
  };
  Hero.prototype.schedP4 = function () {
    var S = this; if (S.p4 || S.ready('depart') || video !== 'ok' || !S.sm.clips || !S.sm.clips.depart || (S.clipFail && S.clipFail.depart)) return;
    S.p4 = true;
    var fin = function () { S.p4 = false; };
    var go = function () { if (S.st === 'intro') return fin(); S.loadClip('depart', pool[0], 'low').then(function () { var r = S.sm.clips.depart.reverse; return r && S.loadClip(r, pool[1], 'low'); }).then(fin, fin); };
    if (w.requestIdleCallback) requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 1200);
  };
  Hero.prototype.onClipFrame = function (c, F) {
    var S = this, ev = c.cm.events || {};
    S.dirty = true;
    if (c.name === 'intro' && S.st === 'intro') {
      if (F >= (ev.written != null ? ev.written : c.cm.from === 'rest' ? 0 : c.N - 1)) S.written();
      if (c.last()) S.introEnd();
    } else if (S.st === 'depart') {
      if (c.name === 'depart' && ev.unwritten != null && F >= ev.unwritten) S.unwritten();
      if (S.view && S.view.a !== c && S.view.b !== c && S.dir === (c.name === 'depart' ? 'f' : 'r')) S.fadeTo(c, 0);
    }
  };
  Hero.prototype.introEnd = function () {
    var S = this, c = S.clips.intro;
    if (S.st !== 'intro') return;
    S.lastClipEnd = now(); S.written();
    S.pHold = S.pIntro != null ? S.pIntro : S.p; S.go('rest');
    S.R.breathOn = 1; S.R.lastIn = now();
    if (c && c.cm.loopRest) { /* keep looping the clip as the rest state */ }
    else {
      if (S.R.ok) S.fadeTo('rest', 5); else S.toRest(0);
      if (c) setTimeout(function () { if (S.st !== 'intro') c.pause(); }, 200);
    }
    S.loadExtras(); S.schedP4(); downgradeCheck(c);
  };
  Hero.prototype.playIntro = function () {
    var S = this, c = S.clips.intro;
    S.pIntro = S.p; S.go('intro'); S.opacity(1, 0); S.showImg(false); S.R.breathOn = 0;
    if (c.F > 0 || c.v.currentTime > 1 / FPS) c.seek(0);
    c.F = -1;
    c.v.playbackRate = 1; c.play(1); c.seg = qualityMark(c);
    S.view = { a: c }; S.dirty = true;
    if (gauge && gauge.st === 'rest' && Math.abs(gauge.docTop - scrollY) > gauge.vh) gauge.empty();
    if (!S.p3) { S.p3 = true; S.loadBase('low').then(function () { S.loadExtras(); }, function () {}); }
  };
  Hero.prototype.departPlayable = function () {
    var S = this, c = S.sm.clips && S.sm.clips.depart;
    return !!(c && S.ready('depart') && !S.imgMode);
  };
  Hero.prototype.tick = function (t, dt) {
    var S = this, p = S.p = S.prog(), R = S.R, c;
    while (S.upQ.length && S.st !== 'intro' && S.st !== 'depart') { S.upQ.shift()(); break; }
    if (S.st === 'wait') {
      c = S.clips.intro;
      var dl = env.slow ? 4000 : 3000;
      if (S.vis < 0.3 || p >= 0.5) { if (S.introGrab && S.introGrab.got >= 0 && S.introGrab.got < 0.6 * S.introGrab.total) S.abortIntro(); S.toGone(false); }
      else if (c && c.primed && video === 'ok') {
        if (root.classList.contains('is-loaded')) { S.loadedT = S.loadedT || t; if (t - S.loadedT >= 150) { S.p = S.prog(); visSync(S); if (S.vis < 0.3 || S.p >= 0.5) S.toGone(false); else S.playIntro(); } }
      } else if (video !== 'ok' || S.noIntro || t > dl) {
        if (t > dl && S.introGrab && !(c && c.primed)) { var g = S.introGrab; if (g.got >= 0 && g.got < 0.6 * g.total) S.abortIntro(); }
        S.restNow(600);
      }
    } else if (S.st === 'intro') {
      c = S.clips.intro;
      if (S.vis === 0 || (c && c.stall(t) && stallHit(c))) { c.pause(); S.introEnd(); S.pHold = p; }
      else if (c) { c.poll(); if (c.F >= 0 && c.last()) S.introEnd(); }
    } else if (S.st === 'rest') {
      if (gauge && t - S.restT > 4000) gauge.p5();
      var lc = S.clips.intro;                                         // placeholder (clips.intro.loopRest): rest = the looping idle clip
      if (lc && lc.cm.loopRest && S.ready('intro') && S.vis > 0 && !d.hidden) {
        if (lc.v.paused) lc.play(1);
        lc.poll();
        var V = S.view;
        if (!V || (V.a !== lc && V.b !== lc)) { S.showImg(false); S.fadeTo(lc, 5); }
      }
      if (p < S.pHold) S.pHold = p;
      if (jumping && p > S.pHold) { S.toGone(true); return; }
      if (S.fadeDep) {
        var o = 1 - sstep(S.fadeDep, 1, p); S.opacity(o, 0);
        if (o < 0.5) S.unwritten(); else S.written();
        if (o <= 0) { S.fadeDep = 0; S.toGone(false); S.lastClipEnd = t; }
        else if (p <= S.fadeDep) { S.fadeDep = 0; S.opacity(1, 0); S.written(); S.pHold = p; }
      } else if (p > S.pHold + 0.04) {
        S.p0 = Math.min(S.pHold, 0.8);
        if (S.departPlayable()) {
          S.go('align'); R.target(0, R.look ? R.look.angles[R.look.neutral] : 0, true); R.breathOn = 0; if (R.flick) R.flick = null;
          try { S.clips.depart.v.currentTime = 0.5 / FPS; } catch (e) { /* warm-up */ }
        } else S.fadeDep = S.p0 || 1e-6;
      }
      S.autonomy(t);
    } else if (S.st === 'align') {
      if (jumping) { S.toGone(true); return; }
      if (p <= S.pHold + 0.02) { S.go('rest'); R.breathOn = 1; return; }
      var neutral = !R.lookOn() || (Math.abs(R.th) < 0.5 && Math.abs(R.ka - R.look.angles[R.look.neutral]) < 0.5);
      if (neutral && R.breathE === 0) {
        c = S.clips.depart; S.dir = 'f'; S.go('depart');
        if (c.F !== 0) c.seek(0);
        S.fadeTo(c, 3); S.dep = { idleT: t };
      }
    } else if (S.st === 'depart') S.chase(t, p);
    else if (S.st === 'gone') {
      if (p <= 0.25 && t - lastScrollT >= 120 && !jumping && S.vis >= 0.3 && t - S.lastClipEnd >= 1000) {
        if (S.ready('intro') && S.sm.clips.intro) { S.playIntro(); if (gauge) gauge.empty(); }
        else if (!S.reformWait) {
          S.reformWait = true;
          var done = function () { S.reformWait = false; if (S.st === 'gone') { S.restNow(400); if (gauge) gauge.empty(); } };
          if (video === 'ok' && S.sm.clips && S.sm.clips.intro && !(S.clipFail && S.clipFail.intro)) S.loadClip('intro', pool[0], 'low').then(function () { S.reformWait = false; }, done);
          else done();
        }
      }
    }
  };
  Hero.prototype.chase = function (t, p) {                           // W7 chase for the depart / depart-rev pair
    var S = this, fw = S.clips.depart, rv = S.clips[S.sm.clips.depart.reverse], N = fw.N;
    var q = clamp((p - S.p0) / (1 - S.p0), 0, 1), Ft = q * (N - 1);
    if (S.vis === 0 || jumping) { S.toGone(true); return; }
    var rMax = t - lastInput < 250 ? 3 : 1.25;
    if (t - lastScrollT > 600) Ft = q < 0.5 ? 0 : N - 1;
    var rp = rv && rv.primed;
    if (S.dir === 'f') {
      fw.poll();
      var F = fw.F < 0 ? 0 : fw.F, gap = Ft - F;
      var idle = t - lastScrollT > 600;
      if (gap > 0.5) fw.play(idle ? 1 : clamp(gap / (FPS * 0.22), 0.6, rMax));
      else if (gap >= -0.5) { fw.pause(); if (rp && rv.F !== N - 1 - F && rv.v.paused) rv.seek(N - 1 - F); }
      else if (gap < -3 || (Ft === 0 && gap < 0)) {
        if (rp) { fw.pause(); S.dir = 'r'; if (rv.F !== N - 1 - F) rv.seek(N - 1 - F); }
        else if (Ft === 0 && t - lastScrollT > 600) { fw.pause(); S.backToRest(300); return; }
        else fw.pause();
      } else fw.pause();
      if (F >= N - 1 && fw.last()) { fw.pause(); S.departEnd(); }
    } else {
      rv.poll();
      var Fr = rv.F < 0 ? N - 1 - (fw.F < 0 ? 0 : fw.F) : rv.F, gr = (N - 1 - Ft) - Fr;
      if (rv.seekTo != null) return;
      if (gr > 0.5) rv.play(t - lastScrollT > 600 ? 1 : clamp(gr / (FPS * 0.22), 0.6, rMax));
      else if (gr >= -0.5) { rv.pause(); if (fw.F !== N - 1 - Fr && fw.v.paused) fw.seek(N - 1 - Fr); }
      else if (gr < -3) { rv.pause(); S.dir = 'f'; if (fw.F !== N - 1 - Fr) fw.seek(N - 1 - Fr); }
      else rv.pause();
      if (Fr >= N - 1 && Ft === 0) { rv.pause(); S.backToRest(0); }
    }
  };
  Hero.prototype.backToRest = function (ms) {
    var S = this; S.go('rest'); S.pHold = S.p; S.R.breathOn = 1; S.lastClipEnd = now();
    if (ms) { S.showImg(false); S.fadeTo('rest', Math.round(ms * FPS / 1000)); } else S.fadeTo('rest', 3);
    S.written();
  };
  Hero.prototype.departEnd = function () {
    var S = this; S.go('gone'); S.unwritten(); S.clear(); S.opacity(0, 0); S.lastClipEnd = now();
    clearTimeout(S.relT);
    S.relT = setTimeout(function () {                                // release the decoders if she stays gone (W14); blobs stay
      if (S.st === 'gone' && S.p >= 0.5) ['depart', S.sm.clips.depart.reverse].forEach(function (n) { var c = S.clips[n]; if (c) { release(c.v); c.primed = false; S.clipP[n] = null; } });
    }, 10000);
  };
  Hero.prototype.abortIntro = function () { if (B.abort) try { B.abort(); } catch (e) { /* ignore */ } this.introGrab = null; if (this.clipP) delete this.clipP.intro; };
  Hero.prototype.pointer = function (x, y, t) {                      // W10 hero look-at (client coords)
    var S = this, R = S.R; if (!R.lookOn() || S.st !== 'rest') return;
    var L = S.sm.look, eye = S.sm.anchors.eye, ex = S.docLeft + S.lx + (eye[0] - S.sm.stage[0]) * S.s - (w.pageXOffset || 0), ey = S.docTop + S.ly + (eye[1] - S.sm.stage[1]) * S.s - scrollY;
    var vx = x - ex, vy = y - ey, dist = Math.hypot(vx, vy) / S.D;
    var th = 0.6 * Math.atan2(-vy, Math.abs(vx) + 1.5 * S.D) * 180 / Math.PI;
    var f = sstep(-0.2, 0.6, vx / (Math.hypot(vx, vy) || 1)), c = 1 - sstep(1.5, 6, dist);
    R.target(th, lerp(0, 55, Math.max(f, c)));
    if (dist < 2 && t - (R.lastFlick || 0) > 2000 && !R.flick) R.doFlick('single');
    if (L) S.lastPtr = t;
  };
  Scene.prototype.autonomy = function (t) {                          // W10 autonomy: every U(2.5, 6) s when no pointer
    var S = this, R = S.R; if (!R.lookOn() || mode !== 'motion') return;
    if (!env.touch && t - (S.lastPtr || -1e9) < 4000) return;
    if (!S.autoT) S.autoT = t + rnd(2500, 6000);
    if (!R.lastFlick) R.lastFlick = t;
    if (t - R.lastFlick > (S.nextFlick || (S.nextFlick = rnd(3000, 6000))) && !R.flick) { R.doFlick(Math.random() < 0.35 ? 'double' : 'single'); S.nextFlick = rnd(3000, 6000); }
    if (t < S.autoT) return;
    S.autoT = t + rnd(2500, 6000);
    var L = R.look, a = L.angles, x = Math.random(), hero = S.name === 'hero';
    if (x < 0.45) R.target(rnd(0, 6), hero ? rnd(50, 60) : rnd(50, 60), true);
    else if (x < 0.75) { var tg = S.copyPoint && S.copyPoint(); if (tg) S.look(tg[0], tg[1]); }
    else if (x < 0.9) R.target(rnd(L.warp.rangeDeg[0], L.warp.rangeDeg[1]), rnd(a[0], a[a.length - 1]), true);
    else R.target(rnd(-3, 3), hero ? rnd(-10, -5) : rnd(15, 20), true);
  };
  Hero.prototype.look = function (x, y) { this.pointer(x, y, -1e9); };
  Hero.prototype.copyPoint = function () { var h = this.sec.querySelector('h1'); if (!h) return null; var r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  Hero.prototype.onStill = function (on) {
    var S = this;
    if (on) {
      if (S.st === 'intro' || S.st === 'depart' || S.st === 'align') S.pauseAll();
      S.go('still'); S.R.breathOn = 0; S.R.flick = null; S.opacity(1, 0);
      S.imgStill().then(function () { if (S.st === 'still') S.written(); });
      S.written();
    } else {
      var p = S.p = S.prog();
      if (S.vis >= 0.15 && p < 0.5) { S.pHold = p; S.go('rest'); S.R.breathOn = 1; if (S.gl()) S.loadBase('high').then(function () { if (mode === 'motion' && S.st === 'rest') { S.fadeTo('rest', 0); S.draw(); S.showImg(false); S.loadExtras(); S.schedP4(); } }, function () {}); }
      else { S.toGone(false); }
    }
  };

  /* ------------------------------------------------------------------ Gauge */
  function Gauge(sec, layer) { Scene.call(this, 'gauge', sec, layer); this.st = 'off'; this.pg = 0; }
  Gauge.prototype = Object.create(Scene.prototype);
  Gauge.prototype.layout = function () {
    var S = this, G = S.sec.offsetWidth; if (!S.sm || !G) return;
    var a = S.sm.anchors, st = S.sm.stage, s = 0.4 * G / a.ringRadius;
    var ls = S.layer.style;
    S.s = s; S.G_ = G; S.D = s * S.m.pxPerD; S.vh = vh();
    S.lx = G / 2 - s * (a.ringCenter[0] - st[0]); S.ly = G / 2 - s * (a.ringCenter[1] - st[1]);
    ls.setProperty('--s3d-x', S.lx + 'px'); ls.setProperty('--s3d-y', S.ly + 'px'); ls.setProperty('--s3d-w', s * st[2] + 'px'); ls.setProperty('--s3d-h', s * st[3] + 'px');
    if (a.tipX != null) S.sec.dataset.snakeTipX = a.tipX;
    var r = S.sec.getBoundingClientRect(); S.docTop = r.top + scrollY; S.docLeft = r.left + (w.pageXOffset || 0);
    if (!S.tier) S.tier = tierFor(S.D * Math.min(w.devicePixelRatio || 1, 2), S.m);
    S.need = S.D * Math.min(w.devicePixelRatio || 1, 2);
    S.size(S.tier); S.dirty = true;
  };
  Gauge.prototype.prog = function () { return clamp((scrollY + this.vh - this.docTop) / (0.45 * this.vh + 0.5 * this.G_), 0, 1); };
  Gauge.prototype.go = Hero.prototype.go;
  Gauge.prototype.arrived = function () { if (!this.isA) { this.isA = true; emit(this.sec, 'snake:arrived', 'gauge'); } };
  Gauge.prototype.departed = function () { if (this.isA !== false) { this.isA = false; emit(this.sec, 'snake:departed', 'gauge'); } };
  Gauge.prototype.p5 = function () {                                 // P5: gauge rest set + arrive
    var S = this; if (S.loaded || S.st === 'off') return;
    S.loaded = true;
    var still = mode === 'still';
    (still ? S.imgStill() : S.loadBase('low')).then(function (ok) {
      if (ok === false) throw 'still';
      root.classList.add('has-plush-ring');
      if (mode === 'still') S.arrived();
    }).catch(function () { root.classList.remove('has-plush-ring'); S.departed(); S.go('off'); S.layer.hidden = true; });
    if (!still) { S.loadExtras(); if (video !== 'blocked') S.loadClip('arrive', pool[2], 'low').catch(function () {}); }
  };
  Gauge.prototype.empty = function () {
    var S = this; if (S.st === 'off' || S.st === 'still') return;
    S.pauseAll(); S.clear(); S.departed(); S.applyRepick(); S.go('empty'); S.opacity(1, 0); S.R.breathOn = 0;
  };
  Gauge.prototype.allowed = function () { var h = hero; return !h || h.st === 'gone' || h.st === 'still' || (h.st === 'depart' && h.clips.depart.F >= 24) || h.vis === 0; };
  Gauge.prototype.tick = function (t) {
    var S = this, c = S.clips.arrive, pg = S.pg = S.prog();
    if (S.st === 'off' || S.st === 'still') return;
    while (S.upQ.length && S.st !== 'arrive') { S.upQ.shift()(); break; }
    if (S.st === 'empty') {
      if (S.vis > 0 && !S.visT) S.visT = t;
      if (S.vis === 0) S.visT = 0;
      if (!S.allowed()) { if (hero && hero.vis === 0 && hero.st !== 'gone') hero.toGone(false); else return; }
      var playable = S.ready('arrive');
      if (playable && !jumping && pg > 0 && !S.afterJump) { S.go('arrive'); S.timed = false; S.fadeTo(c, 0); }
      else if (playable && S.afterJump && !jumping && t - lastScrollT >= 120 && S.vis >= 0.35) { S.afterJump = false; S.go('arrive'); S.timed = true; c.seek(0); c.play(1); S.fadeTo(c, 0); }
      else if (S.vis >= 0.35 && (video !== 'ok' || !S.G || (S.clipFail && S.clipFail.arrive) || (!playable && S.visT && t - S.visT > 1500) || !S.sm.clips || !S.sm.clips.arrive)) {
        S.go('rest'); S.toRest(400).then(function (ok) { if (ok !== false) S.arrived(); });
      }
    } else if (S.st === 'arrive') {
      c.poll();
      if (S.vis === 0 || (c.stall(t) && stallHit(c))) { c.pause(); S.arriveEnd(true); return; }
      var N = c.N, F = c.F < 0 ? 0 : c.F;
      var Ft = S.timed ? N - 1 : Math.max(S.Ft || 0, pg * (N - 1));
      if (t - lastScrollT > 600 && F < N - 1) { if (S.vis >= 0.35) { Ft = N - 1; S.timed = true; } else Ft = F; }
      S.Ft = Ft;
      var gap = Ft - F, rMax = t - lastInput < 250 ? 3 : 1.25;
      if (gap > 0.5) c.play(S.timed ? 1 : clamp(gap / (FPS * 0.22), 0.6, rMax)); else c.pause();
      if (F >= N - 1 && c.last()) S.arriveEnd(false);
    } else if (S.st === 'rest') S.autonomy(t);
  };
  Gauge.prototype.onClipFrame = function (c, F) { this.dirty = true; if (this.st === 'arrive' && F >= c.N - 1) this.arriveEnd(false); };
  Gauge.prototype.arriveEnd = function (cut) {
    var S = this; if (S.st !== 'arrive') return;
    S.go('rest'); S.Ft = 0; S.R.breathOn = 1; S.R.lastIn = now();
    if (S.R.ok) S.fadeTo('rest', cut ? 0 : 5); else S.toRest(0);
    S.clips.arrive.pause();
    S.arrived();
  };
  Gauge.prototype.pointer = function (x, y, t) {
    var S = this, R = S.R; if (!R.lookOn() || S.st !== 'rest') return;
    var a = S.sm.anchors, ex = S.docLeft + S.lx + (a.eye[0] - S.sm.stage[0]) * S.s - (w.pageXOffset || 0), ey = S.docTop + S.ly + (a.eye[1] - S.sm.stage[1]) * S.s - scrollY;
    var vx = x - ex, vy = y - ey, dist = Math.hypot(vx, vy) / S.D, hd = a.headDir;
    var ang = (Math.atan2(vy, vx) - Math.atan2(hd[1], hd[0])) * 180 / Math.PI; ang = ((ang + 540) % 360) - 180;
    R.target(ang, lerp(25, 60, 1 - sstep(1, 5, dist)));
    if (dist < 2 && t - (R.lastFlick || 0) > 2000) R.doFlick('single');
    S.lastPtr = t;
  };
  Gauge.prototype.look = Gauge.prototype.pointer;
  Gauge.prototype.copyPoint = function () { var f = d.querySelector('.calc, [data-calc], form'); if (!f) return null; var r = f.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  Gauge.prototype.income = function () {
    var S = this, R = S.R, t = now(); if (S.st !== 'rest' || !R.lookOn() || t - (S.incT || 0) < 1200) return;
    S.incT = t; var a = S.sm.anchors, c = a.ringCenter, hd = a.headDir, e = a.eye;
    var ang = (Math.atan2(c[1] - e[1], c[0] - e[0]) - Math.atan2(hd[1], hd[0])) * 180 / Math.PI; ang = ((ang + 540) % 360) - 180;
    R.target(ang, 30, true); R.doFlick('single'); S.lastPtr = t;
  };
  Gauge.prototype.onStill = function (on) {
    var S = this; if (S.st === 'off') return;
    if (on) {
      var was = S.st; S.pauseAll(); S.go('still'); S.R.breathOn = 0;
      if (was === 'rest' || was === 'arrive' || S.vis > 0 || S.loaded) S.imgStill().then(function (ok) { if (ok && S.st === 'still') { root.classList.add('has-plush-ring'); S.arrived(); } });
    } else {
      var back = S.isA || S.vis > 0;
      if (back) { S.go('rest'); S.toRest(0).then(function () { S.arrived(); }); } else { S.go('empty'); S.showImg(false); }
      if (S.loaded) { S.loaded = false; S.p5(); }
    }
  };

  /* ------------------------------------------------------------------ Journey (docs/snake3d-journey.md)
     A fixed strip at the right edge between the hero and the gauge (desktop): one all-intra clip [in | loop | out],
     scrubbed by seeking; the loop repeats n times so one frame is ~14 px of scroll. Runs backwards on scroll up. */
  function Journey(layer) { Scene.call(this, 'journey', layer, layer); this.on = false; this.st = 'off'; }
  Journey.prototype = Object.create(Scene.prototype);
  Journey.prototype.layout = function () {
    var S = this, sm = S.sm; if (!sm || !hero || !hero.sb) return;
    var H = vh(), fr = sm.frame, c = sm.clips.journey, sg = c.segments;
    var s = hero.s || H / fr[1];                                     // the same size as the hero snake (user: «1 в 1 как с верхней»)
    var cy = c.cruiseY != null ? c.cruiseY : 0.62 * fr[1];          // head y during the loop, master px
    S.s = s; S.vh = H; S.D = s * S.m.pxPerD;
    var ls = S.layer.style;
    ls.setProperty('--s3d-w', s * fr[0] + 'px'); ls.setProperty('--s3d-h', s * fr[1] + 'px');
    ls.setProperty('--s3d-y', 0.62 * H - cy * s + 'px');             // cruise head at 62 % of the viewport
    S.y0 = hero.sb * hero.vh;
    S.y1 = gauge && gauge.docTop ? gauge.docTop - H : d.documentElement.scrollHeight - H;
    var a = sg.in[1], L = sg.loop[1] - sg.loop[0], o = c.frames - sg.out[0], R = S.y1 - S.y0;
    S.n = Math.max(1, Math.round((R / 14 - a - o) / L));
    S.tot = a + S.n * L + o; S.ppf = R / S.tot;
    S.fits = mm('(min-width: 960px)') && R > S.tot * 4;
    if (!S.tier) S.tier = tierFor(S.D * Math.min(w.devicePixelRatio || 1, 2), S.m);
    S.need = S.D * Math.min(w.devicePixelRatio || 1, 2);
    S.size(S.tier); S.dirty = true;
  };
  Journey.prototype.fmap = function (U) {                           // unrolled frame -> clip frame
    var sg = this.sm.clips.journey.segments, a = sg.in[1], b = sg.loop[0], L = sg.loop[1] - b, N = this.sm.clips.journey.frames;
    U = Math.max(0, Math.floor(U));
    if (U < a) return U;
    var u = U - a, loops = this.n * L;
    return u < loops ? b + (u % L) : Math.min(N - 1, sg.out[0] + (u - loops));
  };
  Journey.prototype.onClipFrame = function () { this.dirty = true; };
  Journey.prototype.onStill = function (on) { if (on) { this.pauseAll(); this.hide(0); } };
  Journey.prototype.hide = function (ms) { if (!this.on) return; this.on = false; this.vis = 0; this.opacity(0, ms || 0); var S = this; setTimeout(function () { if (!S.on) S.clear(); }, (ms || 0) + 20); };
  Journey.prototype.tick = function (t) {
    var S = this, c = S.clips.journey;
    if (hero && hero.st !== 'gone' && hero.st !== 'still' && hero.vis === 0 && scrollY > S.y0 && S.fits && mode === 'motion') hero.toGone(false);   // hero out of view: she has left
    var want = mode === 'motion' && S.fits && video === 'ok' && !jumping && hero && hero.st === 'gone' &&
      (!gauge || gauge.st === 'empty' || gauge.st === 'off') && scrollY > S.y0 && scrollY < S.y1;
    if (!want) { S.hide(jumping ? 200 : 0); return; }
    if (!S.ready('journey')) {
      if (!S.loading && !hero.p4 && !(S.clipFail && S.clipFail.journey) && S.gl()) {   /* never while the hero still loads its pair into hero B */ S.loading = true; S.loadClip('journey', pool[1], 'low').then(function () { S.loading = false; kick(); }, function () { S.loading = false; }); }
      return;
    }
    var f = S.fmap((scrollY - S.y0) / S.ppf);
    if (c.seekTo == null || t - c.seekT > 150) { if (c.F !== f) c.seek(f); }
    c.poll();
    if (!S.on && c.F >= 0) { S.on = true; S.vis = 1; S.view = { a: c }; S.opacity(1, 0); S.dirty = true; }
  };

  /* ------------------------------------------------------------------ quality / watchdog helpers */
  var stalls = 0, slowSegs = 0;
  function stallHit(c) {
    stalls++;
    if (stalls === 1) { c.pause(); c.seek(c.F < 0 ? 0 : c.F); setTimeout(function () { c.play(); }, 50); return false; }
    setVideo('broken'); return true;
  }
  function qualityMark(c) { var q = c.v.getVideoPlaybackQuality && c.v.getVideoPlaybackQuality(); return q ? { t: now(), d: q.droppedVideoFrames, n: q.totalVideoFrames } : null; }
  function downgradeCheck(c) {                                       // W3 runtime downgrade: 1x segments >= 1 s
    if (!c || !c.seg || d.hidden || now() - c.seg.t < 1000 || now() - lastScrollT < 250) return;
    var q = qualityMark(c), dn = q.n - c.seg.n; if (dn < 10) return;
    if ((q.d - c.seg.d) / dn > 0.15 && ++slowSegs >= 2) { if (hero) hero.skipCodec = (hero.skipCodec || '') + c.codec; if (gauge) gauge.skipCodec = (gauge.skipCodec || '') + c.codec; log('downgrade from', c.codec); }
  }

  /* ------------------------------------------------------------------ Director */
  var hero = null, gauge = null, journey = null, M = null, opts = null, hubbed = false;
  function kick() { if (!rafId && !d.hidden && director) rafId = requestAnimationFrame(loop); }
  var lastT = 0;
  function loop(t) {
    rafId = 0; var dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t; lastRaf = now();
    var need = false;
    if (jumping) {
      var tj = now();
      if ((jumpScrolls > 0 && (sawScrollEnd || tj - lastScrollT >= 150)) || (jumpScrolls === 0 && tj - jumpT >= 300) || tj - jumpT > 2500) { jumping = false; if (gauge) gauge.afterJump = true; }
      need = true;
    }
    scenes.forEach(function (S) {
      if (!S.m || mode === 'still') return;
      S.tick(now(), dt);
      var busy = S.R.ok && S.view && (S.view.a === 'rest' || S.view.b === 'rest') && S.R.step(dt, now());
      if (busy) S.dirty = true;
      var st = S.st, crossing = S.view && S.view.b !== undefined;
      if (S.vis > 0 || st === 'intro' || st === 'arrive') S.draw();
      var active = busy || crossing || S.dirty || S.upQ.length || S.R.breathTick || S.fadeDep || /^(wait|intro|align|depart|arrive)$/.test(st) ||
        (S.vis > 0 && ((st === 'gone' && S.p <= 0.25) || st === 'empty'));
      if (active && (S.vis > 0 || st === 'wait' || st === 'intro')) need = true;
    });
    if (DEBUG) debugDraw();
    if (need) kick();
    else if (scenes.some(function (S) { return S.st === 'rest' && S.R.lookOn() && S.vis > 0; })) { clearTimeout(loop.idle); loop.idle = setTimeout(kick, 400); }
  }
  function setMode() {
    var m2 = envStill || userStill ? 'still' : 'motion';
    root.classList.toggle('snake3d-still', m2 === 'still'); root.classList.toggle('snake3d-motion', m2 === 'motion');
    if (m2 === mode) return false;
    mode = m2; log('mode', mode); return true;
  }
  function onScrollY(y) {
    var t = now();
    scrollY = y != null ? y : (w.pageYOffset || 0);
    lastScrollT = t; if (jumping) jumpScrolls++;
    if (hero && hero.R) hero.R.lastIn = t;
    if (hero && hero.m && hero.st !== 'still' && mode === 'motion' && hero.prog() >= 0.5 && gauge && gauge.m) gauge.p5();
    kick();
  }
  function onLayoutAll() {
    scrollY = w.pageYOffset || 0;
    scenes.forEach(function (S) {
      var W = S.sec.clientWidth, H = w.innerHeight;
      if (env.touch && S.lw === W && Math.abs((S.lh || 0) - H) <= 120 && S.s) return;   // ignore the iOS URL bar
      S.lw = W; S.lh = H; S.layout();
      if (S.m && S.need && S.tier && mode === 'motion') {                                // W3 re-pick on big refits
        var cur = TPX[S.tier]; if (S.need / 1.2 > 1.25 * cur || S.need / 1.2 < 0.6 * cur) S.repick = true;
      }
    });
    kick();
  }
  function observe() {
    if (!w.IntersectionObserver) { scenes.forEach(function (S) { S.vis = 1; S.near = true; }); return; }
    scenes.forEach(function (S) {
      new IntersectionObserver(function (es) {
        var e = es[es.length - 1]; S.vis = e.isIntersecting ? Math.max(e.intersectionRatio, 0.001) : 0;
        if (!S.vis) S.pauseAll();
        kick();
      }, { threshold: S.name === 'hero' ? [0, 0.15, 0.3, 0.6] : [0, 0.35] }).observe(S.sec);
      new IntersectionObserver(function (es) {
        S.near = es[es.length - 1].isIntersecting;
        if (S.near && S === gauge && S.m) S.p5();
      }, { rootMargin: '150% 0px' }).observe(S.sec);
    });
  }
  function visSync(S) {
    var r = S.sec.getBoundingClientRect(), H = w.innerHeight, ih = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    S.vis = r.height ? ih / r.height : 0;
    return S.vis;
  }
  function isTap(e, s) { return s && e.pointerId === s.id && !s.cancel && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && now() - s.t < 500; }
  function listen() {
    var ptrQ = null;
    if (env.fine) d.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      var first = !ptrQ; ptrQ = [e.clientX, e.clientY];
      if (first) requestAnimationFrame(function () {
        var q = ptrQ; ptrQ = null; if (!q || mode !== 'motion') return; var t = now();
        scenes.forEach(function (S) { if (S.vis > 0) { S.R.lastIn = t; S.pointer(q[0], q[1], t); } });
      });
    }, { passive: true });
    scenes.forEach(function (S) {
      var s = null;
      S.sec.addEventListener('pointerdown', function (e) { s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), cancel: false }; }, { passive: true });
      S.sec.addEventListener('pointercancel', function () { if (s) s.cancel = true; }, { passive: true });
      S.sec.addEventListener('pointerup', function (e) {
        if (!isTap(e, s) || S.st !== 'rest' || mode !== 'motion' || !S.R.lookOn()) return;
        var R = S.R, sm = S.sm, mr = sm.look.mask.rect, st = sm.stage, eye = sm.anchors.eye;
        var lx = S.docLeft + S.lx - (w.pageXOffset || 0), ly = S.docTop + S.ly - scrollY;
        var qx = (e.clientX - lx) / S.s + st[0], qy = (e.clientY - ly) / S.s + st[1];
        var on = (qx >= mr[0] && qy >= mr[1] && qx < mr[0] + mr[2] && qy < mr[1] + mr[3]) || Math.hypot(qx - eye[0], qy - eye[1]) * S.s < 1.2 * S.D;
        R.lastIn = now();
        if (on) { R.target(R.th, sm.look.angles[sm.look.angles.length - 1], true); setTimeout(function () { R.doFlick('double'); }, 120); }
        else if (!(e.target.closest && e.target.closest('a, button, input, label, select, textarea, summary, [role=button], [data-magnetic]'))) {
          S.look(e.clientX, e.clientY, now()); S.lastPtr = now() + 1800; R.doFlick('single');
        }
      }, { passive: true });
    });
    ['wheel', 'touchmove', 'keydown'].forEach(function (n) { w.addEventListener(n, function () { lastInput = now(); }, { passive: true }); });
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href').length > 1) { jumping = true; jumpT = now(); jumpScrolls = 0; sawScrollEnd = false; kick(); }
    }, true);
    w.addEventListener('hashchange', function () { jumping = true; jumpT = now(); jumpScrolls = 0; sawScrollEnd = false; kick(); });
    w.addEventListener('scrollend', function () { if (jumping && jumpScrolls > 0) sawScrollEnd = true; lastScrollT = Math.min(lastScrollT, now() - 120); kick(); });
    d.addEventListener('pointerdown', function (e) { var a = e.target.closest && e.target.closest('a[href="#income"]'); if (a && gauge && gauge.m && mode === 'motion') gauge.p5(); }, { passive: true });
    d.addEventListener('ae:income', function (e) { if (gauge && e.detail && e.detail.delta > 0) gauge.income(); });
    d.addEventListener('visibilitychange', function () { if (d.hidden) scenes.forEach(function (S) { S.pauseAll(); }); else kick(); });
    w.addEventListener('pagehide', function () { scenes.forEach(function (S) { S.pauseAll(); }); try { sessionStorage.setItem('ae-s3d:y', String(w.pageYOffset || 0)); } catch (e) { /* ignore */ } });
    w.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      scenes.forEach(function (S) { if (S.G && S.G.g.isContextLost()) S.lost = true; else if (S.G && S.lost) S.restore(); });
      if (hero && hero.st === 'intro') hero.introEnd();
      onScrollY(); kick();
    });
    var us = null;                                                   // tap unlock for blocked autoplay (W11)
    function unlock() {
      if (video !== 'blocked' || env.wkBlocked || !pool) return;
      var ok = false;
      pool.forEach(function (v) {
        if (v._clip) v._clip.unlocking = true;
        var p; try { p = v.play(); } catch (e) { return; }
        if (p && p.then) p.then(function () {
          v.pause(); if (v._clip) { v._clip.unlocking = false; try { v.currentTime = 0.5 / FPS; } catch (e) { /* ignore */ } }
          if (!ok) { ok = true; video = 'ok'; log('unlocked'); lazyAfterUnlock(); }
        }, function () { if (v._clip) v._clip.unlocking = false; });
      });
    }
    d.addEventListener('pointerdown', function (e) { us = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() }; }, { passive: true, capture: true });
    d.addEventListener('pointerup', function (e) { if (isTap(e, us)) unlock(); }, { passive: true, capture: true });
    d.addEventListener('click', unlock, true); d.addEventListener('keydown', unlock, true);
  }
  function lazyAfterUnlock() {
    scenes.forEach(function (S) {
      (S.pendingLoad || []).forEach(function (n) { var c = S.clips[n]; if (c) c.load().catch(function () {}); });
      S.pendingLoad = [];
    });
    if (hero) hero.schedP4();
    if (gauge && gauge.loaded) gauge.loadClip('arrive', pool[2], 'low').catch(function () {});
  }
  function probeAutoplay() {                                         // W7 1-frame probe at mount
    return new Promise(function (res) {
      if (env.wkBlocked || FORCE === 'lpm') { setVideo('blocked'); return res(); }
      if (FORCE === 'novideo' || env.webkitOld) { setVideo('broken'); return res(); }
      var v = pool[0], done = false;
      function fin() { if (!done) { done = true; try { v.pause(); } catch (e) { /* ignore */ } res(); } }
      var p; try { p = v.play(); } catch (e) { return fin(); }
      if (p && p.then) p.then(fin, function (e) { if (e && e.name === 'NotAllowedError') setVideo('blocked'); fin(); });
      setTimeout(fin, 300);
    });
  }
  function getManifest() {
    var first = B.manifest || fetch(url('manifest.json'), { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw r.status; return r.json(); });
    var check = function (m) { if (!m || m.schema !== 'ae-snake3d/1') throw 'schema'; return m; };
    return first.then(check).catch(function () {
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
        return fetch(url('manifest.json'), { cache: 'reload' }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(check);
      });
    });
  }
  function manifestFailed() {                                        // W12: fixed fallback path, CSS placement from the logo box
    if (!hero) return;
    hero.layer.classList.add('is-fallback'); hero.showImg(true); hero.st = mode === 'still' ? 'still' : 'rest';
    var im = hero.img; im.src = url('hero/M/rest.webp');
    (im.decode ? im.decode() : Promise.resolve()).then(function () { hero.written(); }, function () { hero.written(); });
    if (gauge) gauge.st = 'off';
  }
  function start(m) {
    M = m; probeSrc = m.probe || '';
    if (!pool) makePool();
    var heroDone = false;
    scenes.forEach(function (S) { S.m = m; S.sm = m.scenes[S.name] || null; });
    if (gauge && !gauge.sm) { scenes.splice(scenes.indexOf(gauge), 1); gauge.layer.hidden = true; gauge = null; }
    if (m.scenes.journey && hero && mode === 'motion') {                  // the right-edge journey layer (desktop)
      var jl = el('div', 'snake3d snake3d--journey', d.body); jl.setAttribute('aria-hidden', 'true');
      journey = new Journey(jl); journey.m = m; journey.sm = m.scenes.journey; scenes.push(journey);
    }
    if (DEBUG) checkInvariants(m);
    onLayoutAll();
    scenes.forEach(function (S) { S.R.set(m, S.tier); });
    if (hero && hero.sm && !hero.sm.look) hero.sec.classList.add('is-snake-static');
    if (hero) {
      hero.p = hero.prog(); visSync(hero);
      if (hero.st === 'still' || mode === 'still') {
        hero.go('still'); hero.imgStill().then(function () { hero.written(); }); heroDone = true;
        if (hero.tier !== B.stillTier && B.stillImg) { /* the boot already warmed the still at its own tier */ }
      } else if (!hero.gl()) {                                       // no WebGL / highp / caveat -> environment still
        envStill = true; setMode(); if (B.abort) try { B.abort(); } catch (e) { /* ignore */ }
        hero.go('still'); hero.imgStill().then(function () { hero.written(); }); heroDone = true;
      }
    }
    if (gauge) { gauge.go(mode === 'still' ? 'still' : 'empty'); if (gauge.near || (B.deep && mode === 'motion')) gauge.p5(); }
    if (heroDone || !hero) { kick(); return; }
    probeAutoplay().then(function () {
      var deep = B.deep || hero.vis < 0.3 || hero.p >= 0.5;
      if (deep) {
        if (B.abort) try { B.abort(); } catch (e) { /* ignore */ }
        hero.toGone(false); hero.lastClipEnd = now() - 1000;
        if (gauge) gauge.p5();
        hero.loadBase('low').catch(function () {});
        kick(); return;
      }
      hero.go('wait');
      var bootIntro = B.intro && video === 'ok' && !FCODEC && !TPX[FTIER] ? B.intro : null;
      var introP = null;
      if (video === 'ok' && hero.sm.clips && hero.sm.clips.intro) {
        introP = hero.loadClip('intro', pool[0], 'low', bootIntro && bootIntro.then(function (o) {
          if (!o) return null;
          hero.introGrab = o;
          return o.blob.then(function (b) { return { blob: b, codec: o.codec, tier: o.tier }; });
        }));
        introP.catch(function () { hero.noIntro = true; kick(); });
      } else { hero.noIntro = true; if (B.abort) try { B.abort(); } catch (e) { /* ignore */ } }
      var p2 = function () { hero.loadBase(hero.noIntro ? 'high' : 'low').then(function () { if (!hero.p3 && hero.noIntro) { hero.p3 = true; hero.loadExtras(); } }, function () {}); };
      if (hero.noIntro) p2(); else { var p2t = setTimeout(p2, Math.max(0, 1200 - (now() - (B.t0 || 0)))); introP.then(function () { clearTimeout(p2t); p2(); }, function () { clearTimeout(p2t); p2(); }); }
      kick();
    });
  }
  var staleOnce = false;
  function stale() {                                                 // 404 on a hashed file / size mismatch: reload the manifest once, remount
    if (staleOnce || !opts) return; staleOnce = true;
    fetch(url('manifest.json'), { cache: 'reload' }).then(function (r) { return r.json(); }).then(function (m) {
      if (M && m.build === M.build) return;
      log('stale manifest: remount'); B.manifest = Promise.resolve(m); B.intro = null; var o = opts; api.destroy(); api.mount(o);
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ debug */
  var dbg = null;
  function checkInvariants(m) {
    var bad = [];
    Object.keys(m.scenes).forEach(function (n) {
      var s = m.scenes[n], st = s.stage, inS = function (r) { return r[0] >= st[0] && r[1] >= st[1] && r[0] + r[2] <= st[0] + st[2] && r[1] + r[3] <= st[1] + st[3]; };
      var rects = s.rest ? [['still', s.rest.still.rect]] : []; if (s.rest && s.rest.flow) rects.push(['flow', s.rest.flow.rect]);
      if (s.look) rects.push(['look', s.look.rect], ['mask', s.look.mask.rect]);
      rects.forEach(function (r) { if (r[1].some(function (v) { return v % 24; })) bad.push(n + '.' + r[0] + ' not x24'); if (!inS(r[1])) bad.push(n + '.' + r[0] + ' outside stage'); });
      if (s.rest && String(s.rest.still.rect) !== String(st)) bad.push(n + ': still.rect != stage');
      Object.keys(s.clips || {}).forEach(function (k) { if (s.clips[k].rect.some(function (v) { return v % 96; })) bad.push(n + '.' + k + ' rect not x96'); });
    });
    Object.keys(m.files).forEach(function (k) { var f = m.files[k]; if (f.frames) { var mb = Math.ceil(f.size[0] / 16) * Math.ceil(f.size[1] / 16); if (mb > 8192 && k.indexOf('/L/') < 0) bad.push(k + ' ' + mb + ' MBs'); } });
    dbgInv = bad.length ? bad : ['ok'];
    if (bad.length) console.warn('[snake3d] M5 invariants:', bad);
  }
  var dbgInv = [];
  function debugDraw() {
    if (!dbg) { dbg = el('pre', '', d.body); dbg.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:8px 10px;max-width:46ch;white-space:pre-wrap;font:11px/1.35 monospace;background:rgba(20,10,14,.82);color:#fde;border-radius:8px;pointer-events:none'; }
    var s = api.state(), lines = [JSON.stringify(s)];
    scenes.forEach(function (S) {
      var c = S.clips && (S.clips.intro || S.clips.depart || S.clips.arrive), q = c && c.v.getVideoPlaybackQuality && c.v.getVideoPlaybackQuality();
      lines.push(S.name + ': p=' + (S.p != null ? S.p.toFixed(3) : (S.pg || 0).toFixed(3)) + ' vis=' + (S.vis || 0).toFixed(2) + ' tier=' + S.tier + ' D=' + (S.D || 0).toFixed(1) + ' cell=' + S.R.cell + ' th=' + S.R.th.toFixed(1) + ' ka=' + S.R.ka.toFixed(1));
      for (var k in S.clips) { var x = S.clips[k]; if (x) lines.push('  ' + k + ' F=' + x.F + '/' + x.N + ' ' + x.codec + ' ' + (x.cal ? JSON.stringify({ kind: x.cal.kind || (x.cal.fit && x.cal.fit.kind), dev: x.cal.fit && +x.cal.fit.dev.toFixed(1), matrix: x.cal.matrix }) : '')); }
      if (q) lines.push('  dropped ' + q.droppedVideoFrames + '/' + q.totalVideoFrames);
    });
    lines.push('M5: ' + dbgInv.join('; '));
    dbg.textContent = lines.join('\n');
  }

  /* ------------------------------------------------------------------ API */
  var api = {
    mount: function (o) {
      opts = o || {}; BASE = opts.base || 'assets/snake3d/';
      if (director) api.destroy();
      director = { stale: stale };
      envStill = envStillBoot(); userStill = !!opts.still; mode = '';
      setMode();
      scrollY = w.pageYOffset || 0;
      var hl = opts.hero && (opts.hero.querySelector('[data-snake3d-hero]') || (function () { var x = el('div', 'snake3d snake3d--hero'); x.setAttribute('data-snake3d-hero', ''); opts.hero.insertBefore(x, opts.hero.firstChild); return x; })());
      var gl_ = opts.gauge && opts.gauge.querySelector('[data-snake3d-gauge]');
      scenes = [];
      if (hl) { hl.setAttribute('aria-hidden', 'true'); hero = new Hero(opts.hero, hl); scenes.push(hero); } else hero = null;
      if (gl_) { gl_.setAttribute('aria-hidden', 'true'); gauge = new Gauge(opts.gauge, gl_); scenes.push(gauge); } else gauge = null;
      if (hero) { hero.layout(); if (mode === 'still') hero.st = 'still'; hero.sec.classList.toggle('is-snake-static', mode === 'still'); }
      if (!hubbed) {
        hubbed = true;
        if (opts.onScroll) opts.onScroll(function (y) { onScrollY(y); }); else w.addEventListener('scroll', function () { onScrollY(); }, { passive: true });
        if (opts.onLayout) opts.onLayout(onLayoutAll); else w.addEventListener('resize', onLayoutAll, { passive: true });
        listen();
      }
      observe();
      getManifest().then(start, function (e) { log('manifest failed', e); manifestFailed(); });
      return api;
    },
    setStill: function (on) {
      userStill = !!on;
      if (!setMode()) return;
      scenes.forEach(function (S) { if (S.m && S.sm) S.onStill(mode === 'still'); });
      kick();
    },
    layout: function () { scenes.forEach(function (S) { S.lw = -1; }); onLayoutAll(); },
    state: function () {
      return {
        hero: hero ? (hero.st === 'boot' && mode === 'still' ? 'still' : hero.st) : 'boot',
        gauge: gauge ? gauge.st : 'off', journey: journey ? (journey.on ? 'on' : 'off') : 'none', mode: mode, video: video,
        tier: { hero: hero && hero.tier || null, gauge: gauge && gauge.tier || null },
        clipTier: hero && hero.clips.intro ? hero.clips.intro.tier : (M && hero && hero.tier ? clipTierOf(hero.tier, M) : null),
        codec: hero && hero.clips.intro ? hero.clips.intro.codec : null
      };
    },
    destroy: function () {
      scenes.forEach(function (S) { S.pauseAll(); S.cv.remove(); S.img.remove(); S.layer.classList.remove('is-img', 'is-fallback'); S.layer.style.cssText = ''; });
      if (pool) { pool.forEach(release); pool.host.remove(); pool = null; }
      if (journey) journey.layer.remove();
      scenes = []; hero = gauge = journey = null; director = null; root.classList.remove('has-plush-ring');
      if (dbg) { dbg.remove(); dbg = null; }
    },
    _frameOf: frameOf, _fitLut: fitLut,
    _journey: function () { var J = journey; return J && { fits: J.fits, y0: J.y0, y1: J.y1, n: J.n, ppf: J.ppf, tier: J.tier, ready: J.ready('journey'), fail: J.clipFail, loading: J.loading, G: !!J.G }; }
  };
  w.AeSnake3D = api;
})(window, document);
