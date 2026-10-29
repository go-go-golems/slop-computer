// Package seed reads and pushes a seed directory: seed.json (projects,
// artifacts with their version histories, routes, threads) and
// artifacts/<id>/v<n>/ holding each version's files. `slop dev seed` loads
// the Workshop prototype's demo content this way and `slop import francois`
// writes the same shape, so both push through the API with every server
// invariant (dedup, refs, events, audit) intact.
package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/pkg/errors"
)

// File is seed.json.
type File struct {
	Projects  []client.Project `json:"projects"`
	Artifacts []Artifact       `json:"artifacts"`
	Routes    []Route          `json:"routes,omitempty"`
	Threads   []Thread         `json:"threads,omitempty"`
}

type Artifact struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Kind     string    `json:"kind"`
	Type     string    `json:"type"`
	Viewer   string    `json:"viewer"`
	Project  *string   `json:"project"`
	Versions []Version `json:"versions"`
}

// Version is one version of an artifact; its files are in
// artifacts/<artifact>/v<N>/.
type Version struct {
	N        int             `json:"n"`
	Message  string          `json:"message"`
	By       string          `json:"by"`
	Via      string          `json:"via"`
	Session  string          `json:"session"`
	Manifest json.RawMessage `json:"manifest"`
	// Key identifies an imported version (e.g. a francois release); a push
	// skips versions whose key an existing version's manifest already has.
	Key string `json:"key,omitempty"`
	// Main false keeps the main ref where it is (drafts, withdrawn releases).
	Main *bool `json:"main,omitempty"`
	// Author names the person on whose behalf the version is pushed.
	Author *Identity `json:"author,omitempty"`
}

// Identity is an OIDC identity, matched against the server's users.
type Identity struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
	Name    string `json:"name,omitempty"`
}

type Route struct {
	Path     string                    `json:"path"`
	Page     string                    `json:"page"`
	PageFrom string                    `json:"pageFrom,omitempty"`
	Version  *int                      `json:"version"`
	Record   string                    `json:"record"`
	Access   string                    `json:"access"`
	Bindings map[string]client.Binding `json:"bindings"`
}

type Thread struct {
	Artifact string          `json:"artifact"`
	Version  int             `json:"version"`
	Anchor   json.RawMessage `json:"anchor"`
	Resolved bool            `json:"resolved"`
	Comments []struct {
		By      string `json:"by"`
		Version *int   `json:"version"`
		Text    string `json:"text"`
	} `json:"comments"`
}

// ImportKey is where a version's import key lives in its manifest.
type importManifest struct {
	Import struct {
		Key string `json:"key"`
	} `json:"import"`
}

// Load reads dir/seed.json.
func Load(dir string) (*File, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "seed.json")) // #nosec G304 -- operator-supplied seed directory
	if err != nil {
		return nil, err
	}
	var f File
	if err = json.Unmarshal(raw, &f); err != nil {
		return nil, errors.Wrap(err, "seed.json")
	}
	return &f, nil
}

// Write writes f as dir/seed.json.
func Write(dir string, f *File) error {
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "seed.json"), append(raw, '\n'), 0o600)
}

// VersionDir is where a version's files live.
func VersionDir(dir, artifact string, n int) string {
	return filepath.Join(dir, "artifacts", artifact, fmt.Sprintf("v%d", n))
}

// Options steer a push.
type Options struct {
	// Admin creates projects, sets viewers and routes.
	Admin *client.Client
	// As returns the client acting as a seed author (local mode); nil means
	// Admin pushes everything.
	As func(nick string) (*client.Client, error)
	// SkipExisting skips artifacts that already have versions (dev seed);
	// otherwise versions are matched by Key and pushed when missing.
	SkipExisting bool
	// Host is the site host for routes; empty skips routes.
	Host string
	// Note is the route log note.
	Note string
	// Log reports progress; nil is silent.
	Log func(format string, args ...any)
}

// Result counts what a push did.
type Result struct {
	Versions, Unchanged, Skipped, Routes, Threads int
}

// Push pushes a loaded seed directory.
func Push(ctx context.Context, dir string, f *File, o Options) (Result, error) {
	var res Result
	logf := o.Log
	if logf == nil {
		logf = func(string, ...any) {}
	}
	as := func(nick string) (*client.Client, error) {
		if o.As == nil {
			return o.Admin, nil
		}
		return o.As(nick)
	}
	authors, err := authorMap(ctx, f, o.Admin)
	if err != nil {
		return res, err
	}
	used := map[string]bool{}
	for _, art := range f.Artifacts {
		if art.Project != nil {
			used[*art.Project] = true
		}
	}
	for _, p := range f.Projects {
		if used[p.ID] {
			if _, err := o.Admin.PutProject(ctx, p); err != nil {
				return res, errors.Wrap(err, "project "+p.ID)
			}
		}
	}
	// Data first, so pages that read it find it.
	order := append([]Artifact(nil), f.Artifacts...)
	sort.SliceStable(order, func(i, j int) bool { return order[i].Kind == "data" && order[j].Kind != "data" })
	viewers := map[string]string{}
	for _, art := range order {
		if err := pushArtifact(ctx, dir, art, o, as, authors, &res, logf); err != nil {
			return res, err
		}
		if art.Viewer != "" {
			viewers[art.ID] = art.Viewer
		}
	}
	// Viewers name pages, which exist only now.
	for id, viewer := range viewers {
		if _, err := o.Admin.PatchArtifact(ctx, id, map[string]any{"viewer": viewer}); err != nil {
			return res, errors.Wrap(err, "viewer of "+id)
		}
	}
	for _, r := range f.Routes {
		if o.Host == "" {
			break
		}
		if _, err := o.Admin.SetRoute(ctx, client.Route{Host: o.Host, Path: r.Path, Page: r.Page, PageFrom: r.PageFrom, Version: r.Version, Record: r.Record, Access: r.Access, Bindings: r.Bindings, Note: o.Note}); err != nil {
			return res, errors.Wrap(err, "route "+r.Path)
		}
		res.Routes++
	}
	for _, t := range f.Threads {
		if err := pushThread(ctx, t, as); err != nil {
			return res, err
		}
		if len(t.Comments) > 0 {
			res.Threads++
		}
	}
	return res, nil
}

// authorMap maps the seed's author identities to user IDs on the server.
// Identities without an account are left out: those versions are pushed by
// the caller.
func authorMap(ctx context.Context, f *File, api *client.Client) (map[Identity]string, error) {
	need := false
	for _, a := range f.Artifacts {
		for _, v := range a.Versions {
			need = need || v.Author != nil
		}
	}
	out := map[Identity]string{}
	if !need {
		return out, nil
	}
	users, err := api.Users(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "list users (authors need a token with admin scope)")
	}
	for _, u := range users {
		if u.Role != "disabled" {
			out[Identity{Issuer: u.Issuer, Subject: u.Subject}] = u.ID
		}
	}
	return out, nil
}

func pushArtifact(ctx context.Context, dir string, art Artifact, o Options, as func(string) (*client.Client, error),
	authors map[Identity]string, res *Result, logf func(string, ...any)) error {
	existing, err := o.Admin.Artifact(ctx, art.ID)
	exists := err == nil && existing.Latest > 0
	if err != nil && !client.IsNotFound(err) {
		return errors.Wrap(err, "artifact "+art.ID)
	}
	if exists && o.SkipExisting {
		logf("%s exists (v%d), skipped\n", art.ID, existing.Latest)
		res.Skipped += len(art.Versions)
		return nil
	}
	have := map[string]bool{}
	main := 0
	if exists {
		main = existing.Main
		vs, err := o.Admin.Versions(ctx, art.ID)
		if err != nil {
			return errors.Wrap(err, "versions of "+art.ID)
		}
		for _, v := range vs {
			var m importManifest
			if json.Unmarshal(v.Manifest, &m) == nil && m.Import.Key != "" {
				have[m.Import.Key] = true
			}
		}
	}
	for _, ver := range art.Versions {
		if ver.Key != "" && have[ver.Key] {
			res.Skipped++
			continue
		}
		author, err := as(ver.By)
		if err != nil {
			return err
		}
		tree, err := UploadDir(ctx, author, VersionDir(dir, art.ID, ver.N))
		if err != nil {
			return errors.Wrapf(err, "%s v%d", art.ID, ver.N)
		}
		req := client.PushRequest{Tree: tree, Manifest: ver.Manifest, Message: ver.Message, Via: ver.Via, Session: ver.Session, MoveMain: ver.Main}
		if ver.Author != nil {
			req.Author = authors[Identity{Issuer: ver.Author.Issuer, Subject: ver.Author.Subject}]
		}
		if main == 0 {
			req.Create = &client.CreateArtifact{Title: art.Title, Kind: art.Kind, Type: art.Type, Project: art.Project}
			req.MoveMain = nil // the first version is main
		} else {
			base := main
			req.Base = &base
		}
		out, err := author.Push(ctx, art.ID, req)
		if err != nil {
			return errors.Wrapf(err, "push %s v%d", art.ID, ver.N)
		}
		if out.Unchanged {
			res.Unchanged++
		} else {
			res.Versions++
		}
		main = out.Artifact.Main
	}
	return nil
}

func pushThread(ctx context.Context, t Thread, as func(string) (*client.Client, error)) error {
	if len(t.Comments) == 0 {
		return nil
	}
	first, err := as(t.Comments[0].By)
	if err != nil {
		return err
	}
	th, err := first.CreateThread(ctx, t.Artifact, t.Version, t.Anchor, t.Comments[0].Text)
	if err != nil {
		return errors.Wrap(err, "thread on "+t.Artifact)
	}
	for _, cm := range t.Comments[1:] {
		author, err := as(cm.By)
		if err != nil {
			return err
		}
		if _, err = author.ReplyThread(ctx, th.ID, cm.Text, cm.Version); err != nil {
			return err
		}
	}
	if t.Resolved {
		if _, err = first.ResolveThread(ctx, th.ID, true); err != nil {
			return err
		}
	}
	return nil
}

// UploadDir uploads a directory's files (only those the server lacks) and
// returns its tree.
func UploadDir(ctx context.Context, api *client.Client, dir string) (map[string]string, error) {
	tree := map[string]string{}
	paths := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		sum, err := blobs.SumFile(p)
		if err != nil {
			return err
		}
		tree[filepath.ToSlash(rel)] = sum
		paths[sum] = p
		return nil
	})
	if err != nil {
		return nil, err
	}
	sums := make([]string, 0, len(paths))
	for s := range paths {
		sums = append(sums, s)
	}
	sort.Strings(sums)
	missing, err := api.MissingBlobs(ctx, sums)
	if err != nil {
		return nil, err
	}
	for _, s := range missing {
		b, err := os.ReadFile(paths[s]) // #nosec G304 -- files of the seed directory
		if err != nil {
			return nil, err
		}
		if err = api.PutBlob(ctx, s, b); err != nil {
			return nil, err
		}
	}
	return tree, nil
}
