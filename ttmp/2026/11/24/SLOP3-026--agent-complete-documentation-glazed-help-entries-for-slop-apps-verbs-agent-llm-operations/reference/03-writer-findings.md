---
Title: Findings from the page writers
Ticket: SLOP3-026
DocType: reference
Topics:
- documentation
Status: active
Intent: long-term
---

# Findings from the page writers

Bugs, rough edges and old-doc contradictions each writer hit while running
every example against its own local server. Each is a candidate for the
"fix the command or the error first" rule (design 4.1). Status: `open` until
triaged.

## C2: user, room, comments, files, downloads

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| C2-1 | `profiles()`/`search()` always return `guest: false`: the runtime's `asProfile` drops the server's `guest` flag | bug | open |
| C2-2 | `avatarUrl` is always `""`; nothing fills it | gap | open |
| C2-3 | `canSendToClaudeSession()` returns `false`, not a status string as on claude.ai | compat | open |
| C2-4 | runtime `comments.delete` only resolves the thread (unreachable while `comments` is null) | bug | open |
| C2-5 | a guest with the `profile` scope can `search("")` and list the names of all direct grantees of the store | privacy | open |
| C2-6 | room presence has no client throttle and no server rate limit | robustness | open |
| C2-7 | `files.download` has no size cap | robustness | open |
| C2-8 | `slop push` accepts a broken manifest; the error shows only in `slop app status` | error-placement | open |
| C2-9 | the `slop policy set` error lists the capabilities without `stores` | error text | open |
| C2-10 | `files.project: "chan_abc"` passes validation, then every call is `not_found` | silent failure | open |
| C2-11 | `doc/claude-apis/README.md` says `user` works as on claude.ai; on slop `use("user")` is null unless declared | old doc | fixed by `capability-user` |
| C2-12 | `can("data.write")` is answered against one probe path, not the page's paths | ambiguity | open |

## A: quickstart, CLI, access, data

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| A-1 | `explain can --path data/users/<other>/…` says ok; the real read is not_found (explain disagrees with the check) | bug | open |
| A-2 | writing another person's private path answers `not_found: no document` | error text | open |
| A-3 | `store new --app nosuch` succeeds; `app status` then answers `internal: no such store` | silent failure | open |
| A-4 | `sql` write without `--write`: `invalid_argument: not authorized` (should say "add --write") | error text | open |
| A-5 | messages repeat their code: `conflict: conflict: …` | error text | open |
| A-6 | bool flag `--desc` swallows the next word; error "accepts at most 2 arg(s)" (also C1) | error text | fixed (B-1) |
| A-7 | `-o csv` (any unknown format) silently prints YAML | silent failure | fixed (E-9) |
| A-8 | `whoami` doc promises the audience; output has none | doc/output | open |
| A-9 | `files.put` doc: "after the next snapshot"; `files ls` shows it at once | verb doc | open |
| A-10 | `auth status` says it checks the default login; it only reads the file | verb doc | open |
| A-11 | `files commit` has no `-m`; `push` has | gap | open |
| A-12 | `people role` takes only `usr_`; `explain`, `llm` take an email (also D) | consistency | open |
| A-13 | `preview url <store> [at] <parent>`: required positional after an optional one | usage | open |
| A-14 | help rendering: `<group>`/`store:<id>` vanished, `x@y` became mailto, examples collapsed, footer `slop help set` | bug | fixed in `setupHelp` (templates + `mdEscape`, test) |

## C1: runtime, db, assets, artifact, slop

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| C1-1 | `artifact.publish` capped at ~320 KiB by the rpc body limit; error is `invalid_argument: send {method, args}`, the 16 MiB `too_large` never fires | bug | open |
| C1-2 | publishing a page's own `outerHTML` keeps the injected boot/claude.js tags: the runtime loads twice | bug | open |
| C1-3 | `/_blob/<id>` serves anyone with the URL (old README: interact only) | doc/security note | documented |
| C1-4 | `capabilities.slop.permissions` validated, never used; `subscribeUrl()` always `""` | dead code | open |
| C1-5 | `user.me().llm.allowed` (with policy) vs `slop.visitor().llm.allowed` (person only) can disagree | consistency | open |
| C1-6 | `explain can --subject @guest` fails ("no person @guest"); must write `anonymous` | consistency | open |
| C1-7 | `assets.list().usage.maxFiles/maxBytes` are runtime constants, not enforced | dead code | open |
| C1-8 | static host injects no runtime; claude.js `static` mode is dead; README says db read-only there | old doc | fixed by `page-runtime` |

## D: sample, agent, llm, server, pi

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| O-1 | overview said `sampling_disabled`; the server never sends it (runtime table only) | doc | fixed |
| D-1 | page runtime maps unknown server codes to `upstream_error` for sample (`permission_denied`, `quota_exceeded`, `unavailable`, `invalid_argument`, `authentication_error`); agent keeps them | bug | open |
| D-2 | `--listen` with a config file without `hosts`: hosts derive from the file's port, not `--listen` | bug | open |
| D-3 | `llm rm <email>` does not resolve the email and answers `removed:` when nothing matched | silent failure | open |
| D-4 | `llm reset store:<id>` → `not_found: no person` | bug | open |
| D-5 | Pi startup error says "pass --model-quick" (no such flag) | error text | open |
| D-6 | `PI_CODING_AGENT_DIR` ignored | gap | open |
| D-7 | `agent.limits()` returns sample's limits, not maxRounds/toolTimeout | bug | open |
| D-8 | session options above limits are clamped silently (`maxTokens` 999999 → 65536) | silent failure | open |
| D-9 | fake: no-tools session + `/tool` → empty text; after a stop the next message replays the stopped script; cut at budget reports `truncated: false` | fake bugs | open |
| D-10 | empty prompt reported as `prompt_too_large` | error text | open |
| D-11 | `--test` claims loopback-only, `X-Slop-As`, virtual clock; it only defaults `llm` to fake | verb doc | open |

## B: building, manifest, deploying, first app

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| B-1 | bool flags of server verbs need a value (`store ls --all`: "flag needs an argument") | bug | fixed: `NoOptDefVal="true"` in `verbCommand` |
| B-2 | `slop on <store> <unknown path>` prints usage and exits 0 | exit status | open |
| B-3 | `slop dev --once` exits 0 when activation is broken and prints "publish with: slop ref move … <broken n>" | exit status | open |
| B-4 | `ref rm` does not fill `ifAt` like `ref move` | consistency | open |
| B-5 | `mount set /h/:store` without `--storeParam` is not inferred | ergonomics | open |
| B-6 | `slop.reads` validated, never read (also C1-4) | dead code | open |
| B-7 | `store new --type` has an empty flag doc | verb doc | open |
| B-8 | a page's db write refused by a rule is `invalid_argument`, not `permission_denied` | error code | open |
| B-9 | `grant set` refuses an email (`a subject is usr_…`) (also A-12) | consistency | open |
| B-10 | `store new --app X` ignores the manifest's `type` | surprise | documented |
| B-11 | `doc/building-apps.md` §4: snapshot URLs and sandbox files are `immutable`; `/_d/` gone | old doc | fixed by `building-apps` |

## E: actors, app verbs, using verbs, Pinboard

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| E-1 | the unknown-alias hint did not fire when cobra adds "Did you mean this?" (`slop pb`) | bug | fixed: match the first line; test |
| E-2 | text-mode verbs print no trailing newline (`board describe`) | output | open |
| E-3 | a broken mount API allowlist breaks the store's actions too, until `slop app restart` | bug | open |
| E-4 | verbs without `parents` land under `verbs <file> …`; no top-level verb | ergonomics | open |
| E-5 | `slop app verb` reports `via: cli` | cosmetic | open |
| E-6 | app verbs show Glazed's `--config-file` flag | noise | open |
| E-7 | `Visitor.Payer` comment says the owner pays for alarms; code charges `store:<id>` (needs `policy … @store on` and `llm set store:<id> on`) | code comment | open |
| E-8 | "created on visit": the path id is ignored, the new store gets `s-…` | surprise | documented |
| E-10 | no CLI verb lists a store's actor actions (pages have `slop.actions()`); an agent must read `actor.js` | gap | open |
| E-9 | `-o csv` etc. silently YAML (A-7) | silent failure | fixed: root `PersistentPreRunE` refuses unknown formats before the verb runs |

## Harness

| # | Finding | Kind | Status |
| --- | --- | --- | --- |
| H-1 | a bare `- on` in frontmatter `Commands:` is a YAML bool; Glazed's parser panics (`interface {} is bool, not string`) and the binary died at startup | bug | fixed: quoted; `AddDocToHelpSystem` recovers; doc_test catches it |
