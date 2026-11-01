package kernel

import (
	"context"

	"github.com/go-go-golems/slop/pkg/store"
)

// GuestPlaces are the stores where a guest may have left something: those
// granted to it, and those granted to every guest.
func (k *Kernel) GuestPlaces(ctx context.Context, guest string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(id string) {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	if gs, err := k.Sys.SubjectGrants(ctx, guest); err == nil {
		for _, g := range gs {
			add(g.Store)
		}
	}
	if rows, err := k.Sys.StoresGranted(ctx, []string{"@guest"}); err == nil {
		for _, r := range rows {
			add(r.ID)
		}
	}
	return out
}

// PrivateDoc is a document under data/users/<person>/ in one store.
type PrivateDoc struct {
	Store string
	Doc   store.Doc
}

// PrivateDocs are a guest's live documents under data/users/<guest>/.
func (k *Kernel) PrivateDocs(ctx context.Context, guest string) []PrivateDoc {
	var out []PrivateDoc
	for _, id := range k.GuestPlaces(ctx, guest) {
		st, err := k.Store(ctx, id)
		if err != nil {
			continue
		}
		docs, err := st.DocsSince(ctx, 0, "data/users/"+guest+"/")
		if err != nil {
			continue
		}
		for _, d := range docs {
			if d.Body != nil {
				out = append(out, PrivateDoc{id, d})
			}
		}
	}
	return out
}

// SweepGuests deletes the guests unseen since cutoff (ms), with their
// private documents and grants. It returns how many it deleted.
func (k *Kernel) SweepGuests(ctx context.Context, cutoff int64) (int, error) {
	ids, err := k.Sys.StaleGuests(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	for _, g := range ids {
		byStore := map[string][]string{}
		for _, d := range k.PrivateDocs(ctx, g) {
			byStore[d.Store] = append(byStore[d.Store], d.Doc.Path)
		}
		for id, paths := range byStore {
			st, err := k.Store(ctx, id)
			if err != nil {
				continue
			}
			if _, err := st.Do(ctx, store.Who{ID: "system", Via: "sweep"}, func(t *store.Turn) error {
				for _, p := range paths {
					if _, err := t.DeleteDoc(p); err != nil {
						return err
					}
				}
				return nil
			}); err != nil {
				return 0, err
			}
		}
		if err := k.Sys.DeleteGuest(ctx, g); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
