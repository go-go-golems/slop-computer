// Package events fans kernel events out to live subscribers: the
// Workshop's server-sent event stream and `slop comments wait` long-polls.
//
// Events are stored in the events table by the store, in the same
// transaction as the change; the server publishes them here after commit.
// A subscriber subscribes first and then replays stored events after its
// cursor, so an event committed between the two is never lost; duplicates
// are skipped by seq. One process is assumed (design doc §6.6).
package events

import (
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Sub receives published events that pass its filter. C is closed when the
// subscriber falls behind or unsubscribes; it then replays from the store.
type Sub struct {
	C      chan store.Event
	filter func(store.Event) bool
	closed bool
}

type Broker struct {
	mu   sync.Mutex
	subs map[*Sub]struct{}
}

func New() *Broker { return &Broker{subs: map[*Sub]struct{}{}} }

// Subscribe registers a subscriber; filter nil accepts everything.
func (b *Broker) Subscribe(filter func(store.Event) bool) *Sub {
	s := &Sub{C: make(chan store.Event, 256), filter: filter}
	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()
	return s
}

func (b *Broker) Unsubscribe(s *Sub) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.subs[s]; ok {
		delete(b.subs, s)
		if !s.closed {
			s.closed = true
			close(s.C)
		}
	}
}

// Publish delivers events in order. A subscriber whose buffer is full is
// dropped (its channel closed) rather than blocking everyone else.
func (b *Broker) Publish(evs ...store.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ev := range evs {
		for s := range b.subs {
			if s.filter != nil && !s.filter(ev) {
				continue
			}
			select {
			case s.C <- ev:
			default:
				delete(b.subs, s)
				s.closed = true
				close(s.C)
			}
		}
	}
}
