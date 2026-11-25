#!/usr/bin/env node
// rejudge.mjs BATCH SCENARIO: judge a finished run again (after a judge or
// checker fix), replacing run.json's judge; the old one is kept as judgeBefore.
import fs from 'node:fs';
import path from 'node:path';
import { judge } from './judge.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const [batch, scenario] = process.argv.slice(2);
const RUN = path.join(HERE, 'runs', batch, scenario);
const run = JSON.parse(fs.readFileSync(path.join(RUN, 'run.json'), 'utf8'));
const sc = JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios', scenario + '.json'), 'utf8'));
const persona = JSON.parse(fs.readFileSync(path.join(HERE, 'personas', sc.persona + '.json'), 'utf8'));
// Rerun checks first when asked, so a fixed checker feeds the judge.
if (process.env.CHECKS) run.checks = fs.readFileSync(process.env.CHECKS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (process.env.CHECKS && run.metrics) { run.metrics.checksPassed = run.checks.filter((c) => c.ok).length; run.metrics.checksTotal = run.checks.length; }
const r = judge(run, sc, persona, RUN);
run.judgeBefore = run.judge;
run.judge = r.judge;
run.tokens.judge += r.tokens;
fs.writeFileSync(path.join(RUN, 'run.json'), JSON.stringify(run, null, 2));
console.log(JSON.stringify(r.judge).slice(0, 600));
