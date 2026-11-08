package host

// SLOP3-016, actor VM migration phase 4: go-go-goja's synchronous data
// modules (yaml, crypto, events) and goja_nodejs's buffer in the catalog,
// usable with use() and require() on both runtimes.

import (
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/config"
)

const bridgedActor = `
const yaml = use('yaml'), crypto = require('crypto'), EventEmitter = require('events');
const { Buffer } = require('buffer');
defineActor({
  actions: {
    run(ctx, { text }) {
      const doc = yaml.parse(text);
      const back = yaml.stringify({ list: doc.list, count: doc.count + 1 });
      const bad = yaml.validate('a: [1, 2');
      const em = new EventEmitter();
      const seen = [];
      em.on('hit', (x) => seen.push(x));
      em.once('hit', (x) => seen.push('once:' + x));
      em.emit('hit', 1); em.emit('hit', 2);
      const { EventEmitter: Named } = require('events');
      const raw = crypto.randomBytes(8);
      const digest = crypto.createHash('sha256').update('slop').digest();
      return {
        doc, back, bad: bad.valid, errors: (bad.errors || []).length,
        seen, named: new Named() instanceof EventEmitter,
        uuid: crypto.randomUUID().length,
        hex: crypto.createHash('sha256').update('slop').digest('hex'),
        rawLength: raw.length, rawIsBuffer: raw instanceof Buffer && digest instanceof Uint8Array,
        digestHex: digest.toString('hex'), b64: Buffer.from('hi').toString('base64'),
        sameYaml: require('yaml') === yaml,
        globalBuffer: typeof Buffer === 'function' && typeof globalThis.Buffer,
      };
    },
  },
});
`

func TestBridgedModules(t *testing.T) {
	for _, rt := range []string{actor.RuntimeDirect, actor.RuntimeEngine} {
		t.Run(rt, func(t *testing.T) {
			h := newHarnessWith(t, func(c *config.Config) { c.Actors.Runtime = rt })
			admin := h.tokenFor("admin@example.com", "read", "write", "admin")
			h.call(admin, "store.new", map[string]any{"id": "br"})
			h.call(admin, "files.push", map[string]any{"store": "br", "files": files(map[string]string{
				"app.json": `{"title":"Bridged","actor":"actor.js"}`,
				"actor.js": bridgedActor,
			})})
			out := h.call(admin, "actor.call", map[string]any{"store": "br", "action": "run",
				"args": map[string]any{"text": "list: [a, b]\ncount: 41\n"}}).(map[string]any)
			want := map[string]any{
				"back": "count: 42\nlist:\n  - a\n  - b\n", "bad": false, "named": true, "uuid": 36.0,
				"rawLength": 8.0, "rawIsBuffer": true, "b64": "aGk=", "sameYaml": true, "globalBuffer": "undefined",
			}
			for k, v := range want {
				if out[k] != v {
					t.Errorf("%s = %#v, want %#v", k, out[k], v)
				}
			}
			if doc := out["doc"].(map[string]any); doc["count"] != 41.0 || len(doc["list"].([]any)) != 2 {
				t.Errorf("yaml.parse = %v", doc)
			}
			if out["errors"].(float64) < 1 {
				t.Errorf("yaml.validate found no errors")
			}
			if seen := out["seen"].([]any); len(seen) != 3 || seen[0] != 1.0 || seen[1] != "once:1" || seen[2] != 2.0 {
				t.Errorf("events: %v", seen)
			}
			if hex := out["hex"].(string); len(hex) != 64 || hex != out["digestHex"] {
				t.Errorf("sha256: hex %q, digest() %q", hex, out["digestHex"])
			}

			// The catalog lists them as data modules, with their TypeScript.
			mods := h.call(admin, "app.modules", map[string]any{}).(map[string]any)
			byName := map[string]map[string]any{}
			for _, m := range mods["modules"].([]any) {
				row := m.(map[string]any)
				byName[row["name"].(string)] = row
			}
			for _, name := range []string{"yaml", "crypto", "events", "buffer"} {
				row := byName[name]
				if row == nil || row["class"] != "data" || row["default"] != true {
					t.Fatalf("%s: %v", name, row)
				}
				if ts, _ := row["typescript"].(string); !strings.Contains(ts, `declare module "`+name+`"`) {
					t.Errorf("%s typescript: %q", name, ts)
				}
			}
		})
	}
}
