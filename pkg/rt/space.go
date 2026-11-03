package rt

import (
	"sort"
	"strings"
)

// --- the path space (SLOP3-008) ---------------------------------------------
//
// A page's db sees one path space. Its own store sits at the root, exactly as
// the contract has it. Other stores are reached two ways:
//
//   - an alias: a top-level name the holder store's owner bound to a
//     collection of another store (contacts → crm-team: contacts), so a page
//     written for claude.ai reaches it without knowing;
//   - _stores/<id>/<path>: every store, for an app that declares
//     capabilities.db.stores and that an admin allowed (the "stores" policy
//     cell).
//
// A top-level segment that begins with "_" belongs to the platform, at the
// page's root and at every store's root.

// StoresRoot is the top-level name under which other stores are reached.
const StoresRoot = "_stores"

// Reserved reports whether a path's first segment is the platform's.
func Reserved(p string) bool { return strings.HasPrefix(p, "_") }

// Alias maps one top-level name of the page's path space to a collection of
// a store.
type Alias struct {
	Name   string `json:"alias"`
	Store  string `json:"store"`
	Prefix string `json:"prefix"` // a collection path in Store
	Level  Level  `json:"level"`  // the most the alias gives, whatever the viewer holds
	Assets bool   `json:"assets,omitempty"`
}

// Space is a view's path space: the holder store, its aliases, and how far
// _stores reaches (LevelNone: not at all).
type Space struct {
	Holder  string           `json:"holder"`
	Aliases map[string]Alias `json:"aliases,omitempty"`
	Stores  Level            `json:"stores,omitempty"`
}

// Target is where a page path lands.
type Target struct {
	Store string // the store holding the document
	Path  string // its path in that store
	Own   bool   // Store is the holder (Cap is then the view's own level)
	Cap   Level  // the ceiling the route puts on the viewer's level
	Via   string // "" (own), an alias name, or StoresRoot
	// Registry: _stores or _stores/<id>, the registry's documents
	// (SLOP3-008 phase 3; not served yet).
	Registry bool
}

// PathError is a page path the space refuses, with a contract error code.
type PathError struct{ Code, Msg string }

func (e *PathError) Error() string { return e.Code + ": " + e.Msg }

func pathErr(code, msg string) error { return &PathError{Code: code, Msg: msg} }

// Resolve maps a page path (a document if doc, else a collection) to its
// target. A nil space is a store alone: every path is its own.
func (sp *Space) Resolve(p string, doc bool) (Target, error) {
	kind := "collection"
	if doc {
		kind = "document"
	}
	if p == "" {
		return Target{}, pathErr("invalid_argument", "an empty path")
	}
	head, rest, _ := strings.Cut(p, "/")
	holder := ""
	if sp != nil {
		holder = sp.Holder
	}
	switch {
	case head == StoresRoot:
		if sp == nil || sp.Stores == LevelNone {
			return Target{}, pathErr("invalid_argument", "_stores is not open to this app (capabilities.db.stores, allowed by an admin)")
		}
		id, inner, _ := strings.Cut(rest, "/")
		if rest == "" || inner == "" {
			// _stores (a collection) or _stores/<id> (a document)
			if (rest != "") != doc || (rest != "" && !segmentRe.MatchString(id)) {
				return Target{}, pathErr("invalid_argument", p+" is not a "+kind+" path")
			}
			return Target{Store: id, Via: StoresRoot, Cap: sp.Stores, Registry: true}, nil
		}
		if !segmentRe.MatchString(id) || !validPath(inner, doc) {
			return Target{}, pathErr("invalid_argument", p+" is not a "+kind+" path")
		}
		return sp.target(id, inner, sp.Stores, StoresRoot)
	case Reserved(head):
		return Target{}, pathErr("invalid_argument", head+" is reserved: top-level names beginning with _ are the platform's")
	}
	if sp != nil {
		if a, ok := sp.Aliases[head]; ok {
			path := a.Prefix
			if rest != "" {
				path += "/" + rest
			}
			if !validPath(path, doc) {
				return Target{}, pathErr("invalid_argument", p+" is not a "+kind+" path")
			}
			return sp.target(a.Store, path, a.Level, a.Name)
		}
	}
	if !validPath(p, doc) {
		return Target{}, pathErr("invalid_argument", p+" is not a "+kind+" path")
	}
	return Target{Store: holder, Path: p, Own: true, Cap: LevelOwner}, nil
}

// target builds a target in store at path, reached via a route with
// ceiling ceil. Another store's private documents (data/users/<id>/…) are not
// reachable: only that person may read them, and only through that store's
// own app, so an app reaching in cannot read them on their behalf.
func (sp *Space) target(store, path string, ceil Level, via string) (Target, error) {
	if store == sp.Holder {
		return Target{Store: store, Path: path, Own: true, Cap: ceil, Via: via}, nil
	}
	if _, private := privateOwner(path); private {
		return Target{}, pathErr("not_found", "another store's private documents are not reachable")
	}
	return Target{Store: store, Path: path, Cap: ceil, Via: via}, nil
}

// PagePaths are the page paths at which a document of store at path appears
// in this space: the path itself in the holder, each alias whose prefix
// holds it, and _stores/<store>/<path> when _stores is open. Another store's
// private documents appear nowhere.
func (sp *Space) PagePaths(store, path string) []string {
	var out []string
	own := sp == nil || store == sp.Holder
	if own {
		head, _, _ := strings.Cut(path, "/")
		if _, shadowed := sp.aliasNamed(head); !shadowed {
			out = append(out, path) // an alias of the same name hides it
		}
	} else if _, private := privateOwner(path); private {
		return nil
	}
	if sp == nil {
		return out
	}
	for _, a := range sp.Aliases {
		if a.Store == store && strings.HasPrefix(path, a.Prefix+"/") {
			out = append(out, a.Name+path[len(a.Prefix):])
		}
	}
	if sp.Stores != LevelNone {
		out = append(out, StoresRoot+"/"+store+"/"+path)
	}
	return out
}

func (sp *Space) aliasNamed(name string) (Alias, bool) {
	if sp == nil {
		return Alias{}, false
	}
	a, ok := sp.Aliases[name]
	return a, ok
}

// AssetStores are the stores whose uploads a page may show by bare id, in
// the order an id is looked up after the holder's own: the targets of
// aliases that share uploads, by alias name.
func (sp *Space) AssetStores() []string {
	if sp == nil {
		return nil
	}
	names := make([]string, 0, len(sp.Aliases))
	for n, a := range sp.Aliases {
		if a.Assets && a.Store != sp.Holder {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	seen := map[string]bool{}
	var out []string
	for _, n := range names {
		if s := sp.Aliases[n].Store; !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// Equal reports whether two spaces route every path the same way.
func (sp *Space) Equal(o *Space) bool {
	if sp == nil || o == nil {
		return sp == o
	}
	if sp.Holder != o.Holder || sp.Stores != o.Stores || len(sp.Aliases) != len(o.Aliases) {
		return false
	}
	for n, a := range sp.Aliases {
		if o.Aliases[n] != a {
			return false
		}
	}
	return true
}

// ValidAlias checks an alias that maps into the path space: a plain
// top-level name and a collection path.
func ValidAlias(name, prefix string) error {
	switch {
	case !segmentRe.MatchString(name) || name == "." || name == "..":
		return pathErr("invalid_argument", "an alias is one path segment")
	case Reserved(name):
		return pathErr("invalid_argument", "an alias cannot begin with _ (the platform's names)")
	case !validPath(prefix, false):
		return pathErr("invalid_argument", "the prefix must be a collection path (an odd number of segments), so the alias keeps every path's meaning")
	}
	return nil
}
