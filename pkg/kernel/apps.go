package kernel

import (
	"context"
	"errors"
	"strconv"
	"sync"

	"github.com/go-go-golems/slop/pkg/apps"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
	"github.com/go-go-golems/slop/pkg/system"
)

// Running is the app a store runs now.
type Running struct {
	Store    string         `json:"store"`
	App      string         `json:"app"`                // the app store (the store itself when it names none)
	N        int64          `json:"n"`                  // the app store's snapshot; 0 = nothing pushed yet
	Manifest *apps.Manifest `json:"manifest,omitempty"` // nil: plain content, no app.json
	Broken   string         `json:"broken,omitempty"`   // why app.json could not be read
}

type manifestCache struct {
	mu sync.Mutex
	m  map[string]*apps.Manifest // app@n
	e  map[string]string         // app@n → parse error
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
	r.Manifest, r.Broken = k.manifest(ctx, as, n)
	if s.MetaInt("app_version") != n {
		if err := k.activate(ctx, s, r); err != nil {
			return r, err
		}
	}
	return r, nil
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

// activate moves a store to its app's snapshot n. Without an actor this is
// recording the version; P3 adds migrations, setup and the smoke check.
func (k *Kernel) activate(ctx context.Context, s *store.Store, r Running) error {
	n := strconv.FormatInt(r.N, 10)
	var from string
	c, err := s.Do(ctx, store.Who{ID: "system", Via: "activate", App: r.App + "@" + n}, func(t *store.Turn) error {
		from = t.Meta("app_version")
		if from == n {
			return nil // another request activated it first
		}
		t.Summary = "activated " + r.App + "@" + n
		return t.SetMeta("app_version", n)
	})
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
