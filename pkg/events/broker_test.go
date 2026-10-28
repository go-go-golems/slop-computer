package events

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

func TestBroker(t *testing.T) {
	b := New()
	all := b.Subscribe(nil)
	odd := b.Subscribe(func(e store.Event) bool { return e.Seq%2 == 1 })
	b.Publish(store.Event{Seq: 1}, store.Event{Seq: 2}, store.Event{Seq: 3})
	if got := (<-all.C).Seq; got != 1 {
		t.Fatal(got)
	}
	if got := (<-odd.C).Seq; got != 1 {
		t.Fatal(got)
	}
	if got := (<-odd.C).Seq; got != 3 {
		t.Fatal(got)
	}
	b.Unsubscribe(all)
	if _, ok := <-all.C; ok {
		// drain the buffered 2 and 3 first
		<-all.C
		if _, ok = <-all.C; ok {
			t.Fatal("channel should be closed after unsubscribe")
		}
	}
	// A slow subscriber is dropped instead of blocking.
	slow := b.Subscribe(nil)
	for i := 0; i < 300; i++ {
		b.Publish(store.Event{Seq: int64(i)})
	}
	n := 0
	for range slow.C {
		n++
	}
	if n != 256 {
		t.Fatalf("slow subscriber received %d before being dropped", n)
	}
}
