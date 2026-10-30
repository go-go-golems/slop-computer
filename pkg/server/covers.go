package server

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Covers: the Workshop shows a page by an image a record gives it, not by
// running the page (a live thumbnail of a 10 MB app costs as much as opening
// it). Any record of a data artifact's main version that names a page
// ("page": "<id>") and has a cover ("cover": "<src>" or {"src": …}) gives
// that page its cover; the francois catalog does, for every release.

// listCovers answers GET /api/covers: page id → the cover as a main-host
// URL (/api/artifacts/<a>/versions/<n>/files/<path>, which takes ?w=). Only
// covers that are slop data files (/_d/…) that exist are listed. When
// several records name a page, the data artifact first by id wins.
func (s *Server) listCovers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	arts, err := s.Store.Artifacts(ctx, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	sort.Slice(arts, func(i, j int) bool { return arts[i].ID < arts[j].ID })
	out := map[string]string{}
	versions := map[string]store.Version{} // the versions covers name, read once
	exists := func(c cover) bool {
		key := c.artifact + "@" + c.version
		v, ok := versions[key]
		if !ok {
			n := 0
			if c.version != "main" {
				n, _ = strconv.Atoi(c.version)
			}
			v, _ = s.Store.Version(ctx, c.artifact, n) // none: no files, so no cover
			versions[key] = v
		}
		_, ok = v.Files[c.path]
		return ok
	}
	for _, a := range arts {
		if a.Kind != store.KindData || a.Main == 0 {
			continue
		}
		recs, _, err := s.records(ctx, a.ID, a.Main)
		if err != nil {
			continue
		}
		for _, rec := range recs {
			page, _ := rec["page"].(string)
			if page == "" || out[page] != "" {
				continue
			}
			if c, ok := coverOf(rec["cover"]); ok && exists(c) {
				out[page] = c.url()
			}
		}
	}
	httpx.OK(w, out)
}

// cover is a data file a record names as a cover.
type cover struct{ artifact, version, path string }

// url is the cover's file on the main host.
func (c cover) url() string {
	return "/api/artifacts/" + c.artifact + "/versions/" + c.version + "/files/" + (&url.URL{Path: c.path}).EscapedPath()
}

// coverOf reads a record's cover: a src of /_d/<a>/<n|main>/<path>, alone
// or on any host (imported records may keep their old origin), as a string
// or {"src": …}. ok is false when it names no slop data file.
func coverOf(v any) (cover, bool) {
	src, _ := v.(string)
	if m, ok := v.(map[string]any); ok {
		src, _ = m["src"].(string)
	}
	u, err := url.Parse(src)
	if err != nil {
		return cover{}, false
	}
	m := dataPath.FindStringSubmatch(u.Path)
	if m == nil {
		return cover{}, false
	}
	return cover{artifact: m[1], version: m[2], path: m[3]}, true
}
