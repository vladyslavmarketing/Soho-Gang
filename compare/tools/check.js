// Compare page check: console errors, side-by-side and curtain screenshots, frame stepping.
// usage: node compare/tools/check.js <index-url> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const res = [];
  for (const [name, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message));
    p.on('requestfailed', r => errs.push('failed ' + r.url()));
    await p.goto(url + (url.includes('?') ? '&' : '?') + 'frame=45');
    await p.waitForTimeout(8000);
    await p.screenshot({ path: `${out}/${name}_side.png` });
    await p.click('label[for=m-curtain]'); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/${name}_curtain.png` });
    await p.click('#next'); await p.waitForTimeout(800);
    const frame = await p.textContent('#frame');
    const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    res.push({ vp: name, frame, hscroll, bstat: await p.textContent('#bstat'), errors: errs });
    await p.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
