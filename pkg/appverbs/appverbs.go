// Package appverbs runs an app's command-line verbs (SLOP3-016).
//
// An app lists JavaScript files under slop.verbs in its manifest. The CLI
// fetches their sources with app.verbs (from any store that runs the app, as
// anyone who may view that store), scans them with go-go-goja's jsverbs
// (goja's parser, no cgo), builds Glazed commands, and runs a verb in a goja
// runtime inside the CLI. The runtime has one native module, slop, scoped to
// the one store the command was run on: every call it makes is a verb call
// with the person's token, so the store's rules and the person's level apply
// exactly as for the page. Verbs reach no file system, process or network.
package appverbs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/require"
	glazedcli "github.com/go-go-golems/glazed/pkg/cli"
	"github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/go-go-goja/pkg/jsverbs"
	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Caller calls a server verb as the person (pkg/client.Client does).
type Caller interface {
	Call(verb string, args map[string]any) (any, error)
}

// File is one source file of an app's verbs.
type File struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}

// Source is what app.verbs answers for a store.
type Source struct {
	Store     string   `json:"store"`
	Type      string   `json:"type,omitempty"`
	App       string   `json:"app"`
	Snapshot  int64    `json:"snapshot"`
	Alias     string   `json:"alias,omitempty"`
	Title     string   `json:"title,omitempty"`
	Include   []string `json:"include,omitempty"`
	Unchanged bool     `json:"unchanged,omitempty"`
	Files     []File   `json:"files"`
}

// Key is the cache key of a source: app@snapshot.
func (s *Source) Key() string { return fmt.Sprintf("%s@%d", s.App, s.Snapshot) }

var safeName = regexp.MustCompile(`[^A-Za-z0-9._@-]+`)

// Fetch returns the verb sources of the app a store runs. With a cache
// directory, the sources of each app@snapshot are kept there and app.verbs
// only confirms that the store still runs that snapshot.
func Fetch(c Caller, store, cacheDir string) (*Source, error) {
	have := ""
	var cached *Source
	if cacheDir != "" {
		if b, err := os.ReadFile(filepath.Join(cacheDir, "stores", safeName.ReplaceAllString(store, "_"))); err == nil {
			have = strings.TrimSpace(string(b))
			cached = readCached(cacheDir, have)
			if cached == nil {
				have = ""
			}
		}
	}
	args := map[string]any{"store": store}
	if have != "" {
		args["have"] = have
	}
	res, err := c.Call("app.verbs", args)
	if err != nil {
		return nil, err
	}
	var src Source
	if err := remarshal(res, &src); err != nil {
		return nil, fmt.Errorf("app.verbs: %w", err)
	}
	if src.Unchanged && cached != nil {
		cached.Store = store
		return cached, nil
	}
	if cacheDir != "" && src.Snapshot > 0 {
		writeCached(cacheDir, store, &src)
	}
	return &src, nil
}

func readCached(dir, key string) *Source {
	b, err := os.ReadFile(filepath.Join(dir, "apps", safeName.ReplaceAllString(key, "_")+".json"))
	if err != nil {
		return nil
	}
	var s Source
	if json.Unmarshal(b, &s) != nil || s.Key() != key {
		return nil
	}
	return &s
}

func writeCached(dir, store string, s *Source) {
	_ = os.MkdirAll(filepath.Join(dir, "apps"), 0o700)
	_ = os.MkdirAll(filepath.Join(dir, "stores"), 0o700)
	if b, err := json.Marshal(s); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "apps", safeName.ReplaceAllString(s.Key(), "_")+".json"), b, 0o600)
	}
	_ = os.WriteFile(filepath.Join(dir, "stores", safeName.ReplaceAllString(store, "_")), []byte(s.Key()), 0o600)
}

// Scan reads a source's files into a jsverbs registry. Only functions with
// __verb__ metadata become commands; the other files (shared code such as
// core.js) are there for require().
func Scan(src *Source) (*jsverbs.Registry, error) {
	files := make([]jsverbs.SourceFile, 0, len(src.Files))
	for _, f := range src.Files {
		files = append(files, jsverbs.SourceFile{Path: f.Path, Source: []byte(f.Source)})
	}
	reg, err := jsverbs.ScanSources(files, jsverbs.DefaultScanOptions())
	if err != nil {
		return nil, err
	}
	if err := checkTypes(reg); err != nil {
		return nil, err
	}
	return reg, nil
}

// Execute runs one command line (the words after the store) against a
// source's verbs on b. use is the command path shown in help, such as
// ["slop", "pb", "Kitchen"].
func Execute(ctx context.Context, src *Source, c Caller, b Board, use []string, short string, args []string, stdout, stderr io.Writer) error {
	reg, err := Scan(src)
	if err != nil {
		return fmt.Errorf("%s's verbs: %w", src.Key(), err)
	}
	commands, err := Commands(reg, c, b, stderr)
	if err != nil {
		return err
	}
	// One cobra command per word of use, so help reads "slop pb Kitchen clip add".
	top := &cobra.Command{Use: use[0], SilenceUsage: true, SilenceErrors: true}
	top.CompletionOptions.DisableDefaultCmd = true
	parent := top
	for _, w := range use[1:] {
		c := &cobra.Command{Use: w}
		parent.AddCommand(c)
		parent = c
	}
	parent.Short = short
	if err := glazedcli.AddCommandsToRootCommand(parent, commands, nil, glazedcli.WithParserConfig(glazedcli.CobraParserConfig{
		MiddlewaresFunc: glazedcli.CobraCommandDefaultMiddlewares,
	})); err != nil {
		return err
	}
	top.SetArgs(append(append([]string{}, use[1:]...), args...))
	top.SetOut(stdout)
	top.SetErr(stderr)
	return top.ExecuteContext(ctx)
}

// Board is the store a command runs on.
type Board struct {
	ID    string
	Title string
	Type  string
	App   string
	Via   string // how the verb was reached: cli, mcp or verb (board().via)
}

// Commands builds the Glazed commands of a registry, each running locally
// on b through c.
func Commands(reg *jsverbs.Registry, c Caller, b Board, stderr io.Writer) ([]cmds.Command, error) {
	return reg.CommandsWithInvoker(Invoker(c, b, stderr))
}

// Invoker runs a verb in a fresh goja runtime whose only native module is
// slop, scoped to b.
func Invoker(c Caller, b Board, stderr io.Writer) jsverbs.VerbInvoker {
	return func(ctx context.Context, reg *jsverbs.Registry, verb *jsverbs.VerbSpec, parsed *values.Values) (interface{}, error) {
		vm := goja.New()
		r := require.NewRegistry(require.WithLoader(reg.RequireLoader()))
		r.RegisterNativeModule("slop", Module(c, b))
		req := r.Enable(vm)
		installConsole(vm, stderr)
		stop := context.AfterFunc(ctx, func() { vm.Interrupt(verb.FullPath() + ": " + context.Cause(ctx).Error()) })
		defer stop()
		out, err := reg.InvokeInVM(ctx, vm, func(p string) (goja.Value, error) { return req.Require(p) }, verb, parsed)
		if err != nil {
			return nil, unwrap(err)
		}
		if _, pending := out.(*goja.Promise); pending {
			return nil, errors.New(verb.FullPath() + ": the verb's promise never settled")
		}
		return out, nil
	}
}

// Module is the slop module verbs see: require("slop").board() is the store
// the command runs on, and nothing else.
func Module(c Caller, b Board) require.ModuleLoader {
	return func(vm *goja.Runtime, module *goja.Object) {
		exports := module.Get("exports").(*goja.Object)
		_ = exports.Set("board", func(call goja.FunctionCall) goja.Value {
			if a := call.Argument(0); !goja.IsUndefined(a) && !goja.IsNull(a) {
				s := a.String()
				if s != b.ID && !strings.EqualFold(s, b.Title) {
					panic(vm.NewTypeError("this command runs on %s only, not %q", b.name(), s))
				}
			}
			return boardObject(vm, c, b)
		})
	}
}

func (b Board) name() string {
	if b.Title != "" {
		return fmt.Sprintf("%q (%s)", b.Title, b.ID)
	}
	return b.ID
}

func boardObject(vm *goja.Runtime, c Caller, b Board) *goja.Object {
	o := vm.NewObject()
	call := func(verb string, args map[string]any) goja.Value {
		res, err := c.Call(verb, args)
		if err != nil {
			panic(jsError(vm, err))
		}
		return vm.ToValue(plain(res))
	}
	obj := func(v goja.Value) map[string]any {
		if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
			return map[string]any{}
		}
		m, _ := v.Export().(map[string]any)
		if m == nil {
			panic(vm.NewTypeError("expected an object"))
		}
		return m
	}
	_ = o.Set("id", b.ID)
	_ = o.Set("title", b.Title)
	_ = o.Set("type", b.Type)
	_ = o.Set("app", b.App)
	_ = o.Set("via", b.Via)
	_ = o.Set("call", func(action string, args goja.Value) goja.Value {
		return call("actor.call", map[string]any{"store": b.ID, "action": action, "args": obj(args)})
	})
	_ = o.Set("me", func() goja.Value { return call("whoami", nil) })
	_ = o.Set("meta", func() goja.Value { return call("store.meta", map[string]any{"id": b.ID}) })
	docs := vm.NewObject()
	_ = docs.Set("get", func(path string) goja.Value {
		return call("docs.get", map[string]any{"store": b.ID, "path": path})
	})
	_ = docs.Set("query", func(coll string, q goja.Value) goja.Value {
		args := obj(q)
		args["store"], args["coll"] = b.ID, coll
		return call("docs.query", args)
	})
	_ = docs.Set("set", func(path string, data, opts goja.Value) goja.Value {
		args := map[string]any{"store": b.ID, "path": path, "data": obj(data)}
		if o := obj(opts); o["ifVersion"] != nil {
			args["ifVersion"] = o["ifVersion"]
		}
		return call("docs.set", args)
	})
	_ = docs.Set("update", func(path string, data goja.Value) goja.Value {
		return call("docs.update", map[string]any{"store": b.ID, "path": path, "data": obj(data)})
	})
	_ = docs.Set("rm", func(path string) goja.Value {
		return call("docs.rm", map[string]any{"store": b.ID, "path": path})
	})
	_ = o.Set("docs", docs)
	return o
}

// jsError turns a server error into a JavaScript Error with its code.
func jsError(vm *goja.Runtime, err error) goja.Value {
	e := vm.NewGoError(err)
	var ae *client.APIError
	var ve *verbs.Error
	switch {
	case errors.As(err, &ae):
		_ = e.Set("code", ae.Code)
		_ = e.Set("message", ae.Message)
	case errors.As(err, &ve):
		_ = e.Set("code", ve.Code)
		_ = e.Set("message", ve.Message)
	}
	return e
}

// unwrap turns a goja exception into its message, without the stack; an
// error that carries a code (a server refusal the verb let escape, or one
// it threw itself with .code) keeps it.
func unwrap(err error) error {
	var ex *goja.Exception
	if errors.As(err, &ex) {
		if obj, ok := ex.Value().(*goja.Object); ok {
			if c := obj.Get("code"); c != nil && !goja.IsUndefined(c) && !goja.IsNull(c) {
				msg := ex.Value().String()
				if m := obj.Get("message"); m != nil && !goja.IsUndefined(m) {
					msg = m.String()
				}
				return &verbs.Error{Code: c.String(), Message: msg}
			}
		}
		return errors.New(ex.Value().String())
	}
	return err
}

func installConsole(vm *goja.Runtime, w io.Writer) {
	if w == nil {
		w = io.Discard
	}
	con := vm.NewObject()
	logf := func(call goja.FunctionCall) goja.Value {
		parts := make([]string, len(call.Arguments))
		for i, a := range call.Arguments {
			if o, ok := a.(*goja.Object); ok && o.ClassName() != "Function" {
				if b, err := json.Marshal(o.Export()); err == nil {
					parts[i] = string(b)
					continue
				}
			}
			parts[i] = a.String()
		}
		_, _ = fmt.Fprintln(w, strings.Join(parts, " "))
		return goja.Undefined()
	}
	for _, k := range []string{"log", "info", "warn", "error", "debug"} {
		_ = con.Set(k, logf)
	}
	_ = vm.Set("console", con)
}

// plain turns decoded JSON (json.Number from the client) into values goja
// converts naturally.
func plain(v any) any {
	switch x := v.(type) {
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i
		}
		f, _ := x.Float64()
		return f
	case map[string]any:
		for k, e := range x {
			x[k] = plain(e)
		}
		return x
	case []any:
		for i, e := range x {
			x[i] = plain(e)
		}
		return x
	}
	return v
}

func remarshal(in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
