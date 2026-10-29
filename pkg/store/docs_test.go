package store_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

func TestDocs(t *testing.T) {
	ctx := context.Background()
	s := storetest.Open(t)
	u, _ := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "manuel"}, store.RoleAdmin)
	data := map[string]store.FileEntry{"file.json": {SHA256: "aa", Size: 2, Type: "application/json"}}
	for _, a := range []struct{ id, typ string }{{"design-x", "pinup"}, {"journal", "post"}} {
		if _, err := s.Push(ctx, store.PushInput{Artifact: a.id, Tree: data, MoveMain: true, Actor: u.ID, Via: "cli",
			Create: &store.ArtifactInput{Title: a.id, Kind: store.KindData, Type: a.typ}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.PutDoc(ctx, "journal", "nodes/a", store.JSON(`{}`), u.ID); err == nil || !strings.Contains(err.Error(), "keeps no live documents") {
		t.Fatalf("a post artifact must refuse docs: %v", err)
	}
	if _, err := s.PutDoc(ctx, "nope", "nodes/a", store.JSON(`{}`), u.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown artifact: %v", err)
	}
	for _, bad := range []string{"nodes", "a/b/c", "nodes/", "../x", "nodes/a b"} {
		if _, err := s.PutDoc(ctx, "design-x", bad, store.JSON(`{}`), u.ID); err == nil {
			t.Errorf("path %q must be refused", bad)
		}
	}
	for _, bad := range []string{`[1]`, `"x"`, `{"a":`} {
		if _, err := s.PutDoc(ctx, "design-x", "nodes/a", store.JSON(bad), u.ID); err == nil {
			t.Errorf("data %s must be refused", bad)
		}
	}
	if _, err := s.PutDoc(ctx, "design-x", "nodes/big", store.JSON(`{"x":"`+strings.Repeat("a", store.MaxDocBytes)+`"}`), u.ID); !errors.Is(err, store.ErrDocTooLarge) {
		t.Fatalf("too large: %v", err)
	}

	a, err := s.PutDoc(ctx, "design-x", "meta/file", store.JSON(`{"name":"X"}`), u.ID)
	if err != nil || a.Rev != 1 {
		t.Fatalf("put 1: %+v %v", a, err)
	}
	b, _ := s.PutDoc(ctx, "design-x", "nodes/n1", store.JSON(`{"type":"frame"}`), u.ID)
	c, _ := s.PutDoc(ctx, "design-x", "nodes/n1", store.JSON(`{"type":"rect"}`), u.ID)
	if b.Rev != 2 || c.Rev != 3 {
		t.Fatalf("revs %d %d", b.Rev, c.Rev)
	}
	got, err := s.GetDoc(ctx, "design-x", "nodes/n1")
	if err != nil || string(got.Data) != `{"type":"rect"}` || got.Rev != 3 || got.By == nil || *got.By != u.ID {
		t.Fatalf("get %+v %v", got, err)
	}
	if _, err = s.PutDoc(ctx, "design-x", "nodes/n2", store.JSON(`{"type":"text"}`), u.ID); err != nil {
		t.Fatal(err)
	}
	del, err := s.DeleteDoc(ctx, "design-x", "nodes/n2", u.ID)
	if err != nil || del.Rev != 5 {
		t.Fatalf("delete %+v %v", del, err)
	}
	if _, err = s.DeleteDoc(ctx, "design-x", "nodes/n2", u.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	if _, err = s.GetDoc(ctx, "design-x", "nodes/n2"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("get deleted: %v", err)
	}

	// The full list has live documents only; a list after a rev has the
	// changes since, tombstones included, in rev order.
	all, head, err := s.Docs(ctx, "design-x", "", 0)
	if err != nil || head != 5 || len(all) != 2 || all[0].Path != "meta/file" || all[1].Path != "nodes/n1" {
		t.Fatalf("list %+v %d %v", all, head, err)
	}
	since, _, _ := s.Docs(ctx, "design-x", "", 2)
	if len(since) != 2 || since[0].Path != "nodes/n1" || since[1].Path != "nodes/n2" || since[1].Data != nil {
		t.Fatalf("since %+v", since)
	}
	nodes, _, _ := s.Docs(ctx, "design-x", "nodes/", 0)
	if len(nodes) != 1 || nodes[0].Path != "nodes/n1" {
		t.Fatalf("prefix %+v", nodes)
	}
	// An underscore in the prefix is a character, not a wildcard.
	if _, err = s.PutDoc(ctx, "design-x", "noXes/z", store.JSON(`{}`), u.ID); err != nil {
		t.Fatal(err)
	}
	if l, _, _ := s.Docs(ctx, "design-x", "no_es/", 0); len(l) != 0 {
		t.Fatalf("prefix must not be a LIKE pattern: %+v", l)
	}

	// Leases: one holder at a time, renewable by the holder, free after the TTL.
	ok, err := s.AcquireDoc(ctx, "design-x", "nodes/n1", "tab-a", 30*time.Second)
	if err != nil || !ok {
		t.Fatalf("acquire a %v %v", ok, err)
	}
	if ok, _ = s.AcquireDoc(ctx, "design-x", "nodes/n1", "tab-b", 30*time.Second); ok {
		t.Fatal("tab-b must not get a held lease")
	}
	if ok, _ = s.AcquireDoc(ctx, "design-x", "nodes/n1", "tab-a", 30*time.Second); !ok {
		t.Fatal("the holder renews its lease")
	}
	if ok, _ = s.AcquireDoc(ctx, "design-x", "nodes/n2", "tab-a", 30*time.Second); ok {
		t.Fatal("a tombstone cannot be leased")
	}
	s.Now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	if ok, _ = s.AcquireDoc(ctx, "design-x", "nodes/n1", "tab-b", 30*time.Second); !ok {
		t.Fatal("an expired lease is free")
	}

	// Tombstones are pruned after TombstoneTTL.
	s.Now = func() time.Time { return time.Now().Add(store.TombstoneTTL + time.Hour) }
	if n, err := s.PruneDocTombstones(ctx); err != nil || n != 1 {
		t.Fatalf("prune %d %v", n, err)
	}
}

func TestDocRevsUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	s := storetest.Open(t)
	u, _ := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "manuel"}, store.RoleAdmin)
	if _, err := s.Push(ctx, store.PushInput{Artifact: "design-x", Tree: map[string]store.FileEntry{"file.json": {SHA256: "aa", Size: 2}}, MoveMain: true, Actor: u.ID, Via: "cli",
		Create: &store.ArtifactInput{Title: "x", Kind: store.KindData, Type: "pinup"}}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	revs := make(chan int64, 40)
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			d, err := s.PutDoc(ctx, "design-x", "nodes/n"+string(rune('a'+i%26))+string(rune('a'+i/26)), store.JSON(`{}`), u.ID)
			if err != nil {
				t.Error(err)
				return
			}
			revs <- d.Rev
		}(i)
	}
	wg.Wait()
	close(revs)
	seen := map[int64]bool{}
	for r := range revs {
		if seen[r] {
			t.Fatalf("rev %d handed out twice", r)
		}
		seen[r] = true
	}
	if len(seen) != 40 {
		t.Fatalf("%d revs", len(seen))
	}
}
