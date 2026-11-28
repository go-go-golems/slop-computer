# Running slop in production

This guide moved into the binary: `slop help server-configuration`
(`pkg/doc/topics/60-server-configuration.md`) covers `slop serve`, every
`slop.yaml` key, hosts, DNS and TLS, OIDC sign-in, health, Kubernetes, the
data directory, backups and upgrades. Models: `slop help llm-backend-pi` and
`slop help llm-access`. Every page: `slop help --all`.

The section below stays here because it uses this repository's scripts.

## Importing francois releases

The francois apps (slop.boutique's catalog) live in slop as one store per
app, plus the `catalog-data` store that every catalog view reads. Importing
a new release from francois brings both up to date. The scripts are in
`ttmp/2026/11/06/SLOP3-013-…/scripts/`. They use the slop CLI's login and
never print its token. They only read francois, through a read-only
database session and `kubectl exec … cat` of its blob volume.

```sh
D=ttmp/2026/11/06/SLOP3-013--*/scripts
bash $D/01-inventory.sh > inventory.json                     # francois's catalog, as JSON
python3 $D/03-import.py inventory.json --catalog             # dry run: what would change
python3 $D/03-import.py inventory.json --apply --catalog     # push the stores, then catalog-data
python3 $D/04-verify.py inventory.json https://apps.<domain> # trees, refs, grants, anonymous access
```

- **The dry run comes first.** It lists, store by store, the pushes and
  grant changes an apply would make, and the `catalog-data` updates.
  A second apply after a successful one writes nothing.
- **`--catalog` is needed on every import.** Without it, the stores get the
  new release, but the catalog views keep showing the previous one.
- **`--only id,id`** limits the run to some apps. With `--catalog`, apps
  that francois no longer lists are removed from `catalog-data` one by one.
  Without `--only`, the whole table is replaced at once.
- **`--history`** also writes older releases to refs named
  `francois/<version>`. It never writes withdrawn releases.
- **Free and paid.** A free app's store gets `@guest interact`. A paid
  app's store gets `@subscriber interact` and no `@guest` grant.
  `04-verify.py` checks this by opening each app as an anonymous visitor.
  It expects 200 for a free app and 401 for a paid one, and exits non-zero
  when any check fails.
