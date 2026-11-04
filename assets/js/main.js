/*!
 * ae studio — main.js
 * All page interactions except the snake engine (snake.js). Vanilla, zero dependencies, plain IIFE.
 * Every feature is a small init function wrapped in try/catch: a missing element or a missing
 * window.SohoSnake can never break the rest of the page.
 *
 * Shared plumbing
 *   - one passive scroll listener, rAF-throttled, fanned out to subscribers (onScroll)
 *   - one layout hub (window resize + ResizeObserver on <body>), rAF-throttled (onLayout)
 *   - motion flags kept live from matchMedia (state.reduced / state.hover)
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var body = doc.body;
  var win = window;

  /* ------------------------------------------------------------------ helpers */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function now() { return win.performance && performance.now ? performance.now() : Date.now(); }
  /* frame-rate independent lerp factor: `k` is the per-60fps-frame factor */
  function lerpK(k, dt) { return 1 - Math.pow(1 - k, clamp(dt, 0, 100) / 16.667); }
  function raf(fn) { return (win.requestAnimationFrame || function (f) { return setTimeout(function () { f(now()); }, 16); })(fn); }
  function caf(id) { (win.cancelAnimationFrame || clearTimeout)(id); }
  function warn(name, err) { if (win.console && console.warn) console.warn('[ae] ' + name + ' skipped:', err); }
  function safe(fn, arg) { try { fn(arg); } catch (e) { warn('handler', e); } }

  var NBSP = ' ';
  var NNBSP = ' ';

  function mq(query) {
    if (win.matchMedia) return win.matchMedia(query);
    return { matches: false, addEventListener: function () {}, addListener: function () {} };
  }
  function onMq(list, fn) {
    if (list.addEventListener) list.addEventListener('change', fn);
    else if (list.addListener) list.addListener(fn);
  }

  var mqHover = mq('(hover: hover) and (pointer: fine)');
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  var mqDesktop = mq('(min-width: 960px)');

  var state = { hover: mqHover.matches, reduced: mqReduce.matches };
  var motionFns = [];
  function onMotionChange(fn) { motionFns.push(fn); }

  /* Group thousands: 1560 -> "1 560" (narrow no-break space by default) */
  function groupNum(n, sep) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep || NNBSP); }

  /* Russian plural: 1 зритель / 2 зрителя / 5 зрителей */
  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b > 1 && b < 5) return forms[1];
    return forms[2];
  }

  /* layout position of `el` inside `ancestor` (ignores transforms / translate) */
  function offsetWithin(el, ancestor) {
    var x = 0, y = 0, node = el;
    while (node && node !== ancestor) {
      x += node.offsetLeft; y += node.offsetTop;
      node = node.offsetParent;
    }
    if (node === ancestor) return { x: x, y: y };
    var a = ancestor.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - a.left, y: r.top - a.top };
  }

  /* ------------------------------------------------------------------ shared scroll + layout hubs */
  var scrollFns = [];
  var layoutFns = [];
  var scrollQueued = false;
  var layoutQueued = false;

  function onScroll(fn) { scrollFns.push(fn); }
  function onLayout(fn) { layoutFns.push(fn); }

  function runScroll() {
    scrollQueued = false;
    var y = win.pageYOffset || root.scrollTop || 0;
    for (var i = 0; i < scrollFns.length; i++) safe(scrollFns[i], y);
  }
  function queueScroll() { if (!scrollQueued) { scrollQueued = true; raf(runScroll); } }
  function runLayout() {
    layoutQueued = false;
    for (var i = 0; i < layoutFns.length; i++) safe(layoutFns[i]);
    runScroll();
  }
  function queueLayout() { if (!layoutQueued) { layoutQueued = true; raf(runLayout); } }

  win.addEventListener('scroll', queueScroll, { passive: true });
  win.addEventListener('resize', queueLayout, { passive: true });
  win.addEventListener('load', queueLayout);
  if (win.ResizeObserver) {
    try { new ResizeObserver(queueLayout).observe(body); } catch (e) { /* ignore */ }
  }

  /* ================================================================== FLAGS */
  function initFlags() {
    function setHover() {
      state.hover = mqHover.matches;
      root.classList.toggle('has-hover', state.hover);
    }
    function setReduced() {
      state.reduced = mqReduce.matches;
      root.classList.toggle('reduced-motion', state.reduced);
      for (var i = 0; i < motionFns.length; i++) safe(motionFns[i], state.reduced);
    }
    setHover(); setReduced();
    onMq(mqHover, setHover);
    onMq(mqReduce, setReduced);

    /* is-loaded: after the brand fonts are in (max 1.2s), two frames later so the
       hidden intro state has been painted at least once and the transition runs. */
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      raf(function () { raf(function () { root.classList.add('is-loaded'); }); });
    }
    setTimeout(finish, 1200);
    var fonts = doc.fonts;
    if (fonts && fonts.ready) {
      var loads = [];
      try {
        if (fonts.load) {
          loads.push(fonts.load('800 1em Onest'), fonts.load('400 1em Onest'));
        }
      } catch (e) { /* ignore */ }
      Promise.all(loads).catch(function () {}).then(function () { return fonts.ready; }).then(finish, finish);
    } else {
      finish();
    }
  }

  /* ================================================================== NAV */
  function initNav() {
    var nav = $('[data-nav]');
    if (nav) {
      var scrolled = null;
      var update = function (y) {
        var s = y > 24;
        if (s !== scrolled) { scrolled = s; nav.classList.toggle('is-scrolled', s); }
      };
      onScroll(update);
      update(win.pageYOffset || 0);
    }

    /* aria-current: the section crossing the middle of the viewport */
    var links = $$('[data-nav-link], [data-menu-link]').filter(function (a) {
      return /^#[\w-]+$/.test(a.getAttribute('href') || '');
    });
    if (!links.length || !win.IntersectionObserver) return;
    var byId = {};
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      (byId[id] = byId[id] || []).push(a);
    });
    var sections = Object.keys(byId).map(function (id) { return doc.getElementById(id); }).filter(Boolean);
    var visible = {};
    var current = null;

    function setCurrent(id) {
      if (id === current) return;
      current = id;
      links.forEach(function (a) { a.removeAttribute('aria-current'); });
      if (id && byId[id]) byId[id].forEach(function (a) { a.setAttribute('aria-current', 'true'); });
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var pick = null;
      sections.forEach(function (s) { if (visible[s.id]) pick = s.id; });   // last in document order
      setCurrent(pick);
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ================================================================== MOBILE MENU */
  function initMenu() {
    var toggle = $('[data-menu-toggle]');
    var menu = $('[data-menu]');
    if (!toggle || !menu) return;

    var label = $('.sr-only', toggle);
    var inertTargets = [$('main'), $('footer')].filter(Boolean);
    var isOpen = false;
    var closing = null;

    function focusables() {
      var list = $$('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', menu);
      return [toggle].concat(list.filter(function (el) { return el.offsetParent !== null || el === doc.activeElement; }));
    }

    function onKey(e) {
      if (!isOpen) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      var active = doc.activeElement;
      var inside = items.indexOf(active) !== -1;
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      if (closing) { try { closing.cancel(); } catch (e) { /* ignore */ } closing = null; }
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      if (label) label.textContent = 'Закрыть меню';
      body.classList.add('menu-open');
      inertTargets.forEach(function (el) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); });
      doc.addEventListener('keydown', onKey);
      var firstLink = $('a[href]', menu);
      if (firstLink) {
        try { firstLink.focus({ preventScroll: true }); } catch (e) { firstLink.focus(); }
      }
    }

    function close(restoreFocus) {
      if (!isOpen) return;
      isOpen = false;
      toggle.setAttribute('aria-expanded', 'false');
      if (label) label.textContent = 'Открыть меню';
      body.classList.remove('menu-open');
      inertTargets.forEach(function (el) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); });
      doc.removeEventListener('keydown', onKey);
      if (restoreFocus) {
        try { toggle.focus({ preventScroll: true }); } catch (e) { toggle.focus(); }
      }
      /* soft fade-out, then hide */
      if (!state.reduced && menu.animate) {
        closing = menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
        closing.onfinish = function () { closing = null; if (!isOpen) menu.hidden = true; };
      } else {
        menu.hidden = true;
      }
    }

    toggle.addEventListener('click', function () { if (isOpen) close(true); else open(); });
    menu.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('a[href], [data-menu-link]');
      if (link) close(false);              // let the anchor navigate; focus follows the target
    });
    onMq(mqDesktop, function () { if (mqDesktop.matches) close(false); });
  }

  /* ================================================================== CURSOR (pom-pom + ring) */
  function initCursor() {
    var cur = $('.cursor');
    if (!cur) return;
    var ring = $('.cursor__ring', cur);
    var dot = $('.cursor__dot', cur);
    if (!ring || !dot) return;

    var HOVER_SEL = 'a[href], button, summary, label, select, textarea, input:not([type="hidden"]), [role="button"], [data-magnetic], [data-room-switch]';
    var tx = -100, ty = -100, rx = tx, ry = ty, dx = tx, dy = ty;
    var running = false, shown = false, last = 0;

    function paint() {
      ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
      dot.style.transform = 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0)';
    }
    /* hidden state: class for the stylesheet + inline opacity so no hover rule can override it */
    function setShown(on) {
      shown = on;
      cur.classList.toggle('is-hidden', !on);
      cur.style.opacity = on ? '' : '0';
    }
    paint();                 // park it offscreen until the first real mouse move
    setShown(false);
    function tick(t) {
      var dt = last ? t - last : 16.667;
      last = t;
      if (state.reduced) { rx = dx = tx; ry = dy = ty; }
      else {
        var kr = lerpK(0.18, dt), kd = lerpK(0.5, dt);
        rx += (tx - rx) * kr; ry += (ty - ry) * kr;
        dx += (tx - dx) * kd; dy += (ty - dy) * kd;
      }
      paint();
      if (Math.abs(tx - rx) + Math.abs(ty - ry) > 0.1) raf(tick);
      else { running = false; last = 0; }
    }
    function start() { if (!running) { running = true; raf(tick); } }
    function hide() { if (shown) setShown(false); }

    win.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (!state.hover) return;
      tx = e.clientX; ty = e.clientY;
      if (!shown) {
        rx = dx = tx; ry = dy = ty;
        paint();
        setShown(true);
      }
      start();
    }, { passive: true });

    doc.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hide(); });
    win.addEventListener('blur', hide);

    doc.addEventListener('pointerover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest(HOVER_SEL) : null;
      cur.classList.toggle('is-hover', !!t);
    }, { passive: true });
    win.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') cur.classList.add('is-down');
    }, { passive: true });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      win.addEventListener(type, function () { cur.classList.remove('is-down'); }, { passive: true });
    });
  }

  /* ================================================================== MAGNETIC */
  function initMagnetic() {
    var MAX = 8;
    $$('[data-magnetic]').forEach(function (el) {
      var x = 0, y = 0, txx = 0, tyy = 0, id = 0, last = 0;
      function tick(t) {
        var dt = last ? t - last : 16.667;
        last = t;
        var k = lerpK(0.2, dt);
        x += (txx - x) * k; y += (tyy - y) * k;
        if (Math.abs(txx - x) + Math.abs(tyy - y) < 0.05) { x = txx; y = tyy; }
        el.style.transform = (x || y) ? 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)' : '';
        if (x !== txx || y !== tyy) id = raf(tick);
        else { id = 0; last = 0; }
      }
      function kick() { if (!id) id = raf(tick); }
      el.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' || !state.hover || state.reduced) return;
        var r = el.getBoundingClientRect();
        var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
        var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 || 1);
        txx = clamp(nx, -1, 1) * MAX;
        tyy = clamp(ny, -1, 1) * MAX * 0.75;
        kick();
      });
      el.addEventListener('pointerleave', function () { txx = 0; tyy = 0; kick(); });
    });
  }

  /* ================================================================== REVEAL */
  function initReveal() {
    var els = $$('[data-reveal]');
    if (!els.length || !win.IntersectionObserver) return;     // no IO → nothing is ever hidden
    if (state.reduced) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }

    var vh = win.innerHeight || root.clientHeight;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.remove('is-pending');
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top >= vh) {              // starts below the fold → hide until it scrolls in
        el.classList.add('is-pending');
        io.observe(el);
      } else {
        el.classList.add('is-in');
      }
    });

    /* if the user switches to reduced motion mid-way, show everything */
    onMotionChange(function (reduced) {
      if (!reduced) return;
      $$('[data-reveal].is-pending').forEach(function (el) {
        el.classList.remove('is-pending'); el.classList.add('is-in'); io.unobserve(el);
      });
    });
  }

  /* ================================================================== SPOTLIGHT + TILT */
  function initSpotlightTilt() {
    var MAX_TILT = 6;
    $$('[data-spotlight], [data-tilt]').forEach(function (el) {
      var spot = el.hasAttribute('data-spotlight');
      var tilt = el.hasAttribute('data-tilt');
      var px = 0.5, py = 0.5, hovering = false;
      var rxv = 0, ryv = 0, id = 0, last = 0;

      function tick(t) {
        var dt = last ? t - last : 16.667;
        last = t;
        var r = el.getBoundingClientRect();
        if (spot && hovering) {
          el.style.setProperty('--mx', (px * r.width).toFixed(1) + 'px');
          el.style.setProperty('--my', (py * r.height).toFixed(1) + 'px');
        }
        var trx = 0, tryy = 0;
        if (tilt && hovering && !state.reduced) {
          trx = -(py - 0.5) * 2 * MAX_TILT * 0.7;
          tryy = (px - 0.5) * 2 * MAX_TILT;
        }
        var k = lerpK(0.14, dt);
        rxv += (trx - rxv) * k; ryv += (tryy - ryv) * k;
        var settled = Math.abs(trx - rxv) + Math.abs(tryy - ryv) < 0.02;
        if (settled) { rxv = trx; ryv = tryy; }
        if (tilt) {
          el.style.transform = (rxv || ryv)
            ? 'perspective(1100px) rotateX(' + rxv.toFixed(3) + 'deg) rotateY(' + ryv.toFixed(3) + 'deg)'
            : '';
        }
        if (!settled) id = raf(tick);              // pointermove re-kicks while hovering
        else { id = 0; last = 0; }
      }
      function kick() { if (!id) id = raf(tick); }

      el.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse' || !state.hover) return;
        hovering = true; kick();
      });
      el.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' || !state.hover) return;
        var r = el.getBoundingClientRect();
        px = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
        py = clamp((e.clientY - r.top) / (r.height || 1), 0, 1);
        hovering = true; kick();
      });
      el.addEventListener('pointerleave', function () { hovering = false; kick(); });
    });
  }

  /* ================================================================== HERO (snake + viewfinder) */
  function initHero() {
    var hero = $('[data-hero]');
    if (!hero) return;
    var canvas = $('[data-snake-canvas]', hero);
    var written = false;
    function markWritten() {
      if (written) return;
      written = true;
      hero.classList.add('is-written');
    }

    var engine = win.SohoSnake;
    if (canvas && engine && typeof engine.mount === 'function') {
      canvas.addEventListener('snake:written', markWritten);
      try {
        engine.mount(canvas, { mode: 'logo', pointerTarget: hero, reducedMotion: state.reduced });
        setTimeout(markWritten, 4000);                 // safety net
      } catch (e) {
        warn('hero snake', e);
        markWritten();
      }
    } else {
      markWritten();                                     // no engine → show "studio" right away
    }

    /* hint copy for touch devices */
    var hint = $('[data-hero-hint]', hero);
    if (hint && !state.hover) hint.textContent = 'Коснись — она поползёт за' + NBSP + 'тобой';

    /* timecode HH:MM:SS:FF @ 25 fps, only ticking while the hero is on screen */
    var tc = $('[data-timecode]', hero);
    if (!tc) return;
    var t0 = now();
    var lastText = '';
    var inView = true;
    var loopId = 0;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function render() {
      var ms = now() - t0;
      var total = Math.floor(ms / 40);                  // 25 fps frames
      var ff = state.reduced ? 0 : total % 25;
      var s = Math.floor(ms / 1000);
      var text = pad(Math.floor(s / 3600) % 100) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(ff);
      if (text !== lastText) { tc.textContent = text; lastText = text; }
    }
    function loop() {
      render();
      if (!inView) { loopId = 0; return; }
      loopId = state.reduced ? setTimeout(function () { raf(loop); }, 250) : raf(loop);
    }
    loop();
    if (win.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView && !loopId) loop();
      }).observe(hero);
    }
  }

  /* ================================================================== BAND DASHES
     Builds a static dasharray for a "scales" stroke (cream bands) laid over a body stroke that is
     revealed with dasharray "T T" + dashoffset (T - L). Using the SAME dashoffset on both strokes,
     the bands stay anchored behind the head and slide with it, like a crawling snake.
     Pattern space: [0, T) holds the bands (anchored at T = the tip), [T, 2T) is empty. */
  function bandDashArray(T, band, period, headClear) {
    var starts = [];
    for (var a = T - headClear - band; a > -band; a -= period) starts.push(a);
    starts.reverse();
    var arr = [0];
    var cursor = 0;
    for (var i = 0; i < starts.length; i++) {
      var s = Math.max(starts[i], 0);
      var len = starts[i] + band - s;
      if (len <= 0.5) continue;
      arr.push(+(s - cursor).toFixed(2), +len.toFixed(2));
      cursor = s + len;
    }
    arr.push(+(2 * T - cursor).toFixed(2));
    if (arr.length % 2) arr.push(0);
    return arr.join(' ');
  }

  /* ================================================================== CALCULATOR + GAUGE */
  function initCalculator() {
    var form = $('[data-calc]');
    if (!form) return;
    var hoursIn = form.elements.namedItem('hours');
    var daysIn = form.elements.namedItem('days');
    var outHours = $('[data-out="hours"]');
    var outDays = $('[data-out="days"]');
    var incomeEl = $('[data-income]');
    var subEl = $('[data-income-sub]');
    var gauge = $('[data-gauge]');
    var fill = $('[data-gauge-fill]');
    var scales = $('[data-gauge-scales]');
    var head = $('[data-gauge-head]');
    var readout = incomeEl ? incomeEl.closest('[aria-live]') : null;

    var MAX = 12000;
    var R = 160;
    var C = 2 * Math.PI * R;                 // ≈ 1005.3
    var HEAD_AHEAD = 12;                     // head centre sits beyond the tip so it swallows the round cap
    var HEAD_SCALE = 1.36;                   // 20×15 ellipse → a plush head a touch wider than the 34px body

    if (fill) { fill.style.strokeDasharray = C.toFixed(2) + ' ' + C.toFixed(2); }
    if (scales) { scales.style.strokeDasharray = bandDashArray(C, 11, 57, 34); }

    function num(input, fallback) {
      var v = input ? parseFloat(input.value) : NaN;
      return isFinite(v) ? v : fallback;
    }
    function rate() {
      var r = $('input[name="level"]:checked', form);
      return r ? num(r, 12) : 12;
    }
    function compute() {
      var weekly = rate() * num(hoursIn, 6) * num(daysIn, 5);
      return { m: Math.round(weekly * 4.33 / 10) * 10, w: Math.round(weekly / 10) * 10 };
    }

    var shown = { m: 0, w: 0 };
    function renderGauge(m) {
      var p = clamp(m / MAX, 0, 1);
      var L = p * C;
      var off = (C - L).toFixed(2);
      if (fill) fill.style.strokeDashoffset = off;
      if (scales) scales.style.strokeDashoffset = off;
      if (head) {
        var deg = (L + HEAD_AHEAD) / C * 360;          // 0deg = 12 o'clock, clockwise
        var th = (deg - 90) * Math.PI / 180;
        var x = 200 + R * Math.cos(th), y = 200 + R * Math.sin(th);
        head.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') rotate(' + deg.toFixed(2) + ') scale(' + HEAD_SCALE + ')');
      }
    }
    function render(v) {
      if (incomeEl) incomeEl.textContent = '$' + groupNum(Math.round(v.m / 10) * 10);
      if (subEl) subEl.textContent = '≈ $' + groupNum(Math.round(v.w / 10) * 10) + ' в' + NBSP + 'неделю';
      renderGauge(v.m);
    }

    var tweenId = 0;
    function animateTo(target, duration) {
      caf(tweenId);
      if (state.reduced || !duration) {
        shown = { m: target.m, w: target.w };
        render(shown);
        if (readout) readout.removeAttribute('aria-busy');
        return;
      }
      var from = { m: shown.m, w: shown.w };
      var t0 = now();
      if (readout) readout.setAttribute('aria-busy', 'true');
      (function step() {
        var t = clamp((now() - t0) / duration, 0, 1);
        var e = easeOutCubic(t);
        shown = { m: from.m + (target.m - from.m) * e, w: from.w + (target.w - from.w) * e };
        render(shown);
        if (t < 1) tweenId = raf(step);
        else { tweenId = 0; if (readout) readout.removeAttribute('aria-busy'); }
      })();
    }

    var introDone = false;
    function update() {
      if (outHours && hoursIn) outHours.textContent = hoursIn.value;
      if (outDays && daysIn) outDays.textContent = daysIn.value;
      introDone = true;
      animateTo(compute(), 600);
    }
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    /* range fill (for browsers styling via a --p custom property) */
    [hoursIn, daysIn].forEach(function (input) {
      if (!input) return;
      var setP = function () {
        var min = num({ value: input.min }, 0), max = num({ value: input.max }, 100);
        input.style.setProperty('--p', ((num(input, min) - min) / ((max - min) || 1) * 100).toFixed(1) + '%');
      };
      input.addEventListener('input', setP);
      setP();
    });

    /* first appearance: the plush ring grows from zero when the gauge scrolls into view */
    var target = compute();
    if (!state.reduced && gauge && win.IntersectionObserver) {
      shown = { m: 0, w: 0 };
      render(shown);
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.disconnect();
          if (introDone) return;
          setTimeout(function () { if (!introDone) { introDone = true; animateTo(compute(), 1500); } }, 220);
        });
      }, { threshold: 0.35 });
      io.observe(gauge);
    } else {
      shown = { m: target.m, w: target.w };
      render(shown);
    }
  }

  /* ================================================================== ROOMS RAIL */
  function initRooms() {
    var rail = $('[data-rail]');
    var prev = $('[data-rail-prev]');
    var next = $('[data-rail-next]');
    var bar = $('[data-rail-progress]');

    /* light switches work even without the rail */
    $$('[data-room-switch]').forEach(function (btn) {
      var room = btn.closest('[data-room]') || btn.closest('.room');
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? 'Выключить свет' : 'Включить свет';
        if (room) room.classList.toggle('is-lit', on);
      });
    });

    if (!rail) return;
    var maxScroll = 0;

    function measure() { maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth); }
    function setDisabled(btn, off) {
      if (!btn) return;
      if (off) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    }
    var queued = false;
    function sync() {
      queued = false;
      var x = rail.scrollLeft;
      var ratio = maxScroll > 0 ? clamp(x / maxScroll, 0, 1) : 1;
      if (bar) bar.style.transform = 'scaleX(' + Math.max(0.15, ratio).toFixed(4) + ')';
      setDisabled(prev, x <= 2);
      setDisabled(next, x >= maxScroll - 2);
    }
    function queue() { if (!queued) { queued = true; raf(sync); } }
    rail.addEventListener('scroll', queue, { passive: true });
    onLayout(function () { measure(); queue(); });
    measure(); sync();

    /* snap positions in scroll coordinates (respecting scroll-padding) */
    function snapPoints() {
      var rr = rail.getBoundingClientRect();
      var cs = getComputedStyle(rail);
      /* scroll-padding may come back unresolved (e.g. "max(48px, 50% - 592px)");
         the rail's padding-left uses the same --rail-pad and is always resolved */
      var pad = parseFloat(cs.scrollPaddingLeft);
      if (!isFinite(pad) || !/^-?[\d.]+px$/.test(cs.scrollPaddingLeft.trim())) pad = parseFloat(cs.paddingLeft) || 0;
      return $$('[data-room]', rail).map(function (card) {
        return clamp(card.getBoundingClientRect().left - rr.left + rail.scrollLeft - pad, 0, maxScroll);
      });
    }
    function stepSize() {
      var cards = $$('[data-room]', rail);
      if (cards.length > 1) return cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left;
      return rail.clientWidth * 0.8;
    }
    function go(dir) {
      measure();
      var pts = snapPoints();
      var x = rail.scrollLeft;
      var targetX = clamp(x + dir * stepSize(), 0, maxScroll);
      if (pts.length) {
        var ahead = pts.filter(function (p) { return dir > 0 ? p > x + 4 : p < x - 4; });
        targetX = ahead.length ? (dir > 0 ? ahead[0] : ahead[ahead.length - 1]) : (dir > 0 ? maxScroll : 0);
      }
      rail.scrollTo({ left: targetX, behavior: state.reduced ? 'auto' : 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { if (prev.getAttribute('aria-disabled') !== 'true') go(-1); });
    if (next) next.addEventListener('click', function () { if (next.getAttribute('aria-disabled') !== 'true') go(1); });

    /* mouse drag-to-scroll (touch & trackpads scroll natively) */
    var down = false, dragging = false, suppress = false;
    var startX = 0, startLeft = 0, lastX = 0, lastT = 0, vel = 0, pid = null, settleTimer = 0;

    rail.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; dragging = false;
      startX = lastX = e.clientX; lastT = e.timeStamp || now();
      startLeft = rail.scrollLeft; vel = 0; pid = e.pointerId;
      measure();
    });
    rail.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 6) return;
        dragging = true;
        clearTimeout(settleTimer);
        rail.classList.add('is-dragging');
        rail.style.scrollBehavior = 'auto';
        rail.style.scrollSnapType = 'none';
        try { rail.setPointerCapture(pid); } catch (err) { /* ignore */ }
      }
      var t = e.timeStamp || now();
      var dt = Math.max(1, t - lastT);
      vel = vel * 0.6 + ((e.clientX - lastX) / dt) * 0.4;   // px/ms, smoothed
      lastX = e.clientX; lastT = t;
      rail.scrollLeft = clamp(startLeft - dx, 0, maxScroll);
      e.preventDefault();
    });
    function release(e) {
      if (!down || (e && e.pointerId !== pid)) return;
      down = false;
      if (!dragging) return;
      dragging = false;
      suppress = true;
      setTimeout(function () { suppress = false; }, 60);
      try { rail.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      rail.classList.remove('is-dragging');
      /* glide to the nearest card in the throw direction, then restore snapping */
      var projected = rail.scrollLeft - vel * 220;
      var pts = snapPoints();
      var best = projected, bestD = Infinity;
      pts.concat([maxScroll]).forEach(function (p) {
        var d = Math.abs(p - projected);
        if (d < bestD) { bestD = d; best = p; }
      });
      rail.scrollTo({ left: best, behavior: state.reduced ? 'auto' : 'smooth' });
      var restored = false;
      var restore = function () {
        if (restored || dragging) return;
        restored = true;
        clearTimeout(settleTimer);
        rail.removeEventListener('scrollend', restore);
        rail.style.scrollSnapType = '';
        rail.style.scrollBehavior = '';
      };
      if ('onscrollend' in win) rail.addEventListener('scrollend', restore);
      settleTimer = setTimeout(restore, state.reduced ? 0 : 900);
    }
    rail.addEventListener('pointerup', release);
    rail.addEventListener('pointercancel', release);
    rail.addEventListener('lostpointercapture', function (e) { if (dragging) release(e); });
    rail.addEventListener('click', function (e) {
      if (suppress) { e.preventDefault(); e.stopPropagation(); suppress = false; }
    }, true);
    rail.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  /* ================================================================== PATH (snake crawls the 5 steps) */
  function initPath() {
    var track = $('[data-path]');
    if (!track) return;
    var svg = $('[data-path-svg]', track);
    var line = $('[data-path-line]', track);
    var bg = $('[data-path-bg]', track);
    var scales = $('[data-path-scales]', track);
    var head = $('[data-path-head]', track);
    var steps = $$('[data-step]', track);
    if (!svg || !line || !line.getTotalLength || !steps.length) return;

    /* black under-stroke: with the cream scales on top every band becomes the brand's
       black–cream–black triad (decorative, generated here so the markup stays clean) */
    var ink = null;
    if (scales && scales.parentNode) {
      ink = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      ink.setAttribute('class', 'path__scales-ink');
      ink.setAttribute('aria-hidden', 'true');
      ink.style.cssText = 'fill:none;stroke:#1E1618;stroke-linecap:butt;stroke-linejoin:round;';
      scales.parentNode.insertBefore(ink, scales);
    }

    /* the reveal's `translate` turns every .step into a stacking context, which would drop the
       beads (.step__num z-index 2) under the svg (z-index 1); lift the steps unless CSS already does */
    steps.forEach(function (s) {
      try { if (getComputedStyle(s).zIndex === 'auto') s.style.zIndex = '2'; } catch (e) { /* ignore */ }
    });

    var ANCHOR = 0.62;            // the head follows this line of the viewport
    var headScale = 1;
    var T = 0;                    // total path length
    var lutS = [], lutX = [], lutY = [];
    var stepLen = [];
    var trackTop = 0, vh = 0, lastW = -1, lastH = -1, lastMode = null;
    var cur = 0, target = 0, loopId = 0, last = 0, ready = false;

    function f(n) { return Math.round(n * 10) / 10; }

    /* uniform Catmull-Rom → cubic Bézier through points */
    function smoothThrough(pts) {
      var d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += ' C' + f(p1.x + (p2.x - p0.x) / 6) + ' ' + f(p1.y + (p2.y - p0.y) / 6) +
             ' ' + f(p2.x - (p3.x - p1.x) / 6) + ' ' + f(p2.y - (p3.y - p1.y) / 6) +
             ' ' + f(p2.x) + ' ' + f(p2.y);
      }
      return d;
    }

    function centres() {
      return steps.map(function (step) {
        var n = $('.step__num', step) || step;
        var o = offsetWithin(n, track);
        return { x: o.x + n.offsetWidth / 2, y: o.y + n.offsetHeight / 2 };
      });
    }

    function buildD(pts, W, desktop) {
      var gaps = 0;
      for (var i = 1; i < pts.length; i++) gaps += pts[i].y - pts[i - 1].y;
      var avg = pts.length > 1 ? gaps / (pts.length - 1) : 220;
      var first = pts[0], lastP = pts[pts.length - 1];

      if (desktop) {
        /* serpentine: smooth cubic S-curves between alternating sides, vertical tangents at each bead */
        var cx = W / 2;
        var start = { x: 2 * cx - first.x, y: first.y - avg * 0.62 };
        var end = { x: 2 * cx - lastP.x, y: lastP.y + avg * 0.56 };
        var all = [start].concat(pts, [end]);
        var d = 'M' + f(start.x) + ' ' + f(start.y);
        for (var j = 1; j < all.length; j++) {
          var a = all[j - 1], b = all[j], k = (b.y - a.y) * 0.56;
          d += ' C' + f(a.x) + ' ' + f(a.y + k) + ' ' + f(b.x) + ' ' + f(b.y - k) + ' ' + f(b.x) + ' ' + f(b.y);
        }
        return d;
      }

      /* mobile: near-vertical line at x≈22 with a gentle sine wiggle */
      var x0 = first.x || 22;
      var y0 = first.y - 64;
      var y1 = lastP.y + Math.min(120, avg * 0.45);
      var amp = 4.5, lambda = 190, stepY = lambda / 8;
      var samples = [];
      for (var y = y0; y < y1; y += stepY) samples.push({ x: x0 + amp * Math.sin((y - y0) / lambda * Math.PI * 2), y: y });
      samples.push({ x: x0 + amp * Math.sin((y1 - y0) / lambda * Math.PI * 2), y: y1 });
      return smoothThrough(samples);
    }

    function lengthAtY(y) {
      var n = lutY.length;
      if (!n) return 0;
      if (y <= lutY[0]) return 0;
      if (y >= lutY[n - 1]) return T;
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (lutY[mid] <= y) lo = mid; else hi = mid; }
      var span = lutY[hi] - lutY[lo] || 1;
      return lutS[lo] + (lutS[hi] - lutS[lo]) * (y - lutY[lo]) / span;
    }

    function rebuild() {
      var W = track.clientWidth, H = track.clientHeight;
      var desktop = mqDesktop.matches;
      if (!W || !H) return;
      if (W === lastW && H === lastH && desktop === lastMode && ready) return;
      lastW = W; lastH = H; lastMode = desktop;

      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      var d = buildD(centres(), W, desktop);
      [bg, line, ink, scales].forEach(function (p) { if (p) p.setAttribute('d', d); });

      T = line.getTotalLength();
      if (!(T > 0)) return;

      /* length lookup table (y is monotonic along both layouts) */
      lutS = []; lutX = []; lutY = [];
      var STEP = 4, maxY = -Infinity;
      for (var s = 0; s <= T + STEP - 0.001; s += STEP) {
        var L = Math.min(s, T);
        var pt = line.getPointAtLength(L);
        maxY = Math.max(maxY, pt.y);
        lutS.push(L); lutX.push(pt.x); lutY.push(maxY);
      }
      stepLen = centres().map(function (c) { return lengthAtY(c.y); });

      /* plush band pattern scaled to the stroke width */
      var sw = parseFloat(getComputedStyle(line).strokeWidth) || 16;
      line.style.strokeDasharray = T.toFixed(2) + ' ' + T.toFixed(2);
      var cream = Math.max(4, sw * 0.34), edge = Math.max(1.6, sw * 0.11);
      var period = Math.round(sw * 2.25), clear = 14 + sw * 0.5;
      if (scales) scales.style.strokeDasharray = bandDashArray(T, cream, period, clear);
      if (ink) {
        ink.style.strokeWidth = sw + 'px';
        ink.style.strokeDasharray = bandDashArray(T, cream + edge * 2, period, clear - edge);
      }
      /* head: ~1.25× the body on desktop, a touch smaller on the slim mobile line */
      headScale = clamp((sw * 1.3) / 30, 0.88, 1.2);

      ready = true;
      measureTop();
      if (state.reduced) cur = target = T;
      else { target = lengthAtY(win.pageYOffset + vh * ANCHOR - trackTop); cur = Math.min(cur, T); }
      render();
    }

    function measureTop() {
      vh = win.innerHeight || root.clientHeight;
      trackTop = track.getBoundingClientRect().top + (win.pageYOffset || 0);
    }

    function pointAt(L) {
      var n = lutS.length;
      if (!n) return { x: 0, y: 0, a: 90 };
      var i = clamp(Math.floor(L / 4), 0, n - 1);
      var j = clamp(i + 1, 0, n - 1);
      var t = j > i ? (L - lutS[i]) / ((lutS[j] - lutS[i]) || 1) : 0;
      var x = lutX[i] + (lutX[j] - lutX[i]) * t;
      var y = lutY[i] + (lutY[j] - lutY[i]) * t;
      /* tangent from a slightly wider window for a calm head */
      var a0 = clamp(i - 2, 0, n - 1), a1 = clamp(i + 3, 0, n - 1);
      if (a1 === a0) { a0 = clamp(n - 4, 0, n - 1); a1 = n - 1; }
      var ang = Math.atan2(lutY[a1] - lutY[a0], lutX[a1] - lutX[a0]) * 180 / Math.PI;
      return { x: x, y: y, a: ang };
    }

    function render() {
      if (!ready) return;
      var off = (T - cur).toFixed(2);
      line.style.strokeDashoffset = off;
      if (scales) scales.style.strokeDashoffset = off;
      if (ink) ink.style.strokeDashoffset = off;
      if (head) {
        var p = pointAt(cur);
        head.setAttribute('transform', 'translate(' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ') rotate(' + p.a.toFixed(2) + ') scale(' + headScale.toFixed(3) + ')');
      }
      for (var i = 0; i < steps.length; i++) {
        var on = cur >= (stepLen[i] || 0) - 14;
        if (on !== steps[i].classList.contains('is-active')) steps[i].classList.toggle('is-active', on);
      }
    }

    function tick(t) {
      var dt = last ? t - last : 16.667;
      last = t;
      cur += (target - cur) * lerpK(0.16, dt);
      if (Math.abs(target - cur) < 0.4) cur = target;
      render();
      if (cur !== target) loopId = raf(tick);
      else { loopId = 0; last = 0; }
    }
    function kick() { if (!loopId) loopId = raf(tick); }

    onScroll(function (y) {
      if (!ready) return;
      if (state.reduced) { if (cur !== T) { cur = target = T; render(); } return; }
      target = lengthAtY(y + vh * ANCHOR - trackTop);
      kick();
    });
    onLayout(function () { rebuild(); measureTop(); });
    onMotionChange(function () { lastW = -1; rebuild(); });
    if (win.ResizeObserver) {
      try { new ResizeObserver(function () { queueLayout(); }).observe(track); } catch (e) { /* ignore */ }
    }
    rebuild();
  }

  /* ================================================================== PRIVACY CONSOLE + GLOBE */
  function initPrivacy() {
    var stream = $('[data-stream]');
    var boxes = $$('[data-privacy]');
    var nameEl = $('[data-alias-name]');
    var geoStatus = $('[data-geo-status]');
    var viewersEl = $('[data-viewers]');
    var globe = null;

    function checked(key) {
      var box = boxes.filter(function (b) { return b.getAttribute('data-privacy') === key; })[0];
      return box ? box.checked : false;
    }

    /* viewers: geo-block hides your region, a mask costs a few; a tiny live jitter keeps it breathing */
    var shownViewers = 1284, targetViewers = 1284, jitter = 0, vTween = 0;
    function viewersTarget() { return 1284 + (checked('geo') ? 0 : 316) - (checked('mask') ? 58 : 0) + jitter; }
    function paintViewers(n) {
      if (!viewersEl) return;
      n = Math.round(n);
      viewersEl.textContent = groupNum(n, NBSP) + ' ' + plural(n, ['зритель', 'зрителя', 'зрителей']);
    }
    function tweenViewers() {
      targetViewers = viewersTarget();
      caf(vTween);
      if (state.reduced) { shownViewers = targetViewers; paintViewers(shownViewers); return; }
      var from = shownViewers, t0 = now();
      (function step() {
        var t = clamp((now() - t0) / 700, 0, 1);
        shownViewers = from + (targetViewers - from) * easeOutCubic(t);
        paintViewers(shownViewers);
        if (t < 1) vTween = raf(step);
      })();
    }

    function update(animate) {
      var geo = checked('geo'), alias = checked('alias'), mask = checked('mask');
      if (stream) {
        stream.classList.toggle('geo-on', geo);
        stream.classList.toggle('alias-on', alias);
        stream.classList.toggle('mask-on', mask);
      }
      if (nameEl) {
        var txt = alias ? nameEl.getAttribute('data-alias') : nameEl.getAttribute('data-real');
        if (txt && nameEl.textContent !== txt) {
          nameEl.textContent = txt;
          if (animate && nameEl.animate && !state.reduced) {
            nameEl.animate([{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }],
              { duration: 480, easing: 'cubic-bezier(.34,1.56,.64,1)' });
          }
        }
      }
      if (geoStatus) geoStatus.textContent = geo ? 'Скрыт от' + NBSP + 'зрителей' : 'Виден всем странам';
      if (animate) tweenViewers(); else { shownViewers = viewersTarget(); paintViewers(shownViewers); }
      if (globe) globe.setGeo(geo);
    }

    boxes.forEach(function (b) { b.addEventListener('change', function () { update(true); }); });

    var canvas = $('[data-globe]');
    if (canvas && canvas.getContext) {
      try { globe = createGlobe(canvas, checked('geo')); } catch (e) { warn('globe', e); }
    }
    update(false);

    /* gentle live jitter while the console is on screen */
    if (stream && win.IntersectionObserver) {
      var timer = 0;
      var tick = function () {
        if (!state.reduced) { jitter = clamp(jitter + Math.round((Math.random() - 0.45) * 7), -14, 18); tweenViewers(); }
        timer = setTimeout(tick, 2200 + Math.random() * 1600);
      };
      new IntersectionObserver(function (entries) {
        var vis = entries[entries.length - 1].isIntersecting;
        clearTimeout(timer);
        if (vis) timer = setTimeout(tick, 1800);
      }).observe(stream);
    }
  }

  /* Dotted globe: fibonacci sphere, orthographic, tilted so the home region (Moscow-ish) never
     turns its back on you. Geo OFF → region dots in REC red + open lock; ON → dim grey + lock ring. */
  function createGlobe(canvas, geoOn) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var N = 420;
    var GOLD = Math.PI * (3 - Math.sqrt(5));
    var CAP = Math.cos(18 * Math.PI / 180);
    var TILT = 35 * Math.PI / 180;
    var HOME_LAT = 55.75 * Math.PI / 180, HOME_LON = 37.6 * Math.PI / 180;
    var SPEED = (Math.PI * 2) / 34000;          // one turn per 34s

    var pts = [];
    for (var i = 0; i < N; i++) {
      var y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = i * GOLD;
      pts.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r, cap: false });
    }
    /* home vector in the same frame (x = cosφ·sinλ, y = sinφ, z = cosφ·cosλ) */
    var hx = Math.cos(HOME_LAT) * Math.sin(HOME_LON), hy = Math.sin(HOME_LAT), hz = Math.cos(HOME_LAT) * Math.cos(HOME_LON);
    pts.forEach(function (p) { p.cap = (p.x * hx + p.y * hy + p.z * hz) > CAP; });

    var w = 0, h = 0, dpr = 1;
    var rot = -HOME_LON - 0.7;                   // start with the region left of centre, drifting across
    var mix = geoOn ? 1 : 0, mixTarget = mix;   // 1 = protected
    var inView = false, id = 0, last = 0, pulse = 0;

    function size() {
      var cw = canvas.clientWidth || 84, ch = canvas.clientHeight || 84;
      var nd = Math.min(2, win.devicePixelRatio || 1);
      if (cw === w && ch === h && nd === dpr) return;
      w = cw; h = ch; dpr = nd;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    function project(p, cr, sr, ct, st) {
      /* spin around the polar axis, then tilt the north pole toward the viewer */
      var x1 = p.x * cr + p.z * sr;
      var z1 = -p.x * sr + p.z * cr;
      var y2 = p.y * ct - z1 * st;
      var z2 = p.y * st + z1 * ct;
      return { x: x1, y: y2, z: z2 };
    }

    function lockGlyph(x, y, s, open, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.lineWidth = 1.3 * s;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath();
      if (open) ctx.arc(1.6 * s, -1.6 * s, 2.1 * s, Math.PI, Math.PI * 1.95);
      else ctx.arc(0, -1.6 * s, 2.1 * s, Math.PI, 0);
      ctx.stroke();
      if (!open) { ctx.beginPath(); ctx.moveTo(-2.1 * s, -1.6 * s); ctx.lineTo(-2.1 * s, 0); ctx.moveTo(2.1 * s, -1.6 * s); ctx.lineTo(2.1 * s, 0); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(-0.5 * s, -1.6 * s); ctx.lineTo(-0.5 * s, 0); ctx.stroke(); }
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-3.2 * s, -0.2 * s, 6.4 * s, 4.6 * s, 1 * s); else ctx.rect(-3.2 * s, -0.2 * s, 6.4 * s, 4.6 * s);
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      size();
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 5;
      var cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(TILT), st = Math.sin(TILT);

      /* faint limb */
      ctx.beginPath(); ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(90,53,64,.16)'; ctx.lineWidth = 1; ctx.stroke();

      /* home region centre (projected home vector) */
      var hq = project({ x: hx, y: hy, z: hz }, cr, sr, ct, st);
      var mx = cx + hq.x * R, my = cy - hq.y * R;
      var capR = R * 0.31 + 2;
      var homeVis = clamp(hq.z * 4 + 0.4, 0, 1);  // fades the markers as the region nears the limb

      if (mix < 0.999 && homeVis > 0) {
        /* exposed: soft REC glow under the region */
        var g = ctx.createRadialGradient(mx, my, 0, mx, my, capR * 1.5);
        var ga = 0.34 * (1 - mix) * homeVis;
        g.addColorStop(0, 'rgba(229,48,74,' + ga.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(229,48,74,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(mx, my, capR * 1.5, 0, Math.PI * 2); ctx.fill();
      }

      /* two passes: far side first, then near side */
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < N; i++) {
          var p = pts[i];
          var q = project(p, cr, sr, ct, st);
          var front = q.z >= 0;
          if ((pass === 0) === front) continue;
          var sx = cx + q.x * R, sy = cy - q.y * R;
          var depth = (q.z + 1) / 2;                 // 0 back … 1 front
          var rad, col;
          if (!front) {
            rad = 0.55; col = 'rgba(184,95,117,' + (0.1 + 0.08 * depth).toFixed(3) + ')';
          } else {
            rad = 0.62 + 0.72 * q.z;
            /* fur pink at the limb → ink-2 at the centre */
            var a = 0.28 + 0.6 * q.z;
            var rr = Math.round(184 + (90 - 184) * q.z), gg = Math.round(95 + (53 - 95) * q.z), bb = Math.round(117 + (64 - 117) * q.z);
            col = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a.toFixed(3) + ')';
          }
          if (p.cap) {
            /* exposed (mix 0): REC red, bigger · protected (mix 1): dim grey */
            var al = front ? (1 - 0.6 * mix) * (0.6 + 0.4 * q.z) : 0.12;
            var cR = Math.round(229 + (150 - 229) * mix), cG = Math.round(48 + (138 - 48) * mix), cB = Math.round(74 + (142 - 74) * mix);
            col = 'rgba(' + cR + ',' + cG + ',' + cB + ',' + al.toFixed(3) + ')';
            rad = front ? rad + 0.45 * (1 - mix) : rad;
          }
          ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          ctx.fillStyle = col; ctx.fill();
        }
      }

      if (homeVis <= 0) return;
      ctx.globalAlpha = homeVis;
      var BADGE = -Math.PI / 4;                       // the padlock hangs on the ring, top-right
      if (mix < 0.999) {
        /* exposed: soft REC pulse */
        var ph = (pulse % 1800) / 1800;
        ctx.beginPath(); ctx.arc(mx, my, capR * (0.75 + 0.55 * ph), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(229,48,74,' + ((1 - ph) * 0.55 * (1 - mix)).toFixed(3) + ')';
        ctx.lineWidth = 1.2; ctx.stroke();
      }
      if (mix > 0.001) {
        /* protected: the lock ring closes around the region, starting from the padlock */
        ctx.beginPath();
        /* (a closed ring is drawn 0→2π: arc(B, B + 2π) with negative B collapses to nothing in Chrome) */
        if (mix > 0.995) ctx.arc(mx, my, capR, 0, Math.PI * 2);
        else ctx.arc(mx, my, capR, BADGE, BADGE + Math.PI * 2 * mix);
        ctx.strokeStyle = 'rgba(30,22,24,' + (0.85 * mix).toFixed(3) + ')'; ctx.lineWidth = 1.4; ctx.stroke();
      }
      /* padlock badge on the rim */
      var bx = clamp(mx + Math.cos(BADGE) * capR, 6, w - 6), by = clamp(my + Math.sin(BADGE) * capR, 6, h - 6);
      ctx.beginPath(); ctx.arc(bx, by, 5.6, 0, Math.PI * 2);
      ctx.fillStyle = '#F4EADB'; ctx.fill();
      ctx.strokeStyle = mix > 0.5 ? 'rgba(30,22,24,.9)' : 'rgba(229,48,74,.95)'; ctx.lineWidth = 1; ctx.stroke();
      lockGlyph(bx, by - 0.5, 0.7, mix < 0.5, mix > 0.5 ? '#1E1618' : '#B3182F');
      ctx.globalAlpha = 1;
    }

    function frame(t) {
      var dt = last ? clamp(t - last, 0, 64) : 16.667;
      last = t;
      if (!state.reduced) { rot += SPEED * dt; pulse += dt; }
      if (mix !== mixTarget) {
        mix += (mixTarget - mix) * lerpK(0.1, dt);
        if (Math.abs(mixTarget - mix) < 0.004) mix = mixTarget;
      }
      draw();
      var animating = mix !== mixTarget;
      if (inView && (!state.reduced || animating)) id = raf(frame);
      else { id = 0; last = 0; }
    }
    function kick() { if (!id) id = raf(frame); }

    if (win.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView) kick();
      }).observe(canvas);
    } else { inView = true; }
    onLayout(function () { draw(); });
    onMotionChange(function () { kick(); });
    draw();
    if (inView) kick();

    return {
      setGeo: function (on) {
        mixTarget = on ? 1 : 0;
        if (state.reduced) { mix = mixTarget; draw(); }
        else kick();
      }
    };
  }

  /* ================================================================== FAQ (WAAPI height) */
  function initFAQ() {
    var items = $$('details.acc');
    var EASE = 'cubic-bezier(.16,1,.3,1)';
    items.forEach(function (d) {
      var sum = $('summary', d);
      var content = $('.acc__a', d);
      if (!sum || !content || !d.animate) return;
      var anim = null, closing = false, opening = false;

      function done(open) {
        d.open = open;
        anim = null; closing = opening = false;
        d.style.height = ''; d.style.overflow = '';
      }
      function border() { return d.offsetHeight - d.clientHeight; }
      function collapse() {
        closing = true; opening = false;
        var from = d.offsetHeight, to = sum.offsetHeight + border();
        if (anim) anim.cancel();
        anim = d.animate({ height: [from + 'px', to + 'px'] }, { duration: 380, easing: EASE });
        anim.onfinish = function () { done(false); };
        anim.oncancel = function () { closing = false; };
      }
      function expand() {
        d.style.height = d.offsetHeight + 'px';
        d.open = true;
        raf(function () {
          opening = true; closing = false;
          var from = d.offsetHeight, to = sum.offsetHeight + content.offsetHeight + border();
          if (anim) anim.cancel();
          anim = d.animate({ height: [from + 'px', to + 'px'] }, { duration: 520, easing: EASE });
          anim.onfinish = function () { done(true); };
          anim.oncancel = function () { opening = false; };
          content.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
            { duration: 520, easing: EASE });
        });
      }

      sum.addEventListener('click', function (e) {
        if (state.reduced) return;                       // native toggle
        e.preventDefault();
        d.style.overflow = 'hidden';
        if (closing || !d.open) expand();
        else if (opening || d.open) collapse();
      });
    });
  }

  /* ================================================================== APPLY FORM */
  function initForm() {
    var form = $('[data-form]');
    if (!form) return;
    var steps = $$('[data-form-step]', form);
    var prevBtn = $('[data-form-prev]', form);
    var nextBtn = $('[data-form-next]', form);
    var submitBtn = $('[data-form-submit]', form);
    var label = $('[data-step-label]', form);
    var bar = $('[data-form-progress]', form);
    var success = $('[data-form-success]', form);
    var head = $('.form__head', form);
    var navRow = $('.form__nav', form);
    var contact = form.elements.namedItem('contact');
    var contactLabel = $('[data-contact-label]', form);
    var TOTAL = steps.length || 3;
    var current = 1;
    var DRAFT_KEY = 'ae-studio:apply-draft';
    var sending = false;

    function field(name) { return form.elements.namedItem(name); }
    function val(name) { var el = field(name); return el && typeof el.value === 'string' ? el.value : ''; }
    function channel() { var r = $('input[name="channel"]:checked', form); return r ? r.value : 'telegram'; }

    /* ---- contact channel switch */
    var CHANNELS = {
      telegram: { label: 'Ник в' + NBSP + 'Telegram', ph: '@username', mode: 'text', ac: 'username', type: 'text' },
      whatsapp: { label: 'Номер WhatsApp', ph: '+7 900 000-00-00', mode: 'tel', ac: 'tel', type: 'tel' },
      phone: { label: 'Номер телефона', ph: '+7 900 000-00-00', mode: 'tel', ac: 'tel', type: 'tel' }
    };
    function applyChannel() {
      var c = CHANNELS[channel()] || CHANNELS.telegram;
      if (contactLabel) contactLabel.textContent = c.label;
      if (contact) {
        contact.placeholder = c.ph;
        contact.setAttribute('inputmode', c.mode);
        contact.setAttribute('autocomplete', c.ac);
        try { contact.type = c.type; } catch (e) { /* ignore */ }
        if (contact.getAttribute('aria-invalid') === 'true') check(contact);
      }
    }

    /* ---- validation (Russian copy) */
    function message(el) {
      if (!el) return '';
      var v = (el.value || '').trim();
      switch (el.name) {
        case 'name':
          if (!v) return 'Укажи имя или псевдоним';
          if (v.length < 2) return 'Слишком коротко — нужно хотя бы 2' + NBSP + 'буквы';
          return '';
        case 'age':
          if (!v) return 'Укажи возраст';
          if (!/^\d{1,3}$/.test(v)) return 'Возраст — целое число, например 23';
          var n = parseInt(v, 10);
          if (n < 18) return 'Анкету можно отправить только с' + NBSP + '18' + NBSP + 'лет';
          if (n > 60) return 'Укажи возраст от' + NBSP + '18 до' + NBSP + '60';
          return '';
        case 'city':
          return v ? '' : 'Укажи город';
        case 'contact':
          var ch = channel();
          if (ch === 'telegram') {
            if (!v) return 'Укажи ник в' + NBSP + 'Telegram';
            return /^@?[a-zA-Z0-9_]{4,32}$/.test(v) ? '' : 'Ник — от' + NBSP + '4 до' + NBSP + '32 символов: латиница, цифры и' + NBSP + '«_»';
          }
          if (!v) return ch === 'whatsapp' ? 'Укажи номер WhatsApp' : 'Укажи номер телефона';
          return v.replace(/\D/g, '').length >= 10 ? '' : 'В номере должно быть не' + NBSP + 'меньше 10' + NBSP + 'цифр';
        case 'consent':
          return el.checked ? '' : 'Подтверди, что тебе есть 18' + NBSP + 'лет, и' + NBSP + 'согласие на' + NBSP + 'обработку данных';
        default:
          return '';
      }
    }
    function errorEl(el) {
      var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/);
      for (var i = 0; i < ids.length; i++) {
        var e = ids[i] && doc.getElementById(ids[i]);
        if (e && e.classList.contains('field__error')) return e;
      }
      var f = el.closest('.field');
      return f ? $('.field__error', f) : null;
    }
    function setError(el, msg) {
      var f = el.closest('.field');
      var err = errorEl(el);
      if (err) err.textContent = msg;
      if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      if (f) f.classList.toggle('has-error', !!msg);
    }
    function check(el) { var m = message(el); setError(el, m); return !m; }
    var VALIDATE = ['name', 'age', 'city', 'contact', 'consent'];
    function validateStep(n) {
      var fs = steps[n - 1];
      if (!fs) return true;
      var firstBad = null;
      VALIDATE.forEach(function (name) {
        var el = field(name);
        if (!el || !fs.contains(el)) return;
        if (!check(el) && !firstBad) firstBad = el;
      });
      if (firstBad) {
        try { firstBad.focus({ preventScroll: true }); } catch (e) { firstBad.focus(); }
        var r = firstBad.getBoundingClientRect();
        if (r.top < 90 || r.bottom > (win.innerHeight || 0) - 20) {
          firstBad.scrollIntoView({ block: 'center', behavior: state.reduced ? 'auto' : 'smooth' });
        }
        return false;
      }
      return true;
    }

    /* live re-check once a field has shown an error */
    form.addEventListener('input', function (e) {
      var el = e.target;
      if (el && el.getAttribute && el.getAttribute('aria-invalid') === 'true') check(el);
    });
    form.addEventListener('change', function (e) {
      var el = e.target;
      if (!el) return;
      if (el.name === 'channel') applyChannel();
      if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') check(el);
    });

    /* ---- steps */
    function goTo(n, focus) {
      current = clamp(n, 1, TOTAL);
      steps.forEach(function (fs, i) { fs.hidden = i !== current - 1; });
      if (prevBtn) prevBtn.hidden = current === 1;
      if (nextBtn) nextBtn.hidden = current === TOTAL;
      if (submitBtn) submitBtn.hidden = current !== TOTAL;
      if (label) label.textContent = 'Шаг ' + current + ' из ' + TOTAL;
      if (bar) bar.style.transform = 'scaleX(' + (current / TOTAL).toFixed(4) + ')';
      if (focus) {
        var fs = steps[current - 1];
        var first = fs && $('input:not([type="hidden"]):not([disabled]), textarea, select', fs);
        if (first) {
          try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
        }
        var fr = form.getBoundingClientRect();
        if (fr.top < 72) form.scrollIntoView({ block: 'start', behavior: state.reduced ? 'auto' : 'smooth' });
      }
    }
    function next() { if (validateStep(current)) goTo(current + 1, true); }

    if (nextBtn) nextBtn.addEventListener('click', next);
    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(current - 1, true); });

    /* Enter in a single-line field moves forward instead of submitting early */
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      var t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (/^(checkbox|radio|submit|button)$/.test(t.type)) return;
      if (current < TOTAL) { e.preventDefault(); next(); }
    });

    /* ---- draft (localStorage, best-effort) */
    function readDraft() {
      try { var raw = win.localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function collect() {
      return {
        name: val('name').trim(),
        age: val('age').trim(),
        city: val('city').trim(),
        channel: channel(),
        contact: val('contact').trim(),
        shift: $$('input[name="shift"]:checked', form).map(function (c) { return c.value; }),
        experience: ($('input[name="experience"]:checked', form) || {}).value || '',
        about: val('about').trim()
      };
    }
    var saveTimer = 0;
    function saveDraft() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try { win.localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch (e) { /* storage unavailable */ }
      }, 250);
    }
    function clearDraft() {
      clearTimeout(saveTimer);
      try { win.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    }
    function restoreDraft() {
      var d = readDraft();
      if (!d || typeof d !== 'object') return;
      ['name', 'age', 'city', 'contact', 'about'].forEach(function (k) {
        var el = field(k);
        if (el && typeof d[k] === 'string' && d[k]) el.value = d[k];
      });
      [['channel', d.channel], ['experience', d.experience]].forEach(function (pair) {
        if (!pair[1]) return;
        $$('input[name="' + pair[0] + '"]', form).forEach(function (r) { r.checked = r.value === pair[1]; });
      });
      if (Array.isArray(d.shift)) {
        $$('input[name="shift"]', form).forEach(function (c) { c.checked = d.shift.indexOf(c.value) !== -1; });
      }
    }
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);

    /* ---- submit */
    function showSuccess() {
      clearDraft();
      steps.forEach(function (fs) { fs.hidden = true; });
      if (navRow) navRow.hidden = true;
      if (head) head.hidden = true;
      if (success) {
        success.hidden = false;
        try { success.focus({ preventScroll: true }); } catch (e) { success.focus(); }
        var r = success.getBoundingClientRect();
        if (r.top < 80 || r.bottom > (win.innerHeight || 0)) {
          success.scrollIntoView({ block: 'center', behavior: state.reduced ? 'auto' : 'smooth' });
        }
      }
    }
    function setSending(on) {
      sending = on;
      form.setAttribute('aria-busy', on ? 'true' : 'false');
      if (submitBtn) {
        submitBtn.disabled = on;
        if (on) { submitBtn.dataset.label = submitBtn.textContent; submitBtn.textContent = 'Отправляем…'; }
        else if (submitBtn.dataset.label) submitBtn.textContent = submitBtn.dataset.label;
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      if (current < TOTAL) { next(); return; }
      /* re-check every step; jump back to the first one with a problem */
      for (var n = 1; n <= TOTAL; n++) {
        var fs = steps[n - 1];
        var bad = fs && VALIDATE.some(function (name) { var el = field(name); return el && fs.contains(el) && message(el); });
        if (bad) { if (n !== current) goTo(n, false); validateStep(n); return; }
      }
      var data = collect();
      data.age = parseInt(data.age, 10);
      data.consent = true;
      var endpoint = (form.getAttribute('data-endpoint') || '').trim();
      setSending(true);
      var request = endpoint && win.fetch
        ? win.fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(data)
          }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); })
        : new Promise(function (resolve) { setTimeout(resolve, 900); });
      request.then(function () {
        setSending(false);
        showSuccess();
      }, function () {
        setSending(false);
        if (label) label.textContent = 'Не получилось отправить. Проверь интернет и' + NBSP + 'попробуй ещё раз';
      });
    });

    restoreDraft();
    applyChannel();
    goTo(1, false);
  }

  /* ================================================================== FOOTER (wander snake) */
  function initFooter() {
    var footer = $('[data-footer]');
    var canvas = $('[data-footer-snake]');
    var engine = win.SohoSnake;
    if (!footer || !canvas || !engine || typeof engine.mount !== 'function') return;
    var mounted = false;
    function mount() {
      if (mounted) return;
      mounted = true;
      try { engine.mount(canvas, { mode: 'wander', pointerTarget: footer, reducedMotion: state.reduced }); }
      catch (e) { warn('footer snake', e); }
    }
    /* mount lazily, shortly before the footer scrolls into view */
    if (win.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[entries.length - 1].isIntersecting) { io.disconnect(); mount(); }
      }, { rootMargin: '400px 0px' });
      io.observe(footer);
    } else {
      mount();
    }
  }

  /* ================================================================== COPY TO CLIPBOARD */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      var scope = btn.closest('.footer__col') || btn.parentElement || doc;
      var status = $('[data-copy-status]', scope) || $('[data-copy-status]');
      var source = $('[data-copy-text]', scope);
      var timer = 0;

      function say(text) {
        if (!status) return;
        status.textContent = text;
        clearTimeout(timer);
        timer = setTimeout(function () { status.textContent = ''; }, 2500);
      }
      function legacyCopy(text) {
        var ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
        body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
        body.removeChild(ta);
        try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        return ok;
      }
      function selectSource() {
        if (!source || !win.getSelection) return;
        var range = doc.createRange();
        range.selectNodeContents(source);
        var sel = win.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      }

      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy') || (source ? source.textContent.trim() : '');
        if (!text) return;
        var fallback = function () {
          if (legacyCopy(text)) say('Скопировано');
          else { selectSource(); say('Ник выделен — нажми «Копировать»'); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText && win.isSecureContext !== false) {
          navigator.clipboard.writeText(text).then(function () { say('Скопировано'); }, fallback);
        } else {
          fallback();
        }
      });
    });
  }

  /* ============================================================ RANGE FILL */
  /* Range inputs show their filled part through --fill (WebKit has no native progress pseudo-element). */
  function initRangeFill() {
    var inputs = document.querySelectorAll('input[type="range"]');
    Array.prototype.forEach.call(inputs, function (input) {
      var update = function () {
        var min = parseFloat(input.min) || 0, max = parseFloat(input.max) || 100;
        var pct = max > min ? ((parseFloat(input.value) - min) / (max - min)) * 100 : 0;
        input.style.setProperty('--fill', pct.toFixed(2) + '%');
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
      update();
    });
  }

  /* ================================================================== BOOT */
  var inits = [
    ['flags', initFlags], ['nav', initNav], ['menu', initMenu], ['cursor', initCursor],
    ['magnetic', initMagnetic], ['reveal', initReveal], ['spotlight', initSpotlightTilt],
    ['hero', initHero], ['calculator', initCalculator], ['rooms', initRooms], ['path', initPath],
    ['privacy', initPrivacy], ['faq', initFAQ], ['form', initForm], ['footer', initFooter], ['copy', initCopy], ['rangeFill', initRangeFill]
  ];
  function boot() {
    for (var i = 0; i < inits.length; i++) {
      try { inits[i][1](); } catch (e) { warn(inits[i][0], e); }
    }
    queueLayout();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
