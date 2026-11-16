---
Title: 'Follow-up: the agent sees screenshots of its frames (design needed)'
Ticket: SLOP3-022
Status: active
Topics:
    - tools
    - agents
    - apps
    - architecture
    - publishing
    - collaboration
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-16T12:46:47.973430279-05:00
WhatFor: ""
WhenToUse: ""
---

# Follow-up: the agent sees screenshots of its frames

**Status: not started; needs a design pass before any code.** This came up on 2026-11-16 while trying the bench on a real model. The user's question (verbatim): "would adding iframe capability with injecting some kind of snapshotting conduit allow us to take snapshots of the real thing from within the agents themselves? since we control the hosting side too." The user asked for it to be written up as a follow-up, not built yet.

## The question

Today the agent checks its work through `frames.*`. It can read text, query and click elements, type, and get the layout map, console output and issue checks. It never sees pixels. Visual mistakes are invisible to it: overlapping elements, wrong colours, a board that renders but looks broken, a layout that only fails at phone width. The question is whether the agent can take a real screenshot of a frame and look at it.

## What already exists

- **A conduit into the real page.** Slop serves every frame's page, the dev instance's included, and injects `pkg/doors/pages/assets/probe.js` into it. The bench talks to the probe over `postMessage` (`fh.call(verb, args)`), and every `frames.*` call already goes this way.
- **A structural snapshot.** The probe answers `snapshot` with the DOM and its CSS (`web/bench/src/05b-snapshots.js`, `Snaps.capture`). The timeline uses it. It is not an image.
- **Models that read images.** The Pi store lists `lunaroute/deepseek-4.1-flash` (staging's model on every tier) with input `text` and `image`.
- **Images in the sampler, but only on the first user turn.** `llm.Request.Images` joins the last user message (`pkg/llm/gepp/sample.go`). Tool results are text: the comment there says "images excluded".

## Options for taking the picture

| | In the frame (probe) | On the host (headless browser) |
|---|---|---|
| How | The probe draws its own DOM to a canvas (an SVG `foreignObject` with styles, fonts and images inlined) and returns a PNG | Slop loads the dev instance as the developer in headless Chromium and screenshots it |
| Fidelity | Approximate: no nested iframes, some CSS differs, `<canvas>`/WebGL must be copied in, cross-origin images must be inlined | The real rendering |
| What it sees | Exactly the frame the developer sees, with its state (selected cell, typed input) | A fresh load, unless state is replayed |
| Cost | Small: a probe verb and some JS | Chromium in the pod, memory, a queue; auth to view a dev instance; URL restrictions so it cannot be pointed elsewhere |
| Works in | The bench in a browser | Anywhere, including MCP and agents without a browser |

A third option, `getDisplayMedia` screen capture, asks the person for permission every time, so it doesn't suit an agent.

## Getting the picture to the model

This part is needed whichever way the picture is taken:

1. **An eval API call,** for example `frames.shot(id, { selector, scale })`. It returns a handle, not bytes, so the eval's JSON result stays small.
2. **Image tool results in slop's sampler.** A tool result can carry images. The page door (`pkg/doors/pages/sample.go`) and the `llm.ToolResult` type would carry them.
3. **Geppetto:**
   - **Responses:** a `function_call_output` can carry `input_image` content.
   - **Chat Completions:** a tool message is text only, so the image goes in a user message right after it.
   - **Claude:** a `tool_result` can hold images.
   - This needs checking against Geppetto's turn blocks and each engine.
4. **Metering:** an image costs tokens. The meter already reserves `imageTokens` per image on the first turn; the same reservation applies here.

## Open questions

- **Probe or host,** or the probe first and the host later? Is the in-frame rendering good enough for the mistakes we care about?
- **When the agent looks:** on request only (`frames.shot`), or automatically after an eval that changed files (`effects.screenshot`)? Automatic is easier for a model to use, but costs tokens every time.
- **Size and cost:** a cap on dimensions and scale, a per-turn limit, and how screenshots count against the LLM budget.
- **Privacy:** a dev instance's frames show dev data. A screenshot sent to a provider is the same exposure as the text `frames.text` already sends, but it should be stated.
- **Without vision:** what happens when a tier's model doesn't accept images: an error, or a text description instead?

## Not in scope here

Pixel diffs between snapshots for regression checks, and sending screenshots to people (sharing, reviews). Both could build on this later.
