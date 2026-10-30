// Package render prepares a page version for serving: it injects the boot
// data and the runtime that defines window.slop, the preview bridge in
// previews, and the CSS variables of a bound tokens artifact. It is the
// server side of the Workshop prototype's render.js doc().
package render

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/records"
)

//go:embed assets/*.js
var Assets embed.FS

// Modes a page is served in.
const (
	ModeSite    = "site"    // a visitor on a site host
	ModePreview = "preview" // a Workshop preview: bridge for picking and pins
	ModeThumb   = "thumb"   // a Workshop thumbnail: bridge, no clicks, slowed timers
	ModeApp     = "app"     // an app on its target's origin: claude.js, calls with a view secret
	ModeStatic  = "static"  // an app read-only from a saved db.json (players): claude.js
)

// Boot is what a page reads as window.slop.
type Boot struct {
	Route RouteInfo `json:"route"`
	// Data is each binding's records: a DataRef to a data version, loaded
	// as a cacheable script (/_r/<artifact>/<n>.js), or the records inline
	// when they belong to this request (the site index).
	Data         map[string]any  `json:"data"`
	Record       string          `json:"record,omitempty"`
	Version      VersionInfo     `json:"version"`
	Mode         string          `json:"mode"`
	Tokens       *records.Tokens `json:"tokens,omitempty"`
	ParentOrigin string          `json:"parentOrigin,omitempty"`
	// Runtime configures claude.js: the capabilities this app declares and,
	// in static mode, the saved documents.
	Runtime *Runtime `json:"runtime,omitempty"`
}

// DataRef names a data version's records: "<artifact>@<n>". Its script
// /_r/<artifact>/<n>.js calls slop.records(ref, rows) before the page runs.
type DataRef string

// NewDataRef is the DataRef of artifact at version n.
func NewDataRef(artifact string, n int) DataRef { return DataRef(artifact + "@" + strconv.Itoa(n)) }

// Script is the URL of the ref's records script.
func (d DataRef) Script() string {
	a, n, _ := strings.Cut(string(d), "@")
	return "/_r/" + a + "/" + n + ".js"
}

// RecordsScript is the body of a DataRef's script: slop.records(ref, rows).
// "<" is escaped so no record can close a script element.
func RecordsScript(ref DataRef, rows []records.Record) []byte {
	if rows == nil {
		rows = []records.Record{}
	}
	key, _ := json.Marshal(string(ref))
	raw, _ := json.Marshal(rows)
	raw = bytes.ReplaceAll(raw, []byte("<"), []byte(`\u003c`))
	out := make([]byte, 0, len(raw)+len(key)+20)
	out = append(out, "slop.records("...)
	out = append(out, key...)
	out = append(out, ',')
	out = append(out, raw...)
	return append(out, ");\n"...)
}

// Runtime is what claude.js needs before the shell hands it a view.
type Runtime struct {
	Target  string          `json:"target"`
	App     string          `json:"app"`
	Version int             `json:"version"`
	Caps    map[string]any  `json:"caps"`
	Docs    json.RawMessage `json:"docs,omitempty"` // static mode: {path: body}
}

type RouteInfo struct {
	Host   string            `json:"host,omitempty"`
	Path   string            `json:"path,omitempty"`
	Params map[string]string `json:"params"`
}

type VersionInfo struct {
	Artifact string `json:"artifact"`
	N        int    `json:"n"`
}

// AssetHash is the short content hash of an embedded asset ("" when there is
// none); AssetURL names the asset with it, so the URL is a content URL.
func AssetHash(name string) string {
	assetHashes.once.Do(func() {
		assetHashes.m = map[string]string{}
		entries, _ := fs.ReadDir(Assets, "assets")
		for _, e := range entries {
			if b, err := fs.ReadFile(Assets, "assets/"+e.Name()); err == nil {
				sum := sha256.Sum256(b)
				assetHashes.m[e.Name()] = hex.EncodeToString(sum[:])[:12]
			}
		}
	})
	return assetHashes.m[name]
}

// AssetURL is /_slop/<name>?h=<hash>.
func AssetURL(name string) string { return "/_slop/" + name + "?h=" + AssetHash(name) }

var assetHashes struct {
	once sync.Once
	m    map[string]string
}

var (
	headOpen  = regexp.MustCompile(`(?i)<head(\s[^>]*)?>`)
	headClose = regexp.MustCompile(`(?i)</head\s*>`)
	doctype   = regexp.MustCompile(`(?i)^\s*<!doctype[^>]*>`)
)

// Inject adds the boot data, runtime, bridge (previews) and tokens CSS to a
// page's HTML.
func Inject(page []byte, boot Boot) []byte {
	raw, _ := json.Marshal(boot)
	// Escape "<" so the JSON cannot close its script element.
	raw = bytes.ReplaceAll(raw, []byte("<"), []byte(`\u003c`)) // json.Marshal does too; kept explicit
	var head bytes.Buffer
	head.WriteString(`<script type="application/json" id="slop-boot">`)
	head.Write(raw)
	head.WriteString(`</script><script src="` + AssetURL("runtime.js") + `"></script>`)
	// Data versions never change: their records are scripts the browser
	// keeps, run in order before the page's own scripts (slop.data.x.all
	// stays synchronous).
	names := make([]string, 0, len(boot.Data))
	for name := range boot.Data {
		names = append(names, name)
	}
	sort.Strings(names)
	seen := map[DataRef]bool{}
	for _, name := range names {
		if ref, ok := boot.Data[name].(DataRef); ok && !seen[ref] {
			seen[ref] = true
			head.WriteString(`<script src="` + ref.Script() + `"></script>`)
		}
	}
	// claude.js is the first script a page runs anywhere but the public site,
	// so window.claude.use exists (and resolves null where nothing is served).
	if boot.Mode != ModeSite || boot.Runtime != nil {
		head.WriteString(`<script src="` + AssetURL("claude.js") + `"></script>`)
	}
	switch boot.Mode {
	case ModePreview, ModeThumb:
		head.WriteString(`<script src="` + AssetURL("bridge.js") + `"></script>`)
	}
	tail := ""
	if boot.Tokens != nil {
		// Tokens.CSS skips names and values containing < ; { }, so the text
		// cannot leave the style element.
		tail = `<style data-slop="tokens">` + boot.Tokens.CSS() + `</style>`
	}
	out := page
	if loc := headOpen.FindIndex(out); loc != nil {
		out = append(append(append([]byte{}, out[:loc[1]]...), head.Bytes()...), out[loc[1]:]...)
	} else if loc := doctype.FindIndex(out); loc != nil {
		out = append(append(append([]byte{}, out[:loc[1]]...), head.Bytes()...), out[loc[1]:]...)
	} else {
		out = append(head.Bytes(), out...)
	}
	if tail != "" {
		if loc := headClose.FindIndex(out); loc != nil {
			out = append(append(append([]byte{}, out[:loc[0]]...), tail...), out[loc[0]:]...)
		} else {
			out = append(out, tail...)
		}
	}
	return out
}
