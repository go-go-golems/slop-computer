.PHONY: lint fmt-check test test-postgres build web generate run-local dev-backend dev-frontend

lint:
	GOWORK=off golangci-lint run -v

fmt-check:
	GOWORK=off golangci-lint fmt --diff

test:
	GOWORK=off go test ./...

# Runs the store and server tests against Postgres as well as SQLite.
test-postgres:
	TEST_DATABASE_URL=$${TEST_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable} GOWORK=off go test ./...

# Builds the Workshop into pkg/web/workshop (served from disk by plain builds).
web generate:
	GOWORK=off go generate ./pkg/web

# The slop binary with the Workshop inside.
build: generate
	GOWORK=off go build -tags embed -o slop ./cmd/slop

run-local:
	GOWORK=off go run ./cmd/slop serve --local

# Workshop development: the server on :8080, Vite with HMR on :5173
# (open http://localhost:5173; API calls are proxied to :8080).
dev-backend:
	GOWORK=off go run ./cmd/slop serve --local --dev-origin http://localhost:5173

dev-frontend:
	cd web/workshop && pnpm install && pnpm dev
