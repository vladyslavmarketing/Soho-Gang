// Renders the resting 3D "ae" from the live page into assets/img/snake-ae-3d.webp (via PNG) for no-WebGL / reduced motion.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2], out = process.argv[3];
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(url);
  await p.waitForFunction(() => document.querySelector('.hero.is-written'), null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  // wait for a moment without tongue / yawn
  await p.waitForFunction(() => { const r = window.__snake3d.rig; return r.head.tongue < 0.01 && r.head.jaw < 0.01; });
  await p.addStyleTag({ content: '*{visibility:hidden!important} .snake-layer{visibility:visible!important} html,body{background:transparent!important}' });
  await p.waitForTimeout(300);
  const box = await p.evaluate(() => window.SohoSnake.logoBox(innerWidth, innerHeight));
  const clip = { x: box.x - box.w * 0.05, y: box.y - box.h * 0.45, width: box.w * 1.1, height: box.h * 1.45 };
  await p.screenshot({ path: out, clip, omitBackground: true });
  console.log(JSON.stringify(clip));
  await b.close();
})();
