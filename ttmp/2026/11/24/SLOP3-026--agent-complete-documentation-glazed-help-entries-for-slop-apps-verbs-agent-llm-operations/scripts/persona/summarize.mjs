// summarize.mjs BATCH: one line per run, then the failed commands of all runs.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'runs', process.argv[2]);
const runs = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'run.json'))).map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, 'run.json'), 'utf8')));
const row = (r) => {
  const m = r.metrics || {}, j = r.judge || {};
  return [r.scenario, r.persona, m.turns, m.commands, m.failed, m.helpReads, m.helpBeforeFirstFailure, `${m.checksPassed}/${m.checksTotal}`,
    j.goal, j.grounding, j.honesty, j.efficiency, j.communication, (m.outsideReads || []).length + (m.sourceProbes || []).length, (m.egressDenied || []).length, Math.round((m.ms || 0) / 1000) + 's'].join(' | ');
};
console.log('| scenario | persona | turns | cmds | failed | help | help<1st fail | checks | goal | ground | honest | effic | comm | outside | egress | time |');
console.log('|' + ' --- |'.repeat(16));
for (const r of runs) console.log('| ' + row(r) + ' |');
console.log('\nFailed commands:');
for (const r of runs) for (const f of r.failures || []) console.log(`- ${r.scenario} t${f.turn}: ${f.cmd.replace(/\n/g, ' ').slice(0, 140)}\n    → ${f.output.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 200)}\n    next: ${(f.next || '').replace(/\n/g, ' ').slice(0, 140)}`);
// Runs that met a model-service failure: their scores may say nothing about
// the docs (an empty persona reply reads as giving up).
const hit = runs.filter((r) => (r.infra || []).length || (r.turns || []).some((t) => /not JSON: $/.test((t.persona && t.persona.why) || '')));
if (hit.length) {
  console.log('\nModel service failures (rerun these):');
  for (const r of hit) console.log(`- ${r.scenario}: ${(r.infra || ['empty persona reply']).join('; ')}`);
}
