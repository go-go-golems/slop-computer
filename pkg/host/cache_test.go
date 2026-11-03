package host

// The Cache-Control values the page door sends (pkg/doors/pages/site.go),
// spelled out: the tests check the wire, not the constants.
const (
	cacheImmutable = "public, max-age=31536000, immutable"
	cacheMoving    = "public, max-age=60, stale-while-revalidate=600"
	cachePrivate   = "private, no-cache"
)
