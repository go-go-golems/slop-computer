package actor

// use('storage') / ctx.storage (SLOP3-008 phase 5): the Durable-Object-shaped
// storage API, written in JavaScript (storage.js) over the actor's own db,
// sql and alarm modules. Two helpers come from Go: keyID (a key's document
// id) and sqlTable (a statement's columns, rows in column order, and rows
// written, for sql.exec's cursor).

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

//go:embed storage.js
var storageJS string

// storageKeyID is a storage key's document id under storage/: the key itself
// when it is one valid path segment (no /) that does not begin with ~,
// otherwise ~ and the hex SHA-256 of the key. The two never collide. A key
// with slashes is hashed even when storage/<key> is a valid document path
// (a/b/c): that document would sit in a nested collection, out of list's and
// deleteAll's sight.
func storageKeyID(key string) string {
	if !strings.HasPrefix(key, "~") && !strings.Contains(key, "/") && rt.ValidDocPath("storage/"+key) {
		return key
	}
	sum := sha256.Sum256([]byte(key))
	return "~" + hex.EncodeToString(sum[:])
}

// storageModule builds the storage object once per actor VM.
func (a *Actor) storageModule() goja.Value {
	if a.storage != nil {
		return a.storage
	}
	v, err := a.vm.RunString(storageJS)
	a.check(err)
	f, ok := goja.AssertFunction(v)
	if !ok {
		panic(a.vm.NewTypeError("storage.js is not a function"))
	}
	sqlTable := func(call goja.FunctionCall) goja.Value {
		cols, rows, written, err := a.turn().t.QueryTable(store.CallerActor, call.Argument(0).String(), a.params(call.Arguments[1:])...)
		a.check(err)
		if cols == nil {
			cols = []string{}
		}
		rs := make([]any, len(rows))
		for i, r := range rows {
			rs[i] = r
		}
		o := a.vm.NewObject()
		_ = o.Set("columns", a.toJS(cols))
		_ = o.Set("rows", a.toJS(rs))
		_ = o.Set("rowsWritten", written)
		return o
	}
	out, err := f(goja.Undefined(), a.dbModule(), a.sqlModule(), a.alarmModule(), a.vm.ToValue(storageKeyID), a.vm.ToValue(sqlTable))
	a.check(err)
	a.storage = out
	return out
}
