// Renders every storyboard scene of v2/lab at the PDF key times and saves the frames.
// usage: node v2/tools/storyboard-compare.js <baseUrl> <outDir> [sceneFilter]
// then: python3 v2/tools/montage.py <outDir>   (storyboard | site montages)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const base = process.argv[2] || 'http://localhost:8765/v2/lab/index.html';
  const out = process.argv[3] || 'compare';
  const filt = process.argv[4] || '';
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1260, height: 760 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(base + '?static'); await p.waitForFunction(() => window.lab);
  const scenes = await p.evaluate(() => window.lab.scenes);
  for (const s of scenes) {
    if (filt && !s.id.includes(filt)) continue;
    for (let k = 0; k < s.keys.length; k++) {
      await p.evaluate(([id, t]) => window.lab.show(id, t), [s.id, s.keys[k]]);
      await p.screenshot({ path: `${out}/${s.id}_${k + 1}.png`, clip: { x: 0, y: 0, width: 1260, height: 720 } });
    }
  }
  console.log(errs.length ? errs.join('\n') : 'console clean');
  await b.close();
})();
