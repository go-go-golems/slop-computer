---
Title: Diary
Ticket: SLOP-010
Status: active
Topics:
    - slop
    - llm
    - geppetto
    - pi
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-10-29T17:56:10.698028619-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: Study geppetto, pinocchio, sessionstream and Pi's agent directory; open the ticket and branches; write the intern guide

This step answers whether slop's `sample` capability can run on geppetto instead of the Node Pi worker, with Pi's credentials loaded through a new geppetto package. The answer is yes for the providers in use: lunaroute (`openai-completions`) and openai-codex (`openai-codex-responses`). The step also opens ticket SLOP-010, creates branches in geppetto and slop, and writes the intern guide `design-doc/01-intern-guide-sample-on-geppetto-with-pi-credentials.md`. No code was written.

### Prompt Context

**User prompt (verbatim, study):** "can we actually use geppetto and pinocchio (potentiallky) see ~/code/wesen/go-go-golems/geppetto and pinocchio and potentiallky sessionstream, or if it makes sense to just write it in go from scratch, and load the credentials through geppetto, potentially adding a pi credentials loader to geppetto (to load things from the pi files). Study, report here in chat"

**User prompt (verbatim, this ticket):** "ok, create a new ticket with docmgr and create the necessary branh in geppetto as well, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Assistant interpretation:** Study first and report in chat (done). Then create SLOP-010, a geppetto branch, a slop branch for the implementation, and an intern-level design guide, and upload it to reMarkable.

### What I did

- **geppetto** (`main` at `b58b7483`, tag `v0.13.11`): read `README.md` and these packages:
  - `pkg/inference/engine` (`Engine`, `InferenceConfig`, factory);
  - `pkg/turns` (blocks, `toolblocks.ExtractPendingToolCalls`);
  - `pkg/events` (text, reasoning, tool and provider-call events, `Usage`);
  - `pkg/inference/tools` and `toolloop`;
  - `pkg/steps/ai/credentials` (Store, Refresher, renewable bearer source, OAuth client);
  - `providers/openaicodex`, `providers/umans`, and `settings` (base URLs per API type, HTTP client injection).
- **pinocchio:** `pkg/oauthprofiles` is a YAML OAuth store with `flock` and owner-only atomic writes. The rest is CLI, TUI and the web chat app.
- **sessionstream:** the README and the package list. It is a command, event and projection framework with websocket hydration.
- **Pi:**
  - read the credential union in `pi-ai/dist/auth/types.d.ts`, and the lock and write behaviour in `pi-coding-agent/dist/core/auth-storage.js` and `proper-lockfile/lib/lockfile.js`;
  - counted the built-in catalog's wire APIs in `pi-ai/dist/providers/data`;
  - read `~/.pi/agent/settings.json`, and only the *structure* of `models-store.json` and `models.json`, with `jq` (keys, model counts, `api` values);
  - did not open `auth.json`.
- **Ticket and branches:**
  - `docmgr ticket create-ticket --ticket SLOP-010 …`, plus the guide and diary docs and 9 tasks;
  - `git branch task/pi-agent-provider origin/main` in geppetto (local, not pushed, the checkout left on `main`);
  - `git switch -c task/slop-geppetto-sample` in slop (from `task/slop-runtime`).

### Why

- **Use geppetto, write the loop ourselves.** One `RunInference` call is one Pi round. `toolloop.RunLoop` has no hook between rounds to set `MaxResponseTokens` from the shared 65,536-token budget, and the tool execution must block on slop's page callback. A loop of about 80 lines keeps both visible.
- **Put the Pi loader in geppetto, not slop.** Other go-go-golems tools (pinocchio) can then reuse Pi's login.
- **Keep the `piworker.Backend` seam.** `rt_sample.go` and the page client stay unchanged, and the Node worker stays as a fallback.

### What worked

- `CGO_ENABLED=0 go list -deps` on `inference/engine/factory`, `inference/toolloop` and `providers/openaicodex` shows no goja and no `mattn/go-sqlite3`. slop's CGO-free build therefore stays possible. watermill and the Google genai SDKs are linked.
- Every model in `enabledModels` uses `openai-completions` or `openai-codex-responses`, and both have geppetto engines.

### What didn't work

- `git rev-parse --short origin/main main` failed with `fatal: Needed a single revision`, because `--short` takes one revision. I re-ran it with one argument (`b58b7483`) and created the branch.

### What I learned

- Pi stores lunaroute's gateway key as an OAuth `access` whose refresh returns the same credential (`web/piworker/src/lunaroute.ts`). It is effectively a static key.
- `main.ts` prepends `"\n\n"` to the first text (and thinking) delta of a later round when something is already visible. It sends no system prompt.
- geppetto's Chat Completions request sets only `Content-Type`, `Accept` and `Authorization` (`openai/chat_stream.go:163-166`). Lunaroute's three headers need an HTTP client wrapper, or the transport header hook.
- There is no Codex OAuth refresher in geppetto or pinocchio. `openaicodex` expects the host to supply `Credential{BearerToken, AccountID}`.

### What was tricky to build

- **Rotating refresh tokens.** Codex invalidates the old refresh token on refresh. A Go refresher must write back to `auth.json` under Pi's own lock: a `mkdir` lock directory with mtime updates and a stale rule. Otherwise Pi on the same machine is logged out, and a server holding a copy of the file and a laptop invalidate each other. This holds for the Node worker too.

### What warrants a second pair of eyes

- The thinking-level mapping table (guide §6.2). Its values are a starting point and must be checked against real request bodies per API.
- Whether `transport.HeaderSet` reaches the Chat Completions engine. If it does, it replaces the `RoundTripper` wrapper.

### What should be done in the future

- Phases 1–7 in `tasks.md`, starting with lunaroute on static keys (phases 1–3).

### Code review instructions

- Read the guide: §2 (today), §3 (Pi's files), §6–7 (design).
- Check the API references against `~/code/wesen/go-go-golems/geppetto` at `b58b7483`.

### Technical details

- **Branches:** geppetto `task/pi-agent-provider` at `b58b7483`; slop `task/slop-geppetto-sample` at `9011dc8` plus the ticket commit.
- **Catalog counts** (Pi 0.85.1 built-in data): `openai-completions` 679, `anthropic-messages` 325, `bedrock-converse-stream` 121, `openai-responses` 107, `azure-openai-responses` 39, `mistral-conversations` 32, `google-generative-ai` 29, `google-vertex` 14, `openai-codex-responses` 8.
