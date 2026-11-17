package pages

// TypeScript and vendored packages in app pages (SLOP3-024, design §4.3 and
// §4.7). The routes that serve an app's pages (the static host, the
// sandbox, previews) pass writeStoreBytes an appCode. With it, a .ts or .tsx
// file is served compiled, <file>.map serves its source map, and every HTML
// page gets the import map of the app's vendored packages. Routes without
// an appCode (store files, uploads, actor routes) serve bytes as stored.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/tscompile"
)

// TsconfigFile is the tsconfig that governs how an app's page files
// compile (jsx, jsxImportSource, …). The actor's is tsconfig.actor.json.
const TsconfigFile = "tsconfig.json"

// appCode is what a page route knows about the snapshot it serves.
type appCode struct {
	st   *store.Store
	n    int64
	man  *apps.Manifest
	base string // the URL path of the app's root, ending in "/"; "" when unknown
}

// newAppCode is the appCode of a request whose path ends in rest (the
// file's path in the app). The app's root is the path before rest.
func newAppCode(st *store.Store, n int64, man *apps.Manifest, urlPath, rest string) *appCode {
	c := &appCode{st: st, n: n, man: man}
	if strings.HasSuffix(urlPath, rest) {
		if base := strings.TrimSuffix(urlPath, rest); strings.HasSuffix(base, "/") {
			c.base = base
		}
	}
	return c
}

// tsconfig is the snapshot's tsconfig.json (nil when it has none).
func (c *appCode) tsconfig(ctx context.Context) []byte {
	f, err := c.st.SnapshotFile(ctx, c.n, TsconfigFile)
	if err != nil {
		return nil
	}
	b, err := c.st.ReadFile(f)
	if err != nil {
		return nil
	}
	return b
}

// importMap is the <script type="importmap"> of the app's page imports,
// with paths resolved against the app's root ("" when there is nothing to
// map). Its digest goes into the ETag of a page that carries it.
func (c *appCode) importMap() (tag, digest string) {
	if c == nil || c.man == nil || c.man.Slop.Imports == nil || len(c.man.Slop.Imports.Page) == 0 || c.base == "" {
		return "", ""
	}
	imports := map[string]string{}
	for name, p := range c.man.Slop.Imports.Page {
		imports[name] = (&url.URL{Path: c.base + p}).EscapedPath()
	}
	raw, _ := json.Marshal(map[string]any{"imports": imports}) // escapes <, > and &: the data cannot close the script
	sum := sha256.Sum256(raw)
	return `<script type="importmap">` + string(raw) + `</script>`, hex.EncodeToString(sum[:6])
}

// codeBytes is what a page route serves for b in place of the stored bytes:
// a compiled .ts or .tsx, or an HTML page with the import map. ok is false
// when the stored bytes are served as they are.
func (s *Door) codeBytes(ctx context.Context, b storeBytes) (body []byte, etag, ctype string, ok bool) {
	c := b.code
	switch {
	case tscompile.Is(b.f.Path):
		src, err := b.st.ReadFile(b.f)
		if err != nil || !utf8.Valid(src) {
			return nil, "", "", false // not text: most likely a video (MPEG transport stream)
		}
		tsconfig := c.tsconfig(ctx)
		body := compiled(b.f.Path, src, tsconfig, false)
		return body, b.f.SHA256 + "." + tscompile.Version + "." + short(tsconfig), "text/javascript; charset=utf-8", true
	case strings.HasPrefix(b.f.Type, "text/html"):
		tag, digest := c.importMap()
		if tag == "" {
			return nil, "", "", false
		}
		page, err := b.st.ReadFile(b.f)
		if err != nil {
			return nil, "", "", false
		}
		return insertHead(page, []byte(tag)), b.f.SHA256 + ".im" + digest, b.f.Type, true
	}
	return nil, "", "", false
}

// compiled is a page file's JavaScript (or, for wantMap, its source map).
// A file that does not compile becomes a module that throws its errors.
func compiled(name string, src, tsconfig []byte, wantMap bool) []byte {
	out, err := tscompile.Compile(name, src, tscompile.Page, tsconfig)
	var cerr *tscompile.Error
	switch {
	case errors.As(err, &cerr) && wantMap:
		return []byte(`{"version":3,"sources":[],"mappings":""}`)
	case err != nil:
		return tscompile.ErrorModule(err)
	case wantMap:
		return out.Map
	}
	return out.Code
}

func short(b []byte) string {
	if b == nil {
		return "0"
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:6])
}

// serveSourceMap serves <file>.map for a compiled page file: name is the
// requested path, which the snapshot does not hold. It reports whether it
// answered.
func (s *Door) serveSourceMap(w http.ResponseWriter, r *http.Request, b storeBytes, name string) bool {
	src := strings.TrimSuffix(name, ".map")
	if b.code == nil || src == name || !tscompile.Is(src) || s.trustedHost(r.Host) {
		return false
	}
	ctx := r.Context()
	f, err := b.code.st.SnapshotFile(ctx, b.code.n, src)
	if err != nil {
		return false
	}
	text, err := b.code.st.ReadFile(f)
	if err != nil || !utf8.Valid(text) {
		return false
	}
	tsconfig := b.code.tsconfig(ctx)
	b.f = f
	s.writeDerived(w, r, b, compiled(src, text, tsconfig, true), f.SHA256+".map."+tscompile.Version+"."+short(tsconfig), "application/json")
	return true
}

// writeDerived writes bytes computed from a store file, with the headers
// writeStoreBytes derives from the same facts.
func (s *Door) writeDerived(w http.ResponseWriter, r *http.Request, b storeBytes, body []byte, etag, ctype string) {
	h := w.Header()
	etag = `"` + etag + `"`
	h.Set("ETag", etag)
	h.Set("Cache-Control", b.cacheControl())
	h.Set("X-Content-Type-Options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", ctype)
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(body))
}
