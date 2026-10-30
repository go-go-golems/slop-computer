package cmds

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/credentials"
	"github.com/pkg/errors"
)

// defaultHost is --host, else the server's first site host.
func defaultHost(ctx context.Context, api *client.Client, a in) (string, error) {
	if h := a.S("host"); h != "" {
		return strings.ToLower(h), nil
	}
	cfg, err := api.Config(ctx)
	if err != nil {
		return "", err
	}
	if len(cfg.SiteHosts) == 0 {
		return "", errors.New("the server has no site hosts; pass --host")
	}
	return cfg.SiteHosts[0], nil
}

// pageRef parses artifact, artifact@main or artifact@7.
func pageRef(s string) (string, *int, error) {
	id, ver, found := strings.Cut(s, "@")
	if !found || ver == "main" {
		return id, nil, nil
	}
	n, err := strconv.Atoi(ver)
	if err != nil || n <= 0 {
		return "", nil, errors.Errorf("%q: write artifact, artifact@main or artifact@<version>", s)
	}
	return id, &n, nil
}

func hostFlag() *fields.Definition {
	return flag("host", "Site host of the route (default: the server's first site host)")
}

type routeListCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*routeListCmd)(nil)

func (c *routeListCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	rs, err := api.Routes(ctx, strings.ToLower(a.S("host")))
	if err != nil {
		return loginHint(err)
	}
	for _, r := range rs {
		ver := "main"
		if r.Version != nil {
			ver = "v" + strconv.Itoa(*r.Version)
		}
		b, _ := json.Marshal(r.Bindings)
		if err := out.AddRow(ctx, types.NewRow(types.MRP("host", r.Host), types.MRP("path", r.Path), types.MRP("page", r.Page), types.MRP("page_from", r.PageFrom), types.MRP("version", ver),
			types.MRP("record", r.Record), types.MRP("bindings", string(b)), types.MRP("access", r.Access))); err != nil {
			return err
		}
	}
	return nil
}

type routeSetCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*routeSetCmd)(nil)

func (c *routeSetCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	host, err := defaultHost(ctx, api, a)
	if err != nil {
		return err
	}
	page, ver, err := pageRef(a.S("page"))
	if err != nil {
		return err
	}
	r := client.Route{Host: host, Path: a.S("path"), Page: page, PageFrom: a.S("page-from"), Version: ver, Record: a.S("record"), Access: firstNonEmpty(a.S("access"), "public"), Note: a.S("note"),
		Live: a.B("live"), Create: a.S("create"), Bindings: map[string]client.Binding{}}
	for _, b := range a.L("bind") {
		name, ref, ok := strings.Cut(b, "=")
		if !ok {
			return errors.Errorf("--bind %q: write name=artifact[@version]", b)
		}
		id, n, err := pageRef(ref)
		if err != nil {
			return err
		}
		r.Bindings[name] = client.Binding{Artifact: id, Version: n}
	}
	before, _ := api.Routes(ctx, host)
	var prev *client.Route
	for i := range before {
		if before[i].Path == r.Path {
			prev = &before[i]
		}
	}
	if _, err = api.SetRoute(ctx, r); err != nil {
		return loginHint(err)
	}
	fmt.Printf("%s%s  %s → %s   (slop route undo %s goes back)\n", host, r.Path, describeRoute(prev), describeRoute(&r), r.Path)
	if r.PageFrom != "" && r.Access == "public" {
		if art, err := api.Artifact(ctx, r.Page); err == nil && art.Project != nil {
			fmt.Printf("Every page of project %s whose id fits %s is now public at %s%s.\n", *art.Project, r.PageFrom, host, r.Path)
		}
	}
	return nil
}

func describeRoute(r *client.Route) string {
	if r == nil {
		return "(none)"
	}
	if r.PageFrom != "" {
		return fmt.Sprintf("%s in %s's project, else %s@main", r.PageFrom, r.Page, r.Page)
	}
	out := r.Page + "@main"
	if r.Version != nil {
		out = fmt.Sprintf("%s v%d", r.Page, *r.Version)
	}
	if r.Live {
		t := r.Page
		if b, ok := r.Bindings["target"]; ok {
			t = b.Artifact
		}
		out += fmt.Sprintf(" live on %s for %s", t, firstNonEmpty(r.Access, "public"))
	}
	return out
}

type routeUndoCmd struct {
	*glazed.CommandDescription
	remove bool
}

var _ glazed.BareCommand = (*routeUndoCmd)(nil)

func (c *routeUndoCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	host, err := defaultHost(ctx, api, a)
	if err != nil {
		return err
	}
	if c.remove {
		if err = api.RemoveRoute(ctx, host, a.S("path")); err != nil {
			return loginHint(err)
		}
		fmt.Printf("%s%s removed (slop route undo %s brings it back)\n", host, a.S("path"), a.S("path"))
		return nil
	}
	r, err := api.UndoRoute(ctx, host, a.S("path"))
	if err != nil {
		return loginHint(err)
	}
	fmt.Printf("%s%s is now %s\n", host, a.S("path"), describeRoute(r))
	return nil
}

func routeCommands() []glazed.Command {
	common := append(serverFlags(), hostFlag())
	return []glazed.Command{
		&routeListCmd{glazed.NewCommandDescription("list", glazed.WithShort("List routes (all hosts unless --host)"), glazed.WithFlags(common...))},
		&routeSetCmd{glazed.NewCommandDescription("set", glazed.WithShort("Point a path at a page: artifact (follows main) or artifact@<version>"),
			glazed.WithLong("Examples:\n  slop route set /pricing pricing@7\n  slop route set /journal/:slug journal-post --record 'posts/{slug}.md' --bind posts=journal\n"+
				"  slop route set /r/:page release-missing --page-from '{page}'\n"+
				"  slop route set /blocks/team blocks --bind target=ws-team --live --access admins\n\n"+
				"--live runs the page, an app, against its target (--bind target=…, else the page itself) on the\n"+
				"site: the site serves a shell that opens the app for whoever --access admits (admins, signed-in,\n"+
				"or public). See slop help live-sites.\n\n"+
				"--page-from serves the page a template names, filled from the path's :params, among the pages of\n"+
				"the given page's project; the given page is served (404) when it names none. Every page of that\n"+
				"project whose id fits the template becomes public on the host."),
			glazed.WithFlags(append(common, arg("path", "Path pattern: /, *, /a/:param, /a/*"), arg("page", "artifact, artifact@main or artifact@<version>"),
				flag("record", "Record pattern filled from params, e.g. posts/{slug}.md"),
				flag("page-from", "Page template filled from params, e.g. {page} or release-{page}; page is then the else page"),
				list("bind", "Data binding name=artifact[@version] (repeatable)"),
				boolean("live", "Run the app live against its target on the site (see slop help live-sites)"),
				flag("access", "public (default), signed-in (live routes) or admins"),
				flag("create", "Live routes whose target comes from the path: who may create an instance (admins, signed-in, public)"),
				flag("note", "Why, for the route log"))...))},
		&routeUndoCmd{glazed.NewCommandDescription("undo", glazed.WithShort("Restore a route to its state before its last change"),
			glazed.WithFlags(append(common, arg("path", "Path pattern"))...)), false},
		&routeUndoCmd{glazed.NewCommandDescription("rm", glazed.WithShort("Remove a route"),
			glazed.WithFlags(append(common, arg("path", "Path pattern"))...)), true},
	}
}

// cursorFile remembers, per server and filter, the last comment event an
// agent has seen, so comments made while it worked are not missed.
func cursorFile() (string, error) {
	d, err := credentials.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "cursors.json"), nil
}

func loadCursors() map[string]int64 {
	out := map[string]int64{}
	if p, err := cursorFile(); err == nil {
		if b, err := os.ReadFile(p); err == nil { // #nosec G304 -- the user's own config file
			_ = json.Unmarshal(b, &out)
		}
	}
	return out
}

func saveCursor(key string, seq int64) {
	p, err := cursorFile()
	if err != nil {
		return
	}
	all := loadCursors()
	all[key] = seq
	b, _ := json.MarshalIndent(all, "", "  ")
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	_ = os.WriteFile(p, b, 0o600)
}

type waitCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*waitCmd)(nil)

func (c *waitCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	project, artifact := a.S("project"), a.S("artifact")
	key := api.Server() + "|" + project + "|" + artifact
	after := int64(a.I("after"))
	if after == 0 && !a.B("from-now") {
		after = loadCursors()[key]
	}
	deadline := time.Time{}
	if t := a.I("timeout"); t > 0 {
		deadline = time.Now().Add(time.Duration(t) * time.Second)
	}
	for {
		poll := 55
		if !deadline.IsZero() {
			left := int(time.Until(deadline).Seconds())
			if left <= 0 {
				fmt.Fprintln(os.Stderr, "no comments before the timeout")
				os.Exit(2)
			}
			poll = min(poll, left)
		}
		res, ok, err := api.WaitComments(ctx, project, artifact, after, poll)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if client.IsCode(err, "token_invalid") || client.IsCode(err, "token_scope") || client.IsCode(err, "admin_required") {
				return loginHint(err)
			}
			fmt.Fprintln(os.Stderr, "slop: "+err.Error()+"; retrying")
			time.Sleep(2 * time.Second)
			continue
		}
		if !ok {
			continue
		}
		saveCursor(key, res.Seq)
		if a.B("json") {
			b, _ := json.Marshal(res)
			fmt.Println(string(b))
			return nil
		}
		printWait(res)
		return nil
	}
}

// printWait shows a comment so that an agent can act on it.
func printWait(res client.WaitResult) {
	t := res.Thread
	last := t.Comments[len(t.Comments)-1]
	fmt.Printf("thread %s on %s v%d (%d comments)\n", t.ID, t.Artifact, t.Version, len(t.Comments))
	for _, c := range t.Comments {
		who := c.By
		if c.Agent {
			who += " (agent)"
		}
		fmt.Printf("  %s: %s\n", who, c.Text)
	}
	var anchor map[string]any
	if json.Unmarshal(t.Anchor, &anchor) == nil && len(anchor) > 0 {
		if s, ok := anchor["selector"]; ok {
			fmt.Printf("anchor: %v", s)
			if box, ok := anchor["box"]; ok {
				fmt.Printf("  box %v", box)
			}
			fmt.Println()
		}
		if rec, ok := anchor["record"]; ok {
			fmt.Printf("record: %v %v\n", rec, anchor["field"])
		}
		if styles, ok := anchor["styles"].(map[string]any); ok {
			parts := []string{}
			for k, v := range styles {
				if s, _ := v.(string); s != "" && s != "normal" && s != "0px" {
					parts = append(parts, k+"="+s)
				}
			}
			fmt.Println("computed styles: " + strings.Join(parts, " "))
		}
	}
	fmt.Printf("newest: %q\nreply with: slop push <folder> -a %s -m \"…\" --reply %s   or   slop comments reply %s \"…\"\n", last.Text, t.Artifact, t.ID, t.ID)
}

type replyCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*replyCmd)(nil)

func (c *replyCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	var ver *int
	if n := a.I("version"); n > 0 {
		ver = &n
	}
	t, err := api.ReplyThread(ctx, a.S("thread"), a.S("text"), ver)
	if err != nil {
		return loginHint(err)
	}
	if a.B("resolve") {
		if _, err = api.ResolveThread(ctx, t.ID, true); err != nil {
			return err
		}
	}
	fmt.Printf("replied on %s (%d comments)\n", t.ID, len(t.Comments)+1)
	return nil
}

type threadsCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*threadsCmd)(nil)

func (c *threadsCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	ts, err := api.Threads(ctx, a.S("artifact"), a.S("project"), a.B("open"))
	if err != nil {
		return loginHint(err)
	}
	for _, t := range ts {
		first, last := t.Comments[0], t.Comments[len(t.Comments)-1]
		if err := out.AddRow(ctx, types.NewRow(types.MRP("thread", t.ID), types.MRP("artifact", t.Artifact), types.MRP("version", t.Version),
			types.MRP("by", first.By), types.MRP("text", first.Text), types.MRP("comments", len(t.Comments)), types.MRP("last", last.Text), types.MRP("resolved", t.Resolved))); err != nil {
			return err
		}
	}
	return nil
}

func commentCommands() []glazed.Command {
	filter := []*fields.Definition{
		fields.New("project", fields.TypeString, fields.WithShortFlag("p"), fields.WithHelp("Only this project")),
		fields.New("artifact", fields.TypeString, fields.WithShortFlag("a"), fields.WithHelp("Only this artifact")),
	}
	return []glazed.Command{
		&waitCmd{glazed.NewCommandDescription("wait", glazed.WithShort("Block until someone comments, print the thread and exit"),
			glazed.WithLong("Ignores comments written with this token (an agent's own replies). Remembers where it stopped, per server and filter, "+
				"so comments made while you worked are returned by the next wait. Exit status 2 on --timeout."),
			glazed.WithFlags(append(append(serverFlags(), filter...),
				boolean("json", "Print the thread as JSON"),
				integer("timeout", 0, "Give up after this many seconds (default: wait forever)"),
				integer("after", 0, "Start after this event seq instead of the remembered cursor"),
				boolean("from-now", "Ignore the remembered cursor and wait for new comments only"))...))},
		&replyCmd{glazed.NewCommandDescription("reply", glazed.WithShort("Reply on a thread"),
			glazed.WithFlags(append(serverFlags(), arg("thread", "Thread id"), arg("text", "Reply"),
				integer("version", 0, "The version this reply is about"), boolean("resolve", "Also resolve the thread"))...))},
		&threadsCmd{glazed.NewCommandDescription("list", glazed.WithShort("List comment threads"),
			glazed.WithFlags(append(append(serverFlags(), filter...), boolean("open", "Only unresolved threads"))...))},
	}
}

type projectsCmd struct {
	*glazed.CommandDescription
	put bool
}

var _ glazed.GlazeCommand = (*projectsCmd)(nil)

func (c *projectsCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	var ps []client.Project
	if c.put {
		p, err := api.PutProject(ctx, client.Project{ID: a.S("id"), Name: firstNonEmpty(a.S("name"), a.S("id")), Brief: a.S("brief")})
		if err != nil {
			return loginHint(err)
		}
		ps = []client.Project{p}
	} else if ps, err = api.Projects(ctx); err != nil {
		return loginHint(err)
	}
	for _, p := range ps {
		if err := out.AddRow(ctx, types.NewRow(types.MRP("id", p.ID), types.MRP("name", p.Name), types.MRP("brief", p.Brief))); err != nil {
			return err
		}
	}
	return nil
}

func projectCommands() []glazed.Command {
	return []glazed.Command{
		&projectsCmd{glazed.NewCommandDescription("list", glazed.WithShort("List projects"), glazed.WithFlags(serverFlags()...)), false},
		&projectsCmd{glazed.NewCommandDescription("put", glazed.WithShort("Create or update a project"),
			glazed.WithFlags(append(serverFlags(), arg("id", "Project id"), flag("name", "Name"), flag("brief", "Brief every agent reads"))...)), true},
	}
}
