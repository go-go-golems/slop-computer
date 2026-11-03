package commands

import (
	"crypto/rand"
	"encoding/hex"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// PreviewTTL is how long a preview origin serves.
const PreviewTTL = time.Hour

func previewVerbs(e previewEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[PreviewURLIn, any]{Name: "preview.url", Doc: "A private preview of a store's snapshot on its own sandbox origin, with the pick-and-pin bridge, framed only by parent (an origin of this server); it serves for an hour.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in PreviewURLIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if e.Cfg.Hosts.Sandbox == "" {
					return nil, verbs.Errf("unavailable", "this server has no sandbox host")
				}
				if p.Person == nil {
					return nil, verbs.Errf("unauthenticated", "previews are for people")
				}
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "previewing")
				if err != nil {
					return nil, err
				}
				parent := strings.TrimSuffix(in.Parent, "/")
				if !e.serverOrigin(parent) {
					return nil, verbs.Errf("invalid_argument", "parent must be an origin of this server, not %q", parent)
				}
				at := in.At
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
				pv := registry.Preview{Label: "p" + hex.EncodeToString(b), Store: s.ID, N: n, Person: p.Person.ID, Parent: parent,
					ExpiresAt: e.K.Sys.NowMs() + PreviewTTL.Milliseconds()}
				if err := e.K.Registry.CreatePreview(ctx, pv); err != nil {
					return nil, err
				}
				return map[string]any{"url": e.Cfg.Scheme + "://" + pv.Label + "." + e.Cfg.Hosts.Sandbox + "/",
					"store": pv.Store, "n": pv.N, "parent": pv.Parent, "expiresAt": pv.ExpiresAt}, nil
			}}.Verb(),
	}
}

// serverOrigin reports an origin of this server: the main host, a live
// host, or a sandbox origin.
func (e previewEnv) serverOrigin(o string) bool {
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
		!slices.ContainsFunc([]rune(label), func(r rune) bool { return (r < 'a' || r > 'z') && (r < '0' || r > '9') })
}

// PreviewURLIn is preview.url's input.
type PreviewURLIn struct {
	Store  string `json:"store" slop:"pos=1"`
	At     string `json:"at,omitempty" slop:"pos=2" jsonschema_description:"a snapshot number or ref (default draft, else main)"`
	Parent string `json:"parent" slop:"pos=3" jsonschema_description:"the origin of the page that frames it"`
}
