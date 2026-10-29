const { chromium, devices } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') + `;(function(){const d=${fs.readFileSync(__dirname + '/dump.json','utf8')};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p.goto('file://' + __dirname + '/index.html');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: __dirname + '/m1.png' });
  await p.tap('#bLeft'); await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + '/m2.png' });
  await p.tap('#bLeft'); await p.waitForTimeout(200);
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log('scrollWidth', w);
  // present flow from welcome
  await p.tap('#bPlay'); await p.waitForTimeout(500);
  await p.screenshot({ path: __dirname + '/m3.png' });
  console.log(errs.join('\n'));
  await b.close();
})();
