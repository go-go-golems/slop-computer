// Package web holds the Workshop's production build (web/workshop, React +
// RTK Query) for the server to serve under /static/workshop/.
//
// `go generate ./pkg/web` runs `pnpm build` in web/workshop and copies dist/
// into pkg/web/workshop. Binaries built with `-tags embed` (make build) carry
// it inside; other builds read pkg/web/workshop from disk when it exists, so
// `go run ./cmd/slop serve` works after a generate. Without either, Workshop
// is nil and the main host shows a placeholder.
package web

//go:generate go run generate_build.go
