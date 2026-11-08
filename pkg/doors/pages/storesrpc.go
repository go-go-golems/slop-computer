package pages

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// maxListedStores bounds slop.stores.list: the stores of one type a person
// can open, with a title read from each (SLOP3-016, "my boards").
const maxListedStores = 200

// rpcSlopStores lists the stores of one type that the viewer holds a level
// on: owned, granted to them, or open to an audience they are in (what
// store.ls lists, narrowed to a type). With title, it also reads that
// document from each store as the viewer, under the store's rules, and
// returns its "title" field: a board page can then name each board.
func (s *Door) rpcSlopStores(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Type  string `json:"type"`
		Title string `json:"title"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if a.Type == "" {
		return nil, rtErr("invalid_argument", "list needs a store type")
	}
	if a.Title != "" && !rt.ValidDocPath(a.Title) {
		return nil, rtErr("invalid_argument", "title is a document path such as board/meta")
	}
	out := []map[string]any{}
	p := s.viewPrincipal(ctx, v)
	if p == nil {
		return map[string]any{"stores": out}, nil
	}
	rows, err := s.K.VisibleStores(ctx, p)
	if err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].CreatedAt > rows[j].CreatedAt })
	for _, r := range rows {
		if r.Type != a.Type {
			continue
		}
		if len(out) == maxListedStores {
			break
		}
		d := s.K.Access.Level(ctx, p, r)
		if d.Level < rt.LevelView { // Level computes the level; OK belongs to a check
			continue
		}
		row := map[string]any{"id": r.ID, "app": r.App, "level": d.LevelName(), "mine": r.Owner == p.ID(), "createdAt": r.CreatedAt}
		if a.Title != "" {
			if t := s.storeTitle(ctx, p.ID(), r.ID, a.Title); t != "" {
				row["title"] = t
			}
		}
		out = append(out, row)
	}
	return map[string]any{"stores": out}, nil
}

// storeTitle reads path's "title" from a store as the person, or "".
func (s *Door) storeTitle(ctx context.Context, uid, id, path string) string {
	p := s.Web.PersonAs(ctx, uid, "page")
	st, d, err := s.K.Open(ctx, p, id, rt.LevelView, "reading", true)
	if err != nil || !d.OK {
		return ""
	}
	rules := s.K.Rules(ctx, id)
	doc, err := st.GetDoc(ctx, path, func(path string) bool { return rules.CanRead(path, p.ID(), d.Level) })
	if err != nil {
		return ""
	}
	t, _ := doc.Body["title"].(string)
	return t
}
