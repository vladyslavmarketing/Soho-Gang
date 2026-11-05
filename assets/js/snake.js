/*!
 * ae studio — plush snake engine (assets/js/snake.js)
 * Vanilla canvas-2D, zero dependencies, plain IIFE.
 *
 *   window.SohoSnake.mount(canvas, opts) -> controller
 *     opts.mode           'logo'    (hero: writes "ae", looks at / chases the pointer)
 *                         'wander'  (footer: free crawl)
 *                         'journey' (page layer: writes "ae" in the hero, then travels down the page with the
 *                                    scroll and coils around opts.end; see "Journey" below)
 *     opts.pointerTarget  element that receives pointer events and the --logo-x/-y/-w/-h CSS vars
 *                         (default: canvas.parentElement; in 'journey' only the CSS vars — pointer events
 *                         are read on the document)
 *     opts.hero           'journey': the hero section (logo box = hero formula on its rect; default pointerTarget)
 *     opts.end            'journey': the element to coil around (a square gauge whose ring r = 0.4 x width)
 *     opts.zoneEnd        'journey': the last section of the snake's zone (default: end's section)
 *     opts.reducedMotion  boolean (default: matchMedia('(prefers-reduced-motion: reduce)'))
 *     opts.ignoreSelector pointerdown on these never starts a chase
 *   controller = { replay(), chase(x, y), pause(), resume(), destroy(), getLogoBox() }
 *     chase(x, y)   x/y in CSS px relative to the canvas' top-left corner
 *     getLogoBox()  {x, y, w, h} in CSS px relative to pointerTarget (same numbers as the CSS vars)
 *   canvas events (bubbling CustomEvents): 'snake:written', 'snake:chase',
 *     journey only: 'snake:unwritten' (head left the logo pose), 'snake:arrived' / 'snake:departed' (coil at opts.end)
 *
 * Journey
 *   The canvas is fixed and viewport-sized; the world is the document. The path J (document px) is the logo
 *   in writing order (so the body on [uRest - L, uRest] is exactly the "ae") followed by a descent measured
 *   from the DOM (curl out of the logo, under the marquee, down the right margin with S-wiggles and a lazy S
 *   into open space beside section heads) and a coil around opts.end. Scroll maps monotonically to the head's
 *   arc position u = f(scrollY); the head follows f with a critically damped spring and the body is the J
 *   segment [u - L, u]. Chases run in document space; the return re-forms the pose on J.
 *
 * How it works
 *   Body   A ring buffer of head positions (the trail). Body stamps sit at fixed arc-length offsets
 *          from the head, so the body lies exactly on whatever path the head travelled. Writing the
 *          logo = the head travelling the "ae" path in reverse, from beyond the right edge.
 *   Plush  Pre-rendered fur sprites (colour x variant x 32 angle buckets, cylinder lighting baked in)
 *          are blitted at integer device pixels from tail to head. Each stamp only shows its
 *          tail-side crescent, which reads as fur combed toward the tail; band edges curve like
 *          stripes wrapped round a cylinder.
 *   Depth  Trail points carry a layer tag; the body is drawn in layer-sorted runs and every part that
 *          lies over another part casts a soft occlusion shadow onto it.
 *   Cost   While resting, the body is cached (re-rendered progressively so it can breathe) and only
 *          the head + neck are drawn live.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ constants */
  var PI = Math.PI, TAU = PI * 2;
  var ASPECT = 1.85;          // logo box w:h
  var THICK = 0.17;           // body thickness / logo box height
  var NB = 32;                // body sprite angle buckets over [0, PI)
  var HB = 32;                // head sprite lighting buckets over [0, 2PI)
  var ALONG = 0.62;           // stamp ellipse: semi-axis along the body / radius
  var FUZZ = 0.24;            // fur reach beyond the radius (sprite padding, x radius)
  var HEAD = 1.36;            // head radius / body radius
  var TIP = 0.36;             // tail-tip radius / body radius
  var SMALL = 0.6;            // radius of the low-res sprite set used by the thin tail
  var MAX_RDEV = 58;          // cap on the body radius in device px (memory / fill-rate guard)
  var BLOB = [1.06, 0.92, 0.8, 0.69, 0.59, 0.5, 0.42, 0.35];
  var Z_FREE = 10;            // layer tag for trail laid while chasing / wandering (on top)
  var PERIOD = 2.16;          // band period in body widths: black .125 | cream .25 | black .125 | pink 1.66
  var VARIANTS = [3, 2, 2];   // pink, cream, black
  var WRITE_T = 2.8;          // seconds for the first writing
  var CHASE_IDLE = 2.5;       // seconds without pointer movement before returning
  var DEFAULT_IGNORE = 'a,button,input,label,select,textarea,[data-no-chase]';
  var JOURNEY_IGNORE = 'a,button,input,label,select,textarea,summary,[role=button],[data-no-chase],[data-nav],[data-menu]';
  var OP_FLOOR = 1, OP_OCCL = 2, OP_BODY = 3, OP_CAP = 4, OP_HEAD = 5, OP_HEADSH = 6;
  var ST_BOOT = 0, ST_ROUTE = 1, ST_REST = 2, ST_CHASE = 3, ST_WANDER = 4, ST_STATIC = 5, ST_JOURNEY = 6;
  var Z_DESC = 3;             // layer tag of the journey descent (over every part of the logo)
  var REST_LOGO = 1, REST_END = 2;
  var S0_REST = 24;           // scroll (px) up to which the snake stays in the logo
  var CHASE_IDLE_TOUCH = 1.4; // a tap only starts a short chase

  var L3 = norm3(-0.42, -0.58, 0.7);  // key light: upper-left, toward the viewer
  var WRAP = 0.45;                    // wrap-diffuse: plush scatters light softly

  // Colour ramps indexed by lighting 0..1 (pink #D7899A base / #F0B3C1 light / #B85F75 deep, etc.)
  var RAMP = [
    ramp([[0, '#923B55'], [0.3, '#AE5068'], [0.55, '#C77187'], [0.76, '#D7899A'], [0.92, '#E7A2B2'], [1, '#F0B3C1']]),
    ramp([[0, '#A88E6C'], [0.36, '#CDB896'], [0.62, '#D9C7AE'], [0.82, '#EEE2CF'], [0.94, '#F4EADB'], [1, '#FFF9EE']]),
    ramp([[0, '#070405'], [0.5, '#1E1618'], [0.8, '#33262B'], [1, '#4A3A3E']])
  ];
  // Fur strand tints: light tips / dark roots per colour
  var STRAND = [
    { lo: [255, 236, 242], la: [0.08, 0.24], dk: [120, 30, 58], da: [0.05, 0.15] },
    { lo: [255, 255, 250], la: [0.12, 0.3], dk: [130, 100, 68], da: [0.05, 0.13] },
    { lo: [255, 226, 236], la: [0.05, 0.14], dk: [0, 0, 0], da: [0.18, 0.38] }
  ];

  /* "ae" logo path, normalised to the box height (box = 1.85 x 1), head -> tail.
     Head rests top-left looking left; the neck arcs over the 'a' and dives behind the front
     diagonal, loops counter-clockwise through the bowl, rises as the diagonal (a's stem / e's
     back), rolls over the top of the 'e', comes back as the crossbar, tucks under the diagonal,
     wraps round the bottom of the 'e' and trails off to the right. */
  var LOGO = [
    [0.170, 0.215], [0.300, 0.125], [0.460, 0.085], [0.592, 0.130], [0.652, 0.250], [0.645, 0.382],
    [0.552, 0.462], [0.360, 0.475], [0.200, 0.530], [0.110, 0.670], [0.170, 0.850], [0.340, 0.915],
    [0.510, 0.885], [0.635, 0.770], [0.695, 0.580], [0.737, 0.385], [0.805, 0.205], [0.950, 0.095],
    [1.120, 0.110], [1.225, 0.250], [1.215, 0.430], [1.090, 0.515], [0.920, 0.520], [0.790, 0.575],
    [0.760, 0.710], [0.830, 0.850], [0.980, 0.910], [1.140, 0.860], [1.280, 0.760], [1.440, 0.690],
    [1.620, 0.690], [1.780, 0.730], [1.830, 0.750]
  ];
  // Layer per control segment: head..bowl = 1, front diagonal = 2 (over everything), 'e' + tail = 0.
  function logoZ(seg) { return seg < 13 ? 1 : seg < 17 ? 2 : 0; }

  /* ------------------------------------------------------------------ small utils */
  function norm3(x, y, z) { var l = Math.sqrt(x * x + y * y + z * z); return [x / l, y / l, z / l]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapA(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function hash(i) {
    var x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function ramp(st) { return st.map(function (s) { return [s[0], hexRgb(s[1])]; }); }
  function rampAt(R, d, o) {
    var i = 1; while (i < R.length - 1 && R[i][0] < d) i++;
    var a = R[i - 1], b = R[i], t = clamp((d - a[0]) / (b[0] - a[0]), 0, 1);
    o[0] = a[1][0] + (b[1][0] - a[1][0]) * t;
    o[1] = a[1][1] + (b[1][1] - a[1][1]) * t;
    o[2] = a[1][2] + (b[1][2] - a[1][2]) * t;
    return o;
  }
  function mixTo(o, c, t) { o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; return o; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (+a).toFixed(3) + ')'; }
  function canvasEl(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c;
  }
  function emit(el, name) {
    var ev;
    try { ev = new CustomEvent(name, { bubbles: true }); }
    catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(name, true, false, null); }
    el.dispatchEvent(ev);
  }

  /* ------------------------------------------------------------------ logo path (normalised, built once) */
  function crPoint(p0, p1, p2, p3, u, o) { // centripetal Catmull-Rom (Barry-Goldman)
    var d01 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) || 1e-4;
    var d12 = Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) || 1e-4;
    var d23 = Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) || 1e-4;
    var t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23, t = t1 + (t2 - t1) * u;
    for (var c = 0; c < 2; c++) {
      var a1 = ((t1 - t) * p0[c] + (t - t0) * p1[c]) / (t1 - t0);
      var a2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1);
      var a3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
      var b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
      var b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
      o[c] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
    }
    return o;
  }

  var PATH = (function () {
    var P = LOGO, n = P.length, dense = [], o = [0, 0], i, k;
    for (i = 0; i < n - 1; i++) {
      var p1 = P[i], p2 = P[i + 1];
      var p0 = i > 0 ? P[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
      var p3 = i < n - 2 ? P[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
      for (k = 0; k < 48; k++) { crPoint(p0, p1, p2, p3, k / 48, o); dense.push(o[0], o[1], logoZ(i)); }
    }
    dense.push(P[n - 1][0], P[n - 1][1], logoZ(n - 2));
    // uniform arc-length resample
    var step = 0.0035, xs = [dense[0]], ys = [dense[1]], zs = [dense[2]], carry = 0;
    for (i = 3; i < dense.length; i += 3) {
      var ax = dense[i - 3], ay = dense[i - 2], bx = dense[i], by = dense[i + 1];
      var seg = Math.hypot(bx - ax, by - ay), pos = 0;
      while (carry + (seg - pos) >= step) {
        pos += step - carry; carry = 0; var t = pos / seg;
        xs.push(ax + (bx - ax) * t); ys.push(ay + (by - ay) * t); zs.push(dense[i + 2]);
      }
      carry += seg - pos;
    }
    if (carry > step * 0.25) { xs.push(dense[dense.length - 3]); ys.push(dense[dense.length - 2]); zs.push(dense[dense.length - 1]); }
    var N = xs.length, X = new Float64Array(xs), Y = new Float64Array(ys), Z = new Uint8Array(zs);
    var C = new Float64Array(N), K = new Float32Array(N), Ks = new Float32Array(N);
    for (i = 1; i < N; i++) C[i] = C[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
    for (i = 1; i < N - 1; i++) {
      var a0 = Math.atan2(Y[i] - Y[i - 1], X[i] - X[i - 1]), a1 = Math.atan2(Y[i + 1] - Y[i], X[i + 1] - X[i]);
      K[i] = Math.abs(wrapA(a1 - a0)) / step;
    }
    var win = Math.round(0.06 / step); // smooth curvature over ~0.12 box heights
    for (i = 0; i < N; i++) {
      var s = 0, c = 0;
      for (k = Math.max(0, i - win); k <= Math.min(N - 1, i + win); k++) { s += K[k]; c++; }
      Ks[i] = s / c;
    }
    return { x: X, y: Y, z: Z, c: C, k: Ks, n: N, len: C[N - 1] };
  })();

  // HERO formula shared with the CSS (see brief): logo box in canvas px
  function logoBox(W, H) {
    var bw, bh, x, y;
    if (W >= 960) {
      bw = Math.min(0.52 * W, ASPECT * 0.56 * H); bh = bw / ASPECT;
      x = W - Math.max(48, 0.05 * W) - bw; y = 0.46 * H - bh / 2;
    } else {
      bw = W - 32; bh = bw / ASPECT; x = 16; y = 72 + 20;
    }
    return { x: x, y: y, w: bw, h: bh };
  }

  // Canvas pixel density: device pixels, at most 2x, 1.5x on phones (the journey layer is a full-viewport canvas
  // that is re-rasterised every moving frame), and never more than a MAX_RDEV body radius needs.
  function devScale(d, W, r) { return Math.min(d, W < 600 ? 1.5 : 2, Math.max(1, MAX_RDEV / r)); }

  /* ------------------------------------------------------------------ fur photo (optional) */
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  var FUR = { state: 'idle', dev: null, subs: [] };
  function furUrl() {
    try { return new URL('../img/fur-small.jpg', SCRIPT_SRC || document.baseURI).href; }
    catch (e) { return 'assets/img/fur-small.jpg'; }
  }
  // Photo -> luminance-deviation layer (light / dark alpha) used to modulate the procedural fur.
  function makeFurDev(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return null;
      var c = canvasEl(w, h), g = c.getContext('2d'); g.drawImage(img, 0, 0);
      var id = g.getImageData(0, 0, w, h), d = id.data, n = w * h, i, sum = 0, sum2 = 0, lum = new Float32Array(n);
      for (i = 0; i < n; i++) { var l = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; lum[i] = l; sum += l; sum2 += l * l; }
      var mean = sum / n, sd = Math.sqrt(Math.max(1, sum2 / n - mean * mean));
      for (i = 0; i < n; i++) {
        var v = (lum[i] - mean) / sd, a = clamp(Math.abs(v) * 0.17, 0, 0.45), j = i * 4;
        if (v > 0) { d[j] = 255; d[j + 1] = 243; d[j + 2] = 246; } else { d[j] = 96; d[j + 1] = 22; d[j + 2] = 48; }
        d[j + 3] = a * 255;
      }
      g.putImageData(id, 0, 0);
      return c;
    } catch (e) { return null; } // tainted canvas (file://) etc. -> procedural fur only
  }
  function loadFur() {
    if (FUR.state !== 'idle') return;
    FUR.state = 'loading';
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () { FUR.dev = makeFurDev(img); FUR.state = 'done'; notifyFur(); };
    img.onerror = function () { FUR.state = 'fail'; notifyFur(); };
    img.src = furUrl();
  }
  function notifyFur() { var s = FUR.subs.slice(); for (var i = 0; i < s.length; i++) s[i](); }

  /* ------------------------------------------------------------------ sprites */
  // Lighting across a tube lying in the screen plane; t = position across (-1..1) along perp (px, py).
  function tubeLight(t, px, py) {
    var tc = clamp(t, -1, 1), nz = Math.sqrt(Math.max(0, 1 - tc * tc));
    var nl = tc * (px * L3[0] + py * L3[1]) + nz * L3[2];
    var d = (nl + WRAP) / (1 + WRAP);
    d += 0.09 * smooth(0.74, 1, Math.abs(tc)) * (0.3 + 0.7 * clamp(nl + 0.35, 0, 1)); // fuzzy sheen at the silhouette
    return clamp(d, 0, 1);
  }

  // Shape mask (white): the stamp ellipse + fine strands poking out of the rim with alpha falloff.
  function stampMask(R, seed) {
    var A = R * ALONG, B = R, pad = R * FUZZ + 2, hw = Math.ceil(A + pad), hh = Math.ceil(B + pad);
    var c = canvasEl(hw * 2, hh * 2), g = c.getContext('2d'), rnd = rng(seed);
    g.translate(hw, hh);
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, A, B, 0, 0, TAU); g.fill();
    g.lineCap = 'round';
    var n = Math.round(70 + R * 6);
    for (var i = 0; i < n; i++) {
      var ph = rnd() * TAU, cx = Math.cos(ph), sy = Math.sin(ph), ex = cx * A, ey = sy * B;
      var nx = cx / A, ny = sy / B, nl = Math.sqrt(nx * nx + ny * ny); nx /= nl; ny /= nl;
      var j = (rnd() - 0.5) * 0.9, cj = Math.cos(j), sj = Math.sin(j);
      var dx = nx * cj - ny * sj, dy = nx * sj + ny * cj;
      var len = R * (0.07 + rnd() * 0.15), x0 = ex - nx * R * 0.05, y0 = ey - ny * R * 0.05;
      g.lineWidth = Math.max(0.75, R * (0.016 + rnd() * 0.02));
      g.strokeStyle = 'rgba(255,255,255,' + (0.5 + rnd() * 0.4).toFixed(2) + ')';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dx * len * 0.55, y0 + dy * len * 0.55); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,' + (0.14 + rnd() * 0.24).toFixed(2) + ')';
      g.beginPath(); g.moveTo(x0 + dx * len * 0.5, y0 + dy * len * 0.5); g.lineTo(x0 + dx * len, y0 + dy * len); g.stroke();
    }
    return c;
  }

  // Detail layer: hundreds of short strands (light tips / dark roots) radiating outward, biased to the rim
  // (the only part of a stamp that stays visible), plus the optional photo-fur modulation.
  function stampDetail(R, seed, kind, furDev) {
    var A = R * ALONG, B = R, pad = R * FUZZ + 2, hw = Math.ceil(A + pad), hh = Math.ceil(B + pad);
    var c = canvasEl(hw * 2, hh * 2), g = c.getContext('2d'), rnd = rng(seed), st = STRAND[kind];
    if (furDev && kind !== 2) {
      var sw = Math.min(furDev.width, hw * 3), sh = Math.min(furDev.height, hh * 3);
      g.globalAlpha = kind === 0 ? 0.95 : 0.4;
      g.drawImage(furDev, rnd() * (furDev.width - sw), rnd() * (furDev.height - sh), sw, sh, 0, 0, hw * 2, hh * 2);
      g.globalAlpha = 1;
    }
    g.translate(hw, hh); g.lineCap = 'round';
    var n = Math.round(90 + R * 11);
    for (var i = 0; i < n; i++) {
      var ph = rnd() * TAU, cx = Math.cos(ph), sy = Math.sin(ph);
      var rho = 1.02 - Math.pow(rnd(), 1.7) * 0.8, x = cx * A * rho, y = sy * B * rho;
      var nx = cx / A, ny = sy / B, nl = Math.sqrt(nx * nx + ny * ny); nx /= nl; ny /= nl;
      var j = (rnd() - 0.5) * 1.0, cj = Math.cos(j), sj = Math.sin(j);
      var dx = nx * cj - ny * sj, dy = nx * sj + ny * cj;
      var len = R * (0.08 + rnd() * 0.16), light = rnd() < 0.56;
      var col = light ? st.lo : st.dk, ar = light ? st.la : st.da, a = ar[0] + rnd() * (ar[1] - ar[0]);
      var x0 = x - dx * len * 0.35, y0 = y - dy * len * 0.35;
      g.lineWidth = Math.max(0.6, R * (0.014 + rnd() * 0.018));
      g.strokeStyle = rgba(col, a);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dx * len, y0 + dy * len); g.stroke();
      if (light) { // brighter tip
        g.strokeStyle = rgba(col, Math.min(1, a * 1.7));
        g.beginPath(); g.moveTo(x0 + dx * len * 0.62, y0 + dy * len * 0.62); g.lineTo(x0 + dx * len, y0 + dy * len); g.stroke();
      }
    }
    return c;
  }

  // One body sprite: cylinder-lit gradient across the body for this angle, masked + fur detail.
  function stampSprite(R, th, kind, mask, det) {
    var mw = mask.width / 2, mh = mask.height / 2, co = Math.cos(th), si = Math.sin(th);
    var hx = Math.ceil(Math.sqrt(mw * mw * co * co + mh * mh * si * si)) + 1;
    var hy = Math.ceil(Math.sqrt(mw * mw * si * si + mh * mh * co * co)) + 1;
    var c = canvasEl(hx * 2, hy * 2), g = c.getContext('2d');
    var px = -si, py = co, ext = R * (1 + FUZZ), col = [0, 0, 0], N = 20, tint = [255, 240, 244];
    var gr = g.createLinearGradient(hx - px * ext, hy - py * ext, hx + px * ext, hy + py * ext);
    for (var i = 0; i <= N; i++) {
      var t = (i / N * 2 - 1) * (1 + FUZZ);
      rampAt(RAMP[kind], tubeLight(t, px, py), col);
      if (Math.abs(t) > 0.9) mixTo(col, tint, 0.36 * clamp((Math.abs(t) - 0.9) / (FUZZ + 0.1), 0, 1)); // fuzz tips glow
      gr.addColorStop(i / N, rgba(col, 1));
    }
    g.fillStyle = gr; g.fillRect(0, 0, hx * 2, hy * 2);
    g.globalCompositeOperation = 'destination-in';
    g.setTransform(co, si, -si, co, hx, hy); g.drawImage(mask, -mw, -mh);
    g.globalCompositeOperation = 'source-atop'; g.drawImage(det, -mw, -mh);
    return c;
  }

  function blobSprite(rad, rgb) { // soft shadow blob (alpha set at draw time)
    var h = Math.ceil(rad) + 1, c = canvasEl(h * 2, h * 2), g = c.getContext('2d');
    var gr = g.createRadialGradient(h, h, 0, h, h, rad);
    gr.addColorStop(0, rgba(rgb, 1)); gr.addColorStop(0.3, rgba(rgb, 0.86)); gr.addColorStop(0.55, rgba(rgb, 0.55));
    gr.addColorStop(0.78, rgba(rgb, 0.2)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, h * 2, h * 2);
    return c;
  }

  function capSprite(rc, furDev) { // rounded tail tip: a little sphere-lit fur ball
    var pad = rc * 0.45 + 2, h = Math.ceil(rc + pad), c = canvasEl(h * 2, h * 2), g = c.getContext('2d'), rnd = rng(77);
    var col = [0, 0, 0], gr = g.createRadialGradient(h - rc * 0.35, h - rc * 0.45, rc * 0.1, h, h, rc * 1.3);
    gr.addColorStop(0, rgba(rampAt(RAMP[0], 0.95, col), 1)); gr.addColorStop(0.5, rgba(rampAt(RAMP[0], 0.66, col), 1));
    gr.addColorStop(1, rgba(rampAt(RAMP[0], 0.25, col), 1));
    g.fillStyle = gr; g.beginPath(); g.arc(h, h, rc, 0, TAU); g.fill();
    g.lineCap = 'round';
    for (var i = 0; i < 60; i++) {
      var a = rnd() * TAU, x0 = h + Math.cos(a) * rc * 0.9, y0 = h + Math.sin(a) * rc * 0.9, len = rc * (0.15 + rnd() * 0.3);
      g.strokeStyle = rgba(rampAt(RAMP[0], tubeLight(Math.sin(a), 0, 1), col), 0.35 + rnd() * 0.4);
      g.lineWidth = Math.max(0.6, rc * 0.05);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); g.stroke();
    }
    return c;
  }

  function eyeSprite(re) { // glossy black bead, lit in screen space (rotation invariant)
    var h = Math.ceil(re * 2.3) + 1, c = canvasEl(h * 2, h * 2), g = c.getContext('2d');
    var s = g.createRadialGradient(h, h + re * 0.18, re * 0.7, h, h + re * 0.18, re * 2.2);
    s.addColorStop(0, 'rgba(112,34,58,0.34)'); s.addColorStop(1, 'rgba(112,34,58,0)');
    g.fillStyle = s; g.fillRect(0, 0, h * 2, h * 2);
    var b = g.createRadialGradient(h - re * 0.35, h - re * 0.4, re * 0.05, h, h, re);
    b.addColorStop(0, '#5d4a50'); b.addColorStop(0.42, '#1d1417'); b.addColorStop(1, '#040203');
    g.fillStyle = b; g.beginPath(); g.arc(h, h, re, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,186,204,0.4)'; g.lineWidth = Math.max(0.6, re * 0.13);
    g.beginPath(); g.arc(h, h, re * 0.8, 0.3 * PI, 0.78 * PI); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.96)'; g.beginPath(); g.arc(h - re * 0.33, h - re * 0.36, re * 0.27, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(h + re * 0.35, h + re * 0.3, re * 0.1, 0, TAU); g.fill();
    return c;
  }

  // Head silhouette: back sphere + snout sphere joined by a tangent cone (body of revolution).
  var HC1 = -0.16, HR1 = 1, HC2 = 0.94, HR2 = 0.62;
  var HSA = (HR1 - HR2) / (HC2 - HC1), HCA = Math.sqrt(1 - HSA * HSA);
  var HX1 = HC1 + HR1 * HSA, HX2 = HC2 + HR2 * HSA;
  function headRho(x) {
    if (x <= HX1) { var d = x - HC1; return d < -HR1 ? 0 : Math.sqrt(HR1 * HR1 - d * d); }
    if (x >= HX2) { var e = x - HC2; return e > HR2 ? 0 : Math.sqrt(HR2 * HR2 - e * e); }
    return HR1 * HCA + (x - HX1) / (HX2 - HX1) * (HR2 * HCA - HR1 * HCA);
  }
  function headInside(x, y) { return Math.abs(y) < headRho(x); }

  // Lighting-independent head data (once per bank): normal field, alpha, fur layer, fuzz strands.
  function headBase(rh, furDev) {
    var ox = Math.ceil(1.5 * rh) + 2, W = ox + Math.ceil(1.86 * rh) + 2, oy = Math.ceil(1.32 * rh) + 2, H = oy * 2;
    W += W & 1;
    var n = W * H, NX = new Float32Array(n), NY = new Float32Array(n), NZ = new Float32Array(n);
    var AL = new Float32Array(n), MU = new Float32Array(n), SH = new Float32Array(n), px, py;
    for (py = 0; py < H; py++) {
      var y = (py + 0.5 - oy) / rh, ay = Math.abs(y);
      for (px = 0; px < W; px++) {
        var x = (px + 0.5 - ox) / rh, rho = headRho(x), edge = (rho - ay) * rh, i = py * W + px;
        if (edge <= -0.5) continue;
        var dr = (headRho(x + 0.01) - headRho(x - 0.01)) / 0.02, z = Math.sqrt(Math.max(0, rho * rho - y * y));
        var nx = -rho * dr, ny = y, nz = z, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        NX[i] = nx / nl; NY[i] = ny / nl; NZ[i] = nz / nl; AL[i] = clamp(edge + 0.5, 0, 1);
        MU[i] = smooth(0.62, 1.5, x) * 0.32;                         // lighter muzzle
        SH[i] = 0.08 * smooth(0.72, 1, ay / Math.max(rho, 1e-3));   // fuzzy sheen at the outline
      }
    }
    // fur detail (fixed tints): photo modulation + strands combed back, fanning out at the sides
    var det = canvasEl(W, H), g = det.getContext('2d'), rnd = rng(4242), st = STRAND[0], k, m;
    g.translate(ox, oy); g.lineCap = 'round';
    if (furDev) {
      g.globalAlpha = 0.8;
      g.drawImage(furDev, 40, 60, Math.min(furDev.width - 40, rh * 4), Math.min(furDev.height - 60, rh * 3), -1.5 * rh, -1.32 * rh, 3.4 * rh, 2.64 * rh);
      g.globalAlpha = 1;
    }
    m = Math.round(150 + rh * 7);
    for (k = 0; k < m; k++) {
      var sx = -1.15 + rnd() * 2.6, r0 = headRho(sx); if (r0 < 0.06) continue;
      var sy = (rnd() * 2 - 1) * r0 * 0.97, f = sy / r0, ang = PI - f * 1.05 + (rnd() - 0.5) * 0.6;
      var len = (0.08 + rnd() * 0.16) * rh * (sx > 0.85 ? 0.55 : 1), light = rnd() < 0.55;
      var a = light ? st.la[0] + rnd() * (st.la[1] - st.la[0]) : st.da[0] + rnd() * (st.da[1] - st.da[0]);
      var ca = Math.cos(ang), sa = Math.sin(ang), x0 = sx * rh, y0 = sy * rh;
      g.lineWidth = Math.max(0.6, rh * (0.012 + rnd() * 0.014));
      g.strokeStyle = rgba(light ? st.lo : st.dk, a);
      g.beginPath(); g.moveTo(x0 - ca * len * 0.3, y0 - sa * len * 0.3); g.lineTo(x0 + ca * len, y0 + sa * len); g.stroke();
    }
    // fuzzy outline: rays from the head centre to the silhouette; strands poke outward
    m = Math.round(90 + rh * 3);
    var fz = new Float32Array(m * 9);
    for (k = 0; k < m; k++) {
      var phi = rnd() * TAU, dxr = Math.cos(phi), dyr = Math.sin(phi), lo = 0, hi = 2.2;
      for (var it = 0; it < 18; it++) { var mid = (lo + hi) / 2; if (headInside(0.25 + dxr * mid, dyr * mid)) lo = mid; else hi = mid; }
      var bx = 0.25 + dxr * lo, by = dyr * lo, sg = by < 0 ? -1 : 1;
      var g1 = -(headRho(bx + 0.01) - headRho(bx - 0.01)) / 0.02, gl = Math.sqrt(g1 * g1 + 1) || 1, ex = g1 / gl, ey = sg / gl;
      var j = (rnd() - 0.5) * 0.8 - 0.25 * sg * (bx > 0 ? 1 : 0), cj = Math.cos(j), sj = Math.sin(j);
      var o = k * 9;
      fz[o] = bx * rh - ex * rh * 0.04; fz[o + 1] = by * rh - ey * rh * 0.04;
      fz[o + 2] = ex * cj - ey * sj; fz[o + 3] = ex * sj + ey * cj;
      fz[o + 4] = rh * (0.05 + rnd() * 0.09); fz[o + 5] = 0.45 + rnd() * 0.3; fz[o + 6] = 0.15 + rnd() * 0.2;
      fz[o + 7] = ex; fz[o + 8] = ey;
    }
    // back of the head melts into the neck (keeps the bulging outline above / below it)
    var fade = canvasEl(W, H), fg = fade.getContext('2d');
    fg.setTransform(1, 0, 0, 0.62, ox, oy);
    var fo = fg.createRadialGradient(-1.55 * rh, 0, 0, -1.55 * rh, 0, 1.25 * rh);
    fo.addColorStop(0, 'rgba(0,0,0,1)'); fo.addColorStop(0.5, 'rgba(0,0,0,0.85)'); fo.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = fo; fg.fillRect(-3 * rh, -3 * rh, 3 * rh, 6 * rh);
    return { W: W, H: H, ox: ox, oy: oy, rh: rh, NX: NX, NY: NY, NZ: NZ, AL: AL, MU: MU, SH: SH, det: det, fz: fz, nf: m, fade: fade };
  }

  // Head sprite for one lighting bucket (~1 ms; drawn rotated to the exact heading at runtime).
  function headSprite(B, b) {
    var th = b / HB * TAU, fx = Math.cos(th), fy = Math.sin(th);
    var lx = L3[0] * fx + L3[1] * fy, ly = -L3[0] * fy + L3[1] * fx, lz = L3[2];
    var W = B.W, H = B.H, c = canvasEl(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    var col = [0, 0, 0], muz = [249, 210, 220], n = W * H, i, k;
    for (i = 0; i < n; i++) {
      var a = B.AL[i]; if (a <= 0) continue;
      var sh = (B.NX[i] * lx + B.NY[i] * ly + B.NZ[i] * lz + WRAP) / (1 + WRAP) + B.SH[i];
      rampAt(RAMP[0], clamp(sh, 0, 1), col); mixTo(col, muz, B.MU[i]);
      var j = i * 4; d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.drawImage(B.det, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.translate(B.ox, B.oy); g.lineCap = 'round'; g.lineWidth = Math.max(0.7, B.rh * 0.014);
    var tint = [255, 240, 244], fz = B.fz;
    for (k = 0; k < B.nf; k++) {
      var o = k * 9, X0 = fz[o], Y0 = fz[o + 1], dx = fz[o + 2], dy = fz[o + 3], L = fz[o + 4];
      rampAt(RAMP[0], clamp((fz[o + 7] * lx + fz[o + 8] * ly + 0.2 * lz + WRAP) / (1 + WRAP) + 0.12, 0, 1), col); mixTo(col, tint, 0.16);
      g.strokeStyle = rgba(col, fz[o + 5]);
      g.beginPath(); g.moveTo(X0, Y0); g.lineTo(X0 + dx * L * 0.55, Y0 + dy * L * 0.55); g.stroke();
      g.strokeStyle = rgba(col, fz[o + 6]);
      g.beginPath(); g.moveTo(X0 + dx * L * 0.5, Y0 + dy * L * 0.5); g.lineTo(X0 + dx * L, Y0 + dy * L); g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(B.fade, 0, 0);
    return { c: c, ox: B.ox, oy: B.oy };
  }

  // All sprites for one body radius (device px), built as a queue of small tasks so the work can be
  // spread over frames (no long main-thread task at load). job.step(ms) returns true when complete.
  function bankJob(R, furDev) {
    var bank = { R: R, RH: R * HEAD, fur: furDev, big: [[], [], []], small: [[], [], []], floor: [], occl: [], head: new Array(HB), headBase: null };
    var tasks = [], t0 = 0, spent = 0;
    // tasks are kept small (one sprite each) so a slow phone never gets a long main-thread task from the bank
    function set(kind, v, small) { // one colour variant: mask, detail, then the 32 angle sprites one by one
      var rs = small ? R * SMALL : R, seed = small ? 500 + kind * 31 + v * 7 : 1000 + kind * 97 + v * 13, mask, det, arr = [];
      (small ? bank.small : bank.big)[kind][v] = arr;
      tasks.push(function () { mask = stampMask(rs, seed); });
      tasks.push(function () { det = stampDetail(rs, seed + (small ? 100 : 7), kind, furDev); });
      for (var q = 0; q < NB; q++) (function (b) {
        tasks.push(function () { arr[b] = stampSprite(rs, b / NB * PI, kind, mask, det); });
      })(q);
    }
    for (var kind = 0; kind < 3; kind++) {
      for (var v = 0; v < VARIANTS[kind]; v++) set(kind, v, false);
      for (v = 0; v < (kind === 0 ? 3 : 1); v++) set(kind, v, true);
    }
    tasks.push(function () {
      for (var i = 0; i < BLOB.length; i++) {
        bank.floor.push(blobSprite(R * 1.2 * BLOB[i], [140, 60, 80]));
        bank.occl.push(blobSprite(R * 1.05 * BLOB[i], [84, 22, 42]));
      }
    });
    tasks.push(function () {
      bank.headShadow = blobSprite(R * HEAD * 1.55, [140, 60, 80]);
      bank.cap = capSprite(R * TIP, furDev);
      bank.eye = eyeSprite(Math.max(1.6, R * HEAD * 0.13));
    });
    tasks.push(function () { bank.headBase = headBase(bank.RH, furDev); });
    for (var h = 0; h < HB; h++) (function (b) {
      tasks.push(function () { bank.head[b] = headSprite(bank.headBase, b); });
    })(h);
    var job = { bank: bank, tasks: tasks, i: 0 };
    job.step = function (budget) {
      t0 = now();
      while (job.i < tasks.length) { tasks[job.i++](); if (now() - t0 > budget) break; }
      spent += now() - t0; bank.ms = spent;
      return job.i >= tasks.length;
    };
    return job;
  }
  function getHead(bank, ang) {
    var b = Math.round((ang / TAU) * HB) % HB; if (b < 0) b += HB;
    if (!bank.headBase) bank.headBase = headBase(bank.RH, bank.fur);
    return bank.head[b] || (bank.head[b] = headSprite(bank.headBase, b)); // fallback (normally prebuilt)
  }

  /* ------------------------------------------------------------------ trail (ring buffer) */
  function Trail(cap) {
    this.cap = cap; this.mask = cap - 1; this.n = 0;
    this.x = new Float64Array(cap); this.y = new Float64Array(cap); this.c = new Float64Array(cap); this.z = new Uint8Array(cap);
  }
  Trail.prototype.reset = function () { this.n = 0; };
  Trail.prototype.push = function (x, y, z) {
    var n = this.n, m = this.mask, i = n & m;
    if (n) {
      var j = (n - 1) & m, dx = x - this.x[j], dy = y - this.y[j], d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-3) { this.z[j] = z; return; }
      this.c[i] = this.c[j] + d;
    } else this.c[i] = 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.n = n + 1;
  };
  Trail.prototype.headX = function () { return this.x[(this.n - 1) & this.mask]; };
  Trail.prototype.headY = function () { return this.y[(this.n - 1) & this.mask]; };
  // Re-map every stored point (resize) and rebuild the cumulative lengths.
  Trail.prototype.remap = function (fx, fy) {
    var first = Math.max(0, this.n - this.cap), m = this.mask, prev = -1;
    for (var k = first; k < this.n; k++) {
      var i = k & m; this.x[i] = fx(this.x[i]); this.y[i] = fy(this.y[i]);
      this.c[i] = prev < 0 ? 0 : this.c[prev] + Math.hypot(this.x[i] - this.x[prev], this.y[i] - this.y[prev]);
      prev = i;
    }
  };

  /* ------------------------------------------------------------------ mount */
  function prefersReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function noop() {}

  function mount(canvas, opts) {
    opts = opts || {};
    var api = { replay: noop, chase: noop, pause: noop, resume: noop, destroy: noop, getLogoBox: function () { return { x: 0, y: 0, w: 0, h: 0 }; }, stats: { ms: 0, max: 0, frames: 0 } };
    if (!canvas || !canvas.getContext) return api;
    var ctx = canvas.getContext('2d');
    if (!ctx) return api;

    var jm = opts.mode === 'journey';     // journey: document-space world on a fixed canvas
    var mode = opts.mode === 'wander' ? 'wander' : 'logo';   // journey shares every 'logo' behaviour
    var heroEl = jm ? (opts.hero || opts.pointerTarget || canvas.parentElement) : null;
    var target = opts.pointerTarget || heroEl || canvas.parentElement || canvas;
    var reduced = typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : prefersReduced();
    var ignoreSel = jm ? JOURNEY_IGNORE + (opts.ignoreSelector ? ',' + opts.ignoreSelector : '') : (opts.ignoreSelector || DEFAULT_IGNORE);
    var debug = !!opts.debug;
    if (!jm) canvas.style.touchAction = 'pan-y';
    if (jm && !heroEl) return api;

    // ---- geometry / state
    var W = 0, H = 0, dprRaw = 0, dpr = 1, cw = 0, ch = 0, sized = false, destroyed = false;
    var box = { x: 0, y: 0, w: 0, h: 0 }, r = 10, rh = 12, rDev = 10, Lbody = 0, bank = null;
    var state = ST_BOOT, clock = 0, written = false, initialWrite = false, mountT = now();
    var trail = new Trail(8192);
    // path in px
    var pX = null, pY = null, pZ = null, pK = null, pN = 0, eX = [], eY = [];
    // route (writing / return)
    var rX, rY, rZ, rC, rK, rN = 0, rQ = 0, rq = 0, rv = 0, ri = 0, vCruise = 600, vRoute = 600;
    // body tables (ascending s; index 0 sits under the head)
    var bodyColorAt = null, nSt = 0, stS, stF, stCol, stVar, stDith, stJx, stJy, kHead = 0, chunkN = 40, shStep = 4, ovStep = 3, sMaxLook = 0, sLookMax = 0;
    // poses (device px) and plans
    var poseF = null, poseR = null, poseL = null, planF = null, planR = null, kLive = 0;
    var rank, ov, gcell, gnext, cellHead = null, gridW = 0, gridH = 0, gridCell = 1;
    var runA = new Int32Array(64), runB = new Int32Array(64), runZ = new Int32Array(64);
    // rest cache (progressive rebuild for breathing)
    var cacheA = null, cacheB = null, cacheX = 0, cacheY = 0, restReady = false, cacheReady = false, cacheCursor = 0, cacheBreath = 1, restT0 = 0, job = null;
    // look / head / tongue
    var lookA = 0, lookDX = 0, lookDY = 0, eyeX = 0, eyeY = 0, bobT = 0;
    var tongueT = -1, nextFlick = 2.5, lastFlickEnd = -9;
    var headCX = 0, headCY = 0, headAng = PI;   // last drawn head (css px)
    // free motion (chase / wander)
    var heading = 0, speed = 0, undPhase = 0, chaseX = 0, chaseY = 0, lastChaseMove = 0, chaseLeft = false;
    // pointer
    var ptr = { cx: 0, cy: 0, x: 0, y: 0, inside: false, t: -99, type: 'mouse', dirty: false };
    // loop
    var raf = 0, lastT = 0, visible = true, userPaused = false, pendingLayout = 0, furWaitTimer = 0;
    var headState = { x: 0, y: 0, a: 0, tongue: 0, breath: 1 }, wTmp = [0, 0], bankScale = 1;
    // journey: the path J (css px, document space), scroll map and follower
    var endEl = jm ? (opts.end || null) : null;
    var zoneEl = jm ? (opts.zoneEnd || (endEl && endEl.closest ? endEl.closest('section') : null) || null) : null;
    var marqEl = jm ? (opts.marquee || document.querySelector('.marquee')) : null;
    var jX = null, jY = null, jZ = null, jC = null, jK = null, jN = 0, iRest = 0, iQ = 0, uRest = 0, uEnd = 0;
    var mapS = null, mapU = null, mapN = 0, meas = null, measSig = '', measureTimer = 0;
    var viewY = 0, oyDev = 0, baseX = 0, baseY = 0, Hview = 0, Hmax = 0, inZone = true, drawn = false, zoneTop = 0, zoneBot = 0;
    var uJ = 0, vJ = 0, vTs = 0, uTprev = -1, restAt = 0, atLogo = false, atEnd = false, routeEndU = -1, gaugeC = null, coil = null;
    var cullY0 = -1e9, cullY1 = 1e9, gridOY = 0, staticRaf = 0, tap = null, chaseIdle = CHASE_IDLE;
    var jTmp = [0, 0, 0, 0];
    // scroll offset read in the scroll event (never inside the frame, after other rAF callbacks wrote styles)
    var scrollCache = 0;
    // dirty box (canvas device px) of everything drawn last frame: clear only that; null = unknown -> full clear
    var dirty = null;
    // idle (journey, nothing moving): loop stopped until scroll / pointer / the next tongue flick
    var idleT = 0, idleAt = 0, drawnKey = '', restTick = 0, warmFrames = 0, warmT0 = 0;
    var seamOK = null;

    /* ---------------- layout ---------------- */
    function writeVars() {
      if (mode !== 'logo') return;
      var b = getLogoBox(), s = target.style;
      s.setProperty('--logo-x', b.x.toFixed(1) + 'px');
      s.setProperty('--logo-y', b.y.toFixed(1) + 'px');
      s.setProperty('--logo-w', b.w.toFixed(1) + 'px');
      s.setProperty('--logo-h', b.h.toFixed(1) + 'px');
    }
    function getLogoBox() {
      var ox = 0, oy = 0;
      if (jm) { var tb = docBox(target); return { x: box.x - tb.x, y: box.y - tb.y, w: box.w, h: box.h }; }
      if (target !== canvas) {
        var a = canvas.getBoundingClientRect(), t = target.getBoundingClientRect();
        ox = a.left - t.left - (target.clientLeft || 0); oy = a.top - t.top - (target.clientTop || 0);
      }
      if (mode !== 'logo') return { x: ox, y: oy, w: W, h: H };
      return { x: box.x + ox, y: box.y + oy, w: box.w, h: box.h };
    }

    function buildLogoGeometry() {
      var bh = box.h, i;
      pN = PATH.n; pX = new Float64Array(pN); pY = new Float64Array(pN); pZ = PATH.z; pK = new Float32Array(pN);
      for (i = 0; i < pN; i++) { pX[i] = box.x + PATH.x[i] * bh; pY[i] = box.y + PATH.y[i] * bh; pK[i] = PATH.k[i] / bh; }
      Lbody = PATH.len * bh;
      // tail extension: continue the tail's direction, easing toward right/slightly down, past the edge
      eX = [pX[pN - 1]]; eY = [pY[pN - 1]];
      var ang = Math.atan2(pY[pN - 1] - pY[pN - 6], pX[pN - 1] - pX[pN - 6]), goal = Math.atan2(0.16, 1);
      var x = eX[0], y = eY[0], lim = W + rh * 3.4;
      for (i = 0; i < 6000 && x < lim; i++) { ang += (goal - ang) * 0.025; x += Math.cos(ang) * 2; y += Math.sin(ang) * 2; eX.push(x); eY.push(y); }
    }

    // A run drawn over its head-side neighbour shows a seam; hide it in the middle of a pink section
    // (searching head-ward only into the free bowl bottom, so the crossings keep their layering).
    function placeSeams() {
      var z = new Uint8Array(PATH.z), i, j, bh = box.h, step = PATH.c[1] * bh;
      for (i = 0; i < pN - 1; i++) {
        if (!(z[i] < z[i + 1])) continue;
        var sOld = PATH.c[i] * bh, best = -1, bestScore = -1e9;
        for (var sc = sOld - 0.42 * bh; sc <= sOld + 0.03 * bh; sc += 1) {
          if (sc < 4 * r) continue;
          var dn = 0, dp = 0;
          while (dn < 3 * r && bodyColorAt(sc + dn) === 0) dn += 1;
          while (dp < 2 * r && bodyColorAt(sc - dp) === 0) dp += 1;
          var score = Math.min(dn - 1.8 * r, dp - 0.9 * r) - 0.02 * Math.abs(sc - sOld) / r;
          if (score > bestScore) { bestScore = score; best = sc; }
        }
        if (best < 0) continue;
        var iNew = clamp(Math.round(best / step), 1, pN - 2), zHead = z[i], zTail = z[i + 1];
        if (iNew < i) for (j = iNew + 1; j <= i; j++) z[j] = zTail;
        else for (j = i + 1; j <= iNew; j++) z[j] = zHead;
        i = Math.max(i, iNew);
      }
      pZ = z;
    }

    /* ---------------- journey: DOM measurement (document px) ---------------- */
    // Layout box from the offset chain: ignores transforms (reveal offsets, tilt), unlike getBoundingClientRect.
    function docBox(el) {
      var x = 0, y = 0, e = el;
      while (e) {
        x += (e.offsetLeft || 0) + (e !== el ? e.clientLeft || 0 : 0);
        y += (e.offsetTop || 0) + (e !== el ? e.clientTop || 0 : 0);
        e = e.offsetParent;
      }
      return { x: x, y: y, w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
    }
    function measure() {
      var m = { secs: [], colR: 0, contR: 0, marq: null }, i, b, e, guard = 0;
      m.hero = docBox(heroEl);
      // the hero's left text column (desktop: the snake leaves through the channel between it and the logo)
      var cols = heroEl.querySelectorAll('h1, .hero__lead, .hero__actions');
      for (i = 0; i < cols.length; i++) {
        b = docBox(cols[i]);
        if (b.w > 0 && b.x + b.w * 0.5 < m.hero.x + m.hero.w * 0.5) m.colR = Math.max(m.colR, b.x + b.w);
      }
      // blocks between the hero and the end of the zone
      e = zoneEl ? heroEl.nextElementSibling : null;
      while (e && guard++ < 40) {
        if (e.offsetHeight > 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'CANVAS') {
          b = docBox(e);
          if (marqEl && (e === marqEl || e.contains(marqEl))) m.marq = docBox(marqEl);
          else {
            var sec = { box: b, end: e === zoneEl, head: null, contR: 0 };
            var cont = e.querySelector('.container');
            if (cont) {
              var cb = docBox(cont), cs = window.getComputedStyle(cont);
              sec.contR = cb.x + cb.w - (parseFloat(cs.paddingRight) || 0);
              m.contR = Math.max(m.contR, sec.contR);
            }
            var head = e.querySelector('.section-head') || e.querySelector('header');
            if (head && head.offsetHeight) {
              var hb = docBox(head), hr = head.children.length ? hb.x : hb.x + hb.w;
              for (i = 0; i < head.children.length; i++) { var c = docBox(head.children[i]); if (c.w > 0) hr = Math.max(hr, c.x + c.w); }
              sec.head = { x: hb.x, y: hb.y, w: hb.w, h: hb.h, r: hr };
            }
            m.secs.push(sec);
          }
        }
        if (e === zoneEl) break;
        e = e.nextElementSibling;
      }
      m.gauge = endEl && endEl.offsetWidth ? docBox(endEl) : null;
      m.zone = zoneEl && zoneEl.offsetHeight ? docBox(zoneEl) : m.hero;
      // copy stacked above the gauge (phones / tablets): the approach must not cross it
      m.endText = null;
      if (m.gauge && zoneEl) {
        var ts = zoneEl.querySelectorAll('.section-title, .section-lead'), g0 = m.gauge;
        for (i = 0; i < ts.length; i++) {
          b = docBox(ts[i]);
          if (!(b.w > 0 && b.h > 0) || b.y + b.h > g0.y + 0.3 * g0.h || b.x > g0.x + g0.w || b.x + b.w < g0.x) continue;
          if (!m.endText) m.endText = { x: b.x, y: b.y, r: b.x + b.w, b: b.y + b.h };
          else { m.endText.x = Math.min(m.endText.x, b.x); m.endText.r = Math.max(m.endText.r, b.x + b.w); m.endText.b = Math.max(m.endText.b, b.y + b.h); }
        }
      }
      m.docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var sig = [m.hero.x, m.hero.y, m.hero.w, m.hero.h, m.colR, m.contR, m.zone.y, m.zone.h, m.docH];
      if (m.marq) sig.push(m.marq.y, m.marq.h);
      if (m.gauge) sig.push(m.gauge.x, m.gauge.y, m.gauge.w);
      if (m.endText) sig.push(m.endText.b, m.endText.r);
      for (i = 0; i < m.secs.length; i++) { var s = m.secs[i]; sig.push(s.box.y, s.box.h); if (s.head) sig.push(s.head.y, s.head.h, s.head.r); }
      m.sig = sig.map(function (v) { return Math.round(v); }).join(',');
      return m;
    }

    /* ---------------- journey: the path J (logo in writing order + descent + coil) ---------------- */
    function hermite(add, x0, y0, a0, x1, y1, a1, s0, s1, z) {
      var chd = Math.hypot(x1 - x0, y1 - y0); if (chd < 1e-3) return;
      var tx0 = Math.cos(a0) * chd * s0, ty0 = Math.sin(a0) * chd * s0, tx1 = Math.cos(a1) * chd * s1, ty1 = Math.sin(a1) * chd * s1;
      var steps = Math.max(8, Math.ceil(chd * 0.9));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps, t2 = t * t, t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        add(h00 * x0 + h10 * tx0 + h01 * x1 + h11 * tx1, h00 * y0 + h10 * ty0 + h01 * y1 + h11 * ty1, z);
      }
    }
    function buildJourney() {
      var m = meas, bw = 2 * r, i, k, n;
      var xs = [], ys = [], zs = [];
      function add(x, y, z) {
        var q = xs.length;
        if (q && Math.abs(x - xs[q - 1]) < 0.05 && Math.abs(y - ys[q - 1]) < 0.05) return;
        xs.push(x); ys.push(y); zs.push(z);
      }
      // (A) writing order: off-screen run-up, tail extension (reversed), then the logo from tail to head
      n = eX.length;
      var ex = eX[n - 1], ey = eY[n - 1], dx = ex - eX[Math.max(0, n - 6)], dy = ey - eY[Math.max(0, n - 6)], dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      for (var s = Lbody + 12 * r; s > 0; s -= 3) add(ex + dx * s, ey + dy * s, 0);
      for (i = n - 1; i >= 0; i--) add(eX[i], eY[i], 0);
      for (i = pN - 1; i >= 0; i--) add(pX[i], pY[i], pZ[i]);
      var iR = xs.length - 1;

      // (B) descent waypoints: {x, y, a (heading), t (tangent scale), col (on the right column)}
      // The right lane. In a page margin wide enough for the body, its wiggle and the (wider) head, the lane sits
      // between the text column and the viewport edge: the body never covers copy, the head is never clipped.
      // Otherwise (phones, tablets, ~1024px) it runs in the gutter mostly off-screen: only a sliver of fur shows
      // beside the copy (cream text over pink fur would fail contrast), wiggling outward only.
      var contR = m.contR || W - 16, margin = W - contR, laneRoom = margin - 8 - r - rh, gutter = laneRoom < 8, xr, colAmp;
      if (!gutter) {
        colAmp = Math.min(0.42 * bw, laneRoom / 2);
        xr = clamp(contR + margin / 2, contR + 4 + r + colAmp, W - 4 - rh - colAmp);
      } else {
        colAmp = 0.12 * bw;
        xr = contR + 2 + r;
      }
      var logoMinX = 1e9, logoMaxY = -1e9;
      for (i = 0; i < pN; i++) { if (pX[i] < logoMinX) logoMinX = pX[i]; if (pY[i] > logoMaxY) logoMaxY = pY[i]; }
      var wide = W >= 960 && m.colR > 0 && box.x > m.colR;
      var wps = [{ x: pX[0], y: pY[0], a: Math.atan2(pY[0] - pY[6], pX[0] - pX[6]), t: 1 }];
      if (wide) {   // down the channel between the headline column and the logo
        wps.push({ x: (m.colR + logoMinX - r) / 2, y: box.y + box.h * 0.82, a: PI / 2, t: 1 });
      } else {      // curl under the logo, then into the right column
        var yU = logoMaxY + r + 0.55 * bw;
        wps.push({ x: box.x + box.w * 0.44, y: yU, a: 0.14, t: 1 });
        wps.push({ x: xr, y: yU + 2.6 * bw, a: PI / 2, t: 1, col: true });
      }
      // a big lazy S into open space beside section heads, then back to the right column
      for (k = 0; k < m.secs.length; k++) {
        var sc = m.secs[k], hd = sc.head, cR = sc.contR || contR;
        if (sc.end || !hd) continue;
        var oL = hd.r + 0.6 * bw, oR = cR - 0.2 * bw, prev = wps[wps.length - 1];
        if (oR - oL < 3 * bw || hd.y < prev.y + 2 * bw) continue;
        wps.push({ x: (oL + oR) / 2, y: hd.y + hd.h * 0.55, a: PI / 2 - 0.12, t: 1.05 });
        wps.push({ x: xr, y: hd.y + hd.h + 2.4 * bw, a: PI / 2, t: 1, col: true });
      }
      var last = wps[wps.length - 1];
      if (!last.col) {
        var yMin = (m.marq ? m.marq.y + m.marq.h : m.hero.y + m.hero.h) + 2 * bw;
        last = { x: xr, y: Math.max(last.y + 4 * bw, yMin), a: PI / 2, t: 1, col: true };
        wps.push(last);
      }
      // (C) approach + coil, head ending near 12 o'clock.
      //   Gauge beside the copy (desktop): counter-clockwise, entering from the right over the top; the head rides
      //   over the first turn. Copy stacked above the gauge (phones, tablets): the approach stays in the lane until
      //   the copy is passed, then joins the ring at 3 o'clock heading down and wraps clockwise - it never crosses
      //   the heading or the lead.
      var g = m.gauge, et = m.endText;
      coil = null; gaugeC = null;
      if (g) {
        var cx = g.x + g.w / 2, cy = g.y + g.h / 2, ringR = 0.4 * g.w, R = ringR + 0.75 * bw;
        var dir, thS, Phi, lift, yq;
        if (et) { dir = 1; thS = 0; Phi = 1.5 * PI + 0.1; lift = 0; }
        else {
          var turns = clamp(Lbody * 0.96 / (TAU * (R + 0.25 * bw)), 0.62, 1.08);
          dir = -1; Phi = turns * TAU; thS = 262 / 180 * PI + Phi; lift = 0.78 * bw;
        }
        var dR = 0.22 * bw / TAU, mx = cx + R * Math.cos(thS), my = cy + R * Math.sin(thS);
        if (et) yq = Math.min(Math.max(last.y + bw, et.b + r + 0.3 * bw), my - 1.2 * bw);
        else yq = Math.max(last.y + 3 * bw, my - 0.65 * Math.abs(xr - mx) - bw);
        wps.push({ x: xr, y: yq, a: PI / 2, t: 1, col: true });
        wps.push({ x: mx, y: my, a: thS + dir * PI / 2, t: 1, coil: true });
        coil = { cx: cx, cy: cy, R: R, thS: thS, Phi: Phi, dR: dR, lift: lift, dir: dir };
        gaugeC = { x: cx, y: cy, r: ringR };
      } else {
        wps.push({ x: xr, y: Math.max(last.y + 3 * bw, m.zone.y + m.zone.h - 3 * bw), a: PI / 2, t: 1, col: true });
      }
      var iq = -1;
      for (k = 1; k < wps.length; k++) {
        var A = wps[k - 1], B = wps[k];
        if (B.coil) iq = xs.length - 1;
        if (A.col && B.col && B.y > A.y + bw) {   // right column: gentle S-wiggles, vertical at both ends
          var len = B.y - A.y, lam = (wide ? 9 : 8) * bw, nW = Math.max(1, Math.round(len / lam));
          lam = len / nW;
          var steps = Math.ceil(len / 2), ramp = Math.min(lam * 0.6, len / 2);
          for (var q = 1; q <= steps; q++) {
            var tt = len * q / steps, env = smooth(0, ramp, tt) * smooth(0, ramp, len - tt);
            var wig = gutter ? 0.5 * (1 - Math.cos(TAU * tt / lam)) : Math.sin(TAU * tt / lam);   // gutter: outward only
            add(A.x + (B.x - A.x) * q / steps + colAmp * env * wig, A.y + tt, Z_DESC);
          }
        } else hermite(add, A.x, A.y, A.a, B.x, B.y, B.a, A.t, B.t, Z_DESC);
      }
      if (coil) {
        var csteps = Math.ceil(coil.Phi * (coil.R + 0.3 * bw) / 2);
        for (q = 1; q <= csteps; q++) {
          // slow outward spiral; the last stretch rides up and over the first turn so the head rests
          // half on its own body with its silhouette against the background
          var ph = coil.Phi * q / csteps, th = coil.thS + coil.dir * ph, rr = coil.R + coil.dR * ph + coil.lift * smooth(TAU - 1.5, TAU + 0.15, ph);
          add(coil.cx + rr * Math.cos(th), coil.cy + rr * Math.sin(th), Z_DESC);
        }
      }
      // arrays + arc length + curvature (route speed control)
      jN = xs.length;
      jX = new Float64Array(xs); jY = new Float64Array(ys); jZ = new Uint8Array(zs);
      jC = new Float64Array(jN); jK = new Float32Array(jN);
      for (i = 1; i < jN; i++) jC[i] = jC[i - 1] + Math.hypot(jX[i] - jX[i - 1], jY[i] - jY[i - 1]);
      var raw = new Float32Array(jN), acc = new Float64Array(jN + 1), win = 14;
      for (i = 1; i < jN - 1; i++) {
        var b0 = Math.atan2(jY[i] - jY[i - 1], jX[i] - jX[i - 1]), b1 = Math.atan2(jY[i + 1] - jY[i], jX[i + 1] - jX[i]);
        raw[i] = Math.abs(wrapA(b1 - b0)) / Math.max(0.3, (jC[i + 1] - jC[i - 1]) * 0.5);
      }
      for (i = 0; i < jN; i++) acc[i + 1] = acc[i] + raw[i];
      for (i = 0; i < jN; i++) { var lo = Math.max(0, i - win), hi = Math.min(jN, i + win + 1); jK[i] = (acc[hi] - acc[lo]) / (hi - lo); }
      iRest = iR; uRest = jC[iR]; uEnd = jC[jN - 1];
      iQ = iq >= 0 ? iq : jN - 1;
      zoneTop = m.hero.y; zoneBot = m.zone.y + m.zone.h;
      buildMap();
    }

    // Scroll -> head position: monotonic table (scroll px, arc px). During the descent the head leads at ~0.5 of
    // the viewport (after a ramp from its rest height); the approach + coil are spread so that the head arrives
    // (u = uEnd) exactly when the gauge centre is at the viewport centre.
    function buildMap() {
      var Hv = Hview || H, n = jN - iRest, i, k;
      mapN = n; mapS = new Float64Array(n); mapU = new Float64Array(n);
      var p0 = jY[iRest], a0 = clamp((p0 - zoneTop - S0_REST) / Hv, 0.04, 0.9), ramp = 0.8 * Hv, key = p0;
      for (i = iRest; i < jN; i++) {
        k = i - iRest; mapU[k] = jC[i];
        if (i === iRest) { mapS[k] = zoneTop + S0_REST; continue; }
        if (i > iQ) continue;
        key = Math.max(jY[i], key + 0.3 * (jC[i] - jC[i - 1]));
        mapS[k] = key - Hv * (a0 + (0.5 - a0) * smooth(0, ramp, key - p0));
      }
      var kq = iQ - iRest, sQ = mapS[kq], maxScroll = Math.max(0, meas.docH - Hv);
      var sEnd = Math.min(gaugeC ? gaugeC.y - Hv / 2 : sQ, maxScroll);
      for (i = iQ + 1; i < jN; i++) mapS[i - iRest] = sQ + (sEnd - sQ) * (jC[i] - jC[iQ]) / Math.max(1, uEnd - jC[iQ]);
      mapS[n - 1] = sEnd;
      for (k = n - 2; k >= 1; k--) mapS[k] = Math.min(mapS[k], mapS[k + 1] - 0.17 * (mapU[k + 1] - mapU[k]));
      mapS[0] = zoneTop + S0_REST;
      for (k = 1; k < n; k++) if (!(mapS[k] > mapS[k - 1])) mapS[k] = mapS[k - 1] + 1e-3 * Math.max(1e-3, mapU[k] - mapU[k - 1]);
    }
    function uAtScroll(s) {
      if (!mapN) return uRest;
      if (s <= mapS[0]) return mapU[0];
      if (s >= mapS[mapN - 1]) return mapU[mapN - 1];
      var lo = 0, hi = mapN - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (mapS[mid] <= s) lo = mid; else hi = mid; }
      return mapU[lo] + (mapU[hi] - mapU[lo]) * (s - mapS[lo]) / (mapS[hi] - mapS[lo]);
    }
    function jIndex(u) { // largest i with jC[i] <= u (and i < jN - 1)
      if (u <= 0) return 0;
      if (u >= jC[jN - 1]) return jN - 2;
      var lo = 0, hi = jN - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (jC[mid] <= u) lo = mid; else hi = mid; }
      return lo;
    }
    function jAt(u, o) {
      var i = jIndex(u), d = jC[i + 1] - jC[i], t = d > 0 ? clamp((u - jC[i]) / d, 0, 1) : 0;
      o[0] = jX[i] + (jX[i + 1] - jX[i]) * t; o[1] = jY[i] + (jY[i + 1] - jY[i]) * t; o[2] = t < 0.5 ? jZ[i] : jZ[i + 1]; o[3] = i;
      return o;
    }
    // body = J segment [u - L, u]: lay it into the trail so the regular pose sampling applies
    function fillTrailJ(u) {
      trail.reset();
      var o = jAt(Math.max(0, u - Lbody - 4 * r), jTmp), i = o[3] + 1;
      trail.push(o[0], o[1], o[2]);
      for (; i < jN && jC[i] < u; i++) trail.push(jX[i], jY[i], jZ[i]);
      o = jAt(u, jTmp); trail.push(o[0], o[1], o[2]);
    }
    function scrollNow() { return window.pageYOffset || document.documentElement.scrollTop || 0; }
    function setLogo(v) { if (atLogo === v) return; atLogo = v; if (v) written = true; emit(canvas, v ? 'snake:written' : 'snake:unwritten'); }
    function setEnd(v) { if (atEnd === v) return; atEnd = v; emit(canvas, v ? 'snake:arrived' : 'snake:departed'); }

    function profile(s) { // radius factor along the body (s from head centre)
      var w = 2 * r, f = 1, nk = (s - rh * 1.1) / w;
      if (nk > -0.6 && nk < 2.6) f -= 0.1 * Math.sin(clamp((nk + 0.6) / 3.2, 0, 1) * PI);   // gentle neck
      var t0 = Lbody * (mode === 'logo' ? 0.76 : 0.7);
      if (s > t0) f *= 1 - (1 - TIP) * Math.pow((s - t0) / (Lbody - t0), 1.35);              // long taper
      return f;
    }

    function buildBodyTables() {
      var L = Lbody, w = 2 * r, step = W < 600 ? 3 : clamp(0.075 * r, 2, 3), i, k;
      var s0 = 0.25 * rh, NI = Math.ceil(L) + 2, uTab = new Float64Array(NI);
      for (i = 1; i < NI; i++) uTab[i] = uTab[i - 1] + 1 / (w * profile(i - 0.5));
      function uAt(s) { s = clamp(s, 0, NI - 1.001); var a = s | 0; return uTab[a] + (uTab[a + 1] - uTab[a]) * (s - a); }
      function sAtU(u) { var lo = 0, hi = NI - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (uTab[m] < u) lo = m; else hi = m; } return lo + (u - uTab[lo]) / Math.max(1e-9, uTab[hi] - uTab[lo]); }
      // band layout: first band ~0.7w behind the head, whole periods, pink tail tip
      var uStart = uAt(1.22 * rh + 0.7 * w), uEnd = uAt(L), tipU = 1.5;
      var nb = Math.floor((uEnd - tipU - uStart - 0.5) / PERIOD) + 1, kS = 1;
      if (nb < 1) nb = 0; else kS = (uEnd - tipU - uStart) / ((nb - 1) * PERIOD + 0.5);
      function colorAtU(u) {
        if (!nb) return 0;
        var rel = (u - uStart) / kS; if (rel < 0) return 0;
        var p = Math.floor(rel / PERIOD); if (p >= nb) return 0;
        var f = rel - p * PERIOD; return f < 0.125 ? 2 : f < 0.375 ? 1 : f < 0.5 ? 2 : 0;
      }
      bodyColorAt = function (s) { return colorAtU(uAt(s)); };
      var list = [];
      for (var s = s0; s < L; s += step * clamp(profile(s), 0.42, 1)) list.push(s);
      list.push(L);
      var edges = [0, 0.125, 0.375, 0.5];
      for (i = 0; i < nb; i++) for (k = 0; k < 4; k++) {
        var sb = sAtU(uStart + kS * (i * PERIOD + edges[k])), sp = sb - ALONG * r * profile(sb);
        if (sp > s0 && sp < L) list.push(sp);
      }
      list.sort(function (a, b) { return a - b; });
      var out = [list[0]];
      for (i = 1; i < list.length; i++) if (list[i] - out[out.length - 1] > 0.25) out.push(list[i]);
      nSt = out.length;
      stS = new Float64Array(out); stF = new Float32Array(nSt); stCol = new Uint8Array(nSt); stVar = new Uint8Array(nSt); stDith = new Float32Array(nSt);
      stJx = new Float32Array(nSt); stJy = new Float32Array(nSt);
      kHead = 0;
      for (k = 0; k < nSt; k++) {
        var sk = stS[k], f = profile(sk);
        stF[k] = f;
        stCol[k] = colorAtU(uAt(sk + ALONG * r * f) - 1e-7);
        stVar[k] = Math.floor(hash(k * 7 + 3) * VARIANTS[stCol[k]]);
        stDith[k] = hash(k * 13 + 5);
        // sub-2px fixed jitter: on straight vertical / horizontal runs, integer blits would align the fur strands into stripes
        stJx[k] = (hash(k * 29 + 17) - 0.5) * 1.5; stJy[k] = (hash(k * 31 + 7) - 0.5) * 1.5;
        if (sk < 1.1 * rh) kHead = k + 1;
      }
      if (kHead >= nSt) kHead = nSt - 1;
      // where a layer seam may start: >= 1.5r of plain pink tailward (buildPlan fades the over-run in there; a band
      // stamp faded in would show as a translucent cream / grey disc)
      seamOK = new Uint8Array(nSt);
      for (k = nSt - 1, i = Infinity; k >= 0; k--) { if (stCol[k]) i = stS[k]; seamOK[k] = i - stS[k] > 1.5 * r ? 1 : 0; }
      chunkN = Math.max(8, Math.round(8 * r / step));
      shStep = Math.max(1, Math.round(0.42 * r / step));
      ovStep = Math.max(1, Math.round(0.3 * r / step));
      sLookMax = sMaxLook = mode === 'logo' ? 0.11 * L : 0.12 * L;
      // pose / plan buffers
      poseF = makePose(nSt); poseR = makePose(nSt); poseL = makePose(nSt);
      planF = makePlan(nSt * 2 + 32); planR = makePlan(nSt * 2 + 32);
      rank = new Int32Array(nSt); ov = new Float32Array(nSt); gcell = new Int32Array(nSt); gnext = new Int32Array(nSt);
    }
    function makePose(n) { return { x: new Float32Array(n), y: new Float32Array(n), z: new Uint8Array(n), bk: new Uint8Array(n), hx: 0, hy: 0, ha: 0 }; }
    function makePlan(n) { return { k: new Uint8Array(n), i: new Int32Array(n), a: new Float32Array(n), n: 0 }; }

    // Journey layout: canvas = viewport (buffer keeps the tallest height seen unless it shrinks by >= 140px or the
    // width changes), logo box = hero formula on the hero's document rect, J + scroll map from DOM measurements.
    function layoutJ(force) {
      pendingLayout = 0;
      if (destroyed) return;
      var w = canvas.clientWidth || document.documentElement.clientWidth || 0;
      var h = window.innerHeight || document.documentElement.clientHeight || 0;
      if (w < 2 || h < 2) { sized = false; stop(); return; }
      var d = Math.min(window.devicePixelRatio || 1, 2);
      if (!bank && FUR.state === 'loading' && now() - mountT < 800) {
        if (!furWaitTimer) furWaitTimer = setTimeout(function () { furWaitTimer = 0; layoutJ(true); }, 820 - (now() - mountT));
        return;
      }
      if (furWaitTimer) { clearTimeout(furWaitTimer); furWaitTimer = 0; }
      var m = measure(), hb = m.hero, nb = logoBox(hb.w, hb.h);
      nb.x += hb.x; nb.y += hb.y;
      var hc = sized && w === W && d === dprRaw && h <= Hmax && Hmax - h < 140 ? Hmax : h;
      var same = sized && !force && w === W && d === dprRaw && Math.abs(nb.x - box.x) < 0.5 && Math.abs(nb.y - box.y) < 0.5 && Math.abs(nb.w - box.w) < 0.5;
      var oldHv = Hview;
      Hview = h; meas = m; viewY = scrollCache = scrollNow();
      if (same) {
        if (hc !== H) { H = Hmax = hc; canvas.style.height = H + 'px'; ch = Math.max(1, Math.round(H * dpr)); canvas.height = ch; sizeGrid(); drawn = false; dirty = [0, 0, 0, 0]; }
        if (m.sig !== measSig || Math.abs(oldHv - h) > 0.5) rebuildJourney();
        if (reduced) renderStatic(); else kick();
        return;
      }
      var oldBox = { x: box.x, y: box.y, h: box.h }, wasSized = sized;
      W = w; H = Hmax = hc; dprRaw = d;
      canvas.style.height = H + 'px';
      box = nb; r = THICK * 0.5 * box.h; rh = r * HEAD;
      dpr = devScale(dprRaw, W, r);
      cw = Math.max(1, Math.round(W * dpr)); ch = Math.max(1, Math.round(H * dpr));
      canvas.width = cw; canvas.height = ch; drawn = false; dirty = [0, 0, 0, 0]; drawnKey = '';
      rDev = r * dpr;
      if (!bank || Math.abs(bank.R - rDev) > 0.25 || bank.fur !== FUR.dev) {
        if (!job || job.bank.R !== rDev || job.bank.fur !== FUR.dev) job = bankJob(rDev, FUR.dev);
      }
      var oldRest = uRest, oldEnd = uEnd;
      buildLogoGeometry();
      buildBodyTables();
      placeSeams();
      buildJourney(); measSig = m.sig;
      buildRouteBuffers();
      sizeCaches();
      if (job && (reduced || !window.requestAnimationFrame)) finishJob(Infinity);
      bankScale = bank ? rDev / bank.R : 1;
      sizeGrid();
      sized = true;
      writeVars();
      if (reduced) { renderStatic(); return; }
      if (!wasSized || state === ST_BOOT) {
        var u0 = uAtScroll(viewY);
        if (u0 > uRest + 1) { setLogo(true); setLogo(false); placeAt(u0); }   // loaded mid-page: skip the intro
        else startWriting();
      } else if (state === ST_ROUTE && initialWrite) {
        var sc = box.h / (oldBox.h || box.h);
        var fx = function (x) { return box.x + (x - oldBox.x) * sc; }, fy = function (y) { return box.y + (y - oldBox.y) * sc; };
        trail.remap(fx, fy);
        vCruise *= sc; vRoute *= sc;
        for (var i = 0; i < rN; i++) { rX[i] = fx(rX[i]); rY[i] = fy(rY[i]); }
        recomputeRoute(); rq *= sc; rv *= sc;
        if (rq > rQ) rq = rQ;
        ri = 0; while (ri < rN - 1 && rC[ri + 1] <= rq) ri++;
      } else keepState(oldRest, oldEnd);
      kick();
    }
    function sizeGrid() {
      gridCell = 2.3 * rDev; gridW = Math.ceil(cw / gridCell) + 1; gridH = Math.ceil(ch * (jm ? 1.6 : 1) / gridCell) + 1;
      cellHead = new Int32Array(gridW * gridH);
    }
    // the DOM moved (fonts, images, other blocks): new J, same state
    function rebuildJourney() {
      var oldRest = uRest, oldEnd = uEnd;
      buildJourney(); measSig = meas.sig;
      buildRouteBuffers();
      if (!reduced) { sizeCaches(); keepState(oldRest, oldEnd); }
    }
    function keepState(oldRest, oldEnd) {
      if (uJ > oldRest + 0.5) uJ = uRest + (uJ - oldRest) * (uEnd - uRest) / Math.max(1, oldEnd - oldRest);
      else uJ = uRest;
      uJ = clamp(uJ, uRest, uEnd);
      if (state === ST_REST) { if (restAt === REST_END) uJ = uEnd; restReady = false; }
      else if (state === ST_ROUTE && !initialWrite) startReturnJ();
    }
    function placeAt(u) {
      uJ = clamp(u, uRest, uEnd); vJ = 0; uTprev = -1; restAt = 0;
      if (uJ <= uRest + 0.5) enterRestJ(REST_LOGO);
      else if (uJ >= uEnd - 0.5) enterRestJ(REST_END);
      else { state = ST_JOURNEY; restReady = false; }
    }
    function enterRestJ(which) {
      restAt = which; uJ = which === REST_END ? uEnd : uRest; vJ = 0;
      enterRest();
      lastFlickEnd = clock; tongueT = -1; nextFlick = clock + 0.35;
      if (which === REST_LOGO) setLogo(true); else setEnd(true);
    }
    function leaveRestJ() {
      if (restAt === REST_LOGO) setLogo(false); else if (restAt === REST_END) setEnd(false);
      restAt = 0; restReady = false;
    }
    // critically damped spring toward the scroll target, with a light feed-forward of the (smoothed) target
    // velocity so the head keeps up with continuous scrolling without overshooting wheel notches; faster when
    // far behind (e.g. after an anchor jump)
    function follow(dt, uT) {
      if (uTprev < 0 || dt <= 0) { uTprev = uT; vTs = 0; }
      vTs += ((uT - uTprev) / Math.max(dt, 1e-3) - vTs) * (1 - Math.exp(-dt / 0.15)); uTprev = uT;
      var lag = Math.abs(uT - uJ), w = 8, vmax = 5 * Hview, ff = 0.3 * vTs;
      if (lag > 1.5 * Hview) w *= Math.min(3, lag / (1.5 * Hview));
      var n = Math.max(1, Math.ceil(w * dt / 0.12)), h = dt / n;
      for (var i = 0; i < n; i++) {
        vJ += (w * w * (uT - uJ) + 2 * w * (ff - vJ)) * h;
        if (vJ > vmax) vJ = vmax; else if (vJ < -vmax) vJ = -vmax;
        uJ += vJ * h;
      }
      if (uJ < uRest) { uJ = uRest; if (vJ < 0) vJ = 0; }
      if (uJ > uEnd) { uJ = uEnd; if (vJ > 0) vJ = 0; }
    }
    // return from a chase: steer to J(u - L), then travel J forward to u = f(scroll), re-forming the pose
    function startReturnJ() {
      var uS = clamp(uAtScroll(viewY), uRest, uEnd), uA = Math.max(0, uS - Lbody);
      var o = jAt(uA, jTmp), tx = o[0], ty = o[1], i0 = o[3], i1 = Math.min(jN - 1, i0 + 8);
      var ax = jX[i1] - tx, ay = jY[i1] - ty, al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      var hx = trail.headX(), hy = trail.headY();
      var D = Math.hypot(tx - hx, ty - hy), m = Math.max(D * 0.9, 5 * r);
      var m0x = Math.cos(heading) * m, m0y = Math.sin(heading) * m, m1x = ax * m, m1y = ay * m;
      var nJ = jIndex(uS) - i0 + 2, steps = Math.max(4, Math.min(Math.ceil((D + m) / 1.5) + 8, rX.length - nJ - 8));
      rN = 0;
      for (var i = 0; i <= steps; i++) {
        var t = i / steps, t2 = t * t, t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        routePush(h00 * hx + h10 * m0x + h01 * tx + h11 * m1x, h00 * hy + h10 * m0y + h01 * ty + h11 * m1y, Z_FREE, 0);
      }
      for (i = i0 + 1; i < jN && jC[i] < uS; i++) routePush(jX[i], jY[i], jZ[i], jK[i]);
      o = jAt(uS, jTmp); routePush(o[0], o[1], o[2], jK[o[3]]);
      recomputeRoute();
      vRoute = vCruise * 1.35;
      rq = 0; ri = 0; rv = Math.max(speed, 0.25 * vRoute); routeEndU = uS;
      state = ST_ROUTE; initialWrite = false; restReady = false; chaseLeft = false;
    }
    function arriveJ(u) {
      if (u <= uRest + 0.5) enterRestJ(REST_LOGO);
      else if (u >= uEnd - 0.5) enterRestJ(REST_END);
      else { uJ = u; vJ = 0; uTprev = -1; restAt = 0; state = ST_JOURNEY; restReady = false; }
    }
    // rest cache placed on the resting pose (document dev px); grows if a pose needs more room
    function placeCache() {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, P = poseR, k;
      for (k = 0; k < nSt; k++) { var x = P.x[k], y = P.y[k]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      var mg = 1.9 * rh * dpr;
      x0 = Math.max(0, Math.floor(x0 - mg)); x1 = Math.min(cw, Math.ceil(x1 + mg)); y0 = Math.floor(y0 - mg); y1 = Math.ceil(y1 + mg);
      var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      if (!cacheA || cacheA.width < w || cacheA.height < h) {
        var nw = Math.max(w, cacheA ? cacheA.width : 0), nh = Math.max(h, cacheA ? cacheA.height : 0);
        cacheA = canvasEl(nw, nh); cacheB = canvasEl(nw, nh); warmCanvas(cacheA); warmCanvas(cacheB);
      }
      cacheX = x0; cacheY = y0; gridOY = y0;
    }
    function restDims(u) {
      var a = jIndex(Math.max(0, u - Lbody)), b = Math.min(jN - 1, jIndex(u) + 1), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var i = a; i <= b; i++) { if (jX[i] < x0) x0 = jX[i]; if (jX[i] > x1) x1 = jX[i]; if (jY[i] < y0) y0 = jY[i]; if (jY[i] > y1) y1 = jY[i]; }
      var mg = 1.9 * rh + r;
      return [Math.ceil(Math.min(W, x1 - x0 + 2 * mg) * dpr), Math.ceil((y1 - y0 + 2 * mg) * dpr)];
    }
    // reduced motion: the static logo scrolls with the page (blitted from its cache)
    function blitStatic() {
      if (!cacheA || state !== ST_STATIC) return;
      viewY = scrollCache; oyDev = Math.round(viewY * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, cw, ch); dirty = null;
      if (cacheY - oyDev < ch && cacheY + cacheA.height - oyDev > 0) ctx.drawImage(cacheA, cacheX, cacheY - oyDev);
    }

    function layout(force) {
      if (jm) { layoutJ(force); return; }
      pendingLayout = 0;
      if (destroyed) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (w < 2 || h < 2) { sized = false; stop(); return; }
      var d = Math.min(window.devicePixelRatio || 1, 2);
      if (!force && sized && w === W && h === H && d === dprRaw) return;
      // waiting briefly for the fur photo keeps the first frames free of a sprite rebuild
      if (!bank && FUR.state === 'loading' && now() - mountT < 800) {
        if (!furWaitTimer) furWaitTimer = setTimeout(function () { furWaitTimer = 0; layout(true); }, 820 - (now() - mountT));
        return;
      }
      if (furWaitTimer) { clearTimeout(furWaitTimer); furWaitTimer = 0; }
      var oldBox = { x: box.x, y: box.y, h: box.h }, oldW = W, oldH = H, wasSized = sized;
      W = w; H = h; dprRaw = d;
      if (mode === 'logo') { box = logoBox(W, H); r = THICK * 0.5 * box.h; }
      else {
        var vb = logoBox(window.innerWidth || W, window.innerHeight || H);
        r = clamp(THICK * 0.5 * vb.h * 0.7, 7, Math.max(7, H * 0.1));
      }
      rh = r * HEAD;
      dpr = devScale(dprRaw, window.innerWidth || W, r);
      cw = Math.max(1, Math.round(W * dpr)); ch = Math.max(1, Math.round(H * dpr));
      canvas.width = cw; canvas.height = ch; dirty = [0, 0, 0, 0];
      rDev = r * dpr;
      if (!bank || Math.abs(bank.R - rDev) > 0.25 || bank.fur !== FUR.dev) {
        if (!job || job.bank.R !== rDev || job.bank.fur !== FUR.dev) job = bankJob(rDev, FUR.dev);
      }
      if (mode === 'logo') buildLogoGeometry();
      else Lbody = clamp(22 * 2 * r, 260, 1.3 * W + H);
      buildBodyTables();
      if (mode === 'logo') placeSeams();
      buildRouteBuffers();
      sizeCaches();
      if (job && (reduced || !window.requestAnimationFrame)) finishJob(Infinity);   // static render needs it now
      bankScale = bank ? rDev / bank.R : 1;
      sizeGrid();
      sized = true;
      writeVars();

      if (reduced) { renderStatic(); return; }

      if (mode === 'logo') {
        if (!wasSized || state === ST_BOOT) startWriting();
        else {
          // keep whatever is happening: map old coordinates into the new box
          var sc = box.h / (oldBox.h || box.h);
          var fx = function (x) { return box.x + (x - oldBox.x) * sc; }, fy = function (y) { return box.y + (y - oldBox.y) * sc; };
          trail.remap(fx, fy);
          vCruise *= sc; vRoute *= sc;
          if (state === ST_ROUTE) {
            for (var i = 0; i < rN; i++) { rX[i] = fx(rX[i]); rY[i] = fy(rY[i]); }
            recomputeRoute(); rq *= sc; rv *= sc;
            if (rq > rQ) rq = rQ;
            ri = 0; while (ri < rN - 1 && rC[ri + 1] <= rq) ri++;
          } else if (state === ST_REST) { snapRest(); }
          else if (state === ST_CHASE) { chaseX = fx(chaseX); chaseY = fy(chaseY); speed *= sc; }
        }
      } else {
        if (!wasSized || state === ST_BOOT) startWander();
        else {
          var sx = W / (oldW || W), sy = H / (oldH || H);
          trail.remap(function (x) { return x * sx; }, function (y) { return y * sy; });
        }
      }
      kick();
    }
    // Rest cache: only as big as the resting "ae" (+ fuzz / shadow margin), not the whole canvas.
    function sizeCaches() {
      var x0 = 0, y0 = 0, x1 = cw, y1 = ch;
      if (jm) { // one pair big enough for both resting poses (logo, coil); placed per rest
        var a = restDims(uRest), b = restDims(uEnd), nw = Math.max(a[0], b[0]), nh = Math.max(a[1], b[1]);
        if (cacheA && cacheA.width >= nw && cacheA.height >= nh) return;
        cacheA = canvasEl(nw, nh); cacheB = canvasEl(nw, nh); restReady = false;
        if (job) job.tasks.push(function () { warmCanvas(cacheA); warmCanvas(cacheB); });
        else { warmCanvas(cacheA); warmCanvas(cacheB); }
        return;
      }
      if (mode === 'logo') {
        var m = 1.9 * rh;
        x0 = Math.max(0, Math.floor((box.x - m) * dpr)); y0 = Math.max(0, Math.floor((box.y - m) * dpr));
        x1 = Math.min(cw, Math.ceil((box.x + box.w + m) * dpr)); y1 = Math.min(ch, Math.ceil((box.y + box.h + m) * dpr));
      }
      cacheX = x0; cacheY = y0;
      cacheA = canvasEl(Math.max(1, x1 - x0), Math.max(1, y1 - y0)); cacheB = canvasEl(Math.max(1, x1 - x0), Math.max(1, y1 - y0)); restReady = false;
      if (job) job.tasks.push(function () { warmCanvas(cacheA); warmCanvas(cacheB); }); // allocate backing stores early
      else { warmCanvas(cacheA); warmCanvas(cacheB); }
    }
    // allocate a cache's backing store and exercise it as a draw source once (first use is slow in software raster)
    function warmCanvas(cv) {
      var g = cv && cv.getContext('2d'); if (!g) return;
      g.fillRect(0, 0, 1, 1); g.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(cv, 0, 0); ctx.clearRect(0, 0, cw, ch);
    }
    function finishJob(budget) {
      if (!job) return true;
      if (!job.step(budget)) return false;
      bank = job.bank; job = null; api.stats.bankMs = bank.ms; restReady = false; bankScale = 1;
      return true;
    }

    function scheduleLayout() {
      if (pendingLayout) return;
      // first layout immediately; later ones debounced (sprite rebuilds are not free)
      if (!sized) { layout(); return; }
      pendingLayout = setTimeout(function () { layout(); }, 120);
    }

    /* ---------------- routes (writing / returning) ---------------- */
    function buildRouteBuffers() { // grow-only; keeps the current route so a resize can remap it
      var cap = (jm ? jN : mode === 'logo' ? pN + eX.length : 0) + Math.ceil(3 * (W + H)) + 64;
      if (rX && rX.length >= cap) return;
      function grow(old, T) { var a = new T(cap); if (old) a.set(old.subarray(0, Math.min(rN, old.length))); return a; }
      rX = grow(rX, Float64Array); rY = grow(rY, Float64Array); rZ = grow(rZ, Uint8Array); rC = grow(rC, Float64Array); rK = grow(rK, Float32Array);
    }
    function routePush(x, y, z, k) {
      if (rN >= rX.length) return;
      if (rN && Math.abs(x - rX[rN - 1]) < 1e-6 && Math.abs(y - rY[rN - 1]) < 1e-6) return;
      rX[rN] = x; rY[rN] = y; rZ[rN] = z; rK[rN] = k; rN++;
    }
    function recomputeRoute() {
      rC[0] = 0;
      for (var i = 1; i < rN; i++) rC[i] = rC[i - 1] + Math.hypot(rX[i] - rX[i - 1], rY[i] - rY[i - 1]);
      rQ = rC[rN - 1];
    }
    function appendPathReversed() { for (var i = pN - 1; i >= 0; i--) routePush(pX[i], pY[i], pZ[i], pK[i]); }

    // speed controller shared by the real follower and the duration solver
    function routeTargetSpeed(vc, i, q) {
      var vt = vc / (1 + 0.8 * rK[i] * r), vb = Math.sqrt(2 * 2.4 * box.h * Math.max(0, rQ - q));
      return vt < vb ? vt : vb;
    }
    function routeAccel(v, vt, dt) { return v < vt ? Math.min(vt, v + 2.5 * box.h * dt) : Math.max(vt, v - 6 * box.h * dt); }
    function solveCruise() { // pick the cruise speed that makes the first writing last WRITE_T seconds
      var lo = 100, hi = 30000, it, floor = 0.04 * box.h;
      for (it = 0; it < 26; it++) {
        var vc = (lo + hi) / 2, q = 0, v = vc, i = 0, t = 0, dt = 1 / 120;
        while (q < rQ && t < 30) {
          v = routeAccel(v, routeTargetSpeed(vc, i, q), dt);
          q += Math.max(v, floor) * dt; t += dt;
          while (i < rN - 1 && rC[i + 1] <= q) i++;
        }
        if (t > WRITE_T) lo = vc; else hi = vc;
      }
      return (lo + hi) / 2;
    }

    function startWriting() {
      // trail: an off-screen run-up behind the entry point so the whole body starts beyond the edge
      trail.reset();
      var n = eX.length, ex = eX[n - 1], ey = eY[n - 1];
      var dx = ex - eX[Math.max(0, n - 6)], dy = ey - eY[Math.max(0, n - 6)], dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      for (var s = Lbody + 10 * r; s > 0; s -= 3) trail.push(ex + dx * s, ey + dy * s, 0);
      rN = 0;
      for (var i = n - 1; i >= 0; i--) routePush(eX[i], eY[i], 0, 0);
      appendPathReversed();
      recomputeRoute();
      vCruise = vRoute = solveCruise();
      rq = 0; ri = 0; rv = vCruise;
      trail.push(rX[0], rY[0], rZ[0]);
      state = ST_ROUTE; initialWrite = true; restReady = false; restAt = 0; uJ = uRest; vJ = 0;
      warmFrames = 0; warmT0 = now();
    }

    function startReturn() {
      // Hermite curve from the head (current heading) to the tail tip, arriving along the path
      var hx = trail.headX(), hy = trail.headY(), tx = pX[pN - 1], ty = pY[pN - 1];
      var ax = pX[pN - 8] - tx, ay = pY[pN - 8] - ty, al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      var D = Math.hypot(tx - hx, ty - hy), m = Math.max(D * 1.15, 5 * r);
      var m0x = Math.cos(heading) * m, m0y = Math.sin(heading) * m, m1x = ax * m, m1y = ay * m;
      var steps = Math.min(Math.ceil((D + m) / 1.5) + 8, rX.length - pN - 8);
      rN = 0;
      for (var i = 0; i <= steps; i++) {
        var t = i / steps, t2 = t * t, t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        routePush(h00 * hx + h10 * m0x + h01 * tx + h11 * m1x, h00 * hy + h10 * m0y + h01 * ty + h11 * m1y, Z_FREE, 0);
      }
      appendPathReversed();
      recomputeRoute();
      vRoute = vCruise;
      rq = 0; ri = 0; rv = Math.max(speed, 0.2 * vCruise);
      state = ST_ROUTE; initialWrite = false; restReady = false; chaseLeft = false;
    }

    function stepRoute(dt) { // returns true when the head reaches the rest point
      rv = routeAccel(rv, routeTargetSpeed(vRoute, ri, rq), dt);
      rq += Math.max(rv, 0.04 * box.h) * dt;
      if (rq > rQ) rq = rQ;
      while (ri < rN - 1 && rC[ri + 1] <= rq) { ri++; trail.push(rX[ri], rY[ri], rZ[ri]); }
      if (rq >= rQ || ri >= rN - 1) return true;
      var t = (rq - rC[ri]) / Math.max(1e-6, rC[ri + 1] - rC[ri]);
      trail.push(rX[ri] + (rX[ri + 1] - rX[ri]) * t, rY[ri] + (rY[ri + 1] - rY[ri]) * t, rZ[ri]);
      return false;
    }

    // rest pose = head at the path start, body exactly on the path, tail on its extension
    function buildRestTrail() {
      if (jm) { fillTrailJ(restAt === REST_END ? uEnd : uRest); return; }
      trail.reset();
      for (var i = eX.length - 1; i > 0; i--) trail.push(eX[i], eY[i], 0);
      for (i = pN - 1; i >= 0; i--) trail.push(pX[i], pY[i], pZ[i]);
    }

    /* ---------------- free motion (chase / wander) ---------------- */
    function steer(dt, tx, ty, vMax, omega, minR, amp, wave) {
      var hx = trail.headX(), hy = trail.headY(), w = 2 * r;
      var dist = Math.hypot(tx - hx, ty - hy);
      var vt = vMax * clamp(dist / (3 * w), 0.22, 1);
      speed += (vt - speed) * (1 - Math.exp(-dt * 3));
      var total = speed * dt, nSub = Math.max(1, Math.ceil(total / (0.22 * r))), ds = total / nSub;
      var turnMax = Math.min(omega, speed / (minR * w)) * dt / nSub;
      var a = amp * clamp(speed / vMax * 1.4, 0.25, 1);
      for (var i = 0; i < nSub; i++) {
        var want = Math.atan2(ty - hy, tx - hx);
        heading += clamp(wrapA(want - heading), -turnMax, turnMax);
        undPhase += ds / (wave * w) * TAU;
        var mv = heading + a * Math.sin(undPhase);
        hx += Math.cos(mv) * ds; hy += Math.sin(mv) * ds;
        trail.push(hx, hy, Z_FREE);
      }
    }

    function startChase(x, y) {
      if (mode !== 'logo' || reduced || !sized || destroyed) return;
      if (state === ST_ROUTE && initialWrite) return;     // let the first writing finish
      if (state !== ST_REST && state !== ST_ROUTE && state !== ST_CHASE && state !== ST_JOURNEY) return;
      if (jm) { x = clamp(x, 0.6 * rh, W - 0.6 * rh); y = clamp(y, zoneTop + rh, zoneBot - rh); }
      chaseX = x; chaseY = y; lastChaseMove = clock; chaseLeft = false;
      if (state !== ST_CHASE) {
        if (jm) {
          if (state === ST_JOURNEY) fillTrailJ(uJ);
          else if (state === ST_REST) leaveRestJ();
        }
        heading = headAng;
        speed = state === ST_ROUTE ? rv : jm && state === ST_JOURNEY ? clamp(Math.abs(vJ), 0.18 * box.h, 1.5 * box.h) : 0.12 * 1.5 * box.h;
        state = ST_CHASE; restReady = false;
        flick();
        emit(canvas, 'snake:chase');
      }
      kick();
    }

    function startWander() {
      trail.reset();
      var y0 = H * 0.55;
      for (var s = Lbody + 10 * r; s >= 0; s -= 3) trail.push(-rh * 1.6 - s, y0 + Math.sin(s / (5 * r)) * r, Z_FREE);
      heading = 0; speed = 2.5 * r; state = ST_WANDER;
    }
    function wanderTarget(o) {
      var w = 2 * r, mx = Math.min(W * 0.45, 1.6 * w + rh), my = Math.min(H * 0.45, 1.3 * w + rh * 0.5);
      o[0] = W * 0.5 + (W * 0.5 - mx) * Math.sin(clock * 0.19 + 0.4);
      o[1] = H * 0.5 + (H * 0.5 - my) * Math.sin(clock * 0.31 + 1.7);
    }

    /* ---------------- pose sampling ---------------- */
    function samplePose(P) {
      var T = trail, m = T.mask, last = T.n - 1, first = Math.max(0, T.n - T.cap), j = last, hc = T.c[last & m];
      if (T.n < 2) return false;
      for (var k = 0; k < nSt; k++) {
        var target = hc - stS[k];
        while (j > first + 1 && T.c[(j - 1) & m] > target) j--;
        var a = (j - 1) & m, b = j & m, ca = T.c[a], cb = T.c[b];
        var t = cb > ca ? (target - ca) / (cb - ca) : 0;  // t < 0 extrapolates if the trail is short
        P.x[k] = (T.x[a] + (T.x[b] - T.x[a]) * t) * dpr;
        P.y[k] = (T.y[a] + (T.y[b] - T.y[a]) * t) * dpr;
        P.z[k] = t < 0.5 ? T.z[a] : T.z[b];
      }
      P.hx = T.x[last & m] * dpr; P.hy = T.y[last & m] * dpr;
      P.ha = Math.atan2(P.hy - P.y[kHead], P.hx - P.x[kHead]);
      return true;
    }
    // Head/neck look deformation: translate the head toward the pointer, fading along the neck.
    function applyLook(P, src) {
      var dx = lookDX * dpr, dy = lookDY * dpr;
      for (var k = 0; k < nSt && stS[k] < sMaxLook; k++) {
        var w = smooth(0, 1, 1 - stS[k] / sMaxLook);
        P.x[k] = src.x[k] + dx * w; P.y[k] = src.y[k] + dy * w;
      }
      P.hx = src.hx + dx; P.hy = src.hy + dy;
      P.ha = src.ha + lookA;
    }
    function tangents(P, from, to) {
      for (var k = from; k < to; k++) {
        var ax, ay, bx, by;
        if (k > 0) { ax = P.x[k - 1]; ay = P.y[k - 1]; } else { ax = P.hx; ay = P.hy; }
        if (k < nSt - 1) { bx = P.x[k + 1]; by = P.y[k + 1]; } else { bx = P.x[k]; by = P.y[k]; }
        var an = Math.atan2(ay - by, ax - bx);
        if (an < 0) an += PI; if (an >= PI) an -= PI;
        var b = (an / PI * NB + stDith[k]) | 0;
        P.bk[k] = b >= NB ? b - NB : b;
      }
    }

    /* ---------------- draw plan (layer-sorted runs, occlusion shadows) ---------------- */
    function op(PL, kind, i, a) { var n = PL.n; PL.k[n] = kind; PL.i[n] = i; PL.a[n] = a; PL.n = n + 1; }
    // Seams follow the live pose: a layer boundary whose tail side is on top must start in plain pink. While the
    // bands slide past fixed layer tags (writing, returning, chasing) the boundary moves to the nearest such stamp,
    // at most ~2.2r away and never across another boundary.
    function reseat(P, kFrom) {
      var n = nSt, lim = 2.2 * r, k, j, a, b, zH, zT, stepA, stepB;
      for (k = Math.max(1, kFrom + 1); k < n; k++) {
        zH = P.z[k - 1]; zT = P.z[k];
        if (!(zT > zH) || seamOK[k]) continue;
        a = b = k;
        for (;;) {
          stepA = a + 1 < n && P.z[a + 1] === zT && stS[a + 1] - stS[k] <= lim;
          if (stepA && seamOK[++a]) { for (j = k; j < a; j++) P.z[j] = zH; k = a; break; }
          stepB = b - 1 > kFrom && P.z[b - 2] === zH && stS[k] - stS[b - 1] <= lim;
          if (stepB && seamOK[--b]) { for (j = b; j < k; j++) P.z[j] = zT; break; }
          if (!stepA && !stepB) break;
        }
      }
    }
    function buildPlan(PL, P, kFrom, withHead) {
      var n = nSt, nr = 0, k, i, j, z;
      PL.n = 0;
      reseat(P, kFrom);
      k = n - 1;
      while (k >= kFrom && nr < runA.length) { z = P.z[k]; runA[nr] = k; while (k >= kFrom && P.z[k] === z) k--; runB[nr] = k + 1; runZ[nr] = z; nr++; }
      for (i = 1; i < nr; i++) { // stable insertion sort by layer
        var ra = runA[i], rb = runB[i], rz = runZ[i]; j = i - 1;
        while (j >= 0 && runZ[j] > rz) { runA[j + 1] = runA[j]; runB[j + 1] = runB[j]; runZ[j + 1] = runZ[j]; j--; }
        runA[j + 1] = ra; runB[j + 1] = rb; runZ[j + 1] = rz;
      }
      var rk = 0;
      for (i = 0; i < nr; i++) for (k = runA[i]; k >= runB[i]; k--) rank[k] = rk++;
      for (k = 0; k < kFrom; k++) rank[k] = 1e9;
      overness(P, kFrom);
      for (k = n - 1; k >= 0; k -= shStep) op(PL, OP_FLOOR, k, 0);
      op(PL, OP_HEADSH, 0, 0);
      for (i = 0; i < nr; i++) {
        var A = runA[i], B = runB[i];
        // seam: this run lies over its head-side neighbour (drawn earlier) -> fade its head end in
        var seam = B > kFrom && rank[B - 1] < rank[B];
        if (A === n - 1) op(PL, OP_CAP, n - 1, 0);
        k = A;
        while (k >= B) {
          var e = Math.max(B, k - chunkN + 1);
          for (j = k; j >= e; j--) if (j % ovStep === 0 && ov[j] > 0.02) op(PL, OP_OCCL, j, ov[j] * (seam ? smooth(0.6 * r, 2.2 * r, stS[j] - stS[B]) : 1));
          for (j = k; j >= e; j--) op(PL, OP_BODY, j, seam ? smooth(0, 1.5 * r, stS[j] - stS[B]) : 1);
          k = e - 1;
        }
        if (withHead && B === 0) op(PL, OP_HEAD, 0, 0);
      }
    }
    // For every (sub-sampled) stamp: how much it overlaps body drawn beneath it (not its own neighbours).
    function overness(P, kFrom) {
      var n = nSt, cell = gridCell, k, j, k0 = Math.ceil(kFrom / ovStep) * ovStep, minDs = 4.5 * r;
      cellHead.fill(-1);
      for (k = k0; k < n; k += ovStep) {
        ov[k] = 0;
        var cx = Math.floor(P.x[k] / cell), cy = Math.floor((P.y[k] - gridOY) / cell);
        if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) { gcell[k] = -1; continue; }
        var ci = cy * gridW + cx; gnext[k] = cellHead[ci]; cellHead[ci] = k; gcell[k] = ci;
      }
      for (k = k0; k < n; k += ovStep) {
        if (gcell[k] < 0) continue;
        var gx0 = Math.floor(P.x[k] / cell), gy0 = Math.floor((P.y[k] - gridOY) / cell), best = 0, rkk = rank[k], xk = P.x[k], yk = P.y[k], rr = rDev * stF[k], sk = stS[k];
        for (var gy = gy0 - 1; gy <= gy0 + 1; gy++) {
          if (gy < 0 || gy >= gridH) continue;
          for (var gx = gx0 - 1; gx <= gx0 + 1; gx++) {
            if (gx < 0 || gx >= gridW) continue;
            for (j = cellHead[gy * gridW + gx]; j >= 0; j = gnext[j]) {
              if (rank[j] >= rkk) continue;
              var dsj = stS[j] - sk; if (dsj < minDs && dsj > -minDs) continue;
              var lim = 0.92 * (rr + rDev * stF[j]), ddx = P.x[j] - xk, ddy = P.y[j] - yk, d2 = ddx * ddx + ddy * ddy;
              if (d2 < lim * lim) { var o = 1 - Math.sqrt(d2) / lim; if (o > best) best = o; }
            }
          }
        }
        ov[k] = best;
      }
    }

    /* ---------------- drawing primitives ---------------- */
    function blobIndex(f) { var b = 0, bd = 9; for (var i = 0; i < BLOB.length; i++) { var d = Math.abs(BLOB[i] - f); if (d < bd) { bd = d; b = i; } } return b; }
    function drawBlob(c, set, x, y, f, alpha) {
      var s = set[blobIndex(f * bankScale)];
      if (c.globalAlpha !== alpha) c.globalAlpha = alpha;
      c.drawImage(s, Math.round(x - s.width * 0.5), Math.round(y - s.height * 0.5));
    }
    function drawStamp(c, P, k, breath) {
      var f = stF[k] * breath * bankScale, kind = stCol[k], spr, sc;
      if (f >= 0.62) { spr = bank.big[kind][stVar[k] % bank.big[kind].length][P.bk[k]]; sc = f; }
      else { spr = bank.small[kind][stVar[k] % bank.small[kind].length][P.bk[k]]; sc = f / SMALL; }
      var w2 = spr.width * 0.5, h2 = spr.height * 0.5;
      if (sc > 0.996 && sc < 1.004) c.drawImage(spr, Math.round(P.x[k] - w2 + stJx[k]), Math.round(P.y[k] - h2 + stJy[k]));
      else c.drawImage(spr, P.x[k] - w2 * sc, P.y[k] - h2 * sc, w2 * 2 * sc, h2 * 2 * sc);
    }
    var FLOOR_A = 0.12;
    function execPlan(c, PL, P, from, to, breath) {
      var R = rDev, cy0 = c === ctx ? cullY0 : -1e9, cy1 = c === ctx ? cullY1 : 1e9;
      for (var i = from; i < to; i++) {
        var k = PL.i[i], kind = PL.k[i], f;
        if ((kind >= OP_HEAD ? P.hy : P.y[k]) < cy0 || (kind >= OP_HEAD ? P.hy : P.y[k]) > cy1) continue;
        if (kind === OP_BODY) {
          f = PL.a[i]; if (f < 0.01) continue;
          if (c.globalAlpha !== f) c.globalAlpha = f;
          drawStamp(c, P, k, breath);
        } else if (kind === OP_FLOOR) {
          f = stF[k] * breath; drawBlob(c, bank.floor, P.x[k] + 0.1 * R * f, P.y[k] + 0.46 * R * f, f, FLOOR_A);
        } else if (kind === OP_OCCL) {
          if (PL.a[i] < 0.01) continue;
          f = stF[k] * breath; drawBlob(c, bank.occl, P.x[k] + 0.08 * R * f, P.y[k] + 0.4 * R * f, f, Math.min(1, PL.a[i] * 2.4) * 0.42);
        } else if (kind === OP_CAP) {
          c.globalAlpha = 1;
          var cs = bank.cap, sc = breath * bankScale;
          c.drawImage(cs, P.x[k] - cs.width * 0.5 * sc, P.y[k] - cs.height * 0.5 * sc, cs.width * sc, cs.height * sc);
        } else if (kind === OP_HEADSH) {
          var hs = bank.headShadow; c.globalAlpha = 0.13;
          c.drawImage(hs, Math.round(P.hx + Math.cos(P.ha) * 0.2 * R * HEAD + 0.1 * R - hs.width * 0.5), Math.round(P.hy + 0.5 * R - hs.height * 0.5));
        } else if (kind === OP_HEAD) {
          c.globalAlpha = 1;
          drawHead(c, P.hx, P.hy, P.ha, headState.tongue, headState.breath);
        }
      }
      c.globalAlpha = 1;
    }

    // tongue: two thin prongs, pale pink with a deeper edge, flicking from the snout tip
    function drawTongue(c, ext, up) {
      var R = rDev * HEAD, len = R * 1.05 * ext, down = -up;
      var bx = R * 1.3, by = down * R * 0.1, ang = down * 0.28 + Math.sin(clock * 31) * 0.05 * ext;
      var ca = Math.cos(ang), sa = Math.sin(ang), fx = bx + ca * len * 0.68, fy = by + sa * len * 0.68;
      var wv = Math.sin(clock * 47) * 0.06 * R * ext, mx = bx + ca * len * 0.36 - sa * wv, my = by + sa * len * 0.36 + ca * wv;
      var spread = 0.3 + Math.sin(clock * 53) * 0.07, pl = len * 0.36;
      var a1 = ang - spread, a2 = ang + spread;
      var lw = Math.max(1.2 * dpr, R * 0.075);
      for (var pass = 0; pass < 2; pass++) {
        c.lineWidth = pass ? lw : lw + 1.4 * dpr;
        c.strokeStyle = pass ? '#F2B9C6' : '#E58AA0';
        c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(mx, my, fx, fy);
        c.lineTo(fx + Math.cos(a1) * pl, fy + Math.sin(a1) * pl);
        c.moveTo(fx, fy); c.lineTo(fx + Math.cos(a2) * pl, fy + Math.sin(a2) * pl);
        c.stroke();
      }
    }
    function drawHead(c, x, y, ang, tongue, breath) {
      var hs = getHead(bank, ang), co = Math.cos(ang), si = Math.sin(ang), k = (1 + (breath - 1) * 0.5) * bankScale;
      var up = co < 0 ? 1 : -1;                     // local y sign that points up on screen
      c.setTransform(co * k, si * k, -si * k, co * k, x + baseX, y + baseY);
      c.lineCap = 'round'; c.lineJoin = 'round';
      if (tongue > 0.01) drawTongue(c, tongue, up);
      c.drawImage(hs.c, -hs.ox, -hs.oy);
      c.setTransform(1, 0, 0, 1, baseX, baseY);
      // eyes: one bead on the upper side; the second appears when the head points up/down (faces us)
      var R = rDev * HEAD, e = bank.eye, two = smooth(0.42, 0.12, Math.abs(co));
      for (var s = 0; s < 2; s++) {
        var a = s ? two : 1; if (a < 0.02) continue;
        var ly = (s ? -up : up) * 0.4 * R + eyeY * R, lx = 0.3 * R + eyeX * R;
        var ex = x + (co * lx - si * ly) * k, ey = y + (si * lx + co * ly) * k;
        c.globalAlpha = a;
        c.drawImage(e, Math.round(ex - e.width * 0.5), Math.round(ey - e.height * 0.5));
      }
      c.globalAlpha = 1;
      headCX = x / dpr; headCY = y / dpr; headAng = ang;
    }

    /* ---------------- render paths ---------------- */
    // Clears only what the previous frame drew (the canvas is viewport-sized; a full clear re-rasterises all of it).
    function clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (!dirty || debug) ctx.clearRect(0, 0, cw, ch);
      else if (dirty[2] > dirty[0] && dirty[3] > dirty[1]) ctx.clearRect(dirty[0], dirty[1], dirty[2] - dirty[0], dirty[3] - dirty[1]);
      dirty = null;   // unknown until the caller records what it drew (markDrawn)
      if (jm) { // world = document: draw with an offset of -scrollY; skip stamps outside the viewport
        baseX = 0; baseY = -oyDev; ctx.setTransform(1, 0, 0, 1, 0, baseY);
        var pad = 2.6 * rDev * HEAD; cullY0 = oyDev - pad; cullY1 = oyDev + ch + pad; drawn = true;
      }
    }
    // device-px box (canvas coords) of a pose drawn this frame, padded for the head, tongue, fuzz and shadows
    function markDrawn(P) {
      var x0 = P.hx, x1 = P.hx, y0 = P.hy, y1 = P.hy, k, x, y;
      for (k = 0; k < nSt; k++) {
        x = P.x[k]; y = P.y[k];
        if (x < x0) x0 = x; else if (x > x1) x1 = x;
        if (y < y0) y0 = y; else if (y > y1) y1 = y;
      }
      var pad = 3.4 * rDev * HEAD * Math.max(1, bankScale) + 2, oy = jm ? oyDev : 0;
      dirty = [Math.max(0, Math.floor(x0 - pad)), Math.max(0, Math.floor(y0 - oy - pad)),
               Math.min(cw, Math.ceil(x1 + pad)), Math.min(ch, Math.ceil(y1 - oy + pad))];
    }
    function lookingNow() { return Math.abs(lookA) > 0.002 || Math.abs(lookDX) > 0.05 || Math.abs(lookDY) > 0.05; }

    function renderMoving() {
      if (!samplePose(poseR)) return;
      var P = poseR;
      if (lookingNow()) { copyPose(poseF, poseR); applyLook(poseF, poseR); P = poseF; }
      tangents(P, 0, nSt);
      if (jm) gridOY = oyDev - 0.3 * ch;
      buildPlan(planF, P, 0, true);
      headState.breath = 1;
      clear();
      execPlan(ctx, planF, P, 0, planF.n, 1);
      markDrawn(P);
    }
    function copyPose(D, S) { D.x.set(S.x); D.y.set(S.y); D.z.set(S.z); D.bk.set(S.bk); D.hx = S.hx; D.hy = S.hy; D.ha = S.ha; }

    function enterRest() {
      if (jm && !restAt) restAt = REST_LOGO;
      buildRestTrail();
      samplePose(poseR); tangents(poseR, 0, nSt);
      if (jm) placeCache();
      // live part = head + neck, as long as nothing drawn later overlaps it
      buildPlan(planR, poseR, 0, false);
      var margin = 0.35 * rh * dpr, k, j, hit = -1;
      kLive = 0;
      for (k = 0; k < nSt && stS[k] < sLookMax; k++) {
        var conflict = false, rk = rDev * stF[k];
        for (j = 0; j < nSt && !conflict; j += 2) {
          if (rank[j] <= rank[k] || Math.abs(stS[j] - stS[k]) < 4 * r) continue;
          var dx = poseR.x[j] - poseR.x[k], dy = poseR.y[j] - poseR.y[k], lim = 1.05 * (rk + rDev * stF[j]) + margin;
          if (dx * dx + dy * dy < lim * lim) conflict = true;
        }
        if (conflict) { hit = k; break; }
        kLive = k + 1;
      }
      // keep the live/cached joint ~2 radii clear of any conflict
      if (hit >= 0) while (kLive > 0 && stS[kLive - 1] > stS[hit] - 2 * r) kLive--;
      sMaxLook = Math.max(stS[Math.max(0, kLive - 1)], 1);
      buildPlan(planR, poseR, kLive, false);
      copyPose(poseL, poseR);
      restT0 = clock;
      // the first cache image is built progressively too; until then the pose is drawn directly
      restReady = true; cacheReady = false; startCacheRebuild();
      state = ST_REST;
    }
    function snapRest() { enterRest(); }
    function breathNow() { return 1 + 0.03 * Math.sin(Math.max(0, clock - restT0) * TAU / 4.6); }
    function startCacheRebuild() {
      var g = cacheB.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, cacheB.width, cacheB.height);
      g.setTransform(1, 0, 0, 1, -cacheX, -cacheY);
      cacheCursor = 0; cacheBreath = breathNow();
    }
    function stepCache() { // progressive rebuild of the resting body so it can breathe
      var per = Math.ceil(planR.n / 9), g = cacheB.getContext('2d'), to = Math.min(planR.n, cacheCursor + per);
      execPlan(g, planR, poseR, cacheCursor, to, cacheBreath);
      cacheCursor = to;
      if (cacheCursor >= planR.n) { var t = cacheA; cacheA = cacheB; cacheB = t; cacheReady = true; startCacheRebuild(); }
    }
    function renderRest() {
      if (!restReady) enterRest();
      var b = breathNow();
      applyLook(poseL, poseR);
      tangents(poseL, 0, Math.min(nSt, kLive + 1));
      clear();
      if (!cacheReady) {            // first ~150 ms of rest: direct render while the cache builds
        stepCache();
        if (jm) gridOY = cacheY;
        buildPlan(planF, poseL, 0, true);
        headState.breath = b;
        execPlan(ctx, planF, poseL, 0, planF.n, 1);
        markDrawn(poseL);
        return;
      }
      ctx.drawImage(cacheA, cacheX, cacheY);
      stepCache();
      for (var k = kLive - 1; k >= 0; k--) drawStamp(ctx, poseL, k, b);
      ctx.globalAlpha = 1;
      drawHead(ctx, poseL.hx, poseL.hy, poseL.ha, headState.tongue, b);
      markDrawn(poseL);
    }

    function renderStatic() {
      state = ST_STATIC;
      if (jm) { // the "ae" in the hero only, rendered once into the cache and blitted at the scroll offset
        restAt = REST_LOGO; buildRestTrail();
        if (!samplePose(poseR)) return;
        tangents(poseR, 0, nSt); placeCache();
        buildPlan(planF, poseR, 0, true);
        headState.tongue = 0.85; headState.breath = 1;
        var g = cacheA.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, cacheA.width, cacheA.height);
        g.setTransform(1, 0, 0, 1, -cacheX, -cacheY); baseX = -cacheX; baseY = -cacheY;
        execPlan(g, planF, poseR, 0, planF.n, 1);
        g.setTransform(1, 0, 0, 1, 0, 0); baseX = baseY = 0;
        blitStatic();
        if (!written) { written = atLogo = true; setTimeout(function () { if (!destroyed) emit(canvas, 'snake:written'); }, 0); }
        return;
      }
      if (mode === 'logo') buildRestTrail();
      else {
        trail.reset();
        for (var s = Lbody; s >= 0; s -= 3) {
          var u = s / Lbody;
          trail.push(W * 0.12 + (W * 0.76) * (1 - u), H * 0.5 + Math.sin(u * TAU * 1.25) * H * 0.18, 0);
        }
      }
      if (!samplePose(poseR)) return;
      tangents(poseR, 0, nSt);
      buildPlan(planF, poseR, 0, true);
      headState.tongue = mode === 'logo' ? 0.85 : 0; headState.breath = 1;
      clear();
      execPlan(ctx, planF, poseR, 0, planF.n, 1);
      markDrawn(poseR);
      if (debug) drawDebug();
      if (mode === 'logo' && !written) { written = true; setTimeout(function () { if (!destroyed) emit(canvas, 'snake:written'); }, 0); }
    }

    function drawDebug() {
      if (jm && jN) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, -oyDev);
        ctx.strokeStyle = 'rgba(30,22,24,.4)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.beginPath();
        for (var j = iRest; j < jN; j += 3) { if (j > iRest) ctx.lineTo(jX[j], jY[j]); else ctx.moveTo(jX[j], jY[j]); }
        ctx.stroke(); ctx.setLineDash([]);
        var o = jAt(uAtScroll(viewY), jTmp);
        ctx.fillStyle = 'rgba(229,48,74,.8)'; ctx.beginPath(); ctx.arc(o[0], o[1], 5, 0, TAU); ctx.fill();
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.setTransform(1, 0, 0, 1, 0, baseY);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(30,22,24,.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      if (mode === 'logo') { ctx.strokeRect(box.x, box.y, box.w, box.h); }
      ctx.setLineDash([]);
      if (mode === 'logo') {
        ctx.strokeStyle = 'rgba(30,22,24,.25)'; ctx.beginPath();
        for (var i = 0; i < pN; i += 3) { if (i) ctx.lineTo(pX[i], pY[i]); else ctx.moveTo(pX[i], pY[i]); }
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ---------------- update ---------------- */
    function flick() { if (tongueT < 0) tongueT = 0; }
    function tongueEnv(t) { // two quick flicks
      function p(x) { return x > 0 && x < 1 ? Math.pow(Math.sin(PI * x), 0.7) : 0; }
      return p(t / 0.24) + p((t - 0.32) / 0.24);
    }
    function updatePointer() {
      if (jm) { ptr.x = ptr.cx; ptr.y = ptr.cy + viewY; ptr.dirty = false; return; }  // fixed canvas at the viewport origin
      if (!ptr.dirty && !ptr.inside) return;
      var rc = canvas.getBoundingClientRect();
      ptr.x = ptr.cx - rc.left; ptr.y = ptr.cy - rc.top; ptr.dirty = false;
    }
    function update(dt) {
      clock += dt; bobT += dt;
      updatePointer();
      var pointerActive = ptr.inside && (clock - ptr.t < 8);
      // tongue flicks: every 3-6 s, and when the pointer comes close to the head
      if (tongueT >= 0) { tongueT += dt; if (tongueT > 0.58) { tongueT = -1; lastFlickEnd = clock; } }
      if (tongueT < 0 && clock > nextFlick && state !== ST_ROUTE) { flick(); nextFlick = clock + 3 + Math.random() * 3; }
      if (tongueT < 0 && pointerActive && clock - lastFlickEnd > 1.2 && Math.hypot(ptr.x - headCX, ptr.y - headCY) < 120) { flick(); nextFlick = clock + 3 + Math.random() * 3; }
      headState.tongue = tongueT >= 0 ? tongueEnv(tongueT) : 0;

      // look-at (rest only), decays to neutral otherwise
      var tA = 0, tX = 0, tY = 0, eX2 = 0, eY2 = 0;
      if (state === ST_REST) { // idle: gentle head bob
        tY = Math.sin(bobT * TAU / 3.4) * 0.06 * rh; tA = Math.sin(bobT * TAU / 3.4 + 0.9) * 0.03;
      }
      // look target: the pointer; coiled at the gauge with no pointer around -> the readout
      var lkX = NaN, lkY = NaN, lkMax = 0.5;
      if (state === ST_REST && poseR) {
        if (pointerActive && (!jm || Math.abs(ptr.y - poseR.hy / dpr) < 1.2 * Hview)) { lkX = ptr.x; lkY = ptr.y; }
        else if (jm && restAt === REST_END && gaugeC) { lkX = gaugeC.x; lkY = gaugeC.y + gaugeC.r * 0.15; lkMax = 0.55; }
      }
      if (lkX === lkX) {
        var hx = poseR.hx / dpr, hy = poseR.hy / dpr, dx = lkX - hx, dy = lkY - hy, d = Math.hypot(dx, dy) || 1;
        tA += clamp(wrapA(Math.atan2(dy, dx) - poseR.ha), -lkMax, lkMax) * smooth(0.4 * rh, 3 * rh, d);
        var reach = Math.min(d * 0.05, 0.3 * rh); tX = dx / d * reach; tY += dy / d * reach;
        var la = Math.atan2(dy, dx) - (poseR.ha + lookA); eX2 = Math.cos(la) * 0.04; eY2 = Math.sin(la) * 0.04;
      }
      var kl = 1 - Math.exp(-dt * 4.5);
      lookA += (tA - lookA) * kl; lookDX += (tX - lookDX) * kl; lookDY += (tY - lookDY) * kl;
      eyeX += (eX2 - eyeX) * kl; eyeY += (eY2 - eyeY) * kl;

      if (jm) updateJourney(dt);
      if (state === ST_ROUTE) {
        if (stepRoute(dt)) {
          if (jm && !initialWrite) arriveJ(routeEndU);
          else if (jm) enterRestJ(REST_LOGO);
          else {
            enterRest();
            written = true; lastFlickEnd = clock; tongueT = -1; nextFlick = clock + 0.35;
            emit(canvas, 'snake:written');
          }
        }
      } else if (state === ST_CHASE) {
        if (jm && ptr.type === 'mouse' && ptr.inside && clock - ptr.t < chaseIdle) {   // the page scrolls under a still mouse
          chaseX = clamp(ptr.x, 0.6 * rh, W - 0.6 * rh); chaseY = clamp(ptr.y, zoneTop + rh, zoneBot - rh);
        }
        if (clock - lastChaseMove > chaseIdle || chaseLeft) { if (jm) startReturnJ(); else startReturn(); }
        else steer(dt, chaseX, chaseY, 1.5 * box.h, 4.2, 1.1, 0.38, 4.5);
      } else if (state === ST_WANDER) {
        var tw = wTmp, fast = pointerActive && clock - ptr.t < 3;
        if (fast) { tw[0] = ptr.x; tw[1] = ptr.y; } else wanderTarget(tw);
        steer(dt, tw[0], tw[1], (fast ? 5.5 : 3.2) * 2 * r, 2.6, 1.4, 0.42, 5);
      }
    }

    // journey: scroll target, leaving / reaching the two rests, spring follow
    function updateJourney(dt) {
      var uT = uAtScroll(viewY);
      if (state === ST_ROUTE && initialWrite && clock < 1.5 && uT > uRest + Hview) {   // scroll restored mid-page
        setLogo(true); setLogo(false); placeAt(uT); return;
      }
      if (state === ST_REST && ((restAt === REST_LOGO && uT > uRest + 0.5) || (restAt === REST_END && uT < uEnd - 0.5))) {
        uJ = restAt === REST_END ? uEnd : uRest; vJ = 0; uTprev = -1;
        leaveRestJ(); state = ST_JOURNEY;
      }
      if (state !== ST_JOURNEY) return;
      follow(dt, uT);
      // caught up: snap exactly, so a still page means a still frame (and the loop can idle)
      if (Math.abs(uT - uJ) < 0.3 && Math.abs(vJ) < 3 && Math.abs(vTs) < 3) { uJ = uT; vJ = 0; vTs = 0; }
      if (Math.abs(uT - uJ) < 2 && Math.abs(vJ) < 60) {   // settle: a <2px snap is invisible
        if (uT <= uRest + 0.5) enterRestJ(REST_LOGO);
        else if (uT >= uEnd - 0.5) enterRestJ(REST_END);
      }
    }
    function animatingJ() {
      return state === ST_ROUTE || state === ST_CHASE ||
        (state === ST_JOURNEY && (Math.abs(uAtScroll(viewY) - uJ) > 2 || Math.abs(vJ) > 60));
    }

    /* ---------------- loop ---------------- */
    function shouldRun() { return sized && !reduced && visible && !document.hidden && !userPaused && !destroyed && state !== ST_BOOT && state !== ST_STATIC; }
    function kick() {
      if (idleT) { clearTimeout(idleT); idleT = 0; }
      if (idleAt) { var el = Math.max(0, (now() - idleAt) / 1000); clock += el; bobT += el; idleAt = 0; }   // time went on while idle
      if (!raf && shouldRun()) { lastT = 0; raf = requestAnimationFrame(frame); }
    }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    // journey, nothing on screen changes: stop the loop; scroll / pointer / the next tongue flick restart it
    function goIdle() {
      idleAt = now();
      idleT = setTimeout(function () { idleT = 0; kick(); }, Math.max(50, (nextFlick - clock) * 1000));
    }
    function frame(t) {
      raf = 0;
      if (!shouldRun()) return;
      var raw = lastT ? t - lastT : 99, dt = lastT ? Math.min(0.05, Math.max(0, raw / 1000)) : 1 / 60;
      lastT = t;
      var t0 = now();
      if (job && !finishJob(8) && !bank) { lastT = 0; raf = requestAnimationFrame(frame); return; }
      if (!bank) return;
      // the first writing waits for two smooth frames (start-up work on a slow phone would stretch it)
      if (state === ST_ROUTE && initialWrite && warmFrames < 2) {
        warmFrames = raw < 34 ? warmFrames + 1 : 0;
        if (warmFrames < 2 && now() - warmT0 < 1500) { raf = requestAnimationFrame(frame); return; }
        warmFrames = 2;
      }
      if (jm) {
        viewY = scrollCache; oyDev = Math.round(viewY * dpr);
        inZone = viewY < zoneBot + 40 && viewY + Hview > zoneTop - 40;
      }
      update(dt);
      if (jm && !inZone) {   // off-zone: clear once, keep simulating only while something is still settling
        if (drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); drawn = false; dirty = [0, 0, 0, 0]; drawnKey = ''; }
        if (animatingJ()) raf = requestAnimationFrame(frame);
        return;
      }
      if (state === ST_REST) {
        // calm rest (no pointer near, no tongue): the slow breathing is drawn at half rate; the cache keeps building
        if (cacheReady && tongueT < 0 && !(ptr.inside && clock - ptr.t < 1.2) && (restTick = 1 - restTick)) {
          stepCache(); raf = requestAnimationFrame(frame); return;
        }
        renderRest(); drawnKey = '';
      } else {
        var key = '';
        if (jm && state === ST_JOURNEY) {
          key = uJ + ':' + oyDev;
          if (key === drawnKey && drawn && tongueT < 0 && !lookingNow() && !debug) {   // still frame
            if (animatingJ()) raf = requestAnimationFrame(frame); else goIdle();
            return;
          }
          fillTrailJ(uJ);
        }
        renderMoving();
        drawnKey = tongueT >= 0 || lookingNow() ? '' : key;
      }
      if (debug) drawDebug();
      var ms = now() - t0, st = api.stats;
      st.ms = st.frames ? st.ms * 0.95 + ms * 0.05 : ms; st.frames++; st.last = ms; st.state = state;
      if (jm) { st.u = uJ; st.uRest = uRest; st.uEnd = uEnd; st.restAt = restAt; st.uT = uAtScroll(viewY); st.viewY = viewY; }
      if (!(ms < st.max)) st.max = ms;
      raf = requestAnimationFrame(frame);
    }

    /* ---------------- events ---------------- */
    function setPtr(e) { ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.dirty = true; ptr.inside = true; ptr.t = clock; ptr.type = e.pointerType || 'mouse'; }
    function onMove(e) {
      setPtr(e);
      if (state === ST_CHASE) { updatePointer(); chaseX = ptr.x; chaseY = ptr.y; lastChaseMove = clock; }
    }
    function onDown(e) {
      setPtr(e);
      var el = e.target;
      if (el && el.closest && el.closest(ignoreSel)) return;
      if (e.button > 0) return;
      updatePointer();
      startChase(ptr.x, ptr.y);
    }
    function onLeave(e) {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') return; // touch: timer decides
      ptr.inside = false;
      if (state === ST_CHASE) chaseLeft = true;
    }
    function onCancel() { ptr.inside = false; }
    function onVis() { if (document.hidden) stop(); else kick(); }

    // journey: pointer on the whole document (document coords = client + scroll), never preventDefault
    function onMoveJ(e) {
      setPtr(e);
      if (state === ST_CHASE && ptr.type === 'mouse') {
        chaseX = clamp(e.clientX, 0.6 * rh, W - 0.6 * rh); chaseY = clamp(e.clientY + viewY, zoneTop + rh, zoneBot - rh); lastChaseMove = clock;
      }
    }
    function tryChase(el, cx, cy, touch) {
      if (reduced || !sized) return;
      if (el && el.closest && el.closest(ignoreSel)) return;
      viewY = scrollCache = scrollNow();
      var y = cy + viewY;
      if (y < zoneTop || y > zoneBot) return;
      chaseIdle = touch ? CHASE_IDLE_TOUCH : CHASE_IDLE;
      startChase(cx, y);
    }
    function onDownJ(e) {
      setPtr(e);
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), el: e.target }; return; }
      if (e.button > 0) return;
      tryChase(e.target, e.clientX, e.clientY, false);
    }
    function onUpJ(e) { // touch: a tap (short, still) starts a short chase; a scroll gesture never does
      var t = tap; if (!t || e.pointerId !== t.id) return;
      tap = null;
      if (now() - t.t > 450 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) return;
      tryChase(t.el, e.clientX, e.clientY, true);
    }
    function onCancelJ() { tap = null; if (ptr.type !== 'mouse') ptr.inside = false; }
    function onOutJ(e) { if (!e.relatedTarget && (e.pointerType || 'mouse') === 'mouse') { ptr.inside = false; if (state === ST_CHASE) chaseLeft = true; } }
    function onBlurJ() { ptr.inside = false; tap = null; }
    function onScrollJ() {
      scrollCache = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (reduced) { if (!staticRaf && state === ST_STATIC) staticRaf = requestAnimationFrame(function () { staticRaf = 0; blitStatic(); }); return; }
      kick();
    }
    function onLoadJ() { scheduleLayout(); }

    var ro = null, io = null, pe = { passive: true };
    if (jm) {
      document.addEventListener('pointermove', onMoveJ, pe);
      document.addEventListener('pointerdown', onDownJ, pe);
      document.addEventListener('pointerup', onUpJ, pe);
      document.addEventListener('pointercancel', onCancelJ, pe);
      document.addEventListener('pointerout', onOutJ, pe);
      window.addEventListener('blur', onBlurJ);
      window.addEventListener('scroll', onScrollJ, pe);
      window.addEventListener('resize', scheduleLayout);
      window.addEventListener('load', onLoadJ);
      if (window.ResizeObserver && document.body) { ro = new ResizeObserver(scheduleLayout); ro.observe(document.body); }
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!destroyed) scheduleLayout(); }); } catch (e) { /* no font loading API */ }
    } else {
      target.addEventListener('pointermove', onMove, pe);
      target.addEventListener('pointerdown', onDown, pe);
      target.addEventListener('pointerleave', onLeave, pe);
      target.addEventListener('pointercancel', onCancel, pe);
    }
    document.addEventListener('visibilitychange', onVis);
    if (!jm) {
      if (window.ResizeObserver) { ro = new ResizeObserver(scheduleLayout); ro.observe(canvas); }
      else window.addEventListener('resize', scheduleLayout);
    }
    if (!jm && window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) kick(); else stop();
      }, { rootMargin: '80px' });
      io.observe(canvas);
    }
    function onFur() { if (sized) layout(true); else layout(); }
    FUR.subs.push(onFur);
    loadFur();

    /* ---------------- public API ---------------- */
    api.getLogoBox = getLogoBox;
    api.replay = function () {
      if (destroyed || !sized) return;
      if (reduced) { renderStatic(); return; }
      if (jm) { if (state === ST_REST) leaveRestJ(); setEnd(false); }
      if (mode === 'logo') startWriting(); else startWander();
      kick();
    };
    api.chase = function (x, y) {
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (jm) { viewY = scrollCache = scrollNow(); chaseIdle = CHASE_IDLE; y += viewY; }
      startChase(x, y); kick();
    };
    api.pause = function () { userPaused = true; stop(); };
    api.resume = function () { userPaused = false; kick(); };
    // Reduced motion switched while the page is open (OS setting or an on-page "pause animation" control):
    // on -> the static final pose (journey: the "ae" in the hero, scrolling with the page); off -> live again,
    // picking the journey up where the scroll is.
    api.setReducedMotion = function (v) {
      v = !!v;
      if (destroyed || v === reduced) return;
      reduced = v;
      if (!sized) return;                         // the first layout reads `reduced`
      if (v) {
        stop(); if (idleT) { clearTimeout(idleT); idleT = 0; } idleAt = 0;
        if (job) finishJob(Infinity);
        if (jm) { setEnd(false); tap = null; }
        renderStatic();
        if (jm && !atLogo) setLogo(true);
        return;
      }
      if (job) finishJob(Infinity);
      dirty = null; drawnKey = ''; restReady = false; cacheReady = false; lastT = 0;
      if (jm) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
        viewY = scrollCache = scrollNow();
        var u = uAtScroll(viewY);
        if (u > uRest + 1) setLogo(false);
        placeAt(u);
      } else if (mode === 'logo') { enterRest(); }
      else startWander();
      kick();
    };
    api.destroy = function () {
      destroyed = true; stop();
      if (idleT) clearTimeout(idleT);
      if (pendingLayout) clearTimeout(pendingLayout);
      if (furWaitTimer) clearTimeout(furWaitTimer);
      if (staticRaf) cancelAnimationFrame(staticRaf);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerleave', onLeave);
      target.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('pointermove', onMoveJ, pe);
      document.removeEventListener('pointerdown', onDownJ, pe);
      document.removeEventListener('pointerup', onUpJ, pe);
      document.removeEventListener('pointercancel', onCancelJ, pe);
      document.removeEventListener('pointerout', onOutJ, pe);
      window.removeEventListener('blur', onBlurJ);
      window.removeEventListener('scroll', onScrollJ, pe);
      window.removeEventListener('load', onLoadJ);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', scheduleLayout);
      if (ro) ro.disconnect();
      if (jm) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); }
      if (io) io.disconnect();
      var i = FUR.subs.indexOf(onFur); if (i >= 0) FUR.subs.splice(i, 1);
      bank = null; job = null; cacheA = cacheB = null;
    };

    layout();
    return api;
  }

  window.SohoSnake = { mount: mount };
})();
