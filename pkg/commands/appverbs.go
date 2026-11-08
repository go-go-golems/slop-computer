package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/appverbs"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// App verbs (SLOP3-016): an app may ship command-line verbs, JavaScript files
// its manifest lists under slop.verbs. app.verbs hands their sources to
// anyone who can view a store that runs the app, at the snapshot the store
// runs, so the CLI can scan them (go-go-goja jsverbs) and run them as the
// person. The app's own store need not be readable by them.
//
// app.verb runs one of them here instead, with its values as JSON (MCP
// clients and agents cannot run JavaScript): the same function and slop
// module, whose calls go to the verb table as the caller. app.tools lists
// them as MCP tools, once per app.

const (
	maxVerbFiles  = 200
	maxVerbBytes  = 2 << 20
	maxVerbLogs   = 64 << 10
	maxToolStores = 200 // stores app.tools looks at
)

// AppVerbTimeout bounds one app.verb, wall time: the verb's own JavaScript
// and the calls it waits on. A verb that asks the board's agent waits for
// the model (actor sample: up to 3 minutes), so this is longer than that.
var AppVerbTimeout = 4 * time.Minute

// AppVerbsIn is app.verbs's input.
type AppVerbsIn struct {
	Store string `json:"store" slop:"pos=1"`
	Have  string `json:"have,omitempty" jsonschema_description:"the app@snapshot the caller has cached; the answer is then unchanged: true when it still runs that"`
}

// AppVerbFile is one source file of an app's verbs.
type AppVerbFile struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}

// AppVerbsOut is app.verbs's answer.
type AppVerbsOut struct {
	Store     string        `json:"store"`
	Type      string        `json:"type,omitempty"`
	App       string        `json:"app"`
	Snapshot  int64         `json:"snapshot"`
	Alias     string        `json:"alias,omitempty"`
	Title     string        `json:"title,omitempty"`
	Include   []string      `json:"include,omitempty"`
	Unchanged bool          `json:"unchanged,omitempty"`
	Files     []AppVerbFile `json:"files"`
}

// AppVerbIn is app.verb's input.
type AppVerbIn struct {
	Store  string         `json:"store" slop:"pos=1"`
	Verb   string         `json:"verb" slop:"pos=2" jsonschema_description:"the verb's words, such as \"clip add\""`
	Values map[string]any `json:"values,omitempty" jsonschema_description:"the verb's fields by their flag names, such as {\"url\": \"https://…\", \"tags\": [\"a\"]}"`
	Alias  string         `json:"alias,omitempty" jsonschema_description:"refuse unless the store's app has this alias (MCP tools pass it)"`
}

// AppVerbOut is app.verb's answer.
type AppVerbOut struct {
	Result any      `json:"result"`
	Output string   `json:"output,omitempty" jsonschema_description:"glaze (the result is rows) or text"`
	Logs   []string `json:"logs,omitempty"`
}

// AppToolsIn is app.tools's input.
type AppToolsIn struct{}

// AppTool is one app verb as an MCP tool.
type AppTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	App         string         `json:"app"`
	Alias       string         `json:"alias"`
	Verb        string         `json:"verb"`
}

// AppToolsOut is app.tools's answer.
type AppToolsOut struct {
	Tools []AppTool `json:"tools"`
}

func appVerbs(e appVerbsEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[AppVerbsIn, AppVerbsOut]{Name: "app.verbs", Doc: "The command-line verbs of the app a store runs: their sources at the snapshot it runs (slop on <store> runs them).", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "store",
			Run: func(req verbs.Req, in AppVerbsIn) (AppVerbsOut, error) {
				return e.verbSources(req.Context, req.Principal, in.Store, in.Have)
			}}.Verb(),
		verbs.Def[AppVerbIn, AppVerbOut]{Name: "app.verb", Doc: "Run one of the command-line verbs of the app a store runs, here, as you, with its values as JSON (what MCP tools named <alias>_<group>_<verb> do).", Scope: verbs.Read, Effect: verbs.EffectWrite, Action: authz.StoreRead, StoreArg: "store",
			Run: func(req verbs.Req, in AppVerbIn) (AppVerbOut, error) {
				return e.runVerb(req.Context, req.Principal, in)
			}}.Verb(),
		verbs.Def[AppToolsIn, AppToolsOut]{Name: "app.tools", Doc: "The command-line verbs of the apps your stores run, as MCP tools: one per verb and app, each taking the store.", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, _ AppToolsIn) (AppToolsOut, error) {
				return e.tools(req.Context, req.Principal)
			}}.Verb(),
	}
}

// verbSources is app.verbs: the verb files of the snapshot store runs.
func (e appVerbsEnv) verbSources(ctx context.Context, p *access.Principal, store, have string) (AppVerbsOut, error) {
	st, _, err := e.open(ctx, p, store, rt.LevelView, "reading the app's verbs")
	if err != nil {
		return AppVerbsOut{}, err
	}
	run, err := e.K.Running(ctx, store)
	if err != nil {
		return AppVerbsOut{}, err
	}
	out := AppVerbsOut{Store: store, Type: st.Meta("type"), App: run.App, Snapshot: run.N, Files: []AppVerbFile{}}
	if run.N == 0 || run.Manifest == nil || run.Manifest.Slop.Verbs == nil {
		return out, nil
	}
	v := run.Manifest.Slop.Verbs
	out.Alias, out.Title, out.Include = v.Alias, v.Title, v.Include
	if have != "" && have == out.App+"@"+strconv.FormatInt(out.Snapshot, 10) {
		out.Unchanged = true
		return out, nil
	}
	files, err := e.verbFiles(ctx, run)
	if err != nil {
		return AppVerbsOut{}, err
	}
	out.Files = files
	return out, nil
}

// verbFiles reads the files the manifest's include names from the
// snapshot a store runs, as the platform (the app's store may be private).
func (e appVerbsEnv) verbFiles(ctx context.Context, run kernel.Running) ([]AppVerbFile, error) {
	include := run.Manifest.Slop.Verbs.Include
	as, err := e.K.Store(ctx, run.App)
	if err != nil {
		return nil, err
	}
	files, err := as.SnapshotFiles(ctx, run.N)
	if err != nil {
		return nil, err
	}
	out := []AppVerbFile{}
	total := 0
	for _, f := range files {
		if !matchesAny(include, f.Path) {
			continue
		}
		if len(out) == maxVerbFiles {
			return nil, verbs.Errf("resource_exhausted", "%s ships more than %d verb files", run.App, maxVerbFiles)
		}
		b, err := as.ReadFile(f)
		if err != nil {
			return nil, err
		}
		if total += len(b); total > maxVerbBytes {
			return nil, verbs.Errf("resource_exhausted", "%s's verb files are over %d bytes", run.App, maxVerbBytes)
		}
		out = append(out, AppVerbFile{Path: f.Path, Source: string(b)})
	}
	return out, nil
}

// source is a store's verbs as appverbs takes them.
func source(o AppVerbsOut) *appverbs.Source {
	src := &appverbs.Source{Store: o.Store, Type: o.Type, App: o.App, Snapshot: o.Snapshot, Alias: o.Alias, Title: o.Title, Include: o.Include}
	for _, f := range o.Files {
		src.Files = append(src.Files, appverbs.File{Path: f.Path, Source: f.Source})
	}
	return src
}

// runVerb is app.verb.
func (e appVerbsEnv) runVerb(ctx context.Context, p *access.Principal, in AppVerbIn) (AppVerbOut, error) {
	o, err := e.verbSources(ctx, p, in.Store, "")
	if err != nil {
		return AppVerbOut{}, err
	}
	if len(o.Files) == 0 {
		return AppVerbOut{}, verbs.Errf("not_found", "%s runs %s, which ships no verbs", in.Store, orNone(o.App))
	}
	if in.Alias != "" && in.Alias != o.Alias {
		return AppVerbOut{}, verbs.Errf("invalid_argument", "%s runs %s, not the app whose verbs are %s_…", in.Store, o.App, in.Alias)
	}
	reg, err := e.Cache.Get(source(o))
	if err != nil {
		return AppVerbOut{}, verbs.Errf("app_error", "%s's verbs: %v", o.App, err)
	}
	verb, ok := reg.Verb(strings.Join(strings.Fields(in.Verb), " "))
	if !ok {
		return AppVerbOut{}, verbs.Errf("not_found", "%s has no verb %q", o.App, in.Verb)
	}
	inner := *p
	if inner.Via == "" {
		inner.Via = "verb"
	}
	b := appverbs.Board{ID: in.Store, Type: o.Type, App: o.App, Via: inner.Via}
	if o.Title != "" {
		b.Title = e.title(ctx, &inner, in.Store, o.Title)
	}
	logs := &lineBuffer{max: maxVerbLogs}
	res, err := appverbs.Run(ctx, reg, verb.FullPath(), in.Values, tableCaller{ctx: ctx, p: &inner, t: e.Table}, b, logs, AppVerbTimeout)
	if err != nil {
		ve := verbs.AsError(err)
		if ve.Code == "internal" {
			ve = &verbs.Error{Code: "app_error", Message: err.Error()}
		}
		if l := logs.lines(); len(l) > 0 {
			ve.Extra = map[string]any{"logs": l}
		}
		return AppVerbOut{}, ve
	}
	return AppVerbOut{Result: res, Output: verb.OutputMode, Logs: logs.lines()}, nil
}

// title reads the "title" field of a store's document as the caller.
func (e appVerbsEnv) title(ctx context.Context, p *access.Principal, store, path string) string {
	res, err := e.Table.Call(ctx, p, "docs.get", verbs.Args{"store": store, "path": path})
	if err != nil {
		return ""
	}
	var d struct {
		Body struct {
			Title string `json:"title"`
		} `json:"body"`
	}
	if b, err := json.Marshal(res); err == nil {
		_ = json.Unmarshal(b, &d)
	}
	return d.Body.Title
}

// tools is app.tools: one tool per verb of each app with an alias among
// the stores the caller can see (the newest snapshot any of them runs).
func (e appVerbsEnv) tools(ctx context.Context, p *access.Principal) (AppToolsOut, error) {
	out := AppToolsOut{Tools: []AppTool{}}
	rows, err := e.K.VisibleStores(ctx, p)
	if err != nil {
		return out, err
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt > rows[j].CreatedAt })
	if len(rows) > maxToolStores {
		rows = rows[:maxToolStores]
	}
	taken := map[string]bool{} // verb groups: an alias must not shadow store_…, docs_…
	for _, v := range e.Table.All() {
		taken[v.Group()] = true
	}
	type app struct {
		run   kernel.Running
		store string
		typ   string
	}
	apps := map[string]app{}
	for _, r := range rows {
		if d := e.K.Access.Level(ctx, p, r); d.Level < rt.LevelView {
			continue
		}
		run, err := e.K.Running(ctx, r.ID)
		if err != nil || run.N == 0 || run.Manifest == nil || run.Manifest.Slop.Verbs == nil || run.Manifest.Slop.Verbs.Alias == "" {
			continue
		}
		if taken[run.Manifest.Slop.Verbs.Alias] {
			continue
		}
		if a, ok := apps[run.App]; !ok || run.N > a.run.N {
			apps[run.App] = app{run: run, store: r.ID, typ: r.Type}
		}
	}
	names := make([]string, 0, len(apps))
	for n := range apps {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		a := apps[n]
		key := a.run.App + "@" + strconv.FormatInt(a.run.N, 10)
		reg := e.Cache.Lookup(key)
		if reg == nil {
			files, err := e.verbFiles(ctx, a.run)
			if err != nil {
				continue
			}
			src := source(AppVerbsOut{Store: a.store, App: a.run.App, Snapshot: a.run.N, Files: files})
			if reg, err = e.Cache.Get(src); err != nil {
				continue // an app whose verbs do not scan lists none
			}
		}
		alias := a.run.Manifest.Slop.Verbs.Alias
		what := orNone(a.typ)
		storeArg := map[string]any{"store": map[string]any{"type": "string", "description": "the id of the " + what + " store to run it on (slop store ls lists yours)"}}
		for _, v := range reg.Verbs() {
			schema, err := appverbs.InputSchema(reg, v, storeArg, "store")
			if err != nil {
				continue
			}
			desc := v.Short
			if desc == "" {
				desc = v.FullPath()
			}
			out.Tools = append(out.Tools, AppTool{Name: appverbs.ToolName(alias, v), Description: desc + " (" + a.run.App + " app, on a " + what + " store)",
				InputSchema: schema, App: a.run.App, Alias: alias, Verb: v.FullPath()})
		}
	}
	return out, nil
}

func orNone(s string) string {
	if s == "" {
		return "no app"
	}
	return s
}

// tableCaller is the slop module's caller on the server: each call is a
// verb call as the caller, its result as the CLI would decode it.
type tableCaller struct {
	ctx context.Context
	p   *access.Principal
	t   *verbs.Table
}

func (c tableCaller) Call(verb string, args map[string]any) (any, error) {
	res, err := c.t.Call(c.ctx, c.p, verb, verbs.Args(args))
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(res)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var out any
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// lineBuffer keeps what a verb prints, up to max bytes.
type lineBuffer struct {
	mu   sync.Mutex
	max  int
	n    int
	buf  bytes.Buffer
	full bool
}

func (l *lineBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.n+len(p) > l.max {
		if !l.full {
			l.full = true
			l.buf.WriteString(fmt.Sprintf("… (output over %d bytes dropped)\n", l.max))
		}
		return len(p), nil
	}
	l.n += len(p)
	return l.buf.Write(p)
}

func (l *lineBuffer) lines() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := strings.TrimRight(l.buf.String(), "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

func matchesAny(globs []string, p string) bool {
	for _, g := range globs {
		if ok, _ := doublestar.Match(g, p); ok {
			return true
		}
	}
	return false
}
