package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// servePreview serves an inspect preview (SLOP3-002): the snapshot of a
// preview row at the root of its own sandbox origin, p<label>, for the
// person who asked while they may still read the store. HTML gets the
// boot data and the pick-and-pin bridge; every response may be framed
// only by the tool that asked, and is never cached.
func (s *Server) servePreview(w http.ResponseWriter, r *http.Request, label string) {
	ctx := r.Context()
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	pv, err := s.Registry.PreviewByLabel(ctx, label)
	if err != nil {
		notFound(w)
		return
	}
	who := s.personAs(ctx, pv.Person, "preview")
	if who == nil {
		notFound(w)
		return
	}
	if d, _, err := s.Env.K.Access.Can(ctx, who, pv.Store, rt.LevelView, "previewing", true); err != nil || !d.OK {
		notFound(w)
		return
	}
	// frame-ancestors applies to every ancestor: the tool that asked, and
	// the shells (main, live hosts) that frame the tool.
	ancestors := []string{pv.Parent}
	for _, o := range s.frameOrigins() {
		if o != pv.Parent {
			ancestors = append(ancestors, o)
		}
	}
	h := w.Header()
	h.Set("Content-Security-Policy", "frame-ancestors "+strings.Join(ancestors, " "))
	h.Set("Referrer-Policy", "no-referrer")
	if r.URL.Path == "/_slop/bridge.js" {
		serveAsset(w, r)
		h.Set("Cache-Control", "private, no-store")
		return
	}
	st, err := s.Env.K.Store(ctx, pv.Store)
	if err != nil {
		notFound(w)
		return
	}
	man, _ := s.appManifest(ctx, st, pv.N)
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	switch {
	case name == "":
		name = man.Entry()
	case strings.HasSuffix(r.URL.Path, "/"):
		name += "/index.html"
	}
	f, err := st.SnapshotFile(ctx, pv.N, name)
	if err != nil && path.Ext(name) == "" {
		f, err = st.SnapshotFile(ctx, pv.N, name+"/index.html")
	}
	status := http.StatusOK
	if err != nil && man != nil && man.NotFound != "" {
		f, err = st.SnapshotFile(ctx, pv.N, man.NotFound)
		status = http.StatusNotFound
	}
	if err != nil {
		notFound(w)
		return
	}
	if !strings.HasPrefix(f.Type, "text/html") {
		s.writeStoreBytes(w, r, storeBytes{st: st, f: f, vis: private, mut: noStore})
		return
	}
	page, err := st.ReadFile(f)
	if err != nil {
		notFound(w)
		return
	}
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "private, no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(injectPreview(page, pv.Parent))
}

// injectPreview puts the preview's boot data, a claude stub (a preview has
// no view, so every capability is null) and the bridge first in the head.
func injectPreview(page []byte, parent string) []byte {
	raw, _ := json.Marshal(map[string]any{"mode": "preview", "parentOrigin": parent})
	// json.Marshal escapes <, > and & (as \u003c…), so the data cannot close the script.
	var head bytes.Buffer
	head.WriteString(`<script type="application/json" id="slop-boot">`)
	head.Write(raw)
	head.WriteString(`</script><script>window.claude=window.claude||{use:function(){return Promise.resolve(null)}}</script>`)
	head.WriteString(`<script src="` + assetURL("bridge.js") + `"></script>`)
	return insertHead(page, head.Bytes())
}
