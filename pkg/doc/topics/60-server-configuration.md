---
Title: "Running a slop server: slop serve, slop.yaml, hosts, sign-in and operations"
Slug: "server-configuration"
Short: "Every slop serve flag and slop.yaml key, the four hosts with DNS and TLS, OIDC (ZITADEL), Kubernetes, health probes, backups, upgrades and moving stores."
Topics:
- server
- configuration
- deployment
- operations
Commands:
- serve
- server
- store
- import
- llm
- policy
Flags:
- config
- listen
- data
- local
- test
- admin-email
- llm
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
One binary, `slop`, is both the server and the CLI. `slop serve` runs the
server: the back office, sign-in, the API, the page runtime and the actors are
all inside it, and all state lives in one data directory. This page covers how
to configure it, put it on the internet, and keep it running.

## slop serve

```bash
slop serve --config /etc/slop/slop.yaml
slop serve --local --llm fake --data ./data --admin-email you@example.com   # development
```

| Flag | Meaning |
| --- | --- |
| `--config <file>` | Read `slop.yaml`. Without it the server runs on `*.localhost:18300` for development. |
| `--listen <addr>` | Address to listen on (default `127.0.0.1:18300`). Overrides `listen`. |
| `--data <dir>` | Data directory (default `./data`). Overrides `data`. |
| `--admin-email <email>` | Whoever signs in with this address becomes admin. Repeatable; added to `admin_emails`. |
| `--llm pi\|fake` | Model backend. Overrides `llm`. Default: none, so model calls fail. |
| `--local` | A local sign-in form (any email, no password) instead of OIDC. **Development only.** |
| `--test` | Uses the fake model backend unless `--llm` says otherwise. |

The server speaks plain HTTP; TLS is the job of the proxy or ingress in front
of it. It stops cleanly on SIGINT or SIGTERM. At start it prints its hosts:

```text
slop serving on 127.0.0.1:18300
  main    http://slop.localhost:18300
  live    [apps.localhost:18300]
  static  [site.localhost:18300]
  sandbox *.sbx.localhost:18300
```

Without a configuration file, the hosts are derived from `--listen`'s port.
With `--config`, they come from the file; if the file names no `hosts`, they
are derived from the file's `listen` (or port 18300), **not** from
`--listen`. Set `hosts` explicitly in any file you use.

## slop.yaml

Every key the server reads. Secrets never go in the file itself, only paths
to files that hold them. Unknown keys are ignored without a warning, so check
spelling; a value of the wrong type stops the server
(`yaml: unmarshal errors`).

```yaml
listen: 0.0.0.0:8080
data: /var/lib/slop
scheme: https                   # how browsers reach the hosts: https gives secure (__Host-) cookies and HSTS
hosts:
  main: slop.example.com        # back office, sign-in, /api/v1, CLI device login
  live: [apps.example.com]      # mounted apps for visitors: the shell, guests, share links
  static: [site.example.com]    # published files only, no sessions
  sandbox: sbx.example.com      # s<label>.sbx.example.com: one origin per store and app
trust_proxy_headers: true       # read the client address from X-Forwarded-For
signup: approval                # new people wait for an admin; open (the default) makes them members
admin_emails: [admin@example.com]
guests_per_hour: 30             # new guests one address may create per hour (0: 30)
oidc:
  issuer: https://auth.example.com
  client_id_file: /run/secrets/slop/oidc-client-id
  client_secret_file: /run/secrets/slop/oidc-client-secret   # optional: PKCE is always used
  scope: urn:zitadel:iam:org:id:123456789                     # extra scopes, space-separated
stripe:
  secret_key_file: /run/secrets/slop/stripe-key
  webhook_secret_file: /run/secrets/slop/stripe-webhook       # one or more secrets, whitespace-separated (rotation)
  prices: [price_123]
  trials: false
secret_key_file: /run/secrets/slop/secret-key                 # optional: else <data>/secret.key
llm: pi                                                        # pi, fake, or empty (off)
pi:
  agent_dir: /var/lib/slop/pi
  models: { quick: lunaroute/small, default: lunaroute/medium, complex: lunaroute/large:high, vision: lunaroute/deepseek-4.1-flash }
actors:
  runtime: engine               # the only runtime; "direct" was removed
local: false
test: false
```

| Key | Default | Meaning |
| --- | --- | --- |
| `listen` | `127.0.0.1:18300` | Address the HTTP server binds |
| `data` | `data` | The data directory |
| `scheme` | `http` | `https` when browsers reach the hosts over TLS: cookies get `Secure` and the `__Host-` prefix, responses on main and live get HSTS |
| `hosts.main` | `slop.localhost:<port>` | The main host |
| `hosts.live` | `[apps.localhost:<port>]` | Live hosts (a list) |
| `hosts.static` | `[site.localhost:<port>]` | Static hosts (a list) |
| `hosts.sandbox` | `sbx.localhost:<port>` | The sandbox suffix |
| `trust_proxy_headers` | `false` | Take the client address from `X-Forwarded-For` (guest limits use it). Only when the proxy is the only way in. |
| `signup` | `open` | `open`: a new person is a member at once. `approval`: they are `pending` until an admin sets their role (`slop people role usr_… member`; `people role` takes the id, not the email). |
| `admin_emails` | none | These addresses become admin when they sign in |
| `guests_per_hour` | 30 | New guest identities one client address may create per hour |
| `local` | `false` | The local sign-in form; never on a reachable server |
| `test` | `false` | Defaults `llm` to `fake` |
| `oidc.*` | none | The sign-in provider (below). Without `issuer` (and without `local`) nobody can sign in. |
| `stripe.*` | none | Subscriptions through Stripe Checkout; off without `secret_key_file`. A `sk_live_`/`rk_live_` key is live mode. The webhook is `POST https://<main>/webhooks/stripe`. |
| `secret_key_file` | `<data>/secret.key` | HMAC key for sandbox labels and app secrets, at least 16 bytes. Generated on first start when unset. |
| `llm` | empty | `pi` (Pi's models through Geppetto) or `fake`; empty disables model calls |
| `pi.agent_dir`, `pi.models` | `~/.pi/agent`, Pi's default model | See `slop help llm-backend-pi` |
| `actors.runtime` | `engine` | Only `engine` is accepted |

**Keep the secret key.** Sandbox origins and encrypted app secrets derive
from it. A new key gives every store a new sandbox origin (pages lose what
they kept in browser storage) and makes stored app secrets unreadable. If
`secret_key_file` is set but missing or shorter than 16 bytes, the server
refuses to start.

## Hosts, DNS and TLS

The server picks a request's role from its `Host` header, so each role needs
its own name:

| Host | Serves | Who |
| --- | --- | --- |
| main | back office (`/admin`), sign-in, `/api/v1`, MCP, device login for the CLI | admins, members, agents |
| live (one or more) | mounted apps in the shell, guests, share links | visitors |
| static (one or more) | published snapshots of stores, no sessions | visitors |
| sandbox | `s<label>.<sandbox>`: each store's pages on their own origin, inside the shell's frame | the shell's frames |

What the network in front must do:

- **DNS:** a record for main, each live and static host, and a **wildcard**
  for the sandbox (`*.sbx.example.com`).
- **TLS:** certificates for the same names, including a
  **wildcard certificate** for the sandbox (ACME needs the DNS-01 challenge for a
  wildcard). Then set `scheme: https`.
- **Pass `Host` through unchanged.** A request whose host matches no
  configured host gets `421 unknown host …`.
- **Do not buffer responses.** Model answers, agent session events, the
  shell's event stream and `slop log wait` are streams or long polls (Caddy:
  `flush_interval -1`; nginx: `proxy_buffering off`, and the server already
  sends `X-Accel-Buffering: no` on model streams). Allow long-lived
  connections: every open agent session holds one.
- Host names match exactly, port included (`apps.localhost:18300` is not
  `apps.localhost`).

`slop server hosts` prints the hosts a running server uses.

## Sign-in: OIDC (ZITADEL)

Register a **web application** in the provider:

- **Redirect URI:** `https://<main>/auth/callback`.
- **Post-logout redirect URI:** `https://<main>/`. Signing out ends the
  provider's browser session too, so another account can sign in next.
- **Authentication:** PKCE. A client secret is optional
  (`oidc.client_secret_file`).
- **ZITADEL organisation:** `oidc.scope: urn:zitadel:iam:org:id:<id>` limits
  sign-in to that organisation's users. The id is not a secret.

Live hosts never talk to the provider: their sign-in hands off to the main
host, so only the main host's callback is registered. A sign-in needs a
**verified email**; the person is matched by email. The server discovers the
provider lazily, so it starts (and existing sessions keep working) while the
provider is down. A missing `client_id_file` stops the server at start.

The **first admin** is whoever signs in with an address in `admin_emails`.
With `signup: approval`, everyone else waits until an admin lets them in.

**Agents** sign in with the CLI: `slop auth login --server https://<main>`
shows a device code that a person approves in the browser. A token with the
`admin` scope expires within 90 days.

## Models

`llm: pi` serves `sample` and `agent` through the models of a Pi agent
directory; `slop help llm-backend-pi` covers the files, tiers and
credentials. Check it after a start:

```bash
slop sample run "Say hi"     # as an admin: @admin has LLM access on a new server
```

The log shows `Pi models ready (Geppetto): N` at start. Then give access:
`slop policy set <app> sample @member on` and `slop llm set @member on
--budget …` (`slop help llm-access`).

## Health

| Path | Answer |
| --- | --- |
| `GET /healthz` | `ok`: the process is up |
| `GET /readyz` | `{"ok":true}` when `system.db` answers, else 503 |

Both answer on the main host and on any address the server does not serve
(a pod IP, `127.0.0.1:8080`), so probes need no `Host` header. Every other
path on an unknown host gets 421.

## Kubernetes

- **One replica, `strategy: Recreate`.** SQLite has one writer and the data
  volume is `ReadWriteOnce`.
- **A persistent volume** for `data` (for example at `/var/lib/slop`).
- **Configuration** from a ConfigMap (`slop.yaml`), **secrets** as files
  (OIDC client id, secret key, Stripe keys, the Pi credentials), mounted
  read-only.
- **Ingress** for main, live, static and `*.<sandbox>`, with a certificate
  that covers the sandbox wildcard (DNS-01).
- **Probes** on `/healthz` (liveness) and `/readyz` (readiness), on the
  container port.
- **Network policy:** the pod must reach the identity provider and the model
  providers. When the provider resolves to the cluster's own ingress, allow
  that hairpin path explicitly.

```yaml
containers:
- name: slop
  image: ghcr.io/go-go-golems/slop-computer:sha-<short>
  args: [serve, --config=/etc/slop/slop.yaml, --listen=0.0.0.0:8080, --data=/var/lib/slop]
  ports: [{containerPort: 8080}]
  livenessProbe: {httpGet: {path: /healthz, port: 8080}}
  readinessProbe: {httpGet: {path: /readyz, port: 8080}}
  volumeMounts:
  - {name: data, mountPath: /var/lib/slop}
  - {name: config, mountPath: /etc/slop, readOnly: true}
  - {name: secrets, mountPath: /run/secrets/slop, readOnly: true}
```

The binary is built with cgo (SQLite through `mattn/go-sqlite3`), so use the
published image or a glibc base.

## The data directory, backups and upgrades

| Path under `data` | Holds |
| --- | --- |
| `system.db` | people, sessions, tokens, grants, mounts, policy, LLM access and usage, the platform log |
| `stores/<id>/` | one SQLite database per store: documents, files and snapshots, refs, app tables |
| `blobs/` | file contents, content-addressed, shared by all stores |
| `agent/` | agent sessions: `sessions.db`, `turns.db`, `timeline.db` |
| `secret.key` | the generated HMAC key, unless `secret_key_file` is set |

**Back up** the whole directory with the server stopped, or as a volume
snapshot: the databases run in WAL mode, so copying live files can catch them
mid-write. Blobs never change once written, so an rsync of new files is
enough for `blobs/`. Keep the secret key with the backup.

**Upgrade:** back up, replace the binary or image, restart. `system.db`'s
migrations run at start; an app's `sql/*.sql` migrations run in each of its
stores when they activate a new version of the app. To roll back, restore
the backup and run the previous binary.

## Moving stores between servers

`slop store export <id> --folder <dir>` writes a store's current state in a
readable folder format (`store.json`, `docs.jsonl`, `schema.sql`, `tree/`,
`assets/`, `tables/`); `slop import folder <dir> [--store <new id>]` makes a
new store from it on another server (or the same one).

```bash
slop store export pinboard --folder ./pinboard-export
slop --server https://slop.other.example import folder ./pinboard-export
```

The import is one snapshot of the current tree (history and older refs stay
behind). Grants, mounts, policy cells, secrets and LLM rows live in
`system.db`, not in the store: set them again on the new server. To move a
whole server, copy its data directory instead.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `421 unknown host …` | The `Host` header matches no configured host (proxy rewrote it, or the port differs) | Pass `Host` through; list the exact names (with port, if any) under `hosts` |
| Hosts show port 18300 although you passed `--listen` | With `--config`, hosts come from the file | Set `hosts` in the file |
| The sign-in page says it signs in with its OIDC provider, but nothing happens | `oidc.issuer` is empty and `local` is off | Configure `oidc`, or `--local` for development |
| `oidc client_id_file: …` at start | The file is missing or unreadable | Mount the secret; check the path |
| New people cannot do anything | `signup: approval`: they are `pending` | `slop people ls` for their id, then `slop people role usr_… member` |
| Pages lost their saved state after a redeploy | The secret key changed, so sandbox origins changed | Keep `secret_key_file` (or `<data>/secret.key`) across deploys |
| `secret key file …: missing or shorter than 16 bytes` | `secret_key_file` points at a bad file | Write at least 16 random bytes into it |
| Model answers arrive all at once, or agent sessions stall | The proxy buffers responses or cuts long connections | Turn buffering off; raise idle timeouts |
| A setting in `slop.yaml` has no effect | The key is misspelled (unknown keys are ignored) | Compare with the key table above |
| `actors.runtime: direct was removed` | An old configuration | Remove the key or set `engine` |
| `unknown llm "…" (pi or fake)` | Bad `llm` value | Use `pi`, `fake`, or leave it empty |
| `/readyz` answers 503 | `system.db` is unreadable (disk, permissions) | Check the volume and the server log |

## See Also

- `slop help llm-backend-pi` — the Pi agent directory, tiers and credentials
- `slop help llm-access` — who may spend, budgets
- `slop help access-control` — people, roles, grants, policy
- `slop help deploying-apps` — stores, pushes, mounts on a running server
- `slop help agent-quickstart` — logging in from the CLI
