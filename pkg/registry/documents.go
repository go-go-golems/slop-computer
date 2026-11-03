package registry

// The registry as documents (SLOP3-008 phase 3): an app allowed _stores
// reads the registry rows of the stores it reaches as documents, and writes
// some of them, through the db API (people are account governance, changed
// in the back office, not through db):
//
//	_stores                         the stores the viewer may open
//	_stores/<id>                    a store's row (type, app, owner, …)
//	_stores/<id>/_grants/<subject>  its grants        write: grant.set / grant.rm
//	_stores/<id>/_bindings/<alias>  its aliases       write: bind.set / bind.rm
//	_stores/<id>/_llm/budget        its LLM budget    read-only
//	_people/<id>                    people            read-only (platform admins)
//
// Every read and write runs the verb that owns the row, as the viewer
// (labelled app:<app>), so it is allowed exactly when the viewer may do it
// themselves; a read the verb refuses shows nothing. Writes need
// capabilities.db.stores "admin", the person's confirmation in the shell
// (as module calls that change governance do), and honour ifVersion: a
// document's version is the system revision that last changed its row.
// Documents are computed on read; Live (live.go) tells a listener what
// changed when the system log records a change to their rows.

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// regPrincipal is the viewer as the registry's caller; nil for a visitor
// without an id, who reads nothing there.
func (d *Docs) regPrincipal(ctx context.Context, v *rt.View) *access.Principal {
	if v.User == "" {
		return nil
	}
	return d.Host.ActingApp(ctx, v)
}

// regRows runs a listing verb as the viewer and returns its rows as JSON
// objects; nil when the verb refuses (the viewer may not see them).
func (d *Docs) regRows(ctx context.Context, v *rt.View, verb string, args verbs.Args) []map[string]any {
	p := d.regPrincipal(ctx, v)
	if p == nil {
		return nil
	}
	out, err := verbs.Call(d.Host.WithPrincipal(ctx, p), d.Env, p, verb, args)
	if err != nil {
		return nil
	}
	b, _ := json.Marshal(out)
	var rows []map[string]any
	if json.Unmarshal(b, &rows) != nil {
		var one map[string]any
		if json.Unmarshal(b, &one) != nil {
			return nil
		}
		rows = []map[string]any{one}
	}
	return rows
}

// grantID is a grant's document id: its subject, with ~<via> for a grant
// that did not come directly (a share link's), so two never collide.
func grantID(g map[string]any) string {
	id, _ := g["subject"].(string)
	if via, _ := g["via"].(string); via != "" && via != "direct" {
		id += "~" + via
	}
	return id
}

func storeBody(r system.StoreRow, level rt.Level) map[string]any {
	return map[string]any{"id": r.ID, "type": r.Type, "app": r.App, "owner": r.Owner, "createdAt": r.CreatedAt, "level": level.String()}
}

// registryColl lists a registry collection (a page collection resolving to
// a registry target) as documents at page paths.
func (d *Docs) Coll(ctx context.Context, v *rt.View, tgt rt.Target, pageColl string) []rt.Doc {
	var docs []rt.Doc
	add := func(id string, body map[string]any, kind, key string) {
		ver := LastChange(ctx, d.Sys, kind, key)
		docs = append(docs, rt.Doc{Path: pageColl + "/" + id, Body: body, Version: max(ver, 1)})
	}
	switch {
	case tgt.Store == "" && tgt.Path == "":
		rows, err := d.Host.Reachable(ctx, v, v.Space.Stores)
		if err != nil {
			return nil
		}
		p := d.Host.Viewer(ctx, v)
		for _, r := range rows {
			add(r.ID, storeBody(r, min(d.Env.K.Access.Level(ctx, p, r).Level, v.Space.Stores)), "store", r.ID)
		}
	case tgt.Store == "" && tgt.Path == rt.PeopleRoot:
		for _, r := range d.regRows(ctx, v, "people.ls", verbs.Args{}) {
			id, _ := r["id"].(string)
			add(id, r, "person", id)
		}
	case tgt.Path == "_grants":
		for _, r := range d.regRows(ctx, v, "grant.ls", verbs.Args{"store": tgt.Store}) {
			sub, _ := r["subject"].(string)
			add(grantID(r), r, "grant", tgt.Store+" "+sub)
		}
	case tgt.Path == "_bindings":
		for _, r := range d.regRows(ctx, v, "bind.ls", verbs.Args{"store": tgt.Store}) {
			alias, _ := r["alias"].(string)
			add(alias, r, "binding", tgt.Store+" "+alias)
		}
	case tgt.Path == "_llm":
		for _, r := range d.regRows(ctx, v, "llm.usage", verbs.Args{"person": "store:" + tgt.Store}) {
			add("budget", r, "llm", "store:"+tgt.Store)
		}
	}
	return docs
}

// registryDoc reads one registry document at a page path; nil when there
// is none the viewer may see.
func (d *Docs) Doc(ctx context.Context, v *rt.View, tgt rt.Target, path string) *rt.Doc {
	if tgt.Store != "" && tgt.Path == "" {
		// _stores/<id>: the store's row, if the viewer may open it
		row, err := d.Sys.StoreByID(ctx, tgt.Store)
		if err != nil {
			return nil
		}
		level := min(d.Env.K.Access.Level(ctx, d.Host.Viewer(ctx, v), row).Level, v.Space.Stores)
		if level < rt.LevelView {
			return nil
		}
		return &rt.Doc{Path: path, Body: storeBody(row, level), Version: max(LastChange(ctx, d.Sys, "store", row.ID), 1)}
	}
	coll, id := tgt, rt.IDOf(tgt.Path)
	coll.Path = rt.CollOf(tgt.Path)
	if coll.Path == "" {
		return nil
	}
	pageColl := rt.CollOf(path)
	for _, d := range d.Coll(ctx, v, coll, pageColl) {
		if rt.IDOf(d.Path) == id {
			return &d
		}
	}
	return nil
}

// regWrite is one registry write: the verb that owns the row, its
// arguments, and the row's change key for ifVersion.
type regWrite struct {
	verb      string
	args      verbs.Args
	kind, key string
}

// registryWriteOf maps a write of a registry document to its verb.
func writeOf(tgt rt.Target, in WriteIn, body map[string]any) (regWrite, error) {
	only := func(fields ...string) error {
		for k := range body {
			ok := false
			for _, f := range fields {
				ok = ok || k == f
			}
			if !ok {
				return errf("invalid_argument", "%s cannot be written here (only %s)", k, strings.Join(fields, ", "))
			}
		}
		return nil
	}
	str := func(k string) string { v, _ := body[k].(string); return v }
	collOf, id := rt.CollOf(tgt.Path), rt.IDOf(tgt.Path)
	switch {
	case tgt.Store != "" && tgt.Path == "":
		if in.Op != "update" {
			return regWrite{}, errf("invalid_argument", "a store's row takes update {type}")
		}
		if err := only("type"); err != nil {
			return regWrite{}, err
		}
		return regWrite{verb: "store.type", args: verbs.Args{"id": tgt.Store, "type": str("type")}, kind: "store", key: tgt.Store}, nil
	case collOf == "_grants":
		if strings.Contains(id, "~") {
			return regWrite{}, errf("invalid_argument", "a grant from a share link is changed by revoking the link")
		}
		w := regWrite{kind: "grant", key: tgt.Store + " " + id}
		if in.Op == "delete" {
			w.verb, w.args = "grant.rm", verbs.Args{"store": tgt.Store, "subject": id}
			return w, nil
		}
		if err := only("level", "subject", "store", "via"); err != nil {
			return regWrite{}, err
		}
		w.verb, w.args = "grant.set", verbs.Args{"store": tgt.Store, "subject": id, "level": str("level")}
		return w, nil
	case collOf == "_bindings":
		w := regWrite{kind: "binding", key: tgt.Store + " " + id}
		if in.Op == "delete" {
			w.verb, w.args = "bind.rm", verbs.Args{"store": tgt.Store, "alias": id}
			return w, nil
		}
		if err := only("target", "prefix", "level", "assets", "store", "alias"); err != nil {
			return regWrite{}, err
		}
		a := verbs.Args{"store": tgt.Store, "alias": id, "target": str("target")}
		if p := str("prefix"); p != "" {
			a["prefix"] = p
			if l := str("level"); l != "" {
				a["level"] = l
			}
		}
		if b, _ := body["assets"].(bool); b {
			a["assets"] = true
		}
		w.verb, w.args = "bind.set", a
		return w, nil
	}
	return regWrite{}, errf("invalid_argument", "this registry document is read-only")
}

// registryWrite runs a write of a registry document as the viewer.
func (d *Docs) Write(ctx context.Context, v *rt.View, tgt rt.Target, in WriteIn) (int64, error) {
	if v.Space.Stores < rt.LevelAdmin {
		return 0, errf("invalid_argument", "writing the registry needs capabilities.db.stores \"admin\"")
	}
	var body map[string]any
	if in.Op == "set" || in.Op == "update" {
		b, err := rt.ParseBody(in.Body)
		if err != nil {
			return 0, errf("invalid_argument", "%v", err)
		}
		body = b
	} else if in.Op != "delete" {
		return 0, errf("invalid_argument", "the registry takes set, update and delete")
	}
	w, err := writeOf(tgt, in, body)
	if err != nil {
		return 0, err
	}
	p := d.regPrincipal(ctx, v)
	if p == nil || p.Person == nil {
		return 0, errf("permission_denied", "only a signed-in person changes the registry")
	}
	if in.IfVersion != nil {
		if have := LastChange(ctx, d.Sys, w.kind, w.key); have != *in.IfVersion {
			return 0, errf("conflict", "the document is at version %d, not %d", have, *in.IfVersion)
		}
	}
	// Refuse what the verb would refuse before asking anyone to allow it,
	// then ask the person in the shell (once per view and call).
	if err := verbs.Check(p, w.verb, w.args); err != nil {
		ve := verbs.AsError(err)
		return 0, errf(ve.Code, "%s", ve.Message)
	}
	if c, ok := d.Env.Confirmations().Check(p.Person.ID, v.ID, v.App, v.App, w.verb, w.args); !ok {
		return 0, &Error{Code: "confirmation_required", Message: v.App + " asks to " + c.Summary, Confirm: c.ID}
	}
	if _, err := verbs.Call(d.Host.WithPrincipal(ctx, p), d.Env, p, w.verb, w.args); err != nil {
		ve := verbs.AsError(err)
		return 0, errf(ve.Code, "%s", ve.Message)
	}
	return LastChange(ctx, d.Sys, w.kind, w.key), nil
}
