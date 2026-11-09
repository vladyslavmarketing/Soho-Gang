// Frame capture of compare/b.html: node compare/tools/capture.js <b-url> <outDir> [fps=30] [from=0] [to=duration] [step=1] [w=1280] [h=720]
// PNG RGBA (transparent background), frame n = time n / fps, same numbering as the Cycles PNG sequence of clip A.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, out, fpsS, fromS, toS, stepS, wS, hS] = process.argv.slice(2);
  const fps = +(fpsS || 30), step = +(stepS || 1), w = +(wS || 1280), h = +(hS || 720);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message));
  const sep = url.includes('?') ? '&' : '?';
  await p.goto(url + sep + 'capture&paused&embed&transparent');
  await p.waitForFunction(() => window.B && window.B.ready, null, { timeout: 120000 });
  const dur = await p.evaluate(() => B.duration);
  const n0 = Math.round(+(fromS || 0) * fps), n1 = Math.round((toS ? +toS : dur) * fps) - 1;
  for (let n = n0; n <= n1; n += step) {
    await p.evaluate(t => B.seek(t), n / fps);
    await p.screenshot({ path: `${out}/b_${String(n).padStart(3, '0')}.png`, omitBackground: true });
  }
  console.log(JSON.stringify({ frames: Math.floor((n1 - n0) / step) + 1, errors: errs }));
  await b.close();
})();
