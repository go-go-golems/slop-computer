package commands

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// PreviewTTL is how long a preview origin serves.
const PreviewTTL = time.Hour

func previewVerbs(e *Env) []*verbs.Verb {
	return []*verbs.Verb{
		{Name: "preview.url", Doc: "A private preview of a store's snapshot on its own sandbox origin, with the pick-and-pin bridge, framed only by parent (an origin of this server); it serves for an hour.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "at", Type: "string", Pos: 2, Doc: "a snapshot number or ref (default draft, else main)"},
				{Name: "parent", Type: "string", Pos: 3, Required: true, Doc: "the origin of the page that frames it"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if e.Cfg.Hosts.Sandbox == "" {
					return nil, verbs.Errf("unavailable", "this server has no sandbox host")
				}
				if p.Person == nil {
					return nil, verbs.Errf("unauthenticated", "previews are for people")
				}
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "previewing")
				if err != nil {
					return nil, err
				}
				parent := strings.TrimSuffix(a.S("parent"), "/")
				if !e.serverOrigin(parent) {
					return nil, verbs.Errf("invalid_argument", "parent must be an origin of this server, not %q", parent)
				}
				at := a.S("at")
				n, err := s.Ref(ctx, at)
				if at == "" {
					if n, err = s.Ref(ctx, "draft"); err != nil {
						n, err = s.Ref(ctx, "main")
					}
				}
				if err != nil {
					return nil, verbs.Errf("not_found", "no snapshot or ref %s on %s", at, s.ID)
				}
				b := make([]byte, 12)
				if _, err := rand.Read(b); err != nil {
					return nil, err
				}
				pv := system.Preview{Label: "p" + hex.EncodeToString(b), Store: s.ID, N: n, Person: p.Person.ID, Parent: parent,
					ExpiresAt: e.Sys.NowMs() + PreviewTTL.Milliseconds()}
				if err := e.Sys.CreatePreview(ctx, pv); err != nil {
					return nil, err
				}
				return map[string]any{"url": e.Cfg.Scheme + "://" + pv.Label + "." + e.Cfg.Hosts.Sandbox + "/",
					"store": pv.Store, "n": pv.N, "parent": pv.Parent, "expiresAt": pv.ExpiresAt}, nil
			}},
	}
}

// serverOrigin reports an origin of this server: the main host, a live
// host, or a sandbox origin.
func (e *Env) serverOrigin(o string) bool {
	c := e.Cfg
	if o == c.MainURL() {
		return true
	}
	for _, h := range c.Hosts.Live {
		if o == c.Origin(h) {
			return true
		}
	}
	host, ok := strings.CutPrefix(o, c.Scheme+"://")
	label, rest, _ := strings.Cut(host, ".")
	return ok && c.Hosts.Sandbox != "" && rest == c.Hosts.Sandbox && label != "" &&
		!slices.ContainsFunc([]rune(label), func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9') })
}
