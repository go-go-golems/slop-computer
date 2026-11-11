---
Title: Diary
Ticket: SLOP3-020
Status: active
Topics:
    - apps
    - sharing
    - cli
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The working record of SLOP3-020: publishing HTML and Markdown reports on slop, one store per report, shared by link or grant."
LastUpdated: 2026-11-11T15:25:00-05:00
WhatFor: "Following how the reports setup was decided, measured and built"
WhenToUse: "Resuming SLOP3-020, or reviewing scripts/reports and apps/reports-home"
---

# Diary

## Goal

The working record of SLOP3-020: a way to publish HTML and Markdown reports on slop that are private by default and shared with chosen people.

## Step 1: The decision, the ticket, and measurements on a local server

The user asked how to publish reports for friends with controlled access, and we went through the options in conversation. The options were the catalog, one store per report, one store for all reports, access rules in an app, groups and roles in the platform. The decision was one store per report, sharing through slop's grants and links, a publish script and a private list page, with platform work (groups first, then link options, then roles) only when a real need appears. Before designing the script, I published one report by hand on a local server and opened it as a signed-out guest. All of it works today. Two of the measurements changed the design, and both concern what a stranger can see at a guessed id.

### Prompt Context

**User prompts (verbatim), in order:**
- "Imagine I want to use slop-computer to publish artifacts and generate shareable links for my friends / controlled, would we in the current setup have them added to the catalog? or as their own store + app? or should we create a store + app that is solely for me to manage these types of artifacts (like, html or md reports)? What do you think?"
- "answer here, no impementation or so"
- "could we enforce sharing rules in the app itself, with a custom invite code and such?"
- "is that juts reimplementing the "parent" framework offered by slop-computer?"
- "so if i understand correctly, you would prefer to add groups to slop.computer itself?"
- "what would adding a more refined capability system look like, so I can give semantic roles to people  / groups (say, someone can comment but not edit, someone can export but not import, etc...) ?"
- "what would you do? with all these options (in the app, in the platform, one store, many stores, etc...)"
- "Ok, create"; asked what to create, the user chose "Reports setup (Recommended)".
- "create new docmgr ticket, guide, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"

**Assistant interpretation:** Build the near-term plan: report stores on the live host with a `/r/:id` mount, a publish script for Markdown and HTML, a private page listing the reports, tested locally and then on staging. Keep a ticket, a guide and a diary, and commit along the way.

**Inferred user intent:** Publish reports to friends from the command line, private unless shared, without new platform machinery.

**Commit (code):** none yet (this step: ticket, guide, diary, evidence).

### What I did
- **Worktree and ticket:**
  - `git worktree add -b task/slop3-020-reports $S/slop020 origin/main` (`56f3d51`);
  - `docmgr ticket create-ticket --ticket SLOP3-020 …`, with a design doc (the guide) and this diary. SLOP3-019 was skipped, because that number exists in history from the spec that was deleted.
- **Platform facts, from the code:**
  - `pkg/apps/manifest.go:25`: the manifest's `type` is "the store type this app runs on and creates".
  - `pkg/doors/pages/site.go:53`: a mount with a type serves a store only when the store's own type (set at `store new`) matches.
  - `pkg/doors/pages/sandbox.go:114`: sandbox pages send `Content-Security-Policy: frame-ancestors …` and nothing else, so a report may load scripts from a CDN.
  - `grant set` takes `usr_…`, `vis_…`, `store:<id>` or an audience, not an email.
- **A local server from this branch:** `go build -o $S/rep/slop ./cmd/slop`, then `serve --local --listen 127.0.0.1:18490 --data $S/lslop/data --admin-email admin@example.com`. I reused SLOP3-018's rehearsal data and credentials file through a new wrapper, `$S/rep/rslop`.
- **One report by hand** (`$S/rep/t1`):
  - `app.json` `{"title": "Test report one", "type": "report", "page": "index.html"}`;
  - an `index.html` that loads mermaid 11.4.1 from jsDelivr and shows `typeof mermaid`;
  - a `pic.svg` next to it.
  - Commands: `store new --id rep-test1 --type report`, `push . --store rep-test1`, `app status`, `docs set rep-test1 report/meta --data '{"title":…}'`, `docs get`, `mount set --host apps.localhost:18490 --path /r/:id --storeParam id --type report`.
- **A link and a guest:** `link new --store rep-test1 --level view --days 7 --url …`. The URL went to a scratch file, and Playwright read it from a loopback HTTP server, so the token never appeared in a command, a log or this diary. A fresh browser context, signed out, opened the report:
  - without the link;
  - with it;
  - without it again.
- **Revocation:** `link rm`, `grant ls`, then a fresh context at an existing and a missing id.
- **Evidence:** `various/01-local-measurements/` (the command log without token lines, and the browser results).
- **The guide**, `design-doc/01-…`: terms, the measurements, the design of the report store, the mounts, the script and the page, the decisions, the limits and the plan.

### Why
- **Measure before designing the script.** The open questions (CDN scripts, guests on a link, what revoking does, what a store without an app or a db capability allows) decide what the script must do. Each takes one command to answer.
- **A local server, not staging, for experiments.**

### What worked
- A store created without `--app` runs its own `app.json` (`app status`: the manifest, `broken: ""`).
- `docs set` works on a store whose app declares no capabilities.
- The `/r/:id --type report` mount served the report.
- **The guest flow:**
  - the guest received `vis_ee6e… view via lnk_acae…` (`link ls`: `uses 1`);
  - the report rendered in its own sandbox origin (`s0676…sbx.localhost`);
  - `cdn: object`, with a mermaid SVG drawn;
  - the relative image loaded (`naturalWidth 40`);
  - the report opened again without the link.
- `link rm` deleted the guest's grant (`grant ls` → `[]`).

### What didn't work
- **Removing links, and an extra one.** My first `link new` printed through a `sed` that masked tokens. The pattern `k_…` also matched `lnk_…`, so the ids were masked too. A second `link new … --json '{}'` then made another link. I removed both with `link rm --id`. They stay in `link ls` with `revokedAt` set, which is how slop lists revoked links.
- **Getting the URL to the browser.** Playwright's `browser_run_code_unsafe` has no `require` (`ReferenceError: require is not defined`), and `file://` is refused (`net::ERR_ABORTED`). I served the URL file from `python3 -m http.server --bind 127.0.0.1`. The first attempt raced that server's start (`ERR_CONNECTION_REFUSED`); the retry worked.
- **zsh.** It expanded `--include=*.go` in a `grep` as a glob ("no matches found"). Quoting it fixed that.

### What I learned
- **The shell answers differently for a store that exists and one that doesn't.** A missing id shows "There is nothing here."; an existing one shows "Sign in to open this." with the **app's title**. Anyone who guesses a report's id learns that it exists and sees its `app.json` title. Hence generated ids and a neutral title, "Report", in `app.json`; the real title goes in `report/meta`, readable at `view`.
- **A link is a way to get a grant,** not a key. Access lasts until the grant goes, which happens on revoke or on removing the report, not when the link expires.
- **`mount ls -o json` rows** are `{kind, mount: {host, path, type, storeParam, …}}`. The script can find the `/r/:id` mount there to build URLs.

### What was tricky to build
- **Keeping the link token out of every record** while still opening the link in a browser. The fix was a file read by the browser over loopback, never a command argument. The command log in `various/` drops the lines that carry tokens.

### What warrants a second pair of eyes
- **The existence and title leak through the shell** is a platform behaviour. Generated ids work around it. Whether the shell should show app titles to people without access is a separate question.

### What should be done in the future
- Steps 2–5 of the guide's plan: the script, the page, a local end-to-end run, staging, PR.

### Code review instructions
- Read the guide's sections 3 and 4.
- Re-run: build slop, `serve --local`, then the commands under "One report by hand" above, then open `/r/<id>` with and without a link in a signed-out context.

### Technical details
```text
mount:      apps.localhost:18490 /r/:id   storeParam id   type report
store:      rep-test1  type report  manifest {title, type: report, page: index.html}  capabilities: []
meta:       docs set rep-test1 report/meta {"title":"Test report one","publishedAt":1} → version 1
guest:      grant vis_ee6e… view via lnk_acae…   (link uses 1) → link rm → grants []
CSP:        sandbox page: frame-ancestors only
```
