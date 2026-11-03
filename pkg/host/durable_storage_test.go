package host

// SLOP3-008 phase 5: the Durable-Object-shaped storage API for actors.

import (
	"reflect"
	"strings"
	"testing"
)

const storageActor = `
const storage = use('storage'), db = use('db');
const codeOf = async (f) => { try { await f(); return 'ok'; } catch (e) { return e.code || String(e); } };
defineActor({
  actions: {
    async kv(ctx) {
      const s = ctx.storage;
      await s.put('a', 1);
      await s.put({ b: { x: [1, 2] }, 'c/d': 'slash', 'a/b/c': 'deep', 'x/y': 'two', '~t': true, '！': 'bmp', '\u{1F600}': 'astral' });
      const many = await s.get(['b', 'missing', 'a']);
      const out = {
        same: storage === ctx.storage,
        one: await s.get('a'),
        missing: (await s.get('nope')) === undefined,
        many: Array.from(many),
        all: Array.from((await s.list()).keys()),
        prefix: Array.from(await s.list({ prefix: 'c' })),
        reverse: Array.from((await s.list({ reverse: true, limit: 2 })).keys()),
        range: Array.from((await s.list({ start: 'a', end: 'c' })).keys()),
        after: Array.from((await s.list({ startAfter: 'b', limit: 1 })).keys()),
        deleted: await s.delete('a'),
        deletedAgain: await s.delete('a'),
        n: await s.delete(['b', 'zz']),
      };
      out.left = Array.from((await s.list()).keys());
      await s.put('plain', 0);
      return out;
    },
    async clear(ctx) { await ctx.storage.deleteAll(); return Array.from((await ctx.storage.list()).keys()); },
    async tx(ctx) {
      const s = ctx.storage;
      await s.put('k', 'before');
      const failed = await codeOf(() => s.transaction(async (txn) => {
        await txn.put('k', 'inside');
        await txn.put('k2', 'inside');
        if ((await txn.get('k')) !== 'inside') throw new Error('reads its writes');
        if (!(await txn.list({ prefix: 'k' })).has('k2')) throw new Error('lists its writes');
        if ((await s.get('k')) !== 'before') throw new Error('isolated');
        ctx.fail('conflict', 'abort');
      }));
      await s.transaction(async (txn) => { await txn.put('r', 1); txn.rollback(); });
      const v = await s.transaction(async (txn) => { await txn.put('w', 2); await txn.delete('k'); return 'done'; });
      return { failed, v, keys: Array.from((await s.list()).keys()) };
    },
    sync(ctx) {
      const s = ctx.storage;
      let thrown = '';
      try {
        s.transactionSync(() => {
          s.sql.exec('INSERT INTO t (v) VALUES (?)', 'x');
          s.kv.put('s', 1);
          throw new Error('no');
        });
      } catch (e) { thrown = e.message; }
      const r = s.transactionSync(() => { s.sql.exec('INSERT INTO t (v) VALUES (?)', 'y'); s.kv.put('s', 2); return 7; });
      const c = s.sql.exec('SELECT v, v AS w FROM t ORDER BY id');
      const ins = s.sql.exec('INSERT INTO t (v) VALUES (?), (?)', 'p', 'q');
      const iter = [];
      for (const row of s.sql.exec('SELECT v FROM t ORDER BY id')) iter.push(row.v);
      return { thrown, r, cols: c.columnNames, read: c.rowsRead, rows: c.toArray(), written: ins.rowsWritten,
        raw: Array.from(s.sql.exec('SELECT count(*) FROM t').raw()), one: s.sql.exec('SELECT v FROM t WHERE v = ?', 'y').one().v,
        iter, s: s.kv.get('s'), kvList: Array.from(s.kv.list({ prefix: 's' })) };
    },
    async alarm(ctx, { at }) {
      if (at === 0) { await ctx.storage.deleteAlarm(); return { at: await ctx.storage.getAlarm() }; }
      await ctx.storage.setAlarm(at);
      return { at: await ctx.storage.getAlarm() };
    },
    async bad(ctx) {
      const s = ctx.storage;
      const many = Array.from({ length: 129 }, (_, i) => 'k' + i);
      return {
        key: await codeOf(() => s.put(1, 'x')),
        undef: await codeOf(() => s.put('u', undefined)),
        long: await codeOf(() => s.get('x'.repeat(2049))),
        many: await codeOf(() => s.get(many)),
        both: await codeOf(() => s.list({ start: 'a', startAfter: 'a' })),
        limit: await codeOf(() => s.list({ limit: 0 })),
        ddl: await codeOf(() => s.sql.exec('CREATE TABLE u (x)')),
        one: await codeOf(() => s.sql.exec('SELECT v FROM t').one()),
      };
    },
  },
  alarms: { alarm(ctx) { db.doc('fired/alarm').set({ at: ctx.now }); } },
});
`

// An actor written against ctx.storage: keys and values over documents
// (UTF-8 key order, list options, batches), transactions that read their own
// writes and commit all or nothing, sql.exec cursors, the one alarm, and the
// errors Durable Objects raise.
func TestDurableStorage(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "obj"})
	h.call(admin, "files.push", map[string]any{"store": "obj", "files": files(map[string]string{
		"app.json":      `{"title":"Obj","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":      storageActor,
		"index.html":    "<!doctype html><title>o</title>",
		"sql/001_t.sql": "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);",
	})})
	if st := h.call(admin, "app.status", map[string]any{"store": "obj"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	act := func(name string, args map[string]any) map[string]any {
		return h.call(admin, "actor.call", map[string]any{"store": "obj", "action": name, "args": args}).(map[string]any)
	}
	eq := func(what string, got, want any) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s = %#v, want %#v", what, got, want)
		}
	}

	out := act("kv", nil)
	eq("same", out["same"], true)
	eq("one", out["one"], 1.0)
	eq("missing", out["missing"], true)
	eq("many", out["many"], []any{[]any{"a", 1.0}, []any{"b", map[string]any{"x": []any{1.0, 2.0}}}})
	// UTF-8 byte order: U+FF01 before U+1F600 (UTF-16 order would swap them).
	eq("all", out["all"], []any{"a", "a/b/c", "b", "c/d", "x/y", "~t", "！", "\U0001F600"})
	eq("prefix", out["prefix"], []any{[]any{"c/d", "slash"}})
	eq("reverse", out["reverse"], []any{"\U0001F600", "！"})
	eq("range", out["range"], []any{"a", "a/b/c", "b"})
	eq("after", out["after"], []any{"c/d"})
	eq("deleted", out["deleted"], true)
	eq("deletedAgain", out["deletedAgain"], false)
	eq("n", out["n"], 1.0)
	eq("left", out["left"], []any{"a/b/c", "c/d", "x/y", "~t", "！", "\U0001F600"})
	// Keys are documents: a plain key is its own id, others are hashed.
	h.fail(admin, "docs.get", map[string]any{"store": "obj", "path": "storage/~t"}, "not_found")
	if d := h.call(admin, "docs.get", map[string]any{"store": "obj", "path": "storage/plain"}); d == nil {
		t.Errorf("storage/plain: %v", d)
	}
	docs := h.call(admin, "docs.ls", map[string]any{"store": "obj", "coll": "storage"})
	if s := strings.Join(docPaths(docs), " "); !strings.Contains(s, "storage/~") {
		t.Errorf("storage documents: %s", s)
	}
	eq("clear", h.call(admin, "actor.call", map[string]any{"store": "obj", "action": "clear"}), []any{})
	// A key with slashes is hashed into storage/, so deleteAll reaches it: no
	// nested collection is left behind (review of PR #20).
	if left := docPaths(h.call(admin, "docs.ls", map[string]any{"store": "obj", "coll": "storage/a/b"})); len(left) != 0 {
		t.Errorf("storage/a/b after deleteAll: %v", left)
	}

	out = act("tx", nil)
	eq("tx failed", out["failed"], "conflict")
	eq("tx value", out["v"], "done")
	eq("tx keys", out["keys"], []any{"w"})

	out = act("sync", nil)
	eq("thrown", out["thrown"], "no")
	eq("r", out["r"], 7.0)
	eq("cols", out["cols"], []any{"v", "w"})
	eq("rows", out["rows"], []any{map[string]any{"v": "y", "w": "y"}})
	eq("read", out["read"], 1.0)
	eq("written", out["written"], 2.0)
	eq("raw", out["raw"], []any{[]any{3.0}})
	eq("one", out["one"], "y")
	eq("iter", out["iter"], []any{"y", "p", "q"})
	eq("s", out["s"], 2.0)
	eq("kvList", out["kvList"], []any{[]any{"s", 2.0}})

	out = act("alarm", map[string]any{"at": 4102444800000.0})
	eq("alarm at", out["at"], 4102444800000.0)
	h.call(admin, "alarm.fire", map[string]any{"store": "obj", "name": "alarm"})
	waitFor(t, "the alarm handler", func() bool {
		st, _ := api(t, h, admin, "docs.get", map[string]any{"store": "obj", "path": "fired/alarm"})
		return st == 200
	})
	eq("after delete", act("alarm", map[string]any{"at": 0.0})["at"], nil)

	out = act("bad", nil)
	for k, want := range map[string]string{"key": "invalid_argument", "undef": "invalid_argument", "long": "invalid_argument",
		"many": "invalid_argument", "both": "invalid_argument", "limit": "invalid_argument", "one": "invalid_argument"} {
		eq("bad "+k, out[k], want)
	}
	if out["ddl"] == "ok" {
		t.Errorf("DDL at run time: %v", out["ddl"])
	}
}

// docPaths lists the paths in a docs.ls result.
func docPaths(v any) []string {
	var out []string
	l, _ := v.([]any)
	if m, ok := v.(map[string]any); ok {
		l, _ = m["docs"].([]any)
	}
	for _, d := range l {
		if m, ok := d.(map[string]any); ok {
			p, _ := m["path"].(string)
			out = append(out, p)
		}
	}
	return out
}
