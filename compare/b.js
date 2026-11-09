/*!
 * Snake B — the Blender model in real time (three.js r147 + GLTFLoader).
 *   Loads <exportBase>/snake.glb (glTF 2.0, Y up, 1 unit = body diameter): skinned skin mesh, skeleton,
 *   clip "idle_lookaround", camera "CamHero". Fur = shells over the skinned mesh: the base pass plus K copies
 *   pushed along the skinned normal, cut by fur_strands (R height/mask, G random, B clump), with sheen.
 *   Without an export (sources.js: exportBase null) it builds a placeholder tube with the same structure.
 *   Control: window.B.{seek, play, pause}; from the compare page also via postMessage.
 */
(function () {
  'use strict';
  var THREE = window.THREE, PI = Math.PI;
  var SRC = window.SNAKE_SOURCES || {};
  var q = new URLSearchParams(location.search);
  if (q.has('embed')) document.body.classList.add('embed');
  if (q.has('transparent')) document.body.style.background = 'transparent';
  var CAPTURE = q.has('capture'), DEBUG_STRANDS = q.has('debugStrands');   // frame capture: draw only on seek (tools/capture)
  var BASE = q.get('base') || SRC.exportBase || null;

  var canvas = document.getElementById('c'), hud = document.getElementById('hud');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: q.has('capture') });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

  // studio light rig (replaced by the export's lights when it has KHR_lights_punctual)
  var rig = new THREE.Group(); scene.add(rig);
  var key = new THREE.DirectionalLight(0xfff1ec, 1.5); key.position.set(-6, 10, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  var sc = key.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 0.5; sc.far = 40;
  rig.add(key); rig.add(key.target);
  var fill = new THREE.DirectionalLight(0xffe4ea, 0.35); fill.position.set(8, 4, 6); rig.add(fill);
  var rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(0, 6, -10); rig.add(rim);
  rig.add(new THREE.HemisphereLight(0xfff3f3, 0xc98e9c, 0.2));
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.22, color: 0x5a2238 }));
  ground.rotation.x = -PI / 2; ground.receiveShadow = true; scene.add(ground);

  var camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  var mixer = null, action = null, duration = 6, fps = 30, time = 0, playing = !q.has('paused');
  var settings = { furLength: 0.1, shells: 24, tile: 2, gravity: 0.35, sheen: '#e98aa4', sheenAmount: 0.7, envIntensity: 0.3, exposure: 1.1 };

  ['furLength', 'shells', 'tile', 'gravity', 'exposure', 'sheenAmount', 'envIntensity'].forEach(function (k) { if (q.has(k)) settings[k] = +q.get(k); });   // tuning from the URL
  var URLSET = {}; ['furLength', 'shells', 'tile', 'gravity', 'exposure'].forEach(function (k) { if (q.has(k)) URLSET[k] = 1; });

  /* ---------------- fur shells ---------------- */
  var strandsTex = null;
  function makeStrands() {   // placeholder fur_strands: R height/mask, G random, B clump (tileable)
    var n = 512, cv = document.createElement('canvas'); cv.width = cv.height = n;
    var g = cv.getContext('2d'), img = g.createImageData(n, n), d = img.data, cells = 96, cs = n / cells, i, x, y;
    var R = new Float32Array(n * n), G = new Float32Array(n * n);
    function rnd(a, b) { var s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
    for (var cy = 0; cy < cells; cy++) for (var cx = 0; cx < cells; cx++) {
      var px = (cx + 0.2 + 0.6 * rnd(cx, cy)) * cs, py = (cy + 0.2 + 0.6 * rnd(cy + 7, cx + 3)) * cs;
      var len = 0.55 + 0.45 * rnd(cx + 11, cy + 5), rr = cs * 0.46, id = rnd(cx + 31, cy + 17);
      for (y = Math.floor(py - rr); y <= py + rr; y++) for (x = Math.floor(px - rr); x <= px + rr; x++) {
        var dd = Math.hypot(x - px, y - py) / rr; if (dd >= 1) continue;
        var k = ((y + n) % n) * n + ((x + n) % n), v = len * (1 - dd);
        if (v > R[k]) { R[k] = v; G[k] = id; }
      }
    }
    for (i = 0; i < n * n; i++) {
      x = i % n; y = (i / n) | 0;
      var clump = 0.5 + 0.25 * Math.sin(x / n * PI * 8) * Math.cos(y / n * PI * 6) + 0.25 * Math.sin((x + y) / n * PI * 14);
      d[i * 4] = R[i] * 255; d[i * 4 + 1] = G[i] * 255; d[i * 4 + 2] = clump * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; strandFilter(t);
    return t;
  }
  // strand masks must not be averaged by mipmaps (the shells would lose their tips at a distance)
  function strandFilter(t) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; }
  function furMaterial(src, h) {
    var m = new THREE.MeshPhysicalMaterial({
      map: src.map || null, normalMap: src.normalMap || null, color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      roughness: 0.9, metalness: 0, specularIntensity: 0.25, sheen: settings.sheenAmount * h, sheenRoughness: 0.4, sheenColor: new THREE.Color(settings.sheen), envMapIntensity: settings.envIntensity * (0.25 + 0.75 * h)
    });
    if (src.normalScale && m.normalMap) m.normalScale.copy(src.normalScale);
    m.userData.h = h;
    m.onBeforeCompile = function (s) {
      s.uniforms.uShell = { value: h }; s.uniforms.uFur = { value: settings.furLength };
      s.uniforms.uStrands = { value: strandsTex }; s.uniforms.uTile = { value: settings.tile }; s.uniforms.uGrav = { value: settings.gravity };
      m.userData.shader = s;
      s.vertexShader = 'uniform float uShell; uniform float uFur; uniform float uTile; uniform float uGrav; varying vec2 vFurUv;\n' +
        s.vertexShader
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += normalize(objectNormal) * uFur * uShell;\n  transformed.y -= uGrav * uFur * uShell * uShell;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vFurUv = uv * uTile;');
      s.fragmentShader = 'uniform float uShell; uniform sampler2D uStrands; varying vec2 vFurUv;\n' +
        s.fragmentShader.replace('#include <map_fragment>', [
          '#include <map_fragment>',
          '  vec4 fs = texture2D(uStrands, vFurUv);',
          '  if (uShell > 0.001 && fs.r < uShell) discard;',
          '  diffuseColor.rgb *= mix(0.36, 1.08, pow(uShell, 0.7)) * mix(0.92, 1.08, fs.g) * mix(0.94, 1.04, fs.b);',
          DEBUG_STRANDS ? '  diffuseColor.rgb = vec3(fs.r);' : ''
        ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'fur-shell'; };
    return m;
  }
  // K shells over one mesh (skinned or static), sharing its geometry and skeleton
  function furify(mesh) {
    var K = settings.shells, src = mesh.material, parent = mesh.parent, list = [];
    mesh.material = furMaterial(src, 0); mesh.castShadow = true; mesh.receiveShadow = true;
    for (var k = 1; k < K; k++) {
      var h = k / (K - 1), sh;
      if (mesh.isSkinnedMesh) { sh = new THREE.SkinnedMesh(mesh.geometry, furMaterial(src, h)); sh.bind(mesh.skeleton, mesh.bindMatrix); sh.bindMode = mesh.bindMode; }
      else sh = new THREE.Mesh(mesh.geometry, furMaterial(src, h));
      sh.position.copy(mesh.position); sh.quaternion.copy(mesh.quaternion); sh.scale.copy(mesh.scale);
      sh.renderOrder = k; sh.frustumCulled = false; sh.name = mesh.name + '_shell' + k;
      parent.add(sh); list.push(sh);
    }
    mesh.frustumCulled = false;
    return list;
  }

  /* ---------------- placeholder model (same structure as the export contract) ---------------- */
  function bandTexture() {
    var w = 2048, h = 64, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var g = cv.getContext('2d'); g.fillStyle = '#D7899A'; g.fillRect(0, 0, w, h);
    for (var k = 0; k < 12; k++) {   // 12 cream rings with black edges along u (tail -> head)
      var c = (0.08 + k * 0.071) * w, wc = 0.016 * w, wb = 0.007 * w;
      g.fillStyle = '#1E1618'; g.fillRect(c - wc - wb, 0, 2 * (wc + wb), h);
      g.fillStyle = '#F4EADB'; g.fillRect(c - wc, 0, 2 * wc, h);
    }
    var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function buildPlaceholder() {
    var L = 16, NB = 40, NR = 220, NA = 28, seg = L / NB;
    function rad(x) {   // x from tail (0) to snout (L)
      var r = 0.5;
      if (x < L * 0.36) r *= 0.06 + 0.94 * Math.pow(x / (L * 0.36), 0.9);
      if (x > L - 1.2) r *= Math.sqrt(Math.max(0, 1 - Math.pow((x - (L - 1.2)) / 1.2, 2.6))) * 1.0 + 0.0;
      return Math.max(r, 0.004);
    }
    var pos = [], nor = [], uv = [], si = [], sw = [], idx = [], i, j;
    for (i = 0; i <= NR; i++) {
      var x = L * i / NR, r = rad(x), b = Math.min(NB - 1, Math.floor(x / seg)), f = x / seg - b;
      for (j = 0; j <= NA; j++) {
        var a = 2 * PI * j / NA, cy = Math.sin(a), cz = Math.cos(a);
        pos.push(x, r * cy * (cy < 0 ? 0.9 : 1), r * cz); nor.push(0, cy, cz);
        uv.push(x / L, (j / NA) * PI / L);   // isotropic: 1 uv unit = L along and around
        var b2 = Math.min(NB - 1, b + 1);
        si.push(b, b2, 0, 0); sw.push(1 - f, f, 0, 0);
      }
    }
    for (i = 0; i < NR; i++) for (j = 0; j < NA; j++) { var p = i * (NA + 1) + j; idx.push(p, p + 1, p + NA + 1, p + 1, p + NA + 2, p + NA + 1); }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    var bones = [], prev = null;
    for (i = 0; i < NB; i++) {
      var bn = new THREE.Bone(); bn.name = i === NB - 1 ? 'Head' : 'Spine_' + i;
      bn.position.set(i === 0 ? 0 : seg, 0, 0);
      if (prev) prev.add(bn); prev = bn; bones.push(bn);
    }
    var skel = new THREE.Skeleton(bones);
    var mat = new THREE.MeshStandardMaterial({ map: bandTexture(), roughness: 0.85 });
    var mesh = new THREE.SkinnedMesh(geo, mat); mesh.name = 'Skin';
    var root = new THREE.Group(); root.name = 'Snake';
    root.add(bones[0]); root.add(mesh);
    // eyes and tongue on the head bone
    var head = bones[NB - 1], eyeM = new THREE.MeshPhysicalMaterial({ color: 0x0a0607, roughness: 0.05, clearcoat: 1 });
    [-1, 1].forEach(function (s) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), eyeM); e.name = s < 0 ? 'EyeR' : 'EyeL'; e.position.set(0.28, 0.1, 0.4 * s); head.add(e); });
    var tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xd9788f, roughness: 0.4 })); tongue.name = 'TongueMesh';
    tongue.geometry.rotateZ(PI / 2); tongue.geometry.translate(0.3, 0, 0);
    var tg = new THREE.Group(); tg.name = 'Tongue'; tg.position.set(0.55, -0.12, 0); tg.add(tongue); tg.scale.set(0.001, 1, 1); head.add(tg);
    // lay it on the ground (centre height = radius) and centre it
    root.position.set(-L / 2, 0.5, 0);
    // clip "idle_lookaround": lying S, the front raised, breathing, looking around, two tongue flicks
    var T = 6, F = 30, times = [], tracks = [];
    for (i = 0; i <= T * F; i += 3) times.push(i / F);
    function keysAt(fn) { var out = []; times.forEach(function (t) { var qq = fn(t); out.push(qq.x, qq.y, qq.z, qq.w); }); return out; }
    var qy = new THREE.Quaternion(), qz = new THREE.Quaternion(), qo = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    function look(t) { // yaw / pitch of the head, keyed: centre, left, centre up, right, centre
      var k = [[0, 0, 0.05], [1.5, 0.75, 0.0], [3, 0, 0.25], [4.5, -0.75, 0.0], [6, 0, 0.05]], a = k[0], b = k[1];
      for (var n = 0; n < k.length - 1; n++) if (t >= k[n][0] && t <= k[n + 1][0]) { a = k[n]; b = k[n + 1]; break; }
      var u = (t - a[0]) / (b[0] - a[0]); u = u * u * (3 - 2 * u);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    bones.forEach(function (bn, n) {
      if (n === 0) return;
      var s = n / NB;
      tracks.push(new THREE.QuaternionKeyframeTrack(bn.name + '.quaternion', times, keysAt(function (t) {
        var lk = look(t);
        var yaw = 0.16 * Math.sin(2 * PI * s * 1.3 + 0.6) * (s < 0.8 ? 1 : 0.4);            // lying S curve
        var pitch = 0;
        if (s > 0.72 && s < 0.9) pitch = 0.11;                                              // the front rises...
        if (s >= 0.9) pitch = -0.1;                                                         // ...and levels the head
        if (s > 0.8) { yaw += lk[0] * (s > 0.95 ? 0.22 : 0.06); pitch += lk[1] * (s > 0.95 ? 0.25 : 0.03); }
        qy.setFromAxisAngle(Y, yaw); qz.setFromAxisAngle(Z, pitch);
        return qo.copy(qy).multiply(qz);
      })));
      if (s > 0.25 && s < 0.65) {   // breathing: volume round the ribs
        tracks.push(new THREE.VectorKeyframeTrack(bn.name + '.scale', times, (function () {
          var o = []; times.forEach(function (t) { var b = 1 + 0.035 * Math.sin(2 * PI * t / 3) * Math.sin(PI * (s - 0.25) / 0.4); o.push(1, b, b); }); return o;
        })()));
      }
    });
    var tt = [0, 2.0, 2.045, 2.095, 2.17, 4.6, 4.645, 4.695, 4.77, 6], ts = [];
    [0.001, 0.001, 1, 1, 0.001, 0.001, 1, 1, 0.001, 0.001].forEach(function (v) { ts.push(v, 1, 1); });
    tracks.push(new THREE.VectorKeyframeTrack('Tongue.scale', tt, ts));
    var clip = new THREE.AnimationClip('idle_lookaround', T, tracks);
    var cam = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200); cam.name = 'CamHero';
    cam.position.set(0.5, 6.0, 14.5); cam.lookAt(0.5, 0.7, 0);
    root.updateMatrixWorld(true); mesh.bind(skel);
    return { scene: root, animations: [clip], cameras: [cam], placeholder: true };
  }

  /* ---------------- setup from a glTF (or the placeholder) ---------------- */
  var furMeshes = [];
  function setup(gltf, man) {
    man = man || {};
    if (man.furLength && !URLSET.furLength) settings.furLength = man.furLength;
    if (man.shells && !URLSET.shells) settings.shells = man.shells;
    if (man.strandsTiling && !URLSET.tile) settings.tile = man.strandsTiling;
    if (man.exposure && !URLSET.exposure) settings.exposure = man.exposure;
    renderer.toneMappingExposure = settings.exposure;
    var root = gltf.scene; scene.add(root);
    var lights = [], skip = (man.noFur || ['eye', 'tongue', 'mouth', 'teeth', 'cam', 'nofur']).map(function (s) { return s.toLowerCase(); });
    var targets = [];
    root.traverse(function (o) {
      if (o.isLight) lights.push(o);
      if (o.isMesh) {
        var nm = (o.name + ' ' + (o.material && o.material.name || '')).toLowerCase();
        if (skip.some(function (s) { return nm.indexOf(s) >= 0; })) { o.castShadow = true; return; }
        targets.push(o);
      }
    });
    if (lights.length) { rig.visible = false; lights.forEach(function (l) { if (l.isDirectionalLight || l.isSpotLight) l.castShadow = true; }); }
    targets.forEach(function (o) { furMeshes = furMeshes.concat(furify(o)); });
    var cam = null;
    (gltf.cameras || []).forEach(function (c) { if (!cam || c.name === 'CamHero' || (c.parent && c.parent.name === 'CamHero')) cam = c; });
    if (cam) { camera = cam; camera.updateMatrixWorld(); }
    var clip = (gltf.animations || []).filter(function (a) { return a.name === 'idle_lookaround'; })[0] || (gltf.animations || [])[0];
    if (clip) {
      mixer = new THREE.AnimationMixer(root); action = mixer.clipAction(clip); action.play();
      duration = clip.duration || 6;
    }
    if (man.fps) fps = man.fps;
    resize(); seek(0);
    hud.textContent = (gltf.placeholder ? 'заглушка' : 'snake.glb') + ' · ' + settings.shells + ' слоёв меха';
    window.B.ready = true;
    post({ type: 'b-ready', duration: duration, fps: fps, placeholder: !!gltf.placeholder });
  }

  /* ---------------- time / render loop ---------------- */
  function seek(t) {
    time = ((t % duration) + duration) % duration;
    if (mixer) { action.time = time; mixer.update(0); }
    draw();
  }
  var stats = { ms: 0, fps: 0, frames: 0 }, last = 0, acc = 0, cnt = 0, dirty = true;
  function draw() {
    var t0 = performance.now();
    if (camera.parent) camera.updateMatrixWorld();
    renderer.render(scene, camera);
    var ms = performance.now() - t0; stats.ms += (ms - stats.ms) * 0.1;
  }
  function loop(now) {
    var dt = last ? (now - last) / 1000 : 0; last = now;
    if (dt > 0) { acc += dt; cnt++; if (acc > 0.5) { stats.fps = cnt / acc; acc = 0; cnt = 0; post({ type: 'b-stats', ms: stats.ms, fps: stats.fps, t: time }); } }
    if (playing && window.B.ready) {
      time = (time + Math.min(dt, 0.1)) % duration;
      if (mixer) { action.time = time; mixer.update(0); }
    }
    if (window.B.ready && !CAPTURE && (playing || dirty)) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }
  function resize() {
    var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    if (camera.isPerspectiveCamera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
    dirty = true;
  }
  function post(msg) { try { if (window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) { /* noop */ } }
  window.addEventListener('resize', resize);
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.cmd === 'seek') { seek(d.t); }
    if (d.cmd === 'play') { playing = true; if (d.t != null) seek(d.t); }
    if (d.cmd === 'pause') { playing = false; if (d.t != null) seek(d.t); }
  });
  window.B = {
    ready: false, stats: stats, settings: settings, scene: scene, renderer: renderer,
    seek: function (t) { seek(t); }, play: function () { playing = true; }, pause: function () { playing = false; },
    get time() { return time; }, get duration() { return duration; }
  };

  /* ---------------- boot ---------------- */
  strandsTex = makeStrands();
  if (!BASE) { setup(buildPlaceholder(), null); }
  else {
    var man = SRC.manifest || {};
    var tl = new THREE.TextureLoader();
    var strandsUrl = BASE + (man.furStrands || 'fur_strands.webp');
    tl.load(strandsUrl, function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; strandFilter(t); t.needsUpdate = true; strandsTex = t; furMeshes.forEach(function (m) { var s = m.material.userData.shader; if (s) s.uniforms.uStrands.value = t; }); });
    new THREE.GLTFLoader().load(BASE + (man.model || 'snake.glb'), function (g) { setup(g, man); }, undefined, function () { setup(buildPlaceholder(), null); });
  }
  requestAnimationFrame(loop);
})();
