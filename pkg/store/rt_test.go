package store_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

// Writes from many goroutines commit with contiguous revs, none lost, and
// a racing put and delete never deadlock (the head row is locked first, as
// PR #3 settled for the old docs table).
func TestRTWriteConcurrency(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	if _, _, err := st.CreateArtifact(ctx, "ws", store.ArtifactInput{Title: "ws", Kind: store.KindData}, ""); err != nil {
		t.Fatal(err)
	}
	set := func(path string, body string) func(*store.RTDoc) ([]byte, error) {
		return func(*store.RTDoc) ([]byte, error) {
			if body == "" {
				return nil, nil
			}
			return []byte(body), nil
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, 200)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				path := fmt.Sprintf("tasks/t%d", (i+j)%4)
				body := fmt.Sprintf(`{"i":%d,"j":%d}`, i, j)
				if (i+j)%3 == 0 {
					body = "" // delete
				}
				if _, err := st.RTWrite(ctx, "ws", path, "tasks", "u", set(path, body)); err != nil {
					errs <- err
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	head, err := st.RTHead(ctx, "ws")
	if err != nil {
		t.Fatal(err)
	}
	rows, h2, err := st.RTChanges(ctx, "ws", 0)
	if err != nil || h2 != head {
		t.Fatalf("changes: %v head %d/%d", err, h2, head)
	}
	// Every surviving row's rev is ≤ head and distinct; versions count each
	// change of the document.
	seen := map[int64]bool{}
	for _, d := range rows {
		if d.Rev > head || seen[d.Rev] {
			t.Fatalf("rev %d (head %d) repeated or beyond head", d.Rev, head)
		}
		seen[d.Rev] = true
	}
	// Revs are contiguous: head equals the number of committed changes.
	var versions int64
	for _, d := range rows {
		versions += d.Version
	}
	if versions != head {
		t.Fatalf("sum of versions %d != head %d: a rev was skipped or a change lost", versions, head)
	}

	// update of a missing doc is the caller's decision; deleting nothing
	// takes no rev.
	ch, err := st.RTWrite(ctx, "ws", "tasks/none", "tasks", "u", set("tasks/none", ""))
	if err != nil || ch.Rev != 0 {
		t.Fatalf("delete of nothing: %+v %v", ch, err)
	}
	if h3, _ := st.RTHead(ctx, "ws"); h3 != head {
		t.Fatalf("a no-op delete moved the head %d → %d", head, h3)
	}

	// Leases: one holder at a time, renewable by the same holder.
	ok, _, err := st.RTAcquire(ctx, "ws", "tasks/t1", "a", time.Minute)
	if err != nil || !ok {
		t.Fatalf("acquire: %v %v", ok, err)
	}
	if ok, _, _ = st.RTAcquire(ctx, "ws", "tasks/t1", "b", time.Minute); ok {
		t.Fatal("a busy lease was granted")
	}
	if ok, _, _ = st.RTAcquire(ctx, "ws", "tasks/t1", "a", time.Minute); !ok {
		t.Fatal("renewal refused")
	}

	// Origins are stable per target and map back.
	l1, err := st.RTOrigin(ctx, "ws")
	if err != nil {
		t.Fatal(err)
	}
	if l2, _ := st.RTOrigin(ctx, "ws"); l2 != l1 {
		t.Fatal("origin label changed")
	}
	if tgt, err := st.RTOriginTarget(ctx, l1); err != nil || tgt != "ws" {
		t.Fatalf("origin target %q %v", tgt, err)
	}
}
