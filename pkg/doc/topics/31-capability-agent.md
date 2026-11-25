---
Title: "The agent capability: conversations the server keeps"
Slug: "capability-agent"
Short: "agent.open, session.send, tools that run in the page, session keys, fresh sessions, limits, and testing with --llm fake."
Topics:
- capabilities
- llm
- agent
- page-runtime
Commands:
- policy
- llm
- store
- push
- mount
Flags: []
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
The `agent` capability gives a page a **session**: a conversation held on the
server, with its own history and tool loop. The page sends one message at a
time; the server adds it to the conversation, runs model rounds, asks the page
to run tools when the model calls them, and streams the answer back. The page
never resends the history, and a reload finds the conversation where it was.

Use `agent` for chat panels and tool-using assistants. Use `sample`
(`slop help capability-sample`) for one-shot calls, for anything with
**images**, and as the fallback when `agent` is not available.

## How it is granted and paid

`agent` spends exactly like `sample`, and is governed by the same cell:

- the app declares `"agent": {}` in `app.json`;
- the app's policy cell **`sample`** is on for the viewer's audience
  (`slop policy set <app> sample @member on`); an app that declares only
  `agent` still shows a `sample` row in `slop policy ls <app>`;
- the viewer has an id (a signed-in person, or a guest with a `vis_…` id) and
  LLM access and budget
  (`slop help llm-access`);
- the server has a model backend.

Every model round of every message is held on the viewer's monthly budget
before the provider is contacted, and settled with its usage, as `sample`'s
rounds are. Sessions belong to **one person in one store**: the store the
page runs on. Nobody else can list, read or send to them.

```json
{
  "title": "Counter chat",
  "page": "index.html",
  "capabilities": { "agent": {}, "sample": {} }
}
```

`claude.use('agent')` resolves `null` when the app does not declare it or
the policy cell is off for the viewer. As with `sample`, a non-`null` value
does not mean the person may spend: check `limits()` first.

## The rules that shape every agent page

1. **Messages are text only.** `send` has no images option. To show the model
   an image, use `sample` with `images` (and `sample: {images: true}`).
2. **Tier, model and effort are fixed at `open`.** A session keeps the
   settings it was created with; opening the same key with other settings
   returns the old session unchanged. Put the settings in the key
   (`app:thread:tier:model`), so a new tier opens a new session.
3. **`fresh` means the server has no history.** When `open` creates the
   session, `session.fresh` is `true`. If your page already has an earlier
   conversation for that thread (another tier, or from before it used
   `agent`), send it once, in the first message's `context`.
4. **Tools are registered at `open`.** The `tools` list, with its `execute`
   functions, belongs to the session object for its lifetime. Make `execute`
   route to the message that is running now, not capture one message's
   state.
5. **Each open session holds an event stream.** A session object keeps one
   long-lived HTTP request open (and reconnects when it drops). Keep one
   session object per conversation you show, and `close()` the ones you stop
   showing.

## API

### agent.open(key, options) → Promise<Session>

Resumes the person's session with this `key` in this store, or creates it.
`key` is 1–200 characters. Options apply only when the session is created:

| Option | Default | Limit | Meaning |
| --- | --- | --- | --- |
| `system` | none | 262,144 bytes | The system prompt, fixed for the session |
| `tools` | `[]` | | `[{name, description, inputSchema, execute}]`, run in this page |
| `modelTier` | `default` | `quick`, `default`, `complex` | Which configured model answers |
| `model` | none | | A model id from `limits().models`; an unknown one falls back to the tier |
| `effort` | the tier's | `low`, `medium`, `high` | Reasoning effort |
| `maxRounds` | 30 | 60 | Model rounds per message; at the limit the model must answer without tools |
| `toolTimeout` | 600,000 ms | 1,800,000 ms | How long one tool call may take |
| `maxTokens` | 16,384 | 65,536 | Output tokens per model round (also capped by the model and the budget) |
| `title` | none | | Shown in `agent.list()` |

Values above a limit are lowered to it without an error; a `system` prompt
over the limit fails `prompt_too_large`.

`tools` is read on every `open`, including a resume: the session object you
get runs the tools you passed now.

### session.send(prompt, options) → Promise<{text, truncated}>

Sends one message and resolves when the run ends.

| Option | Meaning |
| --- | --- |
| `context` | Text added after the message, for this message only: the live state of the page, or the earlier conversation of a `fresh` session. At most 65,536 bytes. |
| `onText` | `({text, delta}) => void`, the answer so far (assign `text`) |
| `signal` | An `AbortSignal`: stops the run; `send` rejects `cancelled` |

`truncated` is `true` when the run hit the round limit. One message runs at a
time per session: a second `send` while one runs rejects `run_active` (also
from another tab on the same session).

### The rest of a session

Members marked *async* return a promise: `await` them.

| Member | Meaning |
| --- | --- |
| `id`, `key`, `info` | The session's id, its key, and its record (`labels`: `tier`, `model`, `effort`; `data`: the settings after limits; `usage`) |
| `fresh` | `true` when this `open` created it |
| `running` | Whether a run is in progress (another tab's included) |
| `send(text, o)` *async* | Runs one message (above) |
| `stop()` *async* | Stops the running message |
| `history()` *async* | `[{role, text}]`: `user`, `assistant` (and `thinking`, `error` entries) |
| `on(fn)` | Calls `fn(event)` for every event (`ChatRunStarted`, `ChatTextPatch`, `ChatFrontendToolCallRequested`, `ChatRunFinished`, `ChatRunStopped`, …); returns an unsubscribe function |
| `close()` | Ends this page's event stream. A run in progress keeps going on the server. Later `send`s reject `cancelled`. |
| `delete()` *async* | Closes and deletes the session and its history |

### agent.list() and agent.limits()

Both are *async*, as is `agent.open()`. `agent.list()` resolves to the person's sessions in this store:
`[{id, key, title, created, updated, running, usage: {input, output, calls}}]`.

`agent.limits()` resolves to the same answer as `sample.limits()`: `available`,
`allowed`, `remaining`, `models`, `modelTiers`. The session limits are the
table above; they are not in `limits()`.

## Tools

The model sees each tool's name, description and `inputSchema`; `execute`
runs in the page:

```js
{ name: 'add', description: 'Adds n to the counter. Returns the new value.',
  inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
  execute: async (input, { signal, callId }) => { … return value; } }
```

- Return a string or JSON data. A result longer than 16,000 characters is cut,
  with a note to the model.
- Throw to report a problem: the model reads `error: <message>` and carries on.
- Tool calls run one at a time and are never retried, so page code runs once
  per call.
- `signal` aborts when the message is stopped or the call times out.
- A tool the page does not have answers the model `tool not found: <name>`.
- The session object that sends a message runs that message's tools: it
  registers its `tools` with the server again before each message. Two tabs
  on one session each run the tools of their own messages. A closed session
  object runs none, so a run left going after `close()` waits for its tool
  until `toolTimeout`.

Because the tools are fixed at `open` and the session object outlives each
message, route every call to the message in flight:

```js
let current = null;   // set while a message runs
const tools = [{ name: 'eval', description: '…', inputSchema: { … },
  execute: (input, c) => current ? current.runTool(input, c)
                                 : Promise.reject(new Error('no message of this thread is running in this page')) }];
```

## A complete page

A counter the model reads and changes through two tools. It keeps one session
per thread and tier, sends the live state as `context`, and offers Stop.

```html
<!doctype html>
<meta charset="utf-8">
<title>Counter chat</title>
<p>Counter: <b id="count">0</b></p>
<div id="log"></div>
<form id="f" hidden><input id="q" size="50"> <button>Send</button> <button type="button" id="stop">Stop</button></form>
<script>
const $ = (id) => document.getElementById(id);
let count = 0;
const say = (who, text) => { const p = document.createElement('p'); p.textContent = who + ': ' + text; $('log').append(p); return p; };

const SYSTEM = 'You help the person with a counter. Use the tools to read or change it. Answer in one sentence.';
const TIER = 'default';
const thread = 'main';                 // one conversation per page here; use your own thread ids
let current = null;                    // the message in flight

// Tools are registered once, when the session opens: route each call to the
// message that is running now.
const tools = [
  { name: 'get', description: 'Returns the counter value.', execute: () => count },
  { name: 'add', description: 'Adds n to the counter. Returns the new value.',
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    execute: (input) => {
      if (!current) throw new Error('no message is running in this page');
      count += Number(input.n) || 0; $('count').textContent = count; return count;
    } },
];

(async () => {
  const agent = await claude.use('agent');
  const lim = agent && await agent.limits();
  if (!lim || !lim.available) { say('page', 'The model is not available here.'); return; }
  $('f').hidden = false;
  let session = null;
  $('stop').onclick = () => current && current.ctl.abort();
  $('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const text = $('q').value.trim(); if (!text || current) return;
    $('q').value = ''; say('you', text);
    const out = say('agent', '…');
    current = { ctl: new AbortController() };
    try {
      // Tier, model and effort are fixed when a session opens: put them in the key.
      session = session || await agent.open(['counter', thread, TIER].join(':'), { title: 'Counter', system: SYSTEM, modelTier: TIER, tools });
      const context = 'The counter is ' + count + '.';
      const r = await session.send(text, { context, signal: current.ctl.signal, onText: ({ text }) => { out.textContent = 'agent: ' + text; } });
      out.textContent = 'agent: ' + r.text;
    } catch (e) {
      out.textContent = 'agent: ' + (e.text || '') + ' [' + e.code + ': ' + e.message + ']';
    } finally { current = null; }
  };
  window.addEventListener('pagehide', () => session && session.close());
})();
</script>
```

Deploy and allow it on a local server:

```bash
slop store new counterchat
slop push ./chat --store counterchat
slop store new chat1 --app counterchat
slop mount set apps.localhost:18300 /chat chat1
slop policy set counterchat sample @member on
```

With `--llm fake`, sending `/tool add {"n":5}`, then `/tool get {}`, then
`hello` shows:

```text
you: /tool add {"n":5}
agent: add returned: 5
you: /tool get {}
agent: get returned: 5
you: hello
agent: echo: hello
```

## Session keys and fresh sessions

The key decides which conversation you get back. The reference apps use:

| App | Key | Why |
| --- | --- | --- |
| Pinboard (agent panel) | `pinboard:<thread>:<tier>` | one session per thread and tier; only the current thread's session stays open, the others are closed |
| Bench | `<app>:<thread>:<tier>:<model>` | a new tier or model starts a new server conversation |

When `open` returns `fresh: true` and the page has history for that thread,
send it once:

```js
const { s, fresh } = await session(thread);           // your cache of open sessions
let context = live;                                     // the page's state now
if (fresh && earlier) context = '[earlier in this thread]\n' + earlier.slice(-20000) + '\n\n' + live;
const r = await s.send(text, { context: fitBytes(context, 60000) });   // stay under 65,536 bytes
```

Pinboard falls back to `sample` when `claude.use('agent')` is `null`: it then
sends the history itself on every call (`sample` keeps none), and only then
can it attach images.

## Testing with `--llm fake`

A server started with `slop serve --llm fake` runs sessions on a scripted
engine. The message is the script:

| Message | Answer |
| --- | --- |
| `/tool NAME {json}` | calls tool `NAME` with the JSON object, then answers `NAME returned: <result>` (or `NAME returned: error: <message>`) |
| `/tools N NAME {json}` | calls the tool N times, one per round; past `maxRounds` it answers `final answer after <n> tool calls` with `truncated: true` |
| `/sleep MS text` | waits MS milliseconds (Stop works), then answers `echo: text` |
| anything else | `echo: <message>` |

`context` does not change the script. Usage is reported roughly (a token per
four characters), so budgets are exercised.

**What the fake engine cannot test.** It does not read plain language: "add
milk to the list" is answered `echo: add milk to the list` and calls no
tool. So with `--llm fake` you can test that your tools work, that the page
shows answers and errors, and that budgets and permissions hold, by sending
`/tool …` messages yourself. Whether a real model picks the right tool for
what people type needs a server with a real LLM. Do not add code to the page
that parses messages itself to make the fake engine look smart: it is not
the agent, and it stays in the app when a real model answers. Do not detect
the fake engine (`limits().models`) and switch the page to a local parser
or a "demo mode" either: then `/tool …` messages never reach the agent, so
neither you nor anyone checking the app can test the tools, and what you
tested is not what runs with a real model. Leave the page the same on every
engine and say which part you tested with the fake engine and which needs
a real one.

## Errors

`open`, `send` and the other calls reject with an `Error` that has `code` and
`message` (and `text`, the partial answer, when one had streamed).

| Code | When |
| --- | --- |
| `invalid_request` | Empty message, a key not 1–200 characters, a tool without `name` or `execute` |
| `prompt_too_large` | `system` over 262,144 bytes, or `context` over 65,536 bytes |
| `run_active` | A message is still running in this session |
| `cancelled` | The `signal` aborted, `stop()` was called, or the session object was closed |
| `permission_denied` | The person has no LLM access |
| `quota_exceeded` | The person's monthly budget is spent |
| `not_granted` | The policy cell is off for this viewer (the event stream answers 403) |
| `not_declared` | The app does not declare `agent` |
| `session_not_found` | The session was deleted |
| `session_expired` | The view expired: reload the page |
| `unavailable` | The server has no model backend |
| `upstream_error` | The provider or the server failed |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use('agent')` is `null` | Not declared, or the `sample` policy cell is off for the viewer | Declare `"agent": {}`; `slop policy set <app> sample @member on` |
| `send` rejects `permission_denied` | No LLM access for the person | `slop llm set <email or @group> on` (`slop help llm-access`) |
| Changing the tier has no effect | Settings are fixed at `open`; the same key resumed the old session | Put tier and model in the key |
| The model forgot the earlier chat | The session is `fresh` (new key, new tier) | Send the earlier conversation once in `context` |
| A tool acts on the wrong message, or "no message … running" | `execute` captured an old message's state | Route each call to the message in flight |
| `run_active` | Another `send` (or another tab) is still running | Wait, or `stop()` first |
| Tool calls hang until `toolTimeout` | The session object that sent the message was closed (or its page left) | Keep it open while a run goes on, or `stop()` before `close()` |
| Too many open connections | One event stream per open session object | `close()` sessions you no longer show |
| Images do not reach the model | Agent messages are text only | Use `sample` with `images` for that message |
| With the fake engine an answer is empty | The session registered no tools and the script called one | Pass `tools` to `open` |

## See Also

- `slop help capability-sample` — one-shot calls, images, page tools
- `slop help llm-access` — LLM access, budgets, the `sample` policy cell
- `slop help llm-backend-pi` — the models behind the tiers
- `slop help page-runtime` — `claude.use` and the other capabilities
- `slop help pinboard` — the agent panel, a full agent page
