/*!
 * ae studio v2 — 3D plush snake (WebGL, three.js r149 UMD from cdnjs)
 *
 *   Core (this file, window.SohoSnake3D):
 *     Rig    64 spine nodes from the neck joint to the tail tip. Nose..tail = 16 max diameters (D = 1 unit),
 *            the head reaches HEAD_FWD in front of the neck joint. Every pose is laid at fixed arc spacing SEG,
 *            critically damped springs follow the (cross-faded) targets, then a length projection and a
 *            self-collision pass keep the spine inextensible and the coils apart.
 *            Fast, length-preserving FK overlays ride on top: neck look (yaw / lift), strike, tail.
 *     Frames rotation-minimising frames pulled toward world up (belly down), plus a per-node roll field.
 *     View   body = a tube skinned on the CPU (rings bound to arc length), drawn K times as fur shells
 *            (instanced, procedural strands, wrap + rim/sheen lighting). Head = separate group: upper head and
 *            lower jaw (each with fur shells and a mouth cap), bead eyes, forked tongue. Soft ground shadow.
 *     Scenes the 20 storyboard scenes (Snake-Storyboard-Plush-RU.pdf p.07–26) as states with keyed timing.
 *
 *   World: units of D, Z up, ground z = 0 (the page: x = docX / S, y = -docY / S).
 *   Page integration (journey, pointer, stations) lives in snake3d-page.js.
 */
(function () {
  'use strict';
  var W = window;
  var PI = Math.PI, TAU = PI * 2;

  /* ------------------------------------------------------------------ math */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * t * (t * (6 * t - 15) + 10); }
  function wrapA(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }

  // Keys [[t, v], ...]: Hermite through the keys with finite-difference tangents (Catmull-Rom on uneven times).
  // loop = period (wraps the time and the neighbours), otherwise clamps at the ends.
  function keyAt(keys, t, loop) {
    var n = keys.length, i, k0, k1;
    if (loop) { t = t % loop; if (t < 0) t += loop; }
    if (t <= keys[0][0] && !loop) return keys[0][1];
    if (t >= keys[n - 1][0] && !loop) return keys[n - 1][1];
    for (i = 0; i < n - 1; i++) if (t < keys[i + 1][0]) break;
    if (i >= n - 1) i = n - 2;
    if (t < keys[0][0]) i = 0;
    k0 = keys[i]; k1 = keys[i + 1];
    var dt = k1[0] - k0[0], u = clamp((t - k0[0]) / dt, 0, 1);
    function tan(j) {
      var a = keys[j - 1], b = keys[j + 1], ta, tb;
      if (!a) { if (!loop) return 0; a = keys[n - 2]; ta = a[0] - loop; } else ta = a[0];
      if (!b) { if (!loop) return 0; b = keys[1]; tb = b[0] + loop; } else tb = b[0];
      return (b[1] - a[1]) / (tb - ta);
    }
    var m0 = tan(i) * dt, m1 = tan(i + 1) * dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k0[1] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * k1[1] + (u3 - u2) * m1;
  }
  // critically damped spring on {x, v}
  function spring(s, target, w, dt) {
    var x = s.x - target, e = Math.exp(-w * dt), tmp = (s.v + w * x) * dt;
    s.x = target + (x + tmp) * e; s.v = (s.v - w * tmp) * e;
  }
  function Sp(x) { return { x: x || 0, v: 0 }; }

  /* ------------------------------------------------------------------ model (storyboard p.03 / p.06) */
  var N = 64;                 // spine nodes, neck joint .. tail tip
  var SUB = 3;                // tube rings per spine segment
  var LEN = 16;               // nose .. tail tip, in max diameters
  var HEAD_FWD = 1.15;        // head reach in front of the neck joint
  var SPINE = LEN - HEAD_FWD; // 14.85
  var SEG = SPINE / (N - 1);
  var TAPER = LEN * 2 / 3 - HEAD_FWD;   // the tail starts to taper after 2/3 of the length
  var RINGS = { c0: 0.6, sp: 1.153, wc: 0.145, wb: 0.085, n: 12 };   // 12 cream rings, black edges
  var FUR = 0.13;            // fur length (D)

  function radius(s) {        // body radius (max 0.5) at arc s from the neck joint
    var r = 0.5 * lerp(0.89, 1, sstep(0, 2.6, s));
    if (s > TAPER) r *= 0.06 + 0.94 * Math.pow(1 - clamp((s - TAPER) / (SPINE - TAPER), 0, 1), 1.12);
    var e = SPINE - s;
    if (e < 0.14) r *= Math.sqrt(Math.max(e, 0) / 0.14);
    return r;
  }

  /* ------------------------------------------------------------------ head shape (storyboard p.04, p.06) */
  // Local frame: +x forward (snout), +y left, +z up. Neck joint at the origin; the back is a sphere of the neck
  // radius around it, so yaw / pitch / roll about the joint keep the back inside the neck fur.
  var HR = 0.447, HTIP = HEAD_FWD, MOUTH_Z = -0.075, EYE_X = 0.6, EYE_PHI = 0.4, EYE_R = 0.085;
  function headSec(x) {       // half width, half height, centre z
    if (x <= 0) { var q = Math.sqrt(Math.max(HR * HR - x * x, 0)); return [q, q, 0]; }
    var e = Math.pow(Math.max(1 - Math.pow(x / HTIP, 2.7), 0), 1 / 2.7);
    var w = (HR + 0.045 * Math.sin(PI * Math.min(x / 0.9, 1))) * e;
    var h = (HR - 0.12 * sstep(0, 0.9, x)) * e;
    return [w, h, -0.035 * sstep(0.15, 1.1, x)];
  }
  function headPoint(x, th, o) {  // th: 0 = +y side, PI/2 = top
    var sc = headSec(x), sn = Math.sin(th);
    o[0] = x; o[1] = sc[0] * Math.cos(th); o[2] = sc[2] + sc[1] * sn * (sn < 0 ? 0.9 : 1);
    return o;
  }
  var EYE_POS = (function () {
    var p = headPoint(EYE_X, EYE_PHI, [0, 0, 0]), a = headPoint(EYE_X, EYE_PHI + 0.01, [0, 0, 0]), b = headPoint(EYE_X + 0.01, EYE_PHI, [0, 0, 0]);
    var u = [a[0] - p[0], a[1] - p[1], a[2] - p[2]], v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
    var n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]);
    n = [n[0] / l, n[1] / l, n[2] / l]; if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    return { p: [p[0] + n[0] * 0.028, p[1] + n[1] * 0.028, p[2] + n[2] * 0.028], n: n };
  })();

  /* ------------------------------------------------------------------ pose buffers */
  var TN = 16;                // tail overlay segments
  var SCALARS = ['lookYaw', 'lookPitch', 'headRoll', 'jaw', 'tongue', 'tonguePitch', 'breath'];
  function Pose() {
    this.pos = new Float32Array(N * 3);
    this.roll = new Float32Array(N); this.skin = new Float32Array(N); this.radF = new Float32Array(N);
    this.tailY = new Float32Array(TN); this.tailP = new Float32Array(TN);
    this.s = {}; this.clear();
  }
  Pose.prototype.clear = function () {
    this.roll.fill(0); this.skin.fill(0); this.radF.fill(1); this.tailY.fill(0); this.tailP.fill(0);
    for (var i = 0; i < SCALARS.length; i++) this.s[SCALARS[i]] = 0;
  };
  function mixPose(a, b, w, o) {
    var i;
    for (i = 0; i < N * 3; i++) o.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * w;
    for (i = 0; i < N; i++) {
      o.roll[i] = a.roll[i] + (b.roll[i] - a.roll[i]) * w;
      o.skin[i] = a.skin[i] + (b.skin[i] - a.skin[i]) * w;
      o.radF[i] = a.radF[i] + (b.radF[i] - a.radF[i]) * w;
    }
    for (i = 0; i < TN; i++) { o.tailY[i] = lerp(a.tailY[i], b.tailY[i], w); o.tailP[i] = lerp(a.tailP[i], b.tailP[i], w); }
    for (i = 0; i < SCALARS.length; i++) { var k = SCALARS[i]; o.s[k] = lerp(a.s[k], b.s[k], w); }
  }

  /* ------------------------------------------------------------------ pose builders */
  // Lay the spine on the ground from node 0 at (x0, y0): heading(s) = direction toward the tail at arc s,
  // lift(s) = height above lying. Every step is exactly SEG long (lifts shorten the horizontal step).
  function layHeading(out, x0, y0, heading, lift) {
    var x = x0, y = y0, zp = radius(0) + (lift ? lift(0) : 0), i;
    out[0] = x; out[1] = y; out[2] = zp;
    for (i = 1; i < N; i++) {
      var s = i * SEG, z = radius(s) + (lift ? lift(s) : 0), dz = z - zp;
      dz = clamp(dz, -0.95 * SEG, 0.95 * SEG); z = zp + dz;
      var hs = Math.sqrt(SEG * SEG - dz * dz), th = heading(s - SEG / 2);
      x += hs * Math.cos(th); y += hs * Math.sin(th);
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; zp = z;
    }
    return out;
  }
  // A polyline path for the neck joint to follow (head travels toward increasing u). z = lift above lying.
  function Path(pts) {
    var n = pts.length / 3, c = new Float64Array(n), i;
    for (i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    this.p = pts; this.c = c; this.n = n; this.len = c[n - 1]; this.u0 = 0;
  }
  Path.prototype.at = function (u, o) {
    var p = this.p, c = this.c, n = this.n, i, t;
    u -= this.u0;
    if (u <= 0) { i = 0; t = u / Math.max(c[1], 1e-6); }
    else if (u >= this.len) { i = n - 2; t = 1 + (u - this.len) / Math.max(c[n - 1] - c[n - 2], 1e-6); }
    else {
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (c[m] <= u) lo = m; else hi = m; }
      i = lo; t = (u - c[i]) / Math.max(c[i + 1] - c[i], 1e-9);
    }
    o[0] = lerp(p[i * 3], p[i * 3 + 3], t); o[1] = lerp(p[i * 3 + 1], p[i * 3 + 4], t); o[2] = lerp(p[i * 3 + 2], p[i * 3 + 5], t);
    return o;
  };
  var _pa = [0, 0, 0];
  function layPath(out, path, u) {
    for (var i = 0; i < N; i++) {
      path.at(u - i * SEG, _pa);
      out[i * 3] = _pa[0]; out[i * 3 + 1] = _pa[1]; out[i * 3 + 2] = radius(i * SEG) + _pa[2];
    }
    return out;
  }
  function pathFrom(fn, u0, u1, step) {   // fn(u) -> [x, y, lift]
    var pts = [], u;
    for (u = u0; u < u1; u += step) { var q = fn(u); pts.push(q[0], q[1], q[2] || 0); }
    var e = fn(u1); pts.push(e[0], e[1], e[2] || 0);
    var P = new Path(pts); P.u0 = u0; return P;
  }

  /* ------------------------------------------------------------------ rig */
  function Rig() {
    this.A = new Pose(); this.B = new Pose(); this.M = new Pose();
    this.S = new Float32Array(N * 3); this.Sv = new Float32Array(N * 3);   // springs (unconstrained)
    this.P = new Float32Array(N * 3);                                       // constrained base pose
    this.Q = new Float32Array(N * 3);                                       // with overlays
    this.Tg = new Float32Array(N * 3); this.Up = new Float32Array(N * 3); this.Sd = new Float32Array(N * 3);
    this.roll = new Float32Array(N); this.radF = new Float32Array(N); this.skin = new Float32Array(N);
    this.state = null; this.prev = null; this.t = 0; this.tPrev = 0; this.blend = 1; this.blendDur = 0.45;
    this.omega = 26; this.anchor = 0; this.collide = true; this.started = false;
    // controls (springs)
    this.hYaw = Sp(); this.nYaw = Sp(); this.hPitch = Sp(); this.nPitch = Sp(); this.hRoll = Sp();
    this.jaw = Sp(); this.tongue = Sp(); this.tPitch = Sp(); this.breath = Sp();
    this.neckShare = 0.45;
    this.lookOmega = [16, 6.5];     // head, neck ("the head turns first, then a short stretch of the neck")
    this.look = null;               // external look target {yaw, pitch} (page / cursor), added to the state's
    this.extRoll = 0;
    // actions
    this.strikeT = 99; this.strikeDir = 0; this.strikeReach = 20; this.strikeW = Sp(); this.flickT = 99; this.yawnT = 99;   // strikeReach: nodes in the striking front (20 = 4.7 D)
    // outputs
    this.head = { pos: [0, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], jaw: 0, tongue: 0, tonguePitch: 0 };
    this.time = 0;
  }
  // Switch to a state; the previous pose cross-fades out over blendDur (0.3–0.6 s).
  Rig.prototype.setState = function (st, opts) {
    opts = opts || {};
    if (this.state === st && !opts.restart) return;
    if (this.state && this.started) {
      // freeze the current blended target as the "from" pose
      this.evalInto(this.A, this.state, this.t);
      if (this.prev && this.blend < 1) { this.evalInto(this.M, this.prev, this.tPrev); mixPose(this.M, this.A, ease(this.blend), this.A); }
      this.prev = { frozen: true };
      this.blend = 0;
    }
    this.state = st; this.t = opts.t || 0;
    this.blendDur = opts.blend != null ? opts.blend : (st.blend || 0.45);
    this.omega = st.omega || 26; this.anchor = st.anchor || 0; this.collide = st.collide !== false;
    if (st.lookOmega) this.lookOmega = st.lookOmega; else this.lookOmega = [16, 6.5];
    if (!this.started || opts.snap) this.snap();
  };
  Rig.prototype.evalInto = function (pose, st, t) {
    pose.clear();
    st.pose(t, pose, this);
  };
  Rig.prototype.snap = function () {
    this.evalInto(this.B, this.state, this.t);
    this.S.set(this.B.pos); this.Sv.fill(0); this.prev = null; this.blend = 1; this.started = true;
    var s = this.B.s;
    this.hYaw.x = s.lookYaw; this.nYaw.x = s.lookYaw * 0.45; this.hPitch.x = s.lookPitch; this.nPitch.x = s.lookPitch * 0.6;
    this.hRoll.x = s.headRoll; this.jaw.x = s.jaw; this.tongue.x = s.tongue; this.tPitch.x = s.tonguePitch; this.breath.x = s.breath;
    this.hYaw.v = this.nYaw.v = this.hPitch.v = this.nPitch.v = this.hRoll.v = this.jaw.v = this.tongue.v = this.tPitch.v = 0;
    this.solve(0);
  };
  Rig.prototype.strike = function (dirAngle) { if (this.strikeT > 0.55) { this.strikeT = -0.32; this.strikeDir = dirAngle; } };
  Rig.prototype.flick = function () { if (this.flickT > 0.3) this.flickT = 0; };
  Rig.prototype.yawn = function () { if (this.yawnT > 0.6) this.yawnT = 0; };

  Rig.prototype.update = function (dt) {
    if (!this.state) return;
    dt = Math.min(dt, 1 / 20);
    this.time += dt; this.t += dt; this.tPrev += dt;
    this.strikeT += dt; this.flickT += dt; this.yawnT += dt;
    var tgt = this.B;
    this.evalInto(this.B, this.state, this.t);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / Math.max(this.blendDur, 1e-3));
      mixPose(this.A, this.B, ease(this.blend), this.M); tgt = this.M;
    }
    // node springs
    var S = this.S, V = this.Sv, T = tgt.pos, w = this.omega, e = Math.exp(-w * dt), i;
    for (i = 0; i < N * 3; i++) {
      var x = S[i] - T[i], tmp = (V[i] + w * x) * dt;
      S[i] = T[i] + (x + tmp) * e; V[i] = (V[i] - w * tmp) * e;
    }
    // control springs
    var s = tgt.s, lk = this.look, ly = s.lookYaw + (lk ? lk.yaw : 0), lp = s.lookPitch + (lk ? lk.pitch : 0);
    ly = clamp(ly, -1.15, 1.15); lp = clamp(lp, -0.3, 1.25);
    spring(this.hYaw, ly, this.lookOmega[0], dt); spring(this.nYaw, ly * this.neckShare, this.lookOmega[1], dt);
    spring(this.hPitch, lp, this.lookOmega[0], dt); spring(this.nPitch, Math.max(0, lp) * 0.62, this.lookOmega[1], dt);
    spring(this.hRoll, s.headRoll + (lk ? lk.roll || 0 : 0), this.lookOmega[0], dt);
    spring(this.breath, s.breath, 8, dt);
    var jawK = this.yawnT < 0.47 ? keyAt(JAW_KEYS, this.yawnT) : 0;
    var flk = this.flickT < 0.17, tg = flk ? keyAt(TONGUE_EXT, this.flickT) : 0;
    if (this.strikeT < 0.6) jawK = Math.max(jawK, keyAt(STRIKE_JAW, this.strikeT));
    // the timeline keys are already smooth: fast springs keep their timing (tongue 0.045 s, jaw 0.27 s peaks)
    spring(this.jaw, Math.max(s.jaw, jawK), 60, dt);
    spring(this.tongue, Math.max(s.tongue, tg), 90, dt);
    spring(this.tPitch, flk ? keyAt(TONGUE_PITCH, this.flickT) : s.tonguePitch, 90, dt);
    spring(this.strikeW, this.strikeT < 0.33 ? 1 : 0, this.strikeT < 0.33 ? 22 : 7, dt);
    this.solve(dt, tgt);
  };

  // springs -> length projection -> collisions -> overlays -> frames -> head
  Rig.prototype.solve = function (dt, tgt) {
    tgt = tgt || this.B;
    var P = this.P, i, j, k;
    P.set(this.S);
    project(P, this.anchor);
    if (this.collide) { collide(P, 2); project(P, this.anchor); }
    for (i = 0; i < N; i++) if (P[i * 3 + 2] < radius(i * SEG) * 0.98) P[i * 3 + 2] = radius(i * SEG) * 0.98;
    var Q = this.Q; Q.set(P);
    // ---- neck look (yaw) and lift (pitch): head first, then a short stretch of the neck
    var nY = this.nYaw.x, nP = this.nPitch.x, cn = 9, cl = 18;
    if (Math.abs(nY) > 1e-4 || nP > 1e-4) {
      for (k = 0; k < cl; k++) { incY[k] = 0; incP[k] = 0; }
      var wsum = 0; for (k = 0; k < cn; k++) wsum += (k + 1);
      for (k = 0; k < cn; k++) incY[cl - cn + k] = nY * (k + 1) / wsum;            // grows toward the head
      // lift: several neck segments rise, the head end levels out (storyboard p.09)
      for (k = 0; k < cl; k++) { var sg = k / (cl - 1); incP[k] = nP * 0.23 * Math.sin(TAU * sg) * (sg < 0.5 ? 1 : 0.85); }
      bendFront(Q, cl, incY, incP);
    }
    // ---- tail overlay
    var tz = false; for (k = 0; k < TN; k++) if (tgt.tailY[k] || tgt.tailP[k]) { tz = true; break; }
    if (tz) bendTail(Q, TN, tgt.tailY, tgt.tailP);
    // ---- strike (storyboard p.25): the front S unfolds toward strikeDir, the rear keeps its support
    var sw = this.strikeW.x;
    if (sw > 1e-3 || this.strikeT < 0) strikeFront(Q, this.strikeT, this.strikeDir, Math.max(sw, this.strikeT < 0 ? sstep(-0.32, -0.05, this.strikeT) : 0), this.strikeReach);
    // ---- per node fields
    var br = this.breath.x, hr = this.hRoll.x;
    for (i = 0; i < N; i++) {
      var s = i * SEG;
      this.radF[i] = tgt.radF[i] * (1 + br * Math.exp(-Math.pow((s - 4.6) / 2.4, 2)));
      this.skin[i] = tgt.skin[i];
      this.roll[i] = tgt.roll[i] + hr * Math.pow(Math.max(0, 1 - i / 7), 2) * 0.55;
    }
    frames(Q, this.Tg, this.Up, this.Sd, this.roll);
    // ---- head
    var H = this.head, ux = this.Up[0], uy = this.Up[1], uz = this.Up[2];
    var fx = Q[0] - Q[6], fy = Q[1] - Q[7], fz = Q[2] - Q[8], fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    var d = ux * fx + uy * fy + uz * fz; ux -= d * fx; uy -= d * fy; uz -= d * fz; var ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    var lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx;   // left = up x forward
    // local yaw / pitch / roll (the part the neck did not take)
    // the neck carries the lift; the head levels itself and only tips a little toward the target (p.09)
    var el0 = Math.asin(clamp(fz, -1, 1));
    var yaw = this.hYaw.x - this.nYaw.x, pit = (0.22 * this.hPitch.x + Math.min(this.hPitch.x, 0) * 0.8) - el0 * clamp(this.nPitch.x * 3, 0, 1), rol = hr * 0.8 + this.extRoll;
    if (sw > 1e-3) { pit = lerp(pit, 0.05, sw); yaw = lerp(yaw, 0, sw); }
    var R = eulerBasis(yaw, pit, rol);
    // world basis = [F L U] * R
    for (k = 0; k < 3; k++) {
      H.X[k] = [fx, fy, fz][k] * R[0] + [lx, ly, lz][k] * R[1] + [ux, uy, uz][k] * R[2];
      H.Y[k] = [fx, fy, fz][k] * R[3] + [lx, ly, lz][k] * R[4] + [ux, uy, uz][k] * R[5];
      H.Z[k] = [fx, fy, fz][k] * R[6] + [lx, ly, lz][k] * R[7] + [ux, uy, uz][k] * R[8];
    }
    H.pos[0] = Q[0]; H.pos[1] = Q[1]; H.pos[2] = Q[2];
    // keep the jaw and snout above the ground
    var tipZ = H.pos[2] + H.X[2] * 1.05 - Math.abs(H.Z[2]) * 0.3;
    if (tipZ < 0.08) H.pos[2] += 0.08 - tipZ;
    H.jaw = clamp(this.jaw.x, 0, 1.2); H.tongue = clamp(this.tongue.x, 0, 1); H.tonguePitch = this.tPitch.x;
  };
  var incY = new Float32Array(32), incP = new Float32Array(32);

  // R = Rz(yaw) * Ry(-pitch) * Rx(roll), returned as columns [X, Y, Z] (9 numbers, column-major)
  function eulerBasis(yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(-pitch), sp = Math.sin(-pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // Rz * Ry
    var a = [cy * cp, sy * cp, -sp,  -sy, cy, 0,  cy * sp, sy * sp, cp];
    // * Rx: columns X' = X, Y' = cr*Y + sr*Z, Z' = -sr*Y + cr*Z
    return [a[0], a[1], a[2],
      cr * a[3] + sr * a[6], cr * a[4] + sr * a[7], cr * a[5] + sr * a[8],
      -sr * a[3] + cr * a[6], -sr * a[4] + cr * a[7], -sr * a[5] + cr * a[8]];
  }

  function project(P, a) {
    var i, dx, dy, dz, l;
    for (i = a + 1; i < N; i++) {
      dx = P[i * 3] - P[i * 3 - 3]; dy = P[i * 3 + 1] - P[i * 3 - 2]; dz = P[i * 3 + 2] - P[i * 3 - 1];
      l = Math.hypot(dx, dy, dz) || 1e-6; l = SEG / l;
      P[i * 3] = P[i * 3 - 3] + dx * l; P[i * 3 + 1] = P[i * 3 - 2] + dy * l; P[i * 3 + 2] = P[i * 3 - 1] + dz * l;
    }
    for (i = a - 1; i >= 0; i--) {
      dx = P[i * 3] - P[i * 3 + 3]; dy = P[i * 3 + 1] - P[i * 3 + 4]; dz = P[i * 3 + 2] - P[i * 3 + 5];
      l = Math.hypot(dx, dy, dz) || 1e-6; l = SEG / l;
      P[i * 3] = P[i * 3 + 3] + dx * l; P[i * 3 + 1] = P[i * 3 + 4] + dy * l; P[i * 3 + 2] = P[i * 3 + 5] + dz * l;
    }
  }
  var RAD = new Float32Array(N); (function () { for (var i = 0; i < N; i++) RAD[i] = radius(i * SEG); })();
  function collide(P, iters) {
    for (var it = 0; it < iters; it++) {
      for (var i = 0; i < N; i++) {
        for (var j = i + 5; j < N; j++) {
          var dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
          var mn = (RAD[i] + RAD[j]) * 0.97 + (i < 3 ? 0.06 : 0);
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= mn * mn) continue;
          var d = Math.sqrt(d2) || 1e-4, push = (mn - d) / d * 0.5;
          if (d < 1e-3) { dx = 0; dy = 0; dz = 1; d = 1; push = mn * 0.5; }
          P[i * 3] -= dx * push; P[i * 3 + 1] -= dy * push; P[i * 3 + 2] -= dz * push;
          P[j * 3] += dx * push; P[j * 3 + 1] += dy * push; P[j * 3 + 2] += dz * push;
        }
      }
    }
  }
  // Rotate segment vectors cumulatively (yaw about world z, pitch = added elevation), rebuild from the pivot.
  function rotSeg(vx, vy, vz, yaw, pitch, o) {
    var c = Math.cos(yaw), s = Math.sin(yaw), x = vx * c - vy * s, y = vx * s + vy * c;
    var h = Math.hypot(x, y), l = Math.hypot(h, vz) || 1e-6, el = Math.atan2(vz, h) + pitch;
    el = clamp(el, -1.45, 1.45);
    var hx = h > 1e-6 ? x / h : 1, hy = h > 1e-6 ? y / h : 0;
    o[0] = hx * Math.cos(el) * l; o[1] = hy * Math.cos(el) * l; o[2] = Math.sin(el) * l;
  }
  var _o = [0, 0, 0], _orig = new Float32Array(N * 3);
  function bendFront(Q, count, iy, ip) {
    _orig.set(Q);
    var ay = 0, ap = 0;
    for (var k = 0; k < count; k++) {      // k = 0 at the pivot, count - 1 at the head
      var j = count - 1 - k;               // segment from node j+1 to node j
      ay += iy[k]; ap += ip[k];
      rotSeg(_orig[j * 3] - _orig[j * 3 + 3], _orig[j * 3 + 1] - _orig[j * 3 + 4], _orig[j * 3 + 2] - _orig[j * 3 + 5], ay, ap, _o);
      Q[j * 3] = Q[j * 3 + 3] + _o[0]; Q[j * 3 + 1] = Q[j * 3 + 4] + _o[1]; Q[j * 3 + 2] = Q[j * 3 + 5] + _o[2];
    }
  }
  function bendTail(Q, count, iy, ip) {
    _orig.set(Q);
    var ay = 0, ap = 0, p0 = N - 1 - count;
    for (var k = 0; k < count; k++) {
      var j = p0 + 1 + k;
      ay += iy[k]; ap += ip[k];
      rotSeg(_orig[j * 3] - _orig[j * 3 - 3], _orig[j * 3 + 1] - _orig[j * 3 - 2], _orig[j * 3 + 2] - _orig[j * 3 - 1], ay, ap, _o);
      Q[j * 3] = Q[j * 3 - 3] + _o[0]; Q[j * 3 + 1] = Q[j * 3 - 2] + _o[1]; Q[j * 3 + 2] = Q[j * 3 - 1] + _o[2];
    }
  }
  // Strike: front 20 nodes. m = straightness (0 = S-loop ready, 1 = lunge), keyed on the PDF times.
  var STRIKE_M = [[-0.32, 0], [0, 0], [0.06, 0.22], [0.12, 1], [0.2, 0.92], [0.33, 0], [0.6, 0]];
  var STRIKE_JAW = [[-0.32, 0], [0.04, 0], [0.12, 1], [0.24, 0.55], [0.33, 0], [0.6, 0]];
  var JAW_KEYS = [[0, 0], [0.12, 0.42], [0.27, 1], [0.47, 0]];                       // p.13
  var TONGUE_EXT = [[0, 0], [0.045, 1], [0.095, 1], [0.17, 0]];                      // p.12
  var TONGUE_PITCH = [[0, 0.32], [0.045, 0.3], [0.095, -0.38], [0.17, 0]];
  var _sf = new Float32Array(32 * 3);
  function strikeFront(Q, t, dir, w, SC) {
    if (w <= 1e-4) return;
    var m = keyAt(STRIKE_M, t), px = Q[SC * 3], py = Q[SC * 3 + 1], pz = Q[SC * 3 + 2];
    var th0 = Math.atan2(Q[(SC - 2) * 3 + 1] - Q[SC * 3 + 1], Q[(SC - 2) * 3] - Q[SC * 3]);   // body heading at the pivot
    var thD = th0 + clamp(wrapA(dir - th0), -1.25, 1.25);
    var amp = 1.45 * (1 - m), base = lerp(th0, thD, sstep(0, 0.35, m) * 0.6 + 0.4);
    var x = px, y = py, z = pz;
    for (var k = 0; k < SC; k++) {
      var sg = (k + 0.5) / SC;
      var th = base + amp * Math.sin(TAU * sg) * (0.4 + 0.6 * sg) - amp * 0.35;
      var el = lerp(0.62 * Math.cos(PI * sg * 1.1), 0.08, m);
      el = clamp(el, -0.3, 0.9);
      x += SEG * Math.cos(el) * Math.cos(th); y += SEG * Math.cos(el) * Math.sin(th); z += SEG * Math.sin(el);
      var j = SC - 1 - k;
      _sf[j * 3] = x; _sf[j * 3 + 1] = y; _sf[j * 3 + 2] = Math.max(z, RAD[j]);
    }
    for (var i = 0; i < SC; i++) {
      Q[i * 3] = lerp(Q[i * 3], _sf[i * 3], w); Q[i * 3 + 1] = lerp(Q[i * 3 + 1], _sf[i * 3 + 1], w); Q[i * 3 + 2] = lerp(Q[i * 3 + 2], _sf[i * 3 + 2], w);
    }
    // re-project the blended front from the pivot toward the head
    for (i = SC - 1; i >= 0; i--) {
      var dx = Q[i * 3] - Q[i * 3 + 3], dy = Q[i * 3 + 1] - Q[i * 3 + 4], dz = Q[i * 3 + 2] - Q[i * 3 + 5], l = SEG / (Math.hypot(dx, dy, dz) || 1e-6);
      Q[i * 3] = Q[i * 3 + 3] + dx * l; Q[i * 3 + 1] = Q[i * 3 + 4] + dy * l; Q[i * 3 + 2] = Q[i * 3 + 5] + dz * l;
    }
  }

  // Frames: tangent toward the tail, dorsal "up" transported along the spine and pulled toward world up
  // (belly on the ground), starting from the most horizontal node; then the roll field.
  function frames(Q, Tg, Up, Sd, roll) {
    var i, best = 0, bestH = -1;
    for (i = 0; i < N; i++) {
      var a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
      var tx = Q[b * 3] - Q[a * 3], ty = Q[b * 3 + 1] - Q[a * 3 + 1], tz = Q[b * 3 + 2] - Q[a * 3 + 2], l = Math.hypot(tx, ty, tz) || 1;
      Tg[i * 3] = tx / l; Tg[i * 3 + 1] = ty / l; Tg[i * 3 + 2] = tz / l;
      var hz = 1 - Math.abs(tz / l); if (hz > bestH) { bestH = hz; best = i; }
    }
    upAt(Tg, Up, best, null);
    for (i = best + 1; i < N; i++) upAt(Tg, Up, i, i - 1);
    for (i = best - 1; i >= 0; i--) upAt(Tg, Up, i, i + 1);
    for (i = 0; i < N; i++) {
      var r = -roll[i], tx2 = Tg[i * 3], ty2 = Tg[i * 3 + 1], tz2 = Tg[i * 3 + 2], ux = Up[i * 3], uy = Up[i * 3 + 1], uz = Up[i * 3 + 2];
      // side = up x tangent
      var sx = uy * tz2 - uz * ty2, sy = uz * tx2 - ux * tz2, sz = ux * ty2 - uy * tx2;
      if (r) {
        var c = Math.cos(r), s = Math.sin(r);
        var nux = ux * c + (ty2 * uz - tz2 * uy) * s, nuy = uy * c + (tz2 * ux - tx2 * uz) * s, nuz = uz * c + (tx2 * uy - ty2 * ux) * s;
        ux = nux; uy = nuy; uz = nuz; Up[i * 3] = ux; Up[i * 3 + 1] = uy; Up[i * 3 + 2] = uz;
        sx = uy * tz2 - uz * ty2; sy = uz * tx2 - ux * tz2; sz = ux * ty2 - uy * tx2;
      }
      Sd[i * 3] = sx; Sd[i * 3 + 1] = sy; Sd[i * 3 + 2] = sz;
    }
  }
  function upAt(Tg, Up, i, from) {
    var tx = Tg[i * 3], ty = Tg[i * 3 + 1], tz = Tg[i * 3 + 2];
    var px = -tz * tx, py = -tz * ty, pz = 1 - tz * tz, pl = Math.hypot(px, py, pz);   // world up minus its tangent part
    var ux, uy, uz;
    if (from === null) {
      if (pl > 1e-4) { ux = px / pl; uy = py / pl; uz = pz / pl; } else { ux = 1; uy = 0; uz = 0; }
    } else {
      ux = Up[from * 3]; uy = Up[from * 3 + 1]; uz = Up[from * 3 + 2];
      var d = ux * tx + uy * ty + uz * tz; ux -= d * tx; uy -= d * ty; uz -= d * tz;
      var l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (pl > 1e-4) {
        var w = 0.5 * sstep(0.08, 0.5, pl);
        ux = ux * (1 - w) + px / pl * w; uy = uy * (1 - w) + py / pl * w; uz = uz * (1 - w) + pz / pl * w;
        l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      }
    }
    Up[i * 3] = ux; Up[i * 3 + 1] = uy; Up[i * 3 + 2] = uz;
  }

  /* ------------------------------------------------------------------ shaders */
  var COMMON = [
    'precision highp float;',
    'uniform mat4 uVP; uniform vec4 uEye; uniform vec3 uL;',
    'vec3 eyeDir(vec3 p){ return uEye.w > 0.5 ? normalize(uEye.xyz - p) : normalize(uEye.xyz); }'
  ].join('\n');
  var FUR_VS = [COMMON,
    'attribute vec3 position; attribute vec3 normal; attribute vec3 aTan; attribute vec4 aUV; attribute float aShell;',
    'uniform mat4 modelMatrix; uniform float uFur; uniform float uNS;',
    'varying vec3 vN; varying vec3 vP; varying vec4 vUV; varying float vH;',
    'void main(){',
    '  float h = aShell / max(uNS - 1.0, 1.0);',
    '  vec3 n = normalize(mat3(modelMatrix) * normal);',
    '  vec3 t = mat3(modelMatrix) * aTan;',
    '  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;',
    '  float fl = uFur * aUV.w;',
    '  p += n * (fl * h) + t * (0.55 * fl * h * h) + vec3(0.0, 0.0, -0.18) * fl * h * h;',
    '  vN = n; vP = p; vUV = aUV; vH = h;',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}'].join('\n');
  var FUR_FS = [COMMON,
    'uniform float uDens; uniform vec4 uRing; uniform float uRingN; uniform float uTaper; uniform float uSpine;',
    'uniform vec3 cPinkR, cPinkT, cCreamR, cCreamT, cBlackR, cBlackT, cBelly, uSky, uGround, uSheen, uLc;',
    'uniform float uGroundAO;',
    'varying vec3 vN; varying vec3 vP; varying vec4 vUV; varying float vH;',
    'float hash(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    // ring id: 0 pink, 1 cream, 2 black
    'float ringId(float s){',
    '  if (s < 0.0) return 0.0;',
    '  float rs = mix(0.62, 1.0, clamp(1.0 - (s - uTaper) / (uSpine - uTaper), 0.0, 1.0));',
    '  float k = clamp(floor((s - uRing.x) / uRing.y + 0.5), 0.0, uRingN - 1.0);',
    '  float d = s - (uRing.x + k * uRing.y);',
    '  float ad = abs(d) / rs;',
    '  if (ad < uRing.z) return 1.0;',
    '  if (ad < uRing.z + uRing.w) return (k < 0.5 && d < 0.0) ? 0.0 : 2.0;',
    '  return 0.0;',
    '}',
    'void main(){',
    '  float h = vH;',
    '  vec2 g = vUV.xy * uDens;',
    '  vec2 c = floor(g); vec2 f = fract(g);',
    '  float r1 = hash(c);',
    '  vec2 ctr = vec2(hash(c + 13.7), hash(c + 71.3)) * 0.56 + 0.22;',
    '  float clump = vnoise(vUV.xy * uDens * 0.17);',
    '  float len = mix(0.42, 0.74, r1) * mix(0.75, 1.0, clump);',
    '  float stray = step(0.93, hash(c + 5.17));',
    '  len = mix(len, 1.0, stray);',
    '  if (h > 0.001) {',
    '    if (h > len) discard;',
    '    float rad = (0.58 * (1.0 - h / len) + 0.1) * mix(1.0, 0.45, stray);',
    '    if (length(f - ctr) > rad) discard;',
    '  }',
    '  float sStrand = h > 0.001 ? (c.x + ctr.x) / uDens : vUV.x + (vnoise(vUV.xy * 24.0) - 0.5) * 0.05;',
    '  float id = ringId(sStrand + (r1 - 0.5) * 0.035);',
    '  vec3 root = cPinkR, tip = cPinkT;',
    '  if (id > 1.5) { root = cBlackR; tip = cBlackT; } else if (id > 0.5) { root = cCreamR; tip = cCreamT; }',
    '  float hv = pow(h, 0.85);',
    '  vec3 col = mix(root, tip, hv) * mix(0.9, 1.08, r1);',
    '  float belly = smoothstep(-0.35, -0.85, vUV.z);',
    '  col = mix(col, cBelly * mix(0.82, 1.05, hv), belly * (id < 0.5 ? 0.7 : 0.25));',
    '  vec3 N = normalize(vN);',
    '  vec3 V = eyeDir(vP);',
    '  float ndl = dot(N, uL);',
    '  float diff = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);',
    '  vec3 amb = mix(uGround, uSky, 0.5 + 0.5 * N.z);',
    '  float ao = mix(0.6, 1.0, pow(h, 0.6));',
    '  ao *= mix(uGroundAO, 1.0, smoothstep(0.02, 0.4, vP.z));',
    '  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);',
    '  vec3 Hh = normalize(uL + V);',
    '  float th = dot(N, Hh); float kk = pow(sqrt(max(1.0 - th * th, 0.0)), 24.0) * 0.06 * hv;',
    '  vec3 lit = col * (amb + uLc * diff) * ao + uSheen * rim * (0.25 + 0.75 * hv) * (col + 0.12) + kk * uLc;',
    '  gl_FragColor = vec4(pow(max(lit, 0.0), vec3(1.0 / 2.2)), 1.0);',
    '}'].join('\n');
  var LIT_VS = [COMMON,
    'attribute vec3 position; attribute vec3 normal; uniform mat4 modelMatrix;',
    'varying vec3 vN; varying vec3 vP;',
    'void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = uVP * vec4(vP, 1.0); }'].join('\n');
  var LIT_FS = [COMMON,
    'uniform vec3 uCol; uniform float uGloss; uniform vec3 uSky, uGround, uLc;',
    'varying vec3 vN; varying vec3 vP;',
    'void main(){',
    '  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = eyeDir(vP);',
    '  float diff = clamp((dot(N, uL) + 0.3) / 1.3, 0.0, 1.0);',
    '  vec3 amb = mix(uGround, uSky, 0.5 + 0.5 * N.z);',
    '  vec3 col = uCol * (amb + uLc * diff * (1.0 - uGloss * 0.7));',
    '  vec3 H = normalize(uL + V);',
    '  float sp = pow(max(dot(N, H), 0.0), mix(12.0, 160.0, uGloss)) * mix(0.15, 2.4, uGloss);',
    '  float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0) * uGloss * 0.5;',
    '  float sp2 = pow(max(dot(reflect(-V, N), normalize(vec3(-0.2, 0.5, 0.85))), 0.0), 60.0) * uGloss * 1.4;',
    '  col += vec3(1.0, 0.96, 0.97) * (sp + sp2) + uSky * fr;',
    '  gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);',
    '}'].join('\n');
  var SH_VS = [COMMON,
    'attribute vec3 position; attribute vec2 aSh;',
    'varying vec2 vSh;',
    'void main(){ vSh = aSh; gl_Position = uVP * vec4(position, 1.0); }'].join('\n');
  var SH_FS = ['precision highp float;',
    'uniform vec3 uShCol; uniform float uShA;',
    'varying vec2 vSh;',
    'void main(){ float a = exp(-vSh.x * vSh.x * 2.6) * vSh.y * uShA; gl_FragColor = vec4(uShCol * a, a); }'].join('\n');

  function lin(hex) {   // sRGB hex -> linear rgb array
    var n = parseInt(hex.replace('#', ''), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  }
  function v3(THREE, a, k) { k = k || 1; return new THREE.Vector3(a[0] * k, a[1] * k, a[2] * k); }

  /* ------------------------------------------------------------------ view (three.js objects) */
  function View(THREE, opts) {
    opts = opts || {};
    this.THREE = THREE;
    var shells = this.shells = opts.shells || 18;
    var R = this.R = opts.radial || 26;
    var M = this.M = (N - 1) * SUB + 1;
    this.group = new THREE.Group();
    var u = this.uniforms = {
      uVP: { value: new THREE.Matrix4() }, uEye: { value: new THREE.Vector4(0, -0.3, 1, 0) },
      uL: { value: new THREE.Vector3(-0.45, 0.5, 0.74).normalize() }
    };
    var furU = {
      uVP: u.uVP, uEye: u.uEye, uL: u.uL,
      uFur: { value: opts.fur || FUR }, uNS: { value: shells }, uDens: { value: opts.density || 34 },
      uRing: { value: new THREE.Vector4(RINGS.c0, RINGS.sp, RINGS.wc, RINGS.wb) }, uRingN: { value: RINGS.n },
      uTaper: { value: TAPER }, uSpine: { value: SPINE },
      cPinkR: { value: v3(THREE, lin('#A9566F')) }, cPinkT: { value: v3(THREE, lin('#F7B0C4')) },
      cCreamR: { value: v3(THREE, lin('#CBAA74')) }, cCreamT: { value: v3(THREE, lin('#FFF1CC')) },
      cBlackR: { value: v3(THREE, lin('#0B0708')) }, cBlackT: { value: v3(THREE, lin('#3A2C31')) },
      cBelly: { value: v3(THREE, lin('#F6DCDD')) },
      uSky: { value: v3(THREE, lin('#F7E3E6'), 0.62) }, uGround: { value: v3(THREE, lin('#C98E9C'), 0.32) },
      uLc: { value: v3(THREE, lin('#FFF3EE'), 0.82) }, uSheen: { value: v3(THREE, lin('#FFE6EC'), 0.75) },
      uGroundAO: { value: 0.62 }
    };
    this.furUniforms = furU;
    if (opts.pinkRoot) furU.cPinkR.value = v3(THREE, lin(opts.pinkRoot));
    var furMat = this.furMat = new THREE.RawShaderMaterial({ vertexShader: FUR_VS, fragmentShader: FUR_FS, uniforms: furU, side: THREE.FrontSide });
    function litMat(col, gloss) {
      return new THREE.RawShaderMaterial({ vertexShader: LIT_VS, fragmentShader: LIT_FS, side: THREE.DoubleSide, uniforms: {
        uVP: u.uVP, uEye: u.uEye, uL: u.uL, uCol: { value: v3(THREE, lin(col)) }, uGloss: { value: gloss },
        uSky: furU.uSky, uGround: furU.uGround, uLc: furU.uLc } });
    }
    // ---- body tube
    var nv = M * (R + 1);
    var g = this.bodyGeo = new THREE.InstancedBufferGeometry();
    this.bPos = new Float32Array(nv * 3); this.bNor = new Float32Array(nv * 3); this.bTan = new Float32Array(nv * 3); this.bUV = new Float32Array(nv * 4);
    function dyn(arr, n) { var a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; }
    g.setAttribute('position', dyn(this.bPos, 3)); g.setAttribute('normal', dyn(this.bNor, 3));
    g.setAttribute('aTan', dyn(this.bTan, 3)); g.setAttribute('aUV', dyn(this.bUV, 4));
    var idx = [], j, k;
    for (j = 0; j < M - 1; j++) for (k = 0; k < R; k++) {
      var a = j * (R + 1) + k, b = a + 1, c = a + R + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    var sh = new Float32Array(shells); for (k = 0; k < shells; k++) sh[k] = k;
    g.setAttribute('aShell', new THREE.InstancedBufferAttribute(sh, 1));
    g.instanceCount = shells;
    this.body = new THREE.Mesh(g, furMat); this.body.frustumCulled = false; this.body.renderOrder = 2;
    this.group.add(this.body);
    // ---- head
    this.head = new THREE.Group(); this.head.matrixAutoUpdate = false;
    this.jawG = new THREE.Group(); this.jawG.position.set(-0.08, 0, MOUTH_Z);
    var hu = buildHeadPart(THREE, true, shells, sh), hl = buildHeadPart(THREE, false, shells, sh);
    this.upper = new THREE.Mesh(hu.fur, furMat); this.lower = new THREE.Mesh(hl.fur, furMat);
    var mouthMat = litMat('#A54862', 0.15);
    this.palate = new THREE.Mesh(hu.cap, mouthMat); this.floor = new THREE.Mesh(hl.cap, mouthMat);
    this.lower.position.set(0.08, 0, -MOUTH_Z); this.floor.position.copy(this.lower.position);
    this.jawG.add(this.lower); this.jawG.add(this.floor);
    this.head.add(this.upper); this.head.add(this.palate); this.head.add(this.jawG);
    var eyeGeo = new THREE.SphereGeometry(EYE_R, 20, 14), eyeMat = litMat('#0A0607', 1.0);
    for (k = -1; k <= 1; k += 2) {
      var e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(EYE_POS.p[0], EYE_POS.p[1] * k, EYE_POS.p[2]); e.scale.set(0.95, 1, 0.9);
      this.head.add(e);
    }
    this.tongueG = new THREE.Group(); this.tongue = new THREE.Mesh(buildTongue(THREE), litMat('#D97890', 0.35));
    this.tongueG.add(this.tongue); this.head.add(this.tongueG);
    this.head.traverse(function (o) { o.frustumCulled = false; o.renderOrder = 2; });
    this.group.add(this.head);
    // ---- ground shadow (premultiplied, MAX blending: overlapping parts do not double-darken)
    var sg = this.shGeo = new THREE.BufferGeometry(), sn = (N + 6) * 2;
    this.sPos = new Float32Array(sn * 3); this.sAt = new Float32Array(sn * 2);
    sg.setAttribute('position', dyn(this.sPos, 3)); sg.setAttribute('aSh', dyn(this.sAt, 2));
    var sidx = []; for (j = 0; j < N + 5; j++) { var q0 = j * 2; sidx.push(q0, q0 + 1, q0 + 2, q0 + 1, q0 + 3, q0 + 2); }
    sg.setIndex(sidx);
    this.shadowMat = new THREE.RawShaderMaterial({ vertexShader: SH_VS, fragmentShader: SH_FS, transparent: true, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uVP: u.uVP, uShCol: { value: new THREE.Vector3(0.34, 0.14, 0.19) }, uShA: { value: opts.shadow != null ? opts.shadow : 0.42 } } });
    this.shadow = new THREE.Mesh(sg, this.shadowMat); this.shadow.frustumCulled = false; this.shadow.renderOrder = 0;
    this.group.add(this.shadow);
    this.bounds = { x0: 0, y0: 0, x1: 0, y1: 0, z1: 0 };
    this._m = new THREE.Matrix4();
  }
  View.prototype.setShells = function (n) {
    n = clamp(n | 0, 2, this.shells);
    this.bodyGeo.instanceCount = n; this.upper.geometry.instanceCount = n; this.lower.geometry.instanceCount = n;
    this.furUniforms.uNS.value = n;
  };

  // Catmull-Rom sample of the node chain + frame interpolation -> rings
  var _rc = new Float32Array(3), _rt = new Float32Array(3), _ru = new Float32Array(3);
  View.prototype.update = function (rig) {
    var Q = rig.Q, Tg = rig.Tg, Up = rig.Up, R = this.R, M = this.M, pos = this.bPos, nor = this.bNor, tan = this.bTan, uv = this.bUV;
    var j, k, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, bz1 = 0;
    for (j = 0; j < M; j++) {
      var seg = Math.min((j / SUB) | 0, N - 2), f = j / SUB - seg;
      var i0 = Math.max(seg - 1, 0), i1 = seg, i2 = seg + 1, i3 = Math.min(seg + 2, N - 1);
      var f2 = f * f, f3 = f2 * f;
      var w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
      if (seg === 0) { w1 += w0; w0 = 0; }
      if (seg + 2 > N - 1) { w2 += w3; w3 = 0; }
      for (k = 0; k < 3; k++) {
        _rc[k] = w0 * Q[i0 * 3 + k] + w1 * Q[i1 * 3 + k] + w2 * Q[i2 * 3 + k] + w3 * Q[i3 * 3 + k];
        _rt[k] = lerp(Tg[i1 * 3 + k], Tg[i2 * 3 + k], f);
        _ru[k] = lerp(Up[i1 * 3 + k], Up[i2 * 3 + k], f);
      }
      var tl = Math.hypot(_rt[0], _rt[1], _rt[2]) || 1; _rt[0] /= tl; _rt[1] /= tl; _rt[2] /= tl;
      var dd = _ru[0] * _rt[0] + _ru[1] * _rt[1] + _ru[2] * _rt[2];
      _ru[0] -= dd * _rt[0]; _ru[1] -= dd * _rt[1]; _ru[2] -= dd * _rt[2];
      var ul = Math.hypot(_ru[0], _ru[1], _ru[2]) || 1; _ru[0] /= ul; _ru[1] /= ul; _ru[2] /= ul;
      var sx = _ru[1] * _rt[2] - _ru[2] * _rt[1], sy = _ru[2] * _rt[0] - _ru[0] * _rt[2], sz = _ru[0] * _rt[1] - _ru[1] * _rt[0];
      var s = (j / SUB) * SEG, rf = lerp(rig.radF[i1], rig.radF[i2], f), r = radius(s) * rf;
      var skin = lerp(rig.skin[i1], rig.skin[i2], f);
      var furF = clamp(0.35 + 1.3 * radius(s), 0.35, 1) * (j === M - 1 ? 0.3 : 1);
      var circ = TAU * Math.max(radius(s), 0.05);
      for (k = 0; k <= R; k++) {
        var th = -PI / 2 + TAU * k / R, c = Math.cos(th), sn = Math.sin(th), fl = sn < 0 ? 0.9 : 1;
        var nx = c * sx + sn * _ru[0], ny = c * sy + sn * _ru[1], nz = c * sz + sn * _ru[2];
        var o = (j * (R + 1) + k);
        pos[o * 3] = _rc[0] + r * (c * sx + sn * fl * _ru[0]);
        pos[o * 3 + 1] = _rc[1] + r * (c * sy + sn * fl * _ru[1]);
        pos[o * 3 + 2] = _rc[2] + r * (c * sz + sn * fl * _ru[2]);
        nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = nz;
        tan[o * 3] = _rt[0]; tan[o * 3 + 1] = _rt[1]; tan[o * 3 + 2] = _rt[2];
        uv[o * 4] = s + skin; uv[o * 4 + 1] = (k / R) * circ; uv[o * 4 + 2] = sn; uv[o * 4 + 3] = furF;
      }
      if (_rc[0] < bx0) bx0 = _rc[0]; if (_rc[0] > bx1) bx1 = _rc[0];
      if (_rc[1] < by0) by0 = _rc[1]; if (_rc[1] > by1) by1 = _rc[1];
      if (_rc[2] > bz1) bz1 = _rc[2];
    }
    var g = this.bodyGeo.attributes;
    g.position.needsUpdate = g.normal.needsUpdate = g.aTan.needsUpdate = g.aUV.needsUpdate = true;
    // head transform
    var H = rig.head, m = this.head.matrix;
    m.set(H.X[0], H.Y[0], H.Z[0], H.pos[0], H.X[1], H.Y[1], H.Z[1], H.pos[1], H.X[2], H.Y[2], H.Z[2], H.pos[2], 0, 0, 0, 1);
    this.head.matrixWorldNeedsUpdate = true;
    this.jawG.rotation.y = H.jaw * 0.72;
    var te = H.tongue;
    this.tongueG.visible = te > 0.01;
    this.tongueG.position.set(0.74 + 0.62 * te, 0, MOUTH_Z + 0.015);
    this.tongueG.rotation.set(0, -H.tonguePitch, 0);
    this.tongue.scale.set(0.35 + 0.65 * te, 1, 1);
    var hx = H.pos[0] + H.X[0] * 1.6, hy = H.pos[1] + H.X[1] * 1.6;
    bx0 = Math.min(bx0, hx); bx1 = Math.max(bx1, hx); by0 = Math.min(by0, hy); by1 = Math.max(by1, hy);
    this.bounds.x0 = bx0 - 0.8; this.bounds.x1 = bx1 + 0.8; this.bounds.y0 = by0 - 0.8; this.bounds.y1 = by1 + 0.8; this.bounds.z1 = bz1;
    this.updateShadow(rig);
  };
  View.prototype.updateShadow = function (rig) {
    var Q = rig.Q, P = this.sPos, A = this.sAt, L = this.uniforms.uL.value, i, n = 0;
    var ox = -L.x / Math.max(L.z, 0.3), oy = -L.y / Math.max(L.z, 0.3);
    function put(x, y, z, tx, ty, r) {
      var h = Math.max(z - r, 0), w = r * 1.25 + h * 0.45, a = clamp(1 - h / 3.2, 0, 1) * (0.55 + 0.45 * clamp(r / 0.5, 0, 1));
      var cx = x + ox * (r * 0.55 + h * 0.8), cy = y + oy * (r * 0.55 + h * 0.8), tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
      P[n * 3] = cx + nx * w; P[n * 3 + 1] = cy + ny * w; P[n * 3 + 2] = 0.002; A[n * 2] = -1; A[n * 2 + 1] = a; n++;
      P[n * 3] = cx - nx * w; P[n * 3 + 1] = cy - ny * w; P[n * 3 + 2] = 0.002; A[n * 2] = 1; A[n * 2 + 1] = a; n++;
    }
    var H = rig.head;
    for (i = 5; i >= 0; i--) {   // head, in front of the neck joint
      var f = i / 5 * 1.05, x = H.pos[0] + H.X[0] * f, y = H.pos[1] + H.X[1] * f, z = H.pos[2] + H.X[2] * f;
      put(x, y, z, -H.X[0], -H.X[1], 0.46 * (1 - Math.pow(f / 1.15, 3)));
    }
    for (i = 0; i < N; i++) put(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2], rig.Tg[i * 3], rig.Tg[i * 3 + 1], RAD[i]);
    this.shGeo.attributes.position.needsUpdate = true; this.shGeo.attributes.aSh.needsUpdate = true;
  };

  function buildHeadPart(THREE, upper, shells, sh) {
    var NX = 34, NT = 22, xs = [], i, k;
    for (i = 0; i <= NX; i++) { var q = i / NX; xs.push(-HR + (HTIP + HR) * (0.5 - 0.5 * Math.cos(PI * q))); }
    var pos = [], nor = [], tan = [], uv = [], idx = [], p = [0, 0, 0], pa = [0, 0, 0], pb = [0, 0, 0];
    var capPos = [], capNor = [], capIdx = [];
    function thetaRange(x) {
      var sc = headSec(x), zr = (MOUTH_Z - sc[2]) / Math.max(sc[1] * 0.9, 1e-4);
      var ta = Math.asin(clamp(zr, -1, 1));
      return upper ? [ta, PI - ta] : [PI - ta, TAU + ta];
    }
    for (i = 0; i <= NX; i++) {
      var x = Math.min(Math.max(xs[i], -HR + 1e-4), HTIP - 1e-4), tr = thetaRange(x);
      for (k = 0; k <= NT; k++) {
        var th = lerp(tr[0], tr[1], k / NT);
        headPoint(x, th, p);
        headPoint(x + 0.004, th, pa); headPoint(x, th + 0.01, pb);
        var ux = pa[0] - p[0], uy = pa[1] - p[1], uz = pa[2] - p[2], vx = pb[0] - p[0], vy = pb[1] - p[1], vz = pb[2] - p[2];
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9) { nx = x > 0.5 ? 1 : -1; ny = 0; nz = 0; nl = 1; }
        nx /= nl; ny /= nl; nz /= nl;
        // orient outward
        var sc = headSec(x), ox = x > 0 ? x * 0.2 : x, oy = p[1], oz = p[2] - sc[2];
        if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz);
        // fur flows from the snout tip backward
        var fx = -1, fy = p[1] * 0.6, fz = (p[2] - sc[2]) * 0.4, fl = Math.hypot(fx, fy, fz);
        tan.push(fx / fl, fy / fl, fz / fl);
        var de = Math.hypot(p[0] - EYE_POS.p[0], Math.abs(p[1]) - Math.abs(EYE_POS.p[1]), p[2] - EYE_POS.p[2]);
        var furF = (0.5 + 0.5 * sstep(0.06, 0.2, de)) * lerp(0.75, 1, sstep(1.15, 0.6, x));
        uv.push(-1.5 - x, th * 0.44, Math.sin(th), furF);
      }
    }
    for (i = 0; i < NX; i++) for (k = 0; k < NT; k++) {
      var a = i * (NT + 1) + k, b = a + 1, c = a + NT + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    // mouth cap (palate / jaw floor), flat at MOUTH_Z
    var NC = 4;
    for (i = 0; i <= NX; i++) {
      var x2 = Math.min(Math.max(xs[i], -HR + 1e-4), HTIP - 1e-4), tr2 = thetaRange(x2);
      headPoint(x2, upper ? tr2[0] : tr2[1], pa); var yw = Math.abs(pa[1]);
      for (k = 0; k <= NC; k++) {
        capPos.push(x2, lerp(-yw, yw, k / NC), MOUTH_Z + (upper ? 0.004 : -0.004));
        capNor.push(0, 0, upper ? -1 : 1);
      }
    }
    for (i = 0; i < NX; i++) for (k = 0; k < NC; k++) {
      var a2 = i * (NC + 1) + k, b2 = a2 + 1, c2 = a2 + NC + 1, d2 = c2 + 1;
      capIdx.push(a2, c2, b2, b2, c2, d2);
    }
    var g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 4));
    g.setAttribute('aShell', new THREE.InstancedBufferAttribute(sh, 1));
    g.setIndex(idx); g.instanceCount = shells;
    var cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(capNor, 3));
    cg.setIndex(capIdx);
    return { fur: g, cap: cg };
  }
  function buildTongue(THREE) {
    // stalk 0 -> 0.42, two tines to 0.7 diverging; thin tube, local +x
    var segs = [];
    function tube(p0, p1, r0, r1) { segs.push([p0, p1, r0, r1]); }
    tube([0, 0, 0], [0.42, 0, 0.0], 0.024, 0.02);
    tube([0.42, 0, 0], [0.7, 0.07, 0.015], 0.02, 0.006);
    tube([0.42, 0, 0], [0.7, -0.07, 0.015], 0.02, 0.006);
    var pos = [], nor = [], idx = [], RS = 8, LS = 6;
    segs.forEach(function (sg) {
      var p0 = sg[0], p1 = sg[1], d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], l = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / l, d[1] / l, d[2] / l];
      var a = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      var u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]], ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
      var v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      var base = pos.length / 3, i, k;
      for (i = 0; i <= LS; i++) {
        var t = i / LS, r = lerp(sg[2], sg[3], t), c = [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t)];
        for (k = 0; k < RS; k++) {
          var th = TAU * k / RS, cs = Math.cos(th), sn = Math.sin(th) * 0.55;
          var n = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn];
          pos.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r); nor.push(n[0], n[1], n[2]);
        }
      }
      for (i = 0; i < LS; i++) for (k = 0; k < RS; k++) {
        var q = base + i * RS + k, q1 = base + i * RS + (k + 1) % RS;
        idx.push(q, q1, q + RS, q1, q1 + RS, q + RS);
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }

  /* ------------------------------------------------------------------ storyboard scenes (p.07–26) */
  // Every scene: { id, title, dur (seconds, keys from the PDF), loop, pose(t, out, rig), cam, props }
  // Positions in D, head toward -x (screen left, as on the storyboard frames).
  function headingLeftToRight(fn) { return function (s) { return fn(s); }; }
  function restCurve(s) { return 0.4 * Math.sin(TAU * s / 10.5 + 0.9) - 0.1; }
  var Scenes = [];
  function scene(o) { Scenes.push(o); return o; }
  var X0 = -7.3;

  scene({ id: '01-breath', title: 'Покой и дыхание', dur: 1, loop: 1, keys: [0, 0.25, 0.5, 0.75],
    pose: function (t, o) {
      layHeading(o.pos, X0, 0.1, restCurve);
      o.s.breath = 0.06 * Math.sin(TAU * t);           // volume around the ribs; head and tail still
    } });
  scene({ id: '02-head-yaw', title: 'Поворот головы влево и вправо', dur: 1, loop: 1, keys: [0, 0.25, 0.5, 0.75], lookOmega: [26, 11],
    pose: function (t, o) {
      layHeading(o.pos, -2.2, -0.3, function (s) { return 0.3 + 0.55 * sstep(0.5, 4, s); });
      o.s.lookYaw = keyAt([[0, 0], [0.25, 0.95], [0.5, 0], [0.75, -0.95], [1, 0]], t, 1);
    } });
  scene({ id: '03-head-pitch', title: 'Подъём и опускание передней части', dur: 1, loop: 1, keys: [0, 0.25, 0.5, 0.75], lookOmega: [22, 12],
    pose: function (t, o) {
      layHeading(o.pos, X0, 0, function () { return 0; });
      o.s.lookPitch = keyAt([[0, 0], [0.25, 0.5], [0.5, 1.15], [0.75, 0.32], [1, 0]], t, 1);
    } });
  scene({ id: '04-head-roll', title: 'Наклон головы вокруг продольной оси', dur: 1, loop: 1, keys: [0, 0.25, 0.5, 0.75],
    pose: function (t, o) {
      layHeading(o.pos, -0.6, 0, function (s) { return 0.12 * sstep(2, 6, s); });
      var r = keyAt([[0, 0], [0.25, 0.55], [0.5, 0], [0.75, -0.55], [1, 0]], t, 1);
      for (var i = 0; i < N; i++) o.roll[i] = r * Math.pow(Math.max(0, 1 - i / 9), 2) * 0.5;
      o.s.headRoll = r * 0.7;
    } });
  scene({ id: '05-tail', title: 'Подъём и боковой изгиб хвоста', dur: 1, loop: 1, keys: [0, 0.25, 0.5, 0.75],
    pose: function (t, o) {
      layHeading(o.pos, X0, 0.1, restCurve);
      var base = keyAt([[0, 0], [0.25, 1], [0.5, 1], [0.75, 0.75], [1, 0]], t, 1);
      var tip = keyAt([[0, 0], [0.25, 0.35], [0.5, 1], [0.75, 0.9], [1, 0]], t, 1);
      var side = keyAt([[0, 0], [0.25, 0.3], [0.5, 1], [0.75, -1], [1, 0]], t, 1);
      for (var k = 0; k < TN; k++) {
        var sg = k / (TN - 1);
        o.tailP[k] = (sg < 0.45 ? 0.085 * base : 0) + (sg > 0.5 ? 0.11 * tip : 0);
        o.tailY[k] = side * 0.06 * sstep(0.2, 1, sg) * (0.5 + 0.5 * tip);
      }
    } });
  scene({ id: '06-tongue', title: 'Раздвоенный язык', dur: 0.17, loop: 0, keys: [0, 0.045, 0.095, 0.17], hold: 0.5,
    pose: function (t, o) {
      layHeading(o.pos, -1.4, 0.2, function (s) { return -0.25 + 0.6 * sstep(0.5, 4, s); });
      o.s.lookPitch = 0.5;
      o.s.tongue = keyAt(TONGUE_EXT, t); o.s.tonguePitch = keyAt(TONGUE_PITCH, t);
    } });
  scene({ id: '07-jaw', title: 'Открытие и закрытие пасти', dur: 0.47, loop: 0, keys: [0, 0.12, 0.27, 0.47], hold: 0.5,
    pose: function (t, o) {
      layHeading(o.pos, -1.4, 0.2, function (s) { return -0.25 + 0.6 * sstep(0.5, 4, s); });
      o.s.lookPitch = 0.5;
      o.s.jaw = keyAt(JAW_KEYS, t);
    } });
  // serpenoid wave travelling to the tail while the snake advances head first (p.14)
  function serp(o, t, amp, lam, speed, ampFn) {
    var hx = X0 - speed * t;
    layHeading(o.pos, hx, 0, function (s) {
      var a = amp * (ampFn ? ampFn(s) : sstep(0, 2.2, s) * 0.75 + 0.25);
      return a * Math.sin(TAU * (s / lam - t));
    });
  }
  scene({ id: '08-undulation', title: 'Боковая волна по грунту', dur: 1, loop: 0, keys: [0, 0.25, 0.5, 0.75], omega: 40,
    pose: function (t, o) { serp(o, t, 1.2, 8.4, 1.4); } });
  // concertina (p.15): folds gather with the front anchored, then the front extends with the rear anchored
  var CONC = { lam: 4.6, amp: 1.55, per: 0.76, foldT: 0.36 };
  var concExtent = (function () {
    var cache = {};
    return function (f) {
      var key = Math.round(f * 200); if (cache[key] != null) return cache[key];
      var x = 0, s; for (s = 0; s < SPINE; s += SEG) x += SEG * Math.cos(CONC.amp * f * Math.sin(TAU * s / CONC.lam) * sstep(0, 1.2, s));
      return (cache[key] = x);
    };
  })();
  scene({ id: '09-concertina', title: 'Гармошка', dur: 1.12, loop: 0, keys: [0, 0.36, 0.76, 1.12], omega: 30,
    pose: function (t, o) {
      var n = Math.floor(t / CONC.per), ph = t - n * CONC.per;
      var f = ph < CONC.foldT ? ease(ph / CONC.foldT) : 1 - ease((ph - CONC.foldT) / (CONC.per - CONC.foldT));
      var E0 = concExtent(0), E1 = concExtent(1), base = -6.5 - n * (E0 - E1);
      // head x: fold phase head fixed; extend phase tail fixed (tail = base + E1)
      var hx = ph < CONC.foldT ? base : base + E1 - concExtent(f);
      layHeading(o.pos, hx, 0, function (s) { return CONC.amp * f * Math.sin(TAU * s / CONC.lam) * sstep(0, 1.2, s); });
    } });
  scene({ id: '10-sidewinding', title: 'Боковой ход', dur: 0.92, loop: 0, keys: [0, 0.23, 0.46, 0.69], omega: 40, collide: false,
    pose: function (t, o) {
      var A = 1.05, k = TAU / 7.4, w = TAU / 0.92, drift = 0.35 * A * w * t, i;
      var x = X0 + 0.4, zp = 0, yPrev = 0;
      for (i = 0; i < N; i++) {
        var s = i * SEG, ph = k * s - w * t + 0.6;
        var y = A * Math.sin(ph) * sstep(-0.5, 1.5, s) + drift - 0.6;
        var lift = 0.55 * sstep(0.35, 0.9, (1 - Math.cos(ph)) / 2) * sstep(0, 1.5, s);
        var z = radius(s) + lift;
        if (i > 0) { var dy = y - yPrev, dz = z - zp, hs = SEG * SEG - dy * dy - dz * dz; x += Math.sqrt(Math.max(hs, SEG * SEG * 0.1)); }
        o.pos[i * 3] = x; o.pos[i * 3 + 1] = y; o.pos[i * 3 + 2] = z; yPrev = y; zp = z;
      }
    } });
  scene({ id: '11-rectilinear', title: 'Прямолинейное ползание', dur: 1, loop: 0, keys: [0, 0.25, 0.5, 0.75],
    pose: function (t, o) {
      // forward in pulses: the belly skin slides first, then the body catches up (p.17)
      var hx = X0 - (0.55 * t + 0.07 * (1 - Math.cos(TAU * t)));
      layHeading(o.pos, hx, 0, function (s) { return 0.015 * Math.sin(s * 0.7); });
      for (var i = 0; i < N; i++) {
        var s = i * SEG, ph = TAU * (s / 2.6 + t);
        o.skin[i] = 0.11 * Math.sin(ph) * sstep(0.3, 1.5, s);
        o.radF[i] = 1 + 0.035 * Math.cos(ph) * sstep(0.3, 1.5, s) * sstep(SPINE, SPINE - 3, s);
      }
    } });
  var turnPath = pathFrom(function (u) {     // straight wavy course heading -x, then a 180° turn (CCW), then +x
    var R = 2.9, L1 = 13;
    if (u < L1) { var x = 8 - u; return [x, 2.4 + 0.45 * Math.sin(u * TAU / 6.5) * sstep(0, 3, u) * sstep(L1, L1 - 3, u), 0]; }
    var a = (u - L1) / R; if (a < PI) return [8 - L1 - R * Math.sin(a), 2.4 - R + R * Math.cos(a), 0];
    return [8 - L1 + (u - L1 - PI * R), 2.4 - 2 * R, 0];
  }, -20, 60, 0.05);
  scene({ id: '12-turn', title: 'Поворот и смена курса', dur: 0.75, loop: 0, keys: [0, 0.25, 0.5, 0.75], omega: 40, tempo: 3,
    pose: function (t, o) { layPath(o.pos, turnPath, 12 + t / 0.75 * 12); } });
  var LOG = { x: 0, r: 0.42 };
  var obstPath = pathFrom(function (u) {
    var x = 8 - u, bump = Math.pow(Math.cos(clamp(x / 1.55, -1, 1) * PI / 2), 2);
    return [x, 0, (2 * LOG.r + 0.02) * bump];
  }, -20, 60, 0.04);
  scene({ id: '13-obstacle', title: 'Переползание через препятствие', dur: 1.05, loop: 0, keys: [0, 0.3, 0.65, 1.05], omega: 40, tempo: 3,
    props: [{ type: 'log', x: 0, y: 0, r: LOG.r, len: 2.6 }],
    pose: function (t, o) { layPath(o.pos, obstPath, 7.4 + t / 1.05 * 16.2); } });
  // coil (p.20): curvature morphs from a wide arc to a nested spiral (monotone curvature never self-crosses)
  function coilPose(o, f, tuck) {
    var x = 0, y = 0, th = 0, pts = [], i;
    // integrate from the tail tip (outer end) toward the head (inner end)
    var Rin = 0.95, gap = 1.04;
    for (i = N - 1; i >= 0; i--) {
      var s = i * SEG, sFromTail = SPINE - s;
      // archimedean spiral: r(sFromTail) with dr/dphi = gap / 2pi
      var a = gap / TAU, Rmax = Math.sqrt(Rin * Rin + 2 * a * SPINE);
      var rs = Math.sqrt(Math.max(Rmax * Rmax - 2 * a * sFromTail, Rin * Rin));
      var kc = 1 / rs, ka = 1 / 7.5;
      var kap = lerp(ka, kc, f);
      pts.push([x, y]);
      th += kap * SEG;
      x += SEG * Math.cos(th); y += SEG * Math.sin(th);
    }
    // pts[0] = tail tip ... pts[N-1] = neck; centre the coil
    var cx = 0, cy = 0; for (i = 0; i < N; i++) { cx += pts[i][0]; cy += pts[i][1]; } cx /= N; cy /= N;
    for (i = 0; i < N; i++) {
      var q = pts[N - 1 - i], s2 = i * SEG;
      var lift = tuck * 0.95 * sstep(3.2, 0.6, s2);
      o.pos[i * 3] = -(q[0] - cx); o.pos[i * 3 + 1] = -(q[1] - cy); o.pos[i * 3 + 2] = radius(s2) + lift;
    }
  }
  scene({ id: '14-coil', title: 'Сворачивание и укрытие головы', dur: 1.14, loop: 0, keys: [0, 0.42, 0.86, 1.14], omega: 30, anchor: N - 1,
    pose: function (t, o) {
      var f = keyAt([[0, 0], [0.42, 0.55], [0.86, 1], [1.14, 1]], t), tuck = keyAt([[0, 0], [0.86, 0], [1.14, 1]], t);
      coilPose(o, f, tuck);
      o.s.lookPitch = -0.15 * tuck;
    } });
  // constrict (p.21): coils around a neutral post; radius shrinks to contact
  var POST = { r: 0.5 };
  scene({ id: '15-constrict', title: 'Обвивание и сжатие', dur: 1.2, loop: 0, keys: [0, 0.4, 0.8, 1.2], omega: 26, anchor: 0, collide: false,
    props: [{ type: 'post', x: 0.6, y: 0, r: POST.r, h: 4.6 }],
    pose: function (t, o) {
      var R = keyAt([[0, 1.45], [0.4, 1.22], [0.8, 1.06], [1.2, POST.r + 0.5]], t);
      var pitch = keyAt([[0, 1.3], [0.4, 1.18], [0.8, 1.08], [1.2, 1.03]], t);
      // head part on the ground to the left, then a helix around the post rising toward the tail
      var pts = [], u, headLen = 3.0, cx = 0.6;
      for (u = 0; u <= 40; u += 0.03) {
        if (u < headLen) pts.push(cx - R - (headLen - u) * 0.95, -0.35 - (headLen - u) * 0.3, 0);
        else {
          var a = (u - headLen) / R, z = Math.min(pitch * a / TAU, 3.6);
          pts.push(cx - R * Math.cos(a), -R * Math.sin(a), z);
        }
      }
      var path = new Path(pts);
      for (var i = 0; i < N; i++) {
        path.at(i * SEG, _pa);   // node 0 = start of the free head stretch, the helix runs toward the tail
        o.pos[i * 3] = _pa[0]; o.pos[i * 3 + 1] = _pa[1]; o.pos[i * 3 + 2] = radius(i * SEG) + _pa[2];
      }
      o.s.lookYaw = 0;
    } });
  // climb (p.22): a loose helix around a slanted branch, sliding up it
  var BR = { r: 0.28, ang: 0.95, rad: 0.86 };
  function branchPt(u, phase) {
    var dir = [Math.cos(BR.ang), 0, Math.sin(BR.ang)], side = [0, 1, 0], up = [-Math.sin(BR.ang), 0, Math.cos(BR.ang)];
    var turnLen = 3.1, a = TAU * u / turnLen + phase, along = u * 0.62;
    var c = Math.cos(a) * BR.rad, s = Math.sin(a) * BR.rad;
    return [dir[0] * along + side[0] * c + up[0] * s, dir[1] * along + side[1] * c + up[1] * s, dir[2] * along + side[2] * c + up[2] * s];
  }
  scene({ id: '16-climb', title: 'Подъём по наклонной ветке', dur: 1.05, loop: 0, keys: [0, 0.35, 0.7, 1.05], omega: 30, collide: false,
    props: [{ type: 'branch', ang: BR.ang, r: BR.r, len: 11, x: -3.2, z: -2.6 }],
    pose: function (t, o) {
      // grip zones hold while the neighbour moves: the head advances in steps
      var adv = 0.9 * (t / 1.05) + 0.12 * Math.sin(TAU * t / 0.7);
      for (var i = 0; i < N; i++) {
        var u = 9 - i * SEG + adv * 2.2, p = branchPt(u, 0);
        o.pos[i * 3] = p[0] - 3.2; o.pos[i * 3 + 1] = p[1]; o.pos[i * 3 + 2] = p[2] - 2.6 + 1.1;
      }
    } });
  var PLANK = { z: 0.55, gapL: -3.6, gapR: -2.0 };
  scene({ id: '17-bridge', title: 'Переход между опорами', dur: 1.18, loop: 0, keys: [0, 0.36, 0.75, 1.18], omega: 30,
    props: [{ type: 'plank', x0: -9, x1: PLANK.gapL, z: PLANK.z }, { type: 'plank', x0: PLANK.gapR, x1: 9, z: PLANK.z }],
    pose: function (t, o) {
      var u = keyAt([[0, -1.6], [0.36, -2.7], [0.75, -3.95], [1.18, -5.2]], t), i;
      for (i = 0; i < N; i++) {
        var s = i * SEG, x = u + s;
        // unsupported stretch over the gap: a stiff cantilever with a little droop at the head
        var over = x > PLANK.gapL && x < PLANK.gapR, droop = 0;
        if (u > PLANK.gapL - 0.2 && u < PLANK.gapR) { var fr = clamp((PLANK.gapR - x) / 1.6, 0, 1); droop = -0.12 * fr * fr * (x < PLANK.gapR ? 1 : 0); }
        o.pos[i * 3] = x; o.pos[i * 3 + 1] = 0.03 * Math.sin(s); o.pos[i * 3 + 2] = PLANK.z + radius(s) + droop + (over ? 0 : 0);
      }
    } });
  scene({ id: '18-swim', title: 'Плавание', dur: 1, loop: 0, keys: [0, 0.25, 0.5, 0.75], omega: 40, bg: '#DDEBEA',
    pose: function (t, o) { serp(o, t, 1.45, 9.5, 1.3, function (s) { return 0.1 + 0.9 * Math.pow(s / SPINE, 0.9); }); } });
  scene({ id: '19-strike', title: 'Бросок и возврат', dur: 0.33, loop: 0, keys: [0, 0.06, 0.12, 0.33], omega: 30,
    pose: function (t, o, rig) {
      // rear holds: a loose loop behind, the front ready in an S (the strike overlay does the rest)
      layHeading(o.pos, -2.4, 0.6, function (s) { return 0.05 - 1.7 * sstep(4.4, 8.2, s) + 1.5 * sstep(9, 12.5, s); });
      if (rig) { rig.strikeT = t; rig.strikeDir = PI; if (t < 0.33) { rig.strikeW.x = 1; rig.strikeW.v = 0; } }
    } });
  scene({ id: '20-righting', title: 'Возврат из положения на спине', dur: 0.68, loop: 0, keys: [0, 0.18, 0.42, 0.68],
    pose: function (t, o) {
      layHeading(o.pos, X0, 0.1, restCurve);
      for (var i = 0; i < N; i++) {
        var d = i / (N - 1) * 0.22;   // the roll travels from the head to the tail
        o.roll[i] = PI * (1 - ease((t - 0.05 - d) / 0.5));
      }
    } });

  W.SohoSnake3D = {
    THREE: function () { return W.THREE; },
    N: N, SEG: SEG, SPINE: SPINE, LEN: LEN, HEAD_FWD: HEAD_FWD, radius: radius,
    Rig: Rig, View: View, Path: Path, Pose: Pose, Scenes: Scenes,
    layPath: layPath, layHeading: layHeading, pathFrom: pathFrom, keyAt: keyAt, spring: spring,
    util: { clamp: clamp, lerp: lerp, sstep: sstep, ease: ease, wrapA: wrapA },
    keys: { JAW: JAW_KEYS, TONGUE_EXT: TONGUE_EXT, TONGUE_PITCH: TONGUE_PITCH, STRIKE_M: STRIKE_M }
  };
})();
