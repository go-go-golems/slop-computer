.PHONY: lint fmt-check test test-postgres build web generate run-local

lint:
	GOWORK=off golangci-lint run -v

fmt-check:
	GOWORK=off golangci-lint fmt --diff

test:
	GOWORK=off go test ./...

# Runs the store and server tests against Postgres as well as SQLite.
test-postgres:
	TEST_DATABASE_URL=$${TEST_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable} GOWORK=off go test ./...

web:
	cd web/workshop && pnpm install --frozen-lockfile && pnpm build

generate:
	GOWORK=off go generate ./...

build:
	GOWORK=off go build ./...

run-local:
	GOWORK=off go run ./cmd/slop serve --local
