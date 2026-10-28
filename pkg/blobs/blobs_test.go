package blobs

import (
	"os"
	"testing"
	"time"
)

func TestCollect(t *testing.T) {
	b, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	kept, _ := b.Put([]byte("referenced"))
	old, _ := b.Put([]byte("orphan, old"))
	young, _ := b.Put([]byte("orphan, just uploaded"))
	p, _ := b.path(old)
	past := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(p, past, past); err != nil {
		t.Fatal(err)
	}
	refs := map[string]bool{kept: true}
	cutoff := time.Now().Add(-24 * time.Hour)

	got, err := b.Collect(refs, cutoff, true)
	if err != nil || len(got) != 1 || got[0].SHA256 != old {
		t.Fatalf("dry run %+v %v", got, err)
	}
	if _, ok := b.Stat(old); !ok {
		t.Fatal("a dry run removed a blob")
	}
	if got, err = b.Collect(refs, cutoff, false); err != nil || len(got) != 1 {
		t.Fatalf("collect %+v %v", got, err)
	}
	for sum, want := range map[string]bool{kept: true, old: false, young: true} {
		if _, ok := b.Stat(sum); ok != want {
			t.Fatalf("%s present=%v, want %v", sum[:8], ok, want)
		}
	}
}
