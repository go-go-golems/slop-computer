const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  let mock = fs.readFileSync(__dirname + '/mock.js', 'utf8');
  // sample that resolves one feedback item via update_nodes
  mock = mock.replace(/const sample = async[\s\S]*?\};\n  const downloads/, `const sample = async (input, opts) => { const t = opts.tools; const ctx = await t.find(x=>x.name==='get_nodes'); const m = String(input).match(/"layer":\\{"id":"([^"]+)"/); const id = m && m[1]; if (id) await t.find(x=>x.name==='update_nodes').execute({updates:[{id, opacity:0.9}]}, {}); return { text: 'Lowered the card opacity slightly.', truncated:false }; };\n  const downloads`);
  await p.addInitScript({ content: mock + `;(function(){const d=${fs.readFileSync(__dirname + '/seed.json','utf8')};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p.goto('file://' + __dirname + '/index.html'); await p.waitForTimeout(1500);
  const c = await p.evaluate(() => { const e=[...document.querySelectorAll('#world [data-mid]')].find(e=>!e.dataset.sub && e.textContent.includes('Track Tuesday')); const r=e.getBoundingClientRect(); return {x:r.x+r.width-30,y:r.y+r.height/2}; });
  await p.keyboard.press('n'); await p.mouse.click(c.x, c.y); await p.waitForTimeout(150);
  await p.keyboard.type('Make this card quieter'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(300);
  await p.keyboard.press('v');
  // open the card via pin
  const pin = await p.evaluate(() => { const e=document.querySelector('.fbpin'); const r=e.getBoundingClientRect(); return {x:r.x+12,y:r.y+12}; });
  await p.mouse.click(pin.x, pin.y); await p.waitForTimeout(200);
  await p.screenshot({ path: __dirname + '/g1-card.png' });
  await p.click('.fbcard >> text=Fix with Claude'); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => { const f=[...window.__docs.values()].find(v=>v.text==='Make this card quieter'); const logs=[...window.__docs.entries()].filter(([k])=>k.startsWith('log/')).map(([k,v])=>({label:v.label,by:v.by,n:v.changes.length})); return {status:f.status, reply:f.reply, log:f.log, logs}; });
  console.log('after fix', JSON.stringify(r));
  // conflict: user changes same layer, then revert Claude's step from history
  await p.click('[data-ltab="history"]'); await p.waitForTimeout(300);
  const instId = await p.evaluate(() => { const l=[...window.__docs.values()].find(v=>v.by==='claude'); return l.changes[0].id; });
  await p.evaluate((id) => {}, instId);
  // select layer and change opacity through inspector? simulate remote edit by another person instead
  await p.evaluate((id) => { const d = window.__docs.get('nodes/'+id); window.__db.doc('nodes/'+id).set(Object.assign({}, d, { opacity: 0.5 })); }, instId);
  await p.waitForTimeout(300);
  await p.click('.logrow >> text=Revert'); await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + '/g2-conflict.png' });
  console.log('conflict shown', await p.evaluate(() => document.querySelector('.logconf')?.textContent));
  await p.click('.logconf >> text=Revert anyway'); await p.waitForTimeout(700);
  console.log('opacity now', await p.evaluate((id) => window.__docs.get('nodes/'+id).opacity, instId), 'fb status', await p.evaluate(() => [...window.__docs.values()].find(v=>v.text==='Make this card quieter').status));
  await p.screenshot({ path: __dirname + '/g3-hist.png' });
  console.log(errs.join('\n'));
  await b.close();
})();
