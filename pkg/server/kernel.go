package server

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Limits on pushed content.
const (
	maxFileSize    = 25 << 20
	maxVersionSize = 200 << 20
	maxFiles       = 2000
)

func (s *Server) kernelRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/projects", s.guardPerm(admin, scopeRW, "artifacts:read", s.listProjects))
	m.HandleFunc("GET /api/projects/{id}", s.guardPerm(admin, scopeRW, "artifacts:read", s.getProject))
	m.HandleFunc("PUT /api/projects/{id}", s.guard(admin, scopeRW, s.putProject))
	m.HandleFunc("GET /api/artifacts", s.guardPerm(admin, scopeRW, "artifacts:read", s.listArtifacts))
	m.HandleFunc("POST /api/artifacts", s.guardPerm(admin, scopeRW, "versions:push", s.createArtifact))
	m.HandleFunc("GET /api/artifacts/{id}", s.guardPerm(admin, scopeRW, "artifacts:read", s.getArtifact))
	m.HandleFunc("PATCH /api/artifacts/{id}", s.guard(admin, scopeRW, s.patchArtifact))
	m.HandleFunc("GET /api/artifacts/{id}/versions", s.guardPerm(admin, scopeRW, "versions:read", s.listVersions))
	m.HandleFunc("POST /api/artifacts/{id}/versions", s.guardPerm(admin, scopeRW, "versions:push", s.push))
	m.HandleFunc("GET /api/artifacts/{id}/versions/{n}", s.guardPerm(admin, scopeRW, "versions:read", s.getVersion))
	m.HandleFunc("GET /api/artifacts/{id}/versions/{n}/files/{path...}", s.guardPerm(admin, scopeRW, "versions:read", s.getFile))
	m.HandleFunc("PUT /api/artifacts/{id}/refs/{name}", s.guardPerm(admin, scopeRW, "versions:push", s.putRef))
	m.HandleFunc("POST /api/blobs/missing", s.guardPerm(admin, scopeRW, "versions:push", s.missingBlobs))
	m.HandleFunc("PUT /api/blobs/{sha}", s.guardPerm(admin, scopeRW, "versions:push", s.putBlob))
	m.HandleFunc("GET /api/routes", s.guardPerm(admin, scopeRW, "routes:read", s.listRoutes))
	m.HandleFunc("PUT /api/routes", s.guardPerm(admin, scopeRW, "routes:write", s.putRoute))
	m.HandleFunc("DELETE /api/routes", s.guardPerm(admin, scopeRW, "routes:write", s.deleteRoute))
	m.HandleFunc("GET /api/routes/log", s.guardPerm(admin, scopeRW, "routes:read", s.routeLog))
	m.HandleFunc("POST /api/routes/undo", s.guardPerm(admin, scopeRW, "routes:write", s.undoRoute))
	m.HandleFunc("GET /api/threads", s.guardPerm(admin, scopeRW, "threads:read", s.listThreads))
	m.HandleFunc("POST /api/artifacts/{id}/threads", s.guardPerm(admin, scopeRW, "threads:write", s.createThread))
	m.HandleFunc("POST /api/threads/{id}/replies", s.guardPerm(admin, scopeRW, "threads:write", s.replyThread))
	m.HandleFunc("POST /api/threads/{id}/resolve", s.guardPerm(admin, scopeRW, "threads:write", s.resolveThread))
}

// storeFail maps store errors to HTTP answers.
func storeFail(w http.ResponseWriter, err error) {
	var moved *store.MainMovedError
	switch {
	case errors.Is(err, store.ErrNotFound):
		httpx.Fail(w, 404, "not_found", "Not found")
	case errors.Is(err, store.ErrConflict):
		httpx.Fail(w, 409, "conflict", "Already exists")
	case errors.As(err, &moved):
		httpx.JSON(w, 409, map[string]any{"error": httpx.Failure{Code: "main_moved", Message: moved.Error()}, "main": moved.Main})
	default:
		unavailable(w, err)
	}
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	var invalid *store.InvalidError
	if errors.As(err, &invalid) {
		httpx.Fail(w, 400, "invalid_request", invalid.Msg)
		return
	}
	storeFail(w, err)
}

func tokenID(r *http.Request) string {
	if p := principal(r.Context()); p.Token != nil {
		return p.Token.ID
	}
	return ""
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	ps, err := s.Store.Projects(r.Context())
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, ps)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := s.Store.Project(r.Context(), r.PathValue("id"))
	if err != nil {
		storeFail(w, err)
		return
	}
	httpx.OK(w, p)
}

func (s *Server) putProject(w http.ResponseWriter, r *http.Request) {
	var in store.Project
	if err := httpx.Read(w, r, &in, 64<<10); err != nil || strings.TrimSpace(in.Name) == "" {
		httpx.Fail(w, 400, "invalid_request", "A name is required")
		return
	}
	in.ID = r.PathValue("id")
	if !store.ValidArtifactID(in.ID) {
		httpx.Fail(w, 400, "invalid_request", "A project id is lowercase letters, digits and -")
		return
	}
	p, evs, err := s.Store.PutProject(r.Context(), in, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, p)
}

func (s *Server) listArtifacts(w http.ResponseWriter, r *http.Request) {
	as, err := s.Store.Artifacts(r.Context(), r.URL.Query().Get("project"))
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, as)
}

func (s *Server) getArtifact(w http.ResponseWriter, r *http.Request) {
	a, err := s.Store.Artifact(r.Context(), r.PathValue("id"))
	if err != nil {
		storeFail(w, err)
		return
	}
	httpx.OK(w, a)
}

func (s *Server) createArtifact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
		store.ArtifactInput
	}
	if err := httpx.Read(w, r, &in, 16<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	a, evs, err := s.Store.CreateArtifact(r.Context(), in.ID, in.ArtifactInput, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.JSON(w, 201, a)
}

func (s *Server) patchArtifact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title   *string          `json:"title"`
		Viewer  *string          `json:"viewer"`
		Project *json.RawMessage `json:"project"`
	}
	if err := httpx.Read(w, r, &in, 16<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	var project **string
	if in.Project != nil {
		var p *string
		if err := json.Unmarshal(*in.Project, &p); err != nil {
			httpx.Fail(w, 400, "invalid_request", "project must be a string or null")
			return
		}
		project = &p
	}
	a, evs, err := s.Store.UpdateArtifact(r.Context(), r.PathValue("id"), in.Title, in.Viewer, project, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, a)
}

func (s *Server) listVersions(w http.ResponseWriter, r *http.Request) {
	vs, err := s.Store.Versions(r.Context(), r.PathValue("id"))
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, vs)
}

// versionNumber reads {n}: a number or "main" (0).
func versionNumber(r *http.Request) (int, bool) {
	raw := r.PathValue("n")
	if raw == "main" {
		return 0, true
	}
	n, err := strconv.Atoi(raw)
	return n, err == nil && n > 0
}

func (s *Server) getVersion(w http.ResponseWriter, r *http.Request) {
	n, ok := versionNumber(r)
	if !ok {
		httpx.Fail(w, 400, "invalid_request", "A version is a number or main")
		return
	}
	v, err := s.Store.Version(r.Context(), r.PathValue("id"), n)
	if err != nil {
		storeFail(w, err)
		return
	}
	httpx.OK(w, v)
}

// getFile streams one file of a version, with its sha256 as ETag.
func (s *Server) getFile(w http.ResponseWriter, r *http.Request) {
	n, ok := versionNumber(r)
	if !ok {
		httpx.Fail(w, 400, "invalid_request", "A version is a number or main")
		return
	}
	v, err := s.Store.Version(r.Context(), r.PathValue("id"), n)
	if err != nil {
		storeFail(w, err)
		return
	}
	f, ok := v.Files[r.PathValue("path")]
	if !ok {
		httpx.Fail(w, 404, "not_found", "No such file in this version")
		return
	}
	s.serveBlob(w, r, f)
}

func (s *Server) serveBlob(w http.ResponseWriter, r *http.Request, f store.FileEntry) {
	file, err := s.Blobs.Open(f.SHA256)
	if err != nil {
		unavailable(w, err)
		return
	}
	defer func() { _ = file.Close() }()
	w.Header().Set("Content-Type", f.Type)
	w.Header().Set("ETag", `"`+f.SHA256+`"`)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", zeroTime, file)
}

func (s *Server) missingBlobs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SHA256 []string `json:"sha256"`
	}
	if err := httpx.Read(w, r, &in, 1<<20); err != nil || len(in.SHA256) > maxFiles {
		httpx.Fail(w, 400, "invalid_request", "Send {sha256: [...]} with at most 2000 entries")
		return
	}
	for _, sum := range in.SHA256 {
		if !blobs.ValidSum(sum) {
			httpx.Fail(w, 400, "invalid_request", "Not a sha256: "+sum)
			return
		}
	}
	httpx.OK(w, map[string]any{"missing": s.Blobs.Missing(in.SHA256)})
}

// putBlob stores the request body; it must hash to {sha}.
func (s *Server) putBlob(w http.ResponseWriter, r *http.Request) {
	sum := r.PathValue("sha")
	if !blobs.ValidSum(sum) {
		httpx.Fail(w, 400, "invalid_request", "Not a sha256")
		return
	}
	got, size, err := s.Blobs.PutReader(http.MaxBytesReader(w, r.Body, maxFileSize+1), maxFileSize, sum)
	switch {
	case errors.Is(err, blobs.ErrHashMismatch):
		httpx.Fail(w, 400, "hash_mismatch", "The body does not hash to "+sum)
	case errors.Is(err, blobs.ErrTooLarge):
		httpx.Fail(w, 413, "too_large", "A file is at most 25 MB")
	case err != nil:
		unavailable(w, err)
	default:
		httpx.JSON(w, 201, map[string]any{"sha256": got, "size": size})
	}
}

// cleanPath validates a path inside a version's tree.
func cleanPath(p string) (string, bool) {
	if p == "" || len(p) > 512 || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.ContainsRune(p, 0) {
		return "", false
	}
	c := path.Clean(p)
	if c != p || c == "." || strings.HasPrefix(c, "../") || c == ".." || strings.HasPrefix(c, "_slop/") {
		return "", false
	}
	return c, true
}

func mediaType(p string) string {
	if t := mime.TypeByExtension(path.Ext(p)); t != "" {
		return t
	}
	switch path.Ext(p) {
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".csv":
		return "text/csv; charset=utf-8"
	}
	return "application/octet-stream"
}

// compiledWarning warns when a push replaces a page that Pinup compiles from
// a design (manifest pinup.design) with a version that does not come from
// Pinup: Publish app in Pinup then asks before replacing it.
func (s *Server) compiledWarning(ctx context.Context, id string, manifest json.RawMessage) string {
	a, err := s.Store.Artifact(ctx, id)
	if err != nil || a.Main == 0 {
		return ""
	}
	v, err := s.Store.Version(ctx, id, a.Main)
	if err != nil {
		return ""
	}
	type compiled struct {
		Pinup *struct {
			Design string `json:"design"`
		} `json:"pinup"`
	}
	var cur, next compiled
	if store.ManifestOf(v, &cur) != nil || cur.Pinup == nil || cur.Pinup.Design == "" {
		return ""
	}
	if len(manifest) > 0 && json.Unmarshal(manifest, &next) == nil && next.Pinup != nil {
		return ""
	}
	return id + " is compiled from the Pinup design " + cur.Pinup.Design + "; this version is not, and Publish app in Pinup will ask before replacing it (to keep the page in Pinup, edit the design instead)"
}

type pushRequest struct {
	Base     *int                 `json:"base"`
	Tree     map[string]string    `json:"tree"`
	Manifest json.RawMessage      `json:"manifest"`
	Message  string               `json:"message"`
	Via      string               `json:"via"`
	Session  string               `json:"session"`
	Reply    *store.ReplyInput    `json:"reply"`
	Create   *store.ArtifactInput `json:"create"`
	MoveMain *bool                `json:"moveMain"`
	Force    bool                 `json:"force"`
	// Author pushes on behalf of another user (imports). Only a signed-in
	// admin or a token with the admin scope may set it; it is audited.
	Author string `json:"author"`
}

// push stores a new version from a complete tree of already uploaded blobs.
func (s *Server) push(w http.ResponseWriter, r *http.Request) {
	var in pushRequest
	if err := httpx.Read(w, r, &in, 4<<20); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	if len(in.Tree) == 0 || len(in.Tree) > maxFiles {
		httpx.Fail(w, 400, "invalid_request", "A tree has 1–2000 files")
		return
	}
	tree := map[string]store.FileEntry{}
	var total int64
	missing := []string{}
	for p, sum := range in.Tree {
		clean, ok := cleanPath(p)
		if !ok {
			httpx.Fail(w, 400, "invalid_path", "Invalid path in tree: "+p)
			return
		}
		if !blobs.ValidSum(sum) {
			httpx.Fail(w, 400, "invalid_request", "Not a sha256 for "+p)
			return
		}
		size, ok := s.Blobs.Stat(sum)
		if !ok {
			missing = append(missing, sum)
			continue
		}
		total += size
		tree[clean] = store.FileEntry{SHA256: sum, Size: size, Type: mediaType(clean)}
	}
	if len(missing) > 0 {
		httpx.JSON(w, 409, map[string]any{"error": httpx.Failure{Code: "missing_blobs", Message: "Upload these blobs first"}, "missing": missing})
		return
	}
	if total > maxVersionSize {
		httpx.Fail(w, 413, "too_large", "A version is at most 200 MB")
		return
	}
	manifest := store.JSON(in.Manifest)
	var warnings []string
	if len(in.Manifest) > 0 {
		var m struct {
			Reads  map[string]string `json:"reads"`
			Tokens string            `json:"tokens"`
		}
		if err := json.Unmarshal(in.Manifest, &m); err != nil {
			httpx.Fail(w, 400, "invalid_manifest", "The manifest must be a JSON object")
			return
		}
		for name, id := range m.Reads {
			if a, err := s.Store.Artifact(r.Context(), id); err != nil || a.Kind != store.KindData {
				warnings = append(warnings, "reads."+name+": "+id+" is not a data artifact (yet)")
			}
		}
		if m.Tokens != "" {
			if a, err := s.Store.Artifact(r.Context(), m.Tokens); err != nil || a.Type != "tokens" {
				warnings = append(warnings, "tokens: "+m.Tokens+" is not a tokens data artifact (yet)")
			}
		} // A tool section must be valid when it is pushed, not when it is enabled.
		if _, err := store.ToolManifestOf(store.Version{Manifest: manifest}); err != nil {
			s.fail(w, err)
			return
		}
	}
	if w := s.compiledWarning(r.Context(), r.PathValue("id"), in.Manifest); w != "" {
		warnings = append(warnings, w)
	}
	p := principal(r.Context())
	via := "browser"
	if p.Grant != nil {
		via = "tool"
	} else if p.Token != nil {
		via = "cli"
		if in.Via == "claude" || in.Via == "agent" || in.Via == "import" {
			via = in.Via
		}
	}
	author := actor(r)
	if in.Author != "" && in.Author != author {
		if p.Grant != nil || (p.Token != nil && !p.Token.Allows(store.ScopeAdmin)) {
			httpx.Fail(w, 403, "author_not_allowed", "Pushing on behalf of someone else needs the admin scope")
			return
		}
		u, err := s.Store.User(r.Context(), in.Author)
		if err != nil || u.Role == store.RoleDisabled {
			httpx.Fail(w, 400, "invalid_author", "author must be an existing, enabled user")
			return
		}
		author = u.ID
	}
	moveMain := in.MoveMain == nil || *in.MoveMain
	res, err := s.Store.Push(r.Context(), store.PushInput{Artifact: r.PathValue("id"), Base: in.Base, Tree: tree, Manifest: manifest,
		Message: strings.TrimSpace(in.Message), Via: via, Session: in.Session, Reply: in.Reply, Create: in.Create,
		MoveMain: moveMain, Force: in.Force, Actor: author, TokenID: tokenID(r)})
	if err != nil {
		s.fail(w, err)
		return
	}
	if author != actor(r) && !res.Unchanged {
		_ = s.Store.Audit(r.Context(), actor(r), "version.push_as", res.Artifact.ID,
			map[string]any{"author": author, "n": res.Version.N, "via": via})
	}
	s.publish(res.Events)
	code := 201
	if res.Unchanged {
		code = 200
	}
	httpx.JSON(w, code, map[string]any{"artifact": res.Artifact, "version": res.Version, "created": res.Created, "unchanged": res.Unchanged, "warnings": warnings})
}

func (s *Server) putRef(w http.ResponseWriter, r *http.Request) {
	var in struct {
		N      int  `json:"n"`
		Expect *int `json:"expect"`
	}
	if err := httpx.Read(w, r, &in, 1024); err != nil || in.N <= 0 {
		httpx.Fail(w, 400, "invalid_request", "Send {n, expect?}")
		return
	}
	if r.PathValue("name") != "main" {
		httpx.Fail(w, 400, "invalid_request", "Only the main ref exists in v1")
		return
	}
	a, evs, err := s.Store.SetRef(r.Context(), r.PathValue("id"), "main", in.N, in.Expect, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, a)
}

// routeView is a route with what it serves now: the page version (n) and its
// data bindings resolved (data), for ?resolve=1.
type routeView struct {
	store.Route
	N    int                        `json:"n"`
	Data map[string]ResolvedBinding `json:"data"`
}

func (s *Server) listRoutes(w http.ResponseWriter, r *http.Request) {
	rs, err := s.Store.Routes(r.Context(), r.URL.Query().Get("host"))
	if err != nil {
		unavailable(w, err)
		return
	}
	if r.URL.Query().Get("resolve") != "1" {
		httpx.OK(w, rs)
		return
	}
	out := make([]routeView, 0, len(rs))
	for i := range rs {
		rv := routeView{Route: rs[i], Data: map[string]ResolvedBinding{}}
		n := 0
		if rs[i].Version != nil {
			n = *rs[i].Version
		}
		if v, err := s.Store.Version(r.Context(), rs[i].Page, n); err == nil {
			rv.N, rv.Data = v.N, s.bindings(r.Context(), v, &rs[i])
		}
		out = append(out, rv)
	}
	httpx.OK(w, out)
}

func (s *Server) putRoute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		store.Route
		Note string `json:"note"`
	}
	if err := httpx.Read(w, r, &in, 64<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	rt, evs, err := s.Store.SetRoute(r.Context(), in.Route, in.Note, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, rt)
}

func (s *Server) deleteRoute(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	evs, err := s.Store.RemoveRoute(r.Context(), q.Get("host"), q.Get("path"), q.Get("note"), actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, map[string]bool{"removed": true})
}

func (s *Server) routeLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	log, err := s.Store.RouteLog(r.Context(), q.Get("host"), q.Get("path"), limit)
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, log)
}

func (s *Server) undoRoute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Host string `json:"host"`
		Path string `json:"path"`
	}
	if err := httpx.Read(w, r, &in, 4096); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {host, path}")
		return
	}
	rt, evs, err := s.Store.UndoRoute(r.Context(), in.Host, in.Path, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, map[string]any{"route": rt})
}

func (s *Server) listThreads(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ts, err := s.Store.Threads(r.Context(), store.ThreadFilter{Artifact: q.Get("artifact"), Project: q.Get("project"), OpenOnly: q.Get("open") == "1"})
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, ts)
}

func (s *Server) createThread(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int             `json:"version"`
		Anchor  json.RawMessage `json:"anchor"`
		Text    string          `json:"text"`
	}
	if err := httpx.Read(w, r, &in, 256<<10); err != nil || in.Version <= 0 {
		httpx.Fail(w, 400, "invalid_request", "Send {version, anchor, text}")
		return
	}
	t, evs, err := s.Store.CreateThread(r.Context(), r.PathValue("id"), in.Version, store.JSON(in.Anchor), strings.TrimSpace(in.Text), actor(r), tokenID(r), tokenID(r) != "")
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.JSON(w, 201, t)
}

func (s *Server) replyThread(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text    string `json:"text"`
		Version *int   `json:"version"`
	}
	if err := httpx.Read(w, r, &in, 64<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {text, version?}")
		return
	}
	t, _, evs, err := s.Store.Reply(r.Context(), r.PathValue("id"), strings.TrimSpace(in.Text), in.Version, actor(r), tokenID(r), tokenID(r) != "")
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.JSON(w, 201, t)
}

func (s *Server) resolveThread(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Resolved *bool `json:"resolved"`
	}
	if err := httpx.Read(w, r, &in, 1024); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {resolved}")
		return
	}
	t, evs, err := s.Store.ResolveThread(r.Context(), r.PathValue("id"), in.Resolved == nil || *in.Resolved, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, t)
}

var zeroTime time.Time
