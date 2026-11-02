const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') + `;(function(){const d=${fs.readFileSync(__dirname + '/dump.json','utf8')};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p.goto('file://' + __dirname + '/index.html');
  await p.waitForTimeout(1500);
  // select all top-level, export page HTML via the download button
  await p.click('[data-rtab="inspect"]'); await p.waitForTimeout(200);
  await p.click('text=Download this page as HTML'); await p.waitForTimeout(300);
  const html = await p.evaluate(() => window.__saved.data);
  fs.writeFileSync(__dirname + '/export.html', html);
  const q = await b.newPage({ viewport: { width: 1900, height: 1000 } });
  await q.route('**/fonts.googleapis.com/**', r => r.abort());
  await q.goto('file://' + __dirname + '/export.html'); await q.waitForTimeout(300);
  await q.screenshot({ path: __dirname + '/e1.png' });
  // structural ops via keyboard
  const r = await p.evaluate(() => {
    const out = {};
    return out;
  });
  // draw 3 rects then shift+A
  await p.click('[data-rtab="design"]');
  for (let i = 0; i < 3; i++) { await p.keyboard.press('r'); await p.mouse.move(300 + i * 70, 760); await p.mouse.down(); await p.mouse.move(350 + i * 70, 800, { steps: 3 }); await p.mouse.up(); }
  await p.mouse.move(280, 740); await p.mouse.down(); await p.mouse.move(540, 820, { steps: 5 }); await p.mouse.up();
  console.log('selected', await p.evaluate(() => document.querySelector('#insp b').textContent));
  await p.keyboard.press('Shift+A'); await p.waitForTimeout(200);
  console.log('after shift+A', await p.evaluate(() => document.querySelector('#insp b').textContent), await p.evaluate(() => [...document.querySelectorAll('.sec h3')].map(h => h.textContent).join(',')));
  await p.keyboard.press('Control+Alt+k'); await p.waitForTimeout(200);
  console.log('after comp', await p.evaluate(() => document.querySelector('#insp b').textContent));
  await p.click('text=Insert instance'); await p.waitForTimeout(200);
  console.log('instance', await p.evaluate(() => document.querySelector('#insp b').textContent + ' / ' + [...document.querySelectorAll('.sec h3')].map(h => h.textContent).join(',')));
  await p.keyboard.press('Control+Alt+b'); await p.waitForTimeout(200);
  console.log('detached', await p.evaluate(() => document.querySelector('#insp b').textContent + ' ' + document.querySelector('#insp .sec span:last-child')?.textContent));
  await p.keyboard.press('Control+Shift+g'); await p.waitForTimeout(200);
  console.log('ungrouped sel count', await p.evaluate(() => document.querySelector('#insp b').textContent));
  await p.keyboard.press('Control+g'); await p.waitForTimeout(200);
  console.log('grouped', await p.evaluate(() => document.querySelector('#insp b').textContent));
  await p.screenshot({ path: __dirname + '/e2.png' });
  console.log(errs.join('\n'));
  await b.close();
})();
