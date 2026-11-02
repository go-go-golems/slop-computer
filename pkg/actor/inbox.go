package actor

import "context"

// inboxLimit bounds a store's queue of events (continuations excepted:
// they are bounded by the handlers awaiting I/O).
const inboxLimit = 256

// inbox is a store's queue of events. It belongs to the store, not to an
// actor: when a new version replaces the actor, or an idle one retires,
// the next actor takes what is still queued, in order. The manager's mutex
// guards it together with the actors map, so an actor stops taking events
// the moment it is replaced, and no event waits without an actor to take
// it.
type inbox struct {
	evs []*event
}

// inboxLocked is the store's inbox (m.mu held).
func (m *Manager) inboxLocked(id string) *inbox {
	in := m.inboxes[id]
	if in == nil {
		in = &inbox{}
		m.inboxes[id] = in
	}
	return in
}

// push queues ev for store id. When no actor runs the store (it retired,
// was replaced or stopped), one is started to take the queue.
func (m *Manager) push(id string, ev *event) error {
	m.mu.Lock()
	in := m.inboxLocked(id)
	if ev.kind != "cont" && len(in.evs) >= inboxLimit {
		m.mu.Unlock()
		return fail("unavailable", "the actor is busy")
	}
	in.evs = append(in.evs, ev)
	cur := m.actors[id]
	m.mu.Unlock()
	if cur == nil {
		go func() { _, _ = m.Get(context.Background(), id) }()
		return nil
	}
	select {
	case cur.wake <- struct{}{}:
	default:
	}
	return nil
}

// take gives a the next event of its store's queue. ok is false once a no
// longer runs the store; ev is nil when the queue is empty.
func (m *Manager) take(a *Actor) (ev *event, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.actors[a.st.ID] != a {
		return nil, false
	}
	in := m.inboxLocked(a.st.ID)
	if len(in.evs) > 0 {
		ev = in.evs[0]
		in.evs[0] = nil
		in.evs = in.evs[1:]
	}
	return ev, true
}
