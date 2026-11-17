package actors

import (
	"encoding/json"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// A verb's error keeps its details on the way to JavaScript (e.extra),
// as plain JSON values: typed details (files.commit's conflicts) become
// objects with their JSON names.
func TestVerbFailKeepsExtra(t *testing.T) {
	type conflict struct {
		Path string `json:"path"`
	}
	err := &verbs.Error{Code: "conflict", Message: "draft moved", Extra: map[string]any{"at": int64(43), "conflicts": []conflict{{Path: "index.html"}}}}
	e := verbFail(err)
	if e.Code != "conflict" || e.Message != "draft moved" {
		t.Fatalf("verbFail = %+v", e)
	}
	b, _ := json.Marshal(e.Extra)
	if string(b) != `{"at":43,"conflicts":[{"path":"index.html"}]}` {
		t.Fatalf("extra = %s", b)
	}
	if cs, ok := e.Extra["conflicts"].([]any); !ok || cs[0].(map[string]any)["path"] != "index.html" {
		t.Fatalf("conflicts are not plain JSON: %#v", e.Extra["conflicts"])
	}
	if e := verbFail(verbs.Errf("not_found", "no store x")); e.Extra != nil {
		t.Fatalf("an error without details has extra %v", e.Extra)
	}
}
