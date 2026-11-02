# slop

slop is a computer made of stores. A store holds documents, files with
snapshots and refs, and tables; an app is a store type with code: pages that
run in the browser on the `window.claude` runtime, and an actor (JavaScript
on goja) that runs on the server with one turn at a time per store. Mounts
put stores on hosts; grants and audiences decide who may view, interact or
administer; the same verb table serves the CLI, HTTP and `eval`.

This is v3. It replaced v2 (artifacts, versions, routes and the Workshop SPA)
in one cutover; v2 is in this repository's history up to the commit that
removed it.

## Running it

```sh
make run-local       # a development server on *.localhost:18300 with a sign-in form
make test            # Go tests
make build           # ./slop, server and CLI (cgo: SQLite)
```

`slop.localhost:18300` is the main host (back office, sign-in, API),
`apps.localhost:18300` the live host (apps in the shell),
`site.localhost:18300` the static host. Production: `doc/production.md`.

## Where things are

| Path | What it is |
| --- | --- |
| `cmd/slop` | the binary: `serve` and every verb as a command |
| `pkg/` | the server (`server`), stores (`store`), actors (`actor`), the system database (`system`), access, verbs, identity (OIDC), LLM access (`llm`), blobs |
| `web/runtime` | the page runtime (`window.claude`), built into `pkg/server/assets/claude.js` |
| `web/admin` | the back office, built into `pkg/server/admin/` |
| `apps/` | apps that ship with slop: the Workshop, the back office as an app, `blocks-site` (Blocks workspaces as web pages) |
| `web/blocks`, `web/pinup` | Claude Blocks and Pinup, upstream sources built as apps (`make blocks pinup`) |
| `examples/` | small example apps |
| `conformance/` | the runtime conformance page and its browser runner |
| `ttmp/` | tickets: designs, intern guides and diaries (v3: `ttmp/2026/11/01/SLOP3-*`) |
| `design/`, `lab/`, `transcripts/`, `references/` | the v3 design workspace and its in-browser lab (`design/WORKSPACE.md`) |

The intern guide to v3 is
`ttmp/2026/11/01/SLOP3-001--…/design-doc/01-slop-v3-core-design-and-implementation-guide-for-interns.md`.
