// Package render prepares a page version for serving: it injects the boot
// data and the runtime that defines window.slop, the preview bridge in
// previews, and the CSS variables of a bound tokens artifact. It is the
// server side of the Workshop prototype's render.js doc().
package render

import (
	"bytes"
	"embed"
	"encoding/json"
	"regexp"

	"github.com/go-go-golems/slop-computer/pkg/records"
)

//go:embed assets/*.js
var Assets embed.FS

// Modes a page is served in.
const (
	ModeSite    = "site"    // a visitor on a site host
	ModePreview = "preview" // a Workshop preview: bridge for picking and pins
	ModeThumb   = "thumb"   // a Workshop thumbnail: bridge, no clicks, slowed timers
	ModeTool    = "tool"    // a tool open in the Workshop: tool.js, API calls with a grant
)

// Boot is what a page reads as window.slop.
type Boot struct {
	Route        RouteInfo                   `json:"route"`
	Data         map[string][]records.Record `json:"data"`
	Record       string                      `json:"record,omitempty"`
	Version      VersionInfo                 `json:"version"`
	Mode         string                      `json:"mode"`
	Tokens       *records.Tokens             `json:"tokens,omitempty"`
	ParentOrigin string                      `json:"parentOrigin,omitempty"`
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
	raw = bytes.ReplaceAll(raw, []byte("<"), []byte(`<`))
	var head bytes.Buffer
	head.WriteString(`<script type="application/json" id="slop-boot">`)
	head.Write(raw)
	head.WriteString(`</script><script src="/_slop/runtime.js"></script>`)
	switch boot.Mode {
	case ModePreview, ModeThumb:
		head.WriteString(`<script src="/_slop/bridge.js"></script>`)
	case ModeTool:
		head.WriteString(`<script src="/_slop/tool.js"></script>`)
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
