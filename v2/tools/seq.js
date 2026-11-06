// Scroll sequence capture: node v2/tools/seq.js <url> <outDir> <w> <h> <fromY> <toY> <n> [prefix]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w, h, y0, y1, n, pre] = process.argv.slice(2);
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.goto(url); await p.waitForFunction(() => document.querySelector('.hero.is-written'), null, { timeout: 30000 }).catch(() => {});
  const docH = await p.evaluate(() => document.documentElement.scrollHeight);
  const res = [];
  for (let i = 0; i < +n; i++) {
    const y = Math.round((+y0 + (+y1 - +y0) * i / Math.max(1, +n - 1)) * (y1 <= 1 ? docH : 1));
    await p.evaluate(v => window.scrollTo(0, v), y); await p.waitForTimeout(1300);
    const over = await p.evaluate(() => document.querySelector('.snake-layer').classList.contains('is-over'));
    await p.screenshot({ path: `${out}/${pre || 'seq'}_${String(i).padStart(2, '0')}.png` });
    res.push({ i, y, over });
  }
  console.log(JSON.stringify(res));
  await b.close();
})();
