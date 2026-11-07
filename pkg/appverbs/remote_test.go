package appverbs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/go-go-goja/pkg/jsverbs"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

var mcpBoard = Board{ID: "s-1", Title: "Kitchen", Type: "pinboard", App: "pinboard", Via: "mcp"}

// The remote invoker takes values as JSON, checks them against the verb's
// fields as the CLI's flags would be, and calls through the same module.
func TestRunRemote(t *testing.T) {
	reg, err := Scan(pinboard(t))
	if err != nil {
		t.Fatal(err)
	}
	f := &fake{}
	var logs bytes.Buffer
	run := func(path string, in map[string]any) (any, error) {
		f.calls = nil
		return Run(context.Background(), reg, path, in, f, mcpBoard, &logs, time.Second)
	}
	// JSON numbers arrive as float64; integers, lists and booleans convert.
	if _, err := run("coll query", map[string]any{"coll": "recipes", "where": []any{"minutes<30"}, "limit": 10.0, "desc": true}); err != nil {
		t.Fatal(err)
	}
	if c := f.calls[0]; !strings.Contains(c, `"where":[["minutes","<",30]]`) || !strings.Contains(c, `"limit":10`) || !strings.Contains(c, `"desc":true`) {
		t.Fatalf("query: %v", f.calls)
	}
	// Defaults apply as on the command line (limit 50).
	if _, err := run("clip ls", map[string]any{}); err != nil || !strings.Contains(f.calls[0], `"limit":50`) {
		t.Fatalf("ls defaults: %v %v", err, f.calls)
	}
	// board().via says how the verb was reached; Pinboard logs it.
	if _, err := run("clip add", map[string]any{"text": "hi", "tags": []any{"a"}}); err != nil || !strings.Contains(f.calls[0], `"via":"mcp"`) {
		t.Fatalf("add via: %v %v", err, f.calls)
	}
	for name, tc := range map[string]struct {
		path string
		in   map[string]any
		code string
		want string
	}{
		"missing argument": {"coll query", map[string]any{}, "invalid_argument", "needs coll"},
		"unknown field":    {"clip add", map[string]any{"colour": "red"}, "invalid_argument", `no field "colour"`},
		"not an integer":   {"clip ls", map[string]any{"limit": 2.5}, "invalid_argument", "integer"},
		"not a list":       {"clip add", map[string]any{"tags": "a,b"}, "invalid_argument", "list of strings"},
		"no such verb":     {"clip fly", map[string]any{}, "not_found", "no verb"},
	} {
		_, err := run(tc.path, tc.in)
		var ve *verbs.Error
		if !errorsAs(err, &ve) || ve.Code != tc.code || !strings.Contains(ve.Message, tc.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A refusal keeps its code through the verb's JavaScript.
	f.answer = func(string, map[string]any) (any, error) {
		return nil, &verbs.Error{Code: "permission_denied", Message: "this needs interact; you have view"}
	}
	_, err = run("clip rm", map[string]any{"id": "clip:a"})
	var ve *verbs.Error
	if !errorsAs(err, &ve) || ve.Code != "permission_denied" {
		t.Fatalf("refusal: %v", err)
	}
	// So does one from the CLI's client.
	f.answer = func(string, map[string]any) (any, error) {
		return nil, &client.APIError{Code: "not_found", Message: "no clip"}
	}
	if _, err = run("clip rm", map[string]any{"id": "clip:a"}); !errorsAs(err, &ve) || ve.Code != "not_found" {
		t.Fatalf("client refusal: %v", err)
	}
}

func errorsAs(err error, ve **verbs.Error) bool { return errors.As(err, ve) }

// A verb that never returns is interrupted; console output is kept.
func TestRunLimits(t *testing.T) {
	src := &Source{Store: "s-1", App: "x", Snapshot: 1, Files: []File{{Path: "verbs/x.js", Source: `
function spin() { console.log("starting", {n: 1}); for (;;) {} }
__verb__("spin", { parents: ["x"], output: "text" });
`}}}
	reg, err := Scan(src)
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	start := time.Now()
	_, err = Run(context.Background(), reg, "x spin", nil, &fake{}, mcpBoard, &logs, 100*time.Millisecond)
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("spin: %v after %v", err, time.Since(start))
	}
	if !strings.Contains(logs.String(), `starting {"n":1}`) {
		t.Fatalf("logs: %q", logs.String())
	}
}

// Fields that make Glazed read files are refused when the verbs are
// scanned, on the server and in the CLI alike.
func TestFileFieldsRefused(t *testing.T) {
	for _, typ := range []string{"file", "fileList", "stringFromFile", "objectFromFile", "stringListFromFiles", "keyValue"} {
		src := &Source{Store: "s-1", App: "x", Snapshot: 1, Files: []File{{Path: "verbs/x.js", Source: `
function steal(key) { return key; }
__verb__("steal", { parents: ["x"], fields: { key: { type: "` + typ + `", default: "/home/me/.ssh/id_ed25519" } } });
`}}}
		if _, err := Scan(src); err == nil || !strings.Contains(err.Error(), "reads files") {
			t.Errorf("%s: %v", typ, err)
		}
	}
}

func TestInputSchema(t *testing.T) {
	reg, err := Scan(pinboard(t))
	if err != nil {
		t.Fatal(err)
	}
	store := map[string]any{"store": map[string]any{"type": "string"}}
	get := func(path string) map[string]any {
		v, ok := reg.Verb(path)
		if !ok {
			t.Fatalf("no %s", path)
		}
		s, err := InputSchema(reg, v, store, "store")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(s)
		var out map[string]any
		_ = json.Unmarshal(b, &out)
		return out
	}
	q := get("coll query")
	if r := q["required"].([]any); len(r) != 2 || r[0] != "store" || r[1] != "coll" {
		t.Fatalf("required: %v", q["required"])
	}
	p := q["properties"].(map[string]any)
	if l := p["limit"].(map[string]any); l["type"] != "integer" || l["default"] != 100.0 {
		t.Fatalf("limit: %v", l)
	}
	if w := p["where"].(map[string]any); w["type"] != "array" || w["items"].(map[string]any)["type"] != "string" {
		t.Fatalf("where: %v", w)
	}
	if p["desc"].(map[string]any)["type"] != "boolean" || p["order-by"] == nil || q["additionalProperties"] != false {
		t.Fatalf("query schema: %v", q)
	}
	if n := ToolName("pb", mustVerb(t, reg, "clip add")); n != "pb_clip_add" {
		t.Fatalf("tool name: %s", n)
	}
}

func mustVerb(t *testing.T, reg *jsverbs.Registry, path string) *jsverbs.VerbSpec {
	t.Helper()
	v, ok := reg.Verb(path)
	if !ok {
		t.Fatalf("no %s", path)
	}
	return v
}

func TestCache(t *testing.T) {
	c := NewCache(2)
	src := pinboard(t)
	a, err := c.Get(src)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := c.Get(src); a != b || c.Lookup(src.Key()) != a {
		t.Fatal("not cached")
	}
	for i := int64(10); i < 13; i++ {
		s := *src
		s.Snapshot = i
		if _, err := c.Get(&s); err != nil {
			t.Fatal(err)
		}
	}
	if c.Lookup(src.Key()) != nil || len(c.regs) != 2 {
		t.Fatalf("not bounded: %d", len(c.regs))
	}
}
