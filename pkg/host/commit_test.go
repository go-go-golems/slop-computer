package host

// SLOP3-023 phase 1: files.commit, a change list against a base snapshot,
// merged per path in one store turn; ref.rm. The design is the ticket's
// guide, section 5.1.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
)

// commitOut is files.commit's result, decoded.
type commitOut struct {
	N, At, Base, Rev int64
	Merged           bool
	Activated        []map[string]any
}

func asCommit(t *testing.T, v any) commitOut {
	t.Helper()
	var out commitOut
	b, _ := json.Marshal(v)
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("commit result %s: %v", b, err)
	}
	return out
}

// tree is a ref's files at a snapshot, path → text.
func tree(h *harness, token, store string, at int64) map[string]string {
	h.t.Helper()
	out := map[string]string{}
	for _, x := range h.call(token, "files.ls", map[string]any{"store": store, "at": fmt.Sprint(at)}).([]any) {
		p := x.(map[string]any)["path"].(string)
		out[p] = fmt.Sprint(h.call(token, "files.cat", map[string]any{"store": store, "at": fmt.Sprint(at), "path": p}))
	}
	return out
}

func snapCount(h *harness, token, store string) int {
	h.t.Helper()
	return len(h.call(token, "snap.ls", map[string]any{"store": store}).([]any))
}

func text(s string) map[string]any { return map[string]any{"text": s} }

// changes builds a change list: path → {text} or {delete: true} or any
// other change object.
func changes(m map[string]map[string]any) []any {
	paths := make([]string, 0, len(m))
	for p := range m {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	out := []any{}
	for _, p := range paths {
		c := map[string]any{"path": p}
		for k, v := range m[p] {
			c[k] = v
		}
		out = append(out, c)
	}
	return out
}

var del = map[string]any{"delete": true}

// A commit at the ref's own snapshot applies its changes and nothing else;
// base 0 makes the ref; files not listed stay; "" is an empty file; a
// delete of a file that is not there is nothing; a commit that changes
// nothing keeps the ref's snapshot.
func TestCommitClean(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "site"})

	// base 0: the ref does not exist yet.
	c0 := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": 0, "message": "first",
		"changes": changes(map[string]map[string]any{"index.html": text("<h1>one</h1>"), "style.css": text("h1{}")})}))
	if c0.N == 0 || c0.At != 0 || c0.Base != 0 || c0.Merged || c0.Rev == 0 {
		t.Fatalf("first commit = %+v", c0)
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "site"}).(map[string]any); num(refs["draft"]) != c0.N || refs["main"] != nil {
		t.Fatalf("refs = %v", refs)
	}

	// at == base: a clean commit; untouched files stay; "" is a file.
	c1 := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": c0.N,
		"changes": changes(map[string]map[string]any{"index.html": text("<h1>two</h1>"), "empty.txt": text("")})}))
	if c1.N <= c0.N || c1.At != c0.N || c1.Merged {
		t.Fatalf("clean commit = %+v", c1)
	}
	if got := tree(h, admin, "site", c1.N); !reflect.DeepEqual(got, map[string]string{"empty.txt": "", "index.html": "<h1>two</h1>", "style.css": "h1{}"}) {
		t.Fatalf("tree at %d = %v", c1.N, got)
	}
	if f := h.call(admin, "files.cat", map[string]any{"store": "site", "at": "draft", "path": "empty.txt", "as": "base64"}).(map[string]any); num(f["size"]) != 0 {
		t.Fatalf("empty.txt = %v", f)
	}

	// Deleting a file that is not there, or putting what is there, makes
	// no snapshot: the answer is where the ref is.
	before := snapCount(h, admin, "site")
	c2 := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": c1.N,
		"changes": changes(map[string]map[string]any{"nope.txt": del, "style.css": text("h1{}")})}))
	if c2.N != c1.N || c2.At != c1.N || c2.Rev != 0 || snapCount(h, admin, "site") != before {
		t.Fatalf("no-op commit = %+v (snapshots %d → %d)", c2, before, snapCount(h, admin, "site"))
	}

	// A delete removes the file; main never moved.
	c3 := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": c1.N,
		"changes": changes(map[string]map[string]any{"style.css": del})}))
	if _, ok := tree(h, admin, "site", c3.N)["style.css"]; ok || c3.N <= c1.N {
		t.Fatalf("delete: %+v", c3)
	}
	// ref defaults to main, which does not exist: base 0 makes it.
	cm := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "base": 0, "changes": changes(map[string]map[string]any{"index.html": text("main")})}))
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "site"}).(map[string]any); num(refs["main"]) != cm.N || num(refs["draft"]) != c3.N {
		t.Fatalf("refs after a commit to main = %v", refs)
	}
}

// When the ref moved since base, the commit applies over where it is now,
// path by path: disjoint changes merge; the same path changed to another
// result is a conflict and nothing is written; the same result is not a
// conflict.
func TestCommitMerge(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "site"})
	base := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": 0,
		"changes": changes(map[string]map[string]any{"index.html": text("one"), "a.txt": text("a"), "b.txt": text("b"), "c.txt": text("c")})})).N
	commit := func(base int64, m map[string]map[string]any) map[string]any {
		return map[string]any{"store": "site", "ref": "draft", "base": base, "changes": changes(m)}
	}

	// Theirs: index.html and a.txt changed, b.txt deleted, new.txt added.
	theirs := asCommit(t, h.call(admin, "files.commit", commit(base, map[string]map[string]any{
		"index.html": text("theirs"), "a.txt": text("a2"), "b.txt": del, "new.txt": text("new")})))

	// Disjoint: c.txt and mine.txt; applied over theirs.
	mine := asCommit(t, h.call(admin, "files.commit", commit(base, map[string]map[string]any{"c.txt": text("c2"), "mine.txt": text("mine")})))
	if !mine.Merged || mine.At != theirs.N || mine.Base != base || mine.N <= theirs.N {
		t.Fatalf("merge = %+v (theirs %d)", mine, theirs.N)
	}
	want := `{"a.txt":"a2","c.txt":"c2","index.html":"theirs","mine.txt":"mine","new.txt":"new"}`
	if got := fmtAny(tree(h, admin, "site", mine.N)); got != want {
		t.Fatalf("merged tree = %s, want %s", got, want)
	}

	// Conflicts: the same path to another text; edit vs their delete;
	// delete vs their edit; a file they added, with other bytes. Nothing
	// is written, and the answer names where the ref is and each path.
	snaps := snapCount(h, admin, "site")
	e := h.fail(admin, "files.commit", commit(base, map[string]map[string]any{
		"index.html": text("mine"), "b.txt": text("b2"), "a.txt": del, "new.txt": text("other"), "d.txt": text("d")}), "conflict")
	extra := e["extra"].(map[string]any)
	if num(extra["at"]) != mine.N || fmtAny(extra["conflicts"]) != `[{"path":"a.txt"},{"path":"b.txt"},{"path":"index.html"},{"path":"new.txt"}]` {
		t.Fatalf("conflict extra = %v", extra)
	}
	if !strings.Contains(e["message"].(string), "index.html") {
		t.Fatalf("conflict message = %v", e["message"])
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "site"}).(map[string]any); num(refs["draft"]) != mine.N || snapCount(h, admin, "site") != snaps {
		t.Fatalf("a conflict wrote: refs %v, snapshots %d → %d", refs, snaps, snapCount(h, admin, "site"))
	}
	if _, ok := tree(h, admin, "site", mine.N)["d.txt"]; ok {
		t.Fatal("a conflicting commit's other change landed")
	}

	// The same result as theirs is no conflict: the same text, a delete of
	// what they deleted. Here the tree does not change: the answer is at.
	same := asCommit(t, h.call(admin, "files.commit", commit(base, map[string]map[string]any{"index.html": text("theirs"), "b.txt": del})))
	if same.N != mine.N || same.At != mine.N || !same.Merged {
		t.Fatalf("same-result commit = %+v, want n %d", same, mine.N)
	}

	// A ref removed since base is a conflict, not a new ref made of these
	// changes alone.
	h.call(admin, "ref.move", map[string]any{"store": "site", "ref": "gone", "n": base, "ifAt": 0})
	h.call(admin, "ref.rm", map[string]any{"store": "site", "ref": "gone", "ifAt": base})
	e = h.fail(admin, "files.commit", map[string]any{"store": "site", "ref": "gone", "base": base, "changes": changes(map[string]map[string]any{"z.txt": text("z")})}, "conflict")
	if fmtAny(e["extra"]) != `{"at":0,"conflicts":[]}` {
		t.Fatalf("removed ref extra = %v", e["extra"])
	}

	// base 0 over an existing ref: every file there is "theirs".
	h.fail(admin, "files.commit", commit(0, map[string]map[string]any{"index.html": text("x")}), "conflict")
	if c := asCommit(t, h.call(admin, "files.commit", commit(0, map[string]map[string]any{"z.txt": text("z")}))); !c.Merged || c.At != mine.N {
		t.Fatalf("base 0 over draft = %+v", c)
	}
}

// files.commit's arguments: base is required and must be a snapshot;
// changes name a clean path once, with exactly one of text, data, sha256
// or delete; blobs the server lacks are missing_blobs, as for a push.
func TestCommitArguments(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "site"})
	n := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": 0, "changes": changes(map[string]map[string]any{"a.txt": text("a")})})).N
	ok := map[string]any{"path": "b.txt", "text": "b"}
	bad := func(args map[string]any, code string) {
		t.Helper()
		in := map[string]any{"store": "site", "ref": "draft", "base": n, "changes": []any{ok}}
		for k, v := range args {
			if v == nil {
				delete(in, k)
			} else {
				in[k] = v
			}
		}
		h.fail(admin, "files.commit", in, code)
	}
	bad(map[string]any{"base": nil}, "invalid_argument")
	bad(map[string]any{"base": -1}, "invalid_argument")
	bad(map[string]any{"base": n + 100}, "invalid_argument") // not a snapshot
	bad(map[string]any{"changes": nil}, "invalid_argument")
	bad(map[string]any{"ref": "Draft"}, "invalid_argument")
	bad(map[string]any{"ref": "9"}, "invalid_argument")
	for _, c := range []map[string]any{
		{"path": "../x", "text": "x"},
		{"path": "/x", "text": "x"},
		{"path": "x.txt"},                                // nothing to do
		{"path": "x.txt", "text": "x", "delete": true},   // two things
		{"path": "x.txt", "text": "x", "data": "eA=="},   // two things
		{"path": "x.txt", "blob": "9f3a"},                // unknown field
		{"path": "x.txt", "sha256": "nothex", "size": 1}, // not a sha256
		{"path": "x.txt", "data": "not base64!"},         // bad data
	} {
		bad(map[string]any{"changes": []any{c}}, "invalid_argument")
	}
	bad(map[string]any{"changes": []any{ok, ok}}, "invalid_argument") // twice
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "site"}).(map[string]any); num(refs["draft"]) != n {
		t.Fatalf("a refused commit moved draft: %v", refs)
	}

	// sha256: a blob the server lacks is missing_blobs; sent as blobs, it lands.
	png := []byte("\x89PNG not really")
	sum := sha256.Sum256(png)
	hexSum := hex.EncodeToString(sum[:])
	byHash := map[string]any{"path": "logo.png", "sha256": hexSum, "size": len(png)}
	e := h.fail(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": n, "changes": []any{byHash}}, "missing_blobs")
	if fmtAny(e["extra"]) != `{"missing":["`+hexSum+`"]}` {
		t.Fatalf("missing_blobs extra = %v", e["extra"])
	}
	c := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": n, "changes": []any{byHash},
		"blobs": map[string]any{hexSum: base64.StdEncoding.EncodeToString(png)}}))
	f := h.call(admin, "files.cat", map[string]any{"store": "site", "at": fmt.Sprint(c.N), "path": "logo.png", "as": "base64"}).(map[string]any)
	if f["sha256"] != hexSum || f["type"] != "image/png" {
		t.Fatalf("logo.png = %v", f)
	}
	// data: bytes in base64, with a type.
	c2 := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": c.N,
		"changes": []any{map[string]any{"path": "bin/x", "data": base64.StdEncoding.EncodeToString([]byte{0, 1, 2}), "type": "application/x-test"}}}))
	if f := h.call(admin, "files.cat", map[string]any{"store": "site", "at": fmt.Sprint(c2.N), "path": "bin/x", "as": "base64"}).(map[string]any); f["data"] != "AAEC" || f["type"] != "application/x-test" {
		t.Fatalf("bin/x = %v", f)
	}
}

// files.commit {activate} reports the instances, as files.push does.
func TestCommitActivates(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	n := num(h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"}).(map[string]any)["n"])
	h.call(admin, "store.new", map[string]any{"id": "jot-dev", "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "draft"})
	c := asCommit(t, h.call(admin, "files.commit", map[string]any{"store": "jot", "ref": "draft", "base": n, "activate": []string{"jot-dev", "nope"},
		"changes": changes(map[string]map[string]any{"sql/002_tags.sql": text(`CREATE TABLE tags (note TEXT, tag TEXT);`)})}))
	if len(c.Activated) != 2 {
		t.Fatalf("activated = %v", c.Activated)
	}
	if a := c.Activated[0]; a["store"] != "jot-dev" || a["ref"] != "draft" || num(a["n"]) != c.N || a["broken"] != "" || a["error"] != nil {
		t.Fatalf("activated[0] = %v, want jot-dev on draft at %d", a, c.N)
	}
	if e, _ := c.Activated[1]["error"].(string); e == "" {
		t.Fatalf("an unknown store reports no error: %v", c.Activated[1])
	}
	if got := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "jot-dev", "action": "tables"})); got != `["notes","tags"]` {
		t.Fatalf("dev tables = %s", got)
	}
}

// post is api for a goroutine: no t.Fatal.
func post(h *harness, token, verb string, args any) (int, map[string]any, error) {
	body, _ := json.Marshal(args)
	req, _ := http.NewRequest("POST", h.ts.URL+"/api/v1/"+verb, bytes.NewReader(body))
	req.Host = h.cfg.Hosts.Main
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	err = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out, err
}

// Two commits from the same base at once are serialized by the store's
// turns: with disjoint paths both land; on the same path with different
// texts exactly one lands and the other is a conflict.
func TestCommitConcurrent(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "site"})
	race := func(base int64, a, b map[string]map[string]any) [2]map[string]any {
		var out [2]map[string]any
		var wg sync.WaitGroup
		for i, m := range []map[string]map[string]any{a, b} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, res, err := post(h, admin, "files.commit", map[string]any{"store": "site", "ref": "draft", "base": base, "changes": changes(m)})
				if err != nil {
					res = map[string]any{"error": map[string]any{"code": err.Error()}}
				}
				out[i] = res
			}()
		}
		wg.Wait()
		return out
	}
	for round := 0; round < 5; round++ {
		base := h.refAt(admin, "site", "draft")
		// Disjoint: both land.
		r := race(base, map[string]map[string]any{fmt.Sprintf("a%d.txt", round): text("a")}, map[string]map[string]any{fmt.Sprintf("b%d.txt", round): text("b")})
		if r[0]["error"] != nil || r[1]["error"] != nil {
			t.Fatalf("round %d disjoint: %v", round, r)
		}
		got := tree(h, admin, "site", h.refAt(admin, "site", "draft"))
		if got[fmt.Sprintf("a%d.txt", round)] != "a" || got[fmt.Sprintf("b%d.txt", round)] != "b" {
			t.Fatalf("round %d: both should land: %v", round, got)
		}
		merged := 0
		for _, x := range r {
			if x["result"].(map[string]any)["merged"] == true {
				merged++
			}
		}
		if merged != 1 {
			t.Fatalf("round %d: exactly one disjoint commit merges: %v", round, r)
		}

		// The same path: one lands, the other is refused.
		base = h.refAt(admin, "site", "draft")
		r = race(base, map[string]map[string]any{"same.txt": text(fmt.Sprintf("a%d", round))}, map[string]map[string]any{"same.txt": text(fmt.Sprintf("b%d", round))})
		won, lost := -1, -1
		for i, x := range r {
			if x["result"] != nil {
				won = i
			} else if e, _ := x["error"].(map[string]any); e != nil && e["code"] == "conflict" {
				lost = i
			}
		}
		if won < 0 || lost < 0 {
			t.Fatalf("round %d same path: %v", round, r)
		}
		n := num(r[won]["result"].(map[string]any)["n"])
		if num(r[lost]["error"].(map[string]any)["extra"].(map[string]any)["at"]) != n || h.refAt(admin, "site", "draft") != n {
			t.Fatalf("round %d: the loser should see the winner's %d: %v", round, n, r)
		}
		if want := []string{"a", "b"}[won] + fmt.Sprint(round); tree(h, admin, "site", n)["same.txt"] != want {
			t.Fatalf("round %d: same.txt = %q, want %q", round, tree(h, admin, "site", n)["same.txt"], want)
		}
	}
}

// ref.rm removes a ref (its snapshots stay) only when it is still where
// the caller saw it; never main, nor a ref a store follows.
func TestRefRm(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	main := num(h.push(admin, map[string]any{"store": "jot", "files": files(app)}).(map[string]any)["n"])
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	draft := num(h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"}).(map[string]any)["n"])
	h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "proposal/p1", "n": draft, "ifAt": 0})

	h.fail(admin, "ref.rm", map[string]any{"store": "jot", "ref": "proposal/p1"}, "invalid_argument") // no ifAt
	h.fail(admin, "ref.rm", map[string]any{"store": "jot", "ref": "main", "ifAt": main}, "invalid_argument")
	h.fail(admin, "ref.rm", map[string]any{"store": "jot", "ref": "proposal/nope", "ifAt": 0}, "not_found")
	e := h.fail(admin, "ref.rm", map[string]any{"store": "jot", "ref": "proposal/p1", "ifAt": main}, "conflict")
	if num(e["extra"].(map[string]any)["at"]) != draft {
		t.Fatalf("stale ifAt extra = %v", e["extra"])
	}
	out := h.call(admin, "ref.rm", map[string]any{"store": "jot", "ref": "proposal/p1", "ifAt": draft}).(map[string]any)
	if out["ref"] != "proposal/p1" || num(out["n"]) != draft || num(out["rev"]) == 0 {
		t.Fatalf("ref.rm = %v", out)
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); refs["proposal/p1"] != nil || num(refs["draft"]) != draft {
		t.Fatalf("refs after ref.rm = %v", refs)
	}
	if len(h.call(admin, "files.ls", map[string]any{"store": "jot", "at": fmt.Sprint(draft)}).([]any)) != len(app) {
		t.Fatal("the removed ref's snapshot went with it")
	}

	// A ref an instance follows stays until it follows another.
	h.call(admin, "store.new", map[string]any{"id": "jot-dev", "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "draft"})
	e = h.fail(admin, "ref.rm", map[string]any{"store": "jot", "ref": "draft", "ifAt": draft}, "conflict")
	if fmtAny(e["extra"]) != `{"stores":["jot-dev"]}` {
		t.Fatalf("followed ref extra = %v", e["extra"])
	}
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "main"})
	h.call(admin, "ref.rm", map[string]any{"store": "jot", "ref": "draft", "ifAt": draft})
}

const commitActor = `
const ws = use('workshop');
defineActor({
  actions: {
    async commit(ctx, { store, base, changes }) {
      try {
        return { ok: await ws.commit(store, changes, { base }) };
      } catch (e) {
        return { code: e.code, message: e.message, extra: e.extra };
      }
    },
    async rethrow(ctx, { store, base, changes }) { return await ws.commit(store, changes, { base }); },
    async dropRef(ctx, { store, ref, ifAt }) { return await ws.dropRef(store, ref, { ifAt }); },
  },
});
`

// The workshop module's commit writes to draft, and a verb's error
// reaches JavaScript with its details: e.extra.at and e.extra.conflicts
// for a conflict; an action that rethrows it passes them to its caller.
func TestWorkshopCommit(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	toolApp(t, h, admin, "tool", commitActor, "workshop")
	h.call(admin, "app.trust", map[string]any{"app": "tool", "module": "workshop"})
	call := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "tool", "action": action, "args": args}).(map[string]any)
	}
	h.call(admin, "store.new", map[string]any{"id": "site"})
	one := call("commit", map[string]any{"store": "site", "base": 0, "changes": []any{map[string]any{"path": "index.html", "text": "one"}}})["ok"].(map[string]any)
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "site"}).(map[string]any); num(refs["draft"]) != num(one["n"]) || refs["main"] != nil {
		t.Fatalf("workshop commit refs = %v", refs)
	}
	base := num(one["n"])
	two := call("commit", map[string]any{"store": "site", "base": base, "changes": []any{map[string]any{"path": "index.html", "text": "two"}}})["ok"].(map[string]any)

	// The conflict, caught in JavaScript.
	got := call("commit", map[string]any{"store": "site", "base": base, "changes": []any{
		map[string]any{"path": "index.html", "text": "three"}, map[string]any{"path": "gone.txt", "delete": true}}})
	if got["code"] != "conflict" || fmtAny(got["extra"]) != fmt.Sprintf(`{"at":%d,"conflicts":[{"path":"index.html"}]}`, num(two["n"])) {
		t.Fatalf("caught = %v", got)
	}
	// Rethrown, it reaches the caller of the action with its details.
	e := h.fail(admin, "actor.call", map[string]any{"store": "tool", "action": "rethrow", "args": map[string]any{"store": "site", "base": base,
		"changes": []any{map[string]any{"path": "index.html", "text": "three"}}}}, "conflict")
	if num(e["extra"].(map[string]any)["at"]) != num(two["n"]) {
		t.Fatalf("rethrown = %v", e)
	}
	// dropRef: ref.rm with ifAt.
	h.call(admin, "ref.move", map[string]any{"store": "site", "ref": "proposal/x", "n": base, "ifAt": 0})
	if r := call("dropRef", map[string]any{"store": "site", "ref": "proposal/x", "ifAt": base}); r["ref"] != "proposal/x" {
		t.Fatalf("dropRef = %v", r)
	}
}
