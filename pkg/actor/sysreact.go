package actor

import (
	"context"
	"slices"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// --- system: reactors (SLOP3-002) -----------------------------------------
//
// A reactor keyed system:<kind> follows the system log instead of its
// store's: system:grant runs for each commit with a grant change, system:*
// for every commit. Its cursor is a _cursors row with source 'system',
// moved in the same turn as the handler's writes. Only apps trusted with
// the system module may follow the system log.

// followSystem wakes running followers whenever system.db commits.
func (m *Manager) followSystem() {
	if m.K == nil || m.K.Sys == nil {
		return
	}
	wake := make(chan struct{}, 1)
	m.K.Sys.Listen(func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	})
	go func() {
		var seen int64
		for range wake {
			head, err := m.K.Sys.LogHead(context.Background())
			if err != nil || head == seen {
				continue
			}
			seen = head
			m.mu.Lock()
			list := make([]*Actor, 0, len(m.actors))
			for _, a := range m.actors {
				list = append(list, a)
			}
			m.mu.Unlock()
			for _, a := range list {
				if a.followsSystem() {
					m.queueSystem(a)
				}
			}
		}
	}()
}

// systemKeys are the actor's system: reactors.
func (a *Actor) systemKeys() []string {
	var out []string
	for _, k := range a.keys("on") {
		if strings.HasPrefix(k, "system:") {
			out = append(out, k)
		}
	}
	return out
}

// followsSystem reports whether the actor has system: reactors and its app
// may follow the system log (declares and is trusted with system).
func (a *Actor) followsSystem() bool {
	return len(a.systemKeys()) > 0 && slices.Contains(a.run.Manifest.Slop.Modules, "system") &&
		a.m.Trusted != nil && a.m.Trusted(context.Background(), a.run.App, "system")
}

// queueSystem queues one system reactor event (at most one is pending).
func (m *Manager) queueSystem(a *Actor) {
	a.mu.Lock()
	if a.sysQueued {
		a.mu.Unlock()
		return
	}
	a.sysQueued = true
	a.mu.Unlock()
	ev := &event{kind: "reactor", visitor: m.storeVisitor(context.Background(), a.st.ID), via: "reactor",
		run: func(a *Actor, cx *goja.Object) (goja.Value, error) {
			a.mu.Lock()
			a.sysQueued = false
			a.mu.Unlock()
			more, err := a.reactSystem(cx)
			if more && err == nil {
				m.queueSystem(a)
			}
			return nil, err
		}}
	if m.push(a.st.ID, ev) != nil {
		a.mu.Lock()
		a.sysQueued = false
		a.mu.Unlock()
	}
}

// reactSystem delivers the system log commits after each system: reactor's
// cursor (200 at most per turn; more reports that some remain).
func (a *Actor) reactSystem(cx *goja.Object) (bool, error) {
	t := a.cur.t
	more := false
	ctx := t.Context()
	for _, name := range a.systemKeys() {
		f := a.fn("on", name)
		if f == nil {
			continue
		}
		rows, err := t.Query(store.CallerKernel, `SELECT rev FROM _cursors WHERE name = ? AND source = 'system'`, name)
		if err != nil {
			return false, err
		}
		var from int64
		if len(rows) == 0 {
			if from, err = a.m.K.Sys.LogHead(ctx); err != nil {
				return false, err
			}
		} else {
			from = toInt(rows[0]["rev"])
		}
		entries, err := a.m.K.Sys.LogAfter(ctx, from, 200)
		if err != nil {
			return false, err
		}
		more = more || len(entries) == 200
		kind := strings.TrimPrefix(name, "system:")
		last := from
		for _, e := range entries {
			last = e.Rev
			if !systemSelects(kind, e) {
				continue
			}
			if _, err := f(goja.Undefined(), cx, a.toJS(e)); err != nil {
				return false, err
			}
		}
		if last != from || len(rows) == 0 {
			if _, err := t.Exec(store.CallerKernel, `INSERT INTO _cursors (name, source, epoch, rev) VALUES (?, 'system', 0, ?)
				ON CONFLICT (name) DO UPDATE SET source = excluded.source, rev = excluded.rev`, name, last); err != nil {
				return false, err
			}
		}
	}
	return more, nil
}

// systemSelects reports whether a system log commit has a change of kind
// (any change for "*").
func systemSelects(kind string, e sysdb.LogEntry) bool {
	if kind == "*" {
		return true
	}
	for _, c := range e.Changes {
		if c.Kind == kind {
			return true
		}
	}
	return false
}
