#!/usr/bin/env node
// review.mjs BATCH [OUT]: the review page of a batch. It collects each run
// (the request, checks, judge, screenshots, the agent's code, the
// conversation with the persona's looks, the debrief) into one JSON object,
// fills review/template.html with it, and copies the screenshots beside it:
//
//   OUT/index.html          the page (default OUT: runs/BATCH/review)
//   OUT/shots/<run>/*.png   checker, persona and agent screenshots
//   OUT/data.json           the same data, for other tools
//
// The look and the layout live in the template; this file only gathers data.
// Throwaway tokens of the runs' local servers are removed here. runs/BATCH/
// notes.json holds the reviewer's notes: {"<run>": "...", "_all": "..."}.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const [batch, outArg] = process.argv.slice(2);
if (!batch) { console.error('usage: node review.mjs BATCH [OUT]'); process.exit(2); }
const B = path.join(HERE, 'runs', batch);
const OUT = outArg || path.join(B, 'review');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const clean = (s) => String(s ?? '').replace(/slp_[A-Za-z0-9_-]{8,}/g, 'slp_…').replace(/"token"\s*:\s*"[^"]+"/g, '"token":"…"');
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);
const NOTES = readJSON(path.join(B, 'notes.json'), {});

// The agent's code: text files in its work folder (not node_modules, not dot dirs).
function codeOf(dir) {
  const files = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name), q = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, q);
      else if (/\.(js|mjs|html|css|json|sql)$/.test(e.name) && fs.statSync(p).size < 60000) files.push({ path: q, text: clean(fs.readFileSync(p, 'utf8')) });
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return files;
}

const runs = fs.readdirSync(B).filter((d) => fs.existsSync(path.join(B, d, 'run.json'))).sort().map((id) => {
  const r = readJSON(path.join(B, id, 'run.json'), {});
  const sc = readJSON(path.join(HERE, 'scenarios', id + '.json'), {});
  const dest = path.join(OUT, 'shots', id);
  fs.mkdirSync(dest, { recursive: true });
  // the checker's and the persona's screenshots, then the agent's own (look in its box)
  const all = pngs(path.join(B, id, 'shots'));
  for (const f of all) fs.copyFileSync(path.join(B, id, 'shots', f), path.join(dest, f));
  const agentShots = pngs(path.join(B, id, 'home/look/shots')).map((f) => {
    fs.copyFileSync(path.join(B, id, 'home/look/shots', f), path.join(dest, 'agent-' + f));
    return 'agent-' + f;
  });
  const j = r.judge || {};
  return {
    id, persona: sc.persona || r.persona, browser: !!r.browser, opening: sc.opening || '', note: NOTES[id] || '',
    checks: (r.checks || []).map((c) => ({ check: c.check, ok: !!c.ok, detail: clean(c.detail) })),
    judge: { ...j, summary: clean(j.summary), issues: (j.issues || []).map(clean) },
    metrics: r.metrics || {},
    shots: all.filter((f) => !f.startsWith('persona-')),
    agentShots,
    files: codeOf(path.join(B, id, 'work')),
    turns: (r.turns || []).map((t) => ({
      message: clean(t.message), reply: clean(t.reply), commands: (t.tools || []).length, ms: t.ms,
      browse: ((t.persona && t.persona.browse) || []).map((b) => ({ actions: b.actions, seen: clean(b.seen), shots: b.shots || [] })),
    })),
    debrief: clean(r.debrief && r.debrief.reply),
  };
});

const data = {
  batch, title: 'slop persona review', note: NOTES._all || '',
  lede: 'coding agents with only slop help build what a simulated person asks for; each run is checked on the server and in Chrome as members and guests, then judged. Screenshots are what those checks (and, with a browser, the person and the agent) saw.',
  runs,
};
const json = JSON.stringify(data).replace(/</g, '\\u003c'); // nothing in the data can close the script tag
const page = fs.readFileSync(path.join(HERE, 'review/template.html'), 'utf8').replace('/*DATA*/', () => json);
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(data, null, 1));
console.log(path.join(OUT, 'index.html'), runs.length, 'runs');
