# slop v3: one binary (server + CLI). The back office and the page runtime
# are committed and embedded (go:embed), so there is no web build stage.
# SQLite (mattn/go-sqlite3) needs cgo: the builder and the runtime image
# are both Debian bookworm, so the binary finds the glibc it was linked with.
FROM golang:1.26.10-bookworm AS server
WORKDIR /src
ENV GOWORK=off CGO_ENABLED=1
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags "-s -w" -o /out/slop ./cmd/slop

FROM debian:bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="slop" \
      org.opencontainers.image.description="slop v3: a computer made of stores" \
      org.opencontainers.image.source="https://github.com/go-go-golems/slop-computer" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 slop && mkdir -p /var/lib/slop && chown -R slop /var/lib/slop
COPY --from=server /out/slop /usr/local/bin/slop
USER slop
WORKDIR /var/lib/slop
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["slop"]
# system.db, one store.db per store and the blobs live under --data; the
# hosts, OIDC and secrets come from --config (doc/production.md).
CMD ["serve", "--listen", "0.0.0.0:8080", "--data", "/var/lib/slop"]
