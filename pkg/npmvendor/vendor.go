package npmvendor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/apps"
)

// LockFile records what is vendored: each package's version, the
// registry's integrity hash, its entry points and every file written, with
// its sha256.
const LockFile = "vendor/vendor.json"

// TsconfigFile maps the vendored names to their declarations; an app's
// tsconfig extends it ("extends": "./vendor/tsconfig.vendor.json").
const TsconfigFile = "vendor/tsconfig.vendor.json"

// maxTreeFiles is the store's limit on files in a tree (store.MaxTreeFiles).
const maxTreeFiles = 5000

// Lock is vendor/vendor.json.
type Lock struct {
	Registry string              `json:"registry"`
	Packages map[string]*Package `json:"packages"`
}

// Package is one vendored package.
type Package struct {
	Version      string            `json:"version"`
	Integrity    string            `json:"integrity"`
	Dependencies map[string]string `json:"dependencies,omitempty"` // node_modules dir → name@version
	Page         map[string]string `json:"page,omitempty"`         // import name → file, for pages
	Actor        map[string]string `json:"actor,omitempty"`        // import name → file, for the actor
	Files        map[string]string `json:"files"`                  // path in the app → sha256
}

// Options are what slop vendor add asks for.
type Options struct {
	Dir      string   // the app's folder (holds app.json)
	Spec     string   // name or name@range: preact, preact@10.24.3, @lit/context@^1
	Entries  []string // import names to bundle (default: the package itself)
	Actor    bool     // CommonJS for the actor instead of ES modules for pages
	Registry *Registry
}

// Result says what an add or remove did.
type Result struct {
	Name     string            `json:"name"`
	Version  string            `json:"version,omitempty"`
	Page     map[string]string `json:"page,omitempty"`
	Actor    map[string]string `json:"actor,omitempty"`
	Written  int               `json:"written"`
	Removed  int               `json:"removed"`
	Warnings []string          `json:"warnings,omitempty"`
}

var packageName = regexp.MustCompile(`^(@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$`)

// splitSpec splits name@range (a scoped name keeps its leading @).
func splitSpec(spec string) (string, string) {
	if i := strings.LastIndex(spec, "@"); i > 0 {
		return spec[:i], spec[i+1:]
	}
	return spec, ""
}

// Add vendors a package into the app at o.Dir.
func Add(ctx context.Context, o Options) (*Result, error) {
	name, rng := splitSpec(o.Spec)
	if !packageName.MatchString(name) {
		return nil, fmt.Errorf("%q is not a package name", name)
	}
	entries := o.Entries
	if len(entries) == 0 {
		entries = []string{name}
	}
	for _, e := range entries {
		if e != name && !strings.HasPrefix(e, name+"/") {
			return nil, fmt.Errorf("%s is not %s or one of its subpaths (%s/…)", e, name, name)
		}
	}
	appRaw, err := readApp(o.Dir)
	if err != nil {
		return nil, err
	}
	lock, err := loadLock(o.Dir)
	if err != nil {
		return nil, err
	}
	reg := o.Registry
	if reg == nil {
		reg = &Registry{URL: DefaultRegistry}
	}
	installs, warnings, err := reg.resolveAll(ctx, name, rng)
	if err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp("", "slop-vendor-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(work) }()
	budget := int64(maxUnpacked)
	var root *install
	deps := map[string]string{}
	for _, in := range installs {
		if err := unpack(in.tgz, filepath.Join(work, "node_modules", filepath.FromSlash(in.dir)), &budget); err != nil {
			return nil, fmt.Errorf("%s@%s: %v", in.meta.Name, in.meta.Version, err)
		}
		if in.dir == name {
			root = in
		} else {
			deps[in.dir] = in.meta.Name + "@" + in.meta.Version
		}
	}

	// What this package's folder holds after the add: the side asked for,
	// plus what the other side already had (rebuilt at the new version).
	old := lock.Packages[name]
	pageEntries, actorEntries := map[string]bool{}, map[string]bool{}
	if old != nil {
		for e := range old.Page {
			pageEntries[e] = true
		}
		for e := range old.Actor {
			actorEntries[e] = true
		}
	}
	for _, e := range entries {
		if o.Actor {
			actorEntries[e] = true
		} else {
			pageEntries[e] = true
		}
	}
	dir := "vendor/" + name + "@" + root.meta.Version
	pkg := &Package{Version: root.meta.Version, Integrity: root.meta.Dist.Integrity, Dependencies: deps,
		Page: map[string]string{}, Actor: map[string]string{}, Files: map[string]string{}}
	var files []output
	for _, side := range []struct {
		entries map[string]bool
		actor   bool
		names   map[string]string
		ext     string
	}{{pageEntries, false, pkg.Page, ".js"}, {actorEntries, true, pkg.Actor, ".cjs"}} {
		if len(side.entries) == 0 {
			continue
		}
		outs, err := bundle(work, name, sortedKeys(side.entries), side.actor)
		if err != nil {
			return nil, err
		}
		for _, f := range outs {
			files = append(files, output{dir + "/" + f.name, f.data})
		}
		for e := range side.entries {
			side.names[e] = dir + "/" + outName(name, e) + side.ext
		}
	}
	types, err := declarations(work, dir+"/types")
	if err != nil {
		return nil, err
	}
	files = append(files, types...)
	if !hasDeclarations(types, name) {
		warnings = append(warnings, name+" ships no declarations: TypeScript sees its imports as any (vendor @types/"+strings.ReplaceAll(strings.TrimPrefix(name, "@"), "/", "__")+" alongside if it exists)")
	}

	count, err := countFiles(o.Dir)
	if err != nil {
		return nil, err
	}
	if old != nil {
		count -= len(old.Files)
	}
	if count+len(files) > maxTreeFiles {
		return nil, fmt.Errorf("the app would hold %d files; a store's tree holds at most %d", count+len(files), maxTreeFiles)
	}

	res := &Result{Name: name, Version: root.meta.Version, Page: pkg.Page, Actor: pkg.Actor, Warnings: warnings}
	managed := []string{dir + "/"}
	if old != nil {
		res.Removed = removeFiles(o.Dir, old.Files)
		managed = append(managed, "vendor/"+name+"@"+old.Version+"/")
	}
	for _, f := range files {
		p := filepath.Join(o.Dir, filepath.FromSlash(f.name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(p, f.data, 0o644); err != nil {
			return nil, err
		}
		sum := sha256.Sum256(f.data)
		pkg.Files[f.name] = hex.EncodeToString(sum[:])
	}
	res.Written = len(files)
	if lock.Registry == "" || reg.URL != DefaultRegistry {
		lock.Registry = reg.URL
	}
	lock.Packages[name] = pkg
	return res, save(o.Dir, appRaw, lock, managed)
}

// Remove takes a vendored package out of the app at dir.
func Remove(dir, name string) (*Result, error) {
	appRaw, err := readApp(dir)
	if err != nil {
		return nil, err
	}
	lock, err := loadLock(dir)
	if err != nil {
		return nil, err
	}
	pkg, ok := lock.Packages[name]
	if !ok {
		return nil, fmt.Errorf("%s is not vendored here", name)
	}
	res := &Result{Name: name, Version: pkg.Version, Removed: removeFiles(dir, pkg.Files)}
	delete(lock.Packages, name)
	return res, save(dir, appRaw, lock, []string{"vendor/" + name + "@" + pkg.Version + "/"})
}

// Status is one vendored package as Check finds it.
type Status struct {
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	Page     []string `json:"page,omitempty"`
	Actor    []string `json:"actor,omitempty"`
	Files    int      `json:"files"`
	Problems []string `json:"problems,omitempty"` // files missing or changed since they were written
}

// Check lists the vendored packages and checks every file against the
// sha256 recorded when it was written.
func Check(dir string) ([]Status, error) {
	lock, err := loadLock(dir)
	if err != nil {
		return nil, err
	}
	out := []Status{}
	for _, name := range sortedKeys(lock.Packages) {
		pkg := lock.Packages[name]
		st := Status{Name: name, Version: pkg.Version, Page: sortedKeys(pkg.Page), Actor: sortedKeys(pkg.Actor), Files: len(pkg.Files)}
		for _, p := range sortedKeys(pkg.Files) {
			b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(p)))
			if err != nil {
				st.Problems = append(st.Problems, p+": missing")
				continue
			}
			if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != pkg.Files[p] {
				st.Problems = append(st.Problems, p+": changed since it was vendored")
			}
		}
		out = append(out, st)
	}
	return out, nil
}

func readApp(dir string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(dir, apps.File))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("no %s in %s: slop vendor works on an app's folder", apps.File, dir)
	}
	if err != nil {
		return nil, err
	}
	if _, err := apps.Parse(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func loadLock(dir string) (*Lock, error) {
	lock := &Lock{Packages: map[string]*Package{}}
	b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(LockFile)))
	if errors.Is(err, fs.ErrNotExist) {
		return lock, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, lock); err != nil {
		return nil, fmt.Errorf("%s: %v", LockFile, err)
	}
	if lock.Packages == nil {
		lock.Packages = map[string]*Package{}
	}
	return lock, nil
}

// save writes the lock, the tsconfig of declarations and app.json's
// slop.imports. Names that point into a folder slop vendor manages (one in
// the lock, or in managed: folders just replaced or removed) are derived
// from the lock; names the app mapped itself are kept.
func save(dir string, appRaw []byte, lock *Lock, managed []string) error {
	man, err := apps.Parse(appRaw)
	if err != nil {
		return err
	}
	for name, pkg := range lock.Packages {
		managed = append(managed, "vendor/"+name+"@"+pkg.Version+"/")
	}
	ours := func(p string) bool {
		for _, m := range managed {
			if strings.HasPrefix(p, m) {
				return true
			}
		}
		return false
	}
	im := imports{Page: map[string]string{}, Actor: map[string]string{}}
	if cur := man.Slop.Imports; cur != nil {
		for n, p := range cur.Page {
			if !ours(p) {
				im.Page[n] = p
			}
		}
		for n, p := range cur.Actor {
			if !ours(p) {
				im.Actor[n] = p
			}
		}
	}
	paths := map[string][]string{}
	for name, pkg := range lock.Packages {
		for n, p := range pkg.Page {
			im.Page[n] = p
		}
		for n, p := range pkg.Actor {
			im.Actor[n] = p
		}
		types := "./" + name + "@" + pkg.Version + "/types/node_modules/" + name
		paths[name] = []string{types}
		paths[name+"/*"] = []string{types + "/*"}
	}
	newApp, err := setImports(appRaw, im)
	if err != nil {
		return err
	}
	if _, err := apps.Parse(newApp); err != nil {
		return fmt.Errorf("the new app.json does not parse: %v", err)
	}
	lockJSON, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return err
	}
	tsconfig, _ := json.MarshalIndent(map[string]any{
		"//":              "Written by slop vendor: the declarations of the vendored packages. Extend it from tsconfig.json.",
		"compilerOptions": map[string]any{"paths": paths},
	}, "", "  ")
	writes := map[string][]byte{apps.File: newApp, LockFile: append(lockJSON, '\n'), TsconfigFile: append(tsconfig, '\n')}
	if len(lock.Packages) == 0 {
		delete(writes, LockFile)
		delete(writes, TsconfigFile)
		for _, p := range []string{LockFile, TsconfigFile} {
			_ = os.Remove(filepath.Join(dir, filepath.FromSlash(p)))
		}
	}
	for p, b := range writes {
		full := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(full, b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// removeFiles deletes files the lock recorded (only under vendor/) and
// the folders they leave empty.
func removeFiles(dir string, files map[string]string) int {
	n := 0
	dirs := map[string]bool{}
	for p := range files {
		if !strings.HasPrefix(path.Clean(p), "vendor/") {
			continue
		}
		if os.Remove(filepath.Join(dir, filepath.FromSlash(p))) == nil {
			n++
		}
		for d := path.Dir(p); d != "vendor" && d != "."; d = path.Dir(d) {
			dirs[d] = true
		}
	}
	// Deepest first, so a parent is empty when its turn comes.
	ds := sortedKeys(dirs)
	for i := len(ds) - 1; i >= 0; i-- {
		_ = os.Remove(filepath.Join(dir, filepath.FromSlash(ds[i])))
	}
	return n
}

// countFiles counts the files a push of dir sends (dot files and folders
// are skipped, as the CLI's push does).
func countFiles(dir string) (int, error) {
	n := 0
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != dir && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() {
			n++
		}
		return nil
	})
	return n, err
}

func hasDeclarations(types []output, name string) bool {
	prefix := "/types/node_modules/" + name + "/"
	for _, f := range types {
		if strings.Contains(f.name, prefix) && !strings.HasSuffix(f.name, "/package.json") {
			return true
		}
	}
	return false
}
