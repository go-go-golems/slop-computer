package cmds

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"sync"
	"testing"

	"github.com/spf13/cobra"
)

// fakeServer answers ref.ls with refs and records every call.
type fakeServer struct {
	mu    sync.Mutex
	calls []map[string]any
}

func (f *fakeServer) start(t *testing.T, refs map[string]any) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var args map[string]any
		_ = json.NewDecoder(r.Body).Decode(&args)
		verb := path.Base(r.URL.Path)
		f.mu.Lock()
		f.calls = append(f.calls, map[string]any{"verb": verb, "args": args})
		f.mu.Unlock()
		var result any = map[string]any{"ok": true}
		if verb == "ref.ls" {
			result = refs
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": result})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("SLOP_CREDENTIALS", filepath.Join(t.TempDir(), "none.json"))
	t.Setenv("SLOP_SERVER", srv.URL)
	t.Setenv("SLOP_TOKEN", "tok")
}

func run(t *testing.T, cmd *cobra.Command, args ...string) string {
	t.Helper()
	var stderr bytes.Buffer
	cmd.SetErr(&stderr)
	cmd.SetArgs(args)
	stdout := os.Stdout
	devnull, _ := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	os.Stdout = devnull
	defer func() { os.Stdout = stdout; _ = devnull.Close() }()
	if err := cmd.Execute(); err != nil {
		t.Fatalf("%v: %v", args, err)
	}
	return stderr.String()
}

// SLOP3-023: ref.move needs ifAt. slop ref move reads the ref when --ifAt
// is not given, passes where it is, and says so; with --ifAt it passes that.
func TestRefMoveIfAt(t *testing.T) {
	var f fakeServer
	f.start(t, map[string]any{"main": 37, "draft": 42})
	if got := run(t, refMoveCmd(), "jot", "main", "42"); got != "main: 37 → 42\n" {
		t.Fatalf("stderr = %q", got)
	}
	if b, _ := json.Marshal(f.calls); string(b) != `[{"args":{"store":"jot"},"verb":"ref.ls"},{"args":{"ifAt":37,"n":42,"ref":"main","store":"jot"},"verb":"ref.move"}]` {
		t.Fatalf("calls = %s", b)
	}
	f.calls = nil
	if got := run(t, refMoveCmd(), "jot", "release", "42", "--ifAt", "0"); got != "" {
		t.Fatalf("stderr with --ifAt = %q", got)
	}
	if b, _ := json.Marshal(f.calls); string(b) != `[{"args":{"ifAt":0,"n":42,"ref":"release","store":"jot"},"verb":"ref.move"}]` {
		t.Fatalf("calls with --ifAt = %s", b)
	}
}

// slop push reads the ref it pushes to for ifAt (0 when it does not exist).
func TestPushIfAt(t *testing.T) {
	var f fakeServer
	f.start(t, map[string]any{"main": 3})
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(t, pushCmd(), dir, "--store", "site", "--ref", "draft")
	if len(f.calls) != 2 || f.calls[1]["verb"] != "files.push" || f.calls[1]["args"].(map[string]any)["ifAt"] != 0.0 {
		t.Fatalf("calls = %v", f.calls)
	}
	f.calls = nil
	run(t, pushCmd(), dir, "--store", "site")
	if f.calls[1]["args"].(map[string]any)["ifAt"] != 3.0 {
		t.Fatalf("main push calls = %v", f.calls)
	}
	f.calls = nil
	run(t, pushCmd(), dir, "--store", "site", "--ifAt", "2")
	if len(f.calls) != 1 || f.calls[0]["args"].(map[string]any)["ifAt"] != 2.0 {
		t.Fatalf("push --ifAt calls = %v", f.calls)
	}
}
