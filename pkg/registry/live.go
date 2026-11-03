package registry

// Live registry documents (SLOP3-009 step 3; SLOP3-008 left them read on
// demand). The page door remembers, per view and subscription, the
// versions it last sent; when the system log records a change that can
// touch the registry, it recomputes those subscriptions and sends what
// moved: documents with a newer version, and deletions of documents that
// are no longer there (versioned with the change's revision, so the
// runtime's newer-version rule accepts them).

import (
	"sort"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Sub is a view's subscription to a registry path (with its query's
// filters and order, for a collection).
type Sub struct {
	ID    string
	Path  string
	Coll  bool
	Query rt.Query
}

type liveSub struct {
	Sub
	seen map[string]int64 // page path → version last sent
}

// Live is the memory of what each view was sent.
type Live struct {
	mu    sync.Mutex
	views map[string]map[string]*liveSub // view id → sub id → …
}

// NewLive returns an empty memory.
func NewLive() *Live { return &Live{views: map[string]map[string]*liveSub{}} }

// Remember records the documents a subscription was given.
func (l *Live) Remember(view string, s Sub, docs []rt.Doc) {
	l.mu.Lock()
	defer l.mu.Unlock()
	subs := l.views[view]
	if subs == nil {
		subs = map[string]*liveSub{}
		l.views[view] = subs
	}
	ls := &liveSub{Sub: s, seen: map[string]int64{}}
	for _, d := range docs {
		ls.seen[d.Path] = d.Version
	}
	subs[s.ID] = ls
}

// Saw records documents a subscription was given outside Update (its
// snapshot), keeping the newer version of each: a subscription is
// remembered before its snapshot is read, so the follower may have sent
// newer ones in between, and a change landing between the read and the
// registration is not missed.
func (l *Live) Saw(view, sub string, docs []rt.Doc) {
	l.mu.Lock()
	defer l.mu.Unlock()
	ls := l.views[view][sub]
	if ls == nil {
		return
	}
	for _, d := range docs {
		if d.Version > ls.seen[d.Path] {
			ls.seen[d.Path] = d.Version
		}
	}
}

// Forget drops a subscription, or all of a view's with sub "".
func (l *Live) Forget(view, sub string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if sub == "" {
		delete(l.views, view)
		return
	}
	delete(l.views[view], sub)
	if len(l.views[view]) == 0 {
		delete(l.views, view)
	}
}

// Views lists the views with registry subscriptions, and theirs.
func (l *Live) Views() map[string][]Sub {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := map[string][]Sub{}
	for v, subs := range l.views {
		for _, s := range subs {
			out[v] = append(out[v], s.Sub)
		}
		sort.Slice(out[v], func(i, j int) bool { return out[v][i].ID < out[v][j].ID })
	}
	return out
}

// Update compares a subscription's documents now with what it was sent and
// returns what to send: documents whose version moved, and the paths that
// are gone. It records now as sent.
func (l *Live) Update(view, sub string, now []rt.Doc) ([]rt.Doc, []string) {
	var changed []rt.Doc
	var gone []string
	l.mu.Lock()
	defer l.mu.Unlock()
	ls := l.views[view][sub]
	if ls == nil {
		return nil, nil
	}
	cur := map[string]int64{}
	for _, d := range now {
		cur[d.Path] = d.Version
		if d.Version > ls.seen[d.Path] {
			changed = append(changed, d)
		}
	}
	for p := range ls.seen {
		if _, ok := cur[p]; !ok {
			gone = append(gone, p)
		}
	}
	sort.Strings(gone)
	ls.seen = cur
	return changed, gone
}

// Affects reports whether a system change can change registry documents.
func Affects(c system.Change) bool {
	switch c.Kind {
	case "store", "grant", "binding", "person", "llm", "link", "comp", "billing":
		return true
	}
	return false
}
