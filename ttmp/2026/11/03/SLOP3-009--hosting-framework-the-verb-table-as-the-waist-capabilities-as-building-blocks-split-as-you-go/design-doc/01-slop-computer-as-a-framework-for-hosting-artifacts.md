---
Title: slop-computer as a framework for hosting artifacts
Ticket: SLOP3-009
Status: active
Topics:
    - architecture
    - hosting
    - backend
    - agents
    - llm
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/verbs/verb.go
      Note: today's Verb, Arg and table; the waist this design widens
    - Path: repo://pkg/verbs/env.go
      Note: verbs.Env, the god object and its three callbacks
    - Path: repo://pkg/server/views.go
      Note: the page protocol's own RPC dispatch (db, files, sample), outside the verb table
    - Path: repo://pkg/server/modules.go
      Note: modFunc, trusted Go modules as verb calls; the pattern every door should follow
    - Path: repo://pkg/actor/modules.go
      Note: the actor's second implementation of db, sql, files
    - Path: repo://pkg/server/sample.go
      Note: the page side of sample; pkg/actor/sample.go is the actor side
ExternalSources:
    - https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs
Summary: 'Make the verb table the one place an operation exists: doors (page protocol, CLI, HTTP, MCP, actor use(), trusted modules) are projections of it, capabilities (db, sample, files, room…) are packages that contribute verbs, domains own their tables, and a host product is a short main. Verbs are described by Go types turned into JSON Schema with x-slop keywords; glazed is generated for the CLI; protobuf waits for a second process. Code moves toward this map whenever a feature touches it.'
LastUpdated: 2026-11-03T13:31:20.811022695-05:00
WhatFor: The target package layout, dependency rules and verb description format for slop-computer, and the order in which to get there.
WhenToUse: Read before moving code between packages, adding a capability or a door, changing verbs.Verb, or building a second host product from slop's parts.
---

# slop-computer as a framework for hosting artifacts

## 1. Summary

slop-computer already has one unifying idea, the **verb table**. The CLI, the HTTP API and eval programs are generated from it, and since SLOP3-002 trusted Go modules for actors are verb calls too. Two doors do not use it. The page protocol has its own RPC dispatch, and actor modules are a third implementation of `db`, `files` and `sample`. Around those two exceptions, three packages (`server`, `verbs`, `system`) have become knots that mix every domain.

This document proposes a target shape and a way to reach it.

- **The verb table is the narrow waist.** Every operation exists once, as a verb. A **door** turns its own request shape into a verb call with a principal. The doors are the page protocol, the CLI, the HTTP API, MCP, actor `use()` and trusted modules.
- **A capability is a package.** Capabilities are named after the contract's `use()` names: `db`, `sample`, `files`, `room`, `user`, `assets`, `downloads`, `storage`. Each package contributes verbs, a grant rule, policy cells, its part of `claude.js` and, optionally, tables.
- **A domain owns its tables and registers its verbs:** registry, identity, billing, llm, policy.
- **A host product is a short `main`** that chooses domains, capabilities and doors. Today's multi-tenant slop is one; a desktop host, an MCP agent host and a static exporter are others.
- **Verbs are described by Go types,** turned into JSON Schema with `x-slop-*` keywords. glazed sections for the CLI are generated from that schema. Protobuf is reserved for a process boundary that does not exist yet.
- **Split as you go.** No pull request only moves code. Each feature moves the code it touches toward the map in §10.

This started as a design brainstorm, published as an artifact at <https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs>; its source is `various/01-hosting-framework-artifact.html`. The schema question (§5) and the order of work (§11) were settled afterwards in conversation and are recorded here as decisions.

## 2. Where the code is

Non-test Go lines on `main` at 35a4347, after SLOP3-008:

| Package | Lines | What it mixes |
|---|---:|---|
| `pkg/server` | 5,884 | four HTTP hosts (main, live, static, sandbox); sign-in (`auth`, `oidc`, `device`); the page protocol (`views.go`, 1,311 lines); page capabilities (`sample`, `rtassets`, `rtfiles`); since SLOP3-008 also the path space (`space.go`) and registry documents (`registry.go`); Stripe webhooks; the back office bridge |
| `pkg/verbs` | 3,294 | the table machinery *and* every domain's commands; imports `actor`, `kernel`, `store`, `system`, `billing/stripe` |
| `pkg/system` | 3,127 | one database, six domains: identity, registry, app governance, billing, LLM access, the budget ledger |
| `pkg/actor` | 2,945 | the goja runtime *and* its own `db`, `sql`, `files`, `sample`, `storage` |
| `web/runtime` | 2,068 (TS) | the contract's client side: `db.ts`, `caps.ts`, `sample.ts`, `room.ts`, `transport.ts` |

Three problems follow from this layout.

1. **Capabilities are implemented twice.** Page `db` is in `server/views.go` and actor `db` in `actor/modules.go`. `sample` is split between `server/sample.go` and `actor/sample.go`. SLOP3-008's path space reached pages only: actors' `use('db')` still sees only its own store, because their `db` is the other implementation.
2. **Dependencies are wired with callbacks.** `verbs.Env` carries `AccessChanged`, `PolicyChanged` and `PersonChanged`, so commands can tell the server to recheck views. The system log already records every one of those changes.
3. **A package name tells you a layer, not a domain.** Identity is spread across `system/{people,sessions,device,flows,handoffs,guests}`, `server/{auth,oidc,device,sitelinks}` and `verbs/people`.

```text
 slop CLI     HTTP /api/v1    trusted modules     page protocol      actor use()
    │              │                │ modFunc→verb       │                 │
    ▼              ▼                ▼                    ▼                 ▼
 ┌──────────── verbs table (83 verbs) ─────────┐   ┌──────────┐     ┌──────────────┐
 │ pkg/verbs · Env holds everything            │   │ page RPC │     │ actor modules│
 └───────┬───────────────────────────┬─────────┘   │ db files │     │ db sql files │
         │        Env callbacks ┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄▶ │ sample   │     │ sample       │
         ▼                           ▼             └────┬─────┘     └──────┬───────┘
   system.db (six domains)        stores ◀──────────────┴──────────────────┘
```

## 3. Terms

| Term | Meaning here |
|---|---|
| **verb** | one named operation with typed input and output, an effect, a subject and an authority floor; the unit of authority, audit and documentation |
| **door** | a transport that turns its request shape into verb calls with a principal: page protocol, CLI, HTTP API, MCP, actor `use()`, trusted modules |
| **capability** | a contract `use()` name (`db`, `sample`…) as a package: verbs plus a grant rule, policy cells, client code and optional tables |
| **domain** | a part of the platform that owns tables and registers verbs: registry, identity, billing, llm, policy |
| **host product** | a `main` that assembles domains, capabilities and doors |

```text
host products    slop (tenants) · desktop host · MCP agent host · static exporter    a main.go each
doors            page protocol · CLI · HTTP API · MCP · actor use() · Go modules    transport → verb call
═══ verb table   name · input schema · output · effect · subject · Run(call, in)    the narrow waist ═══
capabilities     db · sample · files · room · user · assets · downloads · storage   contract use() names
domains          registry · identity · billing · llm · policy · kernel              own tables + verbs
core             store · rt (contract) · access · blobs · sysdb · actor             no HTTP, no policy
                 (each layer depends only on the layers below it)
```

## 4. The verb table as the waist

### 4.1 Today's verb

```go
type Verb struct {
	Name      string       // group.name, e.g. "grant.set"
	Doc       string
	Args      []Arg        // name, type (string|int|bool|json), position, required, doc
	Scope     Scope        // read | write: what a token's scopes must include
	AdminOnly bool
	Action    authz.Action // the authority floor, checked before Run
	StoreArg  string       // which argument names the store the floor is about
	Run func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error)
}
```

That suits request/response operations made by a person or a token. The page protocol needs three things it lacks, which is why it grew its own dispatch:

- a principal that is a **viewer inside a view**, with the view's `rt.Space`, granted capabilities and policy cells;
- results that **stream** (sample deltas, subscriptions);
- the **contract's error shapes** rather than the CLI's.

### 4.2 Verb v2

A sketch. The names are proposals.

```go
type Def[In, Out any] struct {
	Name    string       // "db.write", "grant.set", "sample.run"; the name "verb" stays
	Doc     string
	Effect  Effect       // Read | Write | Govern (the person confirms) | Stream
	Subject Subject      // Platform | Store(field) | View: what the authority check is about
	Floor   authz.Action
	Hidden  bool         // internal (page RPCs): not listed in `slop --help`
	Run     func(c Call, in In) (Out, error)
}

// Call is what every Run receives, whichever door it came through.
type Call interface {
	context.Context
	Principal() *access.Principal // a person, a token, a store, or a viewer in a view
	View() *rt.View               // nil outside a page or an actor event
	Emit(v any) error             // stream a partial result (Effect Stream)
}
```

Three of these properties do most of the work.

- `Subject: View` lets `db.write` be an ordinary verb whose authority check reads the view: its level, its `rt.Space` and its rules.
- `Effect: Govern` moves the confirmation flow from `modFunc{Confirm: true}` into the verb. A governance change then asks the person whichever door called it. SLOP3-008 had to add this by hand for registry-document writes.
- `Emit` gives `sample` and `subscribe` a way to stream through the same table.

Dependencies come from the package that registered the verb, not from a global `Env`.

```text
 page ──RPC──▶ page door ──Call──▶ verb db.write ────▶ caps/db ───────────▶ store turn
 doc.set()     principal =         effect · floor      rt.Space → store,    commit + log
               viewer in view      · audit             rules                    │
                    ▲                                                           │
                    └──── the log feeds the stream of every view that follows ──┘
 the CLI, MCP and actors call the same verb with their own principal
```

### 4.3 Costs

- **Hot path.** Pages issue many `db.query` and `db.get` calls. Going through the table adds a map lookup, a floor check and a principal per call. Store work dominates, but this must be benchmarked before and after (§11, step 4).
- **Meaning of the table.** Verbs today are commands an operator runs. Page RPCs as verbs puts high-rate browser calls in the same table. Hence `Hidden`, and an audit policy that records reads by sampling or not at all.

## 5. Describing verbs: the schema decision

### 5.1 What has to be described

An argument today is `{name, type, pos, required, doc}`. Counting the table on `main`:

| Argument type | Count |
|---|---:|
| `string` | 117 |
| `int` | 14 |
| `bool` | 10 |
| `json` | 19 |

About 88% are flat scalars. The 19 `json` arguments are the ones agents and MCP care about most:

- `docs.set` data and batch, and `docs.query` where;
- `files.push` files and blobs;
- `actor.call` args and `sql.query` args;
- `mount.set` aliases and the `import` bundle.

Their shape exists only in a `Doc` string such as `[{path, data, ifVersion?}]`.

A description must also cover:

- **outputs**, which are undescribed today;
- **verb-level metadata**: effect, subject, floor, confirmation;
- **dynamic verbs**: actor actions and trusted-module functions, defined at run time;
- **the page protocol**, whose shapes are set by claude.ai's `.d.ts` files. We conform to it; we do not define it.

### 5.2 Options considered

| | glazed field definitions | protobuf | JSON Schema from Go types, plus `x-slop` |
|---|---|---|---|
| Scalars, enums, secrets | yes (`TypeChoice`, `TypeSecret`) | yes | yes (`enum`; `x-slop-secret`) |
| Nested values | only file-loading types (`objectFromFile`), a CLI idea | messages; arbitrary JSON becomes `Struct`/`Value` | native |
| Outputs | rows (glaze output) | messages | native, including streams as typed events |
| Dynamic verbs (app actions) | no | `dynamicpb`, unnatural | native: `actions: {add: {input: {…}}}` |
| Matches the contract's JSON | n/a | no: protojson encodes `int64` as strings (`version`, `rev`) | yes |
| MCP tools, sample tools | approximate export (`pkg/cmds/json-schema.go`) | via a generator | directly |
| Codegen step | none | buf | none (`invopop/jsonschema` is already in `go.mod`) |
| Dependency weight in every capability package | cobra, config, vault | protobuf runtime | small |
| CLI flags, help, env and profile defaults | best | needs a generator | via generated glazed sections |

### 5.3 Decision

- **Go types are the source of truth.** Verbs use `Def[In, Out]` with input and output structs. Page RPCs already decode into typed structs (`args[struct{…}](raw)` in `rtfiles.go`).
- **JSON Schema is the canonical description,** generated from those types (`invopop/jsonschema`, already used in `pkg/llm/gepp/sample.go`). Types can supply their own schema, as `rt.Level.JSONSchema()` returns an enum.
- **`x-slop` keywords** carry what neither JSON Schema nor glazed has:
  - `pos` and `short` for the CLI;
  - `subject`, the field the authority check reads;
  - `secret`, which redacts the value in the audit log and in CLI echo;
  - `complete`, the completion source (store ids, paths);
  - presence (absent vs zero, replacing `a.Has(…)`);
  - output kind: rows, object, stream, bytes.
- **glazed is generated, never hand-written,** for the CLI:
  - top-level scalars become flags;
  - enums become `TypeChoice`, secrets `TypeSecret`;
  - nested values become a JSON flag that also accepts `@file`;
  - outputs of kind rows go through glaze formatting.
- **protobuf waits for a process boundary**: capability servers (§8, approach D) or a separately versioned client API, where both ends are ours.

```go
type GrantSetIn struct {
	Store   string   `json:"store"   x-slop:"pos=1,subject"`  // the store the floor is checked on
	Subject string   `json:"subject" x-slop:"pos=2"`          // @audience, person id or email
	Level   rt.Level `json:"level"   x-slop:"pos=3"`          // enum view|interact|admin
}

var GrantSet = verbs.Def[GrantSetIn, system.Grant]{
	Name: "grant.set", Effect: verbs.Govern, Floor: authz.StoreAdmin,
	Run: func(c verbs.Call, in GrantSetIn) (system.Grant, error) { /* … */ },
}
```

| Door | Uses the schema for |
|---|---|
| CLI | generated glazed sections; rows through glaze output |
| MCP | `inputSchema` and `outputSchema` |
| HTTP API | request validation; an OpenAPI listing |
| actor `use()`, trusted modules | generated `.d.ts` for `use('system')`, `use('workshop')` |
| app actions | an `input` schema per action in `actor.js`, validated by the same code |
| page protocol | validation only; a conformance test compares against claude.ai's `.d.ts` |

## 6. Capabilities as building blocks

```go
type Capability interface {
	Name() string                          // the contract's use() name: "sample"
	Verbs() []verbs.Registration           // what it adds to the table
	Offer(v *rt.View, m *rt.Manifest) bool // granted in this view (manifest + policy)?
	Policy() []policy.Cell                 // the cells an admin sets (sample: audiences, tiers)
	Runtime() fs.FS                        // its part of claude.js, optional
	Migrations() fs.FS                     // its tables, optional
}
```

The page door asks each capability whether it is offered and sends the granted list in the view's hello. It then routes `<cap>.*` calls to the table. The actor door builds `use('<cap>')` from the same verbs, the way `verbModule` builds trusted modules today. Each capability gets a conformance suite that checks shapes and error codes against the contract's type definitions.

| Capability | Today | Depends on | Reusable outside slop |
|---|---|---|---|
| `db` | page and actor, twice | store, `rt.Space`, rules, access | yes, over any store with turns and a log |
| `sample` | page and actor, twice | an LLM backend, a meter, policy | yes; the most generic block |
| `files` | page (SLOP3-008) | store snapshots, `rt.Space` | yes |
| `room` | page | an in-process broker | yes |
| `user` | page | identity, access | with identity's hooks |
| `assets` | page | assets zone, blobs, policy | yes |
| `downloads`, `permissions` | runtime and shell | the shell's dialogs | yes, mostly client-side |
| `storage` | actor (SLOP3-008) | db, sql, alarm | yes |
| `artifact`, `comments`, `mcp` | partial or off | registry, identity | later |

### 6.1 Worked example: `sample`

Any host of claude.ai artifacts must answer `claude.use('sample')`, and the answer needs five parts:

- a backend that runs a model;
- a meter that charges a budget;
- a policy for who may call it, at which tier;
- a tool loop, in which page-defined tools run in the browser while the model waits;
- a stream for `onText` deltas.

slop has all five, split across `pkg/server/sample.go` (page side), `pkg/actor/sample.go` (actor side) and `pkg/llm` (backends and ledger). As one package:

```go
type Backend interface {
	Run(ctx context.Context, req Request, out func(Delta) error) (Result, error) // tiers, tools, images
	Limits(ctx context.Context, tier string) Limits
}
type Meter interface {
	Reserve(ctx context.Context, payer string, est Usage) (Hold, error) // refuse before running
	Settle(ctx context.Context, h Hold, used Usage) error
}

cap := sample.New(sample.Config{
	Backend: llm.Router(cfg.LLM), // tiers → models
	Meter:   ledger.Meter(sys),   // the budget ledger
	Payer:   billing.PayerOf,     // viewer, store or app owner
})
```

Two decisions in today's code become explicit parameters:

- **Who pays** for a page's sample: `Payer`.
- **Whether page tools may run while a turn is open.** Actors may not hold a transaction across a model call, which is why the actor side returns promises. This is a property of the door, not of `sample`.

## 7. The framework shape

```go
func main() {
	cfg := config.Load()
	p := host.New(host.Config{Data: cfg.Data})                // sysdb, stores, the verb table, the log

	p.Domain(identity.New(identity.Config{OIDC: cfg.OIDC, Admins: cfg.Admins},
		identity.Hooks{Claimed: registry.MoveGrants}))         // slop's decision, passed in
	p.Domain(registry.New(), policy.New(), billing.Stripe(cfg.Stripe), llm.Budgets())

	p.Capability(db.New(), files.New(), room.New(), assets.New(), user.New(), downloads.New(),
		sample.New(sample.Config{Backend: llm.Router(cfg.LLM), Meter: llm.Ledger()}),
		storage.New())

	p.Door(pages.New(cfg.Hosts), cli.Verbs(), api.New("/api/v1"), mcp.New("/mcp"), actors.New())
	log.Fatal(http.ListenAndServe(cfg.Listen, p.Handler()))
}
```

| Product | Domains | Capabilities | Doors | What differs |
|---|---|---|---|---|
| slop (today) | identity, registry, policy, billing, llm | all | pages, CLI, API, actors | nothing |
| desktop artifact host | `identity.SingleUser("me")`, registry | db, files, room, sample (local model, no meter) | pages (one host), CLI | no sign-in, no billing, one origin per store on ports |
| agent host | identity (tokens only), registry | db, files, storage | MCP, API | no browser |
| static exporter | none | db (read-only, baked), files | a build step | half-exists as the static host and `static.ts` |
| contract test server | none | any one | pages | runs claude.ai's types against one capability |

The desktop host is the test of the boundaries. If it takes about 40 lines from these blocks, the boundaries are right. If it needs a fork of `pkg/server`, they are not.

## 8. Approaches to modularity

| | Boundary | Cost of crossing it | Decision |
|---|---|---|---|
| **A** | packages in one Go module, cycles avoided by explicit registration | discipline | now, as features touch code |
| **B** | capability and domain plugins registered into a host at build time | one interface | falls out of A if packages take this shape from the first move |
| **C** | separate Go modules (identity, the contract runtime, possibly store) | releases, versioning | only when a second project imports one |
| **D** | capability servers in other processes, over JSON-RPC or MCP | latency, carrying the principal | for backends behind an interface (`Backend`, `Meter`), not for capabilities |

Rules for `identity`, so that approach C stays possible:

- **no slop imports:** it returns its own `Who`, and slop maps that to `access.Principal` in one place;
- **hooks for slop's decisions:** `Admit` (signup policy, admins), `Claimed` (move grants), `Changed` (recheck views);
- **its own migrations** inside `system.db`.

## 9. APIs to rewrite, and APIs to keep

| Today | Instead | Why |
|---|---|---|
| `verbs.Env` (config, system DB, kernel, actors, billing, three callbacks) | each package receives its own dependencies at registration | the god object is why `verbs` imports everything |
| `AccessChanged`, `PolicyChanged`, `PersonChanged` | doors follow system `_changes`, as `system:` reactors do | the log already records these; a callback is a second, forgettable path |
| the page RPC switch in `views.go` | verbs with `Subject: View` | one place for authority, audit, errors and docs |
| `Args` with `a.S("store")`, `a.B("assets")`, `a.Has(…)` | typed input structs | generated MCP schemas and TS types; misspellings fail at build time |
| `modFunc{Confirm: true}` | `Effect: Govern` on the verb | confirmation for every door |
| `system.PolicyCaps`, a central list | `Capability.Policy()` | adding a capability does not edit the policy package |
| `init()` registration into a package-global table | `host.New()` owns the table | two hosts in one test process; no hidden ordering |
| actor `db` and page `db` | one `caps/db` over `rt.Space` | actors get aliases and `_stores` |

Keep exactly:

- the store's turn model;
- `rt.Space` and `rt.Query`, which are already pure;
- `access.Principal` and levels;
- the system log;
- the contract itself, which claude.ai owns.

## 10. Package map and dependency rules

```text
pkg/
  store/ rt/ access/ blobs/ ids/       core: unchanged
  sysdb/                               system.db: open, per-domain migrations, the system log
  verbs/                               the table: Def, Call, schema, dispatch, errors (no domain imports)
  registry/                            stores, mounts, bindings, grants, links; registry documents
  identity/                            people, sessions, tokens, device, OIDC, guests (§8 rules)
  billing/ llm/ policy/                comps + Stripe; backends + ledger; policy cells + secrets
  kernel/                              store lifecycle, app versions, migrations runner
  actor/                               the goja runtime only; modules come from the actor door
  caps/db/ files/ room/ assets/ user/ downloads/ storage/ sample/
  doors/pages/                         main, live, static, sandbox hosts; the view protocol, SSE
  doors/cli/ api/ mcp/ actors/ modules/
  host/                                assembly: New, Domain, Capability, Door, Handler
cmd/slop/                              today's product
web/runtime/                           claude.js; a capability's .ts may later move next to its package
```

The dependency rules:

| Allowed | Forbidden |
|---|---|
| doors → verbs, rt, access | verbs → any domain or capability |
| caps → domains, core, verbs (to register) | caps, domains → doors, `net/http`, goja |
| domains → sysdb, core, verbs (to register) | identity → any slop package except `sysdb` |
| host → everything | one domain → another domain's tables (use its verbs or exported functions) |

**The ratchet.** A test runs `go list -deps` per package and fails on a forbidden edge. Today's violations sit in an allowlist that may only shrink.

## 11. Plan, in order

Split as you go: no pull request only moves code, and each step has a feature or fix someone can see.

0. **Operations, outside this ticket.** Deploy #20 (migrations 009 and 010 apply on start) through the GitOps PR that the main-branch image build opens. Run `make deploy-apps`. Run SLOP3-006's `/f/:id` migration with `--apply`: its dry run on 2026-11-03 found 103 exact mounts to replace.
1. **This ticket**, as the map the following steps are checked against.
2. **Spike `verbs.Def[In, Out]`**, with `Call`, `Effect`, `Subject`, schema generation and a compatibility layer for existing verbs. Try it on three verbs:
   - `grant.set`: flat, an enum, a governance change;
   - `docs.query`: a nested `where`;
   - `sample.run`: streaming output.

   Check the generated CLI help and an MCP-style listing. This comes first because every later move registers verbs. If it reads badly, it costs one small PR.
3. **`pkg/registry` and live registry documents.** Move `server/registry.go`, `system.LastChange` and the mount-template code into `pkg/registry`. The page door follows system `_changes`, which makes registry documents live (deferred in SLOP3-008) and replaces `AccessChanged`. Add the dependency ratchet.
4. **`caps/db`.** One implementation for page RPCs and actor `use('db')` through `rt.Space`. Page `db.*` calls become `Subject: View` verbs and the RPC switch for them goes away. Actors get aliases and `_stores`. Benchmark page `db.query` before and after.
5. **`caps/sample`.** Merge the page and actor sides behind `Backend` and `Meter`, streaming through `Emit`. The same `sample` works from pages, actors and the CLI.
6. **The MCP door**, generated from the table. Agents use slop as MCP tools, with input and output schemas.
7. **Ongoing.** Type the remaining verbs as they are touched, shrink the ratchet's allowlist, and replace `PolicyChanged` and `PersonChanged` with log followers.
8. **When there is a reason.** Bring `identity` to the §8 rules when a second project needs logins. Build `host.New` and the desktop host when a second product is wanted.

## 12. Decisions and open questions

Decided:

1. The verb table is the one place an operation exists (§4).
2. Verbs are described by Go types, turned into JSON Schema with `x-slop` keywords. glazed is generated for the CLI. Protobuf waits for a process boundary (§5.3).
3. Modularity is approaches A and B now, C and D only for specific packages with a second user (§8).
4. Split as you go, in the order of §11.

Open:

1. **One table or two for page RPCs and operator verbs?** One table with `Hidden` keeps audit and docs in one place. Two tables over one `Call` type keep `slop --help` and the audit log free of browser traffic.
2. **Where does a capability's TypeScript live?** Next to its Go package, with `claude.js` assembled from the granted set, or in `web/runtime` as one package for tooling?
3. **Is the contract runtime its own product?** `claude.js` plus the page protocol is what every artifact host needs. It could be published as an npm package with a Go server half.
4. **Audit of reads.** Should high-rate reads be recorded by sampling, or not at all? Writes and governance changes are always recorded.
5. **What is the second product?** The desktop host, the agent host, or another project's identity needs. Whichever comes first decides how far step 8 goes.

## 13. References

- The brainstorm artifact: <https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs> (source in `various/01-hosting-framework-artifact.html`).
- SLOP3-008 (one object model, path space, registry documents, `ctx.storage`): `ttmp/2026/11/02/SLOP3-008--…/design-doc/01-one-object-model-for-apps-routes-data-and-events.md`.
- SLOP3-002 (trusted Go modules as verb calls, confirmations).
- `doc/design/slop-v3.md` (§4.3 path space, §6 actors and storage, §7 capabilities).
- glazed field definitions: `github.com/go-go-golems/glazed/pkg/cmds/fields` (`definitions.go`, `field-type.go`) and its JSON Schema export, `pkg/cmds/json-schema.go`.
