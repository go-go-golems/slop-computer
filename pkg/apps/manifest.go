// Package apps reads app manifests (app.json): a store is an app when its
// tree holds one. The capabilities block keeps the claude.ai contract's
// shape (parsed by rt.ParseManifest); slop-specific fields sit under slop.
package apps

import (
	"encoding/json"
	"fmt"
	"path"
	"strings"

	"github.com/go-go-golems/slop/pkg/rt"
)

// File is the manifest's name in a store's tree.
const File = "app.json"

// Manifest is a parsed app.json.
type Manifest struct {
	Title    string `json:"title,omitempty"`
	Page     string `json:"page,omitempty"`     // the HTML entry (default index.html when present)
	NotFound string `json:"notFound,omitempty"` // static sites: the page a missing path gets, with a 404
	Actor    string `json:"actor,omitempty"`    // the server entry, actor.js
	Type     string `json:"type,omitempty"`     // the store type this app runs on and creates
	Slop     Slop   `json:"slop"`

	Caps rt.Caps `json:"-"`
}

// Slop is the slop-specific part of a manifest.
type Slop struct {
	Reads    map[string]Read `json:"reads,omitempty"`    // read aliases
	Fetch    []string        `json:"fetch,omitempty"`    // origins the actor may request
	Secrets  []string        `json:"secrets,omitempty"`  // secret names the actor may read
	Platform []string        `json:"platform,omitempty"` // stores.create, mounts.set, grants.set
	Modules  []string        `json:"modules,omitempty"`  // Go modules the actor uses once an admin trusts the app with them
}

// Read is one read alias: the store type it expects.
type Read struct {
	Type string `json:"type"`
}

// Platform capabilities an app may ask for.
var Platform = map[string]bool{"stores.create": true, "mounts.set": true, "grants.set": true}

// Modules are the Go modules an app may declare (registered by the server;
// each needs an admin's app.trust before use() returns it).
var Modules = map[string]bool{"system": true, "workshop": true}

// Parse reads and checks app.json.
func Parse(raw []byte) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("app.json: %v", err)
	}
	caps, err := rt.ParseManifest(raw, rt.SlopPermissions)
	if err != nil {
		return nil, fmt.Errorf("app.json: %v", err)
	}
	m.Caps = caps
	for _, f := range []struct{ name, v string }{{"page", m.Page}, {"notFound", m.NotFound}, {"actor", m.Actor}} {
		if f.v != "" && (strings.HasPrefix(f.v, "/") || path.Clean(f.v) != f.v || strings.HasPrefix(f.v, "..")) {
			return nil, fmt.Errorf("app.json: %s must be a relative path in the tree", f.name)
		}
	}
	for _, p := range m.Slop.Platform {
		if !Platform[p] {
			return nil, fmt.Errorf("app.json: slop.platform: unknown %q", p)
		}
	}
	for _, name := range m.Slop.Modules {
		if !Modules[name] {
			return nil, fmt.Errorf("app.json: slop.modules: unknown %q", name)
		}
	}
	for alias, r := range m.Slop.Reads {
		if alias == "" || r.Type == "" {
			return nil, fmt.Errorf("app.json: slop.reads: each alias needs a type")
		}
	}
	return &m, nil
}

// Entry is the page a request for the app's root serves.
func (m *Manifest) Entry() string {
	if m != nil && m.Page != "" {
		return m.Page
	}
	return "index.html"
}

// Live reports whether the app needs a live host: it declares a
// capability, or has server code.
func (m *Manifest) Live() bool { return m != nil && (m.Caps.IsApp() || m.Actor != "") }
