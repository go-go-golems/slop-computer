package host

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// mapFile writes a source map naming every position of lines 1–4
// outside.ts, and returns the comment that points at it. A stack trace that
// mentions outside.ts means the runtime read the file.
func mapFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "outside.map")
	if err := os.WriteFile(path, []byte(`{"version":3,"sources":["outside.ts"],"names":[],"mappings":"AAAA;AAAA;AAAA;AAAA"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return "//# sourceMappingURL=file://" + filepath.ToSlash(path)
}

// App code never makes slop open a file through a source map URL
// (pkg/jsrt): not an actor's entry, a file it requires, a string it passes
// to eval, nor an eval program.
func TestAppCodeOpensNoFiles(t *testing.T) {
	url := mapFile(t)
	byFile := strconv.Quote("new Error('x').stack\n" + url + "\n")
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "maps"})
	h.call(admin, "files.push", map[string]any{"store": "maps", "files": files(map[string]string{
		"app.json": `{"title":"Maps","actor":"actor.js","type":"maps"}`,
		"actor.js": "const lib = require('./lib.js'); defineActor({ actions: { entry() { return new Error('x').stack }, required() { return lib.where() }, viaEval() { return eval(" + byFile + ") } } })\n" + url + "\n",
		"lib.js":   "exports.where = () => new Error('x').stack\n" + url + "\n",
	})})
	if st := h.call(admin, "app.status", map[string]any{"store": "maps"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	for _, action := range []string{"entry", "required", "viaEval"} {
		out, _ := h.call(admin, "actor.call", map[string]any{"store": "maps", "action": action}).(string)
		if out == "" || strings.Contains(out, "outside.ts") {
			t.Errorf("actor %s: the stack is %q", action, out)
		}
	}
	res := h.call(admin, "eval", map[string]any{"source": "return eval(" + byFile + ")"}).(map[string]any)
	if out, _ := res["result"].(string); out == "" || strings.Contains(out, "outside.ts") {
		t.Errorf("eval verb: the stack is %q", out)
	}
}
