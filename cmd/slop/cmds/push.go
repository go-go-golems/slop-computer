package cmds

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/pkg/errors"
	"golang.org/x/sync/errgroup"
)

type pushCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*pushCmd)(nil)

func newPush() *pushCmd {
	return &pushCmd{glazed.NewCommandDescription("push",
		glazed.WithShort("Push a folder as a new version of an artifact"),
		glazed.WithLong("Every file of the folder becomes the new version's tree (except dotfiles, node_modules and slop.json, "+
			"which is the version's manifest: reads, tokens, title, kind, type, project). Only files the server lacks are uploaded. "+
			"The push is refused when main moved since the folder's base; pull, or pass --force. "+
			"--watch pushes again on every change until interrupted.\n\n"+
			"Example: slop push ./pricing -a pricing -m \"tiers: gap 48 → 24px\" --reply th_8k2 --reply-text \"Done in this version\""),
		glazed.WithFlags(append(serverFlags(),
			fields.New("dir", fields.TypeString, fields.WithIsArgument(true), fields.WithDefault("."), fields.WithHelp("Folder to push")),
			fields.New("artifact", fields.TypeString, fields.WithShortFlag("a"), fields.WithHelp("Artifact id (default: slop.json, then the folder's last push/pull)")),
			fields.New("message", fields.TypeString, fields.WithShortFlag("m"), fields.WithHelp("What changed")),
			flag("reply", "Thread to reply on with this version"),
			flag("reply-text", "Reply text (default: the message)"),
			flag("session", "Work session label (default: $SLOP_SESSION)"),
			flag("title", "Title, when the push creates the artifact (default: slop.json, then the id)"),
			flag("kind", "page or data, when the push creates the artifact (default: slop.json, then page if index.html exists)"),
			flag("type", "Data type (post, records, tokens), when the push creates a data artifact"),
			flag("project", "Project, when the push creates the artifact"),
			boolean("force", "Push even if main moved since the folder's base"),
			boolean("no-main", "Do not move main to the new version"),
			boolean("watch", "Keep watching the folder and push on every change"),
		)...))}
}

// via is "claude" when Claude Code runs the command.
// via says what pushed: SLOP_VIA=agent|claude for coding agents (Claude
// Code sets CLAUDECODE=1 itself), else a person at the CLI.
func via() string {
	switch v := os.Getenv("SLOP_VIA"); v {
	case "agent", "claude":
		return v
	}
	if os.Getenv("CLAUDECODE") == "1" {
		return "claude"
	}
	return "cli"
}

func (c *pushCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	dir := a.S("dir")
	if a.B("watch") {
		return watchPush(ctx, dir, func() error { _, err := pushOnce(ctx, api, a, dir); return err })
	}
	res, err := pushOnce(ctx, api, a, dir)
	if err != nil {
		return err
	}
	_ = res
	return nil
}

// pushOnce pushes dir and prints one line about it.
func pushOnce(ctx context.Context, api *client.Client, a in, dir string) (client.PushResult, error) {
	f, err := readFolder(dir)
	if err != nil {
		return client.PushResult{}, err
	}
	st, _ := readState(dir)
	id := firstNonEmpty(a.S("artifact"), f.Meta.Artifact, st.Artifact)
	if id == "" {
		return client.PushResult{}, errors.New("name the artifact with -a, or put \"artifact\" in slop.json")
	}
	if st.Artifact != id {
		st = folderState{Artifact: id}
	}
	// Upload what the server does not have.
	sums := make([]string, 0, len(f.Sums))
	bySum := map[string]string{}
	for p, s := range f.Sums {
		sums = append(sums, s)
		bySum[s] = p
	}
	missing, err := api.MissingBlobs(ctx, sums)
	if err != nil {
		return client.PushResult{}, loginHint(err)
	}
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(4)
	var uploaded int64
	for _, s := range missing {
		data := f.Files[bySum[s]]
		uploaded += int64(len(data))
		g.Go(func() error { return api.PutBlob(gctx, s, data) })
	}
	if err = g.Wait(); err != nil {
		return client.PushResult{}, errors.Wrap(err, "upload")
	}
	req := client.PushRequest{Tree: f.Sums, Manifest: f.Manifest, Message: a.S("message"), Via: via(),
		Session: firstNonEmpty(a.S("session"), os.Getenv("SLOP_SESSION")), Force: a.B("force")}
	if st.Base > 0 {
		base := st.Base
		req.Base = &base
	} else if art, err := api.Artifact(ctx, id); err == nil && art.Main > 0 {
		// A folder that was never pulled pushes on top of main.
		base := art.Main
		req.Base = &base
	}
	if a.B("no-main") {
		no := false
		req.MoveMain = &no
	}
	if t := a.S("reply"); t != "" {
		req.Reply = &client.Reply{Thread: t, Text: firstNonEmpty(a.S("reply-text"), a.S("message"), "Done in this version.")}
	}
	kind := firstNonEmpty(a.S("kind"), f.Meta.Kind)
	if kind == "" {
		kind = "data"
		if _, ok := f.Files["index.html"]; ok {
			kind = "page"
		}
	}
	project := f.Meta.Project
	if p := a.S("project"); p != "" {
		project = &p
	}
	req.Create = &client.CreateArtifact{Title: firstNonEmpty(a.S("title"), f.Meta.Title, id), Kind: kind, Type: firstNonEmpty(a.S("type"), f.Meta.Type), Project: project}
	res, err := api.Push(ctx, id, req)
	if client.IsCode(err, "main_moved") {
		return res, errors.Errorf("%s: main moved since this folder's base; slop pull %s %s (overwrites your edits), or push --force", id, id, dir)
	}
	if err != nil {
		return res, loginHint(err)
	}
	if req.MoveMain == nil || *req.MoveMain {
		st.Base = res.Version.N
	} else if req.Base != nil {
		st.Base = *req.Base
	}
	st.Server = api.Server()
	if err = writeState(dir, st); err != nil {
		return res, err
	}
	if res.Unchanged {
		fmt.Printf("%s unchanged · main is v%d\n", id, res.Version.N)
		return res, nil
	}
	var size int64
	for _, b := range f.Files {
		size += int64(len(b))
	}
	created := ""
	if res.Created {
		created = " (new artifact)"
	}
	replied := ""
	if req.Reply != nil {
		replied = " · replied on " + req.Reply.Thread
	}
	fmt.Printf("pushed %s v%d%s · %d files · %s · %d uploaded%s · %s/watch/%s/%d\n", id, res.Version.N, created, len(f.Files), humanSize(size), len(missing), replied,
		api.Server(), id, res.Version.N)
	for _, w := range res.Warnings {
		fmt.Fprintln(os.Stderr, "warning: "+w)
	}
	return res, nil
}

// watchPush runs push now and after every change (debounced).
func watchPush(ctx context.Context, dir string, push func() error) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer func() { _ = w.Close() }()
	add := func() error {
		return filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(dir, p)
			if d.IsDir() {
				if skipped(rel, d) {
					return filepath.SkipDir
				}
				return w.Add(p)
			}
			return nil
		})
	}
	if err = add(); err != nil {
		return err
	}
	if err = push(); err != nil {
		fmt.Fprintln(os.Stderr, "slop: "+err.Error())
	}
	fmt.Fprintln(os.Stderr, "watching "+dir+" (Ctrl-C to stop)")
	var timer <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			if strings.Contains(filepath.ToSlash(ev.Name), "/.slop/") {
				continue
			}
			if ev.Op&fsnotify.Create != 0 {
				_ = add()
			}
			timer = time.After(300 * time.Millisecond)
		case err := <-w.Errors:
			fmt.Fprintln(os.Stderr, "slop: watch: "+err.Error())
		case <-timer:
			timer = nil
			if err := push(); err != nil {
				fmt.Fprintln(os.Stderr, "slop: "+err.Error())
			}
		}
	}
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%d KB", n>>10)
	}
	return fmt.Sprintf("%d B", n)
}

type pullCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*pullCmd)(nil)

func newPull() *pullCmd {
	return &pullCmd{glazed.NewCommandDescription("pull",
		glazed.WithShort("Write a version of an artifact into a folder"),
		glazed.WithLong("Writes every file of the version, its manifest as slop.json, and remembers the version as the base of the next push. "+
			"Files in the folder that the version does not have are left alone."),
		glazed.WithFlags(append(serverFlags(),
			arg("artifact", "Artifact id"),
			optArg("dir", "Folder (default: the artifact id)"),
			integer("version", 0, "Version number (default: main)"),
		)...))}
}

func (c *pullCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	id := a.S("artifact")
	dir := firstNonEmpty(a.S("dir"), id)
	art, err := api.Artifact(ctx, id)
	if err != nil {
		return loginHint(err)
	}
	ver, err := api.Version(ctx, id, a.I("version"))
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(ver.Files))
	for p := range ver.Files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		target := filepath.Join(dir, filepath.FromSlash(p))
		if err = os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		out, err := os.Create(target) // #nosec G304 -- paths come from the server, validated there (no .., no leading /)
		if err != nil {
			return err
		}
		_, err = api.File(ctx, id, ver.N, p, out)
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return errors.Wrap(err, p)
		}
	}
	manifest := map[string]any{}
	if len(ver.Manifest) > 0 {
		_ = json.Unmarshal(ver.Manifest, &manifest)
	}
	manifest["artifact"], manifest["title"], manifest["kind"] = id, art.Title, art.Kind
	if art.Type != "" {
		manifest["type"] = art.Type
	}
	if art.Project != nil {
		manifest["project"] = *art.Project
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")
	if err = os.WriteFile(filepath.Join(dir, "slop.json"), append(b, '\n'), 0o600); err != nil {
		return err
	}
	if err = writeState(dir, folderState{Server: api.Server(), Artifact: id, Base: ver.N}); err != nil {
		return err
	}
	fmt.Printf("pulled %s v%d into %s · %d files (main is v%d)\n", id, ver.N, dir, len(paths), art.Main)
	return nil
}

type artifactsCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*artifactsCmd)(nil)

func (c *artifactsCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	list, err := api.Artifacts(ctx, a.S("project"))
	if err != nil {
		return loginHint(err)
	}
	for _, x := range list {
		project := ""
		if x.Project != nil {
			project = *x.Project
		}
		if err := out.AddRow(ctx, types.NewRow(types.MRP("id", x.ID), types.MRP("title", x.Title), types.MRP("kind", x.Kind),
			types.MRP("type", x.Type), types.MRP("project", project), types.MRP("main", x.Main), types.MRP("latest", x.Latest))); err != nil {
			return err
		}
	}
	return nil
}
