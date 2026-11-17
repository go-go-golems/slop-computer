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

// packageOf is the package an import name is in: preact/hooks → preact,
// @preact/signals-core → @preact/signals-core.
func packageOf(spec string) string {
	parts := strings.SplitN(spec, "/", 3)
	if strings.HasPrefix(spec, "@") && len(parts) > 1 {
		return parts[0] + "/" + parts[1]
	}
	return parts[0]
}

// addCommand is the slop vendor command that maps names, import names of
// the package pkg (an add keeps the names the package already has).
func addCommand(pkg string, names []string, actor bool) string {
	cmd := "slop vendor add "
	if actor {
		cmd += "--actor "
	}
	if len(names) == 1 && names[0] == pkg {
		return cmd + pkg
	}
	return cmd + pkg + " " + strings.Join(names, " ")
}

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
	t, err := reg.resolveAll(ctx, name, rng)
	if err != nil {
		return nil, err
	}
	installs, warnings := t.installs, t.warnings
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
	var pageExternal, actorExternal []string
	for _, side := range []struct {
		entries  map[string]bool
		actor    bool
		names    map[string]string
		ext      string
		external *[]string
	}{{pageEntries, false, pkg.Page, ".js", &pageExternal}, {actorEntries, true, pkg.Actor, ".cjs", &actorExternal}} {
		if len(side.entries) == 0 {
			continue
		}
		outs, external, err := bundle(work, name, sortedKeys(side.entries), side.actor, t.peers)
		if err != nil {
			return nil, err
		}
		*side.external = external
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

	// Everything is prepared and checked before any file changes: a refused
	// add (an app.json that no longer parses, too many names) leaves the
	// installed version as it was.
	for _, f := range files {
		sum := sha256.Sum256(f.data)
		pkg.Files[f.name] = hex.EncodeToString(sum[:])
	}
	managed := []string{dir + "/"}
	if old != nil {
		managed = append(managed, "vendor/"+name+"@"+old.Version+"/")
	}
	if lock.Registry == "" || reg.URL != DefaultRegistry {
		lock.Registry = reg.URL
	}
	lock.Packages[name] = pkg
	prep, err := prepare(appRaw, lock, managed)
	if err != nil {
		return nil, err
	}
	// A peer is the app's to provide: the bundles import it, and it
	// resolves once the app maps it (vendored before this package or after).
	for _, side := range []struct {
		external []string
		mapped   map[string]string
		actor    bool
		what     string
	}{{pageExternal, prep.im.Page, false, "page bundles import"}, {actorExternal, prep.im.Actor, true, "actor bundles require"}} {
		missing := map[string][]string{} // peer package → its import names the app does not map
		for _, spec := range side.external {
			if _, ok := side.mapped[spec]; !ok {
				missing[packageOf(spec)] = append(missing[packageOf(spec)], spec)
			}
		}
		for _, peer := range sortedKeys(missing) {
			names := missing[peer]
			what := peer
			if len(names) > 1 || names[0] != peer {
				what += " (" + strings.Join(names, ", ") + ")"
			}
			yet := "the app does not map it yet"
			if side.actor {
				yet = "the app does not map it for the actor yet"
			}
			warnings = append(warnings, fmt.Sprintf("%s's %s its peer %s, and %s: %s", name, side.what, what, yet, addCommand(peer, names, side.actor)))
		}
	}

	// The new files first, then the old ones go (not those the new version
	// writes again), then app.json, the lock and the tsconfig.
	for _, f := range files {
		p := filepath.Join(o.Dir, filepath.FromSlash(f.name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(p, f.data, 0o644); err != nil {
			return nil, err
		}
	}
	res := &Result{Name: name, Version: root.meta.Version, Page: pkg.Page, Actor: pkg.Actor, Written: len(files), Warnings: warnings}
	if old != nil {
		res.Removed = removeFiles(o.Dir, old.Files, pkg.Files)
	}
	return res, prep.commit(o.Dir)
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
	delete(lock.Packages, name)
	prep, err := prepare(appRaw, lock, []string{"vendor/" + name + "@" + pkg.Version + "/"})
	if err != nil {
		return nil, err
	}
	res := &Result{Name: name, Version: pkg.Version, Removed: removeFiles(dir, pkg.Files, nil)}
	return res, prep.commit(dir)
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

// prepared is what an add or remove writes besides the packages' files:
// app.json, the lock and the tsconfig of declarations (or, with nothing
// vendored, their removal).
type prepared struct {
	writes map[string][]byte
	drop   []string
	im     imports // app.json's new slop.imports
}

// prepare computes app.json's slop.imports, the lock and the tsconfig from
// the lock, and checks that the new app.json parses. Names that point into
// a folder slop vendor manages (one in the lock, or in managed: folders
// just replaced or removed) are derived from the lock; names the app mapped
// itself are kept. Nothing is written.
func prepare(appRaw []byte, lock *Lock, managed []string) (*prepared, error) {
	man, err := apps.Parse(appRaw)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	if _, err := apps.Parse(newApp); err != nil {
		return nil, fmt.Errorf("refused, nothing changed: the new %v", err)
	}
	lockJSON, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return nil, err
	}
	tsconfig, _ := json.MarshalIndent(map[string]any{
		"//":              "Written by slop vendor: the declarations of the vendored packages. Extend it from tsconfig.json.",
		"compilerOptions": map[string]any{"paths": paths},
	}, "", "  ")
	p := &prepared{writes: map[string][]byte{apps.File: newApp, LockFile: append(lockJSON, '\n'), TsconfigFile: append(tsconfig, '\n')}, im: im}
	if len(lock.Packages) == 0 {
		delete(p.writes, LockFile)
		delete(p.writes, TsconfigFile)
		p.drop = []string{LockFile, TsconfigFile}
	}
	return p, nil
}

// commit writes what prepare computed.
func (pr *prepared) commit(dir string) error {
	for _, p := range pr.drop {
		_ = os.Remove(filepath.Join(dir, filepath.FromSlash(p)))
	}
	for p, b := range pr.writes {
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

// removeFiles deletes files the lock recorded (only under vendor/, and
// not those in keep) and the folders they leave empty.
func removeFiles(dir string, files, keep map[string]string) int {
	n := 0
	dirs := map[string]bool{}
	for p := range files {
		if _, kept := keep[p]; kept || !strings.HasPrefix(path.Clean(p), "vendor/") {
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
