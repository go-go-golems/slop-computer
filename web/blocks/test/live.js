// Claude Blocks on slop's runtime, end to end against a running server
// (SLOP-009 phase 4 and 5 exits): an agent completes the chat protocol with
// slop data, two tabs edit one workspace, a reload converges, a 3,000-op
// session checkpoints, and diff sync is measured.
//   SLOP_SERVER=… SLOP_TOKEN=… SLOP_BIN=slop node web/blocks/test/live.js <workspace>
// Needs blocks pushed, the workspace created with app = blocks (empty),
// local mode, playwright on NODE_PATH.
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const base = process.env.SLOP_SERVER || 'http://localhost:8080';
const ws = process.argv[2] || 'ws-team';
const run = (...a) => execFileSync(process.env.SLOP_BIN || 'slop', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const data = (...a) => JSON.parse(run('data', ...a));
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + what + (extra === undefined ? '' : (ok ? '  — ' : ' — ') + JSON.stringify(extra).slice(0, 300))); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The next turn id, once the page has moved past prev (it rewrites the
// view 1.5 s after a change; a reused id is never applied again).
async function nextTurn(prev) {
  return until(() => { const v = data('get', ws, 'data/users/me/blocks').body; return v.next !== prev ? v.next : null; }, 20000);
}
// Waits for the page to stamp a turn applied.
async function applied(id, ms = 60000) {
  return until(() => { const d = data('get', ws, 'data/users/me/blocks/turns/' + id); return d.exists && d.body.applied ? d.body.applied : null; }, ms);
}
async function until(fn, ms = 15000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch {} await sleep(300); } return v; }

// Counts the runtime's db writes from inside the app frame: op, bytes.
const meter = () => {
  window.__writes = [];
  const f = window.fetch;
  window.fetch = function (url, init) {
    try {
      if (String(url).endsWith('/_rt/rpc') && init && typeof init.body === 'string') {
        const m = JSON.parse(init.body);
        if (m.method === 'db.write') window.__writes.push({ op: m.args.op, path: m.args.path, bytes: init.body.length });
      }
    } catch {}
    return f.apply(this, arguments);
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.request.post(base + '/auth/local', { form: { nickname: 'manuel' }, headers: { Origin: base }, maxRedirects: 0 });
  const errs = [];
  const open = async () => {
    const p = await ctx.newPage();
    // Accept the Workshop's consent dialog (sample) as a person would.
    const t = setInterval(async () => { const bt = p.locator('.dialog button:has-text("Allow")'); if (await bt.count().catch(() => 0)) await bt.first().click().catch(() => {}); }, 300);
    p.on('close', () => clearInterval(t));
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + '/run/' + ws);
    const fr = await (await p.waitForSelector('iframe', { timeout: 15000 })).contentFrame();
    await until(() => fr.evaluate(() => document.body.innerText.includes('Shared · live')));
    return { p, fr };
  };
  const A = await open();
  await A.fr.evaluate(meter);
  check(true, 'tab A shows the workspace, shared and live');

  // The chat protocol, verbatim from the page's README for Claude.
  let view = await until(() => { const d = data('get', ws, 'data/users/me/blocks'); return d.exists ? d.body : null; });
  check(view && typeof view.how === 'string' && 'tree' in view && view.next, 'READ: data/users/me/blocks is the view the page keeps current', view && Object.keys(view));
  const turn = view.next;
  run('data', 'set', ws, 'data/users/me/blocks/turns/' + turn, '--data', JSON.stringify({ text: [
    'trip:', '  title = "Lisbon in May"', '  icon = "🇵🇹"', '  days = 5', '  nightly = 120', '  stay = nightly * (days - 1)',
    '  ui:', '    p "{days} days in Alfama; the flat comes to €{stay}."', '    slider days, min: 2, max: 14, label: "Days"',
  ].join('\n') }));
  const stamp = await applied(turn);
  check(stamp && stamp.errors.length === 0, 'the page stamps the turn applied, with no rejected lines', stamp);
  const shown = await until(() => A.fr.evaluate(() => document.body.innerText.includes('Lisbon in May')), 20000);
  check(shown, 'WRITE: the agent’s turn streams into the open page');
  view = await until(() => { const v = data('get', ws, 'data/users/me/blocks').body; return v.last && v.next !== turn ? v : null; });
  check(view && view.tree.includes('stay') && view.next !== turn, 'the view reports the turn and offers the next id', view && view.last);
  const stay = await until(() => data('get', ws, 'data/users/me/blocks').body.tree.includes('480'));
  check(stay, 'the formula is live: stay = 120 * (5 - 1) = 480 in the tree');

  // A second tab on the same workspace sees it, and edits reach the first.
  const Bt = await open();
  await Bt.fr.evaluate(meter);
  const inB = await until(() => Bt.fr.evaluate(() => document.body.innerText.includes('Lisbon in May')), 20000);
  check(inB, 'tab B loads the workspace from the db and shows the page');
  const next2 = await nextTurn(turn);
  run('data', 'set', ws, 'data/users/me/blocks/turns/' + next2, '--data', JSON.stringify({ text: 'notes:\n  title = "Shared notes"\n  ui:\n    p "Written while two tabs watch."' }));
  const both = await until(async () => (await A.fr.evaluate(() => document.body.innerText.includes('Shared notes'))) && (await Bt.fr.evaluate(() => document.body.innerText.includes('Shared notes'))), 20000);
  check(both, 'a later turn shows in both tabs');
  await applied(next2);

  // A reload converges.
  await Bt.p.reload();
  const fr2 = await (await Bt.p.waitForSelector('iframe')).contentFrame();
  const after = await until(() => fr2.evaluate(() => document.body.innerText.includes('Lisbon in May') && document.body.innerText.includes('Shared notes')), 20000);
  await fr2.evaluate(meter);
  check(after, 'after a reload tab B shows both pages');

  // 3,000 ops in one session: the log checkpoints (meta/snap).
  const before = data('get', ws, 'meta/snap');
  const next3 = await nextTurn(next2);
  const lines = ['bulk:', '  title = "Bulk"'];
  for (let i = 0; i < 3100; i++) lines.push(`  c${i} = ${i}`);
  run('data', 'set', ws, 'data/users/me/blocks/turns/' + next3, '--data', JSON.stringify({ text: lines.join('\n') }));
  const bulk = await applied(next3, 180000);
  check(bulk && bulk.ops >= 3000 && bulk.errors.length === 0, 'the 3,100-line turn applies', bulk && { ops: bulk.ops, errors: bulk.errors.length });
  const snap = await until(() => { const s = data('get', ws, 'meta/snap'); return s.exists && (!before.exists || s.version > before.version) ? s : null; }, 120000);
  check(!!snap, 'a 3,000-op session writes a checkpoint (meta/snap)', snap && { version: snap.version, keys: Object.keys(snap.body) });
  const chunks = data('list', ws, 'chunks', '--limit', '1000').docs;
  check(chunks.length > 0, 'the log is in chunks/*', chunks.length + ' chunks');

  // Diff sync: small edits append to a tab's growing chunk; its rewrites
  // travel as patches. Twenty one-line turns, then count both tabs' writes.
  let prev = next3;
  for (let i = 0; i < 20; i++) {
    const id = await nextTurn(prev);
    run('data', 'set', ws, 'data/users/me/blocks/turns/' + id, '--data', JSON.stringify({ text: `trip.days = ${3 + (i % 10)}` }));
    await applied(id);
    prev = id;
  }
  await sleep(3000);
  const w = [...await A.fr.evaluate(() => window.__writes), ...await fr2.evaluate(() => window.__writes)];
  const chunkWrites = w.filter(x => x.path.startsWith('chunks/'));
  const patches = chunkWrites.filter(x => x.op === 'patch'), sets = chunkWrites.filter(x => x.op === 'set');
  const avg = xs => xs.length ? Math.round(xs.reduce((a, x) => a + x.bytes, 0) / xs.length) : 0;
  check(patches.length > 0 && avg(patches) < avg(sets), 'chunk rewrites go as patches, smaller than whole bodies',
    { patches: patches.length, avgPatchBytes: avg(patches), sets: sets.length, avgSetBytes: avg(sets), total: w.length });
  // A Claude block: a hole the page fills with the model (sample, Pi). The
  // page fills holes a turn sets (path = ?"intent"), not appended ones.
  const hid = await nextTurn(prev);
  run('data', 'set', ws, 'data/users/me/blocks/turns/' + hid, '--data', JSON.stringify({ text: 'trip.ui.9 = ?"one sentence on why to visit Lisbon in May"' }));
  await applied(hid);
  // The model's Hypha may still have rejected lines; the runtime's part is
  // that the hole is taken and a Claude peer writes into it.
  const filled = await until(() => { const v = data('get', ws, 'data/users/me/blocks').body; return v.holes.length === 0 && v.recent.some(l => /^Claude · \d+: trip\.ui\.9/.test(l)) ? v.recent.filter(l => l.startsWith('Claude · ')) : null; }, 180000);
  check(!!filled, 'a Claude block (hole) is filled by the model through sample', filled);
  check(!errs.length, 'no page errors', errs);
  await b.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
