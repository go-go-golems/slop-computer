// Package kernel owns the open stores: it opens them on demand, creates and
// deletes them together with their registry rows, and fans every commit out
// to subscribers (live views, reactors, log watchers).
package kernel

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/billing"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Kernel is the running platform's core.
type Kernel struct {
	Cfg *config.Config
	// Sys is system.db; the domains own its tables' queries.
	Sys      *sysdb.DB
	People   *identity.Accounts
	Registry *registry.Registry
	Ledger   *llm.Ledger
	Gov      *policy.Governance
	Book     *billing.Book
	Blobs    *blobs.Blobs
	Access   *access.Checker

	mu   sync.Mutex
	open map[string]*store.Store

	mc manifestCache

	// Activate runs migrations and the actor's setup inside activation;
	// OnActivated hears that a store moved to a new version (P3, actors).
	Activate    Activator
	OnActivated func(store string, r Running)

	subMu sync.RWMutex
	subs  map[int]func(*store.Commit)
	subN  int
}

// New makes a kernel over the data directory in cfg.
func New(cfg *config.Config, sys *sysdb.DB) (*Kernel, error) {
	b, err := blobs.Open(filepath.Join(cfg.Data, "blobs"))
	if err != nil {
		return nil, err
	}
	k := &Kernel{Cfg: cfg, Sys: sys, People: identity.NewAccounts(sys), Registry: registry.NewRegistry(sys),
		Ledger: llm.NewLedger(sys), Gov: policy.NewGovernance(sys), Book: billing.NewBook(sys), Blobs: b,
		open: map[string]*store.Store{}, subs: map[int]func(*store.Commit){}}
	k.Access = &access.Checker{Dir: directory{k}}
	k.Access.Subscribed = func(ctx context.Context, person string) bool { return k.Standing(ctx, person).Allowed }
	return k, nil
}

// directory is what access reads, from the registry and identity.
type directory struct{ k *Kernel }

func (d directory) StoreByID(ctx context.Context, id string) (sysdb.StoreRow, error) {
	return d.k.Registry.StoreByID(ctx, id)
}

func (d directory) Grants(ctx context.Context, store string) ([]sysdb.Grant, error) {
	return d.k.Registry.Grants(ctx, store)
}

func (d directory) Person(ctx context.Context, id string) (sysdb.Person, error) {
	return d.k.People.Person(ctx, id)
}

func (d directory) NowMs() int64 { return d.k.Sys.NowMs() }

func (k *Kernel) dir(id string) string { return filepath.Join(k.Cfg.Data, "stores", id) }

// ErrNoStore is returned for stores that are not registered.
var ErrNoStore = errors.New("no such store")

// Store returns an open store, opening it if needed.
func (k *Kernel) Store(ctx context.Context, id string) (*store.Store, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if s, ok := k.open[id]; ok {
		return s, nil
	}
	if _, err := k.Registry.StoreByID(ctx, id); err != nil {
		if errors.Is(err, sysdb.ErrNotFound) {
			return nil, ErrNoStore
		}
		return nil, err
	}
	return k.openLocked(ctx, id)
}

func (k *Kernel) openLocked(ctx context.Context, id string) (*store.Store, error) {
	if err := os.MkdirAll(k.dir(id), 0o755); err != nil {
		return nil, err
	}
	s, err := store.Open(ctx, id, filepath.Join(k.dir(id), "store.db"), k.Blobs)
	if err != nil {
		return nil, err
	}
	s.OnCommit = k.publish
	k.open[id] = s
	return s, nil
}

// NewStore is what CreateStore needs.
type NewStore struct {
	ID    string // "" makes s-xxxxxxxx
	Type  string
	App   string
	Owner string // defaults to the principal
}

// SetStoreType changes a store's type in the registry (what mounts match)
// and in the store's own meta (what it reports), as CreateStore sets both.
func (k *Kernel) SetStoreType(ctx context.Context, p *access.Principal, id, typ string) (sysdb.StoreRow, error) {
	row, err := k.Registry.SetStoreType(ctx, p.ID(), p.ViaLabel(), id, typ)
	if err != nil {
		return row, err
	}
	s, err := k.Store(ctx, id)
	if err != nil {
		return row, err
	}
	if s.Meta("type") == typ {
		return row, nil
	}
	_, err = s.Do(ctx, store.Who{ID: p.ID(), Via: p.ViaLabel()}, func(t *store.Turn) error {
		t.Summary = "type " + typ
		return t.SetMeta("type", typ)
	})
	return row, err
}

// CreateStore registers and creates a store.
func (k *Kernel) CreateStore(ctx context.Context, p *access.Principal, n NewStore) (sysdb.StoreRow, *store.Store, error) {
	if n.ID == "" {
		n.ID = ids.Slug("s-", 8)
	}
	if n.Owner == "" {
		n.Owner = p.ID()
	}
	if n.Owner == "" {
		return sysdb.StoreRow{}, nil, errors.New("a store needs an owner")
	}
	row, err := k.Registry.AddStore(ctx, sysdb.StoreRow{ID: n.ID, Type: n.Type, App: n.App, Owner: n.Owner, MadeBy: p.ID()}, p.ViaLabel())
	if err != nil {
		return row, nil, err
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	// A leftover directory from a store deleted while open is stale.
	if _, ok := k.open[n.ID]; !ok {
		_ = os.RemoveAll(k.dir(n.ID))
	}
	s, err := k.openLocked(ctx, n.ID)
	if err != nil {
		_ = k.Registry.RemoveStore(ctx, p.ID(), p.ViaLabel(), n.ID)
		return row, nil, err
	}
	kv := map[string]string{"type": n.Type, "owner": n.Owner}
	if n.App != "" {
		kv["app"] = n.App
	}
	_, err = s.Do(ctx, store.Who{ID: p.ID(), Via: p.ViaLabel()}, func(t *store.Turn) error {
		t.Summary = "created"
		for key, v := range kv {
			if err := t.SetMeta(key, v); err != nil {
				return err
			}
		}
		return nil
	})
	return row, s, err
}

// DeleteStore closes a store, deletes its file and its registry row.
func (k *Kernel) DeleteStore(ctx context.Context, p *access.Principal, id string) error {
	if err := k.Registry.RemoveStore(ctx, p.ID(), p.ViaLabel(), id); err != nil {
		return err
	}
	k.mu.Lock()
	if s, ok := k.open[id]; ok {
		s.Close()
		delete(k.open, id)
	}
	k.mu.Unlock()
	if err := os.RemoveAll(k.dir(id)); err != nil {
		return fmt.Errorf("store %s unregistered but its files remain: %w", id, err)
	}
	return nil
}

// Subscribe registers fn for every commit on every store; call the returned
// function to stop. fn runs on the committing goroutine and must not block.
func (k *Kernel) Subscribe(fn func(*store.Commit)) func() {
	k.subMu.Lock()
	k.subN++
	n := k.subN
	k.subs[n] = fn
	k.subMu.Unlock()
	return func() {
		k.subMu.Lock()
		delete(k.subs, n)
		k.subMu.Unlock()
	}
}

func (k *Kernel) publish(c *store.Commit) {
	k.subMu.RLock()
	defer k.subMu.RUnlock()
	for _, fn := range k.subs {
		fn(c)
	}
}

// Close closes every open store.
func (k *Kernel) Close() {
	k.mu.Lock()
	defer k.mu.Unlock()
	for id, s := range k.open {
		s.Close()
		delete(k.open, id)
	}
}

// systemTx is the transaction type sysdb.DB.Tx hands out.
type systemTx = *sql.Tx
