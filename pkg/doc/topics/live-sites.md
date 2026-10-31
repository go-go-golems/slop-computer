---
Title: "Live sites: apps with their data on a site host, and who may open them"
Slug: live-sites
Short: Run an app live on a site route, let signed-in people and guests open it, make instances from the URL, share by link, and see who has access.
Topics:
- runtime
- routes
- sites
- access
Commands:
- route
- access
IsTemplate: false
IsTopLevel: true
ShowPerDefault: true
SectionType: GeneralTopic
---

A route on a site host usually serves a static page. A **live** route runs an
app instead: the site serves a small shell, the shell opens a view for
whoever is on the site, and the app runs on its target's own origin with its
real database, room and people. The app itself does not change; it is the
same `window.claude` runtime the Workshop's `/run` gives it.

```sh
slop route set /blocks/team blocks --bind target=ws-team --live --access signed-in
slop access grant ws-team '*signed-in' interact
```

## Who gets in

Two things decide what someone sees on a live route:

1. **The route's access** says who may try at all:
   `admins`, `signed-in` (members and admins) or `public` (anyone, including
   guests who are not signed in).
2. **Their level on the target** says what they get: the highest of what
   their role, authorship and grants give them.

| Who | Level |
|---|---|
| an admin | admin on every target; owner of what they created |
| a member | what grants give, at most admin; owner of what they created |
| a guest | what grants to `*anyone` or a share link give, at most interact |
| pending, disabled | nothing |

Without a level, the shell says "You do not have access to this".

People sign in on the site with **Sign in** in the shell's bar. The main
host signs them in (if it has to) and hands them back with a one-time code.
The site keeps its own session cookie.

A **member** is a person who was let in without being an admin: they open
what is shared with them on sites, and they do not use the Workshop. Set it
in Admin ▸ People (*Let in as member*), or on the server with
`slop db users member --user-id usr_…`.

## Grants

```sh
slop access ls ws-team                         # owner, grants, links, open views, live URLs
slop access grant ws-team '*signed-in' view    # everyone signed in may view
slop access grant ws-team '*anyone' interact   # guests too, and they may edit
slop access grant ws-team usr_02657c47 admin   # one person
slop access revoke ws-team '*anyone'
```

Subjects are a person (`usr_…`, see Admin ▸ People or `slop db users list`), `*signed-in` or
`*anyone`. A change applies at once: open views whose level changed close
and reopen at the new level.

What each level may do inside the app follows the app's db rules
(`view` < `interact` < `admin` < `owner`). Some capabilities also depend on
who it is, whatever the level:

| Capability | guest | member | admin |
|---|---|---|---|
| `db`, `user`, `room`, `downloads` | yes | yes | yes |
| `assets` | no | interact and up | yes |
| `comments` | no | yes | yes |
| `sample`, `artifact` (publish), `slop` | no | no | yes |

Models (`sample`) spend the server's credentials, so they stay with admins.

## Instances from the URL

A route can name its target in the path. Any data artifact of the app then
opens at its own URL, and nothing else does:

```sh
slop route set /blocks/:db blocks --bind 'target={db}' --live --access signed-in --create signed-in
```

- `/blocks/ws-team` opens `ws-team` (if it is Blocks data).
- On an address with nothing behind it (`/blocks/new`), the shell offers
  **Create a new one** to whoever `--create` admits (`signed-in` or
  `admins`). The new instance gets a random id (`i-…`); its creator owns it.
- A member creates at most 50 instances a day. Guests never create.

## Share links

```sh
slop access link ws-team --level interact --days 7
slop access unlink ws-team lnk_a9fd7d5ff79691ef
```

The link is the route's URL with `?k=…`, shown once. Whoever opens it (and is
let in by the route's access) gets the link's level as a grant, listed as
"by share link". A link never lowers what someone already has. The shell
takes the token out of the address bar after using it, and keeps it through
sign-in. Revoking a link takes the grants it gave away again.

Owners do the same from the site: the shell's **Share** button (for the
target's owner and for admins) sets view or edit for everyone signed in or
for anyone, makes and revokes links, and removes people. Admin and owner
grants stay in the Workshop.

## Guests

On a `public` route that `*anyone` or a link lets in, someone who is not
signed in becomes a **guest**: an id `vis_…` and a site cookie. Apps see
`user.id()` as that id, the name "Guest" and `guest: true`; private paths
(`data/users/<id>/…`) and `{self}` rules work for them.

- One address makes at most 30 guests an hour; anyone opens at most 120
  views an hour.
- Guests unseen for 90 days are deleted, with their grants and private
  documents.
- A guest who signs in is asked whether to keep what they did as a guest
  (their private documents and grants). Nothing moves without a yes.

## The rest of the site

A host with a live route serves its other pages with a CSP `sandbox` (an
opaque origin), so no page there can use a visitor's site session. Explicit
`/_d/`, `/_r/` and `/_v/` URLs still work. Relative files do not: a
sandboxed page sends no `Referer`, so `style.css` from `/` or from
`/r/weft` no longer finds its page. `localStorage` becomes memory-only.

Give live apps a site host of their own (another `--site-host`), and keep
static pages and releases on a host without live routes.

## In the Workshop

The **Access** tab on an app's data (Watch) shows the same as `slop access
ls`: the live URLs, who may open it, share links, and who has it open now,
with controls for each. **Open live** opens the first live URL. In Routes, a
route's **Runs** switch makes it live; **New ones** sets who may create.

## See also

- `slop help runtime`: apps, targets and their data.
- `slop help site-pages`: static pages on site hosts.
