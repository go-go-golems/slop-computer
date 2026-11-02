# Running slop in production

One binary, `slop`, is the server and the CLI. The back office and the page
runtime are embedded in it (`make build`, or the Docker image). All state is
one data directory:

| Path under `data` | What it holds |
| --- | --- |
| `system.db` | people, sessions, tokens, grants, mounts, bindings, apps, budgets, the system log |
| `stores/<id>/` | one SQLite database per store: documents, files and snapshots, refs, app tables |
| `blobs/` | file contents, content-addressed, shared by all stores |
| `secret.key` | the HMAC key for sandbox labels and secrets, generated on first start unless `secret_key_file` is set |

SQLite is reached through `mattn/go-sqlite3`, so the binary is built with cgo
(`CGO_ENABLED=1`; the Dockerfile builds and runs on Debian bookworm).

## Configuration

`slop serve --config slop.yaml`; `--listen`, `--data`, `--admin-email` and
`--llm` override the file. Without a file the server runs on
`*.localhost:18300` for development. Secrets are never in the file itself,
only paths to files that hold them.

```yaml
listen: 0.0.0.0:8080
data: /var/lib/slop
scheme: https                 # how browsers reach the hosts: secure (__Host-) cookies
hosts:
  main: slop.example          # back office, sign-in, /api/v1, device login
  live: [apps.slop.example]   # apps for visitors: the shell, sessions, guests
  static: [site.slop.example] # published files only, no sessions
  sandbox: sbx.slop.example   # s<label>.sbx.slop.example: one origin per store and app
trust_proxy_headers: true     # only when the server is reachable through the proxy alone
signup: approval              # new people wait for an admin; "open" (the default) makes them members
admin_emails: [admin@example.com]
oidc:
  issuer: https://auth.example.com
  client_id_file: /run/secrets/slop/oidc-client-id
  # client_secret_file: /run/secrets/slop/oidc-client-secret   (optional: PKCE is always used)
  scope: urn:zitadel:iam:org:id:<organization id>
# secret_key_file: /run/secrets/slop/secret-key   (optional: else data/secret.key)
# llm: pi                                         (sample through Pi's models; off by default)
# pi: {agent_dir: /var/lib/slop/pi, models: {quick: lunaroute/…, default: …}}
```

## Hosts, DNS and TLS

| Host | Serves | Who |
| --- | --- | --- |
| main | the back office (`/admin`), sign-in, `/api/v1`, device login for the CLI | admins, members, agents |
| live (repeatable) | mounted apps in the shell (`/b/<workspace>`, `/pub/<site>`), guests, share links | visitors |
| static (repeatable) | published snapshots of stores, no sessions | visitors |
| sandbox | `s<label>.<sandbox>`: each store and app runs on its own origin inside the shell's iframe | the shell's frames |

The sandbox needs a **wildcard DNS record and a wildcard certificate**
(`*.sbx.slop.example`, issued with an ACME DNS-01 challenge). The proxy must
pass the `Host` header through unchanged: the server picks the host's role
from it. Long-polls (`slop log wait`) and the shell's event stream need the
proxy not to buffer responses (Caddy: `flush_interval -1`).

Sandbox origins are same-site with the live host when both are subdomains of
one registrable domain. The server allows for that: a session cookie is
never sent with an unsafe cross-origin request to an actor route, and views
carry their own secret instead of cookies.

## Identity: ZITADEL (or any OIDC provider)

Register a **web application** in the ZITADEL project:

- **Redirect URI:** `https://<main>/auth/callback`
- **Post-logout redirect URI:** `https://<main>/`. Signing out on the main host
  ends ZITADEL's browser session too (RP-initiated logout with the ID token
  as `id_token_hint`), so the next sign-in asks again and another account can
  sign in.
- **Authentication method:** PKCE. A client secret is optional
  (`client_secret_file`).
- **Organization:** `oidc.scope: urn:zitadel:iam:org:id:<organization id>`
  limits sign-in to that organization's users. The organization id is not a
  secret: it appears in every authorize URL.

The live hosts never talk to ZITADEL: their sign-in hands off to the main
host (`/_site/login` → `/auth/login` → ZITADEL → `/auth/callback` →
`/auth/handoff` → back to the live host), so only the main host's callback is
registered.

A sign-in needs a **verified email address**. ZITADEL may leave the profile
claims out of the ID token; the server then asks the userinfo endpoint. The
person is matched by email; the issuer and subject are recorded.

**The first admin** is whoever signs in with an address listed in
`admin_emails` (or `--admin-email`); that list can stay in place. With
`signup: approval`, everyone else waits until an admin lets them in from the
back office.

**Agents** use the CLI with a personal token: `slop auth login --server
https://<main>` approves a device code in the browser.

A token carries scopes, each including the ones before it:

| Scope | The token may |
| --- | --- |
| `read` | call verbs that change nothing; at most view on any store |
| `write` | call verbs that change things, with its person's own levels |
| `admin` | act with its person's admin role: admin-only verbs, admin on every store, pushing app code (D9). Expires within 90 days. |

Without `admin`, an admin's token acts as a member. Members can choose
`read` and `write`.

## Kubernetes

The deployment on the hetzner k3s cluster lives in the GitOps repository as
`gitops/kustomize/slop/`: one replica with `Recreate` (the data volume is
ReadWriteOnce and SQLite has one writer), the data volume at
`/var/lib/slop`, secrets from Vault (`kv/apps/slop/test/runtime`) mounted as
files, a DNS-01 certificate covering the main, live and static hosts and the
sandbox wildcard, and Traefik ingress for all of them. The image is
`ghcr.io/go-go-golems/slop-computer:sha-<short>`, published from `main` by
`.github/workflows/publish-image.yaml`; the deployment pins it by hand.

```yaml
args: [serve, --config=/etc/slop/slop.yaml, --listen=0.0.0.0:8080, --data=/var/lib/slop/v3]
```

with `slop.yaml` from a ConfigMap and the OIDC client id from the runtime
secret. The probes need no Host header: `/healthz` and `/readyz` answer on
the pod's address. A network policy must let the pod reach the identity
provider: when it resolves to the cluster's own address, that is the ingress
controller's port (francois's policy allows Traefik on 8443 for this
hairpin).

**Cutover from v2.** v3 imports nothing from v2: apps are pushed from their
sources (`make blocks-push pinup-push`, SLOP3-001's deploy scripts, the apps
in `apps/`). Pointing `--data` at a new directory on the same volume
(`/var/lib/slop/v3`) leaves v2's blobs and its Postgres database untouched,
so rolling back is redeploying the previous image. v2's `database-url`, the
Postgres bootstrap job and its secrets can go once v3 has settled.

## Health

- `GET /healthz`: the process is up.
- `GET /readyz`: `system.db` answers (503 otherwise).

Both answer on any host the server does not serve (a pod or container
address); every other path there gets 421.

## Models (the sample capability)

`llm: pi` serves `sample` through Pi's models on Geppetto. It reads Pi's
agent directory (`pi.agent_dir`, default `~/.pi/agent`: `auth.json`,
`models.json`, `settings.json`), so models and credentials are managed with
Pi on the server and never reach a database or a browser. `pi.models` pins
the tiers (`quick`, `default`, `complex`). Which apps may sample for which
audience is the policy matrix (`slop policy set <app> sample @member on`);
who has LLM access, with a monthly token budget, is `slop llm set`.

## Backups and upgrades

State is the data directory. Back it up with the server stopped, or as a
volume snapshot; blobs are content-addressed and never change, so an rsync of
new files is enough for them. `slop store export <id> --folder <dir>` exports
one store in a format people and agents can read and diff.

To upgrade: back up, replace the binary or image, restart. `system.db`'s
migrations run at start; an app's `sql/*.sql` migrations run in each of its
stores when they activate a new version of the app.
