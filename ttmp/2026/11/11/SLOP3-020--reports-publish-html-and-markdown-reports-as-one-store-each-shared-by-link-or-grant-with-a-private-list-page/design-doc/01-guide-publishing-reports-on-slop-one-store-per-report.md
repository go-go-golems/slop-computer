---
Title: 'Guide: publishing reports on slop, one store per report'
Ticket: SLOP3-020
Status: active
Topics:
    - apps
    - sharing
    - cli
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How to publish HTML and Markdown reports on slop so that each one is private by default and shared with chosen people by link or grant: one store per report on the live host, a publish script, and a private page that lists them. Includes what was measured on a local server before building it."
LastUpdated: 2026-11-11T15:20:00-05:00
WhatFor: "Publishing and sharing reports; changing the publish script or the reports page"
WhenToUse: "Before publishing a report, adding a feature to scripts/reports, or changing how reports are mounted"
---

# Guide: publishing reports on slop, one store per report

## 1. Executive summary

A report is an HTML page, or a Markdown document rendered to one. Its owner wants to publish it on slop, keep it private by default, and give chosen friends access to it, for a while or until revoked, and without giving them access to any other report.

slop already decides who may open what at the level of a **store**: grants and share links give a person a level on one store, and nothing else. So each report is its own store, of type `report`, which carries its own page. One mount on the live host, `/r/:id`, serves every store of that type by id. A script turns a file into such a store and, on request, a share link or grants. A small private page at `/reports` lists the owner's reports by title.

None of this needs a platform change. The work is:

- `scripts/reports/publish.py`, the publish script (Markdown or HTML in, a report store and optionally a link out);
- `scripts/reports/report.css`, the stylesheet for rendered Markdown;
- `apps/reports-home/`, the page that lists reports;
- two mounts, set once per server.

## 2. Terms

- **Store.** slop's unit of data, code and access: documents, files, a room, an optional app. Every store has an owner and an id unique on the server.
- **Live host.** The host that serves pages to signed-in people and guests (`apps.<domain>`). A **shell** page signs the visitor in and frames the store's page on a **sandbox origin** of its own (`s<hash>.sbx.<domain>`).
- **Static host.** The host that serves files without sign-in (`site.<domain>`). Anything there is readable by anyone with the URL, so reports never go there.
- **Level.** What a person may do on a store: `view` < `interact` < `admin` < `owner`.
- **Grant.** A level given to a subject on one store: a person (`usr_…`), a guest (`vis_…`) or an audience (`@member`, `@guest`).
- **Share link.** A URL with a secret token (`?k=k_…`). The first time someone opens it, slop writes a grant for them (`via` the link), so later visits need no link. Revoking the link deletes exactly those grants.
- **Mount with a store parameter.** `/r/:id --storeParam id --type report` serves any store whose type is `report`, by the id in the path. One mount covers every report.
- **Report store.** A store of type `report` whose files are `app.json`, `index.html` and the page's assets, and whose document `report/meta` holds the report's title.

## 3. What was measured first

Before writing code, one report was published by hand on a local server (`serve --local`) and opened in a fresh browser context, signed out. The details are in the diary, step 1.

| Question | Result |
|---|---|
| Does a store without `--app` run its own `app.json`? | Yes. `store new rep-test1 --type report`, then `push` a directory with `app.json` and `index.html`; `app status` shows the manifest, `broken: ""`. |
| Does `docs set` work on a store whose app declares no `db`? | Yes. `report/meta` was written and read back. |
| Does `/r/:id --type report` serve it? | Yes, for anyone with at least `view`. |
| What does a guest without access see? | The shell's "Sign in to open this", **with the title from `app.json`**. |
| What does a guest see at an id that does not exist? | "There is nothing here." |
| Does a link work for a guest with no account? | Yes. The guest got a grant `vis_… view via lnk_…`, saw the report, and kept access without the link. |
| Does revoking the link remove access? | Yes. `link rm` deleted the guest's grant; `grant ls` is empty. |
| Do scripts from a CDN run in a report? | Yes. The sandbox page's policy is only `frame-ancestors`: mermaid 11 from jsDelivr loaded and rendered a diagram. |
| Do relative assets load? | Yes. `<img src="pic.svg">` next to `index.html` loaded. |

Two of these results shape the design:

1. **The shell tells a stranger that a store exists, and shows its app title.** A report's id and its `app.json` title are therefore visible to anyone who guesses the id. The script uses generated ids (`s-` and eight characters) unless told otherwise, and writes a neutral title, "Report", into `app.json`. The real title lives in `report/meta`, which only people with `view` can read, and inside the page.
2. **Access does not need the link after the first visit.** A link is a way to obtain a grant. Sharing "for a week" means the link expires in a week: someone who opened it keeps their grant until it is revoked or the report is removed.

## 4. Design

### 4.1 A report store

```text
report store s-k3x9q0d2 (type report, owner: you)
  files (pushed, served on the sandbox origin)
    app.json      {"title": "Report", "type": "report", "page": "index.html"}
    index.html    the report
    …             its images and other assets, if any
  documents
    report/meta   {"title": "…", "source": "q3.md", "publishedAt": …, "updatedAt": …, "version": n}
  access
    owner         you
    grants        usr_… view, vis_… view via lnk_…, …
    links         lnk_… view, expires …
```

The report runs no actor and asks for no capability: it is a page. Each report has its own sandbox origin, so a report's scripts cannot read another report's storage or the shell.

### 4.2 Mounts

```sh
slop mount set --host apps.<domain> --path /r/:id --storeParam id --type report
slop store new reports-home && slop push apps/reports-home --store reports-home
slop mount set --host apps.<domain> --path /reports --store reports-home
```

The first mount serves every report. The type restriction matters: without it, `/r/<any store id>` would serve any store the visitor can open.

### 4.3 The publish script

```text
scripts/reports/publish.py publish SOURCE [--id ID] [--title T] [--show-title]
                                          [--link DAYS] [--grant usr_… …] [--grant-file FILE]
                                          [--dry-run] [--server URL]
scripts/reports/publish.py link ID [--days N]
scripts/reports/publish.py ls
```

**`publish`** takes a Markdown file, an HTML file, or a directory with an `index.html`:

1. **Build** the site in a temporary directory.
   - Markdown is rendered with pandoc into one standalone page with `report.css` embedded and local images inlined (`--embed-resources`). Before pandoc, the Markdown is made portable. The YAML front matter is removed; its `title` becomes the page title. Obsidian wikilinks `[[target|text]]` become their text. Callout markers `> [!summary]` become a bold label. After pandoc, fenced `mermaid` blocks become `<pre class="mermaid">` elements, and the mermaid script from jsDelivr is added when there is at least one.
   - An HTML file is copied as `index.html`. A directory is copied whole.
   - The script writes `app.json` (title "Report" unless `--show-title`).
2. **Store.** Without `--id`, `store new --type report` makes a store with a generated id. With `--id` of an existing report, the report is updated in place: same id, same grants and links. With `--id` of a store that is not a report, the script stops.
3. **Push** the directory to the store.
4. **Meta.** Write `report/meta` with the title, the source file name, the times and a version count.
5. **Share**, if asked: `--link DAYS` makes a view link (`0`: until revoked) and prints its URL; `--grant` and `--grant-file` give `view` to people by id.
6. **Print** the report's URL on the live host, from the server's `/r/:id` mount.

The title comes from `--title`, else the front matter's `title`, else the first `# ` heading, else the file name.

**`link`** makes another view link for an existing report. **`ls`** lists your reports with their titles, links (id, uses, expiry or revoked) and grants.

The script calls the `slop` CLI and never reads or prints the token. A link's URL holds a secret, so the script prints it once and nowhere else.

### 4.4 The reports page

`apps/reports-home` is a page without an actor. It calls `slop.stores.list({type: 'report', title: 'report/meta'})` and shows the reports the viewer can open, newest first, "yours" and "shared with you", each linking to `/r/<id>` on the live host (`target="_top"`). That runtime call reads each title as the viewer, under each store's rules, so the page shows nothing the viewer could not open.

By default only the owner can open the page (no grants). Because the list is computed per viewer, it would also be safe to grant `@member view` and let friends with accounts see what has been shared with them.

The page does not create links: pages cannot call `link.new`. Sharing happens in the shell's Share dialog on each report (the owner sees it), or with the script.

## 5. Decisions

- **One store per report, not one store for all reports.** Grants and links are per store. One store would make every link open every report, and all reports would share one sandbox origin.
- **Not in the catalog.** The catalog is a public index on the static host.
- **Access is the platform's, not the app's.** No invite codes in an actor: the platform already has hashed tokens, expiry, revocation, guest identity and enforcement on every path. Enforcing access in an app would require hiding the content from the platform itself.
- **Render Markdown when publishing.** Every report is the same kind of thing, self-contained HTML. A shared viewer app would give one look everywhere and live updates of that look, at the cost of reports that are no longer self-contained. It can come later if reports grow features such as comments.
- **Generated ids and a neutral app title.** See section 3.
- **pandoc.** It is installed where reports are written, handles tables, footnotes and code, and embeds images.

## 6. Limits

- **Friends need either an account or a link.** `grant set` takes `usr_…` ids, not emails. A guest's access is tied to that browser; on a new device they need a link again.
- **The existence of a report and the shell's title are visible at a guessed id** (section 3). Generated ids make guessing impractical; the platform could stop showing app titles to people without access.
- **Mermaid and anything else from a CDN** load from jsDelivr when the report is opened.
- **No groups, roles or link labels yet.** Those are platform work, to be designed when they are needed (groups first).

## 7. Implementation plan

| Step | Work | Check |
|---|---|---|
| 1 | Measure on a local server (section 3) | done |
| 2 | `scripts/reports/publish.py` and `report.css` | unit tests for the Markdown preparation; publish a Markdown report with images, a table and a mermaid diagram on the local server |
| 3 | `apps/reports-home` | the page lists reports by title as the owner; a guest sees a sign-in prompt |
| 4 | Staging: mounts, `reports-home`, one test report, a link opened signed out, revoked | browser |
| 5 | PR | CI |

## 8. References

- `pkg/doors/pages/storesrpc.go`: `slop.stores.list` and the title read as the viewer.
- `pkg/doors/pages/sandbox.go`: the sandbox page and its `frame-ancestors` policy.
- `pkg/registry/links.go`: links, redemption, revocation.
- `apps/pinboard-home/index.html`: the same listing page for boards.
- `doc/building-apps.md`: hosts, mounts and grants.
