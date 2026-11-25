#!/usr/bin/env node
// One persona run (SLOP3-026 design 4.1): a coding agent (pi, in a bwrap box
// with only `slop` and an empty work dir, no source) works for a simulated
// person on its own local slop server. Then a checker settles the facts on
// the server, the agent is asked what it wished it had known, and a judge
// scores the conversation against the facts.
//
//   node run.mjs <scenario> --port 18701 --batch pilot-1 [--slop ./slop]
//
// Writes runs/<batch>/<scenario>/{run.json,transcript.md,agent-*.jsonl,…}.
// Needs: bwrap; pi with the lunaroute extension in ~/.pi/agent/npm; a
// lunaroute-only agent dir (AGENT_DIR, see README); Playwright in PW_DIR for
// the device-login approval.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { judge, transcriptOf, isFail } from './judge.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '18701' },
    batch: { type: 'string', default: 'adhoc' },
    slop: { type: 'string', default: process.env.SLOP_BIN || '' },
    out: { type: 'string', default: path.join(HERE, 'runs') },
    'agent-thinking': { type: 'string', default: 'high' },
    dry: { type: 'boolean', default: false }, // setup and checks only: test a scenario's setup and checker
    // A real browser for both sides: the agent gets `look` in its box, the
    // persona may look at the site before each answer (look.mjs).
    browser: { type: 'boolean', default: process.env.BROWSER === '1' },
  },
});
const SCENARIO = positionals[0];
if (!SCENARIO || !o.slop) {
  console.error('usage: node run.mjs <scenario> --slop <slop binary> [--port N] [--batch name]');
  process.exit(2);
}
const MODEL = ['--provider', 'lunaroute', '--model', 'deepseek-4.1-flash'];
const LUNA = path.join(process.env.HOME, '.pi/agent/npm/node_modules/@lunaroute/pi-extension');
const AGENT_DIR = process.env.AGENT_DIR; // lunaroute-only auth.json, models-store.json, settings.json
const PW_DIR = process.env.PW_DIR; // a folder with node_modules/playwright
const CHROME = process.env.CHROME || '';
if (!AGENT_DIR || !PW_DIR) throw new Error('set AGENT_DIR and PW_DIR (README)');

const sc = JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios', SCENARIO + '.json'), 'utf8'));
const persona = JSON.parse(fs.readFileSync(path.join(HERE, 'personas', sc.persona + '.json'), 'utf8'));
const PORT = o.port;
const RUN = path.resolve(o.out, o.batch, SCENARIO);
fs.rmSync(RUN, { recursive: true, force: true });
for (const d of ['data', 'home/.pi', 'home/.config/slop', 'work', 'host/config']) fs.mkdirSync(path.join(RUN, d), { recursive: true });
fs.cpSync(AGENT_DIR, path.join(RUN, 'home/.pi/agent'), { recursive: true });
const SLOP = path.resolve(o.slop);
const SERVER = `http://slop.localhost:${PORT}`;
const HOSTENV = { ...process.env, SLOP_SERVER: SERVER, SLOP_CREDENTIALS: path.join(RUN, 'host/creds.json'), XDG_CONFIG_HOME: path.join(RUN, 'host/config') };
const log = (...a) => console.error(`[${SCENARIO}]`, ...a);
const run = { scenario: SCENARIO, persona: sc.persona, batch: o.batch, browser: o.browser, startedAt: new Date().toISOString(), turns: [], tokens: { agent: 0, persona: 0, judge: 0 } };
const save = () => fs.writeFileSync(path.join(RUN, 'run.json'), JSON.stringify(run, null, 2));

// ---- server and login -------------------------------------------------------
const server = spawn(SLOP, ['serve', '--local', '--llm', 'fake', '--admin-email', 'admin@example.com', '--data', path.join(RUN, 'data'), '--listen', `127.0.0.1:${PORT}`],
  { stdio: ['ignore', fs.openSync(path.join(RUN, 'server.log'), 'w'), fs.openSync(path.join(RUN, 'server.log'), 'a')], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
// The box's network (net.mjs): only the model provider and this server.
const NET_DIR = path.join(RUN, 'net');
fs.mkdirSync(NET_DIR, { recursive: true });
const netProc = spawn('node', [path.join(HERE, 'net.mjs'), NET_DIR, String(PORT)], { stdio: 'ignore' });
netProc.unref(); // or it keeps the event loop alive, and the exit handler below never runs
process.on('exit', () => netProc.kill());
for (let i = 0; i < 40 && !fs.existsSync(path.join(NET_DIR, 'ready')); i++) await new Promise((r) => setTimeout(r, 100));
if (!fs.existsSync(path.join(NET_DIR, 'ready'))) throw new Error('net.mjs did not start');
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143)); // exit handlers stop the server and net.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) {
  const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', `Host: slop.localhost:${PORT}`, `http://127.0.0.1:${PORT}/readyz`], { encoding: 'utf8' });
  if (r.stdout === '200') break;
  if (i > 60) throw new Error('server did not start; see server.log');
  await sleep(250);
}
{
  const login = spawn(SLOP, ['auth', 'login', '--name', 'persona-run', '--scopes', 'read,write,admin', '--days', '1'], { env: HOSTENV });
  let text = '';
  login.stdout.on('data', (d) => (text += d));
  login.stderr.on('data', (d) => (text += d));
  for (let i = 0; !/device\?code=/.test(text); i++) { if (i > 80) throw new Error('no device code: ' + text); await sleep(200); }
  const url = text.match(/http\S*device\?code=[A-Z0-9-]*/)[0];
  const ap = spawnSync('node', [path.join(HERE, 'approve.mjs'), url, 'admin@example.com', 'Admin', 'read,write,admin'], { cwd: PW_DIR, env: { ...process.env, CHROME, PW_DIR }, encoding: 'utf8' });
  if (ap.status !== 0) throw new Error('approve failed: ' + ap.stderr);
  await new Promise((r) => login.on('exit', r));
  if (!/scopes \[read write admin\]/.test(text)) throw new Error('login: ' + text);
  // The agent acts as the same admin, from its own config inside the box.
  fs.copyFileSync(HOSTENV.SLOP_CREDENTIALS, path.join(RUN, 'home/.config/slop/credentials.json'));
}

// ---- setup -------------------------------------------------------------------
const REPO = path.resolve(HERE, '../../../../../../..'); // apps/ for setups that deploy shipped apps
const shEnv = { ...HOSTENV, TZ: 'UTC', SLOP: SLOP, PORT, WORK: path.join(RUN, 'work'), SETUP: path.join(HERE, 'setup'), RUN, REPO };
for (const cmd of sc.setup || []) {
  const r = spawnSync('bash', ['-c', cmd], { env: shEnv, encoding: 'utf8', cwd: path.join(HERE, 'setup') });
  if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stdout}\n${r.stderr}`);
}
save();

// ---- pi calls ------------------------------------------------------------------
function piEvents(file) {
  const ev = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (line.trim()) try { ev.push(JSON.parse(line)); } catch {} }
  return ev;
}
function finalText(ev) {
  const end = ev.filter((e) => e.type === 'agent_end').at(-1);
  const m = end && end.messages.filter((x) => x.role === 'assistant').at(-1);
  return m ? (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() : '';
}
function tokens(ev) {
  const end = ev.filter((e) => e.type === 'agent_end').at(-1);
  return end ? end.messages.reduce((n, m) => n + ((m.usage && m.usage.totalTokens) || 0), 0) : 0;
}

const SYSTEM = path.join(RUN, 'home/system.md');
fs.writeFileSync(SYSTEM, [
  'You are a coding agent working for a person, in a terminal.',
  'The `slop` command-line tool is installed and already logged in to the person\'s slop server.',
  'You do not have slop\'s source code. `slop help` is its documentation.',
  'Your working directory is ~/work.',
  ...(o.browser ? [
    'You can see the person\'s site in a real browser: `look --help` (signed in as a team member, as a second member, or as a guest).',
    'Check what you build there the way the person will use it before you say it works.',
  ] : []),
].join('\n'));

let turnNo = 0;
async function agentTurn(message, tag) {
  turnNo++;
  const out = path.join(RUN, `agent-${String(turnNo).padStart(2, '0')}-${tag}.jsonl`);
  const args = [path.join(HERE, 'box.sh'), path.join(RUN, 'work'), path.join(RUN, 'home'), SLOP,
    `SLOP_SERVER=${SERVER}`, '--',
    'pi', '-p', '--mode', 'json', '--session-dir', '/home/agent/.pi/sessions', '--session-id', 'run',
    '--no-context-files', '--no-skills', '--no-extensions', '-e', '/opt/pinpm/node_modules/@lunaroute/pi-extension',
    // Built-in tools only: the lunaroute extension adds a document-fetch tool
    // that runs outside the box (pilot-1 fetched slop's source through it).
    '--tools', 'read,bash,edit,write',
    ...MODEL, '--thinking', o['agent-thinking'], '--append-system-prompt', '/home/agent/system.md', message];
  const t0 = Date.now();
  // 30 minutes a turn: pilot-1 lost a whole reply at 15 (a 10-minute npm install).
  const r = spawnSync('bash', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60000, killSignal: 'SIGTERM', env: { ...process.env, NET_DIR, NET_PORT: String(PORT), BROWSER: o.browser ? '1' : '', PW_DIR, CHROME } });
  fs.writeFileSync(out, r.stdout || '');
  if (r.stderr) fs.writeFileSync(out.replace(/\.jsonl$/, '.stderr.txt'), r.stderr);
  const ev = piEvents(out);
  const starts = new Map(ev.filter((e) => e.type === 'tool_execution_start').map((e) => [e.toolCallId, e]));
  const tools = ev.filter((e) => e.type === 'tool_execution_end').map((e) => {
    const s = starts.get(e.toolCallId) || {};
    const text = ((e.result && e.result.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { tool: e.toolName, args: s.args || {}, isError: !!e.isError, output: text.slice(0, 4000) };
  });
  const reply = finalText(ev);
  const tk = tokens(ev);
  run.tokens.agent += tk;
  const timedOut = !!(r.error && /ETIMEDOUT/.test(String(r.error)));
  if (timedOut) log('agent turn timed out');
  return { ms: Date.now() - t0, reply, tools, tokens: tk, exit: r.status, timedOut, error: r.error ? String(r.error) : undefined };
}

function pi(prompt, thinking) {
  const r = spawnSync('pi', ['-p', '--no-session', '--no-tools', '--no-context-files', '--no-skills', '--no-extensions', '-e', LUNA, ...MODEL,
    '--thinking', thinking, '--mode', 'json', prompt], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 10 * 60000, cwd: RUN });
  const ev = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { text: finalText(ev), tokens: tokens(ev) };
}
function json(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

// ---- the persona ---------------------------------------------------------------
// look(actions, tag): what the persona sees in its browser (look.mjs).
function look(actions, tag) {
  const r = spawnSync('node', [path.join(HERE, 'look.mjs'), RUN, tag], { input: JSON.stringify(actions), encoding: 'utf8', timeout: 3 * 60000, env: { ...process.env, PORT, PW_DIR, CHROME } });
  try { return JSON.parse(r.stdout); } catch { return { seen: 'The browser did not open (' + String(r.stderr || r.error || '').slice(0, 200) + ')', shots: [] }; }
}
const LOOKS = 3; // looks per answer
const BROWSE = [
  `You have the site open in your browser. It is at ${'http://apps.localhost:' + PORT}; you are signed in as Sam, a team member. You can also use a colleague's browser (Kim, another member) or a private window (not signed in).`,
  `Before you write your message you may look, as many as ${LOOKS} times: instead of the message, reply with JSON only: {"browse": [actions…], "why": "a note for the tester"}. Actions, in order: {"as": "me"|"colleague"|"guest"}, {"open": "/path"}, {"click": "text on the button or link"}, {"type": "the field's label or placeholder", "text": "..."}, {"press": "Enter"}, {"choose_file": "photo"} (picks one of your pictures), {"wait": seconds}. Each look starts by opening a page. You will be told what you see on the screen.`,
  `Look the way this person would: when the assistant says something is ready, try it yourself, as the people who will use it. Say what you saw, in your own words, if it does not work.`,
].join('\n\n');

function personaTurn() {
  const convo = run.turns.map((t) => `PERSON: ${t.message}\n\nASSISTANT: ${t.reply || '(no answer)'}`).join('\n\n---\n\n');
  const browsed = [];
  for (let n = 0; ; n++) {
    const p = personaAsk(convo, browsed, n < LOOKS && o.browser);
    if (p.browse && o.browser && n < LOOKS) {
      const tag = `persona-t${run.turns.length}-${n + 1}`;
      const r = look(p.browse, tag);
      browsed.push({ actions: p.browse, why: p.why, seen: r.seen, shots: r.shots });
      log(`persona looked: ${JSON.stringify(p.browse).slice(0, 100)}`);
      continue;
    }
    return { ...p, browse: browsed };
  }
}
function personaAsk(convo, browsed, mayLook) {
  const prompt = [
    `You play a person talking to a coding assistant in a terminal. Stay in character.`,
    `Who you are: ${persona.name}. ${persona.text}`,
    `What you know: ${persona.knows}. How you write: ${persona.style}.`,
    sc.personaKnows ? `What you know about this task: ${sc.personaKnows}` : '',
    `What you want: ${sc.goal}.`,
    sc.later && sc.later.length ? `Follow-ups you may ask once the first part is done, in your own words: ${sc.later.join(' / ')}` : '',
    `Write the next message as this person would: in your own words, briefly, without vocabulary you would not know. Answer the assistant's questions from what you know, or say you do not know. If its answer does not fit what you know, say so. You may ask it to show you that something works. Never write code, never mention that this is a test.`,
    `When you have what you wanted, or you would give up (you give up after ${persona.patience} answers that do not help), set done to true.`,
    `Reply with JSON only: {"message": "...", "done": false, "satisfied": true|false, "why": "a note for the tester, never shown"}`,
    o.browser ? BROWSE : '',
    `The conversation so far:\n\n${convo}`,
    ...browsed.map((b, i) => `WHAT YOU DID IN YOUR BROWSER JUST NOW (${i + 1}): ${JSON.stringify(b.actions)}\nWHAT YOU SAW:\n${b.seen}`),
    o.browser ? (mayLook ? 'Now look at the site, or write your message.' : 'You have looked enough for now: write your message (JSON with "message").') : '',
  ].filter(Boolean).join('\n\n');
  const r = pi(prompt, 'low');
  run.tokens.persona += r.tokens;
  return json(r.text) || { message: '', done: true, satisfied: false, why: 'persona reply was not JSON: ' + r.text.slice(0, 200) };
}

// ---- the conversation ----------------------------------------------------------
let message = sc.opening;
for (let i = 0; i < (o.dry ? 0 : sc.maxTurns); i++) {
  log(`turn ${i + 1}: ${message.slice(0, 80)}`);
  const a = await agentTurn(message, 'turn');
  run.turns.push({ message, ...a });
  save();
  if (i === sc.maxTurns - 1) break;
  const p = personaTurn();
  run.turns.at(-1).persona = { done: p.done, satisfied: p.satisfied, why: p.why, browse: p.browse };
  save();
  if (p.done || !p.message) break;
  message = p.message;
}

// ---- facts, before the debrief can change anything -----------------------------
{
  fs.writeFileSync(path.join(RUN, 'replies.txt'), run.turns.map((t) => t.reply || '').join('\n\n'));
  const r = spawnSync('bash', [path.join(HERE, 'checks', SCENARIO + '.sh')], { env: { ...shEnv, FINAL: (run.turns.at(-1) || {}).reply || '' }, encoding: 'utf8', cwd: RUN });
  run.checks = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { check: 'unparsed', ok: false, detail: l }; } });
  if (r.status !== 0) run.checks.push({ check: 'checker', ok: false, detail: (r.stderr || '').slice(0, 500) });
  save();
}

if (o.dry) { console.log(JSON.stringify(run.checks, null, 1)); stop(); process.exit(0); }

// ---- debrief --------------------------------------------------------------------
{
  const d = await agentTurn('(A note from the developer, outside the conversation: this was a test with a simulated person. Please do not change anything now.) ' +
    'Looking back: what did you wish you had known at the start, about slop, its help pages or its error messages? Which errors, help pages or answers misled you or cost you steps? ' +
    'Name the one or two changes to slop\'s commands, errors or help that would have helped most. Be concrete and brief.', 'debrief');
  run.debrief = { reply: d.reply, commands: d.tools.length };
  save();
}

// ---- metrics from the commands --------------------------------------------------
const cmds = [];
run.turns.forEach((t, ti) => t.tools.forEach((x) => cmds.push({ turn: ti + 1, ...x, cmd: x.args.command || x.args.path || JSON.stringify(x.args) })));
const isHelp = (c) => /\bslop\b[^|;&]*\b(help\b|--help\b|-h\b)/.test(c.cmd) || /\bslop help\b/.test(c.cmd);
const outside = (c) => /\/home\/playback|\/opt\/pinpm|\/proc\/|find \/(\s|$)|\.\.\/\.\.|~\/\.pi/.test(c.cmd);
// Looking for slop's source or inside its binary: a sign the help fell short.
const probe = (c) => c.tool !== 'bash' && c.tool !== 'read' && c.tool !== 'edit' && c.tool !== 'write' || /git clone|github\.com|githubusercontent|\bstrings\b[^|]*slop|\bnm\b[^|]*slop|go tool nm|objdump|readelf|go doc|pkg\.go\.dev/.test(c.cmd);
const fails = cmds.map((c, i) => ({ c, i })).filter(({ c }) => isFail(c));
run.metrics = {
  turns: run.turns.length,
  commands: cmds.length,
  failed: fails.length,
  timedOutTurns: run.turns.filter((t) => t.timedOut).length,
  helpReads: cmds.filter(isHelp).length,
  helpBeforeFirstFailure: cmds.slice(0, fails.length ? fails[0].i : cmds.length).filter(isHelp).length,
  failuresFollowedByHelp: fails.filter(({ i }) => cmds[i + 1] && isHelp(cmds[i + 1])).length,
  outsideReads: cmds.filter(outside).map((c) => c.cmd.slice(0, 160)),
  sourceProbes: cmds.filter(probe).map((c) => c.cmd.slice(0, 160)),
  // Connections the box refused (net.mjs): anything but the model provider.
  egressDenied: (() => { try { return fs.readFileSync(path.join(NET_DIR, 'denied.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } })(),
  errorCodes: fails.map(({ c }) => ((c.output.match(/error: ([a-z_]+):/) || [])[1]) || (c.output.match(/error: ([^\n]{0,60})/) || [])[1] || 'nonzero').reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {}),
  checksPassed: run.checks.filter((c) => c.ok).length,
  checksTotal: run.checks.length,
  ms: run.turns.reduce((n, t) => n + t.ms, 0),
};
run.failures = fails.map(({ c, i }) => ({ turn: c.turn, cmd: c.cmd.slice(0, 300), output: c.output.slice(0, 600), next: cmds[i + 1] ? cmds[i + 1].cmd.slice(0, 300) : null }));
save();

// ---- the judge (judge.mjs) --------------------------------------------------------
{
  const r = judge(run, sc, persona, RUN);
  run.tokens.judge += r.tokens;
  run.judge = r.judge;
  save();
  fs.writeFileSync(path.join(RUN, 'transcript.md'), `# ${SCENARIO} (${sc.persona})\n\n${transcriptOf(run)}\n\n## Checks\n\n${run.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.check}: ${c.detail || ''}`).join('\n')}\n\n## Debrief\n\n${run.debrief.reply}\n\n## Judge\n\n\`\`\`json\n${JSON.stringify(run.judge, null, 2)}\n\`\`\`\n`);
}
run.endedAt = new Date().toISOString();
save();
log('done', JSON.stringify(run.metrics), JSON.stringify(run.judge && { goal: run.judge.goal, honesty: run.judge.honesty, efficiency: run.judge.efficiency }));
stop();
