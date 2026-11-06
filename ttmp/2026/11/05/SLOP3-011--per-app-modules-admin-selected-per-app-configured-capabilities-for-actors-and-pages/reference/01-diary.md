---
Title: Diary
Ticket: SLOP3-011
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - hosting
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/manager.go
      Note: routes (MatchRoute, Serve), policy hooks
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/modules.go
      Note: use(name) catalog, sql/fetch/stores modules
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/registry.go
      Note: Module, Provide, Register, trustedModule
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/apps/manifest.go
      Note: slop.modules, fetch, secrets in app.json
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/policy/modules.go
      Note: app.trust storage (app_modules)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-05T19:28:27.967366742-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The chronological record of SLOP3-011: research into letting each mounted app choose a set of modules for its sandboxed scripts (go-go-goja modules, or APIs backed on the page side), with an admin deciding which modules an app may use and configuring each one per app (for example, which stores a db module may reach). It records what slop, go-go-goja/xgoja and go-go-host already provide, the decisions taken, and the evidence for each.

## Step 1: Groundwork — can apps expose HTTP routes?

The question came up just before the design question and frames it: an app's actor can already declare HTTP routes, so "an app" in slop means a manifest, a page and optionally a server-side actor. I read the route code and answered from it: routes are declared in `actor.js` under `http`, keyed `"METHOD /pattern"`, matched below the mount, gated per route by level and audience, and answered by the actor as an event.

### Prompt Context
**User prompt (verbatim):** "Can apps expose HTTP routes?"
**Assistant interpretation:** Explain whether, and how, a mounted app can serve HTTP routes of its own.
**Inferred user intent:** Establish what an app can do server-side today before designing more capabilities for it.

### What I did
- Read `pkg/actor/actor.go:242-255` (routes read from `def.http` with `level` and `audience`), `pkg/actor/manager.go:563-660` (`Route`, `MatchRoute`, `matchPattern`, `Serve`, `toRes`), `pkg/doors/pages/actors.go:126-205` (`serveActorRoute`), `pkg/doors/pages/live.go:160-185` and `pkg/doors/pages/site.go:75-95` (the two call sites).
- Found the examples with `grep -rln --include=actor.js -E '^\s*http\s*:'`: `apps/examples/journal/actor.js:75` (`GET /feed.json`, `level: 'public'`) and `apps/blocks-site/actor.js`.

### Why
- The design question is about what an app's scripts can reach; routes are one of the things they already do, and they show the actor's event model (one event at a time) that any new module has to fit.

### What worked
- Matching: `:param` and trailing `*`, literal segments score 2 and params 1, the highest score wins; `*` methods; `GET` routes answer `HEAD` (`manager.go:572-626`).
- Gating: `level` (default `view`; `interact`, `admin`, `owner`, `public`) and `audience`; no access gives 404, too little gives 403 (`actors.go:137-153`).
- Request: method, path below the mount, base, query, body up to 1 MiB, and four headers (`content-type`, `accept`, `user-agent`, `referer`) (`actors.go:154-163`).
- Response: `{status, headers, json|html|text|body}` or `{asset:{from,id}}`, sent by the server; default `Cache-Control: no-store`, and a `public` cache header becomes private unless anyone may read the store (`manager.go:650-690`, `actors.go:186-200`).
- Live hosts try actor routes before the shell and slop's favicon (`live.go:173-182`); `/_site/*` is reserved.

### What didn't work
- `grep -rn ... --include=*.go` failed in zsh with `(eval):1: no matches found: --include=*.go` (the glob was unquoted); quoting it as `--include='*.go'` fixed it.

### What I learned
- On static hosts, `serveActorRoute` is called with a nil principal (`site.go:88`), so as far as the code shows only `public` routes can answer there. This was not run.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- The static-host behaviour above (inferred from the code, not observed).

### What should be done in the future
- N/A for this ticket.

### Code review instructions
- Start at `pkg/doors/pages/actors.go:serveActorRoute`, then `pkg/actor/manager.go:MatchRoute`.

### Technical details
```js
http: {
  'GET /feed.json': { level: 'public', run(ctx) {
    const items = sql.all("SELECT id, title, author, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 20");
    return { status: 200, json: { title: 'Journal', updated: ctx.now, items } };
  } },
},
```

## Step 2: The question, and the module catalog slop already has

The user described the feature: each mounted app selects modules (go-go-goja modules such as db, http or goja-bleve, or APIs backed on the page side); an admin controls which modules are exposed to the sandboxed scripts and configures each one, for example which stores a db module may reach. They asked for in-depth research, including what xgoja and go-go-host already have, and a concise report first. I started two read-only research subagents (go-go-goja/xgoja, and go-go-host; Steps 3 and 4) and read slop's side myself. The finding is that slop already has most of the model: a `use(name)` catalog with manifest declarations, an admin trust with provenance, per-audience policy, and store reach through bindings. Each module is hard-coded, though, and there is no module type with its own configuration.

### Prompt Context
**User prompt (verbatim):** "now imagine the following:

we want to allow each app (mounted app) to be able to select a set of different modules (go-go-goja modules or imports / backed by API on the frontend side) for example db, http, goja-bleve or such, where an admin can control which modules are eexposed to the sandboxed scripts and offering support in the backend. We can configure each of th emodules as well depending on how they are integrated, since for example the db module would go against stores, so in that case we can choose thiwch stores are allowed. Anyway the idea is that when creating an app they can benefit from different functionality. xgoja and maybe go-go-host already has something similar, can you research how you would implement something like that in depth, and then report concisely here so i can check if things are ok before we write some bigger writeups."
**Assistant interpretation:** Research how per-app, admin-controlled, per-app-configured modules would be built in slop, reusing go-go-goja/xgoja and go-go-host where possible, and report briefly before any long write-up.
**Inferred user intent:** Let app authors use richer functionality (search, HTTP, other stores) without giving every app everything, with an admin as the gate.

### What I did
- `grep -n 'goja' go.mod`: slop uses upstream `github.com/dop251/goja v0.0.0-20251103141225-af2ceb9156d7` and does not depend on go-go-goja.
- Read `pkg/actor/modules.go:1-170` (`module`, the `use(name)` switch, and the exported helpers `Turn`, `VM`, `IO`, `Need`, `AfterCommit`, `ToJS`/`FromJS`), `pkg/actor/registry.go` (`Module{Name, Doc, Load}`, `Provide`, `Register`, `trustedModule`), `pkg/actor/manager.go:44-99` (`Policy`, `Trusted`, `allowed`, `allowedAny`, `need`), `pkg/apps/manifest.go:1-75` (`Manifest`, `Slop{Reads, Fetch, Secrets, Platform, Modules}`, `Modules = {system, workshop}`), `pkg/policy/modules.go` (`TrustModule`, `Trusted`, the `app_modules` table), `pkg/policy/policy.go:20-60` (`PolicyCaps`, `PolicyAudiences`, `app_policy`), `pkg/doors/actors/modules.go:1-60` (`Install`: `Provide` room, sample, platform; `Register` system, workshop), `pkg/actor/modules.go:555-600` (`storesModule`), `690-730` (`fetchModule`), `pkg/registry/bindings.go:15-28` (`Binding`), `pkg/rt/manifest.go:24-40` (`Caps`, `ContractCaps`) and `pkg/doors/pages/views.go:91-115, 552-560` (`grantedCaps`, `rpcTable`).

### Why
- A design that reuses slop's existing gates (manifest declaration, admin trust, policy, bindings, verbs) is smaller and safer than a parallel permission system.

### What worked
- Four kinds of `use()` names already exist (`modules.go:27-66`):
  - **built in:** `sql`, `db`, `files`, `alarm`, `storage`, `time`, `log`, `stores`;
  - **declared, then gated by policy:** `fetch` (origins in `slop.fetch`, checked on every request, `modules.go:690-700`) and `secrets` (names in `slop.secrets`); `use()` is null when the policy allows the capability for no audience, and every call checks the turn's visitor;
  - **provided by doors:** `room`, `sample` and `platform` (`Manager.Provide`);
  - **trusted:** `system` and `workshop` need both `slop.modules` in `app.json` and an admin's `app.trust`. A trust counts only while its granter is still an admin (`policy/modules.go:52-58`), and these modules call verbs as the visitor.
- Store reach: `stores.open(alias)` resolves a binding (`Store, Alias, Target, Assets, Prefix, Level`) and decides again on every call through the handle whether `store:<id>` may read the target (`modules.go:560-590`).
- Pages: the manifest declares claude.ai contract capabilities (`ContractCaps`), and `grantedCaps` decides per view (`views.go:91`). Runtime methods go through `rpcTable` with an authz action.

### What didn't work
- No failures observed.

### What I learned
- `app.trust` already restarts an app's actors (`pkg/commands/actors.go:79`), so module sets can be fixed when the actor starts.
- `fetch`'s origin list lives in the manifest, which the app author controls; the admin only toggles the policy cell. That is the gap the user's "configure each module" points at.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- Whether actors have a CPU or time limit per event. I did not check this here; Step 6 found it (`TurnLimit` = 5 s, enforced with `vm.Interrupt`).

### What should be done in the future
- See the design in Step 5.

### Code review instructions
- Start at `pkg/actor/modules.go:module`, then `pkg/actor/registry.go`, `pkg/policy/modules.go` and `pkg/doors/actors/modules.go:Install`.

### Technical details
```go
type Module struct {
	Name string
	Doc  string
	Load func(a *Actor) goja.Value // builds the module's object for one actor
}
type Slop struct {
	Reads    map[string]Read `json:"reads,omitempty"`
	Fetch    []string        `json:"fetch,omitempty"`    // origins the actor may request
	Secrets  []string        `json:"secrets,omitempty"`  // secret names the actor may read
	Platform []string        `json:"platform,omitempty"` // stores.create, mounts.set, grants.set
	Modules  []string        `json:"modules,omitempty"`  // Go modules, once an admin trusts the app with them
}
```

## Step 3: go-go-goja and xgoja — the module system (research subagent)

A read-only research subagent (transcript `agent-a4dd9581431e1d574`) was asked to document what go-go-goja and xgoja v2 already provide for letting each mounted app choose and configure a set of native modules. It worked in `/home/manuel/code/wesen/go-go-golems/go-go-goja` (tag v0.10.7) and in `/home/manuel/code/wesen/go-go-golems/goja-bleve` as a sample third-party module, plus one lookup in the Go module cache. It made 55 tool calls: 54 Bash calls (all reading is done through `cat -n`/`sed -n`/`grep`/`find`/`ls`, with no Read/Grep/Glob tool) and one final `SubagentHandback`. The run lasted about 4m50s (2026-11-06T00:23:48Z to 00:28:38Z). It delivered a roughly 1,080-word report in seven numbered sections, plus a "Not found" list.

### Prompt Context
**User prompt (verbatim):** see Step 2
**Assistant interpretation:** Delegate one half of the research to a read-only subagent and keep the parent's context small.
**Source of this entry:** rebuilt from the subagent's transcript with go-minitrace (tool calls, results and its final report only; see Step 5).
**Agent prompt (summary):** Research, read-only, "very thorough", in go-go-goja (and goja-bleve as a sample): answer seven questions with file:line references and short code excerpts. The questions were: native module definition/registry/`require()` and per-runtime allowlisting; `engine.New()`/factory options and event-loop/runtimeowner; xgoja v2 `ProviderRegistry`, providers vs modules, per-instance config, capability/allowlist notions; modules that take host-supplied config; TypeScript/doc introspection; in-tree module list and which are safe for untrusted code; goja and Go versions. The context given was that slop-computer wants per-app module selection with admin-controlled, per-module config. The report was to be under about 900 words and to flag anything not found.

### What I did (the subagent's tool calls)
- **Orientation (call 0, 1, 7):** `ls`, `head -20 go.mod`, `git log --oneline -3` and `ls modules pkg engine` in go-go-goja. The `ls engine` part failed (see below). Then `cat modules/common.go modules/exports.go modules/typing.go | head -300; ls modules/*/ pkg/engine pkg/xgoja pkg/runtimeowner pkg/tsgen` and `ls pkg/xgoja/*; wc -l pkg/xgoja/providerapi/*.go`.
- **Engine factory and runtime (calls 2-6):** `cat -n` of `pkg/engine/factory.go`, `options.go`, `module_specs.go`, `module_middleware.go`, `runtime_modules.go`, and `runtime.go` (head -130). Greps: `grep -n "func " pkg/engine/runtime.go pkg/engine/module_roots.go pkg/engine/nodejs_init.go` and `grep -rn "func New\b\|func New(" pkg/engine/`. Owner/bridge: `cat -n pkg/runtimeowner/types.go`, `grep -n "func \|^type" pkg/runtimeowner/runner.go`, `sed -n 85,190p pkg/runtimeowner/runner.go`, `ls pkg/runtimebridge` and a grep of `pkg/runtimebridge/*.go`.
- **xgoja provider API (calls 8-11):** `cat -n` of `pkg/xgoja/providerapi/module.go`, `provider_registry.go`, `capabilities.go`, `sources.go`, `help.go`, `verbs.go`, with a grep of `commands.go` lines 1-115. `find pkg/xgoja/providers -type f`, `cat -n pkg/xgoja/providers/core/*.go`, `cat -n pkg/xgoja/providers/host/host.go` and `host/doc.go`.
- **xgoja app and codegen (calls 12-20, 44-45, 48-49):**
  - Runtime assembly: `grep -n "type \|func "` over `pkg/xgoja/app/types.go`, `runtime_plan.go`, `factory.go`, `host_services.go`; `sed -n 15,80p pkg/xgoja/app/runtime_plan.go`; `cat -n pkg/xgoja/app/factory.go | sed -n 1,240p`.
  - Spec and templates: `ls cmd cmd/xgoja`; `find cmd/xgoja -name "*.go"`; `sed -n 1,95p cmd/xgoja/internal/specv2/types.go`; `sed -n 1,80p cmd/xgoja/internal/specv2/defaults.go`; `ls cmd/xgoja/internal/generate/templates`; and greps `Register\|registry` over `cmd/xgoja/internal/generate/templates.go`, `main.go` and `templates/*`.
  - `ConfigSchema` searches: `grep -rln "ConfigSchema" --include='*.go' . | grep -v ttmp | head -20`; `grep -rn "\.ConfigSchema\|jsonschema" --include='*.go' . | grep -v ttmp | head`; `grep -rn "ConfigSchema" --include='*.go' cmd pkg | grep -v _test | grep -v "ConfigSchema:"`.
  - Later: `sed -n 40,100p cmd/xgoja/cmd_list_modules.go`; `grep` of `cmd/xgoja/cmd_inspect.go`; `grep -n "Config\b\|\.Config\|schema" cmd/xgoja/internal/specv2/validate.go`; `sed -n 160,185p specv2/types.go`; `grep -rln "go-go-goja-host" --include='*.yaml' .`; `cat -n examples/xgoja/23-personal-knowledge-inbox/03-sqlite-cli-inbox/xgoja.yaml | head -50`; `grep` of `pkg/xgoja/providergraph/graph.go` and `app/host.go`; `grep -rn "MRP(" pkg/xgoja/app/*.go`.
- **Sample third-party module, goja-bleve (calls 21-23):** `ls; head -15 go.mod; grep -n "go-go-goja\|dop251" go.mod; find . -name "*.go"` in `/home/manuel/code/wesen/go-go-golems/goja-bleve`. Then `cat -n pkg/xgoja/providers/bleve/bleve.go`, `cat -n pkg/provider.go`, `grep` of `pkg/module.go` (`func \|type \|Register\|init()`), `sed -n 1,40p` and `sed -n 110,190p pkg/module.go`, and `grep -n "bleve.New\|bleve.Open\|NewMemOnly\|os\." pkg/api_index.go`.
- **In-tree modules and host-config injection (calls 24-29, 37-39):**
  - `modules/database/database.go`: `grep -n "^func \|^type \|init()\|modules.Register..."`, then `sed -n 17,30p`, `67,130p`, `221,260p`.
  - `modules/fetch/config.go` (`cat -n | head -120`); `modules/fetch/fetch.go` (`sed -n 20,60p; 222,252p`) and a grep of `client_builder.go` and `auth_builder.go`.
  - `modules/fs/backend.go` (`sed -n 1,80p`); greps over `modules/fs/backend_embed.go`, `fs.go`, `http.go`.
  - `grep -n "init()\|modules.Register" -A3` over `modules/exec/exec.go`, `os/os.go`, `timer/timer.go`, `time/time.go`, `yaml/yaml.go`, `crypto/crypto.go`, `events/events.go`, `path/path.go`, `express/express.go`, `uidsl/module.go`.
  - Filtered `sed` excerpts of `exec.go`, `os.go`, `timer.go`; `sed -n 30,60p modules/express/express.go; sed -n 1,40p modules/uidsl/module.go`.
  - `grep -n "PackageID\|Name:\|func Register\|CapabilityID\|ConfigSchema" pkg/xgoja/providers/http/*.go pkg/xgoja/providers/hostauth/*.go`; `sed -n 25,120p pkg/xgoja/providers/http/http.go`.
- **Event loop / timers / async docs (calls 30-34):** `grep -rn "setTimeout\|setInterval\|queueMicrotask" pkg/engine/*.go`; `grep -rn "setTimeout" --include='*.go' pkg modules`; `cat -n pkg/engine/nodejs_init.go | head -40`; `grep -n "eventloop.NewEventLoop\|replace" go.mod`; `grep -rln "setTimeout" --include='*_test.go' pkg modules`; `ls pkg/doc`; `sed -n 120,145p`, `18,40p`, `171,186p` of `pkg/doc/03-async-patterns.md`.
- **TypeScript generation (calls 35-36):** `ls pkg/tsgen/spec pkg/tsgen/render`; `grep -n "^type\|^\t[A-Z]" pkg/tsgen/spec/*.go`; `grep -n "^func " pkg/xgoja/dtsgen/dtsgen.go`; `sed -n 1,50p pkg/xgoja/dtsgen/dtsgen.go`; `ls cmd/gen-dts`; `grep -rn "TypeScriptDeclarer\|TypeScriptModule()" --include='*.go' modules`.
- **goja_nodejs `require` internals (calls 40-42):** `ls ~/go/pkg/mod/github.com/dop251/`; grep of `goja_nodejs@v0.0.0-20260918173711-b481721df8a2/require/*.go` for `func RegisterCoreModule|...|node:|func WithLoader|...|DefaultSourceLoader`; `sed -n 24,75p require/resolve.go`; `sed -n 125,140p require/module.go`. Also an import census: `grep -rhn "goja_nodejs/" ... | sort | uniq -c`, and go.mod greps for `go-go-goja`, `^go `, `toolchain`, `dop251/goja `, `replace` in both repos.
- **Version and safety checks (calls 43, 46-47, 50-52):** `git describe --tags --abbrev=0; git tag --sort=-v:refname | head -3`; `ls pkg/hashiplugin; grep -rn "Allow\|allowlist\|AllowModules" pkg/hashiplugin`; `grep -rni "sandbox\|untrusted" --include='*.go' --include='*.md' pkg modules cmd README.md | grep -v ttmp | grep -v node_modules | head -15`; `sed -n 398,412p` and `240,260p` of `pkg/doc/16-nodejs-primitives.md`.
- **Verification greps (call 53):** one batched `grep -n` run to pin line numbers for `type NativeModule`, `^type Registry`, `func (r *Registry) Enable`, `^var DefaultRegistry`, `^func Register` (`modules/common.go`); `type TypeScriptDeclarer` (`modules/typing.go`); `NativeModuleRegistrar`, `dataOnlyDefaultRegistryModuleNames =`, `ProcessModule`, `defaultRegistryModuleAliases =`, `RuntimeInitializer`, `modules.GetModule` (`pkg/engine/module_specs.go`); `MiddlewareSafe|MiddlewareOnly|allRegisteredModuleNames` (`module_middleware.go`); `func With` (`options.go`); and `Lookup|CurrentOwnerConte...`.

### Why
- go-go-goja is where the modules the user named live (database, fetch, fs; goja-bleve as a third-party module), and xgoja v2 is its newest way of choosing and configuring modules per runtime. Reusing its contracts beats inventing slop-only ones.

### What worked
- **Q1, native modules and registry.** `modules.NativeModule` is `Name() string; Doc() string; Loader(*goja.Runtime, *goja.Object)` (`modules/common.go:28`). `Registry` is at :37, `Enable` at :86, `DefaultRegistry` at :93, `Register` at :96. All of these were grepped in call 53, and the whole file was read in call 1.
  - Registration is global via `init()`: `modules/database/database.go:570-572` registers "database" and "db" (grep output at lines 570-572 seen); `modules/fetch/fetch.go:316`.
  - `pkg/engine/runtime.go:20-29` blank-imports the default modules (file read via `cat -n | head -130`).
  - An allowlist per factory is available through `engine.MiddlewareOnly` (`module_middleware.go:34`), `MiddlewareSafe` (:23), or `WithImplicitDefaultRegistryModules(false)` plus `WithModules(NativeModuleRegistrar{...})` (`module_specs.go:52`).
  - `require()` resolution was read in `goja_nodejs require/resolve.go:24-75` and `module.go:132`. Native names resolve first, then core modules, then `node_modules`.
- **Q2, runtime factory.** There is no `engine.New()`. The grep `func New\b\|func New(` over `pkg/engine/` was run, and `ls engine` failed. The API is `NewRuntimeFactoryBuilder` (`pkg/engine/factory.go:49`), `Build()` (:123) and `NewRuntime` (:184). Options are in `options.go:59,68,77,86`. `factory.go:208-218` and `:232` build the VM, the event loop and the owner. Lines 260-268 enable `console`, `buffer`, `url` and the performance globals (seen in the raw read). The owner interface is `Call`/`Post`/`WaitIdle`/`Shutdown` (`pkg/runtimeowner/types.go:21`). The async-promise pattern comes from `fetch.go:222-251` and `timer.go:49-76`. `pkg/doc/03-async-patterns.md:138` says "A fresh runtime still does not expose global `setTimeout`/`setInterval`; ... `require("timer").sleep(ms)`", confirmed by grep output. The deadlock rule at :171 was read.
- **Q3, xgoja v2.**
  - `ProviderRegistry` is at `providerapi/provider_registry.go:68`; `Package` at :73; `registry.Package` at :86; `ResolveModule` at :118.
  - `providerapi.Module{Name, DefaultAs, Description, ConfigSchema json.RawMessage, TypeScript, NewModuleFactory}` is at `module.go:44` (`ConfigSchema` field at :48, confirmed by grep). `ModuleSetupContext` carries a per-instance `Config json.RawMessage`.
  - `xgoja.yaml` `providers: [{id, import, register}]` and `runtime.modules` are in `cmd/xgoja/internal/specv2/types.go:64,80`. The generated code calls `Register` (`templates/main.go.tmpl:44-46`, grep output seen).
  - `pkg/xgoja/app/factory.go:78-141` builds an engine with implicit and data-only modules off. `runtime_plan.go:59` has `RuntimePlan`/`RuntimeModulePlan`. The agent saw `NewRuntimeFactory(providers, runtimePlan, services...)` at `factory.go:62`.
  - Capabilities are in `providerapi/capabilities.go:43,64,95,112`: Glazed config section, XGoja config section, host-service contribution, runtime initializer.
  - **`ConfigSchema` is set by hand (e.g. `hostauth.go:52`; `providerapi/commands.go:89`) but the greps found no consumer.**
  - The only allowlist found is `AllowModules []string` for out-of-process plugins, `pkg/hashiplugin/host/config.go:18` (grep output).
- **Q4, host-configured modules.** `pkg/xgoja/providers/host/host.go` (read in full) maps JSON config to constructor options for each module:
  - `fs`: `fsmod.New(WithName, WithBackend(...))`; the `Backend` interface is at `modules/fs/backend.go:5`.
  - `fetch`: `fetchmod.WithPolicy` (`modules/fetch/config.go:16`, origin check :39) and `WithHTTPClient` (`fetch.go:53`).
  - `exec`: `{Allow, AllowedCommands}`.
  - `db`: `dbm.WithPreconfiguredDB(QueryExecer)`, `WithCloseFn`, `WithConfigureEnabled` (`database.go:78-104`, `QueryExecer` at :17). `DBModule.Configure` is at `database.go:241` (grep output seen).
  - `express`: `providers/http/http.go:29`, read via `sed -n 25,120p`.
- **Q5, TypeScript and introspection.** `modules.TypeScriptDeclarer` is at `modules/typing.go:7` (grep output). `spec.Module` is at `pkg/tsgen/spec/types.go:27`. `dtsgen.RenderModules` is at `dtsgen.go:35`. `Host.TypeScriptDeclarations` is at `app/types.go:18`. The module-listing command is at `pkg/xgoja/app/root.go:204-234`, seen in the `MRP(` grep output.
- **Q6, modules and safety.**
  - Safe/data-only: path, crypto, events, time, timer, yaml, uidsl. These match the core provider list (`providers/core/core.go:20`).
  - Unsafe: exec, fs, os, database (`configure()` opens any DSN), fetch without a policy, `process.env`, express.
  - goja-bleve `create`/`open` take host paths: `GB/pkg/api_index.go:62` is `bleve.New(builder.path, ...)` and :67 is `bleve.Open(builder.path)` (grep output). Its `init()` registration is at `GB/pkg/module.go:118`. `GB/pkg/provider.go:14` defines `RegisterProvider`. The bleve provider at `GB/pkg/xgoja/providers/bleve/bleve.go:19` has no config and no TypeScript descriptor.
- **Q7, versions.** go-go-goja is at `go 1.26.1`, toolchain `go1.26.10`, `github.com/dop251/goja v0.0.0-20261103151521-97b96e1e55f5` (upstream, with no `replace`), and goja_nodejs `v0.0.0-20260918173711-b481721df8a2`. `git describe` / `git tag` returned `v0.10.7`. goja-bleve is at `go 1.26.4`, goja `v0.0.0-20260311135729-065cd970411c`, go-go-goja `v0.8.3`.
- **Report's "Not found" list:** no `engine.New()`; no per-store or per-table policy in the db module; no path-root sandbox in the fs OS backend; no `ConfigSchema` validation; no permission model beyond per-module `allow` gates; no CPU or memory limits.

### What didn't work
- Call 0: the combined command exited with code 2 because of `ls modules pkg engine 2>/dev/null`. There is no `engine` directory at the repo root, and the rest of the output (`ls`, `go.mod` head, three `git log` lines, `modules`/`pkg` listings) was still returned. This is the only non-zero exit in the transcript.
- The report states there is no `engine.New()`. This is supported by the failed `ls engine`, the `grep -rn "func New\b\|func New(" pkg/engine/` run, and the builder-based API actually found.
- Calls 14-15, 17-19 re-ran overlapping `ConfigSchema`/`Register` greps with different filters. The earlier ones were narrowed or re-issued, but no tool error was shown.
- Nothing was found for `ConfigSchema` consumers (greps limited with `head`), for a hashiplugin-style allowlist outside `pkg/hashiplugin`, or for a sandbox/untrusted policy beyond doc mentions. No other tool errors observed.

### What I learned
- The plain registry (`modules.Register` in `init()`) shares one module instance per process, so it cannot carry per-app configuration; xgoja's `providerapi.Module.NewModuleFactory(ModuleSetupContext{Config, Host, RuntimeOwner, AddCloser})` can.
- go-go-goja makes modules safe only through what the host passes in (fs `Backend`, fetch `Policy`/`HTTPClient`, db `QueryExecer`); none of them is safe for untrusted code as registered by default, except the data-only ones.

### What was tricky to build
- Telling "configurable safely" from "safe": every unsafe module has an option that would make it safe, but its default is the unsafe one (fs on the OS, fetch with no policy, `database.configure` open).

### What warrants a second pair of eyes
- **"`ConfigSchema` is never validated or read anywhere."** This is an absence claim inferred from `grep ... | head` pipelines (limit 10 or 20) and does not cover the whole repo. Treat it as "no consumer seen in limited greps".
- **"`express` and `uidsl` exist only as `RuntimeModuleRegistrar`s, not in the default registry."** Inferred from a `grep modules.Register` over those directories that found none, plus short `sed` excerpts. The registrar definitions themselves were not opened in full.
- **"Safe for untrusted code" classification.** This is the agent's judgement. The source for os ("hostname, homedir") and exec ("raw `exec.Command`") is only filtered `grep`/`sed` lines (call 29), not full reads.
- **`timer.go:49-76` and `exec`/`os` details.** The commands were `sed -n 1,86p ... | grep ...`, so only matching lines were visible. The line range 49-76 for the async pattern was not displayed in full.
- **"No runtime-level CPU or memory limits."** An absence claim based on one `grep -rni "sandbox\|untrusted" ... | head -15` and `pkg/doc/16-nodejs-primitives.md` ranges; no search for `Interrupt`/`SetMaxCallStackSize` was run in this transcript.
- **`cmd/gen-dts` and `dtsgen` behaviour.** `cmd/gen-dts` was only listed (`ls`); only the first 50 lines of `dtsgen.go` plus a function grep were read.
- **goja-bleve "no path policy".** The quoted comment ("index path policy and runtime cleanup are host-application responsibilities") is backed: it is at `goja-bleve/pkg/provider.go:11-12` in the `cat -n` output. "No path policy" itself is an absence claim.
- Several `file:line` numbers come from `grep -n` or `cat -n` output and are backed. Others (e.g. `fetch.go:316`) came from a grep on `init()` and are backed. The `app/root.go:204-234` and `hashiplugin/host/config.go:18` numbers are backed by grep output. No cited file was found that the agent had never opened, with the exceptions noted above.

### What should be done in the future
- Confirm the absence claims with full-repo greps before relying on them in a design (see the list above).

### Code review instructions
- Start at go-go-goja `modules/common.go`, `pkg/engine/factory.go`, `pkg/xgoja/providerapi/module.go`, `pkg/xgoja/providers/host/host.go`, `modules/database/database.go`.

### Technical details
- Tool calls: 55 total. 54 Bash, 1 SubagentHandback. No Read, Grep or Glob calls. Archive reports 86 turns, 55 tool calls.
- Distinct files read (approximate; derived from `cat`/`sed`/`head` targets, since reading was done through Bash): about 39 distinct files across go-go-goja, goja-bleve and the goja_nodejs module cache. They include `modules/common.go`, `exports.go`, `typing.go`; `pkg/engine/{factory,options,module_specs,module_middleware,runtime_modules,runtime,nodejs_init}.go`; `pkg/runtimeowner/{types,runner}.go`; `pkg/xgoja/providerapi/{module,provider_registry,capabilities,sources,help,verbs,commands}.go`; `pkg/xgoja/providers/{core,host,http}/*.go`; `pkg/xgoja/app/{types,runtime_plan,factory,host_services,host,root}.go`; `cmd/xgoja/internal/specv2/{types,defaults,validate}.go`; `modules/{database,fetch,fs,exec,os,timer,express,uidsl}/*.go`; `pkg/doc/03-async-patterns.md`, `16-nodejs-primitives.md`; goja-bleve `pkg/{provider,module,api_index}.go`, `pkg/xgoja/providers/bleve/bleve.go`; goja_nodejs `require/{resolve,module}.go`.
- Duration: about 4m50s (00:23:48Z to 00:28:38Z, handback timestamp 00:28:38.191Z). Final report: 106 lines, about 1,080 words.

## Step 4: go-go-host — per-site capabilities, policy and runtime wiring (research subagent)

A second read-only subagent (transcript `agent-a97211fe0351f35e6`) was asked what go-go-host already has for per-app module/capability selection, admin control and per-module configuration. It worked in `/home/manuel/code/wesen/go-go-golems/go-go-host`, with a glance at `/home/manuel/code/wesen/2026-05-03--goja-hosting-site`, and read some go-go-goja v0.8.3 source from the Go module cache to understand the runtime owner and middleware. The first turn made 43 tool calls: 38 Bash, 4 Read and 1 `SubagentHandback`. It ended at 2026-11-06T00:27:53Z, about 4m05s after the start. The report covers the seven questions plus a seed-project section and a "Not found" list. Its headline finding: go-go-host has the data model (per-site `site_capabilities` rows with `enabled` and `config_json`, a manifest `capabilities` list, an API and a UI toggle), but enforcement only happens at bundle validation. The runtime ignores both the policy and `config_json`. A later turn (coordinator follow-up asking for a diary entry) was stopped by a safety classifier and is excluded from this log; the archive's `ended_at` (00:28:41Z), turn count (73) and tool count (43) include that follow-up turn's records, but the 43 tool calls are all in the first turn.

### Prompt Context
**User prompt (verbatim):** see Step 2
**Assistant interpretation:** Delegate one half of the research to a read-only subagent and keep the parent's context small.
**Source of this entry:** rebuilt from the subagent's transcript with go-minitrace (tool calls, results and its final report only; see Step 5).
**Agent prompt (summary):** Research, read-only, "very thorough", in go-go-host (and the `2026-05-03--goja-hosting-site` seed project if referenced): answer seven questions with file:line references. The questions were: what go-go-host is; how an app declares needed modules or capabilities and how the host decides what it gets, including any admin allowlist or per-module config; how modules are wired into each runtime (go-go-goja `modules.Register`/`engine.New`/xgoja?) and per-app isolation; db/http/kv/auth modules and tenant scoping; limits and sandboxing; admin UI/API for toggling modules; and design docs on capability selection. The context was that slop-computer wants per-app, admin-controlled module sets. The report was to be under about 800 words and to flag what was not found.

### What I did (the subagent's tool calls)
- **Orientation (calls 0-4):** `ls -la && git log --oneline | head -20 && find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | head -300 | sort` in go-go-host; `ls -la /home/manuel/code/wesen/2026-05-03--goja-hosting-site | head -50`; Read `README.md` (whole file); `cat examples/hello-beta/go-go-host.json && cat AGENT.md && ls -R ttmp | head -200 && grep -rn "goja-hosting-site\|2026-05-03" --include='*' -l . | grep -v '^./.git' | head -30`; `ls -R ttmp/2026/05/13 ttmp/2026/06 | head -80; wc -l internal/deploy/bundle.go internal/runtime/*.go internal/sitejs/*/*.go internal/store/limits.go internal/httpapi/site_settings.go internal/config/config.go`.
- **Manifest, capability policy, deploy path (calls 5-13):**
  - Read `internal/deploy/bundle.go` (whole file), `internal/runtime/runtime.go` (whole file), and `internal/control/deployments.go` (offset 60, limit 380).
  - Capability greps over `--include=*.go --include=*.sql`: `grep -rn -i "capabilit\|PolicyCaps\|EffectiveCaps\|allowed_capab\|SafeCapabilities"` (first form failed, see below), then `grep -rn -i 'capabilit\|PolicyCaps\|EffectiveCaps\|SafeCapabilities' ... | grep -v '_test.go' | grep -v '\.sql\.go' | head -80`.
  - Config/schema: `grep -rn -i 'ConfigJSON\|config_json'` plus `cat internal/store/migrations/001_initial_schema.sql | grep -n -i -A12 'site_capabilities\|site_quotas\|site_config'`.
  - `sed -n 50,95p internal/store/sites.go`; `sed -n 60,200p internal/control/services.go`; `cat internal/store/limits.go`.
  - `sed -n 30,140p internal/httpapi/handler.go`; `sed -n 1,60p`, `60,126p`, and `160,271p` of `internal/httpapi/site_settings.go`; `grep -n 'Quota' internal/control/*.go internal/httpapi/*.go`.
  - Timeouts: `grep -rn 'RequestTimeoutMS\|requestTimeout\|Interrupt\|SetMaxCallStackSize\|deadline\|context.WithTimeout' --include='*.go' internal`.
- **Runtime wiring (calls 14-21):**
  - `sed -n 185,215p internal/runtime/supervisor.go`; `sed -n 30,120p` and `240,300p` of `internal/runtime/lambda_runtime.go`.
  - `grep -n 'go-go-goja\|goja ' go.mod`; `sed -n 1,110p internal/sitejs/web/host.go`.
  - In the module cache `~/go/pkg/mod/github.com/go-go-golems/go-go-goja@v0.8.3`: `ls pkg/runtimeowner/`; grep `Interrupt\|ctx.Done\|func (r \*runtimeOwner) Call\|func .*Call(` over `pkg/runtimeowner/*.go`; grep `func MiddlewareOnly\|UseModuleMiddleware\|WithModules` over `pkg/engine/*.go`; `sed -n 60,170p pkg/runtimeowner/runner.go`; `sed -n 1,80p pkg/engine/module_middleware.go`; grep `moduleMiddlewares\|defaultRegistry\|DefaultRegistry\|func (b \*RuntimeFactoryBuilder) Build` and `Interrupt` over `pkg/engine` and `pkg/runtimeowner`; `sed -n 123,160p pkg/engine/factory.go`; `sed -n 90,150p pkg/engine/runtime.go`.
  - `internal/sitejs/dbguard/{types,guard,registrar,metered,sqlkind}.go` (head/sed ranges); `internal/sitejs/web/{express_module,session,platform}.go`; `internal/sitejs/uidsl/module.go` (`sed -n 1,40p`).
- **Docs and design material (calls 22-29):** `grep -rn -i -c 'capabilit' docs ttmp cmd/go-go-host/doc cmd/go-go-host-agent/doc | grep -v ':0$' | sort -t: -k2 -nr | head -30`. In `ttmp/2026/05/11/HOST-001-GO-GO-HOST-V1--go-go-host-v1-hosting-platform-design/design-doc/01-go-go-host-v1-hosting-platform-intern-design-and-implementation-guide.md`: `grep -n -i 'capabilit\|goja-hosting-site\|2026-05-03\|fetch\|egress\|outbound\|secret' | head -70`, then `sed -n 465,520p`, `580,640p`, `1160,1196p`. `runbooks/03-host-capability-security-review-checklist.md` (`sed -n 1,120p`) and `grep -n -i -B2 -A8 'capabilit' docs/contributing/runtime-and-deployment-guidelines.md`. `grep -n -i 'capabilit\|require(' cmd/go-go-host/doc/js-api-reference.md`; `grep -n -i 'capabilit'` over `developer-guide.md`, `deploy-workflow.md`, `docs/architecture/api-surface.md`, `data-model.md`; `sed -n 345,365p cmd/go-go-host/doc/js-api-reference.md`; `sed -n 45,62p docs/contributing/runtime-and-deployment-guidelines.md`; `grep -n -i 'capabilit' ttmp/2026/06/18/HOST-013*/design-doc/*.md` and `ttmp/2026/05/12/HOST-006*/design-doc/*.md`, `HOST-009*/design-doc/*.md`.
- **Admin UI (calls 30-31):** in `web/admin`: `find src -type f | wc -l; grep -rln -i 'capabilit' src | head -30`; `cat src/pages/AdminCapabilitiesPage/AdminCapabilitiesPage.tsx | head -80`; `grep -n -i -B2 -A12 'capabilit' src/pages/SiteSettingsPage/SiteSettingsPage.tsx | head -100`.
- **Verification greps (calls 32-33, 37-41):**
  - `grep -rn -i 'capabilit\|denied' --include='*_test.go' internal | head -20`; `grep -rn 'ListSiteConfig\|site_config' --include='*.go' internal/runtime internal/sitejs internal/control | head`; `grep -n 'type .*Config struct\|WarmPool\|MaxConcurren\|PoolSize\|Lambda\|yaml:"' internal/config/config.go | head -50`.
  - `grep -n 'func requirePlatformAdmin\|requirePlatformAdmin(' internal/httpapi/*.go | head -5`; `grep -rn -i 'DefaultCapabilities\|effective cap\|BuildModules\|capabilit.*runtime\|runtime.*capabilit' ttmp --include='*.md' | grep -v 'sources/' | head -30`.
  - `grep -rn -i 'UpdateSiteQuota\|UpsertSiteQuota\|SetSiteQuota' --include='*.go' --include='*.sql' .`; `grep -rn -i 'capabilit' cmd/go-go-host/cmds/*.go | head`; `sed -n 120,140p internal/httpapi/admin_inventory.go`; `grep -n 'app.static\|static(' cmd/go-go-host/doc/js-api-reference.md | head -5`; `sed -n 104,116p js-api-reference.md`; `grep -n 'MaxWait\|WithRuntimeOwnerOptions\|runtimeowner.Options' -r internal | head`.
  - `cat internal/store/migrations/007_phase10_hardening.sql internal/store/migrations/008_phase11_site_settings_domains.sql | head -60; grep -n 'net/http\|fetch\|http.Client' -r internal/sitejs | head`.
  - `grep -rn 'xgoja\|providerapi\|modules\.Register\|goja-bleve\|bleve' --include='*.go' --include='go.mod' . | head`; `grep -n 'ReadTimeout\|WriteTimeout' cmd/go-go-hostd/main.go | head -3`; `grep -n 'request body\|MaxBytesReader\|maxBody' -ri internal/sitejs/web/body.go | head`; `cat internal/sitejs/web/body.go | sed -n 1,46p | grep -n 'Limit\|1 <<\|MaxBytes\|ReadAll'`.
- **Seed project, goja-hosting-site (calls 34-36):** in `/home/manuel/code/wesen/2026-05-03--goja-hosting-site`: `find pkg cmd sites -maxdepth 3 -type f | grep -v node_modules | head -60`; `grep -rn -i 'capabilit\|MiddlewareOnly\|MiddlewareSafe\|modules\.\|WithModules\|allowlist\|allowedHosts' --include='*.go' pkg cmd | head -30`; `sed -n 55,90p pkg/app/server.go`; `cat pkg/app/multi_config.go | grep -n 'yaml:"' | head -30`; `ls ttmp; ls ttmp/* | head`; `grep -n 'type DBPolicy' -A12 pkg/app/*.go`; `grep -n 'func buildDatabaseRuntimeConfig' -A30 pkg/app/database.go | head -45`.

### Why
- The user expected go-go-host to "already have something similar": it is the closest existing product (sites running goja with a capability list), so its data model and its gaps are direct input.

### What worked
- **Q1, what it is.** go-go-host hosts small server-side JS sites on goja, one in-process runtime per site, routed by `Host` header (`README.md:3,15,52-60`, read in full). Sites are deployed as tar.gz/zip bundles with `go-go-host.json`. They are validated, unpacked, dry-run with a smoke GET and then activated (`internal/control/deployments.go:69-159, 260-309`, read). Lambda-style bundles are in `internal/deploy/bundle.go:33-41` and `deployments.go:314-386`.
- **Q2, declaration and decision.**
  - Manifest `capabilities` is a flat string list (`bundle.go:23-31`; `examples/hello-beta/go-go-host.json` contains `"capabilities": ["express","ui.dsl","database","assets"]`), with no per-module options.
  - The default platform allowlist is `SafeCapabilities = {"express","ui.dsl","database","db","time","timer","assets","sqlite"}` (`bundle.go:21`, verified in the grep output).
  - The per-site policy table is `site_capabilities(site_id, capability, enabled, config_json JSONB DEFAULT '{}')` (`001_initial_schema.sql:69-76`; `config_json` at :73 seen in grep). It is seeded with enabled rows at site creation (`internal/store/sites.go:65-72`; `UpsertSiteCapability` at :67 seen).
  - `siteCapabilityPolicy` is at `deployments.go:418-431`. `validateManifest` rejects disallowed capabilities at `bundle.go:236-240`. Requested vs effective lists are recorded at `bundle.go:167-169`.
  - `UpsertCapability` is at `internal/control/services.go:160-182`: it validates only that `config_json` is valid JSON and writes an audit event. The report says org owners, not platform admins, may call it.
  - `site_quotas` columns (`bundle_max_bytes`, `db_soft_max_bytes`, `db_hard_max_bytes`, `request_timeout_ms`) are at `001_initial_schema.sql:60-67` (seen), set to defaults in `sites.go:61-63`.
  - **`config_json` is stored and listed but nothing consumes it.** The grep for `ConfigJSON|config_json` shows only the store, DTOs and admin listing (e.g. `httpapi/site_settings.go:140`, `admin_inventory.go:84,280`, `store/admin.go:117,190`, `store/sites.go:67,81,86-87`); the follow-up grep for `site_config` in `internal/runtime`, `sitejs`, `control` found no runtime consumer.
- **Q3, runtime wiring.** `NewSiteRuntime` (`internal/runtime/runtime.go:64-119`) uses go-go-goja v0.8.3 `engine.NewRuntimeFactoryBuilder()`, `WithModules(NativeModuleRegistrar{...database...})`, `UseModuleMiddleware(engine.MiddlewareOnly(...))`, `databasemod.WithPreconfiguredDB(meteredDB)` and `WithConfigureEnabled(false)`. Express, uidsl and dbguard are registered as runtime registrars.
  - **Gap:** `Capabilities: hostruntime.DefaultCapabilities()` is passed at `deployments.go:108, 129, 279`. The `CapabilitySet{Database,Timers,Assets}` is at `runtime.go:45-53`, and the effective list is not passed to the runtime.
  - `lambda_runtime.go:38-90` duplicates the factory. Isolation is one `engine.Runtime` per site in one daemon process.
  - The grep `xgoja\|providerapi\|modules\.Register\|goja-bleve\|bleve` over `--include='*.go' --include='go.mod'` returned no hits for xgoja, providerapi or bleve.
- **Q4, modules provided.** `database`/`db` is the site's own SQLite (`deployments.go:279`; lambda DB at :367), wrapped by `dbguard` MeteredDB (`dbguard/metered.go`, `sqlkind.go`; `registrar.go:23`). Also `express` (`web/express_module.go`), `ui.dsl` (`uidsl/module.go:14-18`), and an opaque session-ID cookie (`web/session.go`). No http/fetch, kv, secrets or auth modules. `site_settings.go:94` says secrets/env are "intentionally not implemented in v1".
- **Q5, limits.** Request timeout via `http.TimeoutHandler` (`supervisor.go:202-206`); lambdas via `context.WithTimeout` (`lambda_runtime.go:261`). `Owner.Call` returns on `ctx.Done()` without interrupting the VM (`runtimeowner/runner.go:129`; grep also showed ctx.Done at :75, :152). `VM.Interrupt` appears only at `Runtime.Close` (`engine/runtime.go:143`). No memory or rate limits found. `web/body.go:14` uses `io.ReadAll(r.Body)` unbounded (grep line `14: data, err := io.ReadAll(r.Body)`). `app.static(prefix, dir)` mounts a host directory (`http.FileServer(http.Dir(dir))` in `web/host.go`). Warm-pool config is `WarmPoolDefaults` at `internal/config/config.go:52-59`. Bundle checks (`bundle.go:96-138`).
- **Q6, admin UI/API.** `GET/PUT /api/v1/sites/{site_id}/capabilities` (`handler.go:69-70`; body type in `site_settings.go:27-39`). A read-only, platform-admin-only `GET /api/v1/admin/capabilities` is at `handler.go:96` and `admin_inventory.go:123-139` (the `requirePlatformAdmin` definition at :123 and its uses at :143, :161, :179, :201 seen in grep). UI: `SiteSettingsPage.tsx:10, 91-93` (checkbox per hardcoded capability, config shown as JSON) and `AdminCapabilitiesPage.tsx:13` (read-only table). No CLI command for capabilities (grep of `cmd/go-go-host/cmds/*.go` returned nothing).
- **Q7, docs.** HOST-001 design doc: richer manifest `permissions`/`limits` proposed around lines 580-592 (not implemented), `BuildModules(spec.Capabilities, ...)` at line 495, "manifest permissions are requests; host policy grants the effective set" (594, 1164), and secrets/egress principles at 1191-1192. `runbooks/03-host-capability-security-review-checklist.md` is a per-capability checklist. `docs/contributing/runtime-and-deployment-guidelines.md:47-60` lists steps for adding a capability. `cmd/go-go-host/doc/js-api-reference.md:349-363` has a capability table. `HOST-006 ... tasks.md:78` has open security tests ("CPU loops, DB hard limit, denied capabilities, and runtime panic containment").
- **goja-hosting-site.** `pkg/app/server.go:71-74` uses `UseModuleMiddleware(engine.MiddlewareOnly("fs", "path", "time", "timer", "yaml"))` (seen at line 73 of the output). The only per-site config is DB policy: `pkg/app/multi_config.go:29-35`, `pkg/app/database.go:20-50`. No capability model.

### What didn't work
- Call 6: `grep -rn -i "capabilit\|PolicyCaps\|..." --include=*.go --include=*.sql . ...` failed in zsh with `(eval):1: no matches found: --include=*.go` (unquoted globs). The agent immediately re-ran it as call 7 with quoted `--include='*.go'`, which succeeded.
- Calls 25 and 28 each returned `Exit code 1` because `echo ======` / `echo ====` failed under zsh with `(eval):1: ===== not found` / `(eval):1: === not found`. The file content before the failing `echo` was still returned (the checklist head and the guidelines `sed` excerpt). The remaining greps of call 28 (HOST-013, HOST-006/009 design docs) were re-run without `echo` as call 29, which succeeded.
- Nothing found: no xgoja, providerapi, `modules.Register` or goja-bleve use anywhere in go-go-host; no per-module config consumer for `config_json`; no `UpdateSiteQuota`/`UpsertSiteQuota`/`SetSiteQuota` (call 37 grep); no capability CLI (`grep -rn -i 'capabilit' cmd/go-go-host/cmds/*.go`); no http/fetch/kv/secrets module; no `MaxBytesReader` request-body limit (call 40 grep returned only ReadTimeout/WriteTimeout lines).

### What I learned
- go-go-host has the right data model (manifest requests, per-site `site_capabilities(enabled, config_json)`, an API and a UI) but enforces it only when a bundle is uploaded; the runtime always gets the same module set and nothing reads `config_json`. The lesson for slop: decide the module set where the runtime is built, and consume the configuration there.
- Its HOST-001 design principle matches slop's: "manifest permissions are requests; host policy grants the effective set".

### What was tricky to build
- Telling a configured capability from an enforced one: the policy table, the API and the UI all exist, so the gap shows only by following `DefaultCapabilities()` to the three call sites in `deployments.go`.

### What warrants a second pair of eyes
- **"The `Database` field of `CapabilitySet` is never read, so express, ui, database, db and db.guard are always registered."** This is an inference from reading `runtime.go` and the `DefaultCapabilities` call sites. No grep for `.Database` reads was run in this transcript.
- **"No API to update quotas"** and **"no CLI command for capabilities"** are absence claims based on one grep each (call 37), with `head` limits.
- **"UpsertCapability requires org owner, not platform admin."** Backed: the read shows `s.ensureSiteRole(ctx, actorUserID, site.OrgID, store.RoleOrgOwner)` inside `UpsertCapability` (`internal/control/services.go`, call 11).
- **"Control plane is Postgres; site data is per-site SQLite."** Inferred from `JSONB`, `pgTime` and the DB path `data/sites/<siteID>/db/app.sqlite`; not stated in a single read.
- **"No egress control because there is no network module."** Based on `grep -n 'net/http\|fetch\|http.Client' -r internal/sitejs | head` (call 39); `express_module.go` and `body.go` use `net/http` for serving, and the claim is an inference that no outbound client exists.
- **File:line caveats.** Files read with plain `cat` or `sed -n A,Bp` show no line numbers in the output. Line numbers cited for `internal/sitejs/web/express_module.go:43-48`, `supervisor.go:201-206`, `lambda_runtime.go:38-90, 261`, `store/sites.go:61-72`, `httpapi/handler.go:69-70, 96`, `site_settings.go:27-39, 94` and `SiteSettingsPage.tsx:91-93` are therefore derived from the `sed` ranges or grep line prefixes rather than a numbered display; spot-verify. `internal/config/config.go:52-59` is backed only by a grep line listing. The files read with the Read tool (`README.md`, `bundle.go`, `runtime.go`, `deployments.go` 60-439) do have numbered lines.
- **Design-doc line numbers** (HOST-001 lines 495, 580-592, 594, 1164, 1191-1192) come from `grep -n` and `sed` ranges within 465-520, 580-640, 1160-1196, so they are backed. HOST-013 "lambdas inherit the same CapabilitySet" comes from a grep line, not a read of the document.
- **"No VM interrupt on timeout".** Backed by `runner.go` (ranges 60-170) and the `Interrupt` greps over go-go-goja v0.8.3 in the module cache; note it describes v0.8.3, not the newer v0.10.7 that transcript A inspected.

### What should be done in the future
- If slop adopts go-go-goja's engine, check whether v0.10.7 interrupts the VM on a request timeout (this research looked at v0.8.3).

### Code review instructions
- Start at go-go-host `internal/deploy/bundle.go` (`SafeCapabilities`, `validateManifest`), `internal/control/deployments.go:418-431` (`siteCapabilityPolicy`) and the `DefaultCapabilities()` call sites, then `internal/runtime/runtime.go:64-119`.

### Technical details
- Tool calls in the first (counted) turn: 43 total. 38 Bash, 4 Read, 1 SubagentHandback. The Read calls were `README.md`, `internal/deploy/bundle.go`, `internal/runtime/runtime.go`, and `internal/control/deployments.go` (offset 60, limit 380). No Grep or Glob calls.
- Distinct files read (approximate; Bash-derived plus the 4 Reads): about 33 files via `cat`/`sed`/`head` (including `AGENT.md`, `examples/hello-beta/go-go-host.json`, `internal/{control/services,httpapi/{handler,site_settings,admin_inventory},runtime/{supervisor,lambda_runtime},sitejs/web/{body,host,express_module,session,platform},sitejs/dbguard/*,store/{sites,limits}}.go`, migrations 001 and 007/008, the HOST-001 design doc and checklist, `docs/contributing/runtime-and-deployment-guidelines.md`, `cmd/go-go-host/doc/js-api-reference.md`, `AdminCapabilitiesPage.tsx`, `SiteSettingsPage.tsx`, four go-go-goja v0.8.3 files in the module cache, and goja-hosting-site `pkg/app/{server,multi_config,database}.go`).
- Duration: start 00:23:48.77Z, handback at 00:27:53.5Z (about 4m05s). The report was about 950 words (70 lines).

## Step 5: The short report, a safety stop on the diary request, and the work log instead

With both research reports in, I gave the user the short report they asked for (slop has most of the model, xgoja's provider contract is the one to reuse, go-go-host has the right data model but no runtime enforcement), and a seven-point design. The user then asked for diaries from the subagents and a long vault report. Asking the finished go-go-host subagent to write its own investigation as a diary entry was stopped by the API's safety classifier. I did not repeat that request. With the user's go-ahead ("try again with a different model?") I asked a Sonnet agent for something narrower: a work log built with go-minitrace from the two transcripts' tool calls, tool results and final reports only, explicitly excluding thinking blocks. That produced Steps 3 and 4.

### Prompt Context
**User prompts (verbatim):**
- "while you're at it and research xgoja and co, ask the subagent to keep a diary (see diary skill, backfill if necessary) and finish their work by  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill).      
 Commit and push the bsidian vault when done (go-go-parc vault)."
- "pass the writer the session ids and tell it to use go-minitrace to analyze the subagents work in more detailed as needed"
- "once the subagents are finished. actually, even if they are readonly, you can ask the agents to give you the diary and report as well on their normal response or so and then you can extract it to files yourself? anyway, you chose how you want to do it (make sure to write it all up in your own diary). commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
- "try again with a different model?"

**Assistant interpretation:** Keep a ticket diary (backfilled), record the subagents' work in it, and finish with a textbook-style deep-dive report in the go-go-parc vault, committed and pushed.
**Inferred user intent:** A durable, reviewable record of the research and a long-form write-up, without losing what the subagents saw.

### What I did
- Created ticket SLOP3-011 with `docmgr ticket create-ticket --ticket SLOP3-011 --title "Per-app modules: …" --topics goja,apps,architecture,security,hosting` and the diary with `docmgr doc add --ticket SLOP3-011 --doc-type reference --title "Diary"`, in a worktree on branch `ticket/slop3-011` from `origin/main` (the user's checkout untouched).
- Sent the finished go-go-host subagent a request to write its investigation as a diary entry in this file's format.
- After the stop, started a Sonnet general-purpose agent with go-minitrace (`go-minitrace convert claude-code --source-list … --output-dir …`, then `go-minitrace query run --archive-glob './out*/active/*/*.minitrace.json' --sql-file qN.sql --output json` over `sessions` and `tool_calls`). Output: `/tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/subagent-worklog.md`, folded into Steps 3–4.

### Why
- Explore subagents are read-only, so they could not write the diary themselves; returning it in a reply and saving it here was the user's suggestion.
- A work log from tool calls is evidence (what was opened and what it said), which is what a diary needs; it does not depend on the subagent recalling its own process.

### What worked
- The work log recovered every tool call of both subagents (55 and 43), with exact search patterns and the files read, and separated the claims backed by a tool result from inferred and absence claims (the "second pair of eyes" lists in Steps 3–4).

### What didn't work
- The diary request to the go-go-host subagent ended with: `API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). … Details: [reasoning_extraction]`, request `req_011CgkjAUcZuw6B6djm4PjtR`. The subagent's first turn (its report) was complete; only the follow-up failed. The same request was not sent to the other subagent.
- The work-log agent noted go-minitrace's limits: `convert claude` and `--source-list` on that verb do not exist (the verb is `convert claude-code`); `tool_calls.result` is truncated for long outputs; `position_in_session` is a fraction, so call order was recovered as `position × count`.

### What I learned
- Ask agents for evidence (calls, files, results), not for accounts of their own reasoning.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The absence claims flagged in Steps 3 and 4 (each rests on one limited grep).

### What should be done in the future
- For research subagents that should leave a diary, start them as general-purpose agents with write access to the diary path, and have them append entries as they go.

### Code review instructions
- Compare Steps 3–4 with the subagents' final reports (quoted in the parent session) and spot-check line numbers marked "derived from `sed` ranges".

### Technical details
- The short report's design points: one slop module type (class, `ConfigSchema` validated by slop, TypeScript, `New(SetupContext)`), adapting xgoja `providerapi.Module`; three decisions (platform catalog and safety class, manifest request, admin grant with `config_json` that wins); store reach only through bindings; module set fixed when the actor starts; an owner shim onto the actor's event loop; page-side functions as verbs; `fetch`, bleve and data-only modules first.

## Step 6: "Isn't each app its own sandbox?"

The user asked whether per-app isolation makes the unsafe modules harmless. It does not: each store running an app gets its own goja VM and a per-turn time limit, but a Go module runs in slop's own process with slop's privileges, so it grants whatever its Go code does. I checked the actor code to answer exactly, which also settled Step 2's open question about CPU limits.

### Prompt Context
**User prompt (verbatim):** "isn't each app its own sandbox?"
**Assistant interpretation:** Does the existing per-app isolation make module safety moot?
**Inferred user intent:** Avoid building a sandbox layer that is already there.

### What I did
- `grep -n 'goja.New()\|Interrupt\|ClearInterrupt\|SetMaxCallStackSize\|time.AfterFunc' pkg/actor/*.go`, `grep -rn 'TurnLimit *=' pkg/actor/`, read `pkg/actor/actor.go:150-160` (`build`) and `pkg/actor/manager.go:140-152` (`Get`).

### Why
- The answer decides whether modules need slop-owned backends at all.

### What worked
- One VM per store, not per app: `build` makes `vm: goja.New()` (`actor.go:159`), and the manager keys actors by store ID (`manager.go:33, 140`).
- `TurnLimit = 5 * time.Second` (`actor.go:32`), enforced with `time.AfterFunc(TurnLimit, func() { a.vm.Interrupt(…) })` for loading (`:195`), turns (`:384`) and other events (`manager.go:407`). No memory limit was found.
- Pages run on their own sandbox origin in the browser.

### What didn't work
- No failures observed.

### What I learned
- The VM boundary isolates JavaScript from JavaScript. It does nothing against a module whose Go code reads `/var/lib/slop/v3/system.db`, runs a command, opens any database or calls an internal address. A module is safe only if it is data-only or its backend is scoped to the app.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- No memory limit per VM: a module that buffers (bleve, fetch bodies) needs its own byte caps.

### What should be done in the future
- Module configuration should carry byte caps where a module buffers.

### Code review instructions
- `pkg/actor/actor.go:32, 159, 195, 384`; `pkg/actor/manager.go:407`.

### Technical details
- Data volume: `/var/lib/slop/v3` holds every store's SQLite, `system.db` and `secret.key` (SLOP3-009 Step 9); that is what a host-fs module would expose.

## Step 7: Database and HTTP first — slop's own modules with go-go-goja's API

The user set the constraints: modules either configured safely or slop's own sandboxed versions; no fs except a virtual in-memory one; no handle to other databases; possibly an interceptor or proxy for other modules; and database and HTTP endpoints first. I read go-go-goja's `database` and `express` modules to see whether they could be reused, and concluded: reuse their JavaScript APIs and TypeScript specs, but implement both on machinery slop already has (the turn's SQL, and the actor's route table). Neither needs a go-go-goja dependency. I sent the design to the user with one open decision.

### Prompt Context
**User prompt (verbatim):** "we want modules that can be configured safe, or slop's own version that is sandbox. no fs for example except against a virtual in memory fs. no handle passed to other dbs, and potentially a custom interceptor / proxy for other or just plain own modules. But important to me is: database, http (to expose endpoints) first.

How would we best do that?"
**Assistant interpretation:** Design the database and HTTP-endpoint modules first, safe by construction, and the general rule for everything after.
**Inferred user intent:** Get real functionality for apps soon, without opening the host.

### What I did
- go-go-goja v0.10.7: read `modules/database/database.go:1-110` (`QueryExecer`, `QueryExecerContext`, `Transaction*` interfaces, `WithPreconfiguredDB`, `WithConfigureEnabled`), `:221-240` (`Loader`: `configure`, `query`, `exec`, `begin`, `close`, each taking `runtimebridge.CurrentOwnerContext(vm)`), `:138-192` (`TypeScriptModule`); `modules/express/express.go:17-233` (`NewRegistrar(host *gojahttp.Host)`, exports `app`, `user`, `agent`, `sessionUser`, `oauth`, `anyOf`, `resource`, `rateLimit`; `app.get(pattern)` returning a route builder, `app.get(p, h)` removed in favour of `.public().handle(h)` / `.auth(…).allow(…).handle(h)`; `static(prefix, dir)` → `host.RegisterStatic`; `mount`, `listen`; `runtimebridgeOwnerAdapter` at :69); `pkg/gojahttp/request_response.go:88-100` (`res.status/set/type/json/send/html/redirect/end`) and `planned_dispatch.go:199-207` (`request`, `body`, `params`, `resources`).
- slop: read `pkg/actor/modules.go:170-215` (`sqlModule`: `all`, `one`, `run`, `transaction` over `a.turn().t.Query/Exec(store.CallerActor, …)` and SAVEPOINTs).

### Why
- Reusing go-go-goja's JavaScript API means scripts written for go-go-host and xgoja run on slop; implementing it on slop's turn and route table means no new path to the host.

### What worked
- **database:** `query` → `t.Query(store.CallerActor, …)`; `exec` → `t.Exec(…)` returning `{rowsAffected, lastInsertId}`; `begin()` → a SAVEPOINT handle (`commit` = `RELEASE`, `rollback` = `ROLLBACK TO`), because the turn already holds the transaction; `configure()` throws; `close()` does nothing. It reaches only the app's own store's SQLite. There is no DSN or store argument, so there is no handle to another database. Other stores stay behind `stores.open(alias)`. Optional configuration: read-only, maximum rows per query.
- **express:** `require("express").app()` with `app.get(p).public().handle(fn)` and `.allow(level|audience)` compiles into the actor's route table (`http: {'GET /p': {level, audience, run}}`), served by the existing `MatchRoute`/`serveActorRoute`. `res` is an adapter onto `toRes`. `static()` serves from the store's own tree, `listen` does nothing, `mount` is absent. Routes register only while `actor.js` loads. Level checks, the 1 MiB body limit, the four forwarded headers and the cache rule are unchanged.
- **General rule:** module classes `data` (go-go-goja data-only, as is), `own` (only the app's own store: database, express, an in-memory virtual fs) and `scoped` (outside reach only through a slop backend: fetch through an egress proxy, stores through bindings, bleve on the virtual fs or the store), each needing an admin's grant with `config_json`. A generic interceptor wraps every exported function (re-check the grant and audience policy, meter calls and bytes, log). go-go-goja modules are configured through their own options: fs `WithBackend(memfs)`, fetch `WithPolicy` + `WithHTTPClient` with slop's proxy transport.
- **Order:** database → express → module type, configuration and admin verbs → go-go-goja imports.

### What didn't work
- Reusing go-go-goja's `DBModule` with `WithPreconfiguredDB`: `QueryExecer` returns `*sql.Rows`/`sql.Result`, so it needs a raw `database/sql` handle. Giving it slop's connection would bypass the actor caller's SQL authorizer (SLOP3-005 A7: no app SQL as the kernel), and its `begin()` opens a real nested transaction inside the turn's. Rejected.
- Reusing go-go-goja's express as is: it is tied to `*gojahttp.Host`, whose `RegisterStatic(prefix, dir)` serves a host directory and whose auth builders duplicate slop's identity. Rejected; only the builder API is kept.

### What I learned
- go-go-goja's `database` is synchronous (it only reads the owner context), so it fits slop's turn without the async shim; the shim is needed only for modules that settle promises (fetch, timers).
- express's route builder already separates "who may call" (`.public()`, `.auth().allow()`) from the handler, which maps directly onto slop's per-route `level` and `audience`.

### What was tricky to build
- Transactions: the turn owns the transaction, so `begin()` must be a SAVEPOINT. A handle left open at the end of a turn must be rolled back (to its savepoint), not committed.

### What warrants a second pair of eyes
- Whether `database` and `express` should be on by default for every app with an actor (they reach only what `sql` and `http:` already reach) or need an admin grant. Asked the user.
- Express-compatible request and response semantics that slop cannot honour (streaming, arbitrary headers, cookies) must fail loudly rather than silently differ.

### What should be done in the future
- A design doc for the module type, grants with `config_json`, and admin verbs; then implementation in the order above.

### Code review instructions
- go-go-goja `modules/database/database.go:221` and `modules/express/express.go:166-233`; slop `pkg/actor/modules.go:172` and `pkg/actor/manager.go:572` (`MatchRoute`).

### Technical details
```js
const db = require("database");
const app = require("express").app();
app.get("/feed.json").public().handle((req, res) =>
  res.json(db.query("SELECT id, title FROM posts WHERE status = 'published'")));
// compiles to: http: { 'GET /feed.json': { level: 'public', run } }
```

## Step 8: HTTP endpoints — the mount is the prefix, and the policy lives on the mount

The user refined the HTTP requirement: an express-style module that cannot serve static files or listen, that only allows certain routes or route globs, under a configurable prefix, so that different apps can be given subpaths for API endpoints while slop keeps control of the endpoints and can add middleware. I checked how mounts assign paths and found that the prefix already exists: a mount maps host and path to a store and is set by an admin. So I recommended putting the HTTP policy on the mount, not only on the app, and sent the refinement to the report writer.

### Prompt Context
**User prompt (verbatim):** "1. make http / express configurable so that no static files / listen etc... is possible, or only certain routes or route globs, and a configurable prefix. that way we can assign different subpaths to apps that want to expose API endpoints, and we have control over the endopints ourselves, potentially passing middlewares and other stuff. Repeat what you understood from my approach and potentially better designs from yourselves, you know more about that area than i do"
**Assistant interpretation:** Restate the approach, then design the HTTP module's configuration: no static/listen, a route allowlist, a prefix per app, host-controlled middleware; improve on it where possible.
**Inferred user intent:** Let apps expose APIs on paths slop assigns, with slop, not the app, deciding what is reachable and how.

### What I did
- Read `pkg/registry/mounts.go:14-27` (`Mount{Host, Path, Store, StoreParam, Type, CreateApp, CreateAudience, Aliases, ChangedBy, ChangedAt}`; `Path` takes `/guestbook`, `/r/:store`, `/docs/*`).
- `grep -rn 'Content-Security-Policy' pkg/doors pkg/host pkg/httpx --include='*.go'`: CSPs are set in `preview.go:47`, `sandbox.go:114`, `live.go:699` (`frame-ancestors 'none'`), `storebytes.go:97` (`sandbox; default-src 'none'`), `office/admin.go:41` and `host/host.go:192`, but not in `serveActorRoute`.
- Sent the refinement to the report writer.

### Why
- A prefix the module config chose would duplicate what mounts do, and could disagree with them. Mounts are already admin-owned and are where an app is exposed, so endpoint policy belongs there.

### What worked
- The design:
  - the mount is the prefix, preferably on a dedicated API host;
  - an optional module `prefix` relative to the mount;
  - a proposed `Mount.API{prefix, routes, floors, middleware, responseTypes, forwardHeaders}`;
  - the effective routes are the app's registrations that match the allowlist, checked when `actor.js` loads (a registration outside it throws) and again at dispatch;
  - a level floor per glob;
  - `static`/`listen`/`mount` absent by construction;
  - host middleware in Go before the actor wakes (`rateLimit`, `cors`, `maxBody`, `methods`, `requireContentType`, `verifyHmac`, `apiToken`, headers and cache, metering), app middleware via `app.use` inside the turn;
  - JSON/text responses by default, HTML only if allowed and then with `CSP: sandbox`;
  - forwarded headers as an allowlist, never cookies or `Authorization`.

### What didn't work
- No failures observed.

### What I learned
- The same app mounted twice can need different endpoint policies (public vs internal), which a per-app module config cannot express. That settles "grant per app or per mount" for HTTP: per mount.

### What was tricky to build
- N/A (design).

### What warrants a second pair of eyes
- `serveActorRoute` sets only `X-Content-Type-Options: nosniff`. An actor route's HTML is served on the live host's origin, which other apps on that host share. Not yet checked whether that allows cross-app calls with the visitor's cookie (for example `/_site/*`, which checks only `sameOrigin`). To verify, independent of this ticket.

### What should be done in the future
- Verify the shared-origin observation above.
- Implementation ticket SLOP3-012.

### Code review instructions
- `pkg/registry/mounts.go:14`, `pkg/doors/pages/actors.go:serveActorRoute`, `pkg/doors/pages/storebytes.go:97`.

### Technical details
```jsonc
// Mount.api (proposed)
{ "prefix": "/api",
  "routes": ["GET /api/*", "POST /api/items"],
  "floors": { "POST /api/*": "interact" },
  "middleware": [{"name":"rateLimit","per":"visitor","rate":"60/m"}, {"name":"cors","origins":["https://…"]}],
  "responseTypes": ["application/json", "text/plain"] }
```
