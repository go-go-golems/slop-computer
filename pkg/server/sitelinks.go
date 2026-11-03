package server

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// claimDocsAtMost bounds the private documents one claim copies.
const claimDocsAtMost = 2000

// siteLinks answers POST /_site/links {path, level, days}: an owner makes
// a share link to the store at path. The token is in the URL, shown once.
func (s *Server) siteLinks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path  string `json:"path"`
		Level string `json:"level"`
		Days  int    `json:"days"`
	}
	if err := httpx.Read(r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {path, level, days}")
		return
	}
	id, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	var until int64
	if in.Days > 0 {
		until = time.Now().Add(time.Duration(in.Days) * 24 * time.Hour).UnixMilli()
	}
	l, token, err := s.Registry.CreateLink(r.Context(), p.ID(), "site", id, in.Level, until)
	if err != nil {
		httpx.Fail(w, 400, "invalid_argument", err.Error())
		return
	}
	httpx.JSON(w, 201, map[string]any{"link": l, "url": s.Cfg.Origin(r.Host) + siteReturn(in.Path) + "?k=" + url.QueryEscape(token)})
}

// siteRevokeLink answers POST /_site/links/<id>/revoke {path}.
func (s *Server) siteRevokeLink(w http.ResponseWriter, r *http.Request, linkID string) {
	var in struct {
		Path string `json:"path"`
	}
	_ = httpx.Read(r, &in, 4<<10)
	id, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	l, err := s.Registry.LinkByID(r.Context(), linkID)
	if err != nil || l.Store != id {
		httpx.Fail(w, 404, "not_found", "no such link here")
		return
	}
	if _, err := s.Registry.RevokeLink(r.Context(), p.ID(), "site", linkID); err != nil {
		failView(w, err)
		return
	}
	s.reviewViews(r.Context(), id)
	httpx.JSON(w, 200, map[string]any{"ok": true})
}

// redeemLink gives p the level of a share link on a store. A link never
// lowers a level; an expired or revoked one is link_invalid.
func (s *Server) redeemLink(ctx context.Context, storeID, token string, p *access.Principal) error {
	row, err := s.Registry.StoreByID(ctx, storeID)
	if err != nil {
		return err
	}
	have := s.Env.K.Access.Level(ctx, p, row).LevelName()
	_, _, err = s.Registry.RedeemLink(ctx, storeID, token, p.ID(), have)
	return err
}

// claimable is what the guest a person signed in over left behind. With
// nothing left, the offer is settled at once.
func (s *Server) claimable(r *http.Request, p *access.Principal, sess *identity.Session) map[string]int {
	if p == nil || p.Kind != access.KindUser || sess == nil || sess.FromGuest == "" {
		return nil
	}
	ctx := r.Context()
	docs := s.Env.K.PrivateDocs(ctx, sess.FromGuest)
	grants, err := s.People.SubjectGrants(ctx, sess.FromGuest)
	if err != nil {
		return nil
	}
	if len(docs) == 0 && len(grants) == 0 {
		if c, err := r.Cookie(s.siteCookie()); err == nil {
			_ = s.People.SettleClaim(ctx, c.Value)
		}
		return nil
	}
	places := map[string]bool{}
	for _, d := range docs {
		places[d.Store] = true
	}
	for _, g := range grants {
		places[g.Store] = true
	}
	return map[string]int{"docs": len(docs), "grants": len(grants), "places": len(places)}
}

// siteClaim answers POST /_site/claim {keep}: the person keeps what the
// guest they signed in over did (its private documents, copied where they
// have none, and its grants), or leaves it to expire. Either way the offer
// is settled.
func (s *Server) siteClaim(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Keep bool `json:"keep"`
	}
	if err := httpx.Read(r, &in, 1024); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {keep}")
		return
	}
	ctx := r.Context()
	p, sess := s.sitePrincipal(r)
	if p == nil || p.Kind != access.KindUser || sess == nil || sess.FromGuest == "" {
		httpx.Fail(w, 404, "not_found", "there is nothing to keep")
		return
	}
	guest, user := sess.FromGuest, p.ID()
	kept, moved := 0, 0
	if in.Keep {
		docs := s.Env.K.PrivateDocs(ctx, guest)
		if len(docs) > claimDocsAtMost {
			docs = docs[:claimDocsAtMost]
		}
		byStore := map[string][]store.Doc{}
		for _, d := range docs {
			byStore[d.Store] = append(byStore[d.Store], d.Doc)
		}
		for id, ds := range byStore {
			st, err := s.Env.K.Store(ctx, id)
			if err != nil {
				continue
			}
			_, err = st.Do(ctx, store.Who{ID: user, Via: "claim"}, func(t *store.Turn) error {
				for _, d := range ds {
					path := "data/users/" + user + "/" + strings.TrimPrefix(d.Path, "data/users/"+guest+"/")
					if _, err := t.GetDoc(path); err == nil {
						continue // theirs already: keep it
					}
					if _, err := t.SetDoc(path, d.Body, 0); err != nil {
						return err
					}
					kept++
				}
				return nil
			})
			if err != nil && !errors.Is(err, store.ErrNotFound) {
				failView(w, err)
				return
			}
		}
		stores, err := s.People.MoveGrants(ctx, guest, user)
		if err != nil {
			failView(w, err)
			return
		}
		moved = len(stores)
		for _, id := range stores {
			s.reviewViews(ctx, id)
		}
	}
	if c, err := r.Cookie(s.siteCookie()); err == nil {
		_ = s.People.SettleClaim(ctx, c.Value)
	}
	httpx.JSON(w, 200, map[string]any{"kept": in.Keep, "docs": kept, "grants": moved})
}
