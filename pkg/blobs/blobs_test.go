package blobs

import (
	"io"
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

// Derived files live outside blobs/ (Collect never sees them) and go with
// their blob.
func TestDerived(t *testing.T) {
	b, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	keep, _ := b.Put([]byte("kept"))
	drop, _ := b.Put([]byte("dropped"))
	for _, sum := range []string{keep, drop} {
		if _, err = b.PutDerived(sum+".gz", func(w io.Writer) error { _, err := w.Write([]byte("z")); return err }); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := b.Derived(keep + ".gz"); !ok {
		t.Fatal("derived file missing")
	}
	if _, err = b.PutDerived("../escape", func(io.Writer) error { return nil }); err == nil {
		t.Fatal("an invalid name was accepted")
	}
	got, err := b.Collect(map[string]bool{keep: true, drop: true}, time.Now(), true)
	if err != nil || len(got) != 0 {
		t.Fatalf("Collect saw derived files: %v %v", got, err)
	}
	gone, err := b.CollectDerived(func(sum string) bool { return sum == keep }, false)
	if err != nil || len(gone) != 1 || gone[0].SHA256 != drop+".gz" {
		t.Fatalf("CollectDerived: %v %v", gone, err)
	}
	if _, ok := b.Derived(keep + ".gz"); !ok {
		t.Fatal("the kept blob's derived file was removed")
	}
}
