package cmds

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOIDCClientID(t *testing.T) {
	file := filepath.Join(t.TempDir(), "client-id")
	if err := os.WriteFile(file, []byte("394970@slop\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if id, err := oidcClientID("", file); err != nil || id != "394970@slop" {
		t.Fatalf("from file: %q %v", id, err)
	}
	if id, err := oidcClientID("abc", ""); err != nil || id != "abc" {
		t.Fatalf("from flag: %q %v", id, err)
	}
	if _, err := oidcClientID("abc", file); err == nil {
		t.Fatal("both: want an error")
	}
	if _, err := oidcClientID("", filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("missing file: want an error")
	}
}
