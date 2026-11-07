package apps

import (
	"strings"
	"testing"
)

func TestManifestVerbs(t *testing.T) {
	m, err := Parse([]byte(`{"slop": {"verbs": {"alias": "pb", "include": ["verbs/*.js", "lib/**/*.js"], "title": "board/meta"}}}`))
	if err != nil || m.Slop.Verbs == nil || m.Slop.Verbs.Alias != "pb" || len(m.Slop.Verbs.Include) != 2 {
		t.Fatalf("parse: %v %+v", err, m)
	}
	for raw, want := range map[string]string{
		`{"slop": {"verbs": {"alias": "PB", "include": ["v/*.js"]}}}`:                "alias",
		`{"slop": {"verbs": {"alias": "a-very-long-alias-name", "include": ["v"]}}}`: "alias",
		`{"slop": {"verbs": {"include": []}}}`:                                       "include",
		`{"slop": {"verbs": {"include": ["../x.js"]}}}`:                              "relative",
		`{"slop": {"verbs": {"include": ["/x.js"]}}}`:                                "relative",
		`{"slop": {"verbs": {"include": ["v/*.js"], "title": "board"}}}`:             "document path",
	} {
		if _, err := Parse([]byte(raw)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want an error about %s, got %v", raw, want, err)
		}
	}
}
