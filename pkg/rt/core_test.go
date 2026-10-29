package rt

import (
	"encoding/json"
	"math/rand"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestPaths(t *testing.T) {
	for p, doc := range map[string]bool{"tasks/t1": true, "boards/b1/columns/c2": true, "data/users/usr_1/blocks": true,
		"a:b/c@d+e~f.g": true} {
		if ValidDocPath(p) != doc || ValidCollPath(p) == doc {
			t.Errorf("%s: doc %v", p, doc)
		}
	}
	for _, p := range []string{"", "tasks//t1", "tasks/..", "a b/c", "x/" + strings.Repeat("a", 201), strings.Repeat("a/", 16) + "a"} {
		if ValidDocPath(p) || ValidCollPath(p) {
			t.Errorf("%q must be refused", p)
		}
	}
	if CollOf("a/b/c/d") != "a/b/c" || IDOf("a/b/c/d") != "d" || CollOf("a/b") != "a" {
		t.Fatal("CollOf/IDOf")
	}
}

// The examples are the State Storage guide's, verbatim.
func TestRules(t *testing.T) {
	rs, err := CompileRules([]Rule{
		{Path: "", Write: "admin"},
		{Path: "data/users/{self}", Write: "interact"},
		{Path: "votes", Read: "view", Write: "owner"},
		{Path: "votes/{self}", Write: "interact"},
	})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		path, user string
		level      Level
		read, wrt  bool
	}{
		{"tasks/t1", "u1", LevelInteract, true, false}, // only editors change shared data
		{"tasks/t1", "u1", LevelAdmin, true, true},     //
		{"data/users/u1/prefs", "u1", LevelInteract, true, true},
		{"data/users/u1/prefs", "u2", LevelOwner, false, false}, // private even from the owner
		{"votes/u1", "u1", LevelInteract, true, true},           // each writes their own
		{"votes/u2", "u1", LevelInteract, true, false},          //
		{"votes/u2", "u1", LevelOwner, true, true},              // the owner changes anyone's
		{"votes/u2", "u1", LevelNone, false, false},
	}
	for _, c := range cases {
		if r, w := rs.CanRead(c.path, c.user, c.level), rs.CanWrite(c.path, c.user, c.level); r != c.read || w != c.wrt {
			t.Errorf("%s as %s (%v): read %v write %v, want %v %v", c.path, c.user, c.level, r, w, c.read, c.wrt)
		}
	}
	// Defaults: everyone reads, interact writes; data/users/<id> private.
	def, _ := CompileRules(nil)
	if !def.CanRead("x/y", "u", LevelView) || def.CanWrite("x/y", "u", LevelView) || !def.CanWrite("x/y", "u", LevelInteract) {
		t.Fatal("defaults")
	}
	// self as a level is met by nobody but a {self} rule below it.
	sealed, _ := CompileRules([]Rule{{Path: "signoffs", Read: "view", Write: "self"}, {Path: "signoffs/{self}", Read: "view", Write: "interact"}})
	if sealed.CanWrite("signoffs/u2", "u1", LevelOwner) || !sealed.CanWrite("signoffs/u1", "u1", LevelInteract) {
		t.Fatal("self level")
	}
	// read: admin hides a path below admin; write is never below read.
	hidden, _ := CompileRules([]Rule{{Path: "notes", Read: "admin", Write: "view"}})
	if hidden.CanRead("notes/n", "u", LevelInteract) || hidden.CanWrite("notes/n", "u", LevelInteract) || !hidden.CanWrite("notes/n", "u", LevelAdmin) {
		t.Fatal("read admin")
	}
	for _, bad := range [][]Rule{
		{{Path: "a/{self}/b"}},
		{{Path: "votes", Read: "view"}, {Path: "votes/{self}", Write: "interact"}}, // prefix must set both
		{{Path: "x", Read: "editor"}},
	} {
		if _, err := CompileRules(bad); err == nil {
			t.Errorf("%+v must be refused", bad)
		}
	}
}

func TestQueryVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/query.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Docs  []Doc `json:"docs"`
		Cases []struct {
			Name  string   `json:"name"`
			Query Query    `json:"query"`
			Want  []string `json:"want"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Cases {
		c.Query.Coll = "tasks"
		if err := c.Query.Validate(); err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		var got []string
		for _, d := range c.Query.Apply(v.Docs) {
			got = append(got, IDOf(d.Path))
		}
		if strings.Join(got, ",") != strings.Join(c.Want, ",") {
			t.Errorf("%s: got %v, want %v", c.Name, got, c.Want)
		}
	}
	for _, bad := range []Query{{Coll: "tasks/t1"}, {Coll: "t", Limit: 1001}, {Coll: "t", Filters: []Filter{{Field: "a.b", Op: "==", Value: 1.0}}},
		{Coll: "t", Filters: []Filter{{Field: "a", Op: "like", Value: 1.0}}}, {Coll: "t", Filters: []Filter{{Field: "a", Op: "in", Value: []any{}}}}} {
		if bad.Validate() == nil {
			t.Errorf("%+v must be refused", bad)
		}
	}
}

func TestDiffVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/diff.json")
	if err != nil {
		t.Fatal(err)
	}
	var pairs []struct{ A, B any }
	if err := json.Unmarshal(raw, &pairs); err != nil {
		t.Fatal(err)
	}
	for i, p := range pairs {
		checkDiff(t, strconv.Itoa(i), p.A, p.B)
	}
	// An append to a growing log is a small patch.
	ops := []any{}
	for i := 0; i < 500; i++ {
		ops = append(ops, []any{"o" + strconv.Itoa(i), "u1:you", float64(i), strings.Repeat("x", 80), 1.0})
	}
	a := map[string]any{"ops": ops[:499], "n": 499.0}
	b := map[string]any{"ops": ops, "n": 500.0}
	if p := Diff(a, b); PatchSize(p) > 200 {
		t.Fatalf("append patch is %d bytes", PatchSize(p))
	}
}

func checkDiff(t *testing.T, name string, a, b any) {
	t.Helper()
	p := Diff(a, b)
	if p == nil {
		if !equal(a, b) {
			t.Fatalf("%s: nil patch for different values", name)
		}
		return
	}
	// the patch survives the wire
	raw, _ := json.Marshal(p)
	var wire Patch
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	got, err := Apply(a, wire)
	if err != nil || !equal(got, b) {
		t.Fatalf("%s: apply(diff) = %s, want %s (%v)", name, canon(got), canon(b), err)
	}
}

// Random JSON pairs: apply(a, diff(a, b)) == b.
func TestDiffProperty(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	var gen func(depth int) any
	gen = func(depth int) any {
		switch k := r.Intn(7); {
		case k == 0 || depth > 3:
			return float64(r.Intn(5))
		case k == 1:
			return []string{"a", "b", "c"}[r.Intn(3)]
		case k == 2:
			return r.Intn(2) == 0
		case k == 3:
			return nil
		case k == 4:
			n := r.Intn(5)
			out := make([]any, n)
			for i := range out {
				out[i] = gen(depth + 1)
			}
			return out
		default:
			n := r.Intn(4)
			out := map[string]any{}
			for i := 0; i < n; i++ {
				out[string(rune('a'+r.Intn(4)))] = gen(depth + 1)
			}
			return out
		}
	}
	for i := 0; i < 3000; i++ {
		checkDiff(t, "random "+strconv.Itoa(i), gen(0), gen(0))
	}
}

func TestManifest(t *testing.T) {
	perms := map[string]string{"versions:push": ""}
	c, err := ParseManifest([]byte(`{"title":"x","capabilities":{"db":{"rules":[{"path":"votes","read":"view","write":"owner"},{"path":"votes/{self}","write":"interact"}]},
		"user":{"scopes":["profile"]},"room":{"topics":{"ops":"interact"}},"downloads":true,"self":{},"slop":{"permissions":["versions:push"]}}}`), perms)
	if err != nil {
		t.Fatal(err)
	}
	if !c.IsApp() || !c.Declared["artifact"] || !c.Scopes["profile"] || c.Topics["ops"] != LevelInteract || len(c.Permission) != 1 {
		t.Fatalf("%+v", c)
	}
	if c.Rules.CanWrite("votes/u2", "u1", LevelAdmin) {
		t.Fatal("rules not compiled")
	}
	if c, _ := ParseManifest([]byte(`{"title":"x"}`), perms); c.IsApp() {
		t.Fatal("a page without capabilities is not an app")
	}
	for _, bad := range []string{`{"capabilities":{"teleport":{}}}`, `{"capabilities":{"room":{"topics":{"Bad":"interact"}}}}`,
		`{"capabilities":{"room":{"topics":{"x":"view"}}}}`, `{"capabilities":{"slop":{"permissions":["users:write"]}}}`,
		`{"capabilities":{"user":{"scopes":["phone"]}}}`} {
		if _, err := ParseManifest([]byte(bad), perms); err == nil {
			t.Errorf("%s must be refused", bad)
		}
	}
}

// web/runtime/src/limits.ts must hold the same numbers.
func TestLimitsMatchRuntime(t *testing.T) {
	ts, err := os.ReadFile("../../web/runtime/src/limits.ts")
	if err != nil {
		t.Skip("web/runtime not present")
	}
	goSrc, _ := os.ReadFile("limits.go")
	re := regexp.MustCompile(`(?m)^\s*(Max\w+|Min\w+|Default\w+)\s*=\s*([^/\n]+)`)
	tsRe := regexp.MustCompile(`(?m)^\s*(Max\w+|Min\w+|Default\w+):\s*([^,/\n]+)`)
	want := map[string]string{}
	for _, m := range re.FindAllStringSubmatch(string(goSrc), -1) {
		want[m[1]] = strings.TrimSpace(m[2])
	}
	got := map[string]string{}
	for _, m := range tsRe.FindAllStringSubmatch(string(ts), -1) {
		got[m[1]] = strings.TrimSpace(m[2])
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("limits.ts %s = %q, limits.go %q", k, got[k], v)
		}
	}
}
