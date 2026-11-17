package npmvendor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dop251/goja"

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
