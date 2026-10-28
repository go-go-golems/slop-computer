# slop.computer: one static binary (server + CLI) with the Workshop embedded.
FROM node:24-bookworm-slim AS web
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /src/web/workshop
COPY web/workshop/package.json web/workshop/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/workshop ./
RUN pnpm build

FROM golang:1.26.10 AS server
WORKDIR /src
ENV GOWORK=off CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/workshop/dist ./pkg/web/workshop
RUN find pkg/web/workshop -name '*.map' -delete \
 && go build -trimpath -tags embed -ldflags "-s -w" -o /out/slop ./cmd/slop

FROM debian:bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="slop" \
      org.opencontainers.image.description="slop.computer: artifacts, versions, routes and the Workshop" \
      org.opencontainers.image.source="https://github.com/go-go-golems/slop-computer" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 slop && mkdir -p /var/lib/slop/blobs && chown -R slop /var/lib/slop
COPY --from=server /out/slop /usr/local/bin/slop
USER slop
WORKDIR /var/lib/slop
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["slop"]
CMD ["serve", "--listen", "0.0.0.0:8080", "--blobs", "/var/lib/slop/blobs"]
