package commands

import (
	"strconv"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// App verbs (SLOP3-016): an app may ship command-line verbs, JavaScript files
// its manifest lists under slop.verbs. app.verbs hands their sources to
// anyone who can view a store that runs the app, at the snapshot the store
// runs, so the CLI can scan them (go-go-goja jsverbs) and run them as the
// person. The app's own store need not be readable by them.

const (
	maxVerbFiles = 200
	maxVerbBytes = 2 << 20
)

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

func appVerbs(e kernelEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[AppVerbsIn, AppVerbsOut]{Name: "app.verbs", Doc: "The command-line verbs of the app a store runs: their sources at the snapshot it runs (slop on <store> runs them).", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "store",
			Run: func(req verbs.Req, in AppVerbsIn) (AppVerbsOut, error) {
				ctx := req.Context
				st, _, err := e.open(ctx, req.Principal, in.Store, rt.LevelView, "reading the app's verbs")
				if err != nil {
					return AppVerbsOut{}, err
				}
				run, err := e.K.Running(ctx, in.Store)
				if err != nil {
					return AppVerbsOut{}, err
				}
				out := AppVerbsOut{Store: in.Store, Type: st.Meta("type"), App: run.App, Snapshot: run.N, Files: []AppVerbFile{}}
				if run.N == 0 || run.Manifest == nil || run.Manifest.Slop.Verbs == nil {
					return out, nil
				}
				v := run.Manifest.Slop.Verbs
				out.Alias, out.Title, out.Include = v.Alias, v.Title, v.Include
				if in.Have != "" && in.Have == out.App+"@"+strconv.FormatInt(out.Snapshot, 10) {
					out.Unchanged = true
					return out, nil
				}
				as, err := e.K.Store(ctx, run.App)
				if err != nil {
					return AppVerbsOut{}, err
				}
				files, err := as.SnapshotFiles(ctx, run.N)
				if err != nil {
					return AppVerbsOut{}, err
				}
				total := 0
				for _, f := range files {
					if !matchesAny(v.Include, f.Path) {
						continue
					}
					if len(out.Files) == maxVerbFiles {
						return AppVerbsOut{}, verbs.Errf("resource_exhausted", "%s ships more than %d verb files", run.App, maxVerbFiles)
					}
					b, err := as.ReadFile(f)
					if err != nil {
						return AppVerbsOut{}, err
					}
					if total += len(b); total > maxVerbBytes {
						return AppVerbsOut{}, verbs.Errf("resource_exhausted", "%s's verb files are over %d bytes", run.App, maxVerbBytes)
					}
					out.Files = append(out.Files, AppVerbFile{Path: f.Path, Source: string(b)})
				}
				return out, nil
			}}.Verb(),
	}
}

func matchesAny(globs []string, p string) bool {
	for _, g := range globs {
		if ok, _ := doublestar.Match(g, p); ok {
			return true
		}
	}
	return false
}
