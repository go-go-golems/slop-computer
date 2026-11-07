package host

// SLOP3-012 phase 5b: use('fs'), an in-memory tree the actor owns, and
// use('path').

import (
	"encoding/json"
	"strings"
	"testing"
)

func jsonString(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

const fsActor = `
const fs = require('fs'), path = require('path');
fs.mkdirSync('/data');
fs.writeFileSync('/data/boot.txt', 'loaded');
function code(f) { try { f(); return 'ok'; } catch (e) { return e.code; } }
defineActor({
  actions: {
    roundTrip() {
      fs.writeFileSync('/data/a.txt', 'hello');
      fs.appendFileSync('data/a.txt', ' world');
      const bytes = fs.readFileSync('/data/a.txt');
      return [fs.readFileSync('/data/a.txt', 'utf8'), bytes.length, bytes[0], fs.readFileSync('/data/a.txt', { encoding: 'base64' }),
        fs.readdirSync('/data'), fs.statSync('/data').isDirectory(), fs.statSync('/data/a.txt').size, fs.existsSync('/nope'),
        fs.readFileSync('/data/boot.txt', 'utf8')];
    },
    errors() {
      return [code(() => fs.readFileSync('/missing')), code(() => fs.writeFileSync('/no/dir/x', 'y')), code(() => fs.mkdirSync('/data')),
        code(() => fs.rmSync('/data')), code(() => fs.readFileSync('/data')), code(() => fs.readFileSync('/data/a.txt/x')),
        code(() => fs.writeFileSync('/../../etc/passwd', 'x')), fs.existsSync('/etc/passwd')];
    },
    moves() {
      fs.mkdirSync('/m/n', { recursive: true });
      fs.writeFileSync('/m/n/f', new Uint8Array([1, 2, 3]));
      fs.renameSync('/m', '/moved');
      fs.copyFileSync('/moved/n/f', '/moved/g');
      const r = [fs.existsSync('/m'), Array.from(fs.readFileSync('/moved/g')), fs.readdirSync('/moved')];
      fs.rmSync('/moved', { recursive: true });
      return r.concat([fs.existsSync('/moved/n/f'), fs.readdirSync('/')]);
    },
    failAfterWrite() { fs.writeFileSync('/data/rolled', 'x'); throw new Error('boom'); },
    has(ctx, { p }) { return fs.existsSync(p); },
    // Renaming a file onto itself changes nothing, the byte count included.
    selfRename() { for (let i = 0; i < 3; i++) fs.renameSync('/big', '/big'); return [code(() => fs.writeFileSync('/extra', 'x')), fs.existsSync('/big')]; },
    // Data that is no string, ArrayBuffer or typed array is a JavaScript
    // error the action can catch, not a failed turn.
    async badData() {
      let p;
      try { await fs.writeFile('/bad3', { a: 1 }); } catch (e) { p = e.code; }
      return [code(() => fs.writeFileSync('/bad', { a: 1 })), code(() => fs.appendFileSync('/bad2', [1, 2])), p, fs.existsSync('/bad')];
    },
    big(ctx, { n }) { return code(() => fs.writeFileSync('/big', 'x'.repeat(n))); },
    many(ctx, { n }) { for (let i = 0; i < n; i++) { const c = code(() => fs.writeFileSync('/f' + i, '')); if (c !== 'ok') return [i, c]; } return 'ok'; },
    async promised() { await fs.writeFile('/p.txt', 'async'); const s = await fs.readFile('/p.txt', 'utf8'); let c; try { await fs.readFile('/none'); } catch (e) { c = e.code; } return [s, c]; },
    paths() {
      return [path.join('a', 'b/../c', 'd.txt'), path.resolve('x', '/y', 'z'), path.resolve('x'), path.dirname('/a/b/c'), path.basename('/a/b.txt', '.txt'),
        path.extname('f.tar.gz'), path.extname('.profile'), path.isAbsolute('a'), path.relative('/a/b/c', '/a/d'), path.normalize('a//b/./c/'), path.sep];
    },
  },
});
`

func TestFSModule(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "fsx"})
	h.call(admin, "files.push", map[string]any{"store": "fsx", "files": files(map[string]string{
		"app.json": `{"title":"FS","actor":"actor.js"}`,
		"actor.js": fsActor,
	})})
	call := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "fsx", "action": action, "args": args})
	}
	eq := func(name string, got any, want string) {
		t.Helper()
		if s := jsonString(t, got); s != want {
			t.Fatalf("%s:\n got %s\nwant %s", name, s, want)
		}
	}
	eq("roundTrip", call("roundTrip", nil), `["hello world",11,104,"aGVsbG8gd29ybGQ=",["a.txt","boot.txt"],true,11,false,"loaded"]`)
	eq("errors", call("errors", nil), `["ENOENT","ENOENT","EEXIST","ENOTEMPTY","EISDIR","ENOTDIR","ENOENT",false]`)
	eq("moves", call("moves", nil), `[false,[1,2,3],["g","n"],false,["data"]]`)
	eq("paths", call("paths", nil), `["a/c/d.txt","/y/z","/x","/a/b","b",".gz","",false,"../../d","a/b/c/","/"]`)
	eq("promised", call("promised", nil), `["async","ENOENT"]`)
	eq("badData", call("badData", nil), `["invalid_argument","invalid_argument","invalid_argument",false]`)

	// A turn that fails takes its fs writes with it.
	h.fail(admin, "actor.call", map[string]any{"store": "fsx", "action": "failAfterWrite"}, "actor_error")
	if call("has", map[string]any{"p": "/data/rolled"}) != false {
		t.Fatal("a failed turn's write stayed")
	}
	if call("has", map[string]any{"p": "/p.txt"}) != true {
		t.Fatal("a committed write is gone")
	}
	// Default limits: 8 MiB.
	eq("big default", call("big", map[string]any{"n": 9 << 20}), `"ENOSPC"`)

	// A grant sets the limits; a restart (here, the grant's) empties the tree.
	h.call(admin, "app.trust", map[string]any{"app": "fsx", "module": "fs", "config": map[string]any{"maxBytes": 100, "maxFiles": 5}})
	if call("has", map[string]any{"p": "/p.txt"}) != false {
		t.Fatal("the tree survived a restart")
	}
	// The load wrote /data/boot.txt (6 bytes) again: 94 more fit.
	eq("big", call("big", map[string]any{"n": 95}), `"ENOSPC"`)
	eq("big ok", call("big", map[string]any{"n": 94}), `"ok"`)
	eq("selfRename", call("selfRename", nil), `["ENOSPC",true]`)
	// "/", /data, /data/boot.txt and /big exist: one more file fits.
	eq("many", call("many", map[string]any{"n": 3}), `[1,"ENOSPC"]`)
	e := h.fail(admin, "app.trust", map[string]any{"app": "fsx", "module": "fs", "config": map[string]any{"maxBytes": 1 << 30}}, "invalid_argument")
	if !strings.Contains(e["message"].(string), "64 MiB") {
		t.Fatalf("maxBytes: %v", e)
	}
}
