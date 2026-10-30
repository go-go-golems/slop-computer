---
Title: Working with your coding agent
Slug: agents
Short: Connect Claude Code, pi, Codex or any shell agent to slop, and work with it through pushes and comments.
Topics:
- agents
- tokens
- push
- comments
Commands:
- auth
- push
- pull
- route
- comments
IsTemplate: false
IsTopLevel: true
ShowPerDefault: true
SectionType: GeneralTopic
---
Your agent works on slop the way you would from a terminal: it pulls an artifact
into a folder, edits the files, and pushes a new version. You watch the version
appear in the Workshop, point at what is wrong, and the agent picks your comment
up and answers it with the next version. Nothing goes on the public site until
someone routes it.

This page is also in the CLI: `slop help agents`.

## 1. Install the CLI

The `slop` binary is both the server and the CLI. Either:

```
go install github.com/go-go-golems/slop-computer/cmd/slop@latest
```

(Go 1.26.3 or newer; the go command fetches it if needed), or copy it out of the
server image (Linux, amd64):

```
docker run --rm --entrypoint cat ghcr.io/go-go-golems/slop-computer:latest /usr/local/bin/slop > slop && chmod +x slop
```

## 2. Log in, once per agent

```
slop auth login --server https://your-slop-server --name "claude on my laptop"
```

This prints a link and opens it. Check that the code matches, pick the
scopes, and approve. Choose `read` and `write` for an agent. `admin` is only
for managing people and for imports that keep authors. The token is stored in
`~/.config/slop/` (mode 600), and every later command uses it.
`slop auth status --check` shows which token is in use.

Open the link in a browser where you are signed in as an admin. If you sign
in from a different browser than the one the link opened in, slop shows a
page saying so, with *Continue signing in*: it signs you in there and brings
you to the approval form. The CLI keeps waiting while the server restarts,
and offers a new code when one expires.

To run several agents, give each one its own login, so their work is labelled
separately and each can be revoked on its own:

```
SLOP_CONFIG_DIR=~/.config/slop-claude slop auth login --server https://your-slop-server --name claude
SLOP_CONFIG_DIR=~/.config/slop-claude claude        # start the agent with that login
```

`SLOP_TOKEN` or `--token-file` work too, for agents that run in CI or a container.
Tokens are listed and revoked in the Workshop (Admin → Tokens) or in safe mode
(`/_/`).

Set `SLOP_VIA=agent` in the agent's environment, so its pushes show as agent
work in the Workshop. Claude Code is detected without it.

## 3. Tell the agent how slop works

Put this in the agent's `AGENTS.md` or `CLAUDE.md`, in the folder it works in:

```
## slop.computer

This project's pages live on slop (https://your-slop-server, public site
https://site.your-slop-server). The `slop` CLI is logged in.

- A *page* is a folder with index.html (+ css/js) and a slop.json; a *data*
  artifact is a folder of records (Markdown with front matter, JSON, CSV,
  images). Every push is a new numbered version; main follows the newest.
- slop artifacts list                      # what exists
- slop pull <artifact> [dir]               # main version into a folder
- slop push <dir> -m "what changed"        # new version (folder remembers its artifact)
- slop push <dir> -a <id> --project <p> --title "Title" -m "first"   # new page
- slop route set /path <artifact>          # put a page on the site (follows main)
- slop route set /r/:page <else-page> --page-from '{page}'
                                           # one route for many pages: serves the page
                                           # named by :page from <else-page>'s project,
                                           # <else-page> (404) when there is none
- slop route undo /path                    # take the last route change back
- slop comments wait -p <project>          # BLOCKS until someone comments; prints
                                           # the thread, the element and how to reply
- slop push <dir> -m "…" --reply <thread> --reply-text "what I did"
- A page reads data through slop.json {"reads": {"posts": "journal"}} and
  window.slop.data.posts.list(). Under a route with --record, window.slop.record
  and window.slop.route.params name the record.
- {"reads": {"pages": "$site"}} gives a page every public URL of its host
  (path, title, kind, section, project, updated; record routes add record):
  static routes, each listed record a record route serves, each page a
  page-from route admits. Left out: private routes, the fallback, pages with
  "listed": false, records with draft/hidden: true, listed: false or
  visibility hidden, private, draft, unlisted or internal. See it with:
  slop site ls
- Keep pages self-contained: no external network requests, no build step.
- Check a routed page with: curl -s https://site.your-slop-server/<path>
```

## 4. The loop

1. You: "build a page that lists the journal" (or any task).
2. Agent: `slop push ./journal-index -a journal-index --project lab -m "first list"`.
3. You open the version in the Workshop (Watch), click an element and comment.
4. The agent, blocked in `slop comments wait -p lab`, gets the thread with the
   element's selector and styles. It changes the files and pushes with
   `--reply <thread>`. The new version and its answer appear in the thread.
5. When it is right, you or the agent route it: `slop route set /journal journal-index`.
   Every route change is logged and can be undone, from the CLI, the Workshop or safe mode.

## 5. Things that surprise agents

- **Data files are private until a routed page reads them.** Images in a data
  artifact get a `src` like `/_d/<artifact>/<n>/files/x.png`. That URL answers
  only when some routed page lists the artifact under `reads`. Page files
  are at `/_v/<artifact>/<n>/<file>`, for routed pages only, with numbered versions.
- **A page gets everything it reads.** All records of every artifact in
  `reads` are inlined into the page. Large data means large pages.
- **Relative links resolve from the route.** A page routed at `/apps/:id`
  finds `style.css` at `/apps/style.css`. Keep a page's files flat at its root.
- **A route serves one page, unless it is a page-from route.** To give many
  page artifacts a URL each, don't write one route per page:
  `slop route set /r/:page release-missing --page-from '{page}'` serves page
  `weft` at `/r/weft`, for every page of `release-missing`'s project, at main.
  Every page of that project whose id fits the template becomes public, so a
  prefix (`--page-from 'release-{page}'`) narrows it. A page cannot be chosen
  by a record field yet; put the page id in the URL.
- **Routes of the same shape shadow each other without warning.**
  `/apps/:id` and `/apps/:slug` cannot both work. `slop route set /` replaces
  the home page. `slop route list` before you route.
- **There is no artifact delete.** Throwaway pushes stay, so name them clearly.

## 6. Designs (Pinup)

If people design in the Workshop's Pinup tool, an agent can read and change a design while it is open, resolve review items one step at a time, and build the real app from a hand-off. See `slop help pinup` (or `/help/pinup`).

## 7. If this server has the francois import

The francois catalogue lives in project `francois`:

- `francois-catalog`: one JSON record per app.
- `francois-creators`.
- `francois-media`, `-2`, `-3`: images, cover and gallery `src` included.
- One page artifact per app whose versions are its releases, served at
  `/r/<page>` (one page-from route, if the server has it; one route each on
  older servers).

The storefront at https://site.your-slop-server/ is the pages `storefront` and
`storefront-entry`; `slop pull storefront` is the quickest example of a page that
reads data.

If the Workshop is ever broken, `https://your-slop-server/_/` (safe mode) can still
move routes and revoke tokens.
