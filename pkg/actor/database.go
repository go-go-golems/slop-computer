package actor

// use('database') / require('database') (SLOP3-012 phase 1): go-go-goja's
// database API (query, exec, begin, configure, close) over the actor's own
// store, so scripts written for go-go-host or xgoja run here. It is not
// go-go-goja's module: that one wants a database/sql handle, which would
// bypass the actor caller's SQL authorizer, and its begin() opens a real
// transaction inside the turn's. Here every statement runs in the turn as
// store.CallerActor (or CallerActorRead), begin() is a SAVEPOINT, and there
// is no configure(): the module reaches this store's database and no other.

import (
	"strconv"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// DatabaseConfig configures the database module. Part 1 always uses the
// zero value; part 2 takes it from the admin's grant.
type DatabaseConfig struct {
	ReadOnly bool `json:"readOnly,omitempty"` // statements run as actor-read: no writes
	MaxRows  int  `json:"maxRows,omitempty"`  // rows a query may return (0: the store's 10,000)
}

// savepoint is one open database.begin() handle.
type savepoint struct {
	name string
	t    *store.Turn // the turn it was opened in; it never outlives it
	done bool
}

type jsFunc = func(goja.FunctionCall) goja.Value

// reservedModules are the use() names require() resolves before the app's
// own files (SLOP3-012): scripts written for go-go-goja require them.
var reservedModules = map[string]bool{"database": true, "express": true, "fs": true, "path": true,
	"yaml": true, "crypto": true, "events": true, "buffer": true} // bridged from go-go-goja (bridge.go)

// databaseModule builds the module once per actor (use() and require()
// return the same object).
func (a *Actor) databaseModule(cfg DatabaseConfig) goja.Value {
	if a.database != nil {
		return a.database
	}
	caller := store.CallerActor
	if cfg.ReadOnly {
		caller = store.CallerActorRead
	}
	o := a.vm.NewObject()
	check := func(err error) {
		// actor-read's authorizer refuses writes as SQLite does ("not
		// authorized"); say why.
		if err != nil && cfg.ReadOnly && strings.Contains(err.Error(), "not authorized") {
			a.throw(fail("permission_denied", "the database module is read-only for %s (its app.trust configuration): %v", a.run.App, err))
		}
		a.check(err)
	}
	query := func(call goja.FunctionCall) goja.Value {
		rows, err := a.turn().t.Query(caller, call.Argument(0).String(), a.flatParams(call.Arguments[1:])...)
		check(err)
		if cfg.MaxRows > 0 && len(rows) > cfg.MaxRows {
			a.throw(fail("invalid_argument", "the query returned more than %d rows", cfg.MaxRows))
		}
		if rows == nil {
			rows = []map[string]any{}
		}
		return a.toJS(rows)
	}
	exec := func(call goja.FunctionCall) goja.Value {
		res, err := a.turn().t.Exec(caller, call.Argument(0).String(), a.flatParams(call.Arguments[1:])...)
		check(err)
		n, _ := res.RowsAffected()
		id, _ := res.LastInsertId()
		return a.toJS(map[string]any{"success": true, "rowsAffected": n, "lastInsertId": id})
	}
	_ = o.Set("query", query)
	_ = o.Set("exec", exec)
	_ = o.Set("begin", func() goja.Value { return a.begin(caller, query, exec) })
	_ = o.Set("configure", func(goja.FunctionCall) goja.Value {
		a.throw(fail("permission_denied", "database is this store's own database; configure() is not available"))
		return nil
	})
	_ = o.Set("close", func() {})
	a.database = o
	return o
}

// begin opens a savepoint and returns its handle {query, exec, commit,
// rollback}. A handle ends with commit, rollback, or its turn.
func (a *Actor) begin(caller string, query, exec jsFunc) goja.Value {
	t := a.turn().t
	a.seq++
	sp := &savepoint{name: "dbsp" + strconv.Itoa(a.seq), t: t}
	_, err := t.Exec(caller, "SAVEPOINT "+sp.name)
	a.check(err)
	a.savepoints = append(a.savepoints, sp)
	live := func() {
		if sp.done || a.cur == nil || a.cur.t != t {
			a.throw(fail("conflict", "the transaction ended (with its turn, or by commit or rollback)"))
		}
	}
	h := a.vm.NewObject()
	_ = h.Set("query", func(c goja.FunctionCall) goja.Value { live(); return query(c) })
	_ = h.Set("exec", func(c goja.FunctionCall) goja.Value { live(); return exec(c) })
	_ = h.Set("commit", func() goja.Value {
		live()
		a.endSavepoint(caller, sp, false)
		return a.toJS(map[string]any{"success": true})
	})
	_ = h.Set("rollback", func() goja.Value {
		live()
		a.endSavepoint(caller, sp, true)
		return a.toJS(map[string]any{"success": true})
	})
	return h
}

// endSavepoint releases sp, or rolls it back and releases it. SQLite's
// RELEASE and ROLLBACK TO also end every savepoint opened after sp, so
// those handles end with it.
func (a *Actor) endSavepoint(caller string, sp *savepoint, rollback bool) {
	if rollback {
		_, err := sp.t.Exec(caller, "ROLLBACK TO "+sp.name)
		a.check(err)
	}
	_, err := sp.t.Exec(caller, "RELEASE "+sp.name)
	a.check(err)
	a.popSavepointsFrom(sp)
}

func (a *Actor) popSavepointsFrom(sp *savepoint) {
	for i, s := range a.savepoints {
		if s == sp {
			for _, inner := range a.savepoints[i:] {
				inner.done = true
			}
			a.savepoints = a.savepoints[:i]
			return
		}
	}
}

// closeSavepoints ends a turn that succeeded: handles still open roll back
// (an open handle never survives its turn, so it cannot commit by accident).
func (a *Actor) closeSavepoints() {
	if len(a.savepoints) == 0 {
		return
	}
	outer := a.savepoints[0]
	_, _ = outer.t.Exec(store.CallerActor, "ROLLBACK TO "+outer.name)
	_, _ = outer.t.Exec(store.CallerActor, "RELEASE "+outer.name)
	a.popSavepointsFrom(outer)
}

// dropSavepoints forgets the handles of a turn that failed: the whole turn
// rolls back, so their savepoints go with it.
func (a *Actor) dropSavepoints() {
	for _, s := range a.savepoints {
		s.done = true
	}
	a.savepoints = nil
}

// noOpenTransaction throws while a database handle is open. A document or
// file write is recorded in the turn's change list as it happens, so a
// ROLLBACK TO under it would leave a change event for a write that never
// committed.
func (a *Actor) noOpenTransaction(what string) {
	if len(a.savepoints) > 0 {
		a.throw(fail("conflict", "%s cannot change while a database transaction is open: commit or roll it back first", what))
	}
}

// flatParams binds statement arguments as go-go-goja does: an array
// argument is spread into positional parameters (one level), then slop's
// mapping applies (numbers, booleans as 0/1, objects and nested arrays as
// JSON strings).
func (a *Actor) flatParams(args []goja.Value) []any {
	var flat []goja.Value
	for _, v := range args {
		if obj, ok := v.(*goja.Object); ok && obj.ClassName() == "Array" {
			n := obj.Get("length").ToInteger()
			for i := int64(0); i < n; i++ {
				flat = append(flat, obj.Get(strconv.FormatInt(i, 10)))
			}
			continue
		}
		flat = append(flat, v)
	}
	return a.params(flat)
}
