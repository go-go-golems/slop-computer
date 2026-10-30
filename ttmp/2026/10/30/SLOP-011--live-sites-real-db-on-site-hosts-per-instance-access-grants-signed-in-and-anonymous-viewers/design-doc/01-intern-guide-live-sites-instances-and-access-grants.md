---
Title: 'Intern guide: live sites, instances and access grants'
Ticket: SLOP-011
Status: active
Topics:
    - architecture
    - auth
    - routing
    - collaboration
    - frontend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/server/serve.go
      Note: serveSite, serveSandbox, renderPage and staticRuntime; the site host today and the place live routes plug in
    - Path: repo://pkg/server/rt.go
      Note: Views (openView, newView, levelOf, grantedCaps, viewOf, viewEvents, viewRPC); levelOf is where grants come in
    - Path: repo://pkg/server/auth.go
      Note: Principal, guard/guardPerm, session cookies; the model the site session follows
    - Path: repo://pkg/rt/rules.go
      Note: Levels and db rules; the vocabulary grants are written in
    - Path: repo://web/workshop/src/screens/AppScreen.tsx
      Note: The Workshop shell; the site shell is a small copy of its handshake
    - Path: repo://web/runtime/src/transport.ts
      Note: The page side of the handshake (hello, view, renew, reload)
    - Path: repo://pkg/store/routes.go
      Note: Route and Binding; live routes and instance bindings extend them
ExternalSources: []
Summary: "How slop serves pages and runs apps today, and a phased design for running apps live on site hosts: site sessions for signed-in and anonymous viewers, instances named in the URL, a per-instance grant table, and a site shell that keeps one origin per instance."
LastUpdated: 2026-10-30T16:00:00-04:00
WhatFor: "Understanding slop's hosts, routes, runtime and identity well enough to implement live sites"
WhenToUse: "Before working on SLOP-011, or when asked who can open which app where"
---

# Intern guide: live sites, instances and access grants

This guide is for someone new to slop who will implement SLOP-011. It explains the parts of the system you need to understand first: hosts, artifacts, routes, page modes, the artifact runtime and identity. It then describes what is missing and proposes a design, with decisions, API changes, data model, pseudocode, phases and tests.

Read sections 2 to 4 even if you only implement one phase. Every phase touches at least two of the three hosts, and most bugs in this area come from mixing them up.

The companion document is the SLOP-009 guide, `ttmp/2026/10/29/SLOP-009--…/design-doc/01-intern-guide-the-slop-artifact-runtime.md`. It explains the runtime contract per capability in depth. This guide repeats only what you need here.

## 1. Executive summary

Today an app such as Claude Blocks runs live in exactly one place: the Workshop at `/run/<target>` on the main host, and only for admins. On the public site host the same app can only run in **static mode**: a frozen copy of the data (`db.json` in a saved version), read-only, with no viewer identity and no rules. The site host never knows who is visiting.

The user wants three things:
1. Apps on the site host should run against the real, live database.
2. Viewers should be either signed-in people or anonymous sessions, with their own ids.
3. A database instance should be nameable in the URL (`/blocks/<db>`), and it should be possible to see who has access to it.

All three can be built on what exists. The runtime already scopes everything (documents, rooms, assets, leases) by **target**, an artifact id. A data artifact with `app = blocks` already is a database instance. A view already carries a person and a level, and every capability reads them. The new work is in three places:

| Area | What to build |
|---|---|
| **Identity on site hosts** | A site session cookie for signed-in users (handed over from the main host) and for anonymous visitors (`vis_…` ids) |
| **Access** | A grant table per target, so `levelOf` can return `view` or `interact` to people who are not admins, plus share links and an access API |
| **Serving** | Live routes: the site host serves a small **site shell** that opens a view and frames the instance's own origin, exactly as the Workshop does at `/run` |

The runtime itself (`pkg/rt`, the rules engine, `claude.js`) changes very little. The proposed order is five phases (section 10):
1. a live route for signed-in admins;
2. grants and a member role;
3. instances in the URL and share links;
4. anonymous visitors with quotas;
5. Workshop UI and documentation.

## 2. Orientation: the three hosts

slop answers on three kinds of host. Which one a request arrives on decides everything else: which handlers run, whether there is a session, and what a page may do.

```text
                       one slop process (pkg/server.Server.Handler, server.go:160)
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
   MAIN HOST                       SITE HOSTS                     SANDBOX ORIGINS
   localhost:18140                 site.localhost:18140           s<label>.sandbox.localhost:18140
   (Config.PublicURL)              (Config.SiteHosts)             (Config.SandboxDomain)
         |                               |                               |
   s.mux: Workshop, /api/*,        serveSite (serve.go:334)        serveSandbox (serve.go:472)
   /auth/*, /run/*, /_/            route table -> page             one origin per target:
   session cookie, guards          no cookie, no principal         /v/<n>/ pages, /_rt/* runtime
         |                               |                               |
   admins work here                the public reads here          apps run here, in an iframe
```

`Server.Handler` (`pkg/server/server.go:160-197`) chooses in this order:
1. If the host is not a main-host origin (`isMainHost`, `server.go:149`):
   - a sandbox label (`sandboxLabel`, `serve.go:451`, pattern `^s[0-9a-f]{20}$`) goes to `serveSandbox`;
   - a configured site host goes to `serveSite`;
   - `/healthz` and `/readyz` go to the mux;
   - anything else gets 421.
2. Otherwise the request goes to the main mux, with `X-Frame-Options: DENY`.

In local mode (`slop serve --local`, `cmd/slop/cmds/serve.go:137-151`) the defaults are:
- main host `http://localhost:<port>`;
- site host `site.localhost:<port>`;
- sandbox domain `sandbox.localhost:<port>`.

Browsers resolve `*.localhost` to loopback, so all three work without DNS.

**Key fact for this ticket:** only the main mux has authentication. `serveSite` and `serveSandbox` never call `s.resolve` or `guard`. The comment at `serve.go:24-26` says it plainly: "Neither carries the main host's session cookie." Cookies are host-only (`setCookie`, `auth.go:57-61`, no `Domain`), so a cookie set on `localhost` is never sent to `site.localhost`.

## 3. Orientation: artifacts, versions, routes

### 3.1 Artifacts and versions

An **artifact** is a named, versioned folder of files (`pkg/store/artifacts.go`). Each push creates version `n` (immutable); `main` points at the version the world sees. There are two kinds (`002_kernel.sql:13`):
- **page**: has an `index.html`; can be routed and rendered.
- **data**: files read by pages (records), or, with `app` set, a database instance for an app.

`artifacts.app` (added in `007_runtime.sql`) names the app that runs a data artifact. For example `ws-team` is `kind = data, app = blocks`. `artifacts.created_by` references `users(id)`.

Useful commands (local server, with a token):

```sh
slop artifacts list                       # id, title, kind, type, project, main, latest
slop push <dir> -a <id> -m "message"      # new version
slop pull <id> <dir>                      # write a version into a folder
```

### 3.2 Routes and bindings

A **route** maps `host + path` to a page (`pkg/store/routes.go:26-37`):

```go
type Route struct {
    Host, Path, Page string
    PageFrom string               // page id template filled from :params (SLOP-003)
    Version  *int                 // nil: follow the page's main
    Bindings map[string]Binding   // name -> data artifact (+ optional pinned version)
    Record   string               // record pattern filled from :params
    Access   string               // "public" or "admins"
    ...
}
type Binding struct { Artifact string; Version *int }
```

- Paths support `:param` segments and a trailing `*` (`pkg/routing/routing.go:18-43`).
- `Resolve` picks the most specific match (literal 3 > `:param` 2 > `*` 1) and returns a `Resolution{Route, Params, Record, Page, Missing, Fallback}` (`routing.go:79-144`).
- Every change is logged in `route_log` and can be undone (`UndoRoute`, `routes.go:323`).
- `Access = "admins"` routes are **not served on the site host at all**: `serveSite` keeps only `Access == "public"` (`serve.go:351-356`). They are visible only in Workshop previews.

```sh
slop route set /pricing pricing@7
slop route set /journal/:slug journal-post --record 'posts/{slug}.md' --bind posts=journal
slop route set /proto/live/:screen pinup-player --bind target=design-live
slop route list
slop route undo /pricing
```

A **binding** gives the page data: `bindings()` (`serve.go:99-123`) starts from the page manifest's `reads`, adds `$tokens`, and lets the route override by name. A binding resolves to `ResolvedBinding{Artifact, Version, N}`, where `N` is the pinned version or the data artifact's `main`.

The binding named **`target`** is special. On a site route it is the database the app reads (section 4.4).

### 3.3 Page modes

`renderPage` (`serve.go:126-183`) injects a boot block into the page's `index.html`. The boot's `mode` (`pkg/render/render.go:20-26`) tells the page where it is:

| Mode | Where | Scripts injected (`render.Inject`, `render.go:70-109`) | Runtime |
|---|---|---|---|
| `site` | site host | `runtime.js` | none (`window.claude` absent) |
| `static` | site host, page is an app with a `target` binding | `runtime.js`, `claude.js` | read-only `db` from `db.json`, `user` without id, others `null` |
| `preview` | sandbox, Workshop `/watch` | `runtime.js`, `claude.js`, `bridge.js` | none: every `use()` resolves `null` |
| `thumb` | sandbox, Workshop thumbnails | same as preview | none |
| `app` | sandbox, Workshop `/run` | `runtime.js`, `claude.js` | live: a view, the stream and RPC |

The boot (`render.Boot`, `render.go:29-40`) carries `route`, `data`, `record`, `version`, `mode`, `tokens`, `parentOrigin` and `runtime`. `render.Runtime` (`render.go:43-49`) carries `target`, `app`, `version`, `caps` and, in static mode only, `docs`.

This table answers the question that started this ticket. `/watch/blocks` is a **preview**, so Ask Claude refuses there. `/run/ws-team` is **app** mode, so it works. `site.localhost/blocks/team` is **static**.

## 4. Orientation: the artifact runtime

The runtime (SLOP-009) implements the claude.ai Artifact contract natively: a page calls `await claude.use("db")` and gets a database. There are two halves:
- the page side, `web/runtime/src`, built into `pkg/render/assets/claude.js`;
- the server side, `pkg/rt` (semantics) plus `pkg/server/rt.go`, `rt_more.go` and `rt_sample.go` (HTTP).

### 4.1 Apps and targets

- An **app** is a page version whose `slop.json` declares `capabilities` (`rt.ParseManifest`, `pkg/rt/manifest.go:44-140`; `Caps.IsApp()` is `len(Declared) > 0`).
- A **target** is the artifact whose db, rooms, assets and leases a view uses. A page opened on itself is its own target. A data artifact with `app` set is a target run by that app.
- `rtTarget(ctx, id, n)` (`rt.go:86-97`) resolves a target to its app and the app version that governs it (`n`, or the app's main).

Blocks' manifest (`web/blocks/slop.json`):

```json
{ "capabilities": {
    "db": {}, "user": { "scopes": ["profile"] }, "room": { "topics": { "ops": "interact" } },
    "sample": { "images": true }, "assets": {}, "downloads": true } }
```

### 4.2 One origin per target

Every target gets its own sandbox origin. The label is `"s" + hex(HMAC-SHA256(serverKey("sandbox"), "target\x00"+id))[:20]`. It is stored in `rt_origins(label PK, target_id UNIQUE)` and created lazily by `Store.RTOrigin` (`pkg/store/rt.go:245-255`).

`serveSandbox` (`serve.go:472-584`) looks the label up (`RTOriginTarget`), puts the target in the request context (`originTarget{}`), then serves:

| Path | Handler |
|---|---|
| `GET /_rt/events` | `viewEvents`: the view's SSE stream |
| `POST /_rt/rpc` | `viewRPC`: every capability call |
| `POST /_rt/assets` | `uploadAsset` |
| `POST /_rt/sample`, `…/cancel`, `…/tools/{use}` | `startSample`, `cancelSample`, `sampleTool` |
| `/_rt/api/*` | `slopProxy`: the `slop` capability reaching the main API |
| `/_blob/{id}` | `serveAsset` |
| `/v/<n>/` | the app version's `index.html`, rendered in `app` mode (or `?mode=`) |

Why one origin per target matters:
- **Browser storage stays per instance.** Each workspace's `localStorage`, IndexedDB and caches are separate.
- **A secret only works on its own origin.** `viewOf` (`rt.go:319-332`) rejects a view secret whose target differs from the origin's target, so a page on workspace A's origin cannot use a secret for workspace B.
- **Nothing else runs there.** The page on that origin is the app itself. No other page shares the origin, so nothing else can read its memory.

The page HTML at `/v/<n>/` is served with no authentication. That is safe because it is code, not data: data is only reachable with a view secret.

### 4.3 Views, secrets and the handshake

A **view** is one open page (or agent) on a target. It lives in memory only (`pkg/rt/views.go:24-48`):

```go
type View struct {
    ID, Secret       string   // "v…", "slv_…"
    Target, App      string
    Version          int
    User, Name       string   // a users.id today
    Level            Level    // none < view < interact < admin < owner
    Caps             Caps     // the app version's parsed manifest
    Perms            []string // approved slop permissions
    Kind             string   // "viewer" | "agent"
    Expires          time.Time // now + ViewTTL (1h); renewed by the shell
    ...
}
```

How a view is opened (`openView`, `rt.go:217-238`):
1. `POST /api/rt/views {target, version}` is guarded `guard(admin, noToken, …)`, so only a signed-in admin's browser can call it.
2. `newView` calls `rtTarget`, then `levelOf(user, target)`. `LevelNone` is refused with `not_granted`.
3. It computes approved `slop` permissions and registers the view.
4. `targetURL` builds `<scheme>://<label>.<sandbox>/v/<n>/?mode=app&parent=<requestOrigin>`.
5. The response (`viewOut`) has `view`, `secret`, `url`, `origin`, `level`, `caps`, `asks` and `expiresAt`.

The handshake between the shell (the Workshop) and the page:

```text
 Workshop AppScreen (main host)             app page (target origin)               server
 ------------------------------             ------------------------               ------
 POST /api/rt/views {target} ------------------------------------------------------> newView
 <------------------------------------------------- {view, secret, url, origin} ---
 <iframe src=url sandbox="allow-scripts allow-same-origin ...">
                                            claude.js boots (mode "app")
                                            connect(): post {type:"hello"} to parent
 on "hello": post {type:"view", view, secret, expiresAt} --->
                                            fetch /_rt/events (Bearer secret) ------> viewEvents
                                            <------------------------------------ event: hello {caps, me, rev, ...}
                                            claude.use("db") resolves
                                            POST /_rt/rpc {method, args} --------> viewRPC
 every 45 min: POST /api/rt/views/{v}/renew; on 401 the page posts {type:"renew"}
 on "reload" (after artifact.publish): open a view on the new version, swap the iframe
```

Files:
- **Shell:** `web/workshop/src/screens/AppScreen.tsx`. `open` is at `:56-64`, `give` at `:52-55`, the message handler (`hello`, `renew`, `consent`, `download`, `compose`, `permissions`, `reload`, `navigate`, `args`) at `:80-128`, and the iframe at `:166-168`.
- **Page:** `web/runtime/src/transport.ts`. The listener at `:86-105` only accepts messages where `e.origin === boot.parentOrigin && e.source === window.parent`. `connect` is at `:261-275`, `startStream` at `:167-223`, `rpc` at `:278-308`. All fetches send `credentials: "omit"`; the secret travels only in `Authorization: Bearer`.
- **Parent origin:** `serveSandbox` forces `?parent=` to be one of the main-host origins (`serve.go:562-565`), and `frameAncestors` sets `frame-ancestors 'self' <main origins>` (`serve.go:209-211`). **Today only the main host can be the shell.** Section 6.3 changes that.

### 4.4 Static mode (the site host today)

On a site route, `renderPage` treats a binding named `target` specially (`serve.go:144-151`). If the page is an app, `staticRuntime` (`serve.go:589-606`) builds a runtime boot whose `docs` field is the `db.json` file of the bound target version, or `{}`. The page boots in mode `static`.

In static mode (`web/runtime/src/static.ts`, `index.ts:15-19`):
- `db` serves those documents read-only. Writes reject with "this page is read-only", and `onSnapshot` fires once.
- `user` is a viewer with no id.
- Every other capability resolves `null`.

Two consequences:
- **No rules apply.** Everything in `db.json` is public, including `data/users/<id>/…` paths if they were saved into it.
- **Apps that need a user id never read the snapshot.** Blocks needs `me().id`; without one it falls back to "memory mode" and seeds its welcome example (`web/blocks/src/blocks.js:514`). So the demonstration route `site.localhost:18140/blocks/team` shows the example, not `ws-team`'s data.

Pinup's player (`pinup-player`, `web/pinup/slop/js/00-slop.js:15`) is written for static mode, and Pinup's *Save version* writes the `db.json` it reads.

### 4.5 Levels and rules

Levels (`pkg/rt/rules.go:13-20`) are ordered:

```text
none < view < interact < admin < owner          (self: a level nobody holds)
```

They mirror claude.ai's roles: view = Viewer/Commenter, interact = Contributor, admin = Editor, owner = Owner.

- **Manifest rules.** An app's `db.rules` set the minimum level to read and write a path prefix. The defaults are read `view` and write `interact`. Deeper rules override; `{self}` as the last segment matches the caller's own id (`Rules.Need`, `rules.go:108-141`).
- **Private paths.** `data/users/<id>/…` is readable and writable only by that id, whatever the level (`privateOwner`, `paths.go:49-55`).
- **Owner.** `meets(have, need)` is `need != self && have >= need`, so the owner passes every rule except `self`.

`levelOf` (`pkg/server/rt.go:101-109`) is the only place a person's level on a target is decided:

```go
func levelOf(u store.User, t store.Artifact) rt.Level {
    switch {
    case u.Role != store.RoleAdmin:                      return rt.LevelNone
    case t.CreatedBy != nil && *t.CreatedBy == u.ID:     return rt.LevelOwner
    }
    return rt.LevelAdmin
}
```

It never returns `view` or `interact`. Those levels exist in the rules engine and in room topics (`manifest.go:100-105`), but nobody can hold them yet. **Grants (section 6.2) fill this gap.**

### 4.6 What each capability checks today

`grantedCaps(v)` (`rt.go:130-169`) decides which declared capabilities a view gets. `viewRPC` refuses any method whose capability is not granted (`not_granted`).

| Capability | Server-side check today |
|---|---|
| `db` | `Rules.CanRead` / `CanWrite` per path with `v.User`, `v.Level` (`rpcDBGet` `rt.go:580`, `dbWrite` `:668`) |
| `user` | `hello.me` = `userInfo(v)` (`rt.go:886-899`): `isOwner` (level owner), `canEdit` (≥ admin), `can["data.write"]`; `id` and `profile` only if declared |
| `room` | Emits need `LevelAdmin` unless the topic is listed in `room.topics` (`rpcRoomEmit`, `rt_more.go:133-173`). Peers carry `guest: false` (hard-coded at `:166`) |
| `assets` | Granted only at ≥ admin (`grantedCaps`) |
| `comments` | Consent per user and app (`rt_consents`) |
| `sample` | `sampleView` (`rt_sample.go:83-100`): ≥ admin and consent; no per-person budget |
| `artifact` | Only when target == app; `publish` needs ≥ admin (`rt_more.go:449`) |
| `slop` | Approved permissions, and the view's user must still be an admin (`guardPerm`, `auth.go:134-155`) |
| `downloads`, `permissions` | No server check (handled in the shell) |

## 5. Orientation: identity

### 5.1 Users and roles

`users` (`001_auth.sql:4-16`) holds people keyed by `(issuer, subject)`. Roles (`pkg/store/users.go:12-16`):
- **`admin`**: may use the Workshop, open views, hold tokens.
- **`pending`**: signed in but not approved. New OIDC users start here (`auth.go:285`).
- **`disabled`**: locked out.

Changing a role away from admin revokes the user's sessions and tokens (`SetUserRole`, `users.go:92-121`) and closes their views with `revoked` (`pkg/server/users.go:58-62`).

There is **no member role** (signed in, approved, not admin) and **no anonymous identity** anywhere.

### 5.2 Sessions and guards

- **Cookie.** The browser session cookie is `__Host-slop_session` on https, `slop_session_dev` otherwise (`auth.go:43-48`). It is `HttpOnly`, `SameSite=Lax` and host-only. Only `Hash(token)` is stored (`sessions` table, `pkg/store/sessions.go`). Idle expiry is 7 days, absolute 30 days.
- **Principal.** `Principal{Session, User, Token, View}` (`auth.go:21-30`) is attached only by `guardPerm` (`auth.go:123-201`), never by a global middleware.
- **Guards.** Every route declares a level (`public`, `session`, `admin`) and a token scope (`noToken`, `anyToken`, `scopeRW`, `scopeAdmin`). A browser mutation must pass `sameOrigin` and the `X-CSRF-Token` check (`auth.go:185-198`).
- **API tokens.** `slp_…` tokens are admin-only (`ScopesForRole`, `tokens.go:23-28`). Agents use them with `slop data` and to open agent views (`POST /api/rt/targets/{t}/views`).

### 5.3 Sign-in

- **OIDC.** `GET /auth/login?return=…` stores a login flow and redirects to the provider. `GET /auth/callback` exchanges the code, calls `signIn`, sets the cookie and redirects to the return path (`auth.go:234-291`). `safeReturn` (`auth.go:214-223`) only allows local paths, never another host.
- **Local mode.** `POST /auth/local` signs a nickname in with `--local-role` (default `admin`). `POST /api/local/token` mints a token for loopback clients (`pkg/server/local.go`).

### 5.4 Limits

The only generic limiter is `pkg/server/limiter.go`, a sliding window keyed by string. It is used only by device login (`device.go:42, 101, 197`). The runtime has one throttle: room emits at 40/s with a burst of 80 per view (`View.AllowEmit`, `views.go:183-207`). The runtime limits table is in `pkg/rt/limits.go`: 256 KiB per document, 25,000 documents per target, 20 MiB per asset, 256 KiB per prompt, and so on.

## 6. The gap and the design

### 6.1 What is missing

| Need | Today | Missing piece |
|---|---|---|
| Live data on a site route | static `db.json`, no rules | a live route mode and a site shell |
| Know who is visiting the site | nothing | a site session: signed-in user or anonymous visitor |
| Non-admins in a live view | `levelOf` returns none | grants and a member role |
| Name an instance in the URL | one route per target | instance routes `/blocks/:db` |
| Share an instance | no mechanism | share links |
| See who has access | admins implicitly; no list | an access API, CLI and panel |
| Keep anonymous use affordable | n/a | per-principal quotas and rate limits |

Goals:
1. A site route can run an app live against its target, with rules applied.
2. Viewers are users or anonymous visitors, each with a stable id.
3. Instances are addressable (`/blocks/<db>`) and creatable by policy.
4. Access is explicit, inspectable and revocable per instance.
5. Everything goes through views, so every capability works without special cases.

Non-goals:
- Changing the runtime contract or `claude.js`'s API.
- Public write access without any identity: even anonymous visitors get an id.
- Billing.
- Replacing static mode. Snapshots stay for deliberate freezing (prototypes, archives).

### 6.2 Concepts

- **Instance**: a target, usually a data artifact with `app` set. The URL names it; its id is the artifact id. No new storage.
- **Principal**: who a view acts for. Either a user (`usr_…`) or an anonymous visitor (`vis_…`). Agents keep using tokens.
- **Grant**: a row giving a subject a level on one target. Subjects can be a user, a visitor, everyone signed in, anyone, or a share link.
- **Site session**: a cookie on a site host that names a principal.
- **Site shell**: the small page a live route serves on the site host. It opens a view and frames the instance's own origin, like `AppScreen`.

```text
 browser at site.host/blocks/team
        |
        |  GET /blocks/team  (cookie slop_site=…)
        v
 serveSite --resolve--> route {page: blocks, target: ws-team, live: true}
        |
        |  serves the SITE SHELL (HTML + /_slop/shell.js), not the app
        v
 shell: POST /_site/views {route path}   (same origin, site cookie)
        |
        v
 openSiteView: principal from the site session
               target from the route (or from :db)
               level = levelOf(principal, target)      <- grants
               newView(...)  ->  {secret, url on s<label>.sandbox, ...}
        |
        v
 shell frames https://s<label>.sandbox/v/<n>/?mode=app&parent=https://site.host
 page boots, says hello, receives the secret, streams /_rt/events ...  (unchanged)
```

### 6.3 The site shell, and why the app does not run on the site origin

The obvious shortcut is to render the app directly on the site host in `app` mode, with the secret in the boot block. **Do not do this.**
- **Other pages could read the secret.** Every page routed on a site host shares that origin. Any of them could `fetch('/blocks/other-db')`, read the injected secret, and act as the visitor in an instance the visitor never opened.
- **Instances would share storage.** Browser storage would be shared across all instances and pages.

The design keeps the SLOP-009 rule: **an app runs only on its target's origin.** The site host serves a shell, and the shell frames the target origin.

The shell is small, much smaller than `AppScreen`:
- It is plain JS, embedded as `pkg/render/assets/shell.js`, with no React.
- It is a full-viewport iframe with a thin bar showing who you are, a sign-in link and, later, an access button.
- It speaks the same message protocol: `hello` → `view`, `renew`, `consent`, `download`, `reload`, `navigate`, `args`. Anything it does not implement (`compose`, `permissions` UI) is answered with the decline reply the runtime already handles.

Server changes for framing:
- **Parent origin.** `?parent=` on the sandbox must also accept site-host origins. Change `serveSandbox`'s check (`serve.go:562-565`) from `s.origins()` to `s.origins() + s.siteOrigins()`.
- **Frame ancestors.** `frameAncestors` on the sandbox must add the site origins.
- **Request origin.** `targetURL` takes the parent from `requestOrigin(r)`. For a site request that is the site origin, which is what the page should trust.

**The remaining same-origin risk.** The shell itself lives on the site origin, and `/_site/views` answers any same-origin request carrying the site cookie. A hostile page routed on the same host could call it. Mitigations, in order of strength:
1. **Serve non-shell site pages with a CSP `sandbox` directive** (`Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox`, without `allow-same-origin`). The page then has an opaque origin. Its requests to `/_site/*` are cross-origin and carry no `SameSite` cookie, and it cannot read the shell's responses. Public data under `/_d/` then needs `Access-Control-Allow-Origin: *` (it is public anyway). This must land before members or anonymous visitors (phase 2).
2. **Make `/_site/views` hard to call from anything but the shell.** Require `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Dest: empty`, an `Origin` equal to the site origin, and `Content-Type: application/json`.
3. **Mark the cookie `SameSite=Strict`, `HttpOnly`, path `/`.**

Recommendation: do 2 and 3 in phase 1 (admins only, pages are admin-authored) and 1 in phase 2.

### 6.4 Site sessions: signed-in users

A site host needs its own session, because cookies do not cross hosts. A signed-in user gets one by a **handoff** from the main host:

```text
 site.host/blocks/team             main host                               site.host
 shell "Sign in" -------------->   GET /auth/handoff?host=site.host&return=/blocks/team
                                   no main session? -> /auth/login?return=<this URL> -> back here
                                   main session ok:
                                     code = random; store hash(code) -> {user, host, return}, 60 s
                                   302 -> https://site.host/_site/callback?code=…
                                                                          consume(code) once
                                                                          create site session for user
                                                                          Set-Cookie slop_site=…; 302 return
```

Rules:
- **Allowlist the host.** `host` must be in `Config.SiteHosts`, otherwise it is an open redirect. `return` goes through `safeReturn`.
- **Codes are single-use and short-lived** (reuse the `login_flows` pattern: hash stored, atomic consume).
- **Store the site session in a new table** (6.7), keyed by token hash and host. A user revoked on the main host (`RevokeUserSessions`) must also lose their site sessions. Extend that function.
- **Sign-out** on a site host revokes only that site session.

### 6.5 Site sessions: anonymous visitors

A visitor without a site session gets one on the first `POST /_site/views`, if the route allows anonymous viewers. That session names a **visitor**: a new principal `vis_<random>` stored in a `visitors` table (6.7). Visitors give apps what they need:
- **`user.id()`** returns the visitor id, stable for as long as the cookie lives. Blocks then runs in db mode instead of memory mode.
- **`data/users/<vis_…>/`** is private to that visitor, through the existing `privateOwner` check.
- **`{self}` rules** work for visitors.
- **Rooms** show visitors as peers with `guest: true` (today hard-coded false at `rt_more.go:166`), with the name "Guest" and a color from the id.

When a visitor later signs in, the site session upgrades in place. Optionally, the visitor's private data can be **claimed**: copy `data/users/<vis>/…` to `data/users/<usr>/…` per target, and record `visitors.claimed_by`. Make claiming explicit (a button), not automatic.

Why a separate `visitors` table and not `users` rows with a new role:
- **The Workshop stays clean.** `users` is the admin-facing people list; thousands of anonymous rows would bury it.
- **Different lifecycle.** Visitors expire and are garbage-collected.
- **The cost is small.** A few foreign keys that point at `users(id)` must accept visitor ids: `rt_consents.user_id` and `artifacts.created_by` (6.7).

### 6.6 Grants and `levelOf`

A grant gives one subject a level on one target. Subjects:

| Subject | Meaning |
|---|---|
| `usr_…` | one user |
| `vis_…` | one anonymous visitor (usually from a share link) |
| `*signed-in` | anyone with a user site session (role member or admin) |
| `*anyone` | anyone, including anonymous visitors |

`levelOf` becomes:

```go
// levelOf is a principal's level on a target: the highest of what their
// role, authorship and grants give them.
func (s *Server) levelOf(ctx context.Context, p Principal, t store.Artifact) rt.Level {
    best := rt.LevelNone
    if p.User != nil && p.User.Role == store.RoleAdmin {
        best = rt.LevelAdmin                       // unchanged: admins administer every target
    }
    if owner, ok := s.ownerOf(ctx, t); ok && owner == p.ID() {
        return rt.LevelOwner                       // creator (user or visitor)
    }
    for _, g := range s.Store.RTGrantsFor(ctx, t.ID, p.Subjects()) {
        best = max(best, g.Level)                  // Subjects(): id, "*anyone", "*signed-in" if a user
    }
    return min(best, s.capFor(p))                  // e.g. visitors capped at interact
}
```

Notes for the implementer:
- **Disabled and pending users** get nothing from grants. `Subjects()` returns no subjects for them.
- **Level caps by principal kind** stop a mistaken grant from making an anonymous visitor an admin. Recommended caps: visitors ≤ `interact`, members ≤ `admin`, admins unlimited.
- **The owner of a target created by a visitor** is recorded in a grant row with level `owner`, because `artifacts.created_by` references `users`. Either relax that foreign key (6.7) or keep owner-by-grant only. Recommendation: owner-by-grant for visitors; `created_by` stays for users.
- **Revocation.** When a grant is removed or lowered, close the affected views with `revoked` (`views.Where(func(v) bool { return v.Target == t && v.User == subject })`). The page then asks the shell to renew, and the new view gets the new level. A grant change to `*anyone` closes all views of the target that rely on it. Simplest: re-evaluate `levelOf` for every view of the target and close those whose level changed.

### 6.7 Data model

New tables (SQLite spelling; Postgres uses `TIMESTAMP WITH TIME ZONE`). Migration `008_live_sites.sql`:

```sql
-- Anonymous principals. Their cookie lives in site_sessions.
CREATE TABLE visitors (
    id text PRIMARY KEY,                 -- vis_<base32>
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    claimed_by text REFERENCES users(id) -- set when a user claims the visitor's data
);

-- A session on one site host: a user (after handoff) or a visitor.
CREATE TABLE site_sessions (
    token_hash blob PRIMARY KEY,
    host text NOT NULL,
    user_id text REFERENCES users(id),
    visitor_id text REFERENCES visitors(id),
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    CHECK ((user_id IS NULL) <> (visitor_id IS NULL))
);
CREATE INDEX site_sessions_user ON site_sessions (user_id);

-- One-time codes for the main-host -> site-host handoff.
CREATE TABLE site_handoffs (
    code_hash blob PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    host text NOT NULL,
    return_path text NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);

-- Who may open a target, at which level.
CREATE TABLE rt_grants (
    target_id text NOT NULL REFERENCES artifacts(id),
    subject text NOT NULL,               -- usr_…, vis_…, *signed-in, *anyone
    level text NOT NULL CHECK (level IN ('view','interact','admin','owner')),
    via text NOT NULL DEFAULT '',        -- '' or the share link id that created it
    created_by text,                     -- usr_… or vis_…
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (target_id, subject)
);

-- Share links: possession of the token grants a level.
CREATE TABLE rt_links (
    id text PRIMARY KEY,                 -- lnk_…
    target_id text NOT NULL REFERENCES artifacts(id),
    token_hash blob NOT NULL UNIQUE,
    level text NOT NULL CHECK (level IN ('view','interact')),
    created_by text,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP
);
```

Changes to existing tables:
- **`routes`** gets `live integer NOT NULL DEFAULT 0` and `viewers text NOT NULL DEFAULT 'signed-in'` (`'admins' | 'signed-in' | 'anyone'`: who the shell lets open a view at all), plus `create_policy text NOT NULL DEFAULT ''` (`'' | 'admins' | 'signed-in' | 'anyone'`) for instance routes.
- **`rt_consents.user_id`** drops its foreign key to `users` so visitor ids fit. SQLite needs a table rebuild: create a new table, copy, drop, rename.
- **`users.role`** CHECK gains `member`.

Store functions to add in `pkg/store`:
- `CreateVisitor`, `TouchVisitor`;
- `CreateSiteSession`, `ResolveSiteSession(host, token)`, `RevokeSiteSession`, `RevokeUserSiteSessions`;
- `SaveHandoff`, `ConsumeHandoff`;
- `RTGrants(target)`, `RTGrantsFor(target, subjects)`, `RTSetGrant`, `RTRemoveGrant`;
- `RTCreateLink`, `RTLinkByToken`, `RTRevokeLink`, `RTLinks(target)`.

### 6.8 Live routes and instance routes

A route becomes live with a flag. Its `target` binding can be fixed, or filled from a path parameter, the same way `--record` is filled today (`fill`, unexported, `pkg/routing/routing.go:93`; export it as `routing.Fill`):

```sh
# one fixed instance, live
slop route set /blocks/team blocks --bind target=ws-team --live --viewers signed-in

# any instance of this app, named in the URL
slop route set /blocks/:db blocks --bind 'target={db}' --live --viewers anyone --create signed-in
```

Rules for a templated target:
- **Validation.** The filled id must be a data artifact whose `app` is the routed page. Anything else is a 404. This stops `/blocks/<some-other-artifact>` from opening unrelated data.
- **Unknown ids.** An unknown id gives the shell an "instance not found" screen, with a create button if the create policy allows.
- **`?db=XXX`.** The user's idea maps onto this route form. Prefer the path form: it works with the route table, the route log and `Resolve` specificity. A query alias can be added later in the shell.

Instance creation: `POST /_site/instances {route}` on the site host.
1. Check `create_policy` against the principal.
2. Create a data artifact `{id: "i_<base32 12>", kind: data, app: <page>}`. Ids are unguessable whenever the creator is not an admin, so knowing the URL pattern does not reveal instances.
3. Write an `owner` grant for the creator.
4. Return the instance id. The shell navigates to `/blocks/<id>`.

Quotas apply (6.11).

Static mode stays: a route with a `target` binding and no `--live` behaves exactly as today.

### 6.9 Opening a view from the site

The new endpoint is on the site host, not the main host, because it must see the site cookie:

```go
// POST /_site/views on a site host: the site shell opens a view for its route.
func (s *Server) openSiteView(w http.ResponseWriter, r *http.Request) {
    if !s.shellRequest(r) { fail(403, "invalid_origin"); return }   // 6.3 checks
    var in struct{ Path string; Link string }                      // Link: a share-link token, optional
    read(r, &in)

    host := lower(r.Host)
    res, ok := routing.Resolve(publicLiveRoutes(host), host, in.Path)
    if !ok { fail(404, "not_found"); return }
    target, err := s.liveTarget(ctx, res)                           // fixed, or filled from {db}; checks app
    if err != nil { fail(404, "not_found"); return }

    p, setCookie := s.siteSession(r, res.Route)                     // user, existing visitor, or a new visitor
    if p == nil { fail(401, "login_required"); return }             // route viewers = signed-in, none present
    if in.Link != "" { s.redeemLink(ctx, p, target, in.Link) }      // writes a grant for p (via = link id)

    v, asks, err := s.newViewFor(ctx, p, target, 0, "viewer")       // newView with levelOf(p, t)
    if err != nil { rtHTTPFail(w, err); return }                    // not_granted -> the shell shows "no access"
    u, origin, err := s.targetURL(ctx, r, v.Target, v.Version, "app", nil)  // parent = site origin
    setCookie(w)
    json(w, viewOut{View: v, Secret: v.Secret, URL: u, Origin: origin, Level: v.Level.String(),
                    Caps: grantedCaps(v), Asks: asks})
}
```

Siblings on the site host, all guarded by the site session and `shellRequest`:

| Method and path | Purpose |
|---|---|
| `POST /_site/views` | open a view (above) |
| `POST /_site/views/{v}/renew` | renew; the view's principal must be the caller |
| `POST /_site/views/{v}/consent` | record a consent for the view's principal |
| `DELETE /_site/views/{v}` | close |
| `POST /_site/instances` | create an instance (6.8) |
| `GET /_site/me` | who am I on this host: `{kind: user|visitor|none, id, name}` |
| `POST /_site/logout` | revoke this site session |
| `GET /_site/login?return=` | start the handoff (redirect to the main host) |
| `GET /_site/callback?code=` | finish the handoff |

`newView` changes from taking a `store.User` to taking a principal. `View.User` keeps holding an id string (`usr_…` or `vis_…`), so `pkg/rt` does not change. Code that resolves `v.User` with `Store.User` must handle visitor ids: `userInfo`, `profileOf`, `rpcUserProfiles` and comments authorship.

### 6.10 Capability policy

Grants decide the level; this table decides what each level and principal kind may do. Policy is enforced in `grantedCaps` and in each handler, never only in the shell.

| Capability | Visitor | Member | Admin / owner | Change from today |
|---|---|---|---|---|
| `db` | rules at their level (≤ interact) | rules at their level | rules (pass everything but `self`) | none: rules already apply |
| `user` | `id = vis_…`, name "Guest", `guest: true` | `id`, profile per scopes | same | `userInfo` and `profileOf` accept visitors |
| `room` | join; emit only topics at ≤ their level; `guest: true` | same | everything | set `guest` from the principal kind |
| `assets` | none | ≥ interact, per-principal quota | yes | lower the gate from admin to interact, add quota |
| `comments` | none | yes (consent) | yes | refuse visitors |
| `sample` | none | off by default; per route `--sample members` with a daily budget | yes (consent) | gate on principal kind + route policy + budget |
| `downloads` | yes | yes | yes | none |
| `artifact` (publish) | none | none | ≥ admin | none |
| `slop` | none | none | approved, admin role | none |
| `files`, `mcp` | not served | not served | not served | none |

Why `sample` stays closed by default: it spends real money on the server's model credentials (Pi models through `Config.Sample`), and `startSample` has no per-person budget (`rt_sample.go:17-21`). Opening it to anonymous visitors would make the site an open LLM proxy.

### 6.11 Quotas and rate limits

Generalize `limiter` (`pkg/server/limiter.go`) into a server-wide instance and key it by principal:

| Limit | Key | Suggested value |
|---|---|---|
| visitor creation | client address | 30 / hour |
| view opens | principal | 120 / hour |
| RPC calls | view | 50 / s burst 100 |
| db writes | principal + target | 20 / s |
| instances created | principal | visitors 5 / day, members 50 / day |
| asset bytes | principal + target | members 100 MiB per target |
| sample calls | user | per route budget, e.g. 50 / day |

Existing per-target limits (`MaxDocsPerTarget`, `MaxDocBytes`) still apply.

Garbage collection is a periodic job next to the view `Sweep` (`server.go:109-113`):
- delete visitors unseen for 90 days, together with their site sessions;
- delete instances created by visitors that have no grants left and no writes for 30 days.

Log every deletion in `audit`.

### 6.12 Seeing who has access

The question "who has access to db XXX" has two answers: who *may* open it (grants), and who *has it open* now (views). Both come from one endpoint on the main host:

```text
GET /api/rt/targets/{t}/access          guard(admin, scopeRW)   (later: the target's owner via the site)
{
  "target": "ws-team", "app": "blocks",
  "owner":  {"id": "usr_…", "name": "Manuel"},
  "grants": [ {"subject": "*signed-in", "level": "view"},
              {"subject": "usr_…", "level": "interact", "name": "Alex"},
              {"subject": "vis_…", "level": "view", "via": "lnk_…"} ],
  "links":  [ {"id": "lnk_…", "level": "view", "createdAt": "…", "revoked": false} ],
  "views":  [ {"view": "v…", "principal": "vis_…", "kind": "viewer", "level": "view", "since": "…"} ],
  "routes": [ {"host": "site.localhost:18140", "path": "/blocks/:db", "viewers": "anyone"} ]
}
PUT    /api/rt/targets/{t}/grants/{subject}   {"level": "interact"}
DELETE /api/rt/targets/{t}/grants/{subject}
POST   /api/rt/targets/{t}/links              {"level": "view", "days": 30}  -> {"url": "https://site…/blocks/ws-team?k=…"}
DELETE /api/rt/targets/{t}/links/{id}
```

CLI (`cmd/slop/cmds/access.go`, new):

```sh
slop access ls ws-team
slop access grant ws-team '*signed-in' view
slop access grant ws-team usr_02657c47 interact
slop access revoke ws-team '*signed-in'
slop access link ws-team --level view --days 30
```

The Workshop gets an *Access* panel on the artifact screen. Later, an in-app share button in the site shell lets an owner manage access without the Workshop.

## 7. Decision records

**D1. An instance is a target; no new storage.** Every runtime table is already keyed by `target_id`, and data artifacts with `app` are already instances (Blocks workspaces). Naming them in URLs only needs route templates. Rejected: a separate `dbs` table, which would duplicate artifacts and break `slop data`.

**D2. Apps stay on their target's origin; the site serves a shell.** Rendering the app with its secret on the site origin would expose secrets to every page on the host and share storage across instances. The shell costs one iframe and copies a protocol that already exists.

**D3. Identity on site hosts is a separate session, handed over from the main host.** Cookies are host-only by design. A parent-domain cookie would also need custom domains (`slop.boutique` vs `slop.computer`) to share a parent, which they do not. The handoff is the standard pattern and keeps the main session cookie off public hosts.

**D4. Anonymous visitors are principals with ids, in their own table.** Apps need a stable id (`user.id()`, `{self}`, private paths, presence). A separate table keeps the people list clean and allows expiry.

**D5. Grants are rows per target, and `levelOf` takes the maximum, capped by principal kind.** This makes access explicit and listable, gives claude.ai's levels a real meaning, and caps the damage of a mistaken grant.

**D6. Capability policy lives in `grantedCaps` and handlers, not in the shell.** The shell is convenience. Anything that costs money or writes data is enforced on the server.

**D7. Static mode stays.** Snapshots are the right tool for frozen publishing. `--live` is an explicit choice per route.

**D8. Non-shell site pages get an opaque origin (CSP `sandbox`) before non-admins are let in.** It is the only robust way to stop a page on the same host from using the site cookie. Admin-only phase 1 can ship without it because every site page is admin-authored.

## 8. API reference

### 8.1 New endpoints

| Host | Method and path | Auth | Body → response |
|---|---|---|---|
| site | `POST /_site/views` | site session (or creates a visitor) + shell checks | `{path, link?}` → `viewOut` |
| site | `POST /_site/views/{v}/renew` | site session, own view | → `{view, secret, expiresAt}` |
| site | `POST /_site/views/{v}/consent` | site session, own view | `{sample: "granted"}` → permission states |
| site | `DELETE /_site/views/{v}` | site session, own view | → `{closed: true}` |
| site | `POST /_site/instances` | site session, route create policy | `{path}` → `{id, path}` |
| site | `GET /_site/me` | optional | → `{kind, id, name}` |
| site | `GET /_site/login?return=` | none | 302 to main `/auth/handoff` |
| site | `GET /_site/callback?code=` | one-time code | sets cookie, 302 to return |
| site | `POST /_site/logout` | site session | revokes it |
| main | `GET /auth/handoff?host=&return=` | main session (else login first) | 302 to site callback |
| main | `GET /api/rt/targets/{t}/access` | admin, `scopeRW` | access summary (6.12) |
| main | `PUT`/`DELETE /api/rt/targets/{t}/grants/{subject}` | admin, `scopeRW` | grant changes, audited |
| main | `POST`/`DELETE /api/rt/targets/{t}/links[/{id}]` | admin, `scopeRW` | share links |

### 8.2 Changed endpoints and functions

| Where | Change |
|---|---|
| `PUT /api/routes` (`kernel.go:532`), `store.Route` | fields `live`, `viewers`, `createPolicy`; binding versions may be templates (`{db}`) |
| `slop route set` (`cmd/slop/cmds/routes.go`) | flags `--live`, `--viewers`, `--create`, `--sample` |
| `serveSite` (`serve.go:334`) | live routes serve the shell; `/_site/*` dispatch; CSP `sandbox` on other pages (phase 2) |
| `serveSandbox` (`serve.go:562`), `frameAncestors` (`:209`) | accept site origins as parent and frame ancestor |
| `levelOf` (`rt.go:101`) | principal + grants + caps (6.6) |
| `newView` (`rt.go:198`) | takes a principal |
| `grantedCaps` (`rt.go:130`) | policy table (6.10) |
| `userInfo`, `profileOf`, `rpcUserProfiles` (`rt.go:858-920`) | visitor ids |
| `rpcRoomEmit`, `AsPeer` (`rt_more.go:166`, `views.go:400`) | `guest` from principal kind |
| `sampleView` (`rt_sample.go:83`) | principal kind + route policy + budget |
| `RevokeUserSessions` (`sessions.go:90`) | also revokes site sessions |
| `PATCH /api/users/{id}` (`users.go`) | role `member` allowed |

### 8.3 Shell ↔ page messages (unchanged protocol, new shell)

| From page | Shell action |
|---|---|
| `hello` | post `{type: "view", view, secret, expiresAt}` |
| `renew` | `POST /_site/views/{v}/renew`, then post the view again |
| `consent {names, app}` | show a dialog; `POST …/consent`; reply `{id, states}` |
| `download {filename, data}` | save the Blob; reply `{id, status}` |
| `reload {version}` | open a view on the new version, swap the iframe |
| `navigate {target}` | go to the instance route of that target, if one exists |
| `args {args}` | update the URL fragment |
| `compose`, `permissions` | reply declined (no comments UI on the site yet) |

## 9. Pseudocode for the main pieces

### 9.1 The site shell (`pkg/render/assets/shell.js`)

```js
const boot = JSON.parse(document.getElementById("slop-shell").textContent); // {path, link, me}
let view = null;
const frame = document.querySelector("iframe");

async function open() {
  const r = await fetch("/_site/views", { method: "POST", headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ path: boot.path, link: boot.link }) });
  if (r.status === 401) return showSignIn();            // route needs a signed-in viewer
  const body = await r.json();
  if (body.error) return showProblem(body.error);       // not_granted -> "You do not have access"
  view = body;
  if (frame.src !== view.url) frame.src = view.url;     // first open; renewals keep the frame
}

addEventListener("message", async (e) => {
  if (!view || e.source !== frame.contentWindow || e.origin !== view.origin || e.data?.slop !== 1) return;
  const m = e.data, post = (x) => frame.contentWindow.postMessage({ ...x, slop: 1 }, view.origin);
  switch (m.type) {
    case "hello":   post({ type: "view", view: view.view, secret: view.secret, expiresAt: view.expiresAt }); break;
    case "renew":   await renew(); post({ type: "view", view: view.view, secret: view.secret, expiresAt: view.expiresAt }); break;
    case "consent": post({ id: m.id, states: await askConsent(m.names) }); break;
    case "reload":  await open(); break;                  // the server already serves the new main
    default:        if (m.id) post({ id: m.id, status: "declined" });
  }
});
setInterval(renew, 45 * 60 * 1000);
open();
```

### 9.2 Resolving a principal on a site host

```go
// siteSession returns the principal for a site request, creating a visitor
// when the route admits anyone and none exists. setCookie writes a new cookie.
func (s *Server) siteSession(r *http.Request, rt store.Route) (*Principal, func(http.ResponseWriter)) {
    host := lower(r.Host)
    if c, err := r.Cookie(siteCookie(s.Config.Secure())); err == nil {
        if ss, u, vis, err := s.Store.ResolveSiteSession(ctx, host, c.Value); err == nil {
            return principalOf(u, vis), noop                 // u for users (role checked later), vis for visitors
        }
    }
    if rt.Viewers != "anyone" {
        return nil, noop                                     // the shell offers sign-in
    }
    if !s.limits.take("visitor:"+s.clientAddress(r), 30, time.Hour) {
        return nil, noop                                     // fail closed: rate_limited
    }
    vis, token := s.Store.CreateVisitorSession(ctx, host)
    return principalOf(nil, &vis), func(w http.ResponseWriter) { s.setSiteCookie(w, token) }
}
```

### 9.3 Filling a templated target

```go
func (s *Server) liveTarget(ctx context.Context, res routing.Resolution) (store.Artifact, error) {
    b, ok := res.Route.Bindings["target"]
    if !ok { return store.Artifact{}, errNotLive }
    id := routing.Fill(b.Artifact, res.Params)               // "{db}" -> "ws-team"; literal ids unchanged
    t, err := s.Store.Artifact(ctx, id)
    if err != nil || t.Kind != store.KindData || t.App != res.Route.Page {
        return store.Artifact{}, errNotFound                 // never open unrelated artifacts
    }
    return t, nil
}
```

## 10. Implementation phases

Each phase ends with something a person can try in the browser on the local server, and with tests.

### Phase 1: a live route for signed-in admins

1. Add the site session for users: the `site_sessions` and `site_handoffs` tables, `/auth/handoff`, `/_site/login`, `/_site/callback`, `/_site/logout` and `/_site/me`.
2. Add route fields `live` and `viewers` (`admins` only at this stage), plus the CLI flags.
3. Add the shell: `pkg/render/assets/shell.js`, the shell HTML template, and serving it in `serveSite` for live routes.
4. Add `POST /_site/views` and its renew, consent and close siblings. Use the existing `newView` with the user's role, so only admins get a level.
5. Accept site origins in `serveSandbox`'s `parent` check and in `frameAncestors`.
6. Add the shell request checks (6.3, items 2 and 3).

**Try it:**
```sh
slop route set /blocks/team blocks --bind target=ws-team --live --viewers admins
```
Sign in on `site.localhost:18140` and edit `ws-team` live. Ask Claude works there too.

### Phase 2: grants and members

1. Add `rt_grants`, the `member` role and `levelOf` with grants and caps.
2. Add `newView` with a principal, and re-evaluate views on grant changes.
3. Add the access API and the `slop access` CLI.
4. Apply the capability policy table (`assets` gate, `comments`, `sample` for members off).
5. Serve non-shell site pages with CSP `sandbox` and add CORS on `/_d/` (D8).

**Try it:** grant `*signed-in view` on `ws-team`. A member signs in on the site and sees the workspace read-only. Grant them `interact` and they can edit.

### Phase 3: instances in the URL and share links

1. Allow templated `target` bindings and add `liveTarget`.
2. Add the create policy and `POST /_site/instances`, with the owner grant.
3. Add `rt_links`, redeeming `?k=` in `/_site/views`, and the link API and CLI.

**Try it:**
```sh
slop route set /blocks/:db blocks --bind 'target={db}' --live --viewers signed-in --create signed-in
```
Then `/blocks/new` creates `i_…`, and a share link opens it for someone else.

### Phase 4: anonymous visitors

1. Add `visitors`, visitor sessions and `viewers = anyone`.
2. Make `userInfo`, profiles, rooms (`guest: true`), consents and audit accept visitors.
3. Add the server-wide limiter, the quotas (6.11) and garbage collection.
4. Add claiming visitor data on sign-in (explicit).

**Try it:** open `/blocks/<id>` in a private window. You are a guest with your own id, Blocks runs in db mode, and other viewers see you as a guest.

### Phase 5: UI and documentation

1. Add the Workshop *Access* panel and an *Open live* link from `/watch` to live routes and `/run`.
2. Update help topics: `pkg/doc/topics/runtime.md` (modes, live routes, access) and a new `live-sites.md`.
3. Optionally add `slop data snapshot <target>`, which writes `db.json` and skips private and above-`view` paths.

## 11. Test strategy

Use the existing harnesses:
- **Go:** `pkg/server/harness_test.go`, `rt_test.go` and the store tests.
- **Browser:** the runtime conformance app (`web/rt-conformance`, run with `make conformance`).

| Area | Tests |
|---|---|
| Handoff | code single-use and expiry; host allowlist; `safeReturn`; site session revoked with the user's main sessions |
| Site views | a live route opens a view only for allowed viewers; `not_granted` for others; the secret works only on the target origin (`viewOf`) |
| `levelOf` | role, creator, each subject kind, max, caps by kind; disabled and pending get nothing |
| Revocation | lowering a grant closes affected views; the page renews and gets the new level |
| Templated targets | `{db}` fills; a wrong app or kind gives 404; an unknown id gives "not found" |
| Links | redeem writes a grant `via` the link; a revoked link stops new redemptions; existing grants are listed in access |
| Visitors | cookie creates a visitor; `user.id()` is stable; `data/users/<vis>/` is private; `guest: true` in rooms; rate limit on creation |
| Capability policy | each row of the policy table, enforced server-side (call RPC and sample directly with a visitor's secret) |
| Same-origin hardening | a site page served with CSP `sandbox` cannot `POST /_site/views` with the cookie (browser test) |
| Conformance | run `rt-conformance` through a live site route as admin, member and visitor; expected differences match the policy table |

Write the regression test for `levelOf` first (table-driven). Every later phase depends on it.

## 12. Risks and open questions

### 12.1 Risks

- **Secret leakage through same-origin pages** (6.3). This is mitigated by the shell, the request checks and, from phase 2, the CSP `sandbox`. Review it carefully.
- **Cost of `sample`.** Keep it closed to visitors and members by default.
- **Data growth from anonymous instances.** Quotas and garbage collection are required before phase 4 ships.
- **Views are in memory.** A restart closes every view; shells must reopen silently. `AppScreen` already does this on `renew` failure; copy the behavior.
- **Third-party cookie rules.** Site sessions are first-party (top-level site host), and the iframe uses no cookies (`credentials: "omit"`), so browser cookie partitioning does not affect this design.

### 12.2 Open questions for the product owner

1. **Who may create instances** on a public route by default: admins, signed-in members, or anyone (with quotas)?
2. **Should members be able to use `sample`** on some routes, and with what daily budget?
3. **URL shape.** `/blocks/:db` (recommended) or `?db=`?
4. **Membership.** Should new OIDC users become `member` automatically, or stay `pending` until an admin approves them?
5. **Owner management from the site.** Should owners of an instance manage its access from the site shell (a share dialog), or only admins in the Workshop?
6. **Visitor data on sign-in.** Should it be claimed automatically, offered, or never?

## 13. File reference

| File | What to read it for |
|---|---|
| `pkg/server/server.go` | `Config`, `Handler` host dispatch, `origins`, `isMainHost`, the view sweep |
| `pkg/server/auth.go` | `Principal`, `guard`/`guardPerm`, cookies, `signIn`, `safeReturn`, OIDC login and callback |
| `pkg/server/local.go` | local sign-in and tokens |
| `pkg/server/serve.go` | `serveSite`, `serveSandbox`, `renderPage`, `bindings`, `staticRuntime`, `frameAncestors` |
| `pkg/server/rt.go` | `rtRoutes`, `levelOf`, `newView`, `openView`, `grantedCaps`, `targetURL`, `viewOf`, `viewEvents`, `viewRPC`, `userInfo` |
| `pkg/server/rt_more.go` | rooms, comments, assets, `artifact.publish`, `agentDB`, `listApps`, `approveApp` |
| `pkg/server/rt_sample.go` | `sampleView`, `startSample`, page tools |
| `pkg/server/limiter.go` | the sliding-window limiter to generalize |
| `pkg/server/users.go` | role changes and view revocation |
| `pkg/rt/views.go` | `View`, `Registry`, rooms, `Peer.Guest`, `AllowEmit` |
| `pkg/rt/rules.go`, `paths.go`, `manifest.go`, `limits.go` | levels, rules, private paths, manifest, limits |
| `pkg/store/routes.go`, `pkg/routing/routing.go` | routes, bindings, resolution, templates |
| `pkg/store/rt.go` | runtime tables, `RTOrigin` |
| `pkg/store/sessions.go`, `users.go`, `tokens.go` | sessions, roles, tokens |
| `pkg/store/migrations/sqlite/001_auth.sql`, `002_kernel.sql`, `007_runtime.sql` | schemas |
| `pkg/render/render.go` | modes, `Boot`, `Runtime`, `Inject` |
| `web/runtime/src/transport.ts`, `index.ts`, `static.ts`, `caps.ts` | the page side: handshake, `use()`, static mode, shell asks |
| `web/workshop/src/screens/AppScreen.tsx` | the shell to copy |
| `web/blocks/slop.json`, `web/blocks/src/blocks.js:507-521` | the first app to run live on the site; its memory/db mode switch |
| `cmd/slop/cmds/routes.go`, `serve.go` | route CLI and local-mode defaults |
| `pkg/doc/topics/runtime.md`, `pinup.md` | current user docs for the runtime and players |
