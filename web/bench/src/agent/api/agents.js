// agent/api/agents.js — llm and agents.*: a quick model call, and subagents.
//
// Both reach the agent (agent/agent.js) through ctx.agent, so the API does
// not import the agent that runs it.
//
// Public API: AGENTS (an API table).
import { ROLES } from '../roles.js';
import { parseJSONReply } from '../../lib/text.js';

export const AGENTS = {
  'llm': {
    sig: 'prompt, {output, tier}?', internal: true, long: true,
    run: async (ctx, prompt, o = {}) => {
      if (!ctx.agent.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
      ctx.llmCalls = (ctx.llmCalls || 0) + 1
      if (ctx.llmCalls > 24) throw Object.assign(new Error('llm calls are capped at 24 per turn'), { kind: 'budget' })
      let res
      try { res = await ctx.agent.sample(String(prompt) + (o.output ? '\n\nReply with JSON only, no prose and no code fences, matching: ' + o.output : ''), { modelTier: o.tier || 'quick', cache: false, signal: ctx.signal }) } catch (e) { throw Object.assign(new Error((e && e.message) || String(e)), { kind: e && e.code === 'rate_limited' ? 'rate_limited' : 'llm' }) }
      const text = ((res && res.text) || '').trim()
      if (!o.output) return text
      const v = parseJSONReply(text)
      if (v === undefined) throw Object.assign(new Error('the reply was not JSON: ' + text.slice(0, 200)), { kind: 'llm' })
      return v
    }
  },
  'agents.delegate': { sig: 'role, task, {output, evals, tier, proposal}?', internal: true, long: true, run: (ctx, role, task, o = {}) => ctx.agent.delegate(ctx, role, String(task), o) },
  'agents.roles': {
    sig: '', internal: true,
    run: () => Object.entries(ROLES).map(([name, r]) => ({ name, describe: r.describe, writes: r.mode === 'read' ? false : r.mode === 'tests' ? 'scenarios/ and fixtures/ only' : true, evals: r.evals }))
  },
}
