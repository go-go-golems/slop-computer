package host

// SLOP3-016 phase 5: app verbs. The Pinboard app ships command-line verbs
// (apps/pinboard/verbs, manifest slop.verbs); app.verbs hands their sources
// to anyone who can view a board, and pkg/appverbs runs them as the person,
// through the board's actor.

import (
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/appverbs"
	"github.com/go-go-golems/slop-computer/pkg/client"
)

// harnessCaller calls verbs on the test server with a token.
type harnessCaller struct {
	t     *testing.T
	h     *harness
	token string
}

func (c harnessCaller) Call(verb string, args map[string]any) (any, error) {
	st, out := api(c.t, c.h, c.token, verb, args)
	if st != 200 {
		e, _ := out["error"].(map[string]any)
		code, _ := e["code"].(string)
		msg, _ := e["message"].(string)
		return nil, &client.APIError{Status: st, Code: code, Message: msg}
	}
	return out["result"], nil
}

func TestPinboardVerbs(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "pinboard"})
	h.call(admin, "files.push", map[string]any{"store": "pinboard", "files": appDir(t, "pinboard")})
	ada, bob, carol := h.tokenFor("ada@example.com"), h.tokenFor("bob@example.com"), h.tokenFor("carol@example.com")
	h.call(ada, "store.new", map[string]any{"id": "kitchen", "type": "pinboard", "app": "pinboard"})
	h.call(ada, "docs.set", map[string]any{"store": "kitchen", "path": "board/meta", "data": map[string]any{"title": "Kitchen"}})
	idOf := func(tok string) string { return h.call(tok, "whoami", nil).(map[string]any)["id"].(string) }
	h.call(ada, "grant.set", map[string]any{"store": "kitchen", "subject": idOf(bob), "level": "interact"})
	h.call(ada, "grant.set", map[string]any{"store": "kitchen", "subject": idOf(carol), "level": "view"})

	// app.verbs: the board's app's verb files, to a viewer; the app store
	// itself is not readable by Carol.
	src := h.call(carol, "app.verbs", map[string]any{"store": "kitchen"}).(map[string]any)
	if src["app"] != "pinboard" || src["alias"] != "pb" || src["title"] != "board/meta" || src["type"] != "pinboard" {
		t.Fatalf("app.verbs: %v", src)
	}
	paths := []string{}
	for _, f := range src["files"].([]any) {
		paths = append(paths, f.(map[string]any)["path"].(string))
	}
	if strings.Join(paths, ",") != "verbs/board.js,verbs/clip.js,verbs/coll.js" {
		t.Fatalf("verb files: %v", paths)
	}
	h.fail(carol, "files.ls", map[string]any{"store": "pinboard"}, "not_found") // hidden from her
	have := "pinboard@" + strings.TrimSuffix(strings.TrimSuffix(asJSON(src["snapshot"]), ".0"), "\n")
	if again := h.call(carol, "app.verbs", map[string]any{"store": "kitchen", "have": have}).(map[string]any); again["unchanged"] != true || len(again["files"].([]any)) != 0 {
		t.Fatalf("app.verbs with have=%s: %v", have, again)
	}
	dave := h.tokenFor("dave@example.com")
	h.fail(dave, "app.verbs", map[string]any{"store": "kitchen"}, "not_found")

	// Running them: as Bob (interact) and as Carol (view), through the actor.
	run := func(tok string, args ...string) (string, error) {
		t.Helper()
		c := harnessCaller{t, h, tok}
		s, err := appverbs.Fetch(c, "kitchen", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		b := appverbs.Board{ID: "kitchen", Title: "Kitchen", Type: "pinboard", App: "pinboard"}
		r, w, _ := os.Pipe()
		old := os.Stdout
		os.Stdout = w
		done := make(chan string)
		go func() { var buf bytes.Buffer; _, _ = io.Copy(&buf, r); done <- buf.String() }()
		var errw bytes.Buffer
		err = appverbs.Execute(context.Background(), s, c, b, []string{"slop", "pb", "Kitchen"}, "", args, &errw, &errw)
		os.Stdout = old
		_ = w.Close()
		return <-done + errw.String(), err
	}
	if out, err := run(bob, "clip", "add", "--url", "https://are.na/x", "--title", "inspo", "--tags", "a,b", "--format", "json"); err != nil || !strings.Contains(out, `"kind": "link"`) {
		t.Fatalf("bob adds: %v %s", err, out)
	}
	if _, err := run(bob, "coll", "insert", "recipes", "--set", "title=Soup", "--set", "minutes=20"); err != nil {
		t.Fatalf("bob inserts: %v", err)
	}
	if out, err := run(carol, "coll", "query", "recipes", "--where", "minutes<30", "--format", "json"); err != nil || !strings.Contains(out, `"title": "Soup"`) || !strings.Contains(out, `"minutes": 20`) {
		t.Fatalf("carol queries: %v %s", err, out)
	}
	if out, err := run(carol, "board", "describe"); err != nil || !strings.Contains(out, "Kitchen  (kitchen)") || !strings.Contains(out, "inspo") {
		t.Fatalf("carol describes: %v %s", err, out)
	}
	if _, err := run(carol, "clip", "add", "--text", "no"); err == nil || !strings.Contains(err.Error(), "interact") {
		t.Fatalf("carol (view) added a clip: %v", err)
	}
	if out, err := run(carol, "board", "log", "--format", "json"); err != nil || !strings.Contains(out, "bob (cli)") {
		t.Fatalf("log: %v %s", err, out)
	}
}
