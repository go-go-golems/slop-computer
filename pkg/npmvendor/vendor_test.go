package npmvendor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// pkgFiles is a package's tarball contents, without the package/ prefix.
type pkgFiles map[string]string

// fakeRegistry serves packages as npm does: metadata at /<name>, tarballs
// at /-/<name>-<version>.tgz with sha512 integrity. tamper, when set,
// changes a tarball after its integrity was computed.
type fakeRegistry struct {
	srv      *httptest.Server
	meta     map[string]map[string]any // name → packument
	tarballs map[string][]byte
	tamper   string
}

func newRegistry(t *testing.T) *fakeRegistry {
	r := &fakeRegistry{meta: map[string]map[string]any{}, tarballs: map[string][]byte{}}
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		p := strings.TrimPrefix(req.URL.Path, "/")
		if b, ok := r.tarballs[p]; ok {
			if p == r.tamper {
				b = append(append([]byte{}, b...), 0)
			}
			_, _ = w.Write(b)
			return
		}
		m, ok := r.meta[p]
		if !ok {
			http.NotFound(w, req)
			return
		}
		_ = json.NewEncoder(w).Encode(m)
	}))
	t.Cleanup(r.srv.Close)
	return r
}

func (r *fakeRegistry) add(t *testing.T, name, version string, pkgJSON map[string]any, files pkgFiles) {
	t.Helper()
	pkgJSON["name"], pkgJSON["version"] = name, version
	pj, _ := json.Marshal(pkgJSON)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(zw)
	all := map[string]string{"package/package.json": string(pj)}
	for p, s := range files {
		all["package/"+p] = s // ../ entries stay as given: a hostile tarball
	}
	for _, p := range sortedKeys(all) {
		_ = tw.WriteHeader(&tar.Header{Name: p, Mode: 0o644, Size: int64(len(all[p])), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(all[p]))
	}
	_ = tw.Close()
	_ = zw.Close()
	tarball := "-/" + strings.ReplaceAll(name, "/", "-") + "-" + version + ".tgz"
	r.tarballs[tarball] = buf.Bytes()
	sum := sha512.Sum512(buf.Bytes())
	v := map[string]any{}
	for k, x := range pkgJSON {
		v[k] = x
	}
	v["dist"] = map[string]any{"tarball": r.srv.URL + "/" + tarball, "integrity": "sha512-" + base64.StdEncoding.EncodeToString(sum[:])}
	m, ok := r.meta[name]
	if !ok {
		m = map[string]any{"name": name, "dist-tags": map[string]any{}, "versions": map[string]any{}}
		r.meta[name] = m
	}
	m["versions"].(map[string]any)[version] = v
	m["dist-tags"].(map[string]any)["latest"] = version
}

// mini has two entry points that share state, a dependency and types.
func (r *fakeRegistry) addMini(t *testing.T) {
	r.add(t, "mini", "1.0.0", map[string]any{
		"types":        "index.d.ts",
		"dependencies": map[string]any{"dep": "^2.0.0"},
		"exports": map[string]any{
			".":       map[string]any{"types": "./index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs"},
			"./hooks": map[string]any{"types": "./hooks.d.ts", "import": "./dist/hooks.mjs", "require": "./dist/hooks.cjs"},
		},
	}, pkgFiles{
		"dist/index.mjs": `import { twice } from "dep"; export let state = 0; export const bump = () => twice(++state);`,
		"dist/hooks.mjs": `import { state, bump } from "./index.mjs"; export const useState = () => [state, bump];`,
		"dist/index.cjs": `const d = require("dep"); let state = 0; exports.bump = () => d.twice(++state); Object.defineProperty(exports, "state", { get: () => state });`,
		"dist/hooks.cjs": `const m = require("./index.cjs"); exports.useState = () => [m.state, m.bump];`,
		"index.d.ts":     `export declare let state: number; export declare const bump: () => number;`,
		"hooks.d.ts":     `export declare const useState: () => [number, () => number];`,
	})
	for _, v := range []string{"2.0.0", "2.1.0", "3.0.0"} {
		r.add(t, "dep", v, map[string]any{"main": "index.js"}, pkgFiles{"index.js": `exports.twice = n => 2 * n; exports.version = "` + v + `";`})
	}
}

const appJSON = `{
  "title": "Notes",
  "actor": "actor.js",
  "slop": {
    "verbs": { "include": ["verbs/*.js"] }
  }
}
`

func appDir(t *testing.T, raw string) string {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "app.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func read(t *testing.T, dir, p string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(p)))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAddForPagesAndActor(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	dir := appDir(t, appJSON)
	ctx := context.Background()
	res, err := Add(ctx, Options{Dir: dir, Spec: "mini@^1", Entries: []string{"mini", "mini/hooks"}, Registry: &Registry{URL: reg.srv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Version != "1.0.0" || res.Page["mini/hooks"] != "vendor/mini@1.0.0/hooks.js" || len(res.Warnings) != 0 {
		t.Fatalf("result = %+v", res)
	}
	// Both entry points import one shared chunk: one copy of mini's state.
	chunk := regexp.MustCompile(`from "\./(chunk-[A-Z0-9]+\.js)"`)
	m1, m2 := chunk.FindStringSubmatch(read(t, dir, "vendor/mini@1.0.0/mini.js")), chunk.FindStringSubmatch(read(t, dir, "vendor/mini@1.0.0/hooks.js"))
	if m1 == nil || m2 == nil || m1[1] != m2[1] || !strings.Contains(read(t, dir, "vendor/mini@1.0.0/"+m1[1]), "2 * n") {
		t.Fatalf("no shared chunk with the dependency: %v %v", m1, m2)
	}
	if !strings.Contains(read(t, dir, "vendor/mini@1.0.0/types/node_modules/mini/hooks.d.ts"), "useState") {
		t.Fatal("declarations not copied")
	}
	var lock Lock
	_ = json.Unmarshal([]byte(read(t, dir, LockFile)), &lock)
	if p := lock.Packages["mini"]; p == nil || p.Dependencies["dep"] != "dep@2.1.0" || !strings.HasPrefix(p.Integrity, "sha512-") || len(p.Files) < 5 || lock.Registry != reg.srv.URL {
		t.Fatalf("lock = %s", read(t, dir, LockFile))
	}
	if ts := read(t, dir, TsconfigFile); !strings.Contains(ts, `"mini/*": [`) || !strings.Contains(ts, `"./mini@1.0.0/types/node_modules/mini/*"`) {
		t.Fatalf("tsconfig = %s", ts)
	}
	// app.json gains slop.imports and nothing else changes.
	want := `{
  "title": "Notes",
  "actor": "actor.js",
  "slop": {
    "verbs": { "include": ["verbs/*.js"] },
    "imports": {
      "page": {
        "mini": "vendor/mini@1.0.0/mini.js",
        "mini/hooks": "vendor/mini@1.0.0/hooks.js"
      }
    }
  }
}
`
	if got := read(t, dir, "app.json"); got != want {
		t.Fatalf("app.json:\n%s\nwant:\n%s", got, want)
	}

	// The actor side: one CommonJS file, which runs in goja.
	if _, err := Add(ctx, Options{Dir: dir, Spec: "mini", Actor: true, Registry: &Registry{URL: reg.srv.URL}}); err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	module := vm.NewObject()
	_ = module.Set("exports", vm.NewObject())
	fn, err := vm.RunString("(function (module, exports) {" + read(t, dir, "vendor/mini@1.0.0/mini.cjs") + "\n})")
	if err != nil {
		t.Fatal(err)
	}
	call, _ := goja.AssertFunction(fn)
	if _, err := call(goja.Undefined(), module, module.Get("exports")); err != nil {
		t.Fatal(err)
	}
	_ = vm.Set("mini", module.Get("exports"))
	if v, err := vm.RunString("mini.bump() + mini.bump()"); err != nil || v.ToInteger() != 6 {
		t.Fatalf("mini.cjs in goja: %v %v", v, err)
	}
	if got := read(t, dir, "app.json"); !strings.Contains(got, `"actor": {`) || !strings.Contains(got, `"mini": "vendor/mini@1.0.0/mini.cjs"`) || !strings.Contains(got, `"mini/hooks": "vendor/mini@1.0.0/hooks.js"`) {
		t.Fatalf("app.json after --actor:\n%s", got)
	}

	// Check finds a file changed after it was vendored.
	if st, err := Check(dir); err != nil || len(st) != 1 || len(st[0].Problems) != 0 {
		t.Fatalf("check = %+v %v", st, err)
	}
	_ = os.WriteFile(filepath.Join(dir, "vendor/mini@1.0.0/hooks.js"), []byte("edited"), 0o644)
	if st, _ := Check(dir); len(st[0].Problems) != 1 || !strings.Contains(st[0].Problems[0], "hooks.js: changed") {
		t.Fatalf("check after an edit = %+v", st)
	}

	// Removing the package leaves app.json as it was.
	if _, err := Remove(dir, "mini"); err != nil {
		t.Fatal(err)
	}
	if got := read(t, dir, "app.json"); got != appJSON {
		t.Fatalf("app.json after rm:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "vendor/mini@1.0.0")); !os.IsNotExist(err) {
		t.Fatalf("the package's folder is still there: %v", err)
	}
}

// A dependency whose nearer copy is another version goes under the
// package that needs it, as npm places it.
func TestNestedVersions(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	reg.add(t, "other", "1.0.0", map[string]any{"main": "index.js", "dependencies": map[string]any{"dep": "^3.0.0", "mini": "^1.0.0"}},
		pkgFiles{"index.js": `const dep = require("dep"); const mini = require("mini"); exports.versions = () => [dep.version, mini.bump()];`})
	dir := appDir(t, `{"title": "x"}`)
	if _, err := Add(context.Background(), Options{Dir: dir, Spec: "other", Registry: &Registry{URL: reg.srv.URL}}); err != nil {
		t.Fatal(err)
	}
	var lock Lock
	_ = json.Unmarshal([]byte(read(t, dir, LockFile)), &lock)
	deps := lock.Packages["other"].Dependencies
	if deps["dep"] != "dep@3.0.0" || deps["mini"] != "mini@1.0.0" || deps["mini/node_modules/dep"] != "dep@2.1.0" {
		t.Fatalf("dependencies = %v", deps)
	}
	if got := read(t, dir, "app.json"); got != `{"title": "x", "slop": {"imports": {"page":{"other":"vendor/other@1.0.0/other.js"}}}}` {
		t.Fatalf("app.json on one line stays on one line: %s", got)
	}
}

func TestRefusals(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	reg.add(t, "evil", "1.0.0", map[string]any{"main": "index.js"}, pkgFiles{"index.js": "x", "../../escape.txt": "out"})
	add := func(spec string) error {
		dir := appDir(t, appJSON)
		_, err := Add(context.Background(), Options{Dir: dir, Spec: spec, Registry: &Registry{URL: reg.srv.URL}})
		if _, statErr := os.Stat(filepath.Join(dir, "vendor")); err != nil && !os.IsNotExist(statErr) {
			t.Errorf("%s: refused, but vendor/ was written", spec)
		}
		if read(t, dir, "app.json") != appJSON {
			t.Errorf("%s: refused, but app.json changed", spec)
		}
		return err
	}
	reg.tamper = "-/dep-2.1.0.tgz"
	if err := add("mini"); err == nil || !strings.Contains(err.Error(), "dep@2.1.0: integrity mismatch") {
		t.Fatalf("a tampered tarball: %v", err)
	}
	reg.tamper = ""
	if err := add("evil"); err == nil || !strings.Contains(err.Error(), "outside the package") {
		t.Fatalf("a tarball that writes outside its folder: %v", err)
	}
	if err := add("mini@^9"); err == nil || !strings.Contains(err.Error(), "no version matches ^9") {
		t.Fatalf("no such version: %v", err)
	}
	if err := add("nothere"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("no such package: %v", err)
	}
	dir := appDir(t, appJSON)
	if _, err := Add(context.Background(), Options{Dir: dir, Spec: "mini", Entries: []string{"lit"}, Registry: &Registry{URL: reg.srv.URL}}); err == nil {
		t.Fatal("an entry point of another package was accepted")
	}
	if _, err := Add(context.Background(), Options{Dir: t.TempDir(), Spec: "mini", Registry: &Registry{URL: reg.srv.URL}}); err == nil || !strings.Contains(err.Error(), "no app.json") {
		t.Fatalf("a folder without app.json: %v", err)
	}
}

func TestSetImportsShapes(t *testing.T) {
	im := imports{Page: map[string]string{"a": "vendor/a@1/a.js"}}
	for in, want := range map[string]string{
		"{\n  \"title\": \"x\"\n}\n": "{\n  \"title\": \"x\",\n  \"slop\": {\n    \"imports\": {\n      \"page\": {\n        \"a\": \"vendor/a@1/a.js\"\n      }\n    }\n  }\n}\n",
		`{}`:                         `{"slop": {"imports": {"page":{"a":"vendor/a@1/a.js"}}}}`,
		`{"slop": {}}`:               `{"slop": {"imports": {"page":{"a":"vendor/a@1/a.js"}}}}`,
		`{"slop": {"imports": {"page": {"old": "x.js"}}, "verbs": {"include": ["v/*.js"]}}}`: `{"slop": {"imports": {"page":{"a":"vendor/a@1/a.js"}}, "verbs": {"include": ["v/*.js"]}}}`,
	} {
		got, err := setImports([]byte(in), im)
		if err != nil || string(got) != want {
			t.Errorf("setImports(%s):\n%s\nwant:\n%s (%v)", in, got, want, err)
		}
	}
	got, _ := setImports([]byte(`{"slop": {"verbs": {"include": ["v/*.js"]}, "imports": {"page": {"a": "x.js"}}}}`), imports{})
	if string(got) != `{"slop": {"verbs": {"include": ["v/*.js"]}}}` {
		t.Errorf("removing imports: %s", got)
	}
}

func TestLimitsMatchTheStore(t *testing.T) {
	if maxTreeFiles != store.MaxTreeFiles {
		t.Fatalf("maxTreeFiles = %d, the store's is %d", maxTreeFiles, store.MaxTreeFiles)
	}
}

// Names the app mapped by hand, even to files under vendor/, survive an add
// and a remove.
func TestHandMappedNamesStay(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	dir := appDir(t, `{"slop": {"imports": {"page": {"mine": "vendor/mine.js"}}}}`)
	if _, err := Add(context.Background(), Options{Dir: dir, Spec: "mini", Registry: &Registry{URL: reg.srv.URL}}); err != nil {
		t.Fatal(err)
	}
	if got := read(t, dir, "app.json"); !strings.Contains(got, `"mine":"vendor/mine.js"`) || !strings.Contains(got, `"mini":"vendor/mini@1.0.0/mini.js"`) {
		t.Fatalf("after add: %s", got)
	}
	if _, err := Remove(dir, "mini"); err != nil {
		t.Fatal(err)
	}
	if got := read(t, dir, "app.json"); got != `{"slop": {"imports": {"page":{"mine":"vendor/mine.js"}}}}` {
		t.Fatalf("after rm: %s", got)
	}
}

// peerNotes are the warnings about peers the app does not map.
func peerNotes(res *Result) []string {
	var out []string
	for _, w := range res.Warnings {
		if strings.Contains(w, "its peer") {
			out = append(out, w)
		}
	}
	return out
}

// A peer stays an import in the bundles, so the app's one copy is what the
// package uses. The peer may be vendored after the package or before it,
// and a note names the command until it is.
func TestPeersStayImports(t *testing.T) {
	reg := newRegistry(t)
	both := func(m, c string) map[string]any { return map[string]any{"import": m, "require": c} }
	reg.add(t, "core", "1.0.0", map[string]any{"exports": map[string]any{".": both("./index.mjs", "./index.cjs"), "./extra": both("./extra.mjs", "./extra.cjs")}}, pkgFiles{
		"index.mjs": `export const id = {};`, "index.cjs": `exports.id = {};`,
		"extra.mjs": `export const extra = "core extra";`, "extra.cjs": `exports.extra = "core extra";`,
	})
	reg.add(t, "ui", "1.0.0", map[string]any{"peerDependencies": map[string]any{"core": "^1"}, "exports": map[string]any{".": both("./index.mjs", "./index.cjs")}}, pkgFiles{
		"index.mjs": `import { id } from "core"; import { extra } from "core/extra"; export const same = x => x === id; export { extra };`,
		"index.cjs": `const core = require("core"); exports.same = x => x === core.id; exports.extra = require("core/extra").extra;`,
	})
	dir := appDir(t, appJSON)
	add := func(o Options) *Result {
		t.Helper()
		o.Dir, o.Registry = dir, &Registry{URL: reg.srv.URL}
		res, err := Add(context.Background(), o)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	// The package first: its bundle imports the peer, which is not in it.
	notes := peerNotes(add(Options{Spec: "ui"}))
	if len(notes) != 1 || notes[0] != "ui's page bundles import its peer core (core, core/extra), and the app does not map it yet: slop vendor add core core core/extra" {
		t.Fatalf("notes = %q", notes)
	}
	if ui := read(t, dir, "vendor/ui@1.0.0/ui.js"); !strings.Contains(ui, `from "core"`) || !strings.Contains(ui, `from "core/extra"`) || strings.Contains(ui, "core extra") {
		t.Fatalf("core was bundled into ui:\n%s", ui)
	}
	// Then the peer, one name at a time: the note names what is still
	// missing, and its command (an add keeps the names already there).
	add(Options{Spec: "core", Entries: []string{"core/extra"}})
	if notes := peerNotes(add(Options{Spec: "ui"})); len(notes) != 1 || !strings.HasSuffix(notes[0], "its peer core, and the app does not map it yet: slop vendor add core") {
		t.Fatalf("notes with core/extra mapped = %q", notes)
	}
	add(Options{Spec: "core"})
	if notes := peerNotes(add(Options{Spec: "ui"})); len(notes) != 0 {
		t.Fatalf("notes once core is mapped = %q", notes)
	}

	// The actor side, the peer first: ui's require("core") is the app's copy.
	add(Options{Spec: "core", Entries: []string{"core", "core/extra"}, Actor: true})
	if notes := peerNotes(add(Options{Spec: "ui", Actor: true})); len(notes) != 0 {
		t.Fatalf("actor notes = %q", notes)
	}
	var app struct {
		Slop struct{ Imports imports } `json:"slop"`
	}
	if err := json.Unmarshal([]byte(read(t, dir, "app.json")), &app); err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	loaded := map[string]goja.Value{}
	var require func(goja.FunctionCall) goja.Value
	require = func(c goja.FunctionCall) goja.Value {
		name := c.Argument(0).String()
		if v, ok := loaded[name]; ok {
			return v
		}
		file, ok := app.Slop.Imports.Actor[name]
		if !ok {
			panic(vm.NewGoError(fmt.Errorf("the app does not map %s", name)))
		}
		module, exports := vm.NewObject(), vm.NewObject()
		_ = module.Set("exports", exports)
		fn, err := vm.RunString("(function (module, exports, require) {" + read(t, dir, file) + "\n})")
		if err != nil {
			panic(vm.NewGoError(err))
		}
		call, _ := goja.AssertFunction(fn)
		if _, err := call(goja.Undefined(), module, exports, vm.ToValue(require)); err != nil {
			panic(vm.NewGoError(err))
		}
		loaded[name] = module.Get("exports")
		return loaded[name]
	}
	_ = vm.Set("require", require)
	if v, err := vm.RunString(`const ui = require("ui"); ui.same(require("core").id) + " " + ui.extra`); err != nil || v.String() != "true core extra" {
		t.Fatalf("ui and core in goja: %v %v", v, err)
	}
	// Each re-add kept the package's files (the new version's are written
	// before the old version's go, and a file in both stays).
	if st, err := Check(dir); err != nil || len(st) != 2 || len(st[0].Problems)+len(st[1].Problems) != 0 {
		t.Fatalf("check = %+v %v", st, err)
	}
}

// An optional dependency that cannot be had is left out with a note,
// together with what was placed for it; a required one fails the add.
func TestOptionalDependencies(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	js := func(s string) pkgFiles { return pkgFiles{"index.js": s} }
	main := func(m map[string]any) map[string]any { m["main"] = "index.js"; return m }
	// notar's metadata is there, its tarball is not.
	reg.add(t, "notar", "1.0.0", main(map[string]any{}), js(`exports.x = 1;`))
	delete(reg.tarballs, "-/notar-1.0.0.tgz")
	// half's first dependency is placed before its second turns out not to exist.
	reg.add(t, "other", "1.0.0", main(map[string]any{}), js(`exports.y = 1;`))
	reg.add(t, "half", "1.0.0", main(map[string]any{"dependencies": map[string]any{"other": "^1", "zz-gone": "^1"}}), js(`exports.z = 1;`))
	reg.add(t, "host", "1.0.0", main(map[string]any{
		"dependencies":         map[string]any{"dep": "^2"},
		"optionalDependencies": map[string]any{"notar": "^1", "half": "^1"},
	}), js(`exports.twice = require("dep").twice;`))
	reg.add(t, "needy", "1.0.0", main(map[string]any{"dependencies": map[string]any{"notar": "^1"}}), js(`exports.x = require("notar").x;`))

	dir := appDir(t, appJSON)
	res, err := Add(context.Background(), Options{Dir: dir, Spec: "host", Registry: &Registry{URL: reg.srv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	skipped := 0
	for _, w := range res.Warnings {
		if strings.HasPrefix(w, "skipped the optional dependency half: ") && strings.Contains(w, "zz-gone") ||
			strings.HasPrefix(w, "skipped the optional dependency notar: ") && strings.Contains(w, "404") {
			skipped++
		}
	}
	var lock Lock
	_ = json.Unmarshal([]byte(read(t, dir, LockFile)), &lock)
	if p := lock.Packages["host"]; skipped != 2 || p == nil || len(p.Dependencies) != 1 || p.Dependencies["dep"] != "dep@2.1.0" {
		t.Fatalf("warnings = %q, lock = %s", res.Warnings, read(t, dir, LockFile))
	}
	for _, gone := range []string{"half", "other", "notar"} {
		if _, err := os.Stat(filepath.Join(dir, "vendor/host@1.0.0/types/node_modules", gone)); !os.IsNotExist(err) {
			t.Errorf("%s was left in: %v", gone, err)
		}
	}
	if _, err := Add(context.Background(), Options{Dir: appDir(t, appJSON), Spec: "needy", Registry: &Registry{URL: reg.srv.URL}}); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("a required dependency without its tarball: %v", err)
	}
}

// snapshot is every file under dir and its contents.
func snapshot(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(p)
		rel, _ := filepath.Rel(dir, p)
		out[filepath.ToSlash(rel)] = string(b)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// An add that the new app.json would refuse (here, an upgrade that adds an
// entry point to an app at the import limit) changes nothing: the
// installed version, its files, the lock and app.json stay.
func TestRefusedAddChangesNothing(t *testing.T) {
	reg := newRegistry(t)
	reg.addMini(t)
	names := map[string]string{}
	for i := range apps.MaxImports - 1 {
		names[fmt.Sprintf("n%d", i)] = fmt.Sprintf("lib/n%d.js", i)
	}
	raw, _ := json.Marshal(map[string]any{"slop": map[string]any{"imports": map[string]any{"page": names}}})
	dir := appDir(t, string(raw))
	o := Options{Dir: dir, Spec: "mini", Registry: &Registry{URL: reg.srv.URL}}
	if _, err := Add(context.Background(), o); err != nil {
		t.Fatal(err) // at the limit
	}
	before := snapshot(t, dir)
	reg.add(t, "mini", "1.1.0", map[string]any{"exports": map[string]any{".": "./index.mjs", "./hooks": "./hooks.mjs"}}, pkgFiles{
		"index.mjs": `export const v = "1.1";`, "hooks.mjs": `export { v } from "./index.mjs";`,
	})
	o.Entries = []string{"mini", "mini/hooks"}
	_, err := Add(context.Background(), o)
	if err == nil || !strings.Contains(err.Error(), "nothing changed") || !strings.Contains(err.Error(), fmt.Sprintf("at most %d names", apps.MaxImports)) {
		t.Fatalf("one name over the limit: %v", err)
	}
	after := snapshot(t, dir)
	for p := range before {
		if after[p] != before[p] {
			t.Errorf("%s changed or went", p)
		}
	}
	for p := range after {
		if _, ok := before[p]; !ok {
			t.Errorf("%s was written", p)
		}
	}
}
