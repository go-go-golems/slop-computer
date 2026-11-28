'use strict';
// The agent panel talks to the agent capability (SLOP3-025) when it is
// granted: one server session per thread and tier, the live board as each
// message's context, the page's eval as the session's tool. A fake
// claude.use('agent') records what the panel opens and sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, PAGE } = require('./harness.js');

function panelEl(sandbox) {
  // index.html's #agentpanel: querySelector answers one element per selector.
  const doc = sandbox.document;
  const panel = doc.createElement('div');
  const parts = {};
  panel.querySelector = (sel) => (parts[sel] = parts[sel] || Object.assign(doc.createElement(sel === 'textarea' ? 'textarea' : 'div'), { value: '' }));
  return { panel, parts };
}

function fakeAgent(record, { fresh = true, reply = 'done', callTool = null } = {}) {
  return {
    async limits() { return { tools: true }; },
    async open(key, o) {
      const s = {
        key, fresh, closed: false,
        async send(text, so) {
          record.sends.push({ key, text, context: so.context });
          let out = null;
          if (callTool) out = await o.tools[0].execute(callTool, { signal: new AbortController().signal });
          so.onText && so.onText({ text: reply });
          return { text: out == null ? reply : reply + ' · ' + out };
        },
        close() { s.closed = true; },
      };
      record.opens.push({ key, o, s });
      return s;
    },
  };
}

async function boot(agentOpts) {
  const record = { opens: [], sends: [], used: [] };
  let ui;
  const { sandbox } = load(PAGE, {
    setup(sb) {
      ui = panelEl(sb);
      sb.document.getElementById = (id) => (id === 'agentpanel' ? ui.panel : sb.document.createElement('div'));
      sb.claude = { use: async (n) => { record.used.push(n); return n === 'agent' ? fakeAgent(record, agentOpts) : null; } };
    },
  });
  const PB = sandbox.PB;
  await PB.agent.init();
  return { PB, A: PB.agent, ui, record };
}

const say = async (env, text) => { env.ui.parts.textarea.value = text; await env.A.send(); };

test('the panel uses the agent capability, not sample, when it is granted', async () => {
  const env = await boot();
  assert.deepEqual(env.record.used, ['agent']);
  assert.ok(env.A.agent && !env.A.sample && env.A.available);
});

test('one session per thread and tier, with the instructions as its system prompt', async () => {
  const env = await boot();
  env.A.mode = 'auto';
  await say(env, 'what is on this board?');
  assert.equal(env.record.opens.length, 1);
  const { key, o } = env.record.opens[0];
  assert.equal(key, 'pinboard:' + env.A.cur.id + ':default');
  assert.equal(o.modelTier, 'default');
  assert.match(o.system, /You are the agent of a pinboard/);
  assert.equal(o.tools.length, 1);
  assert.equal(o.tools[0].name, 'eval');
  const sent = env.record.sends[0];
  assert.equal(sent.text, 'what is on this board?', 'the message is the person\'s text only');
  assert.match(sent.context, /^\[context\]\n/);
  assert.match(sent.context, /\[mode\] auto$/);
  assert.equal(env.A.cur.msgs.at(-1).text, 'done');

  await say(env, 'and now?');
  assert.equal(env.record.opens.length, 1, 'the second message reuses the session');
  assert.equal(env.record.sends.length, 2);
});

test('the session\'s tool runs eval in the page', async () => {
  const env = await boot({ callTool: { code: 'return 6 * 7' } });
  env.A.mode = 'auto';
  await say(env, 'compute');
  const m = env.A.cur.msgs.at(-1);
  assert.equal(m.steps.length, 1);
  assert.equal(m.steps[0].status, 'done');
  assert.match(m.text, /42/);
});

test('another tier opens a fresh session that gets the earlier messages once', async () => {
  const env = await boot();
  env.A.mode = 'auto';
  await say(env, 'first question');
  env.A.tier = 'complex';
  await say(env, 'second question');
  assert.equal(env.record.opens.length, 2);
  assert.equal(env.record.opens[1].key, 'pinboard:' + env.A.cur.id + ':complex');
  assert.ok(env.record.opens[0].s.closed, 'the other session is closed');
  assert.match(env.record.sends[1].context, /^\[earlier in this thread\]\nPerson: first question\n\nAgent: \s*done\n\n\[context\]\n/);
});

test('without agent, the panel falls back to sample', async () => {
  const record = { used: [] };
  const { sandbox } = load(PAGE, {
    setup(sb) {
      const ui = panelEl(sb);
      sb.document.getElementById = (id) => (id === 'agentpanel' ? ui.panel : sb.document.createElement('div'));
      const sample = Object.assign(async () => ({ text: 'x' }), { limits: async () => ({ tools: true }) });
      sb.claude = { use: async (n) => { record.used.push(n); return n === 'sample' ? sample : null; } };
    },
  });
  await sandbox.PB.agent.init();
  assert.deepEqual(record.used, ['agent', 'sample']);
  assert.ok(sandbox.PB.agent.sample && !sandbox.PB.agent.agent);
});
