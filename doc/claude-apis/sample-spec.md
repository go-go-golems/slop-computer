# Artifact Claude API (sample) — Spec

Oct 10, 2026 · @Manuel Odendahl

## Overview

A published artifact calls Claude through the `sample` runtime capability, on the viewer's own Claude account. There is no API key, no base URL and no way to point it at another model provider. This spec covers runtime contract 0.2.75.

| Property | Behavior |
| --- | --- |
| Who pays | The viewer. Each call spends the viewer's Claude usage, like a chat message. |
| Consent | The first call in a view asks the viewer to allow it. A decline rejects every later call with `not_granted`. |
| Auth | Handled by the platform. The page never sees a token or key. |
| State | None. Each call is memoryless; the page keeps any chat history itself. |
| System prompt | None the page controls. Standing instructions go in a leading `user` turn. |
| Network | The page cannot `fetch` outside hosts. Claude cannot browse. |
| Tools | Only JavaScript functions the page passes in `options.tools`. |
| Max input | 256 KiB of text (262,144 UTF-8 bytes). |
| Models | A tier (`quick`, `default`, `complex`), or a named model the viewer can use. |

To reach your own backend, use the `mcp` capability with a custom connector (see the section on it below). Never embed an API key in a page: anyone the page is shared with can read its source.

## Setup

Declare the capability when publishing, then get the function at runtime with `claude.use`.

**1. Manifest.** Pass `capabilities` to the Artifact publish call:

```json
{ "sample": {} }
```

Use `{ "sample": { "images": true } }` only if the page sends images. Every viewer of such a page is told it can send images to Claude.

**2. Runtime.** `window.claude` carries only `use`. Never read `window.claude.sample`.

```js
const sample = await claude.use("sample");
if (!sample) hideAskFeature(); // not served, not granted, or no viewer
```

- `use()` resolves later, never during the script's first synchronous run, and is not ordered against `DOMContentLoaded`. Render the page first, then light the feature up.
- It resolves `null` when the view can't run the capability, including \~10 s after load if no Claude viewer answers. All `null` causes look the same by design.
- The resolved function is frozen and platform-owned. Wrap it; never assign to it.
- `use()` never prompts. Consent arrives on the first `sample()` call, which waits while the viewer decides.

**Where it runs.** Inside a claude.ai viewer, it works. Served top-level on the artifact's own host, `use()` resolves `null` for now. A saved copy or other host has no `window.claude` at all.

**Permissions.** The built-in `permissions` capability reads consent without prompting (`state`) or asks up front in one dialog (`request`). Never gate rendering on `"granted"`; `"prompt"` means go ahead and let the first call ask.

## Calls

Three functions: `sample()` for text, `sample.json()` for data, `sample.limits()` for what this view can send.

### sample(input, options?) → Promise\<SampleResult>

Asks Claude and resolves once with the whole answer. It never throws synchronously; every failure is one rejected `{code, message, text?}`. The request leaves on the next microtask, so aborting in the same synchronous block sends nothing and costs nothing. Arguments are copied at call time.

**`input`** is either:

- a string: instruction, data and output format in one prompt (the common case), or
- an array of `{role: "user" | "assistant", content: string}` turns, oldest first, starting and ending on `user`.

There is no `system` role. Consecutive same-role turns are merged. Assistant turns are labelled to Claude as page-supplied, so use them for real history, not for scripting its words. Total text is capped at 256 KiB; drop the oldest chat turns (never the instructions turn) as a conversation grows.

```js
// One-shot
const { text } = await sample("Summarize in 3 bullets:\n\n" + notes);

// Chat: instructions are a leading user turn the page always keeps
turns.push({ role: "user", content: box.value });
const { text } = await sample([{ role: "user", content: RULES }, ...turns], {
  cache: false,
  onText: ({ text }) => { bubble.textContent = text; },
});
turns.push({ role: "assistant", content: text });
```

### sample.json\<T>(input, options?) → Promise\<T>

Same call, options, consent, caching and errors, but resolves with the reply parsed as one JSON value. State the exact shape in the prompt, with a one-line example. Nothing is validated at run time.

Parsing is tolerant, in this order:

1. the whole reply as JSON;
2. the body of one Markdown code fence;
3. the text from the first `{` or `[` to the last `}` or `]`.

No parseable value, or an answer cut short, rejects `invalid_json` with the raw reply on `e.text`. Such replies are never cached. With `tools`, only Claude's final message is parsed.

```js
const tags = await sample.json(
  "Reply with only a JSON array of up to 5 short topic tags for:\n\n" + note,
  { modelTier: "quick" },
);
```

### sample.limits() → Promise\<SampleLimits>

Local and free; never prompts or spends usage. Use it to decide whether to show image or tool affordances.

```ts
interface SampleLimits {
  maxPromptBytes: number;  // 262144
  images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] }; // only if declared and supported
  tools?: { maxCount: number };  // only if this view can run page tools
}
```

## Options

`options` must be a plain object; every member is optional. Anything else (a Blob, a string, an AbortController) rejects `invalid_request`. Unknown members are ignored with one console note.

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `onText` | `({text, delta}) => void` | none | Streams the answer, a few times a second at most. `text` is the whole answer so far (assign it); `delta` is the new part (append it). Never `+= text`. Silent while Claude thinks, while consent is up, or while queued. |
| `signal` | `AbortSignal` | none | Cancels; rejects `cancelled` with any partial on `e.text`. Use a new `AbortController` per call. No timeout option: the platform ends over-long calls. |
| `modelTier` | `"quick"` \| `"default"` \| `"complex"` | `"default"` | `quick` doesn't think first and starts writing at once; `complex` thinks longest. May fall back to a cheaper tier the viewer's plan allows. |
| `model` | `string` | none | A Claude API model id, e.g. `"claude-sonnet-5-5"`. Answers only if the viewer could pick it in chat; otherwise the call runs on `modelTier` without an error. Use only when someone asked for a specific model. |
| `effort` | `"low"` \| `"medium"` \| `"high"` | platform setting | How much a thinking model thinks. Ignored where the model can't take it. |
| `cache` | `true` \| `false` \| `{gcTime?, refresh?}` | `true` (5 min) | Replays an identical earlier answer for this viewer without spending usage. `false` for chat turns and "Regenerate". `gcTime` max 24 h. Must be omitted or `false` with `tools`. |
| `images` | `Blob` \| `Blob[]` \| `FileList` | none | JPEG, PNG, WebP or GIF, shown with the final user turn. Downsized to \~1.2 MP, metadata stripped. Requires `{sample: {images: true}}`. |
| `tools` | `SampleTool[]` | none | Page functions Claude may call. See Page tools below. |

**Cache key.** An answer replays when `input` (every turn), `modelTier`, `model`, `effort`, `images` (byte-identical) and the verb (`sample` vs `json`) all match, within the shorter `gcTime` of the storing and asking calls. Only successful answers are stored. An identical call made while the first is still running shares its stream. Entries are per viewer, per artifact, per browser, and cleared on sign-out.

**Timing.** On `quick`, a short prompt answers in 1–2 s. On `default` and `complex`, first text usually takes 5–60 s (up to \~2 min for a long structured prompt), then streams over seconds. Each round is capped at \~5 min. Show "Thinking..." from the call until the first `onText`, and offer a Stop button on anything long.

**Concurrency.** A couple of calls run at once per viewer, a few more queue, and a flood rejects `rate_limited`.

## Page tools

`options.tools` lets Claude call JavaScript functions in the page while it works out the answer. Claude sees each tool's name, description and schema, never your code; `execute` runs in the page with the arguments Claude chose.

```ts
interface SampleTool {
  name: string;          // 1-128 chars of A-Z a-z 0-9 _ -, unique in the list
  description: string;   // what it does, what it RETURNS, when to use it; max 1 KB
  inputSchema?: {        // JSON Schema for ONE object argument; max 4 KB; not enforced
    type: "object"; properties?: {...}; required?: string[];
  };
  execute(input: Record<string, unknown>, ctx: { signal: AbortSignal }): unknown;
}
```

**`execute` contract**

- Return a string or plain JSON data, at most 32 KB. May be async.
- To report a problem, throw. Claude receives `Error: <message>` and carries on; the call does not fail.
- Coerce every input you use (`String(id)`, `Number(n)`). The schema guides Claude but isn't validated.
- `ctx.signal` aborts on Stop, when the call settles, or after 150 s. Pass it on to `mcp.callTool(..., {signal})`.
- Several calls in one round run concurrently.

**Cost and rounds.** Each round is a separate paid request that re-reads everything so far, so a call using two tools is three requests. The platform allows a handful of rounds and forces the last to be an answer. A three-round `default` call commonly takes 30–90 s; `quick` takes about a second per round.

**Rules**

- Check `(await sample.limits()).tools` first; otherwise calls reject `tools_unavailable`.
- Omit `cache` (or pass `false`); tool calls are never cached or shared.
- Keep tools few and results small. Page state that fits in the prompt goes in the prompt.
- Text in page data and tool results can steer which tools Claude calls next. Put destructive actions behind your own confirm step, or make them undoable.
- `onText` sees text from all rounds as one growing string, with a blank line between rounds.

```js
const { text } = await sample("Mute the loudest track.", {
  modelTier: "quick",
  tools: [
    { name: "listTracks", description: "Returns [{id, name, volume}] for all tracks.",
      execute: () => tracks.map(({ id, name, volume }) => ({ id, name, volume })) },
    { name: "setVolume", description: "Sets one track's volume (0-100). Returns the new volume.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, volume: { type: "number" } }, required: ["id", "volume"] },
      execute: ({ id, volume }) => setVolume(String(id), Number(volume)) },
  ],
});
```

## Results and errors

### SampleResult

```ts
interface SampleResult {
  text: string;               // whole answer; never empty (that rejects empty_completion)
  truncated: boolean;         // hit the length or time limit; show it with a note
  modelTierApplied: "quick" | "default" | "complex"; // tier that answered or was counted
  modelApplied?: string;      // your `model`, exactly as passed, when it answered
}
```

### SampleError

Every failure is a rejected plain object `{code, message, text?}`, not an `Error`. Branch on `code`; `message` is developer English, not viewer copy. `text` is the partial answer you may keep on screen, present whenever text had streamed (the raw reply on `invalid_json`, absent on `refused`). Treat unknown codes as `upstream_error`. Never retry from a loop.

| Code | Meaning | Page should |
| --- | --- | --- |
| `cancelled` | Your `signal` aborted | Restore idle UI quietly; keep `e.text` if wanted |
| `invalid_request` | Malformed call (empty input, bad turns, bad options, bad tool) | Fix the code; nothing was sent |
| `prompt_too_large` | Over 256 KiB, or tool rounds outgrew the context | Send an excerpt or fewer turns |
| `transform_error` | Arguments couldn't be prepared | Treat like `invalid_request` |
| `queue_overflow` | Hundreds of calls before the runtime started | Remove the load-time loop |
| `not_granted` | Viewer or org didn't allow Claude for this artifact | Hide the feature for this view |
| `sampling_disabled` | Claude unavailable for this account or org | Hide the feature |
| `not_declared` | Artifact no longer declares `sample` | Hide the feature |
| `capability_disabled` | Granted but unusable in this view | Hide the feature |
| `capability_removed` | Method missing in this runtime (e.g. `json` on an old app) | Hide that feature |
| `images_unavailable` | Can't send images here, or not declared | Hide the image affordance only |
| `tools_unavailable` | Can't run page tools here | Hide what depends on tools |
| `rate_limited` | Too many calls, or the viewer hit a usage limit | Tell the viewer; let them retry later |
| `session_expired` | Viewer must sign in again | Tell the viewer |
| `image_rejected` | Wrong type, undecodable, too large or too many | Ask for a different file |
| `refused` | Claude declined this input, possibly mid-stream | Clear the partial; change the ask |
| `empty_completion` | No text produced | Simplify; don't resend unchanged |
| `invalid_json` | `json()` found no complete JSON value | Offer "Try again"; tighten the format instruction |
| `upstream_error` | Transient service or connection failure | Keep the partial, mark it interrupted, offer manual retry |

Only `upstream_error` is transient. A call can fail after `onText` has fired, so always reconcile what's on screen with `e.text` in the `catch`.

## Reaching your own backend: mcp

Wrap your endpoint in an MCP server and add it in claude.ai as a custom connector; the page then calls its tools through the `mcp` capability. Calls use each viewer's own connector credentials, and the page never sees a token.

**Request path**

1. The page calls `mcp.callTool("Your Connector", "tool_name", input)`.
2. The claude.ai viewer checks the tool is in the manifest and the viewer has allowed this connector.
3. The platform calls your MCP server with the viewer's credentials.
4. Your server calls your backend (or any LLM endpoint, with your keys held server-side) and returns a result.
5. The page reads `result.payload`.

**Manifest.** Each server entry names a connector display name and the exact tools the page calls. An empty `tools` list is refused; it never means all tools. Declaring `mcp` bars public sharing of the page.

```json
{ "mcp": { "servers": [ { "server": "Your Connector", "tools": ["search", "create_item"] } ] } }
```

For a local MCP server on the viewer's machine, use `"server": "host:<name>"`. It works only in the Claude app with that server connected, and only for the artifact's owner for now; elsewhere calls reject `server_not_connected`.

**API**

| Function | Use |
| --- | --- |
| `callTool(server, tool, input?, {cache?, signal?})` | An action, once. Resolves `{content, structuredContent?, payload?, cache?}`. |
| `watchTool(server, tool, input, handler, {cache?, refetchInterval?})` | Data to display and keep current. Returns a synchronous unsubscribe. Reads only. |
| `server(name)` | A handle whose methods are that server's tools; each resolves the `payload`. |
| `listTools(server?)` | Manifest ∩ what the viewer has connected, with `authStatus`. Never prompts. |
| `describeTool(server, tool)` | The tool's input and output JSON Schemas, once allowed. |
| `invalidate(server?, tool?, input?)` | Drop cached results after a write. |

**Key error codes**

| Code | Page should |
| --- | --- |
| `server_not_connected` | Show "Add {server} in claude.ai Settings → Connectors" |
| `needs_reauth` | Show "Reconnect {server}"; don't retry |
| `not_in_manifest` | Viewer declined or turned it off; show as not allowed |
| `approval_required` | Show a button that makes the call once |
| `tool_error` | Your tool reported failure; show its message |
| `server_unavailable` | Retryable once for reads; a write's outcome is unknown |

**Combining with sample.** Give Claude a page tool whose `execute` calls your connector. Claude decides when to hit your backend; the call itself stays in your code.

```js
const mcp = await claude.use("mcp");
const lookup = {
  name: "lookupOrder",
  description: "Returns {status, eta} for an order id from our backend.",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  execute: async ({ id }, { signal }) =>
    (await mcp.callTool("Your Connector", "get_order", { id: String(id) }, { signal })).payload,
};
const { text } = await sample("Where is order " + orderId + "?", { tools: [lookup] });
```

## Design rules and full example

**Rules**

- Call on an explicit viewer action ("Ask", "Summarize"), or once at load with a prompt that's stable across loads. Never from a loop or timer.
- Design for absence: render a useful page when `use()` is `null` or a call rejects `not_granted`.
- Show "Thinking..." from the call until the first `onText`; it also covers the consent dialog and queueing.
- Offer Stop on anything long; one `AbortController` per call.
- Put instructions, data and the output format in the input; Claude sees nothing else.
- For lists, prefer one call returning a JSON array over one call per item.
- Use `quick` for tags, classification and snappy chat; `default` for most work; `complex` for hard reasoning.
- Use `cache: false` for chat turns and regenerate buttons.

**Full example: streaming ask box with Stop**

```html
<textarea id="q"></textarea>
<button id="ask" hidden>Ask</button> <button id="stop" hidden>Stop</button>
<pre id="out"></pre> <p id="note"></p>
<script>
const $ = (id) => document.getElementById(id);
const COPY = {
  not_granted: "Claude isn't enabled for this page.",
  rate_limited: "Too many requests. Try again in a bit.",
  session_expired: "Please sign in again.",
  refused: "Claude can't help with that request.",
};
(async () => {
  const sample = await claude.use("sample");
  if (!sample) return; // feature stays hidden
  $("ask").hidden = false;
  let ctl;
  $("stop").onclick = () => ctl?.abort();
  $("ask").onclick = async () => {
    ctl = new AbortController();
    $("ask").disabled = true; $("stop").hidden = false;
    $("out").textContent = "Thinking..."; $("note").textContent = "";
    try {
      const { truncated } = await sample(
        "Answer concisely in plain text.\n\nQuestion: " + $("q").value,
        { signal: ctl.signal, cache: false,
          onText: ({ text }) => { $("out").textContent = text; } },
      );
      if (truncated) $("note").textContent = "Answer was cut short.";
    } catch (e) {
      $("out").textContent = e.text ?? "";
      if (e.code === "not_granted" || e.code === "sampling_disabled") $("ask").hidden = true;
      if (e.code !== "cancelled") $("note").textContent = COPY[e.code] ?? "Something went wrong. Try again.";
    } finally {
      $("ask").disabled = false; $("stop").hidden = true;
    }
  };
})();
</script>
```

Publish with `capabilities: {"sample": {}}`.

**Source:** the platform's `sample.d.ts`, `mcp.d.ts` and `claude.d.ts` type definitions for runtime contract 0.2.75. These define the contract; check them again if your runtime version differs.
