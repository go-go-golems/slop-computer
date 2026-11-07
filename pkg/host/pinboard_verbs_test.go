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
	"time"

	"github.com/go-go-golems/slop-computer/pkg/appverbs"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/llm"
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

// kitchen installs the Pinboard app and Ada's board "Kitchen", with Bob at
// interact and Carol at view.
func kitchen(t *testing.T) (*harness, string, string, string) {
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
	return h, ada, bob, carol
}

func TestPinboardVerbs(t *testing.T) {
	h, _, bob, carol := kitchen(t)

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

// Phase 5b: the same verbs run on the server (app.verb) with values as
// JSON, and are MCP tools named <alias>_<group>_<verb> (app.tools).
func TestPinboardVerbsRemote(t *testing.T) {
	h, _, bob, carol := kitchen(t)
	verb := func(tok, path string, values map[string]any) map[string]any {
		t.Helper()
		return h.call(tok, "app.verb", map[string]any{"store": "kitchen", "verb": path, "values": values}).(map[string]any)
	}
	added := verb(bob, "clip add", map[string]any{"text": "from the server", "tags": []any{"m"}})
	if r, _ := added["result"].(map[string]any); r == nil || r["kind"] != "note" || added["output"] != "glaze" {
		t.Fatalf("bob adds: %v", added)
	}
	verb(bob, "coll insert", map[string]any{"coll": "recipes", "set": []any{"title=Soup", "minutes=20"}})
	rows := verb(carol, "coll query", map[string]any{"coll": "recipes", "where": []any{"minutes<30"}})
	if !strings.Contains(asJSON(rows["result"]), `"title":"Soup"`) {
		t.Fatalf("carol queries: %v", rows)
	}
	if d := verb(carol, "board describe", nil); d["output"] != "text" || !strings.Contains(d["result"].(string), "from the server") {
		t.Fatalf("carol describes: %v", d)
	}
	// Refusals keep their codes; values are checked like flags.
	h.fail(carol, "app.verb", map[string]any{"store": "kitchen", "verb": "clip add", "values": map[string]any{"text": "no"}}, "permission_denied")
	h.fail(bob, "app.verb", map[string]any{"store": "kitchen", "verb": "clip add", "values": map[string]any{"colour": "red"}}, "invalid_argument")
	h.fail(bob, "app.verb", map[string]any{"store": "kitchen", "verb": "clip fly"}, "not_found")
	h.fail(bob, "app.verb", map[string]any{"store": "kitchen", "verb": "clip ls", "alias": "xx"}, "invalid_argument")
	dave := h.tokenFor("dave@example.com")
	h.fail(dave, "app.verb", map[string]any{"store": "kitchen", "verb": "clip ls"}, "not_found")

	// app.tools: once per app, with the store as an argument; none for Dave.
	tools := h.call(carol, "app.tools", nil).(map[string]any)["tools"].([]any)
	names := []string{}
	for _, x := range tools {
		names = append(names, x.(map[string]any)["name"].(string))
	}
	if !strings.Contains(strings.Join(names, ","), "pb_clip_add") || len(names) != 10 {
		t.Fatalf("app.tools: %v", names)
	}
	if got := h.call(dave, "app.tools", nil).(map[string]any)["tools"].([]any); len(got) != 0 {
		t.Fatalf("dave's tools: %v", got)
	}

	// Through the MCP door, as Bob: listed, called, logged as mcp.
	listed := mcpResult(t, mcpPost(t, h, bob, map[string]any{"id": 1, "method": "tools/list"}, nil))
	var add map[string]any
	for _, x := range listed["tools"].([]any) {
		if m := x.(map[string]any); m["name"] == "pb_clip_add" {
			add = m
		}
	}
	if add == nil || !strings.Contains(asJSON(add["inputSchema"]), `"required":["store"]`) {
		t.Fatalf("pb_clip_add listed: %v", add)
	}
	res := mcpResult(t, mcpPost(t, h, bob, map[string]any{"id": 2, "method": "tools/call",
		"params": map[string]any{"name": "pb_clip_add", "arguments": map[string]any{"store": "kitchen", "url": "https://are.na/y", "title": "via mcp"}}}, nil))
	if res["isError"] == true || !strings.Contains(asJSON(res["structuredContent"]), `"kind":"link"`) {
		t.Fatalf("pb_clip_add: %v", res)
	}
	refused := mcpResult(t, mcpPost(t, h, carol, map[string]any{"id": 3, "method": "tools/call",
		"params": map[string]any{"name": "pb_clip_add", "arguments": map[string]any{"store": "kitchen", "text": "no"}}}, nil))
	if refused["isError"] != true || !strings.Contains(asJSON(refused["content"]), "permission_denied") {
		t.Fatalf("carol's pb_clip_add: %v", refused)
	}
	log := verb(carol, "board log", nil)
	if s := asJSON(log["result"]); !strings.Contains(s, "bob (mcp)") {
		t.Fatalf("log: %s", s)
	}
}

// Phase 6: the board's agent on the server (ask: the actions as the model's
// tools, through actor sample tools) and log pruning.
func TestPinboardAgentAndPrune(t *testing.T) {
	h, ada, bob, carol := kitchen(t)
	h.a.LLM = &llm.Fake{}
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	ask := map[string]any{"store": "kitchen", "action": "ask", "args": map[string]any{"question": "what is on this board?"}}
	// Off until an admin allows sample for the app.
	h.fail(bob, "actor.call", ask, "unavailable")
	h.call(admin, "policy.set", map[string]any{"app": "pinboard", "capability": "sample", "audience": "@member", "value": "on"})
	h.call(admin, "llm.set", map[string]any{"subject": "@member", "value": "on", "budget": 1000000})
	// The fake model calls the first tool (describe) and reports.
	for _, tok := range []string{bob, carol} {
		if r := h.call(tok, "actor.call", ask).(map[string]any); r["answer"] != "The browser tool completed successfully." {
			t.Fatalf("ask: %v", r)
		}
	}
	h.fail(bob, "actor.call", map[string]any{"store": "kitchen", "action": "ask", "args": map[string]any{}}, "invalid_argument")
	verb := h.call(carol, "app.verb", map[string]any{"store": "kitchen", "verb": "board ask", "values": map[string]any{"question": "hi"}}).(map[string]any)
	if verb["result"] != "The browser tool completed successfully." || verb["output"] != "text" {
		t.Fatalf("board ask: %v", verb)
	}

	// Pruning keeps the newest steps and anything newer than logDays.
	day := int64(86400000)
	ms := func(daysAgo int64) int64 { return nowMillis() - daysAgo*day }
	h.call(bob, "actor.call", map[string]any{"store": "kitchen", "action": "addClip", "args": map[string]any{"text": "one"}})
	h.call(bob, "actor.call", map[string]any{"store": "kitchen", "action": "addClip", "args": map[string]any{"text": "two"}})
	h.call(ada, "docs.set", map[string]any{"store": "kitchen", "path": "log/tx:old40", "data": map[string]any{"id": "tx:old40", "at": ms(40), "by": "x", "label": "old", "ops": []any{}}})
	h.call(ada, "docs.set", map[string]any{"store": "kitchen", "path": "log/tx:old2", "data": map[string]any{"id": "tx:old2", "at": ms(2), "by": "x", "label": "old", "ops": []any{}}})
	prune := map[string]any{"store": "kitchen", "action": "pruneLog", "args": map[string]any{"keep": 2}}
	h.fail(bob, "actor.call", prune, "permission_denied") // admins only
	if r := h.call(ada, "actor.call", prune).(map[string]any); r["removed"] != 1.0 {
		t.Fatalf("prune at 30 days: %v", r)
	}
	h.fail(ada, "docs.get", map[string]any{"store": "kitchen", "path": "log/tx:old40"}, "not_found")
	h.call(ada, "docs.get", map[string]any{"store": "kitchen", "path": "log/tx:old2"})
	h.call(ada, "docs.update", map[string]any{"store": "kitchen", "path": "board/meta", "data": map[string]any{"logDays": 1}})
	if r := h.call(ada, "actor.call", prune).(map[string]any); r["removed"] != 1.0 || r["days"] != 1.0 {
		t.Fatalf("prune at 1 day: %v", r)
	}
	// The newest two always stay, whatever their age.
	if r := h.call(ada, "actor.call", map[string]any{"store": "kitchen", "action": "log", "args": map[string]any{"limit": 50}}).([]any); len(r) < 2 {
		t.Fatalf("log after pruning: %v", r)
	}
}

func nowMillis() int64 { return time.Now().UnixMilli() }
