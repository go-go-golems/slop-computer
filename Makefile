.PHONY: lint fmt-check test build run-local runtime runtime-test admin conformance blocks blocks-push pinup pinup-push

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

# The page runtime (window.claude): web/runtime → pkg/server/assets/claude.js,
# committed because the server embeds it.
runtime:
	cd web/runtime && pnpm install --frozen-lockfile && pnpm check && pnpm build

runtime-test:
	cd web/runtime && pnpm test

# The back office: web/admin → pkg/server/admin/{app.js,styles.css},
# committed because the server embeds them.
admin:
	cd web/admin && npm ci --no-audit --no-fund && node build.mjs

# The runtime conformance page on a running --local server, with the app
# pushed and mounted (see conformance/run.mjs); needs playwright on NODE_PATH.
conformance:
	node conformance/run.mjs $${CONFORMANCE_URL:-http://apps.localhost:18300/conformance}

# Claude Blocks (web/blocks) and Pinup (web/pinup) as app folders; the
# -push targets store them on the server you are logged in to (SLOP_SERVER).
blocks:
	web/blocks/build.sh

blocks-push: blocks
	$(SLOP) push web/blocks/dist --store blocks -m "Claude Blocks $$(git rev-parse --short HEAD)"

pinup:
	cd web/pinup/vendor && npm ci --no-audit --no-fund
	web/pinup/build-app.sh

pinup-push: pinup
	$(SLOP) push web/pinup/dist/app --store pinup -m "Pinup $$(git rev-parse --short HEAD)"
