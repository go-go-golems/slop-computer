import { base, browser, person, open, frameText, inApp, shot, emit, source, sl } from '../browse.mjs';
import { execFileSync } from 'node:child_process';
const st = base('/helper');
if (st) {
  const src = source(st);
  const caps = Object.keys((JSON.parse((src.match(/--- app\.json\n([\s\S]*?)(\n--- |$)/) || [])[1] || '{}').capabilities) || {});
  emit('uses the agent or sample capability', caps.includes('agent') || caps.includes('sample'), caps.join(', '));
  // the tool's name and its first property, from the page or actor source
  // A model reads the tool's schema; the checker cannot, so it finds the
  // tools that add (defined with name: '…' or passed to a helper such as
  // addTool('add_item', …), js-5b) and tries the usual argument shapes
  // (js-5a's took items: [{name}], not a string).
  const tm = src.match(/name:\s*['"]([\w.-]+)['"][\s\S]{0,400}?(?:inputSchema|parameters|input_schema)[\s\S]{0,200}?properties:\s*\{\s*['"]?(\w+)/);
  const named = [...src.matchAll(/name:\s*['"]([A-Za-z_][\w.-]*)['"]/g)].map((m) => m[1]);
  const passed = [...src.matchAll(/\(\s*['"]([A-Za-z_][\w.-]*)['"]\s*,\s*['"`]/g)].map((m) => m[1]);   // helper('name', 'description')
  const names = [...new Set([...(tm ? [tm[1]] : []), ...named, ...passed].filter((n) => /add/i.test(n)))];
  emit('a tool the assistant can call', names.length > 0, names.length ? names.join(', ') : 'no tool definition found');
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
  // a fresh name each run, so a rerun cannot pass on a probe left by the last one
  const ITEM = 'oat milk ' + (Date.now() % 100000);
  const storedNow = () => { try { return execFileSync(process.env.SLOP, ['store', 'export', st], { encoding: 'utf8', maxBuffer: 1 << 26 }).toLowerCase().includes(ITEM); } catch { return false; } };
  if (names.length && box && await box.count()) {
    const p = (tm && tm[2]) || 'items';
    const shapes = [{ [p]: ITEM }, { [p]: [ITEM] }, { [p]: [{ name: ITEM }] }, { name: ITEM }, { item: ITEM }, { items: [ITEM] }, { items: [{ name: ITEM }] }, { text: ITEM }];
    const seen = new Set(); let worked = '';
    const send = f.getByRole('button', { name: /send|ask|go|submit/i });
    for (const n of names.slice(0, 6)) {
      for (const sh of shapes) {
        const msg = `/tool ${n} ${JSON.stringify(sh)}`;
        if (seen.has(msg)) continue; seen.add(msg);
        for (let w = 0; w < 10 && await box.isDisabled().catch(() => false); w++) await pa.waitForTimeout(1000);
        try { await box.fill(msg); await box.press('Enter'); } catch { continue; }
        await pa.waitForTimeout(800);
        if (await send.count() && (await box.inputValue().catch(() => '')).includes('/tool')) await send.first().click().catch(() => {});
        await pa.waitForTimeout(4000);
        if (storedNow()) { worked = msg; break; }
      }
      if (worked) break;
    }
    await pa.waitForTimeout(2000);
    const t = await frameText(pa);
    emit('an item the assistant adds is stored on the server', !!worked, worked ? 'found in the store after ' + worked : `not in the store export after ${seen.size} tool calls`);
    const tl = t.toLowerCase();
    emit('the item appears in the list on the page', tl.split(ITEM).length - 1 >= 2 || tl.replace(/\/tool[^\n]*/g, '').includes(ITEM), t.slice(0, 300));
  } else emit('an item the assistant adds is stored on the server', false, box && await box.count() ? 'no tool to call' : 'no chat box in the page');
  await shot(pa, 'member-ana');
  const g = sl('explain', 'can', st, 'view', '--subject', 'anonymous');
  emit('guests (for the judge)', true, JSON.stringify(g).slice(0, 200));
  emit('no page errors', !ana.errors.some((e) => /pageerror/.test(e)), ana.errors.join(' | '));
  await b.close();
}
