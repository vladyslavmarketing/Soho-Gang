/* A | B compare: clip A (video) is the clock, B (iframe b.html) is slaved to it frame by frame.
   Without a clip, an internal clock drives B. */
(function () {
  'use strict';
  var SRC = window.SNAKE_SOURCES || {}, FPS = SRC.fps || 30;
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), va = $('va'), fb = $('fb'), scrub = $('scrub'), cut = $('cut');
  var playing = true, dur = 6, nFrames = 180, clockT = 0, last = 0, bReady = false, hasA = false;

  // B: embedded, paused (it only draws what we seek to)
  var bq = 'embed&paused' + (SRC.bQuery ? '&' + SRC.bQuery : '');
  fb.src = 'b.html?' + bq;
  if (SRC.clipA) {
    // whole clip as a blob: exact frame seeking even where the host does not serve byte ranges
    if (SRC.clipAPoster) va.poster = SRC.clipAPoster;
    fetch(SRC.clipA).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(function (bl) { va.src = URL.createObjectURL(bl); })
      .catch(function () { va.src = SRC.clipA; });
    va.addEventListener('loadedmetadata', function () {
      hasA = true; dur = va.duration || dur;
      if (va.videoWidth) stage.style.setProperty('--ar', va.videoWidth + ' / ' + va.videoHeight);   // panes follow the clip (CamHero is 1408×768) nFrames = Math.round(dur * FPS); scrub.max = nFrames - 1;
      if (playing) { va.currentTime = clockT; va.play().catch(function () {}); } else gotoFrame(frameOf(clockT));   // keep the frame chosen before the clip arrived
    });
    va.addEventListener('error', function () { hasA = false; });
  }
  if (SRC.placeholder) $('note').textContent = 'Заглушка: пока нет экспорта из Blender, A — клип, записанный с той же сцены в более высоком качестве, B — простая трубка со скелетом. После экспорта сюда встанут snake.glb и клип Cycles.';

  function bSend(msg) { try { fb.contentWindow.postMessage(msg, '*'); } catch (e) { /* noop */ } }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'b-ready') { bReady = true; if (!hasA) { dur = d.duration; nFrames = Math.round(dur * FPS); scrub.max = nFrames - 1; } }
    if (d.type === 'b-stats') $('bstat').textContent = 'B: отрисовка ' + d.ms.toFixed(1) + ' мс · ' + Math.round(d.fps) + ' fps';
  });

  function now() { return hasA ? va.currentTime : clockT; }
  function frameOf(t) { return Math.min(nFrames - 1, Math.floor(t * FPS + 1e-4)); }
  function show(t) {
    var n = frameOf(t);
    $('frame').textContent = 'кадр ' + n + ' / ' + nFrames;
    $('time').textContent = t.toFixed(3) + ' с';
    if (document.activeElement !== scrub) scrub.value = n;
    if (bReady) bSend({ cmd: 'seek', t: playing ? t : n / FPS });
  }
  function setPlaying(v) {
    playing = v;
    $('play').textContent = v ? '❚❚ пауза' : '▶ играть'; $('play').setAttribute('aria-label', v ? 'Пауза' : 'Играть');
    if (hasA) { if (v) va.play().catch(function () {}); else va.pause(); }
  }
  function gotoFrame(n) {
    n = ((n % nFrames) + nFrames) % nFrames;
    setPlaying(false);
    var t = n / FPS;
    if (hasA) va.currentTime = t + 0.25 / FPS; else clockT = t;
    show(t);
  }
  function tick(ts) {
    var dt = last ? (ts - last) / 1000 : 0; last = ts;
    if (playing && !hasA) clockT = (clockT + Math.min(dt, 0.1)) % dur;
    if (playing || !hasA) show(now());
    requestAnimationFrame(tick);
  }
  $('play').addEventListener('click', function () { setPlaying(!playing); });
  $('prev').addEventListener('click', function () { gotoFrame(frameOf(now()) - 1); });
  $('next').addEventListener('click', function () { gotoFrame(frameOf(now()) + 1); });
  scrub.addEventListener('input', function () { gotoFrame(+scrub.value); });
  va.addEventListener('seeked', function () { if (!playing) show(Math.floor(va.currentTime * FPS + 1e-4) / FPS); });
  document.addEventListener('keydown', function (e) {
    if (e.target && /input|button/i.test(e.target.tagName) && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); gotoFrame(frameOf(now()) - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); gotoFrame(frameOf(now()) + 1); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function (r) {
    r.addEventListener('change', function () { stage.classList.toggle('curtain', r.value === 'curtain' && r.checked); });
  });
  cut.addEventListener('input', function () { stage.style.setProperty('--cut', cut.value + '%'); });
  var q = new URLSearchParams(location.search);
  if (q.get('mode') === 'curtain') { $('m-curtain').checked = true; stage.classList.add('curtain'); }
  if (q.has('frame')) { playing = false; setTimeout(function () { gotoFrame(+q.get('frame')); }, 0); }
  requestAnimationFrame(tick);
})();
