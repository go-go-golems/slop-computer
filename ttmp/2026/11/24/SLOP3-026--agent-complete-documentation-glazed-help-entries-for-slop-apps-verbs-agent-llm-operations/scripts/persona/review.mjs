#!/usr/bin/env node
// review.mjs BATCH [OUT]: a review page of a batch: for each run, what the
// person asked, the checks and the judge, screenshots of what the agent
// built, its code, the conversation and its debrief. Writes OUT/index.html
// (default runs/BATCH/review) and copies the screenshots beside it.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const [batch, outArg] = process.argv.slice(2);
const B = path.join(HERE, 'runs', batch);
const OUT = outArg || path.join(B, 'review');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Throwaway tokens of the run's local server never reach the page.
const clean = (s) => String(s ?? '').replace(/slp_[A-Za-z0-9_-]{8,}/g, 'slp_…').replace(/"token"\s*:\s*"[^"]+"/g, '"token":"…"');
const para = (s) => esc(clean(s)).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</p>`).join('');

const runs = fs.readdirSync(B).filter((d) => fs.existsSync(path.join(B, d, 'run.json'))).sort().map((d) => {
  const r = JSON.parse(fs.readFileSync(path.join(B, d, 'run.json'), 'utf8'));
  const sc = JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios', d + '.json'), 'utf8'));
  // screenshots
  const shotDir = path.join(B, d, 'shots');
  const all = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort() : [];
  fs.mkdirSync(path.join(OUT, 'shots', d), { recursive: true });
  for (const f of all) fs.copyFileSync(path.join(shotDir, f), path.join(OUT, 'shots', d, f));
  const shots = all.filter((f) => !f.startsWith('persona-')); // the checker's; the persona's go with the conversation
  // the agent's own looks (look in its box, --browser)
  const lookDir = path.join(B, d, 'home/look/shots');
  const agentShots = fs.existsSync(lookDir) ? fs.readdirSync(lookDir).filter((f) => f.endsWith('.png')).sort() : [];
  for (const f of agentShots) fs.copyFileSync(path.join(lookDir, f), path.join(OUT, 'shots', d, 'agent-' + f));
  // the code the agent wrote: text files in its work dir
  const files = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name), q = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, q);
      else if (/\.(js|mjs|html|css|json|sql)$/.test(e.name) && fs.statSync(p).size < 60000) files.push({ path: q, text: fs.readFileSync(p, 'utf8') });
    }
  };
  if (fs.existsSync(path.join(B, d, 'work'))) walk(path.join(B, d, 'work'));
  return { id: d, r, sc, shots, agentShots, files };
});

// notes.json beside the runs: the reviewer's notes, per scenario and "_all".
const NOTES = (() => { try { return JSON.parse(fs.readFileSync(path.join(B, 'notes.json'), 'utf8')); } catch { return {}; } })();
const score = (n) => `<span class="score s${n ?? 0}">${n ?? '–'}</span>`;
const secs = (ms) => `${Math.round((ms || 0) / 1000)} s`;
const allPass = (r) => r.checks.length && r.checks.every((c) => c.ok);

const thumbs = (id, fs_) => `<div class="shots small">${fs_.map((f) => `<figure><a href="shots/${esc(id)}/${esc(f)}" target="_blank" rel="noopener"><img src="shots/${esc(id)}/${esc(f)}" alt="${esc(f)}" loading="lazy"></a><figcaption>${esc(f.replace('.png', '').replace(/^persona-t\d+-\d+-/, '').replace(/^agent-look-/, ''))}</figcaption></figure>`).join('')}</div>`;
const looks = (id, t) => ((t.persona && t.persona.browse) || []).map((b) => `<div class="look"><div class="who person">Person looks at the site</div><code class="acts">${esc(JSON.stringify(b.actions))}</code><details class="seen"><summary>What they saw</summary><pre>${esc(clean(b.seen))}</pre></details>${thumbs(id, b.shots || [])}</div>`).join('');
const card = ({ id, r, sc, shots, agentShots, files }) => {
  const m = r.metrics || {}, j = r.judge || {};
  const passed = r.checks.filter((c) => c.ok).length;
  return `
<section class="run" id="${esc(id)}">
  <header class="run-head">
    <div class="run-title">
      <h2>${esc(id)}</h2>
      <span class="chip ${allPass(r) ? 'ok' : 'bad'}">${passed}/${r.checks.length} checks</span>
      <span class="chip plain">${esc(sc.persona)}</span>
    </div>
    <p class="ask">“${esc(sc.opening)}”</p>
    ${NOTES[id] ? `<p class="note"><b>Reviewer's note.</b> ${esc(NOTES[id])}</p>` : ''}
  </header>
  <div class="grid">
    <div class="col">
      <h3>Judge</h3>
      <table class="scores"><tr>${['goal', 'grounding', 'honesty', 'efficiency', 'communication'].map((k) => `<th>${k}</th>`).join('')}</tr>
        <tr>${['goal', 'grounding', 'honesty', 'efficiency', 'communication'].map((k) => `<td>${score(j[k])}</td>`).join('')}</tr></table>
      ${j.summary ? `<p class="summary">${esc(clean(j.summary))}</p>` : `<p class="summary dim">${esc(j.error || 'no judgment')}</p>`}
      ${(j.issues || []).length ? `<ul class="issues">${j.issues.map((i) => `<li>${esc(clean(i))}</li>`).join('')}</ul>` : ''}
      <h3>Checks <span class="dim">(on the server and in Chrome)</span></h3>
      <ul class="checks">${r.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="mark">${c.ok ? '✓' : '✗'}</span><div><b>${esc(c.check)}</b>${c.detail ? `<small>${esc(clean(c.detail)).slice(0, 400)}</small>` : ''}</div></li>`).join('')}</ul>
      <dl class="metrics">
        <div><dt>commands</dt><dd>${m.commands ?? '–'}</dd></div>
        <div><dt>failed</dt><dd>${m.failed ?? '–'}</dd></div>
        <div><dt>help reads</dt><dd>${m.helpReads ?? '–'}</dd></div>
        <div><dt>turns</dt><dd>${m.turns ?? '–'}</dd></div>
        <div><dt>agent time</dt><dd>${secs(m.ms)}</dd></div>
        <div><dt>blocked egress</dt><dd>${(m.egressDenied || []).length}</dd></div>
      </dl>
    </div>
    <div class="col">
      <h3>What it built</h3>
      ${shots.length ? `<div class="shots">${shots.map((f) => `<figure><a href="shots/${esc(id)}/${esc(f)}" target="_blank" rel="noopener"><img src="shots/${esc(id)}/${esc(f)}" alt="${esc(id)}: ${esc(f.replace('.png', ''))}" loading="lazy"></a><figcaption>${esc(f.replace('.png', '').replace(/-/g, ' '))}</figcaption></figure>`).join('')}</div>` : '<p class="dim">No screenshots (the page was not found).</p>'}
    </div>
  </div>
  <details><summary>The agent's code <span class="dim">(${files.length} file${files.length === 1 ? '' : 's'} in its work folder)</span></summary>
    ${files.map((f) => `<h4>${esc(f.path)}</h4><pre><code>${esc(clean(f.text))}</code></pre>`).join('') || '<p class="dim">None.</p>'}
  </details>
  <details><summary>The conversation <span class="dim">(${r.turns.length} turn${r.turns.length === 1 ? '' : 's'})</span></summary>
    ${r.turns.map((t, i) => `<div class="turn"><div class="who person">Person · turn ${i + 1}</div>${para(t.message)}<div class="who agent">Agent · ${t.tools.length} commands · ${secs(t.ms)}</div>${para(t.reply)}${looks(id, t)}</div>`).join('')}
  </details>
  ${agentShots.length ? `<details><summary>The agent's own looks <span class="dim">(${agentShots.length} screenshot${agentShots.length === 1 ? '' : 's'} from <code>look</code> in its box)</span></summary>${thumbs(id, agentShots.map((f) => 'agent-' + f))}</details>` : ''}
  <details><summary>The agent's debrief</summary>${para(r.debrief && r.debrief.reply)}</details>
</section>`;
};

const tot = runs.reduce((a, { r }) => ({ cmds: a.cmds + (r.metrics?.commands || 0), ms: a.ms + (r.metrics?.ms || 0), pass: a.pass + (allPass(r) ? 1 : 0) }), { cmds: 0, ms: 0, pass: 0 });
const html = `<title>slop JS API review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap">
<style>
/* Layout: a sticky index of runs, then one section per run: judgment and checks beside the screenshots, code and conversation folded below. */
:root {
  --bg: #f6f7f5; --panel: #ffffff; --fg: #1c211e; --dim: #66706a; --rule: #dde2dd;
  --accent: #2f6f5e; --ok: #23824f; --bad: #c0392b; --warn: #b7791f; --code: #eef1ee;
  --display: "Space Grotesk", "IBM Plex Sans", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #121614; --panel: #1a1f1c; --fg: #e3e8e4; --dim: #94a09a; --rule: #2c3430;
  --accent: #6cc3a6; --ok: #5cc98a; --bad: #ef7d6e; --warn: #e2b05a; --code: #20262299; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #121614; --panel: #1a1f1c; --fg: #e3e8e4; --dim: #94a09a; --rule: #2c3430;
  --accent: #6cc3a6; --ok: #5cc98a; --bad: #ef7d6e; --warn: #e2b05a; --code: #20262299; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); }
.wrap { max-width: 1180px; margin: 0 auto; padding-block: 28px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2 { font-family: var(--display); text-wrap: balance; margin: 0; }
h1 { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
h2 { font-size: 21px; font-weight: 600; }
h3 { font: 600 12px var(--body); letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin: 18px 0 8px; }
h4 { font: 500 13px var(--mono); margin: 14px 0 4px; }
.lede { max-width: 70ch; color: var(--dim); margin: 8px 0 18px; }
.dim { color: var(--dim); font-weight: 400; text-transform: none; letter-spacing: 0; }
code, pre { font-family: var(--mono); font-size: 12.5px; }
p code { background: var(--code); padding: 1px 4px; border-radius: 3px; }
nav.index { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); padding: 10px 0; display: flex; flex-wrap: wrap; gap: 6px; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
nav.index a { color: var(--fg); text-decoration: none; font: 500 13px var(--mono); padding: 4px 9px; border: 1px solid var(--rule); border-radius: 4px; display: inline-flex; gap: 6px; align-items: center; background: var(--panel); }
nav.index a:hover, nav.index a:focus-visible { border-color: var(--accent); outline: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot.bad { background: var(--bad); }
.totals { display: flex; flex-wrap: wrap; gap: 28px; margin: 6px 0 4px; }
.totals div { display: grid; }
.totals b { font: 600 24px var(--display); font-variant-numeric: tabular-nums; }
.totals span { font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
.run { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 20px 22px; margin-top: 22px; scroll-margin-top: 64px; }
.run-title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ask { font-size: 16px; max-width: 75ch; margin: 10px 0 0; }
.chip { font: 500 12px var(--mono); padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.chip.ok { color: var(--ok); } .chip.bad { color: var(--bad); } .chip.plain { color: var(--dim); }
.grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 28px; }
@media (max-width: 860px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.col { min-width: 0; }
.scores { border-collapse: collapse; width: 100%; }
.scores th { font: 500 11px var(--body); color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; text-align: left; padding: 0 4px 4px 0; }
.score { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 5px; font: 600 15px var(--display); font-variant-numeric: tabular-nums; color: #fff; background: var(--dim); }
.score.s5, .score.s4 { background: var(--ok); } .score.s3 { background: var(--warn); } .score.s2, .score.s1 { background: var(--bad); }
.summary { margin: 10px 0 6px; }
.issues { margin: 0; padding-left: 18px; color: var(--dim); font-size: 14px; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.checks li { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 6px; font-size: 14px; }
.checks .mark { font-weight: 700; }
.checks li.ok .mark { color: var(--ok); } .checks li.bad .mark { color: var(--bad); }
.checks small { display: block; color: var(--dim); font: 12px/1.45 var(--mono); overflow-wrap: anywhere; }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 16px; margin: 18px 0 0; }
.metrics div { display: grid; }
.metrics dt { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
.metrics dd { margin: 0; font: 600 18px var(--display); font-variant-numeric: tabular-nums; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; }
figure { margin: 0; min-width: 0; }
figure img { width: 100%; max-width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: left top; border: 1px solid var(--rule); border-radius: 4px; display: block; background: var(--code); }
figure a:focus-visible img { outline: 2px solid var(--accent); }
figcaption { font: 12px var(--mono); color: var(--dim); margin-top: 4px; }
details { border-top: 1px solid var(--rule); margin-top: 16px; padding-top: 10px; }
summary { cursor: pointer; font-weight: 600; }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
pre { background: var(--code); padding: 10px 12px; border-radius: 4px; overflow-x: auto; max-height: 420px; }
.shots.small { grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); margin-top: 8px; }
.look { margin: 10px 0 4px; padding: 8px 10px; background: var(--code); border-radius: 4px; }
.acts { display: block; font-size: 12px; overflow-wrap: anywhere; color: var(--dim); }
details.seen { border: 0; margin: 6px 0 0; padding: 0; }
details.seen summary { font-weight: 500; font-size: 13px; }
.note { max-width: 85ch; margin: 12px 0 0; padding: 8px 12px; border-left: 3px solid var(--warn); background: var(--code); font-size: 14px; }
.turn { border-left: 3px solid var(--rule); padding-left: 12px; margin: 14px 0; max-width: 85ch; min-width: 0; overflow-wrap: anywhere; }
.who { font: 600 12px var(--body); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 8px; }
.who.person { color: var(--accent); } .who.agent { color: var(--dim); }
</style>
<div class="wrap">
  <h1>slop JS API review</h1>
  <p class="lede">Batch <code>${esc(batch)}</code>${runs.some(({ r }) => r.browser) ? ' (agent and person with a browser)' : ''}: coding agents with only <code>slop help</code> built apps that need the JavaScript API (live rooms, uploads, downloads, alarms, SQL migrations, store bindings, agent tools). Each was checked on the server and in Chrome as members and guests, then judged. Screenshots are what those checks saw.</p>
  <div class="totals">
    <div><b>${tot.pass}/${runs.length}</b><span>runs with every check passed</span></div>
    <div><b>${tot.cmds}</b><span>commands</span></div>
    <div><b>${secs(tot.ms)}</b><span>agent time</span></div>
  </div>
  ${NOTES._all ? `<p class="note"><b>Reviewer's note.</b> ${esc(NOTES._all)}</p>` : ''}
  <nav class="index" aria-label="Runs">${runs.map(({ id, r }) => `<a href="#${esc(id)}"><span class="dot ${allPass(r) ? '' : 'bad'}"></span>${esc(id)}</a>`).join('')}</nav>
  ${runs.map(card).join('\n')}
</div>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(path.join(OUT, 'index.html'), runs.length, 'runs');
