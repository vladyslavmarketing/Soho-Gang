/*!
 * ae studio v2 — the 3D plush snake on the page (window.SohoSnake.mount, same API as v1's snake.js)
 *
 *   Journey: one path J (document px -> rig units of D) = off-screen run-up from the right, the "ae" logo in
 *   writing order (so the body resting on [uRest - L, uRest] IS the logo), then a descent measured from the DOM:
 *   out of the logo down the channel beside the headline (turn, p.18), over the black marquee band (obstacle,
 *   p.19: only the stretch over the band lifts), down the right lane in lateral waves (undulation, p.14), lazy S
 *   turns beside the section heads, and a coil around the income ring (coil / constrict, p.20–21).
 *   Scroll maps monotonically to the neck's arc position u; u follows it through a critically damped,
 *   speed-limited spring, the body is J[u - L, u], so the waves stay fixed on the page while the snake slides
 *   through them — real lateral undulation, no foot-sliding.
 *   Rest (logo / ring): breathing (p.07), head yaw / pitch / roll toward the pointer with the neck lagging
 *   (p.08–10), tongue flicks (p.12), a yawn now and then (p.13), lazy tail (p.11).
 *   Click near the head: strike toward the click and recoil (p.25). The income ring squeezes when the sum grows.
 *   Camera: perspective looking at the page with a slight oblique shear (raised parts shift up, so the near
 *   side of the body and the bead eye show) — the page plane maps 1:1 to CSS px.
 *   No WebGL / reduced motion: html.snake-static, the hero shows the pre-rendered still (CSS).
 */
(function () {
  'use strict';
  var W = window, doc = document;
  var PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapA(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function now() { return performance.now(); }
  function emit(el, name, detail) { try { el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); } catch (e) { /* old browsers */ } }
  function noop() {}

  var ASPECT = 1.85;
  // "ae" in D units (y up), neck joint first -> tail. Bold single-storey 'a' (head on top of the stem) and an
  // 'e' whose last stroke is the tapering tail; 16 diameters nose to tail as on the storyboard.
  var AE = [[2.0, 2.9], [2.05, 2.2], [2.0, 1.3], [1.72, 0.62], [1.08, 0.45], [0.55, 0.88], [0.5, 1.58], [0.92, 2.1], [1.62, 2.1],
    [2.3, 1.72], [3.1, 1.58], [4.05, 1.62], [4.6, 2.05], [4.4, 2.72], [3.75, 2.95], [3.15, 2.6], [2.95, 1.9], [3.1, 1.15], [3.65, 0.68], [4.35, 0.6]];
  var AE_BOX = { x0: -0.05, x1: 5.15, y0: -0.05, y1: 3.45 };
  var IGNORE = 'a,button,input,label,select,textarea,summary,[role=button],[data-no-chase],[data-nav],[data-menu]';

  function prefersReduced() { try { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function logoBox(Wv, Hv) {   // the HERO formula shared with the CSS (--logo-*)
    var bw, bh, x, y;
    if (Wv >= 960) { bw = Math.min(0.44 * Wv, ASPECT * 0.5 * Hv); bh = bw / ASPECT; x = Wv - Math.max(48, 0.05 * Wv) - bw; y = 0.46 * Hv - bh / 2; }
    else { bw = Wv - 32; bh = bw / ASPECT; x = 16; y = 72 + 20; }
    return { x: x, y: y, w: bw, h: bh };
  }
  function crDense(P, per) {   // Catmull-Rom through control points
    var out = [], i, k;
    for (i = 0; i < P.length - 1; i++) {
      var p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
      for (k = 0; k < per; k++) {
        var t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    out.push(P[P.length - 1].slice());
    return out;
  }
  function docBox(el) {   // layout box from the offset chain (ignores reveal transforms)
    var x = 0, y = 0, e = el;
    while (e) { x += (e.offsetLeft || 0) + (e !== el ? e.clientLeft || 0 : 0); y += (e.offsetTop || 0) + (e !== el ? e.clientTop || 0 : 0); e = e.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var api = { replay: noop, chase: noop, pause: noop, resume: noop, destroy: noop, setReducedMotion: noop,
      getLogoBox: function () { return { x: 0, y: 0, w: 0, h: 0 }; }, stats: { ms: 0, max: 0, frames: 0, long: 0 } };
    if (!canvas || opts.mode !== 'journey') { if (canvas) canvas.style.display = 'none'; return api; }   // v2: one snake only
    var S3 = W.SohoSnake3D, THREE = W.THREE, root = doc.documentElement;
    var heroEl = opts.hero || opts.pointerTarget, endEl = opts.end, zoneEl = opts.zoneEnd || null;
    var target = opts.pointerTarget || heroEl;
    var reduced = typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : prefersReduced();
    var marqEl = doc.querySelector('.marquee');

    function goStatic(reason) {
      root.classList.add('snake-static');
      if (reason) root.classList.add('snake-' + reason);
      canvas.style.visibility = 'hidden';
      setLogoVars();
      setTimeout(function () { emit(canvas, 'snake:written'); }, 0);
    }
    function setLogoVars() {
      if (!target) return;
      var b = logoBox(W.innerWidth, W.innerHeight), s = target.style;
      s.setProperty('--logo-x', b.x.toFixed(1) + 'px'); s.setProperty('--logo-y', b.y.toFixed(1) + 'px');
      s.setProperty('--logo-w', b.w.toFixed(1) + 'px'); s.setProperty('--logo-h', b.h.toFixed(1) + 'px');
    }
    api.getLogoBox = function () { return logoBox(W.innerWidth, W.innerHeight); };

    // ---- WebGL (fallback: the static still)
    var renderer = null;
    if (S3 && THREE && heroEl) {
      try {
        var probe = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true }) ||
          canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
        if (probe) renderer = new THREE.WebGLRenderer({ canvas: canvas, context: probe, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
      } catch (e) { renderer = null; }
    }
    if (!renderer) { goStatic('nogl'); return api; }
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    var mobile = Math.min(W.innerWidth, W.innerHeight) < 600 || /Mobi|Android/i.test(navigator.userAgent);
    var scene = new THREE.Scene(), cam = new THREE.Camera();
    var rig = new S3.Rig(), view = new S3.View(THREE, { shells: mobile ? 11 : 16, radial: mobile ? 20 : 24, density: 56, fur: 0.07, shadow: 0.36, pinkRoot: '#BF6882' });
    rig.strikeReach = 13;
    scene.add(view.group);
    var U = view.uniforms;
    U.uEye.value.set(0.06, -0.32, 1, 0).normalize(); U.uEye.value.w = 0;
    U.uL.value.set(-0.42, 0.52, 0.74).normalize();
    var SHEAR_X = -0.06, SHEAR_Y = 0.32;

    // ---- state
    var Wv = 0, Hv = 0, dpr = 1, S = 60, box = null, sized = false, destroyed = false, paused = false;
    var J = null, jPts = null, uRest = 0, uEnd = 0, uJ = 0, vJ = 0, mapS = null, mapU = null, mapN = 0, iQ = 0;
    var gauge = null, card = null, overCard = false, meas = null, sig = '', writing = true, writeT = 0, writeFrom = 0, atLogo = false, atEnd = false;
    var pointer = { x: -1e4, y: -1e4, t: -10, inside: false }, clock = 0, nextFlick = 1.5, nextYawn = 9, squeeze = 0;
    var writeStart = now(), raf = 0, last = 0, lastScroll = -1, idleFrames = 0, stillFrames = 0;
    var tmp = [0, 0, 0];

    // the path state: the body lies on J at the neck's arc position uJ
    var pathState = {
      id: 'journey', omega: 34, anchor: 0, collide: false, blend: 0.45,
      pose: function (t, o) {
        if (!J) return;
        S3.layPath(o.pos, J, uJ);
        var rest = restAmount();
        o.s.breath = 0.035 * Math.sin(TAU * clock / 3.2) * rest;                 // p.07 cycle x 3.2 for a resting rhythm
        if (rest > 0) {                                                          // lazy tail (p.11), low amplitude
          var base = 0.5 + 0.5 * Math.sin(TAU * clock / 5.1), side = Math.sin(TAU * clock / 3.7 - 0.8);
          for (var k = 0; k < 16; k++) {
            var sg = k / 15;
            o.tailP[k] = rest * (sg < 0.45 ? 0.022 * base : 0.03 * base * sstep(0.4, 1, sg));
            o.tailY[k] = rest * side * 0.03 * sstep(0.2, 1, sg);
          }
        }
        if (squeeze > 0) {   // constrict: the coil tightens for a moment (p.21)
          for (var i = 8; i < S3.N; i++) o.radF[i] = 1 - 0.07 * squeeze * Math.sin(PI * clamp(i / S3.N, 0, 1));
        }
      }
    };
    function restAmount() { return atLogo || atEnd ? 1 : sstep(1.2, 0.2, Math.abs(vJ)) * 0.6; }

    /* ---------------- DOM measurement + path ---------------- */
    function measure() {
      var m = { secs: [], colR: 0, contR: 0, marq: null }, i, b, e, guard = 0;
      m.hero = docBox(heroEl);
      var cols = heroEl.querySelectorAll('h1, .hero__lead, .hero__actions');
      for (i = 0; i < cols.length; i++) { b = docBox(cols[i]); if (b.w > 0 && b.x + b.w * 0.5 < m.hero.x + m.hero.w * 0.5) m.colR = Math.max(m.colR, b.x + b.w); }
      e = heroEl.nextElementSibling;
      while (e && guard++ < 40) {
        if (e.offsetHeight > 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'CANVAS') {
          b = docBox(e);
          if (marqEl && (e === marqEl || e.contains(marqEl))) m.marq = docBox(marqEl);
          else {
            var sec = { box: b, end: e === zoneEl, head: null, contR: 0 }, cont = e.querySelector('.container');
            if (cont) { var cb = docBox(cont), cs = W.getComputedStyle(cont); sec.contR = cb.x + cb.w - (parseFloat(cs.paddingRight) || 0); m.contR = Math.max(m.contR, sec.contR); }
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
      var tags = doc.querySelectorAll('[data-tag]');
      m.card = tags.length ? docBox(tags[tags.length - 1]) : null;   // the snake crawls over the last tag (p.19)
      m.gauge = endEl && endEl.offsetWidth ? docBox(endEl) : null;
      m.zone = zoneEl && zoneEl.offsetHeight ? docBox(zoneEl) : m.hero;
      m.endText = null;
      if (m.gauge && zoneEl) {
        var ts = zoneEl.querySelectorAll('.section-title, .section-lead'), g0 = m.gauge;
        for (i = 0; i < ts.length; i++) {
          b = docBox(ts[i]);
          if (!(b.w > 0 && b.h > 0) || b.y + b.h > g0.y + 0.3 * g0.h || b.x > g0.x + g0.w || b.x + b.w < g0.x) continue;
          if (!m.endText) m.endText = { x: b.x, y: b.y, r: b.x + b.w, b: b.y + b.h };
          else { m.endText.r = Math.max(m.endText.r, b.x + b.w); m.endText.b = Math.max(m.endText.b, b.y + b.h); }
        }
      }
      m.docH = Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
      var sg = [Wv, Hv, m.hero.y, m.hero.h, m.colR, m.contR, m.zone.y, m.zone.h, m.docH];
      if (m.marq) sg.push(m.marq.y); if (m.gauge) sg.push(m.gauge.x, m.gauge.y, m.gauge.w);
      for (i = 0; i < m.secs.length; i++) { sg.push(m.secs[i].box.y); if (m.secs[i].head) sg.push(m.secs[i].head.y, m.secs[i].head.r); }
      m.sig = sg.map(function (v) { return Math.round(v); }).join(',');
      return m;
    }

    function buildJourney() {
      var m = meas, D = S, i, k;
      var xs = [], ys = [], region = [];   // doc px; region: 0 run-up/logo, 1 descent, 2 coil
      function add(x, y, rg) {
        var q = xs.length;
        if (q && Math.abs(x - xs[q - 1]) < 0.05 && Math.abs(y - ys[q - 1]) < 0.05) return;
        xs.push(x); ys.push(y); region.push(rg);
      }
      // logo placement in the hero box: D from the box height, the "ae" centred, its baseline on the box bottom
      var ox = box.x + (box.w - (AE_BOX.x1 - AE_BOX.x0) * D) / 2 - AE_BOX.x0 * D, oy = box.y + box.h - 0.1 * D;   // y of D-unit 0
      var ae = crDense(AE, 24).map(function (p) { return [ox + p[0] * D, oy - p[1] * D]; });
      // (A) run-up from beyond the right edge, along the tail's direction, then the logo tail -> head
      var n = ae.length, ex = ae[n - 1][0], ey = ae[n - 1][1], dx = ex - ae[n - 6][0], dy = ey - ae[n - 6][1], dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      var runUp = Math.max(S3.SPINE * D + (Wv - ex) + 4 * D, 4 * D);
      for (var s = runUp; s > 0; s -= D * 0.08) add(ex + dx * s, ey + dy * s, 0);
      for (i = n - 1; i >= 0; i--) add(ae[i][0], ae[i][1], 0);
      var iR = xs.length - 1;
      // (B) descent waypoints {x, y, a (heading, rad, y down), t}
      var contR = m.contR || Wv - 16, margin = Wv - contR, laneRoom = margin - 8 - 0.5 * D - 0.6 * D, gutter = laneRoom < 0.3 * D;
      var colAmp = gutter ? 0.12 * D : Math.min(0.85 * D, laneRoom / 2), xr = gutter ? contR + 0.1 * D : clamp(contR + margin / 2, contR + 0.6 * D + colAmp, Wv - 0.6 * D - colAmp);
      var aeL = ox + AE_BOX.x0 * D, aeB = oy - AE_BOX.y0 * D;
      var p0 = ae[0], hd = Math.atan2(ae[0][1] - ae[3][1], ae[0][0] - ae[3][0]);
      var wps = [{ x: p0[0], y: p0[1], a: hd, t: 0.9 }];
      // turn (p.18): the head leaves the top of the stem; on desktop it arcs right over the 'e' and down the
      // logo's right side (never across the headline), on phones it curls left and under the logo
      if (Wv >= 960) {
        var xR = Math.min(Wv - 0.75 * D, ox + (AE_BOX.x1 + 0.95) * D);
        wps.push({ x: ox + 3.6 * D, y: oy - 4.25 * D, a: 0.05, t: 0.9 });
        wps.push({ x: xR, y: oy - 2.2 * D, a: PI / 2, t: 0.9 });
        wps.push({ x: xR, y: Math.min(m.hero.y + m.hero.h - 0.8 * D, oy + 1.5 * D), a: PI / 2, t: 1.0 });
      } else {
        wps.push({ x: aeL - 0.15 * D, y: oy - 3.9 * D, a: PI * 0.92, t: 0.8 });
        wps.push({ x: Math.max(aeL - 1.1 * D, 0.7 * D), y: oy - 1.6 * D, a: PI / 2, t: 1.0 });
        wps.push({ x: box.x + box.w * 0.45, y: aeB + 1.1 * D, a: 0.05, t: 1.0 });
      }
      // over the marquee band (obstacle, p.19): cross it heading down-right toward the lane
      var mq = m.marq, yAfter = (mq ? mq.y + mq.h : m.hero.y + m.hero.h) + 1.6 * D;
      wps.push({ x: xr, y: Math.max(yAfter, wps[wps.length - 1].y + 3 * D), a: PI / 2, t: 1.0, col: true });
      // lazy S into open space beside section heads, back to the lane
      for (k = 0; k < m.secs.length; k++) {
        var sc = m.secs[k], h = sc.head, cR = sc.contR || contR;
        if (sc.end || !h) continue;
        var oL = h.r + 0.9 * D, oR = cR - 0.4 * D, prev = wps[wps.length - 1];
        if (oR - oL < 3.5 * D || h.y < prev.y + 2.5 * D) continue;
        wps.push({ x: (oL + oR) / 2, y: h.y + h.h * 0.55, a: PI / 2 - 0.12, t: 1.05 });
        wps.push({ x: xr, y: h.y + h.h + 2.6 * D, a: PI / 2, t: 1, col: true });
      }
      // over a card (obstacle, p.19): desktop lane only — a bulge from the lane across the tag's lower corner and back
      card = null;
      var cd = m.card;
      if (cd && Wv >= 960 && cd.x + cd.w > contR - 3 * D) {
        var yc0 = cd.y + 0.2 * cd.h, yc1 = cd.y + cd.h + 2.4 * D, at = wps.length;
        for (k = 1; k < wps.length; k++) if (wps[k].y > yc0) { at = k; break; }
        if (at > 0 && wps[at - 1].y < yc0 - 2 * D) {
          wps.splice(at, 0,
            { x: xr, y: yc0, a: PI / 2, t: 1, col: true },
            { x: cd.x + cd.w * 0.66, y: cd.y + cd.h * 0.8, a: PI / 2 + 0.25, t: 1.1 },
            { x: xr, y: yc1, a: PI / 2, t: 1, col: true });
          for (k = at + 3; k < wps.length; k++) if (wps[k].y < yc1 + 1.5 * D && !wps[k].coil) { wps.splice(k, 1); k--; }
          card = { x: cd.x, y: cd.y, w: cd.w, h: cd.h };
        }
      }
      var lastW = wps[wps.length - 1];
      // (C) approach + coil around the income ring (coil / constrict, p.20–21), head resting near 12 o'clock
      var g = m.gauge, et = m.endText;
      gauge = null;
      var coil = null;
      if (g) {
        var cx = g.x + g.w / 2, cy = g.y + g.h / 2, ringR = 0.4 * g.w, R = ringR + 0.62 * D;
        var circ = TAU * R, turns = clamp(S3.SPINE * D * 0.92 / circ, 0.5, 1.15), dir, thS, yq;
        if (et) { dir = 1; thS = 0; }
        else { dir = -1; thS = 262 / 180 * PI + turns * TAU; }
        var mx = cx + R * Math.cos(thS), my = cy + R * Math.sin(thS);
        if (et) yq = Math.min(Math.max(lastW.y + D, et.b + 0.6 * D), my - 1.4 * D);
        else yq = Math.max(lastW.y + 3 * D, my - 0.65 * Math.abs(xr - mx) - D);
        wps.push({ x: xr, y: yq, a: PI / 2, t: 1, col: true });
        wps.push({ x: mx, y: my, a: thS + dir * PI / 2, t: 1, coil: true });
        coil = { cx: cx, cy: cy, R: R, thS: thS, Phi: turns * TAU, dir: dir };
        gauge = { x: cx, y: cy, r: ringR };
      } else {
        wps.push({ x: xr, y: Math.max(lastW.y + 3 * D, m.zone.y + m.zone.h - 3 * D), a: PI / 2, t: 1, col: true });
      }
      var iq = -1;
      for (k = 1; k < wps.length; k++) {
        var A = wps[k - 1], B = wps[k];
        if (B.coil) iq = xs.length - 1;
        if (A.col && B.col && B.y > A.y + D) {   // lane: lateral waves (undulation, p.14), vertical at both ends
          var len = B.y - A.y, lam = 7.5 * D, nW = Math.max(1, Math.round(len / lam)); lam = len / nW;
          var steps = Math.ceil(len / (0.06 * D)), ramp = Math.min(lam * 0.6, len / 2);
          for (var q = 1; q <= steps; q++) {
            var tt = len * q / steps, env = sstep(0, ramp, tt) * sstep(0, ramp, len - tt);
            var wig = gutter ? 0.5 * (1 - Math.cos(TAU * tt / lam)) : Math.sin(TAU * tt / lam);
            add(A.x + (B.x - A.x) * q / steps + colAmp * env * wig, A.y + tt, 1);
          }
        } else hermite(add, A, B, D);
      }
      if (coil) {
        var cs = Math.ceil(coil.Phi * coil.R / (0.06 * D));
        for (q = 1; q <= cs; q++) {
          var ph = coil.Phi * q / cs, th = coil.thS + coil.dir * ph, rr = coil.R + 0.04 * D * ph;
          add(coil.cx + rr * Math.cos(th), coil.cy + rr * Math.sin(th), 2);
        }
      }
      // ---- to rig units + crossing lifts (the part lying over another one rides on top of it)
      var nP = xs.length, X = new Float64Array(nP), Y = new Float64Array(nP), C = new Float64Array(nP), Z = new Float64Array(nP);
      for (i = 0; i < nP; i++) { X[i] = xs[i] / D; Y[i] = -ys[i] / D; if (i) C[i] = C[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]); }
      var uR = C[iR];
      // body radius at J point i when resting in the logo (for the logo crossings) / full radius elsewhere
      function rAt(j) { return region[j] === 0 && C[j] <= uR ? S3.radius(clamp(uR - C[j], 0, S3.SPINE)) : 0.5; }
      var raw = new Float64Array(nP), cellN = 0, grid = {};
      for (i = 0; i < nP; i++) { var key = Math.floor(X[i]) + ',' + Math.floor(Y[i]); (grid[key] || (grid[key] = [])).push(i); }
      for (i = 0; i < nP; i++) {
        var gx = Math.floor(X[i]), gy = Math.floor(Y[i]);
        for (var ax = -1; ax <= 1; ax++) for (var ay = -1; ay <= 1; ay++) {
          var cell = grid[(gx + ax) + ',' + (gy + ay)]; if (!cell) continue;
          for (var c2 = 0; c2 < cell.length; c2++) {
            var j = cell[c2]; if (Math.abs(C[j] - C[i]) < 2.2) continue;
            var ri = rAt(i), rj = rAt(j), d = Math.hypot(X[j] - X[i], Y[j] - Y[i]);
            if (d >= (ri + rj) * 0.98) continue;
            // who is on top: in the logo the part farther from the head (earlier on J); in the coil the later part
            var iTop = region[i] === 2 || region[j] === 2 ? C[i] > C[j] : C[i] < C[j];
            if (!iTop) continue;
            var need = 2 * rj * 0.93 * Math.sqrt(Math.max(0, 1 - Math.pow(d / ((ri + rj) * 0.98), 2)) * 0.35 + 0.65);
            if (need > raw[i]) raw[i] = need;
          }
        }
        cellN++;
      }
      // marquee band: a soft hump where the descent crosses it (it reads as a raised strip)
      if (mq) for (i = iR; i < nP; i++) { var yy = ys[i]; if (yy > mq.y - 0.4 * D && yy < mq.y + mq.h + 0.4 * D) raw[i] = Math.max(raw[i], 0.42); }
      if (card) for (i = iR; i < nP; i++) {
        var ins = xs[i] > card.x - 0.2 * D && xs[i] < card.x + card.w + 0.2 * D && ys[i] > card.y - 0.2 * D && ys[i] < card.y + card.h + 0.2 * D;
        if (ins) raw[i] = Math.max(raw[i], 0.32);
      }
      // max-filter then smooth along the arc so lifts start and end gently
      var win = 1.3, hi2 = 0;
      for (i = 0; i < nP; i++) {
        var mxv = 0, lo = i;
        while (lo > 0 && C[i] - C[lo - 1] < win) lo--;
        for (j = lo; j < nP && C[j] - C[i] < win; j++) if (raw[j] > 0) mxv = Math.max(mxv, raw[j] * (1 - sstep(0.25, win, Math.abs(C[j] - C[i]))));
        Z[i] = mxv; if (mxv > hi2) hi2 = mxv;
      }
      var pts = new Float32Array(nP * 3);
      for (i = 0; i < nP; i++) { pts[i * 3] = X[i]; pts[i * 3 + 1] = Y[i]; pts[i * 3 + 2] = Z[i]; }
      J = new S3.Path(pts);
      jPts = { y: ys, region: region };
      uRest = J.c[iR]; uEnd = J.len; iQ = iq >= 0 ? iq : nP - 1;
      buildMap(iR, nP);
    }
    function hermite(add, A, B, D) {
      var chd = Math.hypot(B.x - A.x, B.y - A.y); if (chd < 1e-3) return;
      var tx0 = Math.cos(A.a) * chd * A.t, ty0 = Math.sin(A.a) * chd * A.t, tx1 = Math.cos(B.a) * chd * B.t, ty1 = Math.sin(B.a) * chd * B.t;
      var steps = Math.max(8, Math.ceil(chd / (0.05 * D)));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps, t2 = t * t, t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        add(h00 * A.x + h10 * tx0 + h01 * B.x + h11 * tx1, h00 * A.y + h10 * ty0 + h01 * B.y + h11 * ty1, 1);
      }
    }
    // scroll -> u: the neck leads at ~half the viewport after a ramp; the coil completes when the ring is centred
    function buildMap(iR, nP) {
      var n = nP - iR, i, k, ys = jPts.y, Hd = Hv;
      mapN = n; mapS = new Float64Array(n); mapU = new Float64Array(n);
      var heroTop = meas.hero.y, y0 = ys[iR], a0 = clamp((y0 - heroTop - 24) / Hd, 0.04, 0.9), ramp = 0.8 * Hd, key = y0;
      for (i = iR; i < nP; i++) {
        k = i - iR; mapU[k] = J.c[i];
        if (i === iR) { mapS[k] = heroTop + 24; continue; }
        if (i > iQ) continue;
        key = Math.max(ys[i], key + 0.3 * (J.c[i] - J.c[i - 1]) * S);
        mapS[k] = key - Hd * (a0 + (0.5 - a0) * sstep(0, ramp, key - y0));
      }
      var kq = iQ - iR, sQ = mapS[kq], maxScroll = Math.max(0, meas.docH - Hd);
      var sEnd = Math.min(gauge ? gauge.y - Hd / 2 : sQ, maxScroll);
      for (i = iQ + 1; i < nP; i++) mapS[i - iR] = sQ + (sEnd - sQ) * (J.c[i] - J.c[iQ]) / Math.max(1e-3, uEnd - J.c[iQ]);
      mapS[n - 1] = sEnd;
      for (k = n - 2; k >= 1; k--) mapS[k] = Math.min(mapS[k], mapS[k + 1] - 0.17 * (mapU[k + 1] - mapU[k]) * S);
      mapS[0] = heroTop + 24;
      for (k = 1; k < n; k++) if (!(mapS[k] > mapS[k - 1])) mapS[k] = mapS[k - 1] + 1e-3;
    }
    function uAtScroll(s) {
      if (!mapN) return uRest;
      if (s <= mapS[0]) return mapU[0];
      if (s >= mapS[mapN - 1]) return mapU[mapN - 1];
      var lo = 0, hi = mapN - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (mapS[mid] <= s) lo = mid; else hi = mid; }
      return mapU[lo] + (mapU[hi] - mapU[lo]) * (s - mapS[lo]) / (mapS[hi] - mapS[lo]);
    }
    function scrollY() { return W.pageYOffset || root.scrollTop || 0; }

    /* ---------------- layout ---------------- */
    function layout(force) {
      if (destroyed) return;
      var w = W.innerWidth, h = W.innerHeight;
      if (w < 2 || h < 2) return;
      var d = Math.min(W.devicePixelRatio || 1, mobile ? 1.5 : 2);
      var changed = w !== Wv || h !== Hv || d !== dpr;
      Wv = w; Hv = h; dpr = d;
      if (changed || !sized) { renderer.setPixelRatio(dpr); renderer.setSize(Wv, Hv, false); }
      setLogoVars();
      box = logoBox(Wv, Hv);
      S = box.h / 3.75;                                       // px per D: the "ae" (3.5 D tall) fills the logo box
      var m = measure();
      if (!force && sized && !changed && m.sig === sig) return;
      var keep = sized ? { u: uJ - uRest, end: uEnd - uRest } : null;
      meas = m; sig = m.sig;
      buildJourney();
      if (keep) uJ = keep.u > 0.5 ? uRest + keep.u * (uEnd - uRest) / Math.max(1e-3, keep.end) : uRest;
      if (!sized) {
        sized = true;
        uJ = writing ? writeFrom = J.c[0] + S3.SPINE + 0.5 : uRest;
        if (writing) writeFrom = uJ;
        rig.setState(pathState, { snap: true });
      }
      lastScroll = -1;
      kick();
    }

    /* ---------------- camera ---------------- */
    var VPe = new Float32Array(16);
    function updateCamera() {
      var Wd = Wv / S, Hd = Hv / S, sy = scrollY(), sx = W.pageXOffset || 0;
      var cx = (sx + Wv / 2) / S, cy = -(sy + Hv / 2) / S;
      var dist = Hd * 4, f = 2 * dist / Hd, asp = Wd / Hd, near = dist - 12, far = dist + 12;
      // view: x' = x - cx + a z, y' = y - cy + b z, z' = z - dist; proj: perspective
      var A = (far + near) / (near - far), B = 2 * far * near / (near - far);
      var fx = f / asp, a = SHEAR_X, b = SHEAR_Y;
      // column-major 4x4 of P * V
      var e = U.uVP.value.elements;
      e[0] = fx; e[1] = 0; e[2] = 0; e[3] = 0;
      e[4] = 0; e[5] = f; e[6] = 0; e[7] = 0;
      e[8] = fx * a; e[9] = f * b; e[10] = A; e[11] = -1;
      e[12] = -fx * cx; e[13] = -f * cy; e[14] = A * -dist + B; e[15] = dist;
      return { cx: cx, cy: cy, Wd: Wd, Hd: Hd };
    }

    /* ---------------- pointer / look / strike ---------------- */
    function onMove(ev) {
      pointer.x = ev.clientX + (W.pageXOffset || 0); pointer.y = ev.clientY + scrollY(); pointer.t = clock;
      kick();
    }
    function onDown(ev) {
      if (ev.button > 0 || !J || reduced || paused) return;
      var t = ev.target;
      if (t && t.closest && t.closest(IGNORE)) return;
      onMove(ev);
      var H = rig.head, hx = H.pos[0] * S, hy = -H.pos[1] * S, d = Math.hypot(pointer.x - hx, pointer.y - hy);
      if (!(atLogo || atEnd) || d > 7 * S) return;
      rig.strike(Math.atan2(-(pointer.y - hy), pointer.x - hx));
      emit(canvas, 'snake:strike');
      kick();
    }
    function updateLook(dt) {
      var H = rig.head, rest = atLogo || atEnd;
      var hx = H.pos[0], hy = H.pos[1];
      // neck heading (toward the head) from the base pose
      var P = rig.P, nh = Math.atan2(P[1] - P[3 * 6 + 1], P[0] - P[3 * 6]);
      var look = rig.look || (rig.look = { yaw: 0, pitch: 0, roll: 0 });
      var ty = 0, tp = 0, tr = 0;
      if (rest) {
        var active = clock - pointer.t < 3.5 && pointer.x > -1e3;
        if (atLogo && !active) { ty = 0.95; tp = 0.05; tr = 0.12; }      // resting look: to the left, over the bowl
        if (active) {
          var px = pointer.x / S, py = -pointer.y / S, dx = px - hx, dy = py - hy, dd = Math.hypot(dx, dy);
          ty = clamp(wrapA(Math.atan2(dy, dx) - nh), -1.05, 1.05) * sstep(0.4, 1.4, dd);
          tp = 0.55 * sstep(5, 1.2, dd) + 0.06;                              // close cursor: the head rises toward it
          tr = clamp(ty * 0.22, -0.2, 0.2) + 0.12 * Math.sin(clock * 0.7);   // curious tilt
          if (dd < 2.6 && clock > nextFlick - 2.2) nextFlick = Math.min(nextFlick, clock + 0.15);
        }
      }
      look.yaw = ty; look.pitch = tp; look.roll = tr;
      rig.neckShare = atLogo ? 0.18 : 0.45;   // in the logo the neck is the a's stem: mostly the head turns
      if (rest && clock > nextFlick) { rig.flick(); nextFlick = clock + 3 + Math.random() * 3; }
      if (rest && clock > nextYawn) { rig.yawn(); nextYawn = clock + 14 + Math.random() * 10; }
    }

    /* ---------------- journey follow ---------------- */
    var vTs = 0, uTprev = -1;
    function follow(dt, uT) {
      if (uTprev < 0) { uTprev = uT; vTs = 0; }
      vTs += ((uT - uTprev) / Math.max(dt, 1e-3) - vTs) * (1 - Math.exp(-dt / 0.15)); uTprev = uT;
      var lag = Math.abs(uT - uJ), w = 7.5, vmax = 34, ff = 0.3 * vTs, Hd = Hv / S;
      if (lag > 1.5 * Hd) w *= Math.min(3, lag / (1.5 * Hd));
      var n = Math.max(1, Math.ceil(w * dt / 0.1)), h = dt / n;
      for (var i = 0; i < n; i++) {
        vJ += (w * w * (uT - uJ) + 2 * w * (ff - vJ)) * h;
        vJ = clamp(vJ, -vmax, vmax); uJ += vJ * h;
      }
      if (uJ < uRest) { uJ = uRest; if (vJ < 0) vJ = 0; }
      if (uJ > uEnd) { uJ = uEnd; if (vJ > 0) vJ = 0; }
    }
    function setLogo(v) { if (atLogo === v) return; atLogo = v; emit(canvas, v ? 'snake:written' : 'snake:unwritten'); }
    function setEnd(v) { if (atEnd === v) return; atEnd = v; emit(canvas, v ? 'snake:arrived' : 'snake:departed'); }

    /* ---------------- frame ---------------- */
    function frame(t) {
      raf = 0;
      if (destroyed || paused || !sized) return;
      var dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60; last = t;
      var t0 = now();
      clock += dt;
      var sy = scrollY();
      if (writing) {
        writeT = (now() - writeStart) / 1000;
        var k = clamp(writeT / 2.8, 0, 1), e = 1 - Math.pow(1 - k, 2.2);   // ~2.8 s to write the logo, easing in
        uJ = writeFrom + (uRest - writeFrom) * e;
        if (k >= 1) { writing = false; uJ = uRest; vJ = 0; uTprev = -1; }
        if (sy > mapS[0] + 40) { writing = false; vJ = (uRest - writeFrom) / 2.8; uTprev = -1; }
      } else {
        follow(dt, uAtScroll(sy));
      }
      setLogo(!writing && uJ <= uRest + 0.02);
      setEnd(uJ >= uEnd - 0.05);
      // while the body lies on the card the layer goes above the content, otherwise it stays under it
      var oc = false;
      if (card) {
        var Q = rig.Q, cx0 = card.x / S - 0.4, cx1 = (card.x + card.w) / S + 0.4, cy0 = -(card.y + card.h) / S - 0.4, cy1 = -card.y / S + 0.4;
        for (var qi = 0; qi < S3.N; qi += 2) { var qx = Q[qi * 3], qy = Q[qi * 3 + 1]; if (qx > cx0 && qx < cx1 && qy > cy0 && qy < cy1) { oc = true; break; } }
      }
      if (oc !== overCard) { overCard = oc; canvas.classList.toggle('is-over', oc); }
      squeeze = Math.max(0, squeeze - dt * 1.6);
      updateLook(dt);
      rig.update(dt);
      var cv = updateCamera();
      view.update(rig);
      var b = view.bounds, vis = b.x1 > cv.cx - cv.Wd / 2 - 1 && b.x0 < cv.cx + cv.Wd / 2 + 1 && b.y1 > cv.cy - cv.Hd / 2 - 1.5 && b.y0 < cv.cy + cv.Hd / 2 + 1;
      if (vis) { renderer.render(scene, cam); stillFrames = 0; }
      else if (stillFrames++ === 0) renderer.clear();
      var ms = now() - t0, st = api.stats;
      st.frames++; st.ms += (ms - st.ms) * 0.05; if (ms > st.max) st.max = ms; if (ms > 50) st.long++;
      adapt(ms);
      raf = requestAnimationFrame(frame);
    }
    // adaptive quality: fewer fur shells if frames get expensive
    var slow = 0, shellsNow = view.shells;
    function adapt(ms) {
      slow = slow * 0.95 + (ms > 9 ? 1 : 0) * 0.05;
      if (slow > 0.6 && shellsNow > 7) { shellsNow -= 2; view.setShells(shellsNow); slow = 0.2; }
    }
    function kick() { if (!raf && !paused && !destroyed && !reduced && sized) { last = 0; raf = requestAnimationFrame(frame); } }

    /* ---------------- public ---------------- */
    function setReduced(on) {
      reduced = !!on;
      if (reduced) { root.classList.add('snake-static', 'snake-reduced'); canvas.style.visibility = 'hidden'; if (raf) cancelAnimationFrame(raf); raf = 0; emit(canvas, 'snake:written'); }
      else { root.classList.remove('snake-static', 'snake-reduced'); canvas.style.visibility = ''; if (!sized) layout(true); kick(); }
    }
    api.setReducedMotion = setReduced;
    api.pause = function () { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; };
    api.resume = function () { if (!paused) return; paused = false; kick(); };
    api.replay = function () { writing = true; writeStart = now(); uJ = writeFrom; kick(); };
    api.chase = function (x, y) { pointer.x = x; pointer.y = y + scrollY(); pointer.t = clock; };
    api.rig = rig; api.view = view;
    api.debug = function () { return { card: card, meas: meas && { card: meas.card, contR: meas.contR, secs: meas.secs.map(function (q) { return q.head && Math.round(q.head.y); }) }, uJ: uJ, uRest: uRest, uEnd: uEnd, S: S, atLogo: atLogo, atEnd: atEnd, shells: shellsNow, writing: writing }; };
    api.destroy = function () {
      destroyed = true; if (raf) cancelAnimationFrame(raf);
      W.removeEventListener('resize', onResize); doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerdown', onDown);
      W.removeEventListener('scroll', kick);
      renderer.dispose();
    };
    var rzT = 0;
    function onResize() { clearTimeout(rzT); rzT = setTimeout(function () { layout(false); }, 120); }
    W.addEventListener('resize', onResize);
    W.addEventListener('scroll', kick, { passive: true });
    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.addEventListener('pointerdown', onDown, { passive: true });
    // the income ring squeezes when the sum grows
    doc.addEventListener('input', function (e) { if (atEnd && e.target && e.target.closest && e.target.closest('#income')) { squeeze = 1; rig.flick(); } }, { passive: true });
    if (W.ResizeObserver) { try { new ResizeObserver(function () { onResize(); }).observe(doc.body); } catch (e) { /* noop */ } }
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) kick(); });
    if (reduced) { setLogoVars(); setReduced(true); return api; }
    layout(true);
    W.__snake3d = api;
    return api;
  }

  W.SohoSnake = { mount: mount, logoBox: logoBox };
})();
