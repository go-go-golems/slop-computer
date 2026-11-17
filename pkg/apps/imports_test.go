package apps

import (
	"strings"
	"testing"
)

func TestManifestImports(t *testing.T) {
	m, err := Parse([]byte(`{"slop": {"imports": {
		"page": {"preact": "vendor/preact@10.24.3/preact.js", "preact/hooks": "vendor/preact@10.24.3/hooks.js", "@lit/context": "vendor/ctx/index.js", "lit/decorators.js": "vendor/lit/decorators.js"},
		"actor": {"zod": "vendor/zod@3.23.8/zod.cjs"}}}}`))
	if err != nil || len(m.Slop.Imports.Page) != 4 || m.Slop.Imports.Actor["zod"] != "vendor/zod@3.23.8/zod.cjs" {
		t.Fatalf("parse: %v %+v", err, m)
	}
	for raw, want := range map[string]string{
		`{"slop": {"imports": {"page": {"./x": "x.js"}}}}`:           "bare import name",
		`{"slop": {"imports": {"page": {"https://x/y": "x.js"}}}}`:   "bare import name",
		`{"slop": {"imports": {"page": {"Lit": "x.js"}}}}`:           "bare import name",
		`{"slop": {"imports": {"page": {"lit": "/vendor/lit.js"}}}}`: "relative path",
		`{"slop": {"imports": {"actor": {"zod": "../zod.cjs"}}}}`:    "relative path",
		`{"slop": {"imports": {"actor": {"zod": ""}}}}`:              "relative path",
		`{"slop": {"imports": {"page": {"lit": "vendor//lit.js"}}}}`: "relative path",
	} {
		if _, err := Parse([]byte(raw)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want an error about %s, got %v", raw, want, err)
		}
	}
}
