/* ae studio — interactions for the redesigned blocks (rooms multicam, FAQ chat, backstage-pass form).
 * Plain IIFE, no globals, no dependencies. Every feature is guarded: a missing element or an exception
 * in one block never breaks another, and everything degrades to working native HTML:
 *   - Multicam: native radios + CSS :has pick the camera; JS only adds the CUT flash, the light flicker,
 *     the running timecode and keeps the selected preview in view on the mobile strip.
 *   - Chat: rendered from the <details> FAQ list (which stays as the no-JS fallback).
 *   - Pass: the form keeps every main.js hook; JS adds the pass number, the live name, pointer sheen,
 *     gentle swing/tilt (mouse only, never while typing, never with reduced motion) and the stamp.
 */
(function () {
  'use strict';

  var win = window;
  var doc = document;
  var NBSP = ' ';

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return win.performance && performance.now ? performance.now() : Date.now(); }
  function raf(fn) { return (win.requestAnimationFrame || function (f) { return setTimeout(function () { f(now()); }, 16); })(fn); }
  function warn(name, err) { if (win.console && console.warn) console.warn('[ae blocks] ' + name + ' skipped:', err); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function mq(q) {
    try { return win.matchMedia(q); } catch (e) { return { matches: false, addEventListener: function () {} }; }
  }
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  var mqHover = mq('(hover: hover) and (pointer: fine)');
  function reduced() { return mqReduce.matches || doc.documentElement.classList.contains('reduced-motion'); }
  /* the on-page «Остановить анимацию» toggle (main.js: html.motion-paused + an 'ae:motion' event) */
  function paused() { return doc.documentElement.classList.contains('motion-paused'); }
  function onMq(list, fn) {
    if (list.addEventListener) list.addEventListener('change', fn);
    else if (list.addListener) list.addListener(fn);
  }

  /* restart a CSS animation class */
  function pulseClass(el, cls, ms, timerKey) {
    el.classList.remove(cls);
    void el.offsetWidth;                 // reflow so the animation restarts
    el.classList.add(cls);
    clearTimeout(el[timerKey]);
    el[timerKey] = setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  /* ============================================================== A · MULTICAM */
  function initMulticam() {
    var mc = $('[data-mc]');
    if (!mc) return;
    var radios = $$('input[name="mc-cam"]', mc);
    var light = $('[data-mc-light]', mc);
    var strip = $('[data-mc-strip]', mc);

    function current() {
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i];
      return null;
    }
    function reveal(radio, smooth) {
      if (!strip || !radio) return;
      if (strip.scrollWidth <= strip.clientWidth + 2) return;      // desktop grid: nothing to scroll
      var card = radio.closest('.cam');
      if (!card) return;
      var left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
      strip.scrollTo({ left: clamp(left, 0, strip.scrollWidth - strip.clientWidth), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    }

    radios.forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        if (!reduced()) pulseClass(mc, 'is-cut', 260, '_cutT');
        reveal(r, true);
      });
      /* Enter selects too (Space and arrows are native for radios) */
      r.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || r.checked) return;
        e.preventDefault();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    if (light) {
      light.addEventListener('change', function () {
        mc.classList.remove('is-flicker');
        if (light.checked && !reduced()) pulseClass(mc, 'is-flicker', 1000, '_flickT');
      });
    }

    /* keep the on-air preview visible on the mobile strip after layout changes; only a real width change
       counts (mobile browsers fire resize when the URL bar shows / hides, which must not undo a swipe) */
    var resizeT = 0, lastW = win.innerWidth;
    win.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        if (win.innerWidth === lastW) return;
        lastW = win.innerWidth;
        reveal(current(), false);
      }, 150);
    });

    /* REC timecode, 25 fps, only while the console is on screen */
    var tcs = $$('[data-mc-timecode]', mc);
    if (!tcs.length) return;
    var t0 = now() - 754000;               // start "12:34" into the take — feels live
    var inView = false, loopId = 0, lastText = '';
    function render() {
      var ms = now() - t0;
      var s = Math.floor(ms / 1000);
      var ff = reduced() ? 0 : Math.floor(ms / 40) % 25;
      var text = pad(Math.floor(s / 3600) % 100) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(ff);
      if (text === lastText) return;
      lastText = text;
      for (var i = 0; i < tcs.length; i++) tcs[i].textContent = text;
    }
    /* 25 fps display: one tick per timecode frame (40 ms), not a 60 fps loop; frozen while paused */
    function loop() {
      render();
      if (!inView || paused()) { loopId = 0; return; }
      loopId = setTimeout(loop, reduced() ? 500 : 40);
    }
    render();
    if (win.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView && !loopId) loop();
      }).observe(mc);
    }
    doc.addEventListener('ae:motion', function () { if (inView && !loopId) loop(); });
  }

  /* ============================================================== B · CHAT */
  function initChat() {
    var chat = $('[data-chat]');
    var acc = $('[data-accordion]');
    if (!chat || !acc) return;
    var log = $('[data-chat-log]', chat);
    var chipsBox = $('[data-chat-chips]', chat);
    var statusEl = $('[data-chat-status]', chat);
    var countEl = $('[data-chat-count]', chat);
    if (!log || !chipsBox) return;

    var items = $$('details', acc).filter(function (d) { return !d.hidden; }).map(function (d, i) {
      var sum = $('summary', d);
      var ans = $('.acc__a', d) || d;
      var q = sum ? sum.textContent.replace(/\s+/g, ' ').trim() : '';
      return { q: q, ans: ans, i: i, asked: false, bubble: null, chip: null };
    }).filter(function (it) { return it.q; });
    if (!items.length) return;

    function clock() {
      var d = new Date();
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function scrollLog(target) {
      var top = target ? Math.max(0, target.offsetTop - 24) : log.scrollHeight;
      if (log.scrollTo) log.scrollTo({ top: top, behavior: reduced() ? 'auto' : 'smooth' });
      else log.scrollTop = top;
    }

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function srOnly(text) { var s = el('span', 'sr-only', text); return s; }

    function managerMsg(nodes, animate) {
      var m = el('div', 'msg msg--in' + (animate ? ' is-new' : ''));
      var av = el('span', 'msg__avatar', 'ae');
      av.setAttribute('aria-hidden', 'true');
      var b = el('div', 'msg__bubble');
      b.appendChild(srOnly('ae' + NBSP + 'studio: '));
      nodes.forEach(function (n) { b.appendChild(n); });
      var meta = el('p', 'msg__meta');
      meta.setAttribute('aria-hidden', 'true');
      meta.appendChild(el('b', null, 'ae' + NBSP + 'studio'));
      meta.appendChild(doc.createTextNode(' · ' + clock()));
      m.appendChild(av); m.appendChild(b); m.appendChild(meta);
      log.appendChild(m);
      return m;
    }
    function userMsg(text, animate) {
      var m = el('div', 'msg msg--out' + (animate ? ' is-new' : ''));
      var b = el('div', 'msg__bubble');
      b.appendChild(srOnly('Ты: '));
      b.appendChild(doc.createTextNode(text));
      var meta = el('p', 'msg__meta');
      meta.setAttribute('aria-hidden', 'true');
      meta.appendChild(doc.createTextNode('ты · ' + clock()));
      meta.appendChild(el('span', 'msg__ticks'));
      m.appendChild(b); m.appendChild(meta);
      log.appendChild(m);
      return m;
    }
    function answerNodes(it) {
      return Array.prototype.map.call(it.ans.children.length ? it.ans.children : [it.ans], function (n) { return n.cloneNode(true); });
    }
    function para(text) { var p = el('p'); p.textContent = text; return p; }

    function updateCount() {
      if (!countEl) return;
      var n = items.filter(function (it) { return it.asked; }).length;
      countEl.textContent = n + '/' + items.length;
    }
    function markAsked(it) {
      it.asked = true;
      if (!it.chip) return;
      it.chip.classList.add('is-asked');
      var note = $('.qchip__state', it.chip);
      if (note) note.textContent = ' — ответ уже в' + NBSP + 'чате';
      updateCount();
    }

    /* typing indicator (decorative; the log announces the answer itself). The answers are prepared in
       advance, so the header never claims a live manager is online: a real one answers in Telegram. */
    var IDLE_STATUS = 'частые вопросы';
    var typingEl = null;
    function setTyping(on) {
      chat.classList.toggle('is-typing', on);
      if (statusEl) statusEl.textContent = on ? 'печатает…' : IDLE_STATUS;
      if (on && !typingEl) {
        typingEl = el('div', 'msg msg--in msg--typing is-new');
        typingEl.setAttribute('aria-hidden', 'true');
        var av = el('span', 'msg__avatar', 'ae');
        var b = el('div', 'msg__bubble');
        b.appendChild(el('i')); b.appendChild(el('i')); b.appendChild(el('i'));
        typingEl.appendChild(av); typingEl.appendChild(b);
        log.appendChild(typingEl);
        scrollLog();
      } else if (!on && typingEl) {
        typingEl.remove(); typingEl = null;
      }
    }

    var queue = [], busy = false;
    function pump() {
      if (!queue.length) { busy = false; return; }
      busy = true;
      var it = queue.shift();
      userMsg(it.q, !reduced());
      scrollLog();
      var rm = reduced();
      setTimeout(function () {
        if (!rm) setTyping(true);
        setTimeout(function () {
          setTyping(false);
          it.bubble = managerMsg(answerNodes(it), !rm);
          scrollLog();
          setTimeout(pump, rm ? 0 : 260);
        }, rm ? 0 : 720);
      }, rm ? 0 : 320);
    }
    function ask(it) {
      if (it.asked && it.bubble) {                    // already answered → show it again
        scrollLog(it.bubble.previousElementSibling || it.bubble);
        pulseClass(it.bubble, 'is-flash', 1300, '_flashT');
        return;
      }
      if (it.queued) return;
      it.queued = true;
      markAsked(it);
      queue.push(it);
      if (!busy) pump();
    }

    /* chips */
    items.forEach(function (it) {
      var b = el('button', 'qchip');
      b.type = 'button';
      b.appendChild(doc.createTextNode(it.q));
      b.appendChild(el('span', 'sr-only qchip__state', ''));
      b.addEventListener('click', function () { ask(it); });
      b.addEventListener('focus', function () {   // the chip strip is masked at the edges: keep a focused chip fully visible
        try { b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) {}
      });
      it.chip = b;
      chipsBox.appendChild(b);
    });

    /* start state: a greeting and the first Q&A, so the panel is never empty */
    var day = el('p', 'chat__day', 'Сегодня');
    day.setAttribute('aria-hidden', 'true');
    log.appendChild(day);
    if (statusEl) statusEl.textContent = IDLE_STATUS;
    managerMsg([para('Привет! Здесь ответы на' + NBSP + 'частые вопросы' + NBSP + '— выбирай внизу. Живой менеджер ответит в' + NBSP + 'Telegram: @ae_studio_cam')], false);
    var first = items[0];
    userMsg(first.q, false);
    first.bubble = managerMsg(answerNodes(first), false);
    first.queued = true;
    markAsked(first);
    updateCount();

    acc.hidden = true;
    chat.hidden = false;
    log.scrollTop = 0;
  }

  /* ============================================================== C · BACKSTAGE PASS */
  function initPass() {
    var rig = $('[data-pass]');
    var pass = $('[data-pass-card]');
    if (!rig || !pass) return;
    var form = $('[data-form]', pass);

    /* pass number: random, kept for the visitor */
    var KEY = 'ae-studio:pass-no';
    var no = null;
    try { no = win.localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
    if (!/^\d{4}$/.test(no || '')) {
      no = String(1000 + Math.floor(Math.random() * 9000));
      try { win.localStorage.setItem(KEY, no); } catch (e) { /* ignore */ }
    }
    $$('[data-pass-no]', pass).forEach(function (n) { n.textContent = no; });

    /* the name printed on the pass follows the name field */
    var nameOut = $('[data-pass-name]', pass);
    var nameIn = form && form.elements.namedItem('name');
    function syncName() {
      if (!nameOut) return;
      var v = nameIn && typeof nameIn.value === 'string' ? nameIn.value.trim() : '';
      nameOut.textContent = v ? v.slice(0, 40) : (nameOut.getAttribute('data-empty') || '');
      nameOut.classList.toggle('is-empty', !v);
    }
    if (nameIn) {
      nameIn.addEventListener('input', syncName);
      nameIn.addEventListener('change', syncName);
    }
    syncName();
    setTimeout(syncName, 0);               // after main.js restores a saved draft

    /* «ПРИНЯТО»: watch the success panel main.js reveals */
    var success = form && $('[data-form-success]', form);
    if (success && win.MutationObserver) {
      var accepted = function () {
        if (success.hidden) return;
        pass.classList.add('is-accepted');
        swingKick(-2.2);
      };
      new MutationObserver(accepted).observe(success, { attributes: true, attributeFilter: ['hidden'] });
    }

    /* pointer sheen + gentle swing/tilt around the ring */
    var MAX_Y = 4.5, MAX_X = 3;
    var tx = 0, ty = 0, rx = 0, ry = 0;    // tilt target / current (deg)
    var sw = 0, sv = 0;                    // swing angle / velocity (deg, deg/s)
    var hx = .3, hy = .3, thx = .3, thy = .3;
    var id = 0, last = 0, hovering = false, lastPX = null, lastPT = 0;

    function typing() {
      var a = doc.activeElement;
      return !!(a && pass.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(radio|checkbox)$/.test(a.type));
    }
    function motionOK() { return mqHover.matches && !reduced() && !paused(); }

    function frame(t) {
      var dt = last ? Math.min(48, t - last) : 16.7;
      last = t;
      /* filling the form = a flat, still card: any focused control (text, radio, chip, checkbox, button) calms it */
      var calm = typing() || !motionOK() || !!(form && form.contains(doc.activeElement));
      var gx = (hovering && !calm) ? tx : 0;
      var gy = (hovering && !calm) ? ty : 0;
      var k = 1 - Math.pow(1 - .12, dt / 16.7);
      rx += (gy - rx) * k;
      ry += (gx - ry) * k;
      /* damped pendulum */
      var s = dt / 1000;
      sv += (-38 * sw - 3.2 * sv) * s;
      sw += sv * s;
      if (calm) { sw *= .9; sv *= .9; }
      hx += (thx - hx) * k; hy += (thy - hy) * k;

      var settled = Math.abs(gx - ry) + Math.abs(gy - rx) < .02 && Math.abs(sw) < .01 && Math.abs(sv) < .02 &&
                    Math.abs(thx - hx) + Math.abs(thy - hy) < .002;
      if (settled) { rx = gy; ry = gx; sw = 0; sv = 0; hx = thx; hy = thy; }
      var still = Math.abs(rx) < .01 && Math.abs(ry) < .01 && Math.abs(sw) < .01;
      pass.style.transform = still ? '' :
        'perspective(1300px) rotate(' + sw.toFixed(3) + 'deg) rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg)';
      pass.style.setProperty('--hx', hx.toFixed(4));
      pass.style.setProperty('--hy', hy.toFixed(4));
      if (!settled) id = raf(frame); else { id = 0; last = 0; }
    }
    function kick() { if (!id) id = raf(frame); }
    function swingKick(v) {
      if (!motionOK()) return;
      sv += v * 10;
      kick();
    }

    rig.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      hovering = true; lastPX = null; kick();
    });
    rig.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      /* over the form itself the card stays flat (no tilt, no swing): text and inputs must not drift
         under the cursor. Tilt and sheen live on the pass header and the stub. */
      var inForm = !!(form && e.target && form.contains(e.target));
      var t = e.timeStamp || now();
      if (inForm) {
        tx = ty = 0; lastPX = null;
        hovering = true; kick();
        return;
      }
      var r = pass.getBoundingClientRect();
      var px = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
      var py = clamp((e.clientY - r.top) / (r.height || 1), 0, 1);
      thx = px; thy = py;
      tx = (px - .5) * 2 * MAX_Y;
      ty = -(py - .5) * 2 * MAX_X;
      /* a quick sideways brush nudges the pendulum */
      if (lastPX !== null && motionOK() && !typing()) {
        var vx = (e.clientX - lastPX) / Math.max(8, t - lastPT);      // px/ms
        sv += clamp(vx, -3, 3) * .7;
      }
      lastPX = e.clientX; lastPT = t;
      hovering = true; kick();
    });
    rig.addEventListener('pointerleave', function () { hovering = false; lastPX = null; kick(); });
    pass.addEventListener('focusin', kick);

    /* a soft sway the first time the pass scrolls into view */
    if (win.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries[entries.length - 1].isIntersecting) return;
        io.disconnect();
        setTimeout(function () { if (motionOK()) { sv += 11; kick(); } }, 350);
      }, { threshold: .35 });
      io.observe(rig);
    }
    function settleNow() { if (!motionOK()) { sw = sv = rx = ry = 0; pass.style.transform = ''; } }
    onMq(mqReduce, settleNow);
    doc.addEventListener('ae:motion', settleNow);
  }

  /* ============================================================== BOOT */
  var inits = [['multicam', initMulticam], ['chat', initChat], ['pass', initPass]];
  function boot() {
    for (var i = 0; i < inits.length; i++) {
      try { inits[i][1](); } catch (e) { warn(inits[i][0], e); }
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
