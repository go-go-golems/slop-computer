Brainstorm for Manuel and Ramon · revision 2 · 28 October 2026

# slop.computer

A workshop for the two of us and our agents. It is francois’s backend cut down to administrators, with one API that Claude Code reaches with its CLI token, and nothing in the browser that isn’t an artifact, slop.computer’s own screens included.

Below: the kernel all three directions share, three ways the agent loop could work, a side-by-side, where I would start, and the questions I need answered before narrowing.

Revision 2, after your notes

You asked for two things: artifacts can be **data** as well as HTML, so a blog post is pushed as data, shown like any other artifact, served, and saved or imported as static files; and artifacts are seen **inside a project or session**, as in Trellis and Shop Next. What changed:

- The kernel has two kinds of artifact, pages and data, with routes that bind a page to data. See [Pages and data](#pages-and-data), with a wireframe of one post’s life from file to static export.
- The kernel has projects, sessions and turns. See [Projects and sessions](#projects).
- A new section, [The project stage](#stage), with a wireframe, folds the three directions into one shell. Each direction has a note on what your feedback changes.
- The suggestion and the questions are updated.

[A Contact sheet The agent loop stays in Claude Code. The web is where we look at versions, comment on them and point URLs at them. Size: small](#contact-sheet) [B Desk A shared canvas per idea, after CC5: live drafts, notes, references and holes that people and agents fill together. Size: large](#desk) [C Board A Paper-style board of the site: each row is a URL, each column a take. Agents branch, we compare and promote. Size: medium](#board)

[What I read](#read) [The kernel](#kernel) [**A**Contact sheet](#contact-sheet) [**B**Desk](#desk) [**C**Board](#board) [Project stage](#stage) [Side by side](#side-by-side) [Where to start](#start) [Questions](#questions)

Before the proposals

## What I read, and what it changes

I read francois at `ca05239` (the catalog server is about 23,000 lines of Go and 11,700 of TypeScript, with 21 migrations), slop.boutique as it stands with its 100 artifacts, the Trellis build plan and prototype, the CC5 Godprompt Computer bundle, the Boutique Workbench and, for revision 2, Shop Next 1.0.0. Six things shape everything below.

1. **Most of slop.computer is deletion.** francois already has ZITADEL sign-in with PKCE, device-code CLI login into `credentials.json`, scoped tokens that the audit log records, a content-addressed blob store, immutable releases, per-instance origins, the `window.claude` runtime, the Pi worker, and MCP over stdio and HTTP.
2. **What’s missing is a route table.** francois’s URLs are written into `routes.go` and Go templates (`/apps/{id}`, `/journal`), so the storefront can’t be an artifact. The Boutique Workbench already lets a view claim a URL with `ui.view('home').route('/')`. slop.computer makes that the server’s main job.
3. **Releases are single files.** `release_files` allows only `html` and `manifest`, so the import playbook bundles multi-file artifacts. CC5 is nine files and 636 KB; Hypercore was 135. Versions here should be file trees.
4. **The agent loop has been built three times already**, each inside one page: the single `eval` tool of Tabula, RAG and the Boutique Workbench; CC5’s read-the-state, write-a-turn protocol with holes; and Trellis’s server-side eval over an op log. In each one the agent reads a text projection of the state and writes small changes. The three directions differ in where that state lives.
5. **Per-user instances exist because strangers pay for copies.** Launch codes, runtime grants, plans and entitlements protect that. With two administrators, one shared data space per artifact is enough.
6. **Shop Next already separates code from data, and keeps both in a project.** A project holds a program, a brief every agent reads, a bundle of content (collections the product starts with), samples (records for the canvas and scenarios) and assets, and a linked design system in the shape of claude.ai’s Design System tokens. Versions are restore points taken before agent turns, and one strip shows every turn by anyone, to keep or drop. slop.computer can store exactly those parts, so they live on the server instead of in one browser.

Shared by A, B and C

## The kernel

One server that stores artifacts as versions, decides which version answers at which URL, and exposes the same API to our browsers, our CLI and any MCP client.

What runs where. `slop.run` stands for a second registrable domain, so that cookies set on slop.computer never reach artifact code; any spare domain works.

### Who gets in

Sign-in stays ZITADEL, as in francois. Anyone who signs in becomes a *pending* user and sees nothing; an admin promotes them. The first admin is promoted from inside the deployment, the way `francois catalog db users promote` works today. Roles are `admin`, `pending` and `disabled`. Tokens keep francois’s device login (`slop auth login` prints a code, you approve it in the browser) with three scopes: `read`, `write` and `admin` for users and tokens.

### Pages and data revision 2

An artifact is a versioned file tree of one of two kinds.

- A **page** is HTML, JS and CSS with an `index.html`, as before.
- A **data** artifact is a collection of records stored as files: Markdown with front matter, JSON or CSV. Its manifest names a type (`post`, `records`, `tokens`), an optional list of fields, and the page that shows one record by default, the way a file type opens in an app.

Both kinds are pushed, versioned, commented on, routed and exported the same way. A blog post is one file in the `journal` artifact. Publishing it is a `slop push` that makes `journal` v15, and every route whose page reads `journal@main` shows the post at once, with no new version of the page.

**How a page gets its data.** A page’s manifest names what it reads, `"reads": { "posts": "journal" }`, and the page asks for it with `slop.data.posts.list()` or `.get(slug)`. A route or a project decides which version each name means, so the same page can be shown with the real content, with samples, or with last week’s posts. A route like `/journal/:slug` also names the record, `posts/{slug}.md`.

**Content is not live records.** Data artifacts are what we author: posts, menus, fixtures, design tokens. The rows that an app’s visitors write through `window.claude` db stay separate, per artifact, as in francois. Shop Next draws the same line between content, samples and live records.

**Files in, files out.**

```
slop pull journal ./journal                       # records as files: posts/*.md
slop push ./journal -a journal -m "new post"      # edited by hand or by Claude Code
slop import ~/blog/posts --as journal --type post # an existing folder becomes a data artifact
slop export /journal --static ./out               # every route, one page per record, JSON beside each
```

Every record also has a stable raw address through the API, so slop.boutique, a feed or an agent can read it without going through a page.

One post, every way: a Markdown file, a record in the `journal` data artifact, a page bound to it by a route, the live page, and static files that can be hosted anywhere or imported back.

### What it stores

| Table | Holds | From francois |
| --- | --- | --- |
| `users` | Issuer and subject from ZITADEL, email, name, role | kept roles cut to three |
| `sessions`, `api_tokens`, `device_authorizations` | Browser sessions, CLI and agent tokens with scopes, pending device logins | kept |
| `audit` | Who changed what, through which token and which agent | kept `admin_audit` |
| `artifacts` | Slug, title, kind (`page` or `data`), type for data, trust (`shell` or `app`) for pages | changed `catalog_artifacts` without page, plan and demo columns |
| `versions` | An immutable file tree `{path → sha256}`, manifest, parent version, message, author, the agent or token it came through, and its turn | changed releases and release files, as a tree |
| `refs` | Movable names per artifact: `main`, `take/denser` | new |
| `routes`, `route_log` | Host and path pattern → a page at a ref or a pinned version, its data bindings and record pattern; every change kept, so any route can be undone | new |
| `projects`, `project_items` | Name, brief, and the artifacts a project works on, each at a ref, with a role (page, content, samples, system) and a place on the canvas | new |
| `sessions`, `turns` | Sittings inside a project, and the versions each actor made in one go, with their review state | new |
| `docs`, `assets`, `threads`, `comments` | What `window.claude` reads and writes, and comment threads with an anchor, one space per artifact | changed the `instance_*` tables, keyed by artifact |
| blobs, on disk | File bytes by sha256 | kept `releases.Blobs` |

### Where things are served

- `slop.computer/<path>` goes through the route table. A route names an artifact and either follows a ref (`main`) or pins a version. Patterns like `/lab/:slug` pass their parameters to the artifact.
- Artifacts marked **shell** are served on slop.computer itself with `window.slop` injected: the API bound to your session, the way francois injects its runtime into instance pages today. Only an admin can mark an artifact as a shell, so a draft an agent pushes can’t call the API until one of us says so.
- Artifacts marked **app**, and every preview, run on the sandbox domain at `v<n>--<artifact>.slop.run` with `window.claude` (db, room, assets, comments, user, sample) and no quotas. A routed app is a thin frame page on slop.computer around that origin, which is francois’s launch exchange without the billing checks.
- `/_/` is the one page that isn’t an artifact: server-rendered safe mode where an admin can sign in, list routes, point any route at an earlier version and revoke tokens. If a change breaks `/`, this is how we get it back.
- The first shells (Home, Routes, Watch, Admin) live in the repository under `shells/` and an empty database gets them from `slop init`. After that they are ordinary artifacts that we change with the same loop as everything else.

The Routes shell, which every direction needs. It is an artifact like any other, served at `/routes`. The Data column binds a page to data artifacts; the host switch is there in case slop.computer later serves slop.boutique’s pages too (question 2).

### Projects and sessions revision 2

A project is the context artifacts are seen in, the way a Trellis file holds its artboards and a Shop Next project holds its code, content, samples, system and brief.

- A **project** has a brief that every agent reads and a list of the artifacts it works on, each at a ref and with a role: page, content, samples or system. An artifact can belong to several projects; `journal` is in the journal redesign and also in the front page’s project.
- A **session** is one sitting inside a project: a Claude Code conversation, the desk agent’s conversation, or one of us working. `slop session start -p journal-redesign` remembers the session in the folder, and later pushes attach to it. Over MCP, the session header does the same.
- A **turn** groups the versions one actor made in one go. Turns appear in the project’s strip, newest on the right. An agent’s turn waits for review: Keep, Drop (its refs go back to where they were, and the versions stay in history) or Compare. This is Shop Next’s strip and the Trellis plan’s “revert this turn”, kept on the server.
- A project leaves as one file, as in Shop Next: `slop export -p journal-redesign` writes its artifacts, data and brief to a folder or a single HTML file.

### One API, three ways in

The same routes and the same checks answer the CLI, MCP and shell artifacts, and every change records the token or agent that made it.

```
# the CLI, logged in once per machine
slop auth login --server https://slop.computer
slop session start -p journal-redesign               # later pushes land in this session's turns
slop push ./pricing -a pricing -m "three tiers"      # a new version from a folder
slop route set /pricing pricing@main
slop comments wait -a pricing                         # blocks until someone comments

// inside a shell artifact
const routes = await slop.routes.list({ host: 'slop.computer' })
await slop.routes.set('/pricing', { artifact: 'pricing', version: 7 })
slop.events.on('version.created', v => filmstrip.add(v))
const posts = await slop.data.posts.list()   // any page that declares reads

# MCP: about 15 tools instead of francois's 67
list_artifacts  read_version  push_version  list_routes  set_route  undo_route
list_comments  reply  wait_for_comments  whoami  (+ desk_* or take_* for B and C)
```

### What we cut from francois

| Area | In francois | In slop.computer |
| --- | --- | --- |
| Billing | Stripe Checkout, plans, credits, support tiers, year funding; about 1,000 lines | gone |
| Storefront | Server-rendered front page, artifact and creator pages, journal, feeds, SEO, analytics, demos; about 3,000 lines | gone pages are artifacts on routes |
| Portal UI | React app for account, studio, admin; about 9,100 lines of TypeScript | gone replaced by shell artifacts |
| Sign-in | ZITADEL, email links, Google and GitHub through ZITADEL | ZITADEL only |
| Instances | Per-user copies on `i-<id>` origins, members, launch codes, grants | One data space per artifact; version origins on the sandbox domain |
| Releases | One HTML file plus manifest; draft, published, withdrawn | Versions as file trees; refs and routes decide what is live |
| MCP and CLI | 67 tools, glazed commands for catalog, customers, billing | About 15 tools; the same device login |

Rough count: about a third of francois’s Go survives, mostly auth, tokens, the store, the hosted runtime and the MCP plumbing.

DIRECTION A

## Contact sheet

The agent loop stays in Claude Code. slop.computer is where we look at what the agents pushed, point at what’s wrong, and decide what goes live.

### How a round goes

1. Manuel asks his Claude Code for a pricing page. It writes files in a folder and runs `slop push`.
2. Every open Watch page receives version 6 over the event stream. It lands in the filmstrip with the agent’s message.
3. Ramon clicks the tiers and writes “too much air between the tiers”. The comment stores the version, the element’s selector, its box and a crop of the screen.
4. Manuel’s Claude Code is blocked on `slop comments wait`. It gets the comment, edits the CSS, pushes version 7 and replies on the thread.
5. When a version is right, either of us points the route at it, from the Watch page or with `slop route set`.

The Watch shell. The filmstrip is the contact sheet; the flag over v5 shows which version `/pricing` serves. Coloured dots say who pushed.

```
# the same round from the terminal side
$ slop push ./pricing -a pricing -m "three tiers, Areal, no shadows"
pushed pricing v6 · 3 files · 41 KB · https://slop.computer/watch/pricing#v6

$ slop comments wait -a pricing --json
{"thread":"th_8k2","version":6,"by":"Ramon","text":"too much air between the tiers",
 "anchor":{"selector":"section.tiers","box":[96,212,1248,540],"crop":"/api/crops/c_19.png"}}

$ slop push ./pricing -a pricing -m "tiers: gap 48 → 24px" --reply th_8k2
pushed pricing v7 · replied on th_8k2

$ slop route set /pricing pricing@7
/pricing  v5 → v7   (slop route undo /pricing goes back)
```

Adds to the kernel

Comment anchors with selector, box and crop; a long poll behind `comments wait`; the Watch shell. No server-side agent: `sample()` stays for artifacts that call models themselves.

After your notes

The sidebar lists projects, and the Watch page shows a project’s pages and data together. A data push lands in the filmstrip like a page push, drawn through the record page its type names. A comment can anchor on one record (“this post’s date is wrong”), and the agent gets the record path with it.

#### Good at

- Nothing new to learn. Claude Code keeps its files, git, tests and Playwright.
- Two of us can run two agents on two artifacts without stepping on each other.
- Smallest to build, and useful the day it works.

#### Weak at

- Each agent’s conversation stays in one terminal; the other person sees only versions and replies.
- An idea has nowhere to live until it is a folder of files.
- Ramon steers through comments unless he runs his own Claude Code.

DIRECTION B

## Desk

One shared canvas per idea, after CC5. Drafts, notes, references and holes sit side by side, and people and agents work on the same desk at the same time.

### How a round goes

1. Ramon opens a desk called “pricing ideas”, drops in a screenshot for reference and writes a short brief.
2. He types `?"two takes on a pricing page, from the brief"` in the command bar, which opens two holes.
3. The desk’s own Claude, which runs on the server with one `eval` tool over the desk, takes one hole. Manuel’s Claude Code runs `slop holes take` and takes the other. Both drafts grow on the canvas while we watch each other’s cursors and the agents’ working marks.
4. Comments, a mention like “@take-1 make the middle tier win”, and new holes drive the next round. Every change is an op in the desk’s log, so a whole agent turn can be undone at once.
5. Select a tile and choose Publish. Its version becomes a version of the artifact you pick, and the route you pick points at it.

A desk. Tiles are live versions on the sandbox domain, notes, references and holes; dashed wires show where a tile came from. The take with the marching border is still being written.

```
# what an outside agent sees: the desk as text, as CC5 hands Claude its tree
$ slop desk read pricing-ideas
desk pricing-ideas · seq 214 · here: Ramon (on take-1), Manuel
tiles
  brief      note   "Pricing for the lab. Three tiers, set in Areal…"
  ref-mold   image  moldandyeast.com, captured 10:41
  take-1     draft  v3 · desk Claude · 1 comment
  take-2     draft  v1 · Manuel's Claude · working
  phone-1    hole   ?"a phone layout of take-1"   open · from take-1
  home       draft  home@12 · from route /
recent
  212 Ramon   comment take-1  "the middle tier should win"
  213 Manuel  hole    phone-1
  214 Claude  write   take-1 v3 (tiers.css, index.html)

$ slop holes take phone-1
claimed phone-1 for 10 min · take-1@3 checked out in ./phone-1
$ slop push ./phone-1 --fill phone-1 -m "single column, sticky button"
filled phone-1 → v4 · placed under take-1
```

Adds to the kernel

Desks with a server-sequenced op log (place, write, note, hole, fill, link, say, remove), last writer wins per tile property; presence over a WebSocket, reusing francois’s room semantics; holes as a shared work queue; a server-side agent through the Pi worker with one `eval` tool; `slop desk` and `slop holes`.

After your notes

The desk is a project’s canvas, and its log is the project’s turns. A data artifact is a tile drawn as a table or as its record page; dragging it onto a page tile binds it, and the page re-renders with that data.

Worth a spike first: CC5’s page keeps its state in `window.claude` db documents, which francois already reimplements, and an outside Claude reads and writes those documents through ArtifactData. On slop.computer the CLI could play ArtifactData’s part, so CC5 might become the desk with few changes. I have not tried this.

#### Good at

- Ideas before there are files: notes, references and holes come first.
- Many agents in parallel, each taking holes.
- The conversation and the drafts are in one place both of us see.
- Ramon can drive agents from the browser.

#### Weak at

- The canvas is the biggest artifact to build and keep fast; live iframes need thumbnails when zoomed out.
- The site’s structure, which URL serves what, lives on another screen.
- Overlaps with CC5 itself, so we would need to decide whether this is CC5 or a new desk.

DIRECTION C

## Board

A Paper- or Figma-style board of the site. Each row is a URL and each column a take on that page. Agents branch, we compare, and promoting a take changes the site.

### How a round goes

1. The board shows every route as a row. The first artboard is what’s live; the others are takes, stored as refs like `take/denser` on the same artifact.
2. Manuel selects `/pricing`, writes a line of direction and chooses Make 3 takes. Three holes open; the server agent and any Claude Code fill them in parallel, each on its own ref.
3. Ramon clicks the middle tier inside a take. A small script, injected only into previews, reports the element’s selector, box, trimmed HTML and computed styles, so a comment or “Ask about this” carries exact context.
4. CSS variables declared in `:root` show as fields. Changing `--gap` updates every artboard of that page at once, and Fold writes the new `:root` block as a version. This is Trellis’s fold limited to CSS variables, with no compiler.
5. Compare side by side or with an onion-skin slider, then Promote. `main` moves to the take’s version, and because the route follows `main`, the page changes with it.

The board at desktop size. Blue frames are live, the dashed slot is an empty place for a take, and the green dashed frame is a take an agent is still writing.

Site map mode: the route table drawn as a map. Edges come from the links in each live version; a link that points at a path with no route shows in orange. Dragging a version onto a page routes it.

Adds to the kernel

Refs used as takes; the selection script on preview origins; token fields and fold; thumbnails (iframes at quarter scale first, a headless Chromium pool later, as the Trellis plan proposes); fan-out through holes, borrowed from the desk.

After your notes

A board is a project’s Site mode. A route bound to data, like `/journal/:slug`, gets one artboard per record, or the first few beside the empty and long samples, so a take is judged against every kind of post. The site map counts the pages each collection makes, and the tokens panel edits the project’s `tokens` data artifact instead of one page’s `:root`.

#### Good at

- Choosing between designs, page by page.
- Seeing the whole site and where its links go.
- Feedback on one element that an agent can act on exactly.
- It is the route table, drawn.

#### Weak at

- Tools, simulations and CC5-style apps fit only as single artboards.
- Loose ideas and references have no place unless we add a notes lane.

REVISION 2

## The project stage

Your notes point the three directions at one shell. Trellis and Shop Next both show a whole project in one place with modes on top, and that fits here: a project’s pages and data on one canvas, its turns along the bottom.

The journal redesign as a project. Its records sit on the canvas as a table, wired to the three pages that read them; selecting a record shows it in every page and in the inspector. The Data switch re-renders every page with the samples, empty or 200 posts. The agent’s turn on the right of the strip waits for Keep or Drop.

### How a round goes

1. Manuel writes a post as a Markdown file and pushes it into `journal`. It appears in the table, in all three pages and in the strip as his turn.
2. Ramon comments on the post page: dates should be mono. The comment is addressed to the page and carries the record it was made on.
3. Manuel’s Claude Code, in a session on this project, reads the brief and the comment with `slop comments wait`, changes both pages and pushes. Its two versions arrive as one turn.
4. Either of us flips the Data switch to check the empty and long cases, then keeps the turn. The routes follow `main`, so `/journal` changes.
5. When the project should become files, `slop export --static` writes the routes it touches, or `slop export -p` writes the whole project.

### Where A, B and C go

- **Stage** is the mode in the wireframe: the project’s artifacts, laid out on a canvas, rendered with the data the switch picks.
- **Site** is the Board (C): the same artifacts arranged by route, with takes in columns and the site map.
- **Desk** is B: a free canvas for notes, references and holes, for when an idea isn’t a page yet.
- The **strip** is the Contact sheet (A) turned sideways: every turn by anyone, with the same comment loop to Claude Code underneath.
- A `tokens` data artifact, in the shape claude.ai’s Design System type and Shop Next’s systems use, becomes CSS variables in every page of the project that reads it, so a project has one look to change.

Comparison

## Side by side

|  | A · Contact sheet | B · Desk | C · Board |
| --- | --- | --- | --- |
| The unit | One artifact’s versions | A canvas of tiles per idea | The site: routes by takes |
| Where agents run | Claude Code on our laptops | On the desk (server, Pi) and Claude Code through `slop desk` | Server fan-out, or Claude Code taking holes |
| How we give feedback | Comment pins on a version | Comments, @tile, notes, new holes | Select an element, then comment, ask or change tokens |
| How something goes live | Point a route at a version | Publish a tile to an artifact and a route | Promote a take to `main`; the route follows |
| Projects and data | Projects in the sidebar; data shown through its record page | The desk is the project; data are tiles you bind by dragging | Site mode of a project; one artboard per record |
| Adds to the kernel | `comments wait`, the Watch shell | Desk op log, presence, holes, server agent | Refs as takes, selection script, thumbnails, holes |
| Size | Small | Large | Medium |
| Best for | Shipping with Claude Code this week | Open-ended ideas with many agents at once | Designing a website page by page |
| Weakest at | Ideas before files; Ramon needs his own agent | A big UI to build; the site’s structure is elsewhere | Apps that aren’t pages; loose ideas |

My suggestion

## Where I would start

Because every screen is an artifact, the directions don’t exclude each other: they are shells over one API, and the decision is which primitives the kernel needs first. After your notes, the order I would take:

**1. The kernel with pages and data.** Versions as file trees, routes with data bindings, projects, sessions and turns, comments and events, and the CLI’s push, pull, import and export. It is still mostly deletion from francois, and pushing the journal as data is the first real test.

**2. The project stage at `/`**, with the data table, artboards and the strip, used with Claude Code from the first day through sessions and `comments wait`. This replaces the Watch page as the first shell.

**3. Site mode**, the Board and site map, when the project has several routes to compare. Holes come with it, as the way to fan out to several agents.

**4. Desk mode and the desk agent** later, possibly as CC5 itself. It needs nothing new from the server except presence.

For your feedback

## Questions

Answer by number if that’s easier.

1. Your message stopped at “The goal is to streamline, and th…”. What was the rest?
2. Should slop.computer later serve slop.boutique as well, with the storefront made of artifacts on routes for that host and reading a catalog API? Or does it stay our workshop and hand finished artifacts to francois with `releases push`?
3. Should only an admin be able to mark an artifact as a shell, served on slop.computer with API access, or do we trust anything either of us pushes?
4. In the first version, should Ramon be able to drive an agent from the browser (the server-side agent through Pi), or are Claude Code and comments enough to begin with?
5. A separate repository and `slop` binary with its own database, or a mode of the francois binary (`francois computer serve`) so one login and token work on both sites?
6. Postgres on the cluster, as francois runs, or SQLite on a volume? With two users SQLite would do, and `francois serve` already uses it.
7. Which direction, or which pieces of each? Does the project stage match what you meant by seeing artifacts in a session or project?
8. new One data artifact per collection (every post a file in `journal`), or one artifact per post? I lean to the collection: a post is a file, history is per collection, and one push can publish several posts.
9. new Static export: render pages in headless Chromium, which works for any page but needs a browser on the server, or ask pages for a pure `render(data)` function, which is fast and repeatable, the way the Boutique Workbench renders its views on the server?
10. new Is a session one Claude Code conversation, started and ended on purpose, or simply the turns of one day in one project?
11. new Should Shop Next’s projects (code, content, samples, assets, system, versions) be stored here as they are, so Shop can save to slop.computer instead of one browser?

Read for this brainstorm:

- [go-go-golems/francois](https://github.com/go-go-golems/francois) at `ca05239`: README, `doc/production.md`, catalog migrations, `routes.go`, the hosted runtime, the MCP server, tickets FRANCOIS-015, -018 and -023
- [slop.boutique](https://slop.boutique/) as of 28 October 2026
- Trellis production build plan and Trellis prototype (attached)
- CC5 Godprompt Computer bundle, Ramon’s CC5 with Spore (attached)
- Boutique Workbench bundle (attached)
- Shop Next 1.0.0, Ramon’s (attached): projects, data and library, the stage, the strip of turns, products that carry their own studio