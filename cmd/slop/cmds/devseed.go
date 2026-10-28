package cmds

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/pkg/errors"
)

// seedFile is examples/seed/seed.json, written by scripts/export-seed.mjs
// from the Workshop prototype's fake data.
type seedFile struct {
	Projects  []client.Project `json:"projects"`
	Artifacts []struct {
		ID       string  `json:"id"`
		Title    string  `json:"title"`
		Kind     string  `json:"kind"`
		Type     string  `json:"type"`
		Viewer   string  `json:"viewer"`
		Project  *string `json:"project"`
		Versions []struct {
			N        int             `json:"n"`
			Message  string          `json:"message"`
			By       string          `json:"by"`
			Via      string          `json:"via"`
			Session  string          `json:"session"`
			Manifest json.RawMessage `json:"manifest"`
		} `json:"versions"`
	} `json:"artifacts"`
	Routes []struct {
		Path     string                    `json:"path"`
		Page     string                    `json:"page"`
		Version  *int                      `json:"version"`
		Record   string                    `json:"record"`
		Access   string                    `json:"access"`
		Bindings map[string]client.Binding `json:"bindings"`
	} `json:"routes"`
	Threads []struct {
		Artifact string          `json:"artifact"`
		Version  int             `json:"version"`
		Anchor   json.RawMessage `json:"anchor"`
		Resolved bool            `json:"resolved"`
		Comments []struct {
			By      string `json:"by"`
			Version *int   `json:"version"`
			Text    string `json:"text"`
		} `json:"comments"`
	} `json:"threads"`
}

type devSeedCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*devSeedCmd)(nil)

func newDevSeed() *devSeedCmd {
	return &devSeedCmd{glazed.NewCommandDescription("seed",
		glazed.WithShort("Push the Workshop prototype's demo content through the API"),
		glazed.WithLong("Reads examples/seed (see scripts/export-seed.mjs): projects, 14 artifacts with their version histories, "+
			"routes for the site host and comment threads. Against a local-mode server each version and comment is made by its original "+
			"author (manuel, ramon); otherwise everything is made by the logged-in user."),
		glazed.WithFlags(append(serverFlags(),
			flagDefault("dir", "examples/seed", "Exported seed directory"),
			flag("host", "Site host for the routes (default: the server's first site host)"),
		)...))}
}

func (c *devSeedCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		// A local server needs no stored login: --as tokens are minted below.
		srv := firstNonEmpty(a.S("server"), os.Getenv("SLOP_SERVER"))
		if srv == "" {
			return err
		}
		api = client.New(srv, "")
	}
	dir := a.S("dir")
	raw, err := os.ReadFile(filepath.Join(dir, "seed.json")) // #nosec G304 -- operator-supplied seed directory
	if err != nil {
		return err
	}
	var seed seedFile
	if err = json.Unmarshal(raw, &seed); err != nil {
		return errors.Wrap(err, "seed.json")
	}
	cfg, err := api.Config(ctx)
	if err != nil {
		return err
	}
	// as returns the client acting as a seed author.
	authors := map[string]*client.Client{}
	as := func(nick string) (*client.Client, error) {
		if cfg.Mode != "local" {
			return api, nil
		}
		if c, ok := authors[nick]; ok {
			return c, nil
		}
		tok, err := client.New(api.Server(), "").LocalToken(ctx, nick, "dev seed", []string{"read", "write"}, 1)
		if err != nil {
			return nil, errors.Wrap(err, "local token for "+nick)
		}
		authors[nick] = client.New(api.Server(), tok.Token)
		return authors[nick], nil
	}
	admin, err := as("manuel")
	if err != nil {
		return err
	}
	used := map[string]bool{}
	for _, art := range seed.Artifacts {
		if art.Project != nil {
			used[*art.Project] = true
		}
	}
	for _, p := range seed.Projects {
		if used[p.ID] {
			if _, err = admin.PutProject(ctx, p); err != nil {
				return errors.Wrap(err, "project "+p.ID)
			}
		}
	}
	// Data first, so pages that read it find it.
	order := seed.Artifacts
	sort.SliceStable(order, func(i, j int) bool { return order[i].Kind == "data" && order[j].Kind != "data" })
	pushed := 0
	viewers := map[string]string{}
	for _, art := range order {
		if existing, err := admin.Artifact(ctx, art.ID); err == nil && existing.Latest > 0 {
			fmt.Printf("%s exists (v%d), skipped\n", art.ID, existing.Latest)
			continue
		}
		for i, ver := range art.Versions {
			author, err := as(ver.By)
			if err != nil {
				return err
			}
			tree, err := uploadDir(ctx, author, filepath.Join(dir, "artifacts", art.ID, fmt.Sprintf("v%d", ver.N)))
			if err != nil {
				return err
			}
			req := client.PushRequest{Tree: tree, Manifest: ver.Manifest, Message: ver.Message, Via: ver.Via, Session: ver.Session}
			if i == 0 {
				req.Create = &client.CreateArtifact{Title: art.Title, Kind: art.Kind, Type: art.Type, Project: art.Project}
			} else {
				base := art.Versions[i-1].N
				req.Base = &base
			}
			if _, err = author.Push(ctx, art.ID, req); err != nil {
				return errors.Wrapf(err, "push %s v%d", art.ID, ver.N)
			}
			pushed++
		}
		if art.Viewer != "" {
			viewers[art.ID] = art.Viewer
		}
	}
	// Viewers name pages, which exist only now.
	for id, viewer := range viewers {
		if _, err = admin.PatchArtifact(ctx, id, map[string]any{"viewer": viewer}); err != nil {
			return errors.Wrap(err, "viewer of "+id)
		}
	}
	host := a.S("host")
	if host == "" && len(cfg.SiteHosts) > 0 {
		host = cfg.SiteHosts[0]
	}
	for _, r := range seed.Routes {
		if host == "" {
			break
		}
		if _, err = admin.SetRoute(ctx, client.Route{Host: host, Path: r.Path, Page: r.Page, Version: r.Version, Record: r.Record, Access: r.Access, Bindings: r.Bindings, Note: "dev seed"}); err != nil {
			return errors.Wrap(err, "route "+r.Path)
		}
	}
	for _, t := range seed.Threads {
		if len(t.Comments) == 0 {
			continue
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
	}
	fmt.Printf("seeded %d versions, %d routes on %s, %d threads\n", pushed, len(seed.Routes), host, len(seed.Threads))
	return nil
}

// uploadDir uploads a directory's files and returns its tree.
func uploadDir(ctx context.Context, api *client.Client, dir string) (map[string]string, error) {
	tree := map[string]string{}
	data := map[string][]byte{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		b, err := os.ReadFile(p) // #nosec G304 -- files of the seed directory
		if err != nil {
			return err
		}
		sum := blobs.Sum(b)
		tree[filepath.ToSlash(rel)] = sum
		data[sum] = b
		return nil
	})
	if err != nil {
		return nil, err
	}
	sums := make([]string, 0, len(data))
	for s := range data {
		sums = append(sums, s)
	}
	missing, err := api.MissingBlobs(ctx, sums)
	if err != nil {
		return nil, err
	}
	for _, s := range missing {
		if err = api.PutBlob(ctx, s, data[s]); err != nil {
			return nil, err
		}
	}
	return tree, nil
}
