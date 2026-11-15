# Reports

Publish HTML and Markdown reports on slop, private by default, and share each one with chosen people by link or grant. The design is in ticket SLOP3-020 (`ttmp/2026/11/11/SLOP3-020-…/design-doc/01-…`).

A report is a store of type `report` that carries its own page. One mount on the live host serves every report at `/r/<id>` to the people who hold a level on it: you, people you granted `view`, and anyone who opened one of its share links.

## Once per server

```sh
slop mount set --host apps.<domain> --path /r/:id --storeParam id --type report
slop store new reports-home
slop push apps/reports-home --store reports-home
slop mount set --host apps.<domain> --path /reports --store reports-home
```

`/reports` lists the reports you can open, by title. Only its owner can open it. Granting it `@member view` is safe, because each person sees only the reports they can open themselves.

## Publishing

Requires Python 3, `pandoc` for Markdown, and a `slop` CLI that is signed in (`slop auth login`). Set `SLOP` to use a particular binary.

```sh
scripts/reports/publish.py publish notes/q3.md                 # a new report, private
scripts/reports/publish.py publish notes/q3.md --link 7        # … and a view link that works 7 days
scripts/reports/publish.py publish notes/q3.md --id s-k3x9q0d2 # update that report in place
scripts/reports/publish.py publish page.html --grant usr_…     # an HTML page, viewable by one person
scripts/reports/publish.py publish site/ --grant-file friends.txt   # a directory with index.html
scripts/reports/publish.py link s-k3x9q0d2 --days 0            # another link, until revoked
scripts/reports/publish.py ls                                  # your reports, links and grants
```

- **Markdown** is rendered by pandoc into one page with `report.css`; local images are inlined, and TeX math (`$…$`, `$$…$$`) becomes MathML. Front matter's `title` becomes the title. Obsidian `[[wikilinks]]`, `![[embeds]]` and `> [!callouts]` are converted. Fenced `mermaid` blocks are drawn with mermaid from jsDelivr.
- **HTML** is published as it is. A directory is published whole (it needs an `index.html`). Scripts and fonts from CDNs work.
- **The title** comes from `--title`, the front matter, the first heading, `<title>`, or the file name, in that order. It is stored in `report/meta`, which only people with access can read. `app.json` says "Report", because slop's sign-in page shows the app title to anyone who opens `/r/<id>`, including people without access; `--show-title` puts the real title there instead.
- **Ids** are generated (`s-xxxxxxxx`) unless you pass `--id`, so a report's address cannot be guessed.

## Sharing and revoking

- A **link** (`--link DAYS`, or `link ID --days N`) gives view access to whoever opens it, including people without an account, who get a guest identity in that browser. They keep access after the link expires. Revoking the link (`slop link rm --id lnk_…`, or the Share dialog) removes access from everyone who used it.
- A **grant** (`--grant usr_…`) gives one signed-in person view access. They can find their user id with `slop whoami`. Remove it with `slop grant rm <store> usr_…`.
- `slop link ls --store <id>` shows how many people used each link.
- **Removing a report:** `slop store rm --id <id>`.

The script never reads or prints your token. A link's URL holds a secret, so it is printed once.

## Tests

```sh
python3 scripts/reports/test_publish.py
```
