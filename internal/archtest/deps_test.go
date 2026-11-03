// Package archtest checks the dependency rules of SLOP3-009's package map
// (design-doc §10) as a ratchet: a forbidden import fails the build unless
// it is listed in allowed, and a listed import that no longer exists fails
// too, so the list only shrinks.
package archtest

import (
	"encoding/json"
	"os/exec"
	"sort"
	"strings"
	"testing"
)

const mod = "github.com/go-go-golems/slop-computer/"

// Layers, by import path under the module (and the two outside imports the
// rules name).
var (
	core     = []string{"pkg/rt", "pkg/ids", "pkg/blobs", "pkg/store", "pkg/access", "pkg/authz", "pkg/apps", "pkg/config", "pkg/httpx", "pkg/client"}
	domains  = []string{"pkg/system", "pkg/registry", "pkg/identity", "pkg/billing", "pkg/llm", "pkg/kernel"}
	caps     = []string{"pkg/caps"}
	runtime  = []string{"pkg/actor"}
	table    = []string{"pkg/verbs"}
	doors    = []string{"pkg/server"}
	netHTTP  = "net/http"
	gojaPath = "github.com/dop251/goja"
)

// rules: packages under from may not import packages under any of to.
var rules = []struct {
	why      string
	from, to []string
}{
	{"the verb table imports no domain, capability, runtime or door", table, concat(domains, caps, runtime, doors, []string{gojaPath})},
	{"domains know nothing of HTTP, goja, capabilities, the table's callers or doors", domains, concat(caps, runtime, doors, []string{netHTTP, gojaPath})},
	{"capabilities know nothing of HTTP, goja, the runtime or doors", caps, concat(runtime, doors, []string{netHTTP, gojaPath})},
	{"the actor runtime is given its capabilities by a door, through interfaces", runtime, caps},
	{"core imports no domain, capability, runtime, table or door", core, concat(domains, caps, runtime, table, doors)},
	{"identity imports no other slop package", []string{"pkg/identity"}, concat(core, domains, caps, runtime, table, doors)},
	{"only cmd/ imports the server", concat(core, domains, caps, runtime, table), doors},
}

// allowed are today's violations. Remove an entry when its import goes.
var allowed = map[string]bool{
	"pkg/verbs -> pkg/actor":              true,
	"pkg/verbs -> pkg/billing/stripe":     true,
	"pkg/verbs -> pkg/kernel":             true,
	"pkg/verbs -> pkg/system":             true,
	"pkg/verbs -> github.com/dop251/goja": true,
	"pkg/access -> pkg/system":            true,
}

func concat(xs ...[]string) []string {
	var out []string
	for _, x := range xs {
		out = append(out, x...)
	}
	return out
}

func under(pkg string, roots []string) bool {
	for _, r := range roots {
		if pkg == r || strings.HasPrefix(pkg, r+"/") {
			return true
		}
	}
	return false
}

func TestDependencyRules(t *testing.T) {
	cmd := exec.Command("go", "list", "-json", "./pkg/...")
	cmd.Dir = "../.."
	cmd.Env = append(cmd.Environ(), "GOWORK=off")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	dec := json.NewDecoder(strings.NewReader(string(out)))
	edges := map[string]bool{}
	for dec.More() {
		var p struct {
			ImportPath string
			Imports    []string
		}
		if err := dec.Decode(&p); err != nil {
			t.Fatal(err)
		}
		from := strings.TrimPrefix(p.ImportPath, mod)
		for _, imp := range p.Imports {
			edges[from+" -> "+strings.TrimPrefix(imp, mod)] = true
		}
	}
	var bad, stale []string
	broken := map[string]bool{}
	for e := range edges {
		from, to, _ := strings.Cut(e, " -> ")
		for _, r := range rules {
			if under(from, r.from) && under(to, r.to) {
				broken[e] = true
				if !allowed[e] {
					bad = append(bad, e+" ("+r.why+")")
				}
			}
		}
	}
	for e, ok := range allowed {
		if ok && !broken[e] {
			stale = append(stale, e)
		}
	}
	sort.Strings(bad)
	sort.Strings(stale)
	for _, b := range bad {
		t.Errorf("forbidden import: %s", b)
	}
	for _, s := range stale {
		t.Errorf("allowed but no longer imported (remove it from allowed): %s", s)
	}
}
