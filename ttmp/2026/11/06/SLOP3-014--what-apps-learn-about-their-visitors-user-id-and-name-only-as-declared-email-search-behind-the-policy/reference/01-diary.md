---
Title: Diary
Ticket: SLOP3-014
Status: active
Topics:
    - security
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-014: what slop apps learn about their visitors, the tests that showed the leaks, and the fixes."
LastUpdated: 2026-11-06T18:18:01.098717668-05:00
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

## Step 1: Reproduce the leaks with tests, then fix them

The user asked whether JavaScript apps on slop handle access to user information properly. Reading the code showed that the `user` capability itself is enforced carefully: undeclared capabilities are refused, names need the `profile` scope, email needs both the `email` scope and the admin's `user.email` policy, and `user.search` is scoped to the store. But three things went around it. This step writes tests that reproduce each one, fixes them, and checks that the tests guard the fixes.

The answer to the user's follow-up question ("user id and session id avail to app?") is part of the test. No session credential reaches a page, but the person's `usr_` id and name did, in every app, whatever its `app.json` declared.

### Prompt Context
**User prompt (verbatim):** "can JS apps properly handling the access rights to clips (ie has access to user information)?" then "ok ticket with tests and fixes and then PR. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)" and, while I was working, "user id and session id avail to app?"
**Assistant interpretation:** "clips" has no meaning in slop (the only matches are clipboard code), so the question is about user information. Turn the four findings into a ticket with failing tests, fix them, and open a PR. Cover the session question in the tests as well.
**Inferred user intent:** Apps should learn about people exactly what their declared capabilities allow, so that slop is safe to host third-party apps.
**Commit (code):** `cde6017` (ticket and failing tests); `7b51a87` (fixes and docs). PR: https://github.com/go-go-golems/slop-computer/pull/34

### What I did
- **Read the paths by which an app can learn who is visiting:**
  - `pkg/doors/pages/views.go`: `userInfo`, `profileOf`, `rpcUserProfiles`, `rpcUserSearch`, the RPC gate at `:609`;
  - `pkg/actor/manager.go` `VisitorOf`, and `pkg/actor/actor.go` `Visitor` and `ctxObject`;
  - `pkg/rt/views.go` `AsPeer` (room peers);
  - `pkg/registry/documents.go` (`_people`);
  - `web/runtime/src/caps.ts` (`slop.visitor()` returns `hello.me.visitor`);
  - the session cookie flags in `pkg/doors/pages/live.go`.
- **Wrote `pkg/host/user_privacy_test.go`:**
  - `TestAppSeesVisitorOnlyAsDeclared`: three apps declaring `{"db":{}}`, `{"user":{}}` and `{"user":{"scopes":["profile"]}}`, each with an actor action `who` that returns `ctx.visitor`. For each app the test opens a view as a signed-in member, reads `hello` from `/_rt/events`, and checks:
    - that the person's id and name appear only where declared;
    - that `visitor` still carries audience, level and guest;
    - that no `slop_site` cookie value appears in `hello` or in the view the shell receives.

    It also calls `who` with the person's token and checks that the id is always present and the name only with `profile`.
  - `TestUserSearchByEmailNeedsPolicy`: an app with the `profile` and `email` scopes. `user.search` for `"ivy.private@"`, which matches only the address, must return nothing until `policy.set user.email @member on`, and then return the person with the address.
- **The fix,** `Visitor.Seen(caps, page)` in `pkg/actor/actor.go`:
  - it drops the name without the `profile` scope;
  - for a page, it drops the id without `user`;
  - it leaves the store-as-itself visitor (`store:<id>`) unchanged.

  `Visitor.ID` gained `omitempty`. It is used in `userInfo` (`views.go:939`) and in `ctxObject`.
- **`rpcUserSearch`** now matches the query against `pr.Email`, the address `profileOf` would show, instead of the raw address whenever the `email` scope was declared.
- **Docs:** `doc/claude-apis/README.md` (the `slop` row: what `visitor()` carries) and `doc/design/slop-v3.md` §7.1 (the `user` row).

### Why
- **The page rule is the claude.ai contract:** `user.id()` exists only when `user` is declared, and names only with `profile`. slop's own extra, `slop.visitor()`, had quietly given every page more than that.
- **Actors keep the id.** An actor is the app's own server code, and the bundled apps and tests key data on `ctx.visitor.id`: the guestbook, the workshop, blocks-site, `actors_test.go` and `authority_test.go`. Removing it would break them without hiding anything from the app's author. The name, however, is personal data the author didn't ask for, so it follows the `profile` scope. The workshop declares `profile`, so its use of `ctx.visitor.name` still works.
- **One function for both sides** keeps the page and actor rules from drifting apart.

### What worked
- Before the fix, the tests failed in exactly the expected ways:
  - `plain: the page learns the person's id = true … "visitor":{…"id":"usr_0aca7c15db8e9f7a194f0618",…"name":"Test",…}`;
  - `ids: the page learns the person's name = true`;
  - `plain: ctx.visitor.name = "Test", want a name: false` (and the same for `ids`);
  - `user.search matched an email the app may not see: [map[… name:Test]]`.
- The session check passed before the fix as well: no cookie value reaches the page.
- After the fix: `ok … pkg/host`. Full suite: `go test ./... -count=1` passed with no failures. `make lint`: `0 issues.`
- **Mutation checks:** each fix was undone in turn, and each time its own assertion failed:
  - M1, the page id: `plain: the page learns the person's id = true`;
  - M2, the name: `plain …` and `ids: the page learns the person's name = true`;
  - M3, the email match: `user.search matched an email the app may not see`.

### What didn't work
- **The mutation script restored `actor.go` from the wrong place.** The backup command `cp pkg/actor/actor.go /tmp/claude-1000/a.bak 2>/dev/null || cp … $N/a.bak` succeeded on its first branch, but the restores read `$N/a.bak`: `cp: cannot stat '…/scratchpad/a.bak': No such file or directory`. M1 and M2 therefore stayed in the file, and the final run printed `FAIL`. I removed the two `false &&` edits with `sed`, checked `git diff` (only the intended changes; `grep -c "false &&"` → 0), and reran: `ok`. Then I reran `./pkg/host/... ./pkg/actor/... ./pkg/doors/...`: `ok`.

### What I learned
- `room` already applied the right rule: `AsPeer` sets `by` only when the view declares `user` (`pkg/rt/views.go:533`). The leak was limited to `hello` and the actor's `ctx`.
- The session cookie (`__Host-slop_site`, HttpOnly, SameSite=Strict) lives on the apps host, and app code runs on its own sandbox origin. A page holds only its view secret (`slv_…`), which works for one view of one store and expires.
- `_people` is not a leak: it needs `capabilities.db.stores`, an admin's `stores` policy, and a viewer who is a platform admin (`people.ls`).

### What was tricky to build
- **The name could appear without a name being set.** `VisitorOf` falls back to the local part of the email address when a person has no name (`manager.go:318–323`), so the "name" field could leak part of an address. The test signs in as `ivy.private@example.com` and checks for both `"Test"` and `ivy.private`, so the fallback cannot slip through either.

### What warrants a second pair of eyes
- **The actor keeps the global `usr_` id.** That is a deliberate trade-off, but an actor with `fetch` origins can still send ids out, and two apps can recognise the same person.
- **A visible change for apps:** `slop.visitor().id` and `.name` are now missing or empty for apps that do not declare `user`/`profile`. No bundled app relies on them, but an imported app might.

### What should be done in the future
- **Per-app opaque ids** (task `zdmy`): an HMAC of the person and the store instead of `usr_…`. Stored data is keyed on today's ids, so this needs a migration plan.
- **`user.profiles`** resolves any id the page knows. Limiting it to people who wrote to or hold grants on the store would need care, because comments and documents carry the ids of visitors who came in through `@guest` or `@member` grants.

### Code review instructions
- `pkg/actor/actor.go` `Visitor.Seen` and `ctxObject`; `pkg/doors/pages/views.go` `userInfo` and `rpcUserSearch`.
- `pkg/host/user_privacy_test.go`.
- `go test ./pkg/host -run 'TestAppSeesVisitorOnlyAsDeclared|TestUserSearchByEmailNeedsPolicy' -count=1`; `go test ./... -count=1`; `make lint`.

### Technical details
```
what an app learns about the visitor (after this change)
                     page (hello.me.visitor / slop.visitor())    actor (ctx.visitor)
id                   only with capabilities.user                 always
name                 only with user.scopes ⊇ [profile]           only with user.scopes ⊇ [profile]
email                user.profiles/me: email scope + policy      never
audience, level,     always                                      always
guest, subscribed,
llm
session cookie       never (HttpOnly, other origin)              never
```
