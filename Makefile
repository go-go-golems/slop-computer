.PHONY: lint fmt-check test build run-local runtime runtime-test admin conformance blocks blocks-push pinup pinup-push deploy-apps

SLOP ?= slop

lint:
	GOWORK=off golangci-lint run -v

fmt-check:
	GOWORK=off golangci-lint fmt --diff

test:
	GOWORK=off go test ./...

# The slop binary (server and CLI). SQLite needs cgo.
build:
	GOWORK=off CGO_ENABLED=1 go build -o slop ./cmd/slop

# A development server on *.localhost:18300 with the sign-in form instead of
# OIDC: slop.localhost (main), apps.localhost (live), site.localhost (static).
run-local:
	GOWORK=off go run ./cmd/slop serve --local

# Committed build outputs. The server embeds them, so `go build` needs no
# node; each output's first line stamps the hash of its sources, and
# TestBuildOutputsFresh (pkg/server) fails when a source changed without a
# rebuild.
#
# The page runtime (window.claude): web/runtime → pkg/server/assets/claude.js.
runtime:
	cd web/runtime && pnpm install --frozen-lockfile && pnpm check && pnpm build

runtime-test:
	cd web/runtime && pnpm test

# The back office: web/admin → pkg/server/admin/{app.js,styles.css} (built
# in, at /admin) and apps/backoffice/{app.js,styles.css} (the same UI as an
# app, at /office).
admin:
	cd web/admin && npm ci --no-audit --no-fund && node build.mjs && node build.mjs --app ../../apps/backoffice

# The runtime conformance page on a running --local server, with the app
# pushed and mounted (see web/runtime/conformance/run.mjs); needs playwright
# on NODE_PATH.
conformance:
	node web/runtime/conformance/run.mjs $${CONFORMANCE_URL:-http://apps.localhost:18300/conformance}

# Claude Blocks and Pinup (apps/upstream), unmodified Claude artifacts, as
# app folders; the -push targets store them on the server you are logged in
# to (SLOP_SERVER).
blocks:
	apps/upstream/blocks/build.sh

blocks-push: blocks
	$(SLOP) push apps/upstream/blocks/dist --store blocks -m "Claude Blocks $$(git rev-parse --short HEAD)"

pinup:
	cd apps/upstream/pinup/vendor && npm ci --no-audit --no-fund
	apps/upstream/pinup/build-app.sh

pinup-push: pinup
	$(SLOP) push apps/upstream/pinup/dist/app --store pinup -m "Pinup $$(git rev-parse --short HEAD)"

# Every app that ships with slop, Blocks and Pinup, and the examples, with
# their mounts, on the server you are logged in to (scripts/deploy-apps.sh).
deploy-apps: pinup
	scripts/deploy-apps.sh .
