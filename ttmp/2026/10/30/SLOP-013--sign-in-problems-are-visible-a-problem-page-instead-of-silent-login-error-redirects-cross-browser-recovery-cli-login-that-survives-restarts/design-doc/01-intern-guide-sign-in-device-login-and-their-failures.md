---
Title: 'Intern guide: sign-in, device login and their failures'
Ticket: SLOP-013
Status: active
Topics:
    - auth
    - backend
    - frontend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/server/auth.go
      Note: login, callback, signIn, safeReturn, cookies; the failures are redirected to /?login_error= here
    - Path: repo://pkg/store/sessions.go
      Note: SaveLoginFlow and ConsumeLoginFlow; the flow row holds the return path
    - Path: repo://pkg/server/device.go
      Note: Device authorization, polling and the approval page
    - Path: repo://cmd/slop/cmds/auth.go
      Note: slop auth login (device flow) and pollDevice
    - Path: repo://pkg/server/templates/layout.tmpl
      Note: Server-rendered page layout the problem page uses
ExternalSources: []
Summary: "How slop signs people in (OIDC with PKCE and a per-browser flow cookie) and how the CLI gets a token (device flow), why a failed sign-in is silent today (a redirect to /?login_error= that nothing reads, then an automatic re-login), and a design: one sign-in problem page with a way to continue, failures logged, and a CLI poller that survives restarts."
LastUpdated: 2026-10-30T20:30:00-04:00
WhatFor: "Understanding slop's sign-in and device login well enough to make their failures visible and recoverable"
WhenToUse: "Before working on SLOP-013, or when someone says sign-in 'did nothing'"
---

# Intern guide: sign-in, device login and their failures

This guide is for someone new to slop who will implement SLOP-013. It explains how a person signs in to slop in a browser, and how the `slop` command-line tool gets a token by asking that person to approve it in a browser. It then explains why a failed sign-in is invisible today, and proposes a small, consistent design that makes every failure visible and gives the person a way to continue.

## 1. Executive summary

On 2026-10-30 the user ran `slop auth login` against the test cluster. The CLI printed a link (`https://slop.yolo.scapegoat.dev/device?code=…`). The user opened it in one browser, then moved to another one to finish. The address bar briefly showed `?login_error=flow_missing`, and then nothing happened: no message, and no approval page. The CLI kept waiting until its code expired. A second attempt failed differently: the CLI quit with `http_503: no available server` because the server was being redeployed.

Three defects explain this:

| Defect | Where | Effect |
|---|---|---|
| **Failures redirect to `/?login_error=<code>`, which nothing reads** | `callback` and `login` (`pkg/server/auth.go:248, 263`) | The error is only visible in the URL |
| **`/` signs an anonymous person in again** | `workshopPage` (`pkg/server/workshop.go:27-31`) redirects to `/auth/login` | With a live identity-provider session, the second sign-in succeeds silently and lands on `/`. The original destination (`/device?code=…`) is lost |
| **The CLI gives up on a transient server error** | `pollDevice` (`cmd/slop/cmds/auth.go:180-212`) | A 503 during a redeploy ends the login, although the code is still valid |

The design:
1. **One sign-in problem page.** A failed sign-in renders a page that says what happened in plain words and offers one button: *Continue signing in*, which leads back to where the person was going. It replaces every `/?login_error=` redirect.
2. **Recover the destination.** The flow row in the database already stores the return path. When the browser's flow cookie is missing (another browser, or a blocked cookie), the server can still read the return path by `state` and offer it, without trusting the failed flow for anything else.
3. **Log every failure** with its code, so operators can see it.
4. **The CLI retries transient errors** (5xx, 429, network) until the code expires, and says so once.

## 2. Orientation: the pieces

### 2.1 Hosts and pages

slop's sign-in lives on the **main host** (`slop.yolo.scapegoat.dev`; `Config.PublicURL`). Site and sandbox hosts never see sessions (see the SLOP-011 guide). The pages involved are:

| Path | Handler | Guard | Purpose |
|---|---|---|---|
| `GET /auth/login?return=` | `login` (`auth.go:234-253`) | none | start an OIDC sign-in |
| `GET /auth/callback?state=&code=` | `callback` (`auth.go:255-291`) | none | finish it |
| `POST /auth/logout` | `logout` (`auth.go:308-337`) | session | sign out (also at the provider) |
| `GET /`, `/watch`, `/routes`, … `/run/*` | `workshopPage` (`workshop.go:24-45`) | public, but redirects anonymous to `/auth/login` | the Workshop |
| `GET /device?code=` | `devicePage` (`device.go:157-192`) | public, but redirects anonymous to `/auth/login` | approve a CLI login |
| `POST /device` | `deviceDecide` (`device.go:194-238`) | admin | approve or deny |
| `POST /api/device/authorize` | `deviceAuthorize` (`device.go:40-97`) | public, rate-limited | the CLI asks for a code pair |
| `POST /api/device/token` | `deviceToken` (`device.go:100-…`) | public, rate-limited | the CLI polls |

Server-rendered pages (device, local login, home, safe mode) use Go templates in `pkg/server/templates/`, rendered by `s.render` (`pkg/server/pages.go:40-56`). It sets `Cache-Control: no-store` and a strict CSP (no scripts).

### 2.2 Sessions and cookies

- **Session cookie.** A signed-in browser holds `__Host-slop_session` (on http in local mode: `slop_session_dev`). The cookie holds a random token; the database stores only its hash (`sessions` table, `pkg/store/sessions.go`).
- **Flow cookie.** During a sign-in the browser also holds `__Host-slop_flow` (`slop_flow_dev`) for at most 600 s.
- **Attributes.** Both cookies are `HttpOnly`, `SameSite=Lax`, `Secure` on https, and host-only (`setCookie`, `auth.go:57-61`).

### 2.3 OIDC sign-in, step by step

slop uses OpenID Connect with PKCE against ZITADEL (`--oidc-issuer=https://auth.slop.boutique`). The provider code is `pkg/identity/oidc.go`.

```text
 browser                          slop (main host)                         identity provider
 -------                          ----------------                         -----------------
 GET /device?code=ABCD-EFGH
   (no session) <---------------- 303 /auth/login?return=/device?code=ABCD-EFGH
 GET /auth/login?return=…  -----> state, nonce, verifier, binding := random
                                  login_flows += {hash(state), hash(binding), nonce, verifier, return_path}  (10 min)
   <------------------------------ Set-Cookie: __Host-slop_flow=binding (600 s); 303 to the provider
 GET /authorize?state&code_challenge… ----------------------------------->  sign in (or already signed in: no prompt)
   <------------------------------------------------------------------- 302 /auth/callback?state&code
 GET /auth/callback?state&code (cookie: flow=binding)
                           -----> flow := ConsumeLoginFlow(state, hash(binding))   (single use, bound to this browser)
                                  id := Exchange(code, verifier, nonce)
                                  signIn: user (new users: pending), session, audit user.signin
   <------------------------------ Set-Cookie: session; clear flow; 303 flow.return_path (/device?code=ABCD-EFGH)
```

Why the flow cookie exists: it **binds the sign-in to the browser that started it**. Without it, an attacker could start a sign-in, stop at the callback, and trick a victim into opening the callback URL. The victim's browser would then be signed in as the attacker ("login CSRF"). `ConsumeLoginFlow` (`sessions.go:26-33`) only succeeds when the `state` in the URL and the cookie's binding both match one unconsumed, unexpired row:

```sql
UPDATE login_flows SET consumed_at=?
 WHERE state_hash=? AND binding_hash=? AND consumed_at IS NULL AND expires_at > ?
RETURNING binding_hash, nonce, verifier, return_path
```

`safeReturn` (`auth.go:214-223`) keeps return paths local. It accepts only a path starting with `/` (not `//`, `/\` or `/auth/`), with no host and no scheme. Everything else becomes `/`.

### 2.4 The failure codes today

`callback` and `login` redirect to `/?login_error=<code>` on failure:

| Code | Cause |
|---|---|
| `provider_unavailable` | OIDC discovery failed when starting (`login`) |
| `denied` | the provider returned `?error=` (the person cancelled, or access was refused) |
| `flow_missing` | no flow cookie, or no `state`/`code` in the URL. **Typical cause: the sign-in finished in a different browser from the one that started it**, or the browser blocked or dropped the cookie |
| `flow_invalid` | the cookie and `state` match no live row: already used (back button, reload of the callback URL), expired (more than 10 min), or another browser's cookie |
| `exchange_failed` | the provider refused the code (clock skew, a reused code, misconfiguration) |
| `account_unavailable` | the person's account or session could not be stored (a database error in `signIn`, `auth.go:294-306`). Disabled users are *not* refused here: they get a session, and the guards stop them later |

**Nothing reads `login_error`.** `grep -rn login_error` finds only the two redirects: no template, no Workshop code. And `/` is the Workshop, whose handler sends any anonymous visitor to `/auth/login?return=/?login_error=…`. If the provider still has a session (common: the person just signed in there), that second sign-in completes without a prompt. The person lands on `/` with the error still in the URL and their original destination gone.

### 2.5 Device login (the CLI)

`slop auth login --server <origin>` uses the OAuth device flow (RFC 8628). The CLI side is in `cmd/slop/cmds/auth.go:146-212`, the server side in `pkg/server/device.go` and `pkg/store/device.go`.

```text
 slop CLI                                   slop (main host)                       a browser (signed in as an admin)
 --------                                   ----------------                       ---------------------------------
 POST /api/device/authorize {name, scopes, days}
   <---------------------------------------- {deviceCode: sdc_…, userCode: ABCD-EFGH,
                                              verificationUriComplete: …/device?code=ABCD-EFGH,
                                              expiresIn: 600, interval: 5}
 prints the link, opens a browser on a desktop
 every 5 s: POST /api/device/token {deviceCode}
   <---------------------------------------- 400 authorization_pending                GET /device?code=ABCD-EFGH
                                                                                      (sign-in first if needed, 2.3)
                                                                                      approval form: scopes, days
                                                                                      POST /device decision=approve
   <---------------------------------------- 200 {token: slp_…, user, info}
 saves the token (credentials file)
```

- The code lives 10 minutes (`store.DeviceTTL`, `pkg/store/device.go:20`).
- Polling is rate-limited per address (1200/hour, `device.go:101`).
- The approval page shows "This code is invalid or has expired." for unknown codes.

`pollDevice` (`cmd/slop/cmds/auth.go:180-212`) handles the answers:

| Answer | CLI does |
|---|---|
| success | saves the token |
| `authorization_pending` | waits |
| `slow_down` | waits 5 s longer |
| `access_denied` | stops: "the login was denied in the browser" |
| `expired_token`, or past the deadline | stops: "the code expired; run slop auth login again" |
| **any other API error** (`*client.Error`) | **stops with the error** |
| a network error | prints "retrying" and keeps going |

The problem is the second-to-last row. A 503 from the ingress during a redeploy (`no available server`) is parsed as an API error with code `http_503` (`pkg/client/errors.go:51`), so the CLI quits although the code is still valid.

## 3. What happened on 2026-10-30, replayed

```text
browser A: GET /device?code=…          -> no session -> /auth/login?return=/device?code=…
           login_flows row R (return_path=/device?code=…); browser A gets flow cookie for R
           provider sign-in page opens in A
(the user moves the provider URL, or the callback, to browser B)
browser B: provider -> /auth/callback?state=R&code=…   (no flow cookie in B)
           callback: cookie missing -> fail("flow_missing") -> 303 /?login_error=flow_missing
browser B: GET /?login_error=flow_missing  -> no session -> 303 /auth/login?return=/?login_error=flow_missing
           new row R2 (return_path=/?login_error=flow_missing); provider session exists -> no prompt
           callback OK -> session in B -> 303 /?login_error=flow_missing  -> the Workshop, no message
CLI:       keeps polling; nobody ever sees /device?code=… in B; the code expires after 10 min
```

The user later approved a fresh code in the browser that was already signed in, and that worked. The flow itself is sound. What is missing is telling the person what went wrong and where to go next.

## 4. Design principles

- **Consistent.** Every sign-in failure takes the same path: one page, one table of codes, one log line. No failure redirects to a page that does not know about it.
- **Simple.** No new tables, no JavaScript. The page is a server-rendered template like the device page.
- **Elegant.** Use what the flow row already stores. The return path is in `login_flows`, so recovering the destination is a read, not a new mechanism.
- **Expressive.** Each message says what happened and what to do, in the person's terms ("You finished signing in in a different browser"), not in protocol terms.
- **Secure by default.** Recovery never signs anyone in. It only offers a fresh, normal sign-in in the current browser, to a path that passed `safeReturn` when it was saved.

## 5. Design

### 5.1 One table of problems

```go
// signInProblem is what a failed sign-in tells the person.
type signInProblem struct {
    Status  int    // HTTP status of the page
    Title   string // one line
    Explain string // what happened, in plain words
    Retry   bool   // offer "Continue signing in"
}

var signInProblems = map[string]signInProblem{
    "provider_unavailable": {503, "The sign-in service is not reachable", "slop could not reach the identity provider. Try again in a minute.", true},
    "denied":               {403, "Sign-in was cancelled", "The identity provider did not sign you in. If you cancelled, you can start again.", true},
    "flow_missing":         {400, "This sign-in started in another browser", "You finished signing in in a different browser (or this browser blocked a cookie). Continue here to sign in in this browser.", true},
    "flow_invalid":         {400, "This sign-in link was already used or has expired", "Sign-in links work once and for 10 minutes. Start again.", true},
    "exchange_failed":      {502, "The identity provider refused the sign-in", "Start again. If it keeps happening, tell an administrator (the server log has details).", true},
    "account_unavailable":  {503, "Your account could not be loaded", "Try again in a minute. If it keeps happening, tell an administrator.", true},
}
```

### 5.2 Render, do not redirect

`callback` and `login` call one function instead of redirecting:

```go
// signInFailed shows the problem page and logs the failure. ret is where
// "Continue signing in" leads: the flow's return path when known.
func (s *Server) signInFailed(w http.ResponseWriter, r *http.Request, code, ret string) {
    p := signInProblems[code]
    log.Info().Str("code", code).Str("ip", s.clientAddress(r)).Str("return", ret).Msg("sign-in failed")
    s.setCookie(w, s.flowCookie(), "", -1)
    s.render(w, p.Status, "sign-in-problem", map[string]any{
        "Code": code, "Problem": p, "Continue": "/auth/login?return=" + url.QueryEscape(safeReturn(ret)),
    })
}
```

Because the page is rendered at `/auth/callback` (or `/auth/login`) itself, no other handler is involved. The Workshop cannot swallow it, and the URL needs no error parameter. The template (`pkg/server/templates/sign-in-problem.tmpl`):

```html
{{define "sign-in-problem"}}{{template "head" "Sign-in problem"}}{{template "banner" .}}
<main class="card">
<h1>{{.Problem.Title}}</h1>
<p>{{.Problem.Explain}}</p>
{{if .Problem.Retry}}<p><a class="button primary" href="{{.Continue}}">Continue signing in</a></p>{{end}}
<p class="note">Code: <code>{{.Code}}</code></p>
</main>{{template "foot"}}{{end}}
```

### 5.3 Recover the destination without trusting the failed flow

For `flow_missing` and `flow_invalid` the flow cannot be consumed, but its row usually still exists, keyed by `hash(state)`. Add one read:

```go
// LoginFlowReturn is the return path a sign-in was started for, by its state,
// consumed or not, while the row exists. It never authorizes anything: the
// caller only offers a fresh sign-in to that path.
func (s *Store) LoginFlowReturn(ctx context.Context, state string) (string, error) {
    var p string
    err := s.db().row(ctx, `SELECT return_path FROM login_flows WHERE state_hash=?`, Hash(state)).Scan(&p)
    return p, notFound(err)
}
```

`callback` becomes:

```go
c, err := r.Cookie(s.flowCookie())
if err != nil || c.Value == "" || state == "" || code == "" {
    ret, _ := s.Store.LoginFlowReturn(ctx, state)      // "" when unknown
    s.signInFailed(w, r, "flow_missing", ret)
    return
}
flow, err := s.Store.ConsumeLoginFlow(ctx, state, store.Hash(c.Value))
if err != nil {
    ret, _ := s.Store.LoginFlowReturn(ctx, state)
    s.signInFailed(w, r, "flow_invalid", ret)
    return
}
// exchange_failed, account_unavailable: s.signInFailed(w, r, code, flow.ReturnPath)
```

Why this is safe:
- The page only shows a link to `/auth/login?return=<path>`. Clicking it starts a **new** flow, with a new cookie, in the current browser. Nothing from the failed flow (nonce, verifier, binding) is used.
- `return_path` passed `safeReturn` when it was saved (`login`, `auth.go:235`) and passes it again in `signInFailed`. It can only name a local path.
- An attacker who sends someone a crafted callback URL achieves, at most, a page offering that person a normal sign-in to a local path. This is the same as sending them a link to `/auth/login?return=…`, which anyone can already do.

`SaveLoginFlow` deletes rows that expired more than an hour ago (`sessions.go:17`). So recovery works for an hour after a flow expires, which covers "I came back to it later".

### 5.4 The Workshop no longer needs `login_error`

With failures rendered in place, `/?login_error=` is never produced. Old links carrying it are harmless.

### 5.5 Log, and count

`signInFailed` logs one line per failure (code, client address, return path). For an operator, `kubectl logs … | grep 'sign-in failed'` answers "why can't X sign in". An `audit` row is not needed, because the audit log records actions of known people, and a failed sign-in has no person.

### 5.6 The CLI survives restarts

In `pollDevice`, treat server-side trouble as transient, like network errors:

```go
case errors.As(err, &apiErr) && (apiErr.Status >= 500 || apiErr.Status == 429):
    if !warned { fmt.Fprintln(os.Stderr, "slop: the server is not answering ("+apiErr.Code+"); still waiting"); warned = true }
case errors.As(err, &apiErr):
    return tok, err                                   // a real refusal (400 with an unknown code, 401, 403)
default:
    if !warned { fmt.Fprintln(os.Stderr, "slop: "+err.Error()+"; still waiting"); warned = true }
```

The deadline still ends the wait. The device code survives a server restart, because it lives in the database (`device_authorizations`), so polling after a redeploy succeeds.

Also improve the two messages the person sees:
- **Before polling,** print one more line: "Open the link in a browser where you are signed in to <origin> as an admin." This prevents the wrong-browser case from the start.
- **On expiry,** if stderr is a terminal, ask "Get a new code? [Y/n]" and start again. Otherwise keep today's message.

### 5.7 The device page, when the code is wrong

The device page already says "This code is invalid or has expired." when the code does not match. A mis-pasted link (a truncated code) lands there. Add the remedy to the message: "Check that the whole link was copied, or type the code shown in the terminal." The form below it already accepts a typed code.

## 6. API and file reference

### 6.1 Behaviour changes

| Endpoint | Before | After |
|---|---|---|
| `GET /auth/login` (provider down) | 303 `/?login_error=provider_unavailable` | 503 problem page, *Continue* retries |
| `GET /auth/callback` (any failure) | 303 `/?login_error=<code>` | problem page with the code's status; *Continue* leads to `/auth/login?return=<flow's return path or />` |
| `GET /device?code=` (unknown code) | "This code is invalid or has expired." | the same, plus how to fix it |
| `slop auth login` (5xx/429 while polling) | exits with `http_503: …` | keeps waiting until the code expires; one warning line |
| `slop auth login` (expired, interactive) | exits | offers a new code |

### 6.2 Code to change

| File | Change |
|---|---|
| `pkg/server/auth.go` | `signInProblems`, `signInFailed`; `login` and `callback` call it; recovery via `LoginFlowReturn` |
| `pkg/store/sessions.go` | `LoginFlowReturn(ctx, state)` |
| `pkg/server/templates/sign-in-problem.tmpl` (new) | the page |
| `pkg/server/static/pages.css` | `a.button` styled like `button.primary` (`pages.css:10-11` styles only `<button>`) |
| `pkg/server/device.go` | the device page message |
| `cmd/slop/cmds/auth.go` | `pollDevice` transient errors; the extra hint line; renew on expiry |
| `pkg/doc/topics/agents.md` (or the auth help topic) | "if sign-in shows a problem page" |

## 7. Implementation plan

**Phase 1: server.** Add `signInProblems`, `signInFailed`, the template and `LoginFlowReturn`, and move `login` and `callback` onto them. Add tests (section 8).

**Phase 2: CLI.** Make `pollDevice` treat 5xx and 429 as transient, add the hint line and the renewal prompt. Add tests with an `httptest` server that answers 503 for a while.

**Phase 3: device page and docs.** The message, the help text, and a manual check on the cluster: start `slop auth login`, open the link in a signed-out private window, and confirm the flow ends on the approval page.

## 8. Test strategy

Use the fake identity provider pattern from `pkg/server/logout_test.go:21-40` (an `httptest` server answering discovery).

| Test | Expect |
|---|---|
| callback without a flow cookie, `state` of a saved flow with return `/device?code=X` | 400 page, title "started in another browser", *Continue* href `/auth/login?return=%2Fdevice%3Fcode%3DX` |
| callback without a cookie and an unknown `state` | 400 page, *Continue* to `/auth/login?return=%2F` |
| callback with a consumed flow (replay) | 400 `flow_invalid`, the flow's return path offered |
| callback with `?error=access_denied` | 403 `denied` page |
| provider discovery down at `/auth/login` | 503 page |
| return path `//evil.example` stored by a crafted flow row | *Continue* goes to `/auth/login?return=%2F` (`safeReturn`) |
| no response anywhere sets `Location: /?login_error=` | grep test over the handlers' responses |
| `pollDevice`: 503 ×3 then success | the token is returned; one warning line printed |
| `pollDevice`: 403 `forbidden` | stops with the error |
| `pollDevice`: past the deadline while 503 | "the code expired" |

## 9. Risks and open questions

- **Status codes on the problem page.** Some proxies replace bodies of 5xx responses with their own pages. Traefik does not by default; if it ever does, use 200 for the page and keep the code in the body.
- **The renewal prompt in scripts.** Only when stderr is a terminal. Scripts keep today's exit.
- **Disabled users** sign in successfully today (`signIn` does not check the role) and are then stopped by the guards. Whether they should instead see the problem page ("Your account is disabled") is a separate decision; it is out of scope here.
