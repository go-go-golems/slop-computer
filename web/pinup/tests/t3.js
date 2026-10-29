const { chromium } = require('playwright');
(async () => {
  require('./wrap.js');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  p.on('console', m => { if ((m.type() === 'error' || m.type()==='warning') && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.goto('file://' + __dirname + '/index.html');
  await p.waitForTimeout(500);
  await p.click('text=Start with an example app');
  await p.waitForTimeout(3500);
  const shot = async n => p.screenshot({ path: __dirname + '/' + n + '.png' });
  const center = async (pred) => p.evaluate(pred);
  // dbl click into headline then edit
  const hl = await p.evaluate(() => { const e=[...document.querySelectorAll('#world [data-nid]')].find(e=>e.textContent.startsWith('Run together') && !e.children.length); const r=e.getBoundingClientRect(); return {x:r.x+20,y:r.y+10}; });
  await p.mouse.click(hl.x, hl.y); await p.waitForTimeout(100);
  await p.mouse.dblclick(hl.x, hl.y); await p.waitForTimeout(200);
  console.log('after dbl:', await p.evaluate(() => document.querySelector('#insp b')?.textContent));
  await p.mouse.dblclick(hl.x, hl.y); await p.waitForTimeout(200);
  console.log('editing?', await p.evaluate(() => !!document.querySelector('[contenteditable]')));
  await p.keyboard.type('Run with us.');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  console.log('text now:', await p.evaluate(() => [...document.querySelectorAll('#world [data-nid]')].find(e=>e.textContent.startsWith('Run with'))?.textContent));
  // undo
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  console.log('after undo:', await p.evaluate(() => !![...document.querySelectorAll('#world [data-nid]')].find(e=>e.textContent.startsWith('Run together'))));
  // draw a rectangle on empty canvas
  await p.keyboard.press('r');
  await p.mouse.move(300, 780); await p.mouse.down(); await p.mouse.move(360, 820, {steps:4}); await p.mouse.move(420, 860, {steps:4}); await p.mouse.up();
  await p.waitForTimeout(200);
  console.log('rect sel:', await p.evaluate(() => document.querySelector('#insp b')?.textContent));
  // move it
  await p.mouse.move(360, 820); await p.mouse.down(); await p.mouse.move(400, 830, {steps:5}); await p.mouse.move(440, 840, {steps:5}); await p.mouse.up();
  await p.waitForTimeout(200);
  console.log('rect xy:', await p.evaluate(() => [...document.querySelectorAll('#insp .nf input')].slice(0,4).map(i=>i.value).join(',')));
  // drag rect into Home frame
  const home = await p.evaluate(() => { const e=[...document.querySelectorAll('.flabel')].find(e=>e.textContent==='Home'); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y}; });
  await p.mouse.move(400, 830); await p.mouse.down(); await p.mouse.move(home.x+60, home.y+500, {steps:10}); await p.waitForTimeout(100); await shot('s7-dragin'); await p.mouse.up();
  await p.waitForTimeout(300);
  console.log('rect parent:', await p.evaluate(() => { const r=[...document.querySelectorAll('#tree .lr[aria-selected="true"]')][0]; return r && r.style.paddingLeft; }));
  await shot('s8-dropped');
  // resize via handle
  const h = await p.evaluate(() => { const e=document.querySelector('.hdl[data-h="se"]'); const r=e.getBoundingClientRect(); return {x:r.x+4,y:r.y+4}; });
  await p.mouse.move(h.x,h.y); await p.mouse.down(); await p.mouse.move(h.x+30,h.y+20,{steps:5}); await p.mouse.up();
  console.log('after resize:', await p.evaluate(() => [...document.querySelectorAll('#insp .nf input')].slice(0,4).map(i=>i.value).join(',')));
  // assets tab
  await p.click('[data-ltab="assets"]'); await p.waitForTimeout(300);
  await shot('s9-assets');
  // present
  await p.click('#bPlay'); await p.waitForTimeout(600);
  await shot('s10-present');
  const btn = await p.evaluate(() => { const e=[...document.querySelectorAll('#pvclip [data-nid]')].find(e=>e.textContent.trim().startsWith('Find a run')); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await p.mouse.click(btn.x, btn.y); await p.waitForTimeout(700);
  console.log('present now:', await p.evaluate(() => document.querySelector('#pvName').textContent));
  await shot('s11-present2');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  console.log(errs.join('\n'));
  await b.close();
})();
