package npmvendor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// unpack writes a package tarball into dst. The tarball's first path
// component (package/, usually) is dropped; entries that would land outside
// dst, links and devices are refused or skipped. budget is the bytes left to
// unpack in this add.
func unpack(tgz []byte, dst string, budget *int64) error {
	zr, err := gzip.NewReader(bytes.NewReader(tgz))
	if err != nil {
		return err
	}
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		_, rest, _ := strings.Cut(strings.TrimPrefix(h.Name, "./"), "/")
		if rest == "" {
			continue
		}
		clean := path.Clean(rest)
		if strings.HasPrefix(clean, "../") || clean == ".." || path.IsAbs(clean) || strings.Contains(clean, "\\") {
			return fmt.Errorf("the tarball has an entry outside the package: %q", h.Name)
		}
		target := filepath.Join(dst, filepath.FromSlash(clean))
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if *budget -= h.Size; *budget < 0 {
				return fmt.Errorf("the packages unpack to more than %d bytes", maxUnpacked)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, io.LimitReader(tr, h.Size))
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				return err
			}
		}
	}
}

// outName is the file an entry point is written to, without its
// extension: the package's own name for the package, the subpath for the
// rest (preact/hooks → hooks, lit/decorators.js → decorators,
// preact/compat/client → compat-client).
func outName(pkg, spec string) string {
	rest := strings.TrimPrefix(strings.TrimPrefix(spec, pkg), "/")
	if rest == "" {
		return pkg[strings.LastIndex(pkg, "/")+1:]
	}
	for _, ext := range []string{".js", ".mjs", ".cjs"} {
		rest = strings.TrimSuffix(rest, ext)
	}
	return strings.ReplaceAll(rest, "/", "-")
}

// output is one file of a build, by its name in the package's folder.
type output struct {
	name string
	data []byte
}

// bundle builds entry points out of the node_modules under work: for pages,
// ES modules with code splitting (entries of one package share one copy of
// its code); for the actor, one CommonJS file per entry, for goja.
func bundle(work string, pkg string, entries []string, actor bool) ([]output, error) {
	seen := map[string]string{}
	points := []api.EntryPoint{}
	for _, e := range entries {
		n := outName(pkg, e)
		if other, dup := seen[n]; dup {
			return nil, fmt.Errorf("%s and %s would both be written to %s", other, e, n)
		}
		seen[n] = e
		points = append(points, api.EntryPoint{InputPath: e, OutputPath: n})
	}
	base := api.BuildOptions{
		AbsWorkingDir: work, Bundle: true, Write: false, Outdir: filepath.Join(work, "out"),
		Charset: api.CharsetUTF8, LegalComments: api.LegalCommentsEndOfFile, LogLevel: api.LogLevelSilent,
	}
	var builds []api.BuildOptions
	if actor {
		for _, p := range points {
			o := base
			o.EntryPointsAdvanced = []api.EntryPoint{p}
			o.Format, o.Platform, o.Target = api.FormatCommonJS, api.PlatformNeutral, api.ES2020
			o.MainFields = []string{"main", "module"}
			o.OutExtension = map[string]string{".js": ".cjs"}
			builds = append(builds, o)
		}
	} else {
		o := base
		o.EntryPointsAdvanced = points
		o.Format, o.Platform, o.Target = api.FormatESModule, api.PlatformBrowser, api.ES2022
		o.Splitting, o.ChunkNames = true, "chunk-[hash]"
		builds = append(builds, o)
	}
	var out []output
	for _, o := range builds {
		r := api.Build(o)
		if len(r.Errors) > 0 {
			msgs := []string{}
			for _, m := range r.Errors {
				msgs = append(msgs, m.Text)
			}
			return nil, fmt.Errorf("bundling %s: %s", pkg, strings.Join(msgs, "; "))
		}
		for _, f := range r.OutputFiles {
			rel, err := filepath.Rel(o.Outdir, f.Path)
			if err != nil {
				return nil, err
			}
			out = append(out, output{filepath.ToSlash(rel), f.Contents})
		}
	}
	return out, nil
}

// declarations copies the packages' declaration files (and their
// package.json files, which say where the types are) into a node_modules
// tree under dst, so that TypeScript resolves a vendored package's types,
// and the types they import from its dependencies, as it would from npm.
func declarations(work, dst string) ([]output, error) {
	root := filepath.Join(work, "node_modules")
	var out []output
	size := 0
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		if !isDeclaration(name) && name != "package.json" {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if size += len(b); size > maxTypesBytes {
			return fmt.Errorf("the declarations are over %d bytes", maxTypesBytes)
		}
		if len(out) == maxTypesFiles {
			return fmt.Errorf("the declarations are more than %d files", maxTypesFiles)
		}
		rel, _ := filepath.Rel(work, p)
		out = append(out, output{path.Join(dst, filepath.ToSlash(rel)), b})
		return nil
	})
	return out, err
}

func isDeclaration(name string) bool {
	return strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.mts") || strings.HasSuffix(name, ".d.cts")
}

const (
	maxTypesFiles = 2000
	maxTypesBytes = 32 << 20
)
