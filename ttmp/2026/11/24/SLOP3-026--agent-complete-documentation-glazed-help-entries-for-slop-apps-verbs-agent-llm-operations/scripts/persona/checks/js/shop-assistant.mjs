import { base, browser, person, open, frameText, inApp, shot, emit, source, sl } from '../browse.mjs';
import { execFileSync } from 'node:child_process';
const st = base('/helper');
if (st) {
  const src = source(st);
  const caps = Object.keys((JSON.parse((src.match(/--- app\.json\n([\s\S]*?)(\n--- |$)/) || [])[1] || '{}').capabilities) || {});
  emit('uses the agent or sample capability', caps.includes('agent') || caps.includes('sample'), caps.join(', '));
  // the tool's name and its first property, from the page or actor source
  const tm = src.match(/name:\s*['"]([\w.-]+)['"][\s\S]{0,400}?(?:inputSchema|parameters|input_schema)[\s\S]{0,200}?properties:\s*\{\s*['"]?(\w+)/);
  emit('a tool the assistant can call', !!tm, tm ? `${tm[1]}(${tm[2]})` : 'no tool definition found');
  const b = await browser();
  const ana = await person(b, 'ana@example.com');
  const pa = await open(ana, '/helper', 4000);
  const f = inApp(pa);
  // The chat box, not another field: js-1's page had a manual "Add" field
  // before the chat, and the probe went into it.
  const pick = async () => {
    if (!f) return null;
    for (const sel of ['textarea', 'input[placeholder*=ask i], input[placeholder*=message i], input[placeholder*=chat i], input[aria-label*=ask i], input[aria-label*=message i], input[aria-label*=chat i]']) {
      const l = f.locator(sel); if (await l.count()) return l.last();
    }
    return f.locator('input[type=text], input:not([type])').last();
  };
  const box = await pick();
  if (tm && box && await box.count()) {
    await box.fill(`/tool ${tm[1]} {"${tm[2]}":"oat milk"}`);
    await box.press('Enter');
    const send = f.getByRole('button', { name: /send|ask|go|submit/i });
    await pa.waitForTimeout(800);
    if (await send.count() && (await box.inputValue().catch(() => '')).includes('/tool')) await send.first().click().catch(() => {});
    await pa.waitForTimeout(8000);
    const t = await frameText(pa);
    let stored = '';
    try { stored = execFileSync(process.env.SLOP, ['store', 'export', st], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch {}
    emit('an item the assistant adds is stored on the server', /oat milk/i.test(stored), /oat milk/i.test(stored) ? 'found in the store' : 'not in the store export');
    emit('the item appears in the list on the page', (t.match(/oat milk/ig) || []).length >= 2 || /oat milk/i.test(t.replace(/\/tool[^\n]*/g, '')), t.slice(0, 300));
  } else emit('an item the assistant adds is stored on the server', false, box && await box.count() ? 'no tool to call' : 'no chat box in the page');
  await shot(pa, 'member-ana');
  const g = sl('explain', 'can', st, 'view', '--subject', 'anonymous');
  emit('guests (for the judge)', true, JSON.stringify(g).slice(0, 200));
  emit('no page errors', !ana.errors.some((e) => /pageerror/.test(e)), ana.errors.join(' | '));
  await b.close();
}
