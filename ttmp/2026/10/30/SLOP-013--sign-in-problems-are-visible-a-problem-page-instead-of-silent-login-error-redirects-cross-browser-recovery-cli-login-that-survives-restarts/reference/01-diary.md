---
Title: Diary
Ticket: SLOP-013
Status: active
Topics:
    - auth
    - backend
    - frontend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/30/SLOP-013--sign-in-problems-are-visible-a-problem-page-instead-of-silent-login-error-redirects-cross-browser-recovery-cli-login-that-survives-restarts/design-doc/01-intern-guide-sign-in-device-login-and-their-failures.md
      Note: The intern guide this diary records
ExternalSources: []
Summary: "Chronological diary for SLOP-013: visible, recoverable sign-in failures and a CLI login that survives restarts."
LastUpdated: 2026-10-30T20:40:00-04:00
WhatFor: "How the SLOP-013 design was produced, with evidence"
WhenToUse: "Before continuing SLOP-013 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-013 was designed. A failed sign-in in slop is silent: the server redirects to `/?login_error=<code>`, nothing reads it, and the Workshop signs the person in again, losing their destination. The CLI's device login also gives up on a transient 503. The ticket designs one problem page, recovery of the destination, logging, and a poller that waits through restarts.

## Step 1: Replaying the failed CLI logins and designing visible sign-in problems

The user had to approve three device codes before the CLI got a token for the test cluster. They reported that one attempt flashed `?login_error=flow_missing` in the address bar and then showed nothing. I traced the sign-in code and found three problems:
- the error is redirected to a page that never reads it;
- that page (the Workshop) immediately restarts sign-in, which the identity provider completes silently, losing the `/device?code=…` destination;
- separately, the CLI quit on `http_503: no available server` while the cluster was redeploying, although its code was still valid.

The guide designs one fix per problem, using data the server already stores.

### Prompt Context

**User prompt (verbatim):** "then create a new ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. We want consistent, elegant, simple, expressive. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) Diary Format (skill) is MANDATORY --- You chose the best cases. Also, when I logged in with the link, i first opened in the wrong browser, then took it to another browser, and it redirected with \"flow_missing\" but that then didn't show an error or even a warning, i just happened to catch it from the corner of myh eye. Before implementing, let's tackle that token thing. Also, I merged the  deploy PR"

**Mid-step prompt (verbatim):** "I approved the last token again I think maybe it was just the link that I copy pasted wrong from the first browser"

**Assistant interpretation:**
- "You chose the best cases": decide SLOP-012's open questions myself (recorded in SLOP-012, Step 3).
- "that token thing": the sign-in and device-login failures. They get this new ticket and guide, before any implementation.

**Inferred user intent:** Make sign-in failures impossible to miss and easy to recover from, before building more features that depend on logging in.

**Commit (docs):** see the changelog entry for this step.

### What I did

- **Evidence from this session's three CLI logins** (scratchpad `login.log`):
  1. code `MRWH-ZGRJ`: `the code expired; run slop auth login again`;
  2. second attempt: `http_503: no available server` (during the rollout of `sha-2ac2611` after hetzner-k3s#401 merged at 2026-10-30T19:26:33Z);
  3. code `LNTS-MNVX`: success, `tok_64be4cf3dac0527e2d93ff9a`.
- **Read the sign-in code:**
  - `login` and `callback` (`pkg/server/auth.go:234-291`), `signIn` (`:294-306`), `safeReturn` (`:214-223`);
  - `SaveLoginFlow` and `ConsumeLoginFlow` (`pkg/store/sessions.go:15-33`);
  - `workshopPage` (`pkg/server/workshop.go:24-45`);
  - `devicePage` and `deviceDecide` (`pkg/server/device.go:157-238`), `deviceAuthorize` and `deviceToken` (`:40-…, 100-…`), `store.DeviceTTL` (`pkg/store/device.go:20`);
  - the templates (`layout`, `home`, `local-login`, `device`), `s.render` (`pkg/server/pages.go:40-56`), `pages.css`;
  - `pollDevice` (`cmd/slop/cmds/auth.go:138-212`), `client.Error` and the `http_<status>` code (`pkg/client/errors.go:20-54`);
  - the fake-IdP test pattern (`pkg/server/logout_test.go:21-40`).
- **Checked who reads `login_error`:** `grep -rn login_error pkg web/workshop/src cmd` found only the two redirects (`auth.go:248, 263`).
- **Wrote the guide:** `design-doc/01-intern-guide-sign-in-device-login-and-their-failures.md`. It covers:
  - orientation: pages, cookies, the OIDC sequence, the failure codes, the device flow;
  - a replay of the failed login;
  - principles;
  - the design: the problem table, `signInFailed`, `LoginFlowReturn` recovery and why it is safe, logging, the CLI poller, the device-page message;
  - API changes, files, phases, tests, risks.
- **Corrected the draft after checking:**
  - `signIn` does not refuse disabled users (it only stores the identity and session), so `account_unavailable` means a storage error;
  - `pages.css` styles only `<button>`, so the *Continue* link needs an `a.button` rule.

### Why

- **Render the problem page at the callback instead of redirecting.** That removes the handler that swallowed the error from the path entirely. No other page needs to learn about `login_error`.
- **Recover through `login_flows.return_path`.** It needs no new table. It is safe because the recovered path is only offered as a fresh sign-in link, and it passes `safeReturn` twice.
- **Treat 5xx and 429 as transient in the CLI.** The device code is stored in the database, so it survives a server restart.

### What worked

- The replay in guide section 3 explains every symptom the user saw, from the code alone.

### What didn't work

- The failures being designed around:
  - `http_503: no available server` from `slop auth login` during the rollout;
  - `the code expired; run slop auth login again` for `MRWH-ZGRJ`;
  - `?login_error=flow_missing` shown only in the URL (reported by the user).

### What I learned

- **The identity provider's own session hides the failure.** Once the person has signed in at ZITADEL, any `/auth/login` completes without a prompt. Redirecting a failure to a guarded page therefore turns into a silent success at the wrong destination.
- **`SaveLoginFlow` keeps expired rows for an extra hour** before deleting them (`sessions.go:17`). That gives the recovery read a useful window.

### What was tricky to build

- **Recovery without weakening login CSRF protection.** The flow cookie exists so a callback URL cannot sign a victim in as someone else. Recovery must not consume or trust the failed flow. It reads only `return_path`, by `state`, and offers a brand-new flow in the current browser. An attacker gains nothing they could not already get by sending a link to `/auth/login?return=…`.

### What warrants a second pair of eyes

- **Guide section 5.3** (the safety argument for `LoginFlowReturn`).
- **Status codes on the problem page** (5xx bodies and proxies).

### What should be done in the future

- Implement phases 1–3 of the guide. Then retry the user's exact scenario on the cluster: open the link in a signed-out browser, finish elsewhere.

### Code review instructions

- Read guide sections 2.3, 2.4 and 3 against `pkg/server/auth.go:234-291`, then section 5.
- Validate: `docmgr doctor --ticket SLOP-013 --stale-after 30`.

### Technical details

- Device code lifetime 10 min (`store.DeviceTTL`), poll interval 5 s (`deviceInterval`), flow lifetime 10 min, flow cookie 600 s, expired flows deleted after one more hour.
