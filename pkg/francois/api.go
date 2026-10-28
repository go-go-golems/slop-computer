package francois

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// APISource reads a live francois through its studio API with a personal
// token (scope studio; admin:read adds users and instance counts). Only GET
// requests are made. Release HTML comes only for published free samples:
// francois downloads paid releases only to signed-in browser sessions.
type APISource struct {
	base, token string
	http        *http.Client
	// dl fetches file bodies: large media take minutes over a slow link, so
	// only the wait for headers is bounded.
	dl *http.Client
}

// NewAPI returns a source for server (e.g. https://slop.boutique).
func NewAPI(server, token string) *APISource {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.ResponseHeaderTimeout = time.Minute
	return &APISource{base: strings.TrimRight(server, "/"), token: token,
		http: &http.Client{Timeout: 2 * time.Minute}, dl: &http.Client{Transport: tr}}
}

func (s *APISource) Close() error { return nil }

// StoredToken reads the token francois's CLI stored for server
// (~/.config/francois/credentials.json); server "" means its default.
func StoredToken(server string) (string, string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "francois", "credentials.json")) // #nosec G304 -- the francois CLI's own file
	if err != nil {
		return "", "", errors.Wrap(err, "no stored francois login (francois catalog auth login)")
	}
	var f struct {
		Default string `json:"default"`
		Servers map[string]struct {
			Token string `json:"token"`
		} `json:"servers"`
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		return "", "", errors.Wrap(err, "francois credentials")
	}
	if server == "" {
		server = f.Default
	}
	c, ok := f.Servers[strings.TrimRight(server, "/")]
	if !ok || c.Token == "" {
		return "", "", errors.Errorf("no stored francois token for %s", server)
	}
	return server, c.Token, nil
}

// Refs: "token:<path>" is fetched with the token, "anon:<path>" without it.
const (
	refToken = "token:"
	refAnon  = "anon:"
)

func (s *APISource) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &HTTPError{Status: resp.StatusCode, Path: path, Body: strings.TrimSpace(string(b))}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// HTTPError is a non-200 answer from francois.
type HTTPError struct {
	Status     int
	Path, Body string
}

func (e *HTTPError) Error() string {
	return "francois " + e.Path + ": HTTP " + strconv.Itoa(e.Status) + " " + e.Body
}

func (s *APISource) Open(ctx context.Context, f File) (io.ReadCloser, error) {
	var path string
	auth := false
	switch {
	case strings.HasPrefix(f.Ref, refToken):
		path, auth = strings.TrimPrefix(f.Ref, refToken), true
	case strings.HasPrefix(f.Ref, refAnon):
		path = strings.TrimPrefix(f.Ref, refAnon)
	default:
		return nil, ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+path, nil)
	if err != nil {
		return nil, err
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.dl.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 404 {
		_ = resp.Body.Close()
		return nil, ErrUnavailable
	}
	if resp.StatusCode != 200 {
		_ = resp.Body.Close()
		return nil, &HTTPError{Status: resp.StatusCode, Path: path}
	}
	return resp.Body, nil
}

// Wire shapes of the studio API (francois pkg/catalog/client/types.go).
type apiRelease struct {
	ID          string          `json:"id"`
	Version     string          `json:"version"`
	Changelog   string          `json:"changelog"`
	State       string          `json:"state"`
	FreeSample  bool            `json:"freeSample"`
	Manifest    json.RawMessage `json:"manifest"`
	CreatedAt   *time.Time      `json:"createdAt"`
	PublishedAt *time.Time      `json:"publishedAt"`
	WithdrawnAt *time.Time      `json:"withdrawnAt"`
	Files       []struct {
		ID        string `json:"id"`
		Role      string `json:"role"`
		Name      string `json:"name"`
		MediaType string `json:"mediaType"`
		Size      int64  `json:"size"`
		SHA256    string `json:"sha256"`
	} `json:"files"`
	Attachments []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Label     string `json:"label"`
		MediaType string `json:"mediaType"`
		Size      int64  `json:"size"`
		SHA256    string `json:"sha256"`
		Href      string `json:"href"`
	} `json:"attachments"`
}

func (s *APISource) Snapshot(ctx context.Context) (*Snapshot, error) {
	snap := &Snapshot{Source: "api " + s.base, TakenAt: time.Now().UTC(), Counts: map[string]int64{}}
	var rows []struct {
		ID       string `json:"id"`
		HasDraft bool   `json:"hasDraft"`
	}
	if err := s.get(ctx, "/api/studio/artifacts", &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		var d struct {
			Artifact Artifact     `json:"artifact"`
			Creators []string     `json:"creators"`
			Releases []apiRelease `json:"releases"`
		}
		if err := s.get(ctx, "/api/studio/artifacts/"+url.PathEscape(row.ID), &d); err != nil {
			return nil, err
		}
		a := d.Artifact
		a.HasDraft, a.Creators = row.HasDraft, d.Creators
		for _, r := range d.Releases {
			a.Releases = append(a.Releases, releaseOf(r))
		}
		// Oldest first, like the database source.
		sort.SliceStable(a.Releases, func(i, j int) bool { return a.Releases[i].CreatedAt.Before(a.Releases[j].CreatedAt) })
		snap.Artifacts = append(snap.Artifacts, a)
	}
	var posts []Post
	if err := s.get(ctx, "/api/studio/posts", &posts); err != nil {
		return nil, err
	}
	for _, p := range posts {
		var full Post
		if err := s.get(ctx, "/api/studio/posts/"+url.PathEscape(p.ID), &full); err != nil {
			return nil, err
		}
		full.Author = firstNonEmpty(full.Author, p.Author)
		snap.Posts = append(snap.Posts, full)
	}
	if err := s.get(ctx, "/api/studio/creators", &snap.Creators); err != nil {
		return nil, err
	}
	var media []struct {
		ID        string `json:"id"`
		SHA256    string `json:"sha256"`
		MediaType string `json:"mediaType"`
		Size      int64  `json:"size"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		Alt       string `json:"alt"`
	}
	if err := s.get(ctx, "/api/studio/media", &media); err != nil {
		return nil, err
	}
	for _, m := range media {
		snap.Media = append(snap.Media, Media{ID: m.ID, MediaType: m.MediaType, Width: m.Width, Height: m.Height, Alt: m.Alt,
			File: File{ID: m.ID, Name: m.ID + ext(m.MediaType), MediaType: m.MediaType, Size: m.Size, SHA256: m.SHA256, Ref: refAnon + "/media/" + m.ID, Public: true}})
	}
	// Admin scopes add the admins and instance counts; studio-only tokens
	// get a snapshot without them.
	var users []struct {
		User User `json:"user"`
	}
	if err := s.get(ctx, "/api/admin/users?role=admin&limit=500", &users); err == nil {
		for _, u := range users {
			snap.Users = append(snap.Users, u.User)
		}
	}
	var instances []json.RawMessage
	if err := s.get(ctx, "/api/admin/instances", &instances); err == nil {
		snap.Counts["instances"] = int64(len(instances))
	}
	return snap, nil
}

func releaseOf(r apiRelease) Release {
	out := Release{ID: r.ID, Version: r.Version, Changelog: r.Changelog, State: r.State, FreeSample: r.FreeSample, Manifest: r.Manifest,
		PublishedAt: r.PublishedAt, WithdrawnAt: r.WithdrawnAt, Attachments: []File{}}
	if r.CreatedAt != nil {
		out.CreatedAt = *r.CreatedAt
	}
	for _, f := range r.Files {
		if f.Role == "html" {
			// Anyone may download a published free sample; nothing else is
			// downloadable with a token.
			public := r.FreeSample && r.State == "published"
			out.HTML = File{ID: f.ID, Name: f.Name, MediaType: f.MediaType, Size: f.Size, SHA256: f.SHA256, Public: public,
				Ref: refAnon + "/api/releases/" + url.PathEscape(r.ID) + "/files/" + url.PathEscape(f.ID) + "/download"}
		}
	}
	for _, a := range r.Attachments {
		out.Attachments = append(out.Attachments, File{ID: a.ID, Name: a.Name, Label: a.Label, MediaType: a.MediaType, Size: a.Size,
			SHA256: a.SHA256, Ref: refToken + a.Href, Public: true})
	}
	return out
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
