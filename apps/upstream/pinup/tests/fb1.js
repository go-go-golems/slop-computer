const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack)); p.on('console', m => { if (m.type()==='error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.addInitScript({ content: fs.readFileSync(__dirname + '/mock.js', 'utf8') + `;(function(){const d=${fs.readFileSync(__dirname + '/seed.json','utf8')};for(const [k,v] of d) window.__docs.set(k,v);})();` });
  await p.goto('file://' + __dirname + '/index.html'); await p.waitForTimeout(1500);
  const shot = n => p.screenshot({ path: __dirname + '/' + n + '.png' });
  await p.click('[data-ltab="feedback"]'); await p.waitForTimeout(200); await shot('f0');
  // pin feedback on second run card
  const c = await p.evaluate(() => { const e=[...document.querySelectorAll('#world [data-mid]')].find(e=>!e.dataset.sub && e.textContent.includes('Sunrise')); const r=e.getBoundingClientRect(); return {x:r.x+r.width-30,y:r.y+r.height/2}; });
  await p.keyboard.press('n'); await p.mouse.click(c.x, c.y); await p.waitForTimeout(200);
  await p.keyboard.type('Cards feel cramped — add more space between them');
  await p.click('#fbEd [data-sk="arrow"]');
  await p.mouse.move(c.x+40, c.y-60); await p.mouse.down(); await p.mouse.move(c.x+10, c.y-20, {steps:5}); await p.mouse.up();
  await p.waitForTimeout(100); await shot('f1-compose');
  await p.click('#fbPost'); await p.waitForTimeout(300);
  // area feedback
  const hd = await p.evaluate(() => { const e=[...document.querySelectorAll('#world [data-nid]')].find(e=>e.textContent.trim()==='This week'); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y}; });
  await p.mouse.move(hd.x-5, hd.y-5); await p.mouse.down(); await p.mouse.move(hd.x+120, hd.y+40, {steps:5}); await p.mouse.up(); await p.waitForTimeout(200);
  await p.keyboard.type('Title should be bigger'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(400);
  const fbDocs = await p.evaluate(() => [...window.__docs.entries()].filter(([k])=>k.startsWith('feedback/')).map(([k,v])=>({k, n:v.n, node:v.node, area:!!v.area, marks:(v.marks||[]).length, text:v.text})));
  console.log('feedback docs', JSON.stringify(fbDocs));
  await p.keyboard.press('v'); await p.waitForTimeout(100); await shot('f2-pins');
  // Claude step via inbox
  const upId = await p.evaluate(() => [...window.__docs.entries()].find(([k,v])=>k.startsWith('nodes/') && v.name==='Upcoming')[0].split('/')[1]);
  const up = await p.evaluate((id) => window.__docs.get('nodes/'+id), upId);
  await p.evaluate(([id, layout]) => window.__db.doc('inbox/s1').set({ kind:'step', seq:1, feedback:'#1', label:'More space between run cards', reply:'Raised the gap between cards from 12 to 20px.', ops:[{op:'update', id, data:{ layout: Object.assign({}, layout, {gap:20}) }}] }), [upId, up.layout]);
  await p.waitForTimeout(1500);
  const st = await p.evaluate((id) => ({ gap: window.__docs.get('nodes/'+id).layout.gap, inbox: [...window.__docs.keys()].filter(k=>k.startsWith('inbox/')).length, logs: [...window.__docs.entries()].filter(([k])=>k.startsWith('log/')).map(([k,v])=>({k, label:v.label, by:v.by, fb:v.feedback, n:v.changes.length})), fb1: [...window.__docs.entries()].filter(([k,v])=>k.startsWith('feedback/') && v.n===1).map(([k,v])=>({status:v.status, log:v.log, reply:v.reply})) }), upId);
  console.log('after step', JSON.stringify(st));
  await p.click('[data-ltab="history"]'); await p.waitForTimeout(300); await shot('f3-history');
  // user edit (nudge something unrelated) then revert Claude's step
  await p.click('.logrow >> text=Revert'); await p.waitForTimeout(400);
  const st2 = await p.evaluate((id) => ({ gap: window.__docs.get('nodes/'+id).layout.gap, fb1: [...window.__docs.values()].find(v=>v.n===1 && v.text)?.status, logs: [...window.__docs.entries()].filter(([k])=>k.startsWith('log/')).map(([k,v])=>({label:v.label, revertedBy:v.revertedBy, revertOf:v.revertOf})) }), upId);
  console.log('after revert', JSON.stringify(st2));
  await shot('f4-reverted');
  await p.click('.logrow >> text=Restore'); await p.waitForTimeout(400);
  console.log('after restore gap', await p.evaluate((id) => window.__docs.get('nodes/'+id).layout.gap, upId));
  await shot('f5-restored');
  // conflict: change gap by hand then revert the restore? revert the original Claude step again after manual change
  await p.evaluate((id) => {}, upId);
  console.log(errs.join('\n'));
  await b.close();
})();
