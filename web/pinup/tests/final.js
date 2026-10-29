const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') + `;(function(){const d=${fs.readFileSync(__dirname + '/seed.json','utf8')};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p.goto('file://' + __dirname + '/index.html'); await p.waitForTimeout(1500);
  await p.click('[data-rtab="proto"]'); await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + '/final.png' }); console.log(errs.join('\n') || 'no errors'); await b.close();
})();
