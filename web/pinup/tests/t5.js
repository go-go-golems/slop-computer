const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  require('./wrap.js');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  p.on('console', m => { if ((m.type() === 'error' || m.type()==='warning') && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') });
  await p.goto('file://' + __dirname + '/index.html');
  await p.waitForTimeout(800);
  await p.click('text=Start with an example app');
  await p.waitForTimeout(4000);
  const st = await p.evaluate(() => ({ docs: window.__docs.size, file: !!window.__docs.get('meta/file'), presence: window.__presence }));
  console.log('docs written', st.docs, 'file doc', st.file);
  console.log('presence', JSON.stringify(st.presence).slice(0, 300));
  await p.screenshot({ path: __dirname + '/d1.png' });
  // simulate Claude dropping HTML into inbox
  await p.evaluate(() => window.__db.doc('inbox/a1').set({ name: 'Profile', html: '<div style="width:390px;height:844px;background:var(--tk-paper);display:flex;flex-direction:column;gap:16px;padding:64px 24px"><h1 style="margin:0;font:700 32px Inter;color:var(--tk-ink)">Maya Kim</h1><div data-instance="Run card" data-link="Run detail"><span data-name="Title">Hill repeats</span></div><i data-icon="settings" style="width:24px;height:24px;color:var(--tk-accent)"></i></div>' }));
  await p.waitForTimeout(1500);
  const inbox = await p.evaluate(() => ({ remaining: [...window.__docs.keys()].filter(k => k.startsWith('inbox/')).length, profile: [...document.querySelectorAll('.flabel')].map(e => e.textContent) }));
  console.log('inbox after', JSON.stringify(inbox));
  // reload from db (simulates another viewer)
  const p2 = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p2.on('pageerror', e => errs.push('P2 PAGEERROR ' + e.message));
  const dump = await p.evaluate(() => JSON.stringify([...window.__docs.entries()]));
  fs.writeFileSync(__dirname + '/dump.json', dump);
  await p2.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') + `;(function(){const d=${dump};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p2.route('**/fonts.googleapis.com/**', r => r.abort());
  await p2.goto('file://' + __dirname + '/index.html');
  await p2.waitForTimeout(1500);
  console.log('viewer2 frames', await p2.evaluate(() => [...document.querySelectorAll('.flabel')].map(e => e.textContent).join(' | ')));
  await p2.screenshot({ path: __dirname + '/d2.png' });
  // comment mode
  await p.evaluate(() => window.__ca.mode(true));
  await p.waitForTimeout(100);
  await p.mouse.click(700, 400); await p.waitForTimeout(200);
  console.log('composed', JSON.stringify(await p.evaluate(() => window.__composed)));
  await p.evaluate(() => window.__ca.threads([{ id: 't1', anchor: window.__composed.a, resolved: false, active: false }]));
  await p.waitForTimeout(100);
  console.log('placed', JSON.stringify(await p.evaluate(() => window.__placed)));
  await p.evaluate(() => window.__ca.mode(false));
  // in-page Claude
  await p.fill('#askIn', 'Add a settings screen'); await p.click('#askGo'); await p.waitForTimeout(1500);
  console.log('ask out', await p.evaluate(() => document.querySelector('#askOut').textContent), await p.evaluate(() => [...document.querySelectorAll('.flabel')].map(e => e.textContent).join(' | ')));
  // undo Claude's turn in one step
  await p.click('#stage', { position: { x: 10, y: 10 } });
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  console.log('after undo', await p.evaluate(() => [...document.querySelectorAll('.flabel')].map(e => e.textContent).join(' | ')));
  // send to chat
  await p.fill('#askIn', ''); 
  await p.click('#askChat'); await p.waitForTimeout(200);
  console.log('sent', JSON.stringify(await p.evaluate(() => window.__sent)).slice(0, 300));
  // handoff download
  await p.click('[data-rtab="inspect"]'); await p.mouse.click(5, 300); await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.click('text=Download handoff (.md)'); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => window.__saved && { f: window.__saved.filename, n: window.__saved.data.length, head: window.__saved.data.slice(0, 400) });
  console.log('saved', JSON.stringify(saved));
  await p.screenshot({ path: __dirname + '/d3.png' });
  console.log(errs.join('\n'));
  await b.close();
})();
