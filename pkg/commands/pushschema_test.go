package commands

import (
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// files.push's manifest is a union in its schema, and so in TypeScript.
func TestPushFilesSchema(t *testing.T) {
	v := verbs.Def[FilesPushIn, any]{Name: "x"}.Verb()
	files, ok := v.Input.Properties.Get("files")
	if !ok || len(files.OneOf) != 2 {
		t.Fatalf("files = %+v", files)
	}
	ts := verbs.TypeScript(files, "")
	for _, want := range []string{"text: string;", "data: string;", "sha256: string;\n  size: number;", "} | {", "})[] | string"} {
		if !strings.Contains(ts, want) {
			t.Errorf("files in TypeScript lacks %q:\n%s", want, ts)
		}
	}
}

// files.commit's changes are the union the verb enforces.
func TestFileChangeSchema(t *testing.T) {
	v := verbs.Def[FilesCommitIn, any]{Name: "x"}.Verb()
	changes, _ := v.Input.Properties.Get("changes")
	ts := verbs.TypeScript(changes, "")
	for _, want := range []string{"text: string;", "data: string;", "sha256: string;\n  size: number;", "delete: true;", "})[]"} {
		if !strings.Contains(ts, want) {
			t.Errorf("changes in TypeScript lacks %q:\n%s", want, ts)
		}
	}
}
