package kernel

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Running is the app a store runs now: the version it serves (N,
// Manifest), whether that version is activated (Active), and the newest
// version's failure if it failed. Usable is the one answer to "can this
// store serve its app".
type Running struct {
	Store    string         `json:"store"`
	App      string         `json:"app"`                // the app store (the store itself when it names none)
	N        int64          `json:"n"`                  // the version served: the active one, else the newest; 0 = nothing pushed yet
	Manifest *apps.Manifest `json:"manifest,omitempty"` // nil: plain content, no app.json
	Active   bool           `json:"active"`             // N is activated (migrations, setup and smoke check done)
	Failed   *Failure       `json:"failed,omitempty"`   // the newest version failed; the store keeps the last active one
}

// Failure is why a version could not be activated.
type Failure struct {
	N   int64  `json:"n"`
	Why string `json:"why"`
}

// Usable reports whether the store can serve N: something was pushed and
// that version is activated (possibly an older one, after a failure).
func (r Running) Usable() bool { return r.N > 0 && r.Active }

// Broken is why the newest version failed, or "".
func (r Running) Broken() string {
	if r.Failed == nil {
		return ""
	}
	return r.Failed.Why
}

type manifestCache struct {
	mu sync.Mutex
	m  map[string]*apps.Manifest // app@n
	e  map[string]string         // app@n → parse error

	failed map[string]string // store@n → why activation failed
}

// Running resolves the app a store runs, activating the store first when
// its app has a newer snapshot on the ref it follows.
func (k *Kernel) Running(ctx context.Context, id string) (Running, error) {
	s, err := k.Store(ctx, id)
	if err != nil {
		return Running{}, err
	}
	r := Running{Store: id, App: id}
	if a := s.Meta("app"); a != "" {
		r.App = a
	}
	as := s
	if r.App != id {
		if as, err = k.Store(ctx, r.App); err != nil {
			return r, err
		}
	}
	ref := s.Meta("app_ref")
	n, err := as.Ref(ctx, ref)
	if errors.Is(err, store.ErrNotFound) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	r.N = n
	m, why := k.manifest(ctx, as, n)
	r.Manifest = m
	cur := s.MetaInt("app_version")
	if cur == n {
		r.Active = true
		return r, nil
	}
	if why == "" {
		if failed := k.failedActivation(id, n); failed != "" {
			why = failed
		} else if err := k.activate(ctx, s, r); err != nil {
			k.recordFailure(id, n, err.Error())
			why = "activation of " + r.App + "@" + strconv.FormatInt(n, 10) + " failed: " + err.Error()
		} else {
			r.Active = true
			return r, nil
		}
	}
	// The newest version failed: the store keeps running the version it
	// ran before, if any.
	r.Failed = &Failure{N: n, Why: why}
	if cur > 0 {
		r.N = cur
		r.Manifest, _ = k.manifest(ctx, as, cur)
		r.Active = true
	}
	return r, nil
}

// failedActivation reports an earlier failure to activate store at n (so a
// broken version is not retried on every request).
func (k *Kernel) failedActivation(id string, n int64) string {
	k.mc.mu.Lock()
	defer k.mc.mu.Unlock()
	return k.mc.failed[id+"@"+strconv.FormatInt(n, 10)]
}

func (k *Kernel) recordFailure(id string, n int64, msg string) {
	k.mc.mu.Lock()
	defer k.mc.mu.Unlock()
	if k.mc.failed == nil {
		k.mc.failed = map[string]string{}
	}
	k.mc.failed[id+"@"+strconv.FormatInt(n, 10)] = msg
}

// ClearFailure lets a store retry activating its current version.
func (k *Kernel) ClearFailure(id string) {
	k.mc.mu.Lock()
	defer k.mc.mu.Unlock()
	for key := range k.mc.failed {
		if strings.HasPrefix(key, id+"@") {
			delete(k.mc.failed, key)
		}
	}
}

func (k *Kernel) manifest(ctx context.Context, as *store.Store, n int64) (*apps.Manifest, string) {
	key := as.ID + "@" + strconv.FormatInt(n, 10)
	k.mc.mu.Lock()
	if m, ok := k.mc.m[key]; ok {
		k.mc.mu.Unlock()
		return m, ""
	}
	if e, ok := k.mc.e[key]; ok {
		k.mc.mu.Unlock()
		return nil, e
	}
	k.mc.mu.Unlock()
	var m *apps.Manifest
	broken := ""
	f, err := as.SnapshotFile(ctx, n, apps.File)
	if err == nil {
		raw, err := as.ReadFile(f)
		if err == nil {
			m, err = apps.Parse(raw)
		}
		if err != nil {
			broken = err.Error()
		}
	}
	k.mc.mu.Lock()
	if k.mc.m == nil || len(k.mc.m) > 1024 {
		k.mc.m, k.mc.e = map[string]*apps.Manifest{}, map[string]string{}
	}
	if broken != "" {
		k.mc.e[key] = broken
	} else {
		k.mc.m[key] = m
	}
	k.mc.mu.Unlock()
	return m, broken
}

// Activator runs inside the activation turn, before the version is
// recorded: migrations, the actor's setup and its smoke check. An error
// rolls the whole activation back.
type Activator func(ctx context.Context, t *store.Turn, r Running) error

// activate moves a store to its app's snapshot n in one turn.
func (k *Kernel) activate(ctx context.Context, s *store.Store, r Running) error {
	n := strconv.FormatInt(r.N, 10)
	var from string
	c, err := s.Do(ctx, store.Who{ID: "system", Via: "activate", App: r.App + "@" + n}, func(t *store.Turn) error {
		from = t.Meta("app_version")
		if from == n {
			return nil // another request activated it first
		}
		t.Summary = "activated " + r.App + "@" + n
		if k.Activate != nil {
			if err := k.Activate(ctx, t, r); err != nil {
				return err
			}
		}
		return t.SetMeta("app_version", n)
	})
	if err == nil && c != nil && k.OnActivated != nil {
		k.OnActivated(s.ID, r)
	}
	if err != nil || c == nil {
		return err
	}
	_ = k.Sys.Tx(ctx, func(tx systemTx) error {
		_, err := system.Log(ctx, tx, k.Sys.NowMs(), "system", "activate", "store "+s.ID+" runs "+r.App+"@"+n,
			system.Change{Kind: "store", Key: s.ID, Op: "activate", Before: from, After: r.App + "@" + n})
		return err
	})
	return nil
}

// Rules returns the document rules of a store's owner app at its running
// version (the defaults for plain content).
func (k *Kernel) Rules(ctx context.Context, id string) rt.Rules {
	r, err := k.Running(ctx, id)
	if err != nil || r.Manifest == nil {
		return rt.Rules{}
	}
	return r.Manifest.Caps.Rules
}
