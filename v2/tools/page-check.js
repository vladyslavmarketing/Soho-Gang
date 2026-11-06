// v2 page check: console errors, hero + scroll sequence screenshots, frame time.
// usage: node v2/tools/page-check.js <url> <outDir> [--nogl] [--reduced]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const url = process.argv[2], out = process.argv[3];
  const nogl = process.argv.includes('--nogl'), reduced = process.argv.includes('--reduced');
  const only = (process.argv.find(a => a.startsWith('--vp=')) || '').slice(5);
  fs.mkdirSync(out, { recursive: true });
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (nogl) args.push('--disable-webgl', '--disable-webgl2');
  const b = await chromium.launch({ args });
  const vps = [['desk', 1440, 900, false], ['phone', 390, 844, true]].filter(v => !only || v[0] === only);
  for (const [name, w, h, mob] of vps) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mob, hasTouch: mob, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('requestfailed', r => errs.push('requestfailed: ' + r.url()));
    await p.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
    });
    await p.goto(url, { waitUntil: 'load' });
    // wait until the snake has written "ae" (or the static still is up)
    await p.waitForFunction(() => document.querySelector('.hero.is-written') || document.documentElement.classList.contains('snake-static'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const tag = `${name}${nogl ? '_nogl' : ''}${reduced ? '_reduced' : ''}`;
    await p.screenshot({ path: `${out}/${tag}_hero.png` });
    // pointer near the head, then a strike
    if (!mob && !nogl && !reduced) {
      const info = await p.evaluate(() => { const a = window.__snake3d; if (!a) return null; const H = a.rig.head.pos, d = a.debug(); return { x: H[0] * d.S, y: -H[1] * d.S }; });
      if (info) {
        await p.mouse.move(info.x - 160, info.y + 60, { steps: 8 }); await p.waitForTimeout(700);
        await p.screenshot({ path: `${out}/${tag}_look.png` });
        await p.mouse.click(info.x - 150, info.y + 50); await p.waitForTimeout(130);
        await p.screenshot({ path: `${out}/${tag}_strike.png` });
        await p.waitForTimeout(900);
      }
    }
    const docH = await p.evaluate(() => document.documentElement.scrollHeight);
    const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const stops = [0.035, 0.07, 0.11, 0.16, 0.2, 0.24];
    for (let i = 0; i < stops.length; i++) {
      await p.evaluate(y => window.scrollTo(0, y), Math.round(stops[i] * docH));
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${out}/${tag}_scroll${i + 1}.png` });
    }
    const stats = await p.evaluate(() => window.__snake3d ? Object.assign({}, window.__snake3d.stats, window.__snake3d.debug()) : null);
    const cls = await p.evaluate(() => document.documentElement.className);
    const longTasks = await p.evaluate(() => window.__long);
    console.log(JSON.stringify({ vp: name, hscroll, stats, cls, longTasks, errors: errs }));
    await ctx.close();
  }
  await b.close();
})();
