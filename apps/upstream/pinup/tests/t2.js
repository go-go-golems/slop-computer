const { chromium } = require('playwright');
(async () => {
  require('./wrap.js');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.goto('file://' + __dirname + '/index.html');
  await p.waitForTimeout(500);
  await p.click('text=Start with an example app');
  await p.waitForTimeout(3500);
  const shot = async n => p.screenshot({ path: __dirname + '/' + n + '.png' });
  // click the second run card (instance) on Home
  const box = await p.evaluate(() => { const els=[...document.querySelectorAll('#world [data-mid]')].filter(e=>!e.dataset.sub && e.textContent.includes('Sunrise')); const r = els[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(300);
  await shot('s3-instance');
  // select a text in welcome via double clicks: click headline
  const hl = await p.evaluate(() => { const e=[...document.querySelectorAll('#world [data-nid]')].find(e=>e.textContent.startsWith('Run together') && !e.children.length); const r=e.getBoundingClientRect(); return {x:r.x+20,y:r.y+10}; });
  await p.mouse.click(hl.x, hl.y); await p.waitForTimeout(150);
  await p.mouse.dblclick(hl.x, hl.y); await p.waitForTimeout(300);
  const sel1 = await p.evaluate(() => document.querySelector('#insp b')?.textContent);
  console.log('selected after dbl:', sel1);
  await shot('s4-text');
  // Prototype tab
  await p.click('[data-rtab="proto"]'); await p.waitForTimeout(300); await p.mouse.click(5,5);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await shot('s5-proto');
  await p.click('[data-rtab="inspect"]'); await p.waitForTimeout(200);
  // select home frame by label
  const lab = await p.evaluate(() => { const e=[...document.querySelectorAll('.flabel')].find(e=>e.textContent==='Home'); const r=e.getBoundingClientRect(); return {x:r.x+5,y:r.y+5}; });
  await p.mouse.click(lab.x, lab.y); await p.waitForTimeout(400);
  await shot('s6-inspect');
  console.log(errs.join('\n'));
  await b.close();
})();
