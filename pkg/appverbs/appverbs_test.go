package appverbs

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// pinboard reads the Pinboard app's verb files from the repository, as
// app.verbs would send them.
func pinboard(t *testing.T) *Source {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "apps", "pinboard", "verbs", "*.js"))
	if err != nil || len(files) == 0 {
		t.Fatalf("verb files: %v %v", files, err)
	}
	src := &Source{Store: "s-1", Type: "pinboard", App: "pinboard", Snapshot: 3, Alias: "pb", Title: "board/meta"}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		src.Files = append(src.Files, File{Path: "verbs/" + filepath.Base(f), Source: string(b)})
	}
	return src
}

// fake records the verb calls a command makes and answers them.
type fake struct {
	calls  []string
	answer func(verb string, args map[string]any) (any, error)
}

func (f *fake) Call(verb string, args map[string]any) (any, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(args)
	f.calls = append(f.calls, verb+" "+strings.TrimSpace(b.String()))
	if f.answer != nil {
		return f.answer(verb, args)
	}
	return map[string]any{"ok": true}, nil
}

func TestPinboardVerbsScan(t *testing.T) {
	reg, err := Scan(pinboard(t))
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, v := range reg.Verbs() {
		got = append(got, v.FullPath())
	}
	sort.Strings(got)
	want := "board describe,board log,clip add,clip ls,clip rm,clip tag,coll insert,coll ls,coll query"
	if strings.Join(got, ",") != want {
		t.Fatalf("verbs: %v", got)
	}
}

// stdout captures what fn prints: Glazed writes results to os.Stdout.
func stdout(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	done := make(chan string)
	go func() { var b bytes.Buffer; _, _ = b.ReadFrom(r); done <- b.String() }()
	ferr := fn()
	os.Stdout = old
	_ = w.Close()
	return <-done, ferr
}

func run(t *testing.T, c Caller, args ...string) (string, error) {
	t.Helper()
	var errw bytes.Buffer
	return stdout(t, func() error {
		return Execute(context.Background(), pinboard(t), c, Board{ID: "s-1", Title: "Kitchen", Type: "pinboard", App: "pinboard"},
			[]string{"slop", "pb", "Kitchen"}, "pinboard's verbs on Kitchen", args, &errw, &errw)
	})
}

func TestPinboardVerbsCall(t *testing.T) {
	f := &fake{}
	if _, err := run(t, f, "clip", "add", "--url", "https://are.na/x", "--tags", "a,b", "--format", "json"); err != nil {
		t.Fatal(err)
	}
	if len(f.calls) != 1 || !strings.HasPrefix(f.calls[0], "actor.call ") ||
		!strings.Contains(f.calls[0], `"action":"addClip"`) || !strings.Contains(f.calls[0], `"store":"s-1"`) ||
		!strings.Contains(f.calls[0], `"tags":["a","b"]`) || !strings.Contains(f.calls[0], `"via":"cli"`) {
		t.Fatalf("calls: %v", f.calls)
	}
	// Conditions are parsed into the actor's [field, op, value].
	f.calls = nil
	if _, err := run(t, f, "coll", "query", "recipes", "--where", "minutes<30", "--where", "tags~easy", "--format", "json"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.calls[0], `"where":[["minutes","<",30],["tags","contains","easy"]]`) {
		t.Fatalf("query: %v", f.calls)
	}
	// Rows come back as rows; numbers stay numbers.
	f = &fake{answer: func(string, map[string]any) (any, error) {
		return []any{map[string]any{"id": "clip:a", "kind": "note", "z": json.Number("3")}}, nil
	}}
	out, err := run(t, f, "clip", "ls", "--format", "json")
	if err != nil || !strings.Contains(out, `"z": 3`) || !strings.Contains(out, `"id": "clip:a"`) {
		t.Fatalf("ls: %v %s", err, out)
	}
	// A server error reaches the person with its code.
	f = &fake{answer: func(string, map[string]any) (any, error) {
		return nil, &client.APIError{Code: "permission_denied", Message: "this needs interact; you have view"}
	}}
	if _, err := run(t, f, "clip", "rm", "clip:a"); err == nil || !strings.Contains(err.Error(), "this needs interact") {
		t.Fatalf("refused: %v", err)
	}
}

// The slop module reaches only the store the command runs on.
func TestSlopModuleIsScoped(t *testing.T) {
	src := &Source{Store: "s-1", App: "x", Snapshot: 1, Files: []File{{Path: "verbs/x.js", Source: `
function other() { return require("slop").board("s-2").call("describe", {}); }
__verb__("other", { parents: ["x"], output: "text" });
function same() { return require("slop").board("kitchen").id; }
__verb__("same", { parents: ["x"], output: "text" });
function nofs() { return typeof require("fs"); }
__verb__("nofs", { parents: ["x"], output: "text" });
`}}}
	f := &fake{}
	exec := func(args ...string) (string, error) {
		var errw bytes.Buffer
		return stdout(t, func() error {
			return Execute(context.Background(), src, f, Board{ID: "s-1", Title: "Kitchen"}, []string{"slop", "on", "s-1"}, "", args, &errw, &errw)
		})
	}
	if _, err := exec("x", "other"); err == nil || !strings.Contains(err.Error(), "runs on") || len(f.calls) != 0 {
		t.Fatalf("another store: %v %v", err, f.calls)
	}
	if out, err := exec("x", "same"); err != nil || !strings.Contains(out, "s-1") {
		t.Fatalf("same store by title: %v %q", err, out)
	}
	if _, err := exec("x", "nofs"); err == nil {
		t.Fatal("require('fs') worked in a verb")
	}
}

func TestFetchCaches(t *testing.T) {
	dir := t.TempDir()
	src := pinboard(t)
	n := 0
	f := &fake{answer: func(verb string, args map[string]any) (any, error) {
		n++
		if args["have"] == src.Key() {
			return map[string]any{"store": "s-1", "app": src.App, "snapshot": src.Snapshot, "unchanged": true, "files": []any{}}, nil
		}
		return src, nil
	}}
	a, err := Fetch(f, "s-1", dir)
	if err != nil || len(a.Files) != len(src.Files) {
		t.Fatalf("first fetch: %v %d", err, len(a.Files))
	}
	b, err := Fetch(f, "s-1", dir)
	if err != nil || len(b.Files) != len(src.Files) || !strings.Contains(f.calls[1], `"have":"pinboard@3"`) {
		t.Fatalf("cached fetch: %v %v", err, f.calls)
	}
	if n != 2 {
		t.Fatalf("calls: %d", n)
	}
}
