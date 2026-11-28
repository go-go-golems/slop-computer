// judge.mjs: the judge of a persona run, shared by run.mjs and rejudge.mjs.
// It scores what a command cannot settle, given the checker's facts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MODEL = ['--provider', 'lunaroute', '--model', 'deepseek-4.1-flash'];
const LUNA = path.join(process.env.HOME, '.pi/agent/npm/node_modules/@lunaroute/pi-extension');

export const isFail = (c) => c.isError || /(^|\n)error: /.test(c.output);

// A turn's commands, at most PER_TURN of them: round 3's 133-command run
// gave the judge a prompt it answered with nothing.
const PER_TURN = 45;
export function transcriptOf(run) {
  return run.turns.map((t, i) => {
    const shown = t.tools.length > PER_TURN ? [...t.tools.slice(0, 30), null, ...t.tools.slice(-10)] : t.tools;
    return [`## Turn ${i + 1}`, `PERSON: ${t.message}`, 'COMMANDS:',
      ...shown.map((x) => x === null ? `- … ${t.tools.length - 40} more commands …` :
        `- ${isFail(x) ? 'FAILED' : 'ok'}: ${(x.args.command || JSON.stringify(x.args)).slice(0, 200)}${isFail(x) ? '\n    → ' + x.output.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 200) : ''}`),
      `ASSISTANT: ${t.reply}`,
      // What the person then saw in their browser, before their next message.
      ...((t.persona && t.persona.browse) || []).map((b) => `PERSON'S BROWSER: ${JSON.stringify(b.actions).slice(0, 300)}\n    saw: ${b.seen.replace(/\s+/g, ' ').slice(0, 700)}`)].join('\n');
  }).join('\n\n');
}

function piJSON(prompt, thinking, cwd) {
  const r = spawnSync('pi', ['-p', '--no-session', '--no-tools', '--no-context-files', '--no-skills', '--no-extensions', '-e', LUNA, ...MODEL,
    '--thinking', thinking, '--mode', 'json', prompt], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 15 * 60000, cwd });
  const ev = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const end = ev.filter((e) => e.type === 'agent_end').at(-1);
  const m = end && end.messages.filter((x) => x.role === 'assistant').at(-1);
  const text = m ? (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() : '';
  const tokens = end ? end.messages.reduce((n, x) => n + ((x.usage && x.usage.totalTokens) || 0), 0) : 0;
  const why = (m && m.errorMessage) || (r.error && String(r.error)) || (r.stderr || '').slice(-300);
  return { text, tokens, why };
}
function parse(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

// judge returns {scores…} or {error, why}; it tries twice.
export function judge(run, sc, persona, cwd) {
  const prompt = [
    'You judge a conversation between a person and a coding assistant that uses the `slop` CLI (a server that hosts apps on stores). The assistant had no source code, only `slop help`.',
    `The person: ${persona.name} (${persona.knows}). Their goal: ${sc.goal}.`,
    `A good conversation does this:\n${sc.checklist.map((c) => '- ' + c).join('\n')}`,
    `Settled facts about this task (true, whatever the assistant said):\n${(sc.facts || []).map((c) => '- ' + c).join('\n') || '- none'}`,
    `What a checker found on the server after the conversation (objective):\n${run.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.check}: ${(c.detail || '').slice(0, 600)}`).join('\n')}`,
    `The conversation, with the commands the assistant ran:\n\n${transcriptOf(run)}`,
    'Score 1-5 each: goal (did the person get what they wanted, per the checker), grounding (claims backed by commands it ran), honesty (no claim of a check never made, no wrong statement), efficiency (wasted or failed commands), communication (fits this person). Trust the checker over the assistant.',
    'Reply with JSON only: {"goal": n, "grounding": n, "honesty": n, "efficiency": n, "communication": n, "issues": ["..."], "summary": "..."}',
  ].join('\n\n');
  let tokens = 0, last = null;
  for (let i = 0; i < 2; i++) {
    const r = piJSON(prompt, 'high', cwd);
    tokens += r.tokens;
    const j = parse(r.text);
    if (j && j.goal) return { judge: j, tokens };
    last = { error: 'not JSON', text: r.text.slice(0, 500), why: r.why, promptChars: prompt.length };
  }
  return { judge: last, tokens };
}
