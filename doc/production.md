# Running slop.computer in production

One binary, `slop`, is the server and the CLI. The Workshop is embedded in it
(`make build`, or the Docker image). Artifacts, versions, routes and comments
live in Postgres; file contents live in a blob directory. Nothing else is
stateful.

## The three kinds of host

| Host | Example | Serves | Who |
| --- | --- | --- | --- |
| Main host (`--public-url`) | `https://slop.computer` | the Workshop, sign-in, `/api`, safe mode `/_/` | admins |
| Site hosts (`--site-host`, repeatable) | `https://slop.boutique` | pages through the route table | visitors |
| Sandbox domain (`--sandbox-domain`) | `https://s3f9….slop.run` | previews and tools, one origin per version | the Workshop's iframes |

The sandbox domain **must be a separate registrable domain** (not a subdomain
of the main host): every preview runs pushed code, and a separate site keeps
it away from the Workshop's cookies. Each preview origin is
`s<20 hex>.<sandbox domain>`, so it needs a **wildcard DNS record and a
wildcard TLS certificate** (`*.slop.run`, issued with an ACME DNS-01
challenge).

## DNS and TLS

```
slop.computer      A/AAAA  → the reverse proxy
slop.boutique      A/AAAA  → the reverse proxy
*.slop.run         A/AAAA  → the reverse proxy   (wildcard; needs DNS-01 for its certificate)
```

Caddy, with a DNS provider plugin for the wildcard:

```caddyfile
slop.computer, slop.boutique {
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1          # /api/events and comments wait stream
	}
}
*.slop.run {
	tls {
		dns <provider> {env.DNS_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1
	}
}
```

The proxy must pass the `Host` header through unchanged (Caddy does): the
server picks the host class from it. Start the server with
`--trust-proxy-headers` when it is only reachable through the proxy, so rate
limits see client addresses from `X-Real-Ip` / `X-Forwarded-For`.

## Identity (ZITADEL or any OIDC provider)

Register a web application:

- redirect URI `https://slop.computer/auth/callback`
- post-logout redirect URI `https://slop.computer/`
- PKCE; a client secret is optional (`--oidc-client-secret-file`)

Everyone who signs in for the first time is **pending** and sees nothing
until an admin lets them in. Bootstrap the first admin directly in the
database after their first sign-in:

```
slop db users list --database-url-file /run/secrets/db-url
slop db users promote --user-id usr_… --database-url-file /run/secrets/db-url
```

## Running it

```
slop serve \
  --database-url-file /run/secrets/db-url \        # postgres://…
  --blobs /var/lib/slop/blobs \
  --listen 127.0.0.1:8080 \
  --public-url https://slop.computer \
  --site-host slop.boutique \
  --sandbox-domain slop.run \
  --oidc-issuer https://auth.example.com \
  --oidc-client-id 123456@slop \
  --trust-proxy-headers
```

Pending migrations are applied at start (`--no-migrate` to apply them
separately with `slop migrate`). The Docker image runs `slop serve --listen
0.0.0.0:8080 --blobs /var/lib/slop/blobs`; append the flags above as
arguments and mount `/var/lib/slop` as a volume.

```
docker run -d --name slop -p 127.0.0.1:8080:8080 -v slop-data:/var/lib/slop \
  -v /srv/secrets:/run/secrets:ro slop:dev serve --listen 0.0.0.0:8080 --blobs /var/lib/slop/blobs \
  --database-url-file /run/secrets/db-url --public-url https://slop.computer … 
```

`--local` refuses to start unless it listens on loopback with an http
loopback public URL: it has no authentication.

## Kubernetes

The test deployment on the hetzner k3s cluster (ticket SLOP-002) lives in the
GitOps repository as `gitops/kustomize/slop/`, cloned from francois's
package: one replica with `Recreate` (the blob volume is ReadWriteOnce), a
database on the shared Postgres created by a bootstrap Job, secrets from
Vault (`kv/apps/slop/prod/runtime`: `database-url`, `oidc-client-id`,
`zitadel-org-id`) mounted as files, a DNS-01 certificate covering the main
host, the site host and the sandbox wildcard, and Traefik ingress for all
three. The image is `ghcr.io/go-go-golems/slop-computer:sha-<short>`,
published from `main` by `.github/workflows/publish-image.yaml`.

```
slop serve --listen=0.0.0.0:8080 --blobs=/var/lib/slop/blobs \
  --database-url-file=/run/slop/database-url \
  --oidc-client-id-file=/run/slop/oidc-client-id \
  --oidc-issuer=https://zitadel.example --oidc-scope=urn:zitadel:iam:org:id:<org> \
  --public-url=https://slop.example --site-host=site.slop.example \
  --sandbox-domain=sbx.slop.example --trust-proxy-headers
```

A network policy must let the pod reach the identity provider: when it
resolves to the cluster's own address, that is the ingress controller's
port (francois's policy allows Traefik on 8443 for this hairpin).

## Health

- `GET /healthz` — the process is up.
- `GET /readyz` — the database answers (503 otherwise).

## What the server sends

- Main host: `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`; the
  Workshop page gets a CSP that allows only its own scripts and API and
  frames only `https://*.<sandbox domain>`.
- Site and sandbox hosts: `Content-Security-Policy: frame-ancestors` listing
  the main origins (the Workshop frames them), `Cache-Control: no-store` for
  pages, `immutable` for blobs.
- HTTPS deployments: `Strict-Transport-Security: max-age=31536000` on every
  host (without `includeSubDomains`).
- CORS only on `/api/*`, only for sandbox origins, never with credentials:
  tools call the API with a grant (`slg_…`), not with cookies.

## Backups and upgrades

State is the Postgres database plus the blob directory. Back up the database
first, then the blobs (blobs are content-addressed and never change, so an
rsync of new files is enough). Restoring an older database with newer blobs is
safe; the reverse is not.

To upgrade: back up, replace the binary or image, restart. Migrations run at
start.

## Blob garbage collection

Blobs no version references (aborted pushes) accumulate slowly. Remove them
from time to time:

```
slop db gc-blobs --database-url-file /run/secrets/db-url --blobs /var/lib/slop/blobs --dry-run
slop db gc-blobs --database-url-file /run/secrets/db-url --blobs /var/lib/slop/blobs
```

Unreferenced blobs younger than `--grace` (default 24h) are kept, because a
push uploads its blobs before it stores the version that uses them.

## When the Workshop is broken

`https://slop.computer/_/` (safe mode) is server-rendered and has no
JavaScript: point any route at another version, undo the last route change,
revoke tokens. `slop route undo /path` does the same from a terminal.

## Agents

Agents use the CLI with a personal token: `slop auth login --server
https://slop.computer` approves a device code in the browser. Tokens carry
`read`, `write` (and `admin` for user management); revoke them on Admin →
Tokens or in safe mode. Set `SLOP_VIA=agent` in an agent's environment so its
pushes are labelled as agent work (Claude Code is detected by itself).
