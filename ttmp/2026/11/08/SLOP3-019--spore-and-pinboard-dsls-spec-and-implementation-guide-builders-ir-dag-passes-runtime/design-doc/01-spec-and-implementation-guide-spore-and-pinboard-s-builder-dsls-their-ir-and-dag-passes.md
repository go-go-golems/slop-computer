---
Title: 'Spec and implementation guide: Spore and Pinboard''s builder DSLs, their IR and DAG passes'
Ticket: SLOP3-019
Status: active
Topics:
    - apps
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/pinboard/js/apps.js
      Note: evalSource and the editor's Describe IR (Part III, P1)
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/pinboard/js/board.js
      Note: Pinboard's invalidation (B.onChange)
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/pinboard/js/dsl.js
      Note: Pinboard's grammar and build pass (IR)
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/pinboard/js/render.js
      Note: Pinboard's renderer and dependency keys
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/upstream/blocks/src/spore.js
      Note: 'Spore: BUILD, LINK (the DAG and IR), RUN'
ExternalSources: []
Summary: 'Spec and implementation guide for slop''s two JavaScript builder DSLs, Spore (Blocks, upstream) and Pinboard''s app grammar: grammar, passes, IR schema, runtime, host integration, how to change them, and the bugs found by running them (one security bug in Pinboard).'
LastUpdated: 2026-11-08T22:50:30.992277773-05:00
WhatFor: Understanding, changing or writing programs for Spore or Pinboard apps; knowing which documented features are not built.
WhenToUse: Before changing apps/upstream/blocks/src/spore.js, apps/pinboard/js/dsl.js, render.js, board.js, frame.js or frames.js, or before relying on either IR.
---

# Spec and implementation guide: Spore and Pinboard's builder DSLs, their IR and DAG passes

slop ships two JavaScript DSLs in which small apps are written as fluent builder chains:
- **Spore**, inside Blocks;
- **Pinboard's app grammar**, inside Pinboard.

Both have a "build" step that produces an IR, and both are described, in their own documentation, as compiling a program into a DAG that a runtime evaluates. This document specifies each one as the code actually behaves at `f5bc6b2`: the grammar, every pass, the IR field by field, the runtime, and the host integration. It explains how to change each safely, and lists where the code and its documentation disagree.

The short version:
- **Spore really is a three-pass compiler.**
  - BUILD records a description.
  - LINK evaluates every formula once under a tracking scope, so the reads become DAG edges, and the result is a JSON IR.
  - RUN is a lazy, memoised, two-phase-ticked spreadsheet over that DAG.
  - It is sound in the main, with a handful of real bugs at the edges. The worst is that the IR's `order` silently drops every node downstream of a state-to-state read.
- **Pinboard's grammar has an IR but no DAG.**
  - `build()` makes an inspection tree whose `deps` and `edges` are always empty, and the renderer never reads it.
  - Updates come from per-window data keys recorded while drawing; any matching change redraws the whole window.
  - It also has **one security bug**, which should be fixed before anything else in this document (Part III, P1).

## How to read this

- **Three parts:**
  - Part I is Spore;
  - Part II is Pinboard;
  - Part III collects what needs doing, ranked.
  
  Section numbers inside Parts I and II are each part's own, so "section 13" in Part I means Part I §13.
- **Citations:** each part states its base path in its §0.
  - Part I cites `src/…` relative to `apps/upstream/blocks/`.
  - Part II cites paths relative to `apps/pinboard/`, and `ex:<line>` for the Pinboard guide's example code (in SLOP3-016's sources).
- **Evidence tags:** every claim carries one.
  - **[run]** (Part I: [run E0n]) means reproduced by running the code in Node;
  - **[read]** means from reading only;
  - **[test]** means covered by an existing test.
  
  Nothing was run in a browser. Drawing, real DOM events, iframe sandboxing and CSP are [read] in both parts.
- **The experiments live in this ticket's `scripts/`.** `scripts/spore/` holds `load.js` and `e01`–`e10`; `scripts/pinboard/` holds `harness.js` and `exp1`–`exp10`. Each comes with its recorded `.out`. They take the repo files as arguments, for example:
  ```
  node scripts/spore/e01-ir.js apps/upstream/blocks/src/spore.js apps/upstream/blocks/src/hypha.js apps/upstream/blocks/src/index.html
  node scripts/pinboard/exp1-ir.js apps/pinboard
  ```
- **Provenance:** Parts I and II were drafted by two agents, one per system, each reading and running its own system. The lead merged them and re-checked the headline findings against the cited lines before publishing (diary step 2). Each drafting agent's working record is in `reference/02-diary-spore-agent.md` and `reference/03-diary-pinboard-agent.md`.

## The two systems side by side

| | Spore (`apps/upstream/blocks/src/spore.js`) | Pinboard (`apps/pinboard/js/dsl.js` + `render.js`, `board.js`) |
|---|---|---|
| Origin | Upstream (Ramon Marc's CC5/Blocks), copied unchanged; `build.sh` refuses to build if its sha256 differs from `SHA256SUMS` | Ported into slop by SLOP3-016/017; slop's own code |
| Program | Plain JS, compiled with `new Function` in the page (Part I §4.1) | Plain JS, evaluated with `new Function` (in the page for built-in apps, in a sandboxed frame for apps by others) (Part II §1.3, §6.3) |
| Builders | Mutable recorders (`app()`, `.cell`, `.param`, `.state`, `.action`, `.view`, …) (Part I §4.2–4.4) | Immutable, Proxy-wrapped records (`ui.*`, modifiers, fragments, `app()`) (Part II §2) |
| Passes | BUILD → LINK → RUN, kept apart on purpose (Part I §3) | One build pass (`buildIR`) that numbers nodes and copies shape; no link pass (Part II §3.1) |
| Dependencies | Discovered: LINK evaluates each formula once with a tracking `$` and records every read as an edge; view edges are added while painting (Part I §5.4, §8.1) | Recorded per window while rendering, as data keys (`clips`, `coll:<name>`, …); the IR's `deps` are always empty (Part II §4) |
| DAG and order | A real DAG; Kahn topological `order` in the IR, which drops nodes on or after a cycle (Part I §5.7; Part III, P3) | None; `edges` is always `[]`; no ordering or cycle handling (Part II §4.1) |
| Cycles | Formula cycles are detected at LINK and at run time; state↔state reads are legal (two-phase) (Part I §5.6, §7.6) | N/A (no graph) |
| Invalidation | Push dirty flags, pull values lazily, memoised; ticks per frame for states and clock readers (Part I §7.2–7.6) | Any change whose key a window recorded redraws that whole window; clip changes redraw every window (Part II §4.4) |
| IR's role | The program as JSON: inspected by the studio, the graph view and the agent (Part I §6, §9) | Inspection only (*Describe IR*, the agent); the renderer uses builders, never the IR (Part II §1) |
| Writes | Only actions write (`$.set/push/toggle/inc`); the desk only through `$.set` (Part I §7.9; Part III, P3) | Board mutations through a recorder (`m.set`, `m.move`, …) in transactions; window state through `c.set` (Part II §5.6) |
| Trust | Runs with the page's authority; no sandbox (Part I §10.8) | Apps by others run in a sandboxed frame with a step protocol; built-in apps in the page (Part II §6.3), with one hole (Part III, P1) |
| Tests | No tests in the repo; Part I's experiments are the only executable checks | `apps/pinboard/test/*.test.js` (core, steps, render, frames) and `pkg/host/pinboard*_test.go`; nothing tests `dsl.js` or `PB.render` |

## Where to start, by task

| You want to… | Spore | Pinboard |
|---|---|---|
| Understand the model | I §1, §3 | II §1 |
| Write an app | I §4 (grammar), §7 (what runs when) | II §2, §5 |
| Read or produce the IR | I §6 (schema, a real IR in §6.6) | II §3 (schema, a real IR in §3.6) |
| Add a node kind or builder | I §11.3 (and §11.2 for view elements) | II §7.2–7.3 |
| Add a pass or a check | I §11.4 | II §7.4 |
| Change the runtime safely | I §11.6 (invariants) | II §7.1 (invariants) |
| Test a change | I §11.7, §13 | II §7.7, §11 |
| Know what is broken | I §12, Part III | II §8–9, Part III |

---

# Part I: Spore

Spore is the JavaScript DSL that ships inside Claude Blocks (CC5's computer in Notion's form). A program is plain JavaScript that calls a fluent builder; the builder records a description, a linker turns the description plus one evaluation of every formula into a DAG (the IR), and a runtime evaluates that DAG lazily per change and per animation frame. This draft specifies all three stages, the IR field by field, the runtime semantics, the painter, the CC5/Blocks host integration, and how to change any of it safely. It ends with a list of bugs and doc/code mismatches, most of them reproduced by running the code.

## 0. Sources, citations, verification

| Short form | File (repo-relative) | Notes |
|---|---|---|
| `src/spore.js:N` | `apps/upstream/blocks/src/spore.js` | 2,687 lines, sha256 `0f44bac13f78…a3c6` (`apps/upstream/blocks/SHA256SUMS:10`). Upstream file by Ramon Marc, copied unchanged |
| `src/index.html:N` | `apps/upstream/blocks/src/index.html` | the textbook is `script#spore-docs`, `src/index.html:1136-1656` |
| `src/blocks.js:N` | `apps/upstream/blocks/src/blocks.js` | the Blocks host that boots Spore |
| `src/fruit.js:N`, `src/hypha.js:N` | same folder | CC5's view layer and kernel |
| `build.sh:N`, `README.md:N` | `apps/upstream/blocks/` | build and provenance |

Every claim carries one of two tags:

- **[run E0n]**: reproduced by running `spore.js` in node 24.18.0 through a harness (section 13). The repo file is read, not changed; the harness injects one line in memory to expose the private `Paint`/`Host`/`UI` sections and stubs `window`/`document`/`requestAnimationFrame`. The desk experiments use the real Hypha kernel (`require("src/hypha.js")`).
- **[read]**: from reading the code only.

Nothing was verified in a browser: canvas drawing, DOM, Fruit element mounting and the Studio UI are [read] only (painting was exercised with a no-op 2D context, which is enough to run every view lambda and record view reads).

## 1. Purpose and mental model

Spore is "the same idea as CC5, as a small JavaScript DSL": apps made of cells, apps that read each other, the reads drawn as wires (`src/index.html:1139-1141`). Its niche next to Hypha is anything that moves, simulates, draws or computes a lot (`src/index.html:1559-1561`).

The mental model is a spreadsheet with three kinds of code:

1. **Build-time code**: the program's top level and the lambdas passed to `view`, `row`, `each`, `use`, `component` and app factories. It runs once, receives builders, and makes structure (`src/spore.js:19-22`, `src/index.html:1395-1401`).
2. **Runtime readers**: formulas, state steps, data/text slots, `when` conditions and `draw`. They receive the scope `$` and only read (`src/spore.js:26-27`, `src/spore.js:413-414`).
3. **Actions**: runtime lambdas that may write, through `$.set/push/toggle/inc` (`src/spore.js:415-421`).

"Plain JavaScript is the host language: no parser, no interpreter, no sandbox" (`src/spore.js:28`). The program is compiled with `new Function` in the page (`src/spore.js:305`); it runs with the page's full authority (section 10.8).

## 2. Source map of `spore.js`

| Section | Lines | Contents |
|---|---|---|
| Header | `src/spore.js:1-29` | the three stages, the two CC5 elements, `window.spore` |
| SPORE CORE | `src/spore.js:30-730` | errors and line attribution (`40-77`), grammar `KINDS` (`82-100`), builders `makeProgram` (`102-299`), `build` (`302-315`), `syntaxLine` (`317-325`), `Runtime` (`328-695`), `viewIR` (`696-709`), `coerce`/`same`/`clone` (`710-722`), `load` (`725-728`), exports (`729`) |
| presets | `src/spore.js:733-1161` | eleven example programs, `hello` … `creatures` |
| PAINT | `src/spore.js:1170-1751` | tokens and `fmt` (`1180-1204`), the `g` drawing API (`1239-1268`), `paintApp` (`1272-1479`), `Surface` (`1482-1495`), `Stage` desk/app/graph (`1498-1749`) |
| UI PARTS | `src/spore.js:1761-2004` | editor, highlighter (grammar word list `1779`), markdown book renderer, `Params`, error list |
| AGENT | `src/spore.js:2014-2099` | model providers and fallback, `extract` of the program |
| HOST | `src/spore.js:2113-2674` | `Bridge` (`2128-2141`), `Program` (`2146-2217`), `Loop` (`2225-2244`), `RunView` (`2247-2277`), `Studio` (`2290-2569`), mounting and the Fruit hook (`2577-2614`), `create` (`2617-2632`), `window.spore` API (`2637-2660`), `init`/`prompt` (`2663-2672`) |
| styles, exports | `src/spore.js:2677-2686` | CSS injected once; `window.Spore`, `window.spore`, `window.CC5Spore` |

## 3. The three stages and why they are kept apart

| Stage | Entry | What runs | Output |
|---|---|---|---|
| BUILD | `build(code)` `src/spore.js:302-315` | the program text, once; builder calls; build-time lambdas | `prog`: a description (section 4.6) |
| LINK | `new Runtime(prog)` → `link()` `src/spore.js:329-353`, `387-408` | name resolution of static refs; every formula once; every state step once (probe) | a runtime whose cells carry `deps`/`rdeps`: the DAG. `Runtime.ir()` serialises it (`src/spore.js:648-687`) |
| RUN | `read`/`write`/`act`/`tick` `src/spore.js:502-603` | formulas on demand, steps per tick, view readers and `draw` per paint, actions per click | values; repaint signals (`version`, events) |

`Spore.load(code, opts)` does BUILD and LINK in one call (`src/spore.js:725-728`).

Why apart (from the code's own comments and structure): build-time lambdas leave only their result, so the IR can be plain JSON (`src/spore.js:24-25`, `src/index.html:1401`); runtime lambdas are kept as source text plus the edges they read (`src/spore.js:653-656`). Structure is therefore fixed while running: `each` iterates a build-time array, and data that grows at run time must go through runtime elements such as `list`, `bars` or `draw` (`src/index.html:1421`, `src/spore.js:175`). The separation is a convention, not a sandbox: only `app()` refuses to run after BUILD (`src/spore.js:277`); see the unsealed-builder sharp edge in section 12.

## 4. BUILD

### 4.1 Compilation and the program's globals

`build(code)` compiles the text with `new Function("app", "component", "range", "clamp", "lerp", code + "\n//# sourceURL=spore-program.js")` and calls it with the five globals (`src/spore.js:305-307`). A syntax error becomes a `SporeError` of kind `syntax` with a line from `syntaxLine` (`src/spore.js:306`, `317-325`); any other throw becomes kind `build` with the line read from the stack (`src/spore.js:308-311`). A program that makes no apps is a build error (`src/spore.js:313`). After the call, `prog.building = false` (`src/spore.js:312`).

| Global | Signature | Records / returns | Cite |
|---|---|---|---|
| `app` | `app(id, opts?)`; `opts` = `{ title, w }` or a title string | a new `App` builder; `prog.apps.set(id)`, `prog.order.push(id)`. `id` must match `NAME`, not be reserved, be unique; only while building | `src/spore.js:274-284` |
| `component` | `component(name, (v, props) => v…)` | registers `{ name, fn, line }` in `prog.components`; returns `props => v => v[name](props)`, a fragment usable with `use` | `src/spore.js:285-292` |
| `range` | `range(n)` or `range(a, b, step = 1)` | an array | `src/spore.js:294` |
| `clamp` | `clamp(x, lo, hi)` | number | `src/spore.js:295` |
| `lerp` | `lerp(a, b, t)` | number | `src/spore.js:296` |

Constants (`src/spore.js:33-38`): `RESERVED` = `t dt frame now set push toggle inc get desk pointer`; `NAME` = `/^[A-Za-z_][A-Za-z0-9_]*$/`; `REF` = `NAME` or `NAME.NAME`; `CLOCK = "$clock"`; `SRC = "spore-program.js"`.

### 4.2 The App builder

Every method records into `this._` and returns `this` (`src/spore.js:205-272`). `this._` is `{ id, title (default id), w (default 260), line, cells: Map, actions: Map, views: [], exports: [] }` (`src/spore.js:207`).

| Method | Arguments | Records | Checks | Cite |
|---|---|---|---|---|
| `.cell(name, v)` | value, or a function | `{ kind: "formula", fn }` if `v` is a function, else `{ kind: "value", value }` | needs two arguments; name rules via `_def` | `src/spore.js:218-222` |
| `.cells(obj)` | `{ name: value or $ => … }` | one cell per entry, all with the **same line** [run E03] | `obj` must be an object | `src/spore.js:223-228` |
| `.param(name, init, opts)` | number, boolean, string, or string with `opts.options` | `{ kind: "param", value: init, control }` | number: `max > min`; options must contain `init`; other types are a build error | `src/spore.js:229-244` |
| `.state(name, init, step)` | `step: ($, prev) => next` | `{ kind: "state", value: init, init, step }` | `step` must be a function | `src/spore.js:245-249` |
| `.action(name, fn)` | `fn: $ => …` | `actions.set(name, { name, fn, line })` | `NAME`; not already a cell or action | `src/spore.js:250-257` |
| `.export(...names)` | own cell names | `exports.push({ name, line })` | `NAME` only (no `app.cell`); resolved at LINK | `src/spore.js:258-263`, `403` |
| `.view(fn)` | build-time `v => v…` | runs `fn` at once on a fresh `View`; **appends** its nodes, so `.view` may be called several times | `fn` must be a function | `src/spore.js:264-271` |

`_def` (`src/spore.js:209-217`) enforces for every cell: `NAME`, not in `RESERVED`, not a duplicate cell, not an existing action name. Cells and actions share one namespace per app (`src/spore.js:213-214`, `254`).

Param controls (`src/spore.js:231-243`):

| `init` | control | defaults |
|---|---|---|
| number | `{ type: "range", min, max, step }` | `min = opts.min ?? Math.min(0, init)`; `max = opts.max ?? (init > 0 ? init * 2 : 10)`; `step = opts.step ??` 1 if `init`, `min`, `max` are integers and `max - min >= 10`, else `(max - min) / 100`. So `param("b", 3)` gets min 0, max 6, step 0.06 [run E02-12b] |
| boolean | `{ type: "checkbox" }` | |
| string + `opts.options` | `{ type: "select", options }` (stringified) | `init` must be an option |
| string | `{ type: "text" }` | |

All controls also get `label` (default the name) and `unit` (default `""`) (`src/spore.js:242`).

### 4.3 The View builder

A `View` holds `(app, nodes)`; its constructor returns a `Proxy` (`src/spore.js:118-119`, `186-203`). Element methods push a node `{ k, line, …props }` into `nodes` and return the builder (`src/spore.js:120`). Slot helpers decide what a slot holds (`src/spore.js:106-116`):

- **data slot** (`data`): a function becomes `{ fn }`; a string matching `REF` becomes `{ ref }`; anything else is a build error.
- **text slot** (`text`): a function becomes `{ fn }`; any non-object becomes `{ value: String(v) }`; optional text slots may be `undefined`.

| Method | Node recorded | Notes | Cite |
|---|---|---|---|
| `h(t)`, `text(t)`, `note(t)` | `{ k, text }` | text slot | `src/spore.js:127-129` |
| `stat(of, label?, opts?)` | `{ k: "stat", of, label, opts }` | if `label` is an object it is `opts` and `opts.label` is the label | `src/spore.js:130-134` |
| `meter(of, opts)`, `spark(of, opts)`, `bars(of, opts)` | `{ k, of, opts }` | | `src/spore.js:135-137` |
| `list(of, opts)` | `{ k: "list", of, opts }` | `opts.text` must be a function `item => string` | `src/spore.js:138-142` |
| `draw(height?, paint)` | `{ k: "draw", height, paint }` | height defaults to 140 when omitted (undocumented) | `src/spore.js:143-149` |
| `button(label, action)` | `{ k: "button", label, action }` | `action` is an action name (`NAME`) or a function | `src/spore.js:150-154` |
| `toggle(cell, label?)` | `{ k: "toggle", cell, label }` | `cell` must match `REF`; label defaults to the cell name [run E08] | `src/spore.js:155-159` |
| `stepper(cell, label?, opts?)` | `{ k: "stepper", cell, label, opts }` | as `toggle`; label may be `opts` | `src/spore.js:160-165` |
| `divider()` | `{ k: "divider" }` | | `src/spore.js:166` |
| `row(fn)` | `{ k: "row", children }` | `fn` runs on a sub-builder over `children` | `src/spore.js:167`, `121-126` |
| `when(cond, fn)` | `{ k: "when", cond, children }` | `cond` must be a runtime lambda | `src/spore.js:168-172` |
| `each(items, fn)` | **no node** | calls `fn(this, item, i)` on the same builder, so its elements are inlined | `src/spore.js:173-179` |
| `use(fn, ...args)` | **no node** | calls `fn(this, ...args)` | `src/spore.js:180-184` |
| `v.<component>(props)` | `{ k: "group", name, children }` | the component's lambda runs on a sub-builder over `children`, once per use | `src/spore.js:190-197` |

The proxy (`src/spore.js:188-201`) resolves, in order: real members of the `View` (including the internals `_add`, `_sub`, `_app`, `_nodes`, `constructor`); registered components; `then`/`toJSON` (undefined, so the builder is neither thenable nor JSON-serialisable by accident); anything else returns a function that throws `Unknown view element "x". Did you mean …?` with the call's line [run E02-10a]. A component must be registered before the `.view()` that uses it runs, since view lambdas run immediately (`src/spore.js:268`).

`KINDS` (`src/spore.js:82-99`) lists every node kind and its slot names, and `BUILDER_METHODS` (`src/spore.js:100`) lists the method names. Neither drives behaviour: `KINDS` is only exported (`src/spore.js:729`); `BUILDER_METHODS` feeds the did-you-mean list and the component-name clash check (`src/spore.js:200`, `288`). `KINDS`' slot names (`data`, `paint`) are not the node field names (`of`, `paint`, `cond`) [read].

### 4.4 Chaining, mutability, composition

- **Builders are mutable.** Every method mutates the builder's record and returns the same object (`src/spore.js:215-216`, `127`). There is no immutability or copy-on-chain; `const week = app(…)` followed by `week.cell(…)` from a loop is the documented pattern (`src/index.html:1406-1408`).
- **Fragments** are plain functions `(v, …args) => v…` passed to `use` (`src/index.html:1353-1360`).
- **Components** are named fragments with props; `component()` also returns a curried fragment, so `v.use(kpi({ of: "n" }))` equals `v.kpi({ of: "n" })` [run E02-15]. In the IR a use is a `group` node with `component: name`; the group's line is the call site, the children's lines are inside the component's body [run E02-15].
- **App factories** are functions that call `app()`; each call needs its own id (`src/index.html:1385-1387`). Lines recorded for a factory-made app or cell are the lines inside the factory, not the call site [run E03].

### 4.5 Line attribution

`callerLine()` makes an `Error` and reads the first `spore-program.js:N` frame of its stack, minus `LINE_OFFSET` (`src/spore.js:49-53`). `LINE_OFFSET` is measured once by throwing from a probe `new Function` (`src/spore.js:44-48`), which absorbs the two header lines V8 adds. Every builder method calls `callerLine()` in its own body, so the line is the innermost program frame that made the call [run E01, E03: lines match the source]. Syntax errors have no stack line in V8, so `syntaxLine` re-compiles growing prefixes and returns the first prefix that fails with the same message, skipping messages that look like truncation artefacts (`src/spore.js:317-325`); see the bug in section 12 (B4).

### 4.6 The description (`prog`)

```
prog = {
  apps: Map<appId, App>,           // App._ = { id, title, w, line, cells, actions, views, exports }
  order: [appId, …],                // declaration order
  components: Map<name, { name, fn, line }>,
  building: false                   // after build()
}
CellSpec  = { name, line, kind: "value" | "formula" | "param" | "state",
              value?, fn?, control?, init?, step? }          // src/spore.js:215, 221, 243, 248
Action    = { name, fn, line }                                // src/spore.js:255
Export    = { name, line }                                    // src/spore.js:261
ViewNode  = { k, line,
              text?|label?: { value } | { fn },
              of?: { ref } | { fn },                          // LINK adds of.id
              cell?: "name" | "app.name",                     // LINK adds cellId
              action?: "name" | fn, cond?: fn, opts?: {},
              height?, paint?, name? (group), children? }
```

(`src/spore.js:103`, `207`, `120-126`, `194`). Lambdas are kept as live functions in the description; only the IR turns them into source text.

### 4.7 Build-time errors

| Kind | Raised by | Example [run E02-10] |
|---|---|---|
| `syntax` | `new Function` | `missing ) after argument list` |
| `build` | `need()` in a builder (`src/spore.js:105`), the view proxy, `build()` | `Unknown view element "stats". Did you mean "stat"?`; `"t" is reserved in $ …`; `There is already an app "a" (line 1).`; `The program made no apps.`; a plain JS `TypeError` at top level, with hint "This happened while the program built its apps (build time)." |

All build errors are thrown: `Spore.load` throws, and the host keeps the previous runtime (section 10.2).

## 5. LINK

### 5.1 The runtime's records

The `Runtime` constructor copies the description into its own maps (`src/spore.js:329-351`):

| Map | Key | Record | Cite |
|---|---|---|---|
| `apps` | app id | `{ id, title, w, line, names: Set(cell names), views, actions, exports }`; `views`, `actions` and `exports` are the builder's own objects, shared by reference | `src/spore.js:345` |
| `cells` | `"app.name"` | `{ id, app, name, kind, line, fn, step, init, value, def, control, deps: Set, dirty, error }`; `value`/`def` are `structuredClone`s of the declared value; formulas start `dirty` with `value` undefined | `src/spore.js:348-349` |
| `rdeps` | dependency id | `Set` of reader cell ids (the reverse edges used by invalidation) | `src/spore.js:335` |
| `viewReads` | app id | `Set` of ids any of the app's view readers ever read | `src/spore.js:336`, `626-629` |
| `errors` | error key | `{ key, kind, message, line, where, hint }` | `src/spore.js:339`, `632-645` |

Plus `clock = { t, dt, frame, now }`, `pointers: Map<app, pointer>`, `listeners`, the `computing` stack and `version` (`src/spore.js:337-342`).

### 5.2 Static resolution

`link()` first walks every app's view tree (`src/spore.js:388-404`):

- `of: { ref }` → `of.id = resolve(app, ref)` for every node kind that has `of` (`src/spore.js:391`);
- `toggle`/`stepper` → `cellId = resolve(app, cell)`, and a formula target is a link error (`src/spore.js:392-396`);
- `button` with an action name → the app must have that action (`src/spore.js:397-398`);
- `export` names → `resolve` (`src/spore.js:403`).

`resolve(appId, ref)` (`src/spore.js:373-384`): one segment means a cell of the same app; two segments mean `app.cell`. Each failure throws a `SporeError` of kind `link` naming what exists and the closest match [run E02-9]. Static link errors are **fatal**: they escape the constructor, so `Spore.load` throws.

Names used *inside* view lambdas (text, `when`, `draw`, `list` text) are not checked at LINK; they fail when the element first paints [run E07].

### 5.3 The tracking scope `$`

`scope(appId, mode, track, where)` builds the `$` a runtime lambda sees (`src/spore.js:411-439`). `track` is a `Set` that collects every id read; `null` means "do not track" (actions, direct API reads). Property lookup order (`src/spore.js:423-432`):

| Order | `$.p` when `p` is | Returns | Tracks |
|---|---|---|---|
| 1 | a cell of this app | `rt.read("app.p", track)` | `"app.p"` |
| 2 | `get`, `set`, `push`, `toggle`, `inc` | the API function; writers throw unless `mode === "action"` | via `get` |
| 3 | `t`, `dt`, `frame`, `now` | `clock[p]` | `"$clock"` |
| 4 | another app's id | `appScope(p, track)`: a proxy over that app's cells (`src/spore.js:440-452`) | `"other.cell"` |
| 5 | `desk` | `deskScope(track)` (`src/spore.js:455-476`), only with a bridge | `"desk:app.cell"` |
| 6 | `pointer` | `pointers.get(app)` or the frozen `NO_POINTER` | `"$pointer"` |
| – | `toJSON`, `then`, `valueOf`, `toString` | `undefined` | |
| – | anything else | throws `$.x is not defined …` (kind `runtime`) with did-you-mean | |

The textbook's order (`src/index.html:1190-1196`) lists cell, clock, app, desk, pointer; the code puts the API names second, which cannot collide because they are reserved (`src/spore.js:33`, `212`). An own cell shadows an app of the same id (`src/spore.js:425` before `428`) [read]. Assignment (`$.x = 1`) throws (`src/spore.js:434`); `Object.keys($)` lists own cells (`src/spore.js:436-437`); `"x" in $` is true for own cells, API names and app ids (`src/spore.js:435`).

The writers (`src/spore.js:417-420`): `$.set(path, v)` → `write`; `$.push(path, item)` → `write(path, [...cur, item])` (requires an array); `$.toggle(path)` → `write(path, !cur)`; `$.inc(path, by = 1)` → `write(path, (Number(cur) || 0) + by)`. Only `$.set` accepts `desk.` paths (bug B1).

### 5.4 Dynamic edges: evaluate once, record what was read

After static resolution, `link()` reads every formula once with `track = null` at the top (`src/spore.js:405`). `read(id, track)` adds `id` to the caller's `track`, then computes the cell if it is a dirty formula (`src/spore.js:502-507`). `compute(c)` (`src/spore.js:508-528`):

1. cycle check against the `computing` stack (5.6);
2. push `c.id`, make a fresh `track`, run `c.fn(scope(c.app, "read", track))`;
3. reject a returned Promise; clear or record the cell's error;
4. pop, `setDeps(c.id, track)`, `c.dirty = false`.

Because the inner `read` adds to the *caller's* track before computing, `track` holds exactly the direct dependencies. `setDeps` (`src/spore.js:529-535`) removes the reader from the `rdeps` of dependencies it no longer reads, adds it to the new ones, and replaces `c.deps`. Dependencies are therefore dynamic: a formula `$ => $.flag ? $.a : $.b` reads `[flag, a]` or `[flag, b]`, and the stale reverse edge is pruned [run E02-4].

States are probed once: `probeStep(c)` runs the step with a tracking scope on a **clone** of the value and discards the result (`src/spore.js:536-541`); it sets `c.deps` but does not update `rdeps` (harmless: invalidation never marks states dirty, `src/spore.js:550`).

View readers are **not** evaluated at LINK. View edges appear only when a renderer paints (section 8.1), so before the first paint every `view` node has `reads: []` [run E01].

### 5.5 Edge kinds

| From (dependency id) | To | Created by | Lifetime |
|---|---|---|---|
| cell id | formula | `compute` → `setDeps` | replaced at every recompute |
| cell id / `$clock` / `$pointer` / `desk:path` | state | `probeStep` at LINK, then every `tick` (`src/spore.js:599`) | replaced every tick; a "previous tick" (delayed) edge |
| any of the above | `app.view` | `paintApp` → `noteViewReads` (`src/spore.js:1477`) | **union over every paint since the runtime was built; never pruned** [run E02-5] |

Actions create no edges: they run with `track = null` (`src/spore.js:585`).

### 5.6 Cycle detection

A cycle is detected when `compute` finds the cell already on the `computing` stack; it throws `Cycle: a → b → a …` with `kind: "link"`, `cycle: true` (`src/spore.js:509-513`). The error propagates up to the outermost cell of the evaluation, which records it; inner members re-throw without recording (`src/spore.js:521`). Observed [run E02-3]: with `a = $.b + 1`, `b = $.a + 1`, only `c.a` carries the error; `c.b` silently computes `NaN` from `a`'s `undefined` and has no error. The comment "links with cycles are reported, not fatal" holds (`src/spore.js:407`): the runtime is built, the rest of the program works.

Cycles are not only found at LINK. Because edges are dynamic, a write can close a conditional loop at run time; it is reported then, still with kind `link` [run E02-20].

State ↔ state reads are not cycles at run time: each step reads the previous tick (two-phase tick, 7.6). They are, however, cycles in the IR's edge set (bug B2).

### 5.7 Ordering

There is no ordering pass at LINK and the runtime needs none: evaluation is demand-driven (7.2). The only order is computed for the IR by `order(nodes, edges)`, a Kahn topological sort over all IR nodes (`src/spore.js:688-694`); nodes on or downstream of any cycle never reach in-degree 0 and are silently left out (B2). The Graph view computes its own layering, a longest-path depth with a cycle guard, from `rt.cells` and `rt.viewReads` directly (`src/spore.js:1650-1667`); it does not use `order`.

### 5.8 Diagnostics produced by LINK

| Situation | Kind | Fatal? | Where it lands |
|---|---|---|---|
| unknown cell/app in a data slot, toggle, stepper, export | `link` | yes, thrown | `Program.buildError` |
| toggle/stepper on a formula; button naming a missing action | `link` | yes | same |
| formula throws, unknown `$.x`, writes from a formula, returns a Promise | `runtime` (`link` for resolve failures) | no | `rt.errors` `cell:<id>`; value `undefined` |
| cycle | `link` | no | `rt.errors` on the outermost member |
| state step throws in the probe | `runtime` | no | `rt.errors` `step:<id>` |

[run E02-8, E02-9, E02-3]

## 6. The IR

`Runtime.ir()` (`src/spore.js:648-687`) returns plain JSON. It has side effects: it computes any dirty formula first, swallowing exceptions (`src/spore.js:651`).

### 6.1 Top level

| Field | Type | Meaning | Cite |
|---|---|---|---|
| `spore` | `1` | format version | `src/spore.js:677` |
| `stages` | `["build","link","run"]` | constant | `src/spore.js:678` |
| `apps` | `AppIR[]` | declaration order | `src/spore.js:669-675` |
| `components` | `{ name, line }[]` | registered components | `src/spore.js:680` |
| `nodes` | `NodeIR[]` | `$clock`, then cells in app/declaration order, then `$pointer` (if read), then desk nodes, then one view node per app | `src/spore.js:649-673` |
| `edges` | `{ from, to }[]` | from what is read to what reads it | `src/spore.js:659`, `673` |
| `order` | `string[]` | Kahn order of `nodes` (incomplete under cycles, B2) | `src/spore.js:683`, `688-694` |
| `clock` | `{ t, frame }` | `t` rounded to 1 ms | `src/spore.js:684`, `722` |
| `errors` | `{ kind, message, line, where, hint }[]` | `rt.errors` without the key | `src/spore.js:685` |

The host's `Program.ir()` adds `source` (`"the CC5 cell <path>"` or the program key), and after a failed rebuild `buildError` and `note: "The program does not build. This IR is from the last version that did."`; with no runtime yet it returns `{ spore: 1, apps: [], nodes: [], edges: [], errors: [], source }` without `stages`, `order`, `clock` or `components` (`src/spore.js:2194-2199`) [run E04, E08].

### 6.2 `apps[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `title`, `w`, `line` | string, string, number, number | `title` defaults to `id`, `w` to 260 |
| `cells` | string[] | own cell names, declaration order |
| `exports` | string[] | |
| `actions` | `{ name, line, fn }[]` | `fn` is the source text, whitespace collapsed (`src/spore.js:67`) |
| `view` | `ViewIR[]` | |

(`src/spore.js:674`)

### 6.3 `view[]` (`viewIR`, `src/spore.js:696-709`)

| Field | Present when | Value |
|---|---|---|
| `k` | always | node kind |
| `line` | always | |
| `component` | `group` | component name |
| `text` | `h`/`text`/`note` | string, or `{ fn: source }` |
| `label` | has a label | string, or `{ fn }` |
| `of` | data slot | the **resolved** id (`"trip.total"`), or `{ fn }` |
| `cell` | `toggle`/`stepper` | resolved id |
| `action` | `button` | action name, or `{ fn }` |
| `when` | `when` | `{ fn }` (the condition) |
| `height`, `paint` | `draw` | number, `{ fn }` |
| `opts` | non-empty opts | `plain(opts)` |
| `children` | `row`/`when`/`group` | `ViewIR[]` |

### 6.4 `nodes[]` by kind

| Kind | Fields | Cite |
|---|---|---|
| `clock` | `id: "$clock"`, `kind`, `note` | `src/spore.js:649` |
| `value` | `id`, `app`, `name`, `kind`, `line`, `value` | `src/spore.js:652` |
| `param` | as value, plus `control` (section 4.2) | `src/spore.js:655` |
| `formula` | as value, plus `fn`, `reads`, `ticks` (= reads include `$clock`), `error` (message) when failing | `src/spore.js:653`, `656-657` |
| `state` | as value, plus `init`, `step`, `reads`, `ticks: true`; never `error` (only formulas set `c.error`, `src/spore.js:522`) [run E08] | `src/spore.js:654-656` |
| `pointer` | `id: "$pointer"`, `kind`, `note`; only if some cell or view read it | `src/spore.js:661-664` |
| `desk` | `id: "desk:<path>"`, `kind`, `path`, `value` (read through the bridge, or null) | `src/spore.js:665-668` |
| `view` | `id: "<app>.view"`, `app`, `kind`, `reads`, `ticks` | `src/spore.js:671-673` |

### 6.5 Value serialisation (`plain`, `src/spore.js:68-77`)

`undefined` → `null`; non-finite numbers → `"NaN"`/`"Infinity"`; `Date` → ISO string; function → `{ fn: source }`; arrays over 50 → first 50 plus `"… N more"`; objects → first 50 keys, silently; depth over 4 → `"…"` [run E05].

### 6.6 A real IR

Produced by `e10-ir-compact.js` [run E10]: this program, built and linked, painted once (so view reads exist) and ticked once by 0.5 s.

```js
app("trip", { title: "Trip" })
  .param("nights", 4, { min: 1, max: 14 })
  .cell("rate", 120)
  .cell("stay", $ => $.nights * $.rate)
  .cell("total", $ => $.stay + $.food.total)
  .state("days", 0, ($, d) => d + $.dt)
  .action("more", $ => $.inc("nights"))
  .view(v => v
    .stat("total", "Total", { unit: "€" })
    .row(r => r.stat("stay", "Stay").stat("food.total", "Food"))
    .button("One more night", "more")
    .when($ => $.nights > 5, w => w.note($ => `${$.nights} nights`)))

app("food")
  .param("perDay", 45, { min: 10, max: 150 })
  .cell("total", $ => $.perDay * $.trip.nights)
  .view(v => v.stat("total"))
```

```json
{
  "spore": 1,
  "stages": ["build","link","run"],
  "apps": [
    {"id":"trip","title":"Trip","w":260,"line":1,"cells":["nights","rate","stay","total","days"],"exports":[],"actions":[{"name":"more","line":7,"fn":"$ => $.inc(\"nights\")"}],"view":[{"k":"stat","line":9,"label":"Total","of":"trip.total","opts":{"unit":"€"}},{"k":"row","line":10,"children":[{"k":"stat","line":10,"label":"Stay","of":"trip.stay"},{"k":"stat","line":10,"label":"Food","of":"food.total"}]},{"k":"button","line":11,"label":"One more night","action":"more"},{"k":"when","line":12,"when":{"fn":"$ => $.nights > 5"},"children":[{"k":"note","line":12,"text":{"fn":"$ => `${$.nights} nights`"}}]}]},
    {"id":"food","title":"food","w":260,"line":14,"cells":["perDay","total"],"exports":[],"actions":[],"view":[{"k":"stat","line":17,"of":"food.total"}]}
  ],
  "components": [],
  "nodes": [
    {"id":"$clock","kind":"clock","note":"time: $.t, $.dt, $.now, $.frame"},
    {"id":"trip.nights","app":"trip","name":"nights","kind":"param","line":2,"value":4,"control":{"type":"range","min":1,"max":14,"step":1,"label":"nights","unit":""}},
    {"id":"trip.rate","app":"trip","name":"rate","kind":"value","line":3,"value":120},
    {"id":"trip.stay","app":"trip","name":"stay","kind":"formula","line":4,"value":480,"fn":"$ => $.nights * $.rate","reads":["trip.nights","trip.rate"],"ticks":false},
    {"id":"trip.total","app":"trip","name":"total","kind":"formula","line":5,"value":660,"fn":"$ => $.stay + $.food.total","reads":["trip.stay","food.total"],"ticks":false},
    {"id":"trip.days","app":"trip","name":"days","kind":"state","line":6,"value":0.5,"init":0,"step":"($, d) => d + $.dt","reads":["$clock"],"ticks":true},
    {"id":"food.perDay","app":"food","name":"perDay","kind":"param","line":15,"value":45,"control":{"type":"range","min":10,"max":150,"step":1,"label":"perDay","unit":""}},
    {"id":"food.total","app":"food","name":"total","kind":"formula","line":16,"value":180,"fn":"$ => $.perDay * $.trip.nights","reads":["food.perDay","trip.nights"],"ticks":false},
    {"id":"trip.view","app":"trip","kind":"view","reads":["trip.total","trip.stay","food.total","trip.nights"],"ticks":false},
    {"id":"food.view","app":"food","kind":"view","reads":["food.total"],"ticks":false}
  ],
  "edges": [
    {"from":"trip.nights","to":"trip.stay"},
    {"from":"trip.rate","to":"trip.stay"},
    {"from":"trip.stay","to":"trip.total"},
    {"from":"food.total","to":"trip.total"},
    {"from":"$clock","to":"trip.days"},
    {"from":"food.perDay","to":"food.total"},
    {"from":"trip.nights","to":"food.total"},
    {"from":"trip.total","to":"trip.view"},
    {"from":"trip.stay","to":"trip.view"},
    {"from":"food.total","to":"trip.view"},
    {"from":"trip.nights","to":"trip.view"},
    {"from":"food.total","to":"food.view"}
  ],
  "order": ["$clock","trip.nights","trip.rate","food.perDay","trip.days","trip.stay","food.total","trip.total","food.view","trip.view"],
  "clock": {"t":0.5,"frame":1},
  "errors": []
}
```

Things to notice, all [run]: `trip.view` reads `trip.nights` through the `when` condition even though the branch is hidden (`nights` is 4); before the paint both view nodes had `reads: []` and `order` placed them right after the sources (E01); the two apps read each other without a cell cycle (`src/index.html:1347`); the textbook's illustrative IR (`src/index.html:1478-1492`) is a simplification of this shape (it omits `app`, `name`, `value`, `w`, `step`, `label`, `unit`).

## 7. RUN

### 7.1 Who owns which value

| Kind | Changes when | Writable by | Cite |
|---|---|---|---|
| value | written | actions, `toggle`/`stepper` clicks, `rt.write` | `src/spore.js:556-572`, `1426`, `1439` |
| param | written (coerced) | as value, plus the Params panel and `setParam` | `src/spore.js:566`, `573-578`, `1956` |
| state | every tick by its step; also writable | as value | `src/spore.js:590-603` |
| formula | recomputed on read when dirty | nobody: writing one is a runtime error | `src/spore.js:565` |

"Actions are the only code that writes" (`src/index.html:1293`) is true of program code; the built-in controls write directly (`src/spore.js:1426`, `1439`, `2260`).

### 7.2 Reads: lazy pull, memoised

`read` returns the stored value, computing a dirty formula first (`src/spore.js:502-507`). A formula's value stays memoised until it is marked dirty. There is no value-based early cut-off: when a formula recomputes to an equal value, its dependents are still dirty, because dirtiness was propagated at write time (`src/spore.js:542-553`) [read].

### 7.3 Writes and invalidation: push dirty, pull values

`write(appId, path, v)` (`src/spore.js:556-572`): `desk.` paths go to the bridge (7.9); otherwise resolve, refuse formulas, coerce params, return early if `same(old, v)`, store `v` **as is** (no clone), `invalidate(id)`, `version++`, emit `{ type: "change", id, kind, value }`.

`invalidate(id)` is a breadth-first walk over `rdeps` that marks formula readers dirty and continues through them; non-formula readers (states) are skipped and not traversed (`src/spore.js:542-553`). Nothing computes during invalidation.

Observed on a diamond `a → b, a → c, (b, c) → d` [run E02-1]: after a write nothing recomputes; reading `d` recomputes `b`, `c`, `d` once each; an action doing three writes followed by one read also recomputes each once.

### 7.4 Equality and aliasing

`same(a, b)` is `Object.is`, or `JSON.stringify(a) === JSON.stringify(b)` for two objects (`src/spore.js:716-720`): key-order sensitive, blind to functions and `undefined` members, and O(size) on every write and on every state every tick. Values are stored and handed out by reference, so in-place mutation defeats change detection:

- an action that mutates `$.tasks` and sets it back is a no-op: no invalidation, no event, `count` stays stale [run E02-7] (`$.push` is safe because it builds a new array, `src/spore.js:418`);
- a state step that mutates `prev` and returns it never changes: `tick` passes the live value (`src/spore.js:597`) and compares by identity (`src/spore.js:601`), while LINK's probe passes a clone (`src/spore.js:538`) [run E02-6]. See B3.

### 7.5 Glitch-freedom

Within one synchronous call the runtime is glitch-free: invalidation marks every transitive formula dirty before anything can read, and reads recompute on demand from current inputs, so no reader sees a mix of old and new values [run E02-1]. Writes inside an action apply at once, so later lines see the new values (`src/index.html:1325`) [run E08]; renderers only paint in the animation frame (10.3), so an action's intermediate states are never painted, but every write emits its own `change` event (`src/spore.js:571`).

### 7.6 Time: ticks, two-phase steps, `ticking()`, `reset()`

`tick(dt)` (`src/spore.js:590-603`):

1. advance the clock (`dt`, `t += dt`, `frame++`, `now = Date.now()`) and `invalidate("$clock")`;
2. for every state: run `step($, value)` with a tracking scope, collect `[cell, next]`, `setDeps` (a throwing step keeps its value and records `step:<id>`) [run E02-18];
3. commit: for every changed state set the value, invalidate, emit a `quiet` change; then `version++`.

Phase 2 reads only pre-tick state values (formulas over states are memoised from the old values and re-dirtied in phase 3), so declaration order does not matter (`src/index.html:1429`) [run E02-2: two states that swap values do swap].

`ticking()` is true when any state exists, any cell's deps include `$clock`, or any app's view reads include `$clock` (`src/spore.js:605-609`) [run E02-17a]. Because view reads are sticky, a view that once read the clock in a now-hidden branch keeps the program ticking [run E02-5].

`reset()` puts states back to `clone(init)`, zeroes the clock and marks every formula dirty; values, params, pointers, errors and view reads are untouched (`src/spore.js:610-617`) [run E02-17b].

### 7.7 Params

`setParam(id, v)` checks the cell is a param and writes it (`src/spore.js:573-578`). `coerce` (`src/spore.js:710-715`): range → `Number(v)` (non-finite throws), **not clamped** to `min`/`max` [run E02-12: 99 accepted for max 10]; checkbox → `v === true || v === "true" || v === 1`, anything else is `false`; select → must be an option; text → `String(v)`.

### 7.8 The pointer

The Stage reports the pointer over a `draw()` element as `{ x, y, w, h, over, down }` in that element's pixels (`src/spore.js:1705-1712`); `setPointer` stores a frozen copy, skips unchanged positions, invalidates `$pointer`, bumps `version` (`src/spore.js:488-494`) [run E02-19]. There is one pointer per app, not per element.

### 7.9 Desk reads and writes

With a bridge (10.5), `$.desk.app.cell` checks the path exists, tracks `desk:app.cell`, creates an empty `rdeps` entry for it, and returns `bridge.read(path)` (`src/spore.js:455-476`). `syncDesk()` compares `bridge.version()` with the last seen version and, on change, invalidates the readers of every `desk:` id and bumps `version` (`src/spore.js:478-486`); the frame loop calls it every frame (`src/spore.js:2237`). Until then a desk read is stale [run E04: after an action wrote `trip.nights`, `words.nights` stayed 4 until `syncDesk`].

`$.set("desk.app.cell", v)` validates the path shape and calls `bridge.write(path, v)` (`src/spore.js:557-562`).

### 7.10 Live coding: `carry(old)`

After a rebuild the host calls `rt.carry(oldRt)` (`src/spore.js:2177-2178`). `carry` copies the clock and pointers, then, for each non-formula cell present in both with the same kind and the same declared default (`def`), and for params also the same control, copies the old value and invalidates (`src/spore.js:357-369`) [run E02-13: kept a param whose default did not change, reset one whose default changed, kept a state's value and the clock]. Changing a param's `min`/`max`/`step`/`label` also resets it (`src/spore.js:365`) [read]; the textbook mentions only the default (`src/index.html:1289`, `1557`).

### 7.11 Run-time errors

`fail(key, e, ctx)` records `{ key, kind, message, line, where, hint }`, prefixing non-`Error` names (`TypeError: …`), and emits `errors` only when the message for that key changed (`src/spore.js:632-644`); `clearError(key)` removes it on the next success (`src/spore.js:645`).

| Key | Site | Cleared when |
|---|---|---|
| `cell:<id>` | formula compute | the formula next computes without throwing |
| `step:<id>` | probe and every tick | the step next succeeds |
| `act:<app>.<name>` / `act:<app>.lambda` | `act` (`src/spore.js:585-586`) | that action next succeeds; **all anonymous button lambdas of an app share `act:<app>.lambda`** [run E02-11, E07] |
| `view:<app>.<i>.<j>…` (+`l` for a stat label) | `paintApp` slots, `draw`, `when` (`src/spore.js:1278-1279`, `1399-1400`, `1459-1460`) | that element next paints successfully; an element hidden by `when` keeps its error [run E07] |

`list`'s `text` lambda errors are drawn inline as `⚠ …` and never recorded (`src/spore.js:1377`) [run E07]. A failing formula's value is `undefined`; dependents keep running on it [run E02-8b].

### 7.12 Events

`rt.on(fn)` subscribes to `{ type: "change", id, kind, value, quiet? }` and `{ type: "errors" }` (`src/spore.js:354`, `370`, `571`, `601`, `642`). The host re-emits them per program and through `window.spore.on` (`src/spore.js:2179`, `2658-2660`).

## 8. Views and painting as they relate to the DAG

### 8.1 `paintApp`: where view edges come from

`paintApp(ctx, T, rt, appId, x, y, w, st, drawing)` walks the app's view tree, measuring and drawing in one pass, and returns the height (`src/spore.js:1272-1479`). One `track` set is shared by every reader in the app's view; at the end `rt.noteViewReads(appId, track)` adds it to `viewReads` (`src/spore.js:1274`, `1477`). Slots are evaluated through `rt.evalSlot` (`src/spore.js:620-625`): a literal returns its value, a resolved ref reads with tracking, a lambda runs on a tracking `$`. `when` evaluates its condition every paint and paints its children only when true (`src/spore.js:1457-1462`). Both callers pass `drawing = true` (`src/spore.js:1619`, `1641`); the measure-only path is unused.

| Element | Reads | Writes on click | Cite |
|---|---|---|---|
| `h`/`text`/`note` | text slot | | `src/spore.js:1291-1297` |
| `stat` | `of`, label | | `src/spore.js:1298-1311` |
| `meter` | `of` | | `src/spore.js:1312-1322` |
| `spark` | `of`; history is kept in the Stage's per-app `st.sparks`, sampled at most every 60 ms while painting, up to `opts.n` (160) | | `src/spore.js:1323-1347` |
| `bars` | `of` (array, object, or `[{ label, value }]`) | | `src/spore.js:1348-1371` |
| `list` | `of`; `opts.text(item)` untracked | | `src/spore.js:1372-1394` |
| `draw` | anything its `(g, $)` reads | | `src/spore.js:1395-1405` |
| `button` | label | `rt.act(app, action)` | `src/spore.js:1406-1418` |
| `toggle` | `cellId` | `rt.write(app, cell, !on)` | `src/spore.js:1419-1429` |
| `stepper` | `cellId` | `rt.write` of `v ± step`, clamped to `opts.min/max` only, rounded to 1e-6 | `src/spore.js:1430-1446` |
| `divider`, `row`, `when`, `group` | `when`'s condition | | `src/spore.js:1447-1463` |

Consequences: view edges are paint-time facts (missing before the first paint, a union afterwards); spark history is a property of a view, not of the program (two views of one program keep two histories; Reset in the studio clears them, `src/spore.js:2327`).

### 8.2 The `g` drawing API

`makeG(ctx, T, x, y, w, h)` (`src/spore.js:1239-1268`): `w`, `h`, `map(v, a, b, c, d)`, `clear(color)`, `line`, `rect`, `circle`, `path(points, { close })`, `poly`, `text(s, x, y, { size, color, align, baseline, bold, alpha })`, each returning `g`. Options `fill`, `stroke`, `width` (1.5), `alpha`, `dash`; a colour is a theme token name or any CSS colour (`src/spore.js:1188`). `draw` paints clip and translate to the element (`src/spore.js:1398`).

### 8.3 The Stage

One `Stage` draws a program as a desk of windows, one app without chrome, or the graph (`src/spore.js:1498-1749`). Relevant to the DAG:

- **Wires** between apps come from formula/state deps and view reads, excluding `$…` and `desk:` ids, labelled with the cell names (`src/spore.js:1531-1538`). A non-quiet `change` event sends a pulse along every wire leaving the changed app; state changes are quiet and send none (`src/spore.js:1519-1524`).
- **Graph mode** builds its own node/edge set from `rt.cells[*].deps` and `rt.viewReads`, layers nodes by longest path from sources (cycle-safe), sorts each column by id, and caches per `rt.version` (`src/spore.js:1646-1669`). Clicking a node calls `onLine(line)` (`src/spore.js:1719`).
- **Layout** uses the height measured on the previous frame; a height change sets `need` and repaints (`src/spore.js:1621`, `1642`).

## 9. The studio (`spore_ide`), as far as it exposes the DAG

| Surface | What it shows | Cite |
|---|---|---|
| Preview → Desk / Graph / IR | the Stage in desk or graph mode; or `JSON.stringify(prog.ir(), null, 2)`, refreshed every second, with Copy JSON | `src/spore.js:2324`, `2437-2447`, `2493` |
| Graph node click | jumps the editor to the node's line | `src/spore.js:2338`, `1719` |
| Errors panel and gutter | `prog.errors()` (build error first, then runtime errors), lines marked in the editor | `src/spore.js:2461-2473`, `2188-2193` |
| Status line | `N apps · N cells · running per frame / runs on change` from `ticking()` | `src/spore.js:2472` |
| Pause / Step / Reset | `prog.playing`; `rt.tick(1/30)`; `rt.reset()` and clear spark history | `src/spore.js:2325-2327` |
| Agent | sends the textbook, the program, its errors and a per-app summary of cell kinds and values; loads the last fenced js block and re-asks up to twice when errors remain | `src/spore.js:2519-2568`, `2093-2097` |

## 10. Host integration

### 10.1 Load order and globals

`index.html` loads `hypha.js`, `fruit.js`, `fruit-kit.js`, `browser.js`, `computer.js`, `lego.js`, `spore.js`, `blocks-kit.js`, `blocks.js` in that order, then the textbook script (`src/index.html:1125-1136`). `spore.js` exports `window.Spore` (the core), `window.spore` (the API) and `window.CC5Spore = { init, prompt, create, mount, docs, reference, presets }` (`src/spore.js:2684-2686`). At load it hooks Fruit if present (`src/spore.js:2607-2614`). Blocks boots and calls `CC5Spore.init(Host)` (`src/blocks.js:2374`), then aliases `window.blocks.spore = window.spore` (`src/blocks.js:2378`).

### 10.2 Programs

A `Program` holds one program text and its runtime, shared by every view of the same key (`src/spore.js:2146-2222`):

- `sync(code)`: the code changed outside (the tree, the API); ignored while a local write is pending; first sync rebuilds at once, later ones after 240 ms (`src/spore.js:2156-2161`).
- `edit(code, { now, by })`: the code changed here; writes it back to the CC5 cell after 450 ms (0 ms with `now`) when a writer exists; rebuilds now or after 320 ms if Auto is on (`src/spore.js:2163-2171`).
- `rebuild()`: `Spore.load(code, { bridge })`, `carry(old)`, subscribe, drop the old runtime's listeners; on failure keep the old runtime and set `buildError` (`src/spore.js:2173-2187`) [run E04].
- `errors()`: build error first, then the current runtime's errors, including the stale runtime's after a failed build (`src/spore.js:2188-2193`) [run E04].
- `exportTick(now)`: section 10.5.

The key is the code cell's path inside CC5 (`src/spore.js:2597`; `src/index.html:1593`), `"inline:" + node` for an inline program, or `"page:" + id` for `mount` (`src/spore.js:2585`). The first program created becomes the active one (`src/spore.js:2220`); interacting with a studio makes it active (`src/spore.js:2368`).

### 10.3 The frame loop

`Loop` runs one `requestAnimationFrame` for all views (`src/spore.js:2225-2244`). Each frame: `dt = min(0.1, (now - last) / 1000)` (first frame 1/60); views whose root is disconnected for 30 s are disposed; for each program with a live view: `syncDesk()`, `tick(dt)` if `playing && ticking()`, `exportTick(now)`; then every live view's `frame(now)`. It re-arms while any view is registered, live or not (`src/spore.js:2242`). [run E04: three frames at 1000/1016/3016 ms advanced a `$.dt` integrator by 1/60 + 0.016 + 0.1; paused, the state stopped and the view kept framing.]

A view repaints when its stage needs it, the program ticks, `rt.version` changed, a wire pulse is running, or a second passed (`src/spore.js:2267`, `2494`).

### 10.4 The CC5 elements `spore` and `spore_ide`

`hookFruit` registers `F.R.spore` and `F.R.spore_ide` and declares `of` as their positional prop (`H.POS.spore = ["of"]`) (`src/spore.js:2607-2613`). `element(K, p, env, ide)` (`src/spore.js:2594-2606`):

- binds `of` with `F.bind` (`src/fruit.js:160-175`): a reference to a literal cell gives a path and `can: true`;
- program key = that path, else `"inline:" + p`; a writer is installed when the path is writable and the env is not read-only (`F.write` → `env.write("path = <lit>")`, `src/fruit.js:310`);
- props `app` (show one app, chrome-less), `h` (canvas or studio height, studio default 640), `params` (`false` hides the controls) via `F.prop` (`src/spore.js:2601`, `2604`);
- the view object is cached per element path, so re-renders reuse it (`src/spore.js:2576-2583`).

The textbook's syntax: `spore code`, `spore code, app: "garden"`, `spore code, h: 480`, `spore code, params: false`, `spore_ide code` (`src/index.html:1531-1537`). Blocks offers a "Spore app" slash item that writes a code cell from the first preset and a `spore <cell>` block (`src/blocks.js:1411`).

### 10.5 The desk bridge and `export()`

`Bridge.get()` wraps CC5's host `X` (`src/spore.js:2128-2141`):

| Bridge call | Implementation |
|---|---|
| `exists(p)` | `K.exists(p)` |
| `apps()` | top-level branches, minus `desk sys clock spaces theme fn lib` (`src/spore.js:2117`) |
| `children(a)` | `K.children(a)` minus `ui` |
| `read(p)` | `clean(K.valueAt(p))`: Hypha residuals and errors become `undefined` (`src/spore.js:2121-2127`) |
| `version()` | `K.log.length + ":" + Math.floor(Date.now() / 1000)`: changes on every op **and every wall-clock second** |
| `write(p, v)` | `X.writeText("p = <showLit(v)>")`, i.e. as the person (Blocks refuses in read-only workspaces, `src/blocks.js:103-104`) |

`exportTick(now)` (`src/spore.js:2201-2216`): at most every 2 s, not when read-only or viewing the past, for each export compute the value (numbers to 6 significant digits; skip `undefined` and objects over 4,000 JSON chars), skip unchanged literals, and write `<host>.out.<sporeApp>.<cell> = <lit>` lines with `X.write(lines, "spore")`, where `<host>` is the first segment of the program's path (`src/spore.js:2148`). In Blocks that writes as the peer `<user>:spore` (`src/blocks.js:786`, `801`). [run E04 with a real Hypha kernel: `lab.out.words = { total, nights }` written; a second export 1 s later was throttled; 2.5 s later it went through.]

### 10.6 `window.spore`

`API` (`src/spore.js:2637-2657`); every call takes an optional program key, defaulting to the active program (`src/spore.js:2636`).

| Call | Does | Notes |
|---|---|---|
| `load(code, key?)` | puts `code` in that program's editors, `edit(code, { now: true })`; returns `{ ok, errors }` | `ok` is false for any error, runtime ones included [run E04] |
| `run(key?)` | `rebuild()` | |
| `getIR(key?)` | `Program.ir()` | |
| `setParam(id, v, key?)` | `rt.setParam`; returns the stored value | [run E04] |
| `get(id, key?)` | `rt.read(id, null)` | throws for unknown ids |
| `act("app.action", key?)` | `rt.act(app, name)`; returns `errors()` | action errors are recorded, not thrown |
| `errors`, `play(on)`, `code`, `programs()`, `use(key)`, `active()`, `full(on)`, `create(name, code, opts)`, `presets()`, `docs()`, `reference()`, `mount(target, opts)`, `on(type, fn)` | as named | `on` relays program events `code`, `run`, `errors`, `change` with `key` added (`src/spore.js:2658-2660`) |

`init(host)` also sets `window.cc5.spore = API` if `window.cc5` exists (`src/spore.js:2666`); Blocks has no `window.cc5` (only `spore.js:2666` mentions it), so there the alias is `window.blocks.spore`.

### 10.7 What the in-page Claude is told

`CC5Spore.prompt()` is a paragraph on Spore plus the textbook from "## 16. Reference" on (`src/spore.js:2670-2672`, `2573`). Blocks inserts it into its agent prompt after two replaces, one of which turns every `desk` into `workspace` (`src/blocks.js:331`), so the model is taught `$.workspace.<app>.<cell>` and `$.set("workspace.…")`, which Spore does not have [run E09 for the text; B6].

### 10.8 Trust boundary

Programs run in the page's own realm via `new Function` (`src/spore.js:305`): no sandbox (by design, `src/spore.js:28`). On slop this means a Spore program in a workspace runs with whatever the Blocks page can do; SLOP-008's guide records this as an accepted risk because only admins write workspaces (`ttmp/2026/10/29/SLOP-008--…/design-doc/01-intern-guide-claude-blocks-on-slop.md:799`).

## 11. Implementation guide

### 11.1 Ground rule: this is an upstream file

`src/` is Ramon Marc's export copied unchanged; `build.sh` refuses to build when any file's checksum differs from `SHA256SUMS` (`build.sh:8`, `README.md:11-12`). A change to `spore.js` here is a fork: update `SHA256SUMS` in the same commit and say so, or send it upstream. Prefer slop-side additions in `apps/upstream/blocks/slop/` (loaded after `blocks.js`, `build.sh:10-12`, `README.md:13`) when a change can be made from outside through `window.Spore`/`window.spore`.

### 11.2 Add a view element (corrects `src/index.html:1617-1623`)

1. Add a method to `View` (`src/spore.js:118-185`) that calls `callerLine()` first, validates with `need`, records with `this._add(k, { … }, line)` using `data()`/`text()` for slots, and returns `this`.
2. If it takes a cell or action **name** in a field other than `of`, resolve it in `link()`'s `walk` (`src/spore.js:389-401`) and store the resolved id; `of` is resolved generically (`src/spore.js:391`).
3. Add a `case` to `paintApp` (`src/spore.js:1290-1464`) that evaluates slots through `slot()`/`rt.evalSlot` with the shared `track` (so its reads become view edges), records errors under `view:<key>`, draws only when `drawing`, registers hit areas with `hit()`, and returns its height.
4. Serialise new fields in `viewIR` (`src/spore.js:696-709`) as plain JSON (`plain`, `src`).
5. Add the name to `BUILDER_METHODS` (did-you-mean, component clash), to `KINDS` (documentation only), and to the highlighter's `GRAMMAR` (`src/spore.js:1779`).
6. Document it in the textbook chapter 3 and the reference (`src/index.html:1230-1246`, `1644-1645`).

### 11.3 Add an App builder or a cell kind

A new builder that makes an existing kind is a method on `App` that calls `this._def(name, spec, line)` (`src/spore.js:209-217`). A new **kind** touches, in order: the `_def` spec; the runtime cell record (`src/spore.js:348-349`: initial `value`/`def`/`dirty`); `write()` (is it writable? coerced?, `src/spore.js:565-566`); `tick()` if it changes with time (`src/spore.js:594-601`); `ticking()` (`src/spore.js:605-609`); `carry()` (what survives an edit, `src/spore.js:361-367`); `reset()`; `ir()` node fields (`src/spore.js:652-657`); the Graph's colour table (`src/spore.js:1674`); the textbook's kinds table (`src/index.html:1174-1179`).

### 11.4 Add a pass or a check

- **Static checks** (names, shapes) belong in `link()`'s walk, before formulas run, and throw `SporeError(msg, { kind: "link", line, where })` (`src/spore.js:387-404`). They are fatal: the host keeps the last good program.
- **Graph checks** (over real edges) belong after the formula loop and the state probe (`src/spore.js:405-406`), where `c.deps` is populated. Report them as non-fatal with `this.fail("<prefix>:<id>", err, { where, line, kind })` so they show in the error list and clear with `clearError` when fixed.
- **IR passes** (ordering, layering, annotations) belong in `ir()`/`order()` and must stay side-effect free on runtime state. A correct `order` should drop edges into `state` nodes, which are previous-tick edges (B2).
- Remember that view edges do not exist until the first paint; a pass that needs them must run after a frame or paint once itself.

### 11.5 Add a builtin

- **Program global** (like `range`): add a parameter to the `new Function` list and the argument to the call (`src/spore.js:305`, `307`), the helper (`src/spore.js:293-297`), the highlighter's `DSL` set (`src/spore.js:1778`), and the textbook reference (`src/index.html:1627`).
- **Scope member** (like `$.get`): add it to `api` in `scope()` (`src/spore.js:415-421`), add its name to `RESERVED` (`src/spore.js:33`) so no cell can shadow it, track any read it performs (`track.add(id)`), deny it outside actions if it writes (`deny`, `src/spore.js:414`), and add it to the reference (`src/index.html:1642`).

### 11.6 Invariants a change must keep

1. Every runtime read goes through `rt.read(id, track)` or adds its id to `track` explicitly (`src/spore.js:427`, `430`, `468`); otherwise the DAG misses an edge and the value goes stale.
2. Every value change goes through `write()` or does its three steps: store, `invalidate(id)`, `version++` (+ `emit`) (`src/spore.js:568-571`). Renderers repaint on `version` (`src/spore.js:2267`).
3. Invalidation only marks; computation only happens on read (`src/spore.js:542-553`, `502-507`). Do not compute eagerly inside `invalidate`.
4. `setDeps` replaces a reader's dependencies and prunes reverse edges (`src/spore.js:529-535`); dynamic dependencies depend on it.
5. Only actions get a writing `$` (`src/spore.js:413`); formulas, steps and view readers get `mode: "read"`.
6. A tick computes every next state before committing any (`src/spore.js:593-601`).
7. The IR is plain JSON: lambdas as `src(fn)`, values through `plain()` (`src/spore.js:67-77`).
8. Errors are keyed per site and cleared on that site's next success (`src/spore.js:632-645`).
9. Builder methods call `callerLine()` in their own body so lines point at the program (`src/spore.js:53`).

### 11.7 How to test

There is no Spore test in the repo: `test/live.js` is a Playwright end-to-end test of Blocks against a running slop server and never touches Spore (`test/live.js:1-7`). What works today, without a browser:

- the node harness of section 13 (`load.js`) loads `spore.js` and `hypha.js` as they are, exposes the private sections in memory, paints with a no-op 2D context and drives a manual `requestAnimationFrame`;
- `e05-presets.js` is a smoke test: every preset builds, links, paints, ticks 30 times, with zero errors [run E05];
- `e02-run.js` is a battery of 20 labelled semantic probes (laziness, two-phase ticks, cycles, dynamic deps, sticky view reads, aliasing, errors, desk writes, coercion, carry).

A browser check (canvas, Fruit mounting, the Studio) needs the Blocks page; on slop that is the staging host.

## 12. Known gaps, bugs, sharp edges and doc/code mismatches

"Wrong side" says which of textbook or code should change, in this draft's judgement.

### 12.1 Bugs

| # | Finding | Evidence | Wrong side |
|---|---|---|---|
| B1 | `$.push`, `$.toggle`, `$.inc` reject `desk.` paths (they `resolve` first and fail with "there is no app \"desk\"", kind `link`); only `$.set` writes the desk. The reference says all writers take `"desk.app.cell"` | `src/spore.js:418-420` vs `557`; `src/index.html:1642`; [run E02-11] | code (or narrow the reference) |
| B2 | `ir().order` silently drops every node on or downstream of a cycle, and state↔state reads (legal, two-phase) count as cycles: the `wild` preset orders 7 of 14 nodes, `home` 19 of 27, a two-state swap orders only `$clock`. Views are dropped too, against "sources first, views last" | `src/spore.js:656`, `688-694`; `src/index.html:1497`; [run E05, E06] | code: exclude edges into states from the sort, and report leftover nodes |
| B3 | A state step that mutates `prev` and returns it never registers a change (live value passed in, identity compare); LINK's probe passes a clone, so the probe and the tick disagree | `src/spore.js:597`, `601` vs `538`; [run E02-6] | code (pass `clone(c.value)`), or document "return a new value" |
| B4 | A syntax error reported as "missing ) after argument list" always gets the program's **last** line, because that message is in the `endish` skip list | `src/spore.js:319-324`; [run E03: error on line 2 of 6 reported as line 6] | code |
| B5 | `$.get("a.b.c")` / `$.set("a.b.c", …)` with three or more segments pass `resolve` unvalidated and crash with `TypeError: Cannot read properties of undefined (reading 'kind')` | `src/spore.js:380-383`, `416`, `563-564`; [run E02-16] | code |
| B6 | Blocks rewrites "desk" to "workspace" in the Spore prompt, so its in-page Claude is taught `$.workspace…` and `$.set("workspace.…")`, which do not exist (already listed as an upstream defect in SLOP-008 §12.3) | `src/blocks.js:331` vs `src/spore.js:429`, `557`; [run E09, text only] | code (blocks.js) |
| B7 | All anonymous button lambdas of one app share the error key `act:<app>.lambda`: one lambda's failure overwrites another's, and any lambda's success clears both | `src/spore.js:585-586`; [run E02-11, E07] | code |

### 12.2 Sharp edges

| # | Finding | Evidence |
|---|---|---|
| S1 | View edges are a union over all paints, never pruned: a `when` branch that once read `$.t` keeps the program ticking and keeps the edge in the IR | `src/spore.js:626-629`, `605-608`; [run E02-5] |
| S2 | View edges do not exist before the first paint; the IR then shows `reads: []` and orders views right after sources | `src/spore.js:1477`; [run E01] |
| S3 | `$.set` of a mutated alias of the stored array/object is a no-op (no invalidation, no event) | `src/spore.js:567-568`; [run E02-7] |
| S4 | Only the outermost member of a formula cycle carries the error; the others compute on `undefined` silently. Cycles can appear at run time after a write, reported with kind `link` | `src/spore.js:509-524`; [run E02-3, E02-20] |
| S5 | Builders are not sealed after BUILD: a runtime lambda that calls a captured app's `.view()`/`.action()` adds unlinked nodes to the live runtime (shared arrays), and painting them throws an uncaught `TypeError` | `src/spore.js:345`, `264-271`, `277` (only `app()` guarded); [run E02-14] |
| S6 | Range params are never clamped: `setParam`, `$.set` accept any number; the stepper clamps only to its own `opts` | `src/spore.js:711`, `1439`; [run E02-12] |
| S7 | A number param's default step is `(max - min) / 100` unless the range is integral and at least 10 wide: `param("b", 3)` slides in steps of 0.06 | `src/spore.js:235`; [run E02-12b] |
| S8 | Errors of view elements hidden by `when` persist until the element paints again; `list` text-lambda errors are never recorded | `src/spore.js:1278-1279`, `1459-1461`, `1377`; [run E07] |
| S9 | Resolution failures at run time carry kind `link`: "link" names the class of error (a name did not resolve, or a cycle), not the stage | `src/spore.js:378-382`, `512`; [run E02-11, E02-20] |
| S10 | `bridge.version()` includes wall-clock seconds, so every desk-reading formula recomputes, and its views repaint, at least once a second with no desk ops | `src/spore.js:2137`, `478-486` [read] |
| S11 | No early cut-off: an equal recomputed value still recomputes all dependents | `src/spore.js:542-553` [read] |
| S12 | `same()` is `JSON.stringify` equality: cost proportional to value size per write and per state per tick (the `trail` preset stringifies 400 points twice a tick) | `src/spore.js:716-720`, `601` [read] |
| S13 | `ir()` is not a pure read: it computes dirty formulas and so can add or clear errors | `src/spore.js:651` [read] |
| S14 | The rAF loop re-arms every frame while any view is registered, even when nothing ticks; dead views linger 30 s | `src/spore.js:2233`, `2242` [read] |
| S15 | Component names are checked only against `BUILDER_METHODS`; a component named like a `View` member (`constructor`, `_add`) is shadowed by the member | `src/spore.js:189`, `288` [read] |
| S16 | Lines for factory-made apps and cells point inside the factory; `cells({…})` gives every cell the call's line | `src/spore.js:53`, `226`; [run E03] |
| S17 | Code runs unsandboxed in the page (`new Function`) | `src/spore.js:305` [read] |
| S18 | State nodes in the IR never carry `error`; state step errors appear only in the top-level `errors` | `src/spore.js:522`, `539`, `598`; [run E08] |

### 12.3 Textbook vs code

| Textbook | Code | Wrong side |
|---|---|---|
| "Every name in a view is resolved" at link (`src/index.html:1473`) | only string refs; names inside view lambdas fail at first paint (`src/spore.js:389-401`) [run E07] | textbook |
| "Cycles are found here [link]" (`src/index.html:1473`) | also at run time (`src/spore.js:508-513`) [run E02-20] | textbook |
| "A formula's edges … are always true" (`src/index.html:1496`) | true for formulas and states as of their last run; view edges over-approximate (S1) and lag (S2) | textbook (qualify) |
| "order is a topological order: sources first, views last" (`src/index.html:1497`) | B2, S2 | code |
| "the program does not tick at all" when nothing reads the clock (`src/index.html:1449`) | true for `rt.tick`; sticky view reads (S1) and the always-on rAF (S14) | textbook (qualify) |
| writers take `"desk.app.cell"` (`src/index.html:1642`) | only `$.set` (B1) | code |
| a param whose **default** did not change keeps its value (`src/index.html:1289`, `1557`) | default **and** control must be unchanged (`src/spore.js:364-365`) [read] | textbook |
| "inside CC5 also at `cc5.spore`" (`src/index.html:1565`) | set only if `window.cc5` exists (`src/spore.js:2666`); in Blocks it is `window.blocks.spore` (`src/blocks.js:2378`) | textbook (host-specific) |
| "Add its name to `KINDS` and `BUILDER_METHODS`" (`src/index.html:1621`) | `KINDS` drives nothing; LINK and the highlighter also need updating (11.2) | textbook |
| IR example and reference (`src/index.html:1478-1492`, `1649`) | real IR also has `w`, `line` on apps, `app`/`name`/`value` on cells, `step`/`label`/`unit` in controls, `note` and `path` on pseudo-nodes (6.6) | textbook (simplified) |
| `app(id, { title, w })`, `draw(height, …)` (`src/index.html:1627`, `1238`) | also `app(id, "Title")` and `draw(paint)` with height 140; `.view()` may be called repeatedly (`src/spore.js:276`, `145`, `269`) | textbook (undocumented features) |
| Two-phase tick, "order never matters" (`src/index.html:1429`) | holds [run E02-2], but only for steps that return new values (B3) | textbook (add the rule) |

## 13. Verification: scripts and outputs

All in this ticket's `scripts/spore/`. Each script takes `<spore.js> <hypha.js> <index.html>`; outputs are the matching `.out` files.

| Id | Script | Shows |
|---|---|---|
| — | `load.js` | the harness: stubs, in-memory exposure of `Paint`/`Host`/`UI`/`PRESETS`, `paint()`, manual rAF |
| E01 | `e01-ir.js` | full IR right after load; view reads and order after one paint |
| E02 | `e02-run.js` | 20 RUN probes (sections 5–7) |
| E03 | `e03-lines.js` | syntax/runtime error lines, factory and `cells()` lines |
| E04 | `e04-host.js` | `Program`, `window.spore`, the bridge on a real Hypha kernel, `export`, `syncDesk`, the Loop |
| E05 | `e05-presets.js` | every preset: builds, paints, ticks with no errors; node/edge/order counts; `plain()` |
| E06 | `e06-order.js` | which nodes `order` drops in `wild`, `home` and a two-state swap |
| E07 | `e07-view-errors.js` | view-lambda errors, hidden-element errors, shared lambda keys |
| E08 | `e08-misc.js` | state node errors, writes-apply-at-once, toggle label, empty `Program.ir()` |
| E09 | `e09-prompt.js` | the Spore prompt before and after Blocks' rewrite |
| E10 | `e10-ir-compact.js` | the IR in section 6.6 |

Run, for example: `node <dir>/e02-run.js <repo>/apps/upstream/blocks/src/spore.js <repo>/apps/upstream/blocks/src/hypha.js <repo>/apps/upstream/blocks/src/index.html`.

## 14. References

- `apps/upstream/blocks/src/spore.js`: the whole system; section headers at `1-29`, `1163-1169`, `1753-1760`, `2006-2013`, `2101-2112`.
- `apps/upstream/blocks/src/index.html:1136-1656`: the textbook (also the agent's reference; chapter 10 on the IR, 15 on extending, 16 the reference).
- `apps/upstream/blocks/src/blocks.js:331`, `786-808`, `1411`, `2374-2378`: the Blocks host's use of Spore.
- `apps/upstream/blocks/src/fruit.js:137-175`, `310`: `prop`, `bind`, `write` used by the elements.
- `apps/upstream/blocks/README.md`, `build.sh`, `SHA256SUMS`: provenance and the unchanged-upstream rule.
- `ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/design-doc/01-intern-guide-claude-blocks-on-slop.md:799`, `812-820`: the trust note and upstream defects.

---

# Part II: Pinboard's app grammar

## 0. How to read this

**Citations.** Code paths are relative to `apps/pinboard/` unless they start with `pkg/`, `web/` or `ttmp/` (so `js/dsl.js:149` is `apps/pinboard/js/dsl.js:149`). The design guide is cited as `ex:<line>`, meaning `ttmp/2026/11/07/SLOP3-016--pinboard-on-slop-a-collaborative-computational-pinboard-shared-boards-apps-as-code-agent-cli-verbs/sources/pinboard-api-examples-code.txt:<line>`. That file holds the code of the guide's examples, extracted from the HTML guide `…/sources/pinboard-api-examples-and-wireframes.html` (examples start at `:769`, pipeline at `:728-765`). Its chapter numbers are the guide's (00 the grammar … 12 pin and tile, 13 everything at once). Its "EXAMPLE 14" (`ex:358-383`) is the guide's syntax highlighter, an artefact of the extraction.

**Evidence marks.** **[run]** means verified by running the code in Node (scripts and their outputs are listed in §11). **[read]** means read from the code and not executed. **[test]** means covered by an existing test that passed in this session.

**Snapshot.** Worktree at `f5bc6b2` (origin/main). Node v24.18.0.

## 1. Purpose and mental model

Pinboard is a shared canvas of windows ("clips": notes, links, images, docs, groups and app windows). Its little apps are written in a fluent, immutable JavaScript grammar (`js/dsl.js:1`). The grammar has three layers:

| Layer | What it is | Where |
|---|---|---|
| Builders | Immutable, Proxy-wrapped records of *shape*: kind, props, children, handlers, fragments, attributes | `js/dsl.js:63-194` |
| IR | `builder.build()`: a tree of plain nodes with ids and paths, for inspection, YAML and diffs | `js/dsl.js:209-233` |
| Runtime | `PB.render(builder, ctx)` turns **builders** (not IR) into DOM, with a context that records what each window read | `js/render.js:13-192`, `js/board.js:81-104, 680-694` |

The renderer never builds or reads the IR. `PB.render` switches on `b.kind` and reads `b.props`, `b.children` and `b.handlers` (`js/render.js:89-185`), and app windows render `def.view`, `def.toolbar` and `def.side`, which are builders (`js/apps.js:129-131`, `js/frame.js:121-125`). Outside `dsl.js`, `.build()` and `.describe()` are called only by the editor's *Describe IR* button (`js/apps.js:220`) [read]. The IR is an inspection artefact for people and the agent, not a compilation step. This contradicts the guide's pipeline ("builders … compile to an IR once", `…/pinboard-api-examples-and-wireframes.html:728-765`).

### 1.1 What an app is

An app is **source text**: JavaScript that ends with `app('name')….register()` (`js/apps.js:154-171`, `js/apps.js:41`). Evaluating it captures one **definition** (`def`), a plain object of data, builders and lambdas (§2.9). The source is the unit of storage, versioning and trust. `def` is rebuilt from source wherever the app runs. The actor never evaluates source (`actor.js:223-253`).

Source is evaluated as the body of `new Function('ui','app','db','fragment','board','PB','helpers', '"use strict";\n' + src)` (`js/apps.js:38-39`, `js/frame.js:103-104`). There are no imports, despite `ex:2`.

### 1.2 Who writes apps

| Author | How | Cited |
|---|---|---|
| The code store (built-in apps: collections, editor, moodboard, reading, reference, log) | Plain sources in `SRC`, evaluated at boot. They are never written to the board, and a board's own app of the same name wins. | `js/apps.js:173-340` |
| A board admin, in the App editor | `registerFromEditor` → `registerSource` → actor `registerApp` | `js/apps.js:231-234, 52-67`; `actor.js:223-253` |
| The page agent, as the person | an `eval` step whose code captures an app is registered with that code as source | `js/agent.js:77` |
| Offline (no slop runtime) | the page writes `apps/<name>` itself | `js/apps.js:60-64` |

Only admins register apps: the core checks it (`core.js:123-126`), page writes under `apps/` are switched off (`js/store.js:104-106`), the manifest's `apps` rule is `write: self` (`app.json:7-10`), and `registerApp` requires `admin` (`actor.js:224`).

### 1.3 Where an app runs

| App | Realm | Cited |
|---|---|---|
| Built-in | The board page (the viewer's realm) | `js/apps.js:87-89` |
| Any other app the viewer trusts (their own, or a version they accepted) | A sandboxed `<iframe sandbox="allow-scripts">` with an opaque origin and a CSP without network | `js/apps.js:71-76, 87, 127`; `js/frames.js:182, 268-278` |
| Any other app not yet trusted | Nothing runs: a trust prompt with *Run it* / *View source* | `js/apps.js:86, 126, 140-151` |
| Registration (`registerSource`) | The page evaluates the registering person's own source, `narrow` (with `PB` passed as `undefined`), to read its name, size, params and state | `js/apps.js:50-57` |
| Agent steps | The page, with the agent scope | `js/agent.js:69-79` |

In the frame, `dsl.js` and `render.js` are the page's own files, inlined into the frame document (`js/frames.js:185-194`). The grammar is therefore the same in both realms, and `frame.js` supplies a narrowed `PB` underneath it (`js/frame.js:19-97`).

## 2. The builder grammar

### 2.1 The builder record and its Proxy

`mk(kind, props, children, handlers, frags, attrs)` (`js/dsl.js:149-160`) makes a record `t` and returns `new Proxy(t, handler)`:

| Field | Type | Frozen? | Meaning |
|---|---|---|---|
| `_isBuilder` | `true` | — | brand, checked everywhere (`js/dsl.js:150`) |
| `kind` | string | — | one of `PB.grammar.kinds` (`js/dsl.js:113`) |
| `props` | object | shallow-frozen (`Object.freeze`) | everything modifiers record |
| `children` | array | frozen | child builders (or raw values from `ui.list`) |
| `handlers` | `{event: [fn…]}` | frozen (the arrays are not) | `.on(ev, fn)` accumulates per event (`js/dsl.js:153`) |
| `frags` | array of fragment objects | frozen | fragments used, in order |
| `attrs` | object | **not frozen, shared** | fragment attributes and `.set(k, v)` values |
| `_p(patch)`, `_k(child)`, `_h(ev, fn)`, `_a(k, v)` | functions | — | the only constructors of a derived builder (`js/dsl.js:151-154`) |
| `build()`, `mount(el, ctx)`, `describe()`, `toYAML()` | functions | — | the three ways out (`js/dsl.js:155-158`) |

The Proxy's `get` trap (`js/dsl.js:132-145`) resolves a name in this order:

1. a non-string key, a name in `KNOWN_PROPS`, or an own field: return the field. This makes `then`, `toJSON` and the like `undefined`, so builders are not thenables (`js/dsl.js:130, 133`);
2. a kind method (`BY_KIND[kind]`), then a common method (`COMMON`) (`js/dsl.js:134-135`);
3. a method or query of a fragment this builder uses (`js/dsl.js:136`);
4. a method of a **global** fragment (`js/dsl.js:137`);
5. otherwise a diagnostic error (§2.11).

The `set` trap throws "builders are immutable; every call returns a new one. Use b = b.pad(8)." (`js/dsl.js:146`) [run].

**What immutability covers, and its holes** [run, `exp2-grammar.out`]:

- Every method returns a new builder; the old one is unchanged.
- Assigning a property throws.
- `props`, `children` and `handlers` are frozen, but only shallowly: `ui.text('x').style({color:'red'}).props.style.color = 'blue'` succeeds.
- There is no `deleteProperty` trap, so `delete b.kind` removes the field.
- `attrs` is neither frozen nor copied by `_p`, `_k` or `_h` (`js/dsl.js:151-153`). A builder and everything derived from it share one `attrs` object. `b.get('tags').push(x)` changes every builder in that line. Only `_a` (`.set`) copies (`js/dsl.js:154`).
- `app(...).build()` returns the closure's `def`, which is not frozen; `t.def` is frozen (`js/dsl.js:303, 311`).

### 2.2 Constructors (`ui.*`, `js/dsl.js:162-193`)

| Constructor | Kind | Initial props | Notes |
|---|---|---|---|
| `ui.text(v='')` | text | `{value}` | `v` may be a lambda of `c` |
| `ui.h(v, level=2)` | h | `{value, level}` | |
| `ui.note(v='')`, `ui.doc(md='')` | note, doc | `{value}` | doc renders `PB.md` (`js/dsl.js:45-61`) |
| `ui.image(src)`, `ui.screenshot(src)` | image | `{src}` (+`screenshot:true`) | `screenshot` changes nothing at render |
| `ui.link(url)` | link | `{url}` | no unfurling (§10, ch.00) |
| `ui.file(f)` | file | `{file}` | |
| `ui.input(key)` | input | `{key: String(key)}` | bound to a param, `state`, or `local` (§5.4) |
| `ui.button(label)` | button | `{label}` | |
| `ui.chip(t)`, `ui.swatch(hex)` | chip, swatch | `{value}` | |
| `ui.sep()`, `ui.spacer()` | sep, spacer | `{}` | |
| `ui.kv(pairs)` | kv | `{pairs}` | object or `[k, v]` list; values may be lambdas |
| `ui.stack(...k)`, `ui.row(...k)` | stack, row | `{}` | children through `kids()` |
| `ui.grid(...k)` | grid | `{cols: 3}` | |
| `ui.list(items, fn)` | list | `{}`, children `items.map(fn)` | **build time**; throws unless `items` is an array (`js/dsl.js:180`) |
| `ui.each(src, fn)` | each | `{src, fn}` | **runtime**; `src` is an array, an object, a query, or a lambda returning one of those (`js/render.js:73-78`) |
| `ui.when(pred, a, b)` | when | `{pred, then: a, else: b}` | branches are builders or `c => builder` |
| `ui.table(rows, opts)` | table | `{rows, ...opts}` | opts: `columns`, `editable`, `hint`, `selected` |
| `ui.dropzone(opts)` | dropzone | `{accepts: ['*'], ...opts}` | |
| `ui.segmented(key, options)`, `ui.select(key, options)` | segmented, select | `{key, options}` | options default to the param's (`js/render.js:80-84`) |
| `ui.toggle(key, label)` | toggle | `{key, label}` | |
| `ui.slider(key, opts)` | slider | `{key, ...opts}` | opts: `min`, `max`, `step`, `unit`, `label` |
| `ui.slot(name)` | slot | `{name}` | a hole for `.fill(name, n)` |
| `ui.frame(body)` | frame | `{body}` | used by `board.js` for clip chrome (`js/board.js:127`) |
| `ui.strict(v=true)` | — | sets `PB.strict` | §2.11 |
| `ui.tokens` | — | `{xs:4, s:8, m:12, l:16, xl:24}` | `js/dsl.js:64` |

**Children** go through `kids(args)` (`js/dsl.js:161`). It flattens **one** level and drops `null`, `undefined` and `false`, so `0` and `''` survive. Strings and numbers become `ui.text`. A deeper array stays an array child: `ui.row([ui.text('b'), ['c']])` gets an array child, which `describe()` prints as `- [c]` [run, `exp2b-kids.out`]. `ui.list` bypasses `kids()`, so its children may be raw strings [run].

### 2.3 Common modifiers (`COMMON`, `js/dsl.js:71-99`)

Each modifier records a prop (`_p`), a child (`_k`), a handler (`_h`) or an attribute (`_a`):

| Method | Records | Validation |
|---|---|---|
| `.gap(v)`, `.pad(v)` | `gap`, `pad` | number, token, or lambda; anything else throws a `TypeError` listing the tokens (`js/dsl.js:65-70`) |
| `.size(w, h)`, `.width(w)`, `.height(h)` | `w`, `h` | none: `size('xl')` sets `w:'xl'` [run] |
| `.grow(v=1)`, `.align(v)`, `.justify(v)`, `.wrap(v=true)` | `grow`, `align`, `justify`, `wrap` | |
| `.id(v)` | `id: String(v)` | becomes the IR id and the DOM `data-nid` |
| `.on(ev, fn)` | handler | `fn` must be a function |
| `.bind(fn)` | `value: fn` | `fn` must be a function. Only kinds that render `props.value` honour it (text, h, note, doc, chip, swatch); on input, link or button it is silently ignored (`js/render.js:98-127`) [read] |
| `.map(fn)` | whatever `fn(b)` returns | must return a builder (`js/dsl.js:81`) [run] |
| `.use(frag)` | fragment | §2.8 |
| `.class(v)`, `.style(obj)` | `cls`, `style` | |
| `.when(fn)` | `when` | the node renders only if `val(when)` is truthy (`js/render.js:95`) |
| `.hint(v)` | `hint` | the empty text for each, table and dropzone; a `title` elsewhere |
| `.local(v=true)` | `local` | binds a keyed input to `c.local` (`js/render.js:85-86`) |
| `.small()`, `.bold()`, `.mono()`, `.muted()` | booleans | CSS classes |
| `.draggable(o)` | `draggable: {kind:'item', ...o}` | `payload` is called with `c`, not with the item (`js/render.js:180`) |
| `.selected(v)` | `selected` | |
| `.footer(n)`, `.strip(n)`, `.after(n)` | arrays of builders | `strip` is drawn only in clip chrome (`js/board.js:119`) |
| `.caption(n)`, `.title(v)`, `.tooltip(v)` | props | |
| `.fill(slot, n)` | a rebuilt tree with the slot replaced | throws when there is no such slot (`js/dsl.js:95, 115-117`) [run] |
| `.set(k, v)` | attribute (`v` may be `old => new`) | `.get(k)` returns the live value |
| `.menu(items)` | `menu` (appended) | must be an array |

### 2.4 Kind-specific methods (`BY_KIND`, `js/dsl.js:100-111`)

| Kind | Methods |
|---|---|
| image | `.fit(v)` |
| frame | `.body(n)` |
| input | `.placeholder(v)`, `.multiline()`, `.code()` (also multiline), `.type(t)`, `.rows(n)`, `.debounce(ms)` |
| button | `.primary()`, `.disabled(v)` |
| stack, row, dropzone | `.child(n)` |
| grid | `.cols(n \| c => n)` (throws on other types), `.child(n)`, `.masonry()` |
| table | `.columns(v)`, `.editable()`, `.onRow(fn)` (handler `row`), `.onEdit(fn)` (handler `edit`) |
| dropzone | `.accepts(list)` |
| segmented, select | `.options(v)` |
| slider | `.range(min, max, step)` |

Every other kind has an empty entry. **Every kind must have an entry**, because `PB.grammar.kinds` and the diagnostics read `BY_KIND` (`js/dsl.js:112-113`).

### 2.5 Build-time and runtime lambdas

The rule printed to people and to the agent: "A lambda that receives a builder (b) runs at build time; one that receives the context (c) runs at runtime" (`js/apps.js:345`; `js/apps.js:155`).

- **Build time** means when the builder expression is evaluated, i.e. when the source is evaluated. `.map(b => …)`, `ui.list(items, fn)`, fragment methods and decorations all run then.
- **Runtime** means at render. A prop value that is a function is called by `val(v, ctx)` inside `PB.withCtx` (`js/render.js:52-54`). Handlers are called by `fire()` with the context last (`js/render.js:56`).
- Exceptions to "lambda props run through `val`":
  - `ui.each`'s item function is called directly as `fn(item, i, ctx)` (`js/render.js:137`);
  - a `ui.when` branch given as a function is called as `t(ctx)` (`js/render.js:138`);
  - table column `render(r, ctx)` is called directly (`js/render.js:146`).

  All three run **outside** `withCtx`, so db reads inside them are not tracked (§4.3) [run, `exp4b-branch.out`].

### 2.6 Slots

`ui.slot(name)` marks a hole. `b.fill(name, n)` rebuilds the path to the slot with `n` in its place (`js/dsl.js:115-117`). An unfilled slot renders an empty `<span class="slot">` (`js/render.js:169`).

### 2.7 Fragments (`js/dsl.js:196-207`)

`PB.fragment(name)` makes a fragment object and **registers it globally by name** in `PB.fragments` (`js/dsl.js:206`). Its builder API, all chainable on the fragment:

| Method | Effect |
|---|---|
| `.attr(k, default)` | an attribute added on `.use` (default cloned per use, `js/dsl.js:125`) [run] |
| `.method(k, (b, ...a) => builder)` | a builder method visible only after `.use` (`js/dsl.js:136`) |
| `.query(k, (irRoot, ...a) => value)` | a method that builds the builder's IR and calls `fn(root, …)` (`js/dsl.js:136`) |
| `.decorate(b => builder?)` | runs at `.use` time and may return a replacement builder (`js/dsl.js:126`) |
| `.on(ev, fn)` | stored in `hooks`, **never called** by any code (only `toYAML` reads it, `js/dsl.js:203, 205`) [run] |
| `.global()` | its methods are reachable from every builder (`js/dsl.js:137`) |
| `.toYAML()` | a summary of the fragment |

`b.use(frag | name)` (`js/dsl.js:120-128`):

- it is a no-op when `frag` is already used;
- otherwise it appends the fragment, copies attributes the builder lacks, and runs the decorations in order.

Three consequences of the lookup order [run]:

- A global fragment can add methods but **cannot override** a common or kind method. `fragment('measured').method('size', …).global()` has no effect on `.size()` (`js/dsl.js:134-137`).
- Fragment names are last-writer-wins in `PB.fragments`. Builders keep the object they used.
- Any evaluated source can replace a named fragment for later `.use('name')` calls in the same realm. Built-in clip chrome is not affected, because it keeps references (`js/board.js:24`).

Every clip window carries four built-in fragments (`js/board.js:11-24`):

| Fragment | Adds |
|---|---|
| `taggable` | attr `tags`, methods `tag` / `untag`, query `hasTag`, chips in the strip |
| `sourced` | attr `source`, a footer line; its `paste` hook is dead code (paste sets `source` directly, `js/board.js:36`) |
| `bound` | a footer link to the bound row |
| `annotated` | attr `note` |

### 2.8 The `app()` builder (`js/dsl.js:300-326`)

`PB.app(name)` checks the name (`/^[a-z][a-z0-9_-]*$/i`, `js/dsl.js:326`) and returns a Proxy over `{_isApp, def}`. Every method returns a new app builder with a patched `def` (`js/dsl.js:304`):

| Method | `def` field(s) | Notes |
|---|---|---|
| `.icon(v)`, `.title(v)`, `.about(v)`, `.shortcut(v)` | same names, `String(v)` | |
| `.size(w, h)` | `w`, `h` | |
| `.hidden(v=true)`, `.order(n)` | `hidden`, `order` | dock and quicklaunch ordering |
| `.state(obj)` | `state`, merged | must be an object (`js/dsl.js:308`) |
| `.toolbar(b)`, `.view(b)`, `.side(b)` | builders | a lambda is refused with an explanation (`js/dsl.js:314`) [run] |
| `.menu(items)` | `menu`, appended | items `{label, run(c), when?(c), hint?}` or `'-'` |
| `.param.slider/toggle/select/text/number(name, def, opts)` | `params[]`, replaced by name | `toggle` coerces `def` to a boolean; `select`'s third argument is the options list (`js/dsl.js:315-316`) [run] |
| `.agent.describe(fn)` | `agentDescribe` | used by `PB.describe` for in-page apps only (`js/board.js:662`) |
| `.agent.allow(list)`, `.agent.suggest(list)` | `agentAllow`, `agentSuggest` | **stored, never read** (grep: only `js/dsl.js:317`) |
| `.build()` | returns `def` | |
| `.register()` | pushes `def` into `PB.apps._capture` | throws outside an evaluation (`js/dsl.js:312`) |
| `.toYAML()` | YAML of `def` | |

**`def` schema** (what `evalSource` returns, verified on the counter template [run, `exp9-counter-ir.out`]):

| Field | Type | Persisted in `apps/<name>`? |
|---|---|---|
| `name` | string | yes |
| `icon`, `title`, `about`, `shortcut` | strings | yes (`js/apps.js:56`; `actor.js:244`) |
| `w`, `h` | numbers | yes, clamped by the actor (`actor.js:245`) |
| `hidden`, `order` | bool, number | yes |
| `state` | plain object | yes, as JSON (`js/apps.js:57`) |
| `params` | `[{name, type, def, options?, min?, max?, step?, unit?, placeholder?}]` | yes, without `unit` and `placeholder` (`js/apps.js:57`) |
| `toolbar`, `view`, `side` | builders | no: rebuilt from source |
| `menu` | items with lambdas | no |
| `agentDescribe`, `agentAllow`, `agentSuggest` | lambda, lists | no |
| `_narrow` | `true` when evaluated narrow or in a frame | no (`js/apps.js:43`; `js/frame.js:107`) |

The record also gets `source`, `version`, `sha256`, `uid`, `by` and `at` from the actor (`actor.js:242-247`).

### 2.9 Collections and queries (`js/dsl.js:235-298`)

**Schema builder.** `db.collection(name)` checks that the name is a word. If the collection does not exist yet, it creates it **with a mutation** (`js/dsl.js:263-264, 282`). Every chained call is a mutation, coalesced per collection within 2 s (`js/store.js:280`):

| Call | Effect |
|---|---|
| `.field(name, type='text', opts)` | replaces or appends the field `{name, type, ...opts}` |
| `.required()`, `.auto()` | flag the last field. **Not enforced** on insert [run] |
| `.index(f)` | adds to `indexes`. Nothing reads indexes [read] |
| `.store(kind)` | records `store`. Has no effect on slop |
| `.rename(from, to)` | renames the field and moves the value in every row |
| `.migrate(v, fn)` | runs `fn(sb)` once, when the stored `version` is below `v` [run] |
| `.drop()` | removes the collection and its rows |
| `.schema`, `.toYAML()` | read |

Field types are free strings; no type is checked anywhere [read].

Because the schema builder writes when it is called, a schema declared at the top of an app's source (`ex:307-311`) writes the collection **every time the source is evaluated**: at registration, at each in-page load, and in each frame for each viewer. For a viewer below `interact`, the in-page evaluation throws ("This board is read-only for you") [run, `exp10-schema-eval.out`].

**Queries.** `db.<name>` is a `new Query(name)` for any word-like name (`js/dsl.js:289-297`), including collections that do not exist (an empty query, [run]). `Query` is immutable (`js/dsl.js:236-260`):

| Method | Kind | Tracks | Notes |
|---|---|---|---|
| `.where(r => bool)` | builder | — | a throwing predicate drops the row (`js/dsl.js:244`) |
| `.orderBy(f, dir='asc')`, `.orderBy([f, dir])` | builder | — | `f` is a dotted path (`'tags.0'`) or a function **of the record** (`js/dsl.js:245`) |
| `.limit(n)` | builder | — | |
| `.all()` | terminal | `coll:<name>` | full scan of `PB.S.records`; default order `added` asc |
| `.count()`, `.first()`, `.distinct(f)` | terminal | via `all()` | `distinct` flattens arrays |
| `.get(id)` | terminal | `coll:<name>` | `undefined` for a record of another collection |
| `.schema()` | terminal | nothing | |
| `.insert(data)`, `.update(id, patch \| r => patch)`, `.remove(id)` | mutations | — | as `PB.actor`; `insert` coalesces per collection |
| `.toYAML()`, `.toJSON()` | | | `toJSON` is a summary, not the rows |

The sort comparator treats missing values as equal to everything, so records without the sort field land in arbitrary places [run]. `db.collections()` tracks `collections`; `db.record(id)` and `db.has(name)` track nothing (`js/dsl.js:283-286`) [run, `exp3b-record.out`].

The actor and the CLI use a different, data-only query form, `core.query(data, coll, {where: [[field, op, value]], orderBy, desc, limit})` (`core.js:299-308`; `actor.js:111-118`). It is not the DSL's `Query`.

### 2.10 Diagnostics (`js/dsl.js:138-144`)

Every message below was produced by running [run, `exp2-grammar.out`]:

| Misuse | Message |
|---|---|
| `ui.stack().gap('big')` | `TypeError: stack.gap(value) expects a number of px or a spacing token ('xs' 4 · 's' 8 · 'm' 12 · 'l' 16 · 'xl' 24); got "big".` |
| `ui.stack().cols(3)` | `stack has no method "cols". It belongs to grid: use ui.grid(…) (a stack is one column; ui.grid(…).cols(n) lays out columns).` |
| `ui.text('n').placeholder('x')` | `text has no method "placeholder". It belongs to input: use ui.input(…).` |
| `ui.text('x').tag('a')` | `text has no method "tag". It comes from fragment taggable; add .use(taggable) first.` |
| `ui.text('x').bindd()` | `text has no method "bindd". Did you mean "bind"?` (edit distance ≤ 3) |
| `ui.stack(…).colums(3)` | `stack has no method "colums". Did you mean "class"?` |
| a far miss | `… Methods here: gap, pad, size, …` (first 14) |
| `ui.row(…).fill('body', …)` | `row has no slot "body". Slots here: none. Declare one with ui.slot('body').` |
| `ui.list(query, fn)` | `ui.list(items, fn) expands at build time, so items must be an array. For a live query use ui.each(query, fn).` |
| `app('x').viw(…)` | `app has no method "viw". Did you mean "view"?` |
| `app('x').view(c => …)` | `app.view(builder): pass a builder, not a lambda. …` |
| strict mode, `ui.each(…)` without `.id()` at build | `each#1 has a runtime lambda but no .id(); the agent cannot address it. Add .id('rows').` |

**Strict mode** (`ui.strict(true)`, i.e. `PB.strict`) adds exactly one check (`js/dsl.js:218`). It is global to the realm and **the agent does not turn it on** (`PB.strict` is `undefined` during agent steps) [run, `exp6-agent-step.out`].

## 3. The build pass and the IR

### 3.1 The pass (`buildIR`, `js/dsl.js:210-224`)

`b.build()` walks the builder tree once:

1. **Id.** `props.id`, or `kind + '#' + (++n)` with a counter per `build()`. Ids are assigned **pre-order**, root first: `stack#1`, then its children (`js/dsl.js:214`) [run].
2. **Node.** `{kind, id, path, props:{}, children:[], handlers: Object.keys(b.handlers), frags: names, attrs: b.attrs, deps: [], _b: b}` (`js/dsl.js:215`).
3. **Props.** Copied as they are, except that a builder-valued prop is walked into a node at path `path/<key>`, and an array prop containing builders has each builder walked at `path/<key><i>` (no separator, e.g. `/footer0`) (`js/dsl.js:216`) [run]. Lambdas stay functions in the raw IR.
4. **Children.** Walked at `path/<i>`. A non-builder child is kept as it is (`js/dsl.js:213, 217`).
5. **Check.** In strict mode, an `each` without an explicit id throws (`js/dsl.js:218`).
6. **Collect.** The node is pushed to `nodes` **after** its children (**post-order**: the root is last), and `byId[id] = node` (`js/dsl.js:219`).

No other pass exists. Nothing infers dependencies, types, state keys or edges. `deps` is always `[]` [run].

### 3.2 The IR object (`js/dsl.js:222`)

| Member | Type | Behaviour [run, `exp1-ir.out`] |
|---|---|---|
| `root` | node | |
| `nodes` | node[] | post-order |
| `node(id)` | `id → node \| undefined` | duplicate explicit ids: the last one pushed wins, silently |
| `edges` | **getter** | `nodes.flatMap(n => n.deps.map(d => [d, n.id]))`, which is always `[]`; `ir.edges()` (the guide's call) throws `TypeError: ir.edges is not a function` |
| `toYAML()` | `→ string` | `PB.toYAML(strip(root))` |
| `diff(other)` | `→ op[]` | `other` must be an IR. A builder throws `stack has no method "root"`, because `other.root` goes through the builder Proxy (`js/dsl.js:222`) |

### 3.3 The node

| Field | Type | In `strip()`/YAML | Notes |
|---|---|---|---|
| `kind` | string | yes | |
| `id` | string | yes | §3.1 |
| `path` | string | **dropped** | `''` for the root, `/1/0`, `/2/then`, `/footer0` |
| `props` | object | yes, even when empty (`props: {}`) | functions become `'λ'`; plain objects are stripped recursively |
| `children` | (node \| raw)[] | omitted when empty | |
| `handlers` | string[] | omitted when empty | event names only |
| `frags` | string[] | omitted when empty | fragment names |
| `attrs` | object | omitted when empty | **the builder's live object**, not a copy |
| `deps` | `[]` | omitted (always empty) | |
| `_b` | builder | **dropped** | back-reference; nothing reads it [read] |

A builder used twice becomes two nodes with two ids: the IR is a tree, never a DAG [run].

### 3.4 `strip`, `toYAML`, `describe`

- `strip(node)` (`js/dsl.js:226`) removes `_b` and `path`, turns functions into `'λ'`, omits empty `children`, `handlers`, `frags`, `deps` and `attrs`, and recurses into everything else, plain objects included.
- `PB.toYAML(v)` (`js/dsl.js:23-42`) is a YAML-ish printer:
  - it skips keys that start with `_`;
  - it prints a builder as its stripped IR and a query as its rows (`all()`);
  - it prints `λ` for functions, `blob <type> <size> B` for blobs and `<tag>` for DOM nodes, and marks repeats as `…(circular)`;
  - it quotes a string only when it contains a newline or `: `, starts or ends with whitespace, starts with `[`, `{` or `-`, or is empty.
- `b.describe()` and `b.toYAML()` both build a fresh IR and return `toYAML(strip(root))` (`js/dsl.js:157-158`) [run].

**Bug: a query in a prop breaks every YAML view** [run, `exp1b-query-prop.out`]. `strip` copies a `Query` into a plain object that keeps `_isQuery: true` but no methods. `toYAML` then sees `_isQuery` and calls `v.all()`: `TypeError: v.all is not a function` (`js/dsl.js:226, 33`). `ui.each(db.x.where(…), …)` and `ui.table(db.x.orderBy(…))` therefore render correctly but cannot be described. This affects `describe()`, the editor's *Describe IR*, and an agent step that returns such a builder. The Reference allows a query there ("source is an array, a query or `c => query`", `js/apps.js:350`), and the guide uses one (`ex:11, 75, 115, 179, 332`). Only the lambda form works everywhere.

### 3.5 `diff` (`js/dsl.js:227-233`)

`diff(a, b)` compares two stripped trees key by key and emits:

| Op | When | Fields |
|---|---|---|
| `replace` | types differ, or object vs primitive | `at`, `from`, `to` |
| `set` | primitives differ | `at`, `from`, `to` |
| `add` | key only in `b` | `at`, `to` |
| `remove` | key only in `a` | `at`, `from` |

`at` is a slash path from the root through `props`, `children` and indices: `/props/gap`, `/children/1/children/2/props/label`. Its properties [run]:

- Arrays are compared by index, so inserting a first child shows up as "every child changed, one added".
- Auto ids shift when a node is inserted (`text#3` becomes `text#4`).
- Two different lambdas compare equal: both are `'λ'`.

### 3.6 A real IR: the counter template

This is `apps.evalSource(apps.TEMPLATE).view.build()` (`js/apps.js:154-171`), printed as raw nodes in array order with functions shown as `λ` [run, `exp9-counter-ir.out`]:

```
{kind:text,   id:text#2,   path:/0,   props:{value:λ, bold:true, cls:bignum}, children:[], handlers:[], frags:[], attrs:{}, deps:[]}
{kind:button, id:button#4, path:/1/0, props:{label:−},                handlers:[click], …}
{kind:button, id:button#5, path:/1/1, props:{label:+},                handlers:[click], …}
{kind:button, id:button#6, path:/1/2, props:{label:reset, small:true}, handlers:[click], …}
{kind:row,    id:row#3,    path:/1,   props:{gap:6},  children:[button#4, button#5, button#6], …}
{kind:stack,  id:stack#1,  path:"",   props:{pad:12, gap:10}, children:[text#2, row#3], …}
```

What *Describe IR* shows (`def.view.describe()`), abbreviated:

```yaml
kind: stack
id: stack#1
props:
  pad: 12
  gap: 10
children:
  - kind: text
    id: text#2
    props:
      value: λ
      bold: true
      cls: bignum
  - kind: row
    id: row#3
    props:
      gap: 6
    children:
      - kind: button
        id: button#4
        props:
          label: −
        handlers: [click]
      …
```

Diffs: changing `.pad(12)` to `.pad(16)` gives `[{op:'set', at:'/props/pad', from:12, to:16}]`. Renaming `reset` to `zero` gives `[{op:'set', at:'/children/1/children/2/props/label', from:'reset', to:'zero'}]` [run].

## 4. The dependency graph (what stands in for the guide's DAG)

### 4.1 What the guide describes, and what exists

The guide's chapter 06 (`ex:112-141`) describes a static DAG with:

- per-node deps (`ir.node('results').deps // ['state.q', 'db.links']`) and node-to-node edges (`ir.edges()`);
- shared nodes (`ui.ref`);
- a renderer that "re-runs only the nodes whose deps changed, in topological order".

None of this exists. The SLOP3-016 intern guide recorded it as a wish (`ttmp/2026/11/07/SLOP3-016-…/design-doc/01-intern-guide-….md:123, 184`).

What exists is a **dynamic, per-window dependency set**:

- **Nodes of the graph:**
  - *keys*, strings naming a piece of data (table below);
  - *windows*, clip ids in `B.wins` (`js/board.js:70-71`).
- **Edges:** key → window, recorded while a window renders. `renderClip` makes a fresh context with an empty `deps` Set, renders, and keeps that Set as `wins[id].deps` (`js/board.js:89, 103`; `js/render.js:14`).
- **Ordering:** none needed. A window re-renders whole, so there is no intra-window order. Windows are independent, because no window reads another window's output.
- **Cycles:** structurally impossible between windows. Within a window, a lambda that writes during render (for example `c.set(…)` inside a prop lambda) emits a change synchronously (`js/store.js:386-391`), which re-enters `renderClip` for the same window (`js/board.js:677, 689`). Nothing guards against this; only stack exhaustion, caught by the render `try` (`js/render.js:184`), would stop it [read, not run].

### 4.2 Keys: who tracks them, who emits them

| Key | Tracked by (read) | Emitted by (write) | Matched? |
|---|---|---|---|
| `state:<clip>:<k>` | `c.state.k` (`js/render.js:35`) | `PB.setState` (`js/store.js:390`) | yes, locally. A remote state change arrives as `clips`/`clips:<id>` (`js/store.js:209`; `core.js:96-102`) |
| `local:<clip>:<k>` | `c.local.k` (`js/render.js:37`) | `PB.setLocal` (`js/store.js:384`) | yes (this tab only) |
| `param:<clip>:<name>` | `c.param(name)` (`js/render.js:39`) | **nothing** | never; params reach windows through `clips` → `renderAll` (§4.4) |
| `clip:<clip>` | `c.attr(name)` (`js/render.js:41`) | **nothing** (core emits `clips:<id>`) | never; dead key |
| `coll:<name>` | `Query.all()`, `.get()` (`js/dsl.js:242, 252`) | `core.keysFor` for records, and for clips with a binding (`core.js:99-100`) | yes |
| `collections` | `db.collections()` (`js/dsl.js:283`) | `keysFor('collections', …)` | yes |
| `clips` | `board.clips()` (`js/board.js:615`) | every clip change (`core.js:98`) | yes, but every clip change also triggers `renderAll` |
| `selection` | `board.selection()` (`js/board.js:617`) | the `selection` event (`js/board.js:203, 695`) | yes, through its own listener |
| `log` | `board.log()` (`js/board.js:630`) | the log subscription (`js/store.js:195`) | yes |
| `apps:<name>` | (not tracked) | app record changes, trust (`js/apps.js:81`) | windows of that app are re-rendered directly (`js/board.js:686`) |

### 4.3 How tracking works

There are two channels [read; behaviour run in `exp3-db.out`, `exp4-runtime.out`]:

1. **The context's own `track`** (`js/render.js:15`): `c.state`, `c.local`, `c.param` and `c.attr` always add to *their* window's set, whenever they are called. A read inside an event handler therefore also adds keys (harmless).
2. **The global `PB.track`**: `Query`, `db.collections()` and `board.clips()`, `.selection()` and `.log()` call `PB.track && PB.track(key)`. `PB.track` is set only inside `PB.withCtx(ctx, fn)`, i.e. inside `val()` (`js/render.js:52-54`), and when `items()` evaluates a query (`js/render.js:75`). Outside it, `PB.track` is `null` (`js/render.js:7`) and nothing is recorded.

**Reads that are not tracked** [run]:

- a db read inside a `ui.each` item function or a function-valued `ui.when` branch (§2.5): `exp4b-branch.out` shows `coll:other` tracked through a lambda prop but not through the branch function;
- `db.record(id)`, `db.has(name)` and `Query.schema()`;
- `board.get(id)` and `board.find(q)`.

These windows still often update by accident, through the coarse rules below.

### 4.4 Invalidation (`B.onChange`, `js/board.js:680-694`)

Listeners: `PB.on('mutation')` and `PB.on('change')` both call `onChange(keys)` (`js/board.js:676-677`). Rules, in order:

1. Any key `apps` or `apps:*`: redraw the dock.
2. Any key `clips`: **`renderAll()`**, i.e. every visible window.
3. `clips:<id>`: re-render that window. `apps:<name>`: re-render that app's windows.
4. Otherwise re-render each window whose `deps` contains a changed key, or that has any `coll:*` dep when the key `records` changed.
5. Re-render the groups that contain a touched clip.

Replayed with stubbed rendering [run, `exp4-runtime.out`]:

| Change keys | Re-rendered |
|---|---|
| `state:<this>:n` | this window |
| `state:<other>:n` | nothing |
| `records, records:<id>, coll:recipes` (this window reads recipes) | this window |
| `records, records:<id>, coll:unrelated` | **this window too**: the `records` rule over-invalidates every window that reads any collection |
| `clips, clips:<other>` (another clip moved) | **all windows** |
| `clips, clips:<this>` (this window's param changed) | all windows |
| `local:<this>:q` | this window |
| `apps, apps:probe` | dock and this window |
| `collections, collections:recipes` | nothing (the window did not call `db.collections()`) |

**In a frame there is no dependency tracking in effect.** The frame redraws its whole view on every `sync` message and after each of its own state, local or mutate calls, debounced to one animation frame (`js/frame.js:112-113, 145, 47-62`). The page sends a full board snapshot to every live frame once per animation frame after any change, mutation or selection (`js/frames.js:252-263`).

## 5. The runtime

### 5.1 Boot (`js/main.js:53-87`)

1. `PB.connect()` gets the slop runtime handles (`js/store.js:31-40`).
2. `PB.load()` reads the board's documents into `PB.S` (`js/store.js:152-175`).
3. `PB.apps.seed()` evaluates the built-in sources in the page and keeps their `def`s (`js/apps.js:328-340`).
4. On a fresh board, the counter template is registered (`js/main.js:57`).
5. `PB.board.init()` renders every clip (`js/board.js:671-679`).
6. The subscriptions start, then presence, then the agent.

### 5.2 Drawing an app window

`B.renderClip(id)` (`js/board.js:81-104`):

1. It makes `ctx = PB.makeCtx(clip)` and draws the strip, body, foot and side panel inside `PB.rerender` (`js/board.js:100`), which keeps the focused keyed input and its caret and the scroll positions across the redraw (`js/render.js:195-202`).
2. The body of an app window is `PB.apps.view(clip, ctx)` (`js/apps.js:122-133`):
   - not registered: an error line;
   - untrusted: the trust prompt;
   - framed: `PB.frames.view` (an iframe, which is kept across redraws of the same app version, `js/board.js:90-98, 106-110`);
   - failed to load: the error and an *edit source* button;
   - otherwise: `PB.render(def.toolbar|view|side, ctx)`.

`b.mount(el, ctx)` is `PB.mount`. It empties `el`, appends `render(b, ctx)` and returns `{el, ctx}` (`js/render.js:192`). Without a `ctx`, static builders render, and any lambda prop renders an error element instead [run, `exp8-mutations.out`].

### 5.3 The context (`PB.makeCtx`, `js/render.js:13-51`)

Members [run, `exp4-runtime.out`]:

| Member | Meaning |
|---|---|
| `clip`, `window`, `id`, `def`, `deps` | the window's record, its id, its app's `def`, and the dependency Set |
| `state` (Proxy) | the stored `clip.state[k]`, else the app's declared default, read-time (an object default is copied once per context, `js/render.js:17-32`) [test: `test/render.test.js`] |
| `set(k, v)` / `set({…})` | `PB.setState`: shared, saved with the clip, **not a transaction** (no history, no log) (`js/store.js:386-391`) [run] |
| `local` (Proxy), `setLocal` | this viewer and this tab only (`js/store.js:379-385`) |
| `param(name)` | `clip.params[name]`, else the declared default, else throws listing the declared params (`js/render.js:39`) |
| `setParam(name, v)` | `m.setParam`: **a transaction** (`core.js:183`) [run] |
| `attr(name)` | `clip[name]` |
| `db`, `board` | `PB.db`, `PB.boardAPI` (narrowed in frames) |
| `mutate(fn)` | `PB.mutate(fn, 'app:<name>')` for app windows (`js/render.js:44`) |
| `toast`, `sel()` | `sel()` is the clip's *bound record*, not the board selection (`js/render.js:46`) |
| `agent()`, `apps` | `PB.agent` and `PB.apps`, or `null` and `apps.narrow` (`open`, `list`) for narrow `def`s (`js/render.js:47`; `js/apps.js:100`) |
| `ui`, `fragment`, `ago`, `match`, `clock` | helpers |

### 5.4 Rendering per kind (`js/render.js:97-172`)

Common to every kind (`js/render.js:57-65, 173-182`):

- `styleBox` applies gap and pad (lambdas allowed), w and h, grow, align, justify, wrap, class, style, the small/bold/mono/muted classes and the tooltip;
- the id becomes `data-nid`;
- `hint` becomes a title;
- `selected` adds a class;
- `click` and `dblclick` handlers are wired;
- `menu` registers a node menu (`PB.nodeMenus`);
- `draggable` registers a drag item (`PB.dragItems`);
- `footer` and `after` wrap the element.

| Kind | DOM | Events → handler signature |
|---|---|---|
| text, h, note | `span.t` / `hN` / `div.notetext`, text from `value` | `click (ev, c)` |
| doc | `div.doc`, `innerHTML = PB.md(value)` | |
| image | `figure.img > img`. `src` may be a Blob, an asset ref `blob:<id>` (`PB.blobURL`) or a string; an `http(s)` URL becomes a "cannot load images from the web" card (`js/render.js:102-108`) | |
| link | `a.linkcard`: initial letter, title (`title` prop or host), URL | |
| input | `input.in` or `textarea` (`multiline`, `code`); value from `keyGet`; writes `keySet` on input (debounced by `debounce` ms) | `enter (ev, c)`, `submit (ev, c)` on ⌘/Ctrl-Enter, `change (value, ev, c)` |
| button | `button.btn` | `click (ev, c)` |
| chip | `span.chip` | `click (ev, c)` |
| kv | `dl.kv` | |
| stack, row, list | `div.<kind>` with the children | |
| grid | `div.grid`, `grid-template-columns: repeat(cols)` or `column-count` when masonry | |
| each | `div.each`, one `render(fn(item, i, c))` per item; a failing item becomes an error element; `hint` when empty | |
| when | `span.when` with `render(then or else)`; a branch may be `c => builder` | |
| table | `table.rt`; columns `[key \| {key, label, render}]`, or derived from the first 20 rows; `selected` matches `row.id`; `editable` → dblclick to edit a cell | `row (row, ev, c)`, `edit (row, key, value, c)`; without an edit handler the row is updated directly (`js/render.js:188`) |
| dropzone | `div.dz`. `accepts` matches `item.kind` exactly, `'clip:*'` prefixes, `'Files'` (item has files) or `'text/uri-list'` (item has a URL and no clip id) | `drop (item, c)`, `reject (item, c)` (default: a toast) |
| segmented, select | buttons or `<select>`; options from `options` or the param's | `change (value, c)` |
| toggle | `button.tog` | `change (c)` |
| slider | range input; writes on input | none |
| slot, frame | an empty span; the body | |
| anything else | `⚠ unknown kind` | |

**Keyed inputs** (input, segmented, select, toggle, slider) resolve `key` in this order (`js/render.js:85-86`):

1. `c.local` when `.local()`;
2. a param, when the window has `params[key]` or the app declares it;
3. `c.state`.

### 5.5 Errors

- A throwing node renders `⚠ <kind>#<id>: <message>` in place, with the stack as its title (`js/render.js:55, 184`) [run].
- A throwing `each` item is replaced by its own error element (`js/render.js:137`).
- A throwing handler is logged and toasted as `⚠ <event>: <message>` (`js/render.js:56`) [run].
- A source that fails to evaluate gives an in-page `def.error` (`js/apps.js:88, 128`), or in a frame an `error` message plus a failure line (`js/frame.js:157-160`).

### 5.6 Mutations

`PB.mutate(fn, by, opts)` (`js/store.js:292-297`) runs `fn(m)` against the core recorder (`core.js:128-211`). One call is one transaction:

- it is rolled back in full if `fn` throws (`core.js:216-225`) [test: `core.test.js` "a failing transaction…"; run];
- it is recorded in this tab's history (`js/store.js:277-291`) and written to the shared log (`js/store.js:273-276`; `core.js:267-276`);
- it emits `mutation` with its keys.

`opts.coalesce` merges a transaction into the previous one when both have the same key and are less than 2 s apart (`js/store.js:280`). `PB.readonly` (the agent's Read-only mode) makes every mutation throw (`js/store.js:293`).

Recorder operations: `set`, `get`, `place`, `move`, `resize`, `retitle`, `tag`, `untag`, `setAttr`, `remove`, `group`, `ungroup`, `pin`, `open`, `close`, `setParam`, `setState`, `collection`, `insert`, `update`, `removeRecord`, `removeCollection`, `promote`, `demote`, `register` and `unregister` (`core.js:130-209`). The core checks the caller's level before each write (`core.js:123-126, 132`).

**Bug: the recorder does not chain.** Each operation returns what `m.set` returns, i.e. the new document (`core.js:140, 150-184`), or an id for `place`, `insert` and `promote`. It never returns `m`. Yet the in-app Reference (`js/apps.js:381`), the agent's instructions (`js/agent.js:10`) and the guide (`ex:226-232, 245`) all write `m(x => x.move(id, p).retitle(id, t)…)`. Run as written, `PB.mutate(m => m.move(id, {x, y}).retitle(id, 'new'))` throws `TypeError: m.move(...).retitle is not a function`, and the whole transaction rolls back [run, `exp8-mutations.out`]. The frame's recorder does not chain either (`js/steps.js:217-222`).

### 5.7 Presence

Presence (cursors, selections, drags and views, `js/presence.js:1-11`) is drawn by `presence.js` directly. It is **not an input to apps**: there is no context member and no dependency key for it [read]. Its only effects on windows are re-rendering a clip after someone else's drag ends (`js/presence.js:88`) and redrawing outlines after changes (`js/presence.js:142-143`).

### 5.8 What the agent reads

The agent's context is `PB.describe()` (`js/board.js:655-665`; `js/agent.js:134`), not builder IR. For in-page apps with an open window, it includes `agentDescribe(c)`. Framed apps' `agentDescribe` is not carried over (`ttmp/2026/11/07/SLOP3-016-…/design-doc/01-intern-guide-….md:815`; the frame's `meta` omits it, `js/frame.js:109-110`) [read]. An agent step's return value is printed with `PB.toYAML`, so a returned builder appears as its stripped IR (`js/dsl.js:32`; `js/agent.js:81`).

## 6. Host integration on slop

### 6.1 Manifest and storage

`app.json` declares these capabilities (`app.json:6-16`):

- `db`, with rules for `board` (write: admin) and `apps` (write: self, i.e. nobody but the actor);
- `user`, `room`, `assets`, `downloads` and `sample`;
- the actor `actor.js`;
- the CLI verbs `verbs/*.js` under the alias `pb` (`app.json:17`).

The page maps `PB.S` onto the documents `clips/`, `apps/`, `colls/`, `records/`, `board/meta`, `data/users/<me>/view` and `log/` (`js/store.js:1-19`). Writes are debounced per document (`js/store.js:57-118`). Other people's changes arrive through `onSnapshot` and are applied unless this tab has a pending write on that document (`js/store.js:181-213`).

### 6.2 Registration, versions and trust

1. **Evaluate in the page.** The registering page evaluates its own source narrow, to read the metadata, and sends `{source, note, via:'page', …meta}` to the actor's `registerApp` (`js/apps.js:52-59`).
2. **Write the record.** The actor checks the name and the size (160 KiB), computes `version` and `sha256`, stamps `uid` and `by` from the authenticated visitor, replaces `apps/<name>` whole, and writes `apps/<name>/versions/<n>` (`actor.js:217-253`) [test: `pkg/host/pinboard_apps_test.go:16`, not run here].
3. **Decide whether it runs.** A viewer runs a non-built-in app only if its `uid` is the viewer's, or if the viewer accepted that exact `sha256`. The page hashes the source itself (`js/apps.js:14-19, 71-76`). Consent lives in `data/users/<me>/trust`, or in `localStorage` for viewers (`js/store.js:362-377`).

### 6.3 The sandboxed frame

**Document.** `frames.js` builds one `srcdoc` (`js/frames.js:185-194`):

- the page's `style.css` and the scripts `steps.js`, `frame.js`, `dsl.js` and `render.js`, inlined in that order;
- a CSP `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:` (`js/frames.js:182`);
- the iframe attributes `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"` (`js/frames.js:271-272`).

**Protocol** (`js/frame.js:11-16`; handlers `js/frames.js:214-239`, `js/frame.js:137-163`). The page posts `init` with a `MessageChannel` port; everything after that goes over the port.

| Direction | Message | Handling |
|---|---|---|
| page → frame | `init {app:{name, source, version}, clip, S, local, sel, log, me, theme}` + port | the frame evaluates the source with a narrowed `PB` (no `PB` argument), sends `meta`, draws |
| page → frame | `sync {S, sel, log, theme, ack}` | adopt the copy, re-apply own batches with `seq > ack`, redraw |
| page → frame | `blob {ref, blob}` | the frame makes its own object URL |
| page → frame | `drop {x, y, item}` | the frame finds the `.dz` at that point and fires it; replies `dropped {ok}` |
| frame → page | `meta {def}` | `framedMeta`: `w`, `h`, `state`, `params` (≤ 40) (`js/apps.js:92-99`) |
| frame → page | `set {patch}` | `PB.setState(<this window>, patch)` |
| frame → page | `mutate {seq, ops}` | each op checked by `PinboardSteps.check` (≤ 500), applied in one `PB.mutate` as `app:<name>` under the person's level; then `sync` |
| frame → page | `toast`, `open`, `blob {ref}`, `error`, `dropped` | toast; `apps.narrow.open`; fetch and post the asset; warn; toast |

**What the frame sees** (`js/frames.js:199-203`): every clip, record and collection; the board's shared meta only (not the viewer's view document); the apps' names, titles, icons, authors and versions, but not their sources [test: `test/frames.test.js`].

**Steps** (`js/steps.js:55-128`). One table is used on both sides:

- **In the frame**, `record()` turns calls into data. Function arguments of `update` and `promote` run in the frame, on copies (`js/steps.js:96-126, 138-146`).
- **In the page**, `check()` validates argument shapes and fresh ids and strips `id`, `kind` and `app` from `setAttr` (`js/steps.js:80-83, 149-177`).
- **The overlay.** `optimistic()` keeps the frame's own batches over each synced copy until the page acknowledges them (`js/steps.js:239-263`).
- **Allowed ops:** `place` (not apps), `open`, `move`, `resize`, `retitle`, `tag`, `untag`, `setAttr`, `remove`, `group`, `ungroup`, `pin`, `close`, `setParam`, `setState`, `collection`, `insert`, `update`, `removeRecord`, `promote` and `demote`.
- **Refused:** `register`, `unregister`, `removeCollection`, `set` and `get`.

Evidence: the differential tests run each case through core directly and through record → JSON → check → core, and compare [test: 17 pass]. The protocol was also replayed end to end [run, `exp7-frame.out`]:

- `c.set` sends `set`;
- `db.notes.insert` sends `mutate seq 1` with a frame-made `rec:` id;
- `m.update(…, r => {delete r.old; …})` sends `{set:{t:'one!'}, unset:['old']}`;
- after `sync ack=1`, only batch 2 is re-applied;
- after `ack=99`, the page's copy wins.

**The narrowed board API in a frame** (`js/frame.js:67-89`):

- available: `clips`, `get`, `find`, `selection`, `apps`, `open`, `toast`, `mutate`, `log`, and `clip(spec)`, which takes note, link or doc specs only;
- anything else throws `board.<k> is not available to board apps` [run].

So `c.board.clip(ui.note('x'))` throws in a frame, although the Reference documents builders there (`js/apps.js:378`) [run]. The built-in apps' sources use `board.clip(ui.image(…)).near(…)`, `board.putBlob`, `board.filter`, `board.focus` and `prompt()` (`js/apps.js:199, 257, 264-268`; `js/board.js:16`). A board copy of one of them, which runs framed, loses those features [read].

### 6.4 The page agent

`A.runCode(code)` runs the step as an `AsyncFunction` with the scope `board, db, ui, app, apps, m, describe, log, fragment, PB, select` (`js/agent.js:69-76`). Steps time out after 25 s, and results are cut at 9,000 characters (`js/agent.js:76, 83`). The modes are `auto`, `ask` (each step waits) and `readonly` (`js/agent.js:142-144`).

If the step captured an app, its **whole code** is registered as the source (`js/agent.js:77`). `registerSource` then evaluates it **again**, with `evalSource`'s scope, in a plain (non-async) `Function` (`js/apps.js:38, 53`). Consequences [run, `exp6-agent-step.out`]:

| Step code | Result |
|---|---|
| uses `await` | the registration fails with a `SyntaxError` |
| uses `log`, `m`, `apps`, `describe` or `select` | the registration fails with a `ReferenceError` |
| uses `m(…)` before the app chain | the side effect persists even though the step fails |

The instruction "put ONLY the app chain in a step" (`js/agent.js:11`) is the only guard.

### 6.5 Actor, verbs and the server agent

The actor's actions (`actor.js:60-145, 170-189, 223-271`) and the CLI verbs (`verbs/*.js`) operate on documents through `core.js`. They never evaluate app source or touch builders. The server agent (`actions.ask`) gets data tools only (`actor.js:157-168`).

### 6.6 Permissions at a glance

| Action | Who | Enforced at |
|---|---|---|
| change clips, records or collections | `interact` and above | `core.js:124`; `js/store.js:106`; db rules |
| change board meta | admin | `app.json:8`; `js/store.js:131` |
| register or unregister apps | admin, through the actor only | `core.js:125`; `actor.js:224, 256`; `app.json:9`; `js/store.js:106` |
| run a non-built-in app | its author, or a viewer who accepted that sha256 | `js/apps.js:71-76` |
| a framed app's changes | the steps table, as `app:<name>` at the person's level | `js/steps.js:172-177`; `js/frames.js:232-233` |
| a framed app writes state | `set`: its own window only (`js/frames.js:223`). But the `setState`, `setParam` and `setAttr` steps accept **any** clip id (`js/steps.js:80-90`) [run], so the own-window check in `js/frame.js:45` does not confine an app | |

## 7. Implementation guide

### 7.1 Invariants a change must keep

1. **Builders never change.** Every method returns a builder made through `_p`, `_k`, `_h`, `_a` or `mk` (`js/dsl.js:151-154`), and the Proxy keeps throwing on writes.
2. **Every kind has a `BY_KIND` entry**, so diagnostics and `PB.grammar` stay complete (`js/dsl.js:100-113`). Method names shared between kinds are intentional (`child`, `options`): the "belongs to" diagnostic lists all their owners (`js/dsl.js:112, 139-140`).
3. **`dsl.js` and `render.js` run in two realms.** They may use only the `PB` members that `frame.js` also provides (`js/frame.js:19-97`): `S`, `local`, `clone`, `setState`, `setLocal`, `mutate`, `toast`, `keyStop`, `nodeMenus`, `isAssetRef`, `blobURL`, `boardAPI`, `apps.def` / `_capture` / `narrow`, `agent` and `actor`. New dependencies need a frame implementation, or a guard.
4. **Every changeable value read at render needs a matching key pair:** a `track` call at read time (`PB.track && PB.track(key)`, or the context's own `track`), and an emitter of the same key at write time (`core.keysFor`, or `PB.emit('change', keys)`). Check the key in `B.onChange`'s matching rule (`js/board.js:688`).
5. **All board changes go through `PB.mutate`** (in the page) or the steps table (in a frame), so that they are level-checked, logged and undoable. `PB.setState`, `PB.setLocal` and `PB.quiet` are the deliberate exceptions.
6. **What the page needs about a framed app must be plain data:** `meta` (`js/frame.js:109-110`) and the actor's record (`actor.js:242-247`). Functions cannot cross the frame (`js/steps.js:1-11`).
7. **Source not written by this person is evaluated only in a frame.** §8 B1 records where the current code breaks this.
8. **`PB.render` never throws** (per-node `try/catch`), and handlers are caught and toasted.

### 7.2 Adding a node kind

1. Add a constructor to `ui` with its initial props (`js/dsl.js:162-193`).
2. Add a `BY_KIND` entry with its methods, even if empty (`js/dsl.js:100-111`).
3. Add a `case` in `PB.render` (`js/render.js:97-172`):
   - read lambda props through `val(p.x, ctx)` so that their reads are tracked;
   - use `keyGet`/`keySet` if the kind is bound to a key;
   - fire handlers with `fire(b, ev, ctx, ...args)` and document the signature;
   - keep the common tail (`styleBox`, id, hint, menu, draggable), which the code after the `switch` applies.
4. Builder-valued props are walked into the IR automatically (`js/dsl.js:216`). Prefer them over closures, so that the node stays inspectable.
5. If the kind can stand alone as a clip, extend `board.clip` (`js/board.js:601-609`) and `body()` (`js/board.js:131-150`).
6. Document it in `PB.REFERENCE` (`js/apps.js:347-355`), which people and the agent read.
7. Test it: `dsl.js` and `render.js` have no tests today. A test can load them in `vm` with a small DOM stub, as `test/render.test.js` does for `makeCtx`, or as this ticket's `harness.js` does (§11).

### 7.3 Adding a modifier

Add it to `COMMON` (every kind) or to `BY_KIND` (one kind), and validate its arguments where they are cheap to check, as `px()` does (`js/dsl.js:65-70`). If the value may be a lambda, read it through `val()` in the renderer.

### 7.4 Adding a pass or a check

`buildIR`'s `walk` is the only pass (`js/dsl.js:212-220`). Add per-node checks there, and gate warning-level checks on `PB.strict`, as the `each` check does (`js/dsl.js:218`). Remember that `build()` also runs inside `describe()`, `toYAML()` and fragment queries.

To give the IR real `deps` (the guide's chapter 06), note that lambdas are opaque. One option: record keys per builder during render (`val()` knows the builder being rendered; a `WeakMap<builder, Set>`) and let `buildIR` read them through `node._b`. That gives "deps as of the last render", not static deps. Run a lambda at build time only if it is side-effect free; `c.set` in a prop lambda is not.

### 7.5 Adding a db query form

1. Add a method to `Query` (`js/dsl.js:236-260`). A builder method returns a `new Query(…)`; a terminal method must reach `PB.track('coll:' + coll)` (via `all()` or explicitly).
2. Frame parity is automatic, because `Query` reads `PB.S`, which is the frame's copy there.
3. If the CLI or the actor needs it, add the operator to the separate `core.query` (`core.js:299-308`) and to the actor's `query` schema (`actor.js:161`).
4. Do not store `Query` objects in props if the builder must stay describable, until §3.4's bug is fixed (in `strip`, keep queries as `{query: coll, …}` summaries, or skip `_is*` keys).

### 7.6 Adding a mutation or a frame step

1. Add the operation to the core recorder (`core.js:128-211`) and make sure `keysFor` covers what it changes (`core.js:96-102`).
2. If board apps may call it, add a `steps.js` `OPS` entry with argument kinds, and `record`/`check` functions if it takes functions or fresh ids (`js/steps.js:55-128`). Add a case to the differential test (`test/steps.test.js:51-112`), and to `applyLocal` if later steps must see its effect (`js/steps.js:186-205`).
3. Update the Reference and the agent instructions.

### 7.7 Tests

| Test | Covers | Run | Result here |
|---|---|---|---|
| `apps/pinboard/test/core.test.js` | equality, segments, ids, transactions and rollback, revert, levels, query, describe, log trimming, sha256, register | `node --test apps/pinboard/test/core.test.js` | 13 pass |
| `apps/pinboard/test/steps.test.js` | the frame step table, differential | `node --test apps/pinboard/test/steps.test.js` | 17 pass |
| `apps/pinboard/test/render.test.js` | `makeCtx` read-time defaults | `node --test apps/pinboard/test/render.test.js` | 2 pass |
| `apps/pinboard/test/frames.test.js` | frame snapshot contents, sync listeners | `node --test apps/pinboard/test/frames.test.js` | 2 pass |
| `pkg/host/pinboard_test.go`, `pinboard_apps_test.go`, `pinboard_verbs_test.go` | boards on a host, app registration through the actor, verbs | `GOWORK=off go test ./pkg/host/ -run Pinboard` (`Makefile:11-12`) | **not run** in this session |

Name each JS test file: `node --test <dir>` does not work with this Node (`ttmp/2026/11/07/SLOP3-016-…/reference/01-diary.md:410`). **Nothing tests `dsl.js`** (the builders, the IR, diff, the diagnostics, fragments, queries) **or `PB.render`**.

## 8. Known gaps, bugs and sharp edges

Severity: **B** is a bug, **S** a sharp edge or design gap, **G** a gap (designed, not built).

| # | Kind | What | Where | Evidence |
|---|---|---|---|---|
| B1 | B (security) | *Describe IR* in the built-in editor runs `evalSource(c.state.src)` **not narrow, in the page realm** (`PB` passed, and `window` reachable in any case). `state.src` is shared window state: anyone at `interact` can type into it, and a framed app can set it with an `m.setState(editorId, {src})` step. The source of any app, untrusted included, can also be loaded into the editor with *edit source* (`js/board.js:168, 555`; `js/apps.js:116-121`). Pressing *Describe IR* then runs that code as the viewer, with `window.PB` (and on slop `window.claude`), bypassing the trust prompt, whose text promises a frame (`js/apps.js:144`). *Register* also evaluates the source in the page before the actor refuses a non-admin (`js/apps.js:53, 58-59`). | `js/apps.js:220, 35-44` | [run] `exp5-editor.out`: `window.__ran = {PB:'object', rt:[…]}` |
| B2 | B | The mutation recorder does not chain, but the Reference, the agent's instructions and the guide chain it; a chained call throws and rolls back | `core.js:130-184`; `js/apps.js:381`; `js/agent.js:10` | [run] `exp8` |
| B3 | B | A `Query` in a prop (`ui.each(db.x…)`, `ui.table(db.x…)`) breaks `describe()`, `toYAML()`, *Describe IR* and `PB.toYAML(builder)`: `v.all is not a function` | `js/dsl.js:226, 33` | [run] `exp1b` |
| B4 | B | `ir.diff(builder)` throws, although the code tries to accept a builder (`other.root` goes through the builder Proxy) | `js/dsl.js:222` | [run] `exp1` |
| B5 | B | An agent step that registers an app is evaluated twice, with two different scopes; `await`, `log`, `m` and the like break registration, and side effects before the chain persist | `js/agent.js:77`; `js/apps.js:38` | [run] `exp6` |
| B6 | B | A schema declared at the top of an app's source writes the collection on every evaluation (each load, each frame, each viewer), and throws for viewers in the page | `js/dsl.js:263-274` | [run] `exp10` |
| S1 | S | The IR has no deps and no edges; `edges` is a getter, not the guide's function; nothing at runtime uses the IR | `js/dsl.js:215, 222` | [run] |
| S2 | S | Invalidation is per window and coarse: any clip change re-renders every window (`clips` → `renderAll`); any record change re-renders every window that reads any collection | `js/board.js:682, 688` | [run] `exp4` |
| S3 | S | Untracked reads: `ui.each` item functions, `ui.when` branch functions, column `render`, `db.record`, `db.has`, `.schema()`, `board.get` and `board.find` | `js/render.js:137-138, 146`; `js/dsl.js:285-286, 257` | [run] `exp3b`, `exp4b` |
| S4 | S | Dead dependency keys: `param:*` and `clip:*` are tracked but never emitted | `js/render.js:39, 41` | [read] (grep for emitters) |
| S5 | S | Immutability holes: shallow freeze, no `deleteProperty` trap, `attrs` shared and mutable, the IR's `attrs` is the builder's live object, `app().build()` returns a mutable `def` | `js/dsl.js:150-154, 215, 311` | [run] `exp2` |
| S6 | S | Auto ids are positional (`kind#n`, pre-order) and shift when a node is inserted; duplicate explicit ids are not detected; `node(id)` returns the last one | `js/dsl.js:214, 219` | [run] |
| S7 | S | `kids()` flattens one level only; deeper arrays become array children | `js/dsl.js:161` | [run] |
| S8 | S | Fragment `.on(ev)` hooks are never invoked; `.global()` cannot override built-in methods; fragment names are global and last-writer-wins | `js/dsl.js:137, 203, 206` | [run] |
| S9 | S | `.agent.allow` and `.agent.suggest` are stored and never read | `js/dsl.js:317` | [read] (grep) |
| S10 | S | `.required()`, `.auto()`, `.index()`, `.store()` and field types are recorded and never enforced or used | `js/dsl.js:268-272` | [run] (required), [read] (rest) |
| S11 | S | The comparator treats missing sort values as equal, so the order of rows without the field is arbitrary | `js/dsl.js:245` | [run] |
| S12 | S | `.bind()` writes `props.value`, which input, link and button ignore; `.draggable` payloads get `c`, not the item | `js/dsl.js:80`; `js/render.js:180` | [read] |
| S13 | S | No re-entrancy guard: a prop lambda that writes state during render re-triggers its own window synchronously | `js/store.js:386-391`; `js/board.js:677, 689` | [read] |
| S14 | S | Frames: a full board snapshot is posted per animation frame to every live frame, and the whole frame view redraws on each sync; node menus and drags do nothing in a frame (no UI for them in `frame.js`) | `js/frames.js:252-259`; `js/frame.js:145` | [read] |
| S15 | S | `PB.setState` (`c.set`) is neither a transaction nor in the log: not undoable, and not attributed | `js/store.js:386-391` | [run] |
| S16 | S | `let seq = 0` in `dsl.js` is unused | `js/dsl.js:148` | [read] |
| S17 | S | Offline (no slop runtime), an app the person registered has `uid: null` and no stored trust, so even their own app gets the trust prompt | `js/apps.js:63, 74`; `js/store.js:154-157` | [read] |

## 9. The guide's chapters against the code

"Code" is what `apps/pinboard` does at `f5bc6b2`. Where the two disagree, the code is the behaviour and the guide is a wish (as the SLOP3-016 guide already says for some of these, `…/design-doc/01-intern-guide-….md:180-187`).

| Ch. | Guide says | Code does | Evidence |
|---|---|---|---|
| 00 | `import { ui, app, board, db, fragment, split, tile } from 'pinboard'` (`ex:2`) | names are `Function` parameters; no `split`/`tile` (`js/apps.js:38`) | [read] |
| 00 | `ui.link(url)` "unfurls title and favicon at runtime" (`ex:6`) | initial letter, `title` prop or host; no fetch (`js/render.js:109-113`) | [read] |
| 00 | tokens `xs s m l` (`ex:16`) | also `xl: 24` (`js/dsl.js:64`) | [run] |
| 00 | `.bind(c => …)`: "the node's deps are what the lambda read" (`ex:19`) | reads go to the window's set; node deps stay `[]` | [run] |
| 00 | `.ref()`, `.at(x, y)`, `.near(window)` on builders (`ex:22-23`) | no `ref`; `at` and `near` exist only on `board.clip(…)`'s placer (`js/board.js:594`) | [run] |
| 00 | `.mount(el)` → "a live view with .state and .mutate()" (`ex:27`) | `{el, ctx}`; needs a `ctx` for any lambda (`js/render.js:192`) | [run] |
| 00 | `.describe()` → "what the agent reads" (`ex:28`) | the agent reads `PB.describe()` of the board (`js/agent.js:134`) | [read] |
| 01 | lands "snapped to the 24 px grid" (`ex:36`) | cursor + cascade, snapped to 8 px (`js/board.js:27, 32`) | [read] |
| 02 | `board.on('paste', …)`, `board.on('paste:url')`, `ui.arena` (`ex:38-47`) | no `board.on` (`TypeError`); paste is fixed code (`js/board.js:35-59`) | [run] |
| 03 | `.size('xl')` on text (`ex:54`) | sets `w: 'xl'` (an invalid CSS width) | [run] |
| 03 | register keeps `{source, icon, title, params, ir}` in localStorage (`ex:63`) | `apps/<name>` in the slop db, through the actor, no IR (`actor.js:242-250`) | [read] |
| 03 | a closed window's state "kept under its window id" (`ex:64-65`) | `m.close` deletes the clip (`core.js:182`) | [read] |
| 04 | `db.gallery.orderBy(c => c.param('sort'))` (`ex:75`) | the function gets each record: `TypeError: c.param is not a function` | [run] |
| 04 | params "become a side column" | yes: the ◇ panel (`js/board.js:154-173`) | [read] |
| 05 | `.on('paste', …)` lifecycle hook (`ex:96`), `board.clipDefaults` (`ex:104`) | hooks never run; no `clipDefaults` (fixed `B.clipFrags`, `js/board.js:24`) | [run] |
| 05 | `ui.text('x').tag('a')` error text (`ex:108`) | identical | [run] |
| 05 | a global fragment "can also extend a whole grammar entry" with `method('size', …)` (`ex:111`) | can add, cannot override `size` | [run] |
| 06 | `ir.node('results').deps`, `ir.edges()`, node-to-node edges, `c.ir(id)`, `ui.ref`, topological re-render (`ex:112-141`) | `deps: []`, `edges` a getter returning `[]`, `ir.edges()` throws, no `c.ir` or `ui.ref`, whole-window re-render | [run] |
| 06 | YAML with `writes: state.q`, `template: link` (`ex:125-130`) | neither field exists; `each` shows `src: λ, fn: λ`; with a query source, YAML throws (B3) | [run] |
| 06 | `diff` → `[{op:'set', at:'/', prop:'gap', …}]` (`ex:134`) | `[{op:'set', at:'/props/gap', from, to}]` | [run] |
| 06 | `db.links.where(c => l => …)` (`ex:115`) | predicates take the record; a curried predicate returns a function, which is truthy, so nothing is filtered | [run] |
| 07 | `.store('indexeddb')` (`ex:151`) | recorded only; everything is in the slop db | [read] |
| 07 | `promote('recipes', clip => ({… clip.link?.url, clip.attr('note')}))` (`ex:159-161`) | the mapping gets the plain clip document: `clip.attr is not a function` | [run] |
| 07 | `db.recipes.get(4).toClip()` (`ex:164`) | no `toClip` (`TypeError`) | [run] |
| 07 | migrations with `rename` (`ex:167`) | works | [run] |
| 08 | `payload: im => …` (`ex:170`) | payload gets `c` | [read] |
| 08 | `board.quicklaunch.on('drop')`, `c.agent.ask`, `board.targets.list()` (`ex:184-194`) | none exist. Targets in code: dropzones, app frames, a clip's strip (group), the dock (prefills the agent), the agent composer, the pin column, the canvas (`js/board.js:242-260, 286-303`) | [read] |
| 09 | `gap('big')` message with a source span (`ex:196-199`) | same sentence (plus `'xl' 24`), no span; no `Error.captureStackTrace` | [run] |
| 09 | `colums` → "Did you mean "cols"? cols is on grid" (`ex:201-203`) | "Did you mean "class"?" (nearest within stack and common methods) | [run] |
| 09 | an `each` without an id warns at build (`ex:205-206`) | silent; an error only in strict mode | [run] |
| 09 | an undeclared state key is an error at build (`ex:208-209`) | no such check | [run] |
| 09 | `fill` without a slot (`ex:211-212`) | identical message | [run] |
| 09 | a discarded result warns (dev finaliser) (`ex:214-215`) | nothing | [run] |
| 09 | "the agent runs in strict" (`ex:221-222`) | `PB.strict` is unset during agent steps | [run] |
| 10 | `board.handle()`, `h.on('mutation', {ops, by, at})`, `h.history.since(…)` (`ex:224-236`) | no `handle`; `PB.on('mutation', (tx, keys))` internally; `board.history()` is the last 20 lines | [run] (handle) |
| 10 | chained recorder `m.move(…).retitle(…)…` (`ex:226-232, 245`) | does not chain (B2) | [run] |
| 10 | op set incl. `restore`, `place(builder, at)`, `migrate`, `unpin`, layout ops (`ex:238-242`) | the core set (§5.6); `pin(id, false)` unpins; no layout ops | [read] |
| 11 | `board.agent({tool, scope, mode, context, limits})` (`ex:247-253`) | fixed in `agent.js`; one `eval` tool, modes, 25 s, 9,000 characters all match (`js/agent.js:76, 83, 137-146`) | [read] |
| 11 | `.agent.allow`: "beyond this, mode 'ask' applies even in 'auto'" (`ex:277`) | never read | [read] |
| 11 | `pin:recipes/9` links in answers (`ex:280`) | only `clip:<id>` ids are linked (`js/agent.js:54`) | [read] |
| 12 | `split`, `tile`, `board.layout`, `board.layouts.save/load`, `m.free`, `m.pin(id, {tile})` (`ex:282-300`) | none; pinning moves a clip to the side column (`core.js:175`; `js/board.js:86`) | [run] (layout) |
| 13 | `.on('image', async …)` hook (`ex:304`) | never called | [run] (hooks) |
| 13 | `.map(b => c => …)`: "build-time shape, runtime switch" (`ex:335`) | `map` must return a builder: `TypeError` | [run] |
| 13 | `c.sel()` as the selected image (`ex:345-347`) | the clip's bound record (`js/render.js:46`) | [read] |
| 13 | free `ago(…)`, `match(…)` in source (`ex:332, 345`) | the source scope has `helpers.ago`; inside lambdas use `c.ago` (`js/apps.js:39`; `js/render.js:48`) | [read] |
| 13 | "The IR has 11 nodes and these runtime edges" (`ex:354-356`) | no edges | [run] |

The in-app Reference (`js/apps.js:343-388`) is closer to the code than the guide, but it shares B2 (chaining) and B3 (a query as an `each` source). It also promises that a context lambda "is re-run when what it read changes", which §4.3–4.4 qualifies.

## 10. References

- Grammar, IR, queries, schema, `app()`: `apps/pinboard/js/dsl.js`.
- Renderer and context: `apps/pinboard/js/render.js`.
- Windows, invalidation, board API, fragments on clips, menus, drop targets: `apps/pinboard/js/board.js`.
- Registry, trust, built-in app sources, the Reference text: `apps/pinboard/js/apps.js`.
- Store, transactions, undo, trust storage: `apps/pinboard/js/store.js`; core operations: `apps/pinboard/core.js`.
- Frame protocol: `apps/pinboard/js/frame.js`, `apps/pinboard/js/frames.js`, `apps/pinboard/js/steps.js`.
- Agent: `apps/pinboard/js/agent.js`. Actor: `apps/pinboard/actor.js`. Manifest: `apps/pinboard/app.json`. Boot: `apps/pinboard/js/main.js`.
- Tests: `apps/pinboard/test/*.test.js`; `pkg/host/pinboard_test.go`, `pkg/host/pinboard_apps_test.go`, `pkg/host/pinboard_verbs_test.go`.
- The design guide (wireframes, pipeline, 14 examples): `ttmp/2026/11/07/SLOP3-016-…/sources/pinboard-api-examples-and-wireframes.{html,md}`, code in `…/pinboard-api-examples-code.txt`; the original prototype in `…/sources/pinboard-prototype/` (its `dsl.js` differs from today's only by `.local()` and the `app()` builder moving in).
- Background: `ttmp/2026/11/07/SLOP3-016-…/design-doc/01-intern-guide-pinboard-on-slop-….md` (§3.1, §4.3, §4.6, §6.8, §13); `ttmp/2026/11/07/SLOP3-017-…/design-doc/01-design-addressing-the-codex-review-findings-….md` (F1 trust, F6 step table, F7 read-time defaults).

## 11. Experiments

The scripts and outputs are in this ticket's `scripts/pinboard/`.

`harness.js` loads the page scripts in `index.html` order (without `main.js`) into a Node `vm` context with a minimal DOM stub, offline (`PB.rt.db` is null, the level is `owner`). Each script takes the app directory as its argument: `node expN-….js <checkout>/apps/pinboard > expN-….out`.

| Script | Shows |
|---|---|
| `exp1-ir.js` | IR members, ids and paths, `toYAML`, `diff`, `edges`, strict mode, the guide's chapter 06 |
| `exp1b-query-prop.js` | B3 |
| `exp2-grammar.js`, `exp2b-kids.js` | immutability, diagnostics, fragments, `app()`, children |
| `exp3-db.js`, `exp3b-record.js` | schema builder, queries, tracked keys, change keys |
| `exp4-runtime.js`, `exp4b-branch.js` | render, context, deps, events, the `B.onChange` replay |
| `exp5-editor.js` | B1 |
| `exp6-agent-step.js` | B5 |
| `exp7-frame.js` | the frame protocol end to end (steps, frame, dsl, render in the frame's order) |
| `exp8-mutations.js` | B2, `mount`, the missing board API |
| `exp9-counter-ir.js` | §3.6 |
| `exp10-schema-eval.js` | B6 |

Not verified by running:

- anything that needs a browser: layout, CSS, real DOM events, iframe sandboxing and CSP, `postMessage` structured cloning;
- the Go host tests;
- behaviour against a slop server (writes, subscriptions, the actor).

---

# Part III: What needs doing, ranked

These are the findings that call for a change, from both parts, in the order I would take them. Each one cites the part and the row where its evidence is. Spore's fixes need a decision first (III.1); Pinboard's are slop's own code.

## III.0 The decision Spore's fixes need

`spore.js` and `blocks.js` are upstream files, and `apps/upstream/blocks/build.sh` refuses to build if their checksums differ from `SHA256SUMS` (Part I §11.1). Every Spore fix below therefore means either reporting it upstream, or deliberately forking: change the file, update `SHA256SUMS`, and record the divergence. Until that is decided, the Spore rows are documentation for people writing programs: avoid the pattern, or read the IR with the caveat.

## III.1 Ranked list

| Rank | System | What | Why it ranks here | Evidence | Fix |
|---|---|---|---|---|---|
| **P1** | Pinboard | *Describe IR* in the built-in App editor runs the editor's source in the page realm, not narrowed and not sandboxed. The source box is shared window state, so anyone at `interact`, or a framed app through a `setState` step, can stage code that runs with the viewer's full page authority when the viewer clicks the button. This bypasses the trust prompt. *Register* also evaluates in the page before the server refuses a non-admin. | It is a security bug: it breaks the rule stated at `js/apps.js:31-34` ("its source is never evaluated here, except by registerSource") | II §8 B1; lead re-check of `js/apps.js:35-44`, `:220` | Describe in the sandboxed frame, as other apps run; or describe without evaluating; or show the button only for source the viewer wrote or trusts. Evaluate *Register*'s source only after the server check, or in the frame. A test that a staged `src` cannot reach `window.PB`. |
| **P2** | Pinboard | Mutations don't chain, though the in-app Reference, the agent's instructions and the guide chain them; the chained form throws and rolls back the change | The agent is taught a form that always fails | II §8 B2 (`core.js:130-184`; `js/apps.js:381`; `js/agent.js:10`) [run] | Make each op return the recorder (keep `m.set`'s return value under another name), or fix the three texts; the first matches what writers expect |
| **P2** | Pinboard | An agent step that registers an app is evaluated twice in two scopes; `await`, `log` or `m` break registration, and side effects before the chain stay | It silently breaks agent-written apps | II §8 B5 [run] | Evaluate once, capturing the registration; or forbid side effects before the chain and say so in the instructions |
| **P2** | Pinboard | A schema declared at the top of an app's source writes the collection on every evaluation (each load, each frame, each viewer), and throws for read-only viewers in the page | Writes per view; failures for guests | II §8 B6 [run] | Apply schemas at registration (or diff before writing) |
| P3 | Pinboard | `describe()`, `toYAML()` and *Describe IR* throw on a live query in a prop; `ir.diff(builder)` throws | Inspection breaks for common apps | II §8 B3, B4 [run] | Serialise a `Query` as its description; unwrap builders in `diff` |
| P3 | Spore | `ir().order` drops every node on or downstream of a "cycle", and state↔state reads (legal) count as one: `wild` orders 7 of 14 nodes, `home` 19 of 27 | The IR the studio and agent read is wrong for ordinary programs | I §12.1 B2 [run E06]; lead re-check of `src/spore.js:688-694` | Leave state→state edges out of the ordering (they are previous-tick reads), and append unordered nodes with a diagnostic |
| P3 | Spore | `$.push/$.toggle/$.inc` refuse `desk.` paths; only `$.set` writes the desk | The textbook says all four take them | I §12.1 B1 [run]; lead re-check of `src/spore.js:414-422`, `557` | Route the three through `write()`'s `desk.` branch |
| P3 | Spore | A state step that mutates `prev` and returns it never changes (identity compare on the live value); LINK's probe passes a clone, so the probe and the tick disagree | A natural JS idiom silently freezes state | I §12.1 B3 [run]; lead re-check of `src/spore.js:597`, `601`, `538` | Pass `clone(c.value)` in the tick too, or document "return a new value" in the textbook's tick rule |
| P3 | Spore | View edges exist only after painting and accumulate forever; a once-visible branch keeps the program ticking | The IR's view reads lag and over-approximate | I §12.2 S1, S2 [run] | Reset a view's edges at the start of each paint |
| P4 | Spore | Smaller bugs: a syntax error placed on the last line, `$.get("a.b.c")` crashing with a TypeError, shared error slot for anonymous button actions, the in-page Claude taught `$.workspace…` (Blocks' rewrite) | Each misleads, none corrupts | I §12.1 B4–B7 [run] | One-line fixes each, once III.0 is decided |
| P4 | Pinboard | The guide's DAG: `deps`/`edges` empty, `ir.edges()` (a function in the guide) is a getter; coarse invalidation; untracked reads (`ui.each` items, `ui.when` branches, `db.record`); `param:*` and `clip:*` keys never emitted | The guide promises a compiler that does not exist | II §4, §8 S1–S4 [run] | Decide: build the graph (track per node, as Spore does) or rewrite the guide's chapter 06 to describe per-window keys. Track the missing reads either way |
| P4 | Pinboard | The guide's unimplemented chapters (`ui.ref`, layouts and tiles, paste hooks, build-time warnings, `toClip`, lambda `orderBy`/`where`); fragment `.on()`, `.agent.allow/suggest` stored but unused | Writers and the agent are told about features that do nothing | II §9, §8 S8–S10 | Mark them "not built" in the guide and the Reference until built |
| P5 | Both | Textbook/guide wording against the code (Spore: link-time resolution, cycles found only at link, "does not tick at all", `cc5.spore`, `KINDS`) | Documentation accuracy | I §12.3; II §9 | Edit the texts, mostly the documentation side |

## III.2 What this document does not cover

- **Behaviour in a browser:** canvas output, DOM events, iframe sandbox and CSP, `postMessage` cloning.
- **Pinboard on a slop server:** the actor, server writes and subscriptions.
- **The Go host tests,** which were not run for this document (Part II §11).
- **The studio UI and the agents of either system,** beyond what they show of the IR.
