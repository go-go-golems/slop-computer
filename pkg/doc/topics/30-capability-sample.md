---
Title: "The sample capability: one model call from a page or an actor"
Slug: "capability-sample"
Short: "sample(), sample.json() and sample.limits(): options, page tools, images, results, error codes, and what it takes to be allowed."
Topics:
- capabilities
- llm
- sample
- page-runtime
Commands:
- policy
- llm
- sample
Flags:
- modelTier
- model
- effort
- maxTokens
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`sample` asks the server's model one question and returns one answer. A page
calls it through `claude.use('sample')`; an actor calls it through
`use('sample')`. Each call is memoryless: the caller sends the whole prompt
(and any chat history) every time. For a conversation the server keeps, with
a tool loop, use the `agent` capability instead (`slop help capability-agent`).

Every call is checked and paid the same way, wherever it comes from:

1. the app declares `sample` in `app.json`;
2. the app's **policy cell** `sample` is on for the caller's audience
   (`slop policy set <app> sample @member on`);
3. the person who pays has **LLM access** and budget left this month
   (`slop llm set …`, see `slop help llm-access`);
4. the server has a model backend (`slop serve --llm pi`, see
   `slop help llm-backend-pi`).

Before each model round the server holds the round's estimated cost on the
payer's monthly budget and settles it with the real usage afterwards, so a
budget is never overspent, even by concurrent calls.

## Declaring it

The manifest names the capability; `images: true` lets pages send images.

```json
{
  "title": "Ask box",
  "page": "index.html",
  "capabilities": { "sample": {} }
}
```

```json
{ "capabilities": { "sample": { "images": true } } }
```

After the first push, an admin turns the policy on for the audiences that
may use it. Every cell is **off by default**, for admins too:

```bash
slop policy ls askbox                       # the matrix: sample × guest, member, subscriber, admin, store
slop policy set askbox sample @member on    # members, subscribers and admins
```

There is no per-viewer consent dialog on slop: the policy cell is the
consent. `permissions.state('sample')` answers `granted` whenever the
capability resolved.

## Getting the function in a page

`claude.use('sample')` resolves the callable function, or `null`. It is
`null` when the app does not declare `sample`, when the policy cell is off
for the viewer's audience, on a static host, or when the page is not running
in a slop view.

A non-`null` function does **not** mean the viewer may spend: the person may
have no LLM access, an empty budget, or the server may have no backend. Ask
`sample.limits()` before showing the feature:

```js
const sample = await claude.use('sample');
const lim = sample && await sample.limits();
if (!lim || !lim.available) hideAskButton();   // no access, no budget, or no backend
```

`use()` resolves after the page's first synchronous run; render first, then
light up the feature.

## sample(input, options) → Promise<SampleResult>

`input` is a string, or a list of turns `{role: 'user' | 'assistant',
content: string}` that begins and ends with a `user` turn. There is no system
role: put standing instructions in the first user turn. The total text is at
most 262,144 UTF-8 bytes.

```js
// One question
const { text } = await sample('Summarize in 3 bullets:\n\n' + notes);

// A chat the page keeps: instructions first, then the history
turns.push({ role: 'user', content: box.value });
const r = await sample([{ role: 'user', content: RULES }, ...turns], {
  cache: false,
  onText: ({ text }) => { bubble.textContent = text; },   // assign text; never +=
});
turns.push({ role: 'assistant', content: r.text });
```

The result:

| Field | Meaning |
| --- | --- |
| `text` | The whole answer, across all rounds |
| `truncated` | `true` when the answer hit a length or round limit |
| `modelTierApplied` | The tier the call ran on (`quick`, `default`, `complex`) |
| `modelApplied` | Your `model`, exactly as passed, when that model answered; absent when the call fell back to the tier |

## Options

All options are optional. Unknown members are ignored.

| Option | Values | Behaviour |
| --- | --- | --- |
| `modelTier` | `quick`, `default`, `complex` | Which configured model answers (default `default`; `inherit` means `default`). `quick` thinks least. The server maps tiers to models (`slop help llm-backend-pi`). |
| `model` | a model id like `provider/model` | Run on this model if the server has it; otherwise the call runs on the tier **without an error** (check `modelApplied`). `sample.limits().models` lists what exists. |
| `effort` | `low`, `medium`, `high` | How much a reasoning model thinks; anything else fails. Without it the tier's own setting applies. |
| `onText` | `({text, delta}) => void` | Streams the answer: `text` is everything so far, `delta` the new part. |
| `signal` | an `AbortSignal` | Cancels the call; it rejects `cancelled` with the partial answer on `e.text`. Use one `AbortController` per call. |
| `cache` | `true` (default), `false`, `{gcTime, refresh}` | Replays an identical earlier answer from memory without a model call: same input, tier, model and effort, within `gcTime` ms (default 5 minutes). The cache lives in the page and ends with it. A call with `onText`, `tools` or `images` is never cached. `refresh: true` skips the lookup and stores the new answer. Use `cache: false` for chat turns and "regenerate". |
| `tools` | up to 16 page tools | Functions the model may call while it works (below). |
| `images` | a `Blob`, `Blob[]` or `FileList` | Up to 4 JPEG, PNG, WebP or GIF images, shown with the last user turn. Needs `sample: {images: true}`. |

A page cannot set `maxTokens`: the call's output budget is the server's
(65,536 tokens shared by all rounds, capped by the model's own limit and by
the payer's remaining budget). Actors and `slop sample run` take `maxTokens`.

**Images.** The runtime re-encodes each image as JPEG (quality 0.85), at most
1568 px on its longest side, with transparency flattened to white, so
metadata never leaves the page. The server accepts at most 4 images and
8 MiB after that. A model without image input answers `images_unavailable`.

## sample.json(input, options) → Promise<any>

The same call, resolved with the answer parsed as JSON. State the exact shape
in the prompt, with a one-line example. The runtime tries, in order: the
whole answer; the body of one Markdown code fence; the text from the first
`{` or `[` to the last `}` or `]`. Nothing parses: it rejects `invalid_json`
with the raw answer on `e.text`. Nothing is validated against a schema.

```js
const tags = await sample.json(
  'Reply with only a JSON array of up to 5 short topic tags, like ["a","b"], for:\n\n' + note,
  { modelTier: 'quick' });
```

## sample.limits() → Promise<Limits>

Free: no model call, no budget. It describes this viewer, now.

```json
{
  "available": true,
  "allowed": true,
  "remaining": null,
  "maxPromptBytes": 262144,
  "tools": { "maxCount": 16 },
  "modelTiers": ["inherit", "quick", "default", "complex"],
  "models": [{ "provider": "test", "id": "fake", "name": "Deterministic test model", "images": true, "tier": "all" }],
  "images": { "maxCount": 4, "maxInputBytes": 8388608, "mediaTypes": ["image/jpeg", "image/png", "image/webp", "image/gif"] }
}
```

| Field | Meaning |
| --- | --- |
| `allowed` | The person has LLM access (and the policy allows this app for them) |
| `available` | `allowed`, a backend exists, and budget is left: a call can run now |
| `remaining` | Tokens left this month; `null` means no limit |
| `models` | The server's models: the tier models first (`tier` names the tier), then the others |
| `images` | Present only when the app declares `images: true` |

## Page tools

`tools` lets the model call JavaScript functions in the page while it works
out the answer. The model sees each tool's name, description and schema;
`execute` runs in the page with the arguments it chose.

```js
const { text } = await sample('Mute the loudest track.', {
  modelTier: 'quick',
  tools: [
    { name: 'listTracks', description: 'Returns [{id, name, volume}] for all tracks.',
      execute: () => tracks.map(({ id, name, volume }) => ({ id, name, volume })) },
    { name: 'setVolume', description: 'Sets one track volume (0-100). Returns the new volume.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, volume: { type: 'number' } }, required: ['id', 'volume'] },
      execute: ({ id, volume }, { signal }) => setVolume(String(id), Number(volume)) },
  ],
});
```

Rules the server enforces:

- At most 16 tools. A name is 1–128 characters of `A-Z a-z 0-9 _ -`, unique
  in the list; a description at most 1 KB; `inputSchema` at most 4 KB and an
  object schema (`{"type": "object", …}`). The schema guides the model and is
  not enforced: coerce every input you use.
- `execute(input, {signal})` may be async. Return a string or JSON data of at
  most 32 KB; a larger result reaches the model as an error. To report a
  problem, throw: the model reads the message and carries on, the call does
  not fail.
- The server waits 150 s for one tool result; after that the model reads
  "The page tool did not answer in time". `signal` aborts when the call is
  cancelled.
- A call runs at most 10 rounds; the last round offers no tools, so the model
  must answer. Each round is a separate model request that re-reads the
  whole conversation, and the conversation may grow to 512 KiB through tool
  results (then `prompt_too_large`).
- Tool calls are never cached.

Text in page data and tool results can steer the model's next tool call.
Put destructive tools behind your own confirmation, or make them undoable.

## Errors

Every failure rejects with an `Error` that carries `code` and `message`, and
`text` when part of the answer had streamed. Branch on `code`; always
reconcile what is on screen with `e.text` in the `catch`.

| Code | When | What to do |
| --- | --- | --- |
| `cancelled` | Your `signal` aborted | Restore the idle UI; keep `e.text` if useful |
| `invalid_request` | Empty prompt, turns that do not begin and end with `user`, a tool without `name`/`execute` | Fix the call; nothing was sent |
| `prompt_too_large` | Over 262,144 bytes, or the tool conversation outgrew its budget | Send less; drop the oldest chat turns |
| `tools_unavailable` | More than 16 tools | Send fewer |
| `images_unavailable` | Images without `sample: {images: true}`, or the model takes no images | Hide the image affordance |
| `image_rejected` | Not JPEG, PNG, WebP or GIF, or undecodable | Ask for another file |
| `not_declared` | The app's current version does not declare `sample` | Hide the feature |
| `not_granted` | The policy cell is off for this viewer | Hide the feature |
| `invalid_json` | `sample.json` found no JSON value; raw answer on `e.text` | Offer "try again"; tighten the format instruction |
| `empty_completion` | The model produced no text | Simplify; do not resend unchanged |
| `rate_limited` | The provider's rate limit | Let the person retry later |
| `upstream_error` | Anything else, see below | Keep the partial, offer a manual retry |

Several server refusals currently arrive in a page as `upstream_error`, with
the real reason in `message`:

| `message` | Real cause |
| --- | --- |
| `no LLM access` | The person has no LLM access (`slop llm usage <person>`) |
| `token budget used up for this month` | Budget exhausted (`slop llm usage`, `slop llm reset`) |
| `this server has no model backend` | The server runs without `--llm` |
| `Invalid model tier`, `Invalid effort`, `Invalid tool descriptor`, `At most four images` | A bad option the server refused |
| `The model provider request failed…` | The provider failed (credentials, network) |

So check `sample.limits().available` before calling, and show `e.message`
in developer tools when `code` is `upstream_error`.

## sample in an actor

An actor gets the same capability with `use('sample')`, at the top of
`actor.js`. It is `null` unless the app declares `sample`, the server has a
backend and the policy allows `sample` for at least one audience. The call
awaits real I/O, so the turn ends at the `await` and the code after it runs in
a new turn.

```js
const sample = use('sample');
defineActor({
  actions: {
    summarize: {
      requires: 'interact',
      async run(ctx, { text }) {
        if (!sample || !sample.allowed()) ctx.fail('permission_denied', 'no LLM access for you');
        const r = await sample('Summarize in one line:\n\n' + String(text), { modelTier: 'quick', maxTokens: 200 });
        return { summary: r.text, model: r.model, usage: r.usage };   // usage: {input, output}
      },
    },
  },
});
```

| Actor API | Meaning |
| --- | --- |
| `sample(input, {modelTier, model, effort, maxTokens, tools})` | Resolves `{text, model, usage: {input, output}}`. `maxTokens` caps the output (at most 65,536). |
| `sample.json(input, options)` | The answer parsed as JSON: the whole text, or one ```` ```json ```` fence; otherwise it throws `invalid_argument` |
| `sample.allowed()` | Whether this turn's visitor may spend now (no throw) |
| `sample.limits()` | `{allowed, remaining}` for this turn's visitor |

Actor tools are `{name, description, inputSchema, execute}`; each `execute`
runs as a new turn of the same event, so its writes commit, and it has 60 s
to settle. A whole actor call has 3 minutes. Refusals throw actor errors with
the codes `not_granted`, `permission_denied` (no LLM access), `quota_exceeded`,
`invalid_argument`, `prompt_too_large` and `unavailable` (no backend, or the
provider failed).

**Who pays in an actor:** the visitor when they are a signed-in person (a
guest without an id is never charged); for alarms, reactors and setup the
store itself pays, as `store:<id>`, under the policy cell for `@store`. See
`slop help llm-access`.

## mcp

slop accepts `mcp` in `app.json`, but there are no MCP connectors:
`claude.use('mcp')` resolves `null`. To reach your own backend, call it from
the actor (the `fetch` policy capability, `slop help actors`) and expose the
result to the page through an actor action.

## Trying it without a page

`slop sample run` makes the same call as you, with no app in between: it
checks your LLM access and budget, streams the answer on stderr and prints
the result.

```bash
$ slop sample run "hello there"
slop is connected.
model: test/fake
text: slop is connected.
usage:
    input: 13
    output: 18
```

Flags: `--modelTier`, `--model`, `--effort`, `--maxTokens`; `--input` takes a
JSON list of turns as well as a string.

## With `--llm fake`

A server started with `slop serve --llm fake` (or `--test`) answers without a
provider, for tests:

| Input contains | Answer |
| --- | --- |
| anything | `slop is connected.` |
| `fixture:json` | `{"ok":true}` |
| `fixture:stream` | `first second third`, streamed in three parts 250 ms apart |
| a call with `tools` | calls the first tool once with `{}` (a tool named `eval` gets `{"code":"return 1;"}`), then answers `The browser tool completed successfully.` or `The browser tool reported an error.` |

The fake counts one byte as one token, echoes `model` back as
`modelApplied`, and cuts its answer to the remaining budget.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use('sample')` is `null` | Not declared, or the policy cell is off for the viewer's audience | Add `"sample": {}` to `app.json` and push; `slop policy set <app> sample @member on` |
| `use()` works but every call fails `upstream_error` "no LLM access" | The person has no LLM access (new servers allow only `@admin`) | `slop llm set @member on --budget 200000`, or for one person `slop llm set <email> on` |
| `upstream_error` "token budget used up for this month" | Monthly budget spent | `slop llm usage <person>`; raise the budget or `slop llm reset <person>` |
| `upstream_error` "this server has no model backend" | Server started without `--llm` | Start it with `--llm pi` (or `fake` for tests) |
| `model` ignored | That model is not on the server | Read `sample.limits().models`; check `modelApplied` |
| `images_unavailable` | Manifest lacks `images: true`, or the tier's model has no image input | Declare it; pick a model whose `images` is true |
| Tool never runs | Over 16 tools, a bad name or schema, or the model did not choose it | Check the rules above; describe what the tool returns and when to use it |
| Chat answers repeat | The cache replayed an identical call | Pass `cache: false` for chat turns |
| `claude.use('mcp')` is `null` | slop has no MCP connectors | Call your backend from the actor |

## See Also

- `slop help capability-agent` — server-held conversations with a tool loop
- `slop help llm-access` — the `llm` table, budgets, policy cells, who pays
- `slop help llm-backend-pi` — the models behind the tiers
- `slop help page-runtime` — `claude.use` and the other page capabilities
- `slop help actors` — `actor.js`, turns, and `use()` on the server
- `slop help access-control` — audiences, groups and policy
